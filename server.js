const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ─── Game State ───────────────────────────────────────────────────────────────

let game = newGame();

function newGame() {
  return {
    phase: 'lobby',          // 'lobby' | 'phrase-input' | 'playing' | 'game-over'
    players: new Map(),       // socketId → { name, score, joinOrder, spectator }
    host: null,
    phrases: [],              // { id, byId, byName, label1, label2 }
    phraseSubmissions: new Set(),
    pointsGoal: 25,           // 25 | 50 | 75 — first to reach this wins
    vibeManRotation: [],      // ordered list of socketIds cycling through all players
    vibeManRotationIdx: 0,    // current index into rotation (wraps around)
    vibeManUsedPhrases: new Map(), // socketId → Set<phraseId> — per-player phrase history
    roundNumber: 0,
    currentPhrase: null,      // phrase chosen by Vibe Man for the current round
    randomValue: null,
    story: null,
    guesses: new Map(),       // socketId → number
    livePositions: new Map(), // socketId → number  (real-time drag, not yet submitted)
    roundResults: [],
    vibeManPts: null,
    roundPhase: null,         // 'phrase-select' | 'vibe-writing' | 'guessing' | 'round-results'
    pendingPlayers: new Set(), // late-joiners ready to enter at start of next round
    advanceTimer: null,
    guessTimer: null,
    guessDeadline: null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortedPlayers() {
  return [...game.players.entries()]
    .sort(([, a], [, b]) => a.joinOrder - b.joinOrder)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, spectator: !!p.spectator, joinOrder: p.joinOrder, disconnected: !!p.disconnected }));
}

// Active (non-spectator, non-disconnected) players only
function activePlayers() {
  return [...game.players.entries()]
    .filter(([, p]) => !p.spectator && !p.disconnected)
    .sort(([, a], [, b]) => a.joinOrder - b.joinOrder)
    .map(([id, p]) => ({ id, name: p.name, score: p.score }));
}

// Returns phrases this Vibe Man can still choose this cycle; auto-resets if exhausted
function getAvailablePhrases(socketId) {
  const used = game.vibeManUsedPhrases.get(socketId) || new Set();
  let available = game.phrases.filter(ph => !used.has(ph.id));
  if (available.length === 0 && game.phrases.length > 0) {
    game.vibeManUsedPhrases.set(socketId, new Set());
    available = [...game.phrases];
  }
  return available;
}

function buildState(socketId) {
  const vibeManId = game.vibeManRotation[game.vibeManRotationIdx] ?? null;
  const isVibeman = vibeManId === socketId;
  const player    = game.players.get(socketId);
  const isSpectator = player?.spectator ?? true;
  const showValue =
    (isVibeman && (game.roundPhase === 'vibe-writing' || game.roundPhase === 'guessing')) ||
    game.roundPhase === 'round-results';

  return {
    phase: game.phase,
    players: sortedPlayers(),
    host: game.host,
    isHost: socketId === game.host,
    myId: socketId,
    myName: player?.name ?? null,
    isSpectator,
    spectatorSubmittedPhrase: game.phraseSubmissions.has(socketId),
    isPending: game.pendingPlayers.has(socketId),
    phrases: game.phrases,
    phraseSubmissions: [...game.phraseSubmissions],
    hasSubmittedPhrase: game.phraseSubmissions.has(socketId),
    pointsGoal: game.pointsGoal,
    roundNumber: game.roundNumber,
    currentPhrase: game.currentPhrase,
    availablePhrases: (isVibeman && game.roundPhase === 'phrase-select')
      ? getAvailablePhrases(socketId)
      : [],
    vibeManId,
    vibeManName: game.players.get(vibeManId)?.name ?? null,
    isVibeman,
    roundPhase: game.roundPhase,
    randomValue: showValue ? game.randomValue : null,
    story: game.story,
    myGuess: game.guesses.get(socketId) ?? null,
    hasSubmittedGuess: game.guesses.has(socketId),
    guessCount: game.guesses.size,
    totalGuessers: Math.max(0, activePlayers().length - 1),
    liveGuesses: game.roundPhase === 'guessing' &&
      (socketId === vibeManId || game.guesses.has(socketId))
      ? buildLivePositions()
      : [],
    roundResults: game.roundPhase === 'round-results' ? game.roundResults : [],
    vibeManPts: game.roundPhase === 'round-results' ? game.vibeManPts : null,
    guessDeadline: game.roundPhase === 'guessing' ? game.guessDeadline : null,
    currentVibeManIdx: game.vibeManRotationIdx,
    totalVibeManSlots: game.vibeManRotation.length,
  };
}

