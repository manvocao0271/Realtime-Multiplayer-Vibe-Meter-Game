// ============================================================
//  STATE  — shared mutable state and socket connection
// ============================================================

const roomCode = window.location.pathname.replace(/^\//, '').toUpperCase() || '';
const socket = io({ query: { room: roomCode } });

let myName = localStorage.getItem('vibeMeterName') || '';
let currentState = null;

// Preserve input values across re-renders
let saved = {
  label1: '', label2: '',
  story: '',
  guessValue: 50,
};

// Track what's currently rendered to skip unnecessary full re-renders
let lastRenderKey = null;

// -- Guess countdown timer -----------------------------------
let guessCountdownInterval = null;

function startGuessCountdown() {
  clearInterval(guessCountdownInterval);
  guessCountdownInterval = null;
  const deadline = currentState?.guessDeadline;
  if (!deadline) return;

  const durMs = (currentState?.guessDuration ?? 15) * 1000;
  const elapsed = Math.max(0, (Date.now() - (deadline - durMs)) / 1000);
  const bar = document.getElementById('guess-timer-bar');
  if (bar) {
    bar.style.animationDuration = `${currentState?.guessDuration ?? 15}s`;
    bar.style.animationDelay = `-${elapsed}s`;
  }

  function tick() {
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const el = document.getElementById('guess-timer-secs');
    if (el) el.textContent = secs === 1 ? '1 second...' : `${secs} seconds...`;
    if (secs === 0) { clearInterval(guessCountdownInterval); guessCountdownInterval = null; }
  }
  tick();
  guessCountdownInterval = setInterval(tick, 200);
}

// -- Tip deck (shuffled, one tip per round) ------------------
const WAIT_TIPS = [
  { emoji: '&#128172;', text: 'Talk it out — what does a 1 actually look like on this phrase? What does a 100?' },
  { emoji: '&#129504;', text: 'Pre-commit to a gut range before the story even drops so you\'re not starting cold.' },
  { emoji: '&#128064;', text: 'How well do you know the Vibe Man? Watch the their reaction and pace — nerves can mean an extreme number.' },
  { emoji: '&#127919;', text: 'Exact guesses score 7 pts. If the phrase has an obvious extreme, it might be worth camping it.' },
  { emoji: '&#128200;', text: 'Check the leaderboard — know who\'s running hot. Their reading of this Vibe Man might be worth matching.' },
  { emoji: '&#129300;', text: 'Remember: the Vibe Man earns the avg of your points x2. Good writing = they want you all close.' },
  { emoji: '&#9878;&#65039;', text: 'Think about how this specific Vibe Man writes — do they go literal, poetic, deadpan, or chaotic?' },
  { emoji: '&#128257;', text: 'You have 15–30 seconds once the story drops. Lock in fast — second-guessing rarely helps.' },
  { emoji: '&#127756;', text: 'Numbers near 50 are safer but rarely score big. Commit to a direction if you have any read at all.' },
  { emoji: '&#128293;', text: 'Has this Vibe Man gone extreme before? People often cluster their stories in a comfort zone.' },
  { emoji: '&#129517;', text: 'The spectrum ends anchor everything. Re-read them now so they\'re fresh when the story hits.' },
  { emoji: '&#128483;', text: 'Silence can be a tell. Is the Vibe Man quiet and focused, or laughing? Both reveal something.' },
  { emoji: '&#128293;', text: 'Guessing 1–5 or 96–100 is in the Extreme Zone — all or nothing. If the answer is in this zone, you get 6 pts (or 14 for a direct hit). If it\'s not, you score zero.' },
  { emoji: '&#9889;', text: 'The Extreme Zone is only 5 values wide on each end. Guessing here is high risk high reward so don\'t guess it all the time.' },
  { emoji: '&#129520;', text: 'If you suspect the true number is extreme but aren\'t sure which end, staying just outside (6 or 95) is safer — you still score normally without the all-or-nothing penalty.' },
  { emoji: '&#129513;', text: 'Guessing 6 or 95 when you suspect an extreme true value is often the smartest play — if the answer is 1 or 100, you still pocket 3 pts with zero risk.' },
  { emoji: '&#127919;', text: 'The 2-pt and 1-pt brackets exist for a reason. Consistent near-misses is better than nothing, so always try your best.' },
];

let _tipDeck = [];
let _tipIdx  = 0;
let _currentRoundTip = null;

function _nextTipFromDeck() {
  if (_tipIdx >= _tipDeck.length) {
    _tipDeck = Array.from({ length: WAIT_TIPS.length }, (_, i) => i);
    for (let i = _tipDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [_tipDeck[i], _tipDeck[j]] = [_tipDeck[j], _tipDeck[i]];
    }
    _tipIdx = 0;
  }
  return WAIT_TIPS[_tipDeck[_tipIdx++]];
}

function _tipHTML(tip) {
  return `
  <div class="card" style="margin-top:1rem;padding:1rem 1.25rem;display:flex;align-items:flex-start;gap:0.9rem;">
    <span style="font-size:1.75rem;flex-shrink:0;line-height:1.2;">${tip.emoji}</span>
    <div>
      <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-dim);margin-bottom:0.3rem;">TIP: </div>
      <p style="margin:0;font-size:0.92rem;color:var(--text);font-style:italic;">${tip.text}</p>
    </div>
  </div>`;
}
