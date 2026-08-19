import crypto from 'node:crypto'
import { createWriteStream, createReadStream, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { AccessToken } from 'livekit-server-sdk'
import { q } from './db.js'
import { config } from './config.js'
import {
  registerUser, checkCredentials, createSession, clearSessionCookie, requireAuth, requireCsrf,
  publicUser, audit, createMfaChallenge, verifyMfaChallenge, verifyTotp, newMfaSecret,
  validatePassword, generateToken, hashToken,
  createGuestInvite, verifyGuestInvite, createGuestSession, guestFromCookie, clearGuestCookie,
  requireGuest, requireGuestCsrf, publicGuest,
} from './auth.js'

export const router = Router()
const uid = () => crypto.randomUUID()

// Media (recordings/clips) live on disk next to the database; rows in `media` index them.
const MEDIA_DIR = join(dirname(config.dbPath), 'media')
const AVATAR_DIR = join(dirname(config.dbPath), 'avatars')
mkdirSync(MEDIA_DIR, { recursive: true })
mkdirSync(AVATAR_DIR, { recursive: true })
const MAX_AVATAR_BYTES = 4 * 1024 * 1024
const AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const aiJobs = new Set()

/* ---------------- ICE servers ----------------
   Handed to the browser at join time rather than baked into the bundle, so TURN
   credentials stay short-lived and can be rotated without a redeploy.

   With a shared secret we mint coturn REST credentials: the username is an
   expiry timestamp and the password is its HMAC. They cannot be reused for long
   and never need storing anywhere. */
function iceServers(identity = 'peer') {
  const servers = [{ urls: config.stunUrls }]
  const { urls, secret, username, password, ttlSeconds } = config.turn
  if (!urls.length) return servers

  if (secret) {
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds
    const user = `${expiry}:${String(identity).slice(0, 64)}`
    const credential = crypto.createHmac('sha1', secret).update(user).digest('base64')
    servers.push({ urls, username: user, credential })
  } else if (username && password) {
    servers.push({ urls, username, credential: password })
  }
  return servers
}

const turnConfigured = () => config.turn.urls.length > 0 && !!(config.turn.secret || (config.turn.username && config.turn.password))

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024   // 512 MB per file
const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024  // 10 GB per user

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } })

/* ---------------- Auth ---------------- */
router.post('/auth/register', authLimit, (req, res) => {
  const { email, name, password } = req.body || {}
  if (!email || !name || !password) return res.status(400).json({ error: 'email, name and password are required' })
  if (String(name).trim().length < 2 || String(name).length > 80) return res.status(400).json({ error: 'Enter your full name' })
  const result = registerUser({ email: email.toLowerCase().trim(), name: name.trim(), password })
  if (result.error) return res.status(result.error.includes('exists') ? 409 : 400).json({ error: result.error })
  const session = createSession(req, res, result.user)
  audit(req, 'account.created', result.user.id)
  res.status(201).json({ csrfToken: session.csrfToken, user: publicUser(result.user) })
})

router.post('/auth/login', authLimit, (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' })
  const result = checkCredentials({ email: email.toLowerCase().trim(), password })
  if (result.error) { audit(req, 'login.failed', result.user?.id, { email: email.toLowerCase().trim() }); return res.status(result.status || 401).json({ error: result.error }) }
  if (result.user.mfa_enabled) return res.json({ mfaRequired: true, challenge: createMfaChallenge(result.user) })
  const session = createSession(req, res, result.user)
  audit(req, 'login.succeeded', result.user.id)
  res.json({ csrfToken: session.csrfToken, user: publicUser(result.user) })
})

router.post('/auth/mfa/verify', authLimit, (req, res) => {
  const user = verifyMfaChallenge(req.body?.challenge)
  if (!user || !verifyTotp(user.mfa_secret, req.body?.code)) return res.status(401).json({ error: 'That verification code is invalid or expired' })
  const session = createSession(req, res, user); audit(req, 'login.mfa_succeeded', user.id)
  res.json({ csrfToken: session.csrfToken, user: publicUser(user) })
})

