import { Router } from 'express';
import { db, walletOf, addTransaction, publicUser } from '../db.js';
import { requireAuth, HttpError } from '../auth.js';

const MAX_PLAYERS = 6;
const SB = 5;
const BB = 10;
const BUY_IN = 200;
const TURN_MS = 30000;
const BOT_MS = 1100;

const DECK_STYLES = ['classic', 'royal', 'neon'];

const BLIND_PRESETS = [
  { id: 'baixo', label: 'Baixo', sb: 2, bb: 5, buyIn: 100 },
  { id: 'classico', label: 'Clássico', sb: 5, bb: 10, buyIn: 200 },
  { id: 'medio', label: 'Médio', sb: 10, bb: 25, buyIn: 500 },
  { id: 'alto', label: 'Alto', sb: 50, bb: 100, buyIn: 2000 },
];

const clampInt = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const resolveBlinds = (body) => {
  const preset = BLIND_PRESETS.find((p) => p.id === body.blinds) || null;
  const sb = clampInt(preset ? preset.sb : body.sb, 1, 100000, SB);
  const bb = clampInt(preset ? preset.bb : body.bb, sb, 200000, BB > sb ? BB : sb * 2);
  const buyIn = clampInt(preset ? preset.buyIn : body.buyIn, bb * 10, 100000000, Math.max(bb * 20, BUY_IN));
  return { sb, bb, buyIn };
};

const BOT_NAMES = ['Zé do Baralho', 'Seu Bigode', 'Dona Fifi', 'Cuca', 'Tonho', 'Beto Bilada'];
const BOT_AVATARS = ['🤖', '😎', '🦊', '🐧', '😼', '👾'];
const BOT_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#fb7185', '#facc15'];
const BOT_SKINS = ['#e8b58a', '#c68a5a', '#8d5524', '#f1c27d', '#a5673f', '#6b4423'];
const BOT_HAIRS = ['#2c1a10', '#111827', '#7c4a03', '#dc2626', '#e2e8f0', '#3b82f6', '#16a34a'];
const BOT_SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#eab308'];
const BOT_HATS = ['none', 'cap', 'beanie', 'tophat', 'horns', 'crown'];
const EMOTES = new Set(['dedo', 'bunda', 'punheta', 'chifre', 'beijo', 'gemido', 'vomito', 'chorao', 'gargalhada', 'banana']);

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_VAL = { A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
const HAND_NAMES = ['Carta alta', 'Par', 'Dois pares', 'Trinca', 'Sequência', 'Flush', 'Full house', 'Quadra', 'Straight flush'];

const tables = new Map();
let nextTableId = 1;
let ioRef = null;

function shuffledDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function combinations(arr, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return out;
}

function evaluate5(cards) {
  const vals = cards.map((c) => RANK_VAL[c.rank]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts).map(([v, n]) => ({ v: Number(v), n })).sort((a, b) => b.n - a.n || b.v - a.v);
  const distinct = [...new Set(vals)];
  let straight = false;
  let straightHigh = 0;
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) { straight = true; straightHigh = distinct[0]; }
    else if (distinct[0] === 14 && distinct[1] === 5) { straight = true; straightHigh = 5; }
  }
  if (straight && flush) return [8, straightHigh];
  if (groups[0].n === 4) return [7, groups[0].v, groups[1].v];
  if (groups[0].n === 3 && groups[1].n === 2) return [6, groups[0].v, groups[1].v];
  if (flush) return [5, ...vals];
  if (straight) return [4, straightHigh];
  if (groups[0].n === 3) return [3, groups[0].v, ...groups.slice(1).map((g) => g.v)];
  if (groups[0].n === 2 && groups[1].n === 2) return [2, groups[0].v, groups[1].v, groups[2].v];
  if (groups[0].n === 2) return [1, groups[0].v, ...groups.slice(1).map((g) => g.v)];
  return [0, ...vals];
}

function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function bestHand(cards) {
  if (cards.length < 5) return null;
  let best = null;
  for (const c of combinations(cards, 5)) {
    const score = evaluate5(c);
    if (!best || compareScore(score, best) > 0) best = score;
  }
  return best;
}

