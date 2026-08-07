const $ = (sel) => document.querySelector(sel);

// Theme handling
function getInitialTheme() {
  const saved = localStorage.getItem('lapause.theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lapause.theme', theme);
  const metaTheme = $('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#1C130E' : '#F7F1E4');
  }
}

setTheme(getInitialTheme());

const TZ = 'America/Toronto';
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const STATE_KEY = 'lapause.v1';
const STATS_KEY = 'lapause.stats.v1';
const TOKENS_KEY = 'lapause.tokens.v1';

const isDev = new URLSearchParams(window.location.search).get('dev') === '1';
let devShared = false;

let data = null;
let wordSet = new Set();
let wordIndex = new Map();
let dailyStart = null;

let mode = 'daily';
let dailyGame = { start: '', moves: [], solved: false, hintsUsed: 0, tokenAwarded: false };
let freeGame = { start: '', moves: [], solved: false, hintsUsed: 0, tokenAwarded: false, freeHintUsed: false };
let tokens = 0;
let stats = { wins: 0, streak: 0, best: 0, played: 0, playedDate: null, lastWin: null, dist: {} };

const els = {
  tabDaily: $('#tab-daily'),
  tabFree: $('#tab-free'),
  meta: $('#puzzle-meta'),
  ladder: $('#ladder'),
  form: $('#guess-form'),
  input: $('#guess'),
  inputRow: $('#input-row'),
  slots: [],
  submit: $('#submit'),
  footerVersion: $('#footer-version'),
  devBadge: $('#dev-badge'),
  message: $('#message'),
  undo: $('#undo'),
  hintPosition: $('#hint-position'),
  hintWord: $('#hint-word'),
  tokenCount: $('#token-count'),
  newGame: $('#new-game'),
  share: $('#share'),
  solved: $('#solved'),
  solvedTitle: $('#solved-title'),
  solvedStars: $('#solved-stars'),
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

function saveTokens() {
  try { localStorage.setItem(TOKENS_KEY, tokens); } catch {}
}

function restore() {
  const saved = loadJSON(STATE_KEY);
  if (saved && saved.date === todayStr()) {
    if (saved.daily && wordSet.has(saved.daily.start)) {
      dailyGame = {
        start: saved.daily.start,
        moves: [...saved.daily.moves],
        solved: !!saved.daily.solved,
        hintsUsed: saved.daily.hintsUsed !== undefined ? saved.daily.hintsUsed : (saved.daily.hintUsed ? 1 : 0),
        tokenAwarded: !!saved.daily.tokenAwarded
      };
    } else {
      dailyGame = { start: dailyStart, moves: [], solved: false, hintsUsed: 0, tokenAwarded: false };
    }
    if (saved.free && wordSet.has(saved.free.start)) {
      freeGame = {
        start: saved.free.start,
        moves: [...saved.free.moves],
        solved: !!saved.free.solved,
        hintsUsed: saved.free.hintsUsed !== undefined ? saved.free.hintsUsed : (saved.free.hintUsed ? 1 : 0),
        tokenAwarded: !!saved.free.tokenAwarded,
        freeHintUsed: !!saved.free.freeHintUsed
      };
    } else {
      newFreeGame();
    }
  } else {
    dailyGame = { start: dailyStart, moves: [], solved: false, hintsUsed: 0, tokenAwarded: false };
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
  freeGame = { start: randomStart(), moves: [], solved: false, hintsUsed: 0, tokenAwarded: false, freeHintUsed: false };
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

function checkStreakStaleness() {
  if (stats.lastWin && stats.lastWin !== todayStr() && stats.lastWin !== yesterdayStr()) {
    stats.streak = 0;
    saveStats();
  }
}

function recordPlay() {
  if (stats.playedDate !== todayStr()) {
    stats.played += 1;
    stats.playedDate = todayStr();
  }
}

function recordWin() {
  if (mode !== 'daily') return;
  if (stats.lastWin === todayStr()) return;
  const g = game();
  const n = steps(g);
  stats.dist[n] = (stats.dist[n] || 0) + 1;
  stats.wins += 1;
  stats.streak = stats.lastWin === yesterdayStr() ? stats.streak + 1 : 1;
  stats.best = Math.max(stats.best, stats.streak);
  stats.lastWin = todayStr();
  saveStats();
}

/* ---------------- share ---------------- */

function starRating(hintsUsed) {
  if (hintsUsed === 0) return '★★★';
  if (hintsUsed === 1) return '★★';
  return '★';
}

function shareText() {
  const g = game();
  const n = steps(g);
  const par = parOf(g.start);
  const plur = n > 1 ? 's' : '';
  const stars = starRating(g.hintsUsed || 0);
  if (mode === 'daily') {
    return `${stars} La pause n°${puzzleNumber()} — rejoint PAUSE en ${n} coup${plur} (par ${par})\nc5m.ca/pause`;
  }
  return `${stars} La pause (illimité) — rejoint PAUSE en ${n} coup${plur} (par ${par})\nc5m.ca/pause`;
}

function generateShareImage(words) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const cellW = 40;
  const cellH = 46;
  const gap = 6;
  const padding = 24;
  const headerH = 95;
  const footerH = 34;
  const stepsCount = words.length;
  
  const contentW = 5 * cellW + 4 * gap;
  const contentH = stepsCount * cellH + (stepsCount - 1) * gap;
  
  canvas.width = contentW + 2 * padding;
  canvas.height = contentH + 2 * padding + headerH + footerH;
  
  // Background
  ctx.fillStyle = '#F7F1E4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw Header
  const g = game();
  const n = steps(g);
  const par = parOf(g.start);
  const plur = n > 1 ? 's' : '';
  const label = mode === 'daily' ? `La pause n°${puzzleNumber()}` : 'La pause (illimité)';
  const scoreText = `rejoint PAUSE en ${n} coup${plur} (par ${par})`;

  ctx.textAlign = 'center';

  // 1. Draw Title
  ctx.fillStyle = '#33241B';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(label, canvas.width / 2, padding + 18);

  // 2. Draw Stars
  const starsCount = g.hintsUsed === 0 ? 3 : (g.hintsUsed === 1 ? 2 : 1);
  let starsStr = '';
  for (let i = 1; i <= 3; i++) {
    starsStr += i <= starsCount ? '★' : '☆';
  }
  ctx.fillStyle = '#FFC107';
  ctx.font = '22px sans-serif';
  ctx.fillText(starsStr, canvas.width / 2, padding + 48);

  // 3. Draw Subtitle / Score
  ctx.fillStyle = '#9B8A78';
  ctx.font = '500 12px sans-serif';
  ctx.fillText(scoreText, canvas.width / 2, padding + 70);
  
  // Draw Grid
  for (let r = 0; r < stepsCount; r++) {
    const word = words[r];
    const y = padding + headerH + r * (cellH + gap);
    
    for (let c = 0; c < 5; c++) {
      const x = padding + c * (cellW + gap);
      const radius = 8;
      
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, cellW, cellH, radius);
      } else {
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + cellW, y, x + cellW, y + cellH, radius);
        ctx.arcTo(x + cellW, y + cellH, x, y + cellH, radius);
        ctx.arcTo(x, y + cellH, x, y, radius);
        ctx.arcTo(x, y, x + cellW, y, radius);
      }
      ctx.closePath();
      
      const isCorrect = r > 0 && word[c] === data.target[c];
      
      if (isCorrect) {
        ctx.fillStyle = isDev ? '#B3402A' : '#6F4E37';
        ctx.fill();
      } else {
        ctx.fillStyle = '#FDFAF2';
        ctx.fill();
        ctx.strokeStyle = '#E7DCC8';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // Draw Footer Short URL
  const footerY = padding + headerH + contentH + 22;
  ctx.fillStyle = '#9B8A78';
  ctx.font = '600 13px sans-serif';
  ctx.fillText('c5m.ca/pause', canvas.width / 2, footerY);
  
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

function downloadImage(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyShare() {
  if (isDev) {
    devShared = true;
    renderLadder();
  }
  const text = shareText();
  const g = game();
  const allWords = [g.start, ...g.moves];

  try {
    const blob = await generateShareImage(allWords);
    const file = new File([blob], 'la-pause.png', { type: 'image/png' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({
        text,
        files: [file]
      });
    } else if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        flashMessage('Image copiée dans le presse-papiers !', 'ok');
      } catch (err) {
        downloadImage(blob, 'la-pause.png');
        flashMessage('Téléchargement de l\'image...', 'ok');
      }
    } else {
      downloadImage(blob, 'la-pause.png');
      flashMessage('Téléchargement de l\'image...', 'ok');
    }
  } catch (err) {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        flashMessage('Partage copié !', 'ok');
      }
    } catch {}
  }
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
  const ci = index > 0 ? changedIndex(all[index - 1], word) : -1;
  let letters = '';
  for (let i = 0; i < word.length; i++) {
    const cls = ['letter'];
    if (isDev && devShared) {
      cls.push('dev-red');
    } else {
      if (i === ci) cls.push('changed');
      if (index > 0 && word[i] === data.target[i]) cls.push('correct');
    }
    letters += `<span class="${cls.join(' ')}">${word[i]}</span>`;
  }
  const note = index === 0 ? 'départ' : '';
  const cur = index === steps(g);
  return `<li class="step${cur ? ' current' : ''}"><a href="https://www.larousse.fr/dictionnaires/francais/${word}" target="_blank" rel="noopener noreferrer" class="num" title="See word definition">${index}</a><span class="word">${letters}</span><span class="note">${note}</span></li>`;
}

function buildSlots() {
  els.slots = [];
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    s.className = 'slot';
    s.setAttribute('aria-hidden', 'true');
    els.inputRow.insertBefore(s, els.input);
    els.slots.push(s);
  }
}

