import Sidebar from './Sidebar.jsx'
import Topbar from './Topbar.jsx'
import MobileNav from './MobileNav.jsx'

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-[#F5F7FB] dark:bg-[#0B0E14]">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        <main className="flex-1 min-w-0 pb-[76px] lg:pb-0">{children}</main>
      </div>
      <MobileNav />
    </div>
  )
}