const handName = (score) => (score ? HAND_NAMES[score[0]] : '');

function debit(userId, amount, note) {
  db.prepare('UPDATE wallets SET fichas = fichas - ? WHERE user_id = ?').run(amount, userId);
  addTransaction(userId, 'fichas', -amount, 'buyin', note);
}

function credit(userId, amount, note) {
  db.prepare('UPDATE wallets SET fichas = fichas + ? WHERE user_id = ?').run(amount, userId);
  addTransaction(userId, 'fichas', amount, 'payout', note);
}

function nameOfPlayer(p) {
  if (p.isBot) return p.name;
  const row = db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(p.userId);
  return row ? row.n : 'Jogador';
}

function logPlay(table, p, action) {
  if (!table.plays) table.plays = [];
  table.plays.push({ userId: p.isBot ? null : p.userId, street: table.round, action, at: new Date().toISOString() });
}

function newSeat(userId) {
  return {
    userId, stack: 0, bet: 0, contrib: 0, inHand: false,
    folded: false, allIn: false, acted: false, hole: [], best: null,
    revealHole: false, buyIn: 0, net: 0, leaveAfter: false, isBot: false,
  };
}

function makeBot(table) {
  const id = table.botSeq--;
  const a = Math.abs(id);
  return {
    userId: id,
    isBot: true,
    name: BOT_NAMES[a % BOT_NAMES.length],
    avatar: BOT_AVATARS[a % BOT_AVATARS.length],
    color: BOT_COLORS[a % BOT_COLORS.length],
    character: {
      skin: BOT_SKINS[(a * 3) % BOT_SKINS.length],
      hair: BOT_HAIRS[(a * 5 + 1) % BOT_HAIRS.length],
      shirt: BOT_SHIRTS[(a * 7 + 2) % BOT_SHIRTS.length],
      hat: BOT_HATS[(a * 11 + 3) % BOT_HATS.length],
    },
    stack: 0, bet: 0, contrib: 0, inHand: false,
    folded: false, allIn: false, acted: false, hole: [], best: null,
    revealHole: false, buyIn: 0, net: 0, leaveAfter: false,
  };
}

function seatOf(table, userId) {
  return table.players.find((p) => p.userId === userId) || null;
}

function inHandSeats(table) {
  return table.players.filter((p) => p.inHand);
}

function contenders(table) {
  return table.players.filter((p) => p.inHand && !p.folded);
}

function potOf(table) {
  return table.players.reduce((n, p) => n + p.contrib, 0);
}

function clearTimer(table) {
  if (table.turnTimer) { clearTimeout(table.turnTimer); table.turnTimer = null; }
}

function broadcast(table) {
  if (!ioRef) return;
  ioRef.to(`ptable:${table.id}`).emit('poker:state', publicState(table));
  for (const p of table.players) {
    if (p.inHand) ioRef.to(`user:${p.userId}`).emit('poker:hole', { tableId: table.id, hole: p.hole });
  }
}

export function publicState(table) {
  return {
    id: table.id,
    name: table.name,
    hostId: table.hostId,
    state: table.state,
    hintMode: !!table.hintMode,
    maxPlayers: MAX_PLAYERS,
    deckStyle: table.deckStyle,
    sb: table.sb,
    bb: table.bb,
    buyIn: table.buyIn,
    dealerIndex: table.dealerIndex,
    sbIndex: table.sbIndex,
    bbIndex: table.bbIndex,
    round: table.round,
    board: table.board,
    pot: potOf(table),
    currentBet: table.currentBet,
    minRaise: table.minRaise,
    activeIndex: table.activeIndex,
    results: table.results,
    players: table.players.map((p, index) => {
      const u = p.isBot ? null : (publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(p.userId)) || {});
      return {
        userId: p.userId,
        displayName: (p.isBot ? p.name : u.displayName) || 'Jogador',
        avatar: (p.isBot ? p.avatar : u.avatar) || '👤',
        color: (p.isBot ? p.color : u.color) || '#64748b',
        character: (p.isBot ? p.character : u.character) || null,
        isBot: !!p.isBot,
        stack: p.stack,
        bet: p.bet,
        contrib: p.contrib,
        inHand: p.inHand,
        folded: p.folded,
        allIn: p.allIn,
        holeCardCount: p.inHand && !p.folded ? 2 : 0,
        holeShown: table.state === 'finished' && p.revealHole,
        hole: table.state === 'finished' && p.revealHole ? p.hole : null,
        handName: table.state === 'finished' && p.revealHole ? handName(p.best) : '',
        net: table.state === 'finished' ? (p.net ?? 0) : null,
        isTurn: table.state === 'playing' && index === table.activeIndex,
      };
    }),
  };
}

