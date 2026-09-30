import { createContext, useContext, useReducer, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from './api.js'
import { rt } from './realtime.js'
import { useAuth } from './auth.jsx'
import { decorateMeeting, newMeetingId } from './dates.js'

// Exported so guest mode can provide a compatible value to the same consumers.
export const AppContext = createContext(null)
const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10))

/* Slices that live in the per-user state document. Everything else — contacts,
   whiteboards, recordings, clips, channels, meetings — is owned by the server and
   must never be written back, or a stale snapshot shadows the live data. */
const STATE_SLICES = ['docs', 'notes', 'notifications', 'settings']

const defaultSettings = {
  hd: true, mirror: true, touchup: false, autoJoin: true,
  suppressNoise: true, joinSound: false, desktopNotif: true, notifSound: false,
  waitingRoom: true, theme: 'Light',
}

const emptyState = {
  user: null,
  meetings: [],
  channels: [],
  messages: {},
  contacts: [],
  whiteboards: [],
  docs: [],
  clips: [],
  notes: [],
  recordings: [],
  notifications: [],
  settings: defaultSettings,
  storage: { used: 0, quota: 10 * 1024 * 1024 * 1024 },
  online: [],
  activeChannel: null,
  chatFocused: false,
  hydrated: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload, hydrated: true }
    case 'SET_ONLINE':
      return { ...state, online: action.online }
    case 'SET_STORAGE':
      return { ...state, storage: { ...state.storage, ...action.storage } }

    /* ---------------- Meetings ---------------- */
    case 'ADD_MEETING':
      return {
        ...state,
        meetings: [action.meeting, ...state.meetings],
        notifications: [
          { id: uid(), text: `"${action.meeting.title}" is scheduled`, ts: Date.now(), read: false, icon: 'video' },
          ...state.notifications,
        ],
      }
    case 'UPDATE_MEETING':
      return { ...state, meetings: state.meetings.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)) }
    case 'DELETE_MEETING':
      return { ...state, meetings: state.meetings.filter((m) => m.id !== action.id) }

    /* ---------------- Chat ---------------- */
    case 'SET_ACTIVE_CHANNEL':
      return {
        ...state,
        activeChannel: action.id,
        channels: state.channels.map((c) => (c.id === action.id ? { ...c, unread: 0 } : c)),
      }
    // Whether the Team Chat screen is actually on-screen. Without this, leaving
    // the page with a channel selected would keep swallowing its unread count.
    case 'SET_CHAT_FOCUS':
      return { ...state, chatFocused: action.focused }
    case 'SET_MESSAGES':
      return { ...state, messages: { ...state.messages, [action.channelId]: action.messages } }
    case 'ADD_MESSAGE': {
      const { channelId, message } = action
      const thread = state.messages[channelId] || []
      if (thread.some((m) => m.id === message.id)) return state // dedup: WS echo + history refetch
      const mine = message.userId && message.userId === state.user?.id
      // Anything arriving for a channel you are not currently reading counts as unread.
      const isReading = state.chatFocused && state.activeChannel === channelId && document.visibilityState === 'visible'
      return {
        ...state,
        messages: { ...state.messages, [channelId]: [...thread, { ...message, me: mine }] },
        channels: state.channels.map((c) => (c.id !== channelId ? c : {
          ...c,
          last: `${message.author.split(' ')[0]}: ${message.text}`,
          ts: message.ts,
          unread: mine || isReading ? 0 : (c.unread || 0) + 1,
        })),
      }
    }
    case 'UPSERT_CHANNEL': {
      const exists = state.channels.some((c) => c.id === action.channel.id)
      return exists
        ? { ...state, channels: state.channels.map((c) => (c.id === action.channel.id ? { ...c, ...action.channel } : c)) }
        : { ...state, channels: [action.channel, ...state.channels] }
    }

    /* ---------------- Generic collections ---------------- */
    case 'SET_LIST':
      return { ...state, [action.key]: action.items }
    case 'ADD_ITEM':
      return { ...state, [action.key]: [action.item, ...state[action.key]] }
    case 'UPDATE_ITEM':
      return { ...state, [action.key]: state[action.key].map((it) => (it.id === action.id ? { ...it, ...action.patch } : it)) }
    case 'DELETE_ITEM':
      return { ...state, [action.key]: state[action.key].filter((it) => it.id !== action.id) }

    case 'UPDATE_USER':
      return { ...state, user: { ...state.user, ...action.payload } }
    case 'SET_SETTING':
      return { ...state, settings: { ...state.settings, [action.key]: action.value } }

    case 'MARK_NOTIF_READ':
      return { ...state, notifications: state.notifications.map((n) => (n.id === action.id ? { ...n, read: true } : n)) }
    case 'MARK_ALL_NOTIF':
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) }
    case 'ADD_NOTIF':
      return { ...state, notifications: [action.payload, ...state.notifications].slice(0, 100) }
    case 'CLEAR_NOTIFS':
      return { ...state, notifications: [] }

    default:
      return state
  }
}

