import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || join(dataDir, 'cartas.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT,
  avatar_image  TEXT,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT '🂡',
  color         TEXT NOT NULL DEFAULT '#3b82f6',
  bio           TEXT NOT NULL DEFAULT '',
  status_text   TEXT NOT NULL DEFAULT '',
  skin          TEXT NOT NULL DEFAULT '#e8b58a',
  hair          TEXT NOT NULL DEFAULT '#5b3a2a',
  shirt         TEXT NOT NULL DEFAULT '#3b82f6',
  hat           TEXT NOT NULL DEFAULT 'none',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  fichas  INTEGER NOT NULL DEFAULT 0,
  gemas   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency   TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id DESC);

CREATE TABLE IF NOT EXISTS friendships (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TEXT NOT NULL,
  UNIQUE(requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  ckey       TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  joined_at       TEXT NOT NULL,
  last_read_id    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id DESC);

CREATE TABLE IF NOT EXISTS rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id    INTEGER NOT NULL,
  table_name  TEXT NOT NULL,
  deck_style  TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hands (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT NOT NULL,
  is_bot     INTEGER NOT NULL DEFAULT 0,
  bet        INTEGER NOT NULL DEFAULT 0,
  outcome    TEXT NOT NULL,
  delta      INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,
  doubled    INTEGER NOT NULL DEFAULT 0,
  cards_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_hands_round ON hands(round_id);
CREATE INDEX IF NOT EXISTS idx_hands_user ON hands(user_id);

CREATE TABLE IF NOT EXISTS plays (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action   TEXT NOT NULL,
  at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plays_round ON plays(round_id);

CREATE TABLE IF NOT EXISTS poker_rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id    INTEGER NOT NULL,
  table_name  TEXT NOT NULL,
  deck_style  TEXT NOT NULL DEFAULT 'classic',
  sb          INTEGER NOT NULL DEFAULT 0,
  bb          INTEGER NOT NULL DEFAULT 0,
  buy_in      INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  ended_at    TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS poker_hands (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id   INTEGER NOT NULL REFERENCES poker_rounds(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT NOT NULL,
  is_bot     INTEGER NOT NULL DEFAULT 0,
  buy_in     INTEGER NOT NULL DEFAULT 0,
  net        INTEGER NOT NULL DEFAULT 0,
  result     TEXT NOT NULL,
  hand_name  TEXT NOT NULL DEFAULT '',
  hole_json  TEXT NOT NULL DEFAULT '[]',
  board_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_pkhands_round ON poker_hands(round_id);
CREATE INDEX IF NOT EXISTS idx_pkhands_user ON poker_hands(user_id);

CREATE TABLE IF NOT EXISTS poker_plays (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES poker_rounds(id) ON DELETE CASCADE,
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  street   TEXT NOT NULL DEFAULT '',
  action   TEXT NOT NULL,
  at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pkplays_round ON poker_plays(round_id);

CREATE TABLE IF NOT EXISTS support_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_created ON support_posts(created_at DESC);
`);

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
const ensureColumn = (name, decl) => {
  if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${decl}`);
};
ensureColumn('skin', "TEXT NOT NULL DEFAULT '#e8b58a'");
ensureColumn('hair', "TEXT NOT NULL DEFAULT '#5b3a2a'");
ensureColumn('shirt', "TEXT NOT NULL DEFAULT '#3b82f6'");
ensureColumn('hat', "TEXT NOT NULL DEFAULT 'none'");
ensureColumn('celebration', "TEXT NOT NULL DEFAULT 'confetti'");
ensureColumn('email', 'TEXT');
ensureColumn('avatar_image', 'TEXT');

const pokerRoundColumns = new Set(db.prepare('PRAGMA table_info(poker_rounds)').all().map((c) => c.name));
if (!pokerRoundColumns.has('deck_style')) {
  db.exec("ALTER TABLE poker_rounds ADD COLUMN deck_style TEXT NOT NULL DEFAULT 'classic'");
}

export const CELEBRATIONS = ['confetti', 'fireworks', 'trophy', 'coins', 'none'];

export const CURRENCIES = ['fichas', 'gemas'];

export const GEMAS_PARA_FICHAS = 10;
export const SPREAD_FICHAS_PARA_GEMAS = 0.9;

export const now = () => new Date().toISOString();

export const globalConversation = (() => {
  const existing = db.prepare("SELECT * FROM conversations WHERE ckey = 'global'").get();
  if (existing) return existing;
  const info = db
    .prepare("INSERT INTO conversations (type, name, ckey, created_at) VALUES ('global', 'Mural geral', 'global', ?)")
    .run(now());
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
})();

export const dmKey = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;

export function getOrCreateDm(userA, userB) {
  const key = dmKey(userA, userB);
  let conv = db.prepare('SELECT * FROM conversations WHERE ckey = ?').get(key);
  if (!conv) {
    const info = db
      .prepare("INSERT INTO conversations (type, name, ckey, created_by, created_at) VALUES ('dm', '', ?, ?, ?)")
      .run(key, userA, now());
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
    const ts = now();
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(conv.id, userA, 'member', ts);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(conv.id, userB, 'member', ts);
  }
  return conv;
}

export function addMember(conversationId, userId, role = 'member') {
  db.prepare(
    `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(conversation_id, user_id) DO NOTHING`
  ).run(conversationId, userId, role, now());
}

export function ensureGlobalMember(userId) {
  addMember(globalConversation.id, userId);
}

export function isMember(conversationId, userId) {
  const conv = db.prepare('SELECT type FROM conversations WHERE id = ?').get(conversationId);
  if (!conv) return false;
  if (conv.type === 'global') return true;
  return !!db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    nickname: row.nickname,
    displayName: row.display_name,
    avatar: row.avatar,
    color: row.color,
    bio: row.bio,
    statusText: row.status_text,
    character: {
      skin: row.skin || '#e8b58a',
      hair: row.hair || '#5b3a2a',
      shirt: row.shirt || '#3b82f6',
      hat: row.hat || 'none',
    },
    celebration: row.celebration || 'confetti',
    hasPhoto: !!row.avatar_image,
    createdAt: row.created_at,
  };
}

export function selfUser(row) {
  if (!row) return null;
  return {
    ...publicUser(row),
    email: row.email || null,
    hasEmail: !!row.email,
    hasPassword: !!row.password_hash,
  };
}

export function findUserByNickname(nickname) {
  return db.prepare('SELECT * FROM users WHERE nickname = ?').get(String(nickname || '').trim());
}

export function findUserByEmail(email) {
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(norm);
}

export function setUserEmail(userId, email) {
  const norm = email == null ? null : String(email).trim().toLowerCase() || null;
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(norm, userId);
}

export function setUserAvatarImage(userId, dataUrl) {
  const value = dataUrl == null || dataUrl === '' ? null : String(dataUrl);
  db.prepare('UPDATE users SET avatar_image = ? WHERE id = ?').run(value, userId);
}

export function listSupportPosts(limit = 100) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  return db
    .prepare(
      `SELECT p.id AS id, p.body AS body, p.created_at AS created_at,
              u.id AS author_id, u.nickname AS nickname, u.display_name AS display_name,
              u.avatar AS avatar, u.color AS color, u.bio AS bio,
              u.status_text AS status_text, u.skin AS skin, u.hair AS hair,
              u.shirt AS shirt, u.hat AS hat, u.celebration AS celebration,
              u.avatar_image AS avatar_image, u.created_at AS author_created_at
       FROM support_posts p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT ?`
    )
    .all(lim)
    .map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      author: {
        id: r.author_id,
        nickname: r.nickname,
        display_name: r.display_name,
        avatar: r.avatar,
        color: r.color,
        bio: r.bio,
        status_text: r.status_text,
        skin: r.skin,
        hair: r.hair,
        shirt: r.shirt,
        hat: r.hat,
        celebration: r.celebration,
        avatar_image: r.avatar_image,
        created_at: r.author_created_at,
      },
    }));
}

export function createSupportPost(userId, body) {
  const text = String(body).trim();
  const info = db
    .prepare('INSERT INTO support_posts (user_id, body, created_at) VALUES (?, ?, ?)')
    .run(userId, text, now());
  return db.prepare('SELECT * FROM support_posts WHERE id = ?').get(info.lastInsertRowid);
}

export function walletOf(userId) {
  let w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (!w) {
    db.prepare('INSERT INTO wallets (user_id, fichas, gemas) VALUES (?, ?, ?)').run(userId, 1000, 10);
    w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  }
  return { fichas: w.fichas, gemas: w.gemas };
}

export function addTransaction(userId, currency, amount, kind, note = '') {
  db.prepare(
    'INSERT INTO transactions (user_id, currency, amount, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, currency, amount, kind, note, now());
}
