// ============================================================
//  SCREEN: Guessing (guesser's interactive dial + post-submit)
// ============================================================

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

  card.classList.toggle('mini-dial-submitted', !!submitted);
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

  const dialTicks = Array.from({length: 11}, (_, i) => {
    const angle = Math.PI - (i / 10) * Math.PI;
    const r1 = 116, r2 = 144, cx = 150, cy = 150;
    const x1 = cx + r1 * Math.cos(angle); const y1 = cy - r1 * Math.sin(angle);
    const x2 = cx + r2 * Math.cos(angle); const y2 = cy - r2 * Math.sin(angle);
    return `<line class="dial-tick${i === 0 || i === 10 ? ' dial-tick-end' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`;
  }).join('');

  const dialSVG = `
    <div class="dial-wrap" style="margin:0.5rem 0 0;">
      <svg class="dial-svg" id="dial-svg" viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg"${isWaiting ? '' : ' style="cursor:grab;"'}>
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
        <text x="20" y="190" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="14" fill="#10b981">${label1}</text>
        <text x="280" y="190" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="14" fill="#ef4444">${label2}</text>
      </svg>
      ${isWaiting ? '' : `<div class="dial-readout" id="guess-display">${v}</div>`}
    </div>`;

  // -- Waiting for vibe man to write --
  if (isWaiting) {
    return `
      <div class="fade-in">
        ${renderVibeManBanner(s)}
        ${_tipHTML(_currentRoundTip)}
        <div class="card" style="margin-top:1rem;text-align:center;padding:1.75rem 1.5rem 1.25rem;">
          <div style="font-size:3rem;margin-bottom:0.5rem;">&#128161;</div>
          <h3 style="margin-bottom:1rem;"><span class="waiting-pulse"></span> ${esc(s.vibeManName)} is writing their story...</h3>
          ${dialSVG}
        </div>
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
        <div class="story-box" style="margin-bottom:1rem;">${esc(s.story)}</div>
        <div class="section-title">What number is this vibe?</div>
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

function attachGuessListeners() {
  const s = currentState;

  // -- Waiting state: oscillating dial, no timer --
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

  const CX = 150, CY = 150, R = 130;

  function valueToAngle(val) {
    return Math.PI - ((val - 1) / 99) * Math.PI;
  }

  function angleToValue(angle) {
    const clamped = Math.max(0, Math.min(Math.PI, angle));
    return Math.round(1 + ((Math.PI - clamped) / Math.PI) * 99);
  }

  function updateDial(val) {
    saved.guessValue = val;
    if (display) display.textContent = val;

    const angle = valueToAngle(val);
    const nx = CX + (R - 18) * Math.cos(angle);
    const ny = CY - (R - 18) * Math.sin(angle);
    needle.setAttribute('x2', nx.toFixed(2));
    needle.setAttribute('y2', ny.toFixed(2));

    const ARC_LEN = Math.PI * R;
    const fraction = (val - 1) / 99;
    fill.style.strokeDasharray = ARC_LEN;
    fill.style.strokeDashoffset = ARC_LEN * (1 - fraction);

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
    const scaleY = 170 / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    };
  }

  function handleMove(clientX, clientY) {
    const pt = getSVGPoint(clientX, clientY);
    const dx = pt.x - CX;
    const dy = CY - pt.y;

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
