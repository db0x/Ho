// Friends next to the start menu: find someone by their handle, send a
// request, answer one - and from then on see who is online and write to
// each other. Only for accounts; the server says who is who by handle only.
// Messages are end-to-end encrypted (../e2e.js) - the server never sees the text.
import { t, localeTag, onLocaleChange } from '../i18n.js';
import { loadDevice, encrypt, decrypt, safetyCode } from '../e2e.js';
import { avatarHtml } from './avatar.js';
import { sfx } from '../audio/sfx.js';

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
    this.data = { devices: [], friends: [], incoming: [], outgoing: [] };
    this.device = null;         // this browser's key pair (../e2e.js)
    this.handle = null;         // own handle
    this.code = null;           // safety code of the open conversation
    this.showCode = false;
    this.found = null;          // last lookup: { handle, user, relation }
    this.open = null;           // handle of the open conversation
    this.log = [];

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
    $('#fc-back').onclick = () => this.openChat(null);
    $('#fc-send').onclick = () => this.write();
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
  }

  /**
   * After 'hello': only accounts have friends. Loads (or creates) this
   * browser's key pair and tells the server its public half.
   */
  async setEnabled(handle) {
    this.enabled = !!handle;
    this.handle = handle || null;
    $('#friends-panel').classList.toggle('hidden', !this.enabled);
    $('#screen-menu').classList.toggle('with-friends', this.enabled);
    if (!this.enabled) return this.openChat(null);
    // One key per account and browser - two accounts on one device stay apart.
    if (this.device?.account !== handle) {
      try {
        this.device = { ...(await loadDevice(handle)), account: handle };
      } catch (e) {
        console.error('E2E: no key', e);
        this.device = null;
      }
    }
    if (this.device) this.net.send({ t: 'e2eDevice', id: this.device.id, pub: this.device.pub });
    this.render();
  }

  /** The server's list: friends with status, open requests both ways. */
  update(m) {
    const before = new Set(this.data.incoming.map(p => p.handle));
    this.data = { devices: m.devices || [], friends: m.friends || [], incoming: m.incoming || [], outgoing: m.outgoing || [] };
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

  /** Opens an envelope: the text, or null if it was not meant for this browser. */
  async open1(msg) {
    const text = this.device ? await decrypt(this.device, msg.env) : null;
    return { mine: msg.mine, at: msg.at, text, pub: msg.env?.pub };
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
      if (!msg.mine) this.net.send({ t: 'friendRead', handle: m.with });
    }
    if (!msg.mine) sfx.play('chat');
    return msg.text;
  }

  renderChat() {
    const p = this.data.friends.find(x => x.handle === this.open);
    if (!p) return;
    $('#fc-who').innerHTML = `${avatarHtml({ name: p.name, avatar: p.avatar }, 26)}
      <span><b>${esc(p.name)}</b> <small class="muted">#${p.handle} · ${t('friends.status.' + p.status)}</small></span>`;
    const log = $('#fc-log');
    const time = at => new Date(at).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' });
    // A key the server does not list for either of us: possibly slipped in.
    const known = new Set([...p.devices, ...this.data.devices].map(d => d.pub));
    const bubble = m => m.text == null
      ? `<span class="fc-locked">${t('friends.unreadable')}</span>`
      : `<span>${esc(m.text)}</span>`;
    log.innerHTML = `<p class="fc-e2e">${t(this.device?.stored === false ? 'friends.e2eVolatile' : 'friends.e2e')}</p>` + (this.log.length
      ? this.log.map(m => `<div class="fc-msg ${m.mine ? 'mine' : ''}">${bubble(m)}<small>${time(m.at)}${
          m.text != null && !known.has(m.pub) ? ` · <b class="fc-warn" title="${t('friends.unknownKeyTip')}">${t('friends.unknownKey')}</b>` : ''}</small></div>`).join('')
      : `<p class="muted small">${t('friends.empty', { name: esc(p.name) })}</p>`);
    log.scrollTop = log.scrollHeight;
    this.updateCode(p);
  }

  /** Safety code over the keys of both - recomputed when a device comes or goes. */
  async updateCode(p) {
    const code = await safetyCode(
      { handle: this.handle, pubs: this.data.devices.map(d => d.pub) },
      { handle: p.handle, pubs: p.devices.map(d => d.pub) });
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

  /** Encrypts for every device of the friend and every own one, then sends. */
  async write() {
    const input = $('#fc-text');
    const text = input.value.replace(/\s+/g, ' ').trim().slice(0, 500);
    const p = this.data.friends.find(x => x.handle === this.open);
    if (!text || !p) return;
    if (!this.device) return this.note(t('friends.noKey'));
    if (!p.devices.length) return this.note(t('friends.noDevice', { name: esc(p.name) }));
    const own = this.data.devices.some(d => d.id === this.device.id) ? [] : [this.device];
    const env = await encrypt(this.device, text, [...p.devices, ...this.data.devices, ...own]);
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
