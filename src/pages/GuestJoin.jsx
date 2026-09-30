import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Navigate } from 'react-router-dom'
import { Loader2, Video, ShieldCheck, LogIn, AlertTriangle } from 'lucide-react'
import { api } from '../api.js'
import { rt } from '../realtime.js'
import { useAuth } from '../auth.jsx'
import { GuestProvider } from '../guest.jsx'
import MeetingTransport from '../components/MeetingTransport.jsx'
import Toasts from '../components/Toasts.jsx'
import Logo from '../components/Logo.jsx'

/*
  The public door into a meeting. Someone opens an invite link, gives a display
  name, and joins — no account, no sign-up. The pass they receive is scoped by
  the server to this one room.
*/
export default function GuestJoin() {
  const { room } = useParams()
  const [params] = useSearchParams()
  const { status } = useAuth()
  const token = params.get('t') || ''

  const [guest, setGuest] = useState(null)
  const [name, setName] = useState('')
  const [opts, setOpts] = useState({ muted: false, noVideo: false })
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // A refreshed tab shouldn't have to re-enter a name — the pass is a cookie.
  useEffect(() => {
    let alive = true
    api.guestMe()
      .then(({ guest }) => { if (alive && guest?.room === room) { setGuest(guest); rt.connect() } })
      .catch(() => {})
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [room])

  // Members already have an identity; send them in as themselves.
  if (status === 'authed') return <Navigate to={`/meeting/${room}`} replace />
  if (status === 'loading' || checking) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#F5F7FB]">
        <Loader2 className="w-8 h-8 text-brand-blue animate-spin" />
      </div>
    )
  }

  if (guest) {
    const search = new URLSearchParams()
    if (opts.muted) search.set('muted', '1')
    if (opts.noVideo) search.set('novideo', '1')
    // Keep the join choices on the URL so MeshRoom applies them, as it does for members.
    if ([...search].length && !window.location.search.includes('muted') && !window.location.search.includes('novideo')) {
      window.history.replaceState(null, '', `${window.location.pathname}?${search}`)
    }
    return (
      <GuestProvider guest={guest}>
        <MeetingTransport
          room={room}
          loadConfig={api.guestLivekitConfig}
          loadToken={api.guestLivekitToken}
          onLeave={() => { api.guestLogout().catch(() => {}); rt.disconnect(); setGuest(null) }}
          toast={() => {}}
        />
        <Toasts />
      </GuestProvider>
    )
  }

  const join = async (e) => {
    e?.preventDefault()
    if (name.trim().length < 2) return setError('Enter the name others will see')
    setBusy(true); setError('')
    try {
      const { guest } = await api.guestSession(token, name.trim())
      rt.connect()
      setGuest(guest)
    } catch (err) {
      setError(err.message || 'Could not join this meeting')
    } finally { setBusy(false) }
  }

  const missingToken = !token

  return (
    <div className="min-h-screen bg-[#F5F7FB] flex flex-col">
      <header className="h-[68px] shrink-0 px-6 flex items-center border-b border-ink-200 bg-white">
        <Logo />
      </header>

      <main className="flex-1 grid place-items-center px-5 py-10">
        <div className="w-full max-w-[440px]">
          <div className="card p-7 sm:p-8">
            <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-blue to-brand-bluedark shadow-lg shadow-blue-500/20">
              <Video className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-[26px] font-black tracking-[-0.03em] text-ink-900">Join the meeting</h1>
            <p className="mt-2 text-sm leading-6 text-ink-500">
              You're joining as a guest — no account needed. Meeting ID <span className="font-semibold text-ink-700">{room}</span>
            </p>

            {missingToken ? (
              <div className="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>This link is missing its invite code. Ask the host to send you the full guest link.</span>
              </div>
            ) : (
              <form onSubmit={join} className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-sm font-bold text-ink-700">Your name</span>
                  <input
                    autoFocus value={name} onChange={(e) => { setName(e.target.value); setError('') }}
                    placeholder="e.g. Alex Morgan" maxLength={60}
                    className="mt-1.5 h-12 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-sm outline-none transition focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/10"
                  />
                </label>

                <div className="space-y-2.5">
                  <label className="flex items-center gap-2.5 text-sm text-ink-700">
                    <input type="checkbox" className="w-4 h-4 accent-brand-blue" checked={opts.muted}
                      onChange={(e) => setOpts((o) => ({ ...o, muted: e.target.checked }))} /> Join muted
                  </label>
                  <label className="flex items-center gap-2.5 text-sm text-ink-700">
                    <input type="checkbox" className="w-4 h-4 accent-brand-blue" checked={opts.noVideo}
                      onChange={(e) => setOpts((o) => ({ ...o, noVideo: e.target.checked }))} /> Turn off my video
                  </label>
                </div>

                {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</div>}

                <button type="submit" disabled={busy}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-blue px-4 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition hover:bg-brand-bluehover disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Join meeting
                </button>
              </form>
            )}

            <div className="mt-7 flex items-center justify-center gap-2 border-t border-ink-100 pt-5 text-xs text-ink-400">
              <ShieldCheck className="h-3.5 w-3.5" /> Guest access is limited to this meeting
            </div>
          </div>

          <p className="mt-5 text-center text-sm text-ink-500">
            Have an account? <a href="/" className="font-bold text-brand-blue hover:underline inline-flex items-center gap-1"><LogIn className="h-3.5 w-3.5" /> Sign in</a>
          </p>
        </div>
      </main>
    </div>
  )
}