router.post('/auth/forgot-password', authLimit, (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim(), user = q.userByEmail.get(email)
  let resetToken
  if (user) {
    resetToken = generateToken(); q.insertPasswordReset.run(hashToken(resetToken), user.id, Date.now() + 15 * 60 * 1000)
    audit(req, 'password.reset_requested', user.id)
  }
  // In production connect this token to an email provider; never return it to the browser.
  res.json({ ok: true, ...(resetToken && !config.isProduction ? { resetToken } : {}) })
})

router.post('/auth/reset-password', authLimit, (req, res) => {
  const error = validatePassword(req.body?.password)
  if (error) return res.status(400).json({ error })
  const row = q.passwordResetByHash.get(hashToken(String(req.body?.token || '')), Date.now())
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or expired' })
  q.updatePassword.run(bcrypt.hashSync(req.body.password, config.bcryptRounds), Date.now(), row.user_id)
  q.usePasswordReset.run(Date.now(), hashToken(req.body.token)); q.deleteSessionsByUser.run(row.user_id)
  audit(req, 'password.reset_completed', row.user_id); res.json({ ok: true })
})


/* ---------------- Avatars (public by design) ----------------
   Avatars are shown to teammates and to guests sitting in a meeting, neither of
   which shares a session with the owner. The filename is a random UUID, so the
   URL is unguessable while staying simple to embed in an <img>. */
router.get('/avatars/:file', (req, res) => {
  const file = String(req.params.file || '')
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file)) return res.status(404).end()
  const path = join(AVATAR_DIR, file)
  try { statSync(path) } catch { return res.status(404).end() }
  res.set('Cache-Control', 'public, max-age=86400')
  res.type(file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg')
  createReadStream(path).pipe(res)
})

/* ---------------- Guest access ---------------- */
const guestLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } })

// Redeem an invite link for a room-scoped guest pass.
router.post('/guest/session', guestLimit, (req, res) => {
  const invite = verifyGuestInvite(req.body?.token)
  if (!invite) return res.status(401).json({ error: 'This invite link is invalid or has expired' })
  const name = String(req.body?.name || '').trim().slice(0, 60)
  if (name.length < 2) return res.status(400).json({ error: 'Enter the name others will see' })
  const guest = createGuestSession(req, res, { room: invite.room, name, invitedBy: invite.by })
  audit(req, 'guest.joined', invite.by || null, { room: invite.room, name })
  res.status(201).json({ csrfToken: guest.csrfToken, guest: publicGuest({ ...guest, csrf_token: guest.csrfToken }) })
})

// Who am I, as a guest? Lets a refreshed tab rejoin without re-entering a name.
router.get('/guest/me', (req, res) => {
  const guest = guestFromCookie(req.headers.cookie)
  if (!guest) return res.status(401).json({ error: 'No guest session' })
  res.json({ guest: publicGuest(guest), csrfToken: guest.csrf_token })
})

router.post('/guest/logout', (req, res) => {
  const guest = guestFromCookie(req.headers.cookie)
  if (guest) q.deleteGuestSession.run(guest.id)
  clearGuestCookie(res)
  res.json({ ok: true })
})

// Guests need the SFU too, but only ever for the room their pass names.
router.get('/guest/ice', requireGuest, (req, res) =>
  res.json({ iceServers: iceServers(`guest:${req.guest.id}`), turnConfigured: turnConfigured() }))

router.get('/guest/livekit/config', requireGuest, (_req, res) =>
  res.json({ enabled: !!(config.livekit.url && config.livekit.apiKey && config.livekit.apiSecret) }))

