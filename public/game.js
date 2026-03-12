// ============================================================
//  VIBE METER -- Client
// ============================================================

// Read the room code from the URL path, e.g. /ABCDEF → 'ABCDEF'
const roomCode = window.location.pathname.replace(/^\//, '').toUpperCase() || '';
const socket = io({ query: { room: roomCode } });

// -- Persistent local state ----------------------------------
let myName = localStorage.getItem('vibeMeterName') || '';
let currentState = null;

// Preserve input values across re-renders
let saved = {
  label1: '', label2: '',
  story: '',
  guessValue: 50,
};

// Track what's currently rendered so we can skip full re-renders
// when only incremental data (counts, player list) has changed.
let lastRenderKey = null;

let guessCountdownInterval = null;

function startGuessCountdown() {
  clearInterval(guessCountdownInterval);
  guessCountdownInterval = null;
  const deadline = currentState?.guessDeadline;
  if (!deadline) return;

  // Sync CSS animation bar
  const durMs = (currentState?.guessDuration ?? 15) * 1000;
  const elapsed = Math.max(0, (Date.now() - (deadline - durMs)) / 1000);
  const bar = document.getElementById('guess-timer-bar');
  if (bar) {
    bar.style.animationDuration = `${currentState?.guessDuration ?? 15}s`;
    bar.style.animationDelay = `-${elapsed}s`;
  }

  // integer countdown text
  function tick() {
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const el = document.getElementById('guess-timer-secs');
    if (el) el.textContent = secs === 1 ? '1 second...' : `${secs} seconds...`;
    if (secs === 0) { clearInterval(guessCountdownInterval); guessCountdownInterval = null; }
  }
  tick();
  guessCountdownInterval = setInterval(tick, 200);
}

// -- Socket Events -------------------------------------------
socket.on('connect', () => render());

socket.on('state', (s) => {
  currentState = s;
  render();
});

socket.on('err', (msg) => showToast(msg, 'error'));

// Live drag positions pushed only to the Vibe Man -- patch mini-dials in-place
socket.on('live-positions', (players) => {
  players.forEach(p => updateMiniDial(p.id, p.value, p.submitted));
});

socket.on('reset', () => {
  currentState = null;
  render();
});

socket.on('disconnect', () => {
  showToast('Disconnected from server.', 'error');
});

// -- Render Entry Point --------------------------------------
function render() {
  const appWrapper = document.getElementById('app-wrapper');
  const app        = document.getElementById('app');
  const meta       = document.getElementById('header-meta');

  if (!currentState || !currentState.myName) {
    meta.innerHTML = '';
    appWrapper.classList.remove('with-sidebar');
    app.innerHTML = renderJoin();
    attachJoinListeners();
    return;
  }

  if (currentState.phase === 'playing') {
    appWrapper.classList.add('with-sidebar');
    document.getElementById('leaderboard-sidebar').innerHTML = renderLeaderboard();
  } else {
    appWrapper.classList.remove('with-sidebar');
  }

  meta.innerHTML = `
    <span class="player-badge">${esc(currentState.myName)}</span>
    ${currentState.isSpectator ? '<span class="badge badge-yellow" style="font-size:0.75rem;">Spectating</span>' : ''}
  `;

  switch (currentState.phase) {
    case 'lobby':
      lastRenderKey = null;
      app.innerHTML = renderLobby();
      attachLobbyListeners();
      break;
    case 'phrase-input': {
      if (currentState.isSpectator) {
        app.innerHTML = renderSpectator();
        attachSpectatorListeners();
        lastRenderKey = null;
        break;
      }
      // Key encodes the structural state -- only full-render on structural change.
      // Incremental updates (other players submitting) are patched in-place
      // so the input boxes are never destroyed while the user is typing.
      const key = `phrase-input:${currentState.hasSubmittedPhrase ? 'waiting' : 'form'}`;
      if (lastRenderKey === key) {
        patchPhraseInput();
      } else {
        app.innerHTML = renderPhraseInput();
        attachPhraseListeners();
      }
      lastRenderKey = key;
      break;
    }
    case 'playing': {
      // Avoid destroying mini-dial DOM while live positions are streaming in.
      const s = currentState;
      let playKey = null;
      if (!s.isSpectator) {
        if (s.roundPhase === 'vibe-writing' && !s.isVibeman) {
          playKey = 'playing:vibe-writing';
        } else if (s.roundPhase === 'guessing') {
          playKey = s.isVibeman
            ? `playing:guessing:vibe-man:${s.totalGuessers}`
            : `playing:guessing:${s.hasSubmittedGuess ? 'post' : 'pre'}`;
        }
      }
      if (playKey && lastRenderKey === playKey) {
        if (s.roundPhase === 'guessing') {
          s.isVibeman ? patchVibeManWaiting() : patchGuesserGuessing();
        }
        // vibe-writing: static screen, skip re-render
      } else {
        renderPlaying(app);
      }
      lastRenderKey = playKey;
      break;
    }
    case 'game-over':
      lastRenderKey = null;
      app.innerHTML = renderGameOver();
      attachGameOverListeners();
      break;
    default:
      app.innerHTML = '<div class="connecting-screen"><div class="spinner"></div><p>Loading...</p></div>';
  }
}

// ============================================================
//  LEADERBOARD SIDEBAR
// ============================================================

function renderLeaderboard() {
  const s = currentState;
  if (!s) return '';
  const ranked = [...s.players]
    .filter(p => !p.spectator)
    .sort((a, b) => b.score - a.score || (a.joinOrder ?? 999) - (b.joinOrder ?? 999));
  const spectators = s.players.filter(p => p.spectator);

  const medalEmoji = ['&#x1F947;', '&#x1F948;', '&#x1F949;'];

  // Build a pts-this-round map for the results phase
  const deltaMap = {};
  if (s.roundPhase === 'round-results') {
    (s.roundResults || []).forEach(r => { deltaMap[r.id] = r.pts; });
    if (s.vibeManId != null && s.vibeManPts != null) deltaMap[s.vibeManId] = s.vibeManPts;
  }

  return `
    <div class="lb-header">
      Leaderboard
      ${s.pointsGoal ? `<span style="font-size:0.7rem;color:var(--text-dim);font-weight:400;display:block;margin-top:0.1rem;">First to ${s.pointsGoal} pts wins</span>` : ''}
    </div>
    <div class="lb-list">
      ${ranked.map((p, i) => {
        const isYou = p.id === s.myId;
        const bulls = p.bullseyes || 0;
        const delta = deltaMap[p.id];
        return `
          <div class="lb-entry">
            <span class="lb-streak-col">${bulls > 0 ? `${bulls}x&#127919;` : ''}</span>
            <div class="lb-row ${isYou ? 'lb-you' : ''} ${p.disconnected ? 'lb-disconnected' : ''}">
              <span class="lb-medal">${medalEmoji[i] !== undefined ? medalEmoji[i] : ''}</span>
              <span class="lb-pname">${esc(p.name)}${p.disconnected ? ' <span class="lb-away">(away)</span>' : ''}</span>
              <span class="lb-pts">${p.score}</span>
            </div>
            <span class="lb-delta-col">${delta != null && delta > 0 ? `+${delta}` : ''}</span>
          </div>
        `;
      }).join('')}
    </div>
    ${spectators.length > 0 ? `
      <div class="lb-spectators">
        <div class="lb-spec-title">Spectating</div>
        ${spectators.map(p => {
          const pending = (s.pendingPlayerIds || []).includes(p.id);
          return `
          <div class="lb-spec-row ${pending ? 'lb-spec-pending' : ''}">
            <span class="lb-spec-name">${esc(p.name)}${p.disconnected ? ' <span class="lb-away">(away)</span>' : ''}</span>
            ${pending ? '<span class="lb-spec-badge">&#10003;</span>' : ''}
          </div>`;
        }).join('')}
      </div>
    ` : ''}
  `;
}

// ============================================================
//  SCREENS
// ============================================================

// -- Join Screen ---------------------------------------------
function renderJoin() {
  const gameInProgress = currentState && currentState.phase !== 'lobby' && !currentState.myName;
  const hasDisconnected = currentState?.players?.some(p => p.disconnected);
  // Determine initial button label based on pre-filled name
  const prefilledName = myName.trim().toLowerCase();
  const isRejoin = hasDisconnected && prefilledName &&
    currentState.players.some(p => p.disconnected && p.name.toLowerCase() === prefilledName);
  const btnLabel = isRejoin ? 'Rejoin Session' : gameInProgress ? 'Join as Spectator' : 'Join Game';

  return `
    <div class="phase-hero fade-in" style="padding-top:3rem;">
      <span class="emoji-big">&#127919;</span>
      <h1 class="gradient-text">Vibe Meter</h1>
      <p>The party game where vibes speak louder than words.</p>
    </div>

    <div class="card" style="max-width:420px;margin:1.5rem auto;" id="join-card">
      ${gameInProgress ? `
        <div class="callout ${isRejoin ? 'callout-success' : 'callout-warning'}" style="margin-bottom:1rem;" id="join-callout">
          ${ isRejoin
            ? '<div class="callout-title">Welcome back!</div><p>Rejoin with your saved score.</p>'
            : '<div class="callout-title">Game in progress</div><p>You will spectate and submit a phrase to join on the next round.</p>'
          }
        </div>
      ` : ''}
      <div class="form-group">
        <label for="name-input">Your Name</label>
        <input type="text" id="name-input" placeholder="Enter your name..." maxlength="10"
               value="${esc(myName)}" autocomplete="off" autocorrect="off" spellcheck="false" />
      </div>
      <button class="btn btn-primary btn-full btn-lg" id="join-btn" style="margin-top:1rem;">
        ${btnLabel}
      </button>
      <p style="font-size:0.8rem;margin-top:0.75rem;text-align:center;">
        The <strong>first person</strong> to join becomes the host.
      </p>
    </div>
  `;
}

function attachJoinListeners() {
  const input = document.getElementById('name-input');
  const btn   = document.getElementById('join-btn');
  if (!input || !btn) return;

  input.focus();

  const gameInProgress = currentState && currentState.phase !== 'lobby';

  function updateJoinUI() {
    const name = input.value.trim().toLowerCase();
    const rejoining = !!(gameInProgress &&
      currentState?.players?.some(p => p.disconnected && p.name.toLowerCase() === name));
    btn.textContent = rejoining ? 'Rejoin Session' : gameInProgress ? 'Join as Spectator' : 'Join Game';
    const callout = document.getElementById('join-callout');
    if (callout) {
      if (rejoining) {
        callout.className = 'callout callout-success';
        callout.innerHTML = '<div class="callout-title">Welcome back!</div><p>Rejoin with your saved score.</p>';
      } else {
        callout.className = 'callout callout-warning';
        callout.innerHTML = '<div class="callout-title">Game in progress</div><p>You will spectate and submit a phrase to join on the next round.</p>';
      }
    }
  }

  input.addEventListener('input', updateJoinUI);

  const submit = () => {
    const name = input.value.trim();
    if (!name) return showToast('Please enter your name.', 'error');
    myName = name;
    localStorage.setItem('vibeMeterName', myName);
    socket.emit('join', { name });
  };

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

// -- Lobby ---------------------------------------------------
function renderLobby() {
  const s = currentState;
  const players = s.players || [];
  const activeCt = players.filter(p => !p.spectator).length;

  return `
    <div class="phase-hero fade-in">
      <span class="emoji-big">&#128715;</span>
      <h2>Waiting for players...</h2>
      <p>Share this page's URL with your friends to join.</p>
    </div>

    <div class="card">
      <div style="background:rgba(124,58,237,0.15);border:1px solid var(--primary);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
        <span style="font-size:0.8rem;font-weight:600;color:#c4b5fd;white-space:nowrap;">&#128279; Invite link</span>
        <input readonly id="share-url-input" value="${esc(window.location.href)}"
               style="flex:1;min-width:0;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius-sm);color:var(--text);font-size:0.8rem;padding:0.35rem 0.6rem;font-family:monospace;cursor:default;outline:none;" />
        <button class="btn btn-secondary" id="copy-link-btn" style="padding:0.35rem 0.75rem;font-size:0.8rem;flex-shrink:0;">Copy</button>
      </div>
      <div class="section">
        <div class="section-title">Players (${activeCt})</div>
        <div class="player-list stack-sm">
          ${players.map(p => renderPlayerItem(p, s)).join('')}
        </div>
      </div>

      <hr class="divider" />

      ${s.isHost ? `
        <div class="section-title" style="margin-bottom:0.5rem;">Points Goal</div>
        <div class="row" style="gap:0.5rem;margin-bottom:1rem;" id="goal-picker">
          ${[25, 50, 75].map(g => `
            <button class="btn goal-btn ${g === 25 ? 'btn-primary' : 'btn-secondary'}"
                    data-goal="${g}" style="flex:1;">${g} pts</button>
          `).join('')}
        </div>
        <button class="btn btn-primary btn-full btn-lg" id="start-btn"
          ${activeCt < 2 ? 'disabled' : ''}>
          ${activeCt < 2 ? 'Waiting for more players...' : 'Start Game'}
        </button>
        ${activeCt < 2 ? `<p style="font-size:0.8rem;margin-top:0.5rem;text-align:center;">Need at least 2 players.</p>` : ''}
      ` : `
        <div class="callout callout-info">
          <div class="callout-title"><span class="waiting-pulse"></span> Waiting for host to start...</div>
          <p>The host will start once everyone has joined.</p>
        </div>
      `}
    </div>
  `;
}

function attachLobbyListeners() {
  let selectedGoal = 25;
  document.querySelectorAll('.goal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedGoal = Number(btn.dataset.goal);
      document.querySelectorAll('.goal-btn').forEach(b => {
        b.classList.toggle('btn-primary', b === btn);
        b.classList.toggle('btn-secondary', b !== btn);
      });
    });
  });
  document.getElementById('start-btn')?.addEventListener('click', () => {
    socket.emit('start', { pointsGoal: selectedGoal });
  });
  document.getElementById('copy-link-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('copy-link-btn');
    navigator.clipboard.writeText(window.location.href).then(() => {
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { if (btn) btn.textContent = 'Copy'; }, 2000); }
    });
  });
}

