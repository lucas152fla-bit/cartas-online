import { api } from './api.js';
import { state } from './state.js';
import { $, $$, escapeHtml, toast, openModal, closeModal, userAvatarHtml } from './ui.js';
import { cardHtml, DECKS } from './blackjack.js';
import { avatarSpec, characterCanvas } from './avatar3d.js';
import { EMOTES, emoteById } from './emotes.js';
import { celebrate } from './celebrate.js';
import { playSfx } from './sound.js';

let sock = null;
let onWalletChange = () => {};
let myTableId = null;
let lastState = null;
let myHole = [];
let emoteTimer = null;
let wasMyTurn = false;
let lastBoardLen = 0;
let dealingTimer = null;
let dealing = false;
const activeEmotes = new Map();
const prevBets = new Map();

function dollHtml(p, size = 62, opts = {}) {
  try {
    const spec = avatarSpec({ character: p.character || {} });
    const canvas = characterCanvas(spec, size, { sit: !!opts.sit, emote: opts.emote || null });
    return `<img class="doll" alt="" draggable="false" src="${canvas.toDataURL()}">`;
  } catch {
    return userAvatarHtml({ id: p.userId, avatar: p.avatar, color: p.color, hasPhoto: p.hasPhoto }, 'sm');
  }
}

function activeEmoteFor(userId) {
  const e = activeEmotes.get(userId);
  if (!e) return null;
  if (Date.now() > e.until) { activeEmotes.delete(userId); return null; }
  return e;
}

function showEmote({ userId, emote }) {
  const data = emoteById(emote);
  if (!data) return;
  if (userId !== state.user.id) playSfx('message');
  activeEmotes.set(userId, { emote, bubble: data.bubble, until: Date.now() + 3200 });
  if (lastState) renderTable(lastState);
  clearTimeout(emoteTimer);
  emoteTimer = setTimeout(() => {
    for (const [uid, e] of activeEmotes) if (Date.now() > e.until) activeEmotes.delete(uid);
    if (lastState) renderTable(lastState);
  }, 3300);
}

