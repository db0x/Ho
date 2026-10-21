// Access control in front of the lobby. What is checked is not the UI but
// what matters: that nothing comes out without a session - not even a
// WebSocket, because the game runs over it.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hashPassword, verifyPassword, addUser, deleteUser, listUsers, getUser,
  setPassword, verifyUser, generatePassword, checkPassword, validName, setDisplay, setAdmin
} from '../server/userstore.js';

// A separate account file so no real data gets touched.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-auth-'));
const USERS = path.join(dir, 'users.json');
process.env.HO_USERS_FILE = USERS;

let errors = 0;
const check = (cond, msg) => {
  if (!cond) { console.error('ERROR: ' + msg); errors++; }
  return cond;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------- Hashes
{
  const hash = await hashPassword('aPassword123');
  check(hash.startsWith('scrypt$'), 'Hash does not name its method');
  check(!hash.includes('aPassword123'), 'The password is in the hash');
  check(await verifyPassword('aPassword123', hash), 'Correct password is rejected');
  check(!await verifyPassword('aPassword124', hash), 'Wrong password is accepted');
  check(!await verifyPassword('', hash), 'Empty password is accepted');
  check(!await verifyPassword('aPassword123', 'nonsense'), 'Broken hash lets it through');
  const second = await hashPassword('aPassword123');
  check(hash !== second, 'The same password gives the same hash - the salt is missing');
  console.log('scrypt hashes: salted, verifiable, no plain text.');
}

// ----------------------------------------------------------------- Accounts
{
  const r = await addUser('captain');
  check(r.generated && r.password.length >= 12, 'First password is not random');
  check(getUser('captain').mustChange, 'New account does not require a password change');
  check(!JSON.stringify(getUser('captain')).includes(r.password), 'Account contains the password');
  check(await verifyUser('CAPTAIN', r.password), 'Uppercase name is rejected');
  check(!await verifyUser('captain', 'wrong'), 'Wrong password is accepted');
  check(!await verifyUser('doesnotexist', r.password), 'Unknown account is accepted');

  // Spelling: key lowercase, display as created
  const b = await addUser('BATMAN');
  check(b.name === 'batman' && b.display === 'BATMAN', `Spelling lost on creation (${b.display})`);
  const bv = await verifyUser('batman', b.password);
  check(bv && bv.display === 'BATMAN', 'Lowercase sign-in does not return the spelling');
  check(setDisplay('batman', 'BatMan').display === 'BatMan', 'Spelling cannot be changed');
  let wrong = null;
  try { setDisplay('batman', 'Joker'); } catch (e) { wrong = e.message; }
  check(wrong === 'auth.cli.badSpelling', 'Renaming via the spelling is possible');
  check(setDisplay('batman', 'batman').display === 'batman' && !getUser('batman').display,
    'Returning to lowercase leaves display in place');
  deleteUser('batman');
  console.log('Spelling: created as typed, sign-in case-insensitive, only the case can change.');

  let duplicate = null;
  await addUser('captain').catch(e => { duplicate = e.message; });
  check(duplicate === 'auth.cli.exists', `Duplicate account not rejected (${duplicate})`);

  check(!validName('With spaces') && !validName('x') && validName('tom.92'),
    'Name check lets nonsense through');
  check(checkPassword('short') === 'auth.err.tooShort', 'Too short password goes through');
  check(checkPassword('captain1', 'captain1') === 'auth.err.sameAsUser',
    'Password must not be the name');

  await addUser('second', 'anotherPassword');
  check(listUsers().length === 2, 'List counts wrong');
  check(deleteUser('second') && listUsers().length === 1, 'Deleting has no effect');
  check(!deleteUser('second'), 'Second delete reports success');
  console.log('Creating, checking, listing and deleting accounts.');
}

// The player the server is tested with: first password, change due.
const FIRST = generatePassword();
await setPassword('captain', FIRST, { mustChange: true });

// --------------------------------------------------------------- The server
const PORT = 8411 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HO_USERS_FILE: USERS, HO_AUTH: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));
await new Promise(r => server.stdout.once('data', r));

