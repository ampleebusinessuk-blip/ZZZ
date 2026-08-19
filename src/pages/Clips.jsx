import { useState, useRef, useEffect } from 'react'
import { Plus, Play, Clock, Eye, Clapperboard, Trash2, Monitor, Camera, Square, X, Circle, Download, Share2, Loader2 } from 'lucide-react'
import PageHeader, { Page } from '../components/PageHeader.jsx'
import { useApp } from '../store.jsx'
import { formatBytes, relativeTime } from '../dates.js'

const thumbs = ['from-blue-500 to-cyan-500', 'from-violet-500 to-fuchsia-500', 'from-orange-500 to-amber-500', 'from-emerald-500 to-teal-500']

export default function Clips() {
  const { state, uploadMedia, deleteMedia, updateMedia, toast } = useApp()
  const [picker, setPicker] = useState(false)
  const [recording, setRecording] = useState(false)
  const [secs, setSecs] = useState(0)
  const [saving, setSaving] = useState(0)
  const [playing, setPlaying] = useState(null)
  const recorder = useRef(null)
  const chunks = useRef([])
  const stream = useRef(null)
  const timer = useRef(null)
  const startAt = useRef(0)

  useEffect(() => () => {
    clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
  }, [])

  const startRecording = async (source) => {
    setPicker(false)
    try {
      stream.current = source === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch { return toast('Recording cancelled', 'info') }

    // A screen capture often carries no audio track, so pull the microphone in
    // as well — otherwise every screen clip would be silent.
    if (source === 'screen' && !stream.current.getAudioTracks().length) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
        mic.getAudioTracks().forEach((t) => stream.current.addTrack(t))
      } catch {}
    }

    let mr
    try {
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm'
      mr = new MediaRecorder(stream.current, { mimeType: mime, videoBitsPerSecond: 2_500_000 })
    } catch {
      stream.current.getTracks().forEach((t) => t.stop())
      return toast('Recording is not supported in this browser', 'info')
    }

    chunks.current = []
    mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
    mr.onstop = async () => {
      clearInterval(timer.current)
      stream.current?.getTracks().forEach((t) => t.stop())
      setRecording(false); setSecs(0)
      const duration = Math.max(1, Math.round((Date.now() - startAt.current) / 1000))
      const blob = new Blob(chunks.current, { type: 'video/webm' })
      chunks.current = []
      if (!blob.size) return toast('Clip was empty', 'info')
      setSaving(0.01)
      try {
        await uploadMedia(blob, {
          kind: 'clip',
          title: `Clip · ${new Date().toLocaleString()}`,
          duration: `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`,
          thumb: thumbs[state.clips.length % thumbs.length],
          onProgress: setSaving,
        })
        toast('Clip saved to your library', 'check')
      } catch (e) { toast(e.message || 'Could not save the clip', 'info') } finally { setSaving(0) }
    }

    // Stop cleanly if the user ends the share from the browser's own UI.
    stream.current.getVideoTracks()[0].onended = () => { if (recorder.current?.state === 'recording') recorder.current.stop() }
    mr.start(1000)
    recorder.current = mr
    startAt.current = Date.now()
    setRecording(true); setSecs(0)
    timer.current = setInterval(() => setSecs((s) => s + 1), 1000)
    toast('Recording started', 'video')
  }

  const stopRecording = () => { try { recorder.current?.stop() } catch {} }

  const play = (c) => { setPlaying(c); updateMedia('clips', c.id, { views: (c.views || 0) + 1 }) }
  const download = (c) => {
    const a = document.createElement('a')
    a.href = `${c.url}?download=1`; a.download = `${c.title}.webm`
    document.body.appendChild(a); a.click(); a.remove()
    toast('Download started', 'info')
  }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`

  return (
    <Page>
      <PageHeader
        title="Clips"
        subtitle="Record and share short async video updates."
        actions={
          <button className="btn-primary flex items-center gap-1.5 disabled:opacity-60" disabled={recording || saving > 0} onClick={() => setPicker(true)}>
            <Plus className="w-4 h-4" /> Record Clip
          </button>
        }
      />

      {saving > 0 && (
        <div className="card mb-5 p-4 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-brand-blue shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink-900">Saving your clip… {Math.round(saving * 100)}%</p>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-ink-100 overflow-hidden">
              <div className="h-full rounded-full bg-brand-blue transition-all" style={{ width: `${Math.max(2, saving * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      {state.clips.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 grid place-items-center mx-auto mb-4"><Clapperboard className="w-7 h-7 text-brand-blue" /></div>
          <p className="font-semibold text-ink-900 text-lg">No clips yet</p>
          <p className="text-ink-500 mt-1">Record your screen or camera to create a shareable clip.</p>
          <button className="btn-primary mt-5" onClick={() => setPicker(true)}>Record a clip</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {state.clips.map((c) => (
            <div key={c.id} className="card overflow-hidden hover:shadow-soft transition group">
              <button onClick={() => play(c)} className={`w-full h-44 bg-gradient-to-br ${c.thumb || thumbs[0]} relative grid place-items-center`}>
                <span className="w-14 h-14 rounded-full bg-white/25 backdrop-blur grid place-items-center group-hover:scale-110 transition"><Play className="w-6 h-6 text-white fill-white ml-0.5" /></span>
                <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> {c.duration}</span>
                <Clapperboard className="absolute top-2 left-2 w-5 h-5 text-white/80" />
              </button>
              <div className="p-4">
                <p className="font-semibold text-ink-900 truncate" title={c.title}>{c.title}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <div className="flex items-center gap-3 text-xs text-ink-500">
                    <span>{relativeTime(c.createdAt)}</span>
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {c.views || 0}</span>
                    <span>{formatBytes(c.bytes)}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <IconBtn title="Download" onClick={() => download(c)}><Download className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Copy link" onClick={() => { navigator.clipboard?.writeText(`${location.origin}${c.url}`); toast('Clip link copied') }}><Share2 className="w-4 h-4" /></IconBtn>
                    <IconBtn title="Delete" onClick={() => { deleteMedia('clips', c.id); toast('Clip deleted', 'check') }}><Trash2 className="w-4 h-4" /></IconBtn>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {picker && (
        <div className="fixed inset-0 z-50 bg-ink-900/50 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4 animate-fade" onMouseDown={() => setPicker(false)}>
          <div onMouseDown={(e) => e.stopPropagation()} className="animate-pop w-full max-w-sm bg-white rounded-t-[24px] sm:rounded-2xl shadow-soft overflow-hidden">
            <div className="flex items-center justify-between px-6 h-14 border-b border-ink-200">
              <h3 className="font-bold text-ink-900">Record a clip</h3>
              <button onClick={() => setPicker(false)} className="text-ink-400 hover:text-ink-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-3">
              <button onClick={() => startRecording('screen')} className="rounded-xl border border-ink-200 p-5 hover:border-brand-blue hover:bg-blue-50 transition text-center">
                <Monitor className="w-8 h-8 text-brand-blue mx-auto" /><p className="font-semibold text-ink-900 text-sm mt-2">Screen</p>
              </button>
              <button onClick={() => startRecording('camera')} className="rounded-xl border border-ink-200 p-5 hover:border-brand-blue hover:bg-blue-50 transition text-center">
                <Camera className="w-8 h-8 text-brand-blue mx-auto" /><p className="font-semibold text-ink-900 text-sm mt-2">Camera</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {recording && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-ink-900 text-white rounded-2xl shadow-soft px-5 py-3 flex items-center gap-4 animate-pop">
          <span className="flex items-center gap-2 text-red-400 font-semibold tabular-nums"><Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" /> {mmss}</span>
          <button onClick={stopRecording} className="h-9 px-4 rounded-lg bg-red-500 hover:bg-red-600 font-semibold flex items-center gap-1.5"><Square className="w-4 h-4" /> Stop</button>
        </div>
      )}

      {playing && (
        <div className="fixed inset-0 z-[60] bg-black/85 grid place-items-center p-4" onMouseDown={() => setPlaying(null)}>
          <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-3xl">
            <div className="flex items-center justify-between mb-3 text-white">
              <p className="font-semibold truncate pr-4">{playing.title}</p>
              <button onClick={() => setPlaying(null)} className="p-1.5 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <video src={playing.url} controls autoPlay className="w-full rounded-2xl bg-black" />
          </div>
        </div>
      )}
    </Page>
  )
}

function IconBtn({ children, ...props }) {
  return <button {...props} className="w-8 h-8 grid place-items-center rounded-lg text-ink-600 hover:bg-blue-50 hover:text-brand-blue transition">{children}</button>
}
