// ============================================================
//  SCREEN: Spectator
// ============================================================

function renderSpectator() {
  const s = currentState;
  const currentPhrase = s.currentPhrase;
  const gameStarted = s.phase === 'playing';

  return `
    <div class="fade-in">
      <div class="card" style="margin-bottom:1rem;">
        <div style="display:flex;align-items:center;gap:0.75rem;${s.isPending ? 'margin-bottom:0.75rem;' : 'margin-bottom:0.5rem;'}">
          <span style="font-size:2rem;">&#128065;</span>
          <div>
            <h3 style="margin:0;">Spectating</h3>
            <p style="margin:0;font-size:0.85rem;">Watching this round.</p>
          </div>
        </div>
        ${s.isPending ? `
          <div class="callout callout-success">
            <div class="callout-title">&#10003; You're in for next round!</div>
            <p>You'll be a full player starting on the next round.</p>
          </div>
        ` : `
          <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
            <p style="margin:0;flex:1;font-size:0.85rem;min-width:0;">Watch the action &mdash; jump in whenever you're ready.</p>
            <button class="btn btn-primary" id="join-next-round-btn" style="flex-shrink:0;">Join Next Round</button>
          </div>
        `}
      </div>

      ${gameStarted ? `
        <div class="card">
          <div class="section-title">Round ${s.roundNumber}</div>
          ${renderVibeManBanner(s)}
          ${currentPhrase ? renderPhraseStrip(currentPhrase) : ''}
          ${s.story ? `
            <div class="section-title" style="margin-top:1rem;">The Vibe Story</div>
            <div class="story-box">${esc(s.story)}</div>
          ` : s.roundPhase === 'phrase-select' ? `
            <p style="font-size:0.85rem;margin-top:0.5rem;color:var(--text-muted);">
              <span class="waiting-pulse"></span> ${esc(s.vibeManName)} is choosing a phrase&hellip;
            </p>
          ` : s.vibeManName ? `
            <p style="font-size:0.85rem;margin-top:0.5rem;color:var(--text-muted);">
              <span class="waiting-pulse"></span> ${esc(s.vibeManName)} is writing their story&hellip;
            </p>
          ` : ''}
        </div>
      ` : `
        <div class="card">
          <p style="font-size:0.9rem;color:var(--text-muted);"><span class="waiting-pulse"></span> Waiting for the game to start&hellip;</p>
        </div>
      `}
    </div>
  `;
}

function attachSpectatorListeners() {
  document.getElementById('join-next-round-btn')?.addEventListener('click', () => {
    socket.emit('join-next-round');
  });
}
