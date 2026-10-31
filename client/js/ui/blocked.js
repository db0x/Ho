// What a blocked account sees: a dialog that cannot be closed, saying so,
// and a line to the admins. Everything else stays behind it - and the server
// refuses every other request anyway, so the dialog is no security boundary.
import { t, localeTag, onLocaleChange } from '../i18n.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A conversation between a blocked account and the admins as chat bubbles,
 * in the look of the friends' chat. `msgs`: [{ mine, who, text, at }].
 * Shared with the admin panel, which sees the same thread from the other side.
 */
export function appealLogHtml(msgs, empty) {
  if (!msgs.length) return `<p class="fc-e2e">${esc(empty)}</p>`;
  const when = at => new Date(at).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' });
  return msgs.map(m => `<div class="fc-msg ${m.mine ? 'mine' : ''}">
    <span>${esc(m.text)}</span><small>${[m.who ? esc(m.who) : null, when(m.at)].filter(Boolean).join(' · ')}</small></div>`).join('');
}

export class BlockedDialog {
  constructor(net) {
    this.net = net;
    this.open = false;
    this.since = null;
    this.msgs = [];
    $('#blocked-send').onclick = () => this.write();
    $('#blocked-text').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.write(); }
    };
    // Signing out works as from the start menu, which stays out of reach here.
    $('#blocked-logout').onclick = (e) => { e.preventDefault(); $('#link-logout').click(); };
    onLocaleChange(() => this.render());
  }

  /** After 'hello': the block with the thread so far, or null - then the dialog goes. */
  set(blocked, msgs) {
    this.open = !!blocked;
    $('#blocked').classList.toggle('hidden', !this.open);
    document.body.classList.toggle('is-blocked', this.open);
    if (!this.open) return;
    this.since = blocked.at || null;
    this.update(msgs || []);
    $('#blocked-text').focus({ preventScroll: true });
  }

  update(msgs) {
    this.msgs = msgs;
    this.error('');
    this.render();
  }

  /** A refused message (too long, too many in a row) - said inside the dialog. */
  error(text) {
    $('#blocked-error').textContent = text;
  }

  render() {
    if (!this.open) return;
    $('#blocked-since').textContent = this.since
      ? t('blocked.since', { date: new Date(this.since).toLocaleDateString(localeTag()) }) : '';
    const log = $('#blocked-log');
    log.innerHTML = appealLogHtml(
      this.msgs.map(m => ({ ...m, who: m.by ? t('blocked.admin', { admin: m.by }) : null })),
      t('blocked.empty'));
    log.scrollTop = log.scrollHeight;
  }

  write() {
    const box = $('#blocked-text');
    const text = box.value.trim();
    if (!text) return;
    this.net.send({ t: 'appeal', text });
    box.value = '';
  }
}
