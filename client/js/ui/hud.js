// All panels of the game screen. The Hud holds what they share - the view,
// the selection, the docks and tooltips - and puts the panels together;
// each panel lives in ./hud/ with its own part of the game.
import { shipTypesFor } from '../../shared/rules.js';
import { t } from '../i18n.js';
import { makeDialog } from '../ui/dialog.js';
import { openShipInfo } from '../ui/shipinfo.js';
import { desktop } from '../ui/viewport.js';
import { commsMethods } from './hud/comms.js';
import { empireMethods } from './hud/empire.js';
import { fleetMethods } from './hud/fleet.js';
import { planetMethods } from './hud/planet.js';
import { playersMethods } from './hud/players.js';
import { researchMethods } from './hud/research.js';
import { shipyardMethods } from './hud/shipyard.js';
import { topbarMethods } from './hud/topbar.js';
import { treasuryMethods } from './hud/treasury.js';
import { wormholeMethods } from './hud/wormhole.js';

const $ = s => document.querySelector(s);

export class Hud {
  constructor(app) {
    this.app = app;             // { send, map, selection, setSelection }
    this.view = null;
    this.dragging = null;       // slider currently being dragged
    this.unread = 0;            // chat lines from others not seen yet
    // Sliders fire up to 60 times per second, and every message pulls a
    // complete new view after it - hence the throttled sending.
    this.sendSlider = throttle(m => this.app.send(m), 100);
    this.bindStatic();
  }

  bindStatic() {
    for (const b of document.querySelectorAll('#leftdock .tabs button')) {
      b.onclick = () => {
        document.querySelectorAll('#leftdock .tabs button').forEach(x => x.classList.toggle('active', x === b));
        for (const tab of ['research', 'empire', 'players']) {
          $('#tab-' + tab).classList.toggle('hidden', tab !== b.dataset.tab);
        }
      };
    }
    for (const b of document.querySelectorAll('#logdock .tabs button[data-ltab]')) {
      b.onclick = () => {
        document.querySelectorAll('#logdock .tabs button[data-ltab]').forEach(x => x.classList.toggle('active', x === b));
        const chat = b.dataset.ltab === 'chat';
        $('#log-list').classList.toggle('hidden', chat);
        $('#chat-list').classList.toggle('hidden', !chat);
        $('#chat-input-row').classList.toggle('hidden', !chat);
        if (chat && desktop.matches) $('#chat-input').focus();
        this.chatSeen();
      };
    }
    // The log is a window: movable, resizable from every edge, minimizable.
    this.logDlg = makeDialog($('#logdock'), {
      handle: $('#log-bar'), grip: $('#log-grip'), collapse: $('#log-collapse'), icon: $('#tray-log'), key: 'ho-logdock',
      w: 460, h: 240, minW: 250, minH: 110,
      onToggle: () => this.chatSeen()
    });
    // The dock at the top left likewise.
    this.leftDlg = makeDialog($('#leftdock'), {
      handle: $('#left-bar'), grip: $('#left-grip'), collapse: $('#left-collapse'), icon: $('#tray-left'), key: 'ho-leftdock',
      x: 12, y: 72, w: 300, h: Math.max(260, Math.min(520, innerHeight - 332)), minW: 220, minH: 130
    });

    // Ledger: hover with the pointer to view it, pinned with a click.
    const res = $('#res'), ledger = $('#ledger');
    let pinned = false;
    const show = (open) => {
      ledger.classList.toggle('hidden', !open);
      for (const b of res.querySelectorAll('button')) b.setAttribute('aria-expanded', String(open));
      if (open) this.ledger();
    };
    for (const b of res.querySelectorAll('button')) {
      b.onclick = () => { pinned = !pinned; show(pinned); };
    }
    res.onpointerenter = (e) => { if (e.pointerType === 'mouse' && this.view?.me) show(true); };
    res.onpointerleave = (e) => { if (e.pointerType === 'mouse' && !pinned) show(false); };
    addEventListener('pointerdown', (e) => {
      if (ledger.classList.contains('hidden') || res.contains(e.target)) return;
      pinned = false; show(false);
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !ledger.classList.contains('hidden')) { pinned = false; show(false); }
    });

