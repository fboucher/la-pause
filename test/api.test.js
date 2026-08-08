'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDatabase, todayInToronto, recordGuestVisit, findUser, findUserById, upsertUser } = require('../db');
const { createApp } = require('../server');

function listen(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

async function start(t, db, options = {}) {
  const app = createApp(db, { sessionSecret: 'test-secret-key-12345', ...options });
  const { srv, port } = await listen(app);
  t.after(() => new Promise((resolve) => srv.close(resolve)));
  return `http://127.0.0.1:${port}`;
}

function post(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('heartbeat records unique daily guest visits non-destructively', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const fixedNow = new Date('2026-08-06T12:00:00Z');
  const base = await start(t, db, { now: () => fixedNow });

  const r1 = await post(base, '/api/analytics/heartbeat', { guestId: 'guest-1' }).then((r) => r.json());
  assert.equal(r1.ok, true);
  assert.equal(r1.newVisit, true);
  assert.equal(r1.date, todayInToronto(fixedNow));

  const r2 = await post(base, '/api/analytics/heartbeat', { guestId: 'guest-1' }).then((r) => r.json());
  assert.equal(r2.newVisit, false);

  await post(base, '/api/analytics/heartbeat', { guestId: 'guest-2' });

  const row = db.prepare('SELECT date, guests, registered, puzzle_wins, free_wins FROM daily_analytics').get();
  assert.equal(row.date, '2026-08-06');
  assert.equal(row.guests, 2);
  assert.equal(row.registered, 0);
  assert.equal(row.puzzle_wins, 0);
  assert.equal(row.free_wins, 0);
});

test('heartbeat rolls over to a new daily row on the next day', async (t) => {
  let current = new Date('2026-08-06T23:00:00Z');
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db, { now: () => current });

  await post(base, '/api/analytics/heartbeat', { guestId: 'guest-1' });
  current = new Date('2026-08-07T12:00:00Z');
  await post(base, '/api/analytics/heartbeat', { guestId: 'guest-1' });

  const rows = db.prepare('SELECT date, guests FROM daily_analytics ORDER BY date').all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.guests), [1, 1]);
});

test('heartbeat rejects invalid payloads with 400', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db);

  for (const body of [{}, { guestId: 42 }, { guestId: 'a b' }, { guestId: '' }]) {
    const res = await post(base, '/api/analytics/heartbeat', body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  const visits = db.prepare('SELECT COUNT(*) AS n FROM daily_guest_visits').get();
  assert.equal(visits.n, 0);
});

test('recordGuestVisit upserts into daily_analytics directly', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(recordGuestVisit(db, '2026-08-06', 'g1'), true);
    assert.equal(recordGuestVisit(db, '2026-08-06', 'g1'), false);
    assert.equal(recordGuestVisit(db, '2026-08-06', 'g2'), true);
    assert.equal(recordGuestVisit(db, '2026-08-07', 'g1'), true);
    const rows = db.prepare('SELECT date, guests FROM daily_analytics ORDER BY date').all();
    assert.deepEqual(rows, [
      { date: '2026-08-06', guests: 2 },
      { date: '2026-08-07', guests: 1 },
    ]);
  } finally {
    db.close();
  }
});

test('GET /api/health responds ok', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db);
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('upsertUser inserts new user and updates existing user', () => {
  const db = openDatabase(':memory:');
  try {
    const u1 = upsertUser(db, {
      provider: 'google',
      providerId: '12345',
      name: 'Alice',
      email: 'alice@example.com',
      avatar: 'https://avatar1.png',
    });
    assert.ok(u1.id);
    assert.equal(u1.provider, 'google');
    assert.equal(u1.provider_id, '12345');
    assert.equal(u1.name, 'Alice');

    const u1Fetched = findUserById(db, u1.id);
    assert.equal(u1Fetched.name, 'Alice');

    const u1Updated = upsertUser(db, {
      provider: 'google',
      providerId: '12345',
      name: 'Alice Updated',
      email: 'alice@example.com',
      avatar: 'https://avatar2.png',
    });
    assert.equal(u1Updated.id, u1.id);
    assert.equal(u1Updated.name, 'Alice Updated');
    assert.equal(u1Updated.avatar, 'https://avatar2.png');
  } finally {
    db.close();
  }
});

test('GET /api/auth/me returns authenticated: false when unauthenticated', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db);
  const res = await fetch(`${base}/api/auth/me`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { authenticated: false });
});

test('POST /api/auth/logout responds ok when unauthenticated', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db);
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('GET /api/user/profile returns 401 when unauthenticated', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db);
  const res = await fetch(`${base}/api/user/profile`);
  assert.equal(res.status, 401);
});

