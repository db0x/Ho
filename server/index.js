// The server: static files over HTTP, the WebSocket the game runs on
// (server/hub/), and starting it all up.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import * as friends from './friends.js';
import { handleAuth, gate, checkUpgrade, authEnabled } from './auth.js';
import { DEV } from './hub/dev.js';
import { attach, startTimers } from './hub/hub.js';
import { VERSION } from './hub/news.js';
import { startVoice } from './hub/voice.js';
import { handleAvatar } from './profile.js';
import { ensureHandles, userFile, listUsers } from './userstore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8080;
const VERSION_MARK = /__HO_VERSION__/g;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // Decode first, then normalize - and in this order: an encoded slash (%2f)
  // survives the URL parser and would otherwise only become a separator after
  // all checks, e.g. with /css/..%2f..%2f.
  let rel;
  try { rel = path.posix.normalize(decodeURIComponent(url.pathname)); } catch { rel = ''; }
  if (!rel.startsWith('/') || rel.includes('\0')) { res.writeHead(400).end('bad path'); return; }
  if (rel === '/') rel = '/index.html';
  // Access control before anything else: first its own endpoints, then the gate.
  // Without a session there is only the sign-in page and what it needs to display.
  if (handleAuth(req, res, rel)) return;
  if (!gate(req, res, rel)) return;
  if (handleAvatar(req, res, rel)) return;
  // /shared/* comes from the shared directory, everything else from /client
  const base = rel.startsWith('/shared/') ? ROOT : path.join(ROOT, 'client');
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(ext === '.html' ? data.toString('utf8').replace(VERSION_MARK, VERSION) : data);
  });
});

// The largest legitimate message is a profile image (AVATAR_MAX, base64
// encoded); the library default of 100 MB would let anyone tie up memory.
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const session = checkUpgrade(req);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, session));
});

attach(wss);
startTimers();

server.listen(PORT, async () => {
  console.log(`Ho!! running on http://localhost:${PORT}`);
  // Before anything else: accounts from before handles existed get theirs now.
  try {
    const n = ensureHandles();
    if (n) console.log(`Accounts: handle assigned to ${n} account(s) (${userFile()})`);
    // Accounts deleted on the command line take their friendships along.
    friends.purge(listUsers().map(u => u.name));
    const expired = friends.expire();
    if (expired) console.log(`Friends: ${expired} message(s) older than 14 days deleted`);
  } catch (e) {
    console.error('Accounts: could not assign handles -', e.message);
  }
  if (DEV) console.warn(`Dev mode: ON (HO_DEV) - testing aids for ${authEnabled() ? 'admins' : 'everyone'}.`);
  await startVoice();
  if (!authEnabled()) {
    console.warn('Access: DISABLED (HO_AUTH=off) - anyone with the URL can play.');
    return;
  }
  try {
    const n = listUsers().length;
    console.log(`Access: sign-in active, accounts: ${n} (${userFile()})`);
    if (!n) console.warn('No account yet. Create one with: node server/users.js add <name>');
  } catch (e) {
    console.error('Access: account file unreadable -', e.message);
  }
});