function listSummary(table) {
  const host = db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(table.hostId);
  return {
    id: table.id,
    name: table.name,
    host: host ? host.n : '—',
    players: table.players.length,
    bots: table.players.filter((p) => p.isBot).length,
    maxPlayers: MAX_PLAYERS,
    state: table.state,
    hintMode: !!table.hintMode,
    deckStyle: table.deckStyle,
    sb: table.sb,
    bb: table.bb,
    buyIn: table.buyIn,
  };
}

function nextIndex(table, from, predicate) {
  for (let step = 1; step <= table.players.length; step++) {
    const i = (from + step) % table.players.length;
    if (predicate(table.players[i])) return i;
  }
  return -1;
}

function postBlind(p, amount) {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.bet += paid;
  p.contrib += paid;
  if (p.stack === 0) p.allIn = true;
  return paid;
}

function startHand(table) {
  clearTimer(table);
  const eligible = table.players.filter((p) => p.isBot || walletOf(p.userId).fichas >= table.buyIn);
  if (eligible.length < 2) throw new HttpError(400, 'São necessários ao menos 2 jogadores com fichas suficientes.');

  const eligibleIds = new Set(eligible.map((p) => p.userId));
  for (const p of table.players) {
    p.folded = !eligibleIds.has(p.userId);
    p.bet = 0;
    p.contrib = 0;
    p.allIn = false;
    p.acted = false;
    p.hole = [];
    p.best = null;
    p.revealHole = false;
    p.buyIn = 0;
    p.stack = 0;
    p.inHand = eligibleIds.has(p.userId);
  }
  for (const p of eligible) {
    p.buyIn = table.buyIn;
    p.stack = table.buyIn;
    if (!p.isBot) debit(p.userId, table.buyIn, 'Entrada na mesa de poker');
  }

  table.deck = shuffledDeck();
  table.board = [];
  table.results = [];
  table.round = 'preflop';
  table.currentBet = 0;
  table.minRaise = table.bb;
  table.state = 'playing';
  table.handStartMs = Date.now();
  table.plays = [];

  for (const p of eligible) {
    p.hole = [table.deck.pop(), table.deck.pop()];
  }

  const activeCount = eligible.length;
  table.dealerIndex = nextIndex(table, table.dealerIndex < 0 ? table.players.length - 1 : table.dealerIndex, (p) => p.inHand);
  if (activeCount === 2) {
    table.sbIndex = table.dealerIndex;
  } else {
    table.sbIndex = nextIndex(table, table.dealerIndex, (p) => p.inHand);
  }
  table.bbIndex = nextIndex(table, table.sbIndex, (p) => p.inHand);

  postBlind(table.players[table.sbIndex], table.sb);
  postBlind(table.players[table.bbIndex], table.bb);
  table.currentBet = Math.max(table.players[table.sbIndex].bet, table.players[table.bbIndex].bet);

  if (activeCount === 2) {
    table.activeIndex = table.dealerIndex;
  } else {
    table.activeIndex = nextIndex(table, table.bbIndex, (p) => p.inHand && !p.allIn);
  }
  broadcast(table);
  armTimer(table);
  if (table.activeIndex === -1) advanceStreet(table);
}

