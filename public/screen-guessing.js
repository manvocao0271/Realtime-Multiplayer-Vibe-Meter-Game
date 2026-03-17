// ============================================================
//  SCREEN: Guessing (guesser's interactive dial + post-submit)
// ============================================================

let _waitingAnimCancel = false;

// -- Mini-dial card (shared by vibe-man waiting + post-submit) --
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

  const wasSubmitted = card.classList.contains('mini-dial-submitted');
  card.classList.toggle('mini-dial-submitted', !!submitted);
  if (submitted && !wasSubmitted) playSound('playerLock');
  card.classList.toggle('mini-dial-waiting', value == null);
}

// -- Patch for in-place updates ------------------------------
function patchGuesserGuessing() {
  const s = currentState;
  const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
  const countEl = document.getElementById('guesser-guess-count');
  if (countEl) countEl.textContent = `${s.guessCount} / ${s.totalGuessers}`;
  const progressEl = document.getElementById('guesser-guess-progress');
  if (progressEl) progressEl.style.width = `${pct}%`;
  const waitingEl = document.getElementById('guesser-waiting-text');
  if (waitingEl) waitingEl.innerHTML = `<span class="waiting-pulse"></span> Waiting for ${s.totalGuessers - s.guessCount} more player(s)...`;
  (s.liveGuesses || []).forEach(g => {
    if (g.id !== s.myId) updateMiniDial(g.id, g.value, g.submitted);
  });
}

