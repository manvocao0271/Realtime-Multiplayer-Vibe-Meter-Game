import math
import os
import random
import time
from gevent import monkey
monkey.patch_all()

from flask import Flask, send_from_directory, request, redirect
from flask_socketio import SocketIO, emit

# ─── Flask & SocketIO setup ───────────────────────────────────────────────────

app = Flask(__name__)
# Default to same-origin WebSocket policy. To allow explicit cross-origin clients,
# set CORS_ALLOWED_ORIGINS as a comma-separated list.
_cors_env = os.environ.get('CORS_ALLOWED_ORIGINS', '').strip()
_cors_allowed = [o.strip() for o in _cors_env.split(',') if o.strip()] if _cors_env else []
socketio = SocketIO(app, cors_allowed_origins=_cors_allowed, async_mode='gevent')

# Short, readable room codes — no visually ambiguous characters (0/O, 1/I/L)
_ROOM_ALPHA = 'BCDFGHJKMNPQRSTVWXYZ2345679'
rooms: dict[str, 'VibeMeterGame'] = {}  # room_code → game instance
sid_to_room: dict[str, str] = {}         # socket_id → room_code

# Basic server-side abuse controls
_event_last_ts: dict[tuple[str, str], float] = {}
_MIN_EVENT_GAP = {
    'live-pos': 0.02,               # allow high-frequency dial streaming, but bounded
    'suggest-phrase': 0.5,
    'vote-suggested-phrase': 0.08,
}
_MAX_PENDING_SUGGESTIONS = 30


def _new_room_code() -> str:
    """Generate a unique 6-character room code not already in use."""
    while True:
        code = ''.join(random.choices(_ROOM_ALPHA, k=6))
        if code not in rooms:
            return code


# ─── Player Class Hierarchy ───────────────────────────────────────────────────

class Player:
    """Base class representing any game participant (active or spectating)."""

    def __init__(self, name: str, join_order: int) -> None:
        self.name = name
        self.score = 0
        self.bullseyes = 0
        self.join_order = join_order
        self.spectator = False
        self.disconnected = False

    def to_dict(self, sid: str) -> dict:
        return {
            'id': sid,
            'name': self.name,
            'score': self.score,
            'bullseyes': self.bullseyes,
            'spectator': self.spectator,
            'joinOrder': self.join_order,
            'disconnected': self.disconnected,
        }


class ActivePlayer(Player):
    """A fully active player who can be the Vibe Man and submit guesses."""

    def __init__(self, name: str, join_order: int) -> None:
        super().__init__(name, join_order)
        self.spectator = False


class SpectatorPlayer(Player):
    """A late-joining participant who observes the game and waits to join next round."""

    def __init__(self, name: str, join_order: int) -> None:
        super().__init__(name, join_order)
        self.spectator = True

    def promote(self) -> ActivePlayer:
        """Return an ActivePlayer with this spectator's name and metadata."""
        active = ActivePlayer(self.name, self.join_order)
        active.score = self.score
        active.bullseyes = self.bullseyes
        active.disconnected = self.disconnected
        return active


# ─── Game State ───────────────────────────────────────────────────────────────

