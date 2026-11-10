// Research presets (shared/presets.js): cleaned up the same way on both
// sides, at most eight, at most one applied at the start of a game. With an
// account they are stored with it and every device of the account gets the
// new list; without one the server does not touch them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-presets-'));
process.env.HO_USERS_FILE = path.join(dir, 'users.json');
const { addUser, getUser } = await import('../server/userstore.js');
const { accountHandlers } = await import('../server/hub/account.js');
const { conns } = await import('../server/hub/connections.js');
const { cleanPresets, cleanPreset, presetMatches, PRESET_MAX } = await import('../shared/presets.js');
const { TECH_FIELDS } = await import('../shared/rules.js');

let errors = 0;
const check = (cond, msg) => { if (!cond) { console.error('ERROR: ' + msg); errors++; } return cond; };

// 1) Cleaning: names, ranges, steps, the one start preset, the limit.
{
  const p = cleanPreset({ name: '  <b>War</b>  plan ', budgetPct: 47, weights: { range: 14, speed: -3, weapons: 2.6, bogus: 9 }, auto: 1 });
  check(p.name === 'bWar/b plan', `The name is not cleaned: ${p.name}`);
  check(p.budgetPct === 45, `The share is not rounded to a step of 5: ${p.budgetPct}`);
  check(p.weights.range === 10 && p.weights.speed === 0 && p.weights.weapons === 3 && !('bogus' in p.weights)
    && TECH_FIELDS.every(f => Number.isInteger(p.weights[f])), 'The weights are not clamped to 0-10 for every field');
  check(p.auto === true && /^[a-z0-9]+$/.test(p.id), 'Start flag or id missing');
  check(cleanPreset({ name: '   ' }) === null && cleanPreset(null) === null, 'A preset without a name is kept');
  const many = cleanPresets(Array.from({ length: 12 }, (_, i) => ({ name: 'P' + i, auto: true })));
  check(many.length === PRESET_MAX, `More than ${PRESET_MAX} presets kept: ${many.length}`);
  check(many.filter(x => x.auto).length === 1 && many[0].auto, 'Not exactly one start preset (the first)');
  check(cleanPresets([{ id: 'abc', name: 'A' }, { id: 'abc', name: 'B' }]).length === 1, 'Two presets with the same id');
  check(cleanPresets('nonsense').length === 0, 'Something that is no list is not refused');
  const research = { budgetPct: 45, weights: { ...p.weights } };
  check(presetMatches(p, research) && !presetMatches(p, { ...research, budgetPct: 50 }), 'Matching against the settings is off');
}

// 2) Stored with the account, every device of it gets the list.
{
  await addUser('alice', 'aLongPassword1', { mustChange: false });
  const got = { a: [], b: [], other: [] };
  const ws = (k) => ({ readyState: 1, send: raw => got[k].push(JSON.parse(raw)) });
  const devA = { accountKey: 'alice', ws: ws('a') }, devB = { accountKey: 'alice', ws: ws('b') };
  conns.set('1', devA); conns.set('2', devB); conns.set('3', { accountKey: 'bob', ws: ws('other') });
  accountHandlers.presets({ c: devA, ws: devA.ws }, { presets: [{ name: 'Rush', budgetPct: 30, weights: { speed: 8 }, auto: true }] });
  const stored = getUser('alice').presets;
  check(stored?.length === 1 && stored[0].name === 'Rush' && stored[0].weights.speed === 8, 'Not stored with the account');
  check(got.a.at(-1)?.t === 'presets' && got.b.at(-1)?.presets?.[0]?.name === 'Rush', 'Not every device of the account got the list');
  check(!got.other.length, 'Another account got the list');
  accountHandlers.presets({ c: devB, ws: devB.ws }, { presets: [] });
  check(!('presets' in getUser('alice')), 'An empty list leaves an entry behind');
  // Without an account the server keeps nothing.
  const guest = { accountKey: null, ws: ws('other') };
  accountHandlers.presets({ c: guest, ws: guest.ws }, { presets: [{ name: 'X' }] });
  check(!got.other.length, 'A guest got an answer');
}

fs.rmSync(dir, { recursive: true, force: true });
if (errors) { console.log(`\n${errors} preset checks failed.`); process.exit(1); }
console.log('All preset checks passed.');
