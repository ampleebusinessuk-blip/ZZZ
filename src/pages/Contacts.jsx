import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Video, MessageSquare, Copy, UserPlus, Users } from 'lucide-react'
import PageHeader, { Page } from '../components/PageHeader.jsx'
import { useApp } from '../store.jsx'
import { toRoomId, newRoomId } from '../dates.js'
import { createGuestInviteLink } from '../invites.js'

export default function Contacts() {
  const { state, openDM, sendMessage, toast } = useApp()
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  const online = new Set(state.online || [])
  const people = state.contacts || []
  const filtered = people.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.email || '').toLowerCase().includes(q.toLowerCase())
  )

  const startDM = async (p) => {
    try {
      const channel = await openDM(p.id)
      navigate(`/team-chat?dm=${channel.id}`)
    } catch { toast('Could not open chat', 'info') }
  }

  // "Meet" opens your personal room AND sends them the link, so the invite
  // actually reaches the person instead of dropping you into an empty room.
  const meet = async (p) => {
    const room = toRoomId(state.user?.pmi) || newRoomId()
    try {
      const link = await createGuestInviteLink(room)
      const channel = await openDM(p.id)
      sendMessage(channel.id, `Joining a call now — use this guest link (no account required): ${link}`)
      toast(`Invite sent to ${p.name.split(' ')[0]}`, 'video')
    } catch { toast('Could not send the invite — opening the room anyway', 'info') }
    navigate(`/meeting/${room}`)
  }

  const invite = () => {
    const link = `${location.origin}/`
    navigator.clipboard?.writeText(link)
    toast('Invite link copied — share it so teammates can join')
  }

  return (
    <Page>
      <PageHeader
        title="Contacts"
        subtitle={`${people.length} ${people.length === 1 ? 'person' : 'people'} on your workspace · ${online.size} online`}
        actions={<button className="btn-primary flex items-center gap-1.5" onClick={invite}><UserPlus className="w-4 h-4" /> Invite people</button>}
      />

      <div className="relative w-full max-w-xs mb-5">
        <Search className="w-4 h-4 text-ink-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" className="w-full h-10 rounded-xl bg-white border border-ink-200 pl-10 pr-3 text-sm outline-none focus:border-brand-blue" />
      </div>

      {people.length === 0 ? (
        <div className="card p-7 sm:p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 grid place-items-center mx-auto mb-4"><Users className="w-7 h-7 text-brand-blue" /></div>
          <p className="font-semibold text-ink-900 text-lg">No one else here yet</p>
          <p className="text-ink-500 mt-1 max-w-sm mx-auto">Contacts are the real people who join your workspace. Invite teammates and they'll appear here — with live online status.</p>
          <button className="btn-primary mt-5" onClick={invite}>Copy invite link</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const isOnline = online.has(p.id)
            return (
              <div key={p.id} className="card p-5 hover:shadow-soft transition group">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img src={p.avatar} alt={p.name} className="w-12 h-12 rounded-full object-cover" />
                    <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full ring-2 ring-white ${isOnline ? 'bg-emerald-500' : 'bg-ink-300'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900 truncate">{p.name}</p>
                    <p className="text-[13px] text-ink-500 truncate">{p.email}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs text-ink-500 flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-ink-300'}`} /> {isOnline ? 'Online' : 'Offline'}
                  </span>
                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                    <IconBtn title="Start a call and invite them" onClick={() => meet(p)}><Video className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Message" onClick={() => startDM(p)}><MessageSquare className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Copy email" onClick={() => { navigator.clipboard?.writeText(p.email); toast('Email copied') }}><Copy className="w-4 h-4" /></IconBtn>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {people.length > 0 && filtered.length === 0 && <p className="text-ink-500 text-center py-16">No contacts found.</p>}
    </Page>
  )
}

function IconBtn({ children, ...props }) {
  return (
    <button {...props} className="w-8 h-8 grid place-items-center rounded-lg text-ink-600 hover:bg-blue-50 hover:text-brand-blue transition">{children}</button>
  )
}
