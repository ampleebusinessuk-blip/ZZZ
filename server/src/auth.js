import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { db, q } from './db.js'
import { defaultUserState } from './seed.js'

const uid = () => crypto.randomUUID()
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex')
const COOKIE = config.isProduction ? '__Host-nexus_session' : 'nexus_session'
// Guests get their own cookie so a guest session can never be mistaken for a
// member session, and signing in as a member doesn't clobber a guest tab.
const GUEST_COOKIE = config.isProduction ? '__Host-zoom17_guest' : 'zoom17_guest'
const SESSION_MS = config.sessionDays * 24 * 60 * 60 * 1000
const GUEST_SESSION_MS = 12 * 60 * 60 * 1000        // a guest pass lasts 12 hours
const GUEST_INVITE_MS = 7 * 24 * 60 * 60 * 1000     // an invite link lasts 7 days

const cookieOptions = () => ({ httpOnly: true, secure: config.isProduction, sameSite: 'strict', path: '/', maxAge: SESSION_MS })

function makePmi() {
  const g = () => String(Math.floor(1000 + Math.random() * 9000))
  return `${g().slice(0, 3)} ${g()} ${g()}`
}

function clientMeta(req) {
  return {
    ip: String(req.ip || req.socket?.remoteAddress || '').slice(0, 128),
    userAgent: String(req.headers['user-agent'] || 'Unknown device').slice(0, 512),
  }
}

export function audit(req, type, userId = null, metadata = {}) {
  const { ip, userAgent } = clientMeta(req)
  q.insertAuthEvent.run(uid(), userId, type, ip, userAgent, JSON.stringify(metadata), Date.now())
}

export function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, firstName: u.name.split(' ')[0], avatar: u.avatar, pmi: u.pmi, plan: u.plan, mfaEnabled: !!u.mfa_enabled }
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) return 'Use at least 12 characters'
  if (password.length > 128) return 'Password must be 128 characters or fewer'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) return 'Include upper and lowercase letters, a number, and a symbol'
  return null
}

export function registerUser({ email, name, password }) {
  if (q.userByEmail.get(email)) return { error: 'An account with this email already exists' }
  const passwordError = validatePassword(password)
  if (passwordError) return { error: passwordError }
  const id = uid(), now = Date.now()
  const hash = bcrypt.hashSync(password, config.bcryptRounds)
  const avatar = `https://i.pravatar.cc/150?u=${encodeURIComponent(email)}`
  db.exec('BEGIN')
  try {
    q.insertUser.run(id, email, name, hash, avatar, makePmi(), 'Enterprise', now)
    q.upsertUserState.run(id, JSON.stringify(defaultUserState()), now)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  return { user: q.userById.get(id) }
}

export function checkCredentials({ email, password }) {
  const user = q.userByEmail.get(email)
  const dummy = '$2a$10$7EqJtq98hPqEX7fNZaFWoO5g0W5XDQhAq0wJjHqfHjYhVt/2uH8eK'
  const valid = bcrypt.compareSync(password || '', user?.password_hash || dummy)
  if (!user || !valid) {
    if (user) {
      const attempts = (user.failed_attempts || 0) + 1
      q.updateLoginFailure.run(attempts, attempts >= 5 ? Date.now() + 15 * 60 * 1000 : null, user.id)
    }
    return { error: 'Invalid email or password' }
  }
  if (user.locked_until && user.locked_until > Date.now()) return { error: 'Account temporarily locked. Try again in 15 minutes.', status: 423 }
  q.clearLoginFailures.run(user.id)
  return { user }
}

export function createSession(req, res, user) {
  const raw = randomToken(), csrfToken = randomToken(24), now = Date.now(), id = uid()
  const { ip, userAgent } = clientMeta(req)
  q.purgeSessions.run(now)
  q.insertSession.run(id, user.id, digest(raw), csrfToken, userAgent, ip, now, now, now + SESSION_MS)
  res.cookie(COOKIE, raw, cookieOptions())
  return { id, csrfToken }
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: config.isProduction, sameSite: 'strict', path: '/' })
}

function parseCookies(header = '') {
  const pairs = header.split(';').map((v) => v.trim().split('=').map(decodeURIComponent)).filter((p) => p.length === 2)
  return Object.fromEntries(pairs)
}

