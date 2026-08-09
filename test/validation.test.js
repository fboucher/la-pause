import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createValidation,
  normalize,
  changedIndex,
  diffCount,
  MSG_WRONG_LENGTH,
  MSG_NOT_ONE_LETTER,
  formatNotInDictMsg
} from '../public/validation.js';

test('normalize converts to lowercase and strips accents', () => {
  assert.equal(normalize('ÉLÈVE'), 'eleve');
  assert.equal(normalize('PAUSÉ'), 'pause');
  assert.equal(normalize('café'), 'cafe');
  assert.equal(normalize(''), '');
});

test('changedIndex returns first differing position or -1 when identical', () => {
  assert.equal(changedIndex('pause', 'cause'), 0);
  assert.equal(changedIndex('pause', 'piste'), 1);
  assert.equal(changedIndex('pause', 'pause'), -1);
  assert.equal(changedIndex('eleve', 'eleve'), -1);
});

test('diffCount calculates number of differing characters', () => {
  assert.equal(diffCount('pause', 'cause'), 1);
  assert.equal(diffCount('pause', 'piste'), 3);
  assert.equal(diffCount('pause', 'pause'), 0);
});

test('validate allows valid plain move', () => {
  const lexicon = new Set(['tartes', 'portes', 'porte', 'postes', 'pause', 'cause']);
  const validator = createValidation(lexicon);

  const res = validator.validate('cause', 'pause');
  assert.deepEqual(res, { ok: true, word: 'cause' });
});

test('validate normalizes valid accented input before checking dictionary', () => {
  const lexicon = new Set(['pause', 'causé', 'cause']);
  const validator = createValidation(lexicon);

  const res = validator.validate('CAUSÉ', 'pause');
  assert.deepEqual(res, { ok: true, word: 'cause' });
});

test('validate rejects wrong length input with byte-identical message', () => {
  const lexicon = new Set(['pause']);
  const validator = createValidation(lexicon);

  assert.deepEqual(validator.validate('pau', 'pause'), { ok: false, msg: MSG_WRONG_LENGTH });
  assert.deepEqual(validator.validate('pauses', 'pause'), { ok: false, msg: MSG_WRONG_LENGTH });
  assert.equal(validator.validate('pau', 'pause').msg, 'Tapez 5 lettres.');
});

test('validate rejects word not in dictionary with formatted message', () => {
  const lexicon = new Set(['pause']);
  const validator = createValidation(lexicon);

  const res = validator.validate('zzzzz', 'pause');
  assert.deepEqual(res, { ok: false, msg: "« ZZZZZ » n'est pas dans le dictionnaire." });
  assert.equal(res.msg, formatNotInDictMsg('zzzzz'));
});

test('validate rejects moves changing more than one letter', () => {
  const lexicon = new Set(['pause', 'porte']);
  const validator = createValidation(lexicon);

  const res = validator.validate('porte', 'pause');
  assert.deepEqual(res, { ok: false, msg: MSG_NOT_ONE_LETTER });
  assert.equal(res.msg, 'Changez exactement une lettre.');
});

test('validate supports fallback to start word when moves array is empty', () => {
  const lexicon = new Set(['porte', 'porte', 'poste', 'pause', 'piste']);
  const validator = createValidation(lexicon);

  const moves = [];
  const startWord = 'porte';
  const currentLastWord = moves[moves.length - 1] || startWord;

  assert.equal(currentLastWord, 'porte');
  const res = validator.validate('poste', currentLastWord);
  assert.deepEqual(res, { ok: true, word: 'poste' });
});
