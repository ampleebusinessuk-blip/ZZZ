import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Video, Copy, Link2, Lock, Loader2, Monitor } from 'lucide-react'
import { useApp } from '../store.jsx'
import { nextSlot, toRoomId, durationLabel, newRoomId } from '../dates.js'
import { copyGuestInvite } from '../invites.js'

function Backdrop({ children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-ink-900/50 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4 animate-fade" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="animate-pop w-full max-w-md max-h-[92dvh] overflow-y-auto">{children}</div>
    </div>
  )
}

function Shell({ title, onClose, children, footer }) {
  return (
    <div className="bg-white rounded-t-[24px] sm:rounded-2xl shadow-soft overflow-hidden">
      <div className="flex items-center justify-between px-6 h-16 border-b border-ink-200">
        <h3 className="text-lg font-bold text-ink-900">{title}</h3>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1 rounded-lg hover:bg-ink-100"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
      {footer && <div className="px-5 sm:px-6 py-4 bg-ink-50 border-t border-ink-200 flex flex-wrap justify-end gap-3">{footer}</div>}
    </div>
  )
}

const field = 'w-full h-11 rounded-xl border border-ink-200 px-3.5 text-sm outline-none focus:border-brand-blue'
const DURATIONS = [15, 30, 45, 60, 90, 120]