const ROUND_LABEL = { preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
const STATE_LABEL = { waiting: 'Aguardando', playing: 'Em andamento', finished: 'Mão encerrada' };

const BLIND_PRESETS = [
  { id: 'baixo', label: 'Baixo', sb: 2, bb: 5, buyIn: 100 },
  { id: 'classico', label: 'Clássico', sb: 5, bb: 10, buyIn: 200 },
  { id: 'medio', label: 'Médio', sb: 10, bb: 25, buyIn: 500 },
  { id: 'alto', label: 'Alto', sb: 50, bb: 100, buyIn: 2000 },
];

const LAYOUTS = {
  1: [[50, 88]],
  2: [[50, 88], [50, 12]],
  3: [[50, 88], [12, 32], [88, 32]],
  4: [[50, 88], [10, 62], [50, 12], [90, 62]],
  5: [[50, 88], [10, 60], [26, 14], [74, 14], [90, 60]],
  6: [[50, 88], [11, 66], [16, 26], [50, 12], [84, 26], [89, 66]],
};

// Layout para telas estreitas: como as cadeiras laterais de 5-6 jogadores ficam
// muito próximas na cena 4:3 do celular, separamos em colunas (esquerda/direita)
// em alturas diferentes para não sobrepor.
const MOBILE_LAYOUTS = {
  1: [[50, 86]],
  2: [[50, 86], [50, 12]],
  3: [[50, 86], [11, 40], [89, 40]],
  4: [[50, 86], [10, 52], [50, 12], [90, 52]],
  5: [[50, 86], [10, 58], [24, 14], [76, 14], [90, 58]],
  6: [[50, 86], [10, 22], [10, 60], [50, 12], [90, 22], [90, 60]],
};

function isNarrow() {
  return window.innerWidth <= 640;
}

export function initPoker({ socket, refreshWallet }) {
  sock = socket;
  onWalletChange = refreshWallet || (() => {});
  sock.on('poker:state', (st) => {
    if (st.id !== myTableId) return;
    const prev = lastState;
    if (prev && prev.state === 'playing' && st.state === 'finished') {
      onWalletChange();
      playSfx('flip');
      const mine = (st.results || []).find((r) => r.userId === state.user.id);
      if (mine) playSfx((mine.net ?? 0) > 0 ? 'win' : (mine.net ?? 0) < 0 ? 'lose' : 'coin');
      if (mine && (mine.net ?? 0) > 0 && state.user?.celebration) {
        const scene = $('#pk-scene');
        // Usa o wrap (persistente) em vez da cena, cujo innerHTML é
        // reescrito logo abaixo em renderTable() e apagaria a animação.
        const host = scene ? (scene.closest('.pk-scene-wrap') || scene.parentElement) : null;
        if (host) celebrate(state.user.celebration, host);
      }
    }
    if (prev && prev.state === 'waiting' && st.state === 'playing') playSfx('deal');
    renderTable(st);
    lastState = st;
  });
  sock.on('poker:hole', ({ tableId, hole }) => {
    if (tableId !== myTableId) return;
    myHole = Array.isArray(hole) ? hole : [];
    if (lastState) renderTable(lastState);
  });
  sock.on('poker:emote', (payload) => {
    if (payload && payload.userId != null) showEmote(payload);
  });
  const eb = $('#pk-emote-btn');
  if (eb) eb.onclick = openEmoteMenu;
}

function emit(event, payload) {
  return new Promise((resolve) => {
    if (!sock) return resolve({ ok: false, error: 'Sem conexão.' });
    const t = setTimeout(() => resolve({ ok: false, error: 'Tempo esgotado.' }), 6000);
    sock.emit(event, payload, (res) => { clearTimeout(t); resolve(res || { ok: true }); });
  });
}

export function inPokerTable() {
  return myTableId != null;
}

export async function openPokerLobby() {
  $('#pk-table').classList.add('hidden');
  $('#pk-lobby').classList.remove('hidden');
  await loadPokerTables();
}

export function enterPoker() {
  if (myTableId != null) {
    $('#pk-lobby').classList.add('hidden');
    $('#pk-table').classList.remove('hidden');
  } else {
    openPokerLobby();
  }
}

async function loadPokerTables() {
  const box = $('#pk-lobby');
  let tables = [];
  try {
    ({ tables } = await api.pokerTables());
  } catch (e) {
    box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    return;
  }
  box.innerHTML = tables.length
    ? tables.map((t) => `
      <div class="pk-lobby-item">
        <div class="pk-lobby-suit">♠</div>
        <div class="grow">
          <strong>${escapeHtml(t.name)}</strong>
          <small>Anfitrião ${escapeHtml(t.host)} · ${t.players}/${t.maxPlayers} jogadores${t.bots ? ` (🤖 ${t.bots})` : ''} · ${(DECKS[t.deckStyle] || {}).name || 'Clássico'} · blinds ${t.sb}/${t.bb} 🪙 · buy-in ${t.buyIn} 🪙</small>
        </div>
        <span class="bj-tag ${t.state}">${STATE_LABEL[t.state] || t.state}</span>
        <button class="btn primary" data-enter="${t.id}" ${t.players >= t.maxPlayers && t.state !== 'finished' ? 'disabled' : ''}>Entrar</button>
      </div>`).join('')
    : '<p class="muted">Nenhuma mesa de poker aberta. Crie uma para jogar com os amigos.</p>';
  $$('[data-enter]', box).forEach((b) => { b.onclick = () => openPokerTable(Number(b.dataset.enter)); });
}

function openEmoteMenu() {
  openModal(`
    <h3>Interações 🎭</h3>
    <p class="muted" style="font-size:.85rem">Escolha uma provocação — o boneco faz a pose pra mesa toda.</p>
    <div class="emote-grid">
      ${EMOTES.map((e) => `<button class="emote-btn" data-emote="${e.id}" title="${escapeHtml(e.label)}"><span class="emote-ico">${e.icon}</span><span class="emote-lbl">${escapeHtml(e.label)}</span></button>`).join('')}
    </div>
    <div class="modal-actions"><button class="btn ghost" id="emote-close">Fechar</button></div>`);
  $('#emote-close').onclick = closeModal;
  $$('[data-emote]').forEach((b) => {
    b.onclick = async () => {
      const r = await emit('poker:emote', { tableId: myTableId, emote: b.dataset.emote });
      if (!r.ok) toast(r.error || 'Não deu.');
      closeModal();
    };
  });
}

export function openPokerCreate() {
  const deckBtns = Object.entries(DECKS).map(([k, d], i) => `
    <button type="button" class="deck-option ${i === 0 ? 'selected' : ''}" data-deck="${k}">
      <span class="deck-mini mini-${k}"></span>
      <span class="deck-txt"><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.desc)}</small></span>
    </button>`).join('');
  const blindBtns = BLIND_PRESETS.map((p) => `
    <button type="button" class="blind-option ${p.id === 'classico' ? 'selected' : ''}" data-blind="${p.id}">
      <strong>${escapeHtml(p.label)}</strong>
      <small>${p.sb}/${p.bb} 🪙 · buy-in ${p.buyIn}</small>
    </button>`).join('');
  openModal(`
    <h3>Nova mesa de poker</h3>
    <label>Nome da mesa<input id="pk-name" maxlength="40" placeholder="Mesa do Lukaz" /></label>
    <label>Robôs na mesa<select id="pk-bots">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}${n === 0 ? ' (só gente)' : ''}</option>`).join('')}</select></label>
    <div class="field-caption">Baralho</div>
    <div class="deck-picker">${deckBtns}</div>
    <div class="field-caption">Blinds</div>
    <div class="blind-picker">${blindBtns}</div>
    <label class="toggle-row">
      <input type="checkbox" id="pk-hint" />
      <span><b>Modo dicas 🧠</b><small>circula em dourado as cartas que formam sua melhor mão (na sua mão e na mesa) e mostra o nome dela (ex: dupla, sequência). As mãos valem as mesmas moedas e rankings de sempre.</small></span>
    </label>
    <p class="muted" style="font-size:.85rem">Texas Hold'em · mínimo de 2 jogadores para começar. O anfitrião pode trocar o baralho na sala de espera.</p>
    <div class="modal-actions">
      <button class="btn ghost" id="pk-cancel">Cancelar</button>
      <button class="btn primary" id="pk-confirm">Criar</button>
    </div>`);
  let deckChoice = 'classic';
  let blindChoice = 'classico';
  $$('.deck-option').forEach((b) => { b.onclick = () => { $$('.deck-option').forEach((x) => x.classList.toggle('selected', x === b)); deckChoice = b.dataset.deck; }; });
  $$('.blind-option').forEach((b) => { b.onclick = () => { $$('.blind-option').forEach((x) => x.classList.toggle('selected', x === b)); blindChoice = b.dataset.blind; }; });
  $('#pk-cancel').onclick = closeModal;
  $('#pk-confirm').onclick = async () => {
    try {
      const { table } = await api.createPokerTable({ name: $('#pk-name').value, bots: Number($('#pk-bots').value) || 0, hint: $('#pk-hint').checked, deckStyle: deckChoice, blinds: blindChoice });
      closeModal();
      await openPokerTable(table.id);
    } catch (e) {
      toast(e.message);
    }
  };
}

export async function openPokerTable(tableId) {
  myTableId = tableId;
  lastState = null;
  myHole = [];
  lastBoardLen = 0;
  dealing = false;
  clearTimeout(dealingTimer);
  activeEmotes.clear();
  prevBets.clear();
  wasMyTurn = false;
  $('#pk-lobby').classList.add('hidden');
  $('#pk-table').classList.remove('hidden');
  $('#pk-table-name').textContent = 'Mesa';
  document.querySelector('.content')?.scrollTo?.({ top: 0 });
  const res = await emit('poker:join', { tableId });
  if (!res.ok) {
    toast(res.error || 'Não foi possível entrar.');
    await openPokerLobby();
  }
}

export async function leavePokerTable() {
  if (myTableId != null) await emit('poker:leave', { tableId: myTableId });
  myTableId = null;
  lastState = null;
  myHole = [];
  lastBoardLen = 0;
  dealing = false;
  clearTimeout(dealingTimer);
  await openPokerLobby();
  onWalletChange();
}

const SRANK = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
const ckey = (c) => `${c.rank}${c.suit}`;

function boardRender(st, from = 99, hint = null) {
  const deck = st.deckStyle || 'classic';
  const cards = [];
  for (let i = 0; i < 5; i++) {
    const c = st.board[i];
    if (!c) { cards.push('<span class="card slot med"></span>'); continue; }
    const extra = [i >= from ? 'fresh' : '', hint && hint.keys && hint.keys.has(ckey(c)) ? 'hint-ring' : '']
      .filter(Boolean).join(' ');
    cards.push(cardHtml(c, deck, 'med', extra));
  }
  return `<div class="pk-board">${cards.join('')}</div>`;
}

function eval5(r) {
  const ranks = r.map((x) => SRANK[x.rank] || 0).sort((a, b) => b - a);
  const flush = r.every((x) => x.suit === r[0].suit);
  const uniq = [...new Set(ranks)];
  let straight = false;
  let sHigh = ranks[0];
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straight = true;
    else if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) { straight = true; sHigh = 5; }
  }
  const counts = {};
  for (const v of ranks) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts).map(([v, c]) => ({ v: +v, c })).sort((a, b) => b.c - a.c || b.v - a.v);
  let tier;
  let kick;
  if (straight && flush) { tier = 8; kick = [sHigh]; }
  else if (groups[0].c === 4) { tier = 7; kick = [groups[0].v, groups[1].v]; }
  else if (groups[0].c === 3 && groups[1].c === 2) { tier = 6; kick = [groups[0].v, groups[1].v]; }
  else if (flush) { tier = 5; kick = ranks; }
  else if (straight) { tier = 4; kick = [sHigh]; }
  else if (groups[0].c === 3) { tier = 3; kick = [groups[0].v, ...ranks.filter((x) => x !== groups[0].v)]; }
  else if (groups[0].c === 2 && groups[1].c === 2) {
    const hi = Math.max(groups[0].v, groups[1].v);
    const lo = Math.min(groups[0].v, groups[1].v);
    tier = 2; kick = [hi, lo, ...ranks.filter((x) => x !== hi && x !== lo)];
  } else if (groups[0].c === 2) { tier = 1; kick = [groups[0].v, ...ranks.filter((x) => x !== groups[0].v)]; }
  else { tier = 0; kick = ranks; }
  return { tier, kick };
}

function cmpKick(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}

function bestCombo(cards) {
  const n = cards.length;
  if (n < 5) return null;
  let best = null;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
    const combo = [cards[a], cards[b], cards[c], cards[d], cards[e]];
    const ev = eval5(combo);
    if (!best || ev.tier > best.ev.tier || (ev.tier === best.ev.tier && cmpKick(ev.kick, best.ev.kick) > 0)) best = { ev, combo };
  }
  return best;
}

const HINT_NAME = { 1: 'Dupla', 2: 'Dois pares', 3: 'Trinca', 4: 'Sequência', 5: 'Flush', 6: 'Full house', 7: 'Quadra', 8: 'Straight flush' };

function pkHint(st) {
  if (!myHole || myHole.length !== 2) return null;
  if (!st.board || st.board.length < 3) {
    const ra = SRANK[myHole[0].rank] || 0;
    const rb = SRANK[myHole[1].rank] || 0;
    const suited = myHole[0].suit === myHole[1].suit;
    if (ra === rb) return { name: 'Dupla (par na mão)', keys: new Set([ckey(myHole[0]), ckey(myHole[1])]) };
    if (ra >= 11 && rb >= 11) return { name: suited ? 'Cartas altas do mesmo naipe' : 'Cartas altas' };
    if (Math.abs(ra - rb) <= 3 && Math.min(ra, rb) >= 5) return { name: suited ? 'Cartas conectadas do mesmo naipe' : 'Cartas conectadas' };
    if (suited) return { name: 'Cartas do mesmo naipe' };
    return null;
  }
  const best = bestCombo([...myHole, ...st.board]);
  if (!best || best.ev.tier < 1) return null;
  const { tier, kick } = best.ev;
  let sigRanks;
  if (tier === 1 || tier === 3 || tier === 7) sigRanks = [kick[0]];
  else if (tier === 2) sigRanks = [kick[0], kick[1]];
  else sigRanks = best.combo.map((c) => SRANK[c.rank]);
  const keys = new Set(best.combo.filter((c) => sigRanks.includes(SRANK[c.rank])).map(ckey));
  return { name: HINT_NAME[tier], keys };
}

function seatHtml(st, p, x, y, isMe) {
  const deck = st.deckStyle || 'classic';
  const cls = ['pk-seat'];
  if (p.isTurn) cls.push('turn');
  if (p.folded) cls.push('folded');
  if (p.allIn) cls.push('allin');
  if (!p.inHand) cls.push('out');
  if (isMe) cls.push('me');
  if (y < 45) cls.push('top');
  const em = activeEmoteFor(p.userId);
  if (em) cls.push('emoting');
  const isDealer = st.dealerIndex >= 0 && st.players[st.dealerIndex]?.userId === p.userId;
  let cards = '';
  if (p.holeShown && p.hole) {
    const rev = st.state === 'finished' ? ' reveal' : '';
    cards = `<div class="pk-seat-cards${rev}">${p.hole.map((c) => cardHtml(c, deck, 'mini')).join('')}</div>`;
  } else if (!isMe && p.inHand && !p.folded && p.holeCardCount) {
    cards = `<div class="pk-seat-cards">${Array.from({ length: p.holeCardCount }, () => `<span class="card back mini dk-${deck}"></span>`).join('')}</div>`;
  }
  const handName = p.holeShown && p.handName ? `<span class="pk-handname">${escapeHtml(p.handName)}</span>` : '';
  const bubble = em ? `<span class="pk-emote-bubble">${escapeHtml(em.bubble)}</span>` : '';
  return `
    <div class="${cls.join(' ')}" data-uid="${p.userId}" style="left:${x}%;top:${y}%">
      ${isDealer ? '<span class="pk-dealer-dot">D</span>' : ''}
      ${bubble}
      ${cards}
      <div class="pk-seat-box" style="--pc:${escapeHtml(p.color || '#64748b')}" title="${escapeHtml(p.displayName)}">
        <div class="char-2d">${dollHtml(p, 58, { sit: true, emote: em ? em.emote : null })}</div>
        <span class="pk-seat-name">${escapeHtml(p.displayName)}${isMe ? ' (você)' : ''}${p.isBot ? ' 🤖' : ''}</span>
        <span class="pk-seat-stack">${p.stack.toLocaleString('pt-BR')} 🪙${p.allIn ? ' · all-in' : ''}</span>
      </div>
      ${handName}
      ${p.bet ? `<span class="pk-seat-bet">${p.bet} 🪙</span>` : ''}
    </div>`;
}

function renderHeroHand(st, me, hint) {
  const bar = $('#pk-hero');
  if (!me || !me.inHand || me.folded || !myHole.length) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  const deck = st.deckStyle || 'classic';
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="pk-hero-cards">${myHole.map((c) => cardHtml(c, deck, 'big', hint && hint.keys && hint.keys.has(ckey(c)) ? 'hint-ring' : '')).join('')}</div>
    ${hint ? `<span class="pk-hint-chip">🧠 dica: <b>${hint.name}</b></span>` : ''}`;
}

