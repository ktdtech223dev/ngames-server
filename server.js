/**
 * N Games Network — Server
 * Phase 1: Express + better-sqlite3 + WebSocket
 * Deploy to Railway with persistent /data volume
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path       = require('path');
const fs         = require('fs');
const Database   = require('better-sqlite3');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT    = process.env.PORT || 3200;
const DB_PATH = process.env.DB_PATH || (
  fs.existsSync('/data') ? '/data/ngames.db' : path.join(__dirname, 'ngames.db')
);

const CREW = [
  { id: 'keshawn', name: 'Keshawn', color: '#80e060', suit: '♣', initial: 'K' },
  { id: 'sean',    name: 'Sean',    color: '#f0c040', suit: '♦', initial: 'S' },
  { id: 'dart',    name: 'Dart',    color: '#e04040', suit: '♥', initial: 'D' },
  { id: 'amari',   name: 'Amari',   color: '#40c0e0', suit: '♠', initial: 'A' },
];

const GAMES = [
  {
    id:          'chaos-holdem',
    name:        'Chaos Hold\'Em',
    owner:       'keshawn',
    status:      'live',
    version:     '1.0.0',
    description: 'Roguelike poker. Run-based chaos.',
    url:         'https://chaos-holdem-server3-production.up.railway.app',
    art_url:     null,
    tags:        JSON.stringify(['poker', 'roguelike', 'cards']),
  },
  {
    id:          'blacks-dungeon',
    name:        'Shape of Blacks',
    owner:       'sean',
    status:      'construction',
    version:     null,
    description: 'Shape of Blacks. Under construction.',
    url:         null,
    art_url:     null,
    tags:        JSON.stringify(['action', 'roguelike']),
  },
];

// ─── Database ─────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      color           TEXT NOT NULL,
      suit            TEXT NOT NULL,
      initial         TEXT NOT NULL,
      xp              INTEGER DEFAULT 0,
      level           INTEGER DEFAULT 1,
      casino_balance  INTEGER DEFAULT 1000,
      game_stats      TEXT DEFAULT '{}',
      created_at      INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS presence (
      profile_id  TEXT PRIMARY KEY REFERENCES profiles(id),
      online      INTEGER DEFAULT 0,
      game_id     TEXT,
      game_state  TEXT,
      updated_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  TEXT NOT NULL REFERENCES profiles(id),
      game_id     TEXT NOT NULL,
      score       INTEGER DEFAULT 0,
      data        TEXT DEFAULT '{}',
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS wall (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  TEXT NOT NULL REFERENCES profiles(id),
      game_id     TEXT,
      content     TEXT NOT NULL,
      reactions   TEXT DEFAULT '{"♦":[],"♥":[],"♠":[],"♣":[]}',
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id     INTEGER NOT NULL REFERENCES wall(id) ON DELETE CASCADE,
      profile_id  TEXT NOT NULL REFERENCES profiles(id),
      content     TEXT NOT NULL,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id     TEXT NOT NULL REFERENCES profiles(id),
      to_id       TEXT NOT NULL REFERENCES profiles(id),
      content     TEXT NOT NULL,
      read        INTEGER DEFAULT 0,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      owner       TEXT REFERENCES profiles(id),
      status      TEXT DEFAULT 'construction',
      version     TEXT,
      description TEXT,
      url         TEXT,
      art_url     TEXT,
      tags        TEXT DEFAULT '[]',
      updated_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_game    ON sessions(game_id);
    CREATE INDEX IF NOT EXISTS idx_wall_created     ON wall(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_pair    ON messages(from_id, to_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to      ON messages(to_id, read);
  `);

  // Seed crew profiles
  const upsert = db.prepare(`
    INSERT INTO profiles (id, name, color, suit, initial)
    VALUES (@id, @name, @color, @suit, @initial)
    ON CONFLICT(id) DO NOTHING
  `);
  const upsertPresence = db.prepare(`
    INSERT INTO presence (profile_id) VALUES (?)
    ON CONFLICT(profile_id) DO NOTHING
  `);
  for (const c of CREW) {
    upsert.run(c);
    upsertPresence.run(c.id);
  }

  // Seed games
  const upsertGame = db.prepare(`
    INSERT INTO games (id, name, owner, status, version, description, url, art_url, tags)
    VALUES (@id, @name, @owner, @status, @version, @description, @url, @art_url, @tags)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const g of GAMES) upsertGame.run(g);

  console.log(`[DB] Ready at ${DB_PATH}`);
}

initDB();

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmts = {
  getProfile:   db.prepare('SELECT * FROM profiles WHERE id = ?'),
  getProfiles:  db.prepare('SELECT * FROM profiles'),
  updateXP:     db.prepare('UPDATE profiles SET xp = xp + ?, level = ? WHERE id = ?'),
  updateStats:  db.prepare('UPDATE profiles SET game_stats = ? WHERE id = ?'),
  updateBalance:db.prepare('UPDATE profiles SET casino_balance = casino_balance + ? WHERE id = ?'),

  getPresence:  db.prepare('SELECT * FROM presence'),
  upsertPing:   db.prepare(`
    INSERT INTO presence (profile_id, online, game_id, game_state, updated_at)
    VALUES (?, 1, ?, ?, strftime('%s','now'))
    ON CONFLICT(profile_id) DO UPDATE SET
      online=1, game_id=excluded.game_id,
      game_state=excluded.game_state, updated_at=excluded.updated_at
  `),
  setPingOffline: db.prepare(`
    UPDATE presence SET online=0, game_id=NULL, game_state=NULL,
    updated_at=strftime('%s','now') WHERE profile_id=?
  `),

  insertSession:  db.prepare(`
    INSERT INTO sessions (profile_id, game_id, score, data)
    VALUES (@profile_id, @game_id, @score, @data)
  `),
  getLeaderboard: db.prepare(`
    SELECT s.*, p.name, p.color, p.suit
    FROM sessions s JOIN profiles p ON p.id = s.profile_id
    WHERE (@game_id IS NULL OR s.game_id = @game_id)
    ORDER BY s.score DESC LIMIT 50
  `),
  getSessionsByProfile: db.prepare(`
    SELECT * FROM sessions WHERE profile_id = ? ORDER BY created_at DESC LIMIT 100
  `),

  getWall:    db.prepare(`
    SELECT w.*, p.name, p.color, p.suit, p.initial
    FROM wall w JOIN profiles p ON p.id = w.profile_id
    ORDER BY w.created_at DESC LIMIT 50
  `),
  getComments: db.prepare(`
    SELECT c.*, p.name, p.color, p.suit, p.initial
    FROM comments c JOIN profiles p ON p.id = c.profile_id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `),
  insertWall:   db.prepare('INSERT INTO wall (profile_id, game_id, content) VALUES (?, ?, ?)'),
  updateReactions: db.prepare('UPDATE wall SET reactions = ? WHERE id = ?'),
  getPost:      db.prepare('SELECT * FROM wall WHERE id = ?'),
  insertComment:db.prepare('INSERT INTO comments (post_id, profile_id, content) VALUES (?, ?, ?)'),

  getMessages:  db.prepare(`
    SELECT m.*, p.name as from_name, p.color as from_color, p.suit as from_suit
    FROM messages m JOIN profiles p ON p.id = m.from_id
    WHERE (from_id=@a AND to_id=@b) OR (from_id=@b AND to_id=@a)
    ORDER BY m.created_at ASC LIMIT 200
  `),
  insertMessage:db.prepare('INSERT INTO messages (from_id, to_id, content) VALUES (?, ?, ?)'),
  markRead:     db.prepare('UPDATE messages SET read=1 WHERE to_id=? AND from_id=?'),
  unreadCounts: db.prepare(`
    SELECT from_id, COUNT(*) as count FROM messages
    WHERE to_id=? AND read=0 GROUP BY from_id
  `),

  getGames:   db.prepare('SELECT * FROM games'),
  getGame:    db.prepare('SELECT * FROM games WHERE id = ?'),
};

// ─── XP & Level helpers ───────────────────────────────────────────────────────

function calcLevel(xp) {
  // Simple curve: level = floor(sqrt(xp / 100)) + 1, cap 100
  return Math.min(100, Math.floor(Math.sqrt(xp / 100)) + 1);
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Health
app.get('/', (_, res) => res.json({ service: 'N Games Network', status: 'ok', ts: Date.now() }));
app.get('/health', (_, res) => res.json({ ok: true }));

// ── Profiles ──────────────────────────────────────────────────────────────────

app.get('/profiles', (_, res) => {
  const profiles = stmts.getProfiles.all();
  res.json(profiles.map(parseProfile));
});

app.get('/profiles/:id', (req, res) => {
  const p = stmts.getProfile.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(parseProfile(p));
});

function parseProfile(p) {
  return { ...p, game_stats: safeJSON(p.game_stats, {}) };
}

// ── Presence ──────────────────────────────────────────────────────────────────

app.get('/presence', (_, res) => {
  const rows = stmts.getPresence.all();
  // Auto-offline after 90s without ping
  const now = Math.floor(Date.now() / 1000);
  res.json(rows.map(r => ({
    ...r,
    online: r.online && (now - r.updated_at) < 90 ? 1 : 0,
    game_state: safeJSON(r.game_state, null),
  })));
});

app.post('/presence/ping', (req, res) => {
  const { profile_id, game_id = null, game_state = null } = req.body;
  if (!profile_id) return res.status(400).json({ error: 'profile_id required' });
  stmts.upsertPing.run(profile_id, game_id, game_state ? JSON.stringify(game_state) : null);
  broadcast({ type: 'presence', profile_id, online: true, game_id, game_state });
  res.json({ ok: true });
});

app.post('/presence/offline', (req, res) => {
  const { profile_id } = req.body;
  if (!profile_id) return res.status(400).json({ error: 'profile_id required' });
  stmts.setPingOffline.run(profile_id);
  broadcast({ type: 'presence', profile_id, online: false, game_id: null });
  res.json({ ok: true });
});

// ── Sessions ──────────────────────────────────────────────────────────────────

app.post('/sessions', (req, res) => {
  const { profile_id, game_id, score = 0, data = {} } = req.body;
  if (!profile_id || !game_id) return res.status(400).json({ error: 'profile_id + game_id required' });

  const info = stmts.insertSession.run({
    profile_id,
    game_id,
    score: Math.floor(score),
    data: JSON.stringify(data),
  });

  // Award XP (10 XP per session + 1 per 100 score)
  const xpGain = 10 + Math.floor(score / 100);
  const profile = stmts.getProfile.get(profile_id);
  if (profile) {
    const newXP    = (profile.xp || 0) + xpGain;
    const newLevel = calcLevel(newXP);
    stmts.updateXP.run(xpGain, newLevel, profile_id);
  }

  broadcast({ type: 'session', profile_id, game_id, score, session_id: info.lastInsertRowid });
  res.json({ ok: true, session_id: info.lastInsertRowid, xp_gained: xpGain });
});

app.get('/sessions/leaderboard', (req, res) => {
  const game_id = req.query.game || null;
  const rows = stmts.getLeaderboard.all({ game_id });
  res.json(rows.map(r => ({ ...r, data: safeJSON(r.data, {}) })));
});

app.get('/sessions/:profile_id', (req, res) => {
  const rows = stmts.getSessionsByProfile.all(req.params.profile_id);
  res.json(rows.map(r => ({ ...r, data: safeJSON(r.data, {}) })));
});

// ── Wall ──────────────────────────────────────────────────────────────────────

app.get('/wall', (req, res) => {
  const posts = stmts.getWall.all();
  res.json(posts.map(p => ({ ...p, reactions: safeJSON(p.reactions, {}) })));
});

app.post('/wall/post', (req, res) => {
  const { profile_id, game_id = null, content } = req.body;
  if (!profile_id || !content) return res.status(400).json({ error: 'profile_id + content required' });

  const info = stmts.insertWall.run(profile_id, game_id, content.slice(0, 500));
  const post  = stmts.getWall.all().find(p => p.id === info.lastInsertRowid);

  broadcast({ type: 'wall_post', post: post ? { ...post, reactions: safeJSON(post.reactions, {}) } : null });
  res.json({ ok: true, post_id: info.lastInsertRowid });
});

app.post('/wall/:id/react', (req, res) => {
  const { profile_id, suit } = req.body;
  const SUITS = ['♦', '♥', '♠', '♣'];
  if (!profile_id || !SUITS.includes(suit)) return res.status(400).json({ error: 'profile_id + valid suit required' });

  const post = stmts.getPost.get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const reactions = safeJSON(post.reactions, { '♦': [], '♥': [], '♠': [], '♣': [] });
  const list = reactions[suit] || [];
  const idx  = list.indexOf(profile_id);
  if (idx === -1) list.push(profile_id);
  else list.splice(idx, 1); // toggle off
  reactions[suit] = list;

  stmts.updateReactions.run(JSON.stringify(reactions), post.id);
  broadcast({ type: 'reaction', post_id: post.id, reactions });
  res.json({ ok: true, reactions });
});

app.get('/wall/:id/comments', (req, res) => {
  const comments = stmts.getComments.all(req.params.id);
  res.json(comments);
});

app.post('/wall/:id/comment', (req, res) => {
  const { profile_id, content } = req.body;
  if (!profile_id || !content) return res.status(400).json({ error: 'profile_id + content required' });

  const info = stmts.insertComment.run(req.params.id, profile_id, content.slice(0, 300));
  broadcast({ type: 'comment', post_id: +req.params.id, profile_id, comment_id: info.lastInsertRowid });
  res.json({ ok: true, comment_id: info.lastInsertRowid });
});

// ── Messages ──────────────────────────────────────────────────────────────────

// IMPORTANT: unread route must come before /:a/:b or Express matches 'unread' as :a
app.get('/messages/unread/:profile_id', (req, res) => {
  const rows = stmts.unreadCounts.all(req.params.profile_id);
  res.json(rows);
});

app.get('/messages/:a/:b', (req, res) => {
  const { a, b } = req.params;
  const rows = stmts.getMessages.all({ a, b });
  res.json(rows);
});

app.post('/messages', (req, res) => {
  const { from_id, to_id, content } = req.body;
  if (!from_id || !to_id || !content) return res.status(400).json({ error: 'from_id, to_id, content required' });

  const info = stmts.insertMessage.run(from_id, to_id, content.slice(0, 1000));
  const msg  = { id: info.lastInsertRowid, from_id, to_id, content, created_at: Math.floor(Date.now() / 1000) };

  broadcast({ type: 'message', message: msg }, [to_id]);
  res.json({ ok: true, message_id: info.lastInsertRowid });
});

app.post('/messages/read', (req, res) => {
  const { reader_id, from_id } = req.body;
  stmts.markRead.run(reader_id, from_id);
  res.json({ ok: true });
});

// ── Games ─────────────────────────────────────────────────────────────────────

app.get('/games', (_, res) => {
  const rows = stmts.getGames.all();
  res.json(rows.map(g => ({ ...g, tags: safeJSON(g.tags, []) })));
});

app.get('/games/:id', (req, res) => {
  const g = stmts.getGame.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  res.json({ ...g, tags: safeJSON(g.tags, []) });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

// Map profile_id → Set of ws clients
const clients = new Map(); // profile_id → Set<ws>

wss.on('connection', (ws, req) => {
  let profileId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'identify' && msg.profile_id) {
        profileId = msg.profile_id;
        if (!clients.has(profileId)) clients.set(profileId, new Set());
        clients.get(profileId).add(ws);
        ws.send(JSON.stringify({ type: 'identified', profile_id: profileId }));
        console.log(`[WS] ${profileId} connected`);
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      }
    } catch (e) {
      // bad json — ignore
    }
  });

  ws.on('close', () => {
    if (profileId && clients.has(profileId)) {
      clients.get(profileId).delete(ws);
      if (clients.get(profileId).size === 0) {
        clients.delete(profileId);
        // Auto-offline
        stmts.setPingOffline.run(profileId);
        broadcast({ type: 'presence', profile_id: profileId, online: false });
      }
    }
  });

  ws.on('error', () => {});
});

/**
 * Broadcast a JSON message to all connected clients.
 * @param {object} payload
 * @param {string[]} [targetIds] — if set, only send to these profile IDs
 */
