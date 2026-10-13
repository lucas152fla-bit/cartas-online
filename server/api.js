import { Router } from 'express';
import {
  db,
  now,
  CURRENCIES,
  GEMAS_PARA_FICHAS,
  SPREAD_FICHAS_PARA_GEMAS,
  globalConversation,
  getOrCreateDm,
  addMember,
  isMember,
  publicUser,
  walletOf,
  addTransaction,
  CELEBRATIONS,
} from './db.js';
import { createUser, verifyLogin, requireAuth, sessionPayload, ensureGuestUser, ensureNickUser, HttpError } from './auth.js';
import { blackjackRouter } from './games/blackjack.js';
import { pokerRouter } from './games/poker.js';

export const api = new Router();

api.use(blackjackRouter);
api.use(pokerRouter);

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Erro interno.' });
  }
};

api.post('/guest', wrap((req, res) => {
  if (process.env.DISABLE_GUEST) throw new HttpError(404, 'Login de convidado desativado.');
  res.json(ensureGuestUser());
}));

api.post('/enter', wrap((req, res) => {
  const { nickname, displayName } = req.body || {};
  res.json(ensureNickUser(nickname, displayName));
}));

api.post('/register', wrap((req, res) => {
  const { nickname, password, displayName } = req.body || {};
  const user = createUser({ nickname, password, displayName });
  res.status(201).json(sessionPayload(user));
}));

api.post('/login', wrap((req, res) => {
  const { nickname, password } = req.body || {};
  const user = verifyLogin(nickname, password);
  if (!user) throw new HttpError(401, 'Apelido ou senha inválidos.');
  res.json(sessionPayload(user));
}));

api.get('/me', requireAuth, wrap((req, res) => {
  res.json({ user: publicUser(req.user), wallet: walletOf(req.user.id) });
}));

api.patch('/me', requireAuth, wrap((req, res) => {
  const b = req.body || {};
  const displayName = b.displayName != null ? String(b.displayName).trim().slice(0, 40) : req.user.display_name;
  const avatar = b.avatar != null ? String(b.avatar).slice(0, 8) : req.user.avatar;
  const color = b.color != null && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : req.user.color;
  const bio = b.bio != null ? String(b.bio).slice(0, 200) : req.user.bio;
  const statusText = b.statusText != null ? String(b.statusText).slice(0, 60) : req.user.status_text;
  const hex = (v, prev) => /^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : prev;
  const skin = hex(b.skin, req.user.skin);
  const hair = hex(b.hair, req.user.hair);
  const shirt = hex(b.shirt, req.user.shirt);
  const hats = ['none', 'cap', 'beanie', 'tophat', 'crown', 'horns'];
  const hat = hats.includes(b.hat) ? b.hat : req.user.hat;
  const celebration = CELEBRATIONS.includes(b.celebration) ? b.celebration : req.user.celebration;
  db.prepare(
    `UPDATE users SET display_name = ?, avatar = ?, color = ?, bio = ?, status_text = ?, skin = ?, hair = ?, shirt = ?, hat = ?, celebration = ?
     WHERE id = ?`
  ).run(displayName, avatar, color, bio, statusText, skin, hair, shirt, hat, celebration, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
}));

api.get('/users/search', requireAuth, wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ users: [] });
  const rows = db
    .prepare('SELECT * FROM users WHERE nickname LIKE ? AND id != ? ORDER BY nickname LIMIT 20')
    .all(`%${q}%`, req.user.id);
  res.json({ users: rows.map(publicUser) });
}));

api.get('/users/:id', requireAuth, wrap((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Usuário não encontrado.');
  res.json({ user: publicUser(row), friend: friendState(req.user.id, id) });
}));

function friendState(meId, otherId) {
  const row = db
    .prepare(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
    )
    .get(meId, otherId, otherId, meId);
  if (!row) return { status: 'none' };
  if (row.status === 'accepted') return { status: 'friends', since: row.created_at };
  return { status: row.requester_id === meId ? 'outgoing' : 'incoming', requestId: row.id };
}