function renderTable(st) {
  const me = st.players.find((p) => p.userId === state.user.id) || null;
  const deck = st.deckStyle || 'classic';
  const myTurnNow = st.state === 'playing' && !!me?.isTurn && !me.folded;
  if (myTurnNow && !wasMyTurn) playSfx('turn');
  wasMyTurn = myTurnNow;
  $('#pk-table-name').textContent = st.name;
  const roundTxt = st.state === 'playing' ? ROUND_LABEL[st.round] || '' : '';
  $('#pk-status').textContent = `Blinds ${st.sb}/${st.bb} 🪙${roundTxt ? ` · ${roundTxt}` : ''} · ${(DECKS[deck] || {}).name || ''}${st.hintMode ? ' · 🧠 dicas' : ''}`;

  const scene = $('#pk-scene');
  const myIndex = Math.max(0, st.players.findIndex((p) => p.userId === state.user.id));
  const n = st.players.length || 1;
  const layout = (isNarrow() ? MOBILE_LAYOUTS : LAYOUTS)[n] || LAYOUTS[6];
  const ordered = [];
  for (let k = 0; k < n; k++) ordered.push(st.players[(myIndex + k) % n]);

  const seats = ordered.map((p, k) => {
    const [x, y] = layout[Math.min(k, layout.length - 1)];
    return seatHtml(st, p, x, y, p.userId === state.user.id);
  }).join('');

  const startedHand = lastState && lastState.state === 'waiting' && st.state === 'playing';
  if (startedHand) {
    dealing = true;
    lastBoardLen = 0;
    clearTimeout(dealingTimer);
    dealingTimer = setTimeout(() => { dealing = false; }, 1500);
  }
  const boardFrom = startedHand ? 0 : st.board.length > lastBoardLen ? lastBoardLen : 99;
  const hint = st.hintMode ? pkHint(st) : null;
  scene.className = `pk-scene pk-theme-${deck}${dealing ? ' dealing' : ''}`;
  scene.innerHTML = `
    <div class="pk-felt"></div>
    ${boardRender(st, boardFrom, hint)}
    <div class="pk-pot">${st.pot > 0 ? `Pote <b>${st.pot}</b> 🪙` : ''}</div>
    ${seats}`;
  lastBoardLen = st.board.length;

  animateChips(st, lastState);
  renderHeroHand(st, me, hint);
  const heroBar = $('#pk-hero');
  if (heroBar) heroBar.classList.toggle('dealing', dealing);
  renderControls(st, me);
}

