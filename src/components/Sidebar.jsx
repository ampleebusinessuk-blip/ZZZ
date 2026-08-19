import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home, Video, Calendar, Users, MessageSquare, PenTool,
  FileText, Clapperboard, StickyNote, Settings, MoreHorizontal, ChevronDown, Sparkles,
  ShieldCheck, Palette, CircleHelp, LogOut,
} from 'lucide-react'
import Logo from './Logo.jsx'
import { useApp } from '../store.jsx'

const nav = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/meetings', label: 'Meetings', icon: Video },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/team-chat', label: 'Team Chat', icon: MessageSquare, badgeKey: 'chat' },
  { to: '/whiteboards', label: 'Whiteboards', icon: PenTool, tag: 'NEW' },
  { to: '/recordings', label: 'AI Notes & Recordings', icon: Sparkles, tag: 'AI' },
  { to: '/docs', label: 'Docs', icon: FileText, tag: 'NEW' },
  { to: '/clips', label: 'Clips', icon: Clapperboard },
  { to: '/notes', label: 'Notes', icon: StickyNote },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar() {
  const { state, toast, logout } = useApp()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const chatUnread = (state.channels || []).reduce((n, c) => n + (c.unread || 0), 0)
  const badges = { chat: chatUnread }
  return (
    <aside className="hidden lg:flex w-[248px] shrink-0 h-screen sticky top-0 bg-white dark:bg-[#12151C] border-r border-ink-200 flex-col">
      <div className="px-6 h-[68px] flex items-center">
        <Logo />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {nav.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'nav-item-active' : ''}`
              }
            >
              <Icon className="w-[20px] h-[20px] shrink-0" strokeWidth={2} />
              <span className="flex-1">{item.label}</span>
              {item.badgeKey && badges[item.badgeKey] > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 grid place-items-center rounded-full bg-red-500 text-white text-[11px] font-bold">
                  {badges[item.badgeKey]}
                </span>
              )}
              {item.tag && (
                <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-brand-bluedark text-[10px] font-bold tracking-wide">
                  {item.tag}
                </span>
              )}
            </NavLink>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="sidebar-more-menu"
          className={`nav-item w-full text-left ${moreOpen ? 'bg-ink-100 text-ink-900' : 'text-ink-500'}`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="flex-1">More tools</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
        </button>
        {moreOpen && (
          <div id="sidebar-more-menu" className="mx-1 mb-2 rounded-xl border border-ink-200 bg-ink-50 p-1.5 animate-pop" role="menu">
            <MoreItem icon={ShieldCheck} label="Security center" onClick={() => { navigate('/settings?section=security'); setMoreOpen(false) }} />
            <MoreItem icon={Palette} label="Appearance" onClick={() => { navigate('/settings?section=appearance'); setMoreOpen(false) }} />
              <MoreItem icon={CircleHelp} label="Keyboard shortcuts" onClick={() => { toast('Press Ctrl / ⌘ + K to search anything', 'info'); setMoreOpen(false) }} />
            <div className="my-1 border-t border-ink-200" />
            <MoreItem icon={LogOut} label="Sign out" danger onClick={() => logout()} />
          </div>
        )}
      </nav>

      {/* Signed-in user footer */}
      <div className="p-3 border-t border-ink-200">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <img src={state.user?.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900 truncate">{state.user?.name}</p>
            <p className="text-[11px] text-ink-500 truncate">{state.user?.email}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function MoreItem({ icon: Icon, label, onClick, danger = false }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition hover:bg-white dark:hover:bg-[#20242E] ${danger ? 'text-red-600' : 'text-ink-700'}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  )
}