class VibeMeterGame:
    """
    Core game engine — owns all state, validates transitions, and computes scoring.

    Background timers (guess timeout, round-advance) are managed by server-level
    helpers that close over token objects kept on this instance.  Replacing
    game tokens or swapping the global `game` reference automatically
    invalidates any stale background tasks.
    """

    def __init__(self) -> None:
        # Phase: 'lobby' | 'phrase-input' | 'playing' | 'game-over'
        self.phase: str = 'lobby'
        self.players: dict[str, Player] = {}
        self.host: str | None = None

        # Phrases submitted by players; pool shared across rounds
        self.phrases: list[dict] = []
        self.phrase_submissions: set[str] = set()

        self.points_goal: int = 25

        # Vibe Man rotation — ordered list of sids cycling through all active players
        self.vibe_man_rotation: list[str] = []
        self.vibe_man_rotation_idx: int = 0
        self.vibe_man_used_phrases: dict[str, set] = {}

        # Per-round state
        self.round_number: int = 0
        self.round_phase: str | None = None   # 'phrase-select'|'vibe-writing'|'guessing'|'round-results'
        self.current_phrase: dict | None = None
        self.random_value: int | None = None
        self.story: str | None = None
        self.guesses: dict[str, int] = {}
        self.live_positions: dict[str, int] = {}
        self.round_results: list[dict] = []
        self.vibe_man_pts: int | None = None
        self.guess_deadline: int | None = None      # epoch-ms for client countdown
        self.guess_duration: int = 15              # seconds for the guess timer
        self.game_won: bool = False
        self.current_vibe_man_sid: str | None = None  # actual VM for the current round

        # Late-joiners approved for next round
        self.pending_players: set[str] = set()

        # Phrase suggestions proposed during results and voted on by all connected players.
        # Each item: {id, byId, byName, label1, label2, votes:{sid:'yes'|'no'}}
        self.pending_phrase_suggestions: list[dict] = []
        self.next_phrase_suggestion_id: int = 1

        # Token objects used to cancel stale background tasks without threading primitives.
        # A task checks "game._some_token is captured_token" before acting; replacing or
        # nulling the token here is sufficient to prevent stale execution.
        self._guess_token: object | None = None
        self._advance_token: object | None = None

    # ── Helpers ──────────────────────────────────────────────────────────────

    def sorted_players(self) -> list[dict]:
        return sorted(
            (p.to_dict(sid) for sid, p in self.players.items()),
            key=lambda d: d['joinOrder'],
        )

    def active_players(self) -> list[dict]:
        """Return non-spectator, non-disconnected players ordered by join time."""
        return sorted(
            (p.to_dict(sid) for sid, p in self.players.items()
             if not p.spectator and not p.disconnected),
            key=lambda d: d['joinOrder'],
        )

    def next_host_candidate(self, departed_join_order: int | None = None) -> str | None:
        """Pick the next connected player by join order, wrapping around if needed."""
        connected = sorted(
            ((sid, p) for sid, p in self.players.items() if not p.disconnected),
            key=lambda item: item[1].join_order,
        )
        if not connected:
            return None
        if departed_join_order is None:
            return connected[0][0]
        for sid, player in connected:
            if player.join_order > departed_join_order:
                return sid
        return connected[0][0]

    def vibe_man_id(self) -> str | None:
        if self.vibe_man_rotation:
            return self.vibe_man_rotation[self.vibe_man_rotation_idx]
        return None

    def eligible_voter_ids(self) -> list[str]:
        """All non-disconnected players (active + spectator) can vote."""
        return [sid for sid, p in self.players.items() if not p.disconnected]

    def phrase_suggestions_for(self, sid: str) -> list[dict]:
        eligible = set(self.eligible_voter_ids())
        total_voters = len(eligible)
        items = []
        for sug in self.pending_phrase_suggestions:
            votes = sug.get('votes', {})
            yes_votes = sum(1 for pid, v in votes.items() if pid in eligible and v == 'yes')
            no_votes = sum(1 for pid, v in votes.items() if pid in eligible and v == 'no')
            items.append({
                'id': sug['id'],
                'byId': sug['byId'],
                'byName': sug['byName'],
                'label1': sug['label1'],
                'label2': sug['label2'],
                'yesVotes': yes_votes,
                'noVotes': no_votes,
                'totalVoters': total_voters,
                'myVote': votes.get(sid),
            })
        return items

    def resolve_phrase_suggestions(self) -> None:
        """Resolve suggestions at end of results timer.

        Rules:
        - yes >= half of eligible voters -> add phrase and remove suggestion
        - no >= half of eligible voters -> remove suggestion
        - tie (yes == no) -> keep suggestion and keep votes
        - otherwise -> keep suggestion and keep votes
        """
        eligible = set(self.eligible_voter_ids())
        n = len(eligible)
        if n <= 0 or not self.pending_phrase_suggestions:
            return

        half = n / 2.0
        survivors: list[dict] = []

        existing_pairs = {
            (ph.get('label1', '').strip().lower(), ph.get('label2', '').strip().lower())
            for ph in self.phrases
        }

        for sug in self.pending_phrase_suggestions:
            votes = sug.get('votes', {})
            yes_votes = sum(1 for pid, v in votes.items() if pid in eligible and v == 'yes')
            no_votes = sum(1 for pid, v in votes.items() if pid in eligible and v == 'no')

            if yes_votes == no_votes:
                survivors.append(sug)
                continue

            if yes_votes >= half:
                pair = (sug['label1'].strip().lower(), sug['label2'].strip().lower())
                if pair not in existing_pairs:
                    self.phrases.append({
                        'id': len(self.phrases),
                        'byId': sug['byId'],
                        'byName': sug['byName'],
                        'label1': sug['label1'],
                        'label2': sug['label2'],
                    })
                    existing_pairs.add(pair)
                continue

            if no_votes >= half:
                continue

            survivors.append(sug)

        self.pending_phrase_suggestions = survivors

    def get_available_phrases(self, sid: str) -> list[dict]:
        """Return phrases the given Vibe Man can still pick; resets if all used."""
        used = self.vibe_man_used_phrases.get(sid, set())
        available = [ph for ph in self.phrases if ph['id'] not in used]
        if not available and self.phrases:
            self.vibe_man_used_phrases[sid] = set()
            available = list(self.phrases)
        return available

    def build_live_positions(self) -> list[dict]:
        vm = self.vibe_man_id()
        guessers = [p for p in self.active_players() if p['id'] != vm]
        result = []
        for p in guessers:
            pid = p['id']
            submitted = pid in self.guesses
            value = self.guesses[pid] if submitted else self.live_positions.get(pid)
            result.append({'id': pid, 'name': p['name'], 'value': value, 'submitted': submitted})
        return result

    def build_state(self, sid: str) -> dict:
        # Use the round's actual VM during results so a disconnected VM is still credited
        if self.round_phase == 'round-results' and self.current_vibe_man_sid:
            vm = self.current_vibe_man_sid
        else:
            vm = self.vibe_man_id()
        is_vibeman = vm == sid
        player = self.players.get(sid)
        is_spectator = player.spectator if player else True
        show_value = (
            (is_vibeman and self.round_phase in ('vibe-writing', 'guessing'))
            or self.round_phase == 'round-results'
        )
        total_guessers = max(0, len(self.active_players()) - 1)
        live_guesses = (
            self.build_live_positions()
            if self.round_phase == 'guessing' and (sid == vm or sid in self.guesses)
            else []
        )
        vm_name = self.players[vm].name if vm and vm in self.players else None

        return {
            'phase': self.phase,
            'players': self.sorted_players(),
            'host': self.host,
            'isHost': sid == self.host,
            'myId': sid,
            'myName': player.name if player else None,
            'isSpectator': is_spectator,
            'spectatorSubmittedPhrase': sid in self.phrase_submissions,
            'isPending': sid in self.pending_players,
            'phrases': self.phrases,
            'phraseSubmissions': list(self.phrase_submissions),
            'hasSubmittedPhrase': sid in self.phrase_submissions,
            'pointsGoal': self.points_goal,
            'roundNumber': self.round_number,
            'currentPhrase': self.current_phrase,
            'availablePhrases': (
                self.get_available_phrases(sid)
                if is_vibeman and self.round_phase == 'phrase-select' else []
            ),
            'vibeManId': vm,
            'vibeManName': vm_name,
            'isVibeman': is_vibeman,
            'roundPhase': self.round_phase,
            'randomValue': self.random_value if show_value else None,
            'story': self.story,
            'myGuess': self.guesses.get(sid),
            'hasSubmittedGuess': sid in self.guesses,
            'guessCount': len(self.guesses),
            'totalGuessers': total_guessers,
            'liveGuesses': live_guesses,
            'roundResults': self.round_results if self.round_phase == 'round-results' else [],
            'vibeManPts': self.vibe_man_pts if self.round_phase == 'round-results' else None,
            'guessDeadline': self.guess_deadline if self.round_phase == 'guessing' else None,
            'guessDuration': self.guess_duration if self.round_phase == 'guessing' else None,
            'pendingPlayerIds': list(self.pending_players),
            'currentVibeManIdx': self.vibe_man_rotation_idx,
            'totalVibeManSlots': len(self.vibe_man_rotation),
            'phraseSuggestions': self.phrase_suggestions_for(sid),
        }

    # ── Phase Transitions ────────────────────────────────────────────────────

    def begin_game(self) -> None:
        self.phase = 'playing'
        self.vibe_man_rotation = [p['id'] for p in self.active_players()]
        self.vibe_man_rotation_idx = 0
        self.round_number = 0
        self.start_round()

    def start_round(self) -> None:
        # Promote any pending late-joiners into active players
        for sid in list(self.pending_players):
            p = self.players.get(sid)
            if p:
                p.spectator = False
            if sid not in self.vibe_man_rotation:
                self.vibe_man_rotation.append(sid)
        self.pending_players.clear()

        if self.vibe_man_rotation:
            self.vibe_man_rotation_idx %= len(self.vibe_man_rotation)

        if len(self.active_players()) < 2:
            self.end_game()
            return

        self.round_number += 1
        self.random_value = random.randint(1, 100)
        self.current_phrase = None
        self.story = None
        self.guesses = {}
        self.live_positions = {}
        self.round_results = []
        self.vibe_man_pts = None
        self.guess_deadline = None
        self.game_won = False

        # Nulling these tokens invalidates any background tasks from the previous round
        self._guess_token = None
        self._advance_token = None

        self.current_vibe_man_sid = self.vibe_man_id()
        self.round_phase = 'phrase-select'

    def resolve_round(self) -> None:
        # Invalidate the guess timer so it cannot fire a second time
        self._guess_token = None

        # Auto-submit for any eligible player who didn't lock in a guess:
        # use their last live drag position, or 50 as a neutral fallback.
        vm = self.current_vibe_man_sid or self.vibe_man_id()
        for p in self.active_players():
            pid = p['id']
            if pid != vm and pid not in self.guesses:
                self.guesses[pid] = self.live_positions.get(pid, 50)

        results = []
        if self.random_value is not None:
            in_extreme_true = self.random_value <= 5 or self.random_value >= 96
            for sid, guess in self.guesses.items():
                diff = abs(guess - self.random_value)
                base_pts = 7 if diff == 0 else (3 if diff <= 5 else (2 if diff <= 7 else (1 if diff <= 9 else 0)))
                in_extreme_guess = guess <= 5 or guess >= 96
                if in_extreme_guess:
                    pts = base_pts * 2 if in_extreme_true else 0
                else:
                    pts = base_pts
                p = self.players.get(sid)
                if p:
                    p.score += pts
                    if diff == 0:
                        p.bullseyes += 1
                results.append({
                    'id': sid,
                    'name': p.name if p else '?',
                    'guess': guess,
                    'diff': diff,
                    'pts': pts,
                    'extremeGuess': in_extreme_guess,
                    'extremeTrue': in_extreme_true,
                })
        results.sort(key=lambda r: (-r['pts'], r['diff']))
        self.round_results = results

        if results:
            avg_pts = sum(r['pts'] for r in results) / len(results)
            vm_pts = math.ceil(avg_pts)
            if vm is not None:
                vm_player = self.players.get(vm)
                if vm_player:
                    vm_player.score += vm_pts
            self.vibe_man_pts = vm_pts
        else:
            self.vibe_man_pts = 0

        self.game_won = any(
            not p.spectator and p.score >= self.points_goal
            for p in self.players.values()
        )

        # Fresh token for the advance timer (set after scoring so callers can capture it)
        self._advance_token = object()
        self.round_phase = 'round-results'

    def end_game(self) -> None:
        self.phase = 'game-over'


