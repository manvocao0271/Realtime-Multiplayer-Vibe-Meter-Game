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
        <div class="lb-entry">
          <span class="lb-streak-col">${bulls > 0 ? `${bulls}x&#127919;` : ''}</span>
          <div class="lb-row ${isYou ? 'lb-you' : ''} ${p.disconnected ? 'lb-disconnected' : ''}">
            <span class="lb-medal">${medal}</span>
            <span class="lb-pname">${esc(p.name)}${p.disconnected ? ' <span class="lb-away">(away)</span>' : ''}</span>
            <span class="lb-pts">${p.score}</span>
          </div>
          <span class="lb-delta-col">${delta != null && delta > 0 ? `+${delta}` : ''}</span>
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
  `;
}
