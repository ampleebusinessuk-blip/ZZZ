import { CheckCircle2, Info, Video } from 'lucide-react'
import { useApp } from '../store.jsx'

const icons = { check: CheckCircle2, info: Info, video: Video }

export default function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5">
      {toasts.map((t) => {
        const Icon = icons[t.icon] || CheckCircle2
        return (
          <div
            key={t.id}
            className="animate-pop flex items-center gap-3 bg-ink-900 text-white pl-4 pr-5 py-3 rounded-xl shadow-soft min-w-[260px]"
          >
            <Icon className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-sm font-medium">{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}
