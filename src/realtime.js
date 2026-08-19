// Front-end WebSocket client: authenticates, auto-reconnects with backoff,
// and dispatches typed messages to subscribers. Shared by the store (chat,
// presence, notifications) and the Meeting room (WebRTC signaling).
class Realtime {
  constructor() {
    this.ws = null
    this.listeners = new Map() // type -> Set<fn>
    this.queue = []
    this.connected = false
    this.backoff = 500
    this.peerId = null
    this.shouldRun = false
    this.activeRoom = null
  }

  connect() {
    this.shouldRun = true
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws`
    try {
      this.ws = new WebSocket(url)
    } catch {
      return this._retry()
    }

    this.ws.onopen = () => {
      this.backoff = 500
      this.send({ type: 'auth' })
    }
    this.ws.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.type === 'ready') {
        this.connected = true
        this.peerId = msg.you?.peerId
        const queued = this.queue
        queued.forEach((m) => this._raw(m))
        this.queue = []
        // A new WebSocket after wifi/mobile handoff has no server-side room
        // membership. Restore it automatically instead of leaving the call
        // looking empty after a brief network interruption.
        if (this.activeRoom && !queued.some((m) => m.type === 'join-room' && m.roomId === this.activeRoom)) {
          this._raw({ type: 'join-room', roomId: this.activeRoom })
        }
      }
      this._dispatch(msg.type, msg)
    }
    this.ws.onclose = () => {
      this.connected = false
      if (this.shouldRun) this._retry()
    }
    this.ws.onerror = () => { try { this.ws.close() } catch {} }
  }

  _retry() {
    clearTimeout(this._t)
    this._t = setTimeout(() => this.connect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, 8000)
  }

  disconnect() {
    this.shouldRun = false
    try { this.ws?.close() } catch {}
    this.ws = null
    this.connected = false
    this.activeRoom = null
  }

  _raw(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  send(obj) {
    if (obj.type === 'join-room') this.activeRoom = obj.roomId
    else if (obj.type === 'leave-room' && (!obj.roomId || obj.roomId === this.activeRoom)) this.activeRoom = null
    // 'auth' must go immediately; everything else waits until authed.
    if (obj.type === 'auth' || this.connected) this._raw(obj)
    else this.queue.push(obj)
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
    return () => this.listeners.get(type)?.delete(fn)
  }

  _dispatch(type, msg) {
    this.listeners.get(type)?.forEach((fn) => fn(msg))
  }
}

export const rt = new Realtime()
