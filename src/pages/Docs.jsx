import { useState } from 'react'
import { Plus, FileText, Trash2, Star, ArrowLeft } from 'lucide-react'
import PageHeader, { Page } from '../components/PageHeader.jsx'
import RichEditor from '../components/RichEditor.jsx'
import { useApp } from '../store.jsx'
import { relativeTime } from '../dates.js'

const templates = {
  Blank: '',
  'Meeting Notes': '<h1>Meeting Notes</h1><p><b>Date:</b> </p><p><b>Attendees:</b> </p><h2>Agenda</h2><ul><li></li></ul><h2>Action items</h2><ul><li></li></ul>',
  'Project Plan': '<h1>Project Plan</h1><h2>Goal</h2><p></p><h2>Milestones</h2><ol><li></li></ol><h2>Risks</h2><ul><li></li></ul>',
  'Weekly Update': '<h1>Weekly Update</h1><h2>Highlights</h2><ul><li></li></ul><h2>Next week</h2><ul><li></li></ul>',
}

export default function Docs() {
  const { state, addItem, deleteItem, updateItem, toast, uid } = useApp()
  const [editing, setEditing] = useState(null) // {id, title, content, isNew}
  const [draft, setDraft] = useState({ title: '', content: '' })

  const openNew = (tpl) => {
    const doc = { id: uid(), title: tpl === 'Blank' ? 'Untitled doc' : tpl, content: templates[tpl] || '', updatedAt: Date.now(), owner: state.user.name, starred: false, isNew: true }
    setDraft({ title: doc.title, content: doc.content }); setEditing(doc)
  }
  const openEdit = (d) => { setDraft({ title: d.title, content: d.content || '' }); setEditing(d) }
  const save = () => {
    if (editing.isNew) addItem('docs', { ...editing, isNew: undefined, title: draft.title || 'Untitled doc', content: draft.content, updatedAt: Date.now() })
    else updateItem('docs', editing.id, { title: draft.title || 'Untitled doc', content: draft.content, updatedAt: Date.now() })
    toast('Doc saved', 'check'); setEditing(null)
  }

  if (editing) {
    return (
      <div className="fixed inset-0 z-40 bg-white dark:bg-[#0B0E14] flex flex-col">
        <div className="h-16 border-b border-ink-200 px-3 sm:px-6 flex items-center gap-2 sm:gap-4">
          <button onClick={() => setEditing(null)} className="w-9 h-9 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-600"><ArrowLeft className="w-5 h-5" /></button>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="flex-1 text-lg font-bold outline-none bg-transparent text-ink-900" placeholder="Untitled doc" />
          <button className="btn-ghost hidden sm:block" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </div>
        <div className="flex-1 min-h-0 max-w-3xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <RichEditor value={draft.content} onChange={(html) => setDraft({ ...draft, content: html })} autoFocus placeholder="Start writing your doc…" />
        </div>
      </div>
    )
  }

  return (
    <Page>
      <PageHeader
        title="Docs"
        subtitle="Create and collaborate on documents connected to your meetings."
        actions={<button className="btn-primary flex items-center gap-1.5" onClick={() => openNew('Blank')}><Plus className="w-4 h-4" /> New Doc</button>}
      />
      <div className="flex gap-4 mb-6 overflow-x-auto pb-1">
        {Object.keys(templates).map((t) => (
          <button key={t} onClick={() => openNew(t)} className="shrink-0 w-40 card p-4 hover:shadow-soft transition text-left">
            <div className="w-10 h-10 rounded-lg bg-blue-50 grid place-items-center mb-3"><FileText className="w-5 h-5 text-brand-blue" /></div>
            <p className="font-semibold text-ink-900 text-sm">{t}</p>
            <p className="text-xs text-ink-500 mt-0.5">Template</p>
          </button>
        ))}
      </div>

      <p className="text-sm font-semibold text-ink-500 mb-3">Recent</p>
      {state.docs.length === 0 ? (
        <div className="card p-12 text-center text-ink-500">No docs yet — create one from a template above.</div>
      ) : (
        <div className="card divide-y divide-ink-100">
          {state.docs.map((d) => (
            <div key={d.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-ink-50/60 transition cursor-pointer" onClick={() => openEdit(d)}>
              <div className="w-10 h-10 rounded-lg bg-blue-50 grid place-items-center shrink-0"><FileText className="w-5 h-5 text-brand-blue" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 truncate">{d.title}</p>
                <p className="text-[12.5px] text-ink-500">Edited {relativeTime(d.updatedAt) || d.edited || 'recently'} · {d.owner}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); updateItem('docs', d.id, { starred: !d.starred }) }} className={d.starred ? 'text-amber-400' : 'text-ink-300 hover:text-amber-400'}><Star className="w-4 h-4" fill={d.starred ? 'currentColor' : 'none'} /></button>
              <button onClick={(e) => { e.stopPropagation(); deleteItem('docs', d.id); toast('Doc deleted', 'check') }} className="text-ink-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}
