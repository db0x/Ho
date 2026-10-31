// Access control in front of the lobby. What is checked is not the UI but
// what matters: that nothing comes out without a session - not even a
// WebSocket, because the game runs over it.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inviteFile, peekInvite } from '../server/invites.js';
import { appealsOf } from '../server/appeals.js';
import {
  hashPassword, verifyPassword, addUser, deleteUser, listUsers, getUser,
  setPassword, verifyUser, generatePassword, checkPassword, validName, setDisplay, setAdmin, setInviter, setBlocked
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
const session = (msg, as = cookie) => new Promise((ok) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: as } });
  ws.on('error', () => ok(got));          // refused upgrade: no session (any more)
  const got = { hello: null, data: null, sent: null, invite: null, mine: null, created: null, appeal: null, games: null, errors: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'hello') { got.hello = m; ws.send(JSON.stringify(msg)); }
    if (m.t === 'adminData') got.data = m;
    if (m.t === 'adminMsgSent') got.sent = m;
    if (m.t === 'adminInviteCreated') got.invite = m;
    if (m.t === 'inviteData') got.mine = m;
    if (m.t === 'inviteCreated') got.created = m;
    if (m.t === 'appealData') got.appeal = m;
    if (m.t === 'games') got.games = m;
    if (m.t === 'error') got.errors.push(m.key);
    if (['adminData', 'adminMsgSent', 'inviteData', 'appealData', 'games', 'error'].includes(m.t)) { ws.close(); ok(got); }
  });
  setTimeout(() => { ws.close(); ok(got); }, 3000);
});

// --- Admin flag: only flagged accounts get the overview, and the server asks
//     the account file on every request - granting and revoking take effect
//     without signing in again.
{

  // Every admin message, read from the server's source - so a future admin
  // feature that forgets the check fails here without anyone remembering to
  // add it. A normal account must get a refusal and no admin data for each.
  const serverSource = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const adminTypes = [...serverSource.matchAll(/case '(admin[A-Za-z]*)'/g)].map(m => m[1]);
  check(adminTypes.length >= 6, `Admin messages not found in the source (${adminTypes})`);
  for (const t of adminTypes) {
    const tried = await session({ t, code: 'ABCD', text: 'x', id: 'x', note: 'x' });
    check(tried.errors.includes('err.notAdmin') && !tried.data && !tried.sent && !tried.invite,
      `A normal account gets through '${t}' (${JSON.stringify(tried.errors)})`);
  }

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
    // Another account plays it - an admin must not watch a game they play in.
    await addUser('absentee', 'absenteePassword1', { mustChange: false });
    const signIn = await fetch(`${BASE}/api/auth/login`, asJson({ user: 'absentee', password: 'absenteePassword1' }));
    const absentCookie = signIn.headers.get('set-cookie').split(';')[0];
    const absent = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: absentCookie } });
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
    deleteUser('absentee');
  }

  // Fairness: an admin who plays in a game must not watch it without fog,
  // and one account gets one seat per game.
  const ownWatch = await session({ t: 'adminWatch', code });
  check(ownWatch.errors.includes('err.watchOwnGame'), 'An admin can watch their own game without fog');
  {
    const host = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
    let lobbyCode = null;
    host.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'hello') host.send(JSON.stringify({ t: 'create', name: 'z' }));
      if (m.t === 'joined') lobbyCode = m.code;
    });
    for (let i = 0; i < 60 && !lobbyCode; i++) await wait(50);
    const second = await session({ t: 'join', code: lobbyCode });
    check(second.errors.includes('err.alreadySeated'), 'The same account gets a second seat in one game');
    host.close();
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
  console.log(`Admin flag: all ${adminTypes.length} admin messages refused for normal accounts; granting and revoking apply immediately.`);
}

