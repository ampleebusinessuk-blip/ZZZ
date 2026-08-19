// Same-origin API client. Authentication is an HttpOnly session cookie; the
// CSRF token is intentionally kept only in memory and refreshed on every boot.
let csrfToken = ''
export const setCsrfToken = (value) => { csrfToken = value || '' }

// Notified whenever the server rejects us as unauthenticated, so the app can
// drop to the sign-in screen instead of silently failing every request.
let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn || (() => {}) }

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth && !['GET', 'HEAD'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken
  const res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && auth) onUnauthorized()
    const error = new Error(data.error || `Request failed (${res.status})`)
    error.status = res.status
    throw error
  }
  if (data.csrfToken) setCsrfToken(data.csrfToken)
  return data
}

// Generic binary POST used by media and avatar uploads.
function postBinary(url, blob, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream')
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else {
        if (xhr.status === 401) onUnauthorized()
        reject(Object.assign(new Error(data.error || `Upload failed (${xhr.status})`), { status: xhr.status }))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'))
    xhr.send(blob)
  })
}

// Binary upload for recordings/clips. Progress is reported so the UI can show a bar.
function upload(blob, { kind, title, duration, thumb, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ kind, title, duration, thumb })
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/media?${params}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', blob.type || 'video/webm')
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else {
        if (xhr.status === 401) onUnauthorized()
        reject(Object.assign(new Error(data.error || `Upload failed (${xhr.status})`), { status: xhr.status }))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'))
    xhr.send(blob)
  })
}

export const api = {
  register: (email, name, password) => request('/auth/register', { method: 'POST', body: { email, name, password }, auth: false }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  verifyMfa: (challenge, code) => request('/auth/mfa/verify', { method: 'POST', body: { challenge, code }, auth: false }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
  resetPassword: (token, password) => request('/auth/reset-password', { method: 'POST', body: { token, password }, auth: false }),
  me: () => request('/me'),
  updateProfile: (patch) => request('/me', { method: 'PATCH', body: patch }),
  uploadAvatar: (blob, onProgress) => postBinary('/api/me/avatar', blob, { onProgress }),
  removeAvatar: () => request('/me/avatar', { method: 'DELETE' }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  sessions: () => request('/auth/sessions'),
  revokeSession: (id) => request(`/auth/sessions/${id}`, { method: 'DELETE' }),
  logoutAll: () => request('/auth/logout-all', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  mfaSetup: () => request('/auth/mfa/setup', { method: 'POST' }),
  mfaEnable: (code) => request('/auth/mfa/enable', { method: 'POST', body: { code } }),
  mfaDisable: (password) => request('/auth/mfa/disable', { method: 'POST', body: { password } }),
  authEvents: () => request('/auth/events'),

  bootstrap: () => request('/bootstrap'),
  saveMeeting: (meeting) => request(`/meetings/${meeting.id}`, { method: 'PUT', body: meeting }),
  deleteMeeting: (id) => request(`/meetings/${id}`, { method: 'DELETE' }),
  users: () => request('/users'),

  channels: () => request('/channels'),
  createChannel: (name) => request('/channels', { method: 'POST', body: { name } }),
  openDM: (userId) => request(`/channels/dm/${userId}`, { method: 'POST' }),
  messages: (channelId) => request(`/channels/${encodeURIComponent(channelId)}/messages`),

  boards: () => request('/boards'),
  createBoard: (title, color) => request('/boards', { method: 'POST', body: { title, color } }),
  saveBoard: (id, patch) => request(`/boards/${id}`, { method: 'PUT', body: patch }),
  deleteBoard: (id) => request(`/boards/${id}`, { method: 'DELETE' }),

  media: () => request('/media'),
  uploadMedia: upload,
  updateMedia: (id, patch) => request(`/media/${id}`, { method: 'PATCH', body: patch }),
  deleteMedia: (id) => request(`/media/${id}`, { method: 'DELETE' }),
  aiStatus: () => request('/ai/status'),
  generateAiNotes: (id) => request(`/media/${id}/ai-notes`, { method: 'POST' }),

  ice: () => request('/ice'),
  livekitConfig: () => request('/livekit/config'),
  livekitToken: (room) => request('/livekit/token', { method: 'POST', body: { room } }),

  /* Guest access: an invite link lets someone join one room without an account. */
  createGuestLink: (room) => request(`/rooms/${encodeURIComponent(room)}/guest-link`, { method: 'POST' }),
  guestSession: (token, name) => request('/guest/session', { method: 'POST', body: { token, name }, auth: false }),
  guestMe: () => request('/guest/me'),
  guestLogout: () => request('/guest/logout', { method: 'POST' }),
  guestIce: () => request('/guest/ice'),
  guestLivekitConfig: () => request('/guest/livekit/config'),
  guestLivekitToken: () => request('/guest/livekit/token', { method: 'POST' }),
  patchState: (patch) => request('/state', { method: 'PATCH', body: patch }),
}