function flyCoins(fromEl, toEl, count = 3) {
  const layer = $('#coin-layer');
  if (!layer || !fromEl || !toEl || typeof fromEl.getBoundingClientRect !== 'function') return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  for (let i = 0; i < count; i++) {
    const c = document.createElement('span');
    c.className = 'flying-coin';
    c.style.left = `${ax}px`;
    c.style.top = `${ay}px`;
    c.style.animationDelay = `${i * 55}ms`;
    layer.appendChild(c);
    const dx = bx - ax;
    const dy = by - ay;
    requestAnimationFrame(() => {
      c.style.transform = `translate(${dx}px, ${dy}px) scale(.85)`;
      c.style.opacity = '0.15';
    });
    setTimeout(() => c.remove(), 700 + i * 55);
  }
}

function animateChips(st, prevState) {
  const scene = $('#pk-scene');
  const potEl = scene ? scene.querySelector('.pk-pot') : null;
  if (!potEl) return;
  let chipSound = false;
  let myChipSound = false;
  for (const p of st.players) {
    const prev = prevBets.get(p.userId) || 0;
    if (p.bet > prev) {
      const seat = scene.querySelector(`.pk-seat[data-uid="${p.userId}"]`);
      flyCoins(seat, potEl, Math.min(6, Math.max(1, Math.round((p.bet - prev) / 10))));
      chipSound = true;
      if (p.userId === state.user.id) myChipSound = true;
    }
  }
  if (chipSound) playSfx(myChipSound ? 'chips' : 'chip');
  const startedFinished = st.state === 'finished' && prevState && prevState.state !== 'finished';
  if (startedFinished && st.pot > 0) {
    const winners = new Set((st.results || []).filter((r) => (r.net ?? 0) > 0).map((r) => r.userId));
    for (const uid of winners) {
      const seat = scene.querySelector(`.pk-seat[data-uid="${uid}"]`);
      flyCoins(potEl, seat, 8);
    }
  }
  prevBets.clear();
  for (const p of st.players) prevBets.set(p.userId, p.bet);
}