let cookie = null;                          // the session, as a browser holds it

/** Request as from a browser: with the cookie, without following redirects. */
async function request(urlPath, opt = {}) {
  const r = await fetch(BASE + urlPath, {
    redirect: 'manual',
    ...opt,
    headers: { ...(cookie ? { cookie } : {}), ...(opt.headers || {}) }
  });
  const set = r.headers.get('set-cookie');
  if (set) {
    const pair = set.split(';')[0];
    cookie = pair.endsWith('=') ? null : pair;    // Max-Age=0 signs out like this
  }
  let body = null;
  try { body = await r.json(); } catch { /* HTML or empty */ }
  return { status: r.status, location: r.headers.get('location'), body, raw: r };
}

const page = { accept: 'text/html' };
const asJson = (data) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
});

/** Can a game be opened? Only then are you really in the game. */
function wsAttempt() {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: cookie ? { cookie } : {} });
    const done = (r) => { try { ws.close(); } catch { /* never mind */ } ok(r); };
    ws.on('message', (raw) => {
      if (JSON.parse(raw.toString()).t === 'hello') done('hello');
    });
    ws.on('unexpected-response', (_, res) => done('rejected ' + res.statusCode));
    ws.on('error', () => done('rejected'));
    setTimeout(() => done('silent'), 3000);
  });
}

// --- Without a session nothing comes out
{
  const root = await request('/', { headers: page });
  check(root.status === 302 && root.location === 'login.html',
    `/ does not lead to the sign-in (${root.status} ${root.location})`);
  const client = await request('/js/main.js');
  check(client.status === 401, `The game client comes out without a session (${client.status})`);
  const rules = await request('/shared/rules.js');
  check(rules.status === 401, `The rules come out without a session (${rules.status})`);
  const deep = await request('/js/ui/hud.js', { headers: page });
  check(deep.status === 302 && deep.location === '../../login.html?next=%2Fjs%2Fui%2Fhud.js',
    `Deep redirect does not remember the target (${deep.location})`);

  const signInPage = await request('/login.html', { headers: page });
  check(signInPage.status === 200, 'The sign-in page itself cannot be reached');
  for (const urlPath of ['/js/login.js', '/js/i18n.js', '/js/ui/scene.js', '/shared/i18n.js', '/i18n/de.json', '/css/style.css', '/img/logo.svg']) {
    const r = await request(urlPath);
    check(r.status === 200, `The sign-in page cannot load ${urlPath} (${r.status})`);
  }
  check(await wsAttempt() !== 'hello', 'A WebSocket comes about without a session');

  // The allow list must not be bypassable. An encoded slash survives the URL
  // parser and only becomes a separator when decoding - without normalization
  // /css/..%2f..%2f led out of the client.
  for (const trick of ['/css/..%2f..%2fserver%2findex.js', '/css/..%2f..%2fpackage.json',
    '/i18n/..%2fjs%2fmain.js', '/img/%2e%2e/%2e%2e/server/userstore.js',
    '/css/..%5c..%5cpackage.json']) {
    const r = await fetch(BASE + trick, { redirect: 'manual' });
    const text = await r.text();
    check(r.status !== 200, `${trick} comes out without a session (${r.status})`);
    check(!/WebSocketServer|scrypt|"ho-web"/.test(text),
      `${trick} serves project files`);
  }
  console.log('Without a session: no client, no rules, no WebSocket, no path trick.');
}