// --- Moving devices: the account continues its game on another connection,
//     the first one lets go and cannot quietly take the seat back.
{
  const device = () => new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie } });
    const d = { ws, msgs: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      d.msgs.push(m);
      if (m.t === 'hello') { d.hello = m; ok(d); }
      if (m.t === 'joined') d.joined = m;
    });
  });
  const got = async (d, t) => {
    for (let i = 0; i < 60; i++) { const m = d.msgs.find(x => x.t === t); if (m) return m; await wait(50); }
    return null;
  };

  const phone = await device();
  phone.send({ t: 'create', name: 'x' });
  await got(phone, 'joined');
  const code = phone.joined?.code, phoneToken = phone.joined?.token;
  phone.send({ t: 'addBot' }); phone.send({ t: 'start' });
  await got(phone, 'view');

  const pc = await device();
  check(pc.hello.mySeats?.some(g => g.id === code && g.state === 'running'),
    `The second device does not offer the running game (${JSON.stringify(pc.hello.mySeats)})`);
  pc.send({ t: 'takeover', code });
  const joined = await got(pc, 'joined');
  check(joined?.code === code && joined.token !== phoneToken, 'Takeover does not seat the second device with a new key');
  check(await got(pc, 'view'), 'The second device gets no view after the takeover');
  check((await got(phone, 'takenOver'))?.code === code, 'The first device is not told about the takeover');

  // The phone reconnects with its old key: no seat, but the hint why.
  const late = await device();
  late.send({ t: 'resume', code, token: phoneToken });
  check(await got(late, 'takenOver'), 'An old key brings no hint that the seat moved');
  check(!late.joined, 'The old key still gets the seat');
  check(late.hello.mySeats?.some(g => g.id === code), 'The game is not offered back to the first device');

  // And back again.
  late.send({ t: 'takeover', code });
  check((await got(late, 'joined'))?.code === code, 'The seat cannot be taken back');
  check(await got(pc, 'takenOver'), 'The second device is not told when the seat goes back');
  const chatLost = [...phone.msgs, ...pc.msgs, ...late.msgs].some(m => m.t === 'chat' && /lost|back/.test(JSON.stringify(m)));
  check(!chatLost, 'The other players hear about the device change');

  // A foreign account cannot take the seat.
  await addUser('stranger', 'strangerPassword1', { mustChange: false });
  const signIn = await fetch(`${BASE}/api/auth/login`, asJson({ user: 'stranger', password: 'strangerPassword1' }));
  const strangerWs = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: signIn.headers.get('set-cookie').split(';')[0] } });
  const refused = await new Promise((ok) => {
    strangerWs.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'hello') {
        check(!m.mySeats?.length, 'A foreign account is offered the seat');
        strangerWs.send(JSON.stringify({ t: 'takeover', code }));
      }
      if (m.t === 'error' || m.t === 'joined') ok(m);
    });
    setTimeout(() => ok(null), 3000);
  });
  check(refused?.key === 'err.noSeat', `A foreign account takes the seat (${JSON.stringify(refused)})`);
  strangerWs.close();
  deleteUser('stranger');

  for (const d of [phone, pc, late]) d.ws.close();
  console.log('Moving devices: seat taken over and back, old key refused, foreign account refused, nobody told.');
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

  // Cyrillic works, and an apostrophe becomes the letter apostrophe ʼ instead of vanishing.
  lobby = null;
  ws.send(JSON.stringify({ t: 'profile', name: "Мар'яна `Ї`" }));
  await until(() => lobby);
  check(myName() === 'Марʼяна ʼЇʼ', `Apostrophes not turned into ʼ ('${myName()}')`);
  check(getUser('captain').nick === 'Марʼяна ʼЇʼ', 'Cyrillic display name is not stored');

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