function armTimer(table) {
  clearTimer(table);
  if (table.state !== 'playing' || table.activeIndex < 0) return;
  const seat = table.players[table.activeIndex];
  const uid = seat.userId;
  if (seat.isBot) {
    table.turnTimer = setTimeout(() => {
      const p = seatOf(table, uid);
      if (!p || table.players[table.activeIndex] !== p || table.state !== 'playing') return;
      applyAction(table, p, botDecision(table, p));
    }, BOT_MS);
    return;
  }
  table.turnTimer = setTimeout(() => {
    const p = seatOf(table, uid);
    if (!p || table.players[table.activeIndex] !== p) return;
    const toCall = table.currentBet - p.bet;
    applyAction(table, p, toCall > 0 ? { type: 'fold' } : { type: 'check' });
  }, TURN_MS);
}

function botStrength(table, seat) {
  if (!seat.hole || seat.hole.length < 2) return 0;
  const all = [...seat.hole, ...table.board];
  if (all.length >= 5) {
    const score = bestHand(all);
    return score ? score[0] : 0;
  }
  const a = RANK_VAL[seat.hole[0].rank];
  const b = RANK_VAL[seat.hole[1].rank];
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (a === b) return hi >= 10 ? 3 : 2;
  if (hi === 14) return lo >= 10 ? 3 : 2;
  if (hi >= 12 && lo >= 10) return 2;
  if (hi >= 11 || (hi === 14)) return 1;
  return 0;
}

function botDecision(table, seat) {
  const toCall = table.currentBet - seat.bet;
  const pot = potOf(table);
  const maxTo = seat.bet + seat.stack;
  const strength = botStrength(table, seat);
  const rnd = Math.random();
  const canRaise = seat.stack > 0 && maxTo > table.currentBet;

  const raiseTo = () => {
    const want = Math.max(
      table.currentBet + table.minRaise,
      Math.round((pot * 0.6) / table.bb) * table.bb
    );
    return { type: 'raise', amount: Math.min(maxTo, want) };
  };

  if (toCall <= 0) {
    if (canRaise && (strength >= 5 || (strength >= 3 && rnd < 0.4) || rnd < 0.07)) return raiseTo();
    return { type: 'check' };
  }
  if (strength >= 5) return canRaise && rnd < 0.65 ? raiseTo() : { type: 'call' };
  if (strength >= 3) return canRaise && rnd < 0.3 ? raiseTo() : { type: 'call' };
  const potOdds = toCall / (pot + toCall);
  if (strength >= 1) {
    if (toCall <= Math.max(table.bb, pot * 0.25)) return { type: 'call' };
    return rnd < potOdds ? { type: 'call' } : { type: 'fold' };
  }
  if (toCall <= table.bb && rnd < 0.5) return { type: 'call' };
  return { type: 'fold' };
}

function applyAction(table, p, action) {
  const toCall = table.currentBet - p.bet;
  if (action.type === 'fold') {
    p.folded = true;
    p.acted = true;
    logPlay(table, p, 'desiste');
  } else if (action.type === 'check') {
    if (toCall > 0) throw new HttpError(400, 'Há uma aposta para pagar.');
    p.acted = true;
    logPlay(table, p, 'mesa');
  } else if (action.type === 'call') {
    const paid = putChips(p, toCall);
    p.acted = true;
    logPlay(table, p, `paga ${paid}`);
  } else if (action.type === 'raise') {
    let to = Math.floor(Number(action.amount));
    if (!Number.isFinite(to)) throw new HttpError(400, 'Valor inválido.');
    const maxTo = p.bet + p.stack;
    if (to > maxTo) to = maxTo;
    if (to <= table.currentBet && !(to === maxTo)) throw new HttpError(400, 'Aumento muito baixo.');
    const raiseSize = to - table.currentBet;
    if (raiseSize < table.minRaise && to !== maxTo) throw new HttpError(400, `Aumento mínimo: ${table.currentBet + table.minRaise}.`);
    putChips(p, to - p.bet);
    if (to > table.currentBet) {
      if (raiseSize >= table.minRaise) table.minRaise = raiseSize;
      table.currentBet = p.bet;
    }
    p.acted = true;
    logPlay(table, p, `aumenta para ${p.bet}`);
  } else {
    throw new HttpError(400, 'Ação inválida.');
  }
  afterAction(table);
}

