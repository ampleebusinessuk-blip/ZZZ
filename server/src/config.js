// Centralized configuration, all overridable via environment variables.
export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me-in-production',
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  dbPath: process.env.DB_PATH || new URL('../data/app.db', import.meta.url).pathname,
  // Comma-separated allowed origins for CORS; '*' in dev.
  corsOrigin: process.env.CORS_ORIGIN || '*',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
  isProduction: process.env.NODE_ENV === 'production',
  /* TURN relay. Without one, two people behind restrictive NATs (mobile data,
     corporate wifi, many home routers) can complete signalling and still never
     exchange media — the call sits on "connecting" forever. STUN alone only
     discovers a public address; it cannot relay.

     Either supply a shared secret (coturn `use-auth-secret`, preferred: the
     server mints short-lived credentials per call) or a static username and
     password. */
  turn: {
    urls: (process.env.TURN_URLS || '').split(',').map((u) => u.trim()).filter(Boolean),
    // Keep the bundled relay usable when a separate TURN secret has not yet
    // been supplied in Dokploy.
    secret: process.env.TURN_SECRET || process.env.JWT_SECRET || '',
    username: process.env.TURN_USERNAME || '',
    password: process.env.TURN_PASSWORD || '',
    ttlSeconds: Number(process.env.TURN_TTL) || 12 * 60 * 60,
  },
  stunUrls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',').map((u) => u.trim()).filter(Boolean),

  // LiveKit SFU (optional). When all three are set, the meeting room uses LiveKit;
  // otherwise it automatically falls back to the built-in peer-to-peer mesh.
  livekit: {
    url: process.env.LIVEKIT_URL || '',        // e.g. wss://livekit.aethelonglobal.io
    apiKey: process.env.LIVEKIT_API_KEY || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
  },

  // Optional, self-hosted AI meeting notes. Speaches exposes an OpenAI-compatible
  // transcription endpoint; Ollama turns the transcript into structured notes.
  // Keeping both behind the API means recordings never need to be sent from the
  // browser to a third-party service.
  ai: {
    transcriptionUrl: process.env.AI_TRANSCRIPTION_URL || '',
    transcriptionModel: process.env.AI_TRANSCRIPTION_MODEL || 'Systran/faster-whisper-small',
    summaryUrl: process.env.AI_SUMMARY_URL || '',
    summaryModel: process.env.AI_SUMMARY_MODEL || 'qwen2.5:3b',
  },
}
