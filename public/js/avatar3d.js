export const AVATAR_SKINS = ['#f1c27d', '#e8b58a', '#c68642', '#a5673f', '#8d5524', '#ffe0bd'];
export const AVATAR_HAIRS = ['#2c1a10', '#111827', '#8b5a2b', '#dc2626', '#e2e8f0', '#3b82f6', '#16a34a', '#eab308', '#f472b6', '#7c2d12'];
export const AVATAR_SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#eab308', '#64748b', '#ec4899', '#ffffff'];
export const AVATAR_HATS = ['none', 'cap', 'beanie', 'tophat', 'crown', 'horns'];

export const HAT_LABEL = {
  none: 'Sem chapéu',
  cap: 'Boné',
  beanie: 'Gorro',
  tophat: 'Cartola',
  crown: 'Coroa',
  horns: 'Chifres',
};

export const AVATAR_DEFAULTS = { skin: '#e8b58a', hair: '#5b3a2a', shirt: '#3b82f6', hat: 'none' };

export function avatarSpec(user) {
  const c = user?.character || user || {};
  return {
    skin: c.skin || AVATAR_DEFAULTS.skin,
    hair: c.hair || AVATAR_DEFAULTS.hair,
    shirt: c.shirt || AVATAR_DEFAULTS.shirt,
    hat: AVATAR_HATS.includes(c.hat) ? c.hat : AVATAR_DEFAULTS.hat,
  };
}

export function characterCanvas(spec = {}, size = 96, opts = {}) {
  const dpr = typeof opts === 'number' ? opts : (opts?.dpr || window.devicePixelRatio || 1);
  const sit = typeof opts === 'number' ? false : !!opts?.sit;
  const emote = typeof opts === 'object' ? (opts?.emote || null) : null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  drawCharacter(ctx, spec, size, { sit, emote });
  return canvas;
}