function putChips(p, amount) {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.bet += paid;
  p.contrib += paid;
  if (p.stack === 0) p.allIn = true;
  return paid;
}

function afterAction(table) {
  clearTimer(table);
  const cs = contenders(table);
  if (cs.length === 1) {
    winByFold(table, cs[0]);
    return;
  }
  const needAction = cs.filter((p) => !p.allIn && (!p.acted || p.bet < table.currentBet));
  if (needAction.length === 0) {
    advanceStreet(table);
    return;
  }
  table.activeIndex = nextIndex(table, table.activeIndex, (p) => p.inHand && !p.folded && !p.allIn && (!p.acted || p.bet < table.currentBet));
  broadcast(table);
  armTimer(table);
}

function resetRound(table) {
  for (const p of table.players) {
    p.bet = 0;
    p.acted = false;
  }
  table.currentBet = 0;
  table.minRaise = table.bb;
  table.activeIndex = -1;
}

function advanceStreet(table) {
  clearTimer(table);
  resetRound(table);
  const cs = contenders(table);
  const canAct = cs.filter((p) => !p.allIn);
  const deal = (n) => { for (let i = 0; i < n; i++) table.board.push(table.deck.pop()); };

  if (table.round === 'preflop') {
    table.round = 'flop';
    deal(3);
  } else if (table.round === 'flop') {
    table.round = 'turn';
    deal(1);
  } else if (table.round === 'turn') {
    table.round = 'river';
    deal(1);
  } else {
    showdown(table);
    return;
  }

  if (canAct.length <= 1) {
    while (table.board.length < 5) table.board.push(table.deck.pop());
    showdown(table);
    return;
  }

  table.activeIndex = nextIndex(table, table.dealerIndex, (p) => p.inHand && !p.folded && !p.allIn);
  broadcast(table);
  armTimer(table);
}

function winByFold(table, winner) {
  const pot = potOf(table);
  winner.stack += pot;
  table.results = inHandSeats(table)
    .map((p) => ({
      userId: p.userId,
      amount: p === winner ? pot : 0,
      net: (p === winner ? pot : 0) - p.contrib,
      handName: p === winner ? 'todos desistiram' : null,
    }))
    .sort((a, b) => b.net - a.net);
  settle(table);
}

function buildPots(table) {
  const players = inHandSeats(table);
  const levels = [...new Set(players.map((p) => p.contrib).filter((c) => c > 0))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    for (const p of players) amount += Math.min(p.contrib, lvl) - Math.min(p.contrib, prev);
    const eligible = players.filter((p) => !p.folded && p.contrib >= lvl);
    pots.push({ amount, eligible });
    prev = lvl;
  }
  return pots;
}

function showdown(table) {
  while (table.board.length < 5) table.board.push(table.deck.pop());
  table.round = 'showdown';
  for (const p of contenders(table)) {
    p.best = bestHand([...p.hole, ...table.board]);
    p.revealHole = true;
  }
  const pots = buildPots(table);
  const results = {};
  for (const pot of pots) {
    if (!pot.eligible.length) continue;
    let best = null;
    for (const p of pot.eligible) if (!best || compareScore(p.best, best) > 0) best = p.best;
    const winners = pot.eligible.filter((p) => compareScore(p.best, best) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      w.stack += share + extra;
      results[w.userId] = (results[w.userId] || 0) + share + extra;
    }
  }
  table.results = inHandSeats(table)
    .map((p) => {
      const payout = results[p.userId] || 0;
      return {
        userId: p.userId,
        amount: payout,
        net: payout - p.contrib,
        handName: p.folded ? null : handName(p.best),
      };
    })
    .sort((a, b) => b.net - a.net);
  settle(table);
}

