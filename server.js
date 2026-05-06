'use strict';

/**
 * N Games Network — Server
 * Includes Phase 1 + Phase 2 features:
 *   1.1 Stats endpoint
 *   1.3 Custom titles
 *   1.4 Records leaderboard
 *   2.5 Crew challenges
 *   2.6 Season system
 *   2.7 Crew bets
 * Deploy to Railway — auto-deploys on git push.
 */

const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const net        = require('net');
const { WebSocketServer, WebSocket } = require('ws');
const path       = require('path');
const fs         = require('fs');
const Database   = require('better-sqlite3');

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT    = process.env.PORT || 3200;
const DB_PATH = process.env.DB_PATH || (
  fs.existsSync('/data') ? '/data/ngames.db' : path.join(__dirname, 'ngames.db')
);

const CREW = [
  { id: 'keshawn', name: 'Keshawn', color: '#80e060', suit: '♣', initial: 'K' },
  { id: 'sean',    name: 'Sean',    color: '#f0c040', suit: '♦', initial: 'S' },
  { id: 'dart',    name: 'Dart',    color: '#e04040', suit: '♥', initial: 'D' },
  { id: 'amari',   name: 'Amari',   color: '#40c0e0', suit: '♠', initial: 'A' },
  { id: 'arisa',   name: 'Ari',     color: '#ff69b4', suit: '✿', initial: 'Ri' },
  { id: 'tyheim',  name: 'Tyheim',  color: '#a855f7', suit: '⚡', initial: 'T' },
];

const GAMES = [
  {
    id: 'chaos-casino', name: "Chaos Casino",   owner: 'keshawn', status: 'live',
    version: '1.0.0', description: 'Roguelike poker. Run-based chaos.',
    url: 'https://chaos-holdem-server3-production.up.railway.app', art_url: null,
    tags: JSON.stringify(['poker','roguelike','cards']),
  },
  {
    id: 'blacks-dungeon', name: 'Shape of Blacks', owner: 'sean', status: 'live',
    version: '1.0.0', description: 'A Gungeon-esque action roguelike.',
    url: null, art_url: null, tags: JSON.stringify(['action','roguelike','dungeon']),
  },
  {
    id: 'project-x', name: 'N Arena', owner: 'keshawn', status: 'hidden',
    version: '1.0.0', description: 'Crew arena combat. Deathmatch and survival.',
    url: null, art_url: null, tags: JSON.stringify(['arena','combat','multiplayer']),
  },
  {
    id: 'case-sim', name: 'Case Sim', owner: 'keshawn', status: 'paused',
    version: '2.0.1', description: 'CS-inspired case opening simulator.',
    url: null, art_url: null, tags: JSON.stringify(['casino','cases','skins']),
  },
  {
    id: 'cuunsurf', name: 'CuunSurf', owner: 'keshawn', status: 'live',
    version: '1.0.0', description: 'Surf game. Hit max speed.',
    url: null, art_url: null, tags: JSON.stringify(['surf','speed','skill']),
  },
  {
    id: 'nkart', name: 'N Kart', owner: 'keshawn', status: 'hidden',
    version: '1.0.0', description: '3D kart racing for the crew. 16 tracks, 4 cups, drift physics, items, and online multiplayer.',
    url: null, art_url: '/assets/nkart-banner.png', tags: JSON.stringify(['racing','multiplayer','3D']),
  },
  {
    id: 'interrogating-blacks', name: 'Interrogating Blacks', owner: 'keshawn', status: 'live',
    version: '1.0.0', description: 'Crew trivia game. How well do you actually know Black culture, history, and the crew?',
    url: null, art_url: '/assets/ib-banner.jpg', tags: JSON.stringify(['trivia','crew','knowledge']),
  },
];

