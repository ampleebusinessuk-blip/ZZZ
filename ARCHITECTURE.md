# Architecture & Scaling to Thousands of Users

This document explains how the app is built to scale, what already scales, and the concrete steps to take it to thousands of concurrent clients.

## Current shape

```
        ┌────────────┐     HTTPS /api      ┌─────────────┐
Browser │  React SPA │ ──────────────────▶ │  Express    │
(client)│  (nginx)   │     WSS   /ws       │  + ws hub   │
        └────────────┘ ──────────────────▶ │             │
                                           │   node:sqlite (WAL)
                                           └─────────────┘
```

- **Stateless REST**: every `/api` request authenticates via a JWT (no server session). Any number of API instances can serve any request → horizontally scalable behind a load balancer.
- **Local-first client**: the store hydrates once from `/api/bootstrap`, then updates optimistically and syncs in the background. The UI never blocks on the network, which is what makes it feel seamless.
- **Code-splitting**: each route ships as its own chunk; vendor libraries are cached separately. First paint downloads only what it needs.

## What already scales

| Concern | Why it holds up |
|---|---|
| Browsing, dashboards, workspace data | Stateless API + per-user reads; add instances behind a load balancer. |
| Auth | JWT — no shared session store required. |
| Static front-end | Served by nginx / any CDN; fully cacheable hashed assets. |
| Many small meetings at once | Each meeting is an independent peer mesh; they don't contend. |

## The three things to change for real scale

### 1. Database: SQLite → Postgres
SQLite (WAL) is great for a single node and development. For many writers across many instances, move to **Postgres** (or any managed SQL). The data layer is isolated in `server/src/db.js` behind a small query object — swap the driver, keep the callers. Add read replicas for read-heavy load.

### 2. Real-time fan-out: in-memory → Redis pub/sub
Today the WebSocket hub (`server/src/realtime.js`) holds connections in memory, so a broadcast only reaches clients on **that** instance. To run many WS instances behind a load balancer:

- Publish every outbound event to a **Redis** channel; every instance subscribes and relays to its local sockets.
- Store presence in Redis (a per-user key with TTL refreshed by the heartbeat) so “who’s online” is correct cluster-wide.
- Use sticky sessions **or** a shared token so reconnects land anywhere.

The message contract does not change — only the transport between instances.

### 3. Video: mesh → SFU (the hard limit)
The current WebRTC video is a **peer-to-peer mesh**: every participant sends their stream to every other participant. That's perfect for small calls (≈2–6 people) but each client's upload grows with the group, so it does **not** scale to large meetings.

For large meetings / webinars you need a **Selective Forwarding Unit (SFU)** — a media server that receives each participant's stream once and forwards it. Recommended: **[LiveKit](https://livekit.io)**, **mediasoup**, or **Janus**. The SFU runs as its own horizontally-scaled service; our WebSocket layer already does the signaling role, so integration is swapping the peer connections for SFU client SDK calls. TURN servers (e.g. coturn) are also needed so clients behind restrictive NATs can connect.

> This is why "thousands in a single call" is an infrastructure question, not a code one. Thousands of users **across many meetings** works with the mesh; thousands **in one** needs an SFU.

## Reference production topology

```
                 ┌──────── CDN (static SPA) ────────┐
                 │                                   │
   Clients ──▶ Load Balancer ──▶  API instances (N)  ──▶ Postgres (+ read replicas)
                 │                        │
                 │                        └──▶ Redis (pub/sub + presence + cache)
                 │
                 └──▶ WS instances (N) ◀── Redis adapter
                 │
                 └──▶ SFU cluster (LiveKit) + TURN  ── for video media
```

## Hardening checklist for production

- [ ] Set a strong `JWT_SECRET`; rotate periodically. Consider short-lived access tokens + refresh tokens.
- [ ] Rate-limit auth endpoints; add lockout/backoff on repeated failures.
- [ ] Serve everything over HTTPS/WSS; WebRTC and `getUserMedia` require a secure context.
- [ ] Add input validation (e.g. `zod`) and per-route authorization checks.
- [ ] Move DB to Postgres; run migrations; back it up.
- [ ] Add Redis for WS fan-out + presence + caching.
- [ ] Add observability: structured logs, metrics, tracing, health/readiness probes.
- [ ] Add a TURN server and an SFU for large or unreliable-network calls.
- [ ] Autoscale API/WS instances on CPU + connection count.
```