function settle(table) {
  clearTimer(table);
  const endedAt = new Date();
  for (const p of table.players) {
    if (p.inHand && p.stack > 0 && !p.isBot) credit(p.userId, p.stack, 'Prêmio na mesa de poker');
    p.net = p.inHand ? p.stack - p.buyIn : 0;
  }
  saveHand(table, endedAt);
  for (const p of table.players) p.inHand = false;
  table.players = table.players.filter((p) => !p.leaveAfter);
  const emptied = table.players.length === 0;
  table.state = 'finished';
  table.activeIndex = -1;
  if (emptied) {
    tables.delete(table.id);
    return;
  }
  if (!table.players.some((p) => p.userId === table.hostId)) {
    table.hostId = table.players[0].userId;
  }
  broadcast(table);
}

function saveHand(table, endedAt) {
  if (!table.handStartMs) return;
  const info = db
    .prepare(
      `INSERT INTO poker_rounds (table_id, table_name, deck_style, sb, bb, buy_in, started_at, ended_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      table.id,
      table.name,
      table.deckStyle || 'classic',
      table.sb,
      table.bb,
      table.buyIn,
      new Date(table.handStartMs).toISOString(),
      endedAt.toISOString(),
      endedAt.getTime() - table.handStartMs
    );
  const roundId = Number(info.lastInsertRowid);
  const insHand = db.prepare(
    `INSERT INTO poker_hands (round_id, user_id, user_name, is_bot, buy_in, net, result, hand_name, hole_json, board_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const board = JSON.stringify(table.board);
  for (const p of table.players) {
    if (!p.inHand) continue;
    const net = p.net || 0;
    const result = p.folded ? 'desistiu' : net > 0 ? 'venceu' : net < 0 ? 'perdeu' : 'empate';
    insHand.run(
      roundId,
      p.isBot ? null : p.userId,
      nameOfPlayer(p),
      p.isBot ? 1 : 0,
      p.buyIn || 0,
      net,
      result,
      p.best ? handName(p.best) : '',
      JSON.stringify(p.hole || []),
      board
    );
  }
  const insPlay = db.prepare('INSERT INTO poker_plays (round_id, user_id, street, action, at) VALUES (?, ?, ?, ?, ?)');
  for (const pl of table.plays || []) insPlay.run(roundId, pl.userId, pl.street, pl.action, pl.at);
  table.handStartMs = null;
  table.plays = [];
}

function nextHand(table) {
  if (table.state === 'playing') throw new HttpError(400, 'A mão ainda está em andamento.');
  for (const p of table.players) {
    p.folded = false;
    p.bet = 0;
    p.contrib = 0;
    p.allIn = false;
    p.acted = false;
    p.hole = [];
    p.best = null;
    p.revealHole = false;
  }
  table.board = [];
  table.results = [];
  table.round = 'preflop';
  table.state = 'waiting';
  table.activeIndex = -1;
  table.handStartMs = null;
  table.plays = [];
  broadcast(table);
}

const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Erro interno.' });
  }
};

export const pokerRouter = new Router();

pokerRouter.get('/poker/tables', requireAuth, wrap((req, res) => {
  res.json({ tables: [...tables.values()].map(listSummary) });
}));

pokerRouter.post('/poker/tables', requireAuth, wrap((req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 40) || `Poker de ${req.user.display_name}`;
  const hintMode = b.hint === true || b.hint === 'true';
  const deckStyle = DECK_STYLES.includes(b.deckStyle) ? b.deckStyle : 'classic';
  const { sb, bb, buyIn } = resolveBlinds(b);
  const table = {
    id: nextTableId++,
    name,
    hostId: req.user.id,
    hintMode,
    deckStyle,
    sb,
    bb,
    buyIn,
    state: 'waiting',
    players: [],
    deck: [],
    board: [],
    dealerIndex: -1,
    sbIndex: -1,
    bbIndex: -1,
    currentBet: 0,
    minRaise: bb,
    activeIndex: -1,
    round: 'preflop',
    results: [],
    turnTimer: null,
    botSeq: -1,
    handStartMs: null,
    plays: [],
  };
  tables.set(table.id, table);
  const botCount = Math.max(0, Math.min(Math.floor(Number(b.bots) || 0), MAX_PLAYERS - 1));
  for (let i = 0; i < botCount; i++) table.players.push(makeBot(table));
  res.status(201).json({ table: publicState(table) });
}));

