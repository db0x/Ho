// CB radio: what the server does for it - and what it must not do.
// It is a server option, the game leader opens it per game, it needs two
// people at least. Then the server answers STUN, passes on the connection
// setup only between players on the radio, and hands out the channel one
// speaker at a time. The audio
// itself never comes near it, so there is nothing to test here for that.
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { bindingResponse } from '../server/stun.js';

let errors = 0;
const check = (cond, msg) => { if (!cond) { console.error('ERROR: ' + msg); errors++; } return cond; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(20); }
  return false;
};

const COOKIE = 0x2112a442;
function bindingRequest(extra = 0) {
  const b = Buffer.alloc(20 + extra);
  b.writeUInt16BE(0x0001, 0);
  b.writeUInt16BE(extra, 2);
  b.writeUInt32BE(COOKIE, 4);
  crypto.randomBytes(12).copy(b, 8);
  return b;
}
/** The address in a Binding Success, decoded again. */
function mapped(res) {
  const family = res.readUInt8(25);
  const port = res.readUInt16BE(26) ^ (COOKIE >>> 16);
  const key = Buffer.concat([Buffer.alloc(4), res.subarray(8, 20)]);
  key.writeUInt32BE(COOKIE, 0);
  const ip = [...res.subarray(28, 28 + (family === 1 ? 4 : 16))].map((b, i) => b ^ key[i]);
  return { family, port, ip: family === 1 ? ip.join('.') : ip };
}

// ------------------------------------------------------------ STUN, offline
{
  const req = bindingRequest();
  const res = bindingResponse(req, '203.0.113.7', 54321, 'IPv4');
  check(res && res.readUInt16BE(0) === 0x0101, 'No Binding Success for a Binding Request');
  check(res && res.subarray(8, 20).equals(req.subarray(8, 20)), 'Answer does not carry the transaction id');
  const m = res && mapped(res);
  check(m?.ip === '203.0.113.7' && m.port === 54321, `Wrong address in the answer (${JSON.stringify(m)})`);
  const v6 = bindingResponse(req, '2001:db8::1', 4000, 'IPv6');
  const m6 = v6 && mapped(v6);
  check(m6?.family === 2 && m6.port === 4000 && m6.ip[0] === 0x20 && m6.ip[1] === 0x01 && m6.ip[15] === 1,
    'IPv6 address not answered correctly');
  check(!bindingResponse(Buffer.from('hello world, no stun'), '1.2.3.4', 1, 'IPv4'), 'Junk gets an answer');
  const wrongType = bindingRequest(); wrongType.writeUInt16BE(0x0003, 0);   // TURN Allocate
  check(!bindingResponse(wrongType, '1.2.3.4', 1, 'IPv4'), 'A TURN request gets an answer - there is no relay');
  check(!bindingResponse(bindingRequest().subarray(0, 19), '1.2.3.4', 1, 'IPv4'), 'A cut-off packet gets an answer');
  console.log('STUN: Binding answered with the sender address (v4, v6), everything else dropped.');
}

// ------------------------------------------------------------- the server
const PORT = 8711 + Math.floor(Math.random() * 300);
const STUN = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HO_AUTH: 'off', HO_VOICE: 'on', HO_STUN_PORT: String(STUN) },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));
await new Promise(r => server.stdout.on('data', d => { if (/STUN on UDP/.test(d)) r(); }));

{
  const sock = dgram.createSocket('udp4');
  await new Promise(r => sock.bind(0, '127.0.0.1', r));
  const got = [];
  sock.on('message', m => got.push(m));
  sock.send(Buffer.from('junk'), STUN, '127.0.0.1');
  sock.send(bindingRequest(), STUN, '127.0.0.1');
  await until(() => got.length);
  await wait(100);
  const m = got[0] && mapped(got[0]);
  check(got.length === 1, `Expected exactly one answer, got ${got.length}`);
  check(m?.ip === '127.0.0.1' && m.port === sock.address().port, `STUN names the wrong address (${JSON.stringify(m)})`);
  sock.close();
  console.log(`STUN on UDP ${STUN}: the server tells a browser its own address, nothing more.`);
}

function client() {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = { ws, msgs: [], send: m => ws.send(JSON.stringify(m)) };
    c.last = (t) => c.msgs.filter(m => m.t === t).at(-1);
    c.all = (t) => c.msgs.filter(m => m.t === t);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      c.msgs.push(m);
      if (m.t === 'hello') { c.hello = m; ok(c); }
      if (m.t === 'joined') c.id = m.playerId;
    });
  });
}

