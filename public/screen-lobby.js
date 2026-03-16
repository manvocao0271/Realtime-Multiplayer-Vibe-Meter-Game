// ============================================================
//  SCREEN: Lobby
// ============================================================

function renderLobby() {
  const s = currentState;
  const players = s.players || [];
  const activeCt = players.filter(p => !p.spectator).length;

  return `
    <div class="screen-shell screen-shell-centered fade-in">
      <div class="screen-shell-inner">
        <div class="phase-hero screen-hero-tight">
          <span class="emoji-big">&#128715;</span>
          <h2>Waiting for players...</h2>
          <p>Share this page's URL with your friends to join.</p>
        </div>

        <div class="card lobby-card">
          <div class="invite-link-card">
            <span class="invite-link-label">&#128279; Invite link</span>
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
            <p id="lobby-hint" style="font-size:0.8rem;margin-top:0.5rem;text-align:center;${activeCt >= 2 ? 'display:none;' : ''}">Need at least 2 players.</p>
          ` : `
            <div class="callout callout-info">
              <div class="callout-title"><span class="waiting-pulse"></span> Waiting for host to start...</div>
              <p>The host will start once everyone has joined.</p>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

function patchLobby() {
  const s = currentState;
  const players = s.players || [];
  const activeCt = players.filter(p => !p.spectator).length;

  const sectionTitle = document.querySelector('#app .section-title');
  if (sectionTitle) sectionTitle.textContent = `Players (${activeCt})`;

  const list = document.querySelector('#app .player-list');
  if (list) list.innerHTML = players.map(p => renderPlayerItem(p, s)).join('');

  if (s.isHost) {
    const btn = document.getElementById('start-btn');
    if (btn) {
      btn.disabled = activeCt < 2;
      btn.textContent = activeCt < 2 ? 'Waiting for more players...' : 'Start Game';
    }
    const hint = document.getElementById('lobby-hint');
    if (hint) hint.style.display = activeCt < 2 ? '' : 'none';
  }
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
    playSound('gameStart');
    socket.emit('start', { pointsGoal: selectedGoal });
  });
  const copyBtn = document.getElementById('copy-link-btn');
  copyBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      if (copyBtn) { copyBtn.textContent = 'Copied!'; setTimeout(() => { if (copyBtn) copyBtn.textContent = 'Copy'; }, 2000); }
    });
  });
}