api.get('/friends', requireAuth, wrap((req, res) => {
  const me = req.user.id;
  const friends = db
    .prepare(
      `SELECT u.* FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
       ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(me, me, me);
  const incoming = db
    .prepare(
      `SELECT f.id AS request_id, f.created_at AS requested_at, u.* FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.id DESC`
    )
    .all(me);
  const outgoing = db
    .prepare(
      `SELECT f.id AS request_id, f.created_at AS requested_at, u.* FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.id DESC`
    )
    .all(me);
  res.json({
    friends: friends.map(publicUser),
    incoming: incoming.map((r) => ({ ...publicUser(r), requestId: r.request_id, requestedAt: r.requested_at })),
    outgoing: outgoing.map((r) => ({ ...publicUser(r), requestId: r.request_id, requestedAt: r.requested_at })),
  });
}));

api.post('/friends/request', requireAuth, wrap((req, res) => {
  const me = req.user.id;
  const b = req.body || {};
  let targetId = b.userId ? Number(b.userId) : null;
  if (!targetId && b.nickname) {
    const u = db.prepare('SELECT id FROM users WHERE nickname = ?').get(String(b.nickname).trim());
    targetId = u ? u.id : null;
  }
  if (!targetId) throw new HttpError(404, 'Usuário não encontrado.');
  if (targetId === me) throw new HttpError(400, 'Você não pode adicionar você mesmo.');
  const state = friendState(me, targetId);
  if (state.status === 'friends') throw new HttpError(409, 'Vocês já são amigos.');
  if (state.status === 'outgoing') throw new HttpError(409, 'Pedido já enviado.');
  if (state.status === 'incoming') {
    db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(state.requestId);
    return res.json({ ok: true, status: 'friends' });
  }
  db.prepare('INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, ?)')
    .run(me, targetId, 'pending', now());
  res.status(201).json({ ok: true, status: 'outgoing' });
}));

api.post('/friends/:requestId/accept', requireAuth, wrap((req, res) => {
  const r = db.prepare('SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = \'pending\'')
    .get(Number(req.params.requestId), req.user.id);
  if (!r) throw new HttpError(404, 'Pedido não encontrado.');
  db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(r.id);
  res.json({ ok: true });
}));

api.post('/friends/:requestId/decline', requireAuth, wrap((req, res) => {
  const r = db.prepare('SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = \'pending\'')
    .get(Number(req.params.requestId), req.user.id);
  if (!r) throw new HttpError(404, 'Pedido não encontrado.');
  db.prepare('DELETE FROM friendships WHERE id = ?').run(r.id);
  res.json({ ok: true });
}));

api.delete('/friends/:friendId', requireAuth, wrap((req, res) => {
  const me = req.user.id;
  const other = Number(req.params.friendId);
  db.prepare(
    `DELETE FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`
  ).run(me, other, other, me);
  res.json({ ok: true });
}));

function membersOf(conversationId) {
  return db
    .prepare(
      `SELECT u.*, m.role, m.joined_at, m.last_read_id FROM conversation_members m
       JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY m.role = 'owner' DESC, u.display_name COLLATE NOCASE`
    )
    .all(conversationId)
    .map((r) => ({ ...publicUser(r), role: r.role, joinedAt: r.joined_at, lastReadId: r.last_read_id }));
}

function lastMessage(conversationId) {
  const m = db
    .prepare(
      `SELECT msg.*, u.display_name AS sender_name, u.avatar AS sender_avatar, u.color AS sender_color
       FROM messages msg LEFT JOIN users u ON u.id = msg.sender_id
       WHERE msg.conversation_id = ? ORDER BY msg.id DESC LIMIT 1`
    )
    .get(conversationId);
  if (!m) return null;
  return {
    id: m.id,
    body: m.body,
    senderId: m.sender_id,
    senderName: m.sender_name,
    senderAvatar: m.sender_avatar,
    senderColor: m.sender_color,
    createdAt: m.created_at,
  };
}

export function serializeConversation(conv, meId) {
  const members = membersOf(conv.id);
  const my = members.find((m) => m.id === meId);
  const unread = db
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND id > ? AND sender_id != ?')
    .get(conv.id, my ? my.lastReadId : 0, meId).n;
  let name = conv.name;
  let avatar = '👥';
  let color = '#64748b';
  if (conv.type === 'dm') {
    const other = members.find((m) => m.id !== meId);
    name = other ? other.displayName : 'Conversa';
    avatar = other ? other.avatar : '👤';
    color = other ? other.color : color;
  } else if (conv.type === 'global') {
    avatar = '🌐';
    color = '#8b5cf6';
  }
  return {
    id: conv.id,
    type: conv.type,
    key: conv.ckey,
    name,
    avatar,
    color,
    createdBy: conv.created_by,
    createdAt: conv.created_at,
    members,
    lastMessage: lastMessage(conv.id),
    unread,
  };
}

api.get('/conversations', requireAuth, wrap((req, res) => {
  const convs = db
    .prepare(
      `SELECT c.* FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = ?
       ORDER BY COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = c.id), c.id) DESC`
    )
    .all(req.user.id);
  res.json({ conversations: convs.map((c) => serializeConversation(c, req.user.id)) });
}));

api.post('/conversations/dm', requireAuth, wrap((req, res) => {
  const target = Number((req.body || {}).userId);
  if (!target) throw new HttpError(400, 'userId obrigatório.');
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(target)) throw new HttpError(404, 'Usuário não encontrado.');
  const conv = getOrCreateDm(req.user.id, target);
  const io = req.app.get('io');
  for (const uid of [req.user.id, target]) {
    io?.in(`user:${uid}`).socketsJoin(`conv:${conv.id}`);
    io?.to(`user:${uid}`).emit('conversation:updated', { id: conv.id });
  }
  res.json({ conversation: serializeConversation(conv, req.user.id) });
}));

api.post('/conversations/group', requireAuth, wrap((req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60) || 'Novo grupo';
  const ids = Array.isArray(b.memberIds) ? b.memberIds.map(Number).filter((n) => n && n !== req.user.id) : [];
  if (ids.length < 1) throw new HttpError(400, 'Escolha ao menos um amigo.');
  const ckey = `group:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const info = db
    .prepare("INSERT INTO conversations (type, name, ckey, created_by, created_at) VALUES ('group', ?, ?, ?, ?)")
    .run(name, ckey, req.user.id, now());
  const id = Number(info.lastInsertRowid);
  addMember(id, req.user.id, 'owner');
  for (const uid of ids) if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) addMember(id, uid);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  const io = req.app.get('io');
  for (const member of membersOf(id)) {
    io?.in(`user:${member.id}`).socketsJoin(`conv:${id}`);
    io?.to(`user:${member.id}`).emit('conversation:updated', { id });
  }
  res.status(201).json({ conversation: serializeConversation(conv, req.user.id) });
}));

