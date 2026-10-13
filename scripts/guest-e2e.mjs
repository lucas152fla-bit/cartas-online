import { io } from 'socket.io-client';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';
const j = async (p, opts = {}) => {
  const r = await fetch(BASE + p, {
    method: opts.m || 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.b ? JSON.stringify(opts.b) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${p}: ${d.error}`);
  return d;
};
const connect = (token) => new Promise((res, rej) => {
  const s = io(BASE, { auth: { token }, forceNew: true });
  s.on('connect', () => res(s)); s.on('connect_error', rej);
});
const emit = (s, e, p) => new Promise((res) => {
  const t = setTimeout(() => res({ ok: false, error: 'timeout' }), 8000);
  s.emit(e, p, (r) => { clearTimeout(t); res(r || { ok: true }); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { token } = await j('/api/guest', { m: 'POST' });
const { user } = await j('/api/me', { token });
if (user.nickname !== '__dev') throw new Error('convidado não é __dev');

const { table } = await j('/api/tables', { m: 'POST', token, b: { name: 'Dev check', deckStyle: 'neon', bots: 1 } });
const s = await connect(token);
let latest = table;
s.on('table:state', (st) => { if (st.id === table.id) latest = st; });
await emit(s, 'table:join', { tableId: table.id });
await emit(s, 'table:bet', { tableId: table.id, amount: 50 });
await emit(s, 'table:start', { tableId: table.id });
const t0 = Date.now();
while (latest.state !== 'finished') {
  if (Date.now() - t0 > 25000) throw new Error(`não terminou (${latest.state})`);
  const me = latest.players.find((p) => p.userId === user.id);
  if (latest.state === 'playing' && me?.isTurn && !me.stood) await emit(s, 'table:action', { tableId: table.id, action: 'stand' });
  await sleep(120);
}
s.close();
if (!latest.players.find((p) => p.userId === user.id).outcome) throw new Error('sem resultado');
const { rank } = await j('/api/rank', { token });
console.log(`[GUEST E2E PASS] convidado __dev jogou rodada (${latest.players.find(p=>p.userId===user.id).outcome}) | rank games=${rank.find(r=>r.id===user.id)?.games}`);
process.exit(0);