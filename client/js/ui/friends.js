// Friends next to the start menu: find someone by their handle, send a
// request, answer one - and from then on see who is online and write to
// each other. Only for accounts; the server says who is who by handle only.
// Messages are end-to-end encrypted (../e2e.js) - the server never sees the text.
// The key is the account's: the sign-in page leaves it in this browser. If it
// is not there (a session from before, a private window), the password
// opens it here.
// During a game the same panel is a window behind a button on the map, so
// friends can still reach you there (setInGame).
import { t, localeTag, onLocaleChange } from '../i18n.js';
import { loadKey, dropKey, setupKey, encrypt, decrypt, safetyCode } from '../e2e.js';
import { avatarHtml } from './avatar.js';
import { sfx } from '../audio/sfx.js';
import { bindEmoji } from './emoji.js';
import { emojify } from '../../shared/emoji.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const HANDLE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const VERIFIED_KEY = 'ho-e2e-verified';

/** Safety codes marked as compared, per friend - on this device. */
function verified() {
  try { return JSON.parse(localStorage.getItem(VERIFIED_KEY) || '{}'); } catch { return {}; }
}
function setVerified(handle, code) {
  const all = verified();
  if (code) all[handle] = code; else delete all[handle];
  try { localStorage.setItem(VERIFIED_KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
}

export class FriendsPanel {
  constructor(net) {
    this.net = net;
    this.enabled = false;
    this.data = { key: null, friends: [], incoming: [], outgoing: [] };
    this.key = null;            // the account's key pair, opened (../e2e.js)
    this.handle = null;         // own handle
    this.code = null;           // safety code of the open conversation
    this.showCode = false;
    this.found = null;          // last lookup: { handle, user, relation }
    this.open = null;           // handle of the open conversation
    this.log = [];
    // In a game the panel is a window behind a button on the map (setInGame).
    this.inGame = false;
    this.shown = false;         // the window is open (in a game only)
    this.lastStatus = new Map();  // handle -> status of the last list
    this.offlineAt = new Map();   // handle -> when they were last seen going offline
    /** Hook for the game: a friend came online. */
    this.onOnline = null;

    const input = $('#friends-handle');
    input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^0-9A-Z#]/g, ''); };
    input.onkeydown = (e) => { if (e.key === 'Enter') this.lookup(); };
    $('#friends-find').onclick = () => this.lookup();
    // One delegated handler - the lists are rebuilt on every update.
    $('#friends-panel').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const h = b.dataset.handle;
      switch (b.dataset.act) {
        case 'request': this.net.send({ t: 'friendRequest', handle: h }); break;
        case 'accept': this.net.send({ t: 'friendAnswer', handle: h, accept: true }); break;
        case 'decline': this.net.send({ t: 'friendAnswer', handle: h, accept: false }); break;
        case 'withdraw': this.net.send({ t: 'friendRemove', handle: h }); break;
        case 'chat': this.openChat(h); break;
      }
    });
    $('#friends-unlock').onsubmit = (e) => { e.preventDefault(); this.unlock(); };
    $('#fc-back').onclick = () => this.openChat(null);
    $('#fc-send').onclick = () => this.write();
    // Smileys and codes turn into emojis as in the comms, with the same palette.
    const emoji = bindEmoji($('#fc-text'), $('#fc-emoji'));
    onLocaleChange(() => emoji.relabel());
    $('#fc-text').onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.write(); }
      if (e.key === 'Escape') this.openChat(null);
    };
    $('#fc-lock').onclick = () => { this.showCode = !this.showCode; this.renderCode(); };
    $('#fc-code').addEventListener('click', (e) => {
      const end = e.target.closest('[data-end]');
      if (end) { e.preventDefault(); return this.removeFriend(end); }
      const b = e.target.closest('[data-verify]');
      if (!b) return;
      e.preventDefault();
      setVerified(this.open, b.dataset.verify === 'on' ? this.code : null);
      this.renderCode();
    });
    onLocaleChange(() => this.render());
    $('#friends-close').onclick = () => this.show(false);
    // Escape in the game: from the conversation back to the list, then the
    // window closes. Before the map, which would drop its selection - but the
    // emoji palette closes first.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.inGame || !this.shown) return;
      if (document.querySelector('.emoji-palette:not(.hidden)')) return;
      e.stopPropagation();
      if (this.open) this.openChat(null); else this.show(false);
    }, true);
  }

  /**
   * After 'hello': only accounts have friends. Loads the account's key from
   * this browser - kept per handle, two accounts on one device stay apart.
   */
  async setEnabled(handle) {
    this.enabled = !!handle;
    if (this.handle !== handle) this.key = null;
    this.handle = handle || null;
    $('#friends-panel').classList.toggle('hidden', !this.enabled);
    $('#screen-menu').classList.toggle('with-friends', this.enabled);
    this.paintButton();
    if (!this.enabled) { this.show(false); return this.openChat(null); }
    this.key ||= await loadKey(handle);
    this.render();
  }

  // ------------------------------------------------------------ In the game

  /**
   * In a game the start menu is out of sight: the panel moves into the game
   * screen and opens as a window from the friends button on the map. Same
   * list, same conversation, same key - only the search and the account
   * settings stay in the start menu.
   */
  setInGame(on) {
    if (this.inGame === on) return;
    const panel = $('#friends-panel');
    this.inGame = on;
    if (on) $('#screen-game').appendChild(panel);
    else $('#screen-menu').insertBefore(panel, $('#admin-panel'));
    panel.classList.toggle('in-game', on);
    this.show(false);
  }

  /** Is the panel on screen? In the start menu always, in a game while the window is open. */
  get visible() { return !document.hidden && (!this.inGame || this.shown); }

  /** Opens or closes the window in the game - with a conversation, if a handle is given. */
  show(open, handle = null) {
    if (open && !this.enabled) return;
    const was = this.shown;
    this.shown = !!open;
    $('#friends-panel').classList.toggle('closed', this.inGame && !this.shown);
    if (handle) this.openChat(handle);
    // Back to a conversation left open: what came meanwhile is read now.
    else if (open && !was && this.open) this.openChat(this.open);
    this.paintButton();
  }

  /** The button on the map: unread messages and requests, who is online. */
  paintButton() {
    const btn = $('#btn-friends');
    if (!btn) return;
    btn.classList.toggle('hidden', !this.enabled);
    btn.classList.toggle('open', this.shown);
    btn.setAttribute('aria-expanded', String(this.shown));
    const d = this.data;
    const unread = d.friends.reduce((a, p) => a + (p.unread || 0), 0) + d.incoming.length;
    const online = d.friends.filter(p => p.status !== 'offline').length;
    const badge = btn.querySelector('.friends-badge');
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('hidden', !unread);
    btn.querySelector('.friends-dot').classList.toggle('hidden', !online || !!unread);
    btn.title = online ? t('friends.buttonOnline', { n: online }) : t('friends.button');
  }

  /**
   * Friends who come online while you play: a toast says so. Not for the
   * first list (that is just how things are), and not for a reload - only
   * after a minute away.
   */
  noticeOnline() {
    const now = Date.now();
    for (const p of this.data.friends) {
      const before = this.lastStatus.get(p.handle);
      this.lastStatus.set(p.handle, p.status);
      if (before == null) { if (p.status === 'offline') this.offlineAt.set(p.handle, 0); continue; }
      if (p.status === 'offline') { if (before !== 'offline') this.offlineAt.set(p.handle, now); continue; }
      if (before !== 'offline') continue;
      const away = now - (this.offlineAt.get(p.handle) ?? 0);
      if (this.inGame && away > 60000) this.onOnline?.(p);
    }
  }

  /**
   * Opens the account's key with the password - or makes the first one. The
   * server checks the password before it keeps a new key.
   */
  async unlock() {
    const input = $('#friends-pw');
    const password = input.value;
    if (!password) return;
    const button = $('#friends-unlock button');
    const error = $('#friends-unlock-error');
    button.disabled = true;
    error.textContent = t('auth.working');
    const api = async (method, data) => {
      const r = await fetch('api/auth/key', {
        method, cache: 'no-store',
        headers: data ? { 'content-type': 'application/json' } : undefined,
        body: data ? JSON.stringify(data) : undefined
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(body.error || 'auth.err.server'), { params: body.params });
      return body;
    };
    try {
      const { handle, e2e } = await api('GET');
      this.key = await setupKey(handle, password, e2e, async saved => (await api('POST', { password, e2e: saved })).e2e);
      input.value = '';
      error.textContent = '';
      this.render();
      if (this.open) this.net.send({ t: 'friendHistory', handle: this.open });
    } catch (e) {
      const key = e.message === 'wrong' || e.message === 'auth.err.badLogin' ? 'friends.unlock.wrong'
        : e.message.startsWith('auth.') ? e.message : 'auth.err.network';
      error.textContent = t(key, e.params);
    } finally {
      button.disabled = false;
    }
  }

  /** Signing out or deleting the account: the key leaves this browser. */
  async forgetKey() {
    if (this.handle) await dropKey(this.handle);
    this.key = null;
  }

  /** The server's list: friends with status, open requests both ways. */
  update(m) {
    const before = new Set(this.data.incoming.map(p => p.handle));
    this.data = { key: m.key || null, friends: m.friends || [], incoming: m.incoming || [], outgoing: m.outgoing || [] };
    // The account has another key by now (a reset, then a new sign-in
    // elsewhere): the one in this browser opens nothing new.
    if (this.key && this.data.key && this.data.key !== this.key.pub) {
      dropKey(this.handle);
      this.key = null;
    }
    if (this.data.incoming.some(p => !before.has(p.handle)) && this.seen) sfx.play('chat');
    this.seen = true;
    // A lookup result shows the relation - keep it current.
    if (this.found?.user) {
      const h = this.found.handle;
      this.found.relation = this.data.friends.some(p => p.handle === h) ? 'friends'
        : this.data.outgoing.some(p => p.handle === h) ? 'outgoing'
        : this.data.incoming.some(p => p.handle === h) ? 'incoming'
        : (this.found.relation === 'self' ? 'self' : 'none');
    }
    if (this.open && !this.data.friends.some(p => p.handle === this.open)) this.openChat(null);
    this.noticeOnline();
    this.render();
  }

  lookup() {
    const h = $('#friends-handle').value.trim().replace(/^#/, '').toUpperCase();
    if (!HANDLE_RE.test(h)) {
      this.found = { handle: h, user: null, bad: true };
      return this.render();
    }
    this.net.send({ t: 'friendLookup', handle: h });
  }

  onLookup(m) {
    this.found = m;
    this.render();
  }

  // ------------------------------------------------------------ Rendering

  render() {
    if (!this.enabled) return;
    this.paintButton();
    // WebCrypto exists only over HTTPS (and on localhost).
    const crypto = !!globalThis.crypto?.subtle;
    $('#friends-unlock').classList.toggle('hidden', !!this.key || !crypto);
    $('#friends-nocrypto').classList.toggle('hidden', crypto);
    $('#friends-result').innerHTML = this.resultHtml();
    const d = this.data;
    $('#friends-incoming').innerHTML = d.incoming.length ? `
      <h3>${t('friends.incoming')}</h3>
      ${d.incoming.map(p => this.row(p, `
        <button type="button" class="tiny primary" data-act="accept" data-handle="${p.handle}">${t('friends.accept')}</button>
        <button type="button" class="tiny" data-act="decline" data-handle="${p.handle}">${t('friends.decline')}</button>`)).join('')}` : '';
    $('#friends-list').innerHTML = `
      <h3>${t('friends.list')} <span class="muted">${d.friends.length || ''}</span></h3>
      ${d.friends.length ? d.friends.map(p => this.row(p, p.unread
        ? `<span class="fr-unread" title="${t('friends.unread', { n: p.unread, count: p.unread })}">${p.unread}</span>` : '',
        { act: 'chat', status: p.status })).join('')
        : `<p class="muted small">${t('friends.none')}</p>`}`;
    $('#friends-outgoing').innerHTML = d.outgoing.length ? `
      <h3>${t('friends.outgoing')}</h3>
      ${d.outgoing.map(p => this.row(p, `
        <button type="button" class="tiny" data-act="withdraw" data-handle="${p.handle}">${t('friends.withdraw')}</button>`)).join('')}` : '';
    if (this.open) this.renderChat();
  }

  resultHtml() {
    const f = this.found;
    if (!f) return '';
    if (f.bad) return `<p class="muted small">${t('friends.badHandle')}</p>`;
    if (!f.user) return `<p class="muted small">${t('friends.notFound', { handle: esc(f.handle) })}</p>`;
    const action = {
      none: `<button type="button" class="tiny primary" data-act="request" data-handle="${f.user.handle}">${t('friends.request')}</button>`,
      incoming: `<button type="button" class="tiny primary" data-act="accept" data-handle="${f.user.handle}">${t('friends.accept')}</button>`,
      outgoing: `<span class="muted small">${t('friends.pending')}</span>`,
      friends: `<button type="button" class="tiny" data-act="chat" data-handle="${f.user.handle}">${t('friends.write')}</button>`,
      self: `<span class="muted small">${t('friends.self')}</span>`
    }[f.relation] || '';
    return `<div class="friends-found">${this.row(f.user, action)}</div>`;
  }

  /** One person: avatar (with status dot), name, handle, and what can be done. */
  row(p, actions, { act, status } = {}) {
    const dot = status ? `<span class="dot ${status}" title="${t('friends.status.' + status)}"></span>` : '';
    const sub = status ? t('friends.status.' + status) : '#' + p.handle;
    return `<div class="fr-row${act ? ' clickable' : ''}"${act ? ` data-act="${act}" data-handle="${p.handle}"` : ''}>
        <span class="fr-avatar">${avatarHtml({ name: p.name, avatar: p.avatar }, 30)}${dot}</span>
        <span class="fr-who"><b>${esc(p.name)}</b><small class="muted">${esc(sub)}</small></span>
        <span class="fr-actions">${actions}</span>
      </div>`;
  }

  // ---------------------------------------------------------- Conversation

  openChat(handle) {
    this.open = handle;
    this.log = [];
    this.code = null;
    this.showCode = false;
    $('#fc-code').classList.add('hidden');
    $('.friends-list-view').classList.toggle('hidden', !!handle);
    $('.friends-chat').classList.toggle('hidden', !handle);
    if (!handle) return;
    this.renderChat();
    this.net.send({ t: 'friendHistory', handle });
    $('#fc-text').focus();
  }

  /** Opens an envelope: the text, or null if it does not open with this key. */
  async open1(msg) {
    const text = this.key ? await decrypt(this.key, msg.env) : null;
    return { mine: msg.mine, at: msg.at, text };
  }

  async onHistory(m) {
    if (m.with !== this.open) return;
    const log = await Promise.all((m.messages || []).map(x => this.open1(x)));
    if (m.with !== this.open) return;     // switched meanwhile
    this.log = log;
    this.renderChat();
  }

  /**
   * A new message - in the open conversation, or as a sound for the list.
   * @returns {Promise<string|null>} the text, for a toast in the game
   */
  async onMessage(m) {
    const msg = await this.open1(m.msg);
    if (m.with === this.open) {
      this.log.push(msg);
      this.renderChat();
      // Read only if it is on screen - a closed window in the game keeps it unread.
      if (!msg.mine && this.visible) this.net.send({ t: 'friendRead', handle: m.with });
    }
    if (!msg.mine) sfx.play('chat');
    return msg.text;
  }

  /** Is the conversation with this friend on screen right now? */
  reading(handle) { return this.visible && this.open === handle; }

  renderChat() {
    const p = this.data.friends.find(x => x.handle === this.open);
    if (!p) return;
    $('#fc-who').innerHTML = `${avatarHtml({ name: p.name, avatar: p.avatar }, 26)}
      <span><b>${esc(p.name)}</b> <small class="muted">#${p.handle} · ${t('friends.status.' + p.status)}</small></span>`;
    const log = $('#fc-log');
    const time = at => new Date(at).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' });
    const bubble = m => m.text == null
      ? `<span class="fc-locked">${t(this.key ? 'friends.unreadable' : 'friends.locked')}</span>`
      : `<span>${esc(m.text)}</span>`;
    log.innerHTML = `<p class="fc-e2e">${t(this.key?.stored === false ? 'friends.e2eVolatile' : 'friends.e2e')}</p>` + (this.log.length
      ? this.log.map(m => `<div class="fc-msg ${m.mine ? 'mine' : ''}">${bubble(m)}<small>${time(m.at)}</small></div>`).join('')
      : `<p class="muted small">${t('friends.empty', { name: esc(p.name) })}</p>`);
    log.scrollTop = log.scrollHeight;
    this.updateCode(p);
  }

  /** Safety code over the keys of both - recomputed when one of them changes. */
  async updateCode(p) {
    if (!this.data.key || !p.key) return;
    const code = await safetyCode({ handle: this.handle, pubs: [this.data.key] }, { handle: p.handle, pubs: [p.key] });
    if (p.handle !== this.open) return;
    this.code = code;
    this.renderCode();
  }

  /** Lock button and code box: compared, changed since then, or not yet compared. */
  renderCode() {
    if (!this.open || !this.code) return;
    const saved = verified()[this.open];
    const state = !saved ? 'none' : saved === this.code ? 'ok' : 'changed';
    const lock = $('#fc-lock');
    lock.className = 'tiny fc-lock ' + state;
    lock.textContent = { none: '🔒', ok: '🔒 ✓', changed: '🔒 ⚠' }[state];
    lock.title = t('friends.code.' + state);
    const box = $('#fc-code');
    box.classList.toggle('hidden', !this.showCode && state !== 'changed');
    const name = esc(this.data.friends.find(x => x.handle === this.open)?.name || '');
    box.innerHTML = `
      ${state === 'changed' ? `<p class="fc-warn">${t('friends.code.changedLong', { name })}</p>` : ''}
      <div class="fc-digits">${this.code}</div>
      <p class="small muted">${t('friends.code.explain', { name })}</p>
      ${state === 'ok'
        ? `<p class="small" style="color:var(--good)">✓ ${t('friends.code.ok')} <a href="#" data-verify="off">${t('friends.code.unmark')}</a></p>`
        : `<button type="button" class="tiny" data-verify="on">${t('friends.code.mark')}</button>`}
      <p class="fc-end"><a href="#" data-end>${t('friends.remove')}</a></p>`;
  }

  /** Encrypts for the friend's key, then sends. */
  async write() {
    const input = $('#fc-text');
    // A smiley at the very end only counts now that the line is finished.
    const text = emojify(input.value.replace(/\s+/g, ' ').trim()).slice(0, 500);
    const p = this.data.friends.find(x => x.handle === this.open);
    if (!text || !p) return;
    if (!this.key) return this.note(t(globalThis.crypto?.subtle ? 'friends.lockedSend' : 'friends.noKey'));
    if (!p.key) return this.note(t('friends.noFriendKey', { name: esc(p.name) }));
    const env = await encrypt(this.key, text, p.key);
    this.net.send({ t: 'friendMsg', handle: this.open, env });
    input.value = '';
  }

  /** A line under the conversation that disappears again. */
  note(text) {
    const log = $('#fc-log');
    log.insertAdjacentHTML('beforeend', `<p class="fc-warn small">${text}</p>`);
    log.scrollTop = log.scrollHeight;
  }

  /** Ending a friendship deletes the conversation too - so ask with a second click. */
  removeFriend(b) {
    if (!b.dataset.armed) {
      b.dataset.armed = '1';
      b.textContent = t('friends.removeConfirm');
      setTimeout(() => { if (b.dataset.armed) { b.dataset.armed = ''; b.textContent = t('friends.remove'); } }, 4000);
      return;
    }
    this.net.send({ t: 'friendRemove', handle: this.open });
    this.openChat(null);
  }
}
