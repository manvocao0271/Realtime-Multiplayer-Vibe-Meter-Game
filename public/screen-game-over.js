// ============================================================
//  SCREEN: Game Over
// ============================================================

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
      playSound('click');
      socket.emit('restart');
    }
  });
}
