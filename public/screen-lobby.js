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
            ${activeCt < 2 ? `<p style="font-size:0.8rem;margin-top:0.5rem;text-align:center;">Need at least 2 players.</p>` : ''}
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