function renderInput() {
  const val = normalize(els.input.value);
  els.slots.forEach((s, i) => {
    const ch = val[i] || '';
    s.textContent = ch;
    s.classList.toggle('filled', !!ch);
    s.classList.toggle('correct', !!ch && ch === data.target[i]);
  });
}

function renderLadder() {
  const g = game();
  const all = [g.start, ...g.moves];
  els.ladder.innerHTML = all.map((w, i) => stepHTML(g, all, w, i)).join('');
}

function renderMeta() {
  const g = game();
  const label = mode === 'daily' ? `Puzzle n°${puzzleNumber()}` : 'Mode illimité';
  const par = parOf(g.start);
  if (!g.solved) {
    els.meta.innerHTML = `<span>${label}</span><span class="par">par ${par}</span>`;
    return;
  }
  const n = steps(g);
  els.meta.innerHTML = `<span>${label}</span><span class="par">${n} coup${n > 1 ? 's' : ''} · par ${par}</span>`;
}

function renderControls() {
  const solved = isSolved();
  const locked = solved && mode === 'daily';
  els.undo.disabled = steps(game()) === 0 || locked;
  els.newGame.style.display = mode === 'free' ? '' : 'none';
  els.share.style.display = solved ? '' : 'none';
  els.submit.disabled = solved;
  els.input.disabled = solved;
  els.inputRow.hidden = solved;
  els.submit.hidden = solved;

  if (isDev) {
    els.hintPosition.style.display = '';
    els.hintPosition.disabled = solved;
    els.hintPosition.title = solved ? "Partie terminée !" : "Révèle quelle lettre changer (Gratuit en dev)";

    els.hintWord.style.display = '';
    els.hintWord.disabled = solved;
    els.hintWord.title = solved ? "Partie terminée !" : "Joue automatiquement le mot suivant (Gratuit en dev)";
  } else {
    const hasFreeHint = mode === 'free' && !freeGame.freeHintUsed;
    els.hintPosition.style.display = '';
    els.hintPosition.disabled = solved || (tokens < 1 && !hasFreeHint);
    els.hintPosition.title = solved
      ? "Partie terminée !"
      : (hasFreeHint ? "1 conseil gratuit ! Révèle quelle lettre changer" : (tokens < 1 ? "Coûte 1 🪙 (Solde insuffisant)" : "Révèle quelle lettre changer (coûte 1 🪙)"));
    const positionPrice = $('#hint-position-price');
    if (positionPrice) positionPrice.textContent = hasFreeHint ? '(1 gratuit 🎁)' : '(1 🪙)';

    els.hintWord.style.display = '';
    els.hintWord.disabled = solved || tokens < 2;
    els.hintWord.title = solved ? "Partie terminée !" : (tokens < 2 ? "Coûte 2 🪙 (Solde insuffisant)" : "Joue automatiquement le mot suivant (coûte 2 🪙)");
  }
}

