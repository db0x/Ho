// Friends: find by handle, request, accept, status and messages - over a
// real server with real accounts. What is checked above all: a stranger only
// ever learns the handle, the name and the image, never the sign-in name -
// and the server never gets to see the text of a message (end-to-end, with
// the browser's own client/js/e2e.js, here on Node's WebCrypto). One key per
// account, kept on the server wrapped with the password: every sign-in, on
// any device, opens the same one.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A separate account file so no real data gets touched.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-friends-'));
const USERS = path.join(dir, 'users.json');
process.env.HO_USERS_FILE = USERS;
const { addUser, getUser } = await import('../server/userstore.js');
const { setupKey, unwrapKey, rewrapKey, encrypt, decrypt, safetyCode } = await import('../client/js/e2e.js');

let errors = 0;
const check = (cond, msg) => { if (!cond) { console.error('ERROR: ' + msg); errors++; } return cond; };

const PW = 'friendlyPassword1';
for (const name of ['alice', 'bob', 'carol']) await addUser(name, PW, { mustChange: false });
const handle = name => getUser(name).handle;

// Left over from before: one message past the 14 days, one within. The server
// has to drop the old one at boot, unread or not.
const DAY = 24 * 3600 * 1000;
const oldEnv = { v: 2, a: 'B' + 'A'.repeat(86) + '=', b: 'B' + 'B'.repeat(86) + '=', iv: 'AAAA', ct: 'AAAA' };
fs.writeFileSync(path.join(dir, 'friends.json'), JSON.stringify({ version: 3, links: [], read: {},
  messages: { 'alice|carol': [{ from: 'alice', env: oldEnv, at: Date.now() - 15 * DAY }, { from: 'alice', env: oldEnv, at: Date.now() - 13 * DAY }] } }));

const PORT = 8711 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HO_USERS_FILE: USERS, HO_AUTH: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));
await new Promise(r => server.stdout.once('data', r));
{
  // The first line comes before the boot work is done - wait until it is.
  let out = '';
  await new Promise(r => server.stdout.on('data', d => { out += d; if (/Access:/.test(out)) r(); }));
  const left = JSON.parse(fs.readFileSync(path.join(dir, 'friends.json'), 'utf8')).messages['alice|carol'] || [];
  check(left.length === 1 && Date.now() - left[0].at < 14 * DAY, 'Messages older than 14 days survive the boot');
}

/** POST/GET to /api/auth/* with a session cookie. */
async function api(route, cookie, data) {
  const r = await fetch(`${BASE}/api/auth/${route}`, {
    method: data ? 'POST' : 'GET',
    headers: { cookie, ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined
  });
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], ...(await r.json()) };
}

/**
 * Signs in like the sign-in page: opens the account's key with the password
 * (or makes the first one), then opens the WebSocket. Every call is a device
 * of its own - nothing is kept between two of them.
 */
async function connect(name, password = PW) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: name, password })
  });
  const login = await r.json();
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const key = await setupKey(login.handle, password, login.e2e,
    async e2e => (await api('key', cookie, { password, e2e })).e2e);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
  const inbox = [];
  const waiters = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'friends') c.view = m;
    inbox.push(m);
    for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m); }
  });
  const c = {
    ws, inbox, key, cookie, view: null,
    send: m => ws.send(JSON.stringify(m)),
    /** The next message of this type (and condition) - also one that already came. */
    next(t, cond = () => true, ms = 3000) {
      const test = m => m.t === t && cond(m);
      const i = inbox.findIndex(test);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((ok, fail) => {
        const w = { test, ok: m => { inbox.splice(inbox.indexOf(m), 1); ok(m); } };
        waiters.push(w);
        setTimeout(() => { if (waiters.includes(w)) { waiters.splice(waiters.indexOf(w), 1); fail(new Error(`no ${t} for ${name}`)); } }, ms);
      });
    },
    // Status changes are pushed by a timer every three seconds.
    async friends(cond) { return c.next('friends', cond, 5000); },
    drain() { inbox.length = 0; },
    /** Encrypted for the friend's key - as the panel does it. */
    async write(friendHandle, text) {
      const f = c.view.friends.find(x => x.handle === friendHandle);
      c.send({ t: 'friendMsg', handle: friendHandle, env: await encrypt(key, text, f.key) });
    },
    read: msg => decrypt(key, msg.env)
  };
  await c.next('hello');
  await c.friends(m => m.key === key.pub);
  return c;
}

const saved = name => JSON.parse(fs.readFileSync(USERS, 'utf8')).users[name].e2e;

