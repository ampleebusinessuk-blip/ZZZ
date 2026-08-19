import { useEffect, useState } from 'react'
import { Play, Download, Share2, Clock, Eye, Search, HardDrive, Trash2, X, Video, Sparkles, Loader2, AlertCircle, CheckCircle2, ListChecks, FileText } from 'lucide-react'
import { api } from '../api.js'
import PageHeader, { Page } from '../components/PageHeader.jsx'
import { useApp } from '../store.jsx'
import { formatBytes, relativeTime } from '../dates.js'

export default function Recordings() {
  const [q, setQ] = useState('')
  const [playing, setPlaying] = useState(null)
  const [notesFor, setNotesFor] = useState(null)
  const { state, deleteMedia, updateMedia, refreshMedia, toast } = useApp()

  const processing = state.recordings.some((r) => r.aiNotes?.status === 'processing')
  useEffect(() => {
    if (!processing) return
    const timer = setInterval(refreshMedia, 3500)
    return () => clearInterval(timer)
  }, [processing, refreshMedia])

  const filtered = state.recordings.filter((r) => r.title.toLowerCase().includes(q.trim().toLowerCase()))
  const { used = 0, quota = 1 } = state.storage || {}
  const pct = Math.min(100, Math.round((used / quota) * 100))

  const play = (r) => {
    setPlaying(r)
    // Count the view once, optimistically, and persist it.
    updateMedia('recordings', r.id, { views: (r.views || 0) + 1 })
  }

  const download = (r) => {
    // A real file from the server, not a toast pretending to be one.
    const a = document.createElement('a')
    a.href = `${r.url}?download=1`
    a.download = `${r.title}.webm`
    document.body.appendChild(a); a.click(); a.remove()
    toast('Download started', 'info')
  }

  const share = (r) => {
    const link = `${location.origin}${r.url}`
    navigator.clipboard?.writeText(link)
    toast('Share link copied — only you can open it while signed in')
  }

  const generateNotes = async (r) => {
    setNotesFor(r.id)
    updateMedia('recordings', r.id, { aiNotes: { status: 'processing', startedAt: Date.now() } })
    try {
      await api.generateAiNotes(r.id)
      toast('AI note taker is transcribing this meeting', 'info')
      refreshMedia()
    } catch (error) {
      updateMedia('recordings', r.id, { aiNotes: { status: 'error', error: error.message } })
      toast(error.message, 'info')
    }
  }

  return (
    <Page>
      <PageHeader
        title="Recordings"
        subtitle="Meeting recordings you captured, stored in your workspace."
        actions={
          <div className="min-w-[220px] rounded-lg border border-ink-200 bg-white px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-ink-600">
              <HardDrive className="w-4 h-4 text-brand-blue shrink-0" />
              <span>{formatBytes(used)} of {formatBytes(quota)} used</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-ink-100 overflow-hidden">
              <div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : 'bg-brand-blue'}`} style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }} />
            </div>
          </div>
        }
      />

      <div className="relative w-full max-w-xs mb-5">
        <Search className="w-4 h-4 text-ink-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recordings"
          className="w-full h-10 rounded-xl bg-white border border-ink-200 pl-10 pr-3 text-sm outline-none focus:border-brand-blue" />
      </div>

      {state.recordings.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 grid place-items-center mx-auto mb-4"><Video className="w-7 h-7 text-brand-blue" /></div>
          <p className="font-semibold text-ink-900 text-lg">No recordings yet</p>
          <p className="text-ink-500 mt-1 max-w-sm mx-auto">Hit <span className="font-semibold">Record</span> during a meeting and it lands here, ready to play back and download.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((r) => (
            <div key={r.id} className="card overflow-hidden hover:shadow-soft transition group">
              <button onClick={() => play(r)} className={`w-full h-40 bg-gradient-to-br ${r.thumb || 'from-blue-500 to-indigo-600'} relative grid place-items-center`}>
                <span className="w-14 h-14 rounded-full bg-white/25 backdrop-blur grid place-items-center group-hover:scale-110 transition">
                  <Play className="w-6 h-6 text-white fill-white ml-0.5" />
                </span>
                <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-xs font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {r.duration}
                </span>
              </button>
              <div className="p-4">
                <p className="font-semibold text-ink-900 truncate" title={r.title}>{r.title}</p>
                <p className="text-[12.5px] text-ink-500 mt-0.5">{relativeTime(r.createdAt)} · {formatBytes(r.bytes)}</p>
                <button onClick={() => r.aiNotes?.status === 'ready' ? setNotesFor(r.id) : generateNotes(r)} disabled={r.aiNotes?.status === 'processing'}
                  className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-sm font-bold text-brand-blue transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-70">
                  {r.aiNotes?.status === 'processing' ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating AI notes…</>
                    : r.aiNotes?.status === 'ready' ? <><CheckCircle2 className="h-4 w-4" /> View AI notes</>
                    : r.aiNotes?.status === 'error' ? <><AlertCircle className="h-4 w-4" /> Retry AI notes</>
                    : <><Sparkles className="h-4 w-4" /> Generate AI notes</>}
                </button>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-ink-500 flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {r.views || 0} views</span>
                  <div className="flex items-center gap-1">
                    <IconBtn title="Download" onClick={() => download(r)}><Download className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Copy link" onClick={() => share(r)}><Share2 className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Delete" onClick={() => { deleteMedia('recordings', r.id); toast('Recording deleted', 'check') }}><Trash2 className="w-4 h-4" /></IconBtn>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {state.recordings.length > 0 && filtered.length === 0 && <p className="text-ink-500 text-center py-16">No recordings match “{q}”.</p>}

      {playing && (
        <div className="fixed inset-0 z-[60] bg-black/85 grid place-items-center p-4" onMouseDown={() => setPlaying(null)}>
          <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-4xl">
            <div className="flex items-center justify-between mb-3 text-white">
              <p className="font-semibold truncate pr-4">{playing.title}</p>
              <button onClick={() => setPlaying(null)} className="p-1.5 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <video src={playing.url} controls autoPlay className="w-full rounded-2xl bg-black" />
          </div>
        </div>
      )}
      {notesFor && (() => {
        const recording = state.recordings.find((r) => r.id === notesFor)
        if (!recording) return null
        const notes = recording.aiNotes || {}
        return <AiNotesModal recording={recording} notes={notes} onClose={() => setNotesFor(null)} onGenerate={() => generateNotes(recording)} />
      })()}
    </Page>
  )
}

function AiNotesModal({ recording, notes, onClose, onGenerate }) {
  return (
    <div className="fixed inset-0 z-[70] bg-ink-900/55 p-3 backdrop-blur-sm sm:p-6" onMouseDown={onClose}>
      <section onMouseDown={(e) => e.stopPropagation()} className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-200 p-5 sm:p-6">
          <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-bold text-brand-blue"><Sparkles className="h-4 w-4" /> AI Meeting Notes</div><h2 className="mt-1 truncate text-xl font-bold text-ink-900">{recording.title}</h2></div>
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-600"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {notes.status === 'processing' && <div className="grid min-h-[320px] place-items-center text-center"><div><Loader2 className="mx-auto h-9 w-9 animate-spin text-brand-blue" /><p className="mt-4 font-bold text-ink-900">Listening to the meeting</p><p className="mt-1 text-sm text-ink-500">Transcribing audio, then extracting the summary and actions. You can close this panel.</p></div></div>}
          {notes.status === 'error' && <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 text-center"><AlertCircle className="mx-auto h-8 w-8 text-red-500" /><p className="mt-3 font-bold text-red-700">AI notes could not be created</p><p className="mt-1 text-sm text-red-600">{notes.error}</p><button onClick={onGenerate} className="mt-5 rounded-xl bg-brand-blue px-5 py-2.5 text-sm font-bold text-white">Try again</button></div>}
          {notes.status === 'ready' && <div className="space-y-5">
            <NoteSection icon={Sparkles} title="Executive summary"><p className="leading-7 text-ink-700">{notes.summary}</p></NoteSection>
            <div className="grid gap-5 md:grid-cols-2">
              <NoteSection icon={ListChecks} title="Key points"><BulletList items={notes.keyPoints} empty="No key points detected." /></NoteSection>
              <NoteSection icon={CheckCircle2} title="Decisions"><BulletList items={notes.decisions} empty="No explicit decisions detected." /></NoteSection>
            </div>
            <NoteSection icon={ListChecks} title="Action items">
              {notes.actionItems?.length ? <div className="space-y-2">{notes.actionItems.map((item, i) => <div key={i} className="rounded-xl bg-ink-50 p-3"><p className="font-semibold text-ink-900">{item.task}</p><p className="mt-1 text-xs text-ink-500">Owner: {item.owner} · Due: {item.due}</p></div>)}</div> : <p className="text-sm text-ink-500">No explicit action items detected.</p>}
            </NoteSection>
            <details className="rounded-2xl border border-ink-200 bg-white p-4"><summary className="flex cursor-pointer list-none items-center gap-2 font-bold text-ink-900"><FileText className="h-4 w-4 text-brand-blue" /> Full transcript</summary><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink-700">{notes.transcript}</p></details>
          </div>}
          {!notes.status && <div className="grid min-h-[320px] place-items-center text-center"><div><Sparkles className="mx-auto h-9 w-9 text-brand-blue" /><p className="mt-4 font-bold text-ink-900">Turn this recording into useful notes</p><p className="mt-1 text-sm text-ink-500">Get a transcript, summary, decisions, and assigned actions.</p><button onClick={onGenerate} className="mt-5 rounded-xl bg-brand-blue px-5 py-2.5 text-sm font-bold text-white">Generate AI notes</button></div></div>}
        </div>
      </section>
    </div>
  )
}

function NoteSection({ icon: Icon, title, children }) {
  return <section className="rounded-2xl border border-ink-200 bg-white p-4 sm:p-5"><h3 className="mb-3 flex items-center gap-2 font-bold text-ink-900"><Icon className="h-4 w-4 text-brand-blue" />{title}</h3>{children}</section>
}
function BulletList({ items = [], empty }) {
  return items.length ? <ul className="space-y-2 text-sm text-ink-700">{items.map((item, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-blue" />{item}</li>)}</ul> : <p className="text-sm text-ink-500">{empty}</p>
}

function IconBtn({ children, ...props }) {
  return (
    <button {...props} className="w-8 h-8 grid place-items-center rounded-lg text-ink-600 hover:bg-blue-50 hover:text-brand-blue transition">
      {children}
    </button>
  )
}
