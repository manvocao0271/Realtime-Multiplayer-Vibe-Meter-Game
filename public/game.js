// ============================================================
//  VIBE METER -- Client
// ============================================================

const socket = io();

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
  const elapsed = Math.max(0, (Date.now() - (deadline - 15000)) / 1000);
  const bar = document.getElementById('guess-timer-bar');
  if (bar) bar.style.animationDelay = `-${elapsed}s`;

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

  const inGame = currentState.phase === 'playing' || currentState.phase === 'game-over' ||
                 (currentState.phase === 'phrase-input' && currentState.players.length > 0);

  if (inGame) {
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
      if (!s.isSpectator && s.roundPhase === 'guessing') {
        playKey = s.isVibeman
          ? 'playing:guessing:vibe-man'
          : `playing:guessing:${s.hasSubmittedGuess ? 'post' : 'pre'}`;
      }
      if (playKey && lastRenderKey === playKey) {
        s.isVibeman ? patchVibeManWaiting() : patchGuesserGuessing();
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

  return `
    <div class="lb-header">Leaderboard</div>
    <div class="lb-list">
      ${ranked.map((p, i) => {
        const isYou = p.id === s.myId;
        return `
          <div class="lb-row ${isYou ? 'lb-you' : ''}">
            <span class="lb-medal">${medalEmoji[i] !== undefined ? medalEmoji[i] : ''}</span>
            <span class="lb-pname">${esc(p.name)}</span>
            <span class="lb-pts">${p.score}</span>
          </div>
        `;
      }).join('')}
    </div>
    ${spectators.length > 0 ? `
      <div class="lb-spectators">
        <div class="lb-spec-title">Spectating</div>
        ${spectators.map(p => `
          <div class="lb-spec-row">
            <span>${esc(p.name)}</span>
            ${(s.isPending && p.id === s.myId)
              ? '<span style="font-size:0.7rem;color:var(--success);">ready next</span>'
              : ''}
          </div>
        `).join('')}
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
  return `
    <div class="phase-hero fade-in" style="padding-top:3rem;">
      <span class="emoji-big">&#127919;</span>
      <h1 class="gradient-text">Vibe Meter</h1>
      <p>The party game where vibes speak louder than words.</p>
    </div>

    <div class="card" style="max-width:420px;margin:1.5rem auto;" id="join-card">
      ${gameInProgress ? `
        <div class="callout callout-warning" style="margin-bottom:1rem;">
          <div class="callout-title">Game in progress</div>
          <p>You will spectate and submit a phrase to join on the next phrase cycle.</p>
        </div>
      ` : ''}
      <div class="form-group">
        <label for="name-input">Your Name</label>
        <input type="text" id="name-input" placeholder="Enter your name..." maxlength="20"
               value="${esc(myName)}" autocomplete="off" autocorrect="off" spellcheck="false" />
      </div>
      <button class="btn btn-primary btn-full btn-lg" id="join-btn" style="margin-top:1rem;">
        ${gameInProgress ? 'Join as Spectator' : 'Join Game'}
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
      <div class="section">
        <div class="section-title">Players (${activeCt})</div>
        <div class="player-list stack-sm">
          ${players.map(p => renderPlayerItem(p, s)).join('')}
        </div>
      </div>

      <hr class="divider" />

      ${s.isHost ? `
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
  document.getElementById('start-btn')?.addEventListener('click', () => {
    socket.emit('start');
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
    attachSpectatorPhraseListeners();
    return;
  }

  switch (s.roundPhase) {
    case 'vibe-writing':
      app.innerHTML = s.isVibeman ? renderVibeManWrite() : renderWaitForVibeman();
      if (s.isVibeman) attachStoryListeners();
      else attachWaitDialAnimation();
      break;
    case 'guessing':
      app.innerHTML = s.isVibeman ? renderVibeManWaiting() : renderGuessing();
      if (!s.isVibeman) attachGuessListeners();
      else startGuessCountdown();
      break;
    case 'round-results':
    case 'phrase-results':
      app.innerHTML = renderResults();
      attachResultsListeners();
      break;
    default:
      app.innerHTML = '<div class="connecting-screen"><div class="spinner"></div></div>';
  }
}

// -- Spectator Screen ----------------------------------------
function renderSpectator() {
  const s = currentState;
  const currentPhrase = s.currentPhrase;

  if (s.spectatorSubmittedPhrase) {
    return `
      <div class="fade-in">
        <div class="card" style="text-align:center;padding:2rem;margin-bottom:1rem;">
          <div style="font-size:2.5rem;margin-bottom:0.5rem;">&#128065;</div>
          <h3>Spectating</h3>
          <p style="margin-top:0.4rem;">Your phrase is queued. You'll join as a full player at the start of the next phrase!</p>
          <div class="callout callout-success" style="margin-top:1rem;text-align:left;">
            <div class="callout-title">Phrase submitted &mdash; you're in the queue</div>
            <p>Sit back and watch. Points start at <strong>0</strong> when you join.</p>
          </div>
        </div>

        <div class="card">
          <div class="section-title">Current Round</div>
          ${renderVibeManBanner(s)}
          ${currentPhrase ? renderPhraseStrip(currentPhrase) : ''}
          ${s.story ? `
            <div class="section-title" style="margin-top:1rem;">Vibe Story</div>
            <div class="story-box">${esc(s.story)}</div>
          ` : `
            <p style="font-size:0.9rem;margin-top:0.5rem;">
              <span class="waiting-pulse"></span> Waiting for ${esc(s.vibeManName)} to write their story...
            </p>
          `}
        </div>
      </div>
    `;
  }

  return `
    <div class="fade-in">
      <div class="phase-hero" style="padding-top:1rem;">
        <span class="emoji-big">&#128065;</span>
        <h2>Spectating Game</h2>
        <p>Submit a phrase pair to join the action on the next phrase cycle!</p>
      </div>

      <div class="card fade-in">
        <div class="section-title">Submit your phrase to join</div>
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
          <button class="btn btn-primary btn-full" id="spectator-phrase-btn">
            Submit &amp; Join Next Round
          </button>
        </div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <div class="section-title">Current Round</div>
        ${renderVibeManBanner(s)}
        ${currentPhrase ? renderPhraseStrip(currentPhrase) : ''}
        ${s.story ? `
          <div class="section-title" style="margin-top:1rem;">Vibe Story</div>
          <div class="story-box">${esc(s.story)}</div>
        ` : `
          <p style="font-size:0.9rem;margin-top:0.5rem;">
            <span class="waiting-pulse"></span> Waiting for ${esc(s.vibeManName)} to write their story...
          </p>
        `}
      </div>
    </div>
  `;
}

function attachSpectatorPhraseListeners() {
  const l1 = document.getElementById('label1-input');
  const l2 = document.getElementById('label2-input');
  const btn = document.getElementById('spectator-phrase-btn');

  l1?.addEventListener('input', () => { saved.label1 = l1.value; });
  l2?.addEventListener('input', () => { saved.label2 = l2.value; });

  btn?.addEventListener('click', () => {
    const label1 = l1?.value.trim();
    const label2 = l2?.value.trim();
    if (!label1 || !label2) return showToast('Both phrases are required.', 'error');
    if (label1.toLowerCase() === label2.toLowerCase()) return showToast('Phrases must be different.', 'error');
    socket.emit('phrase', { label1, label2 });
    saved.label1 = '';
    saved.label2 = '';
  });
}

// Vibe Man banner
function renderVibeManBanner(s) {
  const total = s.totalVibeManSlots;
  const idx   = s.currentVibeManIdx + 1;
  return `
    <div class="row" style="gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
      ${s.isVibeman
        ? '' /* TASK badge moved into the story card */
        : `<span class="badge badge-purple">Vibe Man: ${esc(s.vibeManName)}</span>`
      }
      <span class="badge badge-purple">Round ${idx} / ${total}</span>
      <span class="badge badge-purple">Phrase ${s.currentPhraseIdx + 1} / ${s.phrases.length}</span>
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
function attachWaitDialAnimation() {
  const needle = document.getElementById('wait-needle');
  if (!needle) return;
  const CX = 150, CY = 150, R = 112;
  const T = 4000; // full cycle ms (left → right → left)
  const startTs = performance.now();
  function tick(ts) {
    // Stop if the element has been removed from the DOM (state changed)
    if (!document.getElementById('wait-needle')) return;
    const elapsed = ts - startTs;
    // Cosine oscillation: angle goes π → 0 → π smoothly with natural ease at both ends
    const angle = (Math.PI / 2) * (1 + Math.cos((2 * Math.PI * elapsed) / T));
    needle.setAttribute('x2', (CX + R * Math.cos(angle)).toFixed(2));
    needle.setAttribute('y2', (CY - R * Math.sin(angle)).toFixed(2));
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderWaitForVibeman() {
  const s = currentState;
  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card" style="text-align:center;padding:2rem;">
        <div style="font-size:3rem;margin-bottom:0.75rem;">&#128161;</div>
        <h3><span class="waiting-pulse"></span> Waiting for ${esc(s.vibeManName)} to write their story...</h3>
        <p style="margin-top:0.5rem;">The Vibe Man has a secret number and is crafting a vibe story.</p>
      </div>

      <div class="card" style="margin-top:1rem;">
        <div class="dial-wrap" style="margin:0.5rem 0 0;">
          <svg class="dial-svg" viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="dialGradWait" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#10b981" />
                <stop offset="50%"  stop-color="#a855f7" />
                <stop offset="100%" stop-color="#ef4444" />
              </linearGradient>
            </defs>
            <path class="dial-track" d="M 20,150 A 130,130 0 0,1 280,150" />
            <path class="dial-fill" d="M 20,150 A 130,130 0 0,1 280,150"
              style="stroke-dasharray:408.41;stroke-dashoffset:0;stroke:url(#dialGradWait);" />
            <line class="dial-needle" id="wait-needle" x1="150" y1="150" x2="38" y2="150" />
            <circle class="dial-pivot" cx="150" cy="150" r="10" />
          </svg>
          <div class="dial-labels">
            <div class="dial-label-left">
              <span class="dial-label-num">1</span>
              <span class="phrase-label-1">${esc(s.currentPhrase?.label1 || '')}</span>
            </div>
            <div class="dial-label-right">
              <span class="dial-label-num">100</span>
              <span class="phrase-label-2">${esc(s.currentPhrase?.label2 || '')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// -- Vibe Man: Waiting for Guesses ---------------------------

// Update a single mini-dial in the grid without re-rendering the whole page
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
  const card = document.getElementById(`mini-dial-${CSS.escape(playerId)}`);
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
  const guessers = (s.players || []).filter(p => !p.spectator && p.id !== vibeManId);
  const knownMap = {};
  (s.liveGuesses || []).forEach(g => { knownMap[g.id] = g; });

  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card highlight" style="padding:0.75rem 1rem 0.5rem;margin-bottom:1rem;text-align:center;">
        <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-dim);margin-bottom:0.2rem;">Your Secret Number</div>
        <div class="big-number" style="font-size:3.5rem;">${s.randomValue}</div>
      </div>

      <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;margin-bottom:1rem;">
        <p id="guess-timer-secs" style="font-size:0.9rem;margin-bottom:0.6rem;">15 seconds...</p>
        <div class="countdown-bar-wrap">
          <div class="countdown-bar-15" id="guess-timer-bar"></div>
        </div>
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

      <div class="card">
        <div class="section-title">Your Story</div>
        <div class="story-box">${esc(s.story)}</div>
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
  const v = saved.guessValue;

  if (s.hasSubmittedGuess) {
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

        <div class="card" style="margin-top:1rem;">
          <div class="story-box">${esc(s.story)}</div>
        </div>

        ${(() => {
          const otherGuessers = (s.players || []).filter(p => !p.spectator && p.id !== s.vibeManId && p.id !== s.myId);
          if (otherGuessers.length === 0) return '';
          const knownMap = {};
          (s.liveGuesses || []).forEach(g => { knownMap[g.id] = g; });
          const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
          const cols = otherGuessers.length === 1 ? 1 : otherGuessers.length <= 4 ? 2 : otherGuessers.length <= 9 ? 3 : 4;
          return `
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
            </div>
          `;
        })()}
      </div>
    `;
  }

  const label1 = esc(s.currentPhrase?.label1 || '');
  const label2 = esc(s.currentPhrase?.label2 || '');

  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card" style="margin-bottom:1rem;">
        <div class="section-title">The Vibe Story from ${esc(s.vibeManName)}</div>
        <div class="story-box">${esc(s.story)}</div>
      </div>

      <div class="card highlight">
        <div class="section-title">What number is this vibe?</div>

        <div class="dial-wrap">
          <svg class="dial-svg" id="dial-svg" viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="dialGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#10b981" />
                <stop offset="50%"  stop-color="#a855f7" />
                <stop offset="100%" stop-color="#ef4444" />
              </linearGradient>
            </defs>
            <!-- Track arc background -->
            <path class="dial-track" d="M 20,150 A 130,130 0 0,1 280,150" />
            <!-- Filled arc: same path as track, revealed via stroke-dashoffset -->
            <path class="dial-fill" id="dial-fill" d="M 20,150 A 130,130 0 0,1 280,150" />
            <!-- Tick marks -->
            ${Array.from({length: 11}, (_, i) => {
              const angle = Math.PI - (i / 10) * Math.PI;
              const r1 = 116, r2 = 144, cx = 150, cy = 150;
              const x1 = cx + r1 * Math.cos(angle);
              const y1 = cy - r1 * Math.sin(angle);
              const x2 = cx + r2 * Math.cos(angle);
              const y2 = cy - r2 * Math.sin(angle);
              return `<line class="dial-tick${i === 0 || i === 10 ? ' dial-tick-end' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`;
            }).join('')}
            <!-- Needle -->
            <line class="dial-needle" id="dial-needle" x1="150" y1="150" x2="20" y2="150" />
            <!-- Center pivot -->
            <circle class="dial-pivot" cx="150" cy="150" r="10" />
            <!-- Drag target (invisible large circle for easy grab) -->
            <circle id="dial-hit" cx="150" cy="150" r="140" fill="transparent" style="cursor:grab;" />
          </svg>

          <!-- Value readout -->
          <div class="dial-readout" id="guess-display">${v}</div>

          <!-- Phrase labels at the ends -->
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
        </div>

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

    </div>
  `;
}

function attachGuessListeners() {
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
    const dy = CY - pt.y;  // flip y so up = positive
    // Only respond in the upper hemisphere (dy >= -30 allows slight below-center drag)
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
    if (dragging) { dragging = false; svg.style.cursor = ''; }
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
  const s = currentState;
  const isPhraseEnd = s.roundPhase === 'phrase-results';
  const phrase = s.currentPhrase;
  const results = s.roundResults || [];

  const markerHtml = results.map((r) => {
    const cls = r.pts === 3 ? 'perfect' : r.pts === 2 ? 'good' : r.pts === 1 ? 'ok' : 'miss';
    const pct = ((r.guess - 1) / 99) * 100;
    return `
      <div class="meter-marker ${cls}" style="left:${pct}%;" title="${esc(r.name)}: ${r.guess}">
        <div class="meter-marker-label">${esc(r.name.split(' ')[0])}</div>
        ${r.name.slice(0, 2).toUpperCase()}
      </div>
    `;
  }).join('');

  const actualPct = ((s.randomValue - 1) / 99) * 100;
  const actualMarker = `
    <div class="meter-marker actual" style="left:${actualPct}%;" title="Answer: ${s.randomValue}">
      <div class="meter-marker-label">Answer</div>
      ${s.randomValue}
    </div>
  `;

  const anyPerfect = results.some(r => r.pts === 3);

  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card ${anyPerfect ? 'success' : ''}" style="text-align:center;padding:1.5rem;margin-bottom:1rem;">
        ${anyPerfect
          ? `<div style="font-size:2.5rem;margin-bottom:0.25rem;">&#127881;</div><h3>Someone nailed it!</h3>`
          : isPhraseEnd
            ? `<div style="font-size:2.5rem;margin-bottom:0.25rem;">&#128202;</div><h3>Phrase Complete</h3>`
            : `<div style="font-size:2.5rem;margin-bottom:0.25rem;">&#128517;</div><h3>Nobody hit the bullseye this round!</h3>`
        }
        <p style="margin-top:0.3rem;">
          The secret number was <strong style="color:var(--text);font-size:1.1em;">${s.randomValue}</strong>
        </p>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <div class="section-title">Where everyone landed</div>
        <div class="meter-wrap" style="padding-bottom:1.5rem;">
          <div class="meter-labels">
            <div>
              <div class="meter-label-num">1</div>
              <div class="phrase-label-1">${esc(phrase?.label1 || '')}</div>
            </div>
            <div style="text-align:right;">
              <div class="meter-label-num">100</div>
              <div class="phrase-label-2">${esc(phrase?.label2 || '')}</div>
            </div>
          </div>
          <div class="meter-bar" style="height:24px;overflow:visible;margin-top:2rem;">
            ${markerHtml}
            ${actualMarker}
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <div class="section-title">The Vibe Story by ${esc(s.vibeManName)}</div>
        <div class="story-box">${esc(s.story)}</div>
      </div>

      <div class="card" style="margin-bottom:1.5rem;">
        <div class="section-title">This Round's Scores</div>
        <div class="stack-sm">
          ${results.map(r => `
            <div class="result-row pts-${r.pts}">
              <div class="result-pts pts-${r.pts}">
                ${r.pts > 0 ? '+' + r.pts : '--'}
              </div>
              <div class="player-avatar avatar-${(s.players.findIndex(p => p.id === r.id)) % 8}">
                ${esc(r.name[0].toUpperCase())}
              </div>
              <div style="flex:1;">
                <div class="result-name">${esc(r.name)}</div>
                <div class="result-diff">Guessed ${r.guess} &middot; off by ${r.diff}</div>
              </div>
              <div style="font-size:0.8rem;color:var(--text-dim);">
                ${r.diff <= 3 ? 'Bullseye!' : r.diff <= 4 ? 'Close!' : r.diff <= 5 ? 'Nearly!' : 'Miss'}
              </div>
            </div>
          `).join('')}
          ${s.vibeManPts != null ? (() => {
            const vmPts = s.vibeManPts;
            const vmIdx = s.players.findIndex(p => p.id === s.vibeManId);
            const avgDiff = results.length > 0
              ? (results.reduce((sum, r) => sum + r.diff, 0) / results.length).toFixed(1)
              : '–';
            const label = vmPts === 3 ? 'Story on point!' : vmPts === 2 ? 'Great story!' : vmPts === 1 ? 'Decent hint!' : 'Misleading...';
            return `
            <div class="result-row pts-${vmPts}" style="border-top:1px solid rgba(255,255,255,0.07);margin-top:0.25rem;padding-top:0.5rem;">
              <div class="result-pts pts-${vmPts}">
                ${vmPts > 0 ? '+' + vmPts : '--'}
              </div>
              <div class="player-avatar avatar-${vmIdx % 8}">
                ${esc(s.vibeManName[0].toUpperCase())}
              </div>
              <div style="flex:1;">
                <div class="result-name">${esc(s.vibeManName)} <span style="font-size:0.75rem;opacity:0.6;">(Vibe Man)</span></div>
                <div class="result-diff">Avg guess off by ${avgDiff}</div>
              </div>
              <div style="font-size:0.8rem;color:var(--text-dim);">${label}</div>
            </div>`;
          })() : ''}
        </div>
      </div>

      <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;">
        <p style="font-size:0.9rem;margin-bottom:0.6rem;">
          ${isPhraseEnd
            ? (s.currentPhraseIdx + 1 >= s.phrases.length ? 'Showing final results&hellip;' : 'Next phrase starting&hellip;')
            : 'Next round starting&hellip;'
          }
        </p>
        <div class="countdown-bar-wrap">
          <div class="countdown-bar"></div>
        </div>
      </div>
    </div>
  `;
}

function attachResultsListeners() {
  // Rounds auto-advance on the server — nothing to attach.
}

// -- Game Over -----------------------------------------------
function renderGameOver() {
  const s = currentState;
  const ranked = [...s.players].filter(p => !p.spectator).sort((a, b) => b.score - a.score);
  const medalEmoji = ['&#x1F947;', '&#x1F948;', '&#x1F949;'];

  return `
    <div class="fade-in">
      <div class="phase-hero">
        <span class="emoji-big">&#x1F3C6;</span>
        <h2 class="gradient-text">Game Over!</h2>
        <p>Here are the final standings.</p>
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
    <div class="player-item ${isYou ? 'you' : ''} ${isVibe ? 'vibeman' : ''}">
      <div class="player-avatar avatar-${idx % 8}">
        ${esc(p.name[0].toUpperCase())}
      </div>
      <div class="player-name">${esc(p.name)}</div>
      <div style="display:flex;align-items:center;gap:0.4rem;">
        ${isHost ? '<span class="player-tag tag-host">host</span>' : ''}
        ${isVibe ? '<span class="player-tag tag-vibeman">Vibe Man</span>' : ''}
        ${p.spectator ? '<span class="player-tag" style="background:rgba(245,158,11,0.15);color:#fcd34d;border:1px solid var(--warning);">spectating</span>' : ''}
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