// --- Sign in
{
  const wrong = await request('/api/auth/login', asJson({ user: 'captain', password: 'missed' }));
  check(wrong.status === 401 && wrong.body.error === 'auth.err.badLogin',
    `Wrong password is not rejected (${wrong.status})`);
  check(!cookie, 'There is a cookie after a rejected sign-in');

  const foreign = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'user=captain&password=' + FIRST
  });
  check(foreign.status === 400, `A form from a foreign page gets through (${foreign.status})`);

  const good = await request('/api/auth/login', asJson({ user: 'captain', password: FIRST }));
  check(good.status === 200 && good.body.mustChange === true,
    `Sign-in fails or does not require a change (${good.status})`);
  check(cookie && cookie.startsWith('ho_sid='), 'No session cookie arrives');
  const raw = good.raw.headers.get('set-cookie');
  check(/HttpOnly/i.test(raw) && /SameSite=Lax/i.test(raw),
    `The cookie is not shielded (${raw})`);
  console.log('Sign-in: wrong password rejected, correct one brings a session.');
}

// --- As long as the first password applies, you get no further than the change
{
  const root = await request('/', { headers: page });
  check(root.status === 302 && root.location === 'login.html',
    `The client comes out before the password change (${root.status})`);
  check(await wsAttempt() !== 'hello', 'A WebSocket comes about before the password change');
  const me = await request('/api/auth/me');
  check(me.status === 200 && me.body.mustChange === true, 'me does not report the due change');
  console.log('Before the password change: session yes, game no.');
}

// --- Password change
const NEW = 'myOwnPassword-2026';
{
  const withoutOld = await request('/api/auth/change', asJson({ password: 'missed', newPassword: NEW }));
  check(withoutOld.status === 401, `Change without the current password goes through (${withoutOld.status})`);

  const tooShort = await request('/api/auth/change', asJson({ password: FIRST, newPassword: 'short' }));
  check(tooShort.status === 400 && tooShort.body.error === 'auth.err.tooShort',
    `Too short password goes through (${tooShort.status})`);

  const same = await request('/api/auth/change', asJson({ password: FIRST, newPassword: FIRST }));
  check(same.status === 400 && same.body.error === 'auth.err.sameAsOld',
    `The old password is accepted as the new one (${same.status})`);

  const good = await request('/api/auth/change', asJson({ password: FIRST, newPassword: NEW }));
  check(good.status === 200 && good.body.mustChange === false, `Change fails (${good.status})`);
  check(!getUser('captain').mustChange, 'The file does not know about the change');
  check(!await verifyUser('captain', FIRST), 'The first password still applies');
  check(await verifyUser('captain', NEW), 'The new password does not apply');
  console.log('Password change: old password required, too short and identical ones rejected.');
}

// --- Now into the game
{
  const root = await request('/', { headers: page });
  check(root.status === 200, `The client does not come out (${root.status})`);
  check(await wsAttempt() === 'hello', 'No WebSocket comes about with a session');
  const signInPage = await request('/login.html', { headers: page });
  check(signInPage.status === 302 && signInPage.location === './',
    'Signed in, you land on the sign-in page again');
  console.log('With the changed password: client and WebSocket are open.');
}

/** Opens a socket, sends `msg` after hello and collects what comes back. */
const session = (msg) => new Promise((ok) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
  const got = { hello: null, data: null, sent: null, errors: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'hello') { got.hello = m; ws.send(JSON.stringify(msg)); }
    if (m.t === 'adminData') got.data = m;
    if (m.t === 'adminMsgSent') got.sent = m;
    if (m.t === 'error') got.errors.push(m.key);
    if (['adminData', 'adminMsgSent', 'error'].includes(m.t)) { ws.close(); ok(got); }
  });
  setTimeout(() => { ws.close(); ok(got); }, 3000);
});

