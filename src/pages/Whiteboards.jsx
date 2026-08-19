import { useState, useEffect } from 'react'
import { Plus, PenTool, Trash2, Users } from 'lucide-react'
import PageHeader, { Page } from '../components/PageHeader.jsx'
import WhiteboardCanvas from '../components/WhiteboardCanvas.jsx'
import NameDialog from '../components/NameDialog.jsx'
import { useApp } from '../store.jsx'
import { relativeTime } from '../dates.js'

const colors = ['from-blue-400 to-indigo-500', 'from-pink-400 to-rose-500', 'from-emerald-400 to-teal-500', 'from-amber-400 to-orange-500', 'from-violet-400 to-fuchsia-500']

export default function Whiteboards() {
  const { state, createBoard, saveBoard, deleteBoard, refreshBoards, toast } = useApp()
  const [openId, setOpenId] = useState(null)
  const [naming, setNaming] = useState(false)
  const [busy, setBusy] = useState(false)

  // Boards are shared across the workspace, so pick up ones teammates created.
  useEffect(() => { refreshBoards() }, [refreshBoards])

  const create = async (title) => {
    setBusy(true)
    try {
      const board = await createBoard(title.trim(), colors[state.whiteboards.length % colors.length])
      setNaming(false)
      setOpenId(board.id)
    } catch (e) { toast(e.message || 'Could not create the whiteboard', 'info') } finally { setBusy(false) }
  }

  const board = state.whiteboards.find((w) => w.id === openId)
  if (openId && board) {
    return (
      <WhiteboardCanvas
        board={board}
        onClose={() => setOpenId(null)}
        onSave={async (snapshot) => {
          try { await saveBoard(board.id, { snapshot }); toast('Whiteboard saved', 'check') }
          catch (e) { toast(e.message || 'Could not save the whiteboard', 'info') }
        }}
      />
    )
  }

  return (
    <Page>
      <PageHeader
        title="Whiteboards"
        subtitle="Shared across your workspace — open the same board as a teammate and draw together."
        actions={<button className="btn-primary flex items-center gap-1.5" onClick={() => setNaming(true)}><Plus className="w-4 h-4" /> New Whiteboard</button>}
      />
      {naming && (
        <NameDialog
          title="New Whiteboard" label="Whiteboard name" initial="Untitled whiteboard"
          confirmText={busy ? 'Creating…' : 'Create'}
          onCancel={() => setNaming(false)} onConfirm={create}
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <button onClick={() => setNaming(true)} className="card border-2 border-dashed border-ink-200 h-[200px] grid place-items-center text-ink-400 hover:border-brand-blue hover:text-brand-blue transition">
          <div className="text-center"><Plus className="w-8 h-8 mx-auto" /><p className="mt-2 font-semibold text-sm">Blank whiteboard</p></div>
        </button>
        {state.whiteboards.map((w) => (
          <div key={w.id} className="card overflow-hidden hover:shadow-soft transition group cursor-pointer" onClick={() => setOpenId(w.id)}>
            <div className={`h-[130px] relative grid place-items-center ${w.snapshot ? 'bg-white' : `bg-gradient-to-br ${w.color || colors[0]}`}`}>
              {w.snapshot ? <img src={w.snapshot} alt="" className="w-full h-full object-contain" /> : <PenTool className="w-9 h-9 text-white/90" />}
            </div>
            <div className="p-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-ink-900 truncate">{w.title}</p>
                <p className="text-[12.5px] text-ink-500 mt-0.5 truncate">
                  Edited {relativeTime(w.updatedAt)} · {w.ownerId === state.user?.id ? 'You' : w.owner}
                </p>
              </div>
              {w.ownerId === state.user?.id && (
                <button
                  title="Delete whiteboard"
                  onClick={(e) => { e.stopPropagation(); deleteBoard(w.id); toast('Whiteboard deleted', 'check') }}
                  className="text-ink-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {state.whiteboards.length === 0 && (
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-ink-500">
          <Users className="w-4 h-4" /> Boards you create here are visible to everyone in your workspace.
        </p>
      )}
    </Page>
  )
}