const ACHIEVEMENTS = [
  // Launcher / global
  { id:'ng_first_session',    game_id:'ngames',         game_mode:null,       name:'First Session',     description:'Play your first game session',          icon:'🎮', np_reward:50,   goal:1,     secret:0 },
  { id:'ng_sessions_10',      game_id:'ngames',         game_mode:null,       name:'Getting Into It',   description:'Play 10 sessions across any game',       icon:'🎮', np_reward:100,  goal:10,    secret:0 },
  { id:'ng_sessions_50',      game_id:'ngames',         game_mode:null,       name:'Regular',           description:'Play 50 sessions',                       icon:'🎯', np_reward:300,  goal:50,    secret:0 },
  { id:'ng_sessions_100',     game_id:'ngames',         game_mode:null,       name:'Dedicated',         description:'Play 100 total sessions',                icon:'💯', np_reward:750,  goal:100,   secret:0 },
  { id:'ng_level_5',          game_id:'ngames',         game_mode:null,       name:'Level 5',           description:'Reach level 5',                          icon:'⭐', np_reward:100,  goal:5,     secret:0 },
  { id:'ng_level_10',         game_id:'ngames',         game_mode:null,       name:'Level 10',          description:'Reach level 10',                         icon:'⭐', np_reward:200,  goal:10,    secret:0 },
  { id:'ng_level_25',         game_id:'ngames',         game_mode:null,       name:'Level 25',          description:'Reach level 25',                         icon:'🌟', np_reward:500,  goal:25,    secret:0 },
  { id:'ng_level_50',         game_id:'ngames',         game_mode:null,       name:'N Master',          description:'Reach the level cap',                    icon:'👑', np_reward:5000, goal:50,    secret:0 },
  { id:'ng_win_10',           game_id:'ngames',         game_mode:null,       name:'Ten Wins',          description:'Win 10 sessions across any game',         icon:'🏆', np_reward:200,  goal:10,    secret:0 },
  { id:'ng_win_50',           game_id:'ngames',         game_mode:null,       name:'Winner',            description:'Win 50 sessions',                         icon:'🥇', np_reward:500,  goal:50,    secret:0 },
  { id:'ng_all_games',        game_id:'ngames',         game_mode:null,       name:'All In',            description:'Play every game in the library',          icon:'🗃️', np_reward:400,  goal:7,     secret:0 },
  // N Arena
  { id:'first_blood',         game_id:'project-x',      game_mode:null,       name:'First Blood',       description:'Get your first kill',                    icon:'🩸', np_reward:50,   goal:1,     secret:0 },
  { id:'streak_5',            game_id:'project-x',      game_mode:null,       name:'On a Roll',         description:'Get a 5 kill streak',                    icon:'🔥', np_reward:100,  goal:5,     secret:0 },
  { id:'streak_10',           game_id:'project-x',      game_mode:null,       name:'Unstoppable',       description:'Get a 10 kill streak',                   icon:'🔥', np_reward:300,  goal:10,    secret:0 },
  { id:'streak_15',           game_id:'project-x',      game_mode:null,       name:'Arena God',         description:'Get a 15 kill streak',                   icon:'⚡', np_reward:1000, goal:15,    secret:1 },
  { id:'first_arena_win',     game_id:'project-x',      game_mode:null,       name:'First Win',         description:'Win your first arena match',              icon:'🏆', np_reward:100,  goal:1,     secret:0 },
  { id:'five_hundred_career', game_id:'project-x',      game_mode:null,       name:'Legend',            description:'500 career kills',                       icon:'💀', np_reward:2000, goal:500,   secret:1 },
  // Shape of Blacks
  { id:'sob_first_kill',      game_id:'blacks-dungeon', game_mode:null,       name:'First Kill',        description:'Get your first kill',                    icon:'🗡️', np_reward:50,   goal:1,     secret:0 },
  { id:'sob_floor_5',         game_id:'blacks-dungeon', game_mode:null,       name:'Deep Dive',         description:'Reach floor 5',                          icon:'🏚️', np_reward:150,  goal:5,     secret:0 },
  { id:'sob_floor_10',        game_id:'blacks-dungeon', game_mode:null,       name:'Floor 10',          description:'Reach floor 10',                         icon:'🏚️', np_reward:400,  goal:10,    secret:0 },
  { id:'sob_beat_game',       game_id:'blacks-dungeon', game_mode:null,       name:'Beat It',           description:'Beat the game',                          icon:'🔥', np_reward:1500, goal:1,     secret:0 },
  { id:'sob_nightmare_win',   game_id:'blacks-dungeon', game_mode:'nightmare',name:'Nightmare',         description:'Win on nightmare mode',                  icon:'👻', np_reward:2000, goal:1,     secret:1 },
  // Case Sim
  { id:'cs_first_case',       game_id:'case-sim',       game_mode:null,       name:'First Case',        description:'Open your first case',                   icon:'📦', np_reward:50,   goal:1,     secret:0 },
  { id:'cs_cases_10',         game_id:'case-sim',       game_mode:null,       name:'Case Opener',       description:'Open 10 cases',                          icon:'📦', np_reward:150,  goal:10,    secret:0 },
  { id:'cs_cases_100',        game_id:'case-sim',       game_mode:null,       name:'Mass Opener',       description:'Open 100 cases',                         icon:'📦', np_reward:500,  goal:100,   secret:0 },
  { id:'cs_first_knife',      game_id:'case-sim',       game_mode:null,       name:'Knife God',         description:'Unbox your first knife',                 icon:'🗡️', np_reward:500,  goal:1,     secret:0 },
  { id:'cs_crash_10x',        game_id:'case-sim',       game_mode:'crash',    name:'Crash God',         description:'Hit a 10x crash multiplier',             icon:'💥', np_reward:1000, goal:1,     secret:1 },
  { id:'cs_balance_10k',      game_id:'case-sim',       game_mode:null,       name:'High Roller',       description:'Reach a 10,000 balance',                 icon:'💰', np_reward:300,  goal:10000, secret:0 },
  // CuunSurf
  { id:'cuunsurf_first_run',  game_id:'cuunsurf',       game_mode:null,       name:'First Run',         description:'Complete your first surf run',            icon:'🏄', np_reward:50,   goal:1,     secret:0 },
  { id:'cuunsurf_speed_800',  game_id:'cuunsurf',       game_mode:null,       name:'Speed Demon',       description:'Reach speed 800',                        icon:'⚡', np_reward:150,  goal:800,   secret:0 },
  { id:'cuunsurf_speed_1200', game_id:'cuunsurf',       game_mode:null,       name:'Lightspeed',        description:'Reach speed 1200',                       icon:'💨', np_reward:500,  goal:1200,  secret:1 },
  { id:'cuunsurf_level_5',    game_id:'cuunsurf',       game_mode:null,       name:'Level 5',           description:'Reach level 5 in CuunSurf',              icon:'⭐', np_reward:200,  goal:5,     secret:0 },
  { id:'cuunsurf_runs_10',    game_id:'cuunsurf',       game_mode:null,       name:'Surfer',            description:'Complete 10 surf runs',                  icon:'🌊', np_reward:300,  goal:10,    secret:0 },
  { id:'cuunsurf_expert_all', game_id:'cuunsurf',       game_mode:'expert',   name:'Wave Master',       description:'Complete all expert maps',               icon:'🏆', np_reward:2000, goal:1,     secret:1 },
  { id:'cuunsurf_ghost_buster',game_id:'cuunsurf',      game_mode:null,       name:'Ghost Hunter',      description:'Beat a ghost run',                       icon:'👻', np_reward:750,  goal:1,     secret:1 },
  // Chaos Casino
  { id:'ch_first_win',        game_id:'chaos-casino',   game_mode:'poker',    name:'First Win',         description:'Win your first hand',                    icon:'🃏', np_reward:50,   goal:1,     secret:0 },
  { id:'ch_first_run',        game_id:'chaos-casino',   game_mode:'poker',    name:'First Run',         description:'Complete your first run',                icon:'🎲', np_reward:100,  goal:1,     secret:0 },
  { id:'ch_big_win',          game_id:'chaos-casino',   game_mode:'poker',    name:'High Roller',       description:'Win over 5000 chips in one run',         icon:'💰', np_reward:500,  goal:5000,  secret:0 },
  // nkart
  { id:'nkart_first_race',  game_id:'nkart', game_mode:null, name:'First Race',     description:'Complete your first race',                     icon:'🏎️', np_reward:50,   goal:1,   secret:0 },
  { id:'nkart_first_win',   game_id:'nkart', game_mode:null, name:'First Win',      description:'Win your first race',                          icon:'🏆', np_reward:100,  goal:1,   secret:0 },
  { id:'nkart_podium_5',    game_id:'nkart', game_mode:null, name:'On the Podium',  description:'Finish on the podium 5 times',                 icon:'🥉', np_reward:150,  goal:5,   secret:0 },
  { id:'nkart_win_10',      game_id:'nkart', game_mode:null, name:'Race Winner',    description:'Win 10 races',                                 icon:'🏅', np_reward:300,  goal:10,  secret:0 },
  { id:'nkart_gp_champ',    game_id:'nkart', game_mode:'gp', name:'GP Champion',    description:'Win a Grand Prix',                             icon:'🏆', np_reward:400,  goal:1,   secret:0 },
  { id:'nkart_all_cups',    game_id:'nkart', game_mode:'gp', name:'All Cups',       description:'Win all 4 cups',                               icon:'👑', np_reward:1000, goal:4,   secret:0 },
  { id:'nkart_time_attack', game_id:'nkart', game_mode:'ta', name:'Time Attacker',  description:'Complete a Time Attack run',                   icon:'⏱️', np_reward:75,   goal:1,   secret:0 },
  { id:'nkart_item_hunter', game_id:'nkart', game_mode:null, name:'Item Hunter',    description:'Use 50 items in races',                        icon:'💣', np_reward:200,  goal:50,  secret:0 },
  { id:'nkart_perfect_gp',  game_id:'nkart', game_mode:'gp', name:'Flawless',       description:'Win every race in a Grand Prix',               icon:'⭐', np_reward:750,  goal:1,   secret:1 },
  { id:'nkart_drift_king',  game_id:'nkart', game_mode:null, name:'Drift King',     description:'Win a race while drifting the most',           icon:'🔥', np_reward:250,  goal:1,   secret:1 },
  // Interrogating Blacks
  { id:'ib_first_answer',   game_id:'interrogating-blacks', game_mode:null,   name:'First Answer',    description:'Answer your first question correctly',         icon:'🎤', np_reward:50,   goal:1,   secret:0 },
  { id:'ib_first_win',      game_id:'interrogating-blacks', game_mode:null,   name:'First Win',       description:'Win your first trivia game',                   icon:'🏆', np_reward:100,  goal:1,   secret:0 },
  { id:'ib_streak_5',       game_id:'interrogating-blacks', game_mode:null,   name:'On a Roll',       description:'Answer 5 questions correctly in a row',        icon:'🔥', np_reward:150,  goal:5,   secret:0 },
  { id:'ib_streak_10',      game_id:'interrogating-blacks', game_mode:null,   name:'Hot Streak',      description:'Answer 10 questions correctly in a row',       icon:'🔥', np_reward:300,  goal:10,  secret:0 },
  { id:'ib_perfect_round',  game_id:'interrogating-blacks', game_mode:null,   name:'Perfect Round',   description:'Get every question right in a round',          icon:'💯', np_reward:500,  goal:1,   secret:0 },
  { id:'ib_games_10',       game_id:'interrogating-blacks', game_mode:null,   name:'Regular',         description:'Play 10 trivia games',                         icon:'📚', np_reward:200,  goal:10,  secret:0 },
  { id:'ib_wins_5',         game_id:'interrogating-blacks', game_mode:null,   name:'Quiz Kid',        description:'Win 5 trivia games',                           icon:'🥇', np_reward:300,  goal:5,   secret:0 },
  { id:'ib_crew_win',       game_id:'interrogating-blacks', game_mode:'crew', name:'Crew Trivia',     description:'Win a crew trivia match',                      icon:'👥', np_reward:400,  goal:1,   secret:0 },
  { id:'ib_quick_draw',     game_id:'interrogating-blacks', game_mode:null,   name:'Quick Draw',      description:'Answer correctly in under 3 seconds',          icon:'⚡', np_reward:250,  goal:1,   secret:1 },
  { id:'ib_the_authority',  game_id:'interrogating-blacks', game_mode:null,   name:'The Authority',   description:'Win 20 trivia games',                          icon:'👑', np_reward:1000, goal:20,  secret:1 },
];

const CUSTOM_TITLES = [
  { title_id:'knife_god',      title_text:'Knife God',     unlock_type:'achievement', unlock_ref:'cs_first_knife',        color:'#eb4b4b', game_id:'case-sim'      },
  { title_id:'wave_master',    title_text:'Wave Master',   unlock_type:'achievement', unlock_ref:'cuunsurf_expert_all',   color:'#40c0e0', game_id:'cuunsurf'      },
  { title_id:'arena_god',      title_text:'Arena God',     unlock_type:'achievement', unlock_ref:'streak_15',             color:'#e04040', game_id:'project-x'    },
  { title_id:'ghost_hunter',   title_text:'Ghost Hunter',  unlock_type:'achievement', unlock_ref:'cuunsurf_ghost_buster', color:'#8847ff', game_id:'cuunsurf'      },
  { title_id:'the_nightmare',  title_text:'The Nightmare', unlock_type:'achievement', unlock_ref:'sob_nightmare_win',     color:'#ff2288', game_id:'blacks-dungeon' },
  { title_id:'pyreheart',      title_text:'Pyreheart',     unlock_type:'achievement', unlock_ref:'sob_beat_game',         color:'#ff8c42', game_id:'blacks-dungeon' },
  { title_id:'lightspeed',     title_text:'Lightspeed',    unlock_type:'achievement', unlock_ref:'cuunsurf_speed_1200',   color:'#f0c040', game_id:'cuunsurf'      },
  { title_id:'n_master',       title_text:'The N Master',  unlock_type:'level',       unlock_ref:'50',                    color:'#80e060', game_id:null            },
  { title_id:'legend',         title_text:'Legend',        unlock_type:'achievement', unlock_ref:'five_hundred_career',   color:'#ffd700', game_id:'project-x'    },
  { title_id:'crash_god',      title_text:'Crash God',     unlock_type:'achievement', unlock_ref:'cs_crash_10x',          color:'#ff4400', game_id:'case-sim'      },
  { title_id:'the_authority', title_text:'The Authority', unlock_type:'achievement', unlock_ref:'ib_the_authority',      color:'#f0c040', game_id:'interrogating-blacks' },
];