// --- Admin flag: only flagged accounts get the overview, and the server asks
//     the account file on every request - granting and revoking take effect
//     without signing in again.
{

  const plain = await session({ t: 'admin' });
  check(plain.hello?.admin === false, 'hello calls a normal account an admin');
  check(!plain.data && plain.errors.includes('err.notAdmin'), 'A normal account gets the admin overview');

  check(setAdmin('captain', true).admin && listUsers().find(u => u.name === 'captain')?.admin,
    'Admin flag is not stored');
  const admin = await session({ t: 'admin' });
  check(admin.hello?.admin === true, 'hello does not report the admin flag');
  check(Array.isArray(admin.data?.games), 'Admin overview has no game list');
  const me = admin.data?.accounts.find(a => a.name === 'captain');
  check(me && me.admin && me.online, `Admin overview does not list the own account as online admin (${JSON.stringify(me)})`);
  check(admin.data && !JSON.stringify(admin.data).includes('scrypt'), 'Admin overview leaks password hashes');
  check(me && me.avatar === null, `Account without an image shows an avatar (${me?.avatar})`);

  // Ending a game from outside: a player sits in a running game, the admin
  // ends it from a second connection.
  const player = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
  let code = null, ended = null, announced = null;
  player.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'hello') player.send(JSON.stringify({ t: 'create', name: 'x' }));
    if (m.t === 'joined') { code = m.code; player.send(JSON.stringify({ t: 'addBot' })); player.send(JSON.stringify({ t: 'start' })); }
    if (m.t === 'ended') ended = m;
    if (m.t === 'adminMsg') announced = m;
  });
  for (let i = 0; i < 60 && !code; i++) await wait(50);
  check(code, 'Test setup: no game created');
  const listed = await session({ t: 'admin' });
  check(listed.data?.games.some(g => g.id === code), 'The new game is missing from the admin overview');
  // An announcement reaches everyone in the game, as the admin's own text.
  const notice = 'Server restart at 22:00 <b>sharp</b>';
  const sent = await session({ t: 'adminMsg', code, text: notice });
  for (let i = 0; i < 40 && !announced; i++) await wait(50);
  check(sent.sent?.delivered === 1, `Announcement not confirmed for exactly one connection (${JSON.stringify(sent.sent)})`);
  check(announced?.text === notice && announced.from === 'captain' && announced.code === code,
    `Player did not get the announcement (${JSON.stringify(announced)})`);
  const empty = await session({ t: 'adminMsg', code, text: '   ' });
  check(empty.errors.includes('err.badAdminMessage'), 'An empty announcement is accepted');
  const long = await session({ t: 'adminMsg', code, text: 'x'.repeat(501) });
  check(long.errors.includes('err.badAdminMessage'), 'An overlong announcement is accepted');

  // Watching: an admin may watch a game with humans - with the full map,
  // but without a pace, and the game must not start running by itself. The
  // dangerous case is a game whose humans are all offline: for the server
  // they count as ready, so a spectator pace would play it through.
  {
    const absent = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
    let watchCode = null;
    absent.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'hello') absent.send(JSON.stringify({ t: 'create', name: 'y' }));
      if (m.t === 'joined') { watchCode = m.code; absent.send(JSON.stringify({ t: 'addBot' })); absent.send(JSON.stringify({ t: 'start' })); }
    });
    for (let i = 0; i < 60 && !watchCode; i++) await wait(50);
    await wait(200);
    absent.close();
    await wait(200);

    const watcher = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
    const views = [];
    watcher.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'hello') watcher.send(JSON.stringify({ t: 'adminWatch', code: watchCode }));
      if (m.t === 'view') views.push(m.view);
    });
    for (let i = 0; i < 60 && !views.length; i++) await wait(50);
    const v = views[0];
    check(v?.spectator === true && v.pace === null, `Admin does not watch as a spectator without pace (${JSON.stringify(v?.pace)})`);
    check(v && v.planets.every(p => p.known === 'live'), 'Admin view has fog of war');
    // A pace request from the admin must not drive a game with humans.
    watcher.send(JSON.stringify({ t: 'pace', paused: false, ms: 120 }));
    watcher.send(JSON.stringify({ t: 'step' }));
    await wait(1500);
    check(views.every(x => x.turn === v?.turn), `Watched game ran by itself (turns ${views.map(x => x.turn).join(',')})`);
    watcher.close();
  }

  const gone = await session({ t: 'adminEnd', code });
  for (let i = 0; i < 40 && !ended; i++) await wait(50);
  check(ended?.key === 'notice.endedByAdmin' && ended.params?.code === code, 'The player is not told that the game ended');
  check(gone.data && !gone.data.games.some(g => g.id === code), 'The ended game is still listed');
  const unknown = await session({ t: 'adminEnd', code });
  check(unknown.errors.includes('err.gameNotFound'), 'Ending a game twice does not report it as gone');
  player.close();

  setAdmin('captain', false);
  const notAllowed = await session({ t: 'adminEnd', code: 'ABCD' });
  check(notAllowed.errors.includes('err.notAdmin'), 'A normal account may end games');
  const notAllowedWatch = await session({ t: 'adminWatch', code: 'ABCD' });
  check(notAllowedWatch.errors.includes('err.notAdmin'), 'A normal account may watch any game');
  const notAllowedMsg = await session({ t: 'adminMsg', code: 'ABCD', text: 'hi' });
  check(notAllowedMsg.errors.includes('err.notAdmin'), 'A normal account may send announcements');
  const revoked = await session({ t: 'admin' });
  check(!revoked.data && revoked.errors.includes('err.notAdmin'), 'Revoked admin still gets the overview');
  console.log('Admin flag: overview, watching, announcements and ending games only for admins, granting and revoking apply immediately.');
}