router.post('/guest/livekit/token', requireGuest, requireGuestCsrf, async (req, res) => {
  const { url, apiKey, apiSecret } = config.livekit
  if (!url || !apiKey || !apiSecret) return res.status(501).json({ error: 'LiveKit not configured' })
  try {
    // The room comes from the signed pass, never from the request body.
    const at = new AccessToken(apiKey, apiSecret, { identity: `guest:${req.guest.id}`, name: req.guest.name, ttl: '2h' })
    at.addGrant({ roomJoin: true, room: req.guest.room, canPublish: true, canSubscribe: true, canPublishData: true })
    res.json({ token: await at.toJwt(), url })
  } catch { res.status(500).json({ error: 'Failed to mint token' }) }
})

// Every route below requires a valid server session; every mutation also requires CSRF.
router.use(requireAuth, requireCsrf)

router.get('/me', (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.session.csrf_token }))
router.post('/auth/logout', (req, res) => {
  audit(req, 'logout', req.user.id); q.deleteSession.run(req.session.id); clearSessionCookie(res); res.json({ ok: true })
})
router.get('/auth/sessions', (req, res) => res.json(q.sessionsByUser.all(req.user.id, Date.now()).map((s) => ({ ...s, current: s.id === req.session.id }))))
router.delete('/auth/sessions/:id', (req, res) => {
  const session = q.sessionsByUser.all(req.user.id, Date.now()).find((s) => s.id === req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  q.deleteSession.run(session.id); audit(req, 'session.revoked', req.user.id); if (session.id === req.session.id) clearSessionCookie(res); res.json({ ok: true })
})
router.post('/auth/logout-all', (req, res) => { q.deleteOtherSessions.run(req.user.id, req.session.id); audit(req, 'sessions.revoked_all', req.user.id); res.json({ ok: true }) })
router.post('/auth/change-password', (req, res) => {
  if (!bcrypt.compareSync(req.body?.currentPassword || '', req.user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' })
  const error = validatePassword(req.body?.newPassword); if (error) return res.status(400).json({ error })
  q.updatePassword.run(bcrypt.hashSync(req.body.newPassword, config.bcryptRounds), Date.now(), req.user.id)
  q.deleteOtherSessions.run(req.user.id, req.session.id); audit(req, 'password.changed', req.user.id); res.json({ ok: true })
})
router.post('/auth/mfa/setup', (req, res) => {
  const secret = newMfaSecret(); q.setMfa.run(secret, 0, req.user.id)
  const issuer = encodeURIComponent('Zoom17'), account = encodeURIComponent(req.user.email)
  res.json({ secret, otpauthUrl: `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` })
})
router.post('/auth/mfa/enable', (req, res) => {
  const user = q.userById.get(req.user.id)
  if (!user.mfa_secret || !verifyTotp(user.mfa_secret, req.body?.code)) return res.status(400).json({ error: 'Enter a valid code from your authenticator' })
  q.setMfa.run(user.mfa_secret, 1, user.id); audit(req, 'mfa.enabled', user.id); res.json({ ok: true })
})
router.post('/auth/mfa/disable', (req, res) => {
  if (!bcrypt.compareSync(req.body?.password || '', req.user.password_hash)) return res.status(401).json({ error: 'Password is incorrect' })
  q.setMfa.run(null, 0, req.user.id); audit(req, 'mfa.disabled', req.user.id); res.json({ ok: true })
})
router.get('/auth/events', (req, res) => res.json(q.authEventsByUser.all(req.user.id).map((e) => ({ ...e, metadata: JSON.parse(e.metadata || '{}') }))))

router.get('/ice', (req, res) =>
  res.json({ iceServers: iceServers(req.user.id), turnConfigured: turnConfigured() }))

/* ---------------- LiveKit SFU token (falls back to mesh when unconfigured) ---------------- */
router.get('/livekit/config', (_req, res) => res.json({ enabled: !!(config.livekit.url && config.livekit.apiKey && config.livekit.apiSecret) }))
router.post('/livekit/token', async (req, res) => {
  const { url, apiKey, apiSecret } = config.livekit
  if (!url || !apiKey || !apiSecret) return res.status(501).json({ error: 'LiveKit not configured' })
  const room = String(req.body?.room || '').slice(0, 128)
  if (!room) return res.status(400).json({ error: 'room required' })
  try {
    const at = new AccessToken(apiKey, apiSecret, { identity: req.user.id, name: req.user.name, ttl: '2h' })
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true })
    res.json({ token: await at.toJwt(), url })
  } catch { res.status(500).json({ error: 'Failed to mint token' }) }
})

/* ---------------- Guest invite links ---------------- */
// Hosts mint a link that lets anyone join one specific room without an account.
router.post('/rooms/:room/guest-link', (req, res) => {
  const room = String(req.params.room || '').slice(0, 128)
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(room)) return res.status(400).json({ error: 'Invalid room' })
  const token = createGuestInvite(room, req.user.id)
  audit(req, 'guest_link.created', req.user.id, { room })
  res.json({ token, url: `/join/${room}?t=${token}`, expiresInDays: 7 })
})

