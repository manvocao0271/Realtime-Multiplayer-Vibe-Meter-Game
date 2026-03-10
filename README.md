# Vibe Meter

A real-time multiplayer party game where players write "vibe stories" and everyone else tries to guess where on a spectrum the story lands.

---

## How It Works

### Setup
1. One player hosts the server and shares the URL with friends on the same network.
2. The **first player to join** becomes the host.
3. The host selects a **points goal** (25, 50, or 75) and clicks *Start Game*.
4. Every player enters a pair of **polar-opposite phrases** (e.g. *"green flag"* vs *"red flag"*, *"totally sober"* vs *"blackout drunk"*). These become the scoring scales for the game.

### Gameplay Loop
Rounds continue until a player reaches the points goal:

1. **The Vibe Man is assigned** — players rotate through the role in order. The Vibe Man is secretly given a random integer from 1–100, where 1 anchors the left phrase and 100 anchors the right.
2. **Vibe Man selects a phrase** — from the pool of submitted phrases, picking one they haven't used recently. The chosen phrase defines the spectrum for this round.
3. **Vibe Man writes a story** — a short description that captures the feeling of their secret number on that scale, without mentioning the number directly.
4. **Everyone else guesses** — all other players submit a number (1–100) based purely on the vibe of the story. Guesses must be locked in within **15 seconds** or the round resolves automatically.
5. **Scoring:**
   | Distance from true value | Guesser points | Vibe Man points |
   |--------------------------|----------------|-----------------|
   | ≤ 3                      | 3 pts          | +(sum of all guesser pts) |
   | ≤ 4                      | 2 pts          | same |
   | ≤ 5                      | 1 pt           | same |
   | > 5                      | 0 pts          | same |

   The Vibe Man earns the **sum of all guessers' points** that round — good writing is rewarded.
6. Play continues, rotating the Vibe Man role, until any player reaches the points goal. A final leaderboard is then shown.

---

## Running Locally

```bash
npm install
npm start        # node server.js  →  http://localhost:3000
npm run dev      # nodemon (auto-restart on changes)
```

Share `http://<your-local-ip>:3000` with anyone on the same Wi-Fi.

### Exposing via Cloudflare Tunnel (for remote players)

Open a **second terminal** and run:

```bash
cloudflared tunnel --url localhost:3000
```

Cloudflare will print a public `https://` URL — share that with anyone, anywhere.

| Terminal | Command | Purpose |
|----------|---------|---------|
| 1 | `npm start` | Start the Node.js game server on `localhost:3000` |
| 2 | `cloudflared tunnel --url localhost:3000` | Expose the server publicly via Cloudflare Tunnel |

**Stack:** Node.js · Express · Socket.IO (WebSockets)

---

## Current Architecture

The current implementation is a **single-process monolith**:

```
Browser (Socket.IO client)
        │  WebSocket
        ▼
  Node.js / Express
  ┌─────────────────────────┐
  │  In-memory game state   │  ← one global `game` object
  │  (Map, arrays, flags)   │
  │  Socket.IO server       │
  └─────────────────────────┘
```

All game state lives in a single JavaScript object in memory. Every event (`join`, `story`, `guess`, `next`) mutates that object and calls `broadcast()`, which rebuilds a personalised state snapshot for each connected socket and pushes it out simultaneously.

This is intentionally minimal — no database, no authentication, no persistence between sessions.

### Client-Side Features (fully implemented)

| Feature | Detail |
|---------|--------|
| **Interactive SVG dial** | Semicircular gauge for submitting guesses; drag or click, full mouse + touch support |
| **Phrase-select screen** | Vibe Man picks which submitted phrase to use each round; the server tracks which phrases they've used recently and auto-resets when all are exhausted |
| **15-second guess timer** | Countdown bar and live second-ticker for guessers; round auto-resolves on expiry |
| **Live drag positions** | While guessing, each player's dial position is streamed to the server (throttled ~25 fps) and forwarded to the current Vibe Man **and any guesser who has already submitted** as a mini-dial dashboard |
| **Vibe Man scoring** | After each round the Vibe Man earns the sum of all guessers' points, incentivising clear writing |
| **Bullseye tracker** | 3-point scores (exact-ish guesses) are counted separately per player and displayed with 🎯 in the leaderboard sidebar |
| **Points goal selector** | Host picks 25, 50, or 75 as the winning threshold in the lobby before starting |
| **Spectator / late-join flow** | Players who join mid-game spectate, submit a phrase, and are promoted to full players at the start of the next round |
| **Player reconnection** | If a player disconnects and rejoins with the same name, their score, rotation slot, and phrase history are fully restored |
| **In-place DOM patching** | The phrase-input and guessing screens patch counters and mini-dials without replacing interactive elements, preventing flicker |
| **Animated waiting dial** | A smoothly oscillating dial is shown to players waiting for the Vibe Man to finish writing |
| **Name persistence** | Player name is saved to `localStorage` and pre-filled on re-open |
| **Results visualisation** | After each round, a visual meter bar overlays every player's guess and the actual answer |
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
- [x] 15-second guess countdown with auto-resolve on expiry
- [x] Vibe Man scoring (earns sum of all guessers' points each round)
- [x] Bullseye tracking (3-pt scores counted and shown per player in leaderboard)
- [x] Host management and host-migration on disconnect
- [x] Disconnect edge-case handling (vibe-man skip, guesser drop, lobby cleanup)
- [x] Player reconnection — same-name rejoin restores score, rotation slot, and phrase history
- [x] Spectator / late-joiner system with pending-player queue
- [x] Real-time live drag-position streaming to Vibe Man and submitted guessers
- [x] Interactive SVG dial with mouse and touch support
- [x] Mini-dial dashboard during the guessing phase
- [x] Animated oscillating dial shown while waiting for Vibe Man
- [x] In-place DOM patching (no flicker while typing or during live guessing)
- [x] Visual results meter — player guesses overlaid on the spectrum
- [x] Restart / Play Again flow from game-over screen
- [x] Name persistence via `localStorage`
- [x] XSS-safe HTML escaping throughout the client

### Upcoming
- [ ] Redis shared-state layer + Socket.IO Redis adapter
- [ ] Kafka event bus + PostgreSQL persistence
- [ ] Service decomposition and containerisation (Docker Compose)
- [ ] Kubernetes deployment manifests
- [ ] OpenTelemetry tracing and Prometheus metrics
- [ ] Auth / room codes so multiple games can run in parallel
