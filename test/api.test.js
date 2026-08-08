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

