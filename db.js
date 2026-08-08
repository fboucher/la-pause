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
`;

function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
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

module.exports = {
  openDatabase,
  todayInToronto,
  recordGuestVisit,
  findUser,
  findUserById,
  upsertUser,
};

