const $ = (sel) => document.querySelector(sel);

const TZ = 'America/Toronto';
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const STATE_KEY = 'lapause.v1';
const STATS_KEY = 'lapause.stats.v1';

let data = null;
let wordSet = new Set();
let wordIndex = new Map();
let dailyStart = null;

let mode = 'daily';
let dailyGame = { start: '', moves: [], solved: false };
let freeGame = { start: '', moves: [], solved: false };
let stats = { wins: 0, streak: 0, best: 0, played: 0, playedDate: null, lastWin: null, dist: {} };

const els = {
  tabDaily: $('#tab-daily'),
  tabFree: $('#tab-free'),
  meta: $('#puzzle-meta'),
  ladder: $('#ladder'),
  form: $('#guess-form'),
  input: $('#guess'),
  submit: $('#submit'),
  message: $('#message'),
  undo: $('#undo'),
  newGame: $('#new-game'),
  share: $('#share'),
  solved: $('#solved'),
  solvedTitle: $('#solved-title'),
  solvedText: $('#solved-text'),
  shareSolved: $('#share-solved'),
  countdown: $('#countdown'),
  statWins: $('#stat-wins'),
  statStreak: $('#stat-streak'),
  statBest: $('#stat-best'),
  statRate: $('#stat-rate'),
  distBars: $('#dist-bars'),
};

function game() {
  return mode === 'daily' ? dailyGame : freeGame;
}

/* ---------------- date helpers (America/Toronto) ---------------- */

function dateParts(ts) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = fmt.formatToParts(new Date(ts));
  const get = (t) => p.find((x) => x.type === t).value;
  return { y: +get('year'), m: +get('month'), d: +get('day') };
}

function dateStr(parts) {
  return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}

function todayStr() { return dateStr(dateParts(Date.now())); }

function puzzleNumber() {
  const p = dateParts(Date.now());
  return Math.round((Date.UTC(p.y, p.m - 1, p.d) - EPOCH_UTC) / 86400000) + 1;
}

function nextMidnight() {
  const p = dateParts(Date.now());
  return Date.UTC(p.y, p.m - 1, p.d) + 86400000;
}

function yesterdayStr() {
  const p = dateParts(Date.now());
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d) - 86400000);
  return dateStr({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function dailyIndex() {
  return fnv1a(todayStr()) % data.daily.length;
}

/* ---------------- persistence ---------------- */

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function saveState() {
  const payload = { v: 1, date: todayStr(), daily: dailyGame, free: freeGame };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(payload)); } catch {}
}

function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {}
}

function restore() {
  const saved = loadJSON(STATE_KEY);
  if (saved && saved.date === todayStr()) {
    if (saved.daily && wordSet.has(saved.daily.start)) {
      dailyGame = { start: saved.daily.start, moves: [...saved.daily.moves], solved: !!saved.daily.solved };
    } else {
      dailyGame = { start: dailyStart, moves: [], solved: false };
    }
    if (saved.free && wordSet.has(saved.free.start)) {
      freeGame = { start: saved.free.start, moves: [...saved.free.moves], solved: !!saved.free.solved };
    } else {
      newFreeGame();
    }
  } else {
    dailyGame = { start: dailyStart, moves: [], solved: false };
    newFreeGame();
  }
}

/* ---------------- game setup ---------------- */

function randomStart() {
  const words = data.words;
  let w;
  do {
    w = words[Math.floor(Math.random() * words.length)];
  } while (w === data.target);
  return w;
}

function newFreeGame() {
  freeGame = { start: randomStart(), moves: [], solved: false };
}

function parOf(word) {
  const i = wordIndex.get(word);
  return i != null ? data.dist[i] : null;
}

function steps(g) {
  return g.moves.length;
}

function isSolved() {
  return game().solved;
}

function lastWord() {
  const g = game();
  return [...g.moves][g.moves.length - 1] || g.start;
}

/* ---------------- validation ---------------- */