const a = await client(), b = await client(), q = await client();
check(a.hello.voice?.stun?.port === STUN, `hello does not name the STUN port (${JSON.stringify(a.hello.voice)})`);
a.send({ t: 'create', name: 'Alpha' });
await until(() => a.id);
const code = a.msgs.find(m => m.t === 'joined').code;
b.send({ t: 'join', code, name: 'Bravo' });
q.send({ t: 'join', code, name: 'Quiet' });
await until(() => b.id && q.id);
a.send({ t: 'addBot' });
await wait(100);
const botId = a.last('lobby')?.lobby?.players?.find(p => p.isBot)?.id;

// Before the start there are no comms.
a.send({ t: 'voice', on: true });
await wait(150);
check(!a.last('voice'), 'Comms can be switched on in the lobby');
a.send({ t: 'start' });
await until(() => a.last('view') && b.last('view'));

// --- Closed until the game leader opens it
a.send({ t: 'voice', on: true });
await until(() => a.last('voice'));
check(a.last('voice')?.allowed === false && !a.last('voice').peers.length, 'Radio can be switched on before the game leader opens it');
b.send({ t: 'voiceAllow', on: true });
await until(() => b.last('error'));
check(b.last('error')?.key === 'err.voiceHostOnly', 'Someone other than the game leader can open the radio');
check(!b.all('voice').some(m => m.allowed), 'The radio is open after a refused request');
a.send({ t: 'voiceAllow', on: true });
await until(() => b.last('voice')?.allowed && q.last('voice')?.allowed);
check(b.last('voice')?.allowed === true, 'Opening the radio does not reach the others');
check(b.all('chat').some(m => m.key === 'chat.voiceOn'), 'Nobody is told that the radio was opened');
console.log('Opening: only the game leader, and everyone is told.');

// --- Switching on
a.send({ t: 'voice', on: true });
b.send({ t: 'voice', on: true });
await until(() => b.last('voice')?.peers.length === 2 && a.last('voice')?.peers.length === 2);
const peers = b.last('voice').peers;
check(peers.some(p => p.id === a.id) && peers.some(p => p.id === b.id), 'Comms do not list both players');
check(peers.every(p => /^[0-9a-f]{12}$/.test(p.n)), 'Peers carry no nonce');
check(q.last('voice')?.peers.length === 2, 'A player off the comms does not see who is on');
const nA = peers.find(p => p.id === a.id).n;
console.log('Comms: switched on only in a running game, everyone in it sees who is on.');

// --- Connection setup goes only where it should
a.send({ t: 'rtc', to: b.id, data: { type: 'offer', sdp: 'v=0 test', tn: 'x' } });
await until(() => b.last('rtc'));
const r = b.last('rtc');
check(r?.from === a.id && r.n === nA && r.data?.sdp === 'v=0 test', `Offer not passed on intact (${JSON.stringify(r)})`);
a.send({ t: 'rtc', to: q.id, data: { sdp: 'to someone off the comms' } });
a.send({ t: 'rtc', to: botId, data: { sdp: 'to a bot' } });
a.send({ t: 'rtc', to: a.id, data: { sdp: 'to myself' } });
a.send({ t: 'rtc', to: b.id, data: { sdp: 'x'.repeat(17 * 1024) } });
q.send({ t: 'rtc', to: b.id, data: { sdp: 'from someone off the comms' } });
await wait(250);
check(!q.last('rtc'), 'A player off the comms gets connection data');
check(!a.last('rtc'), 'A message to oneself or to a bot comes back');
check(b.all('rtc').length === 1, `Oversized or unauthorized data reached Bravo (${b.all('rtc').length})`);
console.log('Connection setup: only between players on the comms, size-limited, never to bots.');