# ─── Room Helpers ────────────────────────────────────────────────────────────

def _game_for(sid: str) -> tuple[str, VibeMeterGame] | None:
    """Return (room_code, game) for the given socket, or None."""
    code = sid_to_room.get(sid)
    if not code:
        return None
    game = rooms.get(code)
    if not game:
        return None
    return code, game


def broadcast(code: str) -> None:
    """Push a personalised state snapshot to every socket in the room."""
    game = rooms.get(code)
    if not game:
        return
    for sid, rc in list(sid_to_room.items()):
        if rc == code:
            socketio.emit('state', game.build_state(sid), to=sid)


def _sid() -> str:
    """Return the socket ID of the current Flask-SocketIO connection."""
    return request.sid  # type: ignore[attr-defined]


def _allow_event(sid: str, event: str) -> bool:
    """Simple in-memory per-sid throttle to reduce event spam/DoS impact."""
    gap = _MIN_EVENT_GAP.get(event)
    if not gap:
        return True
    now = time.monotonic()
    key = (sid, event)
    prev = _event_last_ts.get(key)
    if prev is not None and now - prev < gap:
        return False
    _event_last_ts[key] = now
    return True


# ─── Background Task Helpers ──────────────────────────────────────────────────

def start_guess_timer(code: str) -> None:
    game = rooms.get(code)
    if not game:
        return
    token = object()
    game._guess_token = token
    duration = game.guess_duration

    def _run() -> None:
        socketio.sleep(duration)
        g = rooms.get(code)
        if g is None or g._guess_token is not token:
            return
        if g.round_phase == 'guessing':
            g.resolve_round()
            broadcast(code)
            _schedule_advance(code)

    socketio.start_background_task(_run)


