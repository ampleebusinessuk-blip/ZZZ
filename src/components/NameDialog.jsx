import { useState } from 'react'
import { X } from 'lucide-react'

// Small reusable "enter a name" dialog to replace window.prompt.
export default function NameDialog({ title = 'Name', label = 'Name', initial = '', confirmText = 'Create', onCancel, onConfirm }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="fixed inset-0 z-[60] bg-ink-900/50 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4 animate-fade" onMouseDown={onCancel}>
      <div onMouseDown={(e) => e.stopPropagation()} className="animate-pop w-full max-w-sm bg-white rounded-t-[24px] sm:rounded-2xl shadow-soft overflow-hidden">
        <div className="flex items-center justify-between px-6 h-14 border-b border-ink-200">
          <h3 className="font-bold text-ink-900">{title}</h3>
          <button onClick={onCancel} className="text-ink-400 hover:text-ink-700 p-1 rounded-lg hover:bg-ink-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
          <label className="text-sm font-semibold text-ink-700">{label}</label>
          <input
            autoFocus value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()) }}
            className="w-full h-11 rounded-xl border border-ink-200 px-3.5 text-sm mt-1.5 outline-none focus:border-brand-blue"
          />
        </div>
        <div className="px-6 py-4 bg-ink-50 border-t border-ink-200 flex justify-end gap-3">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary disabled:opacity-50" disabled={!value.trim()} onClick={() => onConfirm(value.trim())}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}
