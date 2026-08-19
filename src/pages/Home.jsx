import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Video, Plus, CalendarDays, ScreenShare, ChevronLeft, ChevronRight,
  CalendarPlus, Copy, Trash2, Radio,
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { monthGrid, todayKey, MONTHS, WEEKDAYS, greeting, toRoomId, durationLabel, newRoomId } from '../dates.js'
import AvatarStack from '../components/Avatars.jsx'
import { copyGuestInvite } from '../invites.js'

const quickActions = [
  { key: 'new', title: 'New Meeting', sub: 'Start an instant meeting', icon: Video, color: 'bg-brand-orange' },
  { key: 'join', title: 'Join Meeting', sub: 'Join with meeting ID', icon: Plus, color: 'bg-brand-blue' },
  { key: 'schedule', title: 'Schedule Meeting', sub: 'Plan for later', icon: CalendarDays, color: 'bg-brand-blue' },
  { key: 'share', title: 'Share Screen', sub: 'Share your screen', icon: ScreenShare, color: 'bg-brand-blue' },
]

const upcomingColors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-pink-500']

export default function Home() {
  const { state, openModal, toast, deleteMeeting } = useApp()
  const navigate = useNavigate()
  const currentUser = state.user

  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [selectedDay, setSelectedDay] = useState(null)
  const weeks = monthGrid(viewYear, viewMonth)
  const tKey = todayKey()
  const meetingDays = new Set(state.meetings.map((m) => m.dateKey).filter(Boolean))

  const changeMonth = (delta) => {
    let m = viewMonth + delta, y = viewYear
    if (m < 0) { m = 11; y-- } else if (m > 11) { m = 0; y++ }
    setViewMonth(m); setViewYear(y); setSelectedDay(null)
  }

  const todaysMeetings = state.meetings.filter((m) => m.dateKey === tKey)
  const upcoming = state.meetings.filter((m) => m.bucket === 'upcoming').slice(0, 3)
  const dayMeetings = selectedDay ? state.meetings.filter((m) => m.dateKey === selectedDay) : []

  const handleAction = (key) => {
    if (key === 'new') navigate(`/meeting/${newRoomId()}`)
    else openModal(key)
  }

  const copyInvite = async (m) => {
    try {
      await copyGuestInvite(toRoomId(m.meetingId), (link) => `${currentUser.name} is inviting you to "${m.title}".\n\nJoin as a guest: ${link}\nMeeting ID: ${m.meetingId}`)
      toast('Guest invitation copied — no account required')
    } catch (e) { toast(e.message || 'Could not create invitation', 'info') }
  }

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        <div className="min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-[26px] font-extrabold text-ink-900">
                {greeting()}, {currentUser.firstName}! <span className="align-middle">👋</span>
              </h1>
              <p className="text-ink-500 mt-1">
                {todaysMeetings.length === 0
                  ? "You have nothing scheduled today — the floor is yours."
                  : `You have ${todaysMeetings.length} meeting${todaysMeetings.length > 1 ? 's' : ''} today.`}
              </p>
            </div>
            <button className="btn-ghost shrink-0" onClick={() => { navigator.clipboard?.writeText(currentUser.pmi); toast('Personal Meeting ID copied') }}>
              Personal Meeting ID
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            {quickActions.map((a) => {
              const Icon = a.icon
              return (
                <button key={a.key} onClick={() => handleAction(a.key)} className="card p-5 text-center hover:shadow-soft hover:-translate-y-0.5 transition-all group">
                  <div className={`w-14 h-14 mx-auto rounded-2xl grid place-items-center text-white ${a.color} group-hover:scale-105 transition-transform`}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <p className="font-bold text-ink-900 mt-3">{a.title}</p>
                  <p className="text-[13px] text-ink-500 mt-0.5">{a.sub} ›</p>
                </button>
              )
            })}
          </div>

          <div className="card mt-6">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 className="text-lg font-bold text-ink-900">Today's Meetings</h2>
              <button onClick={() => navigate('/meetings')} className="text-sm font-semibold text-brand-blue hover:text-brand-bluehover">View all</button>
            </div>
            {todaysMeetings.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 grid place-items-center mx-auto mb-3"><CalendarPlus className="w-6 h-6 text-brand-blue" /></div>
                <p className="font-semibold text-ink-900">No meetings scheduled for today</p>
                <p className="text-sm text-ink-500 mt-1">Start an instant meeting or schedule one for later.</p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button className="btn-primary" onClick={() => navigate(`/meeting/${newRoomId()}`)}>New Meeting</button>
                  <button className="btn-ghost" onClick={() => openModal('schedule')}>Schedule</button>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-ink-100">
                {todaysMeetings.map((m) => (
                  <div key={m.id} className="flex items-center gap-4 px-6 py-4 hover:bg-ink-50/60 transition-colors">
                    <div className={`w-[74px] shrink-0 border-l-2 pl-3 ${m.live ? 'border-emerald-500' : m.bucket === 'previous' ? 'border-ink-200' : 'border-brand-blue'}`}>
                      <p className="font-bold text-ink-900 text-[15px]">{m.time}</p>
                      <p className="text-xs text-ink-500">{durationLabel(m.durationMins)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink-900 truncate flex items-center gap-2">
                        {m.title}
                        {m.live && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><Radio className="w-3 h-3" /> Now</span>}
                      </p>
                      <p className="text-[13px] text-ink-500">Meeting ID: {m.meetingId}</p>
                    </div>
                    {m.participants?.length > 0 && <AvatarStack ids={m.participants} extra={0} />}
                    <button title="Copy invitation" onClick={() => copyInvite(m)} className="text-ink-400 hover:text-ink-700 p-1.5 rounded-lg hover:bg-ink-100"><Copy className="w-4 h-4" /></button>
                    <button onClick={() => navigate('/meeting/' + toRoomId(m.meetingId))} className="btn-primary min-w-[76px]">
                      {m.bucket === 'previous' ? 'Restart' : 'Start'}
                    </button>
                    <button title="Delete meeting" onClick={() => { deleteMeeting(m.id); toast('Meeting deleted', 'check') }} className="text-ink-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-ink-900">Calendar</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => changeMonth(-1)} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-500"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => changeMonth(1)} className="w-7 h-7 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-500"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
            <p className="font-semibold text-ink-900 text-center mb-2">{MONTHS[viewMonth]} {viewYear}</p>
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {WEEKDAYS.map((d) => <div key={d} className="text-[11px] font-semibold text-ink-400 py-1">{d}</div>)}
              {weeks.map((week, wi) => week.map((cell) => {
                const isToday = cell.key === tKey && !cell.out
                const isSelected = selectedDay === cell.key
                const hasDot = meetingDays.has(cell.key) && !cell.out && !isToday
                return (
                  <button
                    key={cell.key + wi}
                    onClick={() => setSelectedDay(isSelected ? null : cell.key)}
                    className={`relative h-9 w-9 mx-auto grid place-items-center rounded-full text-[13px] transition ${
                      isToday ? 'bg-brand-blue text-white font-bold'
                        : isSelected ? 'bg-blue-50 text-brand-blue font-bold ring-1 ring-brand-blue'
                        : cell.out ? 'text-ink-300 hover:bg-ink-50' : 'text-ink-700 hover:bg-ink-100'
                    }`}
                  >
                    {cell.day}
                    {hasDot && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-brand-blue" />}
                  </button>
                )
              }))}
            </div>

            {selectedDay && (
              <div className="mt-3 border-t border-ink-100 pt-3">
                {dayMeetings.length === 0 ? (
                  <div className="text-center">
                    <p className="text-sm text-ink-500">Nothing on this day.</p>
                    <button className="btn-ghost !py-1.5 mt-2 text-xs" onClick={() => openModal('schedule', { dateISO: selectedDay })}>Schedule something</button>
                  </div>
                ) : dayMeetings.map((m) => (
                  <button key={m.id} onClick={() => navigate('/meeting/' + toRoomId(m.meetingId))} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-ink-50">
                    <p className="text-sm font-semibold text-ink-900 truncate">{m.title}</p>
                    <p className="text-xs text-ink-500">{m.time} · {durationLabel(m.durationMins)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-ink-900">Upcoming</h3>
              <button onClick={() => navigate('/meetings')} className="text-sm font-semibold text-brand-blue">View all</button>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-500 py-6 text-center">No upcoming meetings.<br />Schedule one to see it here.</p>
            ) : (
              <div className="divide-y divide-ink-100">
                {upcoming.map((u, i) => (
                  <button key={u.id} onClick={() => navigate('/meetings')} className="w-full text-left py-3.5">
                    <p className="font-semibold text-brand-blue text-sm">{u.date}</p>
                    <p className="text-[13px] text-ink-500 mt-1">● {u.time} · {durationLabel(u.durationMins)}</p>
                    <p className="text-sm text-ink-900 mt-0.5 flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${upcomingColors[i % upcomingColors.length]}`} /> {u.title}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
