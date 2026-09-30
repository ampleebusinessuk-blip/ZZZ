// Background blur / virtual background for the local camera feed, run entirely
// in-browser via MediaPipe's selfie segmenter (WASM). Assets are self-hosted
// under /mediapipe (copied from node_modules at build time) rather than
// pulled from a CDN, so this works under the app's `script-src 'self'` CSP
// and without a third-party dependency at call time.
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision'

export const BACKGROUNDS = [
  { id: 'office', label: 'Office', colors: ['#4b5160', '#20232b'] },
  { id: 'blue', label: 'Soft blue', colors: ['#5b8dff', '#1b2a5c'] },
  { id: 'studio', label: 'Studio', colors: ['#3a3a3a', '#0c0c0c'] },
  { id: 'beige', label: 'Warm beige', colors: ['#e7d3b8', '#b08a55'] },
]

let segmenterPromise = null
function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = FilesetResolver.forVisionTasks('/mediapipe/wasm').then((vision) =>
      ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/mediapipe/selfie_segmenter.tflite' },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })
    )
  }
  return segmenterPromise
}

function gradientCanvas(colors, w, h) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  return c
}

// Reads a video element, applies the current effect (background blur or
// replacement via segmentation), and paints the result onto `canvas` every
// frame. Call .start()/.stop() to run/pause the loop and .setEffect() to
// change what's applied — cheap, since only the composite step changes.
export function createEffectPipeline(video, canvas) {
  const ctx = canvas.getContext('2d')
  const maskCanvas = document.createElement('canvas')
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  const cutoutCanvas = document.createElement('canvas')
  const cutoutCtx = cutoutCanvas.getContext('2d')
  const bgCanvas = document.createElement('canvas')
  const bgCtx = bgCanvas.getContext('2d')

  let running = false
  let raf = null
  let effect = { type: 'none' }
  let lastGradientId = null
  let failed = false

  function resize() {
    const w = video.videoWidth, h = video.videoHeight
    if (!w || !h) return false
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h
      cutoutCanvas.width = w; cutoutCanvas.height = h
      bgCanvas.width = w; bgCanvas.height = h
    }
    return true
  }

  function drawBackground() {
    if (effect.type === 'blur') {
      bgCtx.filter = `blur(${effect.strength || 14}px)`
      bgCtx.drawImage(video, 0, 0, bgCanvas.width, bgCanvas.height)
      bgCtx.filter = 'none'
    } else if (effect.type === 'image') {
      if (lastGradientId !== effect.bgId) {
        const preset = BACKGROUNDS.find((b) => b.id === effect.bgId) || BACKGROUNDS[0]
        bgCtx.drawImage(gradientCanvas(preset.colors, bgCanvas.width, bgCanvas.height), 0, 0)
        lastGradientId = effect.bgId
      }
    }
  }

  async function loop() {
    if (!running) return
    try {
      if (resize() && effect.type !== 'none' && !failed) {
        const segmenter = await getSegmenter()
        segmenter.segmentForVideo(video, performance.now(), (result) => {
          const mask = result.confidenceMasks?.[0]
          if (!mask) return
          const mw = mask.width, mh = mask.height
          const float = mask.getAsFloat32Array()
          if (maskCanvas.width !== mw || maskCanvas.height !== mh) { maskCanvas.width = mw; maskCanvas.height = mh }
          const alphaImg = maskCtx.createImageData(mw, mh)
          for (let i = 0; i < float.length; i++) alphaImg.data[i * 4 + 3] = float[i] * 255
          maskCtx.putImageData(alphaImg, 0, 0)
          mask.close?.()

          // Cut the person out of the full-res frame using the (upscaled) alpha mask.
          cutoutCtx.clearRect(0, 0, cutoutCanvas.width, cutoutCanvas.height)
          cutoutCtx.drawImage(video, 0, 0, cutoutCanvas.width, cutoutCanvas.height)
          cutoutCtx.globalCompositeOperation = 'destination-in'
          cutoutCtx.drawImage(maskCanvas, 0, 0, cutoutCanvas.width, cutoutCanvas.height)
          cutoutCtx.globalCompositeOperation = 'source-over'

          drawBackground()
          ctx.drawImage(bgCanvas, 0, 0)
          ctx.drawImage(cutoutCanvas, 0, 0)
        })
      } else if (resize()) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      }
    } catch {
      // A model/segmentation failure shouldn't freeze the call — fall back to
      // the plain camera frame for the rest of the session.
      failed = true
      if (resize()) ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    }
    raf = requestAnimationFrame(loop)
  }

  return {
    start() { if (!running) { running = true; loop() } },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null },
    setEffect(next) { effect = next },
  }
}