function normalize(word) {
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function diffCount(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function validate(raw) {
  if (!/^[\u00C0-\u00FFa-zA-Z]{5}$/.test(raw.trim())) {
    return { ok: false, msg: 'Tapez 5 lettres.' };
  }
  const w = normalize(raw.trim());
  if (!wordSet.has(w)) {
    return { ok: false, msg: `« ${w.toUpperCase()} » n'est pas dans le dictionnaire.` };
  }
  const d = diffCount(lastWord(), w);
  if (d !== 1) {
    return { ok: false, msg: 'Changez exactement une lettre.' };
  }
  return { ok: true, word: w };
}

/* ---------------- stats ---------------- */

function recordPlay() {
  if (stats.playedDate !== todayStr()) {
    stats.played += 1;
    stats.playedDate = todayStr();
  }
}

function recordWin() {
  if (stats.lastWin === todayStr()) return;
  const g = game();
  const n = steps(g);
  stats.dist[n] = (stats.dist[n] || 0) + 1;
  stats.wins += 1;
  stats.streak = stats.lastWin === yesterdayStr() ? stats.streak + 1 : 1;
  stats.best = Math.max(stats.best, stats.streak);
  stats.lastWin = todayStr();
}

/* ---------------- share ---------------- */

function shareText() {
  const g = game();
  const n = steps(g);
  const par = parOf(g.start);
  const plur = n > 1 ? 's' : '';
  if (mode === 'daily') {
    return `« La pause n°${puzzleNumber()} — ${n} coup${plur} (par ${par}) »`;
  }
  return `« La pause (illimité) — ${n} coup${plur} (par ${par}) »`;
}

async function copyShare() {
  const text = shareText();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(text);
      flashMessage('Partage copié !', 'ok');
    }
  } catch {}
}

function flashMessage(text, cls) {
  els.message.textContent = text;
  els.message.className = `message ${cls || ''}`.trim();
  window.clearTimeout(flashMessage._t);
  flashMessage._t = window.setTimeout(() => {
    els.message.textContent = '';
    els.message.className = 'message';
  }, 2400);
}

/* ---------------- rendering ---------------- */

function changedIndex(prev, word) {
  for (let i = 0; i < prev.length; i++) if (prev[i] !== word[i]) return i;
  return -1;
}

function stepHTML(g, all, word, index) {
  let letters;
  if (index > 0) {
    const ci = changedIndex(all[index - 1], word);
    letters = '';
    for (let i = 0; i < word.length; i++) {
      letters += `<span class="${i === ci ? 'changed' : ''}">${word[i]}</span>`;
    }
  } else {
    letters = word;
  }
  const note = index === 0 ? 'départ' : '';
  const cur = index === steps(g);
  return `<li class="step${cur ? ' current' : ''}"><span class="num">${index}</span><span class="word">${letters}</span>${note ? `<span class="note">${note}</span>` : ''}</li>`;
}

function renderLadder() {
  const g = game();
  const all = [g.start, ...g.moves];
  els.ladder.innerHTML = all.map((w, i) => stepHTML(g, all, w, i)).join('');
}

function renderMeta() {
  const g = game();
  const par = parOf(g.start);
  const n = steps(g);
  const label = mode === 'daily' ? `Puzzle n°${puzzleNumber()}` : 'Mode illimité';
  const done = `${n} coup${n > 1 ? 's' : ''}`;
  els.meta.innerHTML = `<span>${label}</span><span class="par">${done} · par ${par}</span>`;
}

function renderControls() {
  const locked = isSolved() && mode === 'daily';
  els.undo.disabled = steps(game()) === 0 || locked;
  els.newGame.style.display = mode === 'free' ? '' : 'none';
  els.share.style.display = isSolved() ? '' : 'none';
  els.submit.disabled = locked;
  els.input.disabled = locked;
}

