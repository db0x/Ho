// Change notes (client/news/<release>.json). Only the first two places of the version count as a release
// (0.5.4 -> 0.6.0 shows notes, 0.6.0 -> 0.6.1 does not). The notes appear
// once per account: the server remembers the release an account has seen and
// tells the client in 'hello'. New accounts start at the current release -
// they have nothing to catch up on. Accounts from before know no release yet.
// Without sign-in the browser remembers it, so 'hello' says nothing.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { releaseOf, compareRelease, dueReleases } from '../shared/version.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-news-'));
const USERS = path.join(dir, 'users.json');
process.env.HO_USERS_FILE = USERS;
const { addUser, getUser, load, save } = await import('../server/userstore.js');

let errors = 0;
const check = (cond, msg) => { if (!cond) { console.error('ERROR: ' + msg); errors++; } };

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const RELEASE = releaseOf(VERSION);

// --- Releases
check(releaseOf('0.6.0') === '0.6' && releaseOf('0.6.3') === '0.6' && releaseOf('1.12.0') === '1.12',
  'releaseOf does not cut after the second place');
check(releaseOf('0.5.4') !== releaseOf('0.6.0'), '0.5.4 and 0.6.0 count as the same release');
check(compareRelease('0.10', '0.9') > 0 && compareRelease('1.0', '0.12') > 0 && compareRelease('0.6', '0.6') === 0,
  'Releases are compared as text instead of by number');

// --- What is due: everything since the last visit, newest first
{
  const all = ['0.6', '0.7', '0.8', '0.9'];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(same(dueReleases(all, '0.8', '0.6'), ['0.8', '0.7']), `Skipped 0.7: ${dueReleases(all, '0.8', '0.6')}`);
  check(same(dueReleases(all, '0.8', '0.8'), []), 'Seen release shown again');
  check(same(dueReleases(all, '0.8', null), ['0.8']), 'Never seen any: should get only the current release, not the history');
  check(same(dueReleases(['0.6', '0.8'], '0.8', '0.6'), ['0.8']), 'A release without notes is not skipped over silently');
  check(same(dueReleases(all, '0.7', '0.8'), []), 'After a downgrade nothing is due');
  check(same(dueReleases(['0.6'], '0.8', '0.7'), []), 'Notes older than the last visit are shown again');
  console.log('Due: everything since the last visit, newest first; never seen any - only the current one.');
}

// --- Notes for the running release (client/news/<release>.json), the same
// number of points in every language of the game, none of them empty
{
  const file = new URL(`../client/news/${RELEASE}.json`, import.meta.url);
  let notes = null;
  try { notes = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { check(false, `No change notes for release ${RELEASE}: ${e.message}`); }
  if (notes) {
    const langs = fs.readdirSync(new URL('../client/i18n/', import.meta.url)).map(f => f.replace('.json', ''));
    for (const l of langs) {
      check(Array.isArray(notes[l]) && notes[l].length > 0, `Change notes for ${RELEASE} lack the language ${l}`);
      check((notes[l] || []).every(x => typeof x === 'string' && x.trim()), `Change notes for ${RELEASE} (${l}) contain an empty point`);
    }
    const counts = langs.map(l => (notes[l] || []).length);
    check(new Set(counts).size === 1, `Change notes for ${RELEASE}: ${langs.map((l, i) => `${counts[i]} ${l}`).join(', ')}`);
    console.log(`Release ${RELEASE}: ${counts[0]} notes in ${langs.join(' and ')}.`);
  }
}

// --- Accounts
await addUser('fresh', 'aPassword123', { mustChange: false });
check(getUser('fresh').news === RELEASE, 'A new account should start at the current release');
await addUser('veteran', 'aPassword123', { mustChange: false });
const db = load();
delete db.users.veteran.news;            // an account from before the change notes
save(db);

// --- Over the wire
const PORT = 8711 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const start = (env) => {
  const s = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), HO_USERS_FILE: USERS, ...env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  s.stderr.on('data', d => process.stderr.write('[server] ' + d));
  return new Promise(r => s.stdout.once('data', () => r(s)));
};
const stop = s => new Promise(r => { s.once('exit', r); s.kill(); });

async function signIn(user) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user, password: 'aPassword123' })
  });
  return r.headers.get('set-cookie')?.split(';')[0] || null;
}

/** Opens a socket, optionally sends something after hello, returns hello. */
const hello = (cookie, after) => new Promise((ok, fail) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: cookie ? { cookie } : {} });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t !== 'hello') return;
    if (after) ws.send(JSON.stringify(after));
    setTimeout(() => { ws.close(); ok(m); }, after ? 300 : 0);
  });
  ws.on('error', fail);
  setTimeout(() => fail(new Error('no hello')), 4000);
});

{
  const server = await start({ HO_AUTH: '1' });
  try {
    const vet = await signIn('veteran');
    const first = await hello(vet, { t: 'newsSeen' });
    check(first.version === VERSION, `hello names version ${first.version} instead of ${VERSION}`);
    check(first.newsSeen === null, `An old account should not have seen any notes yet (${first.newsSeen})`);
    check(Array.isArray(first.releases) && first.releases.includes(RELEASE)
      && first.releases.every(r => compareRelease(r, RELEASE) <= 0),
      `hello should name the releases with notes up to ${RELEASE} (${first.releases})`);
    const again = await hello(vet);
    check(again.newsSeen === RELEASE, `After 'newsSeen' the account should be at ${RELEASE} (${again.newsSeen})`);
    check(getUser('veteran').news === RELEASE, 'The release seen did not reach the account file');
    const fresh = await hello(await signIn('fresh'));
    check(fresh.newsSeen === RELEASE, 'A new account is shown the notes of the release it started at');
    console.log('Accounts: an old one sees the notes once, a new one not at all.');
  } finally { await stop(server); }
}
{
  const server = await start({ HO_AUTH: 'off' });
  try {
    const open = await hello(null, { t: 'newsSeen' });
    check(open.version === VERSION && !('newsSeen' in open), 'Without sign-in hello should leave it to the browser');
    console.log('Without sign-in: hello names the version, the browser remembers what was seen.');
  } finally { await stop(server); }
}

fs.rmSync(dir, { recursive: true, force: true });
if (errors) { console.error(`${errors} error(s)`); process.exit(1); }
console.log('All change-note checks passed.');
