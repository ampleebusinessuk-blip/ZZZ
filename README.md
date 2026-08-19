# Zoom17 — Full-Stack

A production-structured video meeting platform: React front-end + Node/Express API + WebSocket real-time layer + SQLite, with JWT auth, live chat & presence, and real WebRTC video.

## Features

- **Enterprise auth** — HttpOnly server sessions, CSRF protection, bcrypt password hashing, lockouts, rate limits, MFA/TOTP, password recovery, device management, and security audit history.
- **Meetings** — schedule, start, join, delete. Each meeting gets its own unique ID and room; `Today` / `Upcoming` / `Previous` are derived from the clock, so a meeting moves buckets on its own as it starts and ends.
- **Video** — real `getUserMedia` + WebRTC mesh using **perfect negotiation**: buffered ICE candidates, glare resolution, renegotiation on track changes, and ICE restart on failure. Mic/camera/screen-share state is broadcast to every participant, and cameras & microphones can be switched mid-call.
- **Recording** — in-meeting recording mixes the microphone, shared-tab audio and every remote participant into one track, then uploads to the server. Recordings and clips stream back with HTTP range support, so they play and seek in-app.
- **AI meeting notes** — the host can start a clearly disclosed AI recording from the call controls. A self-hosted Speaches/faster-whisper service transcribes it; optional Ollama summarization produces an executive summary, key points, decisions, action items and a full transcript.
- **Host moderation** — signed-in hosts can mute or remove participants directly from the in-call participant panel; guests cannot send moderation commands.
- **Team Chat** — real-time messaging over WebSockets with real timestamps, unread badges, message grouping, channel creation and DMs.
- **Whiteboards** — shared workspace-wide, with live stroke sync and a snapshot handshake so someone joining mid-session sees the current canvas.
- **Guest access** — hosts mint an invite link that lets anyone join one meeting without an account. The pass is scoped by the server to that single room: guests get video, screen share and in-call chat, and are refused everything else (workspace channels, whiteboards, the directory, other rooms). They're also excluded from member presence.
- **Profile pictures** — upload a photo; it's centre-cropped and resized in the browser, then stored on the server and served with cache headers.
- **Presence** — live online/offline tracking; new teammates appear in Contacts without a refresh.
- **Workspace** — calendar, contacts, recordings, docs, clips, notes, settings — persisted per account.
- **Dark mode**, global search, and route-level code-splitting (the LiveKit SDK only loads when an SFU is configured).

## Data ownership

Two kinds of state, deliberately kept apart:

| Owned by | Slices | Endpoint |
|---|---|---|
| **Server** | contacts (the user directory), channels, meetings, whiteboards, recordings, clips, avatars | dedicated tables + REST routes |
| **Client** (debounce-synced) | docs, notes, notifications, settings | `PATCH /api/state` |

`PATCH /api/state` ignores anything outside the client-owned list, and `/api/bootstrap` layers
server-owned data *over* the stored document. Without that split, a stale client snapshot
silently shadows live data — which is exactly how the contact list used to freeze.

## Tech stack

| Layer | Tech |
|-------|------|
| Front-end | React 18, React Router, Vite, Tailwind CSS |
| Back-end | Node 22+, Express, `ws` |
| Database | SQLite via Node's built-in `node:sqlite` (WAL mode) |
| Auth | Revocable server sessions + `bcryptjs` + TOTP MFA |
| Real-time | WebSockets (chat, presence, notifications, WebRTC signaling, whiteboard sync) |
| Media | Recordings/clips streamed to disk beside the DB, served with range requests |

## TURN: required for calls between different networks

Mesh video is peer-to-peer, so the two browsers need a path to each other. STUN
only tells a browser its own public address; it cannot carry traffic. When either
side is behind a symmetric NAT or a network that blocks UDP — mobile data,
corporate and hotel wifi, plenty of home routers — there is no direct path, and
the call completes signalling and then sits on **"connecting"** forever.

A TURN server fixes that by relaying the media. Set two variables and the server
hands short-lived credentials to each participant at join time:

```bash
TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_SECRET=<a long random string>
```

The bundled Dokploy Compose deployment defaults `TURN_URLS` to
`meet.aethelonglobal.io:3478` and uses `JWT_SECRET` for relay authentication
until a separate `TURN_SECRET` is supplied. Setting `TURN_SECRET` remains the
recommended production configuration and overrides that fallback.