api.get('/conversations/:id', requireAuth, wrap((req, res) => {
  const id = Number(req.params.id);
  if (!isMember(id, req.user.id)) throw new HttpError(403, 'Você não participa desta conversa.');
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conv) throw new HttpError(404, 'Conversa não encontrada.');
  res.json({ conversation: serializeConversation(conv, req.user.id) });
}));

api.get('/conversations/:id/messages', requireAuth, wrap((req, res) => {
  const id = Number(req.params.id);
  if (!isMember(id, req.user.id)) throw new HttpError(403, 'Você não participa desta conversa.');
  const before = Number(req.query.before || 0);
  const limit = Math.min(Number(req.query.limit || 50), 100);
  const rows = db
    .prepare(
      `SELECT msg.*, u.display_name AS sender_name, u.avatar AS sender_avatar, u.color AS sender_color
       FROM messages msg LEFT JOIN users u ON u.id = msg.sender_id
       WHERE msg.conversation_id = ? AND (? = 0 OR msg.id < ?)
       ORDER BY msg.id DESC LIMIT ?`
    )
    .all(id, before, before, limit);
  res.json({ messages: rows.reverse().map(serializeMessage) });
}));

export function serializeMessage(m) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    senderName: m.sender_name,
    senderAvatar: m.sender_avatar,
    senderColor: m.sender_color,
    body: m.body,
    createdAt: m.created_at,
  };
}

