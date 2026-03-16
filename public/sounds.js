// ============================================================
//  SOUNDS — Web Audio API sound effects (no external files)
// ============================================================

let _ac;
try {
  _ac = new (window.AudioContext || window.webkitAudioContext)();
} catch (e) {
  _ac = null;
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
}

function _resume() {
  if (_ac && _ac.state === 'suspended') _ac.resume();
}

const SOUNDS = {
  // Lightweight confirm for non-critical button presses
  click:      () => _beep({ type: 'square', freq: 200, gain: 0.15, dur: 0.04, release: 0.03 }),

  // Successful submission (phrases, story)
  submit:     () => _beep({ freq: 260, freq2: 340, gain: 0.25, dur: 0.1 }),

  // Locking in a guess — two-tone snap
  lockIn:     () => {
    _beep({ freq: 440, freq2: 880, gain: 0.3, dur: 0.08 });
    setTimeout(() => _beep({ freq: 880, gain: 0.2, dur: 0.15 }), 90);
  },

  // Story revealed / guessing phase opens — rising sweep
  reveal:     () => _beep({ type: 'triangle', freq: 300, freq2: 700, gain: 0.35, dur: 0.3, release: 0.2 }),

  // Phase/round start — ascending three-note sting
  phaseStart: () => {
    [0, 120, 240].forEach((d, i) =>
      setTimeout(() => _beep({ freq: [440, 550, 660][i], gain: 0.25, dur: 0.15 }), d));
  },

  // Bullseye / high score — four-note fanfare
  bullseye:   () => {
    [0, 100, 200, 300].forEach((d, i) =>
      setTimeout(() => _beep({ freq: [523, 659, 784, 1047][i], gain: 0.3, dur: 0.15 }), d));
  },

  // Game over — ascending four-note victory phrase
  gameover:   () => {
    [0, 150, 300, 500].forEach((d, i) =>
      setTimeout(() => _beep({ freq: [392, 523, 659, 784][i], gain: 0.3, dur: 0.25 }), d));
  },

  // Another player locks in their guess — subtle chime
  playerLock: () => _beep({ freq: 660, freq2: 880, gain: 0.12, dur: 0.06, release: 0.05 }),

  // Countdown tick for final seconds
  countdown:  () => _beep({ freq: 880, gain: 0.18, dur: 0.06, release: 0.04 }),

  // Error / validation failure
  error:      () => _beep({ type: 'sawtooth', freq: 220, freq2: 180, gain: 0.2, dur: 0.15, release: 0.1 }),
};

function playSound(name) {
  _resume();
  SOUNDS[name]?.();
}
