import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from './auth.jsx'
import { AppProvider } from './store.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Modals from './components/Modals.jsx'
import Toasts from './components/Toasts.jsx'

// Route-level code-splitting: each page ships as its own chunk, loaded on demand.
const Home = lazy(() => import('./pages/Home.jsx'))
const Meetings = lazy(() => import('./pages/Meetings.jsx'))
const Calendar = lazy(() => import('./pages/Calendar.jsx'))
const Contacts = lazy(() => import('./pages/Contacts.jsx'))
const TeamChat = lazy(() => import('./pages/TeamChat.jsx'))
const Whiteboards = lazy(() => import('./pages/Whiteboards.jsx'))
const Recordings = lazy(() => import('./pages/Recordings.jsx'))
const Docs = lazy(() => import('./pages/Docs.jsx'))
const Clips = lazy(() => import('./pages/Clips.jsx'))
const Notes = lazy(() => import('./pages/Notes.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const Meeting = lazy(() => import('./pages/Meeting.jsx'))
const GuestJoin = lazy(() => import('./pages/GuestJoin.jsx'))

function Splash() {
  return (
    <div className="min-h-screen grid place-items-center bg-[#F5F7FB] dark:bg-[#0B0E14]">
      <Loader2 className="w-8 h-8 text-brand-blue animate-spin" />
    </div>
  )
}

const PageFallback = () => (
  <div className="grid place-items-center py-32">
    <Loader2 className="w-6 h-6 text-brand-blue animate-spin" />
  </div>
)

export default function App() {
  const { status } = useAuth()
  const location = useLocation()

  /* The guest door is public: it must render before any auth gate, or an invite
     link would bounce the visitor to a sign-in screen they cannot pass. */
  if (location.pathname.startsWith('/join/')) {
    return (
      <Suspense fallback={<Splash />}>
        <Routes><Route path="/join/:room" element={<GuestJoin />} /></Routes>
      </Suspense>
    )
  }

  if (status === 'loading') return <Splash />
  if (status === 'guest') return <Login />

  // Authenticated: mount the data store + real-time layer.
  const inMeeting = location.pathname === '/meeting' || location.pathname.startsWith('/meeting/')

  return (
    <AppProvider>
      {inMeeting ? (
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="/meeting" element={<Meeting />} />
            <Route path="/meeting/:id" element={<Meeting />} />
          </Routes>
        </Suspense>
      ) : (
        <Layout>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/meetings" element={<Meetings />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/team-chat" element={<TeamChat />} />
              <Route path="/whiteboards" element={<Whiteboards />} />
              <Route path="/recordings" element={<Recordings />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/clips" element={<Clips />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </Layout>
      )}
      <Modals />
      <Toasts />
    </AppProvider>
  )
}
