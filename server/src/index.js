import http from 'node:http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { config } from './config.js'
import { router } from './rest.js'
import { attachRealtime } from './realtime.js'
import './db.js' // initialize DB + seed on boot

const app = express()

if (config.isProduction && config.jwtSecret === 'dev-secret-change-me-in-production') {
  throw new Error('JWT_SECRET must be set to a strong random value in production')
}

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://i.pravatar.cc'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
      mediaSrc: ["'self'", 'blob:'],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), credentials: true }))
// 8 MB covers whiteboard snapshots (PNG data URLs); binary media uploads bypass
// this parser entirely because they are not application/json.
app.use(express.json({ limit: '8mb' }))
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }))

// lightweight request log
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'production') console.log(`${req.method} ${req.url}`)
  next()
})

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))
app.use('/api', router)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const server = http.createServer(app)
attachRealtime(server)

server.listen(config.port, () => {
  console.log(`\n  ⚡ Zoom17 API on http://localhost:${config.port}`)
  console.log(`  🔌 WebSocket on ws://localhost:${config.port}/ws\n`)
})
