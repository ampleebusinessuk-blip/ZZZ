import { useState, useEffect, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import MeshRoom from './MeshRoom.jsx'

// The LiveKit SDK is ~600 kB. Loading it lazily keeps it out of the bundle for
// every deployment that runs on the built-in peer-to-peer mesh.
const LiveKitMeeting = lazy(() => import('./LiveKitRoom.jsx'))

const Spinner = () => (
  <div className="h-screen w-screen bg-[#0B0E14] grid place-items-center">
    <Loader2 className="w-8 h-8 text-brand-blue animate-spin" />
  </div>
)

/*
  Picks the real transport: LiveKit SFU when the backend has it configured,
  otherwise the built-in peer-to-peer mesh.

  Members and guests reach the SFU through different endpoints, so both are
  passed in. They must agree — if a guest fell back to mesh while members were
  on LiveKit, the two would sit in the same room and never see each other.
*/
export default function MeetingTransport({ room, loadConfig, loadToken, onLeave, toast, canInvite = false }) {
  const [mode, setMode] = useState('loading') // 'loading' | 'livekit' | 'mesh'
  const [lk, setLk] = useState(null)

  useEffect(() => {
    let alive = true
    loadConfig()
      .then(({ enabled }) => {
        if (!alive) return null
        if (!enabled) { setMode('mesh'); return null }
        return loadToken()
      })
      .then((credentials) => {
        if (!alive || !credentials) return
        setLk(credentials); setMode('livekit')
      })
      .catch(() => { if (alive) setMode('mesh') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  if (mode === 'loading') return <Spinner />
  if (mode === 'livekit') {
    return (
      <Suspense fallback={<Spinner />}>
        <LiveKitMeeting token={lk.token} serverUrl={lk.url} meetingId={room} onLeave={onLeave} toast={toast} canInvite={canInvite} />
      </Suspense>
    )
  }
  return <MeshRoom roomId={room} onLeave={onLeave} />
}