// --- With sign-in you are named as in your profile: create cannot get around
//     that, 'profile' can - but never as another account.
{
  await addUser('rival', 'rivalPassword1');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
  let lobby = null, profile = null, hello = null;
  const errorKeys = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'hello') { hello = m; ws.send(JSON.stringify({ t: 'create', name: 'Impostor' })); }
    if (m.t === 'lobby') lobby = m.lobby;
    if (m.t === 'profile') profile = m.profile;
    if (m.t === 'error') errorKeys.push(m.key);
  });
  const until = async (fn) => { for (let i = 0; i < 60 && !fn(); i++) await wait(50); };
  await until(() => lobby);
  const myName = () => lobby?.players[0]?.name;
  check(hello?.profile?.account === 'captain', 'hello does not name the account');
  check(myName() === 'captain', `Player name is '${myName()}' instead of the account name`);

  lobby = null;
  ws.send(JSON.stringify({ t: 'profile', name: 'Señor <b>Nemo</b>' }));
  await until(() => lobby);
  check(myName() === 'Señor bNemo/b', `Renaming has no effect or markup remains ('${myName()}')`);
  check(getUser('captain').nick === 'Señor bNemo/b', 'Display name is not stored in the account');
  check(lobby.players[0].account === 'captain', 'Lobby does not reveal the account behind the display name');

  profile = null;
  ws.send(JSON.stringify({ t: 'profile', name: 'RIVAL' }));
  await until(() => profile);
  check(errorKeys.includes('profile.err.taken'), 'Name of another account is accepted');
  check(profile?.name === 'Señor bNemo/b', `Rejected name ends up in the profile anyway ('${profile?.name}')`);

  // Image: a tiny PNG goes through, nonsense does not
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  profile = null; lobby = null;
  ws.send(JSON.stringify({ t: 'profile', avatar: png }));
  await until(() => profile && lobby);
  check(/^api\/avatar\/u-captain\?v=/.test(profile?.avatar || ''), `No image URL in the profile (${profile?.avatar})`);
  check(lobby?.players[0]?.avatar === profile?.avatar, 'Lobby does not show the new image');
  setAdmin('captain', true);
  const withImage = await session({ t: 'admin' });
  check(withImage.data?.accounts.find(u => u.name === 'captain')?.avatar === profile.avatar,
    'Admin overview does not show the account image');
  setAdmin('captain', false);
  const image = await request('/' + profile.avatar);
  check(image.status === 200 && image.raw.headers.get('content-type') === 'image/png', `Image does not come out (${image.status})`);
  const foreign = await fetch(`${BASE}/${profile.avatar}`, { redirect: 'manual' });
  check(foreign.status !== 200, 'Image comes out without a session');
  errorKeys.length = 0; profile = null;
  ws.send(JSON.stringify({ t: 'profile', avatar: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' }));
  await until(() => profile);
  check(errorKeys.includes('profile.err.image'), 'A non-PNG with a PNG label is accepted');
  ws.send(JSON.stringify({ t: 'profile', avatar: null, name: 'captain' }));
  await wait(150);
  check(!getUser('captain').avatar && !getUser('captain').nick, 'Profile cannot be reset');
  ws.close();
  console.log('Profile: display name free (but never another account), image checked and only with a session.');
}

// --- A deleted account is out immediately, even from an open session
{
  const open = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
  let closed = false;
  open.on('close', () => { closed = true; });
  await new Promise(r => open.on('message', r));

  deleteUser('captain');
  const root = await request('/', { headers: page });
  check(root.status === 302, `Deleted account still reaches the client (${root.status})`);
  for (let i = 0; i < 40 && !closed; i++) await wait(100);
  check(closed, 'The open WebSocket of the deleted account stays up');
  try { open.close(); } catch { /* never mind */ }
  console.log('Deleted account: HTTP closed immediately, open WebSocket disconnected within a second.');
}

// --- An unreadable account file locks everyone out but does not kill the server.
//     It is read on every request - a throw there would reach all the way into
//     the HTTP server and take it down on every call.
{
  const intact = fs.readFileSync(USERS, 'utf8');
  fs.writeFileSync(USERS, '{ this is not JSON');
  const root = await request('/', { headers: page });
  check(root.status === 302, `Unreadable account file lets through (${root.status})`);
  const signInPage = await request('/login.html', { headers: page });
  check(signInPage.status === 200, 'After an unreadable account file the server no longer responds');
  fs.writeFileSync(USERS, intact);
  const again = await request('/login.html', { headers: page });
  check(again.status === 200, 'The server does not recover when the file is intact again');
  console.log('Unreadable account file: locks out, but does not take the server down.');
}

// --- Throttle guessing. Last, because the lockout counts per origin.
{
  const r = await addUser('victim', 'aPasswordX1');
  check(r.name === 'victim', 'Account for the guessing attempt is missing');
  cookie = null;
  let locked = null;
  for (let i = 0; i < 8 && !locked; i++) {
    const a = await request('/api/auth/login', asJson({ user: 'victim', password: 'missed' + i }));
    if (a.status === 429) locked = { after: i + 1, body: a.body };
  }
  check(locked, 'Any number of failed attempts has no consequences');
  check(locked && locked.body.error === 'auth.err.locked' && locked.body.params?.n > 0,
    'The lockout names no waiting time');
  const anyway = await request('/api/auth/login', asJson({ user: 'victim', password: 'aPasswordX1' }));
  check(anyway.status === 429, 'During the lockout the correct password gets through');
  console.log(`Guessing: locked after ${locked?.after} failed attempts, even for the correct password.`);
}

// --- Switched off means switched off: then nothing should stand in the way
{
  server.kill();
  await wait(200);
  const PORT2 = PORT + 1;
  const open = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT2), HO_AUTH: 'off' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise(r => open.stdout.once('data', r));
  const r = await fetch(`http://127.0.0.1:${PORT2}/`, { redirect: 'manual' });
  check(r.status === 200, `Without sign-in the client does not come out (${r.status})`);
  const ws = await new Promise((ok) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT2}`);
    s.on('message', (raw) => { ok(JSON.parse(raw.toString()).t); s.close(); });
    s.on('error', () => ok('error'));
    setTimeout(() => ok('silent'), 3000);
  });
  check(ws === 'hello', `Without sign-in no WebSocket comes about (${ws})`);
  open.kill();
  console.log('HO_AUTH=off: everything open as before - for development and tests.');
}

fs.rmSync(dir, { recursive: true, force: true });
if (errors) { console.error(`\n${errors} access problems.`); process.exit(1); }
console.log('\nAll access checks passed.');
process.exit(0);
