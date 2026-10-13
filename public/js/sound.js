const STORAGE_KEY = 'cartas_sound';

let ctx = null;
let master = null;
let muted = readMuted();
let lastUiClick = 0;

function readMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === 'off'; } catch { return false; }
}

function ac() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

function resume() {
  const c = ac();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.2, attack = 0.006, decay, slide, delay = 0 }) {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const d = Math.max(0.02, decay ?? dur);
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + d);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + d + 0.03);
}

function noise({ dur = 0.12, gain = 0.2, freq = 1800, q = 1, type = 'bandpass', delay = 0 }) {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

const SFX = {
  click() { tone({ freq: 240, type: 'square', dur: 0.03, gain: 0.05, slide: 160 }); },
  deal() {
    noise({ dur: 0.085, gain: 0.14, freq: 2400, q: 0.7 });
    tone({ freq: 340, type: 'triangle', dur: 0.07, gain: 0.05, slide: 180 });
  },
  flip() {
    noise({ dur: 0.06, gain: 0.11, freq: 3100 });
    tone({ freq: 380, type: 'triangle', dur: 0.08, gain: 0.06, slide: 780 });
  },
  chip() {
    tone({ freq: 1500, type: 'triangle', dur: 0.045, gain: 0.07 });
    tone({ freq: 2050, type: 'triangle', dur: 0.04, gain: 0.045, delay: 0.028 });
  },
  chips() {
    for (let i = 0; i < 5; i++) tone({ freq: 1350 + i * 110, type: 'triangle', dur: 0.045, gain: 0.05, delay: i * 0.042 });
    noise({ dur: 0.18, gain: 0.05, freq: 2600, q: 0.8 });
  },
  bet() {
    tone({ freq: 200, type: 'sine', dur: 0.09, gain: 0.1, slide: 130 });
    SFX.chip();
  },
  turn() {
    tone({ freq: 880, type: 'sine', dur: 0.16, gain: 0.11 });
    tone({ freq: 1320, type: 'sine', dur: 0.14, gain: 0.045, delay: 0.02 });
  },
  raise() {
    tone({ freq: 320, type: 'sawtooth', dur: 0.16, gain: 0.06, slide: 940 });
    noise({ dur: 0.12, gain: 0.07, freq: 2600, delay: 0.02 });
  },
  allin() {
    SFX.raise();
    tone({ freq: 1046, type: 'triangle', dur: 0.2, gain: 0.1, delay: 0.09 });
    tone({ freq: 1568, type: 'triangle', dur: 0.22, gain: 0.07, delay: 0.16 });
  },
  fold() {
    noise({ dur: 0.18, gain: 0.08, freq: 900, q: 0.6 });
    tone({ freq: 320, type: 'sine', dur: 0.18, gain: 0.045, slide: 150 });
  },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.13, delay: i * 0.085 })); },
  blackjack() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.18, gain: 0.14, delay: i * 0.075 })); },
  lose() {
    tone({ freq: 392, type: 'sine', dur: 0.2, gain: 0.09, slide: 260 });
    tone({ freq: 261, type: 'sine', dur: 0.28, gain: 0.08, delay: 0.14, slide: 180 });
  },
  bust() {
    noise({ dur: 0.25, gain: 0.1, freq: 500, q: 0.4 });
    tone({ freq: 220, type: 'sawtooth', dur: 0.3, gain: 0.06, slide: 90 });
  },
  coin() {
    tone({ freq: 1650, type: 'triangle', dur: 0.05, gain: 0.08 });
    tone({ freq: 2150, type: 'triangle', dur: 0.08, gain: 0.06, delay: 0.04 });
  },
  message() {
    tone({ freq: 660, type: 'sine', dur: 0.1, gain: 0.08 });
    tone({ freq: 990, type: 'sine', dur: 0.12, gain: 0.055, delay: 0.07 });
  },
};

const HAPTIC = {
  deal: 8, flip: 6, chip: 9, chips: [6, 18, 6], bet: 10, turn: 12,
  raise: 14, allin: [18, 30, 18], fold: 12, win: [12, 40, 12],
  blackjack: [20, 45, 20, 45, 40], lose: 22, bust: 28, coin: 8, message: [8, 28, 8],
};

function haptic(name) {
  if (muted || !navigator.vibrate) return;
  const p = HAPTIC[name];
  if (p) navigator.vibrate(p);
}

export function playSfx(name) {
  const fn = SFX[name];
  if (!fn) return;
  if (!muted) {
    resume();
    try { fn(); } catch { /* áudio indisponível */ }
  }
  haptic(name);
}

export function isSoundMuted() { return muted; }

export function setSoundMuted(value) {
  muted = !!value;
  try { localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on'); } catch { /* sem storage */ }
  updateToggles();
  if (!muted) { resume(); playSfx('click'); }
}

export function toggleSound() { setSoundMuted(!muted); }

function updateToggles() {
  document.querySelectorAll('[data-sound-toggle]').forEach((b) => {
    b.textContent = muted ? '🔇' : '🔊';
    b.setAttribute('aria-pressed', String(!muted));
    b.title = muted ? 'Som e vibração: desligados' : 'Som e vibração: ligados';
    b.setAttribute('aria-label', b.title);
  });
}

export function initSound() {
  const unlock = () => resume();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.dataset.noSfx != null || btn.disabled) return;
    const now = Date.now();
    if (now - lastUiClick < 45) return;
    lastUiClick = now;
    playSfx('click');
  });

  document.querySelectorAll('[data-sound-toggle]').forEach((b) => {
    b.dataset.noSfx = '';
    b.addEventListener('click', (e) => { e.preventDefault(); toggleSound(); });
  });

  updateToggles();
}