// --- Invite links: an admin creates one, a new player picks name and
//     password with it. One use only, 24 hours at most.
{
  /** Requests without the shared cookie - the new player has their own. */
  const redeem = async (data) => {
    const r = await fetch(`${BASE}/api/auth/redeem`, asJson(data));
    let body = null;
    try { body = await r.json(); } catch { /* empty */ }
    return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0] || null };
  };
  const peek = async (token) => (await fetch(`${BASE}/api/auth/invite?token=${encodeURIComponent(token)}`)).status;

  setAdmin('captain', true);
  const made = await session({ t: 'adminInvite', note: 'for the test' });
  const token = made.invite?.token;
  check(token && token.length >= 30, 'No invite token comes back');
  const listed = made.data?.invites.find(i => i.id === made.invite?.invite.id);
  check(listed?.note === 'for the test' && listed.by === 'captain', `Invite not listed (${JSON.stringify(made.data?.invites)})`);
  check(!JSON.stringify(made.data).includes(token), 'The admin overview shows the token');
  check(!fs.readFileSync(inviteFile(), 'utf8').includes(token), 'invites.json holds the token in plain text');

  check(await peek(token) === 200, 'A fresh invite is not recognised');
  const shown = await (await fetch(`${BASE}/api/auth/invite?token=${encodeURIComponent(token)}`)).json();
  check(shown.note === 'for the test' && shown.by === 'captain', `The invitee does not see who invited and the note (${JSON.stringify(shown)})`);
  check(await peek('nonsense') === 404, 'A made-up invite is accepted');

  // Problems that can be fixed leave the link valid.
  const taken = await redeem({ token, user: 'captain', password: 'newPlayer-123' });
  check(taken.status === 400 && taken.body.error === 'profile.err.taken', `Taken name accepted (${JSON.stringify(taken.body)})`);
  const short = await redeem({ token, user: 'newbie', password: 'short' });
  check(short.status === 400 && short.body.error === 'auth.err.tooShort', 'Too short password accepted');
  check(await peek(token) === 200, 'A failed attempt used the invite up');

  // Two requests at once with the same link: exactly one account.
  const [a, b] = await Promise.all([
    redeem({ token, user: 'Newbie', password: 'newPlayer-123' }),
    redeem({ token, user: 'otherbie', password: 'newPlayer-456' })
  ]);
  const wins = [a, b].filter(r => r.status === 200);
  check(wins.length === 1, `One link created ${wins.length} accounts`);
  check([a, b].some(r => r.body?.error === 'auth.err.inviteInvalid'), 'The losing request gets no clear answer');
  const created = getUser('newbie') ? 'newbie' : 'otherbie';
  check(!getUser(created === 'newbie' ? 'otherbie' : 'newbie'), 'The losing request created an account too');
  const fresh = getUser(created);
  check(fresh && !fresh.mustChange && fresh.invitedBy === 'captain', `New account is wrong (${JSON.stringify(fresh)})`);
  check(created !== 'newbie' || fresh.display === 'Newbie', 'The spelling of the chosen name is lost');
  const winner = wins[0];
  const own = await fetch(`${BASE}/`, { headers: { cookie: winner.cookie, accept: 'text/html' }, redirect: 'manual' });
  check(own.status === 200, `The new player is not signed in (${own.status})`);
  const after = await session({ t: 'admin' });
  check(!after.data?.invites.some(i => i.id === made.invite.invite.id), 'A used invite is still listed');
  const again = await redeem({ token, user: 'thirdbie', password: 'newPlayer-789' });
  check(again.status === 404 && !getUser('thirdbie'), 'A used invite creates another account');

  // Expiry: 24 hours at most, even if nobody touches the link.
  const old = (await session({ t: 'adminInvite' })).invite.token;
  const file = JSON.parse(fs.readFileSync(inviteFile(), 'utf8'));
  for (const i of file.invites) i.expires = Date.now() - 1;
  fs.writeFileSync(inviteFile(), JSON.stringify(file));
  check(await peek(old) === 404, 'An expired invite is still valid');
  check(JSON.parse(fs.readFileSync(inviteFile(), 'utf8')).invites.length === 0, 'Expired invites stay in the file');

  // Revoking
  const revokable = await session({ t: 'adminInvite', note: 'oops' });
  const gone = await session({ t: 'adminRevokeInvite', id: revokable.invite.invite.id });
  check(!gone.data?.invites.some(i => i.id === revokable.invite.invite.id), 'Revoked invite still listed');
  check(await peek(revokable.invite.token) === 404, 'A revoked invite still works');

  setAdmin('captain', false);
  const notAllowed = await session({ t: 'adminInvite' });
  check(notAllowed.errors.includes('err.notAdmin') && !notAllowed.invite, 'A normal account may create invites');
  deleteUser(created);
  console.log('Invites: once only, 24 h at most, revocable, token never stored or shown again.');
}