/* ---------------- Profile picture ---------------- */
router.post('/me/avatar', (req, res) => {
  const mime = String(req.headers['content-type'] || '').split(';')[0]
  const ext = AVATAR_TYPES[mime]
  if (!ext) return res.status(415).json({ error: 'Use a JPEG, PNG or WebP image' })
  if (Number(req.headers['content-length'] || 0) > MAX_AVATAR_BYTES) return res.status(413).json({ error: 'Image must be 4 MB or smaller' })

  const file = `${uid()}.${ext}`
  const target = join(AVATAR_DIR, file)
  const out = createWriteStream(target)
  let bytes = 0, failed = false
  const abort = (status, error) => {
    if (failed) return
    failed = true
    req.unpipe(out); out.destroy()
    try { unlinkSync(target) } catch {}
    res.status(status).json({ error })
  }
  req.on('data', (chunk) => { bytes += chunk.length; if (bytes > MAX_AVATAR_BYTES) abort(413, 'Image must be 4 MB or smaller') })
  req.on('error', () => abort(400, 'Upload failed'))
  out.on('error', () => abort(500, 'Could not save the image'))
  req.pipe(out)

  out.on('close', () => {
    if (failed) return
    if (!bytes) { try { unlinkSync(target) } catch {}; return res.status(400).json({ error: 'Empty upload' }) }
    const previous = req.user.avatar
    q.updateAvatar.run(`/api/avatars/${file}`, req.user.id)
    // Clean up the file this one replaced, but never a generated/remote URL.
    const stale = /^\/api\/avatars\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(previous || '')
    if (stale) { try { unlinkSync(join(AVATAR_DIR, stale[1])) } catch {} }
    audit(req, 'profile.avatar_updated', req.user.id)
    res.status(201).json({ user: publicUser(q.userById.get(req.user.id)) })
  })
})

router.delete('/me/avatar', (req, res) => {
  const stale = /^\/api\/avatars\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(req.user.avatar || '')
  q.updateAvatar.run(`https://i.pravatar.cc/150?u=${encodeURIComponent(req.user.email)}`, req.user.id)
  if (stale) { try { unlinkSync(join(AVATAR_DIR, stale[1])) } catch {} }
  res.json({ user: publicUser(q.userById.get(req.user.id)) })
})

/* ---------------- Real user directory (contacts = registered users) ---------------- */
const directory = (excludeId) => q.allUsers.all()
  .filter((u) => u.id !== excludeId)
  .map((u) => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar, title: 'Member', dept: 'Team' }))

router.get('/users', (req, res) => res.json(directory(req.user.id)))

/* ---------------- Profile ---------------- */
router.patch('/me', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : null
  const pmi = typeof req.body?.pmi === 'string' ? req.body.pmi.trim() : null
  if (name !== null && (name.length < 2 || name.length > 80)) return res.status(400).json({ error: 'Enter your full name' })
  if (pmi !== null && !/^[\d ]{9,15}$/.test(pmi)) return res.status(400).json({ error: 'Meeting ID must be 9-13 digits' })
  q.updateProfile.run(name ?? req.user.name, pmi ?? req.user.pmi, req.user.id)
  audit(req, 'profile.updated', req.user.id)
  res.json({ user: publicUser(q.userById.get(req.user.id)) })
})

