// Friends: find by handle, request, accept, status and messages - over a
// real server with real accounts. What is checked above all: a stranger only
// ever learns the handle, the name and the image, never the sign-in name -
// and the server never gets to see the text of a message (end-to-end, with
// the browser's own client/js/e2e.js, here on Node's WebCrypto).
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
const { createDevice, encrypt, decrypt, safetyCode } = await import('../client/js/e2e.js');

let errors = 0;
const check = (cond, msg) => { if (!cond) { console.error('ERROR: ' + msg); errors++; } return cond; };

const PW = 'friendlyPassword1';
for (const name of ['alice', 'bob', 'carol']) await addUser(name, PW, { mustChange: false });
const handle = name => getUser(name).handle;

// Left over from before: one message past the 14 days, one within. The server
// has to drop the old one at boot, unread or not.
const DAY = 24 * 3600 * 1000;
const oldEnv = { v: 1, dev: '0'.repeat(16), pub: 'B' + 'A'.repeat(86) + '=', iv: 'AAAA', ct: 'AAAA', keys: {} };
fs.writeFileSync(path.join(dir, 'friends.json'), JSON.stringify({ version: 2, links: [], read: {}, devices: {},
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

/** Signs in and opens the WebSocket with this device's key; collects everything that arrives. */
async function connect(name, device) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: name, password: PW })
  });
  const cookie = r.headers.get('set-cookie').split(';')[0];
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
    ws, inbox, device, view: null,
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
    /** Encrypted for every device of the friend and every own one - as the panel does it. */
    async write(friendHandle, text) {
      const f = c.view.friends.find(x => x.handle === friendHandle);
      c.send({ t: 'friendMsg', handle: friendHandle, env: await encrypt(device, text, [...f.devices, ...c.view.devices]) });
    },
    read: msg => decrypt(device, msg.env)
  };
  await c.next('hello');
  c.send({ t: 'e2eDevice', id: device.id, pub: device.pub });
  await c.friends(m => m.devices.some(d => d.id === device.id));
  return c;
}

try {
  const keys = { alice: await createDevice(), bob: await createDevice(), carol: await createDevice() };
  const alice = await connect('alice', keys.alice);
  const bob = await connect('bob', keys.bob);
  check(alice.view.friends.length === 0 && alice.view.incoming.length === 0, 'A new account already has friends');

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
  check(a2.friends[0].devices.some(d => d.pub === keys.bob.pub), 'The friend list does not carry the friend\'s key');
  await alice.write(handle('bob'), 'Hallo <b>Bob</b>');
  const got = await bob.next('friendMsg');
  check(got.with === handle('alice') && !got.msg.mine && await bob.read(got.msg) === 'Hallo <b>Bob</b>', 'Message does not open as sent');
  const echo = await alice.next('friendMsg');
  check(echo.msg.mine && await alice.read(echo.msg) === 'Hallo <b>Bob</b>', 'Sender cannot read their own message');
  check(!JSON.stringify(got).includes('Hallo'), 'The text travels in plain sight');
  check(await decrypt(keys.carol, got.msg.env) === null, 'A third device reads along');
  check((await bob.friends(m => m.friends[0]?.unread === 1)), 'Unread count missing');
  bob.send({ t: 'friendHistory', handle: handle('alice') });
  const hist = await bob.next('friendHistory');
  check(hist.messages.length === 1 && await bob.read(hist.messages[0]) === 'Hallo <b>Bob</b>', 'History is wrong');
  check(await bob.friends(m => m.friends[0]?.unread === 0), 'Reading does not clear the unread count');

  // Envelopes the server must refuse: a device that is not the sender's, a key for a stranger
  const forged = await encrypt(keys.carol, 'not me', [{ id: keys.bob.id, pub: keys.bob.pub }]);
  alice.send({ t: 'friendMsg', handle: handle('bob'), env: forged });
  check((await alice.next('error')).key === 'friends.err.badMessage', 'A message from a foreign device is accepted');
  const leaky = await encrypt(keys.alice, 'for carol too', [keys.bob, keys.carol]);
  alice.send({ t: 'friendMsg', handle: handle('bob'), env: leaky });
  check((await alice.next('error')).key === 'friends.err.badMessage', 'A message wrapped for an outsider is accepted');

  // Safety code: the same on both sides
  const codeA = await safetyCode({ handle: handle('alice'), pubs: alice.view.devices.map(d => d.pub) },
    { handle: handle('bob'), pubs: alice.view.friends[0].devices.map(d => d.pub) });
  const bv = bob.view;
  const codeB = await safetyCode({ handle: handle('bob'), pubs: bv.devices.map(d => d.pub) },
    { handle: handle('alice'), pubs: bv.friends[0].devices.map(d => d.pub) });
  check(codeA === codeB && /^\d{4} \d{4} \d{4}$/.test(codeA), `Safety codes differ: ${codeA} / ${codeB}`);
  console.log(`Messages: end-to-end encrypted, forged envelopes refused, safety code ${codeA} on both sides.`);

  bob.ws.close();
  check(await alice.friends(m => m.friends[0]?.status === 'offline'), 'Bob going offline is not noticed');
  await alice.write(handle('bob'), 'while you were away');
  await alice.next('friendMsg');
  // Bob comes back with the same browser - and with a new phone
  const bobAgain = await connect('bob', keys.bob);
  check(bobAgain.view.friends[0]?.unread === 1, 'A message to someone offline is lost');
  const phone = await createDevice();
  const bobPhone = await connect('bob', phone);
  const ha = await alice.friends(m => m.friends[0]?.devices.length === 2);
  check(ha, 'Alice does not learn about Bob\'s new device');
  const codeNew = await safetyCode({ handle: handle('alice'), pubs: ha.devices.map(d => d.pub) },
    { handle: handle('bob'), pubs: ha.friends[0].devices.map(d => d.pub) });
  check(codeNew !== codeA, 'A new device does not change the safety code');
  bobPhone.send({ t: 'friendHistory', handle: handle('alice') });
  const onPhone = await bobPhone.next('friendHistory');
  check(await bobPhone.read(onPhone.messages.at(-1)) === null, 'The new device reads what was written before it existed');
  bobAgain.send({ t: 'friendHistory', handle: handle('alice') });
  const onPc = await bobAgain.next('friendHistory');
  check(await bobAgain.read(onPc.messages.at(-1)) === 'while you were away', 'The old browser lost the message');
  await alice.write(handle('bob'), 'for both');
  check(await bobPhone.read((await bobPhone.next('friendMsg')).msg) === 'for both', 'The new device cannot read new messages');
  check(await bobAgain.read((await bobAgain.next('friendMsg')).msg) === 'for both', 'The old device cannot read new messages');
  const stored = fs.readFileSync(path.join(dir, 'friends.json'), 'utf8');
  check(!/Hallo|away|for both/.test(stored), 'Plain text ended up in friends.json');
  bobPhone.ws.close();
  console.log('Offline and new devices: waits for whoever is away, a new device reads from then on, nothing in plain text on disk.');

  // --- Asking each other at the same time is a yes; ending deletes the history
  const carol = await connect('carol', keys.carol);
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