function broadcast(payload, targetIds = null) {
  const data = JSON.stringify(payload);
  if (targetIds) {
    for (const id of targetIds) {
      const sockets = clients.get(id);
      if (sockets) {
        for (const ws of sockets) {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        }
      }
    }
  } else {
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  }
}

// ─── Periodic stale-presence sweep (every 60s) ───────────────────────────────

setInterval(() => {
  const cutoff = Math.floor(Date.now() / 1000) - 90;
  const stale  = db.prepare(`
    SELECT profile_id FROM presence WHERE online=1 AND updated_at < ?
  `).all(cutoff);

  for (const row of stale) {
    stmts.setPingOffline.run(row.profile_id);
    broadcast({ type: 'presence', profile_id: row.profile_id, online: false });
    console.log(`[Presence] Auto-offline: ${row.profile_id}`);
  }
}, 60_000);

// ─── Mobile command center ────────────────────────────────────────────────────
const MOBILE_PIN      = process.env.MOBILE_PIN || '1337';
const MOBILE_HTML_PATH = path.join(__dirname, 'mobile.html');

app.get('/mobile', (req, res) => {
  if (fs.existsSync(MOBILE_HTML_PATH)) {
    res.sendFile(MOBILE_HTML_PATH);
  } else {
    res.status(404).send('Mobile app not found');
  }
});

app.post('/mobile/auth', (req, res) => {
  const { pin } = req.body;
  if (pin === MOBILE_PIN) res.json({ ok: true });
  else res.status(401).json({ ok: false, error: 'Wrong PIN' });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeJSON(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[N Games Network] Server running on :${PORT}`);
  console.log(`[N Games Network] DB: ${DB_PATH}`);
});
