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
    id:          'chaos-casino',
    name:        'Chaos Casino',
    owner:       'keshawn',
    status:      'live',
    version:     '1.0',
    description: 'ALL IN — Five Games · One Chaos Engine',
    url:         'https://chaos-holdem-server3-production.up.railway.app',
    art_url:     '/assets/chaos-holdem-banner.png',
    tags:        JSON.stringify(['casino','roguelike','poker','blackjack','slots','crash','roulette']),
  },
  {
    id:          'chaos-holdem',
    name:        'Chaos Hold\'Em',
    owner:       'keshawn',
    status:      'live',
    version:     '1.0.0',
    description: 'Roguelike poker. Run-based chaos.',
    url:         'https://chaos-holdem-server3-production.up.railway.app',
    art_url:     '/assets/chaos-holdem-banner.png',
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
      np              INTEGER DEFAULT 0,
      level           INTEGER DEFAULT 1,
      game_stats      TEXT DEFAULT '{}',
      created_at      INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS presence (
      profile_id      TEXT PRIMARY KEY REFERENCES profiles(id),
      online          INTEGER DEFAULT 0,
      game_id         TEXT,
      game_state      TEXT,
      current_game    TEXT,
      playtime_total  INTEGER DEFAULT 0,
      last_ping_at    INTEGER DEFAULT 0,
      updated_at      INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id   TEXT NOT NULL REFERENCES profiles(id),
      game_id      TEXT NOT NULL,
      game_mode    TEXT,
      game_version TEXT,
      score        INTEGER DEFAULT 0,
      outcome      TEXT DEFAULT 'bust',
      data         TEXT DEFAULT '{}',
      created_at   INTEGER DEFAULT (strftime('%s','now'))
    );

    -- Per-mode leaderboard stats (upserted on each run end)
    CREATE TABLE IF NOT EXISTS mode_stats (
      profile_id   TEXT NOT NULL REFERENCES profiles(id),
      game_id      TEXT NOT NULL,
      game_mode    TEXT NOT NULL,
      best_score   INTEGER DEFAULT 0,
      run_count    INTEGER DEFAULT 0,
      best_round   INTEGER DEFAULT 0,
      best_mult    REAL    DEFAULT 0,
      best_machine INTEGER DEFAULT 0,
      best_spin    INTEGER DEFAULT 0,
      updated_at   INTEGER DEFAULT (strftime('%s','now')),
      PRIMARY KEY (profile_id, game_id, game_mode)
    );

    CREATE TABLE IF NOT EXISTS wall (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id   TEXT NOT NULL REFERENCES profiles(id),
      game_id      TEXT,
      game_mode    TEXT,
      content      TEXT NOT NULL,
      reactions    TEXT DEFAULT '{"♦":[],"♥":[],"♠":[],"♣":[]}',
      created_at   INTEGER DEFAULT (strftime('%s','now'))
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

    CREATE TABLE IF NOT EXISTS achievements (
      id          TEXT PRIMARY KEY,
      game_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL,
      icon        TEXT DEFAULT '🏆',
      type        TEXT DEFAULT 'unlock',   -- unlock | progress
      goal        INTEGER DEFAULT 1,
      xp_reward   INTEGER DEFAULT 50,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS profile_achievements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  TEXT NOT NULL REFERENCES profiles(id),
      achievement_id TEXT NOT NULL REFERENCES achievements(id),
      progress    INTEGER DEFAULT 0,
      unlocked    INTEGER DEFAULT 0,
      unlocked_at INTEGER,
      updated_at  INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(profile_id, achievement_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_game    ON sessions(game_id);
    CREATE INDEX IF NOT EXISTS idx_wall_created     ON wall(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_pair    ON messages(from_id, to_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to      ON messages(to_id, read);
    CREATE INDEX IF NOT EXISTS idx_pa_profile       ON profile_achievements(profile_id);
    CREATE INDEX IF NOT EXISTS idx_mode_stats         ON mode_stats(profile_id, game_id);
    CREATE INDEX IF NOT EXISTS idx_pa_achievement   ON profile_achievements(achievement_id);
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
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, description=excluded.description,
      art_url=excluded.art_url, status=excluded.status,
      updated_at=strftime('%s','now')
  `);
  for (const g of GAMES) upsertGame.run(g);

  // Seed achievements registry (upsert — safe to re-run)
  const upsertAch = db.prepare(`
    INSERT INTO achievements (id, game_id, name, description, icon, type, goal, xp_reward)
    VALUES (@id, @game_id, @name, @description, @icon, @type, @goal, @xp_reward)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, description=excluded.description,
      icon=excluded.icon, goal=excluded.goal, xp_reward=excluded.xp_reward
  `);

  const ACHIEVEMENTS = [
    // ── Chaos Hold'Em ────────────────────────────────────────────────────────
    { id:'ch_first_win',      game_id:'chaos-holdem', name:'First Blood',      description:'Win your first run',                    icon:'🩸', type:'unlock',   goal:1,   xp_reward:100 },
    { id:'ch_hardcore',       game_id:'chaos-holdem', name:'Hardcore',         description:'Win a run on Hardcore mode',             icon:'💀', type:'unlock',   goal:1,   xp_reward:300 },
    { id:'ch_boss_slayer',    game_id:'chaos-holdem', name:'Boss Slayer',      description:'Defeat 10 bosses across all runs',       icon:'⚔️', type:'progress', goal:10,  xp_reward:150 },
    { id:'ch_big_stack',      game_id:'chaos-holdem', name:'Big Stack',        description:'Reach $10,000 chips in a single run',   icon:'💰', type:'progress', goal:10000, xp_reward:200 },
    { id:'ch_century',        game_id:'chaos-holdem', name:'Century',          description:'Play 100 hands in a single run',        icon:'🃏', type:'progress', goal:100, xp_reward:150 },
    { id:'ch_chaos_master',   game_id:'chaos-holdem', name:'Chaos Master',     description:'Defeat the final boss',                 icon:'👑', type:'unlock',   goal:1,   xp_reward:500 },
    { id:'ch_untouchable',    game_id:'chaos-holdem', name:'Untouchable',      description:'Win without ever going broke',          icon:'🛡️', type:'unlock',   goal:1,   xp_reward:250 },
    { id:'ch_high_roller',    game_id:'chaos-holdem', name:'High Roller',      description:'Score over 50,000 points in a run',     icon:'🎰', type:'progress', goal:50000, xp_reward:200 },
    { id:'ch_survivor',       game_id:'chaos-holdem', name:'Survivor',         description:'Complete 10 runs total',                icon:'🔟', type:'progress', goal:10,  xp_reward:100 },
    { id:'ch_dedicated',      game_id:'chaos-holdem', name:'Dedicated',        description:'Complete 50 runs total',                icon:'🎖️', type:'progress', goal:50,  xp_reward:300 },
    // ── N Games Network (cross-game) ─────────────────────────────────────────
    { id:'ng_first_session',  game_id:'ngames',       name:'Welcome',          description:'Submit your first session',              icon:'🌐', type:'unlock',   goal:1,   xp_reward:50  },
    { id:'ng_wall_post',      game_id:'ngames',       name:'Broadcaster',      description:'Post to the wall 10 times',             icon:'📢', type:'progress', goal:10,  xp_reward:100 },
    { id:'ng_level_5',        game_id:'ngames',       name:'Level 5',          description:'Reach Level 5',                         icon:'⭐', type:'progress', goal:5,   xp_reward:200 },
    { id:'ng_level_10',       game_id:'ngames',       name:'Veteran',          description:'Reach Level 10',                        icon:'🌟', type:'progress', goal:10,  xp_reward:500 },
  ];

  for (const a of ACHIEVEMENTS) upsertAch.run(a);

  console.log(`[DB] Ready at ${DB_PATH}`);
}

initDB();

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmts = {
  getProfile:   db.prepare('SELECT * FROM profiles WHERE id = ?'),
  getProfiles:  db.prepare('SELECT * FROM profiles'),
  updateNP:     db.prepare('UPDATE profiles SET np = np + ?, level = ? WHERE id = ?'),
  updateStats:  db.prepare('UPDATE profiles SET game_stats = ? WHERE id = ?'),

  getPresence:  db.prepare('SELECT * FROM presence'),
  upsertPing:   db.prepare(`
    INSERT INTO presence (profile_id, online, game_id, game_state, current_game, last_ping_at, updated_at)
    VALUES (?, 1, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))
    ON CONFLICT(profile_id) DO UPDATE SET
      online=1, game_id=excluded.game_id,
      game_state=excluded.game_state,
      current_game=excluded.current_game,
      last_ping_at=excluded.last_ping_at,
      updated_at=excluded.updated_at
  `),
  setPingOffline: db.prepare(`
    UPDATE presence SET online=0, game_id=NULL, game_state=NULL,
    updated_at=strftime('%s','now') WHERE profile_id=?
  `),

  insertSession:  db.prepare(`
    INSERT INTO sessions (profile_id, game_id, game_mode, game_version, score, outcome, data)
    VALUES (@profile_id, @game_id, @game_mode, @game_version, @score, @outcome, @data)
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
  insertWall:   db.prepare('INSERT INTO wall (profile_id, game_id, game_mode, content) VALUES (?, ?, ?, ?)'),
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
  getAchievements:       db.prepare('SELECT * FROM achievements WHERE game_id = ? OR game_id = ?'),
  getAllAchievements:    db.prepare('SELECT * FROM achievements'),
  getProfileAchievements: db.prepare('SELECT pa.*, a.name, a.description, a.icon, a.type, a.goal, a.xp_reward, a.game_id FROM profile_achievements pa JOIN achievements a ON pa.achievement_id = a.id WHERE pa.profile_id = ?'),
  upsertProgress: db.prepare(`
    INSERT INTO profile_achievements (profile_id, achievement_id, progress, unlocked, unlocked_at)
    VALUES (@profile_id, @achievement_id, @progress, @unlocked, @unlocked_at)
    ON CONFLICT(profile_id, achievement_id) DO UPDATE SET
      progress=MAX(excluded.progress, progress),
      unlocked=MAX(excluded.unlocked, unlocked),
      unlocked_at=COALESCE(unlocked_at, excluded.unlocked_at),
      updated_at=strftime('%s','now')
  `),
};

// ─── XP & Level helpers ───────────────────────────────────────────────────────

function tryUnlockAchievement(profile_id, achievement_id, progress) {
  try {
    const ach     = db.prepare('SELECT * FROM achievements WHERE id = ?').get(achievement_id);
    if (!ach) return;
    const current = db.prepare('SELECT * FROM profile_achievements WHERE profile_id = ? AND achievement_id = ?').get(profile_id, achievement_id);
    if (current?.unlocked) return;
    const unlocked    = progress >= ach.goal ? 1 : 0;
    const unlocked_at = unlocked ? Math.floor(Date.now() / 1000) : null;
    stmts.upsertProgress.run({ profile_id, achievement_id, progress, unlocked, unlocked_at });
    if (unlocked) {
      const prof   = stmts.getProfile.get(profile_id);
      const newNP  = (prof?.np || 0) + ach.xp_reward;
      const newLvl = calcLevel(newNP);
      stmts.updateNP.run(ach.xp_reward, newLvl, profile_id);
      broadcast({ type: 'achievement_unlock', profile_id, achievement_id, achievement: ach });
    }
  } catch(e) { console.error('[tryUnlockAchievement]', e.message); }
}

// NP required to reach each level (cap 50)
const NP_TABLE = (() => {
  const t = [0, 0]; // t[1]=0
  for (let lvl = 2; lvl <= 50; lvl++) {
    if (lvl <= 25) t.push(Math.floor(300 * Math.pow(lvl-1, 1.9)));
    else           t.push(t[25] + Math.floor(5000 * Math.pow(lvl-25, 2.1)));
  }
  return t;
})();

function calcLevel(np) {
  let lvl = 1;
  for (let i = 2; i <= 50; i++) {
    if (np >= NP_TABLE[i]) lvl = i;
    else break;
  }
  return lvl;
}

const LEVEL_TITLES = [
  '', 'Newcomer','Newcomer','Newcomer','Newcomer',
  'Douglass','Douglass','Douglass','Douglass','Douglass',
  'Hughes','Hughes','Hughes','Hughes','Hughes',
  'Ali','Ali','Ali','Ali','Ali',
  'Malcolm','Malcolm','Malcolm','Malcolm','Malcolm',
  'Coltrane','Coltrane','Coltrane','Coltrane','Coltrane',
  'Baldwin','Baldwin','Baldwin','Baldwin','Baldwin',
  'Tubman','Tubman','Tubman','Tubman','Tubman',
  'King','King','King','King','King',
  'Obama','Obama','Obama','Obama','Obama',
  'N Master',
];

function getLevelTitle(lvl) {
  return LEVEL_TITLES[Math.min(lvl, 50)] || 'Newcomer';
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health
app.get('/', (_, res) => res.json({ service: 'N Games Network', status: 'ok', ts: Date.now() }));
app.get('/health', (_, res) => res.json({ ok: true }));
// ── Achievements ─────────────────────────────────────────────────────────────

// GET /achievements — all achievements (optionally filtered by game)
app.get('/achievements', (req, res) => {
  const { game_id } = req.query;
  const rows = game_id
    ? stmts.getAchievements.all(game_id, 'ngames')
    : stmts.getAllAchievements.all();
  res.json(rows);
});

// GET /achievements/:profile_id — all progress for a profile
app.get('/achievements/:profile_id', (req, res) => {
  const all   = stmts.getAllAchievements.all();
  const prog  = stmts.getProfileAchievements.all(req.params.profile_id);
  const progMap = {};
  for (const p of prog) progMap[p.achievement_id] = p;

  const result = all.map(a => ({
    ...a,
    progress:    progMap[a.id]?.progress    || 0,
    unlocked:    progMap[a.id]?.unlocked    || 0,
    unlocked_at: progMap[a.id]?.unlocked_at || null,
  }));
  res.json(result);
});

// POST /achievements/unlock — unlock or update progress
app.post('/achievements/unlock', (req, res) => {
  const { profile_id, achievement_id, progress } = req.body;
  if (!profile_id || !achievement_id) return res.status(400).json({ error: 'profile_id and achievement_id required' });

  const ach = db.prepare('SELECT * FROM achievements WHERE id = ?').get(achievement_id);
  if (!ach) return res.status(404).json({ error: 'Achievement not found' });

  const newProgress = Math.max(progress || 0, 0);
  const unlocked    = newProgress >= ach.goal ? 1 : 0;
  const unlocked_at = unlocked ? Math.floor(Date.now() / 1000) : null;

  // Get current state to check if newly unlocked
  const current = db.prepare('SELECT * FROM profile_achievements WHERE profile_id = ? AND achievement_id = ?').get(profile_id, achievement_id);
  const wasUnlocked = current?.unlocked === 1;

  stmts.upsertProgress.run({ profile_id, achievement_id, progress: newProgress, unlocked, unlocked_at });

  // Award XP on first unlock
  if (unlocked && !wasUnlocked) {
    const prof = stmts.getProfile.get(profile_id);
    if (prof) {
      const newNP  = (prof.np || 0) + ach.xp_reward;
      const newLvl = Math.min(100, Math.floor(Math.sqrt(newNP / 100)) + 1);
      stmts.updateNP.run(ach.xp_reward, newLvl, profile_id);
    }
    broadcast({ type: 'achievement_unlock', profile_id, achievement_id, achievement: ach });
    console.log(`[Achievement] ${profile_id} unlocked ${achievement_id} (+${ach.xp_reward} XP)`);
  }

  res.json({ ok: true, unlocked: unlocked === 1, progress: newProgress, np_awarded: unlocked && !wasUnlocked ? ach.xp_reward : 0 });
});

// ── Casino Games Backend ──────────────────────────────────────────────────────
// Ready for Sean's casino games inside Chaos Hold'Em
// Tables: casino_games (registry), casino_sessions (per-game history), casino_jackpots

// Schema is initialized in initDB — added to existing DB via CREATE IF NOT EXISTS
db.exec(`
  CREATE TABLE IF NOT EXISTS casino_games (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    game_id     TEXT NOT NULL REFERENCES games(id),
    type        TEXT NOT NULL,  -- slots | blackjack | roulette | poker | dice | custom
    description TEXT,
    active      INTEGER DEFAULT 1,
    min_bet     INTEGER DEFAULT 10,
    max_bet     INTEGER DEFAULT 10000,
    house_edge  REAL    DEFAULT 0.05,
    config      TEXT    DEFAULT '{}',
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS casino_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT NOT NULL REFERENCES profiles(id),
    casino_game_id TEXT NOT NULL REFERENCES casino_games(id),
    bet         INTEGER NOT NULL,
    outcome     INTEGER NOT NULL,  -- positive = win, negative = loss
    data        TEXT DEFAULT '{}',
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS casino_jackpots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    casino_game_id TEXT NOT NULL REFERENCES casino_games(id),
    profile_id  TEXT NOT NULL REFERENCES profiles(id),
    amount      INTEGER NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_casino_sessions_profile ON casino_sessions(profile_id);
  CREATE INDEX IF NOT EXISTS idx_casino_sessions_game    ON casino_sessions(casino_game_id);
`);

// GET /casino/games — list all casino games for a game_id
app.get('/casino/games', (req, res) => {
  const { game_id } = req.query;
  const rows = game_id
    ? db.prepare('SELECT * FROM casino_games WHERE game_id = ? AND active = 1').all(game_id)
    : db.prepare('SELECT * FROM casino_games WHERE active = 1').all();
  res.json(rows.map(r => ({ ...r, config: safeJSON(r.config, {}) })));
});

// POST /casino/games — register a new casino game (from game dev)
app.post('/casino/games', (req, res) => {
  const { id, name, game_id, type, description, min_bet, max_bet, house_edge, config } = req.body;
  if (!id || !name || !game_id || !type) return res.status(400).json({ error: 'id, name, game_id, type required' });
  db.prepare(`
    INSERT INTO casino_games (id, name, game_id, type, description, min_bet, max_bet, house_edge, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
      min_bet=excluded.min_bet, max_bet=excluded.max_bet, config=excluded.config
  `).run(id, name, game_id, type, description || '', min_bet || 10, max_bet || 10000, house_edge || 0.05, JSON.stringify(config || {}));
  res.json({ ok: true });
});

// POST /casino/session — record a casino game result (roguelike: no persistent balance)
app.post('/casino/session', (req, res) => {
  const { profile_id, casino_game_id, bet, outcome } = req.body;
  if (!profile_id || !casino_game_id || bet == null || outcome == null) {
    return res.status(400).json({ error: 'profile_id, casino_game_id, bet, outcome required' });
  }
  const prof = stmts.getProfile.get(profile_id);
  if (!prof) return res.status(404).json({ error: 'Profile not found' });

  const data = req.body.data ? JSON.stringify(req.body.data) : '{}';
  db.prepare('INSERT INTO casino_sessions (profile_id, casino_game_id, bet, outcome, data) VALUES (?,?,?,?,?)')
    .run(profile_id, casino_game_id, bet, outcome, data);

  // Award NP for casino play (1 NP per 100 chips wagered)
  const npGain = Math.floor(Math.abs(bet) / 100);
  if (npGain > 0) {
    const newNP  = (prof.np || 0) + npGain;
    const newLvl = calcLevel(newNP);
    stmts.updateNP.run(npGain, newLvl, profile_id);
  }

  broadcast({ type: 'casino_session', profile_id, casino_game_id, bet, outcome });
  res.json({ ok: true, np_gained: npGain });
});

// GET /casino/history/:profile_id — last 50 casino sessions
app.get('/casino/history/:profile_id', (req, res) => {
  const rows = db.prepare('SELECT cs.*, cg.name as game_name, cg.type as game_type FROM casino_sessions cs JOIN casino_games cg ON cs.casino_game_id = cg.id WHERE cs.profile_id = ? ORDER BY cs.created_at DESC LIMIT 50').all(req.params.profile_id);
  res.json(rows.map(r => ({ ...r, data: safeJSON(r.data, {}) })));
});

// ── Crash ticker ─────────────────────────────────────────────────────────────
// POST /crash/run — game calls this when a crash round ends; broadcasts to all
app.post('/crash/run', (req, res) => {
  const { player, mult, win, profile_id } = req.body;
  if (!player || mult == null) return res.status(400).json({ error: 'player + mult required' });
  broadcast({ type: 'crash_run', player, mult: parseFloat(mult), win: !!win, profile_id: profile_id || null, ts: Date.now() });
  res.json({ ok: true });
});

app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'banner-upload.html')));

// Static assets (game banners, etc.)
const ASSETS_DIR = fs.existsSync('/data') ? '/data/assets' : path.join(__dirname, 'assets');
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
app.use('/assets', express.static(ASSETS_DIR));

// ── Admin: update game art (POST /admin/games/:id/art) ───────────────────────
// Accepts a PNG/JPG as base64 in the request body
// Protected by ADMIN_KEY env var (set in Railway Variables)
const ADMIN_KEY = process.env.ADMIN_KEY || 'ngames-admin';

app.post('/admin/games/:id/art', (req, res) => {
  const { key, image_base64, filename } = req.body;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const game = stmts.getGame.get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });

  try {
    const ext      = (filename || 'banner.png').split('.').pop().toLowerCase();
    const fname    = `${req.params.id}-banner.${ext}`;
    const destPath = path.join(ASSETS_DIR, fname);
    const data     = image_base64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(destPath, Buffer.from(data, 'base64'));

    const art_url = `/assets/${fname}`;
    db.prepare("UPDATE games SET art_url = ?, updated_at = strftime('%s','now') WHERE id = ?")
      .run(art_url, req.params.id);

    console.log(`[Art] Updated art for ${req.params.id}: ${art_url}`);
    res.json({ ok: true, art_url });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: list games (GET /admin/games) ─────────────────────────────────────
app.get('/admin/games', (req, res) => {
  const { key } = req.query;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  res.json(stmts.getGames.all().map(g => ({ ...g, tags: safeJSON(g.tags, []) })));
});

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
  return { ...p, game_stats: safeJSON(p.game_stats, {}), title: getLevelTitle(p.level || 1), np_next: NP_TABLE[Math.min((p.level||1)+1, 50)] };
}

// ── Presence ──────────────────────────────────────────────────────────────────

app.get('/presence', (_, res) => {
  const rows = stmts.getPresence.all();
  // Auto-offline after 90s without ping
  const now = Math.floor(Date.now() / 1000);
  res.json(rows.map(r => ({
    ...r,
    online: r.online && (now - r.updated_at) < 90 ? 1 : 0,
    game_state:   safeJSON(r.game_state, null),
    current_game: r.current_game || null,
  })));
});

app.post('/presence/ping', (req, res) => {
  const { profile_id, game_id = null, game_state = null, playtime_seconds = 0, current_game = null } = req.body;
  if (!profile_id) return res.status(400).json({ error: 'profile_id required' });

  const now  = Math.floor(Date.now() / 1000);
  const prev = db.prepare('SELECT last_ping_at, playtime_total FROM presence WHERE profile_id = ?').get(profile_id);

  // NP for playtime — 1 NP per minute, capped at 90s per ping to prevent abuse
  let np_awarded = 0;
  if (prev && game_id) {
    const elapsed = now - (prev.last_ping_at || now);
    const cappedSeconds = Math.min(elapsed, 90);
    const np = Math.floor(cappedSeconds / 60);
    if (np > 0) {
      const prof   = stmts.getProfile.get(profile_id);
      if (prof) {
        const newNP  = (prof.np || 0) + np;
        const newLvl = calcLevel(newNP);
        stmts.updateNP.run(np, newLvl, profile_id);
        np_awarded = np;

        // Check level achievements
        if (newLvl >= 5)  tryUnlockAchievement(profile_id, 'ng_level_5',  newLvl);
        if (newLvl >= 10) tryUnlockAchievement(profile_id, 'ng_level_10', newLvl);
      }
    }
    // Update playtime_total
    db.prepare('UPDATE presence SET playtime_total = playtime_total + ? WHERE profile_id = ?').run(cappedSeconds, profile_id);
  }

  stmts.upsertPing.run(profile_id, normGameId(game_id), game_state ? JSON.stringify(game_state) : null, current_game);

  // Broadcast with full profile NP so launcher can update instantly
  const prof = stmts.getProfile.get(profile_id);
  const title = getLevelTitle(prof?.level || 1);
  broadcast({ type: 'presence', profile_id, online: true, game_id: normGameId(game_id), game_state, current_game, np: prof?.np || 0, level: prof?.level || 1, title });
  res.json({ ok: true, np_awarded, np: prof?.np || 0, level: prof?.level || 1, title });
});

app.post('/presence/offline', (req, res) => {
  const { profile_id } = req.body;
  if (!profile_id) return res.status(400).json({ error: 'profile_id required' });
  stmts.setPingOffline.run(profile_id);
  broadcast({ type: 'presence', profile_id, online: false, game_id: null });
  res.json({ ok: true });
});

// ── Sessions ──────────────────────────────────────────────────────────────────

// Normalize game_id — treat chaos-holdem and chaos-casino as aliases
function normGameId(id) {
  if (id === 'chaos-holdem' || id === 'chaos-casino') return id; // keep original for history
  return id;
}

const WIN_OUTCOMES  = new Set(['win', 'cashout']);
const LOSS_OUTCOMES = new Set(['bust', 'quit']);
const SAVE_OUTCOME  = 'saved';

app.post('/sessions', (req, res) => {
  const {
    profile_id, game_id, score = 0, data = {},
    game_mode = null, game_version = null, outcome = 'bust',
  } = req.body;
  if (!profile_id || !game_id) return res.status(400).json({ error: 'profile_id + game_id required' });

  // Mid-run save — acknowledge but don't record to leaderboard
  if (outcome === SAVE_OUTCOME) {
    return res.json({ ok: true, saved: true, np_gained: 0 });
  }

  // Normalize quit → bust
  const normalizedOutcome = outcome === 'quit' ? 'bust' : outcome;

  const info = stmts.insertSession.run({
    profile_id,
    game_id: normGameId(game_id),
    game_mode: game_mode || null,
    game_version: game_version || null,
    score: Math.floor(score),
    outcome: normalizedOutcome,
    data: JSON.stringify(data),
  });

  // Upsert per-mode stats
  if (game_mode) {
    const gid = normGameId(game_id);
    const existing = db.prepare('SELECT * FROM mode_stats WHERE profile_id=? AND game_id=? AND game_mode=?').get(profile_id, gid, game_mode);
    const d = safeJSON(JSON.stringify(data), {});
    db.prepare(`
      INSERT INTO mode_stats (profile_id, game_id, game_mode, best_score, run_count, best_round, best_mult, best_machine, best_spin)
      VALUES (?,?,?,?,1,?,?,?,?)
      ON CONFLICT(profile_id, game_id, game_mode) DO UPDATE SET
        best_score   = MAX(best_score,   excluded.best_score),
        run_count    = run_count + 1,
        best_round   = MAX(best_round,   excluded.best_round),
        best_mult    = MAX(best_mult,     excluded.best_mult),
        best_machine = MAX(best_machine,  excluded.best_machine),
        best_spin    = MAX(best_spin,     excluded.best_spin),
        updated_at   = strftime('%s','now')
    `).run(
      profile_id, gid, game_mode,
      Math.floor(score),
      d.best_round  || d.round  || 0,
      d.best_mult   || d.mult   || 0,
      d.best_machine|| d.machine|| 0,
      d.best_spin   || d.spin   || 0,
    );
  }

  // Award NP only for completed runs
  let npGain = 0;
  if (WIN_OUTCOMES.has(normalizedOutcome) || LOSS_OUTCOMES.has(normalizedOutcome)) {
    npGain = 10 + Math.floor(score / 100);
    const profile = stmts.getProfile.get(profile_id);
    if (profile) {
      const newNP    = (profile.np || 0) + npGain;
      const newLevel = calcLevel(newNP);
      stmts.updateNP.run(npGain, newLevel, profile_id);
      tryUnlockAchievement(profile_id, 'ng_first_session', 1);
    }
  }

  broadcast({ type: 'session', profile_id, game_id: normGameId(game_id), game_mode, score, outcome: normalizedOutcome, session_id: info.lastInsertRowid });
  res.json({ ok: true, session_id: info.lastInsertRowid, np_gained: npGain });
});

// GET /sessions/leaderboard/modes — per-mode stats for a profile
app.get('/sessions/leaderboard/modes', (req, res) => {
  const { profile_id, game_id } = req.query;
  const gid = game_id || 'chaos-casino';
  // Accept both IDs
  const rows = db.prepare(`
    SELECT * FROM mode_stats
    WHERE profile_id = ?
    AND (game_id = ? OR game_id = 'chaos-holdem' OR game_id = 'chaos-casino')
    ORDER BY best_score DESC
  `).all(profile_id || '', gid);
  res.json(rows);
});

// GET /sessions/leaderboard/mode/:mode — top scores per mode across all players
app.get('/sessions/leaderboard/mode/:mode', (req, res) => {
  const rows = db.prepare(`
    SELECT ms.*, p.name, p.color, p.initial
    FROM mode_stats ms JOIN profiles p ON p.id = ms.profile_id
    WHERE ms.game_mode = ?
    ORDER BY ms.best_score DESC LIMIT 20
  `).all(req.params.mode);
  res.json(rows);
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
  const { profile_id, game_id = null, game_mode = null, content } = req.body;
  if (!profile_id || !content) return res.status(400).json({ error: 'profile_id + content required' });

  const info = stmts.insertWall.run(profile_id, normGameId(game_id), game_mode, content.slice(0, 500));
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

app.delete('/wall/:id', (req, res) => {
  const { profile_id } = req.body;
  if (!profile_id) return res.status(400).json({ error: 'profile_id required' });
  const post = stmts.getPost.get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  // Allow post owner or keshawn (admin) to delete
  if (post.profile_id !== profile_id && profile_id !== 'keshawn') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  db.prepare('DELETE FROM wall WHERE id = ?').run(req.params.id);
  broadcast({ type: 'wall_delete', post_id: +req.params.id });
  res.json({ ok: true });
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