def _schedule_advance(code: str) -> None:
    game = rooms.get(code)
    if not game:
        return
    token = game._advance_token

    def _run() -> None:
        socketio.sleep(10)
        g = rooms.get(code)
        if g is None or g._advance_token is not token:
            return
        if g.round_phase != 'round-results':
            return
        g.resolve_phrase_suggestions()
        if g.game_won:
            g.end_game()
        else:
            g.vibe_man_rotation_idx = (
                (g.vibe_man_rotation_idx + 1) % max(1, len(g.vibe_man_rotation))
            )
            g.start_round()
        broadcast(code)

    socketio.start_background_task(_run)


def resolve_and_advance(code: str) -> None:
    game = rooms.get(code)
    if not game:
        return
    game.resolve_round()
    broadcast(code)
    _schedule_advance(code)


# ─── Periodic Room Cleanup ────────────────────────────────────────────────────

def _cleanup_rooms() -> None:
    """Remove rooms that have no active connections (runs every 10 minutes)."""
    while True:
        socketio.sleep(600)
        active_codes = set(sid_to_room.values())
        stale = [c for c in list(rooms) if c not in active_codes]
        for c in stale:
            del rooms[c]
        if stale:
            print(f'[cleanup] Removed {len(stale)} empty room(s)')


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route('/')
def new_room():
    """Create a fresh room and redirect the host to its unique URL."""
    code = _new_room_code()
    rooms[code] = VibeMeterGame()
    return redirect(f'/{code}')


