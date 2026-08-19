import { useRef, useEffect, useState, useCallback } from 'react'
import { ArrowLeft, Eraser, Trash2, Save, Users, Loader2 } from 'lucide-react'
import { rt } from '../realtime.js'

const COLORS = ['#101828', '#2D8CFF', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6']

// Real-time collaborative whiteboard. Strokes broadcast over WS to everyone
// viewing the same board; coordinates are normalized (0..1) so they map across
// different screen sizes. Boards live server-side, so two people genuinely can
// open the same one.
export default function WhiteboardCanvas({ board, onClose, onSave }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  const [color, setColor] = useState('#101828')
  const [size, setSize] = useState(3)
  const [erasing, setErasing] = useState(false)
  const [saving, setSaving] = useState(false)

  const boardId = board.id

  // Redraws must survive a resize, so the canvas is backed by a snapshot image.
  const paintImage = useCallback((dataUrl) => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx || !dataUrl) return
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    img.src = dataUrl
  }, [])

  const sizeCanvas = useCallback((preserve = true) => {
    const canvas = canvasRef.current
    if (!canvas?.parentElement) return
    const snapshot = preserve && canvas.width ? canvas.toDataURL() : null
    const rect = canvas.parentElement.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctxRef.current = ctx
    if (snapshot) paintImage(snapshot)
  }, [paintImage])

  const drawSeg = (x0, y0, x1, y1, col, sz) => {
    const ctx = ctxRef.current, c = canvasRef.current
    if (!ctx || !c) return
    ctx.globalCompositeOperation = col === 'ERASE' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = col === 'ERASE' ? 'rgba(0,0,0,1)' : col
    ctx.lineWidth = sz * (c.width / 1000)
    ctx.beginPath()
    ctx.moveTo(x0 * c.width, y0 * c.height)
    ctx.lineTo(x1 * c.width, y1 * c.height)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }

  useEffect(() => {
    sizeCanvas(false)
    if (board.snapshot) paintImage(board.snapshot)

    const onResize = () => sizeCanvas(true)
    window.addEventListener('resize', onResize)

    rt.send({ type: 'board-join', boardId })

    const offs = [
      rt.on('board-op', ({ boardId: bid, op }) => {
        if (bid !== boardId) return
        if (op.type === 'draw') drawSeg(op.x0, op.y0, op.x1, op.y1, op.col, op.sz)
        else if (op.type === 'clear') {
          const c = canvasRef.current
          ctxRef.current?.clearRect(0, 0, c.width, c.height)
        }
      }),
      // Someone just opened this board — send them what is currently on it so
      // they don't start from a blank page mid-session.
      rt.on('board-sync-request', ({ boardId: bid, to }) => {
        if (bid !== boardId || !canvasRef.current) return
        rt.send({ type: 'board-sync', boardId, to, snapshot: canvasRef.current.toDataURL('image/png') })
      }),
      rt.on('board-sync', ({ boardId: bid, snapshot }) => {
        if (bid === boardId && snapshot) paintImage(snapshot)
      }),
    ]

    return () => {
      rt.send({ type: 'board-leave' })
      offs.forEach((off) => off())
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId])

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    const point = e.touches?.[0] || e
    return { x: (point.clientX - r.left) / r.width, y: (point.clientY - r.top) / r.height }
  }
  const start = (e) => { drawing.current = true; last.current = pos(e) }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const p = pos(e)
    // Erasing punches through to transparency instead of painting white, so it
    // works no matter what is underneath.
    const col = erasing ? 'ERASE' : color
    const sz = erasing ? 24 : size
    drawSeg(last.current.x, last.current.y, p.x, p.y, col, sz)
    rt.send({ type: 'board-op', boardId, op: { type: 'draw', x0: last.current.x, y0: last.current.y, x1: p.x, y1: p.y, col, sz } })
    last.current = p
  }
  const end = () => { drawing.current = false }

  const clear = () => {
    const c = canvasRef.current
    ctxRef.current?.clearRect(0, 0, c.width, c.height)
    rt.send({ type: 'board-op', boardId, op: { type: 'clear' } })
  }

  const save = async () => {
    setSaving(true)
    try { await onSave?.(canvasRef.current.toDataURL('image/png')) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-40 bg-[#F5F7FB] dark:bg-[#0B0E14] flex flex-col">
      <div className="h-14 border-b border-ink-200 bg-white dark:bg-[#12151C] px-2 sm:px-4 flex items-center gap-2 sm:gap-3">
        <button onClick={onClose} className="w-9 h-9 grid place-items-center rounded-lg hover:bg-ink-100 text-ink-600"><ArrowLeft className="w-5 h-5" /></button>
        <span className="font-bold text-ink-900 truncate">{board.title}</span>
        <span className="hidden sm:flex text-xs text-ink-500 items-center gap-1 ml-1 shrink-0"><Users className="w-3.5 h-3.5" /> live</span>
        <div className="flex-1" />
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); setErasing(false) }} title={c}
              className={`w-6 h-6 rounded-full border-2 ${color === c && !erasing ? 'border-brand-blue' : 'border-white shadow'}`} style={{ background: c }} />
          ))}
          <input type="range" min="1" max="12" value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-16 sm:w-20 mx-1 sm:mx-2 accent-brand-blue shrink-0" title="Brush size" />
          <button onClick={() => setErasing((v) => !v)} className={`w-9 h-9 grid place-items-center rounded-lg ${erasing ? 'bg-blue-50 text-brand-blue' : 'text-ink-600 hover:bg-ink-100'}`} title="Eraser"><Eraser className="w-4 h-4" /></button>
          <button onClick={clear} className="w-9 h-9 grid place-items-center rounded-lg text-ink-600 hover:bg-red-50 hover:text-red-500" title="Clear board"><Trash2 className="w-4 h-4" /></button>
          <button onClick={save} disabled={saving} className="btn-primary !py-1.5 flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-2 sm:p-4">
        <div className="w-full h-full bg-white rounded-2xl border border-ink-200 overflow-hidden relative">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
        </div>
      </div>
    </div>
  )
}
