export const CELEBRATIONS = [
  { id: 'confetti', icon: '🎉', label: 'Confete' },
  { id: 'fireworks', icon: '🎆', label: 'Fogos' },
  { id: 'trophy', icon: '🏆', label: 'Troféu' },
  { id: 'coins', icon: '🪙', label: 'Chuva de moedas' },
  { id: 'none', icon: '🚫', label: 'Sem animação' },
];

const COLORS = ['#e7c14a', '#ef4444', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#f59e0b', '#f8fafc'];

let lastBurst = 0;

export function celebrate(style, container) {
  const id = CELEBRATIONS.some((c) => c.id === style) ? style : 'confetti';
  if (id === 'none') return;
  const now = Date.now();
  if (now - lastBurst < 2000) return;
  lastBurst = now;
  const root = container || document.body;
  const el = document.createElement('div');
  el.className = `celebrate celebrate-${id}`;
  if (id === 'confetti' || id === 'coins') fallPieces(el, id === 'coins');
  else if (id === 'fireworks') burstBombs(el);
  else trophyRise(el);
  root.appendChild(el);
  setTimeout(() => el.remove(), 4400);
}

function fallPieces(el, coin) {
  for (let i = 0; i < (coin ? 46 : 70); i++) {
    const p = document.createElement('span');
    p.className = 'cp';
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--drift', `${(Math.random() * 2 - 1) * 90}px`);
    p.style.setProperty('--fall', `${300 + Math.random() * 420}px`);
    p.style.setProperty('--spin', `${Math.random() > 0.5 ? '' : '-'}${120 + Math.random() * 240}deg`);
    p.style.setProperty('--dur', `${1.3 + Math.random() * 1.4}s`);
    p.style.setProperty('--delay', `${Math.random() * 0.7}s`);
    p.style.setProperty('--rc', COLORS[i % COLORS.length]);
    if (coin) {
      p.classList.add('ccoin');
      p.textContent = '🪙';
    }
    el.appendChild(p);
  }
}

function burstBombs(el) {
  const spots = [[18, 30], [72, 24], [48, 48], [26, 62], [68, 66]];
  spots.forEach(([bx, by], s) => {
    const n = 26 + (s % 2) * 8;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rad = 60 + Math.random() * 90;
      const p = document.createElement('span');
      p.className = 'fx';
      p.style.left = `${bx}%`;
      p.style.top = `${by}%`;
      p.style.setProperty('--dx', `${Math.cos(ang) * rad}px`);
      p.style.setProperty('--dy', `${Math.sin(ang) * rad}px`);
      p.style.setProperty('--rc', COLORS[(i + s * 3) % COLORS.length]);
      p.style.setProperty('--delay', `${s * 0.22}s`);
      el.appendChild(p);
    }
    const ring = document.createElement('span');
    ring.className = 'fring';
    ring.style.left = `${bx}%`;
    ring.style.top = `${by}%`;
    ring.style.setProperty('--delay', `${s * 0.22}s`);
    el.appendChild(ring);
  });
}

function trophyRise(el) {
  const title = document.createElement('b');
  title.className = 'celebrate-title';
  title.textContent = 'Campeão!';
  const cup = document.createElement('span');
  cup.className = 'ctrophy';
  cup.textContent = '🏆';
  const shine = document.createElement('span');
  shine.className = 'cshine';
  el.append(title, cup, shine);
}