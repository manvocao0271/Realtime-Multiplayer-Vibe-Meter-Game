// ============================================================
//  SCREEN: Phrase Input
// ============================================================

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
                   maxlength="20" value="${esc(saved.label1)}" autocomplete="off" />
          </div>
          <div class="form-group">
            <label for="label2-input">Phrase 2 &mdash; the 100 end</label>
            <input type="text" id="label2-input" placeholder='e.g. "red flag"'
                   maxlength="20" value="${esc(saved.label2)}" autocomplete="off" />
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