/* ---------------- Channels ---------------- */
// Channels this user can see: shared channels plus DMs they belong to.
function visibleChannels(userId) {
  return q.allChannels.all()
    .map((r) => JSON.parse(r.data))
    .filter((c) => c.type === 'channel' || (Array.isArray(c.members) && c.members.includes(userId)))
}

function canAccessChannel(userId, channelId) {
  const row = q.channelById.get(channelId)
  if (!row) return false
  const channel = JSON.parse(row.data)
  return channel.type === 'channel' || (Array.isArray(channel.members) && channel.members.includes(userId))
}

/* ---------------- Whiteboards (shared org-wide, so collaboration actually works) ---------------- */
const boardList = () => q.allBoards.all().map((r) => ({ ...JSON.parse(r.data), id: r.id, ownerId: r.owner_id }))

router.get('/boards', (_req, res) => res.json(boardList()))

router.post('/boards', (req, res) => {
  const title = String(req.body?.title || 'Untitled whiteboard').trim().slice(0, 120)
  const board = { id: uid(), title, owner: req.user.name, color: String(req.body?.color || ''), snapshot: '', updatedAt: Date.now() }
  q.insertBoard.run(board.id, req.user.id, JSON.stringify(board), board.updatedAt)
  res.status(201).json({ ...board, ownerId: req.user.id })
})

router.put('/boards/:id', (req, res) => {
  const row = q.boardById.get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Whiteboard not found' })
  const current = JSON.parse(row.data)
  const next = {
    ...current,
    title: typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : current.title,
    snapshot: typeof req.body?.snapshot === 'string' ? req.body.snapshot : current.snapshot,
    updatedAt: Date.now(),
  }
  q.updateBoard.run(JSON.stringify(next), next.updatedAt, row.id)
  res.json({ ...next, id: row.id, ownerId: row.owner_id })
})

router.delete('/boards/:id', (req, res) => {
  const row = q.boardById.get(req.params.id)
  if (!row) return res.json({ ok: true })
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete this whiteboard' })
  q.deleteBoard.run(req.params.id, req.user.id)
  res.json({ ok: true })
})

/* ---------------- Media: real recordings & clips on disk ---------------- */
const mediaRow = (r) => ({ ...JSON.parse(r.data), id: r.id, kind: r.kind, bytes: r.bytes, mime: r.mime, createdAt: r.created_at, url: `/api/media/${r.id}/file` })
const usedBytes = (userId) => q.mediaUsage.get(userId)?.used || 0

const aiEndpoint = (base, path) => `${base.replace(/\/$/, '')}${base.endsWith(path) ? '' : path}`
const saveAiNotes = (row, aiNotes) => {
  const meta = JSON.parse(row.data)
  meta.aiNotes = aiNotes
  q.updateMedia.run(JSON.stringify(meta), row.id, row.user_id)
}

function basicSummary(transcript) {
  const sentences = transcript.split(/(?<=[.!?])\s+/).filter(Boolean)
  return {
    summary: sentences.slice(0, 4).join(' ') || transcript.slice(0, 900),
    keyPoints: sentences.slice(0, 6),
    decisions: [],
    actionItems: [],
  }
}