// --- Inviter role: an admin grants it in the panel; the account may then
//     create invite links and sees and revokes only its own. Taking it away
//     ends the open links at once and reaches the open tab.
{
  // Straight from the file, not over HTTP: the failed lookups above (and the
  // deliberate ones here) would run into the guessing lock.
  const peek = async (token) => peekInvite(token) ? 200 : 404;
  await addUser('mate', 'matePassword1', { mustChange: false });
  const login = await fetch(`${BASE}/api/auth/login`, asJson({ user: 'mate', password: 'matePassword1' }));
  const mate = login.headers.get('set-cookie')?.split(';')[0];
  check(mate, 'The second account cannot sign in');

  const before = await session({ t: 'invites' }, mate);
  check(before.hello?.inviter === false, 'hello calls a normal account an inviter');
  for (const t of ['invites', 'inviteCreate', 'inviteRevoke']) {
    const tried = await session({ t, id: 'x', note: 'x' }, mate);
    check(tried.errors.includes('err.notInviter') && !tried.mine && !tried.created,
      `A normal account gets through '${t}' (${JSON.stringify(tried.errors)})`);
  }

  setAdmin('captain', true);
  const unknown = await session({ t: 'adminInviter', name: 'nobody', on: true });
  check(unknown.errors.includes('auth.cli.unknown'), `Granting an unknown account gives no clear answer (${JSON.stringify(unknown.errors)})`);
  const granted = await session({ t: 'adminInviter', name: 'mate', on: true });
  check(granted.data?.accounts.find(a => a.name === 'mate')?.inviter && getUser('mate').inviter,
    'The admin cannot grant the inviter role');
  const adminsOwn = (await session({ t: 'adminInvite', note: 'by the admin' })).invite;

  const made = await session({ t: 'inviteCreate', note: 'from mate' }, mate);
  check(made.hello?.inviter === true, 'hello does not tell the inviter');
  const token = made.created?.token;
  check(token && await peek(token) === 200, 'The inviter gets no working link');
  const mine = made.mine?.invites || [];
  check(mine.length === 1 && mine[0].note === 'from mate' && mine[0].by === 'mate',
    `The inviter does not see exactly their own invites (${JSON.stringify(mine)})`);
  check(!JSON.stringify(made.mine).includes(token), 'The invite list shows the token');
  const overview = await session({ t: 'admin' });
  check(overview.data?.invites.some(i => i.id === made.created.invite.id), 'The admin does not see the inviter\'s invite');

  // Someone else's invite: not visible, not revocable.
  await session({ t: 'inviteRevoke', id: adminsOwn.invite.id }, mate);
  check(await peek(adminsOwn.token) === 200, 'An inviter can revoke someone else\'s invite');
  const second = await session({ t: 'inviteCreate' }, mate);
  const gone = await session({ t: 'inviteRevoke', id: second.created.invite.id }, mate);
  check(!gone.mine?.invites.some(i => i.id === second.created.invite.id) && await peek(second.created.token) === 404,
    'The inviter cannot revoke their own invite');

  // Taking the role away: the open tab hears it, the open link dies.
  const tab = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: mate } });
  let roles = null;
  tab.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'roles') roles = m; });
  await new Promise(r => tab.on('open', r));
  await wait(100);
  await session({ t: 'adminInviter', name: 'mate', on: false });
  for (let i = 0; i < 40 && !roles; i++) await wait(50);
  check(roles?.inviter === false, `The open tab is not told the role is gone (${JSON.stringify(roles)})`);
  tab.close();
  check(!getUser('mate').inviter, 'The inviter role stays after revoking');
  check(await peek(token) === 404, 'A link of a former inviter still works');
  check(await peek(adminsOwn.token) === 200, 'Revoking an inviter takes the admin\'s links along');
  const after = await session({ t: 'inviteCreate' }, mate);
  check(after.errors.includes('err.notInviter') && !after.created, 'A former inviter can still create invites');

  await session({ t: 'adminRevokeInvite', id: adminsOwn.invite.id });
  setAdmin('captain', false);
  deleteUser('mate');
  console.log('Inviter role: granted and taken by an admin, own invites only, links end with the role.');
}