function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function drawCharacter(ctx, spec = {}, size = 96, opts = {}) {
  const sit = !!opts?.sit;
  const emote = opts?.emote || null;
  const { skin, hair, shirt, hat } = { ...AVATAR_DEFAULTS, ...spec };
  const s = size / 96;
  const cx = size / 2;

  const rr = (x, y, w, h, r, fill, stroke) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
    }
  };

  const ellipse = (x, y, rx, ry, fill) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  ctx.save();
  ctx.clearRect(0, 0, size, size);

  // sombra no chão
  ellipse(cx, 88 * s, 30 * s, sit ? 5 * s : 7 * s, 'rgba(0,0,0,.28)');

  // cadeira / pernas
  if (sit) {
    rr(cx - 20 * s, 42 * s, 40 * s, 30 * s, 6 * s, shade('#7c5a33', -0.12));
    rr(cx - 26 * s, 70 * s, 52 * s, 8 * s, 3 * s, '#8b6238');
    rr(cx - 30 * s, 76 * s, 9 * s, 14 * s, 3 * s, '#6d4a26');
    rr(cx + 21 * s, 76 * s, 9 * s, 14 * s, 3 * s, '#6d4a26');
  } else {
    // pernas (dois blocos inclinados -> isométrico leve)
    rr(cx - 22 * s, 60 * s, 14 * s, 26 * s, 5 * s, shade(skin, -0.28));
    rr(cx + 8 * s, 60 * s, 14 * s, 26 * s, 5 * s, shade(skin, -0.28));
  }

  // torso (caixa arredondada, cara lateral mais escura = pseudo-3D)
  rr(cx - 27 * s, 30 * s, 54 * s, 40 * s, 12 * s, shade(shirt, -0.22));
  rr(cx - 27 * s, 30 * s, 48 * s, 40 * s, 12 * s, shirt);
  ellipse(cx, 32 * s, 20 * s, 5 * s, 'rgba(0,0,0,.18)');

  // braços
  if (sit) {
    // sentado: braços à frente segurando a carta
    rr(cx - 26 * s, 46 * s, 20 * s, 9 * s, 4 * s, shade(skin, -0.12));
    rr(cx + 6 * s, 46 * s, 20 * s, 9 * s, 4 * s, shade(skin, -0.12));
    rr(cx - 10 * s, 38 * s, 20 * s, 28 * s, 3 * s, '#ffffff');
    rr(cx - 10 * s, 38 * s, 20 * s, 5 * s, 3 * s, '#c0392b');
    ctx.fillStyle = '#c0392b';
    ctx.font = `bold ${7 * s}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♠', cx, 51 * s);
  } else {
    rr(cx - 40 * s, 34 * s, 12 * s, 32 * s, 6 * s, shade(skin, -0.12));
    rr(cx + 28 * s, 34 * s, 12 * s, 32 * s, 6 * s, shade(skin, -0.12));
  }

  // cabeça (esfera com luz no topo)
  const grad = ctx.createRadialGradient(cx - 5 * s, 10 * s, 4 * s, cx, 18 * s, 24 * s);
  grad.addColorStop(0, shade(skin, 0.12));
  grad.addColorStop(1, shade(skin, -0.18));
  ctx.beginPath();
  ctx.arc(cx, 20 * s, 17 * s, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  if (!emote) {
    // pestanas / sobrancelhas
    rr(cx - 12 * s, 14 * s, 7 * s, 2 * s, 1 * s, shade(hair, -0.1));
    rr(cx + 5 * s, 14 * s, 7 * s, 2 * s, 1 * s, shade(hair, -0.1));

    // olhos (virados pro centro, expressão amigável)
    ellipse(cx - 7.5 * s, 20 * s, 2.4 * s, 3 * s, '#1f2430');
    ellipse(cx + 7.5 * s, 20 * s, 2.4 * s, 3 * s, '#1f2430');
    ellipse(cx - 8.2 * s, 19 * s, 0.9 * s, 1.1 * s, '#fff');
    ellipse(cx + 6.8 * s, 19 * s, 0.9 * s, 1.1 * s, '#fff');

    // sorriso
    ctx.beginPath();
    ctx.arc(cx, 24.5 * s, 5 * s, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = shade(skin, -0.45);
    ctx.lineWidth = 1.6 * s;
    ctx.lineCap = 'round';
    ctx.stroke();

    // bochechas
    ellipse(cx - 13 * s, 25 * s, 3.2 * s, 1.8 * s, 'rgba(224,80,120,.25)');
    ellipse(cx + 13 * s, 25 * s, 3.2 * s, 1.8 * s, 'rgba(224,80,120,.25)');
  }

  drawHair(ctx, hair, cx, s, rr);
  drawHat(ctx, hat, hair, cx, s, rr, ellipse);

  if (emote) drawEmote(ctx, emote, cx, s, { skin, hair });

  ctx.restore();
  return ctx;
}

const EMOTE_EXPR = {
  dedo: { eyes: 'angry', mouth: 'flat' },
  bunda: { eyes: 'squint', mouth: 'tongue' },
  punheta: { eyes: 'determined', mouth: 'grin' },
  chifre: { eyes: 'wink', mouth: 'tongue' },
  beijo: { eyes: 'closed', mouth: 'kiss' },
  gemido: { eyes: 'closed', mouth: 'o', blush: true },
  vomito: { eyes: 'swirl', mouth: 'o', sick: true },
  chorao: { eyes: 'cry', mouth: 'frown', tears: true },
  gargalhada: { eyes: 'laugh', mouth: 'laugh' },
  banana: { eyes: 'happy', mouth: 'grin' },
};

const EMOTE_ICON = {
  dedo: '🖕', bunda: '🍑', punheta: '✊', chifre: '🐂', beijo: '😘',
  gemido: '😩', vomito: '🤮', chorao: '😭', gargalhada: '🤣', banana: '🍌',
};

function drawEmote(ctx, emote, cx, s, colors) {
  const spec = EMOTE_EXPR[emote];
  if (!spec) return;
  const hx = cx;
  const hy = 20 * s;
  const r = 17 * s;

  ctx.save();

  if (spec.sick) {
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120,200,120,.75)';
    ctx.fill();
  }

  const eye = (x, y) => {
    ctx.beginPath();
    ctx.arc(x, y, 2.4 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#1f2430';
    ctx.fill();
  };
  const closedEye = (x) => {
    ctx.beginPath();
    ctx.moveTo(x - 3 * s, 20 * s);
    ctx.quadraticCurveTo(x, 22.4 * s, x + 3 * s, 20 * s);
    ctx.strokeStyle = '#1f2430';
    ctx.lineWidth = 1.6 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  const laughEye = (x) => {
    ctx.beginPath();
    ctx.moveTo(x - 3 * s, 21 * s);
    ctx.quadraticCurveTo(x, 17.5 * s, x + 3 * s, 21 * s);
    ctx.strokeStyle = '#1f2430';
    ctx.lineWidth = 1.6 * s;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const lx = hx - 7.5 * s;
  const rx = hx + 7.5 * s;
  const ey = 20 * s;
  switch (spec.eyes) {
    case 'closed': closedEye(lx); closedEye(rx); break;
    case 'laugh': laughEye(lx); laughEye(rx); break;
    case 'wink': eye(lx); closedEye(rx); break;
    case 'cry': eye(lx); eye(rx); break;
    case 'squint':
      ctx.strokeStyle = '#1f2430'; ctx.lineWidth = 1.8 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(lx - 3 * s, ey - 2 * s); ctx.lineTo(lx + 3 * s, ey + 1 * s);
      ctx.moveTo(rx + 3 * s, ey - 2 * s); ctx.lineTo(rx - 3 * s, ey + 1 * s); ctx.stroke();
      break;
    case 'determined':
      ctx.strokeStyle = '#1f2430'; ctx.lineWidth = 1.8 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(lx - 3 * s, ey - 3 * s); ctx.lineTo(lx + 3 * s, ey);
      ctx.moveTo(rx + 3 * s, ey - 3 * s); ctx.lineTo(rx - 3 * s, ey); ctx.stroke();
      eye(lx); eye(rx);
      break;
    case 'angry':
      ctx.strokeStyle = '#1f2430'; ctx.lineWidth = 1.8 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(lx - 3 * s, ey - 3 * s); ctx.lineTo(lx + 3 * s, ey - 1 * s);
      ctx.moveTo(rx + 3 * s, ey - 3 * s); ctx.lineTo(rx - 3 * s, ey - 1 * s); ctx.stroke();
      eye(lx); eye(rx);
      break;
    case 'swirl': {
      const swirl = (x) => {
        ctx.beginPath();
        ctx.arc(x, ey, 2.6 * s, 0, Math.PI * 1.6);
        ctx.strokeStyle = '#1f2430'; ctx.lineWidth = 1.3 * s; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, ey); ctx.lineTo(x + 1.2 * s, ey - 2.4 * s); ctx.stroke();
      };
      swirl(lx); swirl(rx);
      break;
    }
    default: eye(lx); eye(rx);
  }

  const mx = hx;
  const my = 24.6 * s;
  ctx.strokeStyle = spec.sick ? '#2b3a2b' : shade(colors.skin, -0.45);
  ctx.fillStyle = spec.sick ? '#2b3a2b' : shade(colors.skin, -0.45);
  ctx.lineWidth = 1.6 * s;
  ctx.lineCap = 'round';
  const type = spec.mouth;
  if (type === 'flat') { ctx.beginPath(); ctx.moveTo(mx - 4 * s, my); ctx.lineTo(mx + 4 * s, my); ctx.stroke(); }
  else if (type === 'frown') { ctx.beginPath(); ctx.arc(mx, my + 5 * s, 4.5 * s, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); }
  else if (type === 'o' || type === 'kiss') {
    ctx.beginPath(); ctx.ellipse(mx, my + 0.5 * s, type === 'kiss' ? 2 * s : 3 * s, type === 'kiss' ? 2.6 * s : 3.4 * s, 0, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'grin') {
    ctx.beginPath(); ctx.arc(mx, my - 1 * s, 5.5 * s, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx - 5 * s, my + 0.5 * s); ctx.quadraticCurveTo(mx, my + 5.5 * s, mx + 5 * s, my + 0.5 * s); ctx.fill();
  } else if (type === 'laugh') {
    ctx.beginPath(); ctx.ellipse(mx, my + 1 * s, 4.5 * s, 3.4 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.ellipse(mx, my + 3 * s, 2.6 * s, 1.4 * s, 0, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'tongue') {
    ctx.beginPath(); ctx.arc(mx, my - 1 * s, 5 * s, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#e5485a';
    ctx.beginPath(); ctx.ellipse(mx + 0.5 * s, my + 3.4 * s, 2.6 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  }

  if (spec.blush) {
    ctx.fillStyle = 'rgba(228,72,96,.4)';
    ctx.beginPath(); ctx.ellipse(hx - 12 * s, 25 * s, 3.6 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx + 12 * s, 25 * s, 3.6 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
  }

  if (spec.tears) {
    ctx.fillStyle = 'rgba(90,170,240,.9)';
    const tear = (x) => {
      ctx.beginPath();
      ctx.moveTo(x, ey + 2 * s);
      ctx.quadraticCurveTo(x - 2 * s, ey + 6 * s, x, ey + 8 * s);
      ctx.quadraticCurveTo(x + 2 * s, ey + 6 * s, x, ey + 2 * s);
      ctx.fill();
    };
    tear(lx); tear(rx);
  }

  if (emote === 'chifre') {
    const horn = (side) => {
      ctx.beginPath();
      ctx.moveTo(hx + side * 8 * s, 6 * s);
      ctx.quadraticCurveTo(hx + side * 14 * s, 0, hx + side * 15 * s, 8 * s);
      ctx.quadraticCurveTo(hx + side * 11 * s, 6 * s, hx + side * 10 * s, 5 * s);
      ctx.closePath();
      ctx.fillStyle = '#b0342b';
      ctx.fill();
    };
    horn(1); horn(-1);
  }

  const icon = EMOTE_ICON[emote];
  if (icon) {
    ctx.font = `${20 * s}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, cx, 2 * s);
  }
  ctx.restore();
}

