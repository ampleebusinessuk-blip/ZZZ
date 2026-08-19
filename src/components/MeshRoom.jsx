import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, MonitorUp, MessageSquare,
  Users, Smile, PhoneOff, Send, X, Hand, Circle, ShieldCheck, Copy, Link2, Disc, Square,
  Settings2, Loader2, AlertTriangle, UserPlus,
  Sparkles,
  UserMinus,
  MoreHorizontal, SwitchCamera,
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { rt } from '../realtime.js'
import { messageTime } from '../dates.js'
import { createGuestInviteLink } from '../invites.js'

// Fallback only. The real list is fetched per call so TURN credentials stay
// short-lived; STUN alone cannot relay media between restrictive NATs.
const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
const fallbackAvatar = (seed) => `https://i.pravatar.cc/150?u=${encodeURIComponent(seed || 'user')}`
const EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '😮', '🙌', '🔥']

export default function MeshRoom({ roomId: roomProp, onLeave }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, uploadMedia, toast, uid } = useApp()
  const currentUser = state.user
  const isGuest = !!currentUser?.isGuest
  const settings = state.settings || {}
  const mirror = settings.mirror !== false

  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(settings.autoJoin !== false)
  const [mediaError, setMediaError] = useState('')
  // Local media takes a moment to open. Until it is ready the capture controls
  // stay disabled, otherwise an eager click just reports "nothing to record".
  const [mediaReady, setMediaReady] = useState(false)
  const [hasCamera, setHasCamera] = useState(false)
  const [fitVideo, setFitVideo] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [handUp, setHandUp] = useState(false)
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(0)
  const [aiTakingNotes, setAiTakingNotes] = useState(false)
  const [isHost, setIsHost] = useState(!isGuest)
  const [panel, setPanel] = useState(null)
  const [reactPicker, setReactPicker] = useState(false)
  const [deviceMenu, setDeviceMenu] = useState(false)
  const [mobileMore, setMobileMore] = useState(false)
  const [devices, setDevices] = useState({ cameras: [], mics: [] })
  const [chosen, setChosen] = useState({ camera: '', mic: '' })
  const [elapsed, setElapsed] = useState(0)
  const [remotePeers, setRemotePeers] = useState({})
  const [flyers, setFlyers] = useState([])
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')

  const localVideoRef = useRef(null)
  const localStream = useRef(null)
  const screenStream = useRef(null)
  const peers = useRef(new Map())   // peerId -> { pc, pending: [], polite, makingOffer, meta }
  const chatRef = useRef(null)
  const recorder = useRef(null)
  const recChunks = useRef([])
  const recAudio = useRef(null)     // { ctx, dest, sources: Map }
  const recStartedAt = useRef(0)
  const aiNotesRef = useRef(false)
  // Latest local media flags, readable from WS callbacks without stale closures.
  const localFlags = useRef({ mic: true, cam: true, sharing: false, hand: false })
  const iceServers = useRef(FALLBACK_ICE)
  const turnAvailable = useRef(false)
  const [relayWarning, setRelayWarning] = useState('')

  // The router resolves placeholder segments to a real room before rendering,
  // so the room is always genuine here. Guests arrive on /join/:room, which
  // passes it as a prop instead of a route param.
  const roomId = roomProp || id
  const meetingId = /^\d{11}$/.test(roomId) ? roomId.replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3') : roomId
  const [guestLink, setGuestLink] = useState('')
  const [guestLinkBusy, setGuestLinkBusy] = useState(false)

  useEffect(() => { const t = setInterval(() => setElapsed((e) => e + 1), 1000); return () => clearInterval(t) }, [])
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  useEffect(() => { chatRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' }) }, [msgs.length])

  /* ---------------- media state broadcast ---------------- */
  const publishState = useCallback((extra = {}) => {
    Object.assign(localFlags.current, extra)
    rt.send({ type: 'room-event', roomId, event: { type: 'media', ...localFlags.current } })
  }, [roomId])

  /* ---------------- peer plumbing ---------------- */
  const removePeer = useCallback((peerId) => {
    const entry = peers.current.get(peerId)
    if (entry) { clearTimeout(entry.stallTimer); try { entry.pc.close() } catch {} peers.current.delete(peerId) }
    setRemotePeers((prev) => { const n = { ...prev }; delete n[peerId]; return n })
    // stop mixing this peer's audio into any running recording
    const mix = recAudio.current
    if (mix?.sources.has(peerId)) { try { mix.sources.get(peerId).disconnect() } catch {}; mix.sources.delete(peerId) }
  }, [])

  const attachTracksTo = (pc) => {
    const stream = localStream.current
    if (!stream) return
    const existing = pc.getSenders().map((s) => s.track).filter(Boolean)
    for (const track of stream.getTracks()) {
      if (existing.includes(track)) continue
      // While sharing, publish the screen in the video slot instead of the camera.
      if (track.kind === 'video' && screenStream.current) continue
      pc.addTrack(track, stream)
    }
    const screenTrack = screenStream.current?.getVideoTracks()[0]
    if (screenTrack && !existing.includes(screenTrack)) pc.addTrack(screenTrack, screenStream.current)
  }

  const createPeer = useCallback((peerId, meta) => {
    const found = peers.current.get(peerId)
    if (found) return found
    const pc = new RTCPeerConnection({ iceServers: iceServers.current, bundlePolicy: 'max-bundle' })
    // Perfect negotiation: exactly one side yields when offers cross. Comparing the
    // two peer ids gives both sides the same answer without extra signaling.
    const entry = { pc, pending: [], polite: (rt.peerId || '') > peerId, makingOffer: false, meta }
    peers.current.set(peerId, entry)

    pc.onicecandidate = (e) => { if (e.candidate) rt.send({ type: 'signal', to: peerId, data: { candidate: e.candidate } }) }

    pc.ontrack = (e) => {
      const [stream] = e.streams
      setRemotePeers((prev) => ({ ...prev, [peerId]: { ...(prev[peerId] || meta || {}), stream } }))
      if (e.track.kind === 'audio') mixRemoteAudio(peerId, stream)
    }

    pc.onnegotiationneeded = async () => {
      // Fires whenever tracks are added/removed — this is what makes starting a
      // screen share mid-call actually reach the other side.
      try {
        entry.makingOffer = true
        await pc.setLocalDescription()
        rt.send({ type: 'signal', to: peerId, data: { sdp: pc.localDescription } })
      } catch {} finally { entry.makingOffer = false }
    }

    pc.oniceconnectionstatechange = () => {
      // 'disconnected' is usually a transient blip; only a real failure warrants
      // an ICE restart, and only 'closed' removes the tile.
      if (pc.iceConnectionState === 'failed') {
        try { pc.restartIce() } catch {}
        setRelayWarning(turnAvailable.current
          ? "Couldn't reach this person. Their network may be blocking the call."
          : "Couldn't connect — your networks need a relay (TURN) server to reach each other.")
      }
      if (['connected', 'completed'].includes(pc.iceConnectionState)) setRelayWarning('')
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed') removePeer(peerId)
      setRemotePeers((prev) => (prev[peerId] ? { ...prev, [peerId]: { ...prev[peerId], connection: pc.connectionState } } : prev))
    }

    /* A pair that never gets past checking is the classic no-TURN symptom: the
       tile would otherwise sit on "connecting" with nothing explaining why. */
    entry.stallTimer = setTimeout(() => {
      if (!['connected', 'completed'].includes(pc.iceConnectionState)) {
        setRelayWarning(turnAvailable.current
          ? "Still connecting… one of you may be on a network that blocks video calls."
          : 'Still connecting… a relay (TURN) server is needed for people on different networks.')
      }
    }, 12000)

    attachTracksTo(pc)
    if (meta) setRemotePeers((prev) => ({ ...prev, [peerId]: { ...meta, ...(prev[peerId] || {}) } }))
    return entry
  }, [removePeer])

  /* ---------------- recording audio mixer ---------------- */
  // A recording should capture the meeting, not just your own microphone — and a
  // screen share carries no audio at all, which is why recordings used to be silent.
  const ensureMixer = () => {
    if (recAudio.current) return recAudio.current
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    const dest = ctx.createMediaStreamDestination()
    recAudio.current = { ctx, dest, sources: new Map() }
    return recAudio.current
  }
  const mixInto = (key, stream) => {
    const mix = recAudio.current
    if (!mix || !stream?.getAudioTracks().length || mix.sources.has(key)) return
    try {
      const src = mix.ctx.createMediaStreamSource(stream)
      src.connect(mix.dest)
      mix.sources.set(key, src)
    } catch {}
  }
  const mixRemoteAudio = (peerId, stream) => { if (recAudio.current) mixInto(peerId, stream) }

  /* ---------------- local media ---------------- */
  const buildConstraints = useCallback((withVideo) => ({
    video: withVideo && {
      ...(chosen.camera ? { deviceId: { exact: chosen.camera } } : {}),
      width: { ideal: settings.hd === false ? 640 : 1280 },
      height: { ideal: settings.hd === false ? 360 : 720 },
      frameRate: { ideal: 30 },
      aspectRatio: { ideal: 16 / 9 },
    },
    audio: {
      ...(chosen.mic ? { deviceId: { exact: chosen.mic } } : {}),
      echoCancellation: true,
      noiseSuppression: settings.suppressNoise !== false,
      autoGainControl: true,
    },
  }), [chosen.camera, chosen.mic, settings.hd, settings.suppressNoise])

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        cameras: list.filter((d) => d.kind === 'videoinput'),
        mics: list.filter((d) => d.kind === 'audioinput'),
      })
    } catch {}
  }, [])

  /* ---------------- join / leave lifecycle ---------------- */
  useEffect(() => {
    let cancelled = false
    setMediaReady(false)

    async function start() {
      // Honour the choices made in the Join dialog (?muted=1 / ?novideo=1).
      const url = new URLSearchParams(window.location.search)
      const joinMuted = url.get('muted') === '1'
      const wantVideo = url.get('novideo') === '1' ? false : settings.autoJoin !== false
      let stream = null
      try {
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(wantVideo))
      } catch (err) {
        // Fall back to audio-only rather than joining with nothing at all.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: buildConstraints(false).audio })
          setMediaError('No camera available — you joined with audio only.')
        } catch {
          setMediaError(
            err?.name === 'NotAllowedError'
              ? 'Camera and microphone are blocked. Allow them in your browser to be seen and heard.'
              : 'No camera or microphone found. You can still watch and use chat.'
          )
        }
      }
      if (cancelled) { stream?.getTracks().forEach((t) => t.stop()); return }
      setMediaReady(true)

      if (stream) {
        localStream.current = stream
        const videoTrack = stream.getVideoTracks()[0]
        setHasCamera(!!videoTrack)
        if (videoTrack) videoTrack.enabled = wantVideo
        setCam(!!videoTrack && wantVideo)
        stream.getAudioTracks().forEach((t) => (t.enabled = !joinMuted))
        setMic(!joinMuted)
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
        localFlags.current = { ...localFlags.current, mic: !joinMuted, cam: !!videoTrack && wantVideo }
        refreshDevices()
      } else {
        setHasCamera(false); setCam(false)
        localFlags.current = { ...localFlags.current, mic: false, cam: false }
      }

      /* Fetch relay credentials BEFORE joining. Peers are created the moment we
         announce ourselves, and an RTCPeerConnection's ICE servers cannot be
         changed after construction — arriving late would mean the first peers
         silently get STUN only. */
      try {
        const { iceServers: servers, turnConfigured } = await (isGuest ? api.guestIce() : api.ice())
        if (Array.isArray(servers) && servers.length) iceServers.current = servers
        turnAvailable.current = !!turnConfigured
      } catch { /* keep the STUN fallback */ }
      if (cancelled) return

      rt.send({ type: 'join-room', roomId })
    }
    start()

    const offs = [
      rt.on('peers', ({ peers: existing }) => {
        existing?.forEach((p) => {
          createPeer(p.peerId, { name: p.name, avatar: p.avatar })
          // The newcomer offers; onnegotiationneeded fires once tracks are attached.
        })
        if (existing?.length) setTimeout(() => publishState(), 400)
      }),
      rt.on('peer-joined', ({ peerId, name, avatar }) => {
        createPeer(peerId, { name, avatar })
        // Tell the newcomer our current mute/camera state so their UI is accurate.
        setTimeout(() => publishState(), 500)
        if (settings.joinSound) playJoinChime()
      }),
      rt.on('peer-left', ({ peerId }) => removePeer(peerId)),

      rt.on('signal', async ({ from, data }) => {
        const entry = peers.current.get(from) || createPeer(from, null)
        const { pc } = entry
        try {
          if (data.sdp) {
            const offerCollision = data.sdp.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable')
            if (offerCollision && !entry.polite) return   // impolite side ignores the colliding offer
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            // Candidates that arrived before the description are only valid now.
            for (const c of entry.pending.splice(0)) { try { await pc.addIceCandidate(c) } catch {} }
            if (data.sdp.type === 'offer') {
              await pc.setLocalDescription()
              rt.send({ type: 'signal', to: from, data: { sdp: pc.localDescription } })
            }
          } else if (data.candidate) {
            const candidate = new RTCIceCandidate(data.candidate)
            // Buffering here is what fixes the intermittent "connected but black" tile.
            if (!pc.remoteDescription || !pc.remoteDescription.type) entry.pending.push(candidate)
            else await pc.addIceCandidate(candidate)
          }
        } catch {}
      }),

      rt.on('chat', (m) => {
        if (m.channelId === `room:${roomId}`) {
          setMsgs((prev) => [...prev, { ...m.message, me: m.message.userId === currentUser?.id }])
          setPanel((p) => p)
        }
      }),

      rt.on('room-event', ({ event }) => {
        if (event.type === 'reaction') addFlyer(event.emoji, event.from)
        else if (event.type === 'media') {
          setRemotePeers((prev) => (prev[event.from]
            ? { ...prev, [event.from]: { ...prev[event.from], mic: event.mic, cam: event.cam, sharing: event.sharing, hand: event.hand } }
            : prev))
        }
      }),
      rt.on('moderation', ({ action, by }) => {
        if (action === 'mute') {
          localStream.current?.getAudioTracks().forEach((track) => { track.enabled = false })
          localFlags.current.mic = false
          setMic(false)
          publishState({ mic: false })
          toast(`${by || 'The host'} muted your microphone`, 'info')
        } else if (action === 'remove') {
          toast(`${by || 'The host'} removed you from the meeting`, 'info')
          setTimeout(() => (onLeave ? onLeave() : navigate('/')), 250)
        }
      }),
      rt.on('room-role', ({ host }) => setIsHost(Boolean(host))),
    ]

    return () => {
      cancelled = true
      rt.send({ type: 'leave-room', roomId })
      offs.forEach((off) => off())
      try { if (recorder.current?.state === 'recording') recorder.current.stop() } catch {}
      try { recAudio.current?.ctx.close() } catch {}
      recAudio.current = null
      peers.current.forEach((entry) => { clearTimeout(entry.stallTimer); try { entry.pc.close() } catch {} })
      peers.current.clear()
      localStream.current?.getTracks().forEach((t) => t.stop())
      screenStream.current?.getTracks().forEach((t) => t.stop())
      localStream.current = null
      screenStream.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  const playJoinChime = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.frequency.value = 660; gain.gain.value = 0.06
      osc.connect(gain); gain.connect(ctx.destination); osc.start()
      osc.stop(ctx.currentTime + 0.14)
      setTimeout(() => ctx.close().catch(() => {}), 400)
    } catch {}
  }

  const addFlyer = (emoji) => {
    const fid = uid()
    setFlyers((f) => [...f, { id: fid, emoji, left: 20 + Math.random() * 60 }])
    setTimeout(() => setFlyers((f) => f.filter((x) => x.id !== fid)), 2600)
  }

  /* ---------------- controls ---------------- */
  const toggleMic = () => setMic((v) => {
    const next = !v
    localStream.current?.getAudioTracks().forEach((t) => (t.enabled = next))
    publishState({ mic: next })
    return next
  })

  const toggleCam = () => setCam((v) => {
    const next = !v
    localStream.current?.getVideoTracks().forEach((t) => (t.enabled = next))
    publishState({ cam: next })
    return next
  })

  const setVideoSenders = (track) => peers.current.forEach(({ pc }) => {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
    if (sender) sender.replaceTrack(track).catch(() => {})
    // No video sender yet (camera denied at join) — add one and let
    // onnegotiationneeded renegotiate, instead of silently doing nothing.
    else if (track) pc.addTrack(track, screenStream.current || localStream.current)
  })

  const stopShare = useCallback(() => {
    screenStream.current?.getTracks().forEach((t) => t.stop())
    screenStream.current = null
    const camTrack = localStream.current?.getVideoTracks()[0] || null
    setVideoSenders(camTrack)
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream.current
    setSharing(false)
    publishState({ sharing: false })
  }, [publishState])

  const toggleShare = async () => {
    if (sharing) return stopShare()
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true })
      screenStream.current = s
      setVideoSenders(s.getVideoTracks()[0])
      if (localVideoRef.current) localVideoRef.current.srcObject = s
      s.getVideoTracks()[0].onended = () => stopShare()
      // Tab audio, when the user shared it, belongs in the recording too.
      if (recAudio.current) mixInto('screen', s)
      setSharing(true)
      publishState({ sharing: true })
      toast('You are sharing your screen', 'video')
    } catch { toast('Screen share cancelled', 'info') }
  }

  const switchDevice = async (kind, deviceId) => {
    setChosen((c) => ({ ...c, [kind]: deviceId }))
    setDeviceMenu(false)
    try {
      const constraints = kind === 'camera'
        ? { video: { deviceId: { exact: deviceId }, width: { ideal: settings.hd === false ? 640 : 1280 } } }
        : { audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: settings.suppressNoise !== false } }
      const fresh = await navigator.mediaDevices.getUserMedia(constraints)
      const newTrack = fresh.getTracks()[0]
      const old = localStream.current?.getTracks().find((t) => t.kind === newTrack.kind)
      if (old) { localStream.current.removeTrack(old); old.stop() }
      localStream.current?.addTrack(newTrack)
      newTrack.enabled = newTrack.kind === 'video' ? cam : mic
      peers.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === newTrack.kind)
        if (sender && !(newTrack.kind === 'video' && sharing)) sender.replaceTrack(newTrack).catch(() => {})
      })
      if (newTrack.kind === 'video' && !sharing && localVideoRef.current) localVideoRef.current.srcObject = localStream.current
      if (newTrack.kind === 'video') setHasCamera(true)
      toast(`${kind === 'camera' ? 'Camera' : 'Microphone'} switched`, 'check')
    } catch { toast('Could not switch device', 'info') }
  }

  const cycleCamera = async () => {
    try {
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput')
      if (cameras.length < 2) return toast('No second camera was found', 'info')
      const current = localStream.current?.getVideoTracks()[0]?.getSettings()?.deviceId
      const index = Math.max(0, cameras.findIndex((device) => device.deviceId === current))
      await switchDevice('camera', cameras[(index + 1) % cameras.length].deviceId)
      setMobileMore(false)
    } catch { toast('Could not switch camera', 'info') }
  }

  const react = (emoji) => {
    setReactPicker(false)
    addFlyer(emoji)
    rt.send({ type: 'room-event', roomId, event: { type: 'reaction', emoji } })
  }

  const toggleHand = () => setHandUp((v) => {
    const next = !v
    publishState({ hand: next })
    toast(next ? '✋ Hand raised' : 'Hand lowered', 'info')
    return next
  })

  /* ---------------- recording ---------------- */
  const toggleRecord = () => {
    if (recording) { try { recorder.current?.stop() } catch {}; return }
    const videoTrack = screenStream.current?.getVideoTracks()[0] || localStream.current?.getVideoTracks()[0]
    if (!videoTrack && !localStream.current?.getAudioTracks().length) return toast('Nothing to record', 'info')

    const mix = ensureMixer()
    const composite = new MediaStream()
    if (videoTrack) composite.addTrack(videoTrack)
    if (mix) {
      // Mic + everyone else + shared tab audio, mixed into one track.
      if (localStream.current) mixInto('self', localStream.current)
      if (screenStream.current) mixInto('screen', screenStream.current)
      Object.entries(remotePeers).forEach(([pid, p]) => p.stream && mixInto(pid, p.stream))
      mix.dest.stream.getAudioTracks().forEach((t) => composite.addTrack(t))
    } else {
      localStream.current?.getAudioTracks().forEach((t) => composite.addTrack(t))
    }

    try {
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm'
      const mr = new MediaRecorder(composite, { mimeType: mime, videoBitsPerSecond: 2_500_000 })
      recChunks.current = []
      recStartedAt.current = Date.now()
      mr.ondataavailable = (e) => { if (e.data.size) recChunks.current.push(e.data) }
      mr.onstop = async () => {
        setRecording(false)
        const blob = new Blob(recChunks.current, { type: 'video/webm' })
        recChunks.current = []
        if (!blob.size) return toast('Recording was empty', 'info')
        const secs = Math.max(1, Math.round((Date.now() - recStartedAt.current) / 1000))
        const duration = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
        setSaving(0.01)
        try {
          const saved = await uploadMedia(blob, {
            kind: 'recording',
            title: `Meeting recording · ${new Date().toLocaleString()}`,
            duration,
            thumb: 'from-blue-500 to-indigo-600',
            onProgress: setSaving,
          })
          if (aiNotesRef.current) {
            try {
              await api.generateAiNotes(saved.id)
              toast('Recording saved — AI notes are being prepared', 'check')
            } catch (error) {
              toast(error.message || 'Recording saved, but AI notes could not start', 'info')
            }
          } else toast('Recording saved to your library', 'check')
        } catch (e) {
          toast(e.message || 'Could not save the recording', 'info')
        } finally {
          aiNotesRef.current = false
          setAiTakingNotes(false)
          setSaving(0)
        }
      }
      mr.start(1000)
      recorder.current = mr
      setRecording(true)
      toast('Recording started', 'video')
    } catch { toast('Recording is not supported in this browser', 'info') }
  }

  const toggleAiNotes = async () => {
    if (aiTakingNotes) {
      if (recording) toggleRecord()
      else { aiNotesRef.current = false; setAiTakingNotes(false) }
      return
    }
    try {
      const status = await api.aiStatus()
      if (!status.available) return toast('AI Notes needs AI_TRANSCRIPTION_URL in Dokploy', 'info')
      aiNotesRef.current = true
      setAiTakingNotes(true)
      if (!recording) toggleRecord()
      toast('AI note taker started — everyone’s audio will be transcribed', 'video')
    } catch (error) { toast(error.message || 'Could not start AI notes', 'info') }
  }

  /* A guest link lets someone without an account into this room only. Members
     mint it on demand; guests can't invite further. */
  const copyGuestLink = async () => {
    if (guestLink) {
      navigator.clipboard?.writeText(guestLink)
      return toast('Guest link copied')
    }
    setGuestLinkBusy(true)
    try {
      const full = await createGuestInviteLink(roomId)
      setGuestLink(full)
      navigator.clipboard?.writeText(full)
      toast('Guest link copied — anyone with it can join')
    } catch (e) {
      toast(e.message || 'Could not create a guest link', 'info')
    } finally { setGuestLinkBusy(false) }
  }

  const sendChat = () => { if (text.trim()) { rt.send({ type: 'chat', channelId: `room:${roomId}`, text: text.trim() }); setText('') } }
  const leave = () => (onLeave ? onLeave() : navigate('/'))

  // Auto-start screen share when opened via the "Share Screen" action.
  const autoSharedRef = useRef(false)
  useEffect(() => {
    const wants = new URLSearchParams(window.location.search).get('share') === '1'
    if (wants && !autoSharedRef.current) {
      autoSharedRef.current = true
      const t = setTimeout(() => { if (!sharing) toggleShare() }, 700)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remoteList = Object.entries(remotePeers)
  const count = 1 + remoteList.length
  const alone = remoteList.length === 0
  const selfMirrored = mirror && !sharing
  const showSelfVideo = (cam && hasCamera) || sharing

  return (
    <div className="h-[100dvh] min-h-[100svh] w-screen bg-[#080B10] text-white flex flex-col overflow-hidden">
      <div className="h-12 sm:h-14 shrink-0 px-3 sm:px-5 flex items-center justify-between bg-[#0B0E14]/95 border-b border-white/5">
        <div className="flex items-center gap-3">
          {recording
            ? <span className="flex items-center gap-1.5 text-red-400 text-sm font-medium animate-pulse"><Circle className="w-2.5 h-2.5 fill-red-500 text-red-500" /> {aiTakingNotes ? 'AI NOTES' : 'REC'}</span>
            : <span className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium"><Circle className="w-2.5 h-2.5 fill-emerald-500 text-emerald-500" /> LIVE</span>}
          <span className="hidden sm:inline text-sm text-white/60">·</span>
          <span className="hidden sm:inline text-sm text-white/80 font-medium tabular-nums">{mmss}</span>
          {saving > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-white/70 ml-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving {Math.round(saving * 100)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-white/70">
          <ShieldCheck className="w-4 h-4 text-emerald-400" /><span className="hidden sm:inline">Meeting ID: </span><span className="max-w-[120px] truncate">{meetingId}</span>
          {!isGuest && <button title="Copy guest invite — no account required" className="ml-1 p-1 rounded hover:bg-white/10" onClick={copyGuestLink}><Copy className="w-3.5 h-3.5" /></button>}
        </div>
        <div className="text-xs sm:text-sm text-white/60">{count} <span className="hidden sm:inline">{count === 1 ? 'participant' : 'participants'}</span></div>
      </div>

      {mediaError && (
        <div className="shrink-0 bg-amber-500/15 border-b border-amber-400/20 px-5 py-2 flex items-center gap-2 text-sm text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {mediaError}
        </div>
      )}
      {relayWarning && (
        <div className="shrink-0 bg-red-500/15 border-b border-red-400/20 px-5 py-2 flex items-center gap-2 text-sm text-red-200">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {relayWarning}
        </div>
      )}

      <div className="relative flex-1 flex min-h-0 pb-[76px] sm:pb-0">
        <div className="flex-1 p-0 sm:p-4 min-w-0 flex flex-col relative">
          {flyers.map((f) => (
            <span key={f.id} className="reaction-flyer" style={{ left: `${f.left}%` }}>{f.emoji}</span>
          ))}
          <div className={`relative flex-1 grid gap-1 sm:gap-3 min-h-0 ${alone ? 'grid-cols-1' : count <= 4 ? 'grid-cols-1 sm:grid-cols-2 auto-rows-fr' : 'grid-cols-2 md:grid-cols-3 auto-rows-fr'}`}>
            <div className={`overflow-hidden bg-[#171B22] grid place-items-center ring-1 ${mic ? 'ring-brand-blue/70' : 'ring-white/10'} ${count === 2 ? 'absolute z-10 top-3 right-3 h-[28%] min-h-[132px] w-[34%] rounded-2xl shadow-2xl sm:relative sm:top-auto sm:right-auto sm:h-auto sm:min-h-0 sm:w-auto sm:rounded-2xl sm:shadow-none' : 'relative min-h-0 rounded-none sm:rounded-2xl'}`}>
              <video ref={localVideoRef} autoPlay muted playsInline className={`w-full h-full bg-black ${count === 2 ? 'object-cover sm:object-contain' : fitVideo ? 'object-contain' : 'object-cover'} ${showSelfVideo ? '' : 'hidden'} ${selfMirrored ? '-scale-x-100' : ''}`} />
              {!showSelfVideo && <img src={currentUser?.avatar} alt="You" className="w-24 h-24 rounded-full object-cover opacity-90" />}
              {handUp && <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-amber-400 text-black grid place-items-center text-lg">✋</div>}
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/50 backdrop-blur text-xs">
                {mic ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5 text-red-400" />}
                <span className="font-medium">You{sharing ? ' · sharing' : ''}</span>
              </div>
            </div>
            {remoteList.map(([peerId, p], index) => <RemoteTile key={peerId} peer={p} featured={count === 2 && index === 0} />)}
          </div>

          {alone && (
            <div className="mt-2 sm:mt-3 shrink-0 rounded-2xl bg-white/5 border border-white/10 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-sm">Waiting for others to join…</p>
                <p className="text-white/50 text-xs mt-0.5 truncate">
                  {isGuest ? 'The host can invite more people with a secure guest link.'
                           : 'Copy a secure link that lets anyone join without creating an account.'}
                </p>
              </div>
              {!isGuest && <div className="flex w-full sm:w-auto items-center gap-2 shrink-0">
                <div className="hidden md:flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-white/70 max-w-[260px]"><Link2 className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{guestLink || 'Secure guest invite'}</span></div>
                <button onClick={copyGuestLink} disabled={guestLinkBusy} className="h-9 w-full sm:w-auto justify-center px-3 rounded-lg bg-brand-blue hover:bg-brand-bluehover text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60">
                  {guestLinkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Copy guest invite
                </button>
              </div>}
            </div>
          )}
        </div>

        {panel && (
          <div className="absolute inset-0 z-20 w-full shrink-0 bg-[#14181F] border-l border-white/5 flex flex-col animate-fade sm:static sm:w-[340px]">
            <div className="h-12 px-4 flex items-center justify-between border-b border-white/5">
              <p className="font-semibold">{panel === 'chat' ? 'Chat' : `Participants (${count})`}</p>
              <button onClick={() => setPanel(null)} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
            </div>
            {panel === 'chat' && (
              <>
                <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  {msgs.length === 0 && <p className="text-white/40 text-sm text-center py-6">Messages here reach everyone in the call.</p>}
                  {msgs.map((m) => (
                    <div key={m.id} className="flex gap-2.5">
                      <img src={m.avatar || fallbackAvatar(m.userId || m.author)} className="w-7 h-7 rounded-full shrink-0" alt="" />
                      <div className="min-w-0">
                        <p className="text-xs text-white/50 mb-0.5">{m.me ? 'You' : m.author} · {messageTime(m.ts)}</p>
                        <p className="text-sm bg-white/5 rounded-lg px-3 py-2 inline-block break-words">{m.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-white/5 flex items-center gap-2">
                  <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChat()} placeholder="Type a message" className="flex-1 h-10 rounded-lg bg-white/5 px-3 text-sm outline-none focus:bg-white/10 placeholder:text-white/40" />
                  <button onClick={sendChat} disabled={!text.trim()} className="w-10 h-10 grid place-items-center rounded-lg bg-brand-blue hover:bg-brand-bluehover disabled:opacity-40"><Send className="w-4 h-4" /></button>
                </div>
              </>
            )}
            {panel === 'people' && (
              <div className="flex-1 overflow-y-auto p-2">
                <PersonRow name={isGuest ? 'You (Guest)' : isHost ? 'You (Host)' : 'You'} url={currentUser?.avatar} mic={mic} cam={cam && hasCamera} hand={handUp} sharing={sharing} />
                {remoteList.map(([peerId, p]) => (
                  <PersonRow key={peerId} name={p.name || 'Guest'} url={p.avatar} mic={p.mic !== false} cam={p.cam !== false} hand={p.hand} sharing={p.sharing}
                    canModerate={isHost}
                    onMute={() => rt.send({ type: 'moderate', roomId, target: peerId, action: 'mute' })}
                    onRemove={() => rt.send({ type: 'moderate', roomId, target: peerId, action: 'remove' })} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {mobileMore && (
        <div className="fixed inset-x-3 bottom-[calc(78px+env(safe-area-inset-bottom))] z-50 rounded-3xl border border-white/10 bg-[#171B22]/95 p-3 shadow-2xl backdrop-blur-xl sm:hidden">
          <div className="mb-2 flex items-center justify-between px-1"><p className="text-sm font-bold">Meeting tools</p><button onClick={() => setMobileMore(false)} className="grid h-8 w-8 place-items-center rounded-full bg-white/10"><X className="h-4 w-4" /></button></div>
          <div className="grid grid-cols-3 gap-2">
            <SheetAction icon={MessageSquare} label="Chat" active={panel === 'chat'} onClick={() => { setPanel('chat'); setMobileMore(false) }} />
            <SheetAction icon={Hand} label={handUp ? 'Lower hand' : 'Raise hand'} active={handUp} onClick={() => { toggleHand(); setMobileMore(false) }} />
            <SheetAction icon={SwitchCamera} label="Flip camera" onClick={cycleCamera} />
            {!isGuest && <SheetAction icon={recording ? Square : Disc} label={recording ? 'Stop record' : 'Record'} active={recording} onClick={() => { toggleRecord(); setMobileMore(false) }} />}
            {!isGuest && <SheetAction icon={Sparkles} label={aiTakingNotes ? 'Stop AI' : 'AI Notes'} active={aiTakingNotes} onClick={() => { toggleAiNotes(); setMobileMore(false) }} />}
            {!isGuest && <SheetAction icon={UserPlus} label="Invite" onClick={() => { copyGuestLink(); setMobileMore(false) }} />}
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 min-h-[calc(72px+env(safe-area-inset-bottom))] shrink-0 border-t border-white/10 bg-[#0B0E14]/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl flex items-center justify-around gap-0 sm:static sm:min-h-[76px] sm:justify-center sm:gap-2 sm:px-5 sm:pb-0">
        <Ctrl active={mic} onClick={toggleMic} disabled={!mediaReady} on={{ icon: Mic, label: 'Mute' }} off={{ icon: MicOff, label: 'Unmute' }} danger={!mic} />
        <Ctrl active={cam} onClick={toggleCam} disabled={!mediaReady || !hasCamera} on={{ icon: VideoIcon, label: 'Stop Video' }} off={{ icon: VideoOff, label: 'Start Video' }} danger={!cam} />
        <div className="relative hidden sm:block">
          <CtrlBtn icon={Settings2} label="Devices" active={deviceMenu} onClick={() => { refreshDevices(); setDeviceMenu((v) => !v) }} />
          {deviceMenu && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-64 bg-[#1B2029] border border-white/10 rounded-xl p-2 shadow-xl animate-pop text-left">
              <DeviceGroup label="Camera" items={devices.cameras} selected={chosen.camera} onPick={(d) => switchDevice('camera', d)} />
              <DeviceGroup label="Microphone" items={devices.mics} selected={chosen.mic} onPick={(d) => switchDevice('mic', d)} />
              <div className="mt-1 border-t border-white/10 pt-1">
                <button onClick={() => setFitVideo((value) => !value)} className="w-full rounded-lg px-2 py-2 text-left text-xs text-white/80 hover:bg-white/10">
                  Camera framing: <span className="font-semibold text-white">{fitVideo ? 'Fit full frame' : 'Fill tile'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <CtrlBtn icon={sharing ? MonitorUp : ScreenShare} label={sharing ? 'Stop Share' : 'Share'} active={sharing} onClick={toggleShare} disabled={!mediaReady} />
        <CtrlBtn icon={Users} label="Participants" active={panel === 'people'} onClick={() => setPanel((p) => (p === 'people' ? null : 'people'))} />
        <div className="hidden sm:contents"><CtrlBtn icon={MessageSquare} label="Chat" active={panel === 'chat'} onClick={() => setPanel((p) => (p === 'chat' ? null : 'chat'))} /></div>
        <div className="hidden sm:contents"><CtrlBtn icon={Hand} label="Raise Hand" active={handUp} onClick={toggleHand} /></div>
        <div className="relative hidden sm:block">
          <CtrlBtn icon={Smile} label="React" active={reactPicker} onClick={() => setReactPicker((v) => !v)} />
          {reactPicker && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-[#1B2029] border border-white/10 rounded-2xl px-2 py-2 flex gap-1 shadow-xl animate-pop">
              {EMOJIS.map((e) => <button key={e} onClick={() => react(e)} className="w-9 h-9 grid place-items-center rounded-lg hover:bg-white/10 text-xl">{e}</button>)}
            </div>
          )}
        </div>
        {!isGuest && <div className="hidden sm:contents">
          <CtrlBtn
            icon={Sparkles}
            label={aiTakingNotes ? 'Stop AI' : 'AI Notes'}
            active={aiTakingNotes}
            onClick={toggleAiNotes}
            disabled={!mediaReady || saving > 0}
            title="Record, transcribe, and summarize this meeting"
          />
        </div>}
        {!isGuest && <div className="hidden sm:contents">
          <CtrlBtn
            icon={recording ? Square : Disc}
            label={recording ? 'Stop Rec' : mediaReady ? 'Record' : 'Preparing…'}
            active={recording}
            onClick={toggleRecord}
            disabled={!mediaReady || saving > 0}
            title={mediaReady ? 'Record this meeting' : 'Waiting for your camera and microphone'}
          />
        </div>}
        {!isGuest && <div className="hidden sm:contents">
          <CtrlBtn
            icon={UserPlus}
            label="Invite"
            onClick={copyGuestLink}
            disabled={guestLinkBusy}
            title="Copy a link that lets anyone join as a guest"
          />
        </div>}
        <div className="sm:hidden"><CtrlBtn icon={MoreHorizontal} label="More" active={mobileMore} onClick={() => setMobileMore((open) => !open)} /></div>
        <button onClick={leave} aria-label="Leave meeting" className="grid h-11 w-11 place-items-center rounded-full bg-red-500 transition hover:bg-red-600 sm:ml-3 sm:flex sm:w-auto sm:px-5 sm:rounded-xl sm:font-semibold sm:gap-2"><PhoneOff className="w-4.5 h-4.5" /><span className="hidden sm:inline">Leave</span></button>
      </div>
    </div>
  )
}

function DeviceGroup({ label, items, selected, onPick }) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-white/40 font-semibold">{label}</p>
      {items.length === 0 && <p className="px-2 py-1.5 text-xs text-white/40">None detected</p>}
      {items.map((d, i) => (
        <button key={d.deviceId || i} onClick={() => onPick(d.deviceId)} className={`w-full truncate rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/10 ${selected === d.deviceId ? 'text-brand-blue font-semibold' : 'text-white/80'}`}>
          {d.label || `${label} ${i + 1}`}
        </button>
      ))}
    </div>
  )
}

function RemoteTile({ peer, featured = false }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current && peer.stream) ref.current.srcObject = peer.stream }, [peer.stream])
  const connecting = peer.stream && peer.connection && !['connected', 'completed'].includes(peer.connection)
  return (
    <div className={`relative overflow-hidden bg-[#11151B] grid place-items-center min-h-0 ring-1 ring-emerald-400/30 ${featured ? 'rounded-none sm:rounded-2xl' : 'rounded-none sm:rounded-2xl'}`}>
      {peer.stream
        ? <video ref={ref} autoPlay playsInline className={`w-full h-full bg-black ${featured ? 'object-cover sm:object-contain' : 'object-contain'} ${peer.cam === false && !peer.sharing ? 'hidden' : ''}`} />
        : null}
      {(!peer.stream || (peer.cam === false && !peer.sharing)) && (
        <img src={peer.avatar || fallbackAvatar(peer.name)} alt={peer.name} className="w-20 h-20 rounded-full object-cover opacity-90" />
      )}
      {connecting && <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/70"><Loader2 className="h-3 w-3 animate-spin" /> connecting</span>}
      {peer.hand && <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-amber-400 text-black grid place-items-center text-lg">✋</div>}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/50 backdrop-blur text-xs">
        {peer.mic === false ? <MicOff className="w-3.5 h-3.5 text-red-400" /> : <Mic className="w-3.5 h-3.5" />}
        <span className="font-medium">{peer.name || 'Guest'}{peer.sharing ? ' · sharing' : ''}</span>
      </div>
    </div>
  )
}

function PersonRow({ name, url, mic, cam, hand, sharing, canModerate, onMute, onRemove }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5">
      {url ? <img src={url} className="w-8 h-8 rounded-full" alt="" /> : <div className="w-8 h-8 rounded-full bg-white/10" />}
      <span className="flex-1 text-sm truncate">{name}{sharing ? ' · sharing' : ''}</span>
      {hand && <span className="text-sm">✋</span>}
      {mic ? <Mic className="w-4 h-4 text-white/60" /> : <MicOff className="w-4 h-4 text-red-400" />}
      {cam ? <VideoIcon className="w-4 h-4 text-white/60" /> : <VideoOff className="w-4 h-4 text-red-400" />}
      {canModerate && <>
        <button onClick={onMute} title="Mute participant" className="grid h-7 w-7 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"><MicOff className="h-3.5 w-3.5" /></button>
        <button onClick={onRemove} title="Remove participant" className="grid h-7 w-7 place-items-center rounded-md text-red-400 hover:bg-red-500/15"><UserMinus className="h-3.5 w-3.5" /></button>
      </>}
    </div>
  )
}

function Ctrl({ active, onClick, on, off, danger, disabled }) {
  const info = active ? on : off; const Icon = info.icon
  return (
    <button onClick={onClick} disabled={disabled} className="flex min-w-[48px] flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent sm:min-w-[62px] sm:px-3">
      <Icon className={`w-5 h-5 ${danger ? 'text-red-400' : 'text-white'}`} />
      <span className="text-[11px] text-white/70">{info.label}</span>
    </button>
  )
}

function CtrlBtn({ icon: Icon, label, onClick, active, disabled, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label} className={`flex min-w-[48px] flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[62px] sm:px-3 ${active ? 'bg-white/15' : 'hover:bg-white/10 disabled:hover:bg-transparent'}`}>
      <Icon className="w-5 h-5 text-white" />
      <span className="text-[11px] text-white/70">{label}</span>
    </button>
  )
}

function SheetAction({ icon: Icon, label, onClick, active = false }) {
  return (
    <button onClick={onClick} className={`flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center text-[11px] font-semibold transition active:scale-[.98] ${active ? 'bg-brand-blue text-white' : 'bg-white/[.07] text-white/80'}`}>
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </button>
  )
}