// -- Phrase Input --------------------------------------------
function renderPhraseInput() {
  const s = currentState;
  const activePl = (s.players || []).filter(p => !p.spectator);
  const submitted = s.phraseSubmissions || [];
  const submittedCount = activePl.filter(p => submitted.includes(p.id)).length;
  const total = activePl.length;

  return `
    <div class="phase-hero fade-in">
      <span class="emoji-big">&#9997;</span>
      <h2>Enter Your Two Phrases</h2>
      <p>Think of two polar-opposite words or phrases (e.g. <em>"green flag"</em> vs <em>"red flag"</em>).</p>
    </div>

    ${s.hasSubmittedPhrase ? `
      <div class="card callout-success fade-in" style="text-align:center;padding:1.5rem;">
        <div style="font-size:2rem;margin-bottom:0.5rem;">&#10003;</div>
        <h3>Submitted!</h3>
        <p style="margin-top:0.3rem;">Waiting for others... (${submittedCount}/${total})</p>
        <div class="progress-bar" style="margin-top:1rem;">
          <div class="progress-fill" style="width:${Math.round(submittedCount/total*100)}%"></div>
        </div>
      </div>
    ` : `
      <div class="card fade-in">
        <div class="stack">
          <div class="form-group">
            <label for="label1-input">Phrase 1 &mdash; the 1 end</label>
            <input type="text" id="label1-input" placeholder='e.g. "green flag"'
                   maxlength="50" value="${esc(saved.label1)}" autocomplete="off" />
          </div>
          <div class="form-group">
            <label for="label2-input">Phrase 2 &mdash; the 100 end</label>
            <input type="text" id="label2-input" placeholder='e.g. "red flag"'
                   maxlength="50" value="${esc(saved.label2)}" autocomplete="off" />
          </div>
          <button class="btn btn-primary btn-full" id="phrase-submit-btn">
            Submit Phrases
          </button>
        </div>
      </div>
    `}

    <div class="card" style="margin-top:1.5rem;">
      <div class="section-title">All Players (${submittedCount}/${total} submitted)</div>
      <div class="stack-sm">
        ${activePl.map(p => {
          const done = submitted.includes(p.id);
          return `
            <div class="phrase-card ${p.id === s.myId ? 'current' : ''}">
              <div class="player-avatar avatar-${(s.players || []).indexOf(p) % 8}">
                ${esc(p.name[0].toUpperCase())}
              </div>
              <div>
                <div style="font-weight:600;font-size:0.9rem;">${esc(p.name)}</div>
                ${done && s.phrases.find(ph => ph.byId === p.id) ? `
                  <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.15rem;">
                    <span class="phrase-label-1">${esc(s.phrases.find(ph => ph.byId === p.id).label1)}</span>
                    <span class="phrase-vs">vs</span>
                    <span class="phrase-label-2">${esc(s.phrases.find(ph => ph.byId === p.id).label2)}</span>
                  </div>
                ` : '<div style="font-size:0.8rem;color:var(--text-dim);margin-top:0.15rem;">Typing...</div>'}
              </div>
              <span class="phrase-submitted-badge" style="margin-left:auto;">
                ${done ? '&#10003;' : '<span class="waiting-pulse" style="margin:0;"></span>'}
              </span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// Targeted patch for phrase-input -- only updates counters and player list
// without replacing the input form (prevents flicker while typing).
function patchPhraseInput() {
  const s = currentState;
  const activePl = (s.players || []).filter(p => !p.spectator);
  const submitted = s.phraseSubmissions || [];
  const submittedCount = activePl.filter(p => submitted.includes(p.id)).length;
  const total = activePl.length;
  const pct = Math.round(submittedCount / total * 100);

  // Update wait-card counter + progress (shown after user has submitted)
  const waitP = document.querySelector('.callout-success p');
  if (waitP) waitP.textContent = `Waiting for others... (${submittedCount}/${total})`;
  const waitBar = document.querySelector('.callout-success .progress-fill');
  if (waitBar) waitBar.style.width = `${pct}%`;

  // Update section title
  const secTitle = document.querySelector('#app .section-title');
  if (secTitle) secTitle.textContent = `All Players (${submittedCount}/${total} submitted)`;

  // Re-render only the player list
  const stackSm = document.querySelector('#app .stack-sm');
  if (stackSm) {
    stackSm.innerHTML = activePl.map(p => {
      const done = submitted.includes(p.id);
      const phrase = done ? s.phrases.find(ph => ph.byId === p.id) : null;
      return `
        <div class="phrase-card ${p.id === s.myId ? 'current' : ''}">
          <div class="player-avatar avatar-${(s.players || []).indexOf(p) % 8}">
            ${esc(p.name[0].toUpperCase())}
          </div>
          <div>
            <div style="font-weight:600;font-size:0.9rem;">${esc(p.name)}</div>
            ${phrase ? `
              <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.15rem;">
                <span class="phrase-label-1">${esc(phrase.label1)}</span>
                <span class="phrase-vs">vs</span>
                <span class="phrase-label-2">${esc(phrase.label2)}</span>
              </div>
            ` : '<div style="font-size:0.8rem;color:var(--text-dim);margin-top:0.15rem;">Typing...</div>'}
          </div>
          <span class="phrase-submitted-badge" style="margin-left:auto;">
            ${done ? '&#10003;' : '<span class="waiting-pulse" style="margin:0;"></span>'}
          </span>
        </div>
      `;
    }).join('');
  }
}

function attachPhraseListeners() {
  const l1 = document.getElementById('label1-input');
  const l2 = document.getElementById('label2-input');
  const btn = document.getElementById('phrase-submit-btn');

  l1?.addEventListener('input', () => { saved.label1 = l1.value; });
  l2?.addEventListener('input', () => { saved.label2 = l2.value; });

  const submit = () => {
    const label1 = l1?.value.trim();
    const label2 = l2?.value.trim();
    if (!label1 || !label2) return showToast('Both phrases are required.', 'error');
    if (label1.toLowerCase() === label2.toLowerCase()) return showToast('Phrases must be different.', 'error');
    socket.emit('phrase', { label1, label2 });
    saved.label1 = '';
    saved.label2 = '';
  };

  btn?.addEventListener('click', submit);
  l2?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

// -- Playing Screens -----------------------------------------
function renderPlaying(app) {
  const s = currentState;

  if (s.isSpectator) {
    app.innerHTML = renderSpectator();
    attachSpectatorListeners();
    return;
  }

  switch (s.roundPhase) {
    case 'phrase-select':
      app.innerHTML = s.isVibeman ? renderPhraseSelect() : renderWaitForPhraseSelect();
      if (s.isVibeman) attachPhraseSelectListeners();
      break;
    case 'vibe-writing':
      app.innerHTML = s.isVibeman ? renderVibeManWrite() : renderGuessing();
      if (s.isVibeman) attachStoryListeners();
      else attachGuessListeners();
      break;
    case 'guessing':
      app.innerHTML = s.isVibeman ? renderVibeManWaiting() : renderGuessing();
      if (!s.isVibeman) attachGuessListeners();
      else startGuessCountdown();
      break;
    case 'round-results':
      app.innerHTML = renderResults();
      break;
    default:
      app.innerHTML = '<div class="connecting-screen"><div class="spinner"></div></div>';
  }
}

// -- Spectator Screen ----------------------------------------
function renderSpectator() {
  const s = currentState;
  const currentPhrase = s.currentPhrase;
  const gameStarted = s.phase === 'playing';

  return `
    <div class="fade-in">
      <div class="card" style="margin-bottom:1rem;">
        <div style="display:flex;align-items:center;gap:0.75rem;${s.isPending ? 'margin-bottom:0.75rem;' : 'margin-bottom:0.5rem;'}">
          <span style="font-size:2rem;">&#128065;</span>
          <div>
            <h3 style="margin:0;">Spectating</h3>
            <p style="margin:0;font-size:0.85rem;">Watching this round.</p>
          </div>
        </div>
        ${s.isPending ? `
          <div class="callout callout-success">
            <div class="callout-title">&#10003; You're in for next round!</div>
            <p>You'll be a full player starting on the next round.</p>
          </div>
        ` : `
          <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
            <p style="margin:0;flex:1;font-size:0.85rem;min-width:0;">Watch the action &mdash; jump in whenever you're ready.</p>
            <button class="btn btn-primary" id="join-next-round-btn" style="flex-shrink:0;">Join Next Round</button>
          </div>
        `}
      </div>

      ${gameStarted ? `
        <div class="card">
          <div class="section-title">Round ${s.roundNumber}</div>
          ${renderVibeManBanner(s)}
          ${currentPhrase ? renderPhraseStrip(currentPhrase) : ''}
          ${s.story ? `
            <div class="section-title" style="margin-top:1rem;">The Vibe Story</div>
            <div class="story-box">${esc(s.story)}</div>
          ` : s.roundPhase === 'phrase-select' ? `
            <p style="font-size:0.85rem;margin-top:0.5rem;color:var(--text-muted);">
              <span class="waiting-pulse"></span> ${esc(s.vibeManName)} is choosing a phrase&hellip;
            </p>
          ` : s.vibeManName ? `
            <p style="font-size:0.85rem;margin-top:0.5rem;color:var(--text-muted);">
              <span class="waiting-pulse"></span> ${esc(s.vibeManName)} is writing their story&hellip;
            </p>
          ` : ''}
        </div>
      ` : `
        <div class="card">
          <p style="font-size:0.9rem;color:var(--text-muted);"><span class="waiting-pulse"></span> Waiting for the game to start&hellip;</p>
        </div>
      `}
    </div>
  `;
}

function attachSpectatorListeners() {
  const btn = document.getElementById('join-next-round-btn');
  btn?.addEventListener('click', () => {
    socket.emit('join-next-round');
  });
}

// Vibe Man banner
function renderVibeManBanner(s) {
  return `
    <div class="row" style="gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
      ${s.isVibeman
        ? '' /* TASK badge moved into the story card */
        : `<span class="badge badge-purple">Vibe Man: ${esc(s.vibeManName)}</span>`
      }
      <span class="badge badge-purple">Round ${s.roundNumber}</span>
      <span class="badge badge-yellow">Goal: ${s.pointsGoal} pts</span>
    </div>
  `;
}

// Phrase strip
function renderPhraseStrip(phrase) {
  if (!phrase) return '';
  return `
    <div class="meter-wrap">
      <div class="meter-labels">
        <div>
          <div class="meter-label-num">1</div>
          <div class="phrase-label-1">${esc(phrase.label1)}</div>
        </div>
        <div style="text-align:right;">
          <div class="meter-label-num">100</div>
          <div class="phrase-label-2">${esc(phrase.label2)}</div>
        </div>
      </div>
      <div class="meter-bar"></div>
    </div>
  `;
}

// -- Vibe Man: Writing Phase ---------------------------------
function renderVibeManWrite() {
  const s = currentState;
  const { currentPhrase, randomValue } = s;

  // Static dial showing the secret value
  const CX = 150, CY = 150, R = 130;
  const angle = Math.PI - ((randomValue - 1) / 99) * Math.PI;
  const nx = CX + (R - 18) * Math.cos(angle);
  const ny = CY - (R - 18) * Math.sin(angle);
  const ARC_LEN = Math.PI * R;
  const dashOffset = ARC_LEN * (1 - (randomValue - 1) / 99);

  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card highlight" style="padding:1rem 1rem 0.5rem;">
        <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-dim);text-align:center;margin-bottom:0.25rem;">Your Secret Number</div>

        <div class="dial-wrap" style="margin:0;">
          <svg class="dial-svg" viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="dialGradWrite" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#10b981" />
                <stop offset="50%"  stop-color="#a855f7" />
                <stop offset="100%" stop-color="#ef4444" />
              </linearGradient>
            </defs>
            <path class="dial-track" d="M 20,150 A 130,130 0 0,1 280,150" />
            <path class="dial-fill" d="M 20,150 A 130,130 0 0,1 280,150"
              style="stroke-dasharray:${ARC_LEN.toFixed(2)};stroke-dashoffset:${dashOffset.toFixed(2)};stroke:url(#dialGradWrite);" />
            <line class="dial-needle" x1="150" y1="150" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" />
            <circle class="dial-pivot" cx="150" cy="150" r="10" />
          </svg>
          <div class="dial-readout" style="margin-top:0.25rem;">${randomValue}</div>
          <div class="dial-labels">
            <div class="dial-label-left">
              <span class="dial-label-num">1</span>
              <span class="phrase-label-1">${esc(currentPhrase?.label1 || '')}</span>
            </div>
            <div class="dial-label-right">
              <span class="dial-label-num">100</span>
              <span class="phrase-label-2">${esc(currentPhrase?.label2 || '')}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <div class="form-group">
          <div style="margin-bottom:0.75rem;">
            <span class="badge badge-yellow" style="font-size:0.95rem;padding:0.35rem 0.75rem;">TASK: Vibe Man</span>
          </div>
          <textarea id="story-input" placeholder="Write a short story or scenario that best represents this vibe... (don't give away the number!)"
                    rows="5" maxlength="600">${esc(saved.story)}</textarea>
          <div style="font-size:0.75rem;color:var(--text-dim);text-align:right;" id="story-count">
            ${saved.story.length} / 600
          </div>
        </div>
        <button class="btn btn-primary btn-full" id="story-submit-btn" style="margin-top:0.75rem;">
          Submit Story
        </button>
      </div>
    </div>
  `;
}

function attachStoryListeners() {
  const ta  = document.getElementById('story-input');
  const btn = document.getElementById('story-submit-btn');
  const cnt = document.getElementById('story-count');

  ta?.addEventListener('input', () => {
    saved.story = ta.value;
    if (cnt) cnt.textContent = `${ta.value.length} / 600`;
  });

  ta?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn?.click();
    }
  });

  btn?.addEventListener('click', () => {
    const story = ta?.value.trim();
    if (!story) return showToast('Write your story first!', 'error');
    socket.emit('story', { story });
    saved.story = '';
  });
}

// -- Waiting for Vibe Man ------------------------------------
const WAIT_TIPS = [
  { emoji: '&#128172;', text: 'Talk it out — what does a 1 actually look like on this phrase? What does a 100?' },
  { emoji: '&#129504;', text: 'Pre-commit to a gut range before the story even drops so you\'re not starting cold.' },
  { emoji: '&#128064;', text: 'How well do you know the Vibe Man? Watch the their reaction and pace — nerves can mean an extreme number.' },
  { emoji: '&#127919;', text: 'Exact guesses score 7 pts. If the phrase has an obvious extreme, it might be worth camping it.' },
  { emoji: '&#128200;', text: 'Check the leaderboard — know who\'s running hot. Their reading of this Vibe Man might be worth matching.' },
  { emoji: '&#129300;', text: 'Remember: the Vibe Man earns the avg of your points x2. Good writing = they want you all close.' },
  { emoji: '&#9878;&#65039;', text: 'Think about how this specific Vibe Man writes — do they go literal, poetic, deadpan, or chaotic?' },
  { emoji: '&#128257;', text: 'You have 15–30 seconds once the story drops. Lock in fast — second-guessing rarely helps.' },
  { emoji: '&#127756;', text: 'Numbers near 50 are safer but rarely score big. Commit to a direction if you have any read at all.' },
  { emoji: '&#128293;', text: 'Has this Vibe Man gone extreme before? People often cluster their stories in a comfort zone.' },
  { emoji: '&#129517;', text: 'The spectrum ends anchor everything. Re-read them now so they\'re fresh when the story hits.' },
  { emoji: '&#128483;', text: 'Silence can be a tell. Is the Vibe Man quiet and focused, or laughing? Both reveal something.' },
  { emoji: '&#128293;', text: 'Guessing 1–5 or 96–100 is the Extreme Zone — all or nothing. If the true value is also extreme, you get 6 pts (or 14 for a direct hit). If it\'s not, you score zero.' },
  { emoji: '&#9889;', text: 'The Extreme Zone is only 5 values wide on each end. So you have a 1 in 5 shot to earn 14 points on a direct hit and 6 otherwise!' },
  { emoji: '&#129520;', text: 'If you suspect the true number is extreme but aren\'t sure which end, staying just outside (6 or 95) is safer — you still score normally without the all-or-nothing penalty.' },
  { emoji: '&#129513;', text: 'Guessing 6 or 95 when you suspect an extreme true value is often the smartest play — if the answer is 1 or 100, you still pocket 3 pts with zero risk.' },
  { emoji: '&#127919;', text: 'The 2-pt and 1-pt brackets exist for a reason. Consistent near-misses (within 7–9) will out-score someone swinging for exact hits and hitting zero most rounds.' },
];

// ============================================================
//  TIP DECK  (shuffled, one tip per round)
// ============================================================
let _tipDeck = [];
let _tipIdx  = 0;
let _currentRoundTip = null;

function _nextTipFromDeck() {
  if (_tipIdx >= _tipDeck.length) {
    _tipDeck = Array.from({ length: WAIT_TIPS.length }, (_, i) => i);
    for (let i = _tipDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [_tipDeck[i], _tipDeck[j]] = [_tipDeck[j], _tipDeck[i]];
    }
    _tipIdx = 0;
  }
  return WAIT_TIPS[_tipDeck[_tipIdx++]];
}

function _tipHTML(tip) {
  return `
  <div class="card" style="margin-top:1rem;padding:1rem 1.25rem;display:flex;align-items:flex-start;gap:0.9rem;">
    <span style="font-size:1.75rem;flex-shrink:0;line-height:1.2;">${tip.emoji}</span>
    <div>
      <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-dim);margin-bottom:0.3rem;">While you wait</div>
      <p style="margin:0;font-size:0.92rem;color:var(--text);font-style:italic;">${tip.text}</p>
    </div>
  </div>`;
}

// -- Phrase Select Screen ------------------------------------
function renderPhraseSelect() {
  const s = currentState;
  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card highlight">
        <div style="text-align:center;margin-bottom:1rem;">
          <span class="badge badge-yellow" style="font-size:0.95rem;padding:0.35rem 0.75rem;">TASK: Vibe Man</span>
        </div>
        <div style="text-align:center;margin-bottom:1.25rem;color:var(--text-muted);font-size:0.9rem;">
          Pick the phrase you'll use to describe your secret vibe.
        </div>
        <div class="stack-sm">
          ${(s.availablePhrases || []).map(ph => `
            <button class="btn btn-secondary phrase-pick-btn" data-phrase-id="${ph.id}"
                    style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.75rem 1rem;text-align:left;">
              <span class="phrase-label-1" style="font-size:1rem;">${esc(ph.label1)}</span>
              <span class="phrase-vs">vs</span>
              <span class="phrase-label-2" style="font-size:1rem;">${esc(ph.label2)}</span>
              <span style="font-size:0.7rem;color:var(--text-dim);white-space:nowrap;margin-left:auto;">by ${esc(ph.byName)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderWaitForPhraseSelect() {
  const s = currentState;
  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card" style="text-align:center;padding:2rem;">
        <div style="font-size:3rem;margin-bottom:0.75rem;">&#128196;</div>
        <h3><span class="waiting-pulse"></span> ${esc(s.vibeManName)} is choosing a phrase...</h3>
        <p style="margin-top:0.5rem;">They have a secret number and are picking the best phrase to describe it.</p>
      </div>
    </div>
  `;
}

function attachPhraseSelectListeners() {
  document.querySelectorAll('.phrase-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('select-phrase', { phraseId: Number(btn.dataset.phraseId) });
    });
  });
}

// -- Vibe Man: Waiting for Guesses ---------------------------

// -- Shared mini-dial card renderer --------------------------------
function renderMiniDialCard(p, knownMap) {
  const CX = 100, CY = 100, R = 82;
  const ARC_LEN = Math.PI * R;
  const known    = knownMap[p.id];
  const value    = known?.value ?? null;
  const submitted = known?.submitted ?? false;
  const angle    = value != null ? Math.PI - ((value - 1) / 99) * Math.PI : Math.PI;
  const nx       = (CX + (R - 12) * Math.cos(angle)).toFixed(2);
  const ny       = (CY - (R - 12) * Math.sin(angle)).toFixed(2);
  const dashOff  = value != null ? (ARC_LEN * (1 - (value - 1) / 99)).toFixed(2) : ARC_LEN.toFixed(2);
  return `
      <div class="mini-dial-card ${submitted ? 'mini-dial-submitted' : ''} ${value == null ? 'mini-dial-waiting' : ''}"
           id="mini-dial-${esc(p.id)}">
        <svg viewBox="0 0 200 110" xmlns="http://www.w3.org/2000/svg" style="width:100%;">
          <defs>
            <linearGradient id="mg-${esc(p.id)}" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stop-color="#10b981"/>
              <stop offset="50%"  stop-color="#a855f7"/>
              <stop offset="100%" stop-color="#ef4444"/>
            </linearGradient>
          </defs>
          <path fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="12" stroke-linecap="round"
            d="M 18,100 A 82,82 0 0,1 182,100"/>
          <path class="mini-fill" fill="none" stroke="url(#mg-${esc(p.id)})" stroke-width="12" stroke-linecap="round"
            d="M 18,100 A 82,82 0 0,1 182,100"
            style="stroke-dasharray:${ARC_LEN.toFixed(2)};stroke-dashoffset:${dashOff};"/>
          <line class="mini-needle" x1="100" y1="100" x2="${nx}" y2="${ny}"
            stroke="${submitted ? '#10b981' : '#fff'}" stroke-width="2.5" stroke-linecap="round"
            style="filter:drop-shadow(0 0 3px ${submitted ? '#10b981' : '#a855f7'});"/>
          <circle cx="100" cy="100" r="6" fill="${submitted ? '#10b981' : '#fff'}"
            style="filter:drop-shadow(0 0 4px ${submitted ? '#10b981aa' : '#a855f7aa'});"/>
        </svg>
        <div class="mini-value">${value ?? '&mdash;'}</div>
        <div class="mini-name">
          ${esc(p.name)}
          ${submitted ? '<span class="mini-lock">&#128274;</span>' : ''}
        </div>
      </div>
  `;
}

function updateMiniDial(playerId, value, submitted) {
  const card = document.getElementById('mini-dial-' + playerId);
  if (!card || value == null) return;

  const CX = 100, CY = 100, R = 82;
  const ARC_LEN = Math.PI * R;
  const angle = Math.PI - ((value - 1) / 99) * Math.PI;
  const nx = (CX + (R - 12) * Math.cos(angle)).toFixed(2);
  const ny = (CY - (R - 12) * Math.sin(angle)).toFixed(2);
  const dashOffset = (ARC_LEN * (1 - (value - 1) / 99)).toFixed(2);

  const needle = card.querySelector('.mini-needle');
  const fill   = card.querySelector('.mini-fill');
  const label  = card.querySelector('.mini-value');
  if (needle) { needle.setAttribute('x2', nx); needle.setAttribute('y2', ny); }
  if (fill)   { fill.style.strokeDashoffset = dashOffset; }
  if (label)  { label.textContent = value; }

  // Dim if waiting (no position yet), lock styling when submitted
  card.classList.toggle('mini-dial-submitted', !!submitted);
  card.classList.toggle('mini-dial-waiting', value == null);
}

function renderVibeManWaiting() {
  const s = currentState;
  const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
  const vibeManId = s.vibeManId;
  const guessers = (s.players || []).filter(p => !p.spectator && !p.disconnected && p.id !== vibeManId);
  const knownMap = {};
  (s.liveGuesses || []).forEach(g => { knownMap[g.id] = g; });

  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card highlight" style="padding:0.75rem 1rem 0.5rem;margin-bottom:1rem;text-align:center;">
        <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-dim);margin-bottom:0.2rem;">Your Secret Number</div>
        <div class="big-number" style="font-size:3.5rem;">${s.randomValue}</div>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <div class="section-title">Your Story</div>
        <div class="story-box">${esc(s.story)}</div>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <div class="row-between" style="margin-bottom:0.6rem;">
          <div class="section-title" style="margin:0;">Live Guesses</div>
          <span id="vm-guess-count" style="font-weight:700;">${s.guessCount} / ${s.totalGuessers}</span>
        </div>
        <div class="progress-bar" style="margin-bottom:1rem;">
          <div id="vm-guess-progress" class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="mini-dial-grid" style="--mini-cols:${guessers.length === 1 ? 1 : guessers.length <= 4 ? 2 : guessers.length <= 9 ? 3 : 4};">
          ${guessers.map(p => renderMiniDialCard(p, knownMap)).join('')}
        </div>
      </div>

      <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;margin-bottom:1rem;">
        <p id="guess-timer-secs" style="font-size:0.9rem;margin-bottom:0.6rem;">15 seconds...</p>
        <div class="countdown-bar-wrap">
          <div class="countdown-bar-15" id="guess-timer-bar"></div>
        </div>
      </div>
    </div>
  `;
}


// Patch the vibe-man waiting screen in-place (preserves live mini-dial positions)
function patchVibeManWaiting() {
  const s = currentState;
  const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
  const countEl = document.getElementById('vm-guess-count');
  if (countEl) countEl.textContent = `${s.guessCount} / ${s.totalGuessers}`;
  const progressEl = document.getElementById('vm-guess-progress');
  if (progressEl) progressEl.style.width = `${pct}%`;
  (s.liveGuesses || []).forEach(g => updateMiniDial(g.id, g.value, g.submitted));
}

// Patch the guesser screen in-place (preserves the interactive dial + mini-dials)
function patchGuesserGuessing() {
  const s = currentState;
  const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
  const countEl = document.getElementById('guesser-guess-count');
  if (countEl) countEl.textContent = `${s.guessCount} / ${s.totalGuessers}`;
  const progressEl = document.getElementById('guesser-guess-progress');
  if (progressEl) progressEl.style.width = `${pct}%`;
  (s.liveGuesses || []).forEach(g => {
    if (g.id !== s.myId) updateMiniDial(g.id, g.value, g.submitted);
  });
}

// -- Guessing Phase ------------------------------------------
function renderGuessing() {
  const s = currentState;
  const isWaiting  = s.roundPhase === 'vibe-writing';
  const hasGuessed = s.hasSubmittedGuess;
  if (!_currentRoundTip) _currentRoundTip = _nextTipFromDeck();

  const label1 = esc(s.currentPhrase?.label1 || '');
  const label2 = esc(s.currentPhrase?.label2 || '');
  const v = saved.guessValue;

  const dialTicks = Array.from({length: 11}, (_, i) => {
    const angle = Math.PI - (i / 10) * Math.PI;
    const r1 = 116, r2 = 144, cx = 150, cy = 150;
    const x1 = cx + r1 * Math.cos(angle); const y1 = cy - r1 * Math.sin(angle);
    const x2 = cx + r2 * Math.cos(angle); const y2 = cy - r2 * Math.sin(angle);
    return `<line class="dial-tick${i === 0 || i === 10 ? ' dial-tick-end' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`;
  }).join('');

  const dialSVG = `
    <div class="dial-wrap" style="margin:0.5rem 0 0;">
      <svg class="dial-svg" id="dial-svg" viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg"${isWaiting ? '' : ' style="cursor:grab;"'}>
        <defs>
          <linearGradient id="dialGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stop-color="#10b981" />
            <stop offset="50%"  stop-color="#a855f7" />
            <stop offset="100%" stop-color="#ef4444" />
          </linearGradient>
        </defs>
        <path class="dial-track" d="M 20,150 A 130,130 0 0,1 280,150" />
        <path class="dial-fill" id="dial-fill" d="M 20,150 A 130,130 0 0,1 280,150"
          style="stroke-dasharray:408.41;" />
        ${dialTicks}
        <line class="dial-needle" id="dial-needle" x1="150" y1="150" x2="20" y2="150" />
        <circle class="dial-pivot" cx="150" cy="150" r="10" />
      </svg>
      ${isWaiting ? '' : `<div class="dial-readout" id="guess-display">${v}</div>`}
      <div class="dial-labels">
        <div class="dial-label-left">
          <span class="dial-label-num">1</span>
          <span class="phrase-label-1">${label1}</span>
        </div>
        <div class="dial-label-right">
          <span class="dial-label-num">100</span>
          <span class="phrase-label-2">${label2}</span>
        </div>
      </div>
    </div>`;

  // -- Waiting for vibe man to write --
  if (isWaiting) {
    return `
      <div class="fade-in">
        ${renderVibeManBanner(s)}
        <div class="card" style="text-align:center;padding:2rem;">
          <div style="font-size:3rem;margin-bottom:0.75rem;">&#128161;</div>
          <h3><span class="waiting-pulse"></span> ${esc(s.vibeManName)} is writing their story...</h3>
          <p style="margin-top:0.5rem;">The Vibe Man has a secret number and is crafting a vibe story.</p>
        </div>
        ${_tipHTML(_currentRoundTip)}
        <div class="card" style="margin-top:1rem;">${dialSVG}</div>
      </div>`;
  }

  // -- Guess submitted, waiting for others --
  if (hasGuessed) {
    const otherGuessers = (s.players || []).filter(p => !p.spectator && p.id !== s.vibeManId && p.id !== s.myId);
    let miniDialsHtml = '';
    if (otherGuessers.length > 0) {
      const knownMap = {};
      (s.liveGuesses || []).forEach(g => { knownMap[g.id] = g; });
      const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
      const cols = otherGuessers.length === 1 ? 1 : otherGuessers.length <= 4 ? 2 : otherGuessers.length <= 9 ? 3 : 4;
      miniDialsHtml = `
        <div class="card" style="margin-top:1rem;">
          <div class="row-between" style="margin-bottom:0.6rem;">
            <div class="section-title" style="margin:0;">Others' Guesses</div>
            <span id="guesser-guess-count" style="font-weight:700;">${s.guessCount} / ${s.totalGuessers}</span>
          </div>
          <div class="progress-bar" style="margin-bottom:1rem;">
            <div id="guesser-guess-progress" class="progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="mini-dial-grid" style="--mini-cols:${cols};">
            ${otherGuessers.map(p => renderMiniDialCard(p, knownMap)).join('')}
          </div>
        </div>`;
    }
    return `
      <div class="fade-in">
        ${renderVibeManBanner(s)}
        <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;margin-bottom:1rem;">
          <p id="guess-timer-secs" style="font-size:0.9rem;margin-bottom:0.6rem;">15 seconds...</p>
          <div class="countdown-bar-wrap">
            <div class="countdown-bar-15" id="guess-timer-bar"></div>
          </div>
        </div>
        <div class="card" style="text-align:center;padding:1.5rem;">
          <div style="font-size:2.5rem;margin-bottom:0.5rem;">&#10003;</div>
          <h3>Guess locked in: <span class="gradient-text">${s.myGuess}</span></h3>
          <p style="margin-top:0.35rem;">
            <span class="waiting-pulse"></span>
            Waiting for ${s.totalGuessers - s.guessCount} more player(s)...
          </p>
        </div>
        ${_tipHTML(_currentRoundTip)}
        <div class="card" style="margin-top:1rem;">
          <div class="section-title" style="margin-bottom:0.6rem;">The Vibe Story from ${esc(s.vibeManName)}</div>
          <div class="story-box">${esc(s.story)}</div>
        </div>
        ${miniDialsHtml}
      </div>`;
  }

  // -- Pre-submit: story + interactive dial --
  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}
      ${_tipHTML(_currentRoundTip)}
      <div class="card highlight" style="margin-top:1rem;">
        <div class="section-title">The Vibe Story from ${esc(s.vibeManName)}</div>
        <div class="story-box" style="margin-bottom:1rem;">${esc(s.story)}</div>
        <div class="section-title">What number is this vibe?</div>
        ${dialSVG}
        <button class="btn btn-success btn-full btn-lg" id="guess-submit-btn" style="margin-top:1rem;">
          Lock In My Guess
        </button>
      </div>
      <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;margin-bottom:1rem;">
        <p id="guess-timer-secs" style="font-size:0.9rem;margin-bottom:0.6rem;">15 seconds...</p>
        <div class="countdown-bar-wrap">
          <div class="countdown-bar-15" id="guess-timer-bar"></div>
        </div>
      </div>
    </div>`;
}

function attachGuessListeners() {
  const s = currentState;

  // -- Waiting state: locked oscillating dial, no timer --
  if (s.roundPhase === 'vibe-writing') {
    const needle = document.getElementById('dial-needle');
    const fill   = document.getElementById('dial-fill');
    if (!needle) return;
    if (fill) { fill.style.strokeDasharray = '408.41'; fill.style.strokeDashoffset = '0'; }
    const CX = 150, CY = 150, R = 112, T = 4000;
    const startTs = performance.now();
    function tick(ts) {
      if (!document.getElementById('dial-needle')) return;
      const elapsed = ts - startTs;
      const angle = (Math.PI / 2) * (1 + Math.cos((2 * Math.PI * elapsed) / T));
      needle.setAttribute('x2', (CX + R * Math.cos(angle)).toFixed(2));
      needle.setAttribute('y2', (CY - R * Math.sin(angle)).toFixed(2));
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return;
  }

  // -- Guessing state: interactive dial --
  startGuessCountdown();
  const svg     = document.getElementById('dial-svg');
  const needle  = document.getElementById('dial-needle');
  const fill    = document.getElementById('dial-fill');
  const display = document.getElementById('guess-display');
  const btn     = document.getElementById('guess-submit-btn');
  if (!svg || !needle || !btn) return;

  // Dial geometry (must match SVG viewBox values)
  const CX = 150, CY = 150, R = 130;
  // value 1 = leftmost (angle PI), value 100 = rightmost (angle 0)
  // angle goes from PI (left) to 0 (right) as value goes 1 -> 100

  function valueToAngle(val) {
    return Math.PI - ((val - 1) / 99) * Math.PI;
  }

  function angleToValue(angle) {
    // angle in radians, clamped to [0, PI]
    const clamped = Math.max(0, Math.min(Math.PI, angle));
    return Math.round(1 + ((Math.PI - clamped) / Math.PI) * 99);
  }

  function updateDial(val) {
    saved.guessValue = val;
    if (display) display.textContent = val;

    const angle = valueToAngle(val);
    // Needle endpoint
    const nx = CX + (R - 18) * Math.cos(angle);
    const ny = CY - (R - 18) * Math.sin(angle);
    needle.setAttribute('x2', nx.toFixed(2));
    needle.setAttribute('y2', ny.toFixed(2));

    // Fill arc via stroke-dashoffset -- tracks same path as background, never clips
    const ARC_LEN = Math.PI * R; // semicircle length = ~408.41
    const fraction = (val - 1) / 99;
    fill.style.strokeDasharray = ARC_LEN;
    fill.style.strokeDashoffset = ARC_LEN * (1 - fraction);

    // Throttled live position update so the Vibe Man can watch in real-time
    if (!updateDial._t) {
      updateDial._t = setTimeout(() => {
        socket.emit('live-pos', { value: saved.guessValue });
        updateDial._t = null;
      }, 40);
    }
  }

  // Init at saved value
  updateDial(saved.guessValue);

  function getSVGPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const scaleX = 300 / rect.width;
    const scaleY = 170 / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    };
  }

  function handleMove(clientX, clientY) {
    const pt = getSVGPoint(clientX, clientY);
    const dx = pt.x - CX;
    const dy = CY - pt.y;  // positive = above centre line, negative = below

    // Below the horizontal centre line: snap to the nearest extreme endpoint
    // Left half  → value 1  (angle π)
    // Right half → value 100 (angle 0)
    if (dy < 0) {
      updateDial(dx < 0 ? 1 : 100);
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clamped = Math.max(0, Math.min(Math.PI, angle));
    updateDial(angleToValue(clamped));
  }

  let dragging = false;

  svg.addEventListener('mousedown', (e) => {
    dragging = true;
    svg.style.cursor = 'grabbing';
    handleMove(e.clientX, e.clientY);
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    handleMove(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; svg.style.cursor = 'grab'; }
  });

  // Touch support
  svg.addEventListener('touchstart', (e) => {
    dragging = true;
    const t = e.touches[0];
    handleMove(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    handleMove(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchend', () => { dragging = false; });

  btn.addEventListener('click', () => {
    socket.emit('guess', { value: saved.guessValue });
  });
}

// -- Round / Phrase Results ----------------------------------
function renderResults() {
  _currentRoundTip = null;
  const s = currentState;
  const phrase = s.currentPhrase;
  const results = s.roundResults || [];

  const ptColor = r => {
    if (r.extremeGuess && r.pts > 0)  return '#f59e0b'; // extreme win — orange-gold
    if (r.extremeGuess && r.pts === 0) return '#64748b'; // extreme miss — grey
    return r.pts >= 7 ? '#fbbf24' : r.pts >= 3 ? '#10b981' : r.pts >= 2 ? '#3b82f6' : r.pts >= 1 ? '#f59e0b' : '#ef4444';
  };
  const DCXR = 130, DCX = 150, DCY = 150;
  const TIP_R = DCXR - 16; // needle tips just inside the arc
  const ANS_R = DCXR - 7;  // answer sits right on the arc
  function dialAngle(val) { return Math.PI - ((val - 1) / 99) * Math.PI; }

  const playerNeedles = results.map(r => {
    const a  = dialAngle(r.guess);
    const tx = (DCX + TIP_R * Math.cos(a)).toFixed(1);
    const ty = (DCY - TIP_R * Math.sin(a)).toFixed(1);
    const c  = ptColor(r);
    const init = esc(r.name.slice(0, 2).toUpperCase());
    return `<line x1="${DCX}" y1="${DCY}" x2="${tx}" y2="${ty}" stroke="${c}" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>
      <circle cx="${tx}" cy="${ty}" r="11" fill="${c}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>
      <text x="${tx}" y="${(parseFloat(ty)+4).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#fff">${init}</text>`;
  }).join('');

  const aa = dialAngle(s.randomValue);
  const ax = (DCX + ANS_R * Math.cos(aa)).toFixed(1);
  const ay = (DCY - ANS_R * Math.sin(aa)).toFixed(1);
  const ansNeedle = `<line x1="${DCX}" y1="${DCY}" x2="${ax}" y2="${ay}" stroke="#fbbf24" stroke-width="4" stroke-linecap="round"/>
    <circle cx="${ax}" cy="${ay}" r="13" fill="#fbbf24" stroke="rgba(0,0,0,0.45)" stroke-width="2"/>
    <text x="${ax}" y="${(parseFloat(ay)+4.5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="900" fill="#000">${s.randomValue}</text>`;

  const anyPerfect = results.some(r => r.pts >= 3);
  const anyExtremeWin = results.some(r => r.extremeGuess && r.pts > 0);

  // Find closest guesser (smallest diff)
  const closestResult = results.length > 0
    ? results.reduce((best, r) => r.diff < best.diff ? r : best, results[0])
    : null;
  const heroBullseye = closestResult && closestResult.diff === 0;
  const heroEmoji = heroBullseye ? '&#127919;' : anyExtremeWin ? '&#128293;' : anyPerfect ? '&#127881;' : '&#128517;';
  const heroText = closestResult
    ? (heroBullseye
        ? `${esc(closestResult.name)} hit a bullseye!`
        : `${esc(closestResult.name)} was closest!`)
    : 'Round over!';

  // Trigger confetti if the local player scored big
  const myResult = results.find(r => r.id === currentState.myId);
  if (myResult && (myResult.pts >= 7 || (myResult.extremeGuess && myResult.pts >= 4))) {
    setTimeout(launchConfetti, 100);
  }

  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card ${heroBullseye ? 'success' : ''}" style="text-align:center;padding:1.5rem;margin-bottom:1rem;">
        <div style="font-size:2.5rem;margin-bottom:0.25rem;">${heroEmoji}</div>
        <h3>${heroText}</h3>
        <p style="margin-top:0.3rem;">
          The secret number was <strong style="color:var(--text);font-size:1.1em;">${s.randomValue}</strong>
        </p>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <div class="section-title">Where everyone landed</div>
        <div class="dial-wrap" style="margin:0.5rem 0 0;">
          <svg class="dial-svg" viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="rdGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#10b981"/>
                <stop offset="50%"  stop-color="#a855f7"/>
                <stop offset="100%" stop-color="#ef4444"/>
              </linearGradient>
            </defs>
            <path class="dial-track" d="M 20,150 A 130,130 0 0,1 280,150"/>
            <path fill="none" stroke="url(#rdGrad)" stroke-width="14" stroke-linecap="round" opacity="0.25"
                  d="M 20,150 A 130,130 0 0,1 280,150"/>
            ${playerNeedles}
            ${ansNeedle}
            <circle class="dial-pivot" cx="150" cy="150" r="8"/>
          </svg>
          <div class="dial-labels">
            <div class="dial-label-left">
              <span class="dial-label-num">1</span>
              <span class="phrase-label-1">${esc(phrase?.label1 || '')}</span>
            </div>
            <div class="dial-label-right">
              <span class="dial-label-num">100</span>
              <span class="phrase-label-2">${esc(phrase?.label2 || '')}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:center;gap:0.75rem;font-size:0.72rem;flex-wrap:wrap;color:var(--text-muted);margin-top:0.4rem;padding-bottom:0.25rem;">
          <span style="color:#fbbf24;font-weight:700;">&#9679; Answer</span>
          <span style="color:#fbbf24;opacity:0.75;">&#9679; Exact (7 pts)</span>
          <span style="color:#10b981;">&#9679; Close (3 pts)</span>
          <span style="color:#3b82f6;">&#9679; Near (2 pts)</span>
          <span style="color:#f59e0b;">&#9679; OK (1 pt) / Extreme win</span>
          <span style="color:#64748b;">&#9679; Extreme miss</span>
          <span style="color:#ef4444;">&#9679; Miss</span>
        </div>
        <div class="section-title" style="margin-top:1.25rem;">The Vibe Story by ${esc(s.vibeManName)}</div>
        <div class="story-box">${esc(s.story)}</div>
      </div>

      <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;">
        <p style="font-size:0.9rem;margin-bottom:0.6rem;">Next round starting&hellip;</p>
        <div class="countdown-bar-wrap">
          <div class="countdown-bar"></div>
        </div>
      </div>
    </div>
  `;
}

// -- Game Over -----------------------------------------------
function renderGameOver() {
  const s = currentState;
  const ranked = [...s.players].filter(p => !p.spectator).sort((a, b) => b.score - a.score);
  const medalEmoji = ['&#x1F947;', '&#x1F948;', '&#x1F949;'];
  const winner = ranked[0];

  return `
    <div class="fade-in">
      <div class="phase-hero">
        <span class="emoji-big">&#x1F3C6;</span>
        <h2 class="gradient-text">${winner ? esc(winner.name) + ' wins!' : 'Game Over!'}</h2>
        <p>First to <strong>${s.pointsGoal}</strong> points &mdash; here are the final standings.</p>
      </div>

      <div class="card" style="margin-bottom:1.5rem;">
        <div class="section-title">Final Leaderboard</div>
        <div class="stack-sm">
          ${ranked.map((p, i) => `
            <div class="leaderboard-row">
              <div class="lb-rank">${medalEmoji[i] || '#' + (i + 1)}</div>
              <div class="player-avatar avatar-${s.players.findIndex(pl => pl.id === p.id) % 8}">
                ${esc(p.name[0].toUpperCase())}
              </div>
              <div class="lb-name">
                ${esc(p.name)}
              </div>
              <div class="lb-score">${p.score} <span style="font-size:0.9rem;color:var(--text-dim);">pts</span></div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:1.5rem;">
        <div class="section-title">Phrases Played (${s.phrases.length})</div>
        <div class="stack-sm">
          ${s.phrases.map(ph => `
            <div class="phrase-card">
              <span class="phrase-label-1">${esc(ph.label1)}</span>
              <span class="phrase-vs">vs</span>
              <span class="phrase-label-2">${esc(ph.label2)}</span>
              <span style="margin-left:auto;font-size:0.75rem;color:var(--text-dim);">by ${esc(ph.byName)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      ${s.isHost ? `
        <button class="btn btn-secondary btn-full btn-lg" id="restart-btn">
          Play Again
        </button>
      ` : `
        <div class="callout" style="text-align:center;">
          <span class="waiting-pulse"></span> Waiting for host to restart...
        </div>
      `}
    </div>
  `;
}

function attachGameOverListeners() {
  document.getElementById('restart-btn')?.addEventListener('click', () => {
    if (confirm('Start a new game? All scores will reset.')) {
      socket.emit('restart');
    }
  });
}

// ============================================================
//  SHARED HELPERS
// ============================================================

function renderPlayerItem(p, s) {
  const isYou  = p.id === s.myId;
  const isHost = p.id === s.host;
  const isVibe = p.id === s.vibeManId && s.phase === 'playing';
  const idx    = (s.players || []).findIndex(pl => pl.id === p.id);

  return `
    <div class="player-item ${isYou ? 'you' : ''} ${isVibe ? 'vibeman' : ''} ${p.disconnected ? 'player-disconnected' : ''}">
      <div class="player-avatar avatar-${idx % 8}">
        ${esc(p.name[0].toUpperCase())}
      </div>
      <div class="player-name">${esc(p.name)}</div>
      <div style="display:flex;align-items:center;gap:0.4rem;">
        ${isHost ? '<span class="player-tag tag-host">host</span>' : ''}
        ${isVibe ? '<span class="player-tag tag-vibeman">Vibe Man</span>' : ''}
        ${p.spectator ? '<span class="player-tag" style="background:rgba(245,158,11,0.15);color:#fcd34d;border:1px solid var(--warning);">spectating</span>' : ''}
        ${p.disconnected ? '<span class="player-tag" style="background:rgba(107,114,128,0.15);color:#9ca3af;border:1px solid rgba(107,114,128,0.3);">away</span>' : ''}
        ${s.phase !== 'lobby'
          ? `<span class="player-score">${p.score} pts</span>`
          : ''}
      </div>
    </div>
  `;
}

// -- Toast helper --------------------------------------------
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = msg;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 280);
  }, 3500);
}

// -- Confetti (bullseye celebration) -------------------------
function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORS = ['#a855f7','#10b981','#f59e0b','#ef4444','#3b82f6','#ec4899','#fbbf24'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height * 0.5,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.2,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 4,
  }));

  let alive = true;
  const killTimer = setTimeout(() => { alive = false; }, 3000);

  function frame() {
    if (!alive) { canvas.remove(); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let allGone = true;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.rotSpeed; p.vy += 0.08;
      if (p.y < canvas.height + 20) allGone = false;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (allGone) { clearTimeout(killTimer); canvas.remove(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// -- HTML escaping (XSS prevention) --------------------------
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
