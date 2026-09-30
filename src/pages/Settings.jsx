import { useEffect, useRef, useState } from 'react'
import { User, Video, Mic, Bell, Shield, Palette, Check, KeyRound, Laptop, LogOut, Smartphone, History, Loader2, Camera, Trash2 } from 'lucide-react'
import PageHeader, { Page } from '../components/PageHeader.jsx'
import { useApp } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { api } from '../api.js'
import { useSearchParams } from 'react-router-dom'
import { fileToAvatarBlob } from '../lib/image.js'

const sections = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'video', label: 'Video', icon: Video },
  { key: 'audio', label: 'Audio', icon: Mic },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'security', label: 'Security', icon: Shield },
  { key: 'appearance', label: 'Appearance', icon: Palette },
]

function Toggle({ on, onClick, label, desc }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-ink-100 last:border-0">
      <div>
        <p className="font-semibold text-ink-900 text-sm">{label}</p>
        {desc && <p className="text-[13px] text-ink-500 mt-0.5">{desc}</p>}
      </div>
      <button onClick={onClick} className={`w-11 h-6 rounded-full transition relative shrink-0 ${on ? 'bg-brand-blue' : 'bg-ink-200'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

export default function Settings() {
  const { state, saveProfile, saveAvatar, removeAvatar, setSetting, toast } = useApp()
  const [searchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const [active, setActive] = useState(sections.some((s) => s.key === requestedSection) ? requestedSection : 'profile')
  const s = state.settings
  const [profile, setProfile] = useState({ name: state.user.name, pmi: state.user.pmi })
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')

  // Keep the form in step with the account (e.g. after saving, or another tab).
  useEffect(() => { setProfile({ name: state.user.name, pmi: state.user.pmi }) }, [state.user.name, state.user.pmi])

  const fileRef = useRef(null)
  const [avatarBusy, setAvatarBusy] = useState(false)

  const pickAvatar = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''   // let the same file be chosen again after an error
    if (!file) return
    setAvatarBusy(true); setProfileError('')
    try {
      // Cropped and shrunk in the browser, so a 10 MB phone photo still uploads.
      const blob = await fileToAvatarBlob(file)
      await saveAvatar(blob)
      toast('Profile picture updated', 'check')
    } catch (e) { setProfileError(e.message || 'Could not update your picture') } finally { setAvatarBusy(false) }
  }

  const clearAvatar = async () => {
    setAvatarBusy(true); setProfileError('')
    try { await removeAvatar(); toast('Profile picture removed', 'check') }
    catch (e) { setProfileError(e.message || 'Could not remove your picture') } finally { setAvatarBusy(false) }
  }

  const hasCustomAvatar = (state.user.avatar || '').startsWith('/api/avatars/')
  const dirty = profile.name !== state.user.name || profile.pmi !== state.user.pmi
  const submitProfile = async () => {
    setProfileBusy(true); setProfileError('')
    try {
      await saveProfile({ name: profile.name.trim(), pmi: profile.pmi.trim() })
      toast('Profile saved', 'check')
    } catch (e) { setProfileError(e.message || 'Could not save your profile') } finally { setProfileBusy(false) }
  }

  useEffect(() => {
    if (sections.some((section) => section.key === requestedSection)) setActive(requestedSection)
  }, [requestedSection])

  return (
    <Page>
      <PageHeader title="Settings" subtitle="Manage your account and meeting preferences." />
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <div className="card p-2 h-max flex md:block gap-1 overflow-x-auto">
          {sections.map((sec) => {
            const Icon = sec.icon
            return (
              <button key={sec.key} onClick={() => setActive(sec.key)} className={`shrink-0 md:w-full flex items-center gap-2 md:gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${active === sec.key ? 'bg-blue-50 text-brand-blue' : 'text-ink-600 hover:bg-ink-50'}`}>
                <Icon className="w-4.5 h-4.5" /> {sec.label}
              </button>
            )
          })}
        </div>

        <div className="card p-4 sm:p-6">
          {active === 'profile' && (
            <div>
              <div className="flex items-center gap-5">
                <div className="relative shrink-0">
                  <img src={state.user.avatar} className="w-20 h-20 rounded-full object-cover ring-1 ring-ink-200" alt="" />
                  <button
                    type="button" onClick={() => fileRef.current?.click()} disabled={avatarBusy}
                    title="Change profile picture" aria-label="Change profile picture"
                    className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-brand-blue text-white shadow ring-2 ring-white transition hover:bg-brand-bluehover disabled:opacity-60"
                  >
                    {avatarBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  </button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickAvatar} />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-bold text-ink-900 truncate">{state.user.name}</p>
                  <p className="text-ink-500 truncate">{state.user.email}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-block px-2.5 py-1 rounded-md bg-blue-50 text-brand-blue text-xs font-bold">{state.user.plan}</span>
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={avatarBusy}
                      className="text-xs font-bold text-brand-blue hover:underline disabled:opacity-60">Change picture</button>
                    {hasCustomAvatar && (
                      <button type="button" onClick={clearAvatar} disabled={avatarBusy}
                        className="inline-flex items-center gap-1 text-xs font-bold text-ink-500 hover:text-red-600 disabled:opacity-60">
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                <Field label="Display name" value={profile.name} onChange={(v) => setProfile({ ...profile, name: v })} />
                <Field label="Personal Meeting ID" value={profile.pmi} onChange={(v) => setProfile({ ...profile, pmi: v })} hint="9-13 digits — the room people join when they call you." />
                <Field label="Email" value={state.user.email} readOnly hint="Your email is your sign-in identity and can't be changed here." />
                <Field label="Plan" value={state.user.plan} readOnly />
              </div>
              {profileError && <p className="mt-3 text-sm text-red-600">{profileError}</p>}
              <div className="mt-6 flex items-center gap-3">
                <button className="btn-primary inline-flex items-center gap-2 disabled:opacity-50" disabled={!dirty || profileBusy || !profile.name.trim()} onClick={submitProfile}>
                  {profileBusy && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
                </button>
                {dirty && <button className="btn-ghost" onClick={() => setProfile({ name: state.user.name, pmi: state.user.pmi })}>Discard</button>}
              </div>
            </div>
          )}

          {active === 'video' && (
            <Group title="Video">
              <Toggle on={s.hd} onClick={() => setSetting('hd', !s.hd)} label="Enable HD" desc="Requests 1280×720 instead of 640×360 from your camera" />
              <Toggle on={s.mirror} onClick={() => setSetting('mirror', !s.mirror)} label="Mirror my video" />
              <Toggle on={s.autoJoin} onClick={() => setSetting('autoJoin', !s.autoJoin)} label="Turn on video when joining" desc="Applies the next time you join a meeting" />
            </Group>
          )}

          {active === 'audio' && (
            <Group title="Audio">
              <Toggle on={s.suppressNoise} onClick={() => setSetting('suppressNoise', !s.suppressNoise)} label="Suppress background noise" desc="Enables your browser's noise suppression on the microphone" />
              <Toggle on={s.joinSound} onClick={() => setSetting('joinSound', !s.joinSound)} label="Play a sound when someone joins" desc="A short chime whenever a participant enters your meeting" />
            </Group>
          )}

          {active === 'notifications' && (
            <Group title="Notifications">
              <Toggle on={s.desktopNotif} onClick={() => setSetting('desktopNotif', !s.desktopNotif)} label="Desktop notifications" />
              <Toggle on={s.notifSound} onClick={() => setSetting('notifSound', !s.notifSound)} label="Notification sounds" />
            </Group>
          )}

          {active === 'security' && (
            <SecurityPanel toast={toast} />
          )}

          {active === 'appearance' && (
            <Group title="Appearance">
              <p className="text-sm text-ink-500 mb-3">Choose your theme — applies instantly across the app.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {['Light', 'Dark', 'System'].map((t, i) => (
                  <button key={t} onClick={() => { setSetting('theme', t); toast(`${t} theme applied`, 'check') }} className={`rounded-xl border-2 p-4 text-left transition ${s.theme === t ? 'border-brand-blue' : 'border-ink-200'}`}>
                    <div className={`h-16 rounded-lg mb-2 ${i === 0 ? 'bg-white border border-ink-200' : i === 1 ? 'bg-ink-900' : 'bg-gradient-to-br from-white to-ink-900'}`} />
                    <p className="text-sm font-semibold text-ink-900 flex items-center gap-1">{t} {s.theme === t && <Check className="w-3.5 h-3.5 text-brand-blue" />}</p>
                  </button>
                ))}
              </div>
            </Group>
          )}
        </div>
      </div>
    </Page>
  )
}

function SecurityPanel({ toast }) {
  const { user, setUser } = useAuth()
  const [sessions, setSessions] = useState([])
  const [events, setEvents] = useState([])
  const [passwords, setPasswords] = useState({ current: '', next: '' })
  const [mfa, setMfa] = useState(null)
  const [code, setCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const refresh = async () => {
    const [sessionData, eventData] = await Promise.all([api.sessions(), api.authEvents()])
    setSessions(sessionData); setEvents(eventData)
  }
  useEffect(() => { refresh().catch(() => {}) }, [])
  const run = async (key, fn, message) => {
    setBusy(key); setError('')
    try { await fn(); if (message) toast(message, 'check'); await refresh() } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const setupMfa = () => run('mfa', async () => setMfa(await api.mfaSetup()))
  const eventLabel = (type) => ({ 'login.succeeded': 'Signed in', 'login.mfa_succeeded': 'Signed in with MFA', 'password.changed': 'Password changed', 'mfa.enabled': 'Two-factor authentication enabled', 'mfa.disabled': 'Two-factor authentication disabled', 'session.revoked': 'Session revoked', 'sessions.revoked_all': 'Other sessions signed out', 'account.created': 'Account created' }[type] || type.replaceAll('.', ' '))

  return <div>
    <div className="flex items-start justify-between gap-4">
      <div><h3 className="text-lg font-bold text-ink-900">Security & access</h3><p className="mt-1 text-sm text-ink-500">Protect your identity and review account activity.</p></div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700"><Shield className="h-3.5 w-3.5" /> Account protected</span>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    <SecurityCard icon={KeyRound} title="Password" subtitle="Changing it signs out every other device.">
      <div className="grid gap-3 sm:grid-cols-2"><SecureInput label="Current password" value={passwords.current} onChange={(v) => setPasswords({ ...passwords, current: v })} /><SecureInput label="New password" value={passwords.next} onChange={(v) => setPasswords({ ...passwords, next: v })} /></div>
      <button disabled={busy || !passwords.current || !passwords.next} onClick={() => run('password', () => api.changePassword(passwords.current, passwords.next), 'Password changed securely')} className="btn-primary mt-3 inline-flex items-center gap-2">{busy === 'password' && <Loader2 className="h-4 w-4 animate-spin" />} Update password</button>
    </SecurityCard>

    <SecurityCard icon={Smartphone} title="Two-factor authentication" subtitle={user.mfaEnabled ? 'Authenticator verification is required at every sign in.' : 'Add a second layer of protection to your account.'}>
      {user.mfaEnabled ? <div className="flex flex-col gap-3 sm:flex-row"><SecureInput label="Password to disable MFA" value={disablePassword} onChange={setDisablePassword} /><button disabled={busy || !disablePassword} onClick={() => run('disable-mfa', async () => { await api.mfaDisable(disablePassword); setUser({ ...user, mfaEnabled: false }); setDisablePassword('') }, 'Two-factor authentication disabled')} className="btn-ghost self-end h-11 text-red-600">Disable MFA</button></div> : mfa ? <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4"><p className="text-sm font-semibold text-ink-900">Add this setup key to your authenticator app</p><code className="mt-2 block break-all rounded-lg bg-white p-3 text-sm font-bold tracking-wider text-blue-700">{mfa.secret}</code><div className="mt-3 flex gap-2"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" className="h-11 min-w-0 flex-1 rounded-xl border border-ink-200 px-3.5 outline-none focus:border-brand-blue" /><button disabled={busy || code.length !== 6} onClick={() => run('enable-mfa', async () => { await api.mfaEnable(code); setUser({ ...user, mfaEnabled: true }); setMfa(null) }, 'Two-factor authentication enabled')} className="btn-primary">Confirm</button></div></div> : <button disabled={busy} onClick={setupMfa} className="btn-primary inline-flex items-center gap-2">Set up authenticator</button>}
    </SecurityCard>

    <SecurityCard icon={Laptop} title="Active sessions" subtitle="Devices currently signed in to your account." action={<button onClick={() => run('all', () => api.logoutAll(), 'Other sessions signed out')} className="text-xs font-bold text-red-600 hover:underline">Sign out other devices</button>}>
      <div className="divide-y divide-ink-100">{sessions.map((session) => <div key={session.id} className="flex items-center gap-3 py-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-ink-50"><Laptop className="h-4 w-4 text-ink-500" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-900">{friendlyDevice(session.user_agent)} {session.current && <span className="ml-1 text-xs text-emerald-600">This device</span>}</p><p className="text-xs text-ink-500">{session.ip || 'Private network'} · Active {relativeTime(session.last_seen_at)}</p></div>{!session.current && <button title="Revoke session" onClick={() => run(session.id, () => api.revokeSession(session.id), 'Session revoked')} className="rounded-lg p-2 text-ink-400 hover:bg-red-50 hover:text-red-600"><LogOut className="h-4 w-4" /></button>}</div>)}</div>
    </SecurityCard>

    <SecurityCard icon={History} title="Security activity" subtitle="Recent identity and access events.">
      <div className="divide-y divide-ink-100">{events.slice(0, 8).map((event) => <div key={event.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-semibold capitalize text-ink-900">{eventLabel(event.type)}</p><p className="text-xs text-ink-500">{event.ip || 'Private network'}</p></div><time className="shrink-0 text-xs text-ink-400">{relativeTime(event.created_at)}</time></div>)}</div>
    </SecurityCard>
  </div>
}

function SecurityCard({ icon: Icon, title, subtitle, action, children }) {
  return <section className="mt-5 rounded-2xl border border-ink-200 p-4 sm:p-5"><div className="mb-4 flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50"><Icon className="h-4 w-4 text-brand-blue" /></div><div className="min-w-0 flex-1"><h4 className="text-sm font-bold text-ink-900">{title}</h4><p className="mt-0.5 text-xs text-ink-500">{subtitle}</p></div>{action}</div>{children}</section>
}
function SecureInput({ label, value, onChange }) { return <label className="block flex-1"><span className="text-xs font-semibold text-ink-700">{label}</span><input type="password" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 px-3.5 text-sm outline-none focus:border-brand-blue" /></label> }
function friendlyDevice(ua = '') { if (/iPhone|iPad/.test(ua)) return 'Safari on iOS'; if (/Android/.test(ua)) return 'Browser on Android'; if (/Edg\//.test(ua)) return 'Microsoft Edge'; if (/Firefox\//.test(ua)) return 'Mozilla Firefox'; if (/Chrome\//.test(ua)) return 'Google Chrome'; if (/Safari\//.test(ua)) return 'Safari'; return 'Unknown browser' }
function relativeTime(ts) { const mins = Math.max(0, Math.round((Date.now() - ts) / 60000)); if (mins < 2) return 'just now'; if (mins < 60) return `${mins}m ago`; const hours = Math.round(mins / 60); if (hours < 24) return `${hours}h ago`; return new Date(ts).toLocaleDateString() }

function Field({ label, value, onChange, readOnly = false, hint }) {
  return (
    <div>
      <label className="text-sm font-semibold text-ink-700">{label}</label>
      <input
        value={value ?? ''} readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={`w-full h-11 rounded-xl border border-ink-200 px-3.5 text-sm mt-1.5 outline-none focus:border-brand-blue ${readOnly ? 'bg-ink-50 text-ink-500 cursor-not-allowed' : ''}`}
      />
      {hint && <p className="mt-1 text-[11.5px] text-ink-400">{hint}</p>}
    </div>
  )
}

function Group({ title, children }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-ink-900 mb-2">{title}</h3>
      <div>{children}</div>
    </div>
  )
}
