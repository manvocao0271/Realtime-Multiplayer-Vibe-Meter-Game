// ============================================================
//  LEADERBOARD SIDEBAR
// ============================================================

function renderLeaderboard() {
  const s = currentState;
  if (!s) return '';
  const sorted = [...s.players]
    .filter(p => !p.spectator)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const spectators = s.players.filter(p => p.spectator);

  const medalEmoji = ['&#x1F947;', '&#x1F948;', '&#x1F949;'];

  // Build a pts-this-round map for the results phase
  const deltaMap = {};
  if (s.roundPhase === 'round-results') {
    (s.roundResults || []).forEach(r => { deltaMap[r.id] = r.pts; });
    if (s.vibeManId != null && s.vibeManPts != null) deltaMap[s.vibeManId] = s.vibeManPts;
  }

  // Group players by score for dense ranking; players within each group sorted by name
  const groups = [];
  for (const p of sorted) {
    if (groups.length === 0 || p.score !== groups[groups.length - 1].score) {
      groups.push({ score: p.score, players: [] });
    }
    groups[groups.length - 1].players.push(p);
  }

  const listRows = groups.map((group, gi) => {
    const medal = gi < 3 ? medalEmoji[gi] : '';
    const isTied = group.players.length > 1;

    const entries = group.players.map((p) => {
      const isYou = p.id === s.myId;
      const bulls = p.bullseyes || 0;
      const delta = deltaMap[p.id];
      return `
        <div class="lb-row ${isYou ? 'lb-you' : ''} ${p.disconnected ? 'lb-disconnected' : ''}">
          <span class="lb-streak-inline">${bulls > 0 ? `${bulls}x&#127919;` : ''}</span>
          <span class="lb-medal">${medal}</span>
          <span class="lb-pname">${esc(p.name)}${p.disconnected ? ' <span class="lb-away">(away)</span>' : ''}</span>
          <span class="lb-pts">${p.score}</span>
          <span class="lb-delta-inline">${delta != null && delta > 0 ? `+${delta}` : ''}</span>
        </div>
      `;
    }).join('');

    return isTied ? `<div class="lb-tie-group">${entries}</div>` : entries;
  }).join('');

  return `
    <div class="lb-header">
      Leaderboard
      ${s.pointsGoal ? `<span style="font-size:0.7rem;color:var(--text-dim);font-weight:400;display:block;margin-top:0.1rem;">First to ${s.pointsGoal} pts wins</span>` : ''}
    </div>
    <div class="lb-list">
      ${listRows}
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
    ${renderPhraseSuggestionsPanel()}
  `;
}

function renderPhraseSuggestionsPanel() {
  const s = currentState;
  if (!s || s.phase !== 'playing') return '';

  const suggestions = s.phraseSuggestions || [];

  return `
    <div class="sp-panel">
      <div class="sp-title" style="text-align: center;">Next-Round Phrase Suggestions</div>

      <div class="sp-popover-wrapper">
        <button class="btn btn-secondary btn-full sp-trigger" id="sp-popover-trigger">+</button>
        <div class="sp-popover" id="sp-popover" hidden>
          <div id="sp-popover-form">
            <div class="sp-popover-header">Suggest opposite phrases</div>
            <input type="text" id="sp-label1" maxlength="20" placeholder="Left phrase" autocomplete="off" />
            <input type="text" id="sp-label2" maxlength="20" placeholder="Right phrase" autocomplete="off" />
            <div class="sp-popover-footer">
              <button class="btn btn-secondary sp-popover-submit" id="sp-submit-btn">Suggest</button>
            </div>
          </div>
          <div class="sp-popover-ok" id="sp-popover-ok" hidden>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M27.6 16C27.6 22.4 22.4 27.6 16 27.6C9.6 27.6 4.4 22.4 4.4 16C4.4 9.6 9.6 4.4 16 4.4C22.4 4.4 27.6 9.6 27.6 16Z" fill="rgba(32,144,255,0.16)"/>
              <path d="M12.1 16.97L15 19.87L19.87 13.1M27.6 16C27.6 22.4 22.4 27.6 16 27.6C9.6 27.6 4.4 22.4 4.4 16C4.4 9.6 9.6 4.4 16 4.4C22.4 4.4 27.6 9.6 27.6 16Z" stroke="#2090FF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="sp-popover-ok-title">Suggested!</div>
            <div class="sp-popover-ok-sub">Your pair has been added.</div>
          </div>
        </div>
      </div>

      ${suggestions.length === 0 ? '' : `<div class="sp-list">
            ${suggestions.map(sg => {
              const yesActive = sg.myVote === 'yes' ? 'active' : '';
              const noActive = sg.myVote === 'no' ? 'active' : '';
              return `
                <div class="sp-item" data-suggestion-id="${sg.id}">
                  <div class="sp-pair">
                    <span class="sp-label-1">${esc(sg.label1)}</span>
                    <span class="sp-vs">vs</span>
                    <span class="sp-label-2">${esc(sg.label2)}</span>
                  </div>
                  <div class="sp-meta">by ${esc(sg.byName)} <span class="sp-counts">• ✓ ${sg.yesVotes} • ✗ ${sg.noVotes} • voters ${sg.totalVoters}</span></div>
                  <div class="sp-votes">
                    <button class="btn sp-vote-btn yes ${yesActive}" data-suggestion-id="${sg.id}" data-vote="yes">✓</button>
                    <button class="btn sp-vote-btn no ${noActive}" data-suggestion-id="${sg.id}" data-vote="no">✗</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>`
      }
    </div>
  `;
}

function patchSidebar() {
  const s = currentState;
  if (!s) return;
  const sidebar = document.getElementById('leaderboard-sidebar');
  if (!sidebar) return;

  // Render into a temp element then surgically swap non-input sections
  const tmp = document.createElement('div');
  tmp.innerHTML = renderLeaderboard();

  // Swap leaderboard rows
  const destList = sidebar.querySelector('.lb-list');
  const srcList  = tmp.querySelector('.lb-list');
  if (destList && srcList) destList.innerHTML = srcList.innerHTML;

  // Swap spectators section (may appear or disappear)
  const destSpec = sidebar.querySelector('.lb-spectators');
  const srcSpec  = tmp.querySelector('.lb-spectators');
  if (srcSpec && destSpec)       destSpec.innerHTML = srcSpec.innerHTML;
  else if (srcSpec && !destSpec) sidebar.querySelector('.lb-list')?.insertAdjacentHTML('afterend', srcSpec.outerHTML);
  else if (!srcSpec && destSpec) destSpec.remove();

  // Swap suggestion votes only — the popover wrapper is preserved untouched
  const destPanel = sidebar.querySelector('.sp-panel');
  const srcPanel  = tmp.querySelector('.sp-panel');
  if (destPanel && srcPanel) {
    const destSpList = destPanel.querySelector('.sp-list');
    const srcSpList  = srcPanel.querySelector('.sp-list');
    if (destSpList) destSpList.remove();
    if (srcSpList)  destPanel.appendChild(srcSpList);
    // Re-attach vote listeners on the freshly inserted nodes
    destPanel.querySelectorAll('.sp-vote-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const suggestionId = Number(btn.dataset.suggestionId);
        const vote = btn.dataset.vote;
        if (!suggestionId || (vote !== 'yes' && vote !== 'no')) return;
        socket.emit('vote-suggested-phrase', { suggestionId, vote });
      });
    });
  }
}

let _spListenerCleanup = null;

function attachSidebarListeners() {
  const s = currentState;
  if (!s || s.phase !== 'playing') return;

  // Remove any stale doc-level listeners from a previous render
  if (_spListenerCleanup) { _spListenerCleanup(); _spListenerCleanup = null; }

  const trigger = document.getElementById('sp-popover-trigger');
  const popover = document.getElementById('sp-popover');
  const formEl  = document.getElementById('sp-popover-form');
  const okEl    = document.getElementById('sp-popover-ok');
  const label1  = document.getElementById('sp-label1');
  const label2  = document.getElementById('sp-label2');
  const submit  = document.getElementById('sp-submit-btn');

  function closePopover() {
    popover?.setAttribute('hidden', '');
    formEl?.removeAttribute('hidden');
    okEl?.setAttribute('hidden', '');
    if (_spListenerCleanup) { _spListenerCleanup(); _spListenerCleanup = null; }
  }

  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover && !popover.hasAttribute('hidden')) {
      closePopover();
      return;
    }
    // Position the popover as fixed, aligned to the trigger button
    const rect = trigger.getBoundingClientRect();
    popover.style.width = rect.width + 'px';
    popover.style.left   = rect.left + 'px';
    popover.style.top    = (rect.bottom + 6) + 'px';
    popover.style.bottom = '';

    formEl?.removeAttribute('hidden');
    okEl?.setAttribute('hidden', '');
    popover.removeAttribute('hidden');
    label1?.focus();

    const onDocClick = () => closePopover();
    const onEsc = (ev) => { if (ev.key === 'Escape') closePopover(); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onEsc);
    _spListenerCleanup = () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  });

  // Clicks inside the popover must not bubble up to doc and close it
  popover?.addEventListener('click', (e) => e.stopPropagation());

  submit?.addEventListener('click', () => {
    const l1 = (label1?.value || '').trim().slice(0, 20);
    const l2 = (label2?.value || '').trim().slice(0, 20);
    if (!l1 || !l2) return showToast('Enter both opposite phrases.', 'error');
    playSound('submit');
    socket.emit('suggest-phrase', { label1: l1, label2: l2 });
    label1.value = '';
    label2.value = '';
    formEl?.setAttribute('hidden', '');
    okEl?.removeAttribute('hidden');
    setTimeout(() => closePopover(), 1800);
  });

  document.querySelectorAll('.sp-vote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const suggestionId = Number(btn.dataset.suggestionId);
      const vote = btn.dataset.vote;
      if (!suggestionId || (vote !== 'yes' && vote !== 'no')) return;
      socket.emit('vote-suggested-phrase', { suggestionId, vote });
    });
  });
}
