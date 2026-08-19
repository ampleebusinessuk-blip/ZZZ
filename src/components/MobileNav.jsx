import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Home, Video, MessageSquare, Calendar, MoreHorizontal, X, Users, PenTool, FileText, Clapperboard, StickyNote, Settings, ShieldCheck, LogOut, Sparkles } from 'lucide-react'
import { useApp } from '../store.jsx'

const primary = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/meetings', label: 'Meet', icon: Video },
  { to: '/team-chat', label: 'Chat', icon: MessageSquare, badge: true },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
]
const tools = [
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/whiteboards', label: 'Whiteboards', icon: PenTool },
  { to: '/recordings', label: 'AI Notes', icon: Sparkles },
  { to: '/docs', label: 'Docs', icon: FileText },
  { to: '/clips', label: 'Clips', icon: Clapperboard },
  { to: '/notes', label: 'Notes', icon: StickyNote },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/settings?section=security', label: 'Security', icon: ShieldCheck },
]

export default function MobileNav() {
  const { state, logout } = useApp()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => setOpen(false), [location.pathname, location.search])
  const unread = (state.channels || []).reduce((sum, c) => sum + (c.unread || 0), 0)

  return <>
    {open && <div className="fixed inset-0 z-40 bg-ink-900/45 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)}>
      <section onClick={(e) => e.stopPropagation()} className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white dark:bg-[#161A22] px-5 pt-4 pb-[calc(92px+env(safe-area-inset-bottom))] shadow-2xl animate-pop">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-200" />
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-ink-900">All tools</h2><p className="text-xs text-ink-500">Your complete workspace</p></div><button onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-ink-100 text-ink-600"><X className="h-5 w-5" /></button></div>
        <div className="mt-5 grid grid-cols-4 gap-3">{tools.map(({ to, label, icon: Icon }) => <button key={to} onClick={() => navigate(to)} className="flex min-w-0 flex-col items-center gap-2 rounded-2xl p-2 text-ink-700 active:bg-blue-50"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink-100"><Icon className="h-5 w-5" /></span><span className="w-full truncate text-center text-[11px] font-semibold">{label}</span></button>)}</div>
        <button onClick={logout} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 text-sm font-bold text-red-600"><LogOut className="h-4 w-4" /> Sign out</button>
      </section>
    </div>}
    <nav className="fixed inset-x-0 bottom-0 z-50 flex h-[72px] items-start justify-around border-t border-ink-200 bg-white/95 px-1 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Mobile navigation">
      {primary.map(({ to, label, icon: Icon, end, badge }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `relative flex min-w-[58px] flex-col items-center gap-1 rounded-xl px-2 py-1 text-[10px] font-semibold ${isActive ? 'text-brand-blue' : 'text-ink-500'}`}><Icon className="h-5 w-5" /><span>{label}</span>{badge && unread > 0 && <span className="absolute right-2 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] text-white">{Math.min(unread, 99)}</span>}</NavLink>)}
      <button onClick={() => setOpen(true)} className="flex min-w-[58px] flex-col items-center gap-1 rounded-xl px-2 py-1 text-[10px] font-semibold text-ink-500"><MoreHorizontal className="h-5 w-5" /><span>More</span></button>
    </nav>
  </>
}