async function createAiNotes(row) {
  if (!row) return
  try {
    const bytes = await readFile(join(MEDIA_DIR, row.filename))
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: row.mime }), row.filename)
    form.append('model', config.ai.transcriptionModel)
    form.append('response_format', 'json')
    const transcription = await fetch(aiEndpoint(config.ai.transcriptionUrl, '/v1/audio/transcriptions'), {
      method: 'POST', body: form, signal: AbortSignal.timeout(15 * 60 * 1000),
    })
    if (!transcription.ok) throw new Error(`Transcription service returned ${transcription.status}`)
    const transcriptPayload = await transcription.json()
    const transcript = String(transcriptPayload.text || '').trim()
    if (!transcript) throw new Error('No speech was detected in this recording')

    let notes = basicSummary(transcript)
    if (config.ai.summaryUrl) {
      const prompt = `You are a precise enterprise meeting note taker. Return JSON only with this shape: {"summary":"brief executive summary","keyPoints":["point"],"decisions":["decision"],"actionItems":[{"task":"task","owner":"name or Unassigned","due":"date or Not set"}]}. Do not invent facts. Transcript:\n\n${transcript}`
      const summary = await fetch(aiEndpoint(config.ai.summaryUrl, '/api/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.ai.summaryModel, prompt, stream: false, format: 'json' }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      })
      if (!summary.ok) throw new Error(`Summary service returned ${summary.status}`)
      const payload = await summary.json()
      const parsed = JSON.parse(payload.response || '{}')
      notes = {
        summary: String(parsed.summary || notes.summary),
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 12).map(String) : notes.keyPoints,
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions.slice(0, 12).map(String) : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.slice(0, 20).map((item) => ({
          task: String(item?.task || ''), owner: String(item?.owner || 'Unassigned'), due: String(item?.due || 'Not set'),
        })).filter((item) => item.task) : [],
      }
    }
    const fresh = q.mediaById.get(row.id)
    if (fresh) saveAiNotes(fresh, { status: 'ready', transcript, ...notes, completedAt: Date.now() })
  } catch (error) {
    const fresh = q.mediaById.get(row.id)
    if (fresh) saveAiNotes(fresh, { status: 'error', error: String(error.message || error).slice(0, 240), failedAt: Date.now() })
  } finally {
    aiJobs.delete(row?.id)
  }
}

router.get('/ai/status', (_req, res) => {
  res.json({
    available: Boolean(config.ai.transcriptionUrl),
    transcriptionModel: config.ai.transcriptionModel,
    summaries: Boolean(config.ai.summaryUrl),
    summaryModel: config.ai.summaryModel,
  })
})

router.post('/media/:id/ai-notes', (req, res) => {
  const row = q.mediaById.get(req.params.id)
  if (!row || row.user_id !== req.user.id || row.kind !== 'recording') return res.status(404).json({ error: 'Recording not found' })
  if (!config.ai.transcriptionUrl) return res.status(503).json({ error: 'AI notes are not configured yet. Add AI_TRANSCRIPTION_URL to the server environment.' })
  if (aiJobs.has(row.id)) return res.status(202).json(mediaRow(row))

  aiJobs.add(row.id)
  saveAiNotes(row, { status: 'processing', startedAt: Date.now() })
  setImmediate(() => createAiNotes(q.mediaById.get(row.id)))
  res.status(202).json(mediaRow(q.mediaById.get(row.id)))
})

router.get('/media', (req, res) => {
  const items = q.mediaByUser.all(req.user.id).map(mediaRow)
  res.json({ items, storage: { used: usedBytes(req.user.id), quota: STORAGE_QUOTA_BYTES } })
})