// Build the live-positions payload: merge livePositions (dragging) with
// submitted guesses, keyed by player. Submitted takes priority.
function buildLivePositions() {
  const vibeManId = game.vibeManRotation[game.vibeManRotationIdx];
  const guessers = activePlayers().filter(p => p.id !== vibeManId);
  return guessers.map(p => {
    const submitted = game.guesses.has(p.id);
    const value = submitted
      ? game.guesses.get(p.id)
      : (game.livePositions.get(p.id) ?? null);
    return { id: p.id, name: p.name, value, submitted };
  });
}

function broadcast() {
  // Send to all registered players AND connected spectator sockets
  const allSockets = io.sockets.sockets;
  allSockets.forEach((s) => {
    s.emit('state', buildState(s.id));
  });
}

// ─── Game Logic ───────────────────────────────────────────────────────────────

function beginGame() {
  game.phase = 'playing';
  game.vibeManRotation = activePlayers().map(p => p.id);
  game.vibeManRotationIdx = 0;
  game.roundNumber = 0;
  startRound();
}

function startRound() {
  // Promote any pending late-joiners into active players
  game.pendingPlayers.forEach((id) => {
    const p = game.players.get(id);
    if (p) { p.spectator = false; p.score = 0; }
    if (!game.vibeManRotation.includes(id)) game.vibeManRotation.push(id);
  });
  game.pendingPlayers.clear();

  // Keep rotation index in bounds after any additions or removals
  if (game.vibeManRotation.length > 0) {
    game.vibeManRotationIdx = game.vibeManRotationIdx % game.vibeManRotation.length;
  }

  // Need at least 2 active players to continue
  if (activePlayers().length < 2) {
    endGame();
    return;
  }

  game.roundNumber++;
  game.randomValue = Math.floor(Math.random() * 100) + 1;
  game.currentPhrase = null;
  game.story = null;
  game.guesses = new Map();
  game.livePositions = new Map();
  game.roundResults = [];
  game.vibeManPts = null;
  clearTimeout(game.guessTimer);
  game.guessTimer = null;
  game.guessDeadline = null;
  game.roundPhase = 'phrase-select';
  broadcast();
}

function resolveRound() {
  clearTimeout(game.guessTimer);
  game.guessTimer = null;
  const results = [];

  game.guesses.forEach((guess, id) => {
    const diff = Math.abs(guess - game.randomValue);
    const pts = diff <= 3 ? 3 : diff <= 4 ? 2 : diff <= 5 ? 1 : 0;
    const p = game.players.get(id);
    if (p) p.score += pts;
    results.push({ id, name: p?.name ?? '?', guess, diff, pts });
  });

  results.sort((a, b) => b.pts - a.pts || a.diff - b.diff);
  game.roundResults = results;

  // Award the Vibe Man based on average diff of everyone's guesses
  const vibeManId = game.vibeManRotation[game.vibeManRotationIdx];
  if (results.length > 0) {
    const avgDiff = results.reduce((sum, r) => sum + r.diff, 0) / results.length;
    const vmPts = avgDiff <= 3 ? 3 : avgDiff <= 4 ? 2 : avgDiff <= 5 ? 1 : 0;
    const vm = game.players.get(vibeManId);
    if (vm) vm.score += vmPts;
    game.vibeManPts = vmPts;
  } else {
    game.vibeManPts = 0;
  }

  // Check if any player has reached the points goal
  const gameWon = [...game.players.values()].some(p => !p.spectator && p.score >= game.pointsGoal);
  game.roundPhase = 'round-results';
  broadcast();

  // Auto-advance after 5 s
  clearTimeout(game.advanceTimer);
  game.advanceTimer = setTimeout(() => {
    if (game.phase !== 'playing' || game.roundPhase !== 'round-results') return;
    if (gameWon) {
      endGame();
    } else {
      game.vibeManRotationIdx = (game.vibeManRotationIdx + 1) % Math.max(1, game.vibeManRotation.length);
      startRound();
    }
  }, 5000);
}