export function attachPoker(io, socket, user) {
  ioRef = io;
  const uid = user.id;
  const guard = (fn) => (payload, ack) => {
    try { fn(payload || {}); if (typeof ack === 'function') ack({ ok: true }); }
    catch (err) { if (typeof ack === 'function') ack({ ok: false, error: err.message }); }
  };

  socket.on('poker:join', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (!seatOf(table, uid)) {
      if (table.players.length >= MAX_PLAYERS) throw new HttpError(400, 'Mesa cheia.');
      if (table.state === 'playing') throw new HttpError(400, 'Mão em andamento — espere a próxima.');
      table.players.push(newSeat(uid));
    }
    socket.join(`ptable:${table.id}`);
    broadcast(table);
  }));

  socket.on('poker:leave', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) return;
    const seat = seatOf(table, uid);
    if (seat) {
      if (table.state === 'playing' && seat.inHand) {
        seat.folded = true;
        seat.leaveAfter = true;
        if (table.players[table.activeIndex] === seat) applyAction(table, seat, { type: 'fold' });
      } else {
        table.players = table.players.filter((p) => p.userId !== uid);
        if (table.players.length === 0) { clearTimer(table); tables.delete(table.id); }
        else if (table.hostId === uid) { table.hostId = table.players[0].userId; broadcast(table); }
        else broadcast(table);
      }
    }
    socket.leave(`ptable:${table.id}`);
  }));

  socket.on('poker:start', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode iniciar.');
    if (table.state === 'playing') throw new HttpError(400, 'Mão em andamento.');
    startHand(table);
  }));

  socket.on('poker:action', guard(({ tableId, action }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.state !== 'playing') throw new HttpError(400, 'Não é hora de agir.');
    const seat = seatOf(table, uid);
    if (!seat || table.players[table.activeIndex] !== seat) throw new HttpError(400, 'Não é a sua vez.');
    applyAction(table, seat, action || {});
  }));

  socket.on('poker:next', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode abrir a próxima mão.');
    if (table.state === 'playing') throw new HttpError(400, 'A mão ainda está em andamento.');
    nextHand(table);
  }));

  socket.on('poker:deck', guard(({ tableId, deckStyle }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode trocar o baralho.');
    if (table.state === 'playing') throw new HttpError(400, 'Troque o baralho entre as mãos.');
    if (!DECK_STYLES.includes(deckStyle)) throw new HttpError(400, 'Baralho inválido.');
    table.deckStyle = deckStyle;
    broadcast(table);
  }));

  socket.on('poker:addbot', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode adicionar robôs.');
    if (table.state === 'playing') throw new HttpError(400, 'Adicione robôs entre as mãos.');
    if (table.players.length >= MAX_PLAYERS) throw new HttpError(400, 'Mesa cheia.');
    table.players.push(makeBot(table));
    broadcast(table);
  }));

  socket.on('poker:removebot', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode remover robôs.');
    if (table.state === 'playing') throw new HttpError(400, 'Remova robôs entre as mãos.');
    const idx = table.players.map((p) => p.isBot).lastIndexOf(true);
    if (idx < 0) throw new HttpError(404, 'Nenhum robô na mesa.');
    table.players.splice(idx, 1);
    broadcast(table);
  }));

  socket.on('poker:emote', guard(({ tableId, emote }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (!seatOf(table, uid)) throw new HttpError(400, 'Você não está nesta mesa.');
    if (!EMOTES.has(emote)) throw new HttpError(400, 'Interação inválida.');
    ioRef.to(`ptable:${table.id}`).emit('poker:emote', { userId: uid, emote, at: Date.now() });
  }));

  socket.on('poker:watch', (payload) => {
    const table = tables.get(Number(payload?.tableId));
    if (table && seatOf(table, uid)) {
      socket.join(`ptable:${table.id}`);
      socket.emit('poker:state', publicState(table));
      const seat = seatOf(table, uid);
      if (seat.inHand) socket.emit('poker:hole', { tableId: table.id, hole: seat.hole });
    }
  });
}

export { bestHand as __bestHand, evaluate5 as __evaluate5, compareScore as __compareScore };