function renderSolved() {
  const g = game();
  const solved = g.solved;
  els.solved.hidden = !solved;
  if (!solved) return;
  els.solvedTitle.textContent = 'Pause atteinte !';

  const starsCount = g.hintsUsed === 0 ? 3 : (g.hintsUsed === 1 ? 2 : 1);
  let starsHTML = '';
  for (let i = 1; i <= 3; i++) {
    if (i <= starsCount) {
      starsHTML += '<span class="star">★</span>';
    } else {
      starsHTML += '<span class="star empty">★</span>';
    }
  }
  els.solvedStars.innerHTML = starsHTML;

  const n = steps(g);
  const par = parOf(g.start);
  if (mode === 'daily') {
    const streakSuffix = stats.streak > 0 ? ` 🔥 Série : ${stats.streak} jour${stats.streak > 1 ? 's' : ''}.` : '';
    els.solvedText.textContent = `Vous avez rejoint PAUSE en ${n} coup${n > 1 ? 's' : ''} (par ${par}).${streakSuffix}`;
    const left = nextMidnight() - Date.now();
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    els.countdown.textContent = `Prochaine pause dans ${h} h ${m} min.`;
    els.countdown.hidden = false;
  } else {
    els.solvedText.textContent = `Vous avez rejoint PAUSE en ${n} coup${n > 1 ? 's' : ''} (par ${par}).`;
    els.countdown.hidden = true;
  }
}

