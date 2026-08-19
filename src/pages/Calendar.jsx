import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Page } from '../components/PageHeader.jsx'
import PageHeader from '../components/PageHeader.jsx'
import { monthGrid, todayKey, MONTHS, WEEKDAYS_SHORT } from '../dates.js'
import { useApp } from '../store.jsx'

export default function Calendar() {
  const { state, openModal } = useApp()
  const [view, setView] = useState('Month')
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const weeks = monthGrid(year, month)
  const tKey = todayKey()

  // group meetings by dateKey
  const byDay = {}
  for (const m of state.meetings) {
    if (!m.dateKey) continue
    ;(byDay[m.dateKey] = byDay[m.dateKey] || []).push(m)
  }

  const change = (delta) => {
    let m = month + delta, y = year
    if (m < 0) { m = 11; y-- } else if (m > 11) { m = 0; y++ }
    setMonth(m); setYear(y)
  }
  const today = () => { setYear(now.getFullYear()); setMonth(now.getMonth()) }

  return (
    <Page>
      <PageHeader
        title="Calendar"
        subtitle={`${MONTHS[month]} ${year}`}
        actions={
          <>
            <div className="flex rounded-lg border border-ink-200 overflow-hidden">
              {['Day', 'Week', 'Month'].map((v) => (
                <button key={v} onClick={() => setView(v)} className={`px-3.5 py-2 text-sm font-semibold ${view === v ? 'bg-brand-blue text-white' : 'text-ink-600 hover:bg-ink-50'}`}>{v}</button>
              ))}
            </div>
            <button className="btn-primary flex items-center gap-1.5" onClick={() => openModal('schedule')}><Plus className="w-4 h-4" /> New Event</button>
          </>
        }
      />

      <div className="card overflow-x-auto">
        <div className="min-w-[680px]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink-200">
          <div className="flex items-center gap-2">
            <button onClick={() => change(-1)} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-500"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={today} className="btn-ghost !py-1.5">Today</button>
            <button onClick={() => change(1)} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-500"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <p className="font-bold text-ink-900">{MONTHS[month]} {year}</p>
          <div className="w-24" />
        </div>

        <div className="grid grid-cols-7 border-b border-ink-200">
          {WEEKDAYS_SHORT.map((d) => <div key={d} className="py-2.5 text-center text-xs font-semibold text-ink-500 border-r border-ink-100 last:border-r-0">{d}</div>)}
        </div>

        <div className="grid grid-cols-7">
          {weeks.map((week, wi) => week.map((cell) => {
            const isToday = cell.key === tKey && !cell.out
            const dayEvents = !cell.out ? (byDay[cell.key] || []) : []
            return (
              <div key={cell.key + wi} className="min-h-[116px] border-r border-b border-ink-100 last:border-r-0 p-1.5 hover:bg-ink-50/40">
                <div className={`w-7 h-7 grid place-items-center rounded-full text-sm ${isToday ? 'bg-brand-blue text-white font-bold' : cell.out ? 'text-ink-300' : 'text-ink-700'}`}>{cell.day}</div>
                <div className="mt-1 space-y-1">
                  {dayEvents.map((e) => (
                    <div key={e.id} className="flex items-center gap-1.5 px-1.5 py-1 rounded-md bg-blue-50 text-[11.5px] text-brand-bluedark truncate" title={`${e.time} · ${e.title}`}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-brand-blue" />
                      <span className="truncate">{e.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          }))}
        </div>
        </div>
      </div>
    </Page>
  )
}
