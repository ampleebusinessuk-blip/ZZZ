import { useMemo, useState } from 'react'
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, ShieldCheck, Sparkles, Video } from 'lucide-react'
import { useAuth } from '../auth.jsx'
import { api } from '../api.js'
import Logo from '../components/Logo.jsx'

export default function Login() {
  const { login, register, verifyMfa } = useAuth()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', code: '', token: '' })
  const [challenge, setChallenge] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const strength = useMemo(() => [form.password.length >= 12, /[A-Z]/.test(form.password), /\d/.test(form.password), /[^A-Za-z0-9]/.test(form.password)].filter(Boolean).length, [form.password])

  const switchMode = (next) => { setMode(next); setError(''); setNotice('') }
  const submit = async (e) => {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true)
    try {
      if (mode === 'register') await register(form.email, form.name, form.password)
      else if (mode === 'mfa') await verifyMfa(challenge, form.code)
      else if (mode === 'forgot') {
        const result = await api.forgotPassword(form.email)
        setNotice('If that account exists, a secure reset link has been sent.')
        if (result.resetToken) { setForm((f) => ({ ...f, token: result.resetToken, password: '' })); setMode('reset') }
      } else if (mode === 'reset') {
        await api.resetPassword(form.token, form.password); setNotice('Password updated. You can now sign in.'); setMode('login')
      } else {
        const result = await login(form.email, form.password)
        if (result?.mfaRequired) { setChallenge(result.challenge); setForm((f) => ({ ...f, code: '' })); setMode('mfa') }
      }
    } catch (err) { setError(err.message || 'Something went wrong') } finally { setBusy(false) }
  }

  const title = { login: 'Welcome back', register: 'Create your workspace', forgot: 'Reset your password', reset: 'Choose a new password', mfa: 'Verify it’s you' }[mode]
  const subtitle = { login: 'Sign in to your secure collaboration hub.', register: 'Start with enterprise-grade controls from day one.', forgot: 'We’ll send a time-limited recovery link.', reset: 'Your new password will sign out other devices.', mfa: 'Enter the 6-digit code from your authenticator app.' }[mode]

  return (
    <div className="min-h-screen bg-[#07111f] text-white grid lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden p-14 xl:p-20 border-r border-white/10">
        <div className="absolute inset-0 auth-grid opacity-40" />
        <div className="absolute -top-32 -left-28 h-96 w-96 rounded-full bg-blue-500/25 blur-3xl" />
        <div className="absolute bottom-10 right-0 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <Logo className="relative z-10" invert height={30} />
        <div className="relative z-10 max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold text-blue-200"><Sparkles className="h-3.5 w-3.5" /> Secure collaboration, beautifully simple</div>
          <h1 className="mt-7 text-5xl xl:text-6xl font-black tracking-[-0.045em] leading-[1.04]">Your team’s best work, in one place.</h1>
          <p className="mt-6 text-lg leading-8 text-slate-300 max-w-lg">Meet, message, create and decide—protected by modern identity controls and designed for teams that move fast.</p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {[['99.99%', 'Service target'], ['AES-256', 'Data protection'], ['24/7', 'Security monitoring']].map(([value, label]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/[.055] p-4 backdrop-blur"><p className="text-xl font-bold">{value}</p><p className="mt-1 text-xs text-slate-400">{label}</p></div>)}
          </div>
        </div>
        <p className="relative z-10 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Built with secure sessions, CSRF protection and account auditing</p>
      </section>

      <section className="relative flex min-h-screen items-center justify-center bg-[#f7f9fc] px-5 py-10 text-ink-900">
        <div className="absolute top-7 left-7 lg:hidden"><Logo /></div>
        <div className="w-full max-w-[440px]">
          {mode !== 'login' && <button type="button" onClick={() => switchMode('login')} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Back to sign in</button>}
          <div className="rounded-[28px] border border-slate-200/80 bg-white p-7 sm:p-9 shadow-[0_24px_80px_rgba(15,23,42,.10)]">
            <div className="mb-7 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-500/20">{mode === 'mfa' ? <ShieldCheck className="h-6 w-6 text-white" /> : mode.includes('reset') || mode === 'forgot' ? <KeyRound className="h-6 w-6 text-white" /> : <Video className="h-6 w-6 text-white" />}</div>
            <h2 className="text-[28px] font-black tracking-[-0.03em]">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-ink-500">{subtitle}</p>
            <form onSubmit={submit} className="mt-7 space-y-4">
              {mode === 'register' && <Field label="Full name" value={form.name} onChange={set('name')} placeholder="Jane Doe" autoComplete="name" required />}
              {['login', 'register', 'forgot'].includes(mode) && <Field label="Work email" type="email" value={form.email} onChange={set('email')} placeholder="you@company.com" autoComplete="email" required />}
              {['login', 'register', 'reset'].includes(mode) && <div><Field label={mode === 'reset' ? 'New password' : 'Password'} type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} placeholder={mode === 'login' ? 'Enter your password' : '12+ secure characters'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required trailing={<button type="button" onClick={() => setShowPassword(!showPassword)} className="text-ink-400 hover:text-ink-700" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>} />{mode !== 'login' && <PasswordMeter strength={strength} />}</div>}
              {mode === 'mfa' && <Field label="Authentication code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={form.code} onChange={set('code')} placeholder="000000" autoComplete="one-time-code" className="text-center text-xl tracking-[.35em]" required />}
              {mode === 'login' && <div className="flex justify-end"><button type="button" onClick={() => switchMode('forgot')} className="text-sm font-semibold text-blue-600 hover:text-blue-700">Forgot password?</button></div>}
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</div>}
              {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700">{notice}</div>}
              <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1668e8] px-4 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700 disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{mode === 'login' ? 'Sign in securely' : mode === 'register' ? 'Create secure account' : mode === 'mfa' ? 'Verify and continue' : mode === 'reset' ? 'Update password' : 'Send reset link'}</button>
            </form>
            {['login', 'register'].includes(mode) && <p className="mt-6 text-center text-sm text-ink-500">{mode === 'login' ? 'New to Zoom17? ' : 'Already have an account? '}<button onClick={() => switchMode(mode === 'login' ? 'register' : 'login')} className="font-bold text-blue-600 hover:underline">{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>}
            <div className="mt-7 flex items-center justify-center gap-2 border-t border-ink-100 pt-5 text-xs text-ink-400"><LockKeyhole className="h-3.5 w-3.5" /> Protected by encrypted, revocable sessions</div>
          </div>
          <p className="mt-5 text-center text-xs text-ink-400">By continuing, you agree to the Terms and Privacy Policy.</p>
        </div>
      </section>
    </div>
  )
}

function Field({ label, trailing, className = '', ...props }) {
  return <label className="block"><span className="text-sm font-bold text-ink-700">{label}</span><span className="relative mt-1.5 block"><input {...props} className={`h-12 w-full rounded-xl border border-ink-200 bg-white px-3.5 pr-11 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 ${className}`} />{trailing && <span className="absolute right-3.5 top-1/2 -translate-y-1/2">{trailing}</span>}</span></label>
}

function PasswordMeter({ strength }) {
  return <div className="mt-2"><div className="flex gap-1">{[1,2,3,4].map((n) => <span key={n} className={`h-1 flex-1 rounded-full ${strength >= n ? strength < 3 ? 'bg-amber-400' : 'bg-emerald-500' : 'bg-ink-100'}`} />)}</div><p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-500">{strength === 4 && <Check className="h-3 w-3 text-emerald-500" />} 12+ characters with uppercase, number and symbol</p></div>
}
