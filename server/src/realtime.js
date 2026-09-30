import { WebSocketServer } from 'ws'
import { sessionFromCookie, guestFromCookie } from './auth.js'
import { q } from './db.js'

const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))

/*
  Real-time hub. One process holds connections in memory. To scale horizontally
  across many instances, swap the in-memory `clients`/`rooms` broadcast for a
  Redis pub/sub adapter (publish every outbound event to a channel that all
  instances subscribe to). The message contract below stays identical.
*/
export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 })

  // ws -> { id, userId, name, avatar }
  const clients = new Map()
  // roomId -> Set<ws>   (meeting rooms for WebRTC signaling)
  const rooms = new Map()
  const roomHosts = new Map()
  // roomId -> Map<peerId, { ws, name, avatar, guest }>  (Zoom-style waiting room:
  // everyone except the host sits here until the host admits or denies them)
  const pendingByRoom = new Map()
  // roomId -> Set<userId>  (already admitted once — a dropped wifi/mobile
  // reconnect re-sends join-room automatically and should slide straight back
  // in, not land the participant back in the lobby mid-call)
  const admittedByRoom = new Map()
  // roomId -> true  (the host explicitly ended it — refuse every join from
  // here on, including the host's own reconnect, until a new roomId is used)
  const endedRooms = new Set()
  // boardId -> Set<ws>  (collaborative whiteboard rooms)
  const boards = new Map()

  const send = (ws, obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
  }
  const broadcast = (obj, filter = () => true) => {
    const data = JSON.stringify(obj)
    for (const [ws, meta] of clients) {
      if (ws.readyState === ws.OPEN && filter(meta, ws)) ws.send(data)
    }
  }

  const onlineUserIds = () => [...new Set([...clients.values()].filter((c) => !c.guest).map((c) => c.userId))]
  const pushPresence = () => broadcast({ type: 'presence', online: onlineUserIds() })
  const canAccessChannel = (userId, channelId) => {
    const row = q.channelById.get(channelId)
    if (!row) return false
    try {
      const channel = JSON.parse(row.data)
      return channel.type === 'channel' || (Array.isArray(channel.members) && channel.members.includes(userId))
    } catch { return false }
  }

  wss.on('connection', (ws, request) => {
    const authenticated = sessionFromCookie(request.headers.cookie)
    // A guest holds a pass for exactly one room and no workspace identity.
    const guest = authenticated ? null : guestFromCookie(request.headers.cookie)
    ws.isAlive = true
    ws.on('pong', () => (ws.isAlive = true))

    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }

      // First message must authenticate.
      if (!clients.has(ws)) {
        if (msg.type !== 'auth') return ws.close()
        if (!authenticated && !guest) { send(ws, { type: 'error', error: 'auth failed' }); return ws.close() }

        if (guest) {
          // Guests are confined to their room: no presence, no directory, no
          // workspace channels. `room` is the authority for every later message.
          const meta = { id: uid(), userId: `guest:${guest.id}`, name: guest.name, avatar: guest.avatar, guest: true, room: guest.room }
          clients.set(ws, meta)
          send(ws, { type: 'ready', you: { peerId: meta.id, userId: meta.userId, guest: true, room: guest.room } })
          return
        }

        const user = authenticated.user
        const meta = { id: uid(), userId: user.id, name: user.name, avatar: user.avatar }
        clients.set(ws, meta)
        send(ws, { type: 'ready', you: { peerId: meta.id, userId: meta.userId } })
        pushPresence()
        // Tell everyone else the user directory may have grown, so a teammate who
        // just signed up shows up in Contacts without a page refresh.
        broadcast({ type: 'directory' }, (m) => m.userId !== meta.userId)
        return
      }

      const meta = clients.get(ws)

      /* Guest guard: a guest pass names one room, so anything outside it — other
         rooms, workspace channels, whiteboards, notifications — is refused here
         rather than relying on each handler to remember. */
      if (meta.guest) {
        const allowed = ['chat', 'join-room', 'leave-room', 'cancel-join', 'signal', 'room-event']
        if (!allowed.includes(msg.type)) return send(ws, { type: 'error', error: 'not permitted for guests' })
        if (msg.type === 'chat' && msg.channelId !== `room:${meta.room}`) return send(ws, { type: 'error', error: 'channel access denied' })
        if ((msg.type === 'join-room' || msg.type === 'room-event') && msg.roomId !== meta.room) {
          return send(ws, { type: 'error', error: 'room access denied' })
        }
      }

      switch (msg.type) {
        case 'chat': {
          const { channelId, text } = msg
          if (!channelId || !text?.trim()) return
          if (!channelId.startsWith('room:') && !canAccessChannel(meta.userId, channelId)) return send(ws, { type: 'error', error: 'channel access denied' })
          const safeText = String(text).trim().slice(0, 8000)
          const now = Date.now()
          ws.messageWindow = (ws.messageWindow || []).filter((ts) => now - ts < 10000)
          if (ws.messageWindow.length >= 20) return send(ws, { type: 'error', error: 'message rate limit exceeded' })
          ws.messageWindow.push(now)
          // `ts` is the source of truth; clients format it in their own locale/timezone.
          const message = { id: uid(), author: meta.name, avatar: meta.avatar, userId: meta.userId, ts: now, text: safeText }
          // persist
          try {
            q.insertMessage.run(message.id, channelId, meta.userId, JSON.stringify(message), now)
            const chRow = q.channelById.get(channelId)
            if (chRow) {
              const ch = JSON.parse(chRow.data)
              ch.last = `${meta.name.split(' ')[0]}: ${message.text}`
              ch.ts = now
              q.updateChannel.run(JSON.stringify(ch), now, channelId)
            }
          } catch {}
          // Deliver only to the right recipients.
          const payload = { type: 'chat', channelId, message }
          if (channelId.startsWith('dm:')) {
            const members = channelId.slice(3).split('__')
            broadcast(payload, (m) => members.includes(m.userId))
          } else if (channelId.startsWith('room:')) {
            if (ws.roomId !== channelId.slice(5)) return // still in the waiting room — no call access yet
            const set = rooms.get(channelId.slice(5))
            if (set) for (const p of set) send(p, payload)
          } else {
            broadcast(payload) // shared channels (e.g. #general)
          }
          break
        }

        /* ---------- Collaborative whiteboard ---------- */
        case 'board-join': {
          const { boardId } = msg
          if (!boardId) return
          if (!boards.has(boardId)) boards.set(boardId, new Set())
          const board = boards.get(boardId)
          // Ask one peer already on the board to send the newcomer the current canvas,
          // so someone joining mid-session doesn't stare at a blank page.
          const donor = [...board][0]
          if (donor) send(donor, { type: 'board-sync-request', boardId, to: meta.id })
          board.add(ws)
          ws.boardId = boardId
          break
        }
        case 'board-sync': {
          // Point-to-point snapshot delivery in response to a sync request.
          for (const [pws, pmeta] of clients) {
            if (pmeta.id === msg.to) { send(pws, { type: 'board-sync', boardId: msg.boardId, snapshot: msg.snapshot }); break }
          }
          break
        }
        case 'board-op': {
          const { boardId, op } = msg
          const set = boards.get(boardId)
          if (set) for (const p of set) if (p !== ws) send(p, { type: 'board-op', boardId, op })
          break
        }
        case 'board-leave': {
          const set = boards.get(ws.boardId)
          if (set) { set.delete(ws); if (set.size === 0) boards.delete(ws.boardId) }
          ws.boardId = null
          break
        }

        case 'notify': {
          // fan-out a notification to a target user (or self)
          const note = { id: uid(), text: String(msg.text || '').slice(0, 300), ts: Date.now(), read: false, icon: msg.icon || 'video' }
          broadcast({ type: 'notification', note }, (m) => m.userId === (msg.toUserId || meta.userId))
          break
        }

        /* ---------- WebRTC signaling (mesh) ---------- */
        case 'join-room': {
          const { roomId } = msg
          if (!roomId) return
          if (endedRooms.has(roomId)) return send(ws, { type: 'meeting-ended' })
          if (!rooms.has(roomId)) rooms.set(roomId, new Set())

          // The first signed-in member to reach an empty room starts it and is
          // its host outright — nobody to admit them. Everyone else, member or
          // guest, waits in the lobby until that host lets them in.
          if (!meta.guest && !roomHosts.has(roomId)) {
            roomHosts.set(roomId, meta.id)
            finalizeJoin(ws, meta, roomId)
            flushPendingAdmissions(roomId)
            break
          }

          // Already admitted earlier in this room's lifetime (e.g. reconnecting
          // after a brief network drop) — skip the lobby, rejoin directly.
          if (admittedByRoom.get(roomId)?.has(meta.userId)) {
            finalizeJoin(ws, meta, roomId)
            break
          }

          if (!pendingByRoom.has(roomId)) pendingByRoom.set(roomId, new Map())
          pendingByRoom.get(roomId).set(meta.id, { ws, name: meta.name, avatar: meta.avatar, guest: !!meta.guest })
          send(ws, { type: 'waiting-for-admission' })
          notifyHostOfPending(roomId, meta)
          break
        }
        case 'cancel-join': {
          removeFromPending(ws)
          break
        }
        // Only the current host may admit or deny someone waiting in their room.
        case 'admission-response': {
          const { roomId, requestId, action } = msg
          if (!roomId || !requestId || !['admit', 'deny'].includes(action)) return
          if (meta.guest || roomHosts.get(roomId) !== meta.id) return send(ws, { type: 'error', error: 'host permission required' })
          const pending = pendingByRoom.get(roomId)
          const entry = pending?.get(requestId)
          if (!entry) return
          pending.delete(requestId)
          if (pending.size === 0) pendingByRoom.delete(roomId)
          if (action === 'admit') {
            const admittedMeta = clients.get(entry.ws)
            if (admittedMeta && entry.ws.readyState === entry.ws.OPEN) finalizeJoin(entry.ws, admittedMeta, roomId)
          } else {
            send(entry.ws, { type: 'admission-denied' })
          }
          break
        }
        // Host-only, and final: every current participant is dropped, anyone
        // still waiting to be admitted is turned away, and the room refuses
        // every join from here on rather than quietly reopening for the next
        // person who follows the same link.
        case 'end-meeting': {
          const { roomId } = msg
          if (!roomId || meta.guest || roomHosts.get(roomId) !== meta.id) return send(ws, { type: 'error', error: 'host permission required' })
          endedRooms.add(roomId)
          const room = rooms.get(roomId)
          if (room) for (const p of room) send(p, { type: 'meeting-ended' })
          const pending = pendingByRoom.get(roomId)
          if (pending) for (const p of pending.values()) send(p.ws, { type: 'meeting-ended' })
          rooms.delete(roomId)
          roomHosts.delete(roomId)
          pendingByRoom.delete(roomId)
          admittedByRoom.delete(roomId)
          break
        }
        case 'signal': {
          const { to, data } = msg
          if (!ws.roomId) return
          for (const [pws, pmeta] of clients) {
            if (pmeta.id === to && pws.roomId === ws.roomId) { send(pws, { type: 'signal', from: meta.id, data }); break }
          }
          break
        }
        case 'leave-room': {
          leaveRoom(ws)
          break
        }
        // Reactions, raise-hand, etc. relayed to everyone in the call.
        case 'room-event': {
          if (ws.roomId !== msg.roomId) return // still in the waiting room — no call access yet
          const set = rooms.get(msg.roomId)
          if (set) for (const p of set) if (p !== ws) send(p, { type: 'room-event', event: { ...msg.event, from: meta.id } })
          break
        }
        // Signed-in members act as hosts; guests can never moderate another
        // participant. Targets are resolved only inside the sender's room.
        case 'moderate': {
          if (meta.guest || !ws.roomId || msg.roomId !== ws.roomId || roomHosts.get(ws.roomId) !== meta.id) return send(ws, { type: 'error', error: 'host permission required' })
          if (!['mute', 'remove'].includes(msg.action)) return
          const room = rooms.get(ws.roomId)
          const target = room && [...room].find((p) => clients.get(p)?.id === msg.target)
          if (!target || target === ws) return
          send(target, { type: 'moderation', action: msg.action, by: meta.name })
          if (msg.action === 'remove') setTimeout(() => leaveRoom(target), 150)
          break
        }
      }
    })

    ws.on('close', () => {
      const meta = clients.get(ws)
      leaveRoom(ws)
      removeFromPending(ws)
      const bset = boards.get(ws.boardId)
      if (bset) { bset.delete(ws); if (bset.size === 0) boards.delete(ws.boardId) }
      clients.delete(ws)
      if (!meta?.guest) pushPresence()
    })
  })

  // Admits a waiting (or brand-new host) connection into the actual call: hands
  // them the current roster, adds them to the room, and announces them to peers.
  function finalizeJoin(ws, meta, roomId) {
    const room = rooms.get(roomId)
    const peers = [...room].filter((p) => p !== ws && clients.has(p)).map((p) => {
      const pm = clients.get(p)
      return { peerId: pm.id, name: pm.name, avatar: pm.avatar }
    })
    send(ws, { type: 'peers', peers })
    room.add(ws)
    ws.roomId = roomId
    if (!admittedByRoom.has(roomId)) admittedByRoom.set(roomId, new Set())
    admittedByRoom.get(roomId).add(meta.userId)
    send(ws, { type: 'room-role', host: roomHosts.get(roomId) === meta.id })
    for (const p of room) {
      if (p !== ws) send(p, { type: 'peer-joined', peerId: meta.id, name: meta.name, avatar: meta.avatar })
    }
  }

  function findHostWs(roomId) {
    const hostId = roomHosts.get(roomId)
    const room = rooms.get(roomId)
    if (!hostId || !room) return null
    for (const p of room) if (clients.get(p)?.id === hostId) return p
    return null
  }

  function notifyHostOfPending(roomId, meta) {
    const hostWs = findHostWs(roomId)
    if (hostWs) send(hostWs, { type: 'admission-request', requestId: meta.id, name: meta.name, avatar: meta.avatar, guest: !!meta.guest })
  }

  // Re-announces anyone still waiting once a room gets a (new) host — e.g. a
  // guest arrived before the host started the meeting, or the host handed off.
  function flushPendingAdmissions(roomId) {
    const pending = pendingByRoom.get(roomId)
    const hostWs = findHostWs(roomId)
    if (!pending || !hostWs) return
    for (const [requestId, p] of pending) {
      send(hostWs, { type: 'admission-request', requestId, name: p.name, avatar: p.avatar, guest: p.guest })
    }
  }

  function removeFromPending(ws) {
    for (const [roomId, pending] of pendingByRoom) {
      for (const [requestId, p] of pending) {
        if (p.ws !== ws) continue
        pending.delete(requestId)
        if (pending.size === 0) pendingByRoom.delete(roomId)
        const hostWs = findHostWs(roomId)
        if (hostWs) send(hostWs, { type: 'admission-cancelled', requestId })
        return
      }
    }
  }

  function leaveRoom(ws) {
    const roomId = ws.roomId
    if (!roomId || !rooms.has(roomId)) return
    const room = rooms.get(roomId)
    room.delete(ws)
    const meta = clients.get(ws)
    for (const p of room) send(p, { type: 'peer-left', peerId: meta?.id })
    if (room.size === 0) { rooms.delete(roomId); roomHosts.delete(roomId); pendingByRoom.delete(roomId); admittedByRoom.delete(roomId) }
    else if (roomHosts.get(roomId) === meta?.id) {
      const nextHost = [...room].find((p) => !clients.get(p)?.guest)
      if (nextHost) {
        const nextMeta = clients.get(nextHost)
        roomHosts.set(roomId, nextMeta.id)
        send(nextHost, { type: 'room-role', host: true })
        flushPendingAdmissions(roomId)
      } else roomHosts.delete(roomId)
    }
    ws.roomId = null
  }

  // Heartbeat: drop dead connections so presence stays accurate under load.
  const interval = setInterval(() => {
    for (const ws of clients.keys()) {
      if (ws.isAlive === false) { ws.terminate(); continue }
      ws.isAlive = false
      try { ws.ping() } catch {}
    }
  }, 30000)
  wss.on('close', () => clearInterval(interval))

  return wss
}
