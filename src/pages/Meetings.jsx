import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Video, Plus, Repeat, PlayCircle, Copy, Trash2, Radio, Link2 } from 'lucide-react'
import PageHeader, { Page } from '../components/PageHeader.jsx'
import AvatarStack from '../components/Avatars.jsx'
import { useApp } from '../store.jsx'
import { toRoomId, durationLabel, newRoomId } from '../dates.js'
import { copyGuestInvite } from '../invites.js'

const tabs = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'previous', label: 'Previous' },
  { key: 'personal', label: 'Personal Room' },
  { key: 'templates', label: 'Meeting Templates' },
]

const TEMPLATES = [
  { name: 'Standup', mins: 15 },
  { name: 'Client Demo', mins: 45 },
  { name: '1:1 Sync', mins: 30 },
  { name: 'All Hands', mins: 60 },
  { name: 'Interview', mins: 45 },
  { name: 'Webinar', mins: 90 },
]

export default function Meetings() {
  const [tab, setTab] = useState('upcoming')
  const { state, openModal, toast, deleteMeeting } = useApp()
  const navigate = useNavigate()
  const currentUser = state.user

  // Buckets come from decorateMeeting(), recomputed against the clock — so a
  // meeting moves from Upcoming to Previous on its own once it has ended.
  const lists = {
    upcoming: state.meetings.filter((m) => m.bucket === 'today' || m.bucket === 'upcoming'),
    previous: state.meetings.filter((m) => m.bucket === 'previous').slice().reverse(),
  }

  const personalRoom = toRoomId(currentUser.pmi)
  const copyInvite = async (m) => {
    try {
      await copyGuestInvite(toRoomId(m.meetingId), (link) => `${currentUser.name} is inviting you to a meeting.\n\nTopic: ${m.title}\nTime: ${m.date} at ${m.time}\n\nJoin as a guest: ${link}\nMeeting ID: ${m.meetingId}`)
      toast('Guest invitation copied — no account required')
    } catch (e) { toast(e.message || 'Could not create invitation', 'info') }
  }

  const copyPersonalInvite = async () => {
    try { await copyGuestInvite(personalRoom); toast('Guest link copied — no account required') }
    catch (e) { toast(e.message || 'Could not create invitation', 'info') }
  }

  return (
    <Page>
      <PageHeader
        title="Meetings"
        subtitle="Manage your scheduled, recurring and past meetings."
        actions={
          <>
            <button className="btn-ghost flex items-center gap-1.5" onClick={() => openModal('schedule')}>
              <Plus className="w-4 h-4" /> Schedule
            </button>
            <button className="btn-primary flex items-center gap-1.5" onClick={() => navigate(`/meeting/${newRoomId()}`)}>
              <Video className="w-4 h-4" /> New Meeting
            </button>
          </>
        }
      />

      <div className="flex items-center gap-1 border-b border-ink-200 mb-5 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition ${tab === t.key ? 'border-brand-blue text-brand-blue' : 'border-transparent text-ink-500 hover:text-ink-700'}`}>
            {t.label}
            {t.key === 'upcoming' && lists.upcoming.length > 0 && <span className="ml-1.5 text-xs text-ink-400">{lists.upcoming.length}</span>}
          </button>
        ))}
      </div>

      {(tab === 'upcoming' || tab === 'previous') && (
        <div className="card overflow-hidden">
          {lists[tab].length === 0 && (
            <div className="py-16 text-center">
              <p className="text-ink-500">No {tab} meetings.</p>
              {tab === 'upcoming' && <button className="btn-primary mt-4" onClick={() => openModal('schedule')}>Schedule a meeting</button>}
            </div>
          )}
          {lists[tab].map((m, i) => (
            <div key={m.id} className={`flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 px-4 sm:px-6 py-4 hover:bg-ink-50/60 ${i > 0 ? 'border-t border-ink-100' : ''}`}>
              <div className="w-24 shrink-0">
                <p className="text-xs font-semibold text-brand-blue">{m.date}</p>
                <p className="font-bold text-ink-900">{m.time}</p>
                <p className="text-xs text-ink-500">{durationLabel(m.durationMins)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 flex items-center gap-2 truncate">
                  {m.title}
                  {m.live && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><Radio className="w-3 h-3" /> In progress</span>}
                  {m.recurring && <Repeat className="w-3.5 h-3.5 text-ink-400" title="Recurring" />}
                  {m.recorded && <PlayCircle className="w-3.5 h-3.5 text-emerald-500" title="Recorded" />}
                </p>
                <p className="text-[13px] text-ink-500 mt-0.5">Meeting ID: {m.meetingId} · Host: {m.host}</p>
              </div>
              {m.participants?.length > 0 && <AvatarStack ids={m.participants.slice(0, 3)} extra={Math.max(0, m.participants.length - 3)} />}
              {tab === 'upcoming' ? (
                <div className="flex w-full sm:w-auto items-center justify-end gap-2 order-last sm:order-none">
                  <button className="btn-ghost !py-1.5 flex items-center gap-1.5" onClick={() => copyInvite(m)}>
                    <Copy className="w-3.5 h-3.5" /> Copy invite
                  </button>
                  <button className="btn-primary !py-1.5" onClick={() => navigate('/meeting/' + toRoomId(m.meetingId))}>Start</button>
                </div>
              ) : (
                <button className="btn-ghost !py-1.5" onClick={() => navigate('/meeting/' + toRoomId(m.meetingId))}>Restart</button>
              )}
              <button className="text-ink-400 hover:text-red-500 p-1" title="Delete meeting"
                onClick={() => { deleteMeeting(m.id); toast('Meeting deleted', 'check') }}>
                <Trash2 className="w-4.5 h-4.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'personal' && (
        <div className="card p-5 sm:p-8 max-w-2xl">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-brand-blue/10 grid place-items-center">
              <Video className="w-8 h-8 text-brand-blue" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-ink-900">{currentUser.name}'s Personal Meeting Room</p>
              <p className="text-ink-500 mt-1">Meeting ID: {currentUser.pmi}</p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-ink-200 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <Link2 className="w-4 h-4 text-ink-400 shrink-0" />
            <span className="flex-1 text-sm text-ink-700 truncate">Secure guest link · generated when copied</span>
            <button className="btn-ghost !py-1.5 flex w-full sm:w-auto items-center justify-center gap-1.5"
              onClick={copyPersonalInvite}>
              <Copy className="w-4 h-4" /> Copy guest link
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <Info label="Video on join" value={state.settings?.autoJoin === false ? 'Off' : 'On'} />
            <Info label="Video quality" value={state.settings?.hd === false ? 'Standard' : 'HD'} />
            <Info label="Noise suppression" value={state.settings?.suppressNoise === false ? 'Off' : 'On'} />
            <Info label="Mirror my video" value={state.settings?.mirror === false ? 'Off' : 'On'} />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button className="btn-primary flex items-center gap-1.5" onClick={() => navigate(`/meeting/${personalRoom}`)}>
              <Video className="w-4 h-4" /> Start Meeting
            </button>
            <button className="btn-ghost" onClick={() => navigate('/settings?section=video')}>Edit preferences</button>
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TEMPLATES.map((t) => (
            <div key={t.name} className="card p-5 hover:shadow-soft transition">
              <div className="w-11 h-11 rounded-xl bg-blue-50 grid place-items-center mb-3">
                <Video className="w-5 h-5 text-brand-blue" />
              </div>
              <p className="font-semibold text-ink-900">{t.name}</p>
              <p className="text-[13px] text-ink-500 mt-0.5">{durationLabel(t.mins)} · reusable template</p>
              <div className="flex gap-2 mt-4">
                <button className="btn-ghost flex-1 !py-1.5" onClick={() => openModal('schedule', { title: t.name, durationMins: t.mins })}>Schedule</button>
                <button className="btn-primary flex-1 !py-1.5" onClick={() => navigate(`/meeting/${newRoomId()}`)}>Start now</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl border border-ink-200 p-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="font-semibold text-ink-900 mt-0.5">{value}</p>
    </div>
  )
}
