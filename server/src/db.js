import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config.js'
import { generalChannel } from './seed.js'

mkdirSync(dirname(config.dbPath), { recursive: true })

export const db = new DatabaseSync(config.dbPath)

// WAL mode → far better read/write concurrency under load.
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')
db.exec('PRAGMA busy_timeout = 5000;')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar        TEXT,
    pmi           TEXT,
    plan          TEXT DEFAULT 'Pro Plan',
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,           -- JSON blob of the meeting
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_meetings_user ON meetings(user_id);

  CREATE TABLE IF NOT EXISTS channels (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,           -- JSON blob (shared, org-wide)
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    author_id  TEXT,
    data       TEXT NOT NULL,           -- JSON blob of the message
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);

  CREATE TABLE IF NOT EXISTS user_state (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,           -- JSON: notes/docs/whiteboards/clips/recordings/contacts/settings
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    TEXT UNIQUE NOT NULL,
    csrf_token    TEXT NOT NULL,
    user_agent    TEXT,
    ip            TEXT,
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS boards (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    data       TEXT NOT NULL,           -- JSON blob (shared, org-wide like channels)
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_boards_updated ON boards(updated_at DESC);

  /* Guests hold no account. A guest session is scoped to a single room and
     expires on its own, so an invite link can never become a way into the
     workspace. Kept separate from the members table for exactly that reason. */
  CREATE TABLE IF NOT EXISTS guest_sessions (
    id         TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    csrf_token TEXT NOT NULL,
    room       TEXT NOT NULL,
    name       TEXT NOT NULL,
    avatar     TEXT,
    invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_guest_sessions_token ON guest_sessions(token_hash);

  CREATE TABLE IF NOT EXISTS media (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,           -- 'recording' | 'clip'
    filename   TEXT NOT NULL,
    mime       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    data       TEXT NOT NULL,           -- JSON metadata (title, duration, ...)
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS auth_events (
    id         TEXT PRIMARY KEY,
    user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    metadata   TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at DESC);
`)

// Additive migrations for databases created by earlier versions.
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name))
const additions = [
  ['failed_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['locked_until', 'INTEGER'],
  ['password_changed_at', 'INTEGER'],
  ['mfa_secret', 'TEXT'],
  ['mfa_enabled', 'INTEGER NOT NULL DEFAULT 0'],
]
for (const [name, definition] of additions) {
  if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`)
}

// ---- Migration: strip legacy demo seed data from earlier builds (idempotent) ----
db.prepare("DELETE FROM messages WHERE channel_id IN ('c1','c2','c3','c4','c5')").run()
db.prepare("DELETE FROM channels WHERE id IN ('c1','c2','c3','c4','c5')").run()
// legacy seeded meetings used fixed ids; real meetings use UUIDs, so this is safe
db.prepare("DELETE FROM meetings WHERE id IN ('m1','m2','m3','m4','am4','am5','pm1','pm2','pm3')").run()
// remove throwaway verification accounts (and their cascade) if any were created
db.prepare("DELETE FROM users WHERE email LIKE 'verify+%@test.dev'").run()

/* ---- Migration: whiteboards moved from per-user state into the shared `boards`
   table so two people can open the same board. Lift any existing boards across
   (they hold real drawings) and drop the now server-owned slices from the state
   document. Recordings/clips stored there were metadata only — the actual files
   were never uploaded — so they are dropped rather than resurrected as dead rows. ---- */
const SERVER_OWNED = ['contacts', 'whiteboards', 'recordings', 'clips']
const stateRows = db.prepare('SELECT user_id, data FROM user_state').all()
for (const row of stateRows) {
  let state
  try { state = JSON.parse(row.data) } catch { continue }
  if (!SERVER_OWNED.some((k) => k in state)) continue

  for (const board of Array.isArray(state.whiteboards) ? state.whiteboards : []) {
    if (!board?.id || db.prepare('SELECT 1 FROM boards WHERE id = ?').get(board.id)) continue
    const migrated = {
      id: board.id,
      title: board.title || 'Untitled whiteboard',
      owner: board.owner || 'Unknown',
      color: board.color || '',
      snapshot: board.snapshot || '',
      updatedAt: Date.now(),
    }
    db.prepare('INSERT INTO boards (id, owner_id, data, updated_at) VALUES (?, ?, ?, ?)')
      .run(migrated.id, row.user_id, JSON.stringify(migrated), migrated.updatedAt)
  }

  for (const key of SERVER_OWNED) delete state[key]
  db.prepare('UPDATE user_state SET data = ? WHERE user_id = ?').run(JSON.stringify(state), row.user_id)
}

// ---- Ensure the shared "general" channel exists (idempotent, no fake messages) ----
const hasGeneral = db.prepare('SELECT 1 FROM channels WHERE id = ?').get(generalChannel.id)
if (!hasGeneral) {
  db.prepare('INSERT INTO channels (id, data, updated_at) VALUES (?, ?, ?)')
    .run(generalChannel.id, JSON.stringify(generalChannel), Date.now())
}

// ---- Helpers ----
export const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  allUsers: db.prepare('SELECT id, name, email, avatar, created_at FROM users ORDER BY created_at ASC'),
  insertUser: db.prepare(
    'INSERT INTO users (id, email, name, password_hash, avatar, pmi, plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateLoginFailure: db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?'),
  clearLoginFailures: db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?'),
  setMfa: db.prepare('UPDATE users SET mfa_secret = ?, mfa_enabled = ? WHERE id = ?'),
  updateProfile: db.prepare('UPDATE users SET name = ?, pmi = ? WHERE id = ?'),
  updateAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),

  insertSession: db.prepare('INSERT INTO sessions (id, user_id, token_hash, csrf_token, user_agent, ip, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  sessionByHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?'),
  sessionsByUser: db.prepare('SELECT id, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC'),
  touchSession: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteSessionsByUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  insertPasswordReset: db.prepare('INSERT OR REPLACE INTO password_resets (token_hash, user_id, expires_at, used_at) VALUES (?, ?, ?, NULL)'),
  passwordResetByHash: db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'),
  usePasswordReset: db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?'),
  insertAuthEvent: db.prepare('INSERT INTO auth_events (id, user_id, type, ip, user_agent, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  authEventsByUser: db.prepare('SELECT id, type, ip, user_agent, metadata, created_at FROM auth_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 30'),

  meetingsByUser: db.prepare('SELECT data FROM meetings WHERE user_id = ? ORDER BY updated_at DESC'),
  meetingOwner: db.prepare('SELECT user_id FROM meetings WHERE id = ?'),
  upsertMeeting: db.prepare(
    `INSERT INTO meetings (id, user_id, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ),
  deleteMeeting: db.prepare('DELETE FROM meetings WHERE id = ? AND user_id = ?'),

  allChannels: db.prepare('SELECT data FROM channels ORDER BY updated_at ASC'),
  channelById: db.prepare('SELECT data FROM channels WHERE id = ?'),
  updateChannel: db.prepare('UPDATE channels SET data = ?, updated_at = ? WHERE id = ?'),
  insertChannel: db.prepare('INSERT INTO channels (id, data, updated_at) VALUES (?, ?, ?)'),

  messagesByChannel: db.prepare('SELECT data FROM messages WHERE channel_id = ? ORDER BY created_at ASC LIMIT 200'),
  insertMessage: db.prepare('INSERT INTO messages (id, channel_id, author_id, data, created_at) VALUES (?, ?, ?, ?, ?)'),

  insertGuestSession: db.prepare('INSERT INTO guest_sessions (id, token_hash, csrf_token, room, name, avatar, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  guestByHash: db.prepare('SELECT * FROM guest_sessions WHERE token_hash = ? AND expires_at > ?'),
  deleteGuestSession: db.prepare('DELETE FROM guest_sessions WHERE id = ?'),
  purgeGuestSessions: db.prepare('DELETE FROM guest_sessions WHERE expires_at <= ?'),

  allBoards: db.prepare('SELECT id, owner_id, data FROM boards ORDER BY updated_at DESC'),
  boardById: db.prepare('SELECT id, owner_id, data FROM boards WHERE id = ?'),
  insertBoard: db.prepare('INSERT INTO boards (id, owner_id, data, updated_at) VALUES (?, ?, ?, ?)'),
  updateBoard: db.prepare('UPDATE boards SET data = ?, updated_at = ? WHERE id = ?'),
  deleteBoard: db.prepare('DELETE FROM boards WHERE id = ? AND owner_id = ?'),

  mediaByUser: db.prepare('SELECT id, kind, mime, bytes, data, created_at FROM media WHERE user_id = ? ORDER BY created_at DESC'),
  mediaById: db.prepare('SELECT * FROM media WHERE id = ?'),
  insertMedia: db.prepare('INSERT INTO media (id, user_id, kind, filename, mime, bytes, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  updateMedia: db.prepare('UPDATE media SET data = ? WHERE id = ? AND user_id = ?'),
  deleteMedia: db.prepare('DELETE FROM media WHERE id = ? AND user_id = ?'),
  mediaUsage: db.prepare('SELECT COALESCE(SUM(bytes), 0) AS used FROM media WHERE user_id = ?'),

  userState: db.prepare('SELECT data FROM user_state WHERE user_id = ?'),
  upsertUserState: db.prepare(
    `INSERT INTO user_state (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ),
}