@app.route('/<path:path>')
def catch_all(path: str):
    # Serve files that exist in public/ (CSS, JS, images, etc.)
    public_root = os.path.realpath(os.path.join(app.root_path, 'public'))
    static_path = os.path.realpath(os.path.join(public_root, path))
    if static_path.startswith(public_root + os.sep) and os.path.isfile(static_path):
        return send_from_directory('public', path)
    # Single-segment paths are treated as room codes
    if '/' not in path:
        code = path.upper()
        if code in rooms:
            return send_from_directory('public', 'index.html')
    return redirect('/')


@app.after_request
def set_security_headers(resp):
    # Defense-in-depth browser hardening headers.
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('X-Frame-Options', 'DENY')
    resp.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    resp.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    return resp


# ─── Socket Events ────────────────────────────────────────────────────────────

@socketio.on('connect')
def on_connect():
    sid = _sid()
    code = request.args.get('room', '').upper()
    if not code or code not in rooms:
        emit('err', 'Invalid or expired room.')
        return False
    sid_to_room[sid] = code
    print(f'[+] Connected: {sid} \u2192 {code}')
    emit('state', rooms[code].build_state(sid))


@socketio.on('join')
def on_join(data):
    sid = _sid()
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    name = (data.get('name') or '').strip()[:20]
    if not name:
        return emit('err', 'Name is required.')

    # ── Reconnection: restore a disconnected player under the new sid ──────
    reconnect = next(
        ((old_id, p) for old_id, p in game.players.items()
         if p.disconnected and p.name.lower() == name.lower()),
        None,
    )
    if reconnect:
        old_id, player_data = reconnect
        player_data.disconnected = False
        del game.players[old_id]
        game.players[sid] = player_data

        if old_id in game.vibe_man_rotation:
            idx = game.vibe_man_rotation.index(old_id)
            game.vibe_man_rotation[idx] = sid
        elif not player_data.spectator:
            # Only restore active (non-spectator) players to the rotation
            game.vibe_man_rotation.append(sid)

        if game.host == old_id:
            game.host = sid
        if old_id in game.phrase_submissions:
            game.phrase_submissions.discard(old_id)
            game.phrase_submissions.add(sid)
        if old_id in game.vibe_man_used_phrases:
            game.vibe_man_used_phrases[sid] = game.vibe_man_used_phrases.pop(old_id)
        if old_id in game.guesses:
            game.guesses[sid] = game.guesses.pop(old_id)
        if old_id in game.pending_players:
            game.pending_players.discard(old_id)
            game.pending_players.add(sid)
        for sug in game.pending_phrase_suggestions:
            if sug.get('byId') == old_id:
                sug['byId'] = sid
            votes = sug.get('votes', {})
            if old_id in votes:
                votes[sid] = votes.pop(old_id)

        broadcast(code)
        return

    # ── Prevent duplicate active names ─────────────────────────────────────
    if any(not p.disconnected and p.name.lower() == name.lower()
           for p in game.players.values()):
        return emit('err', f'The name "{name}" is already taken.')

    if game.phase == 'lobby':
        game.players[sid] = ActivePlayer(name, len(game.players))
        if not game.host:
            game.host = sid
    else:
        game.players[sid] = SpectatorPlayer(name, len(game.players))

    broadcast(code)


