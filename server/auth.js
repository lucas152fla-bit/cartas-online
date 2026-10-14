import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, now, selfUser, findUserByNickname, walletOf, ensureGlobalMember } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const secretFile = join(__dirname, '..', 'data', '.secret');

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const s = randomBytes(48).toString('hex');
  writeFileSync(secretFile, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const hash = (password, salt) => scryptSync(password, salt, 64).toString('hex');

export function createUser({ nickname, password, displayName, email }) {
  const nick = String(nickname || '').trim();
  if (nick.length < 3 || nick.length > 20) throw new HttpError(400, 'O apelido precisa ter entre 3 e 20 caracteres.');
  if (!/^[a-zA-Z0-9_.-]+$/.test(nick)) throw new HttpError(400, 'Use apenas letras, números, ponto, hífen ou underline no apelido.');
  if (!password || String(password).length < 4) throw new HttpError(400, 'A senha precisa ter ao menos 4 caracteres.');
  const existing = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nick);
  if (existing) throw new HttpError(409, 'Esse apelido já está em uso.');

  let emailNorm = null;
  if (email != null && String(email).trim() !== '') {
    emailNorm = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) throw new HttpError(400, 'Email inválido.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm)) throw new HttpError(409, 'Email já cadastrado.');
  }

  const salt = randomBytes(16).toString('hex');
  const passwordHash = hash(String(password), salt);
  const display = (String(displayName || '').trim() || nick).slice(0, 40);
  const info = db
    .prepare(
      `INSERT INTO users (nickname, email, password_hash, salt, display_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(nick, emailNorm, passwordHash, salt, display, now());
  const userId = Number(info.lastInsertRowid);
  walletOf(userId);
  ensureGlobalMember(userId);
  return getUser(userId);
}

export function checkPassword(user, password) {
  if (!user || !user.salt || !user.password_hash) return false;
  const candidate = Buffer.from(hash(String(password || ''), user.salt), 'hex');
  const expected = Buffer.from(user.password_hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function verifyLogin(nickname, password) {
  const row = findUserByNickname(nickname);
  if (!row) return null;
  if (!checkPassword(row, password)) return null;
  ensureGlobalMember(row.id);
  return row;
}

export function loginByReserve(nickname, email) {
  const row = findUserByNickname(nickname);
  if (!row) return null;
  const normEmail = String(email || '').trim().toLowerCase();
  const userEmail = String(row.email || '').trim().toLowerCase();
  if (!normEmail || !userEmail || userEmail !== normEmail) return null;
  ensureGlobalMember(row.id);
  return row;
}

export function setUserPassword(userId, newPassword) {
  if (!newPassword || String(newPassword).length < 4) throw new HttpError(400, 'A senha precisa ter ao menos 4 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hash(String(newPassword), salt);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(passwordHash, salt, userId);
}

export function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function issueToken(userId) {
  const payload = b64url(JSON.stringify({ uid: userId, iat: Date.now() }));
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - data.iat > TOKEN_TTL_MS) return null;
    return data.uid;
  } catch {
    return null;
  }
}

export function tokenFromRequest(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const cookie = req.headers['cookie'] || '';
  const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function currentUser(req) {
  const uid = verifyToken(tokenFromRequest(req));
  return uid ? getUser(uid) : null;
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  req.user = user;
  next();
}

export function sessionPayload(user) {
  return {
    token: issueToken(user.id),
    user: selfUser(user),
    wallet: walletOf(user.id),
  };
}

export function ensureGuestUser() {
  const GUEST_NICK = '__dev';
  let row = db.prepare('SELECT * FROM users WHERE nickname = ?').get(GUEST_NICK);
  if (!row) {
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hash(randomBytes(16).toString('hex'), salt);
    const info = db
      .prepare(
        `INSERT INTO users (nickname, password_hash, salt, display_name, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(GUEST_NICK, passwordHash, salt, 'Dev', now());
    const userId = Number(info.lastInsertRowid);
    walletOf(userId);
    ensureGlobalMember(userId);
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  }
  return sessionPayload(row);
}

export function ensureNickUser(nickname, displayName) {
  const nick = String(nickname || '').trim();
  if (nick.length < 3 || nick.length > 20) throw new HttpError(400, 'O apelido precisa ter entre 3 e 20 caracteres.');
  if (!/^[a-zA-Z0-9_.-]+$/.test(nick)) throw new HttpError(400, 'Use apenas letras, números, ponto, hífen ou underline no apelido.');
  const display = (String(displayName || '').trim() || nick).slice(0, 40);
  let row = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nick);
  if (!row) {
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hash(randomBytes(16).toString('hex'), salt);
    const info = db
      .prepare(
        `INSERT INTO users (nickname, password_hash, salt, display_name, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(nick, passwordHash, salt, display, now());
    const userId = Number(info.lastInsertRowid);
    walletOf(userId);
    ensureGlobalMember(userId);
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  }
  return sessionPayload(row);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