// Static challenge pools (rotated by day/week index)
const DAILY_CHALLENGES = [
  { title:'First Blood',      description:'Get 10 kills in N Arena',                metric:'kills',        goal:10,   np_reward:100, game_id:'project-x'    },
  { title:'Case Rush',        description:'Open 5 cases in Case Sim',               metric:'cases_opened', goal:5,    np_reward:75,  game_id:'case-sim'     },
  { title:'Surf Session',     description:'Complete 3 surf runs',                   metric:'sessions',     goal:3,    np_reward:75,  game_id:'cuunsurf'     },
  { title:'Coinflip Winner',  description:'Win 2 coinflips',                        metric:'wins',         goal:2,    np_reward:100, game_id:'case-sim'     },
  { title:'Game Time',        description:'Play any game for 20 minutes',           metric:'playtime',     goal:1200, np_reward:50,  game_id:null           },
  { title:'Arena Grind',      description:'Play 3 N Arena matches',                 metric:'sessions',     goal:3,    np_reward:75,  game_id:'project-x'   },
  { title:'Score Hunter',     description:'Score 500+ points in any game',          metric:'score',        goal:500,  np_reward:80,  game_id:null           },
  { title:'Dungeon Crawler',  description:'Complete a Shape of Blacks run',         metric:'sessions',     goal:1,    np_reward:60,  game_id:'blacks-dungeon'},
  { title:'Arena Domination', description:'Win an N Arena match',                   metric:'wins',         goal:1,    np_reward:100, game_id:'project-x'   },
  { title:'Case Haul',        description:'Open 10 cases in Case Sim',             metric:'cases_opened', goal:10,   np_reward:120, game_id:'case-sim'     },
  { title:'Speed Run',        description:'Complete a CuunSurf run',               metric:'sessions',     goal:1,    np_reward:50,  game_id:'cuunsurf'     },
  { title:'Chaos Player',     description:'Play a Chaos Casino session',            metric:'sessions',     goal:1,    np_reward:60,  game_id:'chaos-casino' },
  { title:'Combo Day',        description:'Play 2 sessions in any game',            metric:'sessions',     goal:2,    np_reward:90,  game_id:null           },
  { title:'Kill Streak',      description:'Get 20 kills in N Arena',               metric:'kills',        goal:20,   np_reward:150, game_id:'project-x'   },
  { title:'Trivia Time',      description:'Play an Interrogating Blacks game',      metric:'sessions',     goal:1,    np_reward:60,  game_id:'interrogating-blacks' },
  { title:'Know It All',      description:'Win 2 Interrogating Blacks games',       metric:'wins',         goal:2,    np_reward:100, game_id:'interrogating-blacks' },
];

const WEEKLY_CHALLENGES = [
  { title:'Score Master',    description:'Score 10,000 total points across any game', metric:'score',        goal:10000, np_reward:500, game_id:null           },
  { title:'Arena Champion',  description:'Win 10 matches in N Arena',                 metric:'wins',         goal:10,    np_reward:400, game_id:'project-x'   },
  { title:'Case Hoarder',    description:'Open 25 cases',                             metric:'cases_opened', goal:25,    np_reward:350, game_id:'case-sim'    },
  { title:'Kill Machine',    description:'Get 100 kills in N Arena',                  metric:'kills',        goal:100,   np_reward:600, game_id:'project-x'   },
  { title:'Surf Pro',        description:'Complete 15 surf runs',                     metric:'sessions',     goal:15,    np_reward:400, game_id:'cuunsurf'    },
  { title:'Game Week',       description:'Play 20 sessions across any game',          metric:'sessions',     goal:20,    np_reward:300, game_id:null          },
  { title:'Dungeon Grind',   description:'Complete 5 Shape of Blacks runs',           metric:'sessions',     goal:5,     np_reward:450, game_id:'blacks-dungeon'},
  { title:'Trivia Grind',    description:'Win 5 Interrogating Blacks games',          metric:'wins',         goal:5,     np_reward:400, game_id:'interrogating-blacks' },
];

// ─── NP / Level helpers ───────────────────────────────────────────────────────

const NP_TABLE = (() => {
  const t = [0, 0];
  for (let lvl = 2; lvl <= 50; lvl++) {
    if (lvl <= 25) t.push(Math.floor(300 * Math.pow(lvl - 1, 1.9)));
    else           t.push(t[25] + Math.floor(5000 * Math.pow(lvl - 25, 2.1)));
  }
  return t;
})();

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

function calcLevel(np) {
  let level = 1;
  for (let i = 1; i <= 50; i++) {
    if ((np || 0) >= NP_TABLE[i]) level = i;
    else break;
  }
  return Math.min(50, level);
}

function getLevelTitle(lvl) {
  return LEVEL_TITLES[Math.min(lvl || 1, 50)] || 'Newcomer';
}

