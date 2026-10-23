// WebSocket connection with automatic reconnect.
export class Net {
  constructor() {
    this.handlers = new Map();
    this.queue = [];
    this.ws = null;
    this.session = loadSession();
    this.connect();
  }

  connect() {
    // Relative to the page so it also works under a subpath (/ho/).
    const url = new URL('.', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.ws = new WebSocket(url);
    let opened = false;
    this.ws.onopen = () => {
      opened = true;
      this.failures = 0;
      this.emit('open');
      if (this.session?.code && this.session?.token) {
        this.send({ t: 'resume', code: this.session.code, token: this.session.token });
      }
      for (const m of this.queue.splice(0)) this.ws.send(JSON.stringify(m));
    };
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'joined') {
        this.session = { code: msg.code, token: msg.token, playerId: msg.playerId };
        saveSession(this.session);
      }
      // The seat is gone (game removed, server restarted): forget it so the
      // next connect does not try to resume it again.
      if (msg.t === 'kicked' || msg.t === 'ended' || (msg.t === 'error' && STALE_SESSION.includes(msg.key))) {
        clearSession();
        this.session = null;
      }
      this.emit(msg.t, msg);
      this.emit('*', msg);
    };
    this.ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      // Only losing a working connection is news - failed retries stay
      // silent, otherwise every attempt brings another toast.
      if (opened) this.emit('close');
      else this.failures = (this.failures || 0) + 1;
      if (!opened || ev.code === 4001) this.checkSession();
      clearTimeout(this._retry);
      this._retry = setTimeout(() => this.connect(), 1500 * 2 ** Math.min(this.failures || 0, 3));
    };
    this.ws.onerror = () => {};
  }

  // Without a valid session (expired, revoked, server restarted) the upgrade
  // is refused, and a WebSocket cannot tell why. A page request can: it is
  // redirected to the sign-in page then - retrying would never succeed.
  async checkSession() {
    try {
      const res = await fetch(location.href, { cache: 'no-store' });
      if (res.redirected && new URL(res.url).pathname.endsWith('/login.html')) location.reload();
    } catch { /* server unreachable - keep retrying */ }
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  forget() { clearSession(); this.session = null; }
}

const KEY = 'ho-session';
const STALE_SESSION = ['err.gameNotFound', 'err.noSeat'];
function loadSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function saveSession(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
function clearSession() {
  try { localStorage.removeItem(KEY); } catch {}
}

export function loadName() {
  try { return localStorage.getItem('ho-name') || ''; } catch { return ''; }
}
export function saveName(n) {
  try { localStorage.setItem('ho-name', n); } catch {}
}

// Without an account the browser keeps the image itself and hands it in when
// connecting; with an account it is stored on the server.
export function loadAvatar() {
  try { return localStorage.getItem('ho-avatar') || null; } catch { return null; }
}
export function saveAvatar(dataUrl) {
  try {
    if (dataUrl) localStorage.setItem('ho-avatar', dataUrl);
    else localStorage.removeItem('ho-avatar');
  } catch {}
}
