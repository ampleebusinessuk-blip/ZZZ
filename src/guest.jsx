import { useState, useCallback, useMemo, useEffect } from 'react'
import { AppContext } from './store.jsx'

const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10))

/*
  Guests have no workspace: no contacts, no channels, no library, no settings
  document. Rather than teach every meeting component about that, this provides
  the same context shape the signed-in app provides, with the workspace parts
  empty and the member-only actions refusing loudly.

  That keeps MeshRoom identical for members and guests.
*/
const guestSettings = {
  hd: true, mirror: true, autoJoin: true, suppressNoise: true,
  joinSound: false, desktopNotif: false, notifSound: false, theme: 'Light',
}

export function GuestProvider({ guest, children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((message, icon = 'check') => {
    const id = uid()
    setToasts((t) => [...t, { id, message, icon }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  // Guests join as themselves, so the app should never sit in dark mode
  // inherited from a previous member session in the same browser.
  useEffect(() => { document.documentElement.classList.remove('dark') }, [])

  const value = useMemo(() => ({
    state: {
      user: guest,
      settings: guestSettings,
      meetings: [], channels: [], messages: {}, contacts: [],
      whiteboards: [], docs: [], clips: [], notes: [], recordings: [],
      notifications: [], online: [], storage: { used: 0, quota: 0 },
      activeChannel: null, chatFocused: false, hydrated: true,
    },
    toasts,
    toast,
    uid,
    // Recording uploads into a personal library need an account.
    uploadMedia: async () => { throw new Error('Sign in to save recordings to a library') },
    modal: null,
    openModal: () => {},
    closeModal: () => {},
  }), [guest, toasts, toast])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