function renderStats() {
  checkStreakStaleness();
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

function renderTokens() {
  if (els.tokenCount) {
    els.tokenCount.textContent = tokens;
  }
}

function renderAll() {
  renderMeta();
  renderLadder();
  renderInput();
  renderSolved();
  renderControls();
  renderStats();
  renderTokens();
}

/* ---------------- actions ---------------- */

function commitMove(word) {
  devShared = false;
  const g = game();
  g.moves.push(word);
  if (mode === 'daily') recordPlay();
  saveState();
  renderMeta();
  renderLadder();
  renderControls();
  els.input.value = '';
  renderInput();
  els.input.focus();
}

function handleWin() {
  const g = game();
  g.solved = true;
  if (g.hintsUsed === 0 && !g.tokenAwarded) {
    tokens += 1;
    g.tokenAwarded = true;
    saveTokens();
  }
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
    els.inputRow.classList.remove('shake');
    void els.inputRow.offsetWidth;
    els.inputRow.classList.add('shake');
    return;
  }
  els.message.textContent = '';
  els.message.className = 'message';
  commitMove(res.word);
  if (res.word === data.target) handleWin();
}

function undoMove() {
  devShared = false;
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
  devShared = false;
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
  devShared = false;
  newFreeGame();
  saveState();
  els.message.textContent = '';
  els.message.className = 'message';
  renderAll();
  els.input.focus();
}

