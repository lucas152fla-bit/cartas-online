import { api } from './api.js';
import { state } from './state.js';
import { $, escapeHtml, toast, openModal, closeModal, userAvatarHtml } from './ui.js';
import { avatarSpec, characterCanvas, AVATAR_DEFAULTS } from './avatar3d.js';
import { celebrate } from './celebrate.js';
import { playSfx } from './sound.js';

let sock = null;
let onWalletChange = () => {};
let myTableId = null;
let prevState = null;

let prevSnap = null;
let lastVoiceText = '';
let lastTable = null;
let dealTimer = null;
let shuffleTimer = null;
let lastShuffleTick = 0;
let wasMyTurn = false;

const MAX_DECK_CHARS = 14;
const STATE_LABEL = {
  waiting: 'Sala de espera',
  playing: 'Em jogo',
  dealer: 'Banca jogando…',
  finished: 'Rodada encerrada',
};

const OUTCOME_LABEL = {
  blackjack: '21!',
  venceu: 'venceu',
  empate: 'empate',
  perdeu: 'perdeu',
  saiu: 'fora',
};

export const DECKS = {
  classic: { name: 'Clássico', desc: 'Tradicional, branca e vermelho' },
  royal: { name: 'Royal', desc: 'Azul-marinho e dourado' },
  neon: { name: 'Neon', desc: 'Preta com brilho neon' },
};

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const PIP_LAYOUT = {
  A: [[0.5, 0.5]],
  2: [[0.5, 0.22], [0.5, 0.78]],
  3: [[0.5, 0.18], [0.5, 0.5], [0.5, 0.82]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.18], [0.75, 0.18], [0.25, 0.5], [0.75, 0.5], [0.25, 0.82], [0.75, 0.82]],
  7: [[0.25, 0.18], [0.75, 0.18], [0.25, 0.5], [0.5, 0.34], [0.75, 0.5], [0.25, 0.82], [0.75, 0.82]],
  8: [[0.25, 0.16], [0.75, 0.16], [0.25, 0.42], [0.75, 0.42], [0.5, 0.29], [0.25, 0.68], [0.75, 0.68], [0.5, 0.84]],
  9: [[0.25, 0.16], [0.75, 0.16], [0.5, 0.16], [0.25, 0.42], [0.75, 0.42], [0.5, 0.52], [0.25, 0.68], [0.75, 0.68], [0.5, 0.84]],
  10: [[0.25, 0.16], [0.75, 0.16], [0.5, 0.16], [0.25, 0.42], [0.75, 0.42], [0.5, 0.42], [0.25, 0.68], [0.75, 0.68], [0.5, 0.68], [0.5, 0.86]],
};

let clockTimer = null;

function startClockLoop() {
  if (clockTimer) return;
  startClockLoop.tickEls = () => {
    for (const el of $$('.bj-countdown')) {
      const left = Number(el.dataset.left || 0);
      const tick = Number(el.dataset.tick || Date.now());
      const sec = Math.max(0, Math.ceil((left - (Date.now() - tick)) / 1000));
      el.textContent = `${sec}s`;
      el.classList.toggle('urgent', sec > 0 && sec <= 5);
    }
  };
  startClockLoop.tickEls();
  clockTimer = setInterval(startClockLoop.tickEls, 400);
}

function countdownHtml(st, cls = '') {
  if (!st.phase) return '';
  const p = st.phase;
  return `<span class="bj-countdown ${cls}" data-left="${p.left}" data-tick="${p.tick}">${Math.ceil(p.left / 1000)}s</span>`;
}

export function initBlackjack({ socket, refreshWallet }) {
  sock = socket;
  onWalletChange = refreshWallet || (() => {});
  startClockLoop();
  sock.on('table:state', (st) => {
    if (st.id !== myTableId) return;
    if (st.state === 'playing' && prevState !== 'playing') onWalletChange();
    if (st.state === 'finished' && prevState !== 'finished') onWalletChange();
    renderTable(st);
    prevState = st.state;
  });
}

function emit(event, payload) {
  return new Promise((resolve) => {
    if (!sock) return resolve({ ok: false, error: 'Sem conexão.' });
    const t = setTimeout(() => resolve({ ok: false, error: 'Tempo esgotado.' }), 6000);
    sock.emit(event, payload, (res) => { clearTimeout(t); resolve(res || { ok: true }); });
  });
}

export async function openBlackjackLobby() {
  $('#bj-table').classList.add('hidden');
  $('#bj-lobby').classList.remove('hidden');
  await loadTables();
}

export function enterJogar() {
  if (myTableId != null) {
    $('#bj-lobby').classList.add('hidden');
    $('#bj-table').classList.remove('hidden');
  } else {
    openBlackjackLobby();
  }
}

async function loadTables() {
  const box = $('#bj-lobby');
  let tables = [];
  try {
    ({ tables } = await api.tables());
  } catch (e) {
    box.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    return;
  }
  box.innerHTML = tables.length
    ? tables.map((t) => `
      <div class="bj-lobby-item">
        <div class="deck-mini mini-${t.deckStyle}"></div>
        <div class="grow">
          <strong>${escapeHtml(t.name)}</strong>
          <small>Anfitrião ${escapeHtml(t.host)} · ${t.players}/${t.maxPlayers} jogadores${t.bots ? ` + ${t.bots} 🤖` : ''} · aposta mín. ${t.minBet} 🪙 · ${(DECKS[t.deckStyle] || {}).name || 'Clássico'} · turno ${Math.round((t.turnMs || 30000) / 1000)}s · até ${t.maxDraw || 3} cartas</small>
        </div>
        <span class="bj-tag ${t.state}">${STATE_LABEL[t.state] || t.state}</span>
        <button class="btn primary" data-enter="${t.id}" ${t.players >= t.maxPlayers && t.state !== 'finished' ? 'disabled' : ''}>Entrar</button>
      </div>`).join('') : '<p class="muted">Nenhuma mesa aberta. Crie uma para jogar com os amigos (ou contra um robô).</p>';
  box.querySelectorAll('[data-enter]').forEach((b) => {
    b.onclick = () => openTable(Number(b.dataset.enter));
  });
}

const TIME_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];

function timeOptions(selected) {
  return TIME_PRESETS.map((s) => `<option value="${s}" ${s === selected ? 'selected' : ''}>${s} s</option>`).join('');
}