// --- Blocking and deleting from the admin panel. A blocked account still
//     signs in, but may do nothing except write to the admins; admins can
//     be neither blocked nor deleted.
{
  await addUser('outcast', 'outcastPassword1', { mustChange: false });
  const login = await fetch(`${BASE}/api/auth/login`, asJson({ user: 'outcast', password: 'outcastPassword1' }));
  const outcast = login.headers.get('set-cookie')?.split(';')[0];
  setAdmin('captain', true);
  /** The account's own HTTP routes, with its cookie. */
  const api = (route, data, method = 'POST', jar = outcast) => fetch(`${BASE}/api/auth/${route}`, {
    method, headers: { cookie: jar, ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined
  });

  // Not blocked: nothing to appeal, the menu works as usual.
  const free = await session({ t: 'appeal', text: 'hello?' }, outcast);
  check(!free.hello?.blocked && free.errors.includes('err.notBlocked'), 'An account that is not blocked can write appeals');

  // An inviter that gets blocked loses their open links along with everything else.
  setInviter('outcast', true);
  const link = (await session({ t: 'inviteCreate' }, outcast)).created?.token;
  check(link && peekInvite(link), 'The account to be blocked cannot create a link');

  // A tab open at the moment of the block is closed and starts over.
  const tab = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: outcast } });
  const tabMsgs = [];
  let closedWith = null;
  tab.on('message', (raw) => tabMsgs.push(JSON.parse(raw.toString())));
  tab.on('close', (code) => { closedWith = code; });
  await new Promise(r => tab.on('open', r));
  await wait(100);

  const block = await session({ t: 'adminBlock', name: 'outcast', on: true });
  check(block.data?.accounts.find(a => a.name === 'outcast')?.blocked && getUser('outcast').blocked,
    'The admin cannot block an account');
  for (let i = 0; i < 40 && closedWith === null; i++) await wait(50);
  check(closedWith === 4003, `The open tab of a blocked account stays connected (${closedWith})`);
  check(!peekInvite(link), 'A link of a blocked inviter still works');

  const inside = await session({ t: 'list' }, outcast);
  check(inside.hello?.blocked && inside.hello.openGames.length === 0 && Array.isArray(inside.hello.appeal),
    `hello does not tell the block (${JSON.stringify(inside.hello?.blocked)})`);
  // Every message the server knows - read from its source, so a future one
  // that forgets the check fails here - plus some it does not, with a payload
  // that would do something for anyone else. Each gets the refusal and
  // nothing else, and neither the account nor the games change.
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const types = [...new Set([...source.matchAll(/case '([A-Za-z]+)'/g)].map(m => m[1]))]
    .filter(t => t !== 'appeal').concat('nonsense', '__proto__', 'constructor', 'toString');
  check(types.length > 40, `Message types not found in the source (${types.length})`);
  const record = JSON.stringify(getUser('outcast'));
  const gamesBefore = (await session({ t: 'admin' })).data?.games.length;
  for (const t of types) {
    const tried = await new Promise((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: outcast } });
      const got = [];
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.t === 'hello') {
          return ws.send(JSON.stringify({
            t, code: 'ABCD', token: 'x', name: 'Hacker', nick: 'Hacker', handle: 'ABCDEF', text: 'x', id: 'x', note: 'x',
            on: true, accept: true, settings: { maxTurns: 5 }, color: 1, level: 'hard', paused: false, ms: 120
          }));
        }
        got.push(m);
      });
      setTimeout(() => { ws.close(); ok(got); }, 300);
    });
    check(tried.length === 1 && tried[0].t === 'error' && tried[0].key === 'err.blocked',
      `A blocked account gets through '${t}' (${JSON.stringify(tried).slice(0, 160)})`);
  }
  check(JSON.stringify(getUser('outcast')) === record, 'A blocked account changed its own account');
  check((await session({ t: 'admin' })).data?.games.length === gamesBefore, 'A blocked account changed the games');

  // Nor does anything reach it: no friends list on the regular push, no
  // friend request someone sends it - a socket that only listens gets nothing.
  const quiet = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: outcast } });
  const heard = [];
  quiet.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t !== 'hello') heard.push(m.t); });
  await new Promise(r => quiet.on('open', r));
  await session({ t: 'friendRequest', handle: getUser('outcast').handle });
  await wait(3500);
  quiet.close();
  check(!heard.length, `A blocked account still hears from the instance (${heard})`);

  // Over HTTP: who it is and signing out, nothing else.
  check((await api('me', null, 'GET')).status === 200, 'A blocked account cannot ask who it is');
  check((await api('key', null, 'GET')).status === 403, 'A blocked account reads its message key');
  check((await api('key', { password: 'outcastPassword1', e2e: {} })).status === 403, 'A blocked account stores a message key');
  check((await api('change', { password: 'outcastPassword1', newPassword: 'outcastPassword9' })).status === 403
    && await verifyUser('outcast', 'outcastPassword1'), 'A blocked account changes its password');
  check((await api('delete', { password: 'outcastPassword1' })).status === 403 && getUser('outcast'),
    'A blocked account deletes itself');

  // The line to the admins - both ways.
  const asked = await session({ t: 'appeal', text: '  Why was I blocked?  ' }, outcast);
  check(asked.appeal?.msgs.length === 1 && asked.appeal.msgs[0].mine && asked.appeal.msgs[0].text === 'Why was I blocked?',
    `The blocked account cannot write to the admins (${JSON.stringify(asked.appeal)})`);
  const tooLong = await session({ t: 'appeal', text: 'x'.repeat(501) }, outcast);
  check(tooLong.errors.includes('err.badAppeal'), 'An overlong appeal is accepted');
  const seen = await session({ t: 'admin' });
  const thread = seen.data?.accounts.find(a => a.name === 'outcast')?.appeal || [];
  check(thread.length === 1 && thread[0].from === 'user', `The admins do not see the appeal (${JSON.stringify(thread)})`);

  // A line, not a flood: five in a row, then the admins have to answer first.
  for (let i = 2; i <= 5; i++) {
    const more = await session({ t: 'appeal', text: `Message ${i}` }, outcast);
    check(more.appeal?.msgs.length === i, `Appeal ${i} of 5 is refused (${JSON.stringify(more.errors)})`);
  }
  const flood = await session({ t: 'appeal', text: 'Message 6' }, outcast);
  check(flood.errors.includes('err.appealWait') && appealsOf('outcast').length === 5, 'A blocked account can flood the admins');

  const listening = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: outcast } });
  let answer = null;
  listening.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'appealData') answer = m; });
  await new Promise(r => listening.on('open', r));
  await wait(100);
  await session({ t: 'adminAppeal', name: 'outcast', text: 'Spamming the chat.' });
  for (let i = 0; i < 40 && !answer; i++) await wait(50);
  const last = answer?.msgs.at(-1);
  check(last && !last.mine && last.by === 'captain' && last.text === 'Spamming the chat.',
    `The blocked account does not get the admin's answer (${JSON.stringify(answer)})`);
  listening.close();
  const afterAnswer = await session({ t: 'appeal', text: 'Sorry.' }, outcast);
  check(afterAnswer.appeal && !afterAnswer.errors.length, 'After an answer the blocked account cannot write again');

  // Admins - oneself included - are off limits.
  for (const t of ['adminBlock', 'adminDelete']) {
    const tried = await session({ t, name: 'captain', on: true });
    check(tried.errors.includes('err.targetAdmin') && !tried.data, `'${t}' works on an admin`);
  }
  check(getUser('captain') && !getUser('captain').blocked, 'The admin blocked or deleted themselves');

  // Lifting the block: back to normal.
  await session({ t: 'adminBlock', name: 'outcast', on: false });
  const back = await session({ t: 'list' }, outcast);
  check(!back.hello?.blocked && back.games && !back.errors.length, 'After lifting the block the account still cannot play');

  // Deleting: two clicks in the panel, one message on the wire.
  const del = await session({ t: 'adminDelete', name: 'outcast' });
  check(!del.data?.accounts.some(a => a.name === 'outcast') && !getUser('outcast'), 'The admin cannot delete an account');
  check(!appealsOf('outcast').length, 'The thread with the admins outlives the account');
  const gone = await session({ t: 'list' }, outcast);
  check(!gone.hello, 'The session of a deleted account still opens a socket');

  setAdmin('captain', false);
  console.log('Blocking: only a line to the admins, open tabs restart, admins off limits; deleting takes everything along.');
}

