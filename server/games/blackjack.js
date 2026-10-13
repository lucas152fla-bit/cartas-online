import { Router } from 'express';
import { db, walletOf, addTransaction, publicUser } from '../db.js';
import { requireAuth, HttpError } from '../auth.js';

const MIN_BET = 10;
const MAX_PLAYERS = 6;
const TURN_MS = 30000;
const BOT_MS = 900;
const DEFAULT_INTERVAL_MS = 25000;
const TIMER_MIN = 5000;
const TIMER_MAX = 120000;
const SHOE_DECKS = 6;
const RESHUFFLE_CUT = 52;
const DEFAULT_MAX_DRAW = 3;
const MAX_DRAW_CAP = 6;

const clampMs = (v, fallback) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(TIMER_MIN, Math.min(TIMER_MAX, n));
};

const clampInt = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const DECK_STYLES = ['classic', 'royal', 'neon'];

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const POINTS = { A: 11, J: 10, Q: 10, K: 10, '10': 10 };

const BOT_NAMES = ['Robô Max', 'Robô Lua', 'Robô Rio', 'Robô Nelly', 'Robô Zeca'];
const BOT_AVATARS = ['🤖', '👾', '🦾', '😼', '🐧', '🦊'];
const BOT_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#fb7185', '#facc15'];
const BOT_SKINS = ['#e8b58a', '#c68a5a', '#8d5524', '#f1c27d', '#a5673f', '#6b4423'];
const BOT_HAIRS = ['#2c1a10', '#111827', '#7c4a03', '#dc2626', '#e2e8f0', '#3b82f6', '#16a34a'];
const BOT_SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#eab308'];
const BOT_HATS = ['none', 'cap', 'beanie', 'tophat', 'horns', 'crown'];

const tables = new Map();
let nextTableId = 1;
let ioRef = null;

const cardValue = (c) => (c.rank in POINTS ? POINTS[c.rank] : Number(c.rank));

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

const handTotal = (cards) => handValue(cards).total;
const isBlackjack = (cards) => cards.length === 2 && handTotal(cards) === 21;

function shuffledDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function makeShoe() {
  const shoe = [];
  for (let i = 0; i < SHOE_DECKS; i++) shoe.push(...shuffledDeck());
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

const draw = (table) => {
  if (!table.deck.length) {
    table.deck = makeShoe();
    table.shuffledAt = Date.now();
  }
  return table.deck.pop();
};

function drawSafe(table, cards) {
  const card = draw(table);
  const total = handValue([...cards, card]).total;
  if (total > 21) {
    table.deck.push(card);
    return false;
  }
  cards.push(card);
  return true;
}

function debitSeat(seat, amount, note) {
  if (seat.isBot) {
    seat.bank -= amount;
    return;
  }
  db.prepare('UPDATE wallets SET fichas = fichas - ? WHERE user_id = ?').run(amount, seat.userId);
  addTransaction(seat.userId, 'fichas', -amount, 'bet', note);
}

function creditSeat(seat, amount, note) {
  if (seat.isBot) {
    seat.bank += amount;
    return;
  }
  db.prepare('UPDATE wallets SET fichas = fichas + ? WHERE user_id = ?').run(amount, seat.userId);
  addTransaction(seat.userId, 'fichas', amount, 'win', note);
}

function clearTimer(table) {
  if (table.turnTimer) {
    clearTimeout(table.turnTimer);
    table.turnTimer = null;
  }
  if (table.phaseTimer) {
    clearTimeout(table.phaseTimer);
    table.phaseTimer = null;
  }
  table.phase = null;
}

function canStartNow(table) {
  return table.state === 'waiting' && table.players.some((p) => !p.sittingOut && p.bet >= table.minBet);
}

function newSeat(userId) {
  return {
    userId,
    isBot: false,
    ai: false,
    bet: 0,
    cards: [],
    stood: false,
    busted: false,
    doubled: false,
    blackjack: false,
    sittingOut: false,
    outcome: null,
    delta: 0,
  };
}

function makeBot(table) {
  const id = table.botSeq--;
  const color = BOT_COLORS[Math.abs(id) % BOT_COLORS.length];
  return {
    ...newSeat(id),
    isBot: true,
    name: BOT_NAMES[Math.abs(id) % BOT_NAMES.length],
    color,
    character: {
      skin: BOT_SKINS[(Math.abs(id) * 3) % BOT_SKINS.length],
      hair: BOT_HAIRS[(Math.abs(id) * 5 + 1) % BOT_HAIRS.length],
      shirt: BOT_SHIRTS[(Math.abs(id) * 7 + 2) % BOT_SHIRTS.length],
      hat: BOT_HATS[(Math.abs(id) * 11 + 3) % BOT_HATS.length],
    },
    avatar: BOT_AVATARS[Math.abs(id) % BOT_AVATARS.length],
    bank: 15000,
  };
}

function botBet(table, p) {
  if (p.bank < table.minBet) {
    p.bet = 0;
    return;
  }
  const raw = Math.max(table.minBet, Math.round(p.bank / 8 / 5) * 5);
  p.bet = Math.min(raw, 400);
}

function resetRound(p) {
  p.cards = [];
  p.stood = false;
  p.busted = false;
  p.doubled = false;
  p.blackjack = false;
  p.sittingOut = false;
  p.outcome = null;
  p.delta = 0;
}

function resetSeat(p) {
  resetRound(p);
  p.bet = 0;
}

function seatOf(table, userId) {
  return table.players.find((p) => p.userId === userId) || null;
}

function currentSeat(table) {
  return table.players[table.activeIndex] || null;
}

function botDecision(table, seat, dealerUp) {
  const canDouble = seat.cards.length === 2 && !seat.doubled && seat.bank >= seat.bet;
  const { total } = handValue(seat.cards);
  if (total > 21) return 'stand';
  if (canDouble) {
    if (total === 11) return 'double';
    if (total === 10 && dealerUp <= 9) return 'double';
  }
  if (dealerUp <= 6) return total >= 12 ? 'stand' : 'hit';
  return total >= 17 ? 'stand' : 'hit';
}

export function publicState(table) {
  const reveal = table.reveal;
  const dealerCards = reveal ? table.dealer : table.dealer.map((c, i) => (i === 0 ? c : { rank: '?', suit: '?' }));
  const dealerTotal = reveal ? handTotal(table.dealer) : handTotal(table.dealer.slice(0, 1));
  return {
    id: table.id,
    name: table.name,
    hostId: table.hostId,
    state: table.state,
    minBet: table.minBet,
    deckStyle: table.deckStyle,
    hintMode: !!table.hintMode,
    maxDraw: table.maxDraw,
    turnMs: table.turnMs,
    intervalMs: table.intervalMs,
    phase: table.phase || null,
    deckLeft: table.deck.length,
    deckTotal: SHOE_DECKS * 52,
    shuffleTick: table.shuffledAt || 0,
    maxPlayers: MAX_PLAYERS,
    slots: table.players.length,
    activeIndex: table.activeIndex,
    reveal,
    dealer: { cards: dealerCards, total: dealerTotal, blackjack: reveal && table.dealer.length === 2 && dealerTotal === 21 },
    players: table.players.map((p, index) => {
      let displayName;
      let avatar = '';
      let color = '#64748b';
      let character = null;
      let wallet = null;
      if (p.isBot) {
        displayName = p.name;
        color = p.color;
        character = p.character;
        avatar = p.avatar;
      } else {
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(p.userId);
        const u = publicUser(row) || {};
        displayName = u.displayName || 'Jogador';
        avatar = u.avatar || '👤';
        color = u.color || '#64748b';
        character = u.character || null;
        wallet = walletOf(p.userId);
      }
      return {
        userId: p.userId,
        isBot: !!p.isBot,
        ai: !!p.ai,
        displayName,
        avatar,
        color,
        character,
        wallet,
        bank: p.isBot ? p.bank : undefined,
        bet: p.bet,
        cards: p.cards,
        total: handTotal(p.cards),
        stood: p.stood,
        busted: p.busted,
        doubled: p.doubled,
        blackjack: p.blackjack,
        sittingOut: p.sittingOut,
        outcome: p.outcome,
        delta: p.delta,
        isTurn: table.state === 'playing' && index === table.activeIndex,
      };
    }),
    canStart: canStartNow(table),
  };
}

function listSummary(table) {
  let host = '—';
  if (table.hostUserId) {
    const row = db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(table.hostUserId);
    host = row ? row.n : '—';
  }
  return {
    id: table.id,
    name: table.name,
    host,
    players: table.players.filter((p) => !p.isBot).length,
    bots: table.players.filter((p) => p.isBot).length,
    maxPlayers: MAX_PLAYERS,
    state: table.state,
    deckStyle: table.deckStyle,
    hintMode: !!table.hintMode,
    minBet: table.minBet,
    turnMs: table.turnMs,
    intervalMs: table.intervalMs,
    maxDraw: table.maxDraw,
  };
}

function broadcast(table) {
  if (!ioRef) return;
  ioRef.to(`table:${table.id}`).emit('table:state', publicState(table));
}

function armTimer(table) {
  if (table.turnTimer) clearTimeout(table.turnTimer);
  if (table.state !== 'playing') return;
  const seat = currentSeat(table);
  if (!seat) return;
  const delay = seat.isBot || seat.ai ? BOT_MS : table.turnMs;
  table.phase = seat.isBot || seat.ai ? null : { name: 'turn', left: table.turnMs, tick: Date.now() };
  table.turnTimer = setTimeout(() => {
    if (!seat.isBot && !seat.ai && !seat.busted && !seat.stood) seat.stood = true;
    if (seat.isBot || seat.ai) botAct(table, seat);
    else advanceTurn(table);
  }, delay);
}

function armPhaseTimer(table) {
  if (table.phaseTimer) clearTimeout(table.phaseTimer);
  const ms = table.intervalMs;
  table.phase = { name: table.state, left: ms, tick: Date.now() };
  table.phaseTimer = setTimeout(() => {
    if (table.state === 'waiting') {
      if (canStartNow(table)) {
        dealRound(table);
      } else {
        armPhaseTimer(table);
        broadcast(table);
      }
    } else if (table.state === 'finished') {
      newRound(table);
    }
  }, ms);
}

function advanceTurn(table) {
  table.activeIndex += 1;
  while (table.activeIndex < table.players.length) {
    const p = table.players[table.activeIndex];
    if (!p.sittingOut && !p.busted && !p.stood && !p.blackjack) break;
    table.activeIndex += 1;
  }
  if (table.activeIndex >= table.players.length) {
    dealerPlay(table);
  } else {
    armTimer(table);
    broadcast(table);
  }
}

function dealerPlay(table) {
  clearTimer(table);
  table.state = 'dealer';
  table.reveal = true;
  while (handTotal(table.dealer) < 17) table.dealer.push(draw(table));
  resolveRound(table);
}

function resolveRound(table) {
  const dealerTotal = handTotal(table.dealer);
  const dealerBJ = table.dealer.length === 2 && dealerTotal === 21;
  for (const p of table.players) {
    if (p.sittingOut || p.bet < table.minBet) {
      p.outcome = 'saiu';
      p.delta = 0;
      continue;
    }
    const total = handTotal(p.cards);
    let payout = 0;
    let outcome;
    if (p.busted) {
      outcome = 'perdeu';
    } else if (p.blackjack && !dealerBJ) {
      outcome = 'blackjack';
      payout = p.bet + Math.floor(p.bet * 1.5);
    } else if (dealerBJ && !p.blackjack) {
      outcome = 'perdeu';
    } else if (dealerTotal > 21 || total > dealerTotal) {
      outcome = 'venceu';
      payout = p.bet * 2;
    } else if (total === dealerTotal) {
      outcome = 'empate';
      payout = p.bet;
    } else {
      outcome = 'perdeu';
    }
    p.outcome = outcome;
    p.delta = payout - p.bet;
    if (payout > 0) creditSeat(p, payout, `21 (${outcome})`);
  }
  clearTimer(table);
  table.state = 'finished';
  saveRound(table);
  armPhaseTimer(table);
  broadcast(table);
}

function saveRound(table) {
  if (!table.roundStartMs || !table.roundPlays) return;
  const endedAt = new Date();
  const info = db
    .prepare(
      `INSERT INTO rounds (table_id, table_name, deck_style, started_at, ended_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      table.id,
      table.name,
      table.deckStyle,
      new Date(table.roundStartMs).toISOString(),
      endedAt.toISOString(),
      endedAt.getTime() - table.roundStartMs
    );
  const roundId = Number(info.lastInsertRowid);
  const nameOf = (p) => {
    if (p.isBot) return p.name;
    const row = db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(p.userId);
    return row ? row.n : 'Jogador';
  };
  const insHand = db.prepare(
    `INSERT INTO hands (round_id, user_id, user_name, is_bot, bet, outcome, delta, total, doubled, cards_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const p of table.players) {
    insHand.run(
      roundId,
      p.isBot ? null : p.userId,
      nameOf(p),
      p.isBot ? 1 : 0,
      p.bet,
      p.outcome || 'saiu',
      p.delta || 0,
      handTotal(p.cards),
      p.doubled ? 1 : 0,
      JSON.stringify(p.cards)
    );
  }
  const insPlay = db.prepare('INSERT INTO plays (round_id, user_id, action, at) VALUES (?, ?, ?, ?)');
  for (const pl of table.roundPlays) insPlay.run(roundId, pl.userId, pl.action, pl.at);
  table.roundStartMs = null;
  table.roundPlays = [];
}

function dealRound(table) {
  clearTimer(table);
  table.phase = null;
  if (table.deck.length < RESHUFFLE_CUT) {
    table.deck = makeShoe();
    table.shuffledAt = Date.now();
  }
  table.dealer = [];
  table.reveal = false;
  table.activeIndex = -1;
  table.roundStartMs = Date.now();
  table.roundPlays = [];
  for (const p of table.players) {
    resetRound(p);
    if (p.isBot) {
      if (p.bet > p.bank) p.bet = Math.max(0, Math.floor(p.bank));
    } else {
      const wallet = walletOf(p.userId);
      if (p.bet > wallet.fichas) p.bet = Math.max(0, Math.floor(wallet.fichas));
    }
    if (p.bet < table.minBet) p.sittingOut = true;
  }
  const inPlay = table.players.filter((p) => !p.sittingOut);
  if (!inPlay.length) throw new HttpError(400, 'Nenhum jogador apostou.');
  for (const p of inPlay) {
    debitSeat(p, p.bet, 'Aposta no 21');
    table.roundPlays.push({ userId: p.isBot ? null : p.userId, action: `aposta ${p.bet}`, at: new Date().toISOString() });
  }
  for (let round = 0; round < 2; round++) {
    for (const p of inPlay) p.cards.push(draw(table));
    table.dealer.push(draw(table));
  }
  for (const p of inPlay) if (isBlackjack(p.cards)) p.blackjack = true;
  table.state = 'playing';
  broadcast(table);
  if (table.dealer.length === 2 && handTotal(table.dealer) === 21) {
    dealerPlay(table);
    return;
  }
  advanceTurn(table);
}

function newRound(table) {
  clearTimer(table);
  for (const p of table.players) {
    resetSeat(p);
    if (p.isBot) botBet(table, p);
    else if (p.ai) {
      const bank = walletOf(p.userId).fichas;
      if (bank < table.minBet) {
        p.bet = 0;
        p.sittingOut = true;
      } else {
        p.bet = Math.min(Math.max(table.minBet, Math.round(bank / 8 / 5) * 5), 400);
      }
    }
  }
  table.dealer = [];
  table.deck = [];
  table.reveal = false;
  table.activeIndex = -1;
  table.state = 'waiting';
  armPhaseTimer(table);
  broadcast(table);
}

function stopSeat(table, seat) {
  seat.stood = true;
  advanceTurn(table);
}

function applyAction(table, seat, action, count = 1) {
  const actor = seat.isBot ? null : seat.userId;
  const at = new Date().toISOString();
  if (action === 'hit') {
    const n = Math.max(1, Math.min(table.maxDraw, Math.floor(Number(count) || 1)));
    if (table.roundPlays) table.roundPlays.push({ userId: actor, action: `pede ${n}`, at });
    for (let i = 0; i < n; i++) {
      if (handTotal(seat.cards) >= 21) return stopSeat(table, seat);
      const ok = drawSafe(table, seat.cards);
      if (!ok) return stopSeat(table, seat);
      if (handTotal(seat.cards) >= 21) return stopSeat(table, seat);
    }
    armTimer(table);
    broadcast(table);
    return;
  }
  if (table.roundPlays) table.roundPlays.push({ userId: actor, action, at });
  if (action === 'stand') {
    return stopSeat(table, seat);
  }
  if (action === 'double') {
    if (seat.cards.length !== 2 || seat.doubled) throw new HttpError(400, 'Só é possível dobrar na primeira mão.');
    const funds = seat.isBot ? seat.bank : walletOf(seat.userId).fichas;
    if (funds < seat.bet) throw new HttpError(400, 'Fichas insuficientes para dobrar.');
    debitSeat(seat, seat.bet, 'Aposta no 21 (dobrar)');
    seat.bet *= 2;
    seat.doubled = true;
    drawSafe(table, seat.cards);
    return stopSeat(table, seat);
  }
  throw new HttpError(400, 'Ação inválida.');
}

function botAct(table, seat) {
  const dealerUp = table.dealer.length ? cardValue(table.dealer[0]) : 0;
  try {
    applyAction(table, seat, botDecision(table, seat, dealerUp));
  } catch {
    stopSeat(table, seat);
  }
}

export const blackjackRouter = new Router();

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Erro interno.' });
  }
};

