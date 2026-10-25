// Minimal STUN responder (RFC 5389, Binding only) for the voice comms.
//
// Browsers ask it once per connection setup "from which address do you see
// me?" and offer that address to the other player - the audio itself then
// flows directly between the browsers, never through here. No relay (TURN),
// no state, no logs of who asked: one packet in, one packet out.
import dgram from 'node:dgram';

const COOKIE = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const XOR_MAPPED_ADDRESS = 0x0020;

/**
 * The answer to a Binding Request from `address:port`, or null if `msg` is
 * not one (anything else is dropped without a reply).
 */
export function bindingResponse(msg, address, port, family) {
  if (msg.length < 20 || msg.readUInt16BE(0) !== BINDING_REQUEST || msg.readUInt32BE(4) !== COOKIE) return null;
  if (msg.readUInt16BE(2) !== msg.length - 20) return null;
  const txid = msg.subarray(8, 20);
  const v6 = family === 'IPv6' || family === 6;
  const ip = v6 ? ipv6Bytes(address) : Buffer.from(address.split('.').map(Number));
  if (!ip || ip.length !== (v6 ? 16 : 4)) return null;
  // XOR with the cookie (and for IPv6 with the transaction id too), so
  // middleboxes that rewrite addresses in packets leave it alone.
  const key = Buffer.concat([Buffer.alloc(4), txid]);
  key.writeUInt32BE(COOKIE, 0);
  const xip = Buffer.from(ip.map((b, i) => b ^ key[i]));
  const attr = Buffer.alloc(8 + xip.length);
  attr.writeUInt16BE(XOR_MAPPED_ADDRESS, 0);
  attr.writeUInt16BE(4 + xip.length, 2);
  attr.writeUInt8(v6 ? 2 : 1, 5);
  attr.writeUInt16BE(port ^ (COOKIE >>> 16), 6);
  xip.copy(attr, 8);
  const head = Buffer.alloc(20);
  head.writeUInt16BE(BINDING_SUCCESS, 0);
  head.writeUInt16BE(attr.length, 2);
  head.writeUInt32BE(COOKIE, 4);
  txid.copy(head, 8);
  return Buffer.concat([head, attr]);
}

function ipv6Bytes(address) {
  const [head, tail = ''] = address.split('%')[0].split('::');
  const part = s => s ? s.split(':') : [];
  const a = part(head), b = part(tail);
  const groups = address.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  if (groups.length !== 8) return null;
  const out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(parseInt(g, 16) || 0, i * 2));
  return out;
}

/**
 * Listens on `port` (IPv4 and, where available, IPv6). Resolves with the
 * port once at least one socket is bound, null if none could be - the game
 * runs without it, the comms then only reach players in the same network.
 */
export function startStun(port) {
  const open = (type) => new Promise((ok) => {
    const sock = dgram.createSocket({ type, ipv6Only: type === 'udp6' });
    sock.on('message', (msg, r) => {
      const res = bindingResponse(msg, r.address, r.port, r.family);
      if (res) sock.send(res, r.port, r.address);
    });
    sock.once('error', (e) => { sock.close(); ok(e); });
    sock.bind(port, () => ok(null));
  });
  return Promise.all([open('udp4'), open('udp6')]).then(([e4, e6]) => {
    if (e4 && e6) { console.warn(`CB radio: STUN on UDP ${port} not available (${e4.code})`); return null; }
    return port;
  });
}
