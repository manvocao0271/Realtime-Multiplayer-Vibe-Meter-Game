// ============================================================
//  SCREEN: Round Results
// ============================================================

function renderResults() {
  _currentRoundTip = null;
  const s = currentState;
  const phrase = s.currentPhrase;
  const results = s.roundResults || [];
  const trueVal = s.randomValue;

  // ── Zone grouping ─────────────────────────────────────────
  const leftGroup  = results.filter(r => r.guess < trueVal).sort((a, b) => b.guess - a.guess);
  const rightGroup = results.filter(r => r.guess > trueVal).sort((a, b) => a.guess - b.guess);
  const exactHits  = results.filter(r => r.diff === 0);

  function buildZones(players) {
    const green  = players.filter(r => r.diff <= 5);
    const yellow = players.filter(r => r.diff > 5 && r.diff <= 7);
    const orange = players.filter(r => r.diff > 7 && r.diff <= 9);
    const missRaw = players.filter(r => r.diff > 9);
    const missGroups = [];
    for (const p of missRaw) {
      const last = missGroups[missGroups.length - 1];
      if (last && Math.abs(p.guess - last[last.length - 1].guess) <= 6) {
        last.push(p);
      } else {
        missGroups.push([p]);
      }
    }
    return { green, yellow, orange, missGroups };
  }

  const lz = buildZones(leftGroup);
  const rz = buildZones(rightGroup);

  const chip = (r) => {
    const idx = (s.players || []).findIndex(p => p.id === r.id);
    const ci  = Math.max(0, idx) % 8;
    const isMe = r.id === s.myId;
    const ptsTip = r.pts > 0 ? ` \u2192 +${r.pts} pts` : ' \u2192 0 pts';
    return `<div class="rz-chip avatar-${ci}${isMe ? ' rz-me' : ''}${r.extremeGuess ? ' rz-extreme' : ''}"
      title="${esc(r.name)}: guessed ${r.guess}${ptsTip}">
      <span class="rz-init">${esc(r.name.slice(0, 2).toUpperCase())}</span>
      ${r.pts > 0 ? `<span class="rz-pts">+${r.pts}</span>` : ''}
    </div>`;
  };

  const makeBlock = (players, color) => {
    if (!players || players.length === 0) return '';
    const diffs = players.map(r => r.diff);
    const minD = Math.min(...diffs), maxD = Math.max(...diffs);
    const rangeLabel = minD === maxD ? `\u00b1${minD}` : `\u00b1${minD}\u2013${maxD}`;
    return `<div class="rz-block rz-${color}">
      <div class="rz-chips">${players.map(chip).join('')}</div>
      <div class="rz-bar-label">${rangeLabel}</div>
      <div class="rz-bar-line"></div>
    </div>`;
  };

  const leftHTML = [
    ...[...lz.missGroups].reverse().map(g => makeBlock(g, 'miss')),
    makeBlock(lz.orange, 'orange'),
    makeBlock(lz.yellow, 'yellow'),
    makeBlock(lz.green,  'green'),
  ].join('');

  const rightHTML = [
    makeBlock(rz.green,  'green'),
    makeBlock(rz.yellow, 'yellow'),
    makeBlock(rz.orange, 'orange'),
    ...rz.missGroups.map(g => makeBlock(g, 'miss')),
  ].join('');

  const centerHTML = `<div class="rz-center">
    ${exactHits.map(chip).join('')}
    <div class="rz-true">&#9733; ${trueVal}</div>
  </div>`;

  // ── Simplified dial (answer marker only) ──────────────────
  const CX = 150, CY = 150, R = 130;
  const ARC_LEN = Math.PI * R;
  const answerDashOffset = (ARC_LEN * (1 - (trueVal - 1) / 99)).toFixed(2);
  const aa  = Math.PI - ((trueVal - 1) / 99) * Math.PI;
  const ax  = (CX + R * Math.cos(aa)).toFixed(1);
  const ay  = (CY - R * Math.sin(aa)).toFixed(1);

  const dialTicks = Array.from({length: 11}, (_, i) => {
    const angle = Math.PI - (i / 10) * Math.PI;
    const r1 = 116, r2 = 144;
    const x1 = CX + r1 * Math.cos(angle); const y1 = CY - r1 * Math.sin(angle);
    const x2 = CX + r2 * Math.cos(angle); const y2 = CY - r2 * Math.sin(angle);
    return `<line class="dial-tick${i === 0 || i === 10 ? ' dial-tick-end' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`;
  }).join('');

  // ── Hero text ─────────────────────────────────────────────
  const anyPerfect    = results.some(r => r.pts >= 3);
  const anyExtremeWin = results.some(r => r.extremeGuess && r.pts > 0);
  const minDiff        = results.length > 0 ? Math.min(...results.map(r => r.diff)) : null;
  const closestResults = results.filter(r => r.diff === minDiff);
  const closestResult  = closestResults[0] ?? null;
  const heroBullseye   = closestResult && closestResult.diff === 0;
  const heroEmoji = heroBullseye ? '&#127919;' : anyExtremeWin ? '&#128293;' : anyPerfect ? '&#127881;' : '&#128517;';
  let heroText = 'Round over!';
  if (closestResults.length === 1) {
    heroText = heroBullseye
      ? `${esc(closestResult.name)} hit a bullseye!`
      : `${esc(closestResult.name)} was closest!`;
  } else if (closestResults.length === 2) {
    const [ca, cb] = closestResults;
    heroText = heroBullseye
      ? `${esc(ca.name)} &amp; ${esc(cb.name)} both hit a bullseye!`
      : `${esc(ca.name)} &amp; ${esc(cb.name)} were closest!`;
  } else if (closestResults.length > 2) {
    heroText = heroBullseye
      ? `${closestResults.length} players hit a bullseye!`
      : `${closestResults.length} players tied for closest!`;
  }

  const myResult = results.find(r => r.id === currentState.myId);
  if (myResult && (myResult.pts >= 7 || (myResult.extremeGuess && myResult.pts >= 4))) {
    setTimeout(launchConfetti, 100);
  }

  return `
    <div class="fade-in">
      ${renderVibeManBanner(s)}

      <div class="card ${heroBullseye ? 'success' : ''}" style="text-align:center;padding:1.5rem;margin-bottom:1rem;">
        <div style="font-size:2.5rem;margin-bottom:0.25rem;">${heroEmoji}</div>
        <h3>${heroText}</h3>
        <p style="margin-top:0.3rem;">
          The secret number was <strong style="color:var(--text);font-size:1.1em;">${trueVal}</strong>
        </p>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <div class="section-title">Where everyone landed</div>

        <div class="dial-wrap" style="margin:0.5rem 0 0;">
          <svg class="dial-svg" viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="rdGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#10b981"/>
                <stop offset="50%"  stop-color="#a855f7"/>
                <stop offset="100%" stop-color="#ef4444"/>
              </linearGradient>
            </defs>
            <path class="dial-track" d="M 20,150 A 130,130 0 0,1 280,150"/>
            <path class="dial-fill" d="M 20,150 A 130,130 0 0,1 280,150"
              style="stroke-dasharray:${ARC_LEN.toFixed(2)};stroke-dashoffset:${answerDashOffset};stroke:url(#rdGrad);"/>
            ${dialTicks}
            <circle cx="${ax}" cy="${ay}" r="13" fill="#fbbf24" stroke="rgba(0,0,0,0.45)" stroke-width="2"
              style="filter:drop-shadow(0 0 8px #fbbf2488);"/>
            <text x="${ax}" y="${(parseFloat(ay)+4.5).toFixed(1)}" text-anchor="middle"
              font-size="9.5" font-weight="900" fill="#000">${trueVal}</text>
            <circle class="dial-pivot" cx="150" cy="150" r="8"/>
            <text x="20" y="190" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
              font-weight="700" font-size="13" fill="#10b981">${esc((phrase?.label1 || '').slice(0,20))}</text>
            <text x="280" y="190" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
              font-weight="700" font-size="13" fill="#ef4444">${esc((phrase?.label2 || '').slice(0,20))}</text>
          </svg>
        </div>

        <div class="rz-row">
          <div class="rz-side rz-left">${leftHTML || '<div class="rz-spacer"></div>'}</div>
          ${centerHTML}
          <div class="rz-side rz-right">${rightHTML || '<div class="rz-spacer"></div>'}</div>
        </div>

        <div class="section-title" style="margin-top:1.25rem;">The Vibe Story by ${esc(s.vibeManName)}</div>
        <div class="story-box">${esc(s.story)}</div>
      </div>

      <div class="card results-timer-ctrl" style="margin-top:1rem;">
        ${s.isVibeman ? `
          <div class="section-title" style="margin-bottom:0.5rem;">Round Timer</div>
          <p id="results-timer-label" style="font-size:0.85rem;text-align:center;margin-bottom:0.5rem;color:var(--text-dim);">
            ${s.resultsPaused ? 'Timer paused &mdash; resume or skip when ready.' : 'Next round starting&hellip;'}
          </p>
          <div class="countdown-bar-wrap" style="margin-bottom:0.85rem;">
            <div class="countdown-bar-10" id="results-countdown-bar"
              style="animation-play-state:${s.resultsPaused ? 'paused' : 'running'};"></div>
          </div>
          <div style="display:flex;gap:0.5rem;">
            ${s.resultsPaused
              ? `<button class="btn btn-secondary" id="results-resume-btn" style="flex:1;">&#9654; Resume</button>`
              : `<button class="btn btn-secondary" id="results-pause-btn" style="flex:1;">&#9646;&#9646; Pause</button>`
            }
            <button class="btn btn-primary" id="proceed-next-round-btn" style="flex:1;">Skip &#8594;</button>
          </div>
        ` : `
          <p style="font-size:0.85rem;text-align:center;margin-bottom:0.5rem;color:var(--text-dim);">
            ${s.resultsPaused ? 'Vibe Man has paused the timer.' : 'Next round starting&hellip;'}
          </p>
          <div class="countdown-bar-wrap">
            <div class="countdown-bar-10"
              style="animation-play-state:${s.resultsPaused ? 'paused' : 'running'};"></div>
          </div>
        `}
      </div>
    </div>
  `;
}

function attachResultsListeners() {
  document.getElementById('proceed-next-round-btn')?.addEventListener('click', () => {
    socket.emit('advance-round');
  });
  document.getElementById('results-pause-btn')?.addEventListener('click', () => {
    socket.emit('pause-round');
  });
  document.getElementById('results-resume-btn')?.addEventListener('click', () => {
    socket.emit('resume-round');
  });
}
