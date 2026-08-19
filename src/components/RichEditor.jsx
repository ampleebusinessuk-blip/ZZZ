import { useRef, useEffect } from 'react'
import { Bold, Italic, Underline, Heading1, Heading2, List, ListOrdered } from 'lucide-react'

// Lightweight contentEditable rich-text editor (bold/italic/headings/lists).
export default function RichEditor({ value, onChange, placeholder = 'Start writing…', autoFocus }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (autoFocus) ref.current?.focus() }, [autoFocus])

  const cmd = (command, arg) => {
    document.execCommand(command, false, arg)
    ref.current?.focus()
    onChange?.(ref.current?.innerHTML || '')
  }

  const tools = [
    { icon: Bold, cmd: () => cmd('bold'), title: 'Bold' },
    { icon: Italic, cmd: () => cmd('italic'), title: 'Italic' },
    { icon: Underline, cmd: () => cmd('underline'), title: 'Underline' },
    { icon: Heading1, cmd: () => cmd('formatBlock', 'H1'), title: 'Heading 1' },
    { icon: Heading2, cmd: () => cmd('formatBlock', 'H2'), title: 'Heading 2' },
    { icon: List, cmd: () => cmd('insertUnorderedList'), title: 'Bullet list' },
    { icon: ListOrdered, cmd: () => cmd('insertOrderedList'), title: 'Numbered list' },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-0.5 border-b border-ink-200 pb-2 mb-3 flex-wrap">
        {tools.map((t, i) => {
          const Icon = t.icon
          return (
            <button key={i} type="button" title={t.title} onMouseDown={(e) => { e.preventDefault(); t.cmd() }}
              className="w-8 h-8 grid place-items-center rounded-lg text-ink-600 hover:bg-ink-100 transition">
              <Icon className="w-4 h-4" />
            </button>
          )
        })}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange?.(ref.current?.innerHTML || '')}
        data-placeholder={placeholder}
        className="rich-editor flex-1 min-h-[220px] outline-none text-[15px] leading-relaxed text-ink-800 overflow-y-auto"
      />
    </div>
  )
}