test('POST /api/user/sync returns 401 when unauthenticated', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db);
  const res = await post(base, '/api/user/sync', { tokens: 5 });
  assert.equal(res.status, 401);
});

test('GET /api/user/profile returns user details and default stats for new user', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  
  const mockUser = upsertUser(db, { provider: 'test', providerId: '99', name: 'Bob' });
  const base = await start(t, db, { mockUser });
  
  const res = await fetch(`${base}/api/user/profile`).then((r) => r.json());
  assert.equal(res.id, mockUser.id);
  assert.equal(res.name, 'Bob');
  assert.deepEqual(res.stats, { tokens: 0, wins: 0, streak: 0, best_streak: 0 });
});

test('POST /api/user/sync merges stats non-destructively with Math.max', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  
  const mockUser = upsertUser(db, { provider: 'test', providerId: '100', name: 'Charlie' });
  const base = await start(t, db, { mockUser });
  
  // First sync: server is 0, client is tokens=5, wins=3, streak=2, best_streak=4
  const res1 = await post(base, '/api/user/sync', { tokens: 5, wins: 3, streak: 2, best_streak: 4 }).then((r) => r.json());
  assert.deepEqual(res1, { tokens: 5, wins: 3, streak: 2, best_streak: 4 });
  
  // Second sync: client is tokens=2 (lower), wins=4 (higher), streak=1 (lower), best_streak=3 (lower)
  const res2 = await post(base, '/api/user/sync', { tokens: 2, wins: 4, streak: 1, best_streak: 3 }).then((r) => r.json());
  assert.deepEqual(res2, { tokens: 5, wins: 4, streak: 2, best_streak: 4 });
});

test('POST /api/analytics/win updates daily wins in analytics', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const fixedNow = new Date('2026-08-08T12:00:00Z');
  const base = await start(t, db, { now: () => fixedNow });
  
  const res1 = await post(base, '/api/analytics/win', { mode: 'daily' }).then((r) => r.json());
  assert.equal(res1.ok, true);
  
  await post(base, '/api/analytics/win', { mode: 'free' });
  await post(base, '/api/analytics/win', { mode: 'daily' });
  
  const row = db.prepare('SELECT date, puzzle_wins, free_wins FROM daily_analytics').get();
  assert.equal(row.date, '2026-08-08');
  assert.equal(row.puzzle_wins, 2);
  assert.equal(row.free_wins, 1);
});

test('GET /api/admin/metrics returns 401 if token is invalid, 200 if valid', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db, { adminSecret: 'secret-token-xyz' });
  
  // Unauthorized
  const res1 = await fetch(`${base}/api/admin/metrics`);
  assert.equal(res1.status, 401);
  
  const res2 = await fetch(`${base}/api/admin/metrics?token=wrong`);
  assert.equal(res2.status, 401);
  
  // Authorized via query param
  const res3 = await fetch(`${base}/api/admin/metrics?token=secret-token-xyz`);
  assert.equal(res3.status, 200);
  const data3 = await res3.json();
  assert.ok(Array.isArray(data3));
  
  // Authorized via header
  const res4 = await fetch(`${base}/api/admin/metrics`, {
    headers: { 'x-admin-token': 'secret-token-xyz' }
  });
  assert.equal(res4.status, 200);
});

test('authenticated calls record registered player visits in daily analytics', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const fixedNow = new Date('2026-08-08T12:00:00Z');
  
  const mockUser = upsertUser(db, { provider: 'test', providerId: '101', name: 'Dave' });
  const base = await start(t, db, { mockUser, now: () => fixedNow });
  
  // Call profile to trigger registered active visit logging
  await fetch(`${base}/api/user/profile`);
  
  // Check daily analytics registered count
  const row = db.prepare('SELECT date, registered FROM daily_analytics').get();
  assert.equal(row.date, '2026-08-08');
  assert.equal(row.registered, 1);
  
  // Another call from the same user on the same day shouldn't double count
  await fetch(`${base}/api/auth/me`);
  const row2 = db.prepare('SELECT registered FROM daily_analytics').get();
  assert.equal(row2.registered, 1);
});

test('GET /auth/mock logs in a mock user and redirects', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const base = await start(t, db);
  
  const res = await fetch(`${base}/auth/mock`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  
  // Verify user was upserted in users table
  const user = db.prepare("SELECT * FROM users WHERE provider = 'mock' AND provider_id = 'dev-user'").get();
  assert.ok(user);
  assert.equal(user.name, 'Développeur Café');
});

test('GET /auth/mock is forbidden in production unless ALLOW_MOCK_AUTH is set', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  
  // Mock NODE_ENV as production
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => { process.env.NODE_ENV = originalEnv; });
  
  const base = await start(t, db);
  const res = await fetch(`${base}/auth/mock`);
  assert.equal(res.status, 403);
});