function drawHair(ctx, hair, cx, s, rr) {
  // tapa lateral + topo
  ctx.beginPath();
  ctx.arc(cx, 13 * s, 17 * s, Math.PI * 1.05, Math.PI * 1.95);
  ctx.quadraticCurveTo(cx + 19 * s, 16 * s, cx + 15 * s, 20 * s);
  ctx.quadraticCurveTo(cx + 12 * s, 12 * s, cx, 13 * s);
  ctx.fillStyle = hair;
  ctx.fill();
  rr(cx - 18 * s, 12 * s, 6 * s, 12 * s, 3 * s, hair);
  rr(cx + 12 * s, 12 * s, 6 * s, 12 * s, 3 * s, hair);
}

function drawHat(ctx, hat, hair, cx, s, rr, ellipse) {
  const gold = '#f1c40f';
  if (hat === 'cap') {
    ctx.beginPath();
    ctx.arc(cx, 14.5 * s, 17.5 * s, Math.PI, Math.PI * 2);
    ctx.fillStyle = shade(hair, -0.1);
    ctx.fill();
    rr(cx - 19 * s, 15.5 * s, 38 * s, 4.5 * s, 2 * s, shade(hair, -0.15));
    rr(cx + 12 * s, 11 * s, 10 * s, 8 * s, 3 * s, shade(hair, -0.25));
  } else if (hat === 'beanie') {
    ctx.beginPath();
    ctx.arc(cx, 15 * s, 16.5 * s, Math.PI, Math.PI * 2);
    ctx.fillStyle = shade(hair, 0.02);
    ctx.fill();
    rr(cx - 18 * s, 14 * s, 36 * s, 5 * s, 2 * s, shade(hair, -0.2));
  } else if (hat === 'tophat') {
    rr(cx - 13 * s, 0 * s, 26 * s, 18 * s, 3 * s, '#1c1c22');
    rr(cx - 21 * s, 15 * s, 42 * s, 4.5 * s, 2 * s, '#2a2a32');
    rr(cx - 8 * s, 3 * s, 16 * s, 3 * s, 1.5 * s, gold);
  } else if (hat === 'crown') {
    const pts = [[-14, 15], [-10, 4], [-4, 12], [0, 3], [4, 12], [10, 4], [14, 15]];
    ctx.beginPath();
    ctx.moveTo(cx + pts[0][0] * s, pts[0][1] * s);
    ctx.lineTo(cx + pts[1][0] * s, pts[1][1] * s);
    ctx.lineTo(cx + pts[2][0] * s, pts[2][1] * s);
    ctx.lineTo(cx + pts[3][0] * s, pts[3][1] * s);
    ctx.lineTo(cx + pts[4][0] * s, pts[4][1] * s);
    ctx.lineTo(cx + pts[5][0] * s, pts[5][1] * s);
    ctx.lineTo(cx + pts[6][0] * s, pts[6][1] * s);
    ctx.lineTo(cx + pts[0][0] * s, pts[0][1] * s);
    ctx.fillStyle = gold;
    ctx.fill();
    rr(cx - 15 * s, 15 * s, 30 * s, 3 * s, 1.5 * s, '#b7950b');
    ellipse(cx, 13 * s, 4 * s, 2.4 * s, '#ffe073');
  } else if (hat === 'horns') {
    const horn = (side) => {
      ctx.beginPath();
      ctx.moveTo(cx + side * 8 * s, 3 * s);
      ctx.quadraticCurveTo(cx + side * 16 * s, 1 * s, cx + side * 19 * s, 10 * s);
      ctx.quadraticCurveTo(cx + side * 12 * s, 8 * s, cx + side * 11 * s, 4 * s);
      ctx.closePath();
      ctx.fillStyle = shade(hair, -0.2);
      ctx.fill();
    };
    horn(1);
    horn(-1);
  }
}