function renderSolved() {
  const g = game();
  const solved = g.solved;
  els.solved.hidden = !solved;
  if (!solved) return;
  els.solvedTitle.textContent = 'Pause atteinte !';
  const n = steps(g);
  const par = parOf(g.start);
  els.solvedText.textContent = `Vous avez rejoint PAUSE en ${n} coup${n > 1 ? 's' : ''} (par ${par}).`;
  if (mode === 'daily') {
    const left = nextMidnight() - Date.now();
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    els.countdown.textContent = `Prochaine pause dans ${h} h ${m} min.`;
    els.countdown.hidden = false;
  } else {
    els.countdown.hidden = true;
  }
}

function renderStats() {
  els.statWins.textContent = stats.wins;
  els.statStreak.textContent = stats.streak;
  els.statBest.textContent = stats.best;
  const rate = stats.played > 0 ? Math.round((stats.wins / stats.played) * 100) : 0;
  els.statRate.textContent = `${rate} %`;
  renderDist();
}

function renderDist() {
  const entries = Object.entries(stats.dist).map(([k, v]) => [+k, v]).sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) {
    els.distBars.innerHTML = '<p class="empty">Aucune partie gagnée pour l\'instant.</p>';
    return;
  }
  const max = Math.max(...entries.map(([, v]) => v));
  els.distBars.innerHTML = entries
    .map(([k, v]) => `<div class="dist-row"><span class="dlabel">${k}</span><span class="bar"><span class="fill" style="width:${(v / max) * 100}%"></span></span><span class="count">${v}</span></div>`)
    .join('');
}

function renderAll() {
  renderMeta();
  renderLadder();
  renderSolved();
  renderControls();
  renderStats();
}

/* ---------------- actions ---------------- */

function commitMove(word) {
  const g = game();
  g.moves.push(word);
  if (mode === 'daily') recordPlay();
  saveState();
  renderMeta();
  renderLadder();
  renderControls();
  els.input.value = '';
  els.input.focus();
}

function handleWin() {
  game().solved = true;
  if (mode === 'daily') recordWin();
  saveState();
  saveStats();
  renderAll();
  flashMessage('PAUSE atteinte !', 'ok');
}

function submitGuess(ev) {
  ev.preventDefault();
  if (isSolved()) return;
  const res = validate(els.input.value);
  if (!res.ok) {
    els.message.textContent = res.msg;
    els.message.className = 'message error';
    els.input.classList.remove('shake');
    void els.input.offsetWidth;
    els.input.classList.add('shake');
    return;
  }
  els.message.textContent = '';
  els.message.className = 'message';
  commitMove(res.word);
  if (res.word === data.target) handleWin();
}

function undoMove() {
  const g = game();
  if (g.moves.length === 0) return;
  if (g.solved && mode === 'daily') return;
  g.moves.pop();
  g.solved = false;
  saveState();
  renderAll();
  els.input.focus();
}

function switchMode(next) {
  if (next === mode) return;
  mode = next;
  els.tabDaily.classList.toggle('is-active', mode === 'daily');
  els.tabFree.classList.toggle('is-active', mode === 'free');
  els.message.textContent = '';
  els.message.className = 'message';
  saveState();
  renderAll();
  els.input.focus();
}

function startFree() {
  newFreeGame();
  saveState();
  els.message.textContent = '';
  els.message.className = 'message';
  renderAll();
  els.input.focus();
}

/* ---------------- init ---------------- */

async function init() {
  const res = await fetch('data.json');
  data = await res.json();
  wordSet = new Set(data.words);
  wordIndex = new Map(data.words.map((w, i) => [w, i]));
  dailyStart = data.words[data.daily[dailyIndex()]];

  stats = Object.assign(stats, loadJSON(STATS_KEY) || {});
  restore();

  els.form.addEventListener('submit', submitGuess);
  els.undo.addEventListener('click', undoMove);
  els.newGame.addEventListener('click', startFree);
  els.share.addEventListener('click', copyShare);
  els.shareSolved.addEventListener('click', copyShare);
  els.tabDaily.addEventListener('click', () => switchMode('daily'));
  els.tabFree.addEventListener('click', () => switchMode('free'));
  els.input.addEventListener('keydown', () => {
    els.message.textContent = '';
    els.message.className = 'message';
  });

  renderAll();
}

init();