function safeJSON(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ─── Database ─────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  // Core tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      color           TEXT NOT NULL,
      suit            TEXT NOT NULL,
      initial         TEXT NOT NULL,
      np              INTEGER DEFAULT 0,
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
      outcome     TEXT,
      game_mode   TEXT,
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

    CREATE TABLE IF NOT EXISTS achievements (
      id          TEXT PRIMARY KEY,
      game_id     TEXT NOT NULL,
      game_mode   TEXT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL,
      icon        TEXT DEFAULT '🏆',
      np_reward   INTEGER DEFAULT 0,
      goal        INTEGER DEFAULT 1,
      secret      INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS profile_achievements (
      profile_id   TEXT NOT NULL REFERENCES profiles(id),
      achievement_id TEXT NOT NULL REFERENCES achievements(id),
      progress     INTEGER DEFAULT 0,
      unlocked     INTEGER DEFAULT 0,
      unlocked_at  INTEGER,
      PRIMARY KEY (profile_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS custom_titles (
      id          INTEGER PRIMARY KEY,
      title_id    TEXT NOT NULL UNIQUE,
      title_text  TEXT NOT NULL,
      unlock_type TEXT NOT NULL,
      unlock_ref  TEXT,
      color       TEXT DEFAULT '#ffffff',
      game_id     TEXT
    );

    CREATE TABLE IF NOT EXISTS profile_titles (
      profile_id  TEXT NOT NULL,
      title_id    TEXT NOT NULL,
      unlocked_at INTEGER DEFAULT (strftime('%s','now')),
      equipped    INTEGER DEFAULT 0,
      PRIMARY KEY (profile_id, title_id)
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,
      game_id     TEXT,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      metric      TEXT NOT NULL,
      goal        INTEGER NOT NULL,
      np_reward   INTEGER NOT NULL,
      active_from INTEGER NOT NULL DEFAULT 0,
      active_to   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS challenge_progress (
      challenge_id INTEGER NOT NULL REFERENCES challenges(id),
      profile_id   TEXT NOT NULL,
      progress     INTEGER DEFAULT 0,
      completed    INTEGER DEFAULT 0,
      completed_at INTEGER,
      PRIMARY KEY (challenge_id, profile_id)
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      winner_id  TEXT
    );

    CREATE TABLE IF NOT EXISTS season_np (
      season_id  INTEGER NOT NULL REFERENCES seasons(id),
      profile_id TEXT NOT NULL,
      np_earned  INTEGER DEFAULT 0,
      PRIMARY KEY (season_id, profile_id)
    );

    CREATE TABLE IF NOT EXISTS bets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      bettor_id   TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      game_id     TEXT NOT NULL,
      game_mode   TEXT,
      np_wager    INTEGER NOT NULL,
      status      TEXT DEFAULT 'open',
      created_at  INTEGER DEFAULT (strftime('%s','now')),
      resolved_at INTEGER,
      session_id  INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_game    ON sessions(game_id);
    CREATE INDEX IF NOT EXISTS idx_wall_created     ON wall(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_pair    ON messages(from_id, to_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to      ON messages(to_id, read);
    CREATE INDEX IF NOT EXISTS idx_pa_profile       ON profile_achievements(profile_id);
    CREATE INDEX IF NOT EXISTS idx_bets_target      ON bets(target_id, status);
  `);

  // ── N Streams crew stats relay ─────────────────────────────────────────────
  // Stores a snapshot of each crew member's N Streams watch stats so that
  // every device can see the full crew picture without needing shared DB access.
  db.exec(`
    CREATE TABLE IF NOT EXISTS nstreams_crew (
      username             TEXT PRIMARY KEY,
      display_name         TEXT,
      avatar_color         TEXT,
      watching_count       INTEGER DEFAULT 0,
      completed_count      INTEGER DEFAULT 0,
      plan_count           INTEGER DEFAULT 0,
      this_week_json       TEXT    DEFAULT '[]',
      recent_completed_json TEXT   DEFAULT '[]',
      updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Migrations for existing Railway DB ──────────────────────────────────────
  // Rename xp → np if needed
  try { db.exec(`ALTER TABLE profiles RENAME COLUMN xp TO np`); } catch (_) {}
  // Add outcome/game_mode to sessions if missing
  try { db.exec(`ALTER TABLE sessions ADD COLUMN outcome TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE sessions ADD COLUMN game_mode TEXT`); } catch (_) {}
  // Add columns to achievements if missing (schema evolved over time)
  try { db.exec(`ALTER TABLE achievements ADD COLUMN game_mode  TEXT`);              } catch (_) {}
  try { db.exec(`ALTER TABLE achievements ADD COLUMN icon       TEXT DEFAULT '🏆'`); } catch (_) {}
  try { db.exec(`ALTER TABLE achievements ADD COLUMN np_reward  INTEGER DEFAULT 0`); } catch (_) {}
  try { db.exec(`ALTER TABLE achievements ADD COLUMN goal       INTEGER DEFAULT 1`); } catch (_) {}
  try { db.exec(`ALTER TABLE achievements ADD COLUMN secret     INTEGER DEFAULT 0`); } catch (_) {}

  // ── Seed crew ───────────────────────────────────────────────────────────────
  const upsertProfile = db.prepare(`
    INSERT INTO profiles (id, name, color, suit, initial)
    VALUES (@id, @name, @color, @suit, @initial)
    ON CONFLICT(id) DO NOTHING
  `);
  const upsertPresence = db.prepare(`
    INSERT INTO presence (profile_id) VALUES (?) ON CONFLICT DO NOTHING
  `);
  for (const c of CREW) { upsertProfile.run(c); upsertPresence.run(c.id); }

  // ── Seed games ──────────────────────────────────────────────────────────────
  const upsertGame = db.prepare(`
    INSERT INTO games (id, name, owner, status, version, description, url, art_url, tags)
    VALUES (@id, @name, @owner, @status, @version, @description, @url, @art_url, @tags)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, status=excluded.status,
      version=excluded.version, description=excluded.description
  `);
  for (const g of GAMES) upsertGame.run(g);

  // ── Seed achievements ────────────────────────────────────────────────────────
  const upsertAch = db.prepare(`
    INSERT INTO achievements (id, game_id, game_mode, name, description, icon, np_reward, goal, secret)
    VALUES (@id, @game_id, @game_mode, @name, @description, @icon, @np_reward, @goal, @secret)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, description=excluded.description,
      np_reward=excluded.np_reward, goal=excluded.goal
  `);
  for (const a of ACHIEVEMENTS) upsertAch.run(a);

  // ── Seed custom titles ────────────────────────────────────────────────────────
  const upsertTitle = db.prepare(`
    INSERT INTO custom_titles (title_id, title_text, unlock_type, unlock_ref, color, game_id)
    VALUES (@title_id, @title_text, @unlock_type, @unlock_ref, @color, @game_id)
    ON CONFLICT(title_id) DO NOTHING
  `);
  for (const t of CUSTOM_TITLES) upsertTitle.run(t);

  // ── Seed challenges (daily + weekly) ─────────────────────────────────────────
  const countChallenges = db.prepare(`SELECT COUNT(*) as n FROM challenges`).get();
  if (countChallenges.n === 0) {
    const insertChal = db.prepare(`
      INSERT INTO challenges (type, game_id, title, description, metric, goal, np_reward)
      VALUES (@type, @game_id, @title, @description, @metric, @goal, @np_reward)
    `);
    for (const c of DAILY_CHALLENGES)  insertChal.run({ ...c, type: 'daily' });
    for (const c of WEEKLY_CHALLENGES) insertChal.run({ ...c, type: 'weekly' });
  }

  // ── Ensure season 1 exists ────────────────────────────────────────────────────
  const seasonCount = db.prepare(`SELECT COUNT(*) as n FROM seasons`).get();
  if (seasonCount.n === 0) {
    db.prepare(`
      INSERT INTO seasons (name, started_at) VALUES ('Season 1', strftime('%s','now'))
    `).run();
    console.log('[Seasons] Season 1 started');
  }

  console.log(`[DB] Ready at ${DB_PATH}`);
}

initDB();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normGameId(id) {
  if (id === 'chaos-holdem') return 'chaos-casino';
  return id;
}

// Get day-of-year (0-based) for challenge rotation
function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff  = d - start;
  return Math.floor(diff / 86400000);
}

function weekOfYear(d = new Date()) {
  return Math.floor(dayOfYear(d) / 7);
}

function getActiveChallenge(type) {
  const all = db.prepare(`SELECT * FROM challenges WHERE type = ?`).all(type);
  if (!all.length) return null;
  const idx = type === 'daily'
    ? dayOfYear()  % all.length
    : weekOfYear() % all.length;
  return all[idx];
}

function getCurrentSeason() {
  return db.prepare(`SELECT * FROM seasons WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`).get();
}

// ─── Season NP + challenge progress helpers ──────────────────────────────────

function awardSeasonNP(profile_id, np) {
  const season = getCurrentSeason();
  if (!season) return;
  db.prepare(`
    INSERT INTO season_np (season_id, profile_id, np_earned)
    VALUES (?, ?, ?)
    ON CONFLICT(season_id, profile_id) DO UPDATE SET np_earned = np_earned + excluded.np_earned
  `).run(season.id, profile_id, np);
}

function updateChallengeProgress(profile_id, metric, value, game_id) {
  for (const type of ['daily', 'weekly']) {
    const chal = getActiveChallenge(type);
    if (!chal) continue;
    if (chal.metric !== metric) continue;
    if (chal.game_id && chal.game_id !== normGameId(game_id || '')) continue;

    // Upsert progress
    db.prepare(`
      INSERT INTO challenge_progress (challenge_id, profile_id, progress)
      VALUES (?, ?, ?)
      ON CONFLICT(challenge_id, profile_id) DO UPDATE SET
        progress = MIN(challenge_progress.progress + excluded.progress, ?)
    `).run(chal.id, profile_id, value, chal.goal);

    const row = db.prepare(`SELECT * FROM challenge_progress WHERE challenge_id=? AND profile_id=?`)
      .get(chal.id, profile_id);

    if (row && !row.completed && row.progress >= chal.goal) {
      db.prepare(`
        UPDATE challenge_progress SET completed=1, completed_at=strftime('%s','now')
        WHERE challenge_id=? AND profile_id=?
      `).run(chal.id, profile_id);

      // Award NP
      const prof = db.prepare(`SELECT * FROM profiles WHERE id=?`).get(profile_id);
      if (prof) {
        const newNp    = (prof.np || 0) + chal.np_reward;
        const newLevel = calcLevel(newNp);
        db.prepare(`UPDATE profiles SET np=?, level=? WHERE id=?`).run(newNp, newLevel, profile_id);
        awardSeasonNP(profile_id, chal.np_reward);
      }

      broadcast({ type: 'challenge_complete', profile_id, challenge_id: chal.id,
        challenge_type: type, title: chal.title, np_reward: chal.np_reward });
    }
  }
}

// ─── Achievement helper ───────────────────────────────────────────────────────

function tryUnlockAchievement(profile_id, achievement_id, progressDelta) {
  const ach = db.prepare(`SELECT * FROM achievements WHERE id=?`).get(achievement_id);
  if (!ach) return null;

  let pa = db.prepare(`
    SELECT * FROM profile_achievements WHERE profile_id=? AND achievement_id=?
  `).get(profile_id, achievement_id);

  if (!pa) {
    db.prepare(`
      INSERT OR IGNORE INTO profile_achievements (profile_id, achievement_id) VALUES (?, ?)
    `).run(profile_id, achievement_id);
    pa = { progress: 0, unlocked: 0 };
  }
  if (pa.unlocked) return null;

  const newProgress = (pa.progress || 0) + (progressDelta || ach.goal);
  const unlocked    = newProgress >= ach.goal;

  db.prepare(`
    UPDATE profile_achievements
    SET progress=?, unlocked=?, unlocked_at=CASE WHEN ?=1 THEN strftime('%s','now') ELSE unlocked_at END
    WHERE profile_id=? AND achievement_id=?
  `).run(Math.min(newProgress, ach.goal), unlocked ? 1 : 0, unlocked ? 1 : 0, profile_id, achievement_id);

  if (!unlocked) return null;

  // Award NP
  const prof = db.prepare(`SELECT * FROM profiles WHERE id=?`).get(profile_id);
  if (prof) {
    const newNp    = (prof.np || 0) + ach.np_reward;
    const newLevel = calcLevel(newNp);
    db.prepare(`UPDATE profiles SET np=?, level=? WHERE id=?`).run(newNp, newLevel, profile_id);
    awardSeasonNP(profile_id, ach.np_reward);

    // Check title unlock via achievement
    checkTitleUnlock(profile_id, 'achievement', achievement_id, newLevel);
  }

  broadcast({ type: 'achievement_unlock', profile_id, achievement_id,
    name: ach.name, icon: ach.icon, np_reward: ach.np_reward });

  return ach;
}

function checkTitleUnlock(profile_id, unlock_type, ref, level) {
  let titles;
  if (unlock_type === 'achievement') {
    titles = db.prepare(`SELECT * FROM custom_titles WHERE unlock_type='achievement' AND unlock_ref=?`).all(ref);
  } else if (unlock_type === 'level') {
    titles = db.prepare(`
      SELECT * FROM custom_titles WHERE unlock_type='level' AND CAST(unlock_ref AS INTEGER) <= ?
    `).all(level);
  } else {
    return;
  }

  for (const t of titles) {
    const existing = db.prepare(`
      SELECT * FROM profile_titles WHERE profile_id=? AND title_id=?
    `).get(profile_id, t.title_id);
    if (existing) continue;

    db.prepare(`
      INSERT INTO profile_titles (profile_id, title_id) VALUES (?, ?)
    `).run(profile_id, t.title_id);

    broadcast({ type: 'title_unlocked', profile_id,
      title_id: t.title_id, title_text: t.title_text, color: t.color });
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// ── Static assets (banners) ───────────────────────────────────────────────────
// On Railway, serve from /data/assets (persistent volume). Locally from assets/.
const DATA_ASSETS = fs.existsSync('/data') ? '/data/assets' : path.join(__dirname, 'assets');
if (!fs.existsSync(DATA_ASSETS)) fs.mkdirSync(DATA_ASSETS, { recursive: true });
// Copy bundled assets into volume on first boot
const SRC_ASSETS = path.join(__dirname, 'assets');
if (fs.existsSync(SRC_ASSETS)) {
  for (const f of fs.readdirSync(SRC_ASSETS)) {
    const dst = path.join(DATA_ASSETS, f);
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(SRC_ASSETS, f), dst);
  }
}
app.use('/assets', express.static(DATA_ASSETS));
// Banner upload endpoint (admin)
app.post('/admin/upload-banner', express.raw({ type: 'image/*', limit: '5mb' }), (req, res) => {
  const key    = req.headers['x-admin-key'];
  const gameId = req.headers['x-game-id'];
  if (key !== 'ngames-admin') return res.status(403).json({ error: 'Forbidden' });
  if (!gameId) return res.status(400).json({ error: 'x-game-id header required' });
  const dest = path.join(DATA_ASSETS, gameId + '-banner.png');
  fs.writeFileSync(dest, req.body);
  res.json({ ok: true, path: '/assets/' + gameId + '-banner.png' });
});

app.get('/',       (_, res) => res.json({ service: 'N Games Network', status: 'ok', ts: Date.now() }));
app.get('/health', (_, res) => res.json({ ok: true }));

// ── Crew definition ───────────────────────────────────────────────────────────
// Single source of truth — clients can fetch this instead of hardcoding.
// Shape: [{ id, name, color, suit, initial }]
app.get('/crew', (_, res) => res.json(CREW));

// ── Profiles ──────────────────────────────────────────────────────────────────

app.get('/profiles', (_, res) => {
  res.json(db.prepare(`SELECT * FROM profiles`).all().map(parseProfile));
});

app.get('/profiles/:id', (req, res) => {
  const p = db.prepare(`SELECT * FROM profiles WHERE id=?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(parseProfile(p));
});

function parseProfile(p) {
  return { ...p, game_stats: safeJSON(p.game_stats, {}) };
}

// ── Presence ──────────────────────────────────────────────────────────────────

app.get('/presence', (_, res) => {
  const rows = db.prepare(`SELECT * FROM presence`).all();
  const now  = Math.floor(Date.now() / 1000);
  res.json(rows.map(r => ({
    ...r,
    online:     r.online && (now - r.updated_at) < 90 ? 1 : 0,
    game_state: safeJSON(r.game_state, null),
  })));
});

app.post('/presence/ping', (req, res) => {
  const { profile_id, game_id = null, game_state = null } = req.body;
  if (!profile_id) return res.status(400).json({ error: 'profile_id required' });
  db.prepare(`
    INSERT INTO presence (profile_id, online, game_id, game_state, updated_at)
    VALUES (?, 1, ?, ?, strftime('%s','now'))
    ON CONFLICT(profile_id) DO UPDATE SET
      online=1, game_id=excluded.game_id,
      game_state=excluded.game_state, updated_at=excluded.updated_at
  `).run(profile_id, game_id, game_state ? JSON.stringify(game_state) : null);
  broadcast({ type: 'presence', profile_id, online: true, game_id, game_state });
  res.json({ ok: true });
});

app.post('/presence/offline', (req, res) => {
  const { profile_id } = req.body;
  if (!profile_id) return res.status(400).json({ error: 'profile_id required' });
  db.prepare(`
    UPDATE presence SET online=0, game_id=NULL, game_state=NULL,
    updated_at=strftime('%s','now') WHERE profile_id=?
  `).run(profile_id);
  broadcast({ type: 'presence', profile_id, online: false, game_id: null });
  res.json({ ok: true });
});

// ── Sessions ──────────────────────────────────────────────────────────────────

app.post('/sessions', (req, res) => {
  const { profile_id, game_id: rawGameId, score = 0, outcome, game_mode, data = {} } = req.body;
  if (!profile_id || !rawGameId) return res.status(400).json({ error: 'profile_id + game_id required' });

  const game_id = normGameId(rawGameId);
  const info = db.prepare(`
    INSERT INTO sessions (profile_id, game_id, score, outcome, game_mode, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(profile_id, game_id, Math.floor(score), outcome || null, game_mode || null, JSON.stringify(data));

  const session_id = info.lastInsertRowid;

  // Award NP
  const npGain = 10 + Math.floor(score / 100);
  const prof   = db.prepare(`SELECT * FROM profiles WHERE id=?`).get(profile_id);
  let newNp = (prof?.np || 0) + npGain;
  let newLevel = calcLevel(newNp);
  if (prof) {
    db.prepare(`UPDATE profiles SET np=?, level=? WHERE id=?`).run(newNp, newLevel, profile_id);
    awardSeasonNP(profile_id, npGain);
    // Check level titles
    checkTitleUnlock(profile_id, 'level', null, newLevel);
  }

  // Update challenge progress
  const parsed = safeJSON(typeof data === 'string' ? data : JSON.stringify(data), {});
  updateChallengeProgress(profile_id, 'sessions', 1, game_id);
  if (outcome === 'win') updateChallengeProgress(profile_id, 'wins', 1, game_id);
  updateChallengeProgress(profile_id, 'score', Math.floor(score), game_id);
  if (parsed.kills)        updateChallengeProgress(profile_id, 'kills',        parsed.kills,        game_id);
  if (parsed.cases_opened) updateChallengeProgress(profile_id, 'cases_opened', parsed.cases_opened, game_id);
  if (parsed.playtime)     updateChallengeProgress(profile_id, 'playtime',     parsed.playtime,     game_id);

  // Resolve bets targeting this profile
  const openBets = db.prepare(`
    SELECT * FROM bets WHERE target_id=? AND game_id=? AND status='open'
  `).all(profile_id, game_id);

  for (const bet of openBets) {
    if (!outcome || (outcome !== 'win' && outcome !== 'bust')) continue;
    const won = outcome === 'win';
    db.prepare(`
      UPDATE bets SET status=?, resolved_at=strftime('%s','now'), session_id=? WHERE id=?
    `).run(won ? 'won' : 'lost', session_id, bet.id);

    if (won) {
      // Return wager × 2 to bettor
      db.prepare(`UPDATE profiles SET np=np+? WHERE id=?`).run(bet.np_wager * 2, bet.bettor_id);
      awardSeasonNP(bet.bettor_id, bet.np_wager);
      broadcast({ type: 'bet_resolved', bet_id: bet.id, bettor_id: bet.bettor_id,
        target_id: profile_id, won: true, np_change: bet.np_wager });
    } else {
      broadcast({ type: 'bet_resolved', bet_id: bet.id, bettor_id: bet.bettor_id,
        target_id: profile_id, won: false, np_change: -bet.np_wager });
    }
  }

  broadcast({ type: 'session', profile_id, game_id, score, session_id });
  res.json({ ok: true, session_id, np_gained: npGain });
});

app.get('/sessions/leaderboard', (req, res) => {
  const game_id = req.query.game || null;
  const rows = db.prepare(`
    SELECT s.*, p.name, p.color, p.suit
    FROM sessions s JOIN profiles p ON p.id = s.profile_id
    WHERE (@game_id IS NULL OR s.game_id = @game_id)
    ORDER BY s.score DESC LIMIT 50
  `).all({ game_id });
  res.json(rows.map(r => ({ ...r, data: safeJSON(r.data, {}) })));
});

app.get('/sessions/:profile_id', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM sessions WHERE profile_id=? ORDER BY created_at DESC LIMIT 100
  `).all(req.params.profile_id);
  res.json(rows.map(r => ({ ...r, data: safeJSON(r.data, {}) })));
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/stats/:profile_id', (req, res) => {
  const pid  = req.params.profile_id;
  const prof = db.prepare(`SELECT * FROM profiles WHERE id=?`).get(pid);
  if (!prof) return res.status(404).json({ error: 'Not found' });

  const sessions = db.prepare(`SELECT * FROM sessions WHERE profile_id=?`).all(pid);
  const total_sessions = sessions.length;
  const total_wins     = sessions.filter(s => s.outcome === 'win').length;

  // Per-game aggregates
  const byGame = {};
  for (const s of sessions) {
    const gid = normGameId(s.game_id);
    if (!byGame[gid]) byGame[gid] = { sessions: 0, wins: 0, best_score: 0, modes: {}, total_score: 0 };
    const g = byGame[gid];
    g.sessions++;
    if (s.outcome === 'win') g.wins++;
    if (s.score > g.best_score) g.best_score = s.score;
    g.total_score += s.score;
    const mode = s.game_mode || 'default';
    g.modes[mode] = (g.modes[mode] || 0) + 1;
  }

  const by_game = {};
  for (const [gid, g] of Object.entries(byGame)) {
    const favorite_mode = Object.entries(g.modes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    by_game[gid] = {
      sessions:     g.sessions,
      wins:         g.wins,
      best_score:   g.best_score,
      win_rate:     g.sessions ? Math.round(g.wins / g.sessions * 100) : 0,
      favorite_mode,
    };
  }

  res.json({
    profile_id:     pid,
    total_sessions,
    total_wins,
    total_np:       prof.np || 0,
    level:          prof.level || 1,
    title:          getLevelTitle(prof.level || 1),
    by_game,
  });
});

// ── Leaderboard records ───────────────────────────────────────────────────────

app.get('/leaderboard/records', (req, res) => {
  const allSessions = db.prepare(`
    SELECT s.*, p.name, p.color
    FROM sessions s JOIN profiles p ON p.id = s.profile_id
    ORDER BY s.created_at ASC
  `).all();

  const records = {};

  for (const s of allSessions) {
    const gid  = normGameId(s.game_id);
    const data = safeJSON(s.data, {});
    if (!records[gid]) records[gid] = {};
    const r = records[gid];

    // Best score
    if (!r.best_score || s.score > r.best_score.score) {
      r.best_score = { profile_id: s.profile_id, name: s.name, color: s.color,
        score: s.score, mode: s.game_mode, date: s.created_at };
    }
    // Most kills (N Arena, SOB)
    if (data.kills != null) {
      if (!r.most_kills || data.kills > r.most_kills.value) {
        r.most_kills = { profile_id: s.profile_id, name: s.name, color: s.color,
          value: data.kills, mode: s.game_mode, date: s.created_at };
      }
    }
    // Fastest run (CuunSurf / SOB — lower is better)
    if (data.time != null && data.time > 0) {
      if (!r.fastest_run || data.time < r.fastest_run.value) {
        r.fastest_run = { profile_id: s.profile_id, name: s.name, color: s.color,
          value: data.time, mode: s.game_mode, date: s.created_at };
      }
    }
    // Longest streak (N Arena)
    if (data.streak != null) {
      if (!r.longest_streak || data.streak > r.longest_streak.value) {
        r.longest_streak = { profile_id: s.profile_id, name: s.name, color: s.color,
          value: data.streak, mode: s.game_mode, date: s.created_at };
      }
    }
  }

  res.json(records);
});

// ── Wall ──────────────────────────────────────────────────────────────────────

app.get('/wall', (_, res) => {
  const posts = db.prepare(`
    SELECT w.*, p.name, p.color, p.suit, p.initial
    FROM wall w JOIN profiles p ON p.id = w.profile_id
    ORDER BY w.created_at DESC LIMIT 50
  `).all();
  res.json(posts.map(p => ({
    ...p,
    reactions:     safeJSON(p.reactions, {}),
    comment_count: db.prepare(`SELECT COUNT(*) as n FROM comments WHERE post_id=?`).get(p.id)?.n || 0,
  })));
});

app.post('/wall/post', (req, res) => {
  const { profile_id, game_id = null, content } = req.body;
  if (!profile_id || !content) return res.status(400).json({ error: 'profile_id + content required' });
  const info = db.prepare(`INSERT INTO wall (profile_id, game_id, content) VALUES (?, ?, ?)`)
    .run(profile_id, game_id, content.slice(0, 500));
  const post = db.prepare(`
    SELECT w.*, p.name, p.color, p.suit, p.initial FROM wall w
    JOIN profiles p ON p.id=w.profile_id WHERE w.id=?
  `).get(info.lastInsertRowid);
  if (post) broadcast({ type: 'wall_post', post: { ...post, reactions: safeJSON(post.reactions, {}), comment_count: 0 } });
  res.json({ ok: true, post_id: info.lastInsertRowid });
});

app.post('/wall/:id/react', (req, res) => {
  const { profile_id, suit } = req.body;
  const SUITS = ['♦','♥','♠','♣'];
  if (!profile_id || !SUITS.includes(suit)) return res.status(400).json({ error: 'profile_id + valid suit required' });
  const post = db.prepare(`SELECT * FROM wall WHERE id=?`).get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const reactions = safeJSON(post.reactions, { '♦':[],'♥':[],'♠':[],'♣':[] });
  const list = reactions[suit] || [];
  const idx  = list.indexOf(profile_id);
  if (idx === -1) list.push(profile_id); else list.splice(idx, 1);
  reactions[suit] = list;
  db.prepare(`UPDATE wall SET reactions=? WHERE id=?`).run(JSON.stringify(reactions), post.id);
  broadcast({ type: 'reaction', post_id: post.id, reactions });
  res.json({ ok: true, reactions });
});

app.get('/wall/:id/comments', (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, p.name, p.color, p.suit, p.initial
    FROM comments c JOIN profiles p ON p.id=c.profile_id
    WHERE c.post_id=? ORDER BY c.created_at ASC
  `).all(req.params.id);
  res.json(comments);
});

app.post('/wall/:id/comment', (req, res) => {
  const { profile_id, content } = req.body;
  if (!profile_id || !content) return res.status(400).json({ error: 'profile_id + content required' });
  const info = db.prepare(`INSERT INTO comments (post_id, profile_id, content) VALUES (?, ?, ?)`)
    .run(req.params.id, profile_id, content.slice(0, 200));
  const poster = db.prepare(`SELECT name, color, initial FROM profiles WHERE id=?`).get(profile_id);
  broadcast({
    type: 'comment', post_id: +req.params.id, comment_id: info.lastInsertRowid,
    profile_id, name: poster?.name, color: poster?.color, initial: poster?.initial,
    content: content.slice(0, 200), created_at: Math.floor(Date.now() / 1000),
  });
  res.json({ ok: true, comment_id: info.lastInsertRowid });
});

// ── Messages ──────────────────────────────────────────────────────────────────

app.get('/messages/:a/:b', (req, res) => {
  const { a, b } = req.params;
  const rows = db.prepare(`
    SELECT m.*, p.name as from_name, p.color as from_color, p.suit as from_suit
    FROM messages m JOIN profiles p ON p.id=m.from_id
    WHERE (from_id=@a AND to_id=@b) OR (from_id=@b AND to_id=@a)
    ORDER BY m.created_at ASC LIMIT 200
  `).all({ a, b });
  res.json(rows);
});

app.post('/messages', (req, res) => {
  const { from_id, to_id, content } = req.body;
  if (!from_id || !to_id || !content) return res.status(400).json({ error: 'from_id, to_id, content required' });
  const info = db.prepare(`INSERT INTO messages (from_id, to_id, content) VALUES (?, ?, ?)`)
    .run(from_id, to_id, content.slice(0, 1000));
  const msg = { id: info.lastInsertRowid, from_id, to_id, content, created_at: Math.floor(Date.now() / 1000) };
  broadcast({ type: 'message', message: msg }, [to_id]);
  res.json({ ok: true, message_id: info.lastInsertRowid });
});

app.post('/messages/read', (req, res) => {
  const { reader_id, from_id } = req.body;
  db.prepare(`UPDATE messages SET read=1 WHERE to_id=? AND from_id=?`).run(reader_id, from_id);
  res.json({ ok: true });
});

app.get('/messages/unread/:profile_id', (req, res) => {
  const rows = db.prepare(`
    SELECT from_id, COUNT(*) as count FROM messages
    WHERE to_id=? AND read=0 GROUP BY from_id
  `).all(req.params.profile_id);
  res.json(rows);
});

// ── Games ─────────────────────────────────────────────────────────────────────

app.get('/games', (_, res) => {
  const rows = db.prepare(`SELECT * FROM games WHERE status != 'hidden'`).all();
  res.json(rows.map(g => ({ ...g, tags: safeJSON(g.tags, []) })));
});

app.get('/games/:id', (req, res) => {
  const g = db.prepare(`SELECT * FROM games WHERE id=?`).get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  res.json({ ...g, tags: safeJSON(g.tags, []) });
});

// ── Achievements ──────────────────────────────────────────────────────────────

app.get('/achievements/:profile_id', (req, res) => {
  const pid  = req.params.profile_id;
  const rows = db.prepare(`
    SELECT a.*,
      COALESCE(pa.progress, 0)    as progress,
      COALESCE(pa.unlocked, 0)    as unlocked,
      pa.unlocked_at
    FROM achievements a
    LEFT JOIN profile_achievements pa ON pa.achievement_id=a.id AND pa.profile_id=?
    ORDER BY a.game_id, a.id
  `).all(pid);
  res.json(rows);
});

app.post('/achievements/unlock', (req, res) => {
  const { profile_id, achievement_id } = req.body;
  if (!profile_id || !achievement_id) return res.status(400).json({ error: 'profile_id + achievement_id required' });
  const ach = tryUnlockAchievement(profile_id, achievement_id, null);
  res.json({ ok: true, unlocked: !!ach, achievement: ach });
});

app.post('/achievements/progress', (req, res) => {
  const { profile_id, achievement_id, value = 1 } = req.body;
  if (!profile_id || !achievement_id) return res.status(400).json({ error: 'required' });
  tryUnlockAchievement(profile_id, achievement_id, value);
  res.json({ ok: true });
});

// ── Titles ────────────────────────────────────────────────────────────────────

app.get('/titles/:profile_id', (req, res) => {
  const pid = req.params.profile_id;
  const rows = db.prepare(`
    SELECT ct.*, pt.unlocked_at, pt.equipped
    FROM profile_titles pt
    JOIN custom_titles ct ON ct.title_id=pt.title_id
    WHERE pt.profile_id=?
    ORDER BY pt.unlocked_at DESC
  `).all(pid);
  res.json(rows);
});

app.post('/titles/equip', (req, res) => {
  const { profile_id, title_id } = req.body;
  if (!profile_id || !title_id) return res.status(400).json({ error: 'required' });
  const owned = db.prepare(`SELECT * FROM profile_titles WHERE profile_id=? AND title_id=?`).get(profile_id, title_id);
  if (!owned) return res.status(403).json({ error: 'Title not unlocked' });
  db.prepare(`UPDATE profile_titles SET equipped=0 WHERE profile_id=?`).run(profile_id);
  db.prepare(`UPDATE profile_titles SET equipped=1 WHERE profile_id=? AND title_id=?`).run(profile_id, title_id);
  const title = db.prepare(`SELECT * FROM custom_titles WHERE title_id=?`).get(title_id);
  broadcast({ type: 'title_equipped', profile_id, title_id, title_text: title?.title_text, color: title?.color });
  res.json({ ok: true });
});

// ── Challenges ────────────────────────────────────────────────────────────────

app.get('/challenges/active', (req, res) => {
  const daily  = getActiveChallenge('daily');
  const weekly = getActiveChallenge('weekly');
  const now    = new Date();
  const midnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  const sundayMs   = (7 - now.getDay()) * 86400000 - (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) * 1000;
  res.json({
    daily:  daily  ? { ...daily,  expires_in: Math.floor(midnightMs / 1000) } : null,
    weekly: weekly ? { ...weekly, expires_in: Math.floor(sundayMs   / 1000) } : null,
  });
});

app.get('/challenges/progress/:profile_id', (req, res) => {
  const pid    = req.params.profile_id;
  const daily  = getActiveChallenge('daily');
  const weekly = getActiveChallenge('weekly');
  const result = {};

  for (const chal of [daily, weekly].filter(Boolean)) {
    // Progress for this profile
    const myRow = db.prepare(`
      SELECT * FROM challenge_progress WHERE challenge_id=? AND profile_id=?
    `).get(chal.id, pid);
    // Progress for all crew
    const allRows = db.prepare(`
      SELECT cp.*, p.name, p.color
      FROM challenge_progress cp JOIN profiles p ON p.id=cp.profile_id
      WHERE cp.challenge_id=?
    `).all(chal.id);
    result[chal.type] = {
      challenge:    chal,
      my_progress:  myRow?.progress || 0,
      my_completed: myRow?.completed || 0,
      crew_progress: allRows,
    };
  }
  res.json(result);
});

// ── Seasons ───────────────────────────────────────────────────────────────────

app.get('/seasons/current', (req, res) => {
  const season = getCurrentSeason();
  if (!season) return res.json(null);
  const lb = db.prepare(`
    SELECT sn.profile_id, sn.np_earned, p.name, p.color, p.initial
    FROM season_np sn JOIN profiles p ON p.id=sn.profile_id
    WHERE sn.season_id=? ORDER BY sn.np_earned DESC
  `).all(season.id);
  const now     = Math.floor(Date.now() / 1000);
  const ends_at = season.started_at + 30 * 86400;
  res.json({ ...season, ends_at, days_remaining: Math.max(0, Math.ceil((ends_at - now) / 86400)), leaderboard: lb });
});

app.get('/seasons/history', (req, res) => {
  const seasons = db.prepare(`SELECT * FROM seasons WHERE ended_at IS NOT NULL ORDER BY id DESC`).all();
  const result  = seasons.map(s => {
    const winner = s.winner_id ? db.prepare(`SELECT * FROM profiles WHERE id=?`).get(s.winner_id) : null;
    return { ...s, winner };
  });
  res.json(result);
});

// ── Bets ──────────────────────────────────────────────────────────────────────

app.post('/bets', (req, res) => {
  const { bettor_id, target_id, game_id, game_mode, np_wager } = req.body;
  if (!bettor_id || !target_id || !game_id || !np_wager)
    return res.status(400).json({ error: 'bettor_id, target_id, game_id, np_wager required' });
  if (bettor_id === target_id) return res.status(400).json({ error: 'Cannot bet on yourself' });
  if (np_wager > 500) return res.status(400).json({ error: 'Max wager is 500 NP' });
  if (np_wager < 1)   return res.status(400).json({ error: 'Minimum wager is 1 NP' });

  const bettor = db.prepare(`SELECT * FROM profiles WHERE id=?`).get(bettor_id);
  if (!bettor || (bettor.np || 0) < np_wager)
    return res.status(400).json({ error: 'Not enough NP' });

  // Deduct NP
  db.prepare(`UPDATE profiles SET np=np-? WHERE id=?`).run(np_wager, bettor_id);

  const info = db.prepare(`
    INSERT INTO bets (bettor_id, target_id, game_id, game_mode, np_wager)
    VALUES (?, ?, ?, ?, ?)
  `).run(bettor_id, target_id, normGameId(game_id), game_mode || null, np_wager);

  const bettorProfile = db.prepare(`SELECT * FROM profiles WHERE id=?`).get(bettor_id);
  const targetProfile = db.prepare(`SELECT * FROM profiles WHERE id=?`).get(target_id);
  broadcast({ type: 'bet_placed', bet_id: info.lastInsertRowid,
    bettor_id, target_id, game_id, np_wager,
    bettor_name: bettorProfile?.name, target_name: targetProfile?.name });

  res.json({ ok: true, bet_id: info.lastInsertRowid });
});

app.get('/bets/open', (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, p1.name as bettor_name, p1.color as bettor_color,
      p2.name as target_name, p2.color as target_color
    FROM bets b
    JOIN profiles p1 ON p1.id=b.bettor_id
    JOIN profiles p2 ON p2.id=b.target_id
    WHERE b.status='open'
    ORDER BY b.created_at DESC
  `).all();
  res.json(rows);
});

app.get('/bets/:profile_id', (req, res) => {
  const pid  = req.params.profile_id;
  const rows = db.prepare(`
    SELECT b.*, p1.name as bettor_name, p1.color as bettor_color,
      p2.name as target_name, p2.color as target_color
    FROM bets b
    JOIN profiles p1 ON p1.id=b.bettor_id
    JOIN profiles p2 ON p2.id=b.target_id
    WHERE b.bettor_id=? OR b.target_id=?
    ORDER BY b.created_at DESC LIMIT 50
  `).all(pid, pid);
  res.json(rows);
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

const VPN_TOKEN = process.env.VPN_TOKEN || 'ngames-crew-vpn-7x4k';

// VPN tunnel: proxies TCP connections on behalf of N Streams clients.
// Client sends { token, host, port } as first JSON message, then raw
// binary frames that are forwarded to the TCP socket — and vice versa.
function handleVpnTunnel(ws) {
  let tcp  = null;
  let ready = false;

  ws.on('message', (data, isBinary) => {
    if (ready) {
      // Tunnel open — forward raw bytes to the TCP target
      if (tcp && !tcp.destroyed) tcp.write(data);
      return;
    }

    // First message must be the JSON handshake
    try {
      const msg = JSON.parse(data.toString());
      if (msg.token !== VPN_TOKEN) { ws.close(1008, 'Unauthorized'); return; }

      tcp = net.connect(msg.port, msg.host);

      tcp.on('connect', () => {
        ready = true;
        ws.send(JSON.stringify({ ok: true })); // tell client TCP is up
      });

      tcp.on('data', (chunk) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      });

      tcp.on('error',  () => ws.close(1011, 'TCP error'));
      tcp.on('close',  () => ws.close());
    } catch {
      ws.close(1008, 'Bad handshake');
    }
  });

  ws.on('close',  () => tcp?.destroy());
  ws.on('error',  () => tcp?.destroy());
}

const wss     = new WebSocketServer({ server });
const clients = new Map(); // profile_id → Set<ws>

wss.on('connection', (ws, req) => {
  // Route VPN tunnel connections separately
  if (req.url === '/vpn') { handleVpnTunnel(ws); return; }
  let profileId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'identify' && msg.profile_id) {
        profileId = msg.profile_id;
        if (!clients.has(profileId)) clients.set(profileId, new Set());
        clients.get(profileId).add(ws);
        ws.send(JSON.stringify({ type: 'identified', profile_id: profileId }));
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    if (profileId && clients.has(profileId)) {
      clients.get(profileId).delete(ws);
      if (clients.get(profileId).size === 0) {
        clients.delete(profileId);
        db.prepare(`
          UPDATE presence SET online=0, game_id=NULL, game_state=NULL,
          updated_at=strftime('%s','now') WHERE profile_id=?
        `).run(profileId);
        broadcast({ type: 'presence', profile_id: profileId, online: false });
      }
    }
  });

  ws.on('error', () => {});
});

function broadcast(payload, targetIds = null) {
  const data = JSON.stringify(payload);
  if (targetIds) {
    for (const id of targetIds) {
      const sockets = clients.get(id);
      if (sockets) for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    }
  } else {
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  }
}

// ─── Periodic tasks ───────────────────────────────────────────────────────────

// Stale presence sweep (every 60s)
setInterval(() => {
  const cutoff = Math.floor(Date.now() / 1000) - 90;
  const stale  = db.prepare(`SELECT profile_id FROM presence WHERE online=1 AND updated_at < ?`).all(cutoff);
  for (const row of stale) {
    db.prepare(`UPDATE presence SET online=0, game_id=NULL, game_state=NULL, updated_at=strftime('%s','now') WHERE profile_id=?`).run(row.profile_id);
    broadcast({ type: 'presence', profile_id: row.profile_id, online: false });
  }
}, 60_000);

// Expire open bets older than 2 hours (every 10m)
setInterval(() => {
  const cutoff = Math.floor(Date.now() / 1000) - 7200;
  const expired = db.prepare(`SELECT * FROM bets WHERE status='open' AND created_at < ?`).all(cutoff);
  for (const bet of expired) {
    db.prepare(`UPDATE bets SET status='cancelled', resolved_at=strftime('%s','now') WHERE id=?`).run(bet.id);
    // Refund bettor
    db.prepare(`UPDATE profiles SET np=np+? WHERE id=?`).run(bet.np_wager, bet.bettor_id);
    broadcast({ type: 'bet_expired', bet_id: bet.id, bettor_id: bet.bettor_id, refund: bet.np_wager });
  }
}, 600_000);

// Season end check (every hour)
setInterval(() => {
  const season = getCurrentSeason();
  if (!season) return;
  const now    = Math.floor(Date.now() / 1000);
  const endsAt = season.started_at + 30 * 86400;
  if (now < endsAt) return;

  // Find winner
  const top = db.prepare(`
    SELECT profile_id FROM season_np WHERE season_id=? ORDER BY np_earned DESC LIMIT 1
  `).get(season.id);
  const winner_id = top?.profile_id || null;

  db.prepare(`UPDATE seasons SET ended_at=?, winner_id=? WHERE id=?`).run(now, winner_id, season.id);

  const nextNum = season.id + 1;
  db.prepare(`INSERT INTO seasons (name, started_at) VALUES (?, ?)`).run(`Season ${nextNum}`, now);

  const winnerProfile = winner_id ? db.prepare(`SELECT * FROM profiles WHERE id=?`).get(winner_id) : null;
  broadcast({ type: 'season_end', season_id: season.id, winner_id, winner_name: winnerProfile?.name });
  console.log(`[Seasons] Season ${season.id} ended. Winner: ${winner_id || 'none'}`);
}, 3_600_000);

// ─── N Streams crew stats relay ──────────────────────────────────────────────
// Each N Streams instance pushes a stat snapshot here after any activity so
// that every device can show the full crew picture on the Crew page.

// GET /nstreams/crew — all crew snapshots
app.get('/nstreams/crew', (req, res) => {
  const rows = db.prepare('SELECT * FROM nstreams_crew ORDER BY username').all();
  res.json(rows.map(r => ({
    username:          r.username,
    display_name:      r.display_name,
    avatar_color:      r.avatar_color,
    watching:          r.watching_count,
    completed:         r.completed_count,
    plan_to_watch:     r.plan_count,
    this_week:         JSON.parse(r.this_week_json         || '[]'),
    recent_completed:  JSON.parse(r.recent_completed_json  || '[]'),
    updated_at:        r.updated_at,
  })));
});

// GET /nstreams/crew/:username — single user snapshot
app.get('/nstreams/crew/:username', (req, res) => {
  const r = db.prepare('SELECT * FROM nstreams_crew WHERE username = ?').get(req.params.username);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({
    username:         r.username,
    display_name:     r.display_name,
    avatar_color:     r.avatar_color,
    watching:         r.watching_count,
    completed:        r.completed_count,
    plan_to_watch:    r.plan_count,
    this_week:        JSON.parse(r.this_week_json         || '[]'),
    recent_completed: JSON.parse(r.recent_completed_json  || '[]'),
    updated_at:       r.updated_at,
  });
});

// POST /nstreams/crew/:username — push a user's stats snapshot
app.post('/nstreams/crew/:username', express.json(), (req, res) => {
  const { username } = req.params;
  const {
    display_name, avatar_color,
    watching = 0, completed = 0, plan_to_watch = 0,
    this_week = [], recent_completed = [],
  } = req.body || {};

  db.prepare(`
    INSERT INTO nstreams_crew
      (username, display_name, avatar_color, watching_count, completed_count,
       plan_count, this_week_json, recent_completed_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(username) DO UPDATE SET
      display_name          = excluded.display_name,
      avatar_color          = excluded.avatar_color,
      watching_count        = excluded.watching_count,
      completed_count       = excluded.completed_count,
      plan_count            = excluded.plan_count,
      this_week_json        = excluded.this_week_json,
      recent_completed_json = excluded.recent_completed_json,
      updated_at            = CURRENT_TIMESTAMP
  `).run(
    username,
    display_name  || username,
    avatar_color  || '#6366f1',
    Number(watching),
    Number(completed),
    Number(plan_to_watch),
    JSON.stringify(this_week),
    JSON.stringify(recent_completed),
  );

  res.json({ ok: true });
});

// ─── N Streams activity bridge ────────────────────────────────────────────────
// N Streams reports viewing milestones here; we broadcast them as
// `nstreams_activity` WS events so the Discord bot can post them.

app.post('/nstreams/activity', express.json(), (req, res) => {
  const {
    event_type, user_name, content_title, content_type,
    poster_path, season, rating, total_episodes,
  } = req.body || {};

  if (!event_type || !user_name || !content_title) {
    return res.status(400).json({ error: 'event_type, user_name, content_title required' });
  }

  broadcast({
    type:           'nstreams_activity',
    event_type,
    user_name,
    content_title,
    content_type:   content_type   || 'tv',
    poster_path:    poster_path    || null,
    season:         season         || null,
    rating:         rating         || null,
    total_episodes: total_episodes || null,
    ts:             Date.now(),
  });

  res.json({ ok: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[N Games Network] Server running on :${PORT}`);
  console.log(`[N Games Network] DB: ${DB_PATH}`);
});