// -- Main render function ------------------------------------
function renderGuessing() {
  const s = currentState;
  const isWaiting  = s.roundPhase === 'vibe-writing';
  const hasGuessed = s.hasSubmittedGuess;
  if (!_currentRoundTip) _currentRoundTip = _nextTipFromDeck();

  const label1 = esc((s.currentPhrase?.label1 || '').slice(0, 20));
  const label2 = esc((s.currentPhrase?.label2 || '').slice(0, 20));
  const v = saved.guessValue;

  const dialSVG = renderMainDial({
    value: v,
    label1,
    label2,
    interactive: !isWaiting,
    showReadout: !isWaiting,
    wrapStyle: 'margin-top:1rem;',
  });

  // -- Waiting for vibe man to write --
  if (isWaiting) {
    return `
      <div class="fade-in" data-screen="vibe-waiting">
        ${renderVibeManBanner(s)}
        ${_tipHTML(_currentRoundTip)}
        <div class="card highlight" style="margin-top:1rem;">
          <div class="waiting-story-slot" style="text-align:center;">
            <div style="font-size:2.5rem;margin-bottom:0.4rem;">&#128161;</div>
            <h3><span class="waiting-pulse"></span> ${esc(s.vibeManName)} is writing their story...</h3>
          </div>
          ${dialSVG}
        </div>
      </div>`;
  }

  // -- Guess submitted, waiting for others --
  if (hasGuessed) {
    const otherGuessers = (s.players || []).filter(p => !p.spectator && p.id !== s.vibeManId && p.id !== s.myId);
    let miniDialsHtml = '';
    if (otherGuessers.length > 0) {
      const knownMap = buildKnownMap(s.liveGuesses);
      const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
      miniDialsHtml = `
        <div class="card" style="margin-top:1rem;">
          <div class="row-between" style="margin-bottom:0.6rem;">
            <div class="section-title" style="margin:0;">Others' Guesses</div>
            <span id="guesser-guess-count" style="font-weight:700;">${s.guessCount} / ${s.totalGuessers}</span>
          </div>
          <div class="progress-bar" style="margin-bottom:1rem;">
            <div id="guesser-guess-progress" class="progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="mini-dial-grid" style="--mini-cols:${miniColCount(otherGuessers.length)};">
            ${otherGuessers.map(p => renderMiniDialCard(p, knownMap)).join('')}
          </div>
        </div>`;
    }
    return `
      <div class="fade-in">
        ${renderVibeManBanner(s)}
        ${_tipHTML(_currentRoundTip)}
        <div class="card highlight" style="margin-top:1rem;">
          <div style="text-align:center;margin-bottom:0;">
            <div style="font-size:2.5rem;margin-bottom:0.5rem;">&#10003;</div>
            <h3>Guess locked in: <span class="gradient-text">${s.myGuess}</span></h3>
            <p id="guesser-waiting-text" style="margin-top:0.35rem;"><span class="waiting-pulse"></span> Waiting for ${s.totalGuessers - s.guessCount} more player(s)...</p>
          </div>
        </div>
        <div class="card" style="margin-top:1rem;">
          <div class="section-title" style="margin-bottom:0.5rem;">The Vibe Story from ${esc(s.vibeManName)}</div>
          <div class="story-box">${esc(s.story)}</div>
        </div>
        ${miniDialsHtml}
        <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;margin-top:1rem;margin-bottom:0;">
          <p id="guess-timer-secs" style="font-size:0.9rem;margin-bottom:0.6rem;">15 seconds...</p>
          <div class="countdown-bar-wrap">
            <div class="countdown-bar-15" id="guess-timer-bar"></div>
          </div>
        </div>
      </div>`;
  }

  // -- Pre-submit: story + interactive dial --
  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}
      ${_tipHTML(_currentRoundTip)}
      <div class="card highlight" style="margin-top:1rem;">
        <div class="section-title">The Vibe Story from ${esc(s.vibeManName)}</div>
        <div class="story-box" style="margin-top:0.5rem;">${esc(s.story)}</div>
        ${dialSVG}
        <button class="btn btn-success btn-full btn-lg" id="guess-submit-btn" style="margin-top:1rem;">
          Lock In My Guess
        </button>
      </div>
      <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;margin-top:1rem;margin-bottom:1rem;">
        <p id="guess-timer-secs" style="font-size:0.9rem;margin-bottom:0.6rem;">15 seconds...</p>
        <div class="countdown-bar-wrap">
          <div class="countdown-bar-15" id="guess-timer-bar"></div>
        </div>
      </div>
    </div>`;
}

function patchVibeWritingToGuessing() {
  const s = currentState;
  const app = document.getElementById('app');
  if (!app) return;

  _waitingAnimCancel = true;

  const outer = app.querySelector('[data-screen="vibe-waiting"]');
  if (outer) outer.removeAttribute('data-screen');

  // Find the main card (the one that contains the dial)
  const card = app.querySelector('#dial-svg')?.closest('.card');
  if (!card) { renderPlaying(app); return; }

  // Replace waiting message with story content (same slot at top of card)
  const storySlot = card.querySelector('.waiting-story-slot');
  if (storySlot) {
    storySlot.insertAdjacentHTML('beforebegin', `
      <div class="section-title">The Vibe Story from ${esc(s.vibeManName)}</div>
      <div class="story-box" style="margin-top:0.5rem;">${esc(s.story)}</div>
    `);
    storySlot.remove();
  }

  // Inject readout into dial-wrap
  const dialWrap = card.querySelector('.dial-wrap');
  if (dialWrap) {
    dialWrap.insertAdjacentHTML('beforeend',
      `<div class="dial-readout" id="guess-display">${saved.guessValue}</div>`);
  }

  // Make SVG interactive cursor
  const svg = app.querySelector('#dial-svg');
  if (svg) svg.style.cursor = 'grab';

  // Add submit button after dial-wrap
  dialWrap?.insertAdjacentHTML('afterend', `
    <button class="btn btn-success btn-full btn-lg" id="guess-submit-btn" style="margin-top:1rem;">
      Lock In My Guess
    </button>
  `);

  // Add countdown callout after the card
  card.insertAdjacentHTML('afterend', `
    <div class="callout callout-info" style="text-align:center;padding:0.85rem 1rem;margin-top:1rem;margin-bottom:1rem;">
      <p id="guess-timer-secs" style="font-size:0.9rem;margin-bottom:0.6rem;">15 seconds...</p>
      <div class="countdown-bar-wrap">
        <div class="countdown-bar-15" id="guess-timer-bar"></div>
      </div>
    </div>
  `);

  // Start interactive dial and countdown
  attachGuessListeners();
}

function attachGuessListeners() {
  const s = currentState;
  const needle = document.getElementById('dial-needle');
  const fill = document.getElementById('dial-fill');
  const display = document.getElementById('guess-display');

  // -- Waiting state: oscillating dial, no timer --
  if (s.roundPhase === 'vibe-writing') {
    if (!needle) return;
    const T = 4000;
    const startTs = performance.now();
    _waitingAnimCancel = false;

    function tick(ts) {
      if (_waitingAnimCancel || !document.getElementById('dial-needle')) return;
      const elapsed = ts - startTs;
      const sweep = (1 - Math.cos((2 * Math.PI * elapsed) / T)) / 2;
      const value = Math.round(1 + sweep * 99);
      setMainDialValue(value, { needle, fill, display });
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
    return;
  }

  // -- Guessing state: interactive dial --
  startGuessCountdown();
  const svg     = document.getElementById('dial-svg');
  const btn     = document.getElementById('guess-submit-btn');
  if (!svg || !needle || !btn) return;

  function updateDial(val) {
    saved.guessValue = setMainDialValue(val, { needle, fill, display });

    if (!updateDial._t) {
      updateDial._t = setTimeout(() => {
        socket.emit('live-pos', { value: saved.guessValue });
        updateDial._t = null;
      }, 40);
    }
  }

  updateDial(saved.guessValue);

  function getSVGPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const scaleX = 300 / rect.width;
    const scaleY = 200 / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    };
  }

  function handleMove(clientX, clientY) {
    const pt = getSVGPoint(clientX, clientY);
    const dx = pt.x - MAIN_DIAL.cx;
    const dy = MAIN_DIAL.cy - pt.y;

    if (dy < 0) {
      updateDial(dx < 0 ? 1 : 100);
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clamped = Math.max(0, Math.min(Math.PI, angle));
    updateDial(angleToDialValue(clamped));
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
    playSound('lockIn');
    socket.emit('guess', { value: saved.guessValue });
  });
}