blackjackRouter.get('/tables', requireAuth, wrap((req, res) => {
  res.json({ tables: [...tables.values()].map(listSummary) });
}));

blackjackRouter.post('/tables', requireAuth, wrap((req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 40) || `Mesa de ${req.user.display_name}`;
  const deckStyle = DECK_STYLES.includes(b.deckStyle) ? b.deckStyle : 'classic';
  const hintMode = b.hint === true || b.hint === 'true';
  const table = {
    id: nextTableId++,
    name,
    hostId: req.user.id,
    hostUserId: req.user.id,
    minBet: MIN_BET,
    deckStyle,
    hintMode,
    maxDraw: clampInt(b.maxDraw, 1, MAX_DRAW_CAP, DEFAULT_MAX_DRAW),
    turnMs: clampMs(b.turnMs, TURN_MS),
    intervalMs: clampMs(b.intervalMs, DEFAULT_INTERVAL_MS),
    state: 'waiting',
    players: [],
    dealer: [],
    deck: makeShoe(),
    shuffledAt: Date.now(),
    activeIndex: -1,
    reveal: false,
    turnTimer: null,
    phaseTimer: null,
    phase: null,
    botSeq: 0,
    online: new Map(),
    roundStartMs: null,
    roundPlays: [],
    createdAt: new Date().toISOString(),
  };
  tables.set(table.id, table);
  const botCount = Math.max(0, Math.min(Number(b.bots) || 0, MAX_PLAYERS - 1));
  for (let i = 0; i < botCount; i++) {
    const bot = makeBot(table);
    table.players.push(bot);
    botBet(table, bot);
  }
  armPhaseTimer(table);
  res.status(201).json({ table: publicState(table) });
}));

