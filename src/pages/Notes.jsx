import { useState } from 'react'
import { Plus, StickyNote, Trash2, X } from 'lucide-react'
import PageHeader, { Page } from '../components/PageHeader.jsx'
import RichEditor from '../components/RichEditor.jsx'
import { useApp } from '../store.jsx'
import { relativeTime } from '../dates.js'

const palette = ['bg-amber-50 border-amber-200', 'bg-blue-50 border-blue-200', 'bg-emerald-50 border-emerald-200', 'bg-pink-50 border-pink-200', 'bg-violet-50 border-violet-200']
const stripHtml = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

export default function Notes() {
  const { state, addItem, updateItem, deleteItem, toast, uid } = useApp()
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ title: '', content: '' })

  const openNew = () => {
    setEditing({ id: uid(), title: '', content: '', updatedAt: Date.now(), color: palette[state.notes.length % palette.length], isNew: true })
    setDraft({ title: '', content: '' })
  }
  const openEdit = (n) => { setEditing(n); setDraft({ title: n.title, content: n.content || `<p>${n.preview || ''}</p>` }) }

  const save = () => {
    const preview = stripHtml(draft.content).slice(0, 140)
    if (editing.isNew) {
      if (draft.title.trim() || preview) { addItem('notes', { ...editing, isNew: undefined, title: draft.title || 'Untitled', content: draft.content, preview, updatedAt: Date.now() }); toast('Note saved', 'check') }
    } else {
      updateItem('notes', editing.id, { title: draft.title || 'Untitled', content: draft.content, preview, updatedAt: Date.now() }); toast('Note updated', 'check')
    }
    setEditing(null)
  }

  return (
    <Page>
      <PageHeader
        title="Notes"
        subtitle="Quick personal notes and meeting takeaways."
        actions={<button className="btn-primary flex items-center gap-1.5" onClick={openNew}><Plus className="w-4 h-4" /> New Note</button>}
      />
      {state.notes.length === 0 ? (
        <div className="card p-12 text-center text-ink-500">No notes yet — capture your first one.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {state.notes.map((n) => (
            <div key={n.id} onClick={() => openEdit(n)} className={`rounded-2xl border p-5 min-h-[160px] hover:shadow-soft transition cursor-pointer group relative ${n.color}`}>
              <button onClick={(e) => { e.stopPropagation(); deleteItem('notes', n.id); toast('Note deleted', 'check') }} className="absolute top-3 right-3 text-ink-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><Trash2 className="w-4 h-4" /></button>
              <div className="flex items-center gap-2 mb-2"><StickyNote className="w-4 h-4 text-ink-500" /><p className="font-bold text-ink-900">{n.title}</p></div>
              <p className="text-sm text-ink-600 leading-relaxed line-clamp-4">{n.preview}</p>
              <p className="text-xs text-ink-400 mt-4">Edited {relativeTime(n.updatedAt) || n.edited || 'recently'}</p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-ink-900/50 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4 animate-fade" onMouseDown={() => setEditing(null)}>
          <div onMouseDown={(e) => e.stopPropagation()} className="animate-pop w-full max-w-lg bg-white rounded-t-[24px] sm:rounded-2xl shadow-soft overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[85vh]">
            <div className="flex items-center justify-between px-6 h-14 border-b border-ink-200 shrink-0">
              <h3 className="font-bold text-ink-900">{editing.isNew ? 'New Note' : 'Edit Note'}</h3>
              <button onClick={() => setEditing(null)} className="text-ink-400 hover:text-ink-700 p-1 rounded-lg hover:bg-ink-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 sm:p-6 flex-1 min-h-0 flex flex-col">
              <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Note title" className="w-full text-lg font-bold outline-none bg-transparent text-ink-900 placeholder:text-ink-300 mb-3 shrink-0" />
              <RichEditor value={draft.content} onChange={(html) => setDraft({ ...draft, content: html })} placeholder="Start typing…" />
            </div>
            <div className="px-6 py-4 bg-ink-50 border-t border-ink-200 flex justify-end gap-3 shrink-0">
              <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}