export function AppProvider({ children }) {
  const { logout, setUser } = useAuth()
  const [state, dispatch] = useReducer(reducer, emptyState)
  const [toasts, setToasts] = useState([])
  const [modal, setModal] = useState(null)
  const [bootError, setBootError] = useState('')
  const syncTimer = useRef(null)
  // Actions read the latest state through this ref, which keeps `actions`
  // referentially stable. Depending on the collections directly made every
  // action a fresh function on each change — and any effect keyed on one of
  // them (e.g. refreshBoards) would loop forever.
  const stateRef = useRef(state)
  stateRef.current = state

  const toast = useCallback((message, icon = 'check') => {
    const id = uid()
    setToasts((t) => [...t, { id, message, icon }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  const openModal = useCallback((type, data = null) => setModal({ type, data }), [])
  const closeModal = useCallback(() => setModal(null), [])

  /* ---- hydrate from the API on mount ---- */
  const hydrate = useCallback(async () => {
    setBootError('')
    try {
      const data = await api.bootstrap()
      dispatch({
        type: 'HYDRATE',
        payload: {
          user: data.user,
          meetings: data.meetings || [],
          channels: data.channels || [],
          contacts: data.contacts || [],
          whiteboards: data.whiteboards || [],
          docs: data.docs || [],
          clips: data.clips || [],
          notes: data.notes || [],
          recordings: data.recordings || [],
          notifications: data.notifications || [],
          settings: { ...defaultSettings, ...(data.settings || {}) },
          storage: data.storage || emptyState.storage,
        },
      })
    } catch (err) {
      // Only a genuine auth failure should sign the user out. A network blip or a
      // 500 must not destroy their session — show a retry instead.
      if (err.status === 401) logout()
      else setBootError(err.message || 'Could not reach the server')
    }
  }, [logout])

  useEffect(() => { hydrate() }, [hydrate])

  /* ---- live WebSocket subscriptions ---- */
  useEffect(() => {
    const offs = [
      rt.on('chat', (m) => dispatch({ type: 'ADD_MESSAGE', channelId: m.channelId, message: m.message })),
      rt.on('presence', (m) => dispatch({ type: 'SET_ONLINE', online: m.online || [] })),
      rt.on('notification', (m) => dispatch({ type: 'ADD_NOTIF', payload: m.note })),
      // A new teammate signing in means the directory changed — refresh it.
      rt.on('directory', () => api.users().then((items) => dispatch({ type: 'SET_LIST', key: 'contacts', items })).catch(() => {})),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  /* ---- keep the contact directory fresh when presence changes ---- */
  const knownIds = state.contacts.map((c) => c.id).join(',')
  useEffect(() => {
    if (!state.hydrated) return
    const unknown = state.online.some((id) => id !== state.user?.id && !knownIds.split(',').includes(id))
    if (unknown) api.users().then((items) => dispatch({ type: 'SET_LIST', key: 'contacts', items })).catch(() => {})
  }, [state.online, state.hydrated, knownIds, state.user?.id])

  /* ---- apply theme ---- */
  useEffect(() => {
    const t = state.settings?.theme
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = t === 'Dark' || (t === 'System' && mq?.matches)
      document.documentElement.classList.toggle('dark', !!dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    if (t === 'System' && mq) { mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply) }
  }, [state.settings?.theme])

  /* ---- debounced sync of personal-state slices to the server ---- */
  const sliceDeps = STATE_SLICES.map((k) => state[k])
  useEffect(() => {
    if (!state.hydrated) return
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      const patch = {}
      for (const k of STATE_SLICES) patch[k] = state[k]
      api.patchState(patch).catch(() => {})
    }, 600)
    return () => clearTimeout(syncTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated, ...sliceDeps])

  /* ---- desktop notifications, when the user has opted in ---- */
  useEffect(() => {
    if (state.settings?.desktopNotif && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [state.settings?.desktopNotif])

  /* ---- action creators ---- */
  const actions = useMemo(() => ({
    /* Meetings — every meeting gets its OWN id, so each opens its own room. */
    scheduleMeeting: async ({ title, dateISO, time, durationMins = 60, recurring = false }) => {
      const meeting = {
        id: uid(),
        title: (title || '').trim() || 'My Meeting',
        meetingId: newMeetingId(),
        startTime: time,
        dateKey: dateISO,
        durationMins: Number(durationMins) || 60,
        host: stateRef.current.user?.name,
        hostId: stateRef.current.user?.id,
        participants: [],
        recurring: !!recurring,
        recorded: false,
        createdAt: Date.now(),
      }
      dispatch({ type: 'ADD_MEETING', meeting })
      try {
        await api.saveMeeting(meeting)
      } catch (e) {
        dispatch({ type: 'DELETE_MEETING', id: meeting.id })
        toast(e.message || 'Could not save the meeting', 'info')
        throw e
      }
      return meeting
    },
    updateMeeting: async (id, patch) => {
      const current = stateRef.current.meetings.find((m) => m.id === id)
      if (!current) return
      dispatch({ type: 'UPDATE_MEETING', id, patch })
      try { await api.saveMeeting({ ...current, ...patch }) } catch { dispatch({ type: 'UPDATE_MEETING', id, patch: current }) }
    },
    deleteMeeting: async (id) => {
      const current = stateRef.current.meetings.find((m) => m.id === id)
      dispatch({ type: 'DELETE_MEETING', id })
      try { await api.deleteMeeting(id) } catch { if (current) dispatch({ type: 'ADD_MEETING', meeting: current }) }
    },

    /* Chat */
    loadChannelMessages: async (channelId) => {
      try {
        const msgs = await api.messages(channelId)
        dispatch({
          type: 'SET_MESSAGES',
          channelId,
          messages: msgs.map((m) => ({ ...m, me: m.userId && m.userId === stateRef.current.user?.id })),
        })
      } catch {}
    },
    sendMessage: (channelId, text) => rt.send({ type: 'chat', channelId, text }),
    openChannel: (id) => dispatch({ type: 'SET_ACTIVE_CHANNEL', id }),
    setChatFocus: (focused) => dispatch({ type: 'SET_CHAT_FOCUS', focused }),
    createChannel: async (name) => {
      const channel = await api.createChannel(name)
      dispatch({ type: 'UPSERT_CHANNEL', channel })
      return channel
    },
    openDM: async (userId) => {
      const channel = await api.openDM(userId)
      dispatch({ type: 'UPSERT_CHANNEL', channel })
      return channel
    },

    /* Whiteboards — shared org-wide so two people can open the same board. */
    createBoard: async (title, color) => {
      const board = await api.createBoard(title, color)
      dispatch({ type: 'ADD_ITEM', key: 'whiteboards', item: board })
      return board
    },
    saveBoard: async (id, patch) => {
      dispatch({ type: 'UPDATE_ITEM', key: 'whiteboards', id, patch })
      return api.saveBoard(id, patch)
    },
    deleteBoard: async (id) => {
      const current = stateRef.current.whiteboards.find((w) => w.id === id)
      dispatch({ type: 'DELETE_ITEM', key: 'whiteboards', id })
      try { await api.deleteBoard(id) } catch (e) { if (current) dispatch({ type: 'ADD_ITEM', key: 'whiteboards', item: current }); toast(e.message, 'info') }
    },
    refreshBoards: async () => {
      try { dispatch({ type: 'SET_LIST', key: 'whiteboards', items: await api.boards() }) } catch {}
    },

    /* Recordings & clips — real files, stored server-side. */
    uploadMedia: async (blob, meta) => {
      const saved = await api.uploadMedia(blob, meta)
      const { storage, ...item } = saved
      dispatch({ type: 'ADD_ITEM', key: meta.kind === 'clip' ? 'clips' : 'recordings', item })
      if (storage) dispatch({ type: 'SET_STORAGE', storage })
      return item
    },
    updateMedia: async (key, id, patch) => {
      dispatch({ type: 'UPDATE_ITEM', key, id, patch })
      try { await api.updateMedia(id, patch) } catch {}
    },
    refreshMedia: async () => {
      try {
        const data = await api.media()
        dispatch({ type: 'SET_LIST', key: 'recordings', items: (data.items || []).filter((m) => m.kind === 'recording') })
        dispatch({ type: 'SET_LIST', key: 'clips', items: (data.items || []).filter((m) => m.kind === 'clip') })
        if (data.storage) dispatch({ type: 'SET_STORAGE', storage: data.storage })
      } catch {}
    },
    deleteMedia: async (key, id) => {
      const current = stateRef.current[key].find((m) => m.id === id)
      dispatch({ type: 'DELETE_ITEM', key, id })
      try {
        const { storage } = await api.deleteMedia(id)
        if (storage) dispatch({ type: 'SET_STORAGE', storage })
      } catch { if (current) dispatch({ type: 'ADD_ITEM', key, item: current }) }
    },

    /* Personal collections (docs, notes) stay client-owned + debounce-synced. */
    addItem: (key, item) => dispatch({ type: 'ADD_ITEM', key, item }),
    updateItem: (key, id, patch) => dispatch({ type: 'UPDATE_ITEM', key, id, patch }),
    deleteItem: (key, id) => dispatch({ type: 'DELETE_ITEM', key, id }),

    /* Profile — persisted, not just local. */
    saveProfile: async (patch) => {
      const { user } = await api.updateProfile(patch)
      dispatch({ type: 'UPDATE_USER', payload: user })
      setUser(user)
      return user
    },
    saveAvatar: async (blob, onProgress) => {
      const { user } = await api.uploadAvatar(blob, onProgress)
      dispatch({ type: 'UPDATE_USER', payload: user })
      setUser(user)
      return user
    },
    removeAvatar: async () => {
      const { user } = await api.removeAvatar()
      dispatch({ type: 'UPDATE_USER', payload: user })
      setUser(user)
      return user
    },
    setSetting: (key, value) => dispatch({ type: 'SET_SETTING', key, value }),

    markNotifRead: (id) => dispatch({ type: 'MARK_NOTIF_READ', id }),
    markAllNotif: () => dispatch({ type: 'MARK_ALL_NOTIF' }),
    clearNotifs: () => dispatch({ type: 'CLEAR_NOTIFS' }),
    addNotif: (payload) => dispatch({ type: 'ADD_NOTIF', payload: { id: uid(), ts: Date.now(), read: false, icon: 'video', ...payload } }),
    logout,
  }), [logout, setUser, toast])

  /* Meetings are stored raw and decorated here, so "Today"/"Previous" stay correct
     as time passes instead of being frozen at the moment they were created. */
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t) }, [])
  const meetings = useMemo(
    () => state.meetings.map((m) => decorateMeeting(m)).sort((a, b) => a.startsAt - b.startsAt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.meetings, tick]
  )

  const value = { state: { ...state, meetings }, ...actions, toasts, toast, modal, openModal, closeModal, uid }

  if (bootError) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#F5F7FB] dark:bg-[#0B0E14] px-6">
        <div className="max-w-sm text-center">
          <p className="text-lg font-bold text-ink-900">We couldn't load your workspace</p>
          <p className="mt-2 text-sm text-ink-500">{bootError}</p>
          <button onClick={hydrate} className="btn-primary mt-5">Try again</button>
        </div>
      </div>
    )
  }

  return (
    <AppContext.Provider value={value}>
      {state.hydrated ? children : (
        <div className="min-h-screen grid place-items-center bg-[#F5F7FB] dark:bg-[#0B0E14]">
          <Loader2 className="w-8 h-8 text-brand-blue animate-spin" />
        </div>
      )}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)
