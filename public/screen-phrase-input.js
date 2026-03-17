// ============================================================
//  SCREEN: Phrase Input
// ============================================================

function renderPhraseInputDialForm() {
  return `
    <div class="card highlight fade-in phrase-input-card">
      <div class="phrase-dial-shell">
        <div class="dial-wrap phrase-dial-wrap">
          <svg class="dial-svg phrase-dial-svg" viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="phraseInputDialGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#10b981" />
                <stop offset="50%" stop-color="#a855f7" />
                <stop offset="100%" stop-color="#ef4444" />
              </linearGradient>
            </defs>
            <path class="dial-track" d="M 20,150 A 130,130 0 0,1 280,150" />
            <path class="dial-fill phrase-dial-fill" d="M 20,150 A 130,130 0 0,1 280,150"
              style="stroke-dasharray:408.41;stroke-dashoffset:0;stroke:url(#phraseInputDialGrad);" />
            ${buildDialTicks()}
            <circle class="phrase-dial-endpoint phrase-dial-endpoint-left" cx="20" cy="150" r="8" />
            <circle class="phrase-dial-endpoint phrase-dial-endpoint-right" cx="280" cy="150" r="8" />
          </svg>

          <div class="phrase-dial-inputs">
            <div class="phrase-dial-input-group phrase-dial-input-left">
              <input type="text" id="label1-input" placeholder='"green flag"'
                     maxlength="20" value="${esc(saved.label1)}" autocomplete="off" aria-label="Left phrase input" />
            </div>
            <div class="phrase-dial-input-group phrase-dial-input-right">
              <input type="text" id="label2-input" placeholder='"red flag"'
                     maxlength="20" value="${esc(saved.label2)}" autocomplete="off" aria-label="Right phrase input" />
            </div>
          </div>
        </div>

        <button class="btn btn-primary btn-full" id="phrase-submit-btn">
          Submit Phrases
        </button>
      </div>
    </div>
  `;
}

// -- Shared phrase-input player card -------------------------
function renderPhraseCard(p, s, done, phrase) {
  const idx = (s.players || []).indexOf(p);
  return `
    <div class="phrase-card ${p.id === s.myId ? 'current' : ''}">
      <div class="player-avatar avatar-${idx % 8}">
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
}

function renderPhraseInput() {
  const s = currentState;
  const activePl = (s.players || []).filter(p => !p.spectator);
  const submitted = s.phraseSubmissions || [];
  const submittedCount = activePl.filter(p => submitted.includes(p.id)).length;
  const total = activePl.length;

  return `
    <div class="fade-in">
    <div class="phase-hero">
      <span class="emoji-big">&#9997;</span>
      <h2>Enter Your Two Phrases</h2>
      <p>Think of two fun polar-opposite phrases that have a wide range.</p>
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
      ${renderPhraseInputDialForm()}
    `}

    <div class="card" style="margin-top:1.5rem;">
      <div class="section-title">All Players (${submittedCount}/${total} submitted)</div>
      <div class="stack-sm">
        ${activePl.map(p => {
          const done = submitted.includes(p.id);
          const phrase = done ? s.phrases.find(ph => ph.byId === p.id) : null;
          return renderPhraseCard(p, s, done, phrase);
        }).join('')}
      </div>
    </div>
    </div>
  `;
}

// Targeted patch — only updates counters and player list,
// without replacing the input form (prevents flicker while typing).
function patchPhraseInput() {
  const s = currentState;
  const activePl = (s.players || []).filter(p => !p.spectator);
  const submitted = s.phraseSubmissions || [];
  const submittedCount = activePl.filter(p => submitted.includes(p.id)).length;
  const total = activePl.length;
  const pct = Math.round(submittedCount / total * 100);

  const waitP = document.querySelector('.callout-success p');
  if (waitP) waitP.textContent = `Waiting for others... (${submittedCount}/${total})`;
  const waitBar = document.querySelector('.callout-success .progress-fill');
  if (waitBar) waitBar.style.width = `${pct}%`;

  const secTitle = document.querySelector('#app .section-title');
  if (secTitle) secTitle.textContent = `All Players (${submittedCount}/${total} submitted)`;

  const stackSm = document.querySelector('#app .stack-sm');
  if (stackSm) {
    stackSm.innerHTML = activePl.map(p => {
      const done = submitted.includes(p.id);
      const phrase = done ? s.phrases.find(ph => ph.byId === p.id) : null;
      return renderPhraseCard(p, s, done, phrase);
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
    playSound('submit');
    socket.emit('phrase', { label1, label2 });
    saved.label1 = '';
    saved.label2 = '';
  };

  btn?.addEventListener('click', submit);
  l2?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}