try {
  const alice = await connect('alice');
  const bob = await connect('bob');
  check(alice.view.friends.length === 0 && alice.view.incoming.length === 0, 'A new account already has friends');

  // --- The key: made at the first sign-in, kept wrapped, the same on every device
  const wrapped = saved('alice');
  check(wrapped?.pub === alice.key.pub && wrapped.key && wrapped.iter >= 100000, 'Alice\'s key is not kept with her account');
  check(!JSON.stringify(wrapped).includes('"d"'), 'The private key lies in users.json unwrapped');
  check(await unwrapKey(wrapped, 'not the password') === null, 'The key opens with a wrong password');
  const second = await setupKey(handle('alice'), PW, wrapped, () => { throw new Error('made a second key'); });
  check(second.pub === alice.key.pub, 'A second device gets another key');
  const other = { ...wrapped, pub: saved('bob').pub };
  check(await unwrapKey(other, PW) === null, 'A private key opens next to a foreign public key');
  check((await api('key', alice.cookie, { password: 'wrongPassword1', e2e: wrapped })).status === 401,
    'A key is accepted without the right password');
  const taken = await api('key', alice.cookie, { password: PW, e2e: { ...wrapped, pub: saved('bob').pub } });
  check(taken.e2e.pub === alice.key.pub && saved('alice').pub === alice.key.pub, 'An existing key gets replaced');
  console.log('Key: made at the first sign-in, kept only wrapped, the same key on every device.');

  // --- Looking up: name and image, never the sign-in name
  alice.send({ t: 'friendLookup', handle: '#' + handle('bob').toLowerCase() });
  const found = await alice.next('friendLookup');
  check(found.user?.handle === handle('bob') && found.user.name === 'bob' && found.relation === 'none',
    'Lookup by handle does not find bob: ' + JSON.stringify(found));
  check(!('accountKey' in found.user) && !JSON.stringify(Object.keys(found.user)).includes('key'), 'Lookup leaks account fields');
  alice.send({ t: 'friendLookup', handle: 'ZZZZZZ' });
  check((await alice.next('friendLookup')).user === null, 'An unknown handle finds somebody');
  alice.send({ t: 'friendLookup', handle: handle('alice') });
  check((await alice.next('friendLookup')).relation === 'self', 'Own handle is not recognised');
  console.log('Lookup: handle -> name and image, nothing else; unknown handles find nobody.');

  // --- Request and answer
  alice.drain(); bob.drain();
  alice.send({ t: 'friendRequest', handle: handle('bob') });
  const a1 = await alice.friends(m => m.outgoing.length === 1);
  check(a1.outgoing[0].handle === handle('bob'), 'Request does not show as outgoing');
  const b1 = await bob.friends(m => m.incoming.length === 1);
  check(b1.incoming[0].handle === handle('alice') && b1.incoming[0].name === 'alice', 'Request does not reach bob');
  bob.send({ t: 'friendMsg', handle: handle('alice'), env: {} });
  check((await bob.next('error')).key === 'friends.err.notFriends', 'Writing works before accepting');
  bob.send({ t: 'friendAnswer', handle: handle('alice'), accept: true });
  const b2 = await bob.friends(m => m.friends.length === 1);
  const a2 = await alice.friends(m => m.friends.length === 1);
  check(b2.incoming.length === 0 && a2.outgoing.length === 0, 'Accepted request is still open');
  check(a2.friends[0].status === 'online', `Bob is online but shows as ${a2.friends[0].status}`);
  bob.send({ t: 'watch', bots: 2 });
  check(await alice.friends(m => m.friends[0]?.status === 'watching'), 'Bob watching a game does not show as watching');
  bob.send({ t: 'leave' });
  check(await alice.friends(m => m.friends[0]?.status === 'online'), 'Bob back in the menu does not show as online');
  console.log('Request: shows on both sides, writing only after the yes, then friends with status.');

  // --- Messages: encrypted, also to someone offline, with unread count
  alice.drain(); bob.drain();
  check(a2.friends[0].key === bob.key.pub, 'The friend list does not carry the friend\'s key');
  await alice.write(handle('bob'), 'Hallo <b>Bob</b>');
  const got = await bob.next('friendMsg');
  check(got.with === handle('alice') && !got.msg.mine && await bob.read(got.msg) === 'Hallo <b>Bob</b>', 'Message does not open as sent');
  const echo = await alice.next('friendMsg');
  check(echo.msg.mine && await alice.read(echo.msg) === 'Hallo <b>Bob</b>', 'Sender cannot read their own message');
  check(!JSON.stringify(got).includes('Hallo'), 'The text travels in plain sight');
  const carolKey = (await setupKey(handle('carol'), PW, null, async e2e => e2e));
  check(await decrypt(carolKey, got.msg.env) === null, 'A third key reads along');
  check((await bob.friends(m => m.friends[0]?.unread === 1)), 'Unread count missing');
  bob.send({ t: 'friendHistory', handle: handle('alice') });
  const hist = await bob.next('friendHistory');
  check(hist.messages.length === 1 && await bob.read(hist.messages[0]) === 'Hallo <b>Bob</b>', 'History is wrong');
  check(await bob.friends(m => m.friends[0]?.unread === 0), 'Reading does not clear the unread count');

  // Envelopes the server must refuse: not made with the sender's key, made for a stranger
  alice.send({ t: 'friendMsg', handle: handle('bob'), env: await encrypt(carolKey, 'not me', bob.key.pub) });
  check((await alice.next('error')).key === 'friends.err.badMessage', 'A message with a foreign key is accepted');
  alice.send({ t: 'friendMsg', handle: handle('bob'), env: await encrypt(alice.key, 'for carol', carolKey.pub) });
  check((await alice.next('error')).key === 'friends.err.badMessage', 'A message for an outsider is accepted');

  // Safety code: the same on both sides
  const codeOf = v => safetyCode({ handle: v === alice.view ? handle('alice') : handle('bob'), pubs: [v.key] },
    { handle: v.friends[0].handle, pubs: [v.friends[0].key] });
  const codeA = await codeOf(alice.view), codeB = await codeOf(bob.view);
  check(codeA === codeB && /^\d{4} \d{4} \d{4}$/.test(codeA), `Safety codes differ: ${codeA} / ${codeB}`);
  console.log(`Messages: end-to-end encrypted, forged envelopes refused, safety code ${codeA} on both sides.`);

  // --- Offline, then on another device: everything readable there too
  bob.ws.close();
  check(await alice.friends(m => m.friends[0]?.status === 'offline'), 'Bob going offline is not noticed');
  await alice.write(handle('bob'), 'while you were away');
  await alice.next('friendMsg');
  const bobPhone = await connect('bob');
  check(bobPhone.key.pub === bob.key.pub, 'Bob\'s phone has another key');
  check(bobPhone.view.friends[0]?.unread === 1, 'A message to someone offline is lost');
  bobPhone.send({ t: 'friendHistory', handle: handle('alice') });
  const onPhone = await bobPhone.next('friendHistory');
  const texts = await Promise.all(onPhone.messages.map(m => bobPhone.read(m)));
  check(texts.join('|') === 'Hallo <b>Bob</b>|while you were away', 'The new device does not read the history: ' + texts.join('|'));
  const stored = fs.readFileSync(path.join(dir, 'friends.json'), 'utf8');
  check(!/Hallo|away/.test(stored), 'Plain text ended up in friends.json');
  console.log('Offline and new devices: waits for whoever is away, every device reads the whole history, nothing in plain text on disk.');

  // --- Password change: the same key, rewrapped; without it, the key goes
  const NEW = 'anotherPassword2';
  const rewrapped = await rewrapKey(saved('bob'), PW, NEW);
  const changed = await api('change', bobPhone.cookie, { password: PW, newPassword: NEW, e2e: rewrapped });
  check(changed.ok && changed.e2e?.pub === bob.key.pub, 'A password change loses the key');
  check(await unwrapKey(saved('bob'), PW) === null && (await unwrapKey(saved('bob'), NEW))?.pub === bob.key.pub,
    'The key is not wrapped with the new password');
  const swapped = await api('change', changed.cookie, { password: NEW, newPassword: PW, e2e: { ...rewrapped, pub: carolKey.pub } });
  check(swapped.ok && !saved('bob'), 'A password change slips in another key');
  const bobAgain = await connect('bob');
  check(bobAgain.key.pub !== bob.key.pub, 'Without a key, the next sign-in does not make a new one');
  const ak = await alice.friends(m => m.friends[0]?.key === bobAgain.key.pub);
  check(ak && await codeOf(ak) !== codeA, 'A new key does not change the safety code');
  bobAgain.send({ t: 'friendHistory', handle: handle('alice') });
  const after = await bobAgain.next('friendHistory');
  check(await bobAgain.read(after.messages[0]) === null, 'The new key opens the old messages');
  await alice.write(handle('bob'), 'with the new key');
  check(await bobAgain.read((await bobAgain.next('friendMsg')).msg) === 'with the new key', 'The new key cannot read new messages');
  bobPhone.ws.close();
  console.log('Password change: the key stays, rewrapped; dropped, the next sign-in makes a new one and the safety code changes.');

  // --- Asking each other at the same time is a yes; ending deletes the history
  const carol = await connect('carol');
  carol.send({ t: 'friendRequest', handle: handle('alice') });
  await carol.friends(m => m.outgoing.length === 1);
  alice.send({ t: 'friendRequest', handle: handle('carol') });
  check(await carol.friends(m => m.friends.length === 1), 'Mutual requests do not make friends');
  alice.send({ t: 'friendRemove', handle: handle('bob') });
  check(await bobAgain.friends(m => m.friends.length === 0), 'Ending the friendship does not reach bob');
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'friends.json'), 'utf8'));
  check(!Object.keys(raw.messages).some(k => k.includes('bob')), 'The history survives the end of the friendship');
  console.log('Mutual requests make friends; ending a friendship takes the messages along.');

  // --- Guests and floods
  alice.drain();
  for (let i = 0; i < 14; i++) alice.send({ t: 'friendLookup', handle: 'AAAAA' + (i % 9 + 2) });
  check((await alice.next('error')).key === 'friends.err.slowDown', 'Handles can be looked up without limit');
  console.log('Lookups are limited per connection.');

  for (const c of [alice, bobAgain, carol]) c.ws.close();
} catch (e) {
  check(false, e.message);
} finally {
  server.kill();
}

if (errors) { console.error(`${errors} errors`); process.exit(1); }
console.log('\nAll friend checks passed.');
fs.rmSync(dir, { recursive: true, force: true });
