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
      game_mode   TEXT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL,
      icon        TEXT DEFAULT '🏆',
      type        TEXT DEFAULT 'unlock',
      goal        INTEGER DEFAULT 1,
      xp_reward   INTEGER DEFAULT 50,
      secret      INTEGER DEFAULT 0,
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

  // ── Migrations — add columns that may not exist on older DBs ───────────────
  const migrations = [
    "ALTER TABLE achievements ADD COLUMN game_mode TEXT",
    "ALTER TABLE achievements ADD COLUMN secret INTEGER DEFAULT 0",
    "ALTER TABLE sessions ADD COLUMN game_mode TEXT",
    "ALTER TABLE sessions ADD COLUMN game_version TEXT",
    "ALTER TABLE sessions ADD COLUMN outcome TEXT DEFAULT 'bust'",
    "ALTER TABLE presence ADD COLUMN current_game TEXT",
    "ALTER TABLE presence ADD COLUMN playtime_total INTEGER DEFAULT 0",
    "ALTER TABLE presence ADD COLUMN last_ping_at INTEGER DEFAULT 0",
    "ALTER TABLE wall ADD COLUMN game_mode TEXT",
  ];
  for (const sql of migrations) {
    try { db.prepare(sql).run(); } catch(e) { /* column already exists */ }
  }

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
    INSERT INTO achievements (id, game_id, game_mode, name, description, icon, type, goal, xp_reward, secret)
    VALUES (@id, @game_id, @game_mode, @name, @description, @icon, @type, @goal, @xp_reward, @secret)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, description=excluded.description,
      icon=excluded.icon, goal=excluded.goal, xp_reward=excluded.xp_reward,
      secret=excluded.secret, game_mode=excluded.game_mode
  `);

  const ACHIEVEMENTS = [
    // ── POKER — Core Gameplay ─────────────────────────────────────────────────
    { id:'first_win',        game_id:'chaos-casino', name:'First Blood',           description:'Win your first hand',                     icon:'🩸', type:'unlock',   goal:1,     xp_reward:50,  secret:false },
    { id:'win_streak_3',     game_id:'chaos-casino', name:'On A Roll',             description:'Win 3 hands in a row',                    icon:'🔥', type:'unlock',   goal:1,     xp_reward:50,  secret:false },
    { id:'win_streak_5',     game_id:'chaos-casino', name:'Unstoppable',           description:'Win 5 hands in a row',                    icon:'⚡', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'win_streak_7',     game_id:'chaos-casino', name:'Volcanic',              description:'Win 7 hands in a row',                    icon:'🌋', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'win_streak_10',    game_id:'chaos-casino', name:'Godmode',               description:'Win 10 hands in a row',                   icon:'👁', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'royal_flush',      game_id:'chaos-casino', name:'Perfection',            description:'Win with Royal Flush',                    icon:'👑', type:'unlock',   goal:1,     xp_reward:300, secret:false },
    { id:'straight_flush',   game_id:'chaos-casino', name:'Colors',                description:'Win with Straight Flush',                 icon:'🎨', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'four_kind',        game_id:'chaos-casino', name:'Quad Damage',           description:'Win with Four of a Kind',                 icon:'4️⃣', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'win_low_hand',     game_id:'chaos-casino', name:'Bottom of the Barrel',  description:'Win with only High Card',                 icon:'🪣', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'all_in_win',       game_id:'chaos-casino', name:"Gambler's Glory",       description:'Win after going all-in',                  icon:'🎲', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'survive_15',       game_id:'chaos-casino', name:'Two Week Notice',       description:'Survive 15 rounds',                       icon:'📋', type:'progress', goal:15,    xp_reward:75,  secret:false },
    { id:'survive_20',       game_id:'chaos-casino', name:'Marathon',              description:'Survive 20 rounds',                       icon:'🏃', type:'progress', goal:20,    xp_reward:100, secret:false },
    { id:'survive_30',       game_id:'chaos-casino', name:'Legend',                description:'Survive 30 rounds',                       icon:'🏆', type:'progress', goal:30,    xp_reward:200, secret:false },
    { id:'ch_century',       game_id:'chaos-casino', name:'Century',               description:'Play 100 hands in one run',               icon:'🃏', type:'progress', goal:100,   xp_reward:150, secret:false },
    { id:'broke_twice',      game_id:'chaos-casino', name:'Glutton for Punishment','description':'Go broke and revive twice',             icon:'💸', type:'progress', goal:2,     xp_reward:75,  secret:false },
    { id:'one_life_win',     game_id:'chaos-casino', name:'On the Edge',           description:'Win with exactly 1 life',                 icon:'❤️', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'max_lives',        game_id:'chaos-casino', name:'Extra Lives',           description:'Have 5+ lives at once',                   icon:'💚', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'score_10k',        game_id:'chaos-casino', name:'High Roller',           description:'Score 10,000+ points',                    icon:'💯', type:'progress', goal:10000, xp_reward:100, secret:false },
    { id:'stack_5k',         game_id:'chaos-casino', name:'High Stack',            description:'Reach $5,000 chips',                      icon:'💰', type:'progress', goal:5000,  xp_reward:75,  secret:false },
    { id:'stack_10k',        game_id:'chaos-casino', name:'Whale',                 description:'Reach $10,000 chips',                     icon:'🐋', type:'progress', goal:10000, xp_reward:150, secret:false },
    { id:'stack_25k',        game_id:'chaos-casino', name:'House Money',           description:'Reach $25,000 chips',                     icon:'🏦', type:'progress', goal:25000, xp_reward:250, secret:false },
    { id:'ch_high_roller',   game_id:'chaos-casino', name:'Whale',                 description:'Score 50,000 points',                     icon:'🎰', type:'progress', goal:50000, xp_reward:200, secret:false },
    { id:'ch_big_stack',     game_id:'chaos-casino', name:'Mountain',              description:'Hold $10,000 at once',                    icon:'⛰️', type:'progress', goal:10000, xp_reward:200, secret:false },
    { id:'win_pot_1k',       game_id:'chaos-casino', name:'Thousand Dollar Pot',   description:'Win a $1,000+ pot',                       icon:'💵', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'win_pot_5k',       game_id:'chaos-casino', name:'High Stakes',           description:'Win a $5,000+ pot',                       icon:'💎', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'cash_out',         game_id:'chaos-casino', name:'Know When to Walk',     description:'Cash out any run',                        icon:'🚪', type:'unlock',   goal:1,     xp_reward:50,  secret:false },
    { id:'first_cashout',    game_id:'chaos-casino', name:'Banker',                description:'Cash out your first run',                 icon:'🏧', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'cash_out_high',    game_id:'chaos-casino', name:'Know Your Limit',       description:'Cash out with 15,000+ score',             icon:'📈', type:'progress', goal:15000, xp_reward:150, secret:false },
    { id:'cash_out_15',      game_id:'chaos-casino', name:'Patient Player',        description:'Cash out at round 15',                    icon:'⏳', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'cash_out_30',      game_id:'chaos-casino', name:'The Long Game',         description:'Cash out at round 30+',                   icon:'🧘', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'ch_untouchable',   game_id:'chaos-casino', name:'Untouchable',           description:'Win without dropping below $500',         icon:'🛡️', type:'unlock',   goal:1,     xp_reward:250, secret:false },
    // ── POKER — Curses ────────────────────────────────────────────────────────
    { id:'curse_10',         game_id:'chaos-casino', name:'Touched by Darkness',   description:'Accumulate 10 curse',                     icon:'🌑', type:'progress', goal:10,    xp_reward:50,  secret:false },
    { id:'curse_25',         game_id:'chaos-casino', name:'Deeply Cursed',         description:'Reach 25 curse',                          icon:'🕷️', type:'progress', goal:25,    xp_reward:75,  secret:false },
    { id:'curse_50',         game_id:'chaos-casino', name:'Fully Corrupted',       description:'Accumulate 50 curse',                     icon:'☠️', type:'progress', goal:50,    xp_reward:100, secret:false },
    { id:'curse_75',         game_id:'chaos-casino', name:'Beyond Saving',         description:'Reach 75 curse',                          icon:'💜', type:'progress', goal:75,    xp_reward:150, secret:false },
    { id:'curse_100',        game_id:'chaos-casino', name:'The Void Takes You',    description:'Reach 100 curse',                         icon:'🌀', type:'progress', goal:100,   xp_reward:300, secret:false },
    { id:'ch_curse_80',      game_id:'chaos-casino', name:'The Abyss',             description:'Reach 80 curse',                          icon:'🕳️', type:'progress', goal:80,    xp_reward:200, secret:false },
    { id:'max_curse',        game_id:'chaos-casino', name:'Fully Gone',            description:'Reach 90+ curse',                         icon:'👻', type:'progress', goal:90,    xp_reward:250, secret:false },
    { id:'buy_cursed_upgrade',game_id:'chaos-casino',name:'Willful Corruption',    description:'Buy from Curse Shop',                     icon:'🛒', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'curse_win_5',      game_id:'chaos-casino', name:'Cursed but Winning',    description:'Win 5 hands with curse card',             icon:'🃏', type:'progress', goal:5,     xp_reward:100, secret:false },
    { id:'curse_showAll',    game_id:'chaos-casino', name:'Open Book',             description:'Win with cards visible to all',           icon:'📖', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'cleanse',          game_id:'chaos-casino', name:'Purified',              description:'Use Cleanse active item',                 icon:'✨', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'secret_curse_win', game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    // ── POKER — Bosses ────────────────────────────────────────────────────────
    { id:'boss_first',       game_id:'chaos-casino', name:'Enter the Arena',       description:'Fight first boss',                        icon:'🥊', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'beat_doyle',       game_id:'chaos-casino', name:'Take Down the Godfather','description':'Defeat Doyle Brunson',                 icon:'🎩', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_phil',        game_id:'chaos-casino', name:'Shut Him Up',           description:'Defeat Phil Hellmuth',                    icon:'😤', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_annie',       game_id:'chaos-casino', name:'Out-Thought',           description:'Defeat Annie Duke',                       icon:'🧠', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_stu',         game_id:'chaos-casino', name:'The Kid is Dead',       description:'Defeat Stu Ungar',                        icon:'💀', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_negreanu',    game_id:'chaos-casino', name:'Beat the GOAT',         description:'Defeat Daniel Negreanu',                  icon:'🐐', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_moneymaker',  game_id:'chaos-casino', name:'Account Closed',        description:'Defeat Chris Moneymaker',                 icon:'💳', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_ivey',        game_id:'chaos-casino', name:'Defanged',              description:'Defeat Phil Ivey',                        icon:'🦷', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_ferguson',    game_id:'chaos-casino', name:'Hallelujah',            description:'Defeat Chris Ferguson',                   icon:'✝️', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_hachem',      game_id:'chaos-casino', name:'The Lion Sleeps',       description:'Defeat Joe Hachem',                       icon:'🦁', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_mortensen',   game_id:'chaos-casino', name:'Olé',                   description:'Defeat Carlos Mortensen',                 icon:'🌹', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'beat_xi',          game_id:'chaos-casino', name:'Redistributed',         description:'Defeat Xi Jinping',                       icon:'🐼', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'beat_duo',         game_id:'chaos-casino', name:'Two for One',           description:'Defeat Jay and Oakley',                   icon:'👥', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'beat_mystery',     game_id:'chaos-casino', name:'Found the Unknown',     description:'Defeat mystery boss',                     icon:'🔮', type:'unlock',   goal:1,     xp_reward:250, secret:false },
    { id:'beat_all_bosses',  game_id:'chaos-casino', name:'The Circuit',           description:'Defeat every boss in one run',            icon:'🏅', type:'unlock',   goal:1,     xp_reward:500, secret:false },
    { id:'beat_all_new_bosses',game_id:'chaos-casino',name:'The Full Circuit',     description:'Defeat all 10 bosses',                    icon:'🎖️', type:'unlock',   goal:1,     xp_reward:500, secret:false },
    { id:'ch_chaos_master',  game_id:'chaos-casino', name:'Chaos Master',          description:'Defeat every boss',                       icon:'👑', type:'unlock',   goal:1,     xp_reward:500, secret:false },
    { id:'ch_boss_slayer',   game_id:'chaos-casino', name:'Boss Hunter',           description:'Defeat 25 bosses total',                  icon:'⚔️', type:'progress', goal:25,    xp_reward:150, secret:false },
    { id:'boss_no_damage',   game_id:'chaos-casino', name:'Untouchable',           description:'Defeat boss without losing chips',        icon:'🧊', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'beat_xi_hc',       game_id:'chaos-casino', name:"People's Champion",     description:'Defeat Xi in Hardcore',                   icon:'✊', type:'unlock',   goal:1,     xp_reward:300, secret:false },
    // ── POKER — Upgrades & Modifiers ─────────────────────────────────────────
    { id:'no_upgrades',      game_id:'chaos-casino', name:'Purist',                description:'Win without buying any upgrade',          icon:'🧹', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'ch_no_upgrade',    game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    { id:'full_inventory',   game_id:'chaos-casino', name:'Loaded',                description:'Own 5+ upgrades at once',                 icon:'🎒', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'ch_full_epic',     game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:200, secret:true  },
    { id:'mod_collector',    game_id:'chaos-casino', name:'Seen It All',           description:'Encounter every modifier',                icon:'📚', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'buy_first',        game_id:'chaos-casino', name:'Window Shopper',        description:'Buy first upgrade',                       icon:'🛍️', type:'unlock',   goal:1,     xp_reward:25,  secret:false },
    { id:'buy_10',           game_id:'chaos-casino', name:'Regular Customer',      description:'Buy 10 upgrades lifetime',                icon:'🏪', type:'progress', goal:10,    xp_reward:75,  secret:false },
    { id:'skip_3_shops',     game_id:'chaos-casino', name:'Window Shopper Only',   description:'Skip 3 shops in a row',                   icon:'🪟', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'luck_upgrade',     game_id:'chaos-casino', name:'Pressing Your Luck',    description:'Buy a luck-increasing upgrade',           icon:'🍀', type:'unlock',   goal:1,     xp_reward:50,  secret:false },
    { id:'luck_50',          game_id:'chaos-casino', name:'Born Lucky',            description:'Reach 50 luck',                           icon:'🌟', type:'progress', goal:50,    xp_reward:100, secret:false },
    { id:'luck_100',         game_id:'chaos-casino', name:"Fortune's Favorite",    description:'Reach 100 luck',                          icon:'⭐', type:'progress', goal:100,   xp_reward:200, secret:false },
    { id:'use_active_item',  game_id:'chaos-casino', name:'Activated',             description:'Use first active item',                   icon:'🔧', type:'unlock',   goal:1,     xp_reward:25,  secret:false },
    { id:'active_items_3',   game_id:'chaos-casino', name:'Prepared',              description:'Carry 3 active items',                    icon:'🎽', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'buy_active_3',     game_id:'chaos-casino', name:'Arsenal',               description:'Have 3 different active items',           icon:'🗡️', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'use_smokeB',       game_id:'chaos-casino', name:'Vanishing Act',         description:'Win using Smoke Bomb',                    icon:'💨', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'use_timeStop',     game_id:'chaos-casino', name:'Rewind',                description:'Use Time Stop',                           icon:'⏱️', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'bounty_collect',   game_id:'chaos-casino', name:'Bounty Hunter',         description:'Collect bounty 3 times',                  icon:'🎯', type:'progress', goal:3,     xp_reward:75,  secret:false },
    // ── POKER — Modifiers ────────────────────────────────────────────────────
    { id:'survive_lowwins',  game_id:'chaos-casino', name:'Opposite Day',          description:'Win during Upside Down',                  icon:'🙃', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'survive_allinonly',game_id:'chaos-casino', name:'Nuclear Option',        description:'Win during All In or Fold',               icon:'☢️', type:'unlock',   goal:1,     xp_reward:100, secret:false },
    { id:'win_ghostshowdown',game_id:'chaos-casino', name:'Ghost Winner',          description:'Win a Ghost Showdown round',              icon:'👻', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'win_combo',        game_id:'chaos-casino', name:'Double Chaos',          description:'Win during Combo Round',                  icon:'💥', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'win_luckround',    game_id:'chaos-casino', name:'Fortune Round',         description:'Win during Luck Round',                   icon:'🍀', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'survive_halfDeck', game_id:'chaos-casino', name:'Half Deck Survivor',    description:'Win during Half Deck',                    icon:'🂠', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'win_ante_frenzy',  game_id:'chaos-casino', name:'Ante King',             description:'Win during Ante Frenzy',                  icon:'🤑', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'win_copy',         game_id:'chaos-casino', name:'Copykiller',            description:'Win during Copycat modifier',             icon:'📋', type:'unlock',   goal:1,     xp_reward:75,  secret:false },
    { id:'win_jackpot',      game_id:'chaos-casino', name:'Lottery Winner',        description:'Win the $200 Jackpot Lottery',            icon:'🎟️', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    // ── POKER — Progression ──────────────────────────────────────────────────
    { id:'win_50_hands',     game_id:'chaos-casino', name:'Card Shark',            description:'Win 50 hands total',                      icon:'🦈', type:'progress', goal:50,    xp_reward:100, secret:false },
    { id:'win_100_hands',    game_id:'chaos-casino', name:'The Grinder',           description:'Win 100 hands total',                     icon:'⚙️', type:'progress', goal:100,   xp_reward:200, secret:false },
    { id:'ch_survivor',      game_id:'chaos-casino', name:'Still Standing',        description:'Complete 10 runs',                        icon:'🔟', type:'progress', goal:10,    xp_reward:100, secret:false },
    { id:'ch_dedicated',     game_id:'chaos-casino', name:'Regular',               description:'Complete 50 runs',                        icon:'🎖️', type:'progress', goal:50,    xp_reward:300, secret:false },
    { id:'level_10',         game_id:'chaos-casino', name:'Getting There',         description:'Reach level 10',                          icon:'📊', type:'progress', goal:10,    xp_reward:100, secret:false },
    { id:'level_26',         game_id:'chaos-casino', name:'Seasoned Player',       description:'Reach level 26',                          icon:'📈', type:'progress', goal:26,    xp_reward:200, secret:false },
    { id:'level_52',         game_id:'chaos-casino', name:'Veteran',               description:'Reach level 52',                          icon:'🏆', type:'progress', goal:52,    xp_reward:400, secret:false },
    { id:'ch_royal_run',     game_id:'chaos-casino', name:'Royal',                 description:'Hit a Royal Flush',                       icon:'♛',  type:'unlock',   goal:1,     xp_reward:200, secret:false },
    // ── POKER — Hardcore ─────────────────────────────────────────────────────
    { id:'hardcore_win',     game_id:'chaos-casino', name:'Hardcore',              description:'Complete a run in Hardcore',               icon:'💀', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'ch_hardcore',      game_id:'chaos-casino', name:'Death Wish',            description:'Win Hardcore run',                        icon:'☠️', type:'unlock',   goal:1,     xp_reward:300, secret:false },
    { id:'hardcore_boss',    game_id:'chaos-casino', name:'Iron Will',             description:'Defeat boss in Hardcore',                 icon:'🦾', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'hardcore_negreanu',game_id:'chaos-casino', name:'The Impossible',        description:'Defeat Negreanu in Hardcore',              icon:'🎯', type:'unlock',   goal:1,     xp_reward:300, secret:false },
    { id:'hardcore_25',      game_id:'chaos-casino', name:'Deathwish',             description:'Reach round 25 in Hardcore',              icon:'🎰', type:'progress', goal:25,    xp_reward:250, secret:false },
    // ── POKER — Crew / Secret ────────────────────────────────────────────────
    { id:'friend_sean',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:50,  secret:true  },
    { id:'friend_dart',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:50,  secret:true  },
    { id:'friend_amari',     game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:50,  secret:true  },
    { id:'friend_keshawn',   game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:50,  secret:true  },
    { id:'secret_all_fold',  game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    { id:'secret_names_all', game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:200, secret:true  },
    { id:'secret_broke_5',   game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    { id:'secret_no_raise',  game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    { id:'secret_xi_trigger',game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    { id:'secret_duo_trigger',game_id:'chaos-casino',name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    { id:'secret_mystery',   game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    { id:'secret_luck_curse',game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:200, secret:true  },
    { id:'secret_lucky100',  game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:200, secret:true  },
    { id:'secret_clean_run', game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:150, secret:true  },
    { id:'secret_duo_hc',    game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:250, secret:true  },
    { id:'ch_clean_run',     game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:200, secret:true  },
    // ── BLACKJACK ─────────────────────────────────────────────────────────────
    { id:'bj_first',         game_id:'chaos-casino', name:'Dealt In',              description:'Complete first Blackjack run',             icon:'🂡', type:'unlock',   goal:1,     xp_reward:50,  secret:false, game_mode:'blackjack' },
    { id:'bj_21',            game_id:'chaos-casino', name:'Twenty One',            description:'Hit a natural Blackjack',                 icon:'2️⃣1️⃣',type:'unlock',  goal:1,     xp_reward:100, secret:false, game_mode:'blackjack' },
    { id:'bj_streak_5',      game_id:'chaos-casino', name:'Hot Table',             description:'Win 5 BJ hands in a row',                 icon:'♨️', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'blackjack' },
    { id:'bj_streak_10',     game_id:'chaos-casino', name:'Card Counter',          description:'Win 10 BJ hands in a row',                icon:'🔢', type:'unlock',   goal:1,     xp_reward:200, secret:false, game_mode:'blackjack' },
    { id:'bj_dealer_bust',   game_id:'chaos-casino', name:'Dealer Down',           description:'Win 10 hands via dealer bust',            icon:'💥', type:'progress', goal:10,    xp_reward:100, secret:false, game_mode:'blackjack' },
    { id:'bj_split_win',     game_id:'chaos-casino', name:'Divide and Conquer',    description:'Win both hands after split',              icon:'✂️', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'blackjack' },
    { id:'bj_double_win',    game_id:'chaos-casino', name:'Committed',             description:'Win 20 doubled-down hands',               icon:'✌️', type:'progress', goal:20,    xp_reward:150, secret:false, game_mode:'blackjack' },
    { id:'bj_boss_1',        game_id:'chaos-casino', name:'First Card',            description:'Defeat first BJ boss',                    icon:'🥊', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'blackjack' },
    { id:'bj_boss_all',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:500, secret:true,  game_mode:'blackjack' },
    { id:'bj_secrets_all',   game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:400, secret:true,  game_mode:'blackjack' },
    { id:'bj_hardcore',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true,  game_mode:'blackjack' },
    { id:'bj_no_bust',       game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:250, secret:true,  game_mode:'blackjack' },
    { id:'bj_curse_heavy',   game_id:'chaos-casino', name:'Dark Table',            description:'Accumulate 60 curse in Blackjack',        icon:'🌑', type:'progress', goal:60,    xp_reward:150, secret:false, game_mode:'blackjack' },
    { id:'bj_insured',       game_id:'chaos-casino', name:'House Rules',           description:'Win after taking insurance',              icon:'📋', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'blackjack' },
    // ── SLOTS ─────────────────────────────────────────────────────────────────
    { id:'sl_first',         game_id:'chaos-casino', name:'One-Armed Bandit',      description:'Complete first Slots run',                icon:'🎰', type:'unlock',   goal:1,     xp_reward:50,  secret:false, game_mode:'slots' },
    { id:'sl_jackpot',       game_id:'chaos-casino', name:'Jackpot',               description:'Hit 3-symbol jackpot (50x bet)',           icon:'💫', type:'unlock',   goal:1,     xp_reward:200, secret:false, game_mode:'slots' },
    { id:'sl_mega_jackpot',  game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:500, secret:true,  game_mode:'slots' },
    { id:'sl_machine_5',     game_id:'chaos-casino', name:'Machine Runner',        description:'Reach Machine 5',                         icon:'5️⃣', type:'progress', goal:5,     xp_reward:75,  secret:false, game_mode:'slots' },
    { id:'sl_machine_10',    game_id:'chaos-casino', name:'Deep Spin',             description:'Reach Machine 10',                        icon:'🔟', type:'progress', goal:10,    xp_reward:150, secret:false, game_mode:'slots' },
    { id:'sl_machine_20',    game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'progress', goal:20,    xp_reward:400, secret:true,  game_mode:'slots' },
    { id:'sl_boss_1',        game_id:'chaos-casino', name:'Boss Machine',          description:'Beat first boss machine',                 icon:'🤖', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'slots' },
    { id:'sl_boss_3',        game_id:'chaos-casino', name:'Triple Threat',         description:'Beat 3 boss machines in one run',         icon:'🎯', type:'progress', goal:3,     xp_reward:200, secret:false, game_mode:'slots' },
    { id:'sl_perfect',       game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true,  game_mode:'slots' },
    { id:'sl_curse_reel',    game_id:'chaos-casino', name:'Corrupted Reel',        description:'Survive cursed reel and hit target',      icon:'🌀', type:'unlock',   goal:1,     xp_reward:150, secret:false, game_mode:'slots' },
    { id:'sl_comeback',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true,  game_mode:'slots' },
    { id:'sl_hardcore',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true,  game_mode:'slots' },
    { id:'sl_streak',        game_id:'chaos-casino', name:'On the Pull',           description:'Win 5 consecutive pulls',                 icon:'🎰', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'slots' },
    { id:'sl_no_curse',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:200, secret:true,  game_mode:'slots' },
    // ── CRASH ─────────────────────────────────────────────────────────────────
    { id:'cr_first',         game_id:'chaos-casino', name:'Liftoff',               description:'Complete first Crash run',                icon:'🚀', type:'unlock',   goal:1,     xp_reward:50,  secret:false, game_mode:'crash' },
    { id:'cr_10x',           game_id:'chaos-casino', name:'10x',                   description:'Cash out at 10x or higher',               icon:'📈', type:'unlock',   goal:1,     xp_reward:150, secret:false, game_mode:'crash' },
    { id:'cr_50x',           game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true,  game_mode:'crash' },
    { id:'cr_100x',          game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:500, secret:true,  game_mode:'crash' },
    { id:'cr_survive_10',    game_id:'chaos-casino', name:'Survivor',              description:'Survive 10 rounds',                       icon:'🛡️', type:'progress', goal:10,    xp_reward:100, secret:false, game_mode:'crash' },
    { id:'cr_survive_25',    game_id:'chaos-casino', name:'Crash Veteran',         description:'Survive 25 rounds',                       icon:'🎖️', type:'progress', goal:25,    xp_reward:200, secret:false, game_mode:'crash' },
    { id:'cr_curse_blocked', game_id:'chaos-casino', name:'Blocked Out',           description:'Get blocked by curse window',             icon:'🚫', type:'unlock',   goal:1,     xp_reward:75,  secret:false, game_mode:'crash' },
    { id:'cr_curse_escape',  game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:250, secret:true,  game_mode:'crash' },
    { id:'cr_boss_1',        game_id:'chaos-casino', name:'Tower Toppler',         description:'Defeat first Crash boss',                 icon:'🏗️', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'crash' },
    { id:'cr_boss_all',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:500, secret:true,  game_mode:'crash' },
    { id:'cr_perfect_run',   game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:400, secret:true,  game_mode:'crash' },
    { id:'cr_hardcore',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true,  game_mode:'crash' },
    { id:'cr_double_bust',   game_id:'chaos-casino', name:'Twice Burned',          description:'Fail to cash out twice in a row',         icon:'🔥', type:'unlock',   goal:1,     xp_reward:75,  secret:false, game_mode:'crash' },
    // ── ROULETTE ──────────────────────────────────────────────────────────────
    { id:'rl_first',         game_id:'chaos-casino', name:'The Wheel Spins',       description:'Complete first Roulette run',              icon:'🎡', type:'unlock',   goal:1,     xp_reward:50,  secret:false, game_mode:'roulette' },
    { id:'rl_zero',          game_id:'chaos-casino', name:'Zero',                  description:'Win on green zero',                       icon:'🟢', type:'unlock',   goal:1,     xp_reward:200, secret:false, game_mode:'roulette' },
    { id:'rl_zero_3',        game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:400, secret:true,  game_mode:'roulette' },
    { id:'rl_red_10',        game_id:'chaos-casino', name:'See Red',               description:'Win 10 red bets in a row',                icon:'🔴', type:'progress', goal:10,    xp_reward:150, secret:false, game_mode:'roulette' },
    { id:'rl_black_10',      game_id:'chaos-casino', name:'Dressed in Black',      description:'Win 10 black bets in a row',              icon:'⚫', type:'progress', goal:10,    xp_reward:150, secret:false, game_mode:'roulette' },
    { id:'rl_curse_reveal',  game_id:'chaos-casino', name:'Purple Numbers',        description:'Witness a cursed number reveal',          icon:'💜', type:'unlock',   goal:1,     xp_reward:75,  secret:false, game_mode:'roulette' },
    { id:'rl_curse_dodge',   game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:200, secret:true,  game_mode:'roulette' },
    { id:'rl_boss_1',        game_id:'chaos-casino', name:'House Challenger',      description:'Defeat first Roulette boss',              icon:'🏠', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'roulette' },
    { id:'rl_boss_all',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:500, secret:true,  game_mode:'roulette' },
    { id:'rl_straight_up',   game_id:'chaos-casino', name:'Straight Up',           description:'Win 5 straight-up bets',                  icon:'⬆️', type:'progress', goal:5,     xp_reward:100, secret:false, game_mode:'roulette' },
    { id:'rl_hardcore',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true,  game_mode:'roulette' },
    { id:'rl_no_curse',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:250, secret:true,  game_mode:'roulette' },
    { id:'rl_full_board',    game_id:'chaos-casino', name:'Covered',               description:'Place bets on 20+ numbers',               icon:'🗺️', type:'unlock',   goal:1,     xp_reward:100, secret:false, game_mode:'roulette' },
    // ── CROSS-GAME ────────────────────────────────────────────────────────────
    { id:'xg_all_games',     game_id:'chaos-casino', name:'Casino Tour',           description:'Complete a run in all 5 games',           icon:'🎪', type:'unlock',   goal:1,     xp_reward:300, secret:false },
    { id:'xg_10k_each',      game_id:'chaos-casino', name:'Across the Board',      description:'Score 10k+ in 3 different modes',         icon:'📊', type:'progress', goal:3,     xp_reward:300, secret:false },
    { id:'xg_boss_each',     game_id:'chaos-casino', name:'Bounty Hunter',         description:'Defeat a boss in every mode',             icon:'🎯', type:'unlock',   goal:1,     xp_reward:400, secret:false },
    { id:'xg_hardcore_all',  game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:1000,secret:true  },
    { id:'xg_curse_each',    game_id:'chaos-casino', name:'Touch of Darkness',     description:'Take a curse in all 5 modes',             icon:'🌑', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'xg_level_20',      game_id:'chaos-casino', name:'Network Veteran',       description:'Reach Network Level 20',                  icon:'🌐', type:'progress', goal:20,    xp_reward:200, secret:false },
    { id:'xg_level_50',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'progress', goal:50,    xp_reward:1000,secret:true  },
    { id:'xg_crew_game',     game_id:'chaos-casino', name:'Played Together',       description:'Complete a Crew Game match',              icon:'👥', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'xg_duel_win',      game_id:'chaos-casino', name:'Duelist',               description:'Win an online Duel',                      icon:'⚔️', type:'unlock',   goal:1,     xp_reward:150, secret:false },
    { id:'xg_duel_streak',   game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true  },
    { id:'xg_all_same_day',  game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:300, secret:true  },
    { id:'xg_pristine',      game_id:'chaos-casino', name:'???',                   description:'???',                                     icon:'❓', type:'unlock',   goal:1,     xp_reward:400, secret:true  },
    // ── N GAMES NETWORK (Launcher) ────────────────────────────────────────────
    { id:'ng_first_session', game_id:'ngames',       name:'Welcome',               description:'Submit your first session',               icon:'🌐', type:'unlock',   goal:1,     xp_reward:50,  secret:false },
    { id:'ng_wall_post',     game_id:'ngames',       name:'Broadcaster',           description:'Post to the wall 10 times',               icon:'📢', type:'progress', goal:10,    xp_reward:100, secret:false },
    { id:'ng_level_5',       game_id:'ngames',       name:'Level 5',               description:'Reach Level 5',                           icon:'⭐', type:'progress', goal:5,     xp_reward:200, secret:false },
    { id:'ng_level_10',      game_id:'ngames',       name:'Veteran',               description:'Reach Level 10',                          icon:'🌟', type:'progress', goal:10,    xp_reward:500, secret:false },
    { id:'ng_first_message', game_id:'ngames',       name:'First Contact',         description:'Send your first DM',                      icon:'✉️', type:'unlock',   goal:1,     xp_reward:25,  secret:false },
    { id:'ng_crew_online',   game_id:'ngames',       name:'Full Squad',            description:'Be online when all 4 crew are online',    icon:'👥', type:'unlock',   goal:1,     xp_reward:200, secret:false },
    { id:'ng_radio_1h',      game_id:'ngames',       name:'Tuned In',              description:'Listen to radio for 1 hour total',        icon:'📻', type:'progress', goal:3600,  xp_reward:100, secret:false },
    { id:'ng_title_maverick',game_id:'ngames',       name:'Maverick',              description:'Reach the Maverick title (Level 25)',      icon:'🎭', type:'progress', goal:25,    xp_reward:500, secret:false },
    { id:'ng_title_king',    game_id:'ngames',       name:'King',                  description:'Reach the King title (Level 40)',          icon:'♛',  type:'progress', goal:40,    xp_reward:1000,secret:false },
    { id:'ng_nmaster',       game_id:'ngames',       name:'N Master',              description:'Reach N Master (Level 50)',                icon:'👑', type:'progress', goal:50,    xp_reward:5000,secret:false },
  ];
  for (const a of ACHIEVEMENTS) upsertAch.run({ game_mode: null, secret: 0, ...a, secret: a.secret ? 1 : 0 });

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
  getProfileAchievements: db.prepare('SELECT pa.*, a.name, a.description, a.icon, a.type, a.goal, a.xp_reward, a.game_id, a.game_mode, a.secret FROM profile_achievements pa JOIN achievements a ON pa.achievement_id = a.id WHERE pa.profile_id = ?'),
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

  const result = all.map(a => {
    const p = progMap[a.id];
    const unlocked = p?.unlocked || 0;
    // Mask secret achievements until unlocked
    if (a.secret && !unlocked) {
      return { ...a, name: '???', description: '???', icon: '❓', progress: 0, unlocked: 0, unlocked_at: null };
    }
    return { ...a, progress: p?.progress || 0, unlocked, unlocked_at: p?.unlocked_at || null };
  });
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