function drawOptions(selected) {
  return [1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === selected ? 'selected' : ''}>${n} carta${n > 1 ? 's' : ''}</option>`).join('');
}

export function openCreateTable() {
  const deckBtns = Object.entries(DECKS).map(([k, d], i) => `
    <button class="deck-option ${i === 0 ? 'selected' : ''}" data-deck="${k}">
      <span class="deck-mini mini-${k}"></span>
      <span class="deck-txt"><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.desc)}</small></span>
    </button>`).join('');
  openModal(`
    <h3>Nova mesa de 21</h3>
    <label>Nome da mesa<input id="bj-name" maxlength="40" placeholder="Mesa do Lukaz" /></label>
    <label>Baralho</label>
    <div class="deck-picker">${deckBtns}</div>
    <div class="settings-grid">
      <label>Tempo de escolha por jogador
        <select id="bj-turn">${timeOptions(30)}</select></label>
      <label>Tempo de aposta / nova rodada
        <select id="bj-interval">${timeOptions(25)}</select></label>
      <label>Máximo de cartas viradas do centro
        <select id="bj-maxdraw">${drawOptions(3)}</select></label>
    </div>
    <label class="toggle-row">
      <input type="checkbox" id="bj-hint" />
      <span><b>Modo dicas 🧠</b><small>destaca em dourado as cartas que formam sua mão (ex: 21) e mostra dicas de compra. As rodadas valem as mesmas moedas e rankings de sempre.</small></span>
    </label>
    <label>Quantidade de robôs</label>
    <div class="bot-pick-row" id="bot-pick-row">
      ${[0, 1, 2, 3, 4, 5].map((n) => `<button type="button" class="chip ${n === 0 ? 'active' : ''}" data-bots="${n}"><b>${n}</b></button>`).join('')}
    </div>
    <p class="muted" style="font-size:.85rem">A aposta mínima é de 10 🪙 por rodada. Se um jogador cair no meio da partida, um robô assume o lugar até ele voltar. As fases avançam sozinhas conforme o tempo escolhido.</p>
    <div class="modal-actions">
      <button class="btn ghost" id="bj-cancel">Cancelar</button>
      <button class="btn primary" id="bj-confirm">Criar</button>
    </div>`);
  $('#bj-cancel').onclick = closeModal;
  let deckChoice = 'classic';
  let botChoice = 0;
  $$('.deck-option').forEach((b) => b.onclick = () => {
    $$('.deck-option').forEach((x) => x.classList.toggle('selected', x === b));
    deckChoice = b.dataset.deck;
  });
  $$('#bot-pick-row .chip').forEach((b) => b.onclick = () => {
    $$('#bot-pick-row .chip').forEach((x) => x.classList.toggle('active', x === b));
    botChoice = Number(b.dataset.bots);
  });
  $('#bj-confirm').onclick = async () => {
    try {
      const { table } = await api.createTable({
        name: $('#bj-name').value,
        deckStyle: deckChoice,
        bots: botChoice,
        turnMs: Number($('#bj-turn').value) * 1000,
        intervalMs: Number($('#bj-interval').value) * 1000,
        maxDraw: Number($('#bj-maxdraw').value),
        hint: $('#bj-hint').checked,
      });
      closeModal();
      await openTable(table.id);
    } catch (e) {
      toast(e.message);
    }
  };
}

export async function openTable(tableId) {
  myTableId = tableId;
  prevState = null;
  prevSnap = null;
  lastVoiceText = '';
  lastShuffleTick = 0;
  wasMyTurn = false;
  clearTimeout(dealTimer);
  clearTimeout(shuffleTimer);
  const v = $('#bj-voice');
  if (v) v.textContent = '';
  $('#bj-scene')?.classList.remove('dealing');
  $('#bj-lobby').classList.add('hidden');
  $('#bj-table').classList.remove('hidden');
  $('#bj-table-name').textContent = 'Mesa';
  document.querySelector('.content')?.scrollTo?.({ top: 0 });
  const res = await emit('table:join', { tableId });
  if (!res.ok) {
    toast(res.error || 'Não foi possível entrar.');
    await openBlackjackLobby();
  }
}

export function inTable() {
  return myTableId != null;
}

export async function leaveTable() {
  if (myTableId != null) await emit('table:leave', { tableId: myTableId });
  myTableId = null;
  prevState = null;
  prevSnap = null;
  lastVoiceText = '';
  clearTimeout(dealTimer);
  const v = $('#bj-voice');
  if (v) v.textContent = '';
  await openBlackjackLobby();
}

const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function isRed(card) {
  return card.suit === '♥' || card.suit === '♦';
}

function pipHtml(card) {
  const rank = card.rank;
  if (rank === 'A') return `<span class="big-suit">${card.suit}</span>`;
  if (['J', 'Q', 'K'].includes(rank)) {
    return `
      <span class="face-bg">${card.suit}</span>
      <span class="face-monogram">${rank}</span>`;
  }
  const dots = (PIP_LAYOUT[rank] || []).map(([x, y]) =>
    `<i style="left:${(x * 100).toFixed(1)}%;top:${(y * 100).toFixed(1)}%"></i>`).join('');
  return `<span class="pips">${dots}</span>`;
}

export function cardHtml(card, deck = 'classic', size = '', extra = '') {
  const ex = extra ? ` ${extra}` : '';
  const hidden = !card || card.rank === '?';
  if (hidden) return `<span class="card back ${size} dk-${deck}${ex}"></span>`;
  const red = isRed(card) ? 'red' : '';
  const pip = pipHtml(card);
  const corner = `<i>${card.rank}</i><b>${card.suit}</b>`;
  return `<span class="card face ${size} dk-${deck}${ex} ${red}" data-rank="${card.rank}">
    <span class="corner tl">${corner}</span>
    <span class="corner br">${corner}</span>
    <span class="body">${pip}</span>
  </span>`;
}

const DEALER_DOLL = { character: { skin: '#e8b58a', hair: '#5b3a2a', shirt: '#2a3a48', hat: 'tophat' } };

function dollHtml(p, size, opts = {}) {
  const spec = avatarSpec({ character: p?.character || {} });
  const canvas = characterCanvas(spec, size, { sit: !!opts.sit });
  return `<img class="doll" alt="" draggable="false" src="${canvas.toDataURL()}">`;
}

function seatMood(p, st, roundDeal) {
  const parts = [];
  if (st.state === 'playing' && p.isTurn) parts.push('turn');
  if (roundDeal) parts.push('deal');
  if (st.state === 'finished') {
    if (p.blackjack || p.delta > 0) parts.push('win');
    else if (p.busted || p.delta < 0 || p.outcome === 'saiu') parts.push('lose');
    else parts.push('tie');
  }
  return parts.join(' ');
}

function seatPositions(total) {
  const spots = [];
  if (total <= 0) return spots;
  const narrow = window.innerWidth <= 640;
  // Em telas estreitas os assentos ficam mais afastados das bordas para não
  // serem cortados nem encostar uns nos outros.
  const clamps = narrow ? [10, 90, 14, 96] : [6, 94, 4, 96];
  if (total === 1) {
    const a = (-90 * Math.PI) / 180;
    spots.push([50 + 42 * Math.cos(a), 50 + 44 * Math.sin(a)]);
    return spots;
  }
  const from = -165;
  const to = -15;
  for (let i = 0; i < total; i++) {
    const deg = total === 1 ? -90 : from + ((to - from) * i) / (total - 1);
    const a = (deg * Math.PI) / 180;
    const x = 50 + 42 * Math.cos(a);
    const y = 50 + 45 * Math.sin(a);
    spots.push([Math.max(clamps[0], Math.min(clamps[1], x)), Math.max(clamps[2], Math.min(clamps[3], y))]);
  }
  return spots;
}

function chipStack(bet, max = 5) {
  if (!bet) return '';
  const rows = [];
  const count = Math.min(max, Math.ceil(bet / 50));
  for (let i = 0; i < count; i++) rows.push('<span class="stack-chip"></span>');
  return `<span class="chip-stack" title="${bet} 🪙">${rows.join('')}<b>${bet}</b></span>`;
}

function turnTimerHtml(st, p) {
  if (!st.phase || st.phase.name !== 'turn') return '';
  if (!p.isTurn || p.isBot || p.ai) return '';
  return `<span class="turn-timer bj-countdown" data-left="${st.phase.left}" data-tick="${st.phase.tick}">s</span>`;
}

function seatChip(p, opts = {}) {
  const me = opts.me;
  const motion = [];
  if (opts.dealt) motion.push('dealt');
  if (opts.state === 'playing' && p.isTurn) motion.push('turn');
  if (opts.state === 'finished' && (p.outcome === 'blackjack' || p.outcome === 'venceu')) motion.push('won');
  else if (opts.state === 'finished' && p.outcome === 'perdeu') motion.push('lost');
  if (p.ai && opts.state !== 'waiting') motion.push('ai');
  return `
    <div class="seat-chip ${motion.join(' ')} ${me ? 'me' : ''}" data-uid="${p.userId ?? ''}" data-seat="${opts.seatIndex ?? ''}" style="--pc:${escapeHtml(p.color || '#64748b')}" title="Ver perfil">
      ${turnTimerHtml({ phase: opts.phase }, p)}
      <div class="char-2d">${dollHtml(p, opts.size === 'lg' ? 84 : 62, { sit: true })}</div>
      <div class="seat-name" title="${escapeHtml(p.displayName)}">${escapeHtml(p.displayName)}${me ? ' (você)' : ''}</div>
    </div>`;
}

function emptySeatSlot(st) {
  const canJoin = st.state === 'waiting' || st.state === 'finished';
  return `
    <div class="seat-chip empty" data-join="${canJoin ? '1' : ''}" title="${canJoin ? 'Sentar na mesa' : 'Lugar reservado'}">
      <div class="empty-char">＋</div>
      <div class="seat-name muted-sm">${canJoin ? 'sentar' : 'aguardando…'}</div>
    </div>`;
}

function dealerHtml(st, deck, opts = {}) {
  const d = st.dealer;
  const total = d.cards.length ? d.total : '';
  return `
    <div class="dealer-slot ${opts.speaking ? 'speaking' : ''}">
      ${opts.bubble ? `<div class="speech-bubble">${opts.bubble}</div>` : ''}
      <div class="dealer-cards">${d.cards.map((c) => cardHtml(c, deck, 'med')).join('')}</div>
      <div class="dealer-foot">
        <span class="croupier ${st.state === 'dealer' ? 'dealer-turn' : ''}" title="Banca (croupier)">${dollHtml(DEALER_DOLL, 88)}</span>
        <div class="dealer-label">Banca${total ? ` · <b>${total}</b>` : ''}${d.blackjack ? ' <span class="seat-tag win">21!</span>' : ''}</div>
      </div>
    </div>`;
}

const seatKey = (p) => ({ c: p.cards.length, s: +p.stood, b: +p.busted, d: +p.doubled, bj: +p.blackjack, t: +p.isTurn, o: p.outcome || '' });
const shorter = (p) => (p.userId === state.user.id ? 'Você' : p.displayName);

function finishLine(st) {
  const d = st.dealer;
  let v = d.total > 21 ? `🏁 Rodada encerrada — a banca estourou (${d.total})!` : `🏁 Rodada encerrada — banca parou em ${d.total}.`;
  const bjs = st.players.filter((p) => p.outcome === 'blackjack');
  if (bjs.length) v += ' ' + bjs.map((p) => `${shorter(p)} acertou 21! 🌟`).join(' ');
  const partes = st.players.filter((p) => p.outcome && p.outcome !== 'saiu' && !p.isBot);
  if (partes.length) v += ' ' + partes.slice(0, 4).map((p) => `${shorter(p)} ${OUTCOME_LABEL[p.outcome] || p.outcome}${p.delta ? (p.delta > 0 ? ` +${p.delta}🪙` : ` ${p.delta}🪙`) : ''}`).join(' · ');
  return v;
}

function showRoundBanner(st) {
  const scene = $('#bj-scene');
  if (!scene) return;
  const rows = st.players
    .filter((p) => !p.isBot && p.outcome && p.outcome !== 'saiu')
    .slice(0, 6)
    .map((p) => {
      const tag = OUTCOME_LABEL[p.outcome] || p.outcome;
      const cls = p.outcome === 'blackjack' || p.outcome === 'venceu' ? 'win' : p.outcome === 'perdeu' ? 'lose' : '';
      const diff = p.delta ? (p.delta > 0 ? ` +${p.delta}` : ` ${p.delta}`) : '';
      return `<div class="rb-row ${cls}"><span>${escapeHtml(p.displayName)}</span><b>${tag}${diff} 🪙</b></div>`;
    });
  const old = scene.querySelector('.round-banner');
  if (old) old.remove();
  const b = document.createElement('div');
  b.className = 'round-banner';
  b.innerHTML = `<h4>🏁 Fim da rodada</h4>${rows.join('') || '<p class="muted">Ninguém jogou.</p>'}`;
  scene.appendChild(b);
  requestAnimationFrame(() => b.classList.add('show'));
}

function openTableSettings(st) {
  if (!st) return;
  openModal(`
    <h3>⚙️ Configurações da sala</h3>
    <div class="settings-grid">
      <label>Tempo de escolha por jogador
        <select id="set-turn">${timeOptions(Math.round((st.turnMs || 30000) / 1000))}</select></label>
      <label>Tempo de aposta / nova rodada
        <select id="set-interval">${timeOptions(Math.round((st.intervalMs || 25000) / 1000))}</select></label>
      <label>Máximo de cartas viradas do centro
        <select id="set-maxdraw">${drawOptions(st.maxDraw || 3)}</select></label>
    </div>
    <p class="muted" style="font-size:.85rem">Vale a partir da próxima rodada. As fases avançam sozinhas; o anfitrião pode pular a qualquer momento.</p>
    <div class="modal-actions">
      <button class="btn ghost" id="set-cancel">Cancelar</button>
      <button class="btn primary" id="set-save">Salvar</button>
    </div>`);
  $('#set-cancel').onclick = closeModal;
  $('#set-save').onclick = async () => {
    const r = await emit('table:settings', {
      tableId: st.id,
      turnMs: Number($('#set-turn').value) * 1000,
      intervalMs: Number($('#set-interval').value) * 1000,
      maxDraw: Number($('#set-maxdraw').value),
    });
    closeModal();
    if (!r.ok) toast(r.error || 'Não foi possível salvar.');
  };
}

function narrate(st) {
  const events = [];
  const bubbleBy = {};
  const snap = { state: st.state, seats: {}, dealer: { c: st.dealer.cards.length } };
  for (const p of st.players) snap.seats[p.userId ?? p.displayName] = seatKey(p);
  const prev = prevSnap;

  if (prev && prev.state === 'waiting' && st.state === 'playing') {
    events.push('🎲 Rodada começou! O croupier distribui as cartas…');
    playSfx('deal');
  }
  if (prev && prev.state !== 'dealer' && st.state === 'dealer') {
    events.push('🎩 Agora a banca joga — compra até 17…');
  }
  if (prev && prev.state !== 'finished' && st.state === 'finished') {
    events.push(finishLine(st));
  }
  if (st.state === 'playing' && prev && prev.state === 'playing') {
    for (const p of st.players) {
      const k = seatKey(p);
      const o = prev.seats[p.userId ?? p.displayName];
      if (!o) continue;
      const who = shorter(p);
      if (k.c > o.c) {
        events.push(`${who} pediu carta — ${p.total || k.c}.`);
        bubbleBy[p.userId ?? p.displayName] = p.isBot ? 'Pediu carta!' : `Pediu carta! (${p.total})`;
        playSfx('deal');
      }
      if (k.bj && !o.bj) {
        events.push(`${who} fez 21! 🌟`);
        bubbleBy[p.userId ?? p.displayName] = '21! 🌟';
        playSfx('blackjack');
      }
      if (k.s && !o.s) {
        events.push(`${who} parou em ${p.total}.`);
        bubbleBy[p.userId ?? p.displayName] = `Parou (${p.total})`;
      }
      if (k.b && !o.b) {
        events.push(`${who} estourou, saiu da disputa! 💥`);
        bubbleBy[p.userId ?? p.displayName] = 'Estourou! 💥';
        playSfx('bust');
      }
      if (k.d && !o.d) {
        events.push(`${who} dobrou a aposta (${p.bet} 🪙)!`);
        bubbleBy[p.userId ?? p.displayName] = 'Dobrou ×2!';
        playSfx('chips');
      }
    }
  }
  if (prev && st.state === 'dealer') {
    const pc = prev.dealer ? prev.dealer.c : 0;
    if (st.dealer.cards.length > pc) { events.push(`🎩 Banca comprou mais uma carta — ${st.dealer.total}.`); playSfx('deal'); }
  }
  if (st.state === 'playing' && st.activeIndex != null && st.players[st.activeIndex]) {
    const cur = st.players[st.activeIndex];
    const key = cur.userId ?? cur.displayName;
    if (!bubbleBy[key]) {
      bubbleBy[key] = cur.userId === state.user.id ? 'É a minha vez!' : cur.ai ? 'O robô joga por ele…' : 'Vez de jogar!';
    }
  }
  prevSnap = snap;
  return { events, bubbleBy };
}

export function renderTable(st) {
  lastTable = st;
  const wasWaiting = prevState === 'waiting';
  const gameOver = st.state === 'finished';
  const waiting = st.state === 'waiting';
  const deck = st.deckStyle || 'classic';

  $('#bj-table-name').textContent = st.name;
  $('#bj-status').textContent = `${STATE_LABEL[st.state] || st.state} · mínimo ${st.minBet} 🪙 · baralho ${(DECKS[st.deckStyle] || {}).name || ''}${st.hintMode ? ' · 🧠 dicas' : ''}`;
  const phaseEl = $('#bj-phase');
  if (phaseEl) {
    if (st.phase && st.phase.name === 'turn') {
      const cur = st.players[st.activeIndex];
      phaseEl.innerHTML = cur
        ? `Vez de <b>${escapeHtml(cur.userId === state.user.id ? 'você' : cur.displayName)}</b> ${countdownHtml(st)}`
        : '';
    } else if (st.phase && st.phase.name === 'waiting') {
      phaseEl.innerHTML = `Apostas fecham em ${countdownHtml(st)}`;
    } else if (st.phase && st.phase.name === 'finished') {
      phaseEl.innerHTML = `Nova rodada em ${countdownHtml(st)}`;
    } else {
      phaseEl.innerHTML = '';
    }
  }

  const mePlayer = st.players.find((p) => p.userId === state.user.id) || null;
  const others = st.players.filter((p) => p.userId !== state.user.id);

  const { events, bubbleBy } = narrate(st);
  const bubble = (p) => bubbleBy[p.userId ?? p.displayName] || '';

  const myTurnNow = st.state === 'playing' && !!mePlayer?.isTurn;
  if (myTurnNow && !wasMyTurn) playSfx('turn');
  wasMyTurn = myTurnNow;

  if (st.state === 'finished' && prevState && prevState !== 'finished' && mePlayer) {
    if (mePlayer.outcome === 'blackjack') playSfx('blackjack');
    else if (mePlayer.delta > 0) playSfx('win');
    else if (mePlayer.busted || mePlayer.delta < 0) playSfx('lose');
  }

  const voice = events.length
    ? events[events.length - 1]
    : waiting ? '🃏 Sala de espera — faça sua aposta e aguarde o anfitrião iniciar.'
    : (st.state === 'playing' ? undefined : st.state === 'dealer' ? '🎩 A banca decide a rodada…' : '🏁 Rodada encerrada.');
  if (voice !== undefined && voice !== lastVoiceText) {
    lastVoiceText = voice;
    const v = $('#bj-voice');
    if (v) {
      v.textContent = voice;
      v.classList.remove('pop');
      void v.offsetWidth;
      v.classList.add('pop');
    }
  }

  const scene = $('#bj-scene');
  const shuffledNow = st.shuffleTick && st.shuffleTick !== lastShuffleTick;
  if (shuffledNow) lastShuffleTick = st.shuffleTick;
  if (wasWaiting && st.state === 'playing') {
    scene.classList.add('dealing');
    clearTimeout(dealTimer);
    dealTimer = setTimeout(() => scene.classList.remove('dealing'), 1800);
  }
  if (shuffledNow || (prevState === 'finished' && st.state === 'waiting')) {
    scene.classList.add('reshuffling');
    clearTimeout(shuffleTimer);
    shuffleTimer = setTimeout(() => scene.classList.remove('reshuffling'), 1100);
  }

  const dealt = new Set();
  st.players.forEach((p, i) => {
    const bub = bubble(p);
    if ((wasWaiting && st.state === 'playing' && !p.sittingOut) || bub.includes('Pediu carta') || bub === '21! 🌟' || bub.includes('Estourou')) dealt.add(i);
  });

  let emptySlots = 0;
  if (waiting) {
    emptySlots = Math.max(0, Math.min(4, st.maxPlayers - st.players.length));
  }
  const oppPos = seatPositions(others.length + emptySlots);
  const oppHtml = others.map((p, i) => `
    <div class="opp-wrap" style="left:${oppPos[i]?.[0] ?? 50}%;top:${oppPos[i]?.[1] ?? 50}%">
      ${seatChip(p, { state: st.state, phase: st.phase, size: opponentCharSize(st.players.length), me: false, seatIndex: st.players.indexOf(p), dealt: dealt.has(st.players.indexOf(p)), bubble: bubble(p) })}
      ${p.cards.length ? `<div class="opp-cards ${st.hintMode && p.total === 21 ? 'ring-gold' : ''}">${p.cards.map((c) => cardHtml(c, deck, 'mini')).join('')}</div>` : ''}
    </div>`).join('');
  const emptyHtml = Array.from({ length: emptySlots }, (_, k) => `
    <div class="opp-wrap" style="left:${oppPos[others.length + k]?.[0] ?? 50}%;top:${oppPos[others.length + k]?.[1] ?? 50}%">
      ${emptySeatSlot(st)}
    </div>`).join('');

  const meIdx = mePlayer ? st.players.indexOf(mePlayer) : -1;
  const meZone = mePlayer ? `
    <div class="me-zone">
      <div class="hand-zone">
        <div class="hand ${mePlayer.cards.length ? '' : 'empty-hand'} ${st.hintMode && mePlayer.total === 21 ? 'ring-gold' : ''}" data-deck="${deck}">
          ${mePlayer.cards.length ? mePlayer.cards.map((c) => cardHtml(c, deck, 'big')).join('') : '<span class="hand-placeholder">sua mão aparecerá aqui</span>'}
        </div>
        <div class="hand-meta">
          <span class="hand-nick">${escapeHtml(mePlayer.displayName)} (você)</span>
          ${mePlayer.cards.length ? `<span class="hand-total">Total <b>${mePlayer.total}</b></span>` : ''}
          ${st.hintMode && mePlayer.cards.length ? `<span class="hand-hint">${mePlayer.total === 21 ? '⭐ 21 — mão dourada!' : `🧠 mão em ${mePlayer.total} — a compra trava no 21, você não estoura`}</span>` : ''}
          <span class="hand-bet">${mePlayer.bet ? `Aposta <b>${mePlayer.bet} 🪙</b>` : ''}</span>
          <span class="hand-outcome">${gameOver && mePlayer.outcome
            ? `<b class="${mePlayer.delta > 0 ? 'win' : mePlayer.delta < 0 ? 'lose' : ''}">${OUTCOME_LABEL[mePlayer.outcome] || mePlayer.outcome} ${mePlayer.delta > 0 ? `+${mePlayer.delta}` : mePlayer.delta < 0 ? mePlayer.delta : ''} 🪙</b>`
            : ''}</span>
        </div>
      </div>
    </div>` : '';

  const meBar = $('#bj-me-bar');
  if (meBar) {
    if (mePlayer) {
      const mood = [st.state === 'playing' && mePlayer.isTurn ? 'turn' : '', dealt.has(meIdx) ? 'dealt' : ''].filter(Boolean).join(' ');
      meBar.classList.remove('hidden');
      meBar.innerHTML = `
        <div class="me-doll ${mood}" title="Ver meu card">${dollHtml(mePlayer, 84, { sit: true })}</div>
        <div class="me-nick"><b>${escapeHtml(mePlayer.displayName)}</b> <span class="muted-sm">(você)</span><small>toque para ver o card</small></div>
        <div class="me-chips">${mePlayer.bet ? chipStack(mePlayer.bet, 4) : ''}</div>`;
      meBar.onclick = () => { if (mePlayer) openSeatProfile(meIdx); };
    } else {
      meBar.classList.add('hidden');
    }
  }

  const dealerBubble = st.state === 'dealer'
    ? (st.dealer.cards.length <= 2 ? 'Comprando…' : st.dealer.total > 21 ? 'Estourou!' : 'Vou parar!')
    : (wasWaiting && st.state === 'playing' ? 'Distribuindo…' : '');

  scene.innerHTML = `
    ${dealerHtml(st, deck, { bubble: dealerBubble, speaking: !!dealerBubble || st.state === 'dealer' })}
    ${oppHtml}
    ${emptyHtml}
    <div class="felt-deck" title="Baralho ${(DECKS[deck] || {}).name || ''} · ${st.deckLeft ?? ''} de ${st.deckTotal ?? ''} cartas">
      <span class="card back ${deck ? `dk-${deck}` : ''} small"></span>
      <span class="card back ${deck ? `dk-${deck}` : ''} small"></span>
      <span class="card back ${deck ? `dk-${deck}` : ''} small"></span>
      <b class="deck-count">${st.deckLeft ?? ''}</b>
    </div>
    ${meZone}`;

  if (prevState === 'playing' && st.state === 'finished') {
    scene.classList.add('round-done');
    showRoundBanner(st);
    if (mePlayer && mePlayer.delta > 0 && state.user?.celebration) {
      // Monta o efeito no wrap (que não é recriado pelo innerHTML da cena),
      // senão a próxima renderização apagaria a animação.
      celebrate(state.user.celebration, scene.closest('.bj-scene-wrap') || scene.parentElement || scene);
    }
    clearTimeout(dealTimer);
    dealTimer = setTimeout(() => {
      scene.classList.remove('round-done');
      const b = scene.querySelector('.round-banner');
      if (b) b.remove();
    }, 2800);
  }

  $$('.seat-chip[data-uid]', scene).forEach((el) => {
    el.onclick = () => {
      const i = Number(el.dataset.seat);
      if (!Number.isNaN(i)) openSeatProfile(i);
    };
  });
  $$('.seat-chip.empty[data-join]', scene).forEach((el) => {
    el.onclick = async () => {
      const r = await emit('table:join', { tableId: st.id });
      if (!r.ok) toast(r.error);
    };
  });

  renderControls(st, mePlayer);
}

async function openSeatProfile(idx) {
  const st = lastTable;
  if (!st) return;
  const p = st.players[idx];
  if (!p) return;
  if (p.isBot) {
    openModal(`
      <h3>🤖 Robô da mesa</h3>
      <div class="profile-card">
        <span class="rank-ava">${dollHtml(p, 96)}</span>
        <div>
          <strong>${escapeHtml(p.displayName)}</strong>
          <div class="muted">robô · joga sozinho contra a banca</div>
          <div class="muted">fichas da banca: ${(p.bank || 0).toLocaleString('pt-BR')} 🪙</div>
        </div>
      </div>
      <p class="muted" style="font-size:.85rem">Os robôs completam a mesa e assumem o lugar de quem desconectar no meio da partida.</p>
      <div class="modal-actions">
        <button class="btn primary" id="pop-close">Fechar</button>
      </div>`);
    $('#pop-close').onclick = closeModal;
    return;
  }

  const isMe = p.userId === state.user.id;
  let info = null;
  let rankEntry = null;
  try {
    if (!isMe) ({ user: info } = await api.getUser(p.userId));
    ({ rank: rankEntry } = await api.rank());
    rankEntry = (rankEntry || []).find((r) => r.id === p.userId) || null;
  } catch { /* segue com o que temos da mesa */ }
  const avatar = dollHtml(p, 96);
  const status = (info ? info.statusText : null) || (isMe ? state.user?.statusText : '') ;
  const bio = info ? info.bio : (isMe ? state.user?.bio : '');
  openModal(`
    <h3>${isMe ? 'Meu perfil' : 'Perfil do jogador'}</h3>
    <div class="profile-card">
      <span class="rank-ava">${avatar}</span>
      <div>
        <strong>${escapeHtml(p.displayName)}${isMe ? ' (você)' : ''}</strong>
        ${info ? `<div class="muted">@${escapeHtml(info.nickname)}</div>` : ''}
        ${status ? `<div class="profile-status">${escapeHtml(status)}</div>` : ''}
        ${bio ? `<p class="muted" style="font-size:.85rem">${escapeHtml(bio)}</p>` : ''}
      </div>
    </div>
    <div class="profile-stats">
      <div><b>${p.bet || 0}</b><span>🪙 aposta</span></div>
      <div><b>${p.total || 0}</b><span>🎯 pontos</span></div>
      <div><b>${rankEntry ? `${rankEntry.pos}º` : '—'}</b><span>🏅 posição</span></div>
      <div><b>${rankEntry?.wins ?? 0}<small>/${rankEntry?.games ?? 0}</small></b><span>🏆 vitórias/partidas</span></div>
      <div><b>${rankEntry?.games ? Math.round((rankEntry.wins / rankEntry.games) * 100) : 0}%</b><span>📈 aproveitamento</span></div>
      <div><b class="${rankEntry?.net != null && rankEntry.net > 0 ? 'win' : rankEntry?.net < 0 ? 'lose' : ''}">${rankEntry?.net != null ? (rankEntry.net > 0 ? '+' : '') + rankEntry.net.toLocaleString('pt-BR') : '—'}</b><span>💰 saldo 🪙</span></div>
    </div>
    <p class="muted" style="font-size:.8rem">Clique em um jogador para ver o perfil dele — dados do ranking geral de vitórias.</p>
    <div class="modal-actions">
      <button class="btn ghost" id="pop-chat" ${(!info || info.id === state.user.id) ? 'style="display:none"' : ''}>💬 Conversar</button>
      <button class="btn primary" id="pop-close">Fechar</button>
    </div>`);
  const chatBtn = $('#pop-chat');
  if (chatBtn) chatBtn.onclick = async () => {
    try {
      const { conversation } = await api.openDm(info.id);
      closeModal();
      window.dispatchEvent(new CustomEvent('open-chat', { detail: conversation.id }));
    } catch (e) {
      toast(e.message || 'Não foi possível conversar.');
    }
  };
  $('#pop-close').onclick = closeModal;
}

function opponentCharSize(players) {
  const n = players.length - 1;
  if (n <= 2) return 'lg';
  if (n <= 4) return 'md';
  return 'sm';
}

function renderControls(st, me) {
  const box = $('#bj-controls');
  const isHost = st.hostId === state.user.id;
  const deck = st.deckStyle || 'classic';

  if (!me) {
    const canJoin = st.state === 'waiting' || st.state === 'finished';
    box.innerHTML = `
      <p class="muted">Você está assistindo.${canJoin ? '' : ' Aguarde a próxima rodada para entrar.'}</p>
      ${canJoin ? '<button class="btn primary" id="bj-join-seat">Sentar na mesa</button>' : ''}`;
    const j = $('#bj-join-seat');
    if (j) j.onclick = async () => { const r = await emit('table:join', { tableId: st.id }); if (!r.ok) toast(r.error); };
    return;
  }

  if (st.state === 'waiting') {
    const chips = [10, 25, 50, 100, 250];
    const deckBtns = Object.entries(DECKS).map(([k, d]) => `
      <button class="mini-deck ${k === deck ? 'active' : ''}" data-deckpick="${k}"><span class="deck-mini mini-${k}"></span>${escapeHtml(d.name)}</button>`).join('');
    const wallet = me.wallet?.fichas ?? state.wallet.fichas;
    box.innerHTML = `
      <div class="waiting-row">
        <div class="bet-box">
          <div class="bet-headline">Aguardando os jogadores entrarem…</div>
          <div class="bet-row">
            <span>Minha aposta: <strong>${me.bet} 🪙</strong></span>
            <span class="muted">Saldo: ${wallet.toLocaleString('pt-BR')} 🪙</span>
          </div>
          <div class="chip-row">
            ${chips.map((c) => `<button class="chip ${me.bet === c ? 'active' : ''}" data-chip="${c}"><b>${c}</b></button>`).join('')}
            <button class="chip clear" data-chip="0">Limpar</button>
          </div>
        </div>
        <div class="host-box">
          ${isHost ? `
            <div class="deck-pick-row"><span class="muted-sm">Baralho:</span>${deckBtns}</div>
            <div class="host-actions">
              <button class="btn ghost" id="bj-settings">⚙️ Tempos</button>
              <button class="btn primary" id="bj-start" ${st.canStart ? '' : 'disabled'}>Iniciar rodada</button>
            </div>
            <p class="muted-sm">Apostas fecham sozinhas em ${countdownHtml(st)}. Compartilhe o link 🔗 para os amigos entrarem.</p>` :
            `<p class="muted">Aguardando o anfitrião iniciar… Apostas fecham em ${countdownHtml(st)}.</p>`}
        </div>
      </div>`;
    $$('[data-chip]', box).forEach((b) => {
      b.onclick = async () => {
        playSfx(Number(b.dataset.chip) ? 'chip' : 'click');
        const r = await emit('table:bet', { tableId: st.id, amount: Number(b.dataset.chip) });
        if (!r.ok) toast(r.error);
      };
    });
    $$('[data-deckpick]', box).forEach((b) => {
      b.onclick = async () => {
        playSfx('flip');
        const r = await emit('table:deck', { tableId: st.id, deckStyle: b.dataset.deckpick });
        if (!r.ok) toast(r.error);
      };
    });
    const start = $('#bj-start');
    if (start) start.onclick = async () => { const r = await emit('table:start', { tableId: st.id }); if (!r.ok) toast(r.error); };
    const settings = $('#bj-settings');
    if (settings) settings.onclick = () => openTableSettings(st);
    return;
  }

  if (st.state === 'playing' || st.state === 'dealer') {
    if (st.state === 'dealer') {
      box.innerHTML = '<p class="muted">A banca está jogando…</p>';
      return;
    }
    if (me.isTurn) {
      const maxDraw = Math.max(1, Math.min(6, st.maxDraw || 3));
      const canDouble = me.cards.length === 2 && !me.doubled;
      const drawBtns = Array.from({ length: maxDraw }, (_, i) => {
        const n = i + 1;
        return `<button class="btn ${n === 1 ? 'primary' : ''} big" data-draw="${n}">＋${n} carta${n > 1 ? 's' : ''}</button>`;
      }).join('');
      box.innerHTML = `
        <div class="action-row">${drawBtns}</div>
        <div class="action-row">
          <button class="btn big" id="bj-stand">⏹ Parar${me.total ? ` (${me.total})` : ''}</button>
          ${canDouble ? '<button class="btn gold big" id="bj-double">×2 Dobrar</button>' : ''}
        </div>
        <p class="muted-sm">${st.hintMode ? `🧠 dica: mão em ${me.total}. A máquina trava a compra no 21 — ao comprar, a carta que estouraria é devolvida e você para.` : `Escolha de 1 a ${maxDraw} carta${maxDraw > 1 ? 's' : ''} do centro — a soma trava em 21, sem estourar.`}</p>`;
      $$('[data-draw]', box).forEach((b) => { b.onclick = () => act('hit', Number(b.dataset.draw)); });
      $('#bj-stand').onclick = () => act('stand');
      const dbl = $('#bj-double');
      if (dbl) dbl.onclick = () => act('double');
    } else {
      box.innerHTML = '<p class="muted">Aguardando a jogada…</p>';
    }
    return;
  }

  if (st.state === 'finished') {
    const mine = me.outcome
      ? `<p>Apostou ${me.bet} 🪙 · <strong>${OUTCOME_LABEL[me.outcome] || me.outcome}</strong> ${me.delta > 0 ? `(+${me.delta})` : me.delta < 0 ? `(${me.delta})` : ''} 🪙</p>`
      : '<p class="muted">Você ficou de fora desta rodada.</p>';
    box.innerHTML = `
      <div class="finish-row">
        <div>${mine}</div>
        <div class="finish-actions">
          ${isHost ? `
            <span class="muted">Nova rodada em ${countdownHtml(st)} · </span>
            <button class="btn primary" id="bj-next">Agora ▶</button>`
          : `<span class="muted">Nova rodada em ${countdownHtml(st)}</span>`}
        </div>
      </div>`;
    const next = $('#bj-next');
    if (next) next.onclick = async () => { const r = await emit('table:next', { tableId: st.id }); if (!r.ok) toast(r.error); };
  }
}

async function act(action, count) {
  if (myTableId == null) return;
  if (action === 'double') playSfx('chips');
  const r = await emit('table:action', { tableId: myTableId, action, count });
  if (!r.ok) toast(r.error);
}

export function openInvite() {
  const url = location.origin + location.pathname;
  openModal(`
    <h3>Chamar os amigos</h3>
    <p class="muted" style="font-size:.9rem">Na mesma rede Wi-Fi eles abrem o endereço abaixo (ou use o IP do seu PC, ex. <b>http://192.168.x.x:3000</b>) e logam.</p>
    <label><input id="invite-url" readonly value="${escapeHtml(url)}" onfocus="this.select()" /></label>
    <div class="modal-actions">
      <button class="btn primary" id="invite-copy">Copiar</button>
      <button class="btn ghost" id="invite-close">Fechar</button>
    </div>`);
  $('#invite-close').onclick = closeModal;
  $('#invite-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiado!');
    } catch {
      toast('Copie manualmente: ' + url);
    }
  };
}

const RANK_TABS = [
  { id: 'all', label: 'Geral' },
  { id: 'bj', label: '🃏 21' },
  { id: 'poker', label: '♠ Poker' },
];

let rankGame = 'all';

export async function openRank() {
  openModal(`
    <h3>🏆 Ranking geral</h3>
    <div class="rank-tabs">
      ${RANK_TABS.map((t) => `<button class="rank-tab ${t.id === rankGame ? 'active' : ''}" data-rank-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="rank-body"><p class="muted">Carregando…</p></div>
    <p class="muted" style="font-size:.82rem" id="rank-note"></p>
    <div class="modal-actions">
      <button class="btn ghost" id="rank-close">Fechar</button>
    </div>`, 'modal-wide');
  $('#rank-close').onclick = closeModal;
  $$('[data-rank-tab]').forEach((b) => {
    b.onclick = () => {
      rankGame = b.dataset.rankTab;
      $$('[data-rank-tab]').forEach((x) => x.classList.toggle('active', x === b));
      loadRank(rankGame);
    };
  });
  loadRank(rankGame);
}

async function loadRank(game) {
  const body = $('#rank-body');
  const note = $('#rank-note');
  if (!body) return;
  body.innerHTML = '<p class="muted">Carregando…</p>';
  let rows;
  try {
    ({ rank: rows } = await api.rank(game));
  } catch (e) {
    body.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const isPoker = game === 'poker';
  const unit = (n) => (isPoker ? `mão${n === 1 ? '' : 's'}` : `vitória${n === 1 ? '' : 's'}`);
  if (!rows.length) {
    if (note) note.textContent = '';
    body.innerHTML = '<div class="rank-empty"><span>🎲</span><p>Ninguém jogou ainda.<br>Crie uma mesa e comece!</p></div>';
    return;
  }
  const totalWins = rows.reduce((s, r) => s + r.wins, 0);
  const totalNet = rows.reduce((s, r) => s + (r.net || 0), 0);
  const pct = (r) => (r.games ? Math.round((r.wins / r.games) * 100) : 0);
  const netCls = (n) => (n >= 0 ? 'win' : 'lose');
  const netTxt = (n) => `${n >= 0 ? '+' : ''}${(n || 0).toLocaleString('pt-BR')} 🪙`;

  const top = rows.slice(0, 3);
  const rest = rows.slice(3);
  const podium = `
    <div class="rank-podium">
      ${[top[1], top[0], top[2]].map((r) => (r ? `
        <div class="podium-item pos-${r.pos}">
          <span class="podium-medal">${medals[r.pos - 1]}</span>
          <span class="podium-ava">${userAvatarHtml(r, 'md')}</span>
          <strong class="podium-name">${escapeHtml(r.name)}</strong>
          <span class="podium-wins"><b>${r.wins}</b> ${unit(r.wins)}</span>
          <span class="podium-net ${netCls(r.net || 0)}">${netTxt(r.net)}</span>
          <span class="podium-base">${r.pos}º</span>
        </div>` : '<div class="podium-item empty"></div>')).join('')}
    </div>`;

  const rowHtml = (r) => `
    <div class="rank-row ${r.pos <= 3 ? 'top' : ''}">
      <span class="rank-pos"><b>${medals[r.pos - 1] || `${r.pos}º`}</b></span>
      <span class="rank-ava">${userAvatarHtml(r, 'sm')}</span>
      <div class="rank-mid">
        <strong>${escapeHtml(r.name)}</strong>
        <small class="muted">${r.games} ${isPoker ? `mão${r.games === 1 ? '' : 's'}` : `partida${r.games === 1 ? '' : 's'}`}${isPoker ? '' : ` · média ${r.avgScore ?? '—'}`}</small>
        <div class="rank-bar" title="Aproveitamento ${pct(r)}%"><i style="width:${pct(r)}%"></i></div>
      </div>
      <span class="rank-wins"><b>${r.wins}</b> ${unit(r.wins)}<small>${pct(r)}%</small></span>
      <span class="rank-net ${netCls(r.net || 0)}">${netTxt(r.net)}</span>
    </div>`;

  body.innerHTML = `
    <div class="rank-summary">
      <div><b>${rows.length}</b><span>jogador${rows.length === 1 ? '' : 'es'}</span></div>
      <div><b>${totalWins.toLocaleString('pt-BR')}</b><span>${unit(2)}</span></div>
      <div><b class="${netCls(totalNet)}">${totalNet >= 0 ? '+' : ''}${totalNet.toLocaleString('pt-BR')}</b><span>saldo 🪙</span></div>
    </div>
    ${podium}
    ${rest.length ? `<div class="rank-sub">Demais posições</div><div class="rank-list">${rest.map(rowHtml).join('')}</div>` : ''}`;
  if (note) {
    note.textContent = game === 'poker'
      ? 'Mãos de poker salvas no banco — vitória é quando a mão dá lucro.'
      : game === 'bj'
        ? 'Baseado nas vitórias somadas das partidas de 21.'
        : 'Vitórias somadas das partidas de 21 e das mãos de poker.';
  }
}