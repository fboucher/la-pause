#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'lexicon.json');
const OUT = path.join(__dirname, '..', 'public', 'data.json');
const TARGET = 'pause';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

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

function main() {
  const words = loadWords();
  const graph = buildGraph(words);
  const dist = bfs(graph, TARGET);

  const connected = [...dist.keys()].sort();
  const distList = connected.map((w) => dist.get(w));
  const daily = connected
    .map((w, i) => ({ i, d: dist.get(w) }))
    .filter((x) => x.d >= 4 && x.d <= 8)
    .map((x) => x.i);

  const hist = {};
  for (const d of dist.values()) hist[d] = (hist[d] || 0) + 1;

  const payload = {
    version: 1,
    target: TARGET,
    generatedAt: new Date().toISOString(),
    stats: {
      total: words.size,
      connected: connected.length,
      dailyPool: daily.length,
      distribution: hist,
    },
    words: connected,
    dist: distList,
    daily,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  console.log(`wrote ${OUT}`);
  console.log(`  ${connected.length}/${words.size} words connected to "${TARGET}"`);
  console.log(`  daily pool (par 4-8): ${daily.length}`);
}

main();