const RANK_GAMES = ['all', 'bj', 'poker'];

function rankRows(game) {
  const bj = db
    .prepare(
      `SELECT h.user_id AS id,
              SUM(CASE WHEN h.outcome IN ('venceu', 'blackjack') THEN 1 ELSE 0 END) AS wins,
              COUNT(*) AS games,
              SUM(h.delta) AS net,
              ROUND(AVG(h.total), 1) AS avgScore
       FROM hands h WHERE h.is_bot = 0 GROUP BY h.user_id`
    )
    .all();
  const pk = db
    .prepare(
      `SELECT p.user_id AS id,
              SUM(CASE WHEN p.net > 0 THEN 1 ELSE 0 END) AS wins,
              COUNT(*) AS games,
              SUM(p.net) AS net
       FROM poker_hands p WHERE p.is_bot = 0 GROUP BY p.user_id`
    )
    .all();
  const byId = new Map();
  const ensure = (id) => {
    if (!byId.has(id)) byId.set(id, { id, wins: 0, games: 0, net: 0, bjAvg: null, bjGames: 0, pkGames: 0 });
    return byId.get(id);
  };
  for (const r of bj) {
    const e = ensure(r.id);
    e.wins += r.wins || 0;
    e.games += r.games || 0;
    e.net += r.net || 0;
    e.bjAvg = r.avgScore;
    e.bjGames = r.games || 0;
  }
  for (const r of pk) {
    const e = ensure(r.id);
    e.wins += r.wins || 0;
    e.games += r.games || 0;
    e.net += r.net || 0;
    e.pkGames = r.games || 0;
  }
  let entries = [...byId.values()];
  if (game === 'bj') entries = entries.filter((e) => e.bjGames > 0);
  else if (game === 'poker') entries = entries.filter((e) => e.pkGames > 0);
  const users = new Map(
    db.prepare('SELECT id, display_name, avatar, color FROM users').all().map((u) => [u.id, u])
  );
  const rows = entries.map((e) => {
    const u = users.get(e.id) || {};
    return {
      id: e.id,
      name: u.display_name || 'Jogador',
      avatar: u.avatar || '👤',
      color: u.color || '#64748b',
      wins: e.wins,
      games: e.games,
      net: e.net,
      avgScore: game === 'poker' ? null : e.bjAvg ?? null,
      bjGames: e.bjGames,
      pkGames: e.pkGames,
    };
  });
  rows.sort((a, b) => b.wins - a.wins || a.games - b.games || b.net - a.net || a.name.localeCompare(b.name));
  return rows.slice(0, 50).map((r, i) => ({ pos: i + 1, ...r }));
}

