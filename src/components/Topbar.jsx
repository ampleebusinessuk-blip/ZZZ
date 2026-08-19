import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, HelpCircle, Bell, CalendarPlus, ChevronDown, Video, MessageSquare,
  Users, FileText, PenTool, PlayCircle, StickyNote, LogOut, Settings as Cog, User, Shield,
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { relativeTime, toRoomId, newRoomId } from '../dates.js'
import Logo from './Logo.jsx'

const iconFor = { video: Video, chat: MessageSquare, rec: PlayCircle }

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ref, onClose])
}

export default function Topbar() {
  const { state, openModal, markNotifRead, markAllNotif, clearNotifs, logout } = useApp()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // 'search' | 'notif' | 'profile'

  const searchRef = useRef(null)
  const notifRef = useRef(null)
  const profileRef = useRef(null)
  const helpRef = useRef(null)
  useClickOutside(searchRef, () => setOpen((o) => (o === 'search' ? null : o)))
  useClickOutside(notifRef, () => setOpen((o) => (o === 'notif' ? null : o)))
  useClickOutside(profileRef, () => setOpen((o) => (o === 'profile' ? null : o)))
  useClickOutside(helpRef, () => setOpen((o) => (o === 'help' ? null : o)))

  const unread = state.notifications.filter((n) => !n.read).length

  // Global search across everything
  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    const out = []
    const add = (type, icon, label, sub, to) => out.push({ type, icon, label, sub, to })
    const has = (...values) => values.some((v) => String(v || '').toLowerCase().includes(term))
    state.meetings.forEach((m) => has(m.title, m.meetingId) && add('Meeting', Video, m.title, `${m.date} · ${m.time}`, `/meeting/${toRoomId(m.meetingId)}`))
    state.contacts.forEach((c) => has(c.name, c.email) && add('Contact', Users, c.name, c.email, '/contacts'))
    state.channels.forEach((c) => has(c.name) && add('Chat', MessageSquare, c.name, 'Team Chat', `/team-chat?dm=${c.id}`))
    state.docs.forEach((d) => has(d.title) && add('Doc', FileText, d.title, `Edited ${relativeTime(d.updatedAt)}`, '/docs'))
    state.whiteboards.forEach((w) => has(w.title) && add('Whiteboard', PenTool, w.title, w.owner, '/whiteboards'))
    state.recordings.forEach((r) => has(r.title) && add('Recording', PlayCircle, r.title, relativeTime(r.createdAt), '/recordings'))
    state.notes.forEach((n) => has(n.title, n.preview) && add('Note', StickyNote, n.title, `Edited ${relativeTime(n.updatedAt)}`, '/notes'))
    return out.slice(0, 8)
  }, [q, state])

  const go = (to) => { setQ(''); setOpen(null); navigate(to) }

  // keyboard shortcut Ctrl/Cmd+K
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen('search')
        searchRef.current?.querySelector('input')?.focus()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <header className="relative h-[68px] shrink-0 bg-white/80 dark:bg-[#12151C]/90 backdrop-blur border-b border-ink-200 px-3 sm:px-6 flex items-center gap-3 sm:gap-4 sticky top-0 z-30">
      <div className="lg:hidden"><Logo height={23} /></div>
      {/* Search */}
      <div ref={searchRef} className="relative hidden md:block w-full max-w-[380px]">
        <Search className="w-4 h-4 text-ink-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen('search') }}
          onFocus={() => setOpen('search')}
          placeholder="Search meetings, people, docs…"
          className="w-full h-10 rounded-xl bg-ink-100 border border-transparent focus:border-brand-blue focus:bg-white dark:focus:bg-[#161A22] pl-10 pr-16 text-sm outline-none transition"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-400 font-medium border border-ink-200 rounded px-1.5 py-0.5 bg-white dark:bg-[#161A22]">
          Ctrl + K
        </span>

        {open === 'search' && q.trim() && (
          <div className="absolute top-12 left-0 w-[420px] max-w-[92vw] card shadow-soft py-2 animate-pop z-40 max-h-[420px] overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-500 text-center">No results for “{q}”</p>
            ) : (
              results.map((r, i) => {
                const Icon = r.icon
                return (
                  <button key={i} onClick={() => go(r.to)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50 text-left transition">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 grid place-items-center shrink-0">
                      <Icon className="w-4 h-4 text-brand-blue" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-900 truncate">{r.label}</p>
                      <p className="text-xs text-ink-500 truncate">{r.sub}</p>
                    </div>
                    <span className="text-[11px] text-ink-400 shrink-0">{r.type}</span>
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      <button onClick={() => setOpen((o) => o === 'mobileSearch' ? null : 'mobileSearch')} className="ml-auto grid h-10 w-10 place-items-center rounded-xl text-ink-600 hover:bg-ink-100 md:hidden" aria-label="Search"><Search className="h-5 w-5" /></button>
      {open === 'mobileSearch' && <div className="absolute left-3 right-3 top-[60px] z-50 rounded-2xl border border-ink-200 bg-white p-3 shadow-soft dark:bg-[#161A22] md:hidden">
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything…" className="h-11 w-full rounded-xl bg-ink-100 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-blue/20" /></div>
        {q.trim() && <div className="mt-2 max-h-[55vh] overflow-y-auto">{results.length === 0 ? <p className="p-5 text-center text-sm text-ink-500">No results found</p> : results.map((r, i) => { const Icon = r.icon; return <button key={i} onClick={() => go(r.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-ink-50"><Icon className="h-4 w-4 shrink-0 text-brand-blue" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink-900">{r.label}</span><span className="block truncate text-xs text-ink-500">{r.sub}</span></span></button> })}</div>}
      </div>}

      <div className="hidden md:block flex-1" />

      <div ref={helpRef} className="relative hidden sm:block">
        <button onClick={() => setOpen((o) => (o === 'help' ? null : 'help'))} className="flex items-center gap-1.5 text-ink-700 hover:text-ink-900 text-sm font-medium">
          <HelpCircle className="w-5 h-5" />
          <span className="hidden md:inline">Support</span>
        </button>
        {open === 'help' && (
          <div className="absolute top-9 right-0 w-[300px] card shadow-soft animate-pop z-40 p-4">
            <p className="font-bold text-ink-900">Keyboard shortcuts</p>
            <dl className="mt-2 space-y-1.5 text-[13px]">
              {[['Ctrl / ⌘ + K', 'Search everything'], ['Enter', 'Send a chat message'], ['Shift + Enter', 'New line in chat'], ['Esc', 'Close a dialog']].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-ink-500">{v}</dt>
                  <dd className="rounded border border-ink-200 px-1.5 py-0.5 font-semibold text-ink-700">{k}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-ink-100 pt-3 text-[12.5px] text-ink-500">
              Meetings need camera and microphone permission, and a secure (HTTPS) connection outside localhost.
            </p>
          </div>
        )}
      </div>

      {/* Notifications */}
      <div ref={notifRef} className="relative">
        <button onClick={() => setOpen((o) => (o === 'notif' ? null : 'notif'))} className="relative text-ink-700 hover:text-ink-900" title="Notifications">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-red-500 text-white text-[10px] font-bold">
              {unread}
            </span>
          )}
        </button>
        {open === 'notif' && (
          <div className="absolute top-9 right-0 w-[360px] max-w-[92vw] card shadow-soft animate-pop z-40 overflow-hidden">
            <div className="flex items-center justify-between px-4 h-12 border-b border-ink-200">
              <p className="font-bold text-ink-900">Notifications</p>
              <div className="flex items-center gap-3">
                <button onClick={markAllNotif} className="text-xs font-semibold text-brand-blue hover:underline">Mark all read</button>
                {state.notifications.length > 0 && <button onClick={clearNotifs} className="text-xs font-semibold text-ink-500 hover:underline">Clear</button>}
              </div>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {state.notifications.length === 0 && <p className="px-4 py-8 text-sm text-ink-500 text-center">You're all caught up 🎉</p>}
              {state.notifications.map((n) => {
                const Icon = iconFor[n.icon] || Bell
                return (
                  <button key={n.id} onClick={() => markNotifRead(n.id)} className={`w-full flex gap-3 px-4 py-3 text-left hover:bg-ink-50 border-b border-ink-100 last:border-0 ${!n.read ? 'bg-blue-50/40' : ''}`}>
                    <div className="w-9 h-9 rounded-full bg-blue-50 grid place-items-center shrink-0">
                      <Icon className="w-4 h-4 text-brand-blue" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink-800 leading-snug">{n.text}</p>
                      <p className="text-[11px] text-ink-400 mt-0.5">{relativeTime(n.ts) || n.time}</p>
                    </div>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-brand-blue shrink-0 mt-1.5" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <button onClick={() => openModal('schedule')} className="flex items-center gap-1.5 text-brand-blue hover:text-brand-bluehover text-sm font-semibold">
        <CalendarPlus className="w-5 h-5" />
        <span className="hidden md:inline">Schedule</span>
      </button>

      <div className="hidden sm:block w-px h-7 bg-ink-200" />

      {/* Profile */}
      <div ref={profileRef} className="relative">
        <button onClick={() => setOpen((o) => (o === 'profile' ? null : 'profile'))} className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-xl hover:bg-ink-100 transition">
          <img src={state.user.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
          <div className="text-left leading-tight hidden sm:block">
            <p className="text-[13px] font-semibold text-ink-900">{state.user.name}</p>
            <p className="text-[12px] text-ink-500">{state.user.plan}</p>
          </div>
          <ChevronDown className="hidden sm:block w-4 h-4 text-ink-400" />
        </button>
        {open === 'profile' && (
          <div className="absolute top-12 right-0 w-64 card shadow-soft animate-pop z-40 overflow-hidden">
            <div className="p-4 border-b border-ink-200 flex items-center gap-3">
              <img src={state.user.avatar} className="w-11 h-11 rounded-full object-cover" alt="" />
              <div className="min-w-0">
                <p className="font-semibold text-ink-900 truncate">{state.user.name}</p>
                <p className="text-xs text-ink-500 truncate">{state.user.email}</p>
              </div>
            </div>
            <div className="py-1.5">
              <MenuItem icon={User} label="My Profile" onClick={() => go('/settings?section=profile')} />
              <MenuItem icon={Video} label="Personal Meeting Room" onClick={() => go(`/meeting/${toRoomId(state.user.pmi) || newRoomId()}`)} />
              <MenuItem icon={Cog} label="Settings" onClick={() => go('/settings')} />
              <MenuItem icon={Shield} label="Security center" onClick={() => go('/settings?section=security')} />
            </div>
            <div className="py-1.5 border-t border-ink-200">
              <MenuItem
                icon={LogOut}
                label="Log out"
                danger
                onClick={() => { setOpen(null); logout() }}
              />
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium hover:bg-ink-50 transition ${danger ? 'text-red-500' : 'text-ink-700'}`}>
      <Icon className="w-4.5 h-4.5" /> {label}
    </button>
  )
}