export function sessionFromCookie(header) {
  const raw = parseCookies(header)[COOKIE]
  if (!raw) return null
  const session = q.sessionByHash.get(digest(raw), Date.now())
  if (!session) return null
  const user = q.userById.get(session.user_id)
  return user ? { session, user } : null
}

export function requireAuth(req, res, next) {
  const auth = sessionFromCookie(req.headers.cookie)
  if (!auth) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  req.user = auth.user; req.session = auth.session
  if (Date.now() - auth.session.last_seen_at > 5 * 60 * 1000) q.touchSession.run(Date.now(), auth.session.id)
  next()
}

export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const supplied = String(req.headers['x-csrf-token'] || ''), expected = String(req.session?.csrf_token || '')
  if (!supplied || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(403).json({ error: 'Security token expired. Refresh and try again.' })
  next()
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32Encode(buffer) {
  let bits = ''; for (const byte of buffer) bits += byte.toString(2).padStart(8, '0')
  let out = ''; for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
  return out
}
function base32Decode(value) {
  let bits = ''; for (const c of value.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0')
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
export const newMfaSecret = () => base32Encode(crypto.randomBytes(20))
export function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(String(code || ''))) return false
  const counter = Math.floor(Date.now() / 30000)
  for (let drift = -1; drift <= 1; drift++) {
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter + drift))
    const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest(), offset = hmac[hmac.length - 1] & 15
    const expected = String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return true
  }
  return false
}

export function createMfaChallenge(user) { return jwt.sign({ sub: user.id, purpose: 'mfa' }, config.jwtSecret, { expiresIn: '5m' }) }
export function verifyMfaChallenge(token) {
  try { const p = jwt.verify(token, config.jwtSecret); return p.purpose === 'mfa' ? q.userById.get(p.sub) : null } catch { return null }
}
/* ---------------- Guest access ----------------
   A guest link is a signed statement of one fact: "this room may be joined by
   anyone holding this token". Redeeming it mints a room-scoped session that
   can reach that room and nothing else in the workspace. */

export function createGuestInvite(room, invitedBy) {
  return jwt.sign({ room, purpose: 'guest-invite', by: invitedBy }, config.jwtSecret, { expiresIn: GUEST_INVITE_MS / 1000 })
}

export function verifyGuestInvite(token) {
  try {
    const payload = jwt.verify(String(token || ''), config.jwtSecret)
    return payload.purpose === 'guest-invite' ? payload : null
  } catch { return null }
}

export function createGuestSession(req, res, { room, name, invitedBy }) {
  const raw = randomToken(), csrfToken = randomToken(24), now = Date.now(), id = uid()
  q.purgeGuestSessions.run(now)
  const avatar = `https://i.pravatar.cc/150?u=${encodeURIComponent('guest-' + id)}`
  q.insertGuestSession.run(id, digest(raw), csrfToken, room, name, avatar, invitedBy || null, now, now + GUEST_SESSION_MS)
  res.cookie(GUEST_COOKIE, raw, { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/', maxAge: GUEST_SESSION_MS })
  return { id, csrfToken, room, name, avatar }
}

export function guestFromCookie(header) {
  const raw = parseCookies(header)[GUEST_COOKIE]
  if (!raw) return null
  return q.guestByHash.get(digest(raw), Date.now()) || null
}

export function clearGuestCookie(res) {
  res.clearCookie(GUEST_COOKIE, { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/' })
}

export function requireGuest(req, res, next) {
  const guest = guestFromCookie(req.headers.cookie)
  if (!guest) return res.status(401).json({ error: 'Your guest pass has expired. Open the invite link again.' })
  req.guest = guest
  next()
}

export function requireGuestCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const supplied = String(req.headers['x-csrf-token'] || ''), expected = String(req.guest?.csrf_token || '')
  if (!supplied || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).json({ error: 'Security token expired. Refresh and try again.' })
  }
  next()
}

export const publicGuest = (g) => ({ id: `guest:${g.id}`, name: g.name, firstName: g.name.split(' ')[0], avatar: g.avatar, room: g.room, isGuest: true })

export const hashToken = digest
export const generateToken = randomToken