// Raw binary upload. express.json() ignores non-JSON bodies, so the stream arrives intact.
router.post('/media', (req, res) => {
  const kind = req.query.kind === 'clip' ? 'clip' : 'recording'
  const mime = String(req.headers['content-type'] || 'video/webm').split(';')[0]
  if (!/^(video|audio)\//.test(mime)) return res.status(415).json({ error: 'Only audio or video uploads are accepted' })

  const declared = Number(req.headers['content-length'] || 0)
  const remaining = STORAGE_QUOTA_BYTES - usedBytes(req.user.id)
  if (declared > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'That file is larger than the 512 MB limit' })
  if (declared > remaining) return res.status(507).json({ error: 'Not enough storage left in your account' })

  const id = uid()
  const ext = mime === 'video/mp4' ? 'mp4' : mime.startsWith('audio') ? 'webm' : 'webm'
  const filename = `${id}.${ext}`
  const target = join(MEDIA_DIR, filename)
  const out = createWriteStream(target)
  let bytes = 0
  let failed = false

  const abort = (status, error) => {
    if (failed) return
    failed = true
    req.unpipe(out); out.destroy()
    try { unlinkSync(target) } catch {}
    res.status(status).json({ error })
  }

  req.on('data', (chunk) => {
    bytes += chunk.length
    if (bytes > MAX_UPLOAD_BYTES) abort(413, 'That file is larger than the 512 MB limit')
    else if (bytes > remaining) abort(507, 'Not enough storage left in your account')
  })
  req.on('error', () => abort(400, 'Upload failed'))
  out.on('error', () => abort(500, 'Could not save the file'))

  req.pipe(out)
  out.on('close', () => {
    if (failed) return
    if (!bytes) { try { unlinkSync(target) } catch {}; return res.status(400).json({ error: 'Empty upload' }) }
    const meta = {
      title: String(req.query.title || 'Untitled recording').slice(0, 160),
      duration: String(req.query.duration || '0:00').slice(0, 16),
      thumb: String(req.query.thumb || 'from-blue-500 to-indigo-600').slice(0, 60),
      views: 0,
    }
    q.insertMedia.run(id, req.user.id, kind, filename, mime, bytes, JSON.stringify(meta), Date.now())
    res.status(201).json({ ...mediaRow(q.mediaById.get(id)), storage: { used: usedBytes(req.user.id), quota: STORAGE_QUOTA_BYTES } })
  })
})

