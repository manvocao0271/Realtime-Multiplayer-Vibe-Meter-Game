// ============================================================
//  SCREEN: Vibe Man (phrase select + story writing + waiting)
// ============================================================

// -- Shared banner + phrase strip ----------------------------
function renderVibeManBanner(s) {
  return `
    <div class="row" style="gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
      ${s.isVibeman
        ? ''
        : `<span class="badge badge-purple">Vibe Man: ${esc(s.vibeManName)}</span>`
      }
      <span class="badge badge-purple">Round ${s.roundNumber}</span>
    </div>
  `;
}

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

// -- Phrase Select -------------------------------------------
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
      playSound('submit');
      socket.emit('select-phrase', { phraseId: Number(btn.dataset.phraseId) });
    });
  });
}

// -- Story Writing -------------------------------------------
function renderVibeManWrite() {
  const s = currentState;
  const { currentPhrase, randomValue } = s;

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
            <text x="20" y="190" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="15" fill="#10b981">${esc((currentPhrase?.label1 || '').slice(0,20))}</text>
            <text x="280" y="190" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="15" fill="#ef4444">${esc((currentPhrase?.label2 || '').slice(0,20))}</text>
          </svg>
          <div class="dial-readout" style="margin-top:0.25rem;">${randomValue}</div>
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
    playSound('submit');
    socket.emit('story', { story });
    saved.story = '';
  });
}

// -- Waiting for Guesses -------------------------------------
function renderVibeManWaiting() {
  const s = currentState;
  const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
  const vibeManId = s.vibeManId;
  const guessers = (s.players || []).filter(p => !p.spectator && !p.disconnected && p.id !== vibeManId);
  const knownMap = buildKnownMap(s.liveGuesses);

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
        <div class="mini-dial-grid" style="--mini-cols:${miniColCount(guessers.length)};">
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

function patchVibeManWaiting() {
  const s = currentState;
  const pct = s.totalGuessers > 0 ? Math.round((s.guessCount / s.totalGuessers) * 100) : 0;
  const countEl = document.getElementById('vm-guess-count');
  if (countEl) countEl.textContent = `${s.guessCount} / ${s.totalGuessers}`;
  const progressEl = document.getElementById('vm-guess-progress');
  if (progressEl) progressEl.style.width = `${pct}%`;
  (s.liveGuesses || []).forEach(g => updateMiniDial(g.id, g.value, g.submitted));
}
