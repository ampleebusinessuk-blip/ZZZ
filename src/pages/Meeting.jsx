import { useNavigate, useParams, useLocation, Navigate } from 'react-router-dom'
import { api } from '../api.js'
import { useApp } from '../store.jsx'
import MeetingTransport from '../components/MeetingTransport.jsx'
import { newRoomId, toRoomId } from '../dates.js'

export default function Meeting() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { state, toast } = useApp()

  /* Placeholder segments are not rooms. "instant" used to be a literal path, so
     every instant meeting on the deployment — across all accounts — joined one
     shared call. Swap them for a real room before anything connects, replacing
     the history entry so Back still leaves the meeting. */
  if (!id || id === 'instant' || id === 'new') {
    return <Navigate to={`/meeting/${newRoomId()}${location.search}`} replace />
  }
  if (id === 'personal' || id === 'share') {
    return <Navigate to={`/meeting/${toRoomId(state.user?.pmi) || newRoomId()}${location.search}`} replace />
  }

  return (
    <MeetingTransport
      room={id}
      loadConfig={api.livekitConfig}
      loadToken={() => api.livekitToken(id)}
      onLeave={() => navigate('/')}
      toast={toast}
      canInvite
    />
  )
}