@socketio.on('start')
def on_start(data):
    sid = _sid()
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    if sid != game.host or game.phase != 'lobby':
        return
    if len(game.active_players()) < 2:
        return emit('err', 'Need at least 2 players to start.')

    data = data or {}
    valid_goals = {25, 50, 75}
    try:
        goal = int(data.get('pointsGoal', 25))
    except (TypeError, ValueError):
        goal = 25
    game.points_goal = goal if goal in valid_goals else 25
    game.phase = 'phrase-input'
    broadcast(code)


@socketio.on('phrase')
def on_phrase(data):
    sid = _sid()
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    if sid in game.phrase_submissions:
        return

    data = data or {}
    label1 = (data.get('label1') or '').strip()[:50]
    label2 = (data.get('label2') or '').strip()[:50]
    if not label1 or not label2:
        return emit('err', 'Both phrases are required.')

    player = game.players.get(sid)
    if not player or player.spectator:
        return

    game.phrases.append({
        'id': len(game.phrases),
        'byId': sid,
        'byName': player.name,
        'label1': label1,
        'label2': label2,
    })
    game.phrase_submissions.add(sid)

    if game.phase == 'phrase-input':
        active_ids = {p['id'] for p in game.active_players()}
        if all(aid in game.phrase_submissions for aid in active_ids):
            game.begin_game()
        broadcast(code)


@socketio.on('join-next-round')
def on_join_next_round():
    sid = _sid()
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair
    player = game.players.get(sid)
    if not player or not player.spectator:
        return
    game.pending_players.add(sid)
    broadcast(code)


