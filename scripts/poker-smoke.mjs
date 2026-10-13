import { io } from 'socket.io-client';
import { DatabaseSync } from 'node:sqlite';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';
const mk = (p) => `pk${Date.now().toString(36)}_${p}`;

async function j(path, opts = {}) {
  const r = await fetch(BASE + path, {
    method: opts.m || 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.b ? JSON.stringify(opts.b) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path}: ${d.error}`);
  return d;
}

function connect(token) {
  const s = io(BASE, { auth: { token }, forceNew: true });
  return new Promise((res, rej) => { s.on('connect', () => res(s)); s.on('connect_error', rej); });
}

const emit = (s, e, p) => new Promise((res) => {
  const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 8000);
  s.emit(e, p, (r) => { clearTimeout(t); res(r || { ok: true }); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { token, user, wallet } = await j('/api/register', { m: 'POST', b: { nickname: mk('a'), password: 'senha123', displayName: 'Poker Alice' } });
const startWallet = wallet.fichas;

const { user: prof } = await j('/api/me', { m: 'PATCH', token, b: { celebration: 'trophy' } });
if (prof.celebration !== 'trophy') throw new Error(`celebração não salva no perfil (veio ${prof.celebration})`);

const { table } = await j('/api/poker/tables', { m: 'POST', token, b: { name: 'Mesa Smoke', bots: 2, hint: true, deckStyle: 'neon', blinds: 'baixo' } });
if (table.hintMode !== true) throw new Error('hintMode não propagado na criação de mesa de poker');
const botNames = table.players.filter((p) => p.isBot).map((b) => b.displayName);
if (botNames.length !== 2) throw new Error(`esperava 2 bots, veio ${botNames.length}`);
if (table.deckStyle !== 'neon') throw new Error(`deckStyle errado: ${table.deckStyle}`);
if (table.sb !== 2 || table.bb !== 5 || table.buyIn !== 100) throw new Error(`preset baixo errado: ${table.sb}/${table.bb}/${table.buyIn}`);
if (table.minRaise !== table.bb) throw new Error(`minRaise da sala de espera deveria ser o bb (${table.bb}), veio ${table.minRaise}`);

// Criação: presets, clamps e deckStyle inválido (mesas extras in-memory, não jogadas)
const { table: tAlto } = await j('/api/poker/tables', { m: 'POST', token, b: { name: 'Mesa Alto', blinds: 'alto' } });
if (tAlto.sb !== 50 || tAlto.bb !== 100 || tAlto.buyIn !== 2000) throw new Error(`preset alto errado: ${tAlto.sb}/${tAlto.bb}/${tAlto.buyIn}`);
if (tAlto.minRaise !== 100) throw new Error(`minRaise do preset alto deveria ser 100, veio ${tAlto.minRaise}`);
if (tAlto.deckStyle !== 'classic') throw new Error(`deckStyle padrão deveria ser classic (veio ${tAlto.deckStyle})`);

const { table: tBadDeck } = await j('/api/poker/tables', { m: 'POST', token, b: { name: 'Mesa Deck Ruim', deckStyle: 'zzz' } });
if (tBadDeck.deckStyle !== 'classic') throw new Error(`deckStyle inválido deveria virar classic (veio ${tBadDeck.deckStyle})`);

const { table: tZero } = await j('/api/poker/tables', { m: 'POST', token, b: { name: 'Mesa Zero', sb: 0, bb: 0, buyIn: 0 } });
if (tZero.sb !== 1 || tZero.bb !== 1 || tZero.buyIn !== 10) throw new Error(`clamps errados: ${tZero.sb}/${tZero.bb}/${tZero.buyIn}`);

const { table: tCustom } = await j('/api/poker/tables', { m: 'POST', token, b: { name: 'Mesa Custom', sb: 3, bb: 7, buyIn: 100 } });
if (tCustom.sb !== 3 || tCustom.bb !== 7 || tCustom.buyIn !== 100) throw new Error(`valores custom errados: ${tCustom.sb}/${tCustom.bb}/${tCustom.buyIn}`);

const s = await connect(token);
let latest = null;
let myHole = [];
s.on('poker:state', (st) => { if (st.id === table.id) latest = st; });
s.on('poker:hole', (h) => { if (h.tableId === table.id) myHole = h.hole; });

let r = await emit(s, 'poker:join', { tableId: table.id });
if (!r.ok) throw new Error(`join: ${r.error}`);
await sleep(150);
if (!latest || latest.players.length !== 3) throw new Error('assento não apareceu');

// Sala de espera: o anfitrião troca o baralho e o broadcast propaga
r = await emit(s, 'poker:deck', { tableId: table.id, deckStyle: 'royal' });
if (!r.ok) throw new Error(`deck royal: ${r.error}`);
await sleep(150);
if (latest.deckStyle !== 'royal') throw new Error(`broadcast do baralho royal não aplicado (veio ${latest.deckStyle})`);

r = await emit(s, 'poker:deck', { tableId: table.id, deckStyle: 'neon' });
if (!r.ok) throw new Error(`deck neon: ${r.error}`);
await sleep(150);
if (latest.deckStyle !== 'neon') throw new Error(`broadcast do baralho neon não aplicado (veio ${latest.deckStyle})`);

r = await emit(s, 'poker:deck', { tableId: table.id, deckStyle: 'invalido' });
if (r.ok !== false) throw new Error('deckStyle inválido deveria ser rejeitado');

async function playHand({ doRaise }) {
  myHole = [];
  const sawHole = new Promise((res) => {
    const iv = setInterval(() => { if (myHole.length === 2) { clearInterval(iv); res(true); } }, 60);
    setTimeout(() => { clearInterval(iv); res(false); }, 6000);
  });
  const st0 = await emit(s, 'poker:start', { tableId: table.id });
  if (!st0.ok) throw new Error(`start: ${st0.error}`);
  if (!(await sawHole)) throw new Error('não recebi minhas 2 cartas (poker:hole)');

  let raised = false;
  const t0 = Date.now();
  while (latest.state !== 'finished') {
    if (Date.now() - t0 > 30000) throw new Error(`mão não terminou (state=${latest.state}, round=${latest.round})`);
    const me = latest.players.find((p) => p.userId === user.id);
    if (latest.state === 'playing' && me.isTurn && !me.folded && !me.allIn) {
      const toCall = Math.max(0, latest.currentBet - me.bet);
      let action;
      if (doRaise && !raised && me.stack > latest.minRaise) {
        action = { type: 'raise', amount: Math.min(me.bet + me.stack, latest.currentBet + latest.minRaise) };
        raised = true;
      } else {
        action = toCall > 0 ? { type: 'call' } : { type: 'check' };
      }
      const ar = await emit(s, 'poker:action', { tableId: table.id, action });
      if (!ar.ok) throw new Error(`action ${action.type}: ${ar.error}`);
    }
    await sleep(110);
  }
  if (doRaise && !raised) throw new Error('não consegui aumentar (caminho de raise não exercitado)');
  return latest;
}

// Mão 1 — só paga/mesa: força um showdown real (revela as cartas vencedoras)
const h1 = await playHand({ doRaise: false });
if (!h1.results || h1.results.length !== 3) throw new Error(`resultados incompletos: ${h1.results?.length}`);
const net1 = h1.results.reduce((n, x) => n + (x.net || 0), 0);
if (net1 !== 0) throw new Error(`conservação quebrada (mão 1): soma dos nets = ${net1}`);
const showdown = h1.players.filter((p) => p.holeShown).length;
if (showdown < 2) throw new Error(`sem showdown: só ${showdown} cartas reveladas`);
const meRes1 = h1.results.find((x) => x.userId === user.id);

// Mão 2 — exerce o aumento (raise) e a próxima mão
const h2 = await playHand({ doRaise: true });
const net2 = h2.results.reduce((n, x) => n + (x.net || 0), 0);
if (net2 !== 0) throw new Error(`conservação quebrada (mão 2): soma dos nets = ${net2}`);
const meRes2 = h2.results.find((x) => x.userId === user.id);

// Persistência: a mão salva em poker_rounds guarda o deck_style vigente
const db = new DatabaseSync(process.env.DB_PATH || '/home/lukaz/cartas-online/data/cartas.db');
const roundRow = db.prepare('SELECT deck_style FROM poker_rounds WHERE table_id = ? ORDER BY id DESC LIMIT 1').get(table.id);
db.close();
if (!roundRow) throw new Error('nenhuma mão salva em poker_rounds para esta mesa');
if (roundRow.deck_style !== 'neon') throw new Error(`deck_style persistido errado: ${roundRow.deck_style}`);

// Carteira: cada mão debita o buy-in e credita o stack final; líquido = soma dos nets
const { wallet: w1 } = await j('/api/me', { token });
const expected = startWallet + meRes1.net + meRes2.net;
if (w1.fichas !== expected) throw new Error(`carteira errada: esperado ${expected}, veio ${w1.fichas}`);

// Ranking/histórico: mãos salvas no banco e somadas ao ranking
const sumNet = meRes1.net + meRes2.net;
const { rank: rankPk } = await j('/api/rank?game=poker', { token });
const rp = rankPk.find((x) => x.id === user.id);
if (!rp || rp.games < 2) throw new Error(`poker não entrou no ranking (games=${rp?.games})`);
if (rp.net !== sumNet) throw new Error(`net do ranking de poker errado: ${rp.net} != ${sumNet}`);
if (rp.avgScore !== null) throw new Error(`avgScore não deveria vir no ranking de poker (veio ${rp.avgScore})`);
const { rank: rankAll } = await j('/api/rank?game=all', { token });
const ra = rankAll.find((x) => x.id === user.id);
if (!ra || (ra.pkGames || 0) < 2 || ra.games < 2) throw new Error(`games combinados errados: games=${ra?.games}, pkGames=${ra?.pkGames}`);
if (ra.net !== sumNet) throw new Error(`net combinado errado: ${ra.net} != ${sumNet}`);
const { rank: rankBj } = await j('/api/rank?game=bj', { token });
if (rankBj.some((x) => x.id === user.id)) throw new Error('jogador só de poker apareceu no ranking de 21');

r = await emit(s, 'poker:next', { tableId: table.id });
if (!r.ok) throw new Error(`next: ${r.error}`);
await sleep(200);
if (latest.state !== 'waiting') throw new Error(`próxima mão não voltou pra waiting (${latest.state})`);

r = await emit(s, 'poker:leave', { tableId: table.id });
if (!r.ok) throw new Error(`leave: ${r.error}`);
s.close();

console.log('POKER_OK');
console.log(JSON.stringify({
  mesa: h1.name,
  baralho: table.deckStyle,
  blinds: `${table.sb}/${table.bb} · buy-in ${table.buyIn}`,
  bots: botNames,
  'mão1': `${meRes1.handName || 'todos desistiram'} · net ${meRes1.net >= 0 ? '+' : ''}${meRes1.net} 🪙 | cartas reveladas: ${showdown}`,
  'mão2': `${meRes2.handName || 'todos desistiram'} · net ${meRes2.net >= 0 ? '+' : ''}${meRes2.net} 🪙 (com aumento)`,
  carteira: `${startWallet} -> ${w1.fichas}`,
  ranking: `poker: ${rp.pos}º · ${rp.games} mãos · ${rp.wins} vitórias · net ${rp.net >= 0 ? '+' : ''}${rp.net} 🪙 | geral games=${ra.games}`,
}, null, 2));
process.exit(0);