function chip(n) {
  return Number(n).toLocaleString('pt-BR');
}

function renderControls(st, me) {
  const box = $('#pk-controls');
  const isHost = st.hostId === state.user.id;

  if (!me) {
    const canJoin = st.state !== 'playing';
    box.innerHTML = `
      <p class="muted">Você está assistindo.${canJoin ? '' : ' Espere esta mão terminar para sentar.'}</p>
      ${canJoin ? '<button class="btn primary" id="pk-join-seat">Sentar na mesa</button>' : ''}`;
    const j = $('#pk-join-seat');
    if (j) j.onclick = async () => { const r = await emit('poker:join', { tableId: st.id }); if (!r.ok) toast(r.error); };
    return;
  }

  if (st.state === 'waiting') {
    const saldo = state.wallet?.fichas ?? 0;
    const botCount = st.players.filter((p) => p.isBot).length;
    const deckBtns = Object.entries(DECKS).map(([k, d]) => `
      <button class="mini-deck ${k === st.deckStyle ? 'active' : ''}" data-deckpick="${k}"><span class="deck-mini mini-${k}"></span>${escapeHtml(d.name)}</button>`).join('');
    box.innerHTML = `
      <div class="pk-wait">
        <div>${st.players.length < 2 ? 'Aguardando mais jogadores (mínimo 2)…' : 'Todos prontos!'}</div>
        <div class="muted-sm">Nesta mão você entra com ${st.buyIn} 🪙 · seu saldo: ${chip(saldo)} 🪙</div>
        ${isHost ? `<div class="deck-pick-row"><span class="muted-sm">Baralho:</span>${deckBtns}</div>` : ''}
        ${isHost ? `
          <div class="pk-bot-row">
            <button class="btn ghost" id="pk-addbot" ${st.players.length >= st.maxPlayers ? 'disabled' : ''}>＋ Robô</button>
            <button class="btn ghost" id="pk-rembot" ${botCount ? '' : 'disabled'}>− Robô</button>
          </div>` : ''}
        ${isHost
          ? `<button class="btn primary big" id="pk-start" ${st.players.length >= 2 ? '' : 'disabled'}>Iniciar mão</button>`
          : '<span class="muted">Aguardando o anfitrião iniciar…</span>'}
      </div>`;
    const s = $('#pk-start');
    if (s) s.onclick = async () => { const r = await emit('poker:start', { tableId: st.id }); if (!r.ok) toast(r.error); else onWalletChange(); };
    const ab = $('#pk-addbot');
    if (ab) ab.onclick = async () => { playSfx('chip'); const r = await emit('poker:addbot', { tableId: st.id }); if (!r.ok) toast(r.error); };
    const rb = $('#pk-rembot');
    if (rb) rb.onclick = async () => { playSfx('chip'); const r = await emit('poker:removebot', { tableId: st.id }); if (!r.ok) toast(r.error); };
    $$('[data-deckpick]', box).forEach((b) => {
      b.onclick = async () => {
        playSfx('flip');
        const r = await emit('poker:deck', { tableId: st.id, deckStyle: b.dataset.deckpick });
        if (!r.ok) toast(r.error);
      };
    });
    return;
  }

  if (st.state === 'playing') {
    if (!me.inHand) { box.innerHTML = '<p class="muted">Você está de fora desta mão.</p>'; return; }
    if (me.folded) { box.innerHTML = '<p class="muted">Você desistiu desta mão. Aguardando o fim…</p>'; return; }
    if (!me.isTurn) { box.innerHTML = '<p class="muted">Aguardando a jogada dos outros…</p>'; return; }

    const toCall = Math.max(0, st.currentBet - me.bet);
    const maxTo = me.bet + me.stack;
    const minRaiseTo = Math.min(Math.max(st.currentBet + st.minRaise, st.bb), maxTo);
    const canRaise = maxTo > st.currentBet && me.stack > 0;
    box.innerHTML = `
      <div class="pk-actions">
        <button class="btn big" id="pk-fold">Desistir</button>
        ${toCall > 0
          ? `<button class="btn primary big" id="pk-call">Pagar ${chip(Math.min(toCall, me.stack))}</button>`
          : '<button class="btn primary big" id="pk-check">Mesa</button>'}
        ${canRaise ? '<button class="btn gold big" id="pk-raise">Aumentar</button>' : ''}
      </div>
      ${canRaise ? `
      <div class="pk-raise-row hidden" id="pk-raise-row">
        <input type="range" id="pk-raise-range" min="${minRaiseTo}" max="${maxTo}" step="${st.bb}" value="${minRaiseTo}" />
        <input type="number" id="pk-raise-amt" min="${minRaiseTo}" max="${maxTo}" step="${st.bb}" value="${minRaiseTo}" />
        <div class="pk-quick">
          <button class="chip" data-quick="min">Mín</button>
          <button class="chip" data-quick="half">½ pote</button>
          <button class="chip" data-quick="pot">Pote</button>
          <button class="chip" data-quick="allin">All-in</button>
        </div>
        <button class="btn primary" id="pk-raise-go">Confirmar</button>
      </div>` : ''}`;

    const act = async (action) => {
      if (action.type === 'fold') playSfx('fold');
      else if (action.type === 'raise') playSfx((action.amount || 0) >= maxTo ? 'allin' : 'raise');
      else playSfx('chip');
      const r = await emit('poker:action', { tableId: st.id, action });
      if (!r.ok) toast(r.error);
    };
    $('#pk-fold').onclick = () => act({ type: 'fold' });
    const callBtn = $('#pk-call');
    if (callBtn) callBtn.onclick = () => act({ type: 'call' });
    const checkBtn = $('#pk-check');
    if (checkBtn) checkBtn.onclick = () => act({ type: 'check' });

    const raiseBtn = $('#pk-raise');
    if (raiseBtn) {
      const row = $('#pk-raise-row');
      const range = $('#pk-raise-range');
      const amt = $('#pk-raise-amt');
      const clamp = (v) => Math.max(minRaiseTo, Math.min(maxTo, Math.round(Number(v) || 0)));
      const sync = (v) => { const c = clamp(v); range.value = c; amt.value = c; };
      raiseBtn.onclick = () => row.classList.toggle('hidden');
      range.oninput = () => sync(range.value);
      amt.oninput = () => sync(amt.value);
      $$('[data-quick]', row).forEach((b) => {
        b.onclick = () => {
          const pot = st.pot;
          let v = minRaiseTo;
          if (b.dataset.quick === 'half') v = st.currentBet + Math.max(st.minRaise, Math.round(pot / 2));
          else if (b.dataset.quick === 'pot') v = st.currentBet + Math.max(st.minRaise, pot);
          else if (b.dataset.quick === 'allin') v = maxTo;
          sync(v);
        };
      });
      $('#pk-raise-go').onclick = () => act({ type: 'raise', amount: clamp(amt.value) });
    }
    return;
  }

  if (st.state === 'finished') {
    const res = st.results || [];
    const lines = res.length
      ? res.map((r) => {
        const u = st.players.find((pp) => pp.userId === r.userId) || {};
        const nv = r.net ?? r.amount ?? 0;
        return `<div class="pk-result-row ${r.userId === state.user.id ? 'me' : ''}">
          <span>${escapeHtml(u.displayName || 'Jogador')}${r.handName ? ` · <em>${escapeHtml(r.handName)}</em>` : ''}</span>
          <b class="${nv > 0 ? 'win' : nv < 0 ? 'lose' : ''}">${nv > 0 ? '+' : ''}${nv} 🪙</b>
        </div>`;
      }).join('')
      : '<p class="muted">—</p>';
    box.innerHTML = `
      <div class="pk-results">
        <h4>Resultado da mão</h4>
        ${lines}
      </div>
      <div class="pk-actions">
        ${isHost
          ? '<button class="btn primary big" id="pk-next">Próxima mão ▶</button>'
          : '<span class="muted">Aguardando o anfitrião abrir a próxima mão…</span>'}
      </div>`;
    const nx = $('#pk-next');
    if (nx) nx.onclick = async () => { const r = await emit('poker:next', { tableId: st.id }); if (!r.ok) toast(r.error); };
  }
}
