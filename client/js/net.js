// WebSocket-Anbindung mit automatischem Wiederverbinden.
export class Net {
  constructor() {
    this.handlers = new Map();
    this.queue = [];
    this.ws = null;
    this.session = loadSession();
    this.connect();
  }

  connect() {
    // Relativ zur Seite, damit es auch unter einem Unterpfad (/ho/) laeuft.
    const url = new URL('.', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
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
      if (msg.t === 'kicked' || (msg.t === 'error' && /nicht gefunden|Schlüssel/.test(msg.msg || ''))) {
        clearSession();
        this.session = null;
      }
      this.emit(msg.t, msg);
      this.emit('*', msg);
    };
    this.ws.onclose = () => {
      this.emit('close');
      clearTimeout(this._retry);
      this._retry = setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => {};
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