// --- Blocked without the panel (users.js, while the player is in a game):
//     from the next message on everything is refused, the connection is
//     closed within moments and the seat is given up - and only a first
//     password that has to be replaced may still be changed.
{
  await addUser('rogue', 'roguePassword1', { mustChange: false });
  const signIn = async (password) => (await fetch(`${BASE}/api/auth/login`, asJson({ user: 'rogue', password })))
    .headers.get('set-cookie')?.split(';')[0];
  let jar = await signIn('roguePassword1');
  setAdmin('captain', true);

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: jar } });
  const msgs = [];
  let joined = null, closedWith = null;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    msgs.push(m);
    if (m.t === 'hello') ws.send(JSON.stringify({ t: 'create', name: 'x' }));
    if (m.t === 'joined') { joined = m; ws.send(JSON.stringify({ t: 'addBot' })); ws.send(JSON.stringify({ t: 'start' })); }
  });
  ws.on('close', (code) => { closedWith = code; });
  for (let i = 0; i < 60 && !msgs.some(m => m.t === 'view'); i++) await wait(50);
  check(joined && msgs.some(m => m.t === 'view'), 'The game for the block test does not start');

  setBlocked('rogue', true);                       // as users.js does it: nobody is told
  const before = msgs.length;
  ws.send(JSON.stringify({ t: 'chat', text: 'still here' }));
  ws.send(JSON.stringify({ t: 'ready' }));
  for (let i = 0; i < 60 && closedWith === null; i++) await wait(50);
  const answers = msgs.slice(before).filter(m => m.t === 'error');
  check(answers.length >= 1 && answers.every(m => m.key === 'err.blocked'),
    `Messages right after a block from outside go through (${JSON.stringify(answers)})`);
  check(!msgs.slice(before).some(m => m.t === 'chat' && JSON.stringify(m).includes('still here')), 'The blocked player still chats');
  check(closedWith === 4003, `A block from outside leaves the connection open (${closedWith})`);
  const game = (await session({ t: 'admin' })).data?.games.find(g => g.id === joined?.code);
  check(game && !game.players.find(p => p.account)?.connected, 'The blocked player still holds the seat');

  const back = await session({ t: 'resume', code: joined?.code, token: joined?.token }, jar);
  check(back.hello?.blocked && !back.hello.mySeats.length && back.errors.includes('err.blocked'),
    'A blocked player gets the seat back');

  // A first password still has to be replaced to get as far as the dialog.
  await setPassword('rogue', 'roguePassword2', { mustChange: true });
  jar = await signIn('roguePassword2');
  const changed = await fetch(`${BASE}/api/auth/change`, {
    method: 'POST', headers: { cookie: jar, 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'roguePassword2', newPassword: 'roguePassword3' })
  });
  check(changed.status === 200, `A blocked account cannot replace its first password (${changed.status})`);
  jar = changed.headers.get('set-cookie')?.split(';')[0] || jar;
  check((await session({ t: 'list' }, jar)).hello?.blocked, 'After the first password the block is gone');

  // Lifted from outside too: the open connection starts over.
  const open = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: jar } });
  let reopened = null;
  open.on('close', (code) => { reopened = code; });
  await new Promise(r => open.on('open', r));
  await wait(100);
  setBlocked('rogue', false);
  for (let i = 0; i < 60 && reopened === null; i++) await wait(50);
  check(reopened === 4003, `Lifting a block from outside leaves the blocked connection open (${reopened})`);

  deleteUser('rogue');
  setAdmin('captain', false);
  console.log('Blocked from outside: refused from the next message, connection closed, seat given up.');
}

