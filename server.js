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
    currentPhraseIdx: -1,
    vibeManQueue: [],         // ordered list of socketIds for current phrase
    currentVibeManIdx: 0,
    randomValue: null,
    story: null,
    guesses: new Map(),       // socketId → number
    livePositions: new Map(), // socketId → number  (real-time drag, not yet submitted)
    roundResults: [],
    roundPhase: null,         // 'vibe-writing' | 'guessing' | 'round-results' | 'phrase-results'
    // Late-joiners who submitted their phrase and are waiting to enter next phrase cycle
    pendingPlayers: new Set(), // socketIds ready to join after current phrase ends
    advanceTimer: null,        // setTimeout handle for auto-advancing between rounds
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortedPlayers() {
  return [...game.players.entries()]
    .sort(([, a], [, b]) => a.joinOrder - b.joinOrder)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, spectator: !!p.spectator, joinOrder: p.joinOrder }));
}

// Active (non-spectator) players only
function activePlayers() {
  return [...game.players.entries()]
    .filter(([, p]) => !p.spectator)
    .sort(([, a], [, b]) => a.joinOrder - b.joinOrder)
    .map(([id, p]) => ({ id, name: p.name, score: p.score }));
}

function buildState(socketId) {
  const vibeManId = game.vibeManQueue[game.currentVibeManIdx] ?? null;
  const isVibeman = vibeManId === socketId;
  const player    = game.players.get(socketId);
  const isSpectator = player?.spectator ?? true; // unknown sockets are spectators
  const showValue =
    (isVibeman && game.roundPhase === 'vibe-writing') ||
    (isVibeman && game.roundPhase === 'guessing') ||
    game.roundPhase === 'round-results' ||
    game.roundPhase === 'phrase-results';

  return {
    phase: game.phase,
    players: sortedPlayers(),
    host: game.host,
    isHost: socketId === game.host,
    myId: socketId,
    myName: player?.name ?? null,
    isSpectator,
    // If spectator: have they already submitted their late-join phrase?
    spectatorSubmittedPhrase: game.phraseSubmissions.has(socketId),
    isPending: game.pendingPlayers.has(socketId),
    phrases: game.phrases,
    phraseSubmissions: [...game.phraseSubmissions],
    hasSubmittedPhrase: game.phraseSubmissions.has(socketId),
    currentPhraseIdx: game.currentPhraseIdx,
    currentPhrase: game.phrases[game.currentPhraseIdx] ?? null,
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
    // Live positions visible to the Vibe Man, and to guessers who have already submitted
    liveGuesses: game.roundPhase === 'guessing' &&
      (socketId === game.vibeManQueue[game.currentVibeManIdx] || game.guesses.has(socketId))
      ? buildLivePositions()
      : [],
    roundResults:
      game.roundPhase === 'round-results' || game.roundPhase === 'phrase-results'
        ? game.roundResults
        : [],
    vibeManPts:
      game.roundPhase === 'round-results' || game.roundPhase === 'phrase-results'
        ? game.vibeManPts
        : null,
    guessDeadline: game.roundPhase === 'guessing' ? game.guessDeadline : null,
    currentVibeManIdx: game.currentVibeManIdx,
    totalVibeManSlots: game.vibeManQueue.length,
  };
}

// Build the live-positions payload: merge livePositions (dragging) with
// submitted guesses, keyed by player. Submitted takes priority.
function buildLivePositions() {
  const vibeManId = game.vibeManQueue[game.currentVibeManIdx];
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
  game.currentPhraseIdx = 0;
  startPhrase();
}

function startPhrase() {
  // Promote any pending players into active players before building the queue
  game.pendingPlayers.forEach((id) => {
    const p = game.players.get(id);
    if (p) {
      p.spectator = false;
      p.score = 0;
    }
  });
  game.pendingPlayers.clear();

  game.vibeManQueue = activePlayers().map(p => p.id);
  game.currentVibeManIdx = 0;
  startRound();
}

function startRound() {
  game.randomValue = Math.floor(Math.random() * 100) + 1;
  game.story = null;
  game.guesses = new Map();
  game.livePositions = new Map();
  game.roundResults = [];
  game.vibeManPts = null;
  clearTimeout(game.guessTimer);
  game.guessTimer = null;
  game.guessDeadline = null;
  game.roundPhase = 'vibe-writing';
  broadcast();
}

