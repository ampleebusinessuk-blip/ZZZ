export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5 sm:mb-6">
      <div>
        <h1 className="text-[24px] font-extrabold text-ink-900">{title}</h1>
        {subtitle && <p className="text-ink-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap sm:justify-end">{actions}</div>}
    </div>
  )
}

export function Page({ children }) {
  return <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">{children}</div>
}