    // While a slider is being dragged, the panel must not be rebuilt: the
    // rebuild replaces the element and the drag breaks off.
    addEventListener('pointerdown', (e) => {
      if (e.target?.matches?.('input[type=range]')) this.dragging = e.target;
    }, true);
    const release = () => {
      if (!this.dragging) return;
      this.dragging = null;
      if (this.view) this.update(this.view);     // catch up on what was left over
    };
    addEventListener('pointerup', release, true);
    addEventListener('pointercancel', release, true);
  }

  update(view) {
    this.view = view;
    if (!!view.spectator !== !!this._spectating) { this._spectating = !!view.spectator; this.chrome(); }
    this.topbar();
    this.log();
    if (view.spectator) {
      this.league();
      if (!this.dragging) this.selection();
      return;
    }
    this.empire();
    this.players();
    this.noticeOffers();
    // Skip panels with sliders while dragging (see bindStatic)
    if (!this.dragging) { this.research(); this.selection(); }
  }

  /** Rebuild the UI for spectating: no empire of your own, the pace instead. */
  chrome() {
    const sp = !!this._spectating;
    $('#btn-endturn').classList.toggle('hidden', sp);
    $('#spectate').classList.toggle('hidden', !sp);
    document.querySelector('#topbar .res').classList.toggle('hidden', sp);
    const tabs = [...document.querySelectorAll('#leftdock .tabs button')];
    tabs[0].textContent = t(sp ? 'tab.empires' : 'tab.research');
    // The icon of the minimized window is named after its tabs - when
    // spectating there is only the one.
    const trayLabel = $('#tray-left .lbl');
    trayLabel.dataset.i18n = sp ? 'tab.empires' : 'dock.trayLeft';
    trayLabel.textContent = t(trayLabel.dataset.i18n);
    // Leaving lives in the menu - for spectators it means to stop watching.
    const quit = $('#btn-quit');
    quit.dataset.i18n = sp ? 'quit.spectatorYes' : 'top.quit';
    quit.textContent = t(quit.dataset.i18n);
    for (const b of tabs.slice(1)) b.classList.toggle('hidden', sp);
    if (sp) {
      tabs[0].click();                                  // always show the table
      $('#chat-input-row').classList.add('hidden');
    }
    const chatTab = document.querySelector('#logdock .tabs button[data-ltab="chat"]');
    if (chatTab) chatTab.classList.toggle('hidden', sp);
  }

  selection() {
    const sel = this.app.selection;
    const box = $('#selection');
    // A ship being renamed: a new view must not throw away what is typed.
    if (box.contains(document.activeElement) && document.activeElement.classList.contains('rename-input')) return;
    if (!sel) { box.innerHTML = `<p class="muted pad">${t('sel.empty')}</p>`; return; }
    if (sel.type === 'planet') this.planetPanel(box, this.view.planets[sel.id]);
    else if (sel.type === 'hole') this.holePanel(box, this.view.wormholes?.find(m => m.id === sel.id));
    else this.fleetPanel(box, this.view.fleets.find(f => f.id === sel.id));
  }

  /**
   * Hover tooltips in the style of the map tooltip, for every [data-tip]
   * element in box. The panels are rebuilt on every update - a tooltip
   * under the mouse is shown again for the new element right away.
   * @param {(el: HTMLElement) => string} html content for an element
   */
  wireTips(box, html) {
    const tip = this.tipEl ||= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'hovertip' }));
    const show = (el) => {
      tip.innerHTML = html(el);
      tip.classList.add('on');
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      // Beside the entry, preferably towards the map; never off screen.
      let x = r.left - w - 10;
      if (x < 8) x = Math.min(r.right + 10, innerWidth - w - 8);
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top)) + 'px';
    };
    const hide = () => tip.classList.remove('on');
    let over = null;
    for (const el of box.querySelectorAll('[data-tip]')) {
      el.onmouseenter = () => show(el);
      el.onmouseleave = hide;
      if (el.matches(':hover')) over = el;
    }
    if (over) show(over); else hide();
  }

  /** Profile of a ship type; without arguments, with your own tech levels. */
  showShip(type, tech, color, note) {
    const me = this.view?.me;
    openShipInfo(type, { tech: tech || me?.tech || {}, color: color || me?.color, note, types: shipTypesFor(this.view) });
  }
}

Object.assign(Hud.prototype,
  topbarMethods, treasuryMethods, researchMethods, empireMethods, playersMethods,
  planetMethods, shipyardMethods, fleetMethods, wormholeMethods, commsMethods);

/** First call right away, then at most one per window - the last value
 *  always goes out at the end. */
function throttle(fn, ms) {
  let timer = null, queued = null;
  return (...args) => {
    if (timer) { queued = args; return; }
    fn(...args);
    timer = setTimeout(() => {
      timer = null;
      if (queued) { const q = queued; queued = null; fn(...q); }
    }, ms);
  };
}
