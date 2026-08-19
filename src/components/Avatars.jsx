import { useApp } from '../store.jsx'

export default function AvatarStack({ ids = [], extra = 0, size = 30 }) {
  const { state } = useApp()
  const byId = Object.fromEntries((state.contacts || []).map((p) => [p.id, p]))
  const known = ids.filter((id) => byId[id])
  const real = known.slice(0, 4)
  // Anyone we can't resolve to a contact still counts toward the "+N" badge.
  const overflow = extra + (ids.length - known.length) + (known.length - real.length)

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {real.map((id) => (
          <img
            key={id}
            src={byId[id].avatar}
            alt={byId[id].name}
            title={byId[id].name}
            className="rounded-full ring-2 ring-white dark:ring-[#1B2029] object-cover"
            style={{ width: size, height: size }}
          />
        ))}
      </div>
      {overflow > 0 && (
        <span
          className="ml-1 grid place-items-center rounded-full bg-ink-100 text-ink-600 text-[11px] font-semibold ring-2 ring-white dark:ring-[#1B2029] dark:bg-[#2A2F3A] dark:text-ink-300"
          style={{ width: size, height: size }}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}
