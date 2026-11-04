// Log and chat: what happened each turn in the player's language, the game
// chat with its unread count, and the toasts that pop up for news.
import { t } from '../../i18n.js';
import { battleKey } from '../../render/courses.js';
import { compact } from '../../ui/viewport.js';
import { fmt1, escapeHtml } from './format.js';

const $ = s => document.querySelector(s);

export const commsMethods = {
  /**
   * A log entry in the chosen language. The server only sends keys and
   * values - whichever of them is a ship type, a direction or a number with
   * decimals only becomes text here.
   */
  logText(e) {
    if (!e?.key) return e?.text || '';
    const p = { ...(e.params || {}) };
    if (Array.isArray(p.fields)) {
      p.fields = p.fields
        .map(x => t('log.techEntry', { tech: t(`tech.${x.field}.name`), level: x.level }))
        .join(', ');
    }
    if (Array.isArray(p.sides)) {
      p.sides = p.sides.map(x => `${x.alien ? t('alien.name') : x.name} ${x.left}/${x.before}`).join(' vs. ');
    }
    if (p.ship) p.ship = t(`ship.${p.ship}.name`);
    if (p.direction) p.direction = t(`dir.${p.direction}`);
    if (typeof p.before === 'number') p.before = fmt1(p.before);
    if (typeof p.after === 'number') p.after = fmt1(p.after);
    if (typeof p.amount === 'number') p.amount = fmt1(p.amount);
    if (e.because?.key) p.because = t(e.because.key, e.because.params);
    return t(e.key, p);
  },

  log() {
    const box = $('#log-list');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.innerHTML = this.view.log.slice().reverse().map(l => `
      <div class="logturn">${t('log.turnHeader', { turn: l.turn })}</div>
      ${l.entries.map(e => {
        const key = battleKey(l.turn, e);
        const replay = e.type === 'combat' && this.app.battles?.has(key)
          ? `<button class="tiny bt-watch" data-b="${key}" title="${escapeHtml(t('battle.watch'))}">▶</button>` : '';
        return `<div class="logline ${e.type} ${e.planetId != null ? 'clickable' : ''}"
        ${e.planetId != null ? `data-p="${e.planetId}"` : ''}>${replay}${escapeHtml(this.logText(e))}</div>`;
      }).join('')}
    `).join('');
    for (const b of box.querySelectorAll('[data-b]')) {
      b.onclick = (ev) => { ev.stopPropagation(); this.app.openBattle(b.dataset.b); };
    }
    for (const line of box.querySelectorAll('[data-p]')) {
      line.onclick = () => {
        const p = this.view.planets[+line.dataset.p];
        if (!p) return;
        this.app.map.focus(p, this.app.freeArea());
        this.app.setSelection({ type: 'planet', id: p.id });
      };
    }
    if (atBottom) box.scrollTop = 0;
  },

  /**
   * A line on the comms. Whatever another player writes while the comms are
   * out of sight counts as unread (badge on the tab and on the bar at the
   * bottom) and pops up as a message - a tap opens the comms to answer.
   * @param {{fromId?: string, system?: boolean, mine?: boolean}} o
   */
  chat(from, text, o = {}) {
    const box = $('#chat-list');
    const div = document.createElement('div');
    div.className = 'logline' + (o.system ? ' sysline' : '');
    const color = this.view?.players.find(p => p.id === o.fromId)?.color;
    div.innerHTML = `<b${color ? ` style="color:${color}"` : ''}>${escapeHtml(from)}:</b> ${escapeHtml(text)}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    if (o.system || o.mine || this.chatVisible()) return;
    this.unread++;
    this.paintUnread();
    this.toast(`${from}: ${text}`, color || null, () => this.openChat(), '↩ ' + t('chat.reply'));
  },

  /** Are the comms on screen right now? */
  chatVisible() {
    if (document.hidden) return false;
    const tab = document.querySelector('#logdock .tabs button[data-ltab="chat"]');
    if (!tab?.classList.contains('active')) return false;
    if (compact.matches) return $('#screen-game').dataset.sheet === 'log';
    return !$('#logdock').classList.contains('collapsed');
  },

  /** Called whenever the comms may have come into view. */
  chatSeen() {
    if (!this.unread || !this.chatVisible()) return;
    this.unread = 0;
    this.paintUnread();
  },

  paintUnread() {
    for (const b of document.querySelectorAll('.chat-badge')) {
      b.textContent = this.unread > 9 ? '9+' : String(this.unread);
      b.classList.toggle('hidden', !this.unread);
    }
  },

  /** Show the comms with the input field - wherever they are hiding. */
  openChat() {
    if (compact.matches) this.app.showSheet?.('log');
    else if (this.logDlg.collapsed()) this.logDlg.toggle(false);
    document.querySelector('#logdock .tabs button[data-ltab="chat"]').click();
  },

  /**
   * @param {Function} [onClick] makes the toast clickable (watch the battle)
   * @param {string} [action]    label of the click hint
   */
  toast(text, color, onClick, action = '▶ ' + t('battle.watch')) {
    const host = $('#toasts');
    // The same message again says nothing new: it starts over instead of
    // stacking up (e.g. clicking an unreachable target several times).
    for (const old of host.querySelectorAll('.toast')) if (old.dataset.text === text) old.remove();
    const d = document.createElement('div');
    d.className = 'toast';
    d.dataset.text = text;
    d.textContent = text;
    if (color) d.style.borderLeftColor = color;
    if (onClick) {
      d.classList.add('clickable');
      const hint = document.createElement('span');
      hint.className = 'toast-action';
      hint.textContent = action;
      d.appendChild(hint);
      d.onclick = () => { d.remove(); onClick(); };
    }
    host.appendChild(d);
    setTimeout(() => d.remove(), onClick ? 7000 : 4200);
  }
};