// Streams the file with HTTP range support so <video> can seek.
router.get('/media/:id/file', (req, res) => {
  const row = q.mediaById.get(req.params.id)
  if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' })
  const path = join(MEDIA_DIR, row.filename)
  let size
  try { size = statSync(path).size } catch { return res.status(410).json({ error: 'The underlying file is gone' }) }

  const download = req.query.download === '1'
  const baseHeaders = {
    'Content-Type': row.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }
  if (download) baseHeaders['Content-Disposition'] = `attachment; filename="${JSON.parse(row.data).title.replace(/[^\w.-]+/g, '_')}.webm"`

  const range = req.headers.range
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    const start = match?.[1] ? Number(match[1]) : 0
    const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (start >= size || start > end) return res.status(416).set('Content-Range', `bytes */${size}`).end()
    res.writeHead(206, { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    return createReadStream(path, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...baseHeaders, 'Content-Length': size })
  createReadStream(path).pipe(res)
})

router.patch('/media/:id', (req, res) => {
  const row = q.mediaById.get(req.params.id)
  if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' })
  const meta = JSON.parse(row.data)
  if (typeof req.body?.title === 'string') meta.title = req.body.title.trim().slice(0, 160)
  if (typeof req.body?.views === 'number') meta.views = Math.max(0, Math.floor(req.body.views))
  q.updateMedia.run(JSON.stringify(meta), row.id, req.user.id)
  res.json(mediaRow(q.mediaById.get(row.id)))
})

router.delete('/media/:id', (req, res) => {
  const row = q.mediaById.get(req.params.id)
  if (!row || row.user_id !== req.user.id) return res.json({ ok: true })
  q.deleteMedia.run(row.id, req.user.id)
  try { unlinkSync(join(MEDIA_DIR, row.filename)) } catch {}
  res.json({ ok: true, storage: { used: usedBytes(req.user.id), quota: STORAGE_QUOTA_BYTES } })
})

/* ---------------- Bootstrap (one call to hydrate the whole app) ---------------- */
router.get('/bootstrap', (req, res) => {
  const stateRow = q.userState.get(req.user.id)
  const stored = stateRow ? JSON.parse(stateRow.data) : {}
  // Slices below are owned by the server. Older builds persisted snapshots of them into
  // user_state; dropping them here stops a stale copy from shadowing the live data.
  const { contacts: _c, whiteboards: _w, recordings: _r, clips: _cl, ...personal } = stored
  const media = q.mediaByUser.all(req.user.id).map(mediaRow)
  res.json({
    ...personal,
    user: publicUser(req.user),
    meetings: q.meetingsByUser.all(req.user.id).map((r) => JSON.parse(r.data)),
    channels: visibleChannels(req.user.id),
    contacts: directory(req.user.id),
    whiteboards: boardList(),
    recordings: media.filter((m) => m.kind === 'recording'),
    clips: media.filter((m) => m.kind === 'clip'),
    storage: { used: usedBytes(req.user.id), quota: STORAGE_QUOTA_BYTES },
  })
})

/* ---------------- Meetings ---------------- */
router.get('/meetings', (req, res) => {
  res.json(q.meetingsByUser.all(req.user.id).map((r) => JSON.parse(r.data)))
})

router.put('/meetings/:id', (req, res) => {
  const owner = q.meetingOwner.get(req.params.id)
  if (owner && owner.user_id !== req.user.id) return res.status(403).json({ error: 'You do not have access to this meeting' })
  const meeting = { ...req.body, id: req.params.id }
  q.upsertMeeting.run(meeting.id, req.user.id, JSON.stringify(meeting), Date.now())
  res.json(meeting)
})

router.delete('/meetings/:id', (req, res) => {
  q.deleteMeeting.run(req.params.id, req.user.id)
  res.json({ ok: true })
})

/* ---------------- Chat (history; live sending goes over WebSocket) ---------------- */
router.get('/channels', (req, res) => res.json(visibleChannels(req.user.id)))

router.post('/channels', (req, res) => {
  const name = String(req.body?.name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 48)
  if (name.length < 2) return res.status(400).json({ error: 'Channel names need at least 2 characters' })
  const existing = q.allChannels.all().map((r) => JSON.parse(r.data)).find((c) => c.type === 'channel' && c.name === name)
  if (existing) return res.status(409).json({ error: `#${name} already exists` })
  const channel = { id: uid(), type: 'channel', name, unread: 0, last: '', time: '', createdBy: req.user.id }
  q.insertChannel.run(channel.id, JSON.stringify(channel), Date.now())
  res.status(201).json(channel)
})

router.get('/channels/:id/messages', (req, res) => {
  if (!canAccessChannel(req.user.id, req.params.id)) return res.status(403).json({ error: 'You do not have access to this channel' })
  res.json(q.messagesByChannel.all(req.params.id).map((r) => JSON.parse(r.data)))
})

// Open (or create) a direct-message channel with another real user.
router.post('/channels/dm/:otherId', (req, res) => {
  const me = req.user.id
  const other = q.userById.get(req.params.otherId)
  if (!other) return res.status(404).json({ error: 'User not found' })
  const id = 'dm:' + [me, other.id].sort().join('__')
  const existing = q.channelById.get(id)
  if (existing) return res.json(JSON.parse(existing.data))
  const channel = { id, type: 'dm', members: [me, other.id], name: other.name, avatar: other.avatar, unread: 0, last: '', time: '' }
  q.insertChannel.run(id, JSON.stringify(channel), Date.now())
  res.json(channel)
})

/* ---------------- Personal workspace state (docs/notes/notifications/settings) ---------------- */
const PERSONAL_SLICES = new Set(['docs', 'notes', 'notifications', 'settings'])

router.get('/state', (req, res) => {
  const row = q.userState.get(req.user.id)
  res.json(row ? JSON.parse(row.data) : {})
})

// Merge-patch the user's state document. Server-owned slices are ignored.
router.patch('/state', (req, res) => {
  const row = q.userState.get(req.user.id)
  const current = row ? JSON.parse(row.data) : {}
  const incoming = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => PERSONAL_SLICES.has(k)))
  q.upsertUserState.run(req.user.id, JSON.stringify({ ...current, ...incoming }), Date.now())
  res.json({ ok: true })
})