api.post('/conversations/:id/messages', requireAuth, wrap((req, res) => {
  const id = Number(req.params.id);
  if (!isMember(id, req.user.id)) throw new HttpError(403, 'Você não participa desta conversa.');
  const body = String((req.body || {}).body || '').trim();
  if (!body) throw new HttpError(400, 'Mensagem vazia.');
  const msg = insertMessage(id, req.user.id, body);
  req.app.get('io')?.to(`conv:${id}`).emit('message:new', msg);
  res.status(201).json({ message: msg });
}));

export function insertMessage(conversationId, senderId, body) {
  const text = String(body).trim().slice(0, 2000);
  const info = db
    .prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(conversationId, senderId, text, now());
  const row = db
    .prepare(
      `SELECT msg.*, u.display_name AS sender_name, u.avatar AS sender_avatar, u.color AS sender_color
       FROM messages msg LEFT JOIN users u ON u.id = msg.sender_id WHERE msg.id = ?`
    )
    .get(info.lastInsertRowid);
  return serializeMessage(row);
}

api.post('/conversations/:id/read', requireAuth, wrap((req, res) => {
  const id = Number(req.params.id);
  if (!isMember(id, req.user.id)) throw new HttpError(403, 'Você não participa desta conversa.');
  const maxId = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE conversation_id = ?').get(id).n;
  db.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?')
    .run(maxId, id, req.user.id);
  res.json({ ok: true, lastReadId: maxId });
}));

api.post('/conversations/:id/members', requireAuth, wrap((req, res) => {
  const id = Number(req.params.id);
  if (!isMember(id, req.user.id)) throw new HttpError(403, 'Você não participa desta conversa.');
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conv || conv.type !== 'group') throw new HttpError(400, 'Só é possível adicionar pessoas a grupos.');
  const uid = Number((req.body || {}).userId);
  if (!uid) throw new HttpError(400, 'userId obrigatório.');
  addMember(id, uid);
  const io = req.app.get('io');
  io?.to(`user:${uid}`).socketsJoin(`conv:${id}`);
  const payload = serializeConversation(conv, req.user.id);
  io?.to(`conv:${id}`).emit('conversation:updated', payload);
  res.json({ conversation: payload });
}));

api.get('/wallet', requireAuth, wrap((req, res) => {
  res.json({ wallet: walletOf(req.user.id), rate: { gemasParaFichas: GEMAS_PARA_FICHAS, spread: SPREAD_FICHAS_PARA_GEMAS } });
}));

api.get('/wallet/transactions', requireAuth, wrap((req, res) => {
  const rows = db
    .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
  res.json({
    transactions: rows.map((r) => ({
      id: r.id, currency: r.currency, amount: r.amount, kind: r.kind, note: r.note, createdAt: r.created_at,
    })),
  });
}));

api.post('/wallet/convert', requireAuth, wrap((req, res) => {
  const { from, to } = req.body || {};
  const amount = Math.floor(Number((req.body || {}).amount));
  if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || from === to) {
    throw new HttpError(400, 'Conversão inválida.');
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Quantidade inválida.');
  const wallet = walletOf(req.user.id);
  if (wallet[from] < amount) throw new HttpError(400, `Saldo insuficiente de ${from}.`);

  let received;
  if (from === 'gemas') received = Math.floor(amount * GEMAS_PARA_FICHAS);
  else received = Math.floor((amount * SPREAD_FICHAS_PARA_GEMAS) / GEMAS_PARA_FICHAS);
  if (received <= 0) throw new HttpError(400, 'Quantidade muito baixa para converter.');

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE wallets SET ${from} = ${from} - ? WHERE user_id = ?`).run(amount, req.user.id);
    db.prepare(`UPDATE wallets SET ${to} = ${to} + ? WHERE user_id = ?`).run(received, req.user.id);
    addTransaction(req.user.id, from, -amount, 'convert_out', `Conversão para ${to}`);
    addTransaction(req.user.id, to, received, 'convert_in', `Conversão de ${from}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ wallet: walletOf(req.user.id), received, rate: { gemasParaFichas: GEMAS_PARA_FICHAS, spread: SPREAD_FICHAS_PARA_GEMAS } });
}));

api.get('/global', requireAuth, wrap((req, res) => {
  res.json({ conversation: serializeConversation(globalConversation, req.user.id) });
}));
