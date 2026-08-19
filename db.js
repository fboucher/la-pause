'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  avatar TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS player_stats (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  tokens INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_analytics (
  date TEXT PRIMARY KEY,
  guests INTEGER NOT NULL DEFAULT 0,
  registered INTEGER NOT NULL DEFAULT 0,
  puzzle_wins INTEGER NOT NULL DEFAULT 0,
  free_wins INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_guest_visits (
  date TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  PRIMARY KEY (date, guest_id)
);

CREATE TABLE IF NOT EXISTS daily_registered_visits (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (date, user_id)
);

CREATE TABLE IF NOT EXISTS leaderboard_daily (
  date TEXT NOT NULL,
  challenge TEXT NOT NULL DEFAULT 'espresso',
  user_id INTEGER NOT NULL REFERENCES users(id),
  moves INTEGER NOT NULL,
  hints INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, challenge, user_id)
);

CREATE TABLE IF NOT EXISTS leaderboard_free (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  wins INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  email TEXT NOT NULL,
  token TEXT NOT NULL PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(leaderboard_daily)').all();
  if (cols.some((c) => c.name === 'challenge')) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    ALTER TABLE leaderboard_daily RENAME TO leaderboard_daily_legacy;
    CREATE TABLE leaderboard_daily (
      date TEXT NOT NULL,
      challenge TEXT NOT NULL DEFAULT 'espresso',
      user_id INTEGER NOT NULL REFERENCES users(id),
      moves INTEGER NOT NULL,
      hints INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (date, challenge, user_id)
    );
    INSERT INTO leaderboard_daily (date, challenge, user_id, moves, hints, submitted_at)
      SELECT date, 'espresso', user_id, moves, hints, submitted_at FROM leaderboard_daily_legacy;
    DROP TABLE leaderboard_daily_legacy;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function todayInToronto(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = fmt.formatToParts(now);
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function recordGuestVisit(db, date, guestId) {
  const inserted = db
    .prepare('INSERT OR IGNORE INTO daily_guest_visits (date, guest_id) VALUES (?, ?)')
    .run(date, guestId);
  if (inserted.changes === 0) return false;
  db.prepare(
    `INSERT INTO daily_analytics (date, guests) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET guests = guests + 1`
  ).run(date);
  return true;
}

function findUser(db, provider, providerId) {
  return db
    .prepare('SELECT id, provider, provider_id, name, email, avatar, created_at FROM users WHERE provider = ? AND provider_id = ?')
    .get(provider, providerId);
}

function findUserById(db, id) {
  return db
    .prepare('SELECT id, provider, provider_id, name, email, avatar, created_at FROM users WHERE id = ?')
    .get(id);
}

function upsertUser(db, { provider, providerId, name = null, email = null, avatar = null }) {
  db.prepare(
    `INSERT INTO users (provider, provider_id, name, email, avatar)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_id) DO UPDATE SET
       name = excluded.name,
       email = excluded.email,
       avatar = excluded.avatar`
  ).run(provider, providerId, name, email, avatar);
  return findUser(db, provider, providerId);
}

function getPlayerStats(db, userId) {
  const row = db
    .prepare('SELECT tokens, wins, streak, best_streak FROM player_stats WHERE user_id = ?')
    .get(userId);
  return row || { tokens: 0, wins: 0, streak: 0, best_streak: 0 };
}

function syncPlayerStats(db, userId, { tokens = 0, wins = 0, streak = 0, best_streak = 0 }) {
  const current = getPlayerStats(db, userId);
  const merged = {
    tokens: Math.max(current.tokens, tokens),
    wins: Math.max(current.wins, wins),
    streak: Math.max(current.streak, streak),
    best_streak: Math.max(current.best_streak, best_streak),
  };
  db.prepare(
    `INSERT INTO player_stats (user_id, tokens, wins, streak, best_streak, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       tokens = excluded.tokens,
       wins = excluded.wins,
       streak = excluded.streak,
       best_streak = excluded.best_streak,
       updated_at = datetime('now')`
  ).run(userId, merged.tokens, merged.wins, merged.streak, merged.best_streak);
  return merged;
}

function recordRegisteredVisit(db, date, userId) {
  const inserted = db
    .prepare('INSERT OR IGNORE INTO daily_registered_visits (date, user_id) VALUES (?, ?)')
    .run(date, userId);
  if (inserted.changes === 0) return false;
  db.prepare(
    `INSERT INTO daily_analytics (date, registered) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET registered = registered + 1`
  ).run(date);
  return true;
}

function recordWin(db, date, mode) {
  const col = mode === 'espresso' || mode === 'latte' ? 'puzzle_wins' : 'free_wins';
  db.prepare(
    `INSERT INTO daily_analytics (date, ${col}) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET ${col} = ${col} + 1`
  ).run(date);
}

function isDailyChallenge(value) {
  return value === 'espresso' || value === 'latte';
}

function isBetterDailyScore(existing, moves, hints) {
  if (existing.moves !== moves) return moves < existing.moves;
  return hints < existing.hints;
}

function submitDailyScore(db, date, challenge, userId, moves, hints, submittedAt = new Date().toISOString()) {
  const existing = db
    .prepare('SELECT moves, hints FROM leaderboard_daily WHERE date = ? AND challenge = ? AND user_id = ?')
    .get(date, challenge, userId);
  if (existing && !isBetterDailyScore(existing, moves, hints)) {
    return { recorded: false, moves: existing.moves, hints: existing.hints };
  }
  db.prepare(
    `INSERT INTO leaderboard_daily (date, challenge, user_id, moves, hints, submitted_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, challenge, user_id) DO UPDATE SET
       moves = excluded.moves,
       hints = excluded.hints,
       submitted_at = excluded.submitted_at`
  ).run(date, challenge, userId, moves, hints, submittedAt);
  return { recorded: true, moves, hints };
}

function getDailyLeaderboard(db, date, challenge = 'espresso') {
  return db
    .prepare(
      `SELECT u.id, u.name, u.avatar, l.moves, l.hints
       FROM leaderboard_daily l
       JOIN users u ON u.id = l.user_id
       WHERE l.date = ? AND l.challenge = ?
       ORDER BY l.moves ASC, l.hints ASC, l.submitted_at ASC
       LIMIT 50`
    )
    .all(date, challenge);
}

function submitFreeWin(db, userId, wins, updatedAt = new Date().toISOString()) {
  const current = db.prepare('SELECT wins FROM leaderboard_free WHERE user_id = ?').get(userId) || { wins: 0 };
  const mergedWins = Math.max(current.wins, wins);
  db.prepare(
    `INSERT INTO leaderboard_free (user_id, wins, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET wins = excluded.wins, updated_at = excluded.updated_at`
  ).run(userId, mergedWins, updatedAt);
  return { wins: mergedWins };
}

function getFreeLeaderboard(db) {
  return db
    .prepare(
      `SELECT u.id, u.name, u.avatar, l.wins
       FROM leaderboard_free l
       JOIN users u ON u.id = l.user_id
       ORDER BY l.wins DESC, l.updated_at ASC
       LIMIT 50`
    )
    .all();
}

function saveMagicLinkToken(db, email, token, expiresAt) {
  db.prepare(
    `INSERT INTO magic_link_tokens (email, token, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET email = excluded.email, expires_at = excluded.expires_at`
  ).run(email, token, expiresAt);
}

function getMagicLinkToken(db, token) {
  return db
    .prepare('SELECT email, token, expires_at, created_at FROM magic_link_tokens WHERE token = ?')
    .get(token);
}

function deleteMagicLinkToken(db, token) {
  db.prepare('DELETE FROM magic_link_tokens WHERE token = ?').run(token);
}

module.exports = {
  openDatabase,
  todayInToronto,
  recordGuestVisit,
  findUser,
  findUserById,
  upsertUser,
  getPlayerStats,
  syncPlayerStats,
  recordRegisteredVisit,
  recordWin,
  isDailyChallenge,
  submitDailyScore,
  getDailyLeaderboard,
  submitFreeWin,
  getFreeLeaderboard,
  saveMagicLinkToken,
  getMagicLinkToken,
  deleteMagicLinkToken,
};