function resolveRound() {
  clearTimeout(game.guessTimer);
  game.guessTimer = null;
  let anyPerfect = false;
  const results = [];

  game.guesses.forEach((guess, id) => {
    const diff = Math.abs(guess - game.randomValue);
    const pts = diff <= 3 ? 3 : diff <= 4 ? 2 : diff <= 5 ? 1 : 0;
    if (pts === 3) anyPerfect = true;
    const p = game.players.get(id);
    if (p) p.score += pts;
    results.push({ id, name: p?.name ?? '?', guess, diff, pts });
  });

  results.sort((a, b) => b.pts - a.pts || a.diff - b.diff);
  game.roundResults = results;

  // Award the Vibe Man based on how accurately their story conveyed the number.
  // Uses the same tier thresholds as guessers, applied to the average diff.
  const vibeManId = game.vibeManQueue[game.currentVibeManIdx];
  if (results.length > 0) {
    const avgDiff = results.reduce((sum, r) => sum + r.diff, 0) / results.length;
    const vmPts = avgDiff <= 3 ? 3 : avgDiff <= 4 ? 2 : avgDiff <= 5 ? 1 : 0;
    const vm = game.players.get(vibeManId);
    if (vm) vm.score += vmPts;
    game.vibeManPts = vmPts;
  } else {
    game.vibeManPts = 0;
  }

  const phraseOver =
    anyPerfect || game.currentVibeManIdx >= game.vibeManQueue.length - 1;
  game.roundPhase = phraseOver ? 'phrase-results' : 'round-results';

  broadcast();

  // Auto-advance after 5 s — host no longer needs to click "next"
  const advancePhase = game.roundPhase;
  clearTimeout(game.advanceTimer);
  game.advanceTimer = setTimeout(() => {
    if (game.phase !== 'playing' || game.roundPhase !== advancePhase) return;
    if (advancePhase === 'phrase-results') {
      game.currentPhraseIdx++;
      if (game.currentPhraseIdx >= game.phrases.length) {
        endGame();
      } else {
        startPhrase();
      }
    } else {
      game.currentVibeManIdx++;
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

    // Prevent duplicate names
    const taken = [...game.players.values()].some(p => p.name.toLowerCase() === clean.toLowerCase());
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
      // Spectators are directed to submit their phrase immediately
      broadcast();
    }
  });

  socket.on('start', () => {
    if (socket.id !== game.host || game.phase !== 'lobby') return;
    if (activePlayers().length < 2) return socket.emit('err', 'Need at least 2 players to start.');
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
      // Late-joiner submitted their phrase — mark them as pending for next phrase cycle
      game.pendingPlayers.add(socket.id);
      broadcast();
    }
  });

  socket.on('story', ({ story }) => {
    if (game.roundPhase !== 'vibe-writing') return;
    if (game.vibeManQueue[game.currentVibeManIdx] !== socket.id) return;
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
    const vibeManId = game.vibeManQueue[game.currentVibeManIdx];
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
    if (socket.id === game.vibeManQueue[game.currentVibeManIdx]) return;
    if (game.guesses.has(socket.id)) return;
    // Spectators cannot guess
    const player = game.players.get(socket.id);
    if (!player || player.spectator) return;

    const v = Math.max(1, Math.min(100, Math.round(Number(value))));
    if (!Number.isFinite(v)) return;

    game.guesses.set(socket.id, v);
    broadcast();

    // Resolve when all active non-vibeman players have guessed
    const vibeManId = game.vibeManQueue[game.currentVibeManIdx];
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
    if (game.phase === 'lobby') {
      game.players.delete(socket.id);
      if (game.host === socket.id) {
        game.host = sortedPlayers()[0]?.id ?? null;
      }
      broadcast();
      return;
    }

    // During an active game we leave the player in the list to avoid state corruption.
    // Clean up pending/spectator sets though.
    game.pendingPlayers.delete(socket.id);

    // If the vibe man disconnects during writing, skip to the next vibe man.
    if (
      game.phase === 'playing' &&
      game.roundPhase === 'vibe-writing' &&
      game.vibeManQueue[game.currentVibeManIdx] === socket.id
    ) {
      if (game.currentVibeManIdx < game.vibeManQueue.length - 1) {
        game.currentVibeManIdx++;
        startRound();
      } else {
        game.roundPhase = 'phrase-results';
        broadcast();
      }
      return;
    }

    // If a guesser disconnects during guessing, check if everyone remaining has guessed
    if (game.phase === 'playing' && game.roundPhase === 'guessing') {
      const vibeManId = game.vibeManQueue[game.currentVibeManIdx];
      const eligibleGuessers = activePlayers().filter(p => p.id !== vibeManId);
      const remaining = eligibleGuessers.filter(p => !game.guesses.has(p.id));
      if (remaining.length === 0 && eligibleGuessers.length > 0) {
        resolveRound();
      }
    }
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮  Vibe Meter is running!`);
  console.log(`   ➜  http://localhost:${PORT}`);
  console.log(`   Share this URL with friends on the same Wi-Fi/network.\n`);
});
