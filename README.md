# 🎛️ Vibe Meter

A real-time multiplayer party game where one player writes a "vibe story" — a short description anchored to a secret number on a 1–100 spectrum — and everyone else tries to guess the number by reading the vibe.

---

## How to Play

### Setup
1. Run the server and visit `http://localhost:3000`. A unique room is created automatically and you are redirected to its URL (e.g. `http://localhost:3000/ABCDEF`).
2. Share that URL with friends — they join by opening the same link.
3. The **first player to join** becomes the host.
4. The host picks a **points goal** (25, 50, or 75) and clicks *Start Game*.
5. Every player enters a pair of **polar-opposite phrases** (e.g. *"morning person"* vs *"night owl"*, *"totally sober"* vs *"blackout drunk"*). These become the scoring scales for the rounds.

### Gameplay Loop

Rounds rotate until a player reaches the points goal:

1. **Vibe Man assigned** — players rotate through the role. The Vibe Man is secretly given a random integer 1–100, where 1 is the left phrase and 100 is the right.
2. **Phrase select** — the Vibe Man picks a phrase from the pool (phrases they've already used are tracked and reset automatically when all are exhausted).
3. **Write a story** — the Vibe Man writes a short story that captures the feeling of their secret number on the chosen spectrum, without mentioning the number.
4. **Guessing** — all other players drag an interactive semicircular dial to a number and lock in their guess. The timer (15–30 s, scaled to story length) auto-submits the last drag position on expiry.
5. **Scoring:**

   | Diff from true value | Guesser points | Vibe Man points |
   |----------------------|----------------|-----------------|
   | Exact (0)            | **7 pts**      | ⌈avg of all guessers' pts⌉ |
   | ≤ 5                  | 3 pts          | same |
   | ≤ 7                  | 2 pts          | same |
   | ≤ 9                  | 1 pt           | same |
   | > 9                  | 0 pts          | same |

   The Vibe Man earns the **ceiling of the average guessers' score** — good writing benefits everyone.

   **🔥 Extreme Zone (guesses 1–5 or 96–100):** Betting on an extreme is all-or-nothing.
   - True value **also in the zone** → **14 pts** for a direct hit, **6 pts** for any other in-zone guess
   - True value **outside the zone** → **0 pts**, regardless of proximity

6. Results show every player's guess overlaid on the spectrum dial. The leaderboard updates with points earned this round.
7. Play continues, rotating the Vibe Man, until a player hits the goal.

---

## Running Locally

```bash
pip install -r requirements.txt
python app.py   # →  http://localhost:3000
```

Visit `http://localhost:3000` — a room is created automatically and you'll be redirected to its URL. Share `http://<your-local-ip>:3000` with anyone on the same Wi-Fi to let them create or join rooms.

### Exposing via Cloudflare Tunnel (for remote players)

Open a **second terminal** and run:

```bash
cloudflared tunnel --url localhost:3000
```

Cloudflare will print a public `https://` URL. Share the full room URL (e.g. `https://<tunnel>.trycloudflare.com/ABCDEF`) with anyone, anywhere.

| Terminal | Command | Purpose |
|----------|---------|---------|
| 1 | `python app.py` | Start the Python game server on `localhost:3000` |
| 2 | `cloudflared tunnel --url localhost:3000` | Expose the server publicly via Cloudflare Tunnel |

**Stack:** Python · Flask · Flask-SocketIO · gevent (WebSockets)

---

## Current Architecture

The backend is a **single-process Python monolith** supporting multiple concurrent rooms:

```
Browser (Socket.IO client)
        |
        │  WebSocket  (connects with ?room=CODE)
        ▼
  Python / Flask + Flask-SocketIO (gevent)
  ┌──────────────────────────────────────────────────┐
  │  Player  ◄──  ActivePlayer                       │
  │          ◄──  SpectatorPlayer                    │
  │                                                  │
  │  rooms: dict[str, VibeMeterGame]                 │
  │    ABCDEF → VibeMeterGame  (phases & scoring)    │
  │    XYZW12 → VibeMeterGame                        │
  │    …                                             │
  │  Socket event handlers                           │
  └──────────────────────────────────────────────────┘
```

Game state lives in per-room `VibeMeterGame` instances stored in a `rooms` dict keyed by 6-character room codes. Every Socket.IO event mutates the relevant instance and calls `broadcast(code)`, which rebuilds a personalised state snapshot for each connected socket in that room and pushes it out simultaneously.

This is intentionally minimal — no database, no authentication, no persistence between sessions.

### Class Hierarchy

```
Player  (base — name, sid, score, is_host)
├── ActivePlayer   — has vibe-man rotation slot, guess state, phrase history
└── SpectatorPlayer — observer; submits a phrase to the pending queue;
                      promoted to ActivePlayer at the start of the next round
```

### Server State Machine

```
lobby ──► phrase-input ──► playing ──► game-over
                               │
              ┌────────────────┴────────────────────────────┐
              │                  roundPhase                 │
              │                                             │
         phrase-select ──► vibe-writing ──► guessing ──► round-results
              ▲                                             │
              └──────────── (next round) ───────────────────┘
                            (loops until points goal reached)
```

### Multi-Room Layout

```
rooms: dict[str, VibeMeterGame]
  ABCDEF → VibeMeterGame   (players, phase, round state …)
  XYZW12 → VibeMeterGame
  …

sid_to_room: dict[str, str]   ← reverse index for O(1) disconnect lookup
```

`GET /` auto-creates a room, generates a 6-character alphanumeric code, and redirects the browser to `/<CODE>`. Subsequent visitors to the same URL join the existing room.

### Broadcast / State Flow

```
Socket.IO event received
        │
        ▼
event handler  →  mutates VibeMeterGame
        │
        ▼
broadcast(code)
        │  for each sid in room:
        ▼
build_state(sid)          ← personalises snapshot (isVibeman, hasSubmittedGuess, …)
        │
        ▼
emit('state', snapshot)   → browser
```

### Background Task Pattern (Token Cancellation)

Background tasks (scaled guess timer, round-advance delay, room cleanup) are launched with `socketio.start_background_task()`. Cancellation is done without threading primitives:

```python
self._guess_token = object()      # create a new token
token = self._guess_token         # capture by reference

def task():
    socketio.sleep(duration)
    if token is not self._guess_token:   # token replaced → stale, bail out
        return
    # … advance phase …

socketio.start_background_task(task)
```

Replacing `self._guess_token` (e.g. when a new round starts) silently invalidates any pending task.

### Client Render Pipeline

```
socket 'state' event
        │
        ▼
currentState = data
render()
        │
    phase switch
    ├── lobby         → renderLobby()         + attachLobbyListeners()
    ├── phrase-input  → renderPhraseInput()   + attachPhraseListeners()
    ├── playing       → renderPlaying()
    │     └── roundPhase switch
    │           ├── phrase-select  → renderPhraseSelect()  /  renderWaitForPhraseSelect()
    │           ├── vibe-writing   → renderVibeManWrite()  /  renderGuessing() [isWaiting branch]
    │           ├── guessing       → renderVibeManWaiting() / renderGuessing() [pre/post-submit branch]
    │           └── round-results  → renderResults()
    └── game-over     → renderGameOver()      + attachGameOverListeners()
```

`renderGuessing()` has three branches keyed by `roundPhase` and `hasSubmittedGuess`:

| Branch | Condition | Dial behaviour |
|--------|-----------|----------------|
| **isWaiting** | `roundPhase === 'vibe-writing'` | Needle oscillates via `requestAnimationFrame`; no interaction |
| **pre-submit** | guessing phase, guess not yet locked | Interactive drag/click dial in a unified card with the vibe story |
| **post-submit** | guessing phase, guess locked in | Dial removed; story-only card + mini-dial live dashboard |

Each branch shows the same **tip card** (`_currentRoundTip`) — one tip is picked per round via a shuffled-deck cycle and held constant until `renderResults()` resets it.

### Client-Side Features (fully implemented)

| Feature | Detail |
|---------|--------|
| **Unified guessing screen** | A single `renderGuessing()` handles three states: oscillating locked dial while Vibe Man writes, interactive dial + vibe story for active guessing, and a story-only card after locking in a guess |
| **Interactive SVG dial** | Semicircular gauge for submitting guesses; drag or click, full mouse + touch support |
| **Phrase-select screen** | Vibe Man picks which submitted phrase to use each round; the server tracks which phrases they've used recently and auto-resets when all are exhausted |
| **Scaled guess timer** | Timer runs 15–30 s depending on story length (characters excl. spaces, capped at +15 s); countdown bar and live second-ticker; round auto-resolves on expiry |
| **Live drag positions** | While guessing, each player's dial position is streamed to the server (throttled ~25 fps) and forwarded to the current Vibe Man **and any guesser who has already submitted** as a mini-dial dashboard |
| **Tip system** | One tip from a shuffled deck is shown per round across all three guessing states; tips cover scoring brackets, extreme-zone rules, and strategy hints |
| **Vibe Man scoring** | After each round the Vibe Man earns ⌈average guessers' score⌉, incentivising clear writing |
| **Bullseye tracker** | Scores ≤ 5 away are counted separately per player and displayed with 🎯 in the leaderboard sidebar |
| **Points goal selector** | Host picks 25, 50, or 75 as the winning threshold in the lobby before starting |
| **Spectator / late-join flow** | Players who join mid-game spectate, submit a phrase, and are promoted to full players at the start of the next round |
| **Player reconnection** | If a player disconnects and rejoins with the same name, their score, rotation slot, and phrase history are fully restored |
| **In-place DOM patching** | The phrase-input and guessing screens patch counters and mini-dials without replacing interactive elements, preventing flicker |
| **Multi-room support** | Each visiting browser automatically gets its own isolated room; stale rooms with no active connections are cleaned up automatically |
| **Name persistence** | Player name is saved to `localStorage` and pre-filled on re-open; capped at 10 characters |
| **Results visualisation** | After each round, a unified card shows the dial with every guess overlaid plus the vibe story; the leaderboard sidebar updates live |
| **Restart flow** | Host can restart from the game-over screen; all clients reset via a `reset` Socket.IO event |
| **XSS prevention** | All user-supplied strings are HTML-escaped via a dedicated `esc()` helper before injection into the DOM |
| **Toast notifications** | Non-blocking error / info toasts with auto-dismiss and slide-out animation |

---

## Planned Distributed Systems Integration

The goal of this project is to evolve the above monolith into a reference implementation for full-scale distributed systems patterns. The planned layers are:

### 1. Stateless Horizontally-Scaled API Servers
Replace the single process with **N identical, stateless Node.js instances** behind a load balancer (e.g. NGINX or an AWS ALB). No instance owns state; they are all equal workers.

### 2. Shared State with Redis
Move the in-memory `game` object into **Redis** (hash / sorted-set structures). All server instances read and write the same authoritative state. Redis also acts as the **Socket.IO adapter** (via `@socket.io/redis-adapter`) so that a `broadcast()` from one instance fans out to sockets connected to any other instance.

```
Load Balancer (sticky or stateless)
     │
  ┌──┴──┐   ┌─────┐   ┌─────┐
  │ App │   │ App │   │ App │   ← N stateless Node.js workers
  └──┬──┘   └──┬──┘   └──┬──┘
     └─────────┼─────────┘
               │
         ┌─────▼──────┐
         │    Redis   │  ← shared game state + pub/sub fan-out
         └────────────┘
```

### 3. Event-Driven Backbone with a Message Queue
Game lifecycle events (`round_started`, `story_submitted`, `round_resolved`) are published to **Kafka** (or RabbitMQ). Downstream consumers can:
- Persist results to a **PostgreSQL** database for historical leaderboards.
- Trigger analytics or anti-cheat pipelines asynchronously without blocking the request path.

### 4. Service Decomposition
Break the single `server.js` into independently deployable services:

| Service | Responsibility |
|---------|---------------|
| **Gateway** | WebSocket handshake, auth, rate-limiting |
| **Game Service** | Phase transitions, scoring logic |
| **State Service** | Redis read/write abstraction |
| **Notification Service** | Fan-out broadcasts via Socket.IO adapter |
| **Persistence Service** | Kafka consumer → Postgres writes |

### 5. Observability
- **Distributed tracing** (OpenTelemetry + Jaeger) across service boundaries.
- **Metrics** (Prometheus + Grafana) for active games, event throughput, latency percentiles.
- **Structured logging** (Pino → stdout → Loki/ELK) with correlation IDs per game session.

### 6. Resilience Patterns
- **Circuit breakers** between the game service and Redis/Kafka to avoid cascading failures.
- **Graceful disconnect handling** — basic reconnect is fully implemented (host migration, guesser drop, same-name session restore with score intact); to be hardened with a Redis-backed session-recovery handshake so reconnects survive server restarts or cross-instance hops.
- **Leader election** for the host role using a distributed lock (Redis `SET NX`) so host state survives the original socket disconnecting.

---

## Roadmap

### Completed
- [x] Core game loop (lobby → phrase input → phrase select → vibe writing → guessing → scoring)
- [x] Points goal selector in lobby (25, 50, or 75 pts)
- [x] Vibe Man phrase-select screen with per-player phrase-usage tracking and auto-reset
- [x] 15–30 s scaled guess countdown with auto-resolve on expiry
- [x] Vibe Man scoring (earns ⌈avg guessers' pts⌉ each round)
- [x] Extreme zone scoring (1–5 / 96–100: all-or-nothing, up to 14 pts)
- [x] Bullseye tracking (≤ 5 away scores counted and shown per player in leaderboard)
- [x] Host management and host-migration on disconnect
- [x] Disconnect edge-case handling (vibe-man skip, guesser drop, lobby cleanup)
- [x] Player reconnection — same-name rejoin restores score, rotation slot, and phrase history
- [x] Spectator / late-joiner system with pending-player queue
- [x] Real-time live drag-position streaming to Vibe Man and submitted guessers
- [x] Interactive SVG dial with mouse and touch support
- [x] Mini-dial dashboard during the guessing phase
- [x] Unified guessing screen — oscillating locked dial during vibe-writing, interactive dial + story pre-submit, story-only post-submit
- [x] Tip system — one shuffled-deck tip per round, shown across all waiting/guessing states
- [x] In-place DOM patching (no flicker while typing or during live guessing)
- [x] Leaderboard sidebar — 260 px, centered flex layout, consistent font sizing
- [x] Visual results dial — player guesses overlaid on the spectrum in a unified card with the story
- [x] Restart / Play Again flow from game-over screen
- [x] Name persistence via `localStorage` (capped at 10 characters)
- [x] XSS-safe HTML escaping throughout the client

### Upcoming
- [ ] Redis shared-state layer + Socket.IO Redis adapter
- [ ] Kafka event bus + PostgreSQL persistence
- [ ] Service decomposition and containerisation (Docker Compose)
- [ ] Kubernetes deployment manifests
- [ ] OpenTelemetry tracing and Prometheus metrics
- [ ] Auth / room codes so multiple games can run in parallel
