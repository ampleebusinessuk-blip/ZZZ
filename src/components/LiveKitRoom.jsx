import '@livekit/components-styles'
import { LiveKitRoom, VideoConference } from '@livekit/components-react'
import { Copy, ShieldCheck } from 'lucide-react'
import { copyGuestInvite } from '../invites.js'

// Real SFU-powered meeting room. LiveKit handles publish/subscribe, the participant
// grid, active-speaker, screen share, chat and device controls — scaling far beyond
// the peer-to-peer mesh. Rendered only when the backend returns a LiveKit token.
export default function LiveKitMeeting({ token, serverUrl, meetingId, onLeave, toast, canInvite }) {
  const invite = async () => {
    try { await copyGuestInvite(meetingId); toast?.('Guest invite copied — no account required') }
    catch (e) { toast?.(e.message || 'Could not create guest invitation', 'info') }
  }
  return (
    <div className="h-screen w-screen bg-[#0B0E14] relative" data-lk-theme="default">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/50 backdrop-blur text-white/80 text-xs rounded-full px-3 py-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        <span>Meeting ID: {meetingId}</span>
        <span className="opacity-40">·</span>
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">SFU</span>
        {canInvite && <button
          onClick={invite}
          className="ml-1 flex items-center gap-1 hover:text-white"
        >
          <Copy className="w-3.5 h-3.5" /> Copy guest invite
        </button>}
      </div>
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        video
        audio
        onDisconnected={onLeave}
        style={{ height: '100vh' }}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  )
}