@socketio.on('suggest-phrase')
def on_suggest_phrase(data):
    sid = _sid()
    if not _allow_event(sid, 'suggest-phrase'):
        return
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    if game.phase != 'playing':
        return

    player = game.players.get(sid)
    if not player or player.disconnected:
        return

    if len(game.pending_phrase_suggestions) >= _MAX_PENDING_SUGGESTIONS:
        return emit('err', 'Too many pending suggestions. Vote on existing ones first.')

    data = data or {}
    label1 = (data.get('label1') or '').strip()[:20]
    label2 = (data.get('label2') or '').strip()[:20]
    if not label1 or not label2:
        return emit('err', 'Both opposite phrases are required.')
    if label1.lower() == label2.lower():
        return emit('err', 'Phrases must be different.')

    # Prevent exact duplicates against existing and pending pairs
    pair_key = (label1.lower(), label2.lower())
    reverse_key = (label2.lower(), label1.lower())
    existing = {
        (ph.get('label1', '').strip().lower(), ph.get('label2', '').strip().lower())
        for ph in game.phrases
    }
    pending = {
        (s.get('label1', '').strip().lower(), s.get('label2', '').strip().lower())
        for s in game.pending_phrase_suggestions
    }
    if pair_key in existing or reverse_key in existing or pair_key in pending or reverse_key in pending:
        return emit('err', 'That phrase pair already exists.')

    game.pending_phrase_suggestions.append({
        'id': game.next_phrase_suggestion_id,
        'byId': sid,
        'byName': player.name,
        'label1': label1,
        'label2': label2,
        'votes': {},
    })
    game.next_phrase_suggestion_id += 1
    broadcast(code)


@socketio.on('vote-suggested-phrase')
def on_vote_suggested_phrase(data):
    sid = _sid()
    if not _allow_event(sid, 'vote-suggested-phrase'):
        return
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    if game.phase != 'playing':
        return

    player = game.players.get(sid)
    if not player or player.disconnected:
        return

    data = data or {}
    try:
        suggestion_id = int(data.get('suggestionId', -1))
    except (TypeError, ValueError):
        return
    vote = (data.get('vote') or '').strip().lower()
    if vote not in ('yes', 'no'):
        return

    suggestion = next((s for s in game.pending_phrase_suggestions if s.get('id') == suggestion_id), None)
    if not suggestion:
        return

    suggestion.setdefault('votes', {})[sid] = vote
    broadcast(code)



@socketio.on('select-phrase')
def on_select_phrase(data):
    sid = _sid()
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    if game.round_phase != 'phrase-select' or game.vibe_man_id() != sid:
        return

    data = data or {}
    try:
        phrase_id = int(data.get('phraseId', -1))
    except (TypeError, ValueError):
        return

    phrase = next((ph for ph in game.phrases if ph['id'] == phrase_id), None)
    if not phrase:
        return emit('err', 'Invalid phrase.')

    available = game.get_available_phrases(sid)
    if not any(ph['id'] == phrase_id for ph in available):
        return emit('err', 'That phrase is not available.')

    game.vibe_man_used_phrases.setdefault(sid, set()).add(phrase_id)
    game.current_phrase = phrase
    game.round_phase = 'vibe-writing'
    broadcast(code)


@socketio.on('story')
def on_story(data):
    sid = _sid()
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    if game.round_phase != 'vibe-writing' or game.vibe_man_id() != sid:
        return

    data = data or {}
    story = (data.get('story') or '').strip()[:600]
    if not story:
        return emit('err', 'You must write a story.')

    game.story = story
    game.round_phase = 'guessing'
    game.guess_duration = 15 + min(sum(1 for c in story if c != ' '), 15)
    game.guess_deadline = int(time.time() * 1000) + game.guess_duration * 1000
    start_guess_timer(code)
    broadcast(code)


@socketio.on('live-pos')
def on_live_pos(data):
    sid = _sid()
    if not _allow_event(sid, 'live-pos'):
        return
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    if game.round_phase != 'guessing':
        return
    vm = game.vibe_man_id()
    if sid == vm:
        return
    player = game.players.get(sid)
    if not player or player.spectator:
        return

    data = data or {}
    try:
        v = max(1, min(100, round(float(data.get('value', 0)))))
    except (TypeError, ValueError):
        return

    game.live_positions[sid] = v
    payload = game.build_live_positions()
    for sock_id, rc in list(sid_to_room.items()):
        if rc == code and (sock_id == vm or sock_id in game.guesses):
            socketio.emit('live-positions', payload, to=sock_id)