// --- Deleting your own account (right to erasure): only with a session and
//     the current password, the profile image goes with it, every session
//     ends - and the last admin cannot leave the server without one.
{
  const signIn = async (user, password) => {
    const r = await fetch(`${BASE}/api/auth/login`, asJson({ user, password }));
    return r.headers.get('set-cookie')?.split(';')[0] || null;
  };
  const del = (jar, data, type = 'application/json') => fetch(`${BASE}/api/auth/delete`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': type, ...(jar ? { cookie: jar } : {}) },
    body: type === 'application/json' ? JSON.stringify(data) : new URLSearchParams(data).toString()
  });

  await addUser('leaver', 'leaverPassword1', { mustChange: false });
  const jar = await signIn('leaver', 'leaverPassword1');
  const avatars = path.join(dir, 'avatars');
  fs.mkdirSync(avatars, { recursive: true });
  fs.writeFileSync(path.join(avatars, 'leaver.png'), 'not really a picture');

  check((await del(null, { password: 'leaverPassword1' })).status === 401, 'An account can be deleted without a session');
  check((await del(jar, { password: 'wrong' })).status === 401 && getUser('leaver'), 'A wrong password deletes the account');
  check((await del(jar, {})).status === 401 && getUser('leaver'), 'Deleting works without any password');
  check((await del(jar, { password: 'leaverPassword1' }, 'application/x-www-form-urlencoded')).status === 400 && getUser('leaver'),
    'A form from a foreign page deletes the account');

  const gone = await del(jar, { password: 'leaverPassword1' });
  check(gone.status === 200, `Deleting with the right password fails (${gone.status})`);
  check(!getUser('leaver'), 'The account is still in the account file');
  check(!fs.existsSync(path.join(avatars, 'leaver.png')), 'The profile image outlives the account');
  check(/Max-Age=0/i.test(gone.headers.get('set-cookie') || ''), 'The session cookie is not cleared');
  const after = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: jar } });
  check(after.status === 401, 'The session of the deleted account still works');

  // Nobody deletes anyone else - whatever the request names. The account
  // always comes from the session, the body only carries the password.
  {
    await addUser('alice', 'alicePassword1', { mustChange: false });
    await addUser('bob', 'bobPassword123', { mustChange: false });
    const alice = await signIn('alice', 'alicePassword1');
    const bob = await signIn('bob', 'bobPassword123');
    // Alice's session with Bob's password, naming Bob in several ways. Few
    // tries only: from the sixth failure on the lockout would answer instead.
    for (const extra of [{ user: 'bob' }, { name: 'bob' }, { account: 'bob' }]) {
      const r = await del(alice, { password: 'bobPassword123', ...extra });
      check(r.status === 401 && getUser('bob') && getUser('alice'), `Alice deletes with Bob's password (${JSON.stringify(extra)})`);
    }
    // Without a session, with Bob's name and password: no way in either
    const anon = await del(null, { user: 'bob', password: 'bobPassword123' });
    check(anon.status === 401 && getUser('bob'), 'Bob is deleted without any session');
    // A WebSocket offers no way at all - not even for something that looks like one
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: alice } });
    await new Promise(r => sock.on('message', r));
    for (const t of ['delete', 'deleteUser', 'deleteAccount', 'adminDelete', 'adminDeleteUser', 'removeUser'])
      sock.send(JSON.stringify({ t, user: 'bob', name: 'bob', account: 'bob', password: 'alicePassword1' }));
    await wait(300);
    sock.close();
    check(getUser('bob'), 'A WebSocket message deletes Bob');
    // With her own password, naming Bob: only Alice goes
    const own = await del(alice, { password: 'alicePassword1', user: 'bob', name: 'bob' });
    check(own.status === 200 && !getUser('alice') && getUser('bob'), 'Naming Bob in her own deletion takes Bob along');
    const bobStill = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: bob } });
    check(bobStill.status === 200, "Bob's session ends when Alice deletes herself");
    deleteUser('bob');
  }

  // Admins never delete themselves - not even with another admin around.
  await addUser('anadmin', 'anAdminPass12', { mustChange: false });
  setAdmin('anadmin', true);
  setAdmin('captain', true);
  const adminJar = await signIn('anadmin', 'anAdminPass12');
  const refused = await del(adminJar, { password: 'anAdminPass12' });
  const body = await refused.json().catch(() => ({}));
  check(refused.status === 403 && body.error === 'auth.err.adminDelete' && getUser('anadmin'), 'An admin can delete themselves');
  setAdmin('captain', false);
  deleteUser('anadmin');
  console.log('Own account: deleted only with session and password, image and sessions gone, never for admins, never anyone else.');
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
