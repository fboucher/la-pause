export const MSG_WRONG_LENGTH = 'Tapez 5 lettres.';
export const MSG_NOT_ONE_LETTER = 'Changez exactement une lettre.';

export function formatNotInDictMsg(word) {
  return `« ${word.toUpperCase()} » n'est pas dans le dictionnaire.`;
}

export function normalize(word) {
  if (!word) return '';
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function diffCount(a, b) {
  if (!a || !b) return Math.max(a ? a.length : 0, b ? b.length : 0);
  let n = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) n++;
  }
  return n + Math.abs(a.length - b.length);
}

export function changedIndex(prev, word) {
  if (!prev || !word) return -1;
  const len = Math.min(prev.length, word.length);
  for (let i = 0; i < len; i++) {
    if (prev[i] !== word[i]) return i;
  }
  return -1;
}

export function createValidation(wordSet) {
  const set = wordSet instanceof Set ? wordSet : new Set(wordSet);

  function validate(rawInput, lastWord) {
    if (!rawInput || typeof rawInput !== 'string') {
      return { ok: false, msg: MSG_WRONG_LENGTH };
    }
    const trimmed = rawInput.trim();
    if (!/^[\u00C0-\u00FFa-zA-Z]{5}$/.test(trimmed)) {
      return { ok: false, msg: MSG_WRONG_LENGTH };
    }
    const w = normalize(trimmed);
    if (!set.has(w)) {
      return { ok: false, msg: formatNotInDictMsg(w) };
    }
    if (lastWord) {
      const d = diffCount(lastWord, w);
      if (d !== 1) {
        return { ok: false, msg: MSG_NOT_ONE_LETTER };
      }
    }
    return { ok: true, word: w };
  }

  return {
    validate,
    normalize,
    changedIndex,
    diffCount
  };
}