blackjackRouter.get('/rank', requireAuth, wrap((req, res) => {
  const game = RANK_GAMES.includes(String(req.query.game)) ? String(req.query.game) : 'all';
  res.json({ rank: rankRows(game), game });
}));

function seatGoesOffline(table, uid) {
  const prev = table.online.get(uid) || 0;
  table.online.set(uid, Math.max(0, prev - 1));
  if (prev - 1 > 0) return;
  const idx = table.players.findIndex((p) => p.userId === uid);
  if (idx < 0) return;
  const seat = table.players[idx];
  if (table.state === 'playing' || table.state === 'dealer') {
    seat.ai = true;
    if (table.state === 'playing' && idx === table.activeIndex) {
      clearTimer(table);
      armTimer(table);
    }
    broadcast(table);
    return;
  }
  const wasHostOnly = table.players.length === 1 && table.hostId === uid;
  table.players.splice(idx, 1);
  if (idx < table.activeIndex) table.activeIndex -= 1;
  if (table.players.filter((p) => !p.isBot).length === 0) {
    clearTimer(table);
    tables.delete(table.id);
    return;
  }
  broadcast(table);
}

export function attachBlackjack(io, socket, user) {
  ioRef = io;
  const uid = user.id;

  const guard = (fn) => (payload, ack) => {
    try {
      const result = fn(payload || {});
      if (typeof ack === 'function') ack({ ok: true, ...(result || {}) });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  };

  socket.on('table:join', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    let seat = seatOf(table, uid);
    if (!seat) {
      if (table.players.length >= MAX_PLAYERS) throw new HttpError(400, 'Mesa cheia.');
      if (table.state === 'playing' || table.state === 'dealer') throw new HttpError(400, 'Rodada em andamento.');
      seat = newSeat(uid);
      table.players.push(seat);
    }
    seat.ai = false;
    table.online.set(uid, (table.online.get(uid) || 0) + 1);
    socket.join(`table:${table.id}`);
    broadcast(table);
  }));

  socket.on('table:leave', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) return;
    seatGoesOffline(table, uid);
    socket.leave(`table:${table.id}`);
  }));

  socket.on('disconnect', () => {
    for (const [, table] of tables) {
      if (seatOf(table, uid)) seatGoesOffline(table, uid);
    }
  });

  socket.on('table:bet', guard(({ tableId, amount }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.state !== 'waiting') throw new HttpError(400, 'Apostas encerradas.');
    const seat = seatOf(table, uid);
    if (!seat) throw new HttpError(400, 'Você não está nesta mesa.');
    let amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt < 0) amt = 0;
    if (amt > walletOf(uid).fichas) throw new HttpError(400, 'Fichas insuficientes.');
    if (amt > 0 && amt < table.minBet) amt = table.minBet;
    seat.bet = amt;
    broadcast(table);
  }));

  socket.on('table:start', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode iniciar.');
    if (table.state !== 'waiting') throw new HttpError(400, 'A mesa não está aguardando apostas.');
    dealRound(table);
  }));

  socket.on('table:action', guard(({ tableId, action, count }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.state !== 'playing') throw new HttpError(400, 'Não é hora de agir.');
    const seat = seatOf(table, uid);
    if (!seat || currentSeat(table) !== seat) throw new HttpError(400, 'Não é a sua vez.');
    applyAction(table, seat, action, count);
  }));

  socket.on('table:next', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode abrir nova rodada.');
    if (table.state !== 'finished') throw new HttpError(400, 'A rodada ainda não terminou.');
    newRound(table);
  }));

  socket.on('table:deck', guard(({ tableId, deckStyle }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode trocar o baralho.');
    if (table.state !== 'waiting') throw new HttpError(400, 'Troque o baralho antes de iniciar.');
    if (!DECK_STYLES.includes(deckStyle)) throw new HttpError(400, 'Baralho inválido.');
    table.deckStyle = deckStyle;
    broadcast(table);
  }));

  socket.on('table:settings', guard(({ tableId, turnMs, intervalMs, maxDraw }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode mudar as configurações.');
    if (table.state !== 'waiting') throw new HttpError(400, 'Ajuste as configurações antes de iniciar a rodada.');
    if (turnMs != null) table.turnMs = clampMs(turnMs, table.turnMs);
    if (intervalMs != null) table.intervalMs = clampMs(intervalMs, table.intervalMs);
    if (maxDraw != null) table.maxDraw = clampInt(maxDraw, 1, MAX_DRAW_CAP, table.maxDraw);
    armPhaseTimer(table);
    broadcast(table);
  }));

  socket.on('table:addBot', guard(({ tableId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode adicionar robôs.');
    if (table.state !== 'waiting') throw new HttpError(400, 'Adicione robôs antes de iniciar.');
    if (table.players.length >= MAX_PLAYERS) throw new HttpError(400, 'Mesa cheia.');
    const bot = makeBot(table);
    table.players.push(bot);
    botBet(table, bot);
    broadcast(table);
  }));

  socket.on('table:removeBot', guard(({ tableId, userId }) => {
    const table = tables.get(Number(tableId));
    if (!table) throw new HttpError(404, 'Mesa não encontrada.');
    if (table.hostId !== uid) throw new HttpError(403, 'Só o anfitrião pode remover robôs.');
    if (table.state !== 'waiting') throw new HttpError(400, 'Remova robôs antes de iniciar.');
    const idx = table.players.findIndex((p) => p.isBot && p.userId === Number(userId));
    if (idx < 0) throw new HttpError(404, 'Robô não encontrado.');
    table.players.splice(idx, 1);
    broadcast(table);
  }));
}