// --- Push to talk
a.send({ t: 'ptt', on: true });
await until(() => b.last('voice')?.floor === a.id);
check(b.last('voice').floor === a.id && q.last('voice')?.floor === a.id, 'Not everyone hears that Alpha is on air');
const bBefore = b.all('voice').length, qBefore = q.all('voice').length;
b.send({ t: 'ptt', on: true });
await until(() => b.all('voice').length > bBefore);
check(b.last('voice').floor === a.id, 'Bravo takes the channel while Alpha speaks');
await wait(100);
check(q.all('voice').length === qBefore, 'A refused request is broadcast');
q.send({ t: 'ptt', on: true });
await wait(150);
check(b.last('voice').floor === a.id, 'A player off the comms can take the channel');
b.send({ t: 'ptt', on: false });
await wait(150);
check(b.last('voice').floor === a.id, 'Bravo can free a channel Alpha holds');
a.send({ t: 'ptt', on: false });
await until(() => b.last('voice')?.floor === null);
check(b.last('voice').floor === null, 'Releasing does not free the channel');
b.send({ t: 'ptt', on: true });
await until(() => a.last('voice')?.floor === b.id);
check(a.last('voice').floor === b.id, 'The free channel is not handed to the next speaker');
console.log('Push to talk: one at a time, first come first served, only the speaker lets go.');

// --- Lost connection while on air: channel free, peer gone
b.ws.close();
await until(() => a.last('voice')?.floor === null && a.last('voice')?.peers.length === 1);
check(a.last('voice').floor === null, 'A lost speaker keeps the channel');
check(!a.last('voice').peers.some(p => p.id === b.id), 'A lost player stays on the comms');
console.log('Lost connection: the channel becomes free, the player leaves the comms.');

// --- A spectator has no comms at all
{
  const s = await client();
  s.send({ t: 'watch', bots: 2 });
  await until(() => s.last('view'));
  s.send({ t: 'voice', on: true });
  s.send({ t: 'rtc', to: 'p1', data: { sdp: 'x' } });
  s.send({ t: 'ptt', on: true });
  await wait(200);
  check(!s.last('voice') && !s.last('rtc'), 'A spectator takes part in the comms');
  s.ws.close();
}

// --- Closing takes everyone off the radio
a.send({ t: 'voiceAllow', on: false });
await until(() => a.last('voice')?.allowed === false);
check(a.last('voice').allowed === false && !a.last('voice').peers.length, 'Closing leaves players on the radio');
a.send({ t: 'voice', on: true });
a.send({ t: 'ptt', on: true });
await wait(150);
check(!a.last('voice').peers.length && a.last('voice').floor === null, 'Radio usable after closing');
console.log('Closing: everyone off, no switching on again until it is opened.');

// --- Chosen in the lobby: open from the first turn
{
  const h = await client(), g = await client();
  h.send({ t: 'create', name: 'Host', settings: { voice: true } });
  await until(() => h.id);
  g.send({ t: 'join', code: h.msgs.find(m => m.t === 'joined').code, name: 'Guest' });
  await until(() => g.last('lobby'));
  check(g.last('lobby')?.lobby?.settings?.voice === true, 'The lobby does not show the CB radio setting');
  h.send({ t: 'start' });
  await until(() => g.last('voice'));
  check(g.last('voice')?.allowed === true, 'CB radio chosen in the lobby is not open after the start');
  for (const c of [h, g]) c.ws.close();
  console.log('Lobby setting: CB radio chosen there is open from the first turn.');
}

// --- Alone against the AI (the quick game) there is no radio
{
  const solo = await client();
  solo.send({ t: 'create', name: 'Solo' });
  await until(() => solo.id);
  solo.send({ t: 'addBot' });
  await wait(80);
  solo.send({ t: 'start' });
  await until(() => solo.last('view'));
  solo.send({ t: 'voiceAllow', on: true });
  solo.send({ t: 'voice', on: true });
  await wait(200);
  check(!solo.last('voice'), 'A game with one person has CB radio');
  solo.ws.close();
  console.log('Quick game (one person against the AI): no CB radio.');
}

for (const c of [a, q]) c.ws.close();
server.kill();

// --- Without HO_VOICE the server has no radio at all
{
  const P2 = PORT + 1;
  const off = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(P2), HO_AUTH: 'off', HO_VOICE: '', HO_STUN_PORT: String(STUN) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  off.stdout.on('data', d => { out += d; });
  await until(() => out.includes('running on'));
  await wait(200);
  const hello = await new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${P2}`);
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'hello') { ws.close(); ok(m); } });
  });
  check(hello.voice === null, `Without HO_VOICE the client is offered radio (${JSON.stringify(hello.voice)})`);
  check(!out.includes('STUN'), 'Without HO_VOICE STUN starts anyway');
  off.kill();
  console.log('Server option: without HO_VOICE no STUN, no radio in the client.');
}
if (errors) { console.error(`\n${errors} voice problems.`); process.exit(1); }
console.log('\nAll voice checks passed.');
process.exit(0);
