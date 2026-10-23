// All panels of the game screen.
import {
  TECH_FIELDS, SHIP_TYPES, shipCost, refitTotal,
  habitability, planetCapacity, planetIncome, planetMining,
  terraformFullCost, terraformable, terraLimits, IDEAL,
  holeZone, travelDistance, supplyDistance, batteryStats, cargoOf
} from '../../shared/rules.js';
import { SHIELD_MIN } from '../render/fx.js';
import { shipIcon } from '../render/ships.js';
import { planetThumb } from '../render/planets.js';
import { makeDialog } from './dialog.js';
import { compact } from './viewport.js';
import { openShipInfo } from './shipinfo.js';
import { openSplit } from './split.js';
import { forecast, refitShips } from '../../shared/budget.js';
import { avatarHtml } from './avatar.js';
import { t, n as num, localeTag } from '../i18n.js';

const $ = s => document.querySelector(s);
// Pause and play as SVG on the same 16 px grid as the other top bar icons -
// text glyphs never sit quite in the middle.
const ICON_PAUSE = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3.5h2.4v9H4.5zM9.1 3.5h2.4v9H9.1z" fill="currentColor"/></svg>';
const ICON_PLAY = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L12.8 8z" fill="currentColor"/></svg>';
// Numbers follow the chosen language: 1.600 or 1,600.
const fmt = n => Math.round(n).toLocaleString(localeTag());
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(localeTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
        if (chat) $('#chat-input').focus();
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

  /** Table of all empires - the most interesting part of the picture when spectating. */
  league() {
    const v = this.view;
    const rows = ranking(v.players);
    const maxPop = Math.max(1, ...rows.map(p => p.stats.pop));
    $('#tab-research').innerHTML = `<div class="league">${rows.map(p => `
      <div class="row ${p.alive ? '' : 'dead'}">
        <div class="head">
          <span class="dot" style="width:9px;height:9px;border-radius:50%;background:${p.color};box-shadow:0 0 8px ${p.color}"></span>
          <span class="nm" title="${p.name}">${p.name}</span>
          ${p.persona ? `<span class="muted small" title="${t(`persona.${p.persona}.desc`)}">${t(`persona.${p.persona}`)}</span>` : ''}
          ${levelTag(p)}
        </div>
        <div class="num">${statsText(p.stats.planets, p.stats.pop, p.stats.ships)}</div>
        <div class="bar"><i style="width:${Math.round(p.stats.pop / maxPop * 100)}%;background:${p.color}"></i></div>
        <div class="tech">${TECH_FIELDS.map(f => t(`tech.${f}.short`) + p.tech[f]).join(' ')}
          · ${fmt(p.money)} ${t('unit.cr')} · ${fmt(p.metal)} ${t('unit.metal')}</div>
      </div>`).join('')}</div>`;
  }

  /**
   * What happens to money and metal at the end of the turn - computed in
   * shared/budget.js exactly as on the server (test/budget.js keeps the two
   * in sync). Here it is only prepared for the top bar, shipyard and ledger.
   */
  plan() {
    const v = this.view, me = v?.me;
    if (!me) return null;
    const f = forecast(v);
    // Every row rounded, the sum from the rounded rows - otherwise the
    // ledger's arithmetic would be off by one unit.
    const r = Math.round;
    const lg = {
      now: { money: r(me.money), metal: r(me.metal) },
      research: r(f.research), share: me.research.budgetPct,
      build: { money: r(f.build.booked.money), metal: r(f.build.booked.metal),
               dropped: f.build.planned.n - f.build.booked.n, total: f.build.planned.n,
               lacksMoney: f.build.lacksMoney, lacksMetal: f.build.lacksMetal },
      refit: { money: r(f.refit.booked.money), metal: r(f.refit.booked.metal),
               short: f.refit.planned.n > f.refit.booked.n, lacksMoney: f.refit.lacksMoney, lacksMetal: f.refit.lacksMetal },
      terra: { money: r(f.terra.booked), missing: r(f.terra.planned - f.terra.booked), worlds: f.terra.worlds },
      income: { money: r(f.income), metal: r(f.mining) }
    };
    lg.after = {
      money: lg.now.money - lg.research - lg.build.money - lg.refit.money - lg.terra.money + lg.income.money,
      metal: lg.now.metal - lg.build.metal - lg.refit.metal + lg.income.metal
    };
    lg.tight = lg.build.dropped > 0 || lg.refit.short || lg.terra.missing > 0;

    // For the shipyard: building and refits together, planned against available.
    const buildMoney = f.build.planned.money + f.refit.planned.money;
    const buildMetal = f.build.planned.metal + f.refit.planned.metal;
    return {
      tech: f.tech, breakthrough: f.breakthrough, research: f.research,
      buildMoney, buildMetal, freeMoney: f.available.money, freeMetal: f.available.metal,
      missingMoney: Math.max(0, buildMoney - f.available.money),
      missingMetal: Math.max(0, buildMetal - f.available.metal),
      ledger: lg
    };
  }

  /**
   * Would the budget still work out with this additional order? The server
   * does the same check - the button only shows beforehand what it accepts.
   * @param {{build?: [number, string], refit?: string}} extra
   */
  affordable(extra) {
    const v = this.view;
    const builds = JSON.parse(JSON.stringify(v.me.builds || {}));
    const refit = { ...(v.me.refit || {}) };
    if (extra.build) {
      const [pid, type] = extra.build;
      (builds[pid] ||= {})[type] = (builds[pid][type] || 0) + 1;
    }
    if (extra.refit) refit[extra.refit] = true;
    const f = forecast({ ...v, me: { ...v.me, builds, refit } });
    return f.build.planned.n === f.build.booked.n && f.refit.planned.n === f.refit.booked.n;
  }

  /**
   * What a refit costs ('f:<fleet>' or 'p:<world>'), with the tech levels
   * after research. Null if there is no shipyard there or nothing is
   * outdated.
   */
  refitFor(key, tech) {
    const r = refitTotal(refitShips(this.view, key), tech);
    return r.count ? r : null;
  }

  /** Profile of a ship type; without arguments, with your own tech levels. */
  showShip(type, tech, color, note) {
    const me = this.view?.me;
    openShipInfo(type, { tech: tech || me?.tech || {}, color: color || me?.color, note });
  }

  /** Button for refitting, or the pending order with a cancel button. */
  refitBlock(key, label) {
    const pl = this.plan();
    const r = pl && this.refitFor(key, pl.tech);
    if (!r) return '';
    const ordered = !!this.view.me.refit?.[key];
    const price = t('refit.cost', { n: r.count, count: r.count, money: fmt(r.money), metal: fmt(r.metal) });
    // Button on top, one line of text below - the same in both states so
    // nothing below shifts when you refit or cancel.
    const text = ordered ? t('refit.ordered', { cost: price }) : price;
    return `<div class="sel-actions">${ordered
        ? `<button class="tiny" data-refit="${key}" data-off="1">${t('refit.cancel')}</button>`
        : `<button class="tiny" data-refit="${key}"${this.affordable({ refit: key }) ? '' : ` disabled title="${t('yard.cantAfford')}"`}>${label}</button>`}</div>
      <p class="small oneline" style="margin-top:4px;color:${ordered ? 'var(--good)' : 'var(--ink-faint)'}" title="${text}">${text}</p>`;
  }

  wireRefit(box) {
    for (const b of box.querySelectorAll('[data-refit]')) {
      const key = b.dataset.refit;
      const target = key.startsWith('f:') ? { fleetId: key.slice(2) } : { planetId: Number(key.slice(2)) };
      b.onclick = () => this.app.send({ t: 'orders', refit: { ...target, value: !b.dataset.off } });
    }
  }

  // --------------------------------------------------------------- Topbar
  topbar() {
    const v = this.view;
    if (v.spectator) {
      const em = $('#me-emblem');
      em.style.background = 'linear-gradient(135deg,#5b6478,#262c3b)';
      em.style.color = '#9aa8c4';
      $('#me-name').textContent = t('top.spectator');
      const alive = v.players.filter(p => p.alive).length;
      const owned = v.planets.filter(p => p.owner).length;
      $('#me-planets').textContent = t('top.spectatorStats',
        { empires: alive, owned, total: v.planets.length })
        + (v.code ? ` · ${t('top.code', { code: v.code })}` : '');
      $('#r-turn').textContent = v.turn;
      // No pace means an admin is watching a game with humans: the players
      // drive the turns, so there is nothing to pause or step.
      $('#spectate').classList.toggle('hidden', !v.pace);
      const paused = !!v.pace?.paused;
      $('#sp-play').textContent = paused ? t('spectate.resume') : t('spectate.pause');
      $('#sp-step').disabled = !paused || v.state !== 'running';
      for (const b of document.querySelectorAll('.sp-speeds button')) {
        b.classList.toggle('active', +b.dataset.ms === (v.pace?.ms ?? 1500));
      }
      $('#btn-pause').classList.add('hidden');
      this.pauseBar();
      return;
    }
    const me = v.me;
    const em = $('#me-emblem');
    em.style.background = `linear-gradient(135deg, ${me.color}, ${shadeHex(me.color, 0.55)})`;
    em.style.color = me.color;
    // With an image the emblem shows the image, the color stays as a frame.
    if (em.dataset.avatar !== (me.avatar || '')) {
      em.dataset.avatar = me.avatar || '';
      em.innerHTML = me.avatar ? `<img src="${me.avatar}" alt="">` : '';
    }
    $('#me-name').textContent = me.name;
    const mine = v.planets.filter(p => p.owner === v.you);
    const pop = mine.reduce((a, p) => a + (p.pop || 0), 0);
    const ships = v.fleets.filter(f => f.mine).reduce((a, f) => a + f.ships.length, 0);
    $('#me-planets').textContent = statsText(mine.length, pop, ships);
    $('#r-turn').textContent = v.turn;

    // Now -> after the end of the turn. How it gets there is in the ledger
    // (click or hover the numbers) - one calculation, not individual parts.
    const lg = this.plan().ledger;
    $('#r-money').textContent = fmt(lg.now.money);
    $('#r-metal').textContent = fmt(lg.now.metal);
    const next = (el, value, tight) => {
      el.textContent = '→ ' + fmt(value);
      el.classList.toggle('tight', tight);
    };
    next($('#r-money-next'), lg.after.money, lg.build.lacksMoney || lg.refit.lacksMoney || lg.terra.missing > 0);
    next($('#r-metal-next'), lg.after.metal, lg.build.lacksMetal || lg.refit.lacksMetal);
    if (!$('#ledger').classList.contains('hidden')) this.ledger();

    const btn = $('#btn-endturn');
    const waiting = me.ready;
    btn.classList.toggle('waiting', waiting);
    const others = v.players.filter(p => p.alive && !p.isBot);
    const readyCount = others.filter(p => p.ready).length;
    btn.textContent = waiting
      ? t('top.waiting', { ready: readyCount, total: others.length })
      : t('top.endTurn');
    btn.disabled = v.state !== 'running';

    // The host may hold the game for everyone - only worth it with a turn
    // timer: without one the turn waits for everybody anyway.
    const pb = $('#btn-pause');
    const host = v.host === v.you && v.state === 'running' && !!(v.deadline || v.paused);
    pb.classList.toggle('hidden', !host);
    pb.classList.toggle('active', !!v.paused);
    pb.setAttribute('aria-pressed', String(!!v.paused));
    pb.querySelector('.ic').innerHTML = v.paused ? ICON_PLAY : ICON_PAUSE;
    pb.querySelector('.lbl').textContent = t(v.paused ? 'top.resume' : 'top.pause');
    pb.title = t(v.paused ? 'top.resumeTitle' : 'top.pauseTitle');
    this.pauseBar();
  }

  /** Notice below the top bar while the game is paused - for everyone. */
  pauseBar() {
    const v = this.view;
    const bar = $('#pausebar');
    $('#screen-game').classList.toggle('paused', !!v.paused);
    if (!v.paused) { bar.classList.add('hidden'); bar.dataset.key = ''; return; }
    const host = !v.spectator && v.host === v.you;
    // Only rebuild when something changed - otherwise a click on the button
    // could land in the middle of a rebuild.
    const key = `${v.paused.name}|${host}|${t('pause.title')}`;
    if (bar.dataset.key === key && !bar.classList.contains('hidden')) return;
    bar.dataset.key = key;
    bar.innerHTML = `<span class="pb-icon" aria-hidden="true">&#10074;&#10074;</span>
      <div class="pb-text"><b>${t('pause.title')}</b>
        <div class="small">${t('pause.by', { player: escapeHtml(v.paused.name) })}</div>
        <div class="small muted">${t('pause.hint')}</div></div>
      ${host ? `<button class="primary tiny" id="pb-resume" data-sfx="none">${t('pause.resume')}</button>` : ''}`;
    bar.classList.remove('hidden');
    const r = bar.querySelector('#pb-resume');
    if (r) r.onclick = () => $('#btn-pause').click();
  }

  /**
   * Ledger of the current turn: from top to bottom exactly as the server
   * deducts at the end of the turn, at the bottom the result from the top bar.
   */
  ledger() {
    const lg = this.plan()?.ledger;
    if (!lg) return;
    const minus = n => n ? '−' + fmt(n) : '';
    const plus = n => n ? '+' + fmt(n) : '';
    const and = (...parts) => parts.filter(Boolean).join(` ${t('word.and')} `);
    const row = (cls, label, money, metal, problem = '') => `
      <tr class="${cls}"><th>${label}${problem ? `<small class="bad">${problem}</small>` : ''}</th>
        <td>${money}</td><td>${metal}</td></tr>`;
    const rows = [row('now', t('ledger.now'), fmt(lg.now.money), fmt(lg.now.metal))];
    rows.push(row('', t('ledger.research', { pct: lg.share }), minus(lg.research), ''));
    // What it fails on: money, metal or both
    const lacking = (x) => and(x.lacksMoney && t('top.money'), x.lacksMetal && t('top.metal'));
    if (lg.build.total) {
      rows.push(row('', t('ledger.build'), minus(lg.build.money), minus(lg.build.metal),
        lg.build.dropped ? t('ledger.buildShort', { n: lg.build.dropped, total: lg.build.total, what: lacking(lg.build) }) : ''));
    }
    if (lg.refit.money || lg.refit.metal || lg.refit.short) {
      rows.push(row('', t('ledger.refit'), minus(lg.refit.money), minus(lg.refit.metal),
        lg.refit.short ? t('ledger.refitShort', { what: lacking(lg.refit) }) : ''));
    }
    if (lg.terra.worlds) {
      rows.push(row('', t('ledger.terra', { n: lg.terra.worlds, count: lg.terra.worlds }), minus(lg.terra.money), '',
        lg.terra.missing ? t('ledger.terraShort', { missing: fmt(lg.terra.missing) }) : ''));
    }
    rows.push(row('income', t('ledger.income'), plus(lg.income.money), plus(lg.income.metal)));
    rows.push(row('total', t('ledger.next'), fmt(lg.after.money), fmt(lg.after.metal)));
    $('#ledger').innerHTML = `
      <h4 id="ledger-title">${t('ledger.title', { turn: this.view.turn })}</h4>
      <table>
        <thead><tr><th></th><td>${t('top.money')}</td><td>${t('top.metal')}</td></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <p class="small muted">${t('ledger.order')}</p>`;
  }

  // Runs in the draw loop: only write when the text changes.
  timer() {
    const v = this.view;
    let txt = '';
    const clock = (ms) => {
      const left = Math.max(0, Math.round(ms / 1000));
      return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    };
    // Paused: the timer stands still at what was left.
    if (v?.paused) txt = t('pause.timer', { time: clock(v.paused.left ?? 0) });
    else if (v?.deadline) txt = clock(v.deadline - Date.now());
    if (txt === this._timerTxt) return;
    this._timerTxt = txt;
    $('#r-timer').textContent = txt;
  }

  // ------------------------------------------------------------- Research
  research() {
    const v = this.view, me = v.me;
    const total = TECH_FIELDS.reduce((a, f) => a + me.research.weights[f], 0) || 1;
    // The same number as in the ledger (rounded down, no weights means no research).
    const budget = this.plan().research;
    const box = $('#tab-research');
    box.innerHTML = `
      <div class="budget-box">
        <label class="field slim" style="margin:0">
          <span>${t('research.share')} <b id="rb-val">${me.research.budgetPct} %</b></span>
          <input type="range" id="rb" min="0" max="100" step="5" value="${me.research.budgetPct}">
        </label>
        <div class="small muted">${t('research.nextTurn', { spend: fmt(budget), money: fmt(me.money) })}</div>
      </div>
      ${TECH_FIELDS.map(f => {
        const lvl = me.tech[f];
        const pr = me.techProgress[f];
        const share = me.research.weights[f] / total;
        return `<div class="tech-row" data-f="${f}">
          <div class="tech-head"><span class="nm">${t(`tech.${f}.name`)}</span>
            <span class="lvl">${t('tech.level', { n: lvl })}</span></div>
          <div class="tech-bar"><i style="width:${Math.min(100, pr.points / pr.next * 100).toFixed(1)}%"></i></div>
          <div class="wrow">
            <input type="range" class="wt" min="0" max="10" step="1" value="${me.research.weights[f]}">
            <span class="pct">${Math.round(share * 100)}%</span>
          </div>
        </div>`;
      }).join('')}
      <p class="hint-line">${t('research.keepsTech')}</p>
    `;
    const rb = box.querySelector('#rb');
    rb.oninput = (e) => {
      box.querySelector('#rb-val').textContent = `${e.target.value} %`;
      this.sendSlider({ t: 'orders', research: { budgetPct: +e.target.value } });
    };
    // On release, send the final value unthrottled
    rb.onchange = (e) => this.app.send({ t: 'orders', research: { budgetPct: +e.target.value } });
    for (const row of box.querySelectorAll('.tech-row')) {
      const f = row.dataset.f;
      const wt = row.querySelector('.wt');
      wt.oninput = (e) => this.sendSlider({ t: 'orders', research: { weights: { [f]: +e.target.value } } });
      wt.onchange = (e) => this.app.send({ t: 'orders', research: { weights: { [f]: +e.target.value } } });
      row.querySelector('.tech-head').title = t(`tech.${f}.desc`);
    }
  }

  // --------------------------------------------------------------- Empire
  empire() {
    const v = this.view;
    const mine = v.planets.filter(p => p.owner === v.you)
      .sort((a, b) => b.pop - a.pop);
    const box = $('#tab-empire');
    const income = mine.reduce((a, p) => a + planetIncome(p), 0);
    const mining = mine.reduce((a, p) => a + planetMining(p), 0);
    box.innerHTML = `
      <div class="statgrid">
        <div class="stat"><div class="k">${t('empire.income')}</div><div class="v">+${fmt(income)}</div></div>
        <div class="stat"><div class="k">${t('empire.mining')}</div><div class="v">+${fmt(mining)}</div></div>
      </div>
      <h4 style="font-size:12.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-dim);margin:10px 0 6px">${t('empire.worlds', { n: mine.length })}</h4>
      ${mine.map(p => `<div class="listrow" data-p="${p.id}">
        <span class="dot" style="background:${tempHex(p.temp)}"></span>
        <span class="nm">${p.name}${p.terraBudget ? ' <span class="muted small">⚙</span>' : ''}</span>
        <span class="num">${t('planet.popValue', { pop: fmt1(p.pop), cap: planetCapacity(p) })}</span>
      </div>`).join('') || `<p class="muted small">${t('empire.noColonies')}</p>`}
      <h4 style="font-size:12.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-dim);margin:14px 0 6px">${t('empire.fleets')}</h4>
      ${v.fleets.filter(f => f.mine).map(f => {
        const where = f.at != null ? t('empire.inOrbitOf', { planet: v.planets[f.at].name })
          : (f.dest != null ? t('empire.enRouteTo', { planet: v.planets[f.dest].name })
            : t('fleet.enRoute'));
        return `<div class="listrow" data-f="${f.id}">
          <span class="dot" style="background:${v.me.color}"></span>
          <span class="nm">${t('word.ships', { n: f.ships.length, count: f.ships.length })} · ${where}</span>
          <span class="num">${f.stats.attack || 0}⚔</span>
        </div>`;
      }).join('') || `<p class="muted small">${t('empire.noFleets')}</p>`}
    `;
    for (const row of box.querySelectorAll('[data-p]')) {
      row.onclick = () => {
        const p = v.planets[+row.dataset.p];
        this.app.map.focus(p, this.app.freeArea());
        this.app.setSelection({ type: 'planet', id: p.id });
      };
    }
    for (const row of box.querySelectorAll('[data-f]')) {
      row.onclick = () => {
        const f = v.fleets.find(x => x.id === row.dataset.f);
        this.app.map.focus(f.at != null ? v.planets[f.at] : f, this.app.freeArea());
        this.app.setSelection({ type: 'fleet', id: f.id });
      };
    }
  }

  // -------------------------------------------------------------- Players
  players() {
    const v = this.view;
    const box = $('#tab-players');
    let place = 0;
    box.innerHTML = `<p class="hint-line rank-hint">${v.maxTurns ? t('rank.hint', { n: v.maxTurns }) : t('rank.hintEndless')}</p>` + ranking(v.players).map(p => {
      if (p.alive) place++;
      return `
      <div class="listrow rankrow ${p.ready ? 'rdy' : ''} ${p.id === v.you ? 'me' : ''} ${p.alive ? '' : 'dead'}">
        <span class="rank">${p.alive ? place : '–'}</span>
        ${avatarHtml(p, 22)}
        <span class="who">
          <span class="nm" title="${p.name}${p.persona ? ' – ' + t(`persona.${p.persona}`) + ': ' + t(`persona.${p.persona}.desc`) : ''}">${p.name}</span>
          <small>${[p.id === v.host ? t('rank.host') : null,
                    p.isBot ? t('word.ai') + (p.persona ? ' · ' + t(`persona.${p.persona}`) : '')
                      + (p.level ? ' · ' + t(`ai.${p.level}`) : '') : null,
                    p.connected || p.isBot ? null : t('word.offline'),
                    p.alive ? `${t('word.worlds', { n: p.stats.planets, count: p.stats.planets })} · ${t('word.ships', { n: p.stats.ships, count: p.stats.ships })}` : null
                   ].filter(Boolean).join(' · ')}</small>
        </span>
        <span class="num"><b>${p.alive ? t('word.pop', { n: fmt1(p.stats.pop) }) : t('rank.out')}</b></span>
      </div>`;
    }).join('');
  }

  // ------------------------------------------------------------ Selection
  selection() {
    const sel = this.app.selection;
    const box = $('#selection');
    if (!sel) { box.innerHTML = `<p class="muted pad">${t('sel.empty')}</p>`; return; }
    if (sel.type === 'planet') this.planetPanel(box, this.view.planets[sel.id]);
    else this.fleetPanel(box, this.view.fleets.find(f => f.id === sel.id));
  }

  planetPanel(box, p) {
    if (!p) { box.innerHTML = ''; return; }
    const v = this.view, me = v.me;
    const ownerP = p.owner ? v.players.find(q => q.id === p.owner) : null;
    // Careful: when spectating, v.you is null - an ownerless world would
    // otherwise be "mine" (null === null) and the panel would offer the
    // shipyard and terraforming.
    const isMine = !!v.you && p.owner === v.you;
    const econ = isMine || (v.spectator && !!p.owner);   // spectators see every balance
    const unknown = p.known === 'unknown';
    const orbit = v.fleets.filter(f => f.at === p.id);
    const myFleets = orbit.filter(f => f.mine);
    const incoming = v.fleets.filter(f => f.dest === p.id && f.at !== p.id)
      .sort((a, b) => this.eta(a, p) - this.eta(b, p));

    if (unknown) {
      box.innerHTML = `
        <div class="sel-head"><div><div class="sel-title">${p.name}</div>
        <div class="sel-sub">${t('planet.unknown')}</div></div></div>
        <p class="hint-line">${t('planet.scoutHint')}</p>
        ${this.courseButton(p)}`;
      this.wireCourse(box, p);
      return;
    }

    const hab = habitability(p);
    const cap = planetCapacity(p);
    // Spectators have no empire of their own: then the owner's tech counts.
    const radical = me ? me.tech.radical
      : (v.players.find(q => q.id === p.owner)?.tech?.radical ?? 1);
    const allow = terraformable(p, radical);
    const fullCost = terraformFullCost(p, radical);
    const lim = terraLimits(radical);
    const dT = p.temp - IDEAL.temp, dG = p.grav - IDEAL.grav;

    box.innerHTML = `
      <div class="sel-head">
        <span id="thumb"></span>
        <div>
          <div class="sel-title">${p.name}${p.isHomeworld ? ' ★' : ''}</div>
          <div class="sel-sub">${ownerP ? `<span style="color:${ownerP.color}">${ownerP.name}</span>` : t('planet.unsettled')}
            ${p.known === 'memory' ? ` · ${t('planet.memory', { turn: p.turn })}` : ''}</div>
        </div>
      </div>

      ${this.courseButton(p)}

      <div class="statgrid">
        <div class="stat"><div class="k">${t('planet.temp')}</div><div class="v">${fmt1(p.temp)} °C</div>
          <div class="small muted">${dT === 0 ? t('planet.ideal')
            : t('planet.offIdeal', { delta: (dT > 0 ? '+' : '') + fmt1(dT) + ' °C' })}</div></div>
        <div class="stat"><div class="k">${t('planet.grav')}</div><div class="v">${(+p.grav).toFixed(2)} g</div>
          <div class="small muted">${Math.abs(dG) < 0.005 ? t('planet.ideal')
            : t('planet.offIdeal', { delta: (dG > 0 ? '+' : '') + dG.toFixed(2) + ' g' })}</div></div>
        <div class="stat"><div class="k">${t('planet.pop')}</div><div class="v">${t('planet.popValue', { pop: fmt1(p.pop), cap })}</div>
          <div class="meter"><i style="width:${cap ? Math.min(100, p.pop / cap * 100) : 0}%;background:#52d98a"></i></div></div>
        <div class="stat"><div class="k">${t('planet.habitability')}</div><div class="v">${Math.round(hab * 100)} %</div>
          <div class="meter"><i style="width:${hab * 100}%;background:linear-gradient(90deg,#4d7fe0,#52d98a)"></i></div></div>
        <div class="stat"><div class="k">${t('planet.ore')}</div><div class="v">${fmt(p.metalReserve)}</div>
          <div class="small muted">${p.metalReserve > 0 ? t('planet.oreGrade', { n: (+p.metalRichness).toFixed(2) }) : t('planet.deepMining')}</div></div>
        <div class="stat"><div class="k">${t(econ ? 'planet.yield' : 'planet.defense')}</div>
          <div class="v">${econ ? '+' + fmt(planetIncome(p)) : t('planet.satellitesShort', { n: p.defenses || 0 })}</div>
          <div class="small muted">${econ ? '+' + fmt(planetMining(p)) + ' ' + t('unit.metal')
            : t('planet.satellites', { n: p.defenses || 0, count: p.defenses || 0 })}</div></div>
      </div>

      ${isMine ? this.defenseSection(p, orbit) : ''}

      ${isMine ? `
      <div class="sec">
        <h4>${t('terra.title')}</h4>
        ${fullCost === 0 && allow.temp && allow.grav
          ? `<p class="small" style="color:var(--good)">${t('terra.perfect')}</p>`
          : `
          ${(!allow.temp || !allow.grav) ? `<p class="small" style="color:#ffb347">
              ${t('terra.radicalShort', {
                level: radical, temp: Math.round(lim.temp), grav: lim.grav.toFixed(2),
                what: t(!allow.temp && !allow.grav ? 'terra.whatBoth'
                  : (!allow.temp ? 'terra.whatTemp' : 'terra.whatGrav'))
              })}</p>` : ''}
          ${fullCost > 0 ? `
          <label class="field slim" style="margin:6px 0">
            <span>${t('terra.budget')} <b id="tb-val">${fmt(p.terraBudget || 0)}</b></span>
            <input type="range" id="tb" min="0" max="${Math.max(10, Math.min(fullCost, Math.max(me.money, p.terraBudget || 0)))}" step="10" value="${p.terraBudget || 0}">
          </label>
          <div class="small muted">${t('terra.totalCost', { cost: fmt(fullCost) })}
            ${p.terraBudget ? ' ' + t('terra.readyIn', { n: Math.ceil(fullCost / p.terraBudget) }) : ''}</div>
          <div class="sel-actions">
            <button class="tiny" id="tb-full">${t('terra.full')}</button>
            <button class="tiny" id="tb-off">${t('terra.stop')}</button>
          </div>` : ''}
        `}
      </div>

      ${p.pop >= 1 ? `
      <div class="sec">
        <h4>${t('yard.title')}</h4>
        <div id="buildrows"></div>
        <div class="small muted" id="buildsum"></div>
        ${this.refitBlock('p:' + p.id, t('refit.satellites'))}
      </div>` : `<div class="sec"><h4>${t('yard.title')}</h4><p class="small muted">${t('yard.needPop')}</p></div>`}
      ` : ''}

      ${orbit.length ? `
      <div class="sec">
        <h4>${t('fleet.inOrbit')}</h4>
        <div class="shiplist">${orbit.map(f => this.fleetRow(f, p)).join('')}</div>
      </div>` : ''}

      ${incoming.length ? `
      <div class="sec">
        <h4>${t('fleet.incoming')}</h4>
        <div class="shiplist">${incoming.map(f => this.fleetRow(f, p)).join('')}</div>
      </div>` : ''}

      ${myFleets.some(f => f.ships.some(s => s.colonists > 0)) ? (!p.owner
        ? `<p class="hint-line" style="color:var(--good)">${t('fleet.colonyAboard')}</p>`
        : (isMine && p.pop < cap
          ? `<div class="sel-actions"><button class="tiny" id="unload">${t('fleet.unload')}</button></div>`
          : '')) : ''}
    `;

    const th = box.querySelector('#thumb');
    if (th) th.appendChild(planetThumb(p, 46));
    // shipIcon keeps every image only once - one copy per row, otherwise it
    // wanders into the last fleet of the same color.
    for (const g of box.querySelectorAll('.ci')) {
      const ic = shipIcon(g.dataset.t, 18, g.dataset.c);
      const copy = document.createElement('canvas');
      copy.width = ic.width; copy.height = ic.height;
      copy.getContext('2d').drawImage(ic, 0, 0);
      g.appendChild(copy);
    }

    const tb = box.querySelector('#tb');
    if (tb) {
      tb.oninput = (e) => {
        p.terraBudget = +e.target.value;
        box.querySelector('#tb-val').textContent = fmt(+e.target.value);
        this.sendSlider({ t: 'orders', terraform: { planetId: p.id, budget: +e.target.value } });
      };
      tb.onchange = (e) => this.app.send({ t: 'orders', terraform: { planetId: p.id, budget: +e.target.value } });
      box.querySelector('#tb-full').onclick = () => {
        const val = Math.min(fullCost, me.money);
        this.app.send({ t: 'orders', terraform: { planetId: p.id, budget: val } });
      };
      box.querySelector('#tb-off').onclick = () => {
        this.app.send({ t: 'orders', terraform: { planetId: p.id, budget: 0 } });
      };
    }

    const rows = box.querySelector('#buildrows');
    if (rows) this.buildRows(rows, box.querySelector('#buildsum'), p);

    this.wireRefit(box);
    const ul = box.querySelector('#unload');
    if (ul) ul.onclick = () => {
      this.app.send({ t: 'orders', unload: { planetId: p.id } });
      this.toast(t('fleet.unloadToast'));
    };

    for (const item of box.querySelectorAll('[data-fleet]')) {
      item.onclick = () => this.app.setSelection({ type: 'fleet', id: item.dataset.fleet });
    }
    this.wireCourse(box, p);
  }

  /** Turns until a fleet reaches the world - the server names those of foreign fleets. */
  eta(f, p) {
    if (!f.mine) return f.eta ?? Infinity;
    const speed = f.stats?.speed || 0;
    return speed > 0 ? Math.max(1, Math.ceil(travelDistance(f, p, holeZone(this.view.galaxy)) / speed)) : Infinity;
  }

  /** Ship types of a fleet as small images with counts. */
  composition(f, color) {
    const per = {};
    for (const s of f.ships) per[s.type] = (per[s.type] || 0) + 1;
    return SHIP_TYPES.filter(type => per[type]).map(type =>
      `<span class="comp" title="${per[type]}× ${t(`ship.${type}.name`)}"><span class="ci" data-t="${type}" data-c="${color}"></span>${per[type]}</span>`).join('');
  }

  /**
   * A fleet in orbit or incoming. For own fleets, firepower and hull are
   * shown; for foreign ones only which ships they are.
   */
  fleetRow(f, p) {
    const v = this.view;
    const pl = v.players.find(q => q.id === f.owner);
    const color = pl?.color || '#9fb0c8';
    const target = f.dest != null && f.dest !== p.id ? v.planets[f.dest] : null;
    const arriving = f.dest === p.id && f.at !== p.id;
    const turns = arriving ? this.eta(f, p) : null;
    let right, below = '';
    if (f.mine) {
      const hp = f.ships.reduce((a, s) => a + s.hp, 0), max = f.ships.reduce((a, s) => a + s.maxHp, 0);
      right = `${fmt1(f.stats.attack || 0)} ⚔ · ${fmt(hp)}/${fmt(max)} HP`;
      below = `<div class="meter"><i style="width:${max ? hp / max * 100 : 0}%;background:${hp / max > 0.5 ? 'var(--good)' : hp / max > 0.25 ? 'var(--gold)' : 'var(--bad)'}"></i></div>`;
    } else {
      right = `<span class="muted">${t('fleet.strengthUnknown')}</span>`;
    }
    const whither = arriving && Number.isFinite(turns) ? t('fleet.arrivesIn', { turns: t('word.turns', { n: turns, count: turns }) })
      : target ? `→ ${escapeHtml(target.name)}` : '';
    return `<div class="fleetrow ${f.mine ? '' : 'foe'}" data-fleet="${f.id}">
      <div class="fr-top">
        <span class="dot" style="background:${color}"></span>
        <span class="fr-name">${f.mine ? t('fleet.own') : escapeHtml(pl?.name || '?')}</span>
        <span class="hp">${right}</span>
      </div>
      ${below}
      <div class="fr-sub"><span class="fr-comp">${this.composition(f, color)}</span><span>${whither}</span></div>
    </div>`;
  }

  /**
   * Defense of an own world: the planetary defense that grows with the
   * population, the satellites including the shield, the firepower in
   * orbit - and a warning when enemies are there or on their way.
   */
  defenseSection(p, orbit) {
    const v = this.view, me = v.me;
    const bat = batteryStats(p.pop, me.tech);
    const ds = p.defenseStats;
    const n = p.defenses || 0;
    const own = orbit.filter(f => f.mine).reduce((a, f) => a + (f.stats.attack || 0), 0);
    const total = (bat?.attack || 0) + (ds?.attack || 0) + own;
    const enemyOrbit = orbit.filter(f => !f.mine);
    const enemyIncoming = v.fleets.filter(f => !f.mine && f.dest === p.id && f.at !== p.id);
    const ships = (f) => t('word.ships', { n: f.ships.length, count: f.ships.length });
    const warnings = [
      ...enemyOrbit.map(f => t('def.enemyOrbit', {
        player: escapeHtml(v.players.find(q => q.id === f.owner)?.name || '?'), ships: ships(f) })),
      ...enemyIncoming.map(f => t(f.eta ? 'def.enemyIncoming' : 'def.enemyIncomingNoEta', {
        player: escapeHtml(v.players.find(q => q.id === f.owner)?.name || '?'), ships: ships(f),
        turns: f.eta ? t('word.turns', { n: f.eta, count: f.eta }) : '' }))
    ];
    const outdated = ds && (ds.weapons < me.tech.weapons || ds.shields < me.tech.shields);
    return `
      <div class="sec">
        <h4>${t('def.title')}</h4>
        ${warnings.map(w => `<p class="def-warn">⚠ ${w}</p>`).join('')}
        <div class="statgrid">
          <div class="stat"><div class="k">${t('def.battery')}</div>
            <div class="v">${bat ? fmt1(bat.attack) + ' ⚔' : '–'}</div>
            <div class="small muted">${bat ? t('def.batteryInfo', { hp: fmt(bat.hp) }) : t('def.batteryNone')}</div></div>
          <div class="stat"><div class="k">${t('def.satellites')}</div>
            <div class="v">${n}${ds ? ` · ${fmt1(ds.attack)} ⚔` : ''}</div>
            ${ds ? `<div class="small muted">${fmt(ds.hp)}/${fmt(ds.maxHp)} HP</div>
              <div class="meter"><i style="width:${ds.maxHp ? ds.hp / ds.maxHp * 100 : 0}%;background:var(--good)"></i></div>`
              : `<div class="small muted">${t('def.satNone')}</div>`}</div>
        </div>
        ${n >= SHIELD_MIN ? `<p class="hint-line" style="color:var(--good)">⬡ ${t('def.shieldOn')}</p>`
          : n > 0 ? `<p class="hint-line">${t('def.shieldSoon', { n: SHIELD_MIN - n, count: SHIELD_MIN - n })}</p>` : ''}
        ${outdated ? `<p class="hint-line">${t('def.satTech', { w: ds.weapons, s: ds.shields, W: me.tech.weapons, S: me.tech.shields })}</p>` : ''}
        <div class="def-total"><span>${t('def.total')}</span><b>${fmt1(total)} ⚔</b></div>
        <div class="small muted">${t('def.totalHint')}</div>
      </div>`;
  }

  buildRows(rows, sum, p) {
    const me = this.view.me;
    const queue = me.builds[p.id] || {};
    // Prices by the tech levels that apply at build time - otherwise the sum
    // below would not match the rows above it.
    const pl = this.plan();
    rows.innerHTML = '';
    for (const type of SHIP_TYPES) {
      const cost = shipCost(type, pl.tech);
      const n = queue[type] || 0;
      const row = document.createElement('div');
      row.className = 'buildrow';
      row.innerHTML = `
        <span class="bi"></span>
        <span>
          <div class="bname">${t(`ship.${type}.name`)}</div>
          <div class="bcost">${fmt(cost.money)} ${t('unit.cr')} · ${fmt(cost.metal)} ${t('unit.metal')}</div>
        </span>
        <span class="bq">
          <button class="tiny minus">−</button>
          <span class="n">${n}</span>
          <button class="tiny plus"${this.affordable({ build: [p.id, type] }) ? '' : ` disabled title="${t('yard.cantAfford')}"`}>+</button>
        </span>`;
      row.querySelector('.bi').appendChild(shipIcon(type, 30, me.color));
      row.title = t(`ship.${type}.desc`) + ' ' + t('shipinfo.hint');
      for (const el of [row.querySelector('.bi'), row.querySelector('.bname')]) {
        el.parentElement.classList.add('clickable-ship');
        el.onclick = () => this.showShip(type, pl.tech, null, pl.breakthrough ? t('yard.breakthrough') : '');
      }
      row.querySelector('.plus').onclick = () => this.app.send({ t: 'orders', build: { planetId: p.id, type, count: 1 } });
      row.querySelector('.minus').onclick = () => this.app.send({ t: 'orders', build: { planetId: p.id, type, count: -1 } });
      rows.appendChild(row);
    }
    let cm = 0, ce = 0;
    for (const [type, count] of Object.entries(queue)) {
      const c = shipCost(type, pl.tech);
      cm += c.money * count; ce += c.metal * count;
    }
    // Exactly two lines, always: the refit button and fleets sit below, and
    // they must not move when clicking + and -. Whatever does not fit on one
    // line is shown in full in the tooltip. Whether the money suffices is
    // already checked by the server (disabled +); the ledger above shows the math.
    const tight = pl.missingMoney > 0 || pl.missingMetal > 0;      // should not happen
    const otherMoney = pl.buildMoney - cm, otherMetal = pl.buildMetal - ce;
    const line1 = cm || ce
      ? t('yard.orderShort', { money: fmt(cm), metal: fmt(ce) })
      : t('yard.noOrder');
    const line2 = [
      pl.breakthrough && (cm || ce) ? t('yard.breakthrough') : null,
      otherMoney > 0 || otherMetal > 0 ? t('yard.otherYards', { money: fmt(otherMoney), metal: fmt(otherMetal) }) : null
    ].filter(Boolean).join(' ');
    sum.className = 'small buildsum';
    sum.innerHTML = `<div class="${cm || ce ? '' : 'muted'}" style="${tight ? 'color:var(--bad)' : ''}"></div><div class="muted"></div>`;
    const [l1, l2] = sum.children;
    l1.textContent = line1; l1.title = line1;
    l2.textContent = line2 || '\u00a0'; l2.title = line2;
  }

  /**
   * Can this fleet go there? Computed as on the server (shared functions from
   * shared/rules.js) so the UI does not offer something the server would
   * reject right away.
   * @returns {string|null} the reason, or null if it is possible
   */
  whyNot(f, target) {
    const v = this.view;
    if (!f.stats || f.stats.speed <= 0) return t('err.fleetImmobile');
    const bases = v.planets.filter(q => q.owner === v.you && q.pop > 0.5);
    if (!bases.length) return t('err.outOfRange', { need: '∞', range: f.stats.range });
    const need = supplyDistance(bases, target, holeZone(v.galaxy));
    if (need > f.stats.range) {
      return t('err.outOfRange', { need: Math.round(need), range: f.stats.range });
    }
    return null;
  }

  /**
   * "Fleet here" for the most recently selected own fleet. Applies to every
   * world - including your own: bringing fleets home is defense, and
   * inhabited own worlds are the stepping stones for range.
   * It is only hidden when the fleet is already there; if it is not
   * possible, the reason is shown below instead of a rejection after the click.
   */
  courseButton(p) {
    const f = this.view.fleets.find(x => x.id === this.lastFleetId);
    if (!this.lastFleetId || !f || !f.mine || f.at === p.id) return '';
    const reason = this.whyNot(f, p);
    const button = `<button id="setcourse" class="primary"${reason ? ' disabled' : ''}>`
      + `${t('planet.courseButton', { n: f.ships.length })}</button>`;
    return `<div class="sel-actions">${button}</div>`
      + (reason ? `<p class="hint-line" style="color:var(--bad)">${t('fleet.cannotReach', { reason })}</p>` : '');
  }

  wireCourse(box, p) {
    const b = box.querySelector('#setcourse');
    if (b) b.onclick = () => this.app.order(p.id);
  }

  fleetPanel(box, f) {
    if (!f) { box.innerHTML = ''; return; }
    const v = this.view;
    this.lastFleetId = f.id;
    if (!f.mine && !v.spectator) {
      const pl = v.players.find(q => q.id === f.owner);
      // Detected means: course and arrival are known, the ships themselves are not.
      const target = f.dest != null ? v.planets[f.dest] : null;
      const whither = target
        ? `<div class="sel-sub">${t('fleet.courseTo', { planet: target.name }).replace('<b>', '<b style="color:var(--gold)">')}`
          + (f.eta ? ' ' + t('fleet.etaSuffix', { turns: t('word.turns', { n: f.eta, count: f.eta }) }) : '')
          + '</div>'
        : `<div class="sel-sub">${t('fleet.noCourse')}</div>`;
      box.innerHTML = `<div class="sel-head"><div><div class="sel-title">${t('fleet.foreign')}</div>
        <div class="sel-sub" style="color:${pl?.color}">${pl?.name || '?'}</div>${whither}</div></div>
        <p class="hint-line">${t('fleet.detected', { ships: t('word.ships', { n: f.ships.length, count: f.ships.length }) })}</p>`;
      return;
    }
    const groups = {};
    for (const s of f.ships) (groups[s.type] || (groups[s.type] = [])).push(s);
    const where = f.at != null ? v.planets[f.at] : null;
    const destP = f.dest != null ? v.planets[f.dest] : null;
    const st = f.stats;
    // The path around the black hole counts, not the straight line.
    const turnsTo = destP
      ? Math.max(1, Math.ceil(travelDistance(f, destP, holeZone(v.galaxy)) / (st.speed || 1)))
      : 0;

    box.innerHTML = `
      <div class="sel-head">
        <div>
          <div class="sel-title">${v.spectator
            ? `<span style="color:${(v.players.find(q => q.id === f.owner) || {}).color}">${(v.players.find(q => q.id === f.owner) || {}).name || '?'}</span> · `
            : ''}${t('fleet.title', { n: f.ships.length })}</div>
          <div class="sel-sub">${where ? t('fleet.atPlanet', { planet: where.name }) : t('fleet.enRoute')}
            ${destP ? ' ' + t('fleet.destSuffix', { planet: destP.name, turns: turnsTo })
              .replace('<b>', '<b style="color:var(--gold)">') : ''}</div>
        </div>
      </div>
      <div class="statgrid cols4">
        <div class="stat"><div class="k">${t('fleet.speed')}</div><div class="v">${Math.round(st.speed)} ${t('unit.lyPerTurn')}</div></div>
        <div class="stat"><div class="k">${t('fleet.range')}</div><div class="v">${fmt(st.range)} ${t('unit.ly')}</div></div>
        <div class="stat"><div class="k">${t('fleet.attack')}</div><div class="v">${st.attack}</div></div>
        <div class="stat"><div class="k">${t('fleet.hull')}</div><div class="v">${Math.round(st.hp)}</div></div>
      </div>
      <div class="sec">
        <h4>${t('fleet.ships')}</h4>
        <div class="shiplist">
          ${Object.entries(groups).map(([type, arr]) => `
            <div class="shipitem clickable-ship" data-info="${type}" title="${t('shipinfo.hint')}">
              <span class="gi" data-t="${type}"></span>
              <span>${arr.length}× ${t(`ship.${type}.name`)}
                <span class="muted small">(${t('tech.weapons.short')}${arr[0].tech.weapons}/${t('tech.shields.short')}${arr[0].tech.shields}/${t('tech.speed.short')}${arr[0].tech.speed})</span></span>
              <span class="hp">${Math.round(arr.reduce((a, s) => a + s.hp, 0))} HP</span>
            </div>`).join('')}
        </div>
      </div>
      ${!f.mine ? '' : `
      <div class="sec">
        <h4>${t('fleet.orders')}</h4>
        <p class="hint-line" style="margin-top:0">${t('fleet.orderHint')}</p>
        <div class="sel-actions">
          ${destP ? `<button class="tiny" id="cancel">${t('fleet.cancelCourse')}</button>` : ''}
          ${where && v.fleets.filter(x => x.mine && x.at === f.at).length > 1
            ? `<button class="tiny" id="merge">${t('fleet.merge')}</button>` : ''}
          ${f.ships.length > 1 && where ? `<button class="tiny" id="split">${t('fleet.split')}</button>` : ''}
        </div>
        ${where ? this.refitBlock('f:' + f.id, t('refit.fleet')) : ''}
      </div>`}
      ${f.mine && !v.spectator ? this.cargoSection(f, where) : ''}`;

    const col = (f.mine && v.me) ? v.me.color
      : ((v.players.find(q => q.id === f.owner) || {}).color || '#9fb0c8');
    for (const g of box.querySelectorAll('.gi')) g.appendChild(shipIcon(g.dataset.t, 26, col));
    // The built-in tech of these ships, not the current levels
    for (const el of box.querySelectorAll('[data-info]')) {
      el.onclick = () => this.showShip(el.dataset.info, groups[el.dataset.info][0].tech, col);
    }
    const c = box.querySelector('#cancel');
    if (c) c.onclick = () => this.app.send({ t: 'orders', move: { fleetId: f.id, planetId: null } });
    const m = box.querySelector('#merge');
    if (m) m.onclick = () => this.app.send({ t: 'orders', merge: { planetId: f.at } });
    const sp = box.querySelector('#split');
    if (sp) sp.onclick = () => openSplit(f, {
      color: col,
      onSplit: (ships, each) => this.app.send({ t: 'orders', split: { fleetId: f.id, ships, each } })
    });
    this.wireRefit(box);
    this.wireCargo(box, f);
  }

  /**
   * Hold of the transporters: what is aboard, and - in orbit of an own
   * world - taking satellites aboard and setting them down. One number for
   * both directions; the server takes at most what fits or is there.
   */
  cargoSection(f, where) {
    const c = cargoOf(f.ships);
    if (!c.capacity) return '';
    const own = where && where.owner === this.view.you;
    const here = own ? where.defenses || 0 : 0;
    const most = Math.max(Math.min(c.room, here), c.used);
    if (this.cargoFleet !== f.id) { this.cargoFleet = f.id; this.cargoPick = most; }
    this.cargoPick = Math.max(1, Math.min(this.cargoPick, most || 1));
    return `
      <div class="sec">
        <h4>${t('fleet.cargo')}</h4>
        <div class="small">${t('fleet.cargoValue', { used: c.used, capacity: c.capacity })}</div>
        <div class="meter"><i style="width:${c.used / c.capacity * 100}%;background:var(--gold)"></i></div>
        ${own ? `
        <p class="hint-line">${t('fleet.cargoHere', { n: here, count: here })}</p>
        <div class="buildrow">
          <span class="bq" style="margin-left:0">
            <button class="tiny" id="cq-minus">−</button>
            <span class="n" id="cq">${this.cargoPick}</span>
            <button class="tiny" id="cq-plus">+</button>
          </span>
          <button class="tiny" id="cargo-load"${c.room && here ? '' : ' disabled'}>${t('fleet.load')}</button>
          <button class="tiny" id="cargo-drop"${c.used ? '' : ' disabled'}>${t('fleet.drop')}</button>
        </div>
        <p class="hint-line">${t('fleet.cargoHint')}</p>`
        : `<p class="hint-line">${t('fleet.cargoAway')}</p>`}
      </div>`;
  }

  wireCargo(box, f) {
    const n = box.querySelector('#cq');
    if (!n) return;
    const step = (d) => { this.cargoPick = Math.max(1, this.cargoPick + d); n.textContent = this.cargoPick; };
    box.querySelector('#cq-minus').onclick = () => step(-1);
    box.querySelector('#cq-plus').onclick = () => step(1);
    box.querySelector('#cargo-load').onclick = () =>
      this.app.send({ t: 'orders', load: { fleetId: f.id, count: this.cargoPick } });
    box.querySelector('#cargo-drop').onclick = () =>
      this.app.send({ t: 'orders', drop: { fleetId: f.id, count: this.cargoPick } });
  }

  // ------------------------------------------------------------------ Log
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
      p.sides = p.sides.map(x => `${x.name} ${x.left}/${x.before}`).join(' vs. ');
    }
    if (p.ship) p.ship = t(`ship.${p.ship}.name`);
    if (p.direction) p.direction = t(`dir.${p.direction}`);
    if (typeof p.before === 'number') p.before = fmt1(p.before);
    if (typeof p.after === 'number') p.after = fmt1(p.after);
    if (typeof p.amount === 'number') p.amount = fmt1(p.amount);
    if (e.because?.key) p.because = t(e.because.key, e.because.params);
    return t(e.key, p);
  }

  log() {
    const box = $('#log-list');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.innerHTML = this.view.log.slice().reverse().map(l => `
      <div class="logturn">${t('log.turnHeader', { turn: l.turn })}</div>
      ${l.entries.map(e => {
        const key = `${l.turn}:${e.planetId}`;
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
  }

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
  }

  /** Are the comms on screen right now? */
  chatVisible() {
    if (document.hidden) return false;
    const tab = document.querySelector('#logdock .tabs button[data-ltab="chat"]');
    if (!tab?.classList.contains('active')) return false;
    if (compact.matches) return $('#screen-game').dataset.sheet === 'log';
    return !$('#logdock').classList.contains('collapsed');
  }

  /** Called whenever the comms may have come into view. */
  chatSeen() {
    if (!this.unread || !this.chatVisible()) return;
    this.unread = 0;
    this.paintUnread();
  }

  paintUnread() {
    for (const b of document.querySelectorAll('.chat-badge')) {
      b.textContent = this.unread > 9 ? '9+' : String(this.unread);
      b.classList.toggle('hidden', !this.unread);
    }
  }

  /** Show the comms with the input field - wherever they are hiding. */
  openChat() {
    if (compact.matches) this.app.showSheet?.('log');
    else if (this.logDlg.collapsed()) this.logDlg.toggle(false);
    document.querySelector('#logdock .tabs button[data-ltab="chat"]').click();
  }

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
}

/** How well an AI plays - only spectators learn it, hard stands out in gold. */
function levelTag(p) {
  if (!p.isBot || !p.level) return '';
  return `<span class="small level-tag ${p.level}" title="${t(`ai.${p.level}.desc`)}">${t(`ai.${p.level}`)}</span>`;
}

/**
 * Order of the ranking - as the game scores at the turn limit: whoever has the
 * most inhabitants wins (server/game.js). On a tie, worlds count, then ships;
 * eliminated empires are at the bottom.
 */
function ranking(players) {
  return players.slice().sort((a, b) => (b.alive - a.alive)
    || b.stats.pop - a.stats.pop || b.stats.planets - a.stats.planets || b.stats.ships - a.stats.ships);
}

/** "3 worlds · 16.9 M · 5 ships" - every piece in its plural form. */
function statsText(worlds, pop, ships) {
  return t('top.myStats', {
    worlds: t('word.worlds', { n: worlds, count: worlds }),
    pop: t('word.pop', { n: fmt1(pop) }),
    ships: t('word.ships', { n: ships, count: ships })
  });
}

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
function tempHex(t) {
  const c = [
    [-180, [92, 108, 196]], [-90, [72, 168, 228]], [-30, [92, 212, 206]],
    [20, [96, 206, 108]], [70, [224, 206, 86]], [130, [232, 142, 58]], [220, [206, 62, 58]]
  ];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i][0]) {
      const [t0, a] = c[i - 1], [t1, b] = c[i];
      const f = Math.max(0, (t - t0) / (t1 - t0));
      return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
    }
  }
  return 'rgb(206,62,58)';
}
