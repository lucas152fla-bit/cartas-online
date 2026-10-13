import { io } from 'socket.io-client';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';
const mk = (p) => `t${Date.now().toString(36)}_${p}`;

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

async function playMyTurn(s, tableId, user) {
  await emit(s, 'table:action', { tableId, action: 'stand' });
}

// ============ Teste 1: criação com bots + partida + rank ============
{
  const { token, user } = await j('/api/register', { m: 'POST', b: { nickname: mk('a'), password: 'senha123', displayName: 'Alice' } });
  const { table } = await j('/api/tables', { m: 'POST', token, b: { name: 'Mesa com bots', deckStyle: 'royal', bots: 2, hint: true } });
  const bots = table.players.filter((p) => p.isBot);
  if (bots.length !== 2) throw new Error(`esperava 2 bots, veio ${bots.length}`);
  if (bots.some((b) => b.bet < 10)) throw new Error('bot sem aposta');
  if (table.deckStyle !== 'royal') throw new Error('deckStyle não propagado');
  if (table.hintMode !== true) throw new Error('hintMode não propagado na criação de mesa de 21');

  const s = await connect(token);
  let latest = table;
  s.on('table:state', (st) => { if (st.id === table.id) latest = st; });
  await emit(s, 'table:join', { tableId: table.id });
  await emit(s, 'table:bet', { tableId: table.id, amount: 100 });
  let r = await emit(s, 'table:start', { tableId: table.id });
  if (!r.ok) throw new Error(`start: ${r.error}`);

  const t0 = Date.now();
  while (latest.state !== 'finished') {
    if (Date.now() - t0 > 25000) throw new Error(`round não terminou (state=${latest.state}) ${JSON.stringify(latest).slice(0, 120)}`);
    // 'dealer'/'finished' logo após o start = banca com 21 no deal (rodada termina sem turnos)
    if (latest.state === 'playing' || latest.state === 'dealer') {
      const me = latest.players.find((p) => p.userId === user.id);
      if (me && me.isTurn && !me.stood) await playMyTurn(s, table.id, user);
    }
    await sleep(150);
  }
  const me = latest.players.find((p) => p.userId === user.id);
  if (!me.outcome) throw new Error('jogador sem outcome');
  s.close();

  const { rank } = await j('/api/rank', { token });
  const entry = rank.find((x) => x.id === user.id);
  if (!entry || entry.games < 1) throw new Error('rank não registrou a partida');
  console.log(`[T1 PASS] mesa com 2 bots → rodada ${me.outcome} (${me.delta}🪙) | rank: ${entry.pos}º (${entry.games} partida, ${entry.wins} vitórias, média ${entry.avgScore})`);
}

// ============ Teste 2: jogador cai no meio → robô assume → volta ============
{
  // Quando a banca tem 21 no deal, a rodada termina de imediato (sem turnos)
  // e não existe jogada pendente para a IA assumir — tentamos de novo.
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    const { token, user } = await j('/api/register', { m: 'POST', b: { nickname: mk(`b${attempt}`), password: 'senha123', displayName: `Bruno${attempt}` } });
    const { token: tokenSpec } = await j('/api/register', { m: 'POST', b: { nickname: mk(`sp${attempt}`), password: 'senha123', displayName: `Espectador${attempt}` } });
    const { table } = await j('/api/tables', { m: 'POST', token, b: { name: `Mesa queda ${attempt}`, deckStyle: 'classic', bots: 1 } });

    const s = await connect(token);
    const spec = await connect(tokenSpec);
    let latest = table;
    const history = [];
    spec.on('table:state', (st) => { if (st.id === table.id) { history.push(st); latest = st; } });

    await emit(s, 'table:join', { tableId: table.id });
    await emit(spec, 'table:join', { tableId: table.id }); // espectador, fica com aposta 0 (fora das jogadas)
    await emit(s, 'table:bet', { tableId: table.id, amount: 50 });
    await emit(s, 'table:start', { tableId: table.id });

    const t0 = Date.now();
    while (!(latest.state === 'playing' && latest.players.find((p) => p.userId === user.id)?.cards.length) && latest.state !== 'finished') {
      if (Date.now() - t0 > 8000) throw new Error(`rodada não começou: ${latest.state}`);
      await sleep(150);
    }
    // banca com 21 no deal → a rodada já acabou; sem turno para a IA assumir
    if (latest.state !== 'playing') { s.close(); spec.close(); continue; }
    await sleep(400); // assentamento: descarta um 'finished' que chegue atrasado
    if (latest.state !== 'playing') { s.close(); spec.close(); continue; }
    s.close(); // Bruno desaparece no meio da rodada

    const t1 = Date.now();
    while (latest.state !== 'finished') {
      if (Date.now() - t1 > 15000) throw new Error('rodada não terminou (IA não assumiu ou travou)');
      await sleep(150);
    }
    const seenAI = history.some((st) => st.players.find((p) => p.userId === user.id)?.ai === true);
    if (!seenAI) throw new Error('IA nunca assumiu o lugar de Bruno (ai=true não observado)');
    if (Date.now() - t1 > 10000) throw new Error('IA demorou demais para fechar a rodada (algo travado)');
    const brunoFim = latest.players.find((p) => p.userId === user.id);
    if (!brunoFim || !brunoFim.outcome) throw new Error('resultado de Bruno não salvo mesmo com IA');

    // Bruno volta para a mesa depois da rodada
    const s2 = await connect(token);
    let latest2 = latest;
    s2.on('table:state', (st) => { if (st.id === table.id) latest2 = st; });
    const rj = await emit(s2, 'table:join', { tableId: table.id });
    if (!rj.ok) throw new Error(`rejoin: ${rj.error}`);
    const brunoVoltou = latest2.players.find((p) => p.userId === user.id);
    if (brunoVoltou.ai) throw new Error('IA não devolveu o controle ao Bruno');
    s2.close(); spec.close();

    const { rank } = await j('/api/rank', { token });
    const b = rank.find((x) => x.id === user.id);
    if (!b || b.games < 1) throw new Error('partida de Bruno não contada no rank');
    console.log(`[T2 PASS] queda ao vivo: ai=true visto, rodada fechada em ${Date.now() - t1}ms (tentativa ${attempt}, ${brunoFim.outcome}) → Bruno voltou com controle restaurado | rank games=${b.games}`);
    done = true;
  }
  if (!done) throw new Error('IA nunca assumiu — banca fez 21 no deal em todas as tentativas');
}

console.log('SMOKE_OK');
process.exit(0);