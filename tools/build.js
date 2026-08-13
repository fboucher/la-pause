#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'lexicon.json');
const OUT = path.join(__dirname, '..', 'public', 'data.json');
const TARGET = 'pause';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const LATTE_MIN_PAR = 2;
const LATTE_MAX_PAR = 4;
const ESPRESSO_MIN_PAR = 5;

function normalize(word) {
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function loadWords() {
  const entries = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const words = new Set();
  for (const raw of entries) {
    const w = normalize(String(raw));
    if (w.length === 5 && /^[a-z]{5}$/.test(w)) words.add(w);
  }
  return words;
}

function buildGraph(words) {
  const graph = new Map();
  for (const w of words) {
    const nbs = [];
    for (let i = 0; i < w.length; i++) {
      for (const c of ALPHABET) {
        if (c === w[i]) continue;
        const n = w.slice(0, i) + c + w.slice(i + 1);
        if (words.has(n)) nbs.push(n);
      }
    }
    graph.set(w, nbs);
  }
  return graph;
}

function bfs(graph, target) {
  const dist = new Map([[target, 0]]);
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const w = queue[head];
    for (const n of graph.get(w)) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(w) + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

function buildPayload(words, appVersion = '1.0.0', generatedAt = new Date().toISOString()) {
  const graph = buildGraph(words);
  const dist = bfs(graph, TARGET);

  const connected = [...dist.keys()].sort();
  const distList = connected.map((w) => dist.get(w));
  const dailyEspresso = connected
    .map((w, i) => ({ i, d: dist.get(w) }))
    .filter((x) => x.d >= ESPRESSO_MIN_PAR)
    .map((x) => x.i);
  const dailyLatte = connected
    .map((w, i) => ({ i, d: dist.get(w) }))
    .filter((x) => x.d >= LATTE_MIN_PAR && x.d <= LATTE_MAX_PAR)
    .map((x) => x.i);

  const hist = {};
  for (const d of dist.values()) hist[d] = (hist[d] || 0) + 1;

  const payload = {
    version: 2,
    appVersion,
    target: TARGET,
    generatedAt,
    stats: {
      total: words.size,
      connected: connected.length,
      espressoPool: dailyEspresso.length,
      lattePool: dailyLatte.length,
      distribution: hist,
    },
    words: connected,
    dist: distList,
    dailyEspresso,
    dailyLatte,
  };
  return payload;
}

function currentVersion() {
  let appVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (pkg.version) appVersion = pkg.version;
  } catch (err) {
    // fallback
  }
  return appVersion;
}

function main() {
  const words = loadWords();
  const payload = buildPayload(words, currentVersion());

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  console.log(`wrote ${OUT}`);
  console.log(`  ${payload.stats.connected}/${words.size} words connected to "${TARGET}"`);
  console.log(`  espresso pool (par >= ${ESPRESSO_MIN_PAR}): ${payload.stats.espressoPool}`);
  console.log(`  latte pool (par ${LATTE_MIN_PAR}-${LATTE_MAX_PAR}): ${payload.stats.lattePool}`);
}

if (require.main === module) {
  main();
}

module.exports = { buildPayload, loadWords, normalize };