function endGame() {
  game.phase = 'game-over';
  broadcast();
}

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Send current state to newcomer so they can see the game / spectate
  socket.emit('state', buildState(socket.id));

  socket.on('join', ({ name }) => {
    if (!name?.trim()) return socket.emit('err', 'Name is required.');
    const clean = name.trim().slice(0, 20);

    // ── Reconnection: restore a disconnected player under the new socket ID ──
    const reconnectEntry = [...game.players.entries()]
      .find(([, p]) => p.disconnected && p.name.toLowerCase() === clean.toLowerCase());

    if (reconnectEntry) {
      const [oldId, playerData] = reconnectEntry;
      playerData.disconnected = false;
      game.players.delete(oldId);
      game.players.set(socket.id, playerData);

      // Remap rotation slot
      const rotIdx = game.vibeManRotation.indexOf(oldId);
      if (rotIdx !== -1) {
        game.vibeManRotation[rotIdx] = socket.id;
      } else {
        // Was removed from rotation while disconnected — re-add at end
        game.vibeManRotation.push(socket.id);
      }

      // Remap per-socket state sets / maps
      if (game.host === oldId) game.host = socket.id;
      if (game.phraseSubmissions.has(oldId)) {
        game.phraseSubmissions.delete(oldId);
        game.phraseSubmissions.add(socket.id);
      }
      if (game.vibeManUsedPhrases.has(oldId)) {
        game.vibeManUsedPhrases.set(socket.id, game.vibeManUsedPhrases.get(oldId));
        game.vibeManUsedPhrases.delete(oldId);
      }
      if (game.guesses.has(oldId)) {
        game.guesses.set(socket.id, game.guesses.get(oldId));
        game.guesses.delete(oldId);
      }
      if (game.pendingPlayers.has(oldId)) {
        game.pendingPlayers.delete(oldId);
        game.pendingPlayers.add(socket.id);
      }

      broadcast();
      return;
    }

    // Prevent duplicate names among connected players
    const taken = [...game.players.values()].some(p => !p.disconnected && p.name.toLowerCase() === clean.toLowerCase());
    if (taken) return socket.emit('err', `The name "${clean}" is already taken.`);

    if (game.phase === 'lobby') {
      // Normal lobby join
      game.players.set(socket.id, { name: clean, score: 0, joinOrder: game.players.size, spectator: false });
      if (!game.host) game.host = socket.id;
      broadcast();
    } else {
      // Game already in progress — join as spectator
      const joinOrder = game.players.size;
      game.players.set(socket.id, { name: clean, score: 0, joinOrder, spectator: true });
      broadcast();
    }
  });

  socket.on('start', ({ pointsGoal } = {}) => {
    if (socket.id !== game.host || game.phase !== 'lobby') return;
    if (activePlayers().length < 2) return socket.emit('err', 'Need at least 2 players to start.');
    const validGoals = [25, 50, 75];
    game.pointsGoal = validGoals.includes(Number(pointsGoal)) ? Number(pointsGoal) : 25;
    game.phase = 'phrase-input';
    broadcast();
  });

  socket.on('phrase', ({ label1, label2 }) => {
    if (game.phraseSubmissions.has(socket.id)) return;
    if (!label1?.trim() || !label2?.trim()) return socket.emit('err', 'Both phrases are required.');
    const player = game.players.get(socket.id);
    if (!player) return;

    game.phrases.push({
      id: game.phrases.length,
      byId: socket.id,
      byName: player.name,
      label1: label1.trim().slice(0, 50),
      label2: label2.trim().slice(0, 50),
    });
    game.phraseSubmissions.add(socket.id);

    if (game.phase === 'phrase-input') {
      // Normal phrase-input phase: check if all active players have submitted
      const activeIds = new Set(activePlayers().map(p => p.id));
      const allDone = [...activeIds].every(id => game.phraseSubmissions.has(id));
      if (allDone) {
        beginGame();
      } else {
        broadcast();
      }
    } else if (game.phase === 'playing' && player.spectator) {
      // Late-joiner submitted their phrase — mark them as pending for next round
      game.pendingPlayers.add(socket.id);
      broadcast();
    }
  });

  socket.on('select-phrase', ({ phraseId }) => {
    if (game.roundPhase !== 'phrase-select') return;
    if (game.vibeManRotation[game.vibeManRotationIdx] !== socket.id) return;
    const id = Number(phraseId);
    const phrase = game.phrases.find(ph => ph.id === id);
    if (!phrase) return socket.emit('err', 'Invalid phrase.');
    const available = getAvailablePhrases(socket.id);
    if (!available.find(ph => ph.id === id)) return socket.emit('err', 'That phrase is not available.');
    if (!game.vibeManUsedPhrases.has(socket.id)) game.vibeManUsedPhrases.set(socket.id, new Set());
    game.vibeManUsedPhrases.get(socket.id).add(id);
    game.currentPhrase = phrase;
    game.roundPhase = 'vibe-writing';
    broadcast();
  });

  socket.on('story', ({ story }) => {
    if (game.roundPhase !== 'vibe-writing') return;
    if (game.vibeManRotation[game.vibeManRotationIdx] !== socket.id) return;
    if (!story?.trim()) return socket.emit('err', 'You must write a story.');
    game.story = story.trim().slice(0, 600);
    game.roundPhase = 'guessing';
    game.guessDeadline = Date.now() + 15000;
    game.guessTimer = setTimeout(() => {
      if (game.roundPhase === 'guessing') resolveRound();
    }, 15000);
    broadcast();
  });

  // Real-time drag position from a guesser — forwarded only to the Vibe Man
  socket.on('live-pos', ({ value }) => {
    if (game.roundPhase !== 'guessing') return;
    const vibeManId = game.vibeManRotation[game.vibeManRotationIdx];
    if (socket.id === vibeManId) return; // Vibe Man doesn't send positions
    const player = game.players.get(socket.id);
    if (!player || player.spectator) return;
    const v = Math.max(1, Math.min(100, Math.round(Number(value))));
    if (!Number.isFinite(v)) return;
    game.livePositions.set(socket.id, v);
    // Push to the Vibe Man and any guesser who has already submitted
    const payload = buildLivePositions();
    io.sockets.sockets.forEach((sock) => {
      const isVibeMan = sock.id === vibeManId;
      const hasSubmitted = game.guesses.has(sock.id);
      if (isVibeMan || hasSubmitted) sock.emit('live-positions', payload);
    });
  });

  socket.on('guess', ({ value }) => {
    if (game.roundPhase !== 'guessing') return;
    if (socket.id === game.vibeManRotation[game.vibeManRotationIdx]) return;
    if (game.guesses.has(socket.id)) return;
    // Spectators cannot guess
    const player = game.players.get(socket.id);
    if (!player || player.spectator) return;

    const v = Math.max(1, Math.min(100, Math.round(Number(value))));
    if (!Number.isFinite(v)) return;

    game.guesses.set(socket.id, v);
    broadcast();

    // Resolve when all active non-vibeman players have guessed
    const vibeManId = game.vibeManRotation[game.vibeManRotationIdx];
    const eligibleGuessers = activePlayers().filter(p => p.id !== vibeManId);
    if (eligibleGuessers.length > 0 && eligibleGuessers.every(p => game.guesses.has(p.id))) {
      resolveRound();
    }
  });

  socket.on('restart', () => {
    if (socket.id !== game.host) return;
    clearTimeout(game.advanceTimer);
    game = newGame();
    io.emit('reset');
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    const player = game.players.get(socket.id);

    if (game.phase === 'lobby') {
      game.players.delete(socket.id);
      if (game.host === socket.id) {
        game.host = sortedPlayers()[0]?.id ?? null;
      }
      broadcast();
      return;
    }

    if (!player) return;

    // Mark disconnected but preserve score so they show grayed-out on leaderboard
    player.disconnected = true;
    game.pendingPlayers.delete(socket.id);

    // Capture whether this socket was the current Vibe Man before altering the rotation
    const wasVibeMan = game.vibeManRotation[game.vibeManRotationIdx] === socket.id;

    // Remove from rotation; adjust index so it still points at the same next player
    const rotIdx = game.vibeManRotation.indexOf(socket.id);
    if (rotIdx !== -1) {
      game.vibeManRotation.splice(rotIdx, 1);
      if (rotIdx < game.vibeManRotationIdx) {
        game.vibeManRotationIdx = Math.max(0, game.vibeManRotationIdx - 1);
      }
      if (game.vibeManRotation.length > 0) {
        game.vibeManRotationIdx = game.vibeManRotationIdx % game.vibeManRotation.length;
      }
    }

    if (game.phase !== 'playing') { broadcast(); return; }

    // Vibe Man left before submitting a story — start a fresh round for the next player
    if (wasVibeMan && (game.roundPhase === 'phrase-select' || game.roundPhase === 'vibe-writing')) {
      startRound(); // startRound() handles the < 2 players endGame check
      return;
    }

    // A guesser disconnected — resolve early if nobody remaining needs to guess
    if (game.roundPhase === 'guessing') {
      const vibeManId = game.vibeManRotation[game.vibeManRotationIdx];
      const eligibleGuessers = activePlayers().filter(p => p.id !== vibeManId);
      if (eligibleGuessers.length === 0 || eligibleGuessers.every(p => game.guesses.has(p.id))) {
        resolveRound();
        return;
      }
    }

    broadcast();
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮  Vibe Meter is running!`);
  console.log(`   ➜  http://localhost:${PORT}`);
  console.log(`   Share this URL with friends on the same Wi-Fi/network.\n`);
});
