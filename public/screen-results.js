// ============================================================
//  SCREEN: Round Results
// ============================================================

function renderResults() {
  _currentRoundTip = null;
  const s = currentState;
  const phrase = s.currentPhrase;
  const results = s.roundResults || [];
  const trueVal = s.randomValue;

  // ── Arc geometry (matches guessing dial exactly) ──────────
  const CX = 150, CY = 150, R = 130;
  const LABEL_R = 178;
  const ANGLE_MIN = 0.10 * Math.PI;
  const ANGLE_MAX = 0.90 * Math.PI;
  const ARC_LEN = Math.PI * R;
  const answerAngle = Math.PI - ((trueVal - 1) / 99) * Math.PI;
  const answerDashOffset = (ARC_LEN * (1 - (trueVal - 1) / 99)).toFixed(2);
  const ax = (CX + R * Math.cos(answerAngle)).toFixed(1);
  const ay = (CY - R * Math.sin(answerAngle)).toFixed(1);

  const dialTicks = Array.from({length: 11}, (_, i) => {
    const angle = Math.PI - (i / 10) * Math.PI;
    const r1 = 116, r2 = 144;
    const x1 = CX + r1 * Math.cos(angle), y1 = CY - r1 * Math.sin(angle);
    const x2 = CX + r2 * Math.cos(angle), y2 = CY - r2 * Math.sin(angle);
    return `<line class="dial-tick${i === 0 || i === 10 ? ' dial-tick-end' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`;
  }).join('');

  const diffColor = (diff) => {
    if (diff === 0) return '#d946ef';
    if (diff <= 5) return '#34d399';
    if (diff <= 7) return '#fbbf24';
    if (diff <= 9) return '#fb923c';
    return '#f87171';
  };

  // ── Peacock-fan label placement ────────────────────────────
  const sorted = [...results].sort((a, b) => a.guess - b.guess);
  const fanItems = sorted.map(r => {
    const nat = Math.PI - ((r.guess - 1) / 99) * Math.PI;
    return { r, guessAngle: nat, labelAngle: Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, nat)) };
  });

  const CHAR_W = 6.5, TEXT_PAD = 18;
  const halfPx = name => (name.length * CHAR_W + TEXT_PAD) / 2;
  const minGapRad = (a, b) => (halfPx(a.r.name) + halfPx(b.r.name) + 10) / LABEL_R;

  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < fanItems.length - 1; i++) {
      const gap = fanItems[i].labelAngle - fanItems[i + 1].labelAngle;
      const need = minGapRad(fanItems[i], fanItems[i + 1]);
      if (gap < need) {
        const push = (need - gap) / 2;
        fanItems[i].labelAngle = Math.min(ANGLE_MAX, fanItems[i].labelAngle + push);
        fanItems[i + 1].labelAngle = Math.max(ANGLE_MIN, fanItems[i + 1].labelAngle - push);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const markerAndLabels = fanItems.map(({ r, guessAngle, labelAngle }) => {
    const color = diffColor(r.diff);
    const dx = (CX + R * Math.cos(guessAngle)).toFixed(1);
    const dy = (CY - R * Math.sin(guessAngle)).toFixed(1);
    const lx = CX + LABEL_R * Math.cos(labelAngle);
    const ly = CY - LABEL_R * Math.sin(labelAngle);
    const label = esc(r.name);
    const pillW = r.name.length * CHAR_W + TEXT_PAD;
    const pillH = 16;
    return `
      <line x1="${dx}" y1="${dy}" x2="${lx.toFixed(1)}" y2="${(ly + pillH / 2).toFixed(1)}"
        stroke="${color}" stroke-width="1.8" stroke-linecap="round" opacity="0.85"/>
      <circle cx="${dx}" cy="${dy}" r="4" fill="${color}" stroke="rgba(0,0,0,0.4)" stroke-width="1.5"/>
      <rect x="${(lx - pillW / 2).toFixed(1)}" y="${(ly - 4).toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH}"
        rx="8" fill="rgba(10,6,25,0.82)" stroke="${color}" stroke-width="1.5"/>
      <text x="${lx.toFixed(1)}" y="${(ly + 8).toFixed(1)}" text-anchor="middle"
        font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="700" fill="${color}">${label}</text>
    `;
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
            ${markerAndLabels}
            <circle cx="${ax}" cy="${ay}" r="13" fill="#fbbf24" stroke="rgba(0,0,0,0.45)" stroke-width="2"
              style="filter:drop-shadow(0 0 8px #fbbf2488);"/>
            <text x="${ax}" y="${(parseFloat(ay)+4.5).toFixed(1)}" text-anchor="middle"
              font-size="9.5" font-weight="900" fill="#000">${trueVal}</text>
            <text x="20" y="190" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
              font-weight="700" font-size="14" fill="#10b981">${esc((phrase?.label1 || '').slice(0,20))}</text>
            <text x="280" y="190" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
              font-weight="700" font-size="14" fill="#ef4444">${esc((phrase?.label2 || '').slice(0,20))}</text>
          </svg>
        </div>

        <div class="section-title" style="margin-top:1.25rem;">The Vibe Story by ${esc(s.vibeManName)}</div>
        <div class="story-box">${esc(s.story)}</div>
      </div>

      <div class="card results-timer-ctrl" style="margin-top:1rem;">
        <p style="font-size:0.85rem;text-align:center;margin-bottom:0.5rem;color:var(--text-dim);">Next round starting&hellip;</p>
        <div class="countdown-bar-wrap">
          <div class="countdown-bar-10"></div>
        </div>
      </div>
    </div>
  `;
}

function attachResultsListeners() {}
