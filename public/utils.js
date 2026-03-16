// ============================================================
//  UTILS  — shared helpers used across all screens
// ============================================================

// -- HTML escaping (XSS prevention) --------------------------
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -- Toast helper --------------------------------------------
function showToast(msg, type = 'info') {
  if (type === 'error') playSound('error');
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = msg;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 280);
  }, 3500);
}

// -- Confetti (bullseye celebration) -------------------------
function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORS = ['#a855f7','#10b981','#f59e0b','#ef4444','#3b82f6','#ec4899','#fbbf24'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height * 0.5,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.2,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 4,
  }));

  let alive = true;
  const killTimer = setTimeout(() => { alive = false; }, 3000);

  function frame() {
    if (!alive) { canvas.remove(); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let allGone = true;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.rotSpeed; p.vy += 0.08;
      if (p.y < canvas.height + 20) allGone = false;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (allGone) { clearTimeout(killTimer); canvas.remove(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// -- Shared player item renderer (lobby) ---------------------
function renderPlayerItem(p, s) {
  const isYou  = p.id === s.myId;
  const isHost = p.id === s.host;
  const isVibe = p.id === s.vibeManId && s.phase === 'playing';
  const idx    = (s.players || []).findIndex(pl => pl.id === p.id);

  return `
    <div class="player-item ${isYou ? 'you' : ''} ${isVibe ? 'vibeman' : ''} ${p.disconnected ? 'player-disconnected' : ''}">
      <div class="player-avatar avatar-${idx % 8}">
        ${esc(p.name[0].toUpperCase())}
      </div>
      <div class="player-name">${esc(p.name)}</div>
      <div style="display:flex;align-items:center;gap:0.4rem;">
        ${isHost ? '<span class="player-tag tag-host">host</span>' : ''}
        ${isVibe ? '<span class="player-tag tag-vibeman">Vibe Man</span>' : ''}
        ${p.spectator ? '<span class="player-tag" style="background:rgba(245,158,11,0.15);color:#fcd34d;border:1px solid var(--warning);">spectating</span>' : ''}
        ${p.disconnected ? '<span class="player-tag" style="background:rgba(107,114,128,0.15);color:#9ca3af;border:1px solid rgba(107,114,128,0.3);">away</span>' : ''}
        ${s.phase !== 'lobby'
          ? `<span class="player-score">${p.score} pts</span>`
          : ''}
      </div>
    </div>
  `;
}

// -- Dial tick marks (shared SVG element) --------------------
// Generates 11 evenly-spaced tick lines for the semicircle dial.
// Assumes the standard dial coordinate system: CX=150, CY=150.
function buildDialTicks() {
  return Array.from({ length: 11 }, (_, i) => {
    const angle = Math.PI - (i / 10) * Math.PI;
    const r1 = 116, r2 = 144, cx = 150, cy = 150;
    const x1 = cx + r1 * Math.cos(angle), y1 = cy - r1 * Math.sin(angle);
    const x2 = cx + r2 * Math.cos(angle), y2 = cy - r2 * Math.sin(angle);
    return `<line class="dial-tick${i === 0 || i === 10 ? ' dial-tick-end' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`;
  }).join('');
}

// -- Main guessing dial helpers ------------------------------
const MAIN_DIAL = {
  cx: 150,
  cy: 150,
  radius: 130,
  needleRadius: 112,
  arcLength: Math.PI * 130,
};

function valueToDialAngle(value) {
  const clamped = Math.max(1, Math.min(100, Number(value) || 1));
  return Math.PI - ((clamped - 1) / 99) * Math.PI;
}

function angleToDialValue(angle) {
  const clamped = Math.max(0, Math.min(Math.PI, angle));
  return Math.round(1 + ((Math.PI - clamped) / Math.PI) * 99);
}

function setMainDialValue(value, elements = {}) {
  const clamped = Math.max(1, Math.min(100, Number(value) || 1));
  const angle = valueToDialAngle(clamped);
  const nx = MAIN_DIAL.cx + MAIN_DIAL.needleRadius * Math.cos(angle);
  const ny = MAIN_DIAL.cy - MAIN_DIAL.needleRadius * Math.sin(angle);
  const fraction = (clamped - 1) / 99;
  const dashOffset = MAIN_DIAL.arcLength * (1 - fraction);

  if (elements.needle) {
    elements.needle.setAttribute('x2', nx.toFixed(2));
    elements.needle.setAttribute('y2', ny.toFixed(2));
  }
  if (elements.fill) {
    elements.fill.style.strokeDasharray = MAIN_DIAL.arcLength.toFixed(2);
    elements.fill.style.strokeDashoffset = dashOffset.toFixed(2);
  }
  if (elements.display) {
    elements.display.textContent = clamped;
  }

  return clamped;
}

function renderMainDial({
  value = 50,
  label1 = '',
  label2 = '',
  interactive = false,
  showReadout = true,
  gradientId = 'dialGrad',
  svgId = 'dial-svg',
  fillId = 'dial-fill',
  needleId = 'dial-needle',
  displayId = 'guess-display',
  wrapStyle = 'margin:0.5rem 0 0;',
} = {}) {
  const initialValue = Math.max(1, Math.min(100, Number(value) || 50));
  const angle = valueToDialAngle(initialValue);
  const nx = MAIN_DIAL.cx + MAIN_DIAL.needleRadius * Math.cos(angle);
  const ny = MAIN_DIAL.cy - MAIN_DIAL.needleRadius * Math.sin(angle);
  const dashOffset = MAIN_DIAL.arcLength * (1 - ((initialValue - 1) / 99));

  return `
    <div class="dial-wrap" style="${wrapStyle}">
      <svg class="dial-svg" id="${svgId}" viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg"${interactive ? ' style="cursor:grab;"' : ''}>
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stop-color="#10b981" />
            <stop offset="50%"  stop-color="#a855f7" />
            <stop offset="100%" stop-color="#ef4444" />
          </linearGradient>
        </defs>
        <path class="dial-track" d="M 20,150 A 130,130 0 0,1 280,150" />
        <path class="dial-fill" id="${fillId}" d="M 20,150 A 130,130 0 0,1 280,150"
          style="stroke-dasharray:${MAIN_DIAL.arcLength.toFixed(2)};stroke-dashoffset:${dashOffset.toFixed(2)};stroke:url(#${gradientId});" />
        ${buildDialTicks()}
        <line class="dial-needle" id="${needleId}" x1="150" y1="150" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" />
        <circle class="dial-pivot" cx="150" cy="150" r="10" />
        <text x="20" y="190" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="14" fill="#10b981">${label1}</text>
        <text x="280" y="190" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="14" fill="#ef4444">${label2}</text>
      </svg>
      ${showReadout ? `<div class="dial-readout" id="${displayId}">${initialValue}</div>` : ''}
    </div>`;
}

// -- Live-guess lookup map -----------------------------------
// Builds { [playerId]: guessData } from the server's liveGuesses array.
function buildKnownMap(liveGuesses) {
  const map = {};
  (liveGuesses || []).forEach(g => { map[g.id] = g; });
  return map;
}

// -- Mini-dial grid column count ----------------------------
// Returns the number of columns for the mini-dial grid based on player count.
function miniColCount(n) {
  return n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
}
