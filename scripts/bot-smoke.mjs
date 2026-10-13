import { io } from 'socket.io-client';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';
const nick = `robo_${Date.now().toString(36)}`;

async function json(path, opts = {}) {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path}: ${d.error}`);
  return d;
}

const { token, user, wallet } = await json('/api/register', {
  method: 'POST',
  body: { nickname: nick, password: 'senha123', displayName: 'Teste Robô' },
});
const startWallet = wallet.fichas;

const sock = io(BASE, { auth: { token } });
await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); });

const emit = (event, payload) => new Promise((res) => {
  const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 10000);
  sock.emit(event, payload, (r) => { clearTimeout(t); res(r || { ok: true }); });
});

const states = [];
const waitState = (pred, ms, tag = '?') => new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const s = states[states.length - 1];
    if (pred(s)) { clearInterval(iv); res(s); }
    else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`estado não alcançado (${tag}): ${JSON.stringify(s).slice(0, 160)}`)); }
  }, 120);
});

sock.on('table:state', (st) => states.push(st));

// criar mesa com 1 robô e baralho 'neon'
const { table } = await json('/api/tables', { method: 'POST', token, body: { name: 'Mesa Teste', deckStyle: 'neon', bots: 1 } });
states.push(table);
const startWaiting = await waitState((s) => s && s.id === table.id && s.state === 'waiting', 5000);
const bot = startWaiting.players.find((p) => p.isBot);
if (!bot) throw new Error('robô não criado');
if (bot.bet < 10) throw new Error(`robô não apostou (bet=${bot.bet})`);
if (startWaiting.deckStyle !== 'neon') throw new Error('deckStyle não propagado');

// entrar na mesa
let r = await emit('table:join', { tableId: table.id });
if (!r.ok) throw new Error(`join: ${r.error}`);
await waitState((s) => s && s.players.length === 2, 5000);

// apostar
r = await emit('table:bet', { tableId: table.id, amount: 50 });
if (!r.ok) throw new Error(`bet: ${r.error}`);

// iniciar
r = await emit('table:start', { tableId: table.id });
if (!r.ok) throw new Error(`start: ${r.error}`);

// esperar minha vez e jogar (nunca estourar de propósito)
// esperar a minha vez ou o fim (blackjack natural pode encerrar sem agir)
const myTurnState = await waitState((s) => {
  const p = s && s.players.find((x) => x.userId === user.id);
  return s && (p.isTurn || s.state === 'finished');
}, 15000, 'minha vez ou fim');
if (myTurnState.state === 'playing') {
  // segue agindo enquanto for a minha vez: pedir carta até 16, parar a partir de 17
  // (assim o turno nunca fica parado esperando os 30 s de timeout do jogo)
  for (let guard = 0; guard < 20; guard++) {
    const now = states[states.length - 1];
    const p = now.players.find((x) => x.userId === user.id);
    if (now.state !== 'playing' || !p.isTurn) break;
    const before = states.length;
    r = await emit('table:action', { tableId: table.id, action: p.total <= 16 ? 'hit' : 'stand' });
    if (!r.ok) throw new Error(`action: ${r.error}`);
    await waitState(() => states.length > before, 15000, 'estado pós-ação');
  }
}

// jogar a mão até finish
const finished = await waitState((s) => s && s.state === 'finished', 20000, 'finished');
const me = finished.players.find((p) => p.userId === user.id);
const meBot = finished.players.find((p) => p.isBot);
if (!me.outcome) throw new Error('meu outcome vazio');
if (!meBot.outcome) throw new Error('robô sem outcome');

// nova rodada deve re-apostar o robô
r = await emit('table:next', { tableId: table.id });
if (!r.ok) throw new Error(`next: ${r.error}`);
await waitState((s) => s && s.state === 'waiting', 5000);

// checar carteira no servidor
const { wallet: finalWallet } = await json('/api/me', { token });
const expected = startWallet + me.delta;
if (finalWallet.fichas !== expected) throw new Error(`carteira errada: esperado ${expected}, veio ${finalWallet.fichas}`);
if (finalWallet.fichas < 1000 - 100) throw new Error(`transação suspeita: ${finalWallet.fichas}`);

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
if (me.bet < 10) throw new Error('aposta minha não registrada');

console.log('PASS — rodada completa com robô');
console.log(JSON.stringify({
  mesa: finished.name, deck: finished.deckStyle,
  robô: { nome: meBot.displayName, bet: meBot.bet, outcome: meBot.outcome, bank: meBot.bank },
  meu: { bet: me.bet, outcome: me.outcome, delta: me.delta },
  carteira: `${startWallet} -> ${finalWallet.fichas}`,
  rodadasNoEstado: states.length,
}, null, 2));

sock.close();
process.exit(0);