@socketio.on('guess')
def on_guess(data):
    sid = _sid()
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair

    if game.round_phase != 'guessing':
        return
    vm = game.vibe_man_id()
    if sid == vm or sid in game.guesses:
        return
    player = game.players.get(sid)
    if not player or player.spectator:
        return

    data = data or {}
    try:
        v = max(1, min(100, round(float(data.get('value', 0)))))
    except (TypeError, ValueError):
        return

    game.guesses[sid] = v
    broadcast(code)

    eligible = [p for p in game.active_players() if p['id'] != vm]
    if eligible and all(p['id'] in game.guesses for p in eligible):
        resolve_and_advance(code)


@socketio.on('restart')
def on_restart():
    sid = _sid()
    pair = _game_for(sid)
    if not pair:
        return
    code, game = pair
    if sid != game.host:
        return
    rooms[code] = VibeMeterGame()
    for s, rc in list(sid_to_room.items()):
        if rc == code:
            socketio.emit('reset', to=s)


@socketio.on('disconnect')
def on_disconnect():
    sid = _sid()
    pair = _game_for(sid)
    sid_to_room.pop(sid, None)
    for key in [k for k in _event_last_ts if k[0] == sid]:
        _event_last_ts.pop(key, None)
    print(f'[-] Disconnected: {sid}')

    if not pair:
        return
    code, game = pair

    player = game.players.get(sid)
    departed_join_order = player.join_order if player else None

    if game.phase == 'lobby':
        game.players.pop(sid, None)
        if game.host == sid:
            game.host = game.next_host_candidate(departed_join_order)
        broadcast(code)
        return

    if not player:
        return

    player.disconnected = True
    if game.host == sid:
        game.host = game.next_host_candidate(departed_join_order)

    # Demote to spectator so they leave the active rotation and appear in the spectators list
    player.spectator = True
    game.pending_players.discard(sid)
    was_vibe_man = game.vibe_man_id() == sid

    # Remove from rotation; keep index pointing at the same next player
    if sid in game.vibe_man_rotation:
        rot_idx = game.vibe_man_rotation.index(sid)
        game.vibe_man_rotation.remove(sid)
        if rot_idx < game.vibe_man_rotation_idx:
            game.vibe_man_rotation_idx = max(0, game.vibe_man_rotation_idx - 1)
        if game.vibe_man_rotation:
            game.vibe_man_rotation_idx %= len(game.vibe_man_rotation)

    if game.phase == 'phrase-input':
        # If all remaining active players have submitted, the game can begin
        active_ids = {p['id'] for p in game.active_players()}
        if len(active_ids) < 2:
            game.phase = 'lobby'  # not enough players to continue
        elif active_ids and all(aid in game.phrase_submissions for aid in active_ids):
            game.begin_game()
        broadcast(code)
        return

    if game.phase != 'playing':
        broadcast(code)
        return

    # Vibe Man left — skip to next player or resolve the current round
    if was_vibe_man and game.round_phase in ('phrase-select', 'vibe-writing', 'guessing'):
        if game.round_phase == 'guessing':
            resolve_and_advance(code)
        else:
            game.start_round()
            broadcast(code)
        return

    # A guesser left — resolve early if no one eligible remains
    if game.round_phase == 'guessing':
        vm = game.vibe_man_id()
        eligible = [p for p in game.active_players() if p['id'] != vm]
        if not eligible or all(p['id'] in game.guesses for p in eligible):
            resolve_and_advance(code)
            return

    broadcast(code)


# ─── Entry Point ──────────────────────────────────────────────────────────────

PORT = int(os.environ.get('PORT', 3000))

if __name__ == '__main__':
    socketio.start_background_task(_cleanup_rooms)
    print(f'\n\U0001f3ae  Vibe Meter is running!')
    print(f'   \u279c  http://localhost:{PORT}')
    print(f'   Visit / to create a new room \u2014 share the URL with friends!\n')
    try:
        socketio.run(app, host='0.0.0.0', port=PORT)
    except KeyboardInterrupt:
        print('\nStopped.')