export default function Modals() {
  const { state, modal, closeModal, toast, scheduleMeeting } = useApp()
  const currentUser = state.user || { name: '', pmi: '' }
  const navigate = useNavigate()

  const [joinId, setJoinId] = useState('')
  const [joinOpts, setJoinOpts] = useState({ noAudio: false, noVideo: false })
  const [form, setForm] = useState(() => ({ title: 'My Meeting', ...nextSlot(), durationMins: 60, recurring: false }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Reset to sensible, *current* defaults each time a modal opens — the previous
  // build shipped a hardcoded 2024 date, so every new meeting landed in the past.
  useEffect(() => {
    if (modal?.type === 'schedule') {
      // modal.data lets callers (e.g. meeting templates) prefill the form.
      setForm({ title: 'My Meeting', ...nextSlot(), durationMins: 60, recurring: false, ...(modal.data || {}) })
      setError('')
    }
    if (modal?.type === 'join') { setJoinId(''); setJoinOpts({ noAudio: false, noVideo: false }); setError('') }
  }, [modal?.type, modal?.data])

  useEffect(() => {
    if (modal?.type === 'new') { closeModal(); navigate(`/meeting/${newRoomId()}`) }
  }, [modal, closeModal, navigate])

  if (!modal || modal.type === 'new') return null

  /* ---------------- Join ---------------- */
  if (modal.type === 'join') {
    const submitJoin = () => {
      const room = toRoomId(joinId)
      if (!room) return setError('Enter a meeting ID or paste an invite link')
      // Accept a full invite URL as well as a bare ID.
      const fromLink = room.match(/(?:meeting|join)\/([^/?#]+)/)
      const target = fromLink ? fromLink[1] : room
      const params = new URLSearchParams()
      if (joinOpts.noAudio) params.set('muted', '1')
      if (joinOpts.noVideo) params.set('novideo', '1')
      closeModal()
      navigate(`/meeting/${target}${params.toString() ? `?${params}` : ''}`)
    }
    return (
      <Backdrop onClose={closeModal}>
        <Shell title="Join a Meeting" onClose={closeModal} footer={
          <>
            <button className="btn-ghost" onClick={closeModal}>Cancel</button>
            <button className="btn-primary disabled:opacity-50" disabled={!joinId.trim()} onClick={submitJoin}>Join</button>
          </>
        }>
          <label className="text-sm font-semibold text-ink-700">Meeting ID or invite link</label>
          <input
            autoFocus value={joinId}
            onChange={(e) => { setJoinId(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && submitJoin()}
            placeholder="845 1234 5678"
            className={field + ' mt-2'}
          />
          <p className="mt-2 text-xs text-ink-500">Joining as <span className="font-semibold text-ink-700">{currentUser.name}</span></p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-4 space-y-2.5">
            <label className="flex items-center gap-2.5 text-sm text-ink-700">
              <input type="checkbox" className="w-4 h-4 accent-brand-blue" checked={joinOpts.noAudio} onChange={(e) => setJoinOpts((o) => ({ ...o, noAudio: e.target.checked }))} /> Join muted
            </label>
            <label className="flex items-center gap-2.5 text-sm text-ink-700">
              <input type="checkbox" className="w-4 h-4 accent-brand-blue" checked={joinOpts.noVideo} onChange={(e) => setJoinOpts((o) => ({ ...o, noVideo: e.target.checked }))} /> Turn off my video
            </label>
          </div>
        </Shell>
      </Backdrop>
    )
  }

  /* ---------------- Schedule ---------------- */
  if (modal.type === 'schedule') {
    const submit = async () => {
      if (!form.title.trim()) return setError('Give your meeting a topic')
      if (!form.dateISO || !form.time) return setError('Pick a date and time')
      setBusy(true); setError('')
      try {
        await scheduleMeeting(form)
        closeModal()
        toast('Meeting scheduled', 'check')
      } catch (e) { setError(e.message || 'Could not schedule the meeting') } finally { setBusy(false) }
    }
    return (
      <Backdrop onClose={closeModal}>
        <Shell title="Schedule a Meeting" onClose={closeModal} footer={
          <>
            <button className="btn-ghost" onClick={closeModal}>Cancel</button>
            <button className="btn-primary inline-flex items-center gap-2 disabled:opacity-50" disabled={busy} onClick={submit}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Schedule
            </button>
          </>
        }>
          <label className="text-sm font-semibold text-ink-700">Topic</label>
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={field + ' mt-2'} />
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <label className="text-sm font-semibold text-ink-700">Date</label>
              <input type="date" value={form.dateISO} onChange={(e) => setForm((f) => ({ ...f, dateISO: e.target.value }))} className={field + ' mt-2'} />
            </div>
            <div>
              <label className="text-sm font-semibold text-ink-700">Time</label>
              <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} className={field + ' mt-2'} />
            </div>
          </div>
          <div className="mt-4">
            <label className="text-sm font-semibold text-ink-700">Duration</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {DURATIONS.map((d) => (
                <button key={d} onClick={() => setForm((f) => ({ ...f, durationMins: d }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${form.durationMins === d ? 'border-brand-blue bg-blue-50 text-brand-blue' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}>
                  {durationLabel(d)}
                </button>
              ))}
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2.5 text-sm text-ink-700">
            <input type="checkbox" className="w-4 h-4 accent-brand-blue" checked={form.recurring} onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.checked }))} /> Recurring meeting
          </label>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex items-center gap-2 text-sm text-ink-700">
            <Lock className="w-4 h-4 text-ink-400" />
            <span>A unique meeting ID is generated when you schedule.</span>
          </div>
        </Shell>
      </Backdrop>
    )
  }

  /* ---------------- Share screen ---------------- */
  if (modal.type === 'share') {
    // This app's own room link. An earlier build pointed at a third-party
    // domain, which sent people to a completely different product.
    const room = toRoomId(currentUser.pmi) || 'personal'
    const copyLink = async () => {
      setBusy(true)
      try { await copyGuestInvite(room); toast('Guest link copied — no account required') }
      catch (e) { toast(e.message || 'Could not create invitation', 'info') }
      finally { setBusy(false) }
    }
    return (
      <Backdrop onClose={closeModal}>
        <Shell title="Share Screen" onClose={closeModal}
          footer={<button className="btn-primary inline-flex items-center gap-2" onClick={() => { closeModal(); navigate(`/meeting/${toRoomId(currentUser.pmi) || 'personal'}?share=1`) }}>
            <Monitor className="w-4 h-4" /> Start sharing
          </button>}
        >
          <p className="text-sm text-ink-500 mb-4">Start a share session in your personal room, then send this link so others can watch.</p>
          <div className="flex items-center gap-2 rounded-xl border border-ink-200 p-2 pl-3.5">
            <Link2 className="w-4 h-4 text-ink-400 shrink-0" />
            <span className="flex-1 text-sm text-ink-700 truncate">Secure guest link · no account required</span>
            <button disabled={busy} className="btn-ghost !py-1.5 flex items-center gap-1.5 disabled:opacity-60" onClick={copyLink}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />} Copy guest link
            </button>
          </div>
          <div className="mt-4 rounded-xl bg-ink-50 border border-ink-200 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-blue/10 grid place-items-center"><Video className="w-5 h-5 text-brand-blue" /></div>
            <p className="text-sm text-ink-600">Your browser will ask which screen, window or tab to share.</p>
          </div>
        </Shell>
      </Backdrop>
    )
  }

  return null
}
