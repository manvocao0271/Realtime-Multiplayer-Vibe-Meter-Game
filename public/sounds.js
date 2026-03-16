// ============================================================
//  SOUNDS — Web Audio API sound effects (no external files)
// ============================================================

let _ac;
try {
  _ac = new (window.AudioContext || window.webkitAudioContext)();
} catch (e) {
  _ac = null;
}

let _activeNodes   = []; // currently playing { node, gain } pairs
let _pendingTimers = []; // setTimeout IDs for notes not yet fired

function _stopAll() {
  _pendingTimers.forEach(clearTimeout);
  _pendingTimers = [];
  const t = _ac ? _ac.currentTime : 0;
  _activeNodes.forEach(({ node, gain }) => {
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0.0001, t);
      node.stop(t + 0.02);
    } catch (_) {}
  });
  _activeNodes = [];
}

function _beep({ type = 'sine', freq = 440, freq2 = freq, gain = 0.3, dur = 0.12, attack = 0.005, release = 0.08 } = {}) {
  if (!_ac) return;
  const g = _ac.createGain();
  const o = _ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, _ac.currentTime);
  o.frequency.linearRampToValueAtTime(freq2, _ac.currentTime + dur);
  g.gain.setValueAtTime(0.0001, _ac.currentTime);
  g.gain.linearRampToValueAtTime(gain, _ac.currentTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, _ac.currentTime + dur + release);
  o.connect(g);
  g.connect(_ac.destination);
  o.start();
  o.stop(_ac.currentTime + dur + release + 0.05);
  const entry = { node: o, gain: g };
  _activeNodes.push(entry);
  o.onended = () => { _activeNodes = _activeNodes.filter(e => e !== entry); };
}

// Schedule a beep after `delay` ms, tracking the timer so it can be cancelled
function _scheduleBeep(delay, opts) {
  if (delay === 0) { _beep(opts); return; }
  const id = setTimeout(() => _beep(opts), delay);
  _pendingTimers.push(id);
}

function _resume() {
  if (_ac && _ac.state === 'suspended') _ac.resume();
}

// Filtered noise sweep — used for whoosh effects
function _whoosh() {
  if (!_ac) return;
  const dur = 0.28;
  const bufSize = Math.floor(_ac.sampleRate * dur);
  const buf = _ac.createBuffer(1, bufSize, _ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = _ac.createBufferSource();
  noise.buffer = buf;

  const bpf = _ac.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.setValueAtTime(4000, _ac.currentTime);
  bpf.frequency.exponentialRampToValueAtTime(280, _ac.currentTime + dur);
  bpf.Q.value = 2.5;

  const g = _ac.createGain();
  g.gain.setValueAtTime(0.0001, _ac.currentTime);
  g.gain.linearRampToValueAtTime(0.32, _ac.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, _ac.currentTime + dur);

  noise.connect(bpf);
  bpf.connect(g);
  g.connect(_ac.destination);
  noise.start();
  noise.stop(_ac.currentTime + dur + 0.05);
  const entry = { node: noise, gain: g };
  _activeNodes.push(entry);
  noise.onended = () => { _activeNodes = _activeNodes.filter(e => e !== entry); };
}

const SOUNDS = {
  // Successful submission (phrases, story)
  submit:       () => _beep({ freq: 260, freq2: 340, gain: 0.25, dur: 0.1 }),

  // Host starts the game — punchy rising fanfare
  gameStart:    () => {
    _beep({ freq: 330, freq2: 880, gain: 0.18, dur: 0.14, release: 0.05 });
    _scheduleBeep(155, { freq: 880,  gain: 0.32, dur: 0.22, release: 0.25 });
    _scheduleBeep(155, { freq: 1109, gain: 0.18, dur: 0.22, release: 0.22 });
  },

  // All phrases submitted — cascading chime
  allPhrasesIn: () => {
    [0, 90, 180, 270, 370].forEach((d, i) =>
      _scheduleBeep(d, { type: 'triangle', freq: [523, 659, 784, 1047, 1319][i], gain: 0.2, dur: 0.1, release: 0.22 }));
  },

  // Vibe man selects the round phrase — sharp stab then descending resonant sweep
  phraseSelect: () => {
    _beep({ freq: 740, gain: 0.22, dur: 0.07, release: 0.03 });
    _scheduleBeep(80, { type: 'triangle', freq: 520, freq2: 280, gain: 0.28, dur: 0.25, release: 0.35 });
  },

  // Locking in a guess — two-tone snap
  lockIn:       () => {
    _beep({ freq: 440, freq2: 880, gain: 0.3, dur: 0.08 });
    _scheduleBeep(90, { freq: 880, gain: 0.2, dur: 0.15 });
  },

  // Story revealed / guessing phase opens — rising sweep
  reveal:       () => _beep({ type: 'triangle', freq: 300, freq2: 700, gain: 0.35, dur: 0.3, release: 0.2 }),

  // Phase/round start — ascending three-note sting
  phaseStart:   () => {
    [0, 120, 240].forEach((d, i) =>
      _scheduleBeep(d, { freq: [440, 550, 660][i], gain: 0.25, dur: 0.15 }));
  },

  // Bullseye / high score — four-note fanfare
  bullseye:     () => {
    [0, 100, 200, 300].forEach((d, i) =>
      _scheduleBeep(d, { freq: [523, 659, 784, 1047][i], gain: 0.3, dur: 0.15 }));
  },

  // Game over — ascending four-note victory phrase
  gameover:     () => {
    [0, 150, 300, 500].forEach((d, i) =>
      _scheduleBeep(d, { freq: [392, 523, 659, 784][i], gain: 0.3, dur: 0.25 }));
  },

  // Another player locks in their guess — subtle chime
  playerLock:   () => _beep({ freq: 660, freq2: 880, gain: 0.12, dur: 0.06, release: 0.05 }),

  // Countdown tick for final seconds
  countdown:    () => _beep({ freq: 880, gain: 0.18, dur: 0.06, release: 0.04 }),

  // Fast-forward — descending noise whoosh + pitch sweep
  fastForward:  () => {
    _whoosh();
    _beep({ freq: 1000, freq2: 220, gain: 0.14, dur: 0.22, release: 0.08 });
  },

  // Error / validation failure
  error:        () => _beep({ type: 'sawtooth', freq: 220, freq2: 180, gain: 0.2, dur: 0.15, release: 0.1 }),
};

function playSound(name) {
  _resume();
  _stopAll();
  SOUNDS[name]?.();
}
