'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildPayload, loadWords } = require('../tools/build');

const data = require('../public/data.json');

test('data.json exposes espresso and latte daily pools of indices into words', () => {
  assert.ok(Array.isArray(data.dailyEspresso));
  assert.ok(Array.isArray(data.dailyLatte));
  assert.ok(data.dailyEspresso.length > 0);
  assert.ok(data.dailyLatte.length > 0);
  for (const i of [...data.dailyEspresso, ...data.dailyLatte]) {
    assert.ok(Number.isInteger(i) && i >= 0 && i < data.words.length);
  }
});

test('data.json no longer ships the curated daily array', () => {
  assert.ok(!('daily' in data));
});

test('every espresso index has par >= 5', () => {
  for (const i of data.dailyEspresso) {
    assert.ok(data.dist[i] >= 5, `index ${i} has dist ${data.dist[i]}`);
  }
});

test('every latte index has par between 2 and 4', () => {
  for (const i of data.dailyLatte) {
    assert.ok(data.dist[i] >= 2 && data.dist[i] <= 4, `index ${i} has dist ${data.dist[i]}`);
  }
});

test('espresso and latte pools are disjoint', () => {
  const espresso = new Set(data.dailyEspresso);
  for (const i of data.dailyLatte) {
    assert.ok(!espresso.has(i), `index ${i} is in both pools`);
  }
});

test('buildPayload reproduces the committed pools deterministically', () => {
  const words = loadWords();
  const a = buildPayload(words, '2.0.0', '2026-08-13T00:00:00.000Z');
  const b = buildPayload(words, '2.0.0', '2026-08-13T00:00:00.000Z');
  assert.deepEqual(a.words, b.words);
  assert.deepEqual(a.dist, b.dist);
  assert.deepEqual(a.dailyEspresso, b.dailyEspresso);
  assert.deepEqual(a.dailyLatte, b.dailyLatte);
  assert.deepEqual(a.dailyEspresso, data.dailyEspresso);
  assert.deepEqual(a.dailyLatte, data.dailyLatte);
});
