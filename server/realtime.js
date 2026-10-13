import { Server } from 'socket.io';
import { verifyToken, getUser } from './auth.js';
import { db, isMember, globalConversation } from './db.js';
import { insertMessage } from './api.js';
import { attachBlackjack } from './games/blackjack.js';
import { attachPoker } from './games/poker.js';

const online = new Map();

const friendIdsOf = (userId) => {
  const rows = db
    .prepare(
      `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
       FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
    )
    .all(userId, userId, userId);
  return rows.map((r) => r.fid);
};

const conversationIdsOf = (userId) =>
  db.prepare('SELECT conversation_id AS id FROM conversation_members WHERE user_id = ?').all(userId).map((r) => r.id);

export function isOnline(userId) {
  return online.has(userId) && online.get(userId).size > 0;
}

export function onlineSnapshot() {
  return [...online.keys()];
}

export function setupRealtime(server) {
  const io = new Server(server, { cors: { origin: true } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const uid = verifyToken(token);
    const user = uid ? getUser(uid) : null;
    if (!user) return next(new Error('Não autenticado.'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const uid = user.id;

    if (!online.has(uid)) online.set(uid, new Set());
    online.get(uid).add(socket.id);

    socket.join(`user:${uid}`);
    socket.join(`conv:${globalConversation.id}`);
    for (const cid of conversationIdsOf(uid)) socket.join(`conv:${cid}`);

    for (const fid of friendIdsOf(uid)) io.to(`user:${fid}`).emit('presence:update', { userId: uid, online: true });

    socket.emit('presence:snapshot', { online: onlineSnapshot() });

    socket.on('message:send', (payload, ack) => {
      try {
        const conversationId = Number(payload?.conversationId);
        const body = String(payload?.body || '').trim();
        if (!conversationId || !body) throw new Error('Dados inválidos.');
        if (!isMember(conversationId, uid)) throw new Error('Sem acesso a esta conversa.');
        const msg = insertMessage(conversationId, uid, body);
        io.to(`conv:${conversationId}`).emit('message:new', msg);
        const conv = db.prepare('SELECT type FROM conversations WHERE id = ?').get(conversationId);
        if (conv?.type === 'global') {
          io.emit('conversation:bump', { conversationId, message: msg });
        } else {
          for (const memberId of allMemberIds(conversationId)) {
            io.to(`user:${memberId}`).emit('conversation:bump', { conversationId, message: msg });
          }
        }
        if (typeof ack === 'function') ack({ ok: true, message: msg });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('conversation:read', (payload) => {
      const conversationId = Number(payload?.conversationId);
      if (!conversationId || !isMember(conversationId, uid)) return;
      const maxId = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE conversation_id = ?').get(conversationId).n;
      db.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?')
        .run(maxId, conversationId, uid);
    });

    socket.on('typing', (payload) => {
      const conversationId = Number(payload?.conversationId);
      if (!conversationId || !isMember(conversationId, uid)) return;
      socket.to(`conv:${conversationId}`).emit('typing', {
        conversationId,
        userId: uid,
        name: user.display_name,
        typing: !!payload?.typing,
      });
    });

    socket.on('conversation:join', (payload) => {
      const conversationId = Number(payload?.conversationId);
      if (conversationId && isMember(conversationId, uid)) socket.join(`conv:${conversationId}`);
    });

    attachBlackjack(io, socket, user);
    attachPoker(io, socket, user);

    socket.on('disconnect', () => {
      const set = online.get(uid);
      if (!set) return;
      set.delete(socket.id);
      if (set.size === 0) {
        online.delete(uid);
        for (const fid of friendIdsOf(uid)) io.to(`user:${fid}`).emit('presence:update', { userId: uid, online: false });
      }
    });
  });

  return io;
}

function allMemberIds(conversationId) {
  return db.prepare('SELECT user_id AS id FROM conversation_members WHERE conversation_id = ?').all(conversationId).map((r) => r.id);
}
