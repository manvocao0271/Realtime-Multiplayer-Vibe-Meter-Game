# Vibe Meter

A real-time multiplayer party game where players write "vibe stories" and everyone else tries to guess where on a spectrum the story lands.

---

## How It Works

### Setup
1. One player hosts the server and shares the URL with friends on the same network.
2. The **first player to join** becomes the host.
3. Every player enters a pair of **polar-opposite phrases** (e.g. *"green flag"* vs *"red flag"*, *"totally sober"* vs *"blackout drunk"*). These become the scoring scales for the game.

### Gameplay Loop
Each phrase goes through one or more rounds until it's resolved:

1. **The Vibe Man is assigned** — one player per round is secretly given a random integer from 1–100, where 1 anchors the left phrase and 100 anchors the right.
2. **Vibe Man writes a story** — a short description that captures the feeling of that number on the scale, without mentioning the number directly.
3. **Everyone else guesses** — all other players submit a number (1–100) based purely on the vibe of the story.
4. **Scoring:**
   | Distance from true value | Points |
   |--------------------------|--------|
   | ≤ 3                      | 3 pts  |
   | ≤ 4                      | 2 pts  |
   | ≤ 5                      | 1 pt   |
   | > 5                      | 0 pts  |
5. **Phrase advances** if at least one player scores a perfect 3 pts, or all players have taken a turn as Vibe Man for that phrase. Otherwise the next player becomes Vibe Man and a new random value is drawn.
6. Once all phrases are resolved, the game ends and a final leaderboard is shown.

---

## Running Locally

```bash
npm install
npm start        # node server.js  →  http://localhost:3000
npm run dev      # nodemon (auto-restart on changes)
```

Share `http://<your-local-ip>:3000` with anyone on the same Wi-Fi.

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
| **Live drag positions** | While guessing, each player's dial position is streamed to the server (throttled ~25 fps) and forwarded exclusively to the current Vibe Man as a mini-dial dashboard |
| **Spectator / late-join flow** | Players who join mid-game spectate, submit a phrase, and are promoted to full players at the start of the next phrase cycle |
| **In-place DOM patching** | The phrase-input screen patches counters and the player list without replacing the input fields, preventing flicker while typing |
| **Name persistence** | Player name is saved to `localStorage` and pre-filled on reconnect |
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
- **Graceful disconnect handling** — already partially implemented (host migration, ghost guesser cleanup); to be hardened with a session-recovery handshake so players can reconnect mid-game.
- **Leader election** for the host role using a distributed lock (Redis `SET NX`) so host state survives the original socket disconnecting.

---

## Roadmap

### Completed
- [x] Core game loop (lobby → phrase input → vibe writing → guessing → scoring)
- [x] Host management and host-migration on disconnect
- [x] Disconnect edge-case handling (vibe-man skip, guesser drop, lobby cleanup)
- [x] Spectator / late-joiner system with pending-player queue
- [x] Real-time live drag-position streaming to Vibe Man
- [x] Interactive SVG dial with mouse and touch support
- [x] Mini-dial dashboard for Vibe Man during the guessing phase
- [x] In-place DOM patching on phrase-input screen (no flicker while typing)
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
