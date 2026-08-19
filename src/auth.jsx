import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { api, setCsrfToken, setUnauthorizedHandler } from './api.js'
import { rt } from './realtime.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'authed' | 'guest'
  const statusRef = useRef(status)
  statusRef.current = status

  const signOutLocally = useCallback(() => {
    rt.disconnect(); setCsrfToken(''); setUser(null); setStatus('guest')
  }, [])

  // Any 401 from the API means the session is gone (expired, or revoked from
  // another device). Drop straight to the sign-in screen instead of leaving the
  // app in a half-broken state where every request silently fails.
  useEffect(() => {
    setUnauthorizedHandler(() => { if (statusRef.current === 'authed') signOutLocally() })
    return () => setUnauthorizedHandler(null)
  }, [signOutLocally])

  // On boot, validate the secure server-side session cookie.
  useEffect(() => {
    api.me()
      .then(({ user }) => { setUser(user); setStatus('authed'); rt.connect() })
      .catch(() => { setCsrfToken(''); setStatus('guest') })
  }, [])

  const login = useCallback(async (email, password) => {
    const result = await api.login(email, password)
    if (result.mfaRequired) return result
    setUser(result.user); setStatus('authed'); rt.connect()
    return result.user
  }, [])

  const verifyMfa = useCallback(async (challenge, code) => {
    const { user } = await api.verifyMfa(challenge, code)
    setUser(user); setStatus('authed'); rt.connect(); return user
  }, [])

  const register = useCallback(async (email, name, password) => {
    const { user } = await api.register(email, name, password)
    setUser(user); setStatus('authed'); rt.connect()
    return user
  }, [])

  const logout = useCallback(async () => {
    try { await api.logout() } catch {}
    signOutLocally()
  }, [signOutLocally])

  return (
    <AuthContext.Provider value={{ user, status, login, register, verifyMfa, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
