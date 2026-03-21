# N Games Network — Server

Phase 1 of the N Games Network. Express + better-sqlite3 + WebSocket.

## Deploy to Railway

1. Create a new Railway service from this repo
2. Add a Volume mounted at `/data`
3. Set env var `DB_PATH=/data/ngames.db` (auto-detected if /data exists)
4. Deploy — Railway auto-detects Node via nixpacks

The server seeds the 4 crew profiles and 2 games on first boot.

---

## REST API

All responses are JSON. No auth (private crew network).

### Health
```
GET  /          → { service, status, ts }
GET  /health    → { ok: true }
```

### Profiles
```
GET  /profiles          → [profile, ...]
GET  /profiles/:id      → profile

Profile shape:
{
  id, name, color, suit, initial,
  xp, level, casino_balance,
  game_stats: {},     // arbitrary per-game JSON
  created_at
}
```

### Presence
```
GET  /presence           → [{ profile_id, online, game_id, game_state, updated_at }, ...]

POST /presence/ping      → { ok: true }
Body: { profile_id, game_id?, game_state? }

POST /presence/offline   → { ok: true }
Body: { profile_id }
```
Profiles auto-go offline after 90s without a ping.

### Sessions (cross-game scores)
```
POST /sessions           → { ok, session_id, xp_gained }
Body: { profile_id, game_id, score, data? }

GET  /sessions/leaderboard?game=<game_id>  → [session+profile, ...]
GET  /sessions/:profile_id                 → [session, ...]
```

### Wall
```
GET  /wall                      → [post+profile, ...]
POST /wall/post                 → { ok, post_id }
Body: { profile_id, content, game_id? }

POST /wall/:id/react            → { ok, reactions }
Body: { profile_id, suit }    (suit ∈ ♦♥♠♣)

GET  /wall/:id/comments         → [comment+profile, ...]
POST /wall/:id/comment          → { ok, comment_id }
Body: { profile_id, content }
```

### Messages
```
GET  /messages/:a/:b            → [message, ...]   (conversation between a and b)
POST /messages                  → { ok, message_id }
Body: { from_id, to_id, content }

POST /messages/read             → { ok }
Body: { reader_id, from_id }

GET  /messages/unread/:profile_id → [{ from_id, count }, ...]
```

### Games Registry
```
GET  /games       → [game, ...]
GET  /games/:id   → game

Game shape:
{
  id, name, owner, status,   // status: 'live' | 'construction' | 'coming_soon'
  version, description, url, art_url,
  tags: [],
  updated_at
}
```

---

## WebSocket

Connect to `ws://<host>/` (or `wss://` in production).

### Client → Server
```json
{ "type": "identify", "profile_id": "keshawn" }
{ "type": "ping" }
```

### Server → Client (broadcast)
```json
{ "type": "identified", "profile_id": "keshawn" }
{ "type": "pong", "ts": 1234567890 }
{ "type": "presence", "profile_id": "...", "online": true/false, "game_id": "..." }
{ "type": "wall_post", "post": { ... } }
{ "type": "reaction", "post_id": 5, "reactions": { ... } }
{ "type": "comment", "post_id": 5, "profile_id": "...", "comment_id": 7 }
{ "type": "message", "message": { ... } }
{ "type": "session", "profile_id": "...", "game_id": "...", "score": 1000 }
```

Messages are targeted — only the recipient's connected clients get them.
All other events are broadcast to everyone.

---

## XP Formula
- 10 XP per session submitted
- +1 XP per 100 score points
- Level = floor(sqrt(XP / 100)) + 1, capped at 100

---

## Env Vars
| Var      | Default            | Notes                        |
|----------|--------------------|------------------------------|
| PORT     | 3200               | Railway sets this            |
| DB_PATH  | /data/ngames.db    | Auto-detected if /data exists|