`compose.yaml` includes a `coturn` service that reads the same `TURN_SECRET`.
Point a DNS record at your host and open these ports:

| Port | Protocol | Why |
|------|----------|-----|
| 3478 | UDP + TCP | STUN/TURN |
| 5349 | TCP (TLS) | the fallback that survives networks blocking UDP |
| 49160–49200 | UDP | relayed media |

Credentials are generated per call from the shared secret (coturn's
`use-auth-secret` scheme): the username is an expiry timestamp, the password its
HMAC. Nothing long-lived is ever sent to the browser, and rotating the secret
invalidates everything without a redeploy.

Without TURN the app still works — for people on the same network, or whenever
one side has a permissive NAT. It just fails for everyone else, which is why the
meeting screen now says so explicitly instead of showing "connecting" forever.

> Using the LiveKit SFU instead? It terminates media server-side, so it solves
> the same problem and TURN is only needed for its own restrictive-network cases.

## Guest links

A host opens a meeting and hits **Invite** (or **Guest link** on the waiting
screen). That mints `/join/<room>?t=<token>`, where the token is a signed
statement that this one room may be joined without an account.

Redeeming it creates a **guest session**: a separate cookie, a separate table,
a 12-hour life, and a room baked in. The room always comes from the signed pass,
never from the request — so a guest cannot point their pass at another meeting.
Invite links themselves expire after 7 days.

Guests are refused at three layers, not one: REST routes sit behind the member
gate, the WebSocket rejects any message outside their room, and member presence
filters them out.

## Run locally

```bash
# 1. Install everything (root + server)
npm run install:all

# 2. Start API + client together
npm run dev
```

- Front-end: <http://localhost:5173>
- API: <http://localhost:4000> (Vite proxies `/api` and `/ws` to it)

Register a new account with a password of 12+ characters containing uppercase, lowercase, a number, and a symbol.

## AI meeting notes

The Compose stack includes the open-source Speaches speech-to-text service and
connects it automatically at `http://speaches:8000`. You only need these
Dokploy environment values when overriding the built-in service or model:

```bash
AI_TRANSCRIPTION_URL=http://speaches:8000
AI_TRANSCRIPTION_MODEL=Systran/faster-whisper-small
```

That enables transcription and a useful extractive summary. For richer
structured summaries, decisions and action items, point the server at an Ollama
instance too:

```bash
AI_SUMMARY_URL=http://ollama:11434
AI_SUMMARY_MODEL=qwen2.5:3b
```

The AI button performs a status check before recording, so a missing deployment
setting results in a clear setup message rather than a failed background job.

## Run with Docker

```bash
docker compose up --build
```

The `web` container (nginx) serves the built front-end and proxies `/api` + `/ws` to the `server` container; SQLite persists in the `db-data` volume.

> Deployed via **Dokploy** (Compose): the `web` service joins the external `dokploy-network` so Traefik can route your domain to it. Set `JWT_SECRET` in the Dokploy **Environment** tab, and point a domain at service `web` port `80` in the **Domains** tab.

## Environment

Copy `server/.env.example` to `server/.env` and set a strong `JWT_SECRET` for production. For Docker, pass `JWT_SECRET` via your environment or an `.env` file next to `docker-compose.yml`.

## Project layout

```
.
├── src/                # React front-end
│   ├── pages/          # route-level, lazy-loaded
│   ├── components/
│   ├── store.jsx       # global store: hydrates from API, syncs, live WS updates
│   ├── api.js          # REST client
│   ├── realtime.js     # WebSocket client (auto-reconnect)
│   └── auth.jsx        # auth context
├── server/             # Node backend
│   └── src/
│       ├── index.js    # Express + HTTP + WS wiring
│       ├── rest.js     # REST routes
│       ├── realtime.js # WebSocket hub
│       ├── auth.js     # JWT + bcrypt
│       ├── db.js       # node:sqlite schema + queries
│       └── seed.js     # workspace defaults (no demo data — accounts start empty)
├── Dockerfile          # front-end (nginx)
├── server/Dockerfile   # back-end
├── docker-compose.yml
└── ARCHITECTURE.md     # how this scales to thousands of users
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the scaling plan.