function hintWord() {
  const w = lastWord();
  const d = parOf(w);
  for (let i = 0; i < w.length; i++) {
    for (let c = 97; c < 123; c++) {
      const ch = String.fromCharCode(c);
      if (ch === w[i]) continue;
      const cand = w.slice(0, i) + ch + w.slice(i + 1);
      if (wordSet.has(cand) && parOf(cand) === d - 1) return cand;
    }
  }
  return null;
}

function hintPosition() {
  const w = lastWord();
  const word = hintWord();
  if (!word) return null;
  for (let i = 0; i < w.length; i++) {
    if (w[i] !== word[i]) return i + 1;
  }
  return null;
}

function usePositionHint() {
  if (isSolved()) return;
  let usingFreeHint = false;
  if (!isDev) {
    if (mode === 'free' && !freeGame.freeHintUsed) {
      usingFreeHint = true;
    } else if (tokens < 1) {
      flashMessage('Jetons insuffisants.', 'error');
      return;
    } else {
      tokens -= 1;
      saveTokens();
    }
  }
  const pos = hintPosition();
  if (pos == null) {
    flashMessage('Aucun conseil disponible ici.', 'error');
    if (!isDev && !usingFreeHint) {
      tokens += 1;
      saveTokens();
    }
    return;
  }
  if (!isDev) {
    game().hintsUsed = (game().hintsUsed || 0) + 1;
    if (usingFreeHint) {
      game().freeHintUsed = true;
    }
  }
  saveState();
  renderAll();
  if (isDev) {
    const word = hintWord();
    flashMessage(`Conseil dev : changez la lettre n°${pos} pour ${word.toUpperCase()}.`, 'ok');
  } else if (usingFreeHint) {
    flashMessage(`Conseil gratuit : changez la lettre n°${pos}.`, 'ok');
  } else {
    flashMessage(`Conseil : changez la lettre n°${pos}.`, 'ok');
  }
}

function useNextWordHint() {
  if (isSolved()) return;
  if (!isDev) {
    if (tokens < 2) {
      flashMessage('Jetons insuffisants.', 'error');
      return;
    }
    tokens -= 2;
    saveTokens();
  }
  const word = hintWord();
  if (word == null) {
    flashMessage('Aucun conseil disponible ici.', 'error');
    if (!isDev) {
      tokens += 2;
      saveTokens();
    }
    return;
  }
  if (!isDev) {
    game().hintsUsed = (game().hintsUsed || 0) + 1;
  }
  saveState();
  commitMove(word);
  if (word === data.target) {
    handleWin();
  } else {
    renderAll();
  }
  flashMessage(`Mot ${word.toUpperCase()} joué automatiquement.`, 'ok');
}

/* ---------------- init ---------------- */

async function init() {
  const res = await fetch(`data.json?v=${Date.now()}`);
  data = await res.json();
  wordSet = new Set(data.words);
  wordIndex = new Map(data.words.map((w, i) => [w, i]));
  dailyStart = data.words[data.daily[dailyIndex()]];

  if (data.appVersion) {
    els.footerVersion.textContent = `v${data.appVersion}`;
  }

  if (isDev) {
    els.devBadge.hidden = false;
  }

  stats = Object.assign(stats, loadJSON(STATS_KEY) || {});
  checkStreakStaleness();
  tokens = parseInt(localStorage.getItem(TOKENS_KEY)) || 0;
  restore();

  els.form.addEventListener('submit', submitGuess);
  els.undo.addEventListener('click', undoMove);
  els.hintPosition.addEventListener('click', usePositionHint);
  els.hintWord.addEventListener('click', useNextWordHint);
  els.newGame.addEventListener('click', startFree);
  els.share.addEventListener('click', copyShare);
  els.shareSolved.addEventListener('click', copyShare);
  els.tabDaily.addEventListener('click', () => switchMode('daily'));
  els.tabFree.addEventListener('click', () => switchMode('free'));
  $('#theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
  els.input.addEventListener('input', () => {
    renderInput();
    els.message.textContent = '';
    els.message.className = 'message';
  });

  buildSlots();
  renderAll();
}

init();
