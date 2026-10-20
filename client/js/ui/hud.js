// Alle Panels des Spielbildschirms.
import {
  TECH_FIELDS, SHIP_TYPES, shipCost, refitTotal,
  habitability, planetCapacity, planetIncome, planetMining,
  terraformFullCost, terraformable, terraLimits, IDEAL,
  holeZone, travelDistance, supplyDistance, batteryStats
} from '../../shared/rules.js';
import { SHIELD_MIN } from '../render/fx.js';
import { shipIcon } from '../render/ships.js';
import { planetThumb } from '../render/planets.js';
import { makeDialog } from './dialog.js';
import { openShipInfo } from './shipinfo.js';
import { forecast, refitShips } from '../../shared/budget.js';
import { avatarHtml } from './avatar.js';
import { t, n as num, localeTag } from '../i18n.js';

const $ = s => document.querySelector(s);
// Zahlen folgen der gewaehlten Sprache: 1.600 oder 1,600.
const fmt = n => Math.round(n).toLocaleString(localeTag());
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(localeTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export class Hud {
  constructor(app) {
    this.app = app;             // { send, map, selection, setSelection }
    this.view = null;
    this.splitPick = {};        // Schiffs-IDs für das Abspalten
    this.dragging = null;       // gerade gezogener Regler
    // Regler feuern bis zu 60-mal pro Sekunde, und jede Meldung zieht eine
    // komplette neue Sicht nach sich - deshalb gedrosselt senden.
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
      };
    }
    // Das Protokoll ist ein Fenster: verschiebbar, aufziehbar, einklappbar.
    const dock = $('#logdock');
    const dlg = makeDialog(dock, {
      handle: $('#log-bar'), grip: $('#log-grip'), key: 'ho-logdock',
      w: 460, h: 240, minW: 320, minH: 150
    });
    // Das Dock oben links ebenso: verschiebbar und aufziehbar.
    makeDialog($('#leftdock'), {
      handle: $('#left-bar'), grip: $('#left-grip'), key: 'ho-leftdock',
      x: 12, y: 72, w: 300, h: Math.max(260, Math.min(520, innerHeight - 332)), minW: 260, minH: 200
    });
    const klappen = () => {
      const zu = dock.classList.toggle('collapsed');
      $('#log-collapse').textContent = zu ? '+' : '\u2212';
      dlg.refresh();
    };
    $('#log-collapse').onclick = klappen;

    // Haushalt: mit dem Zeiger darueber zur Ansicht, per Klick angeheftet.
    const res = $('#res'), ledger = $('#ledger');
    let angeheftet = false;
    const zeige = (auf) => {
      ledger.classList.toggle('hidden', !auf);
      for (const b of res.querySelectorAll('button')) b.setAttribute('aria-expanded', String(auf));
      if (auf) this.ledger();
    };
    for (const b of res.querySelectorAll('button')) {
      b.onclick = () => { angeheftet = !angeheftet; zeige(angeheftet); };
    }
    res.onpointerenter = (e) => { if (e.pointerType === 'mouse' && this.view?.me) zeige(true); };
    res.onpointerleave = (e) => { if (e.pointerType === 'mouse' && !angeheftet) zeige(false); };
    addEventListener('pointerdown', (e) => {
      if (ledger.classList.contains('hidden') || res.contains(e.target)) return;
      angeheftet = false; zeige(false);
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !ledger.classList.contains('hidden')) { angeheftet = false; zeige(false); }
    });
    $('#log-bar').ondblclick = (e) => { if (!e.target.closest('button, input')) klappen(); };

    // Solange ein Regler gezogen wird, darf das Panel nicht neu aufgebaut
    // werden: der Neuaufbau ersetzt das Element und der Zug reißt ab.
    addEventListener('pointerdown', (e) => {
      if (e.target?.matches?.('input[type=range]')) this.dragging = e.target;
    }, true);
    const release = () => {
      if (!this.dragging) return;
      this.dragging = null;
      if (this.view) this.update(this.view);     // nachziehen, was liegen blieb
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
    // Panels mit Reglern beim Ziehen auslassen (siehe bindStatic)
    if (!this.dragging) { this.research(); this.selection(); }
  }

  /** Oberfläche fürs Zusehen umbauen: kein eigenes Reich, dafür der Takt. */
  chrome() {
    const sp = !!this._spectating;
    $('#btn-endturn').classList.toggle('hidden', sp);
    $('#spectate').classList.toggle('hidden', !sp);
    document.querySelector('#topbar .res').classList.toggle('hidden', sp);
    const tabs = [...document.querySelectorAll('#leftdock .tabs button')];
    tabs[0].textContent = t(sp ? 'tab.empires' : 'tab.research');
    for (const b of tabs.slice(1)) b.classList.toggle('hidden', sp);
    if (sp) {
      tabs[0].click();                                  // immer die Tabelle zeigen
      $('#chat-input-row').classList.add('hidden');
    }
    const chatTab = document.querySelector('#logdock .tabs button[data-ltab="chat"]');
    if (chatTab) chatTab.classList.toggle('hidden', sp);
  }

  /** Tabelle aller Reiche - beim Zusehen das Interessanteste am Bild. */
  league() {
    const v = this.view;
    const rows = rangfolge(v.players);
    const maxPop = Math.max(1, ...rows.map(p => p.stats.pop));
    $('#tab-research').innerHTML = `<div class="league">${rows.map(p => `
      <div class="row ${p.alive ? '' : 'dead'}">
        <div class="head">
          <span class="dot" style="width:9px;height:9px;border-radius:50%;background:${p.color};box-shadow:0 0 8px ${p.color}"></span>
          <span class="nm" title="${p.name}">${p.name}</span>
          ${p.persona ? `<span class="muted small" title="${t(`persona.${p.persona}.desc`)}">${t(`persona.${p.persona}`)}</span>` : ''}
        </div>
        <div class="num">${statsText(p.stats.planets, p.stats.pop, p.stats.ships)}</div>
        <div class="bar"><i style="width:${Math.round(p.stats.pop / maxPop * 100)}%;background:${p.color}"></i></div>
        <div class="tech">${TECH_FIELDS.map(f => t(`tech.${f}.short`) + p.tech[f]).join(' ')}
          · ${fmt(p.money)} ${t('unit.cr')} · ${fmt(p.metal)} ${t('unit.metal')}</div>
      </div>`).join('')}</div>`;
  }

  /**
   * Was am Rundenende mit Geld und Metall geschieht - gerechnet in
   * shared/budget.js genau wie im Server (test/budget.js haelt beides
   * zusammen). Hier nur fuer Kopfleiste, Werft und Haushalt aufbereitet.
   */
  plan() {
    const v = this.view, me = v?.me;
    if (!me) return null;
    const f = forecast(v);
    // Jede Zeile gerundet, die Summe aus den gerundeten Zeilen - sonst geht
    // die Rechnung im Haushalt um eine Einheit nicht auf.
    const r = Math.round;
    const hh = {
      jetzt: { geld: r(me.money), metall: r(me.metal) },
      forschung: r(f.forschung), anteil: me.research.budgetPct,
      bau: { geld: r(f.bau.gebucht.geld), metall: r(f.bau.gebucht.metall),
             ausfall: f.bau.geplant.n - f.bau.gebucht.n, gesamt: f.bau.geplant.n,
             ohneGeld: f.bau.ohneGeld, ohneMetall: f.bau.ohneMetall },
      umruest: { geld: r(f.umr.gebucht.geld), metall: r(f.umr.gebucht.metall),
                 fehlt: f.umr.geplant.n > f.umr.gebucht.n, ohneGeld: f.umr.ohneGeld, ohneMetall: f.umr.ohneMetall },
      terra: { geld: r(f.terra.gebucht), fehlt: r(f.terra.geplant - f.terra.gebucht), welten: f.terra.welten },
      ein: { geld: r(f.einnahmen), metall: r(f.foerderung) }
    };
    hh.danach = {
      geld: hh.jetzt.geld - hh.forschung - hh.bau.geld - hh.umruest.geld - hh.terra.geld + hh.ein.geld,
      metall: hh.jetzt.metall - hh.bau.metall - hh.umruest.metall + hh.ein.metall
    };
    hh.knapp = hh.bau.ausfall > 0 || hh.umruest.fehlt || hh.terra.fehlt > 0;

    // Fuer die Werft: Bau und Umrüstung zusammen, geplant gegen verfuegbar.
    const bauGeld = f.bau.geplant.geld + f.umr.geplant.geld;
    const bauErz = f.bau.geplant.metall + f.umr.geplant.metall;
    return {
      tech: f.tech, durchbruch: f.durchbruch, forschung: f.forschung,
      bauGeld, bauErz, geldFrei: f.verfuegbar.geld, erzFrei: f.verfuegbar.metall,
      fehltGeld: Math.max(0, bauGeld - f.verfuegbar.geld),
      fehltErz: Math.max(0, bauErz - f.verfuegbar.metall),
      haushalt: hh
    };
  }

  /**
   * Ginge der Haushalt mit diesem zusaetzlichen Auftrag noch auf? Dieselbe
   * Pruefung macht der Server - der Knopf zeigt nur vorher, was er annimmt.
   * @param {{build?: [number, string], refit?: string}} extra
   */
  leistbar(extra) {
    const v = this.view;
    const builds = JSON.parse(JSON.stringify(v.me.builds || {}));
    const refit = { ...(v.me.refit || {}) };
    if (extra.build) {
      const [pid, typ] = extra.build;
      (builds[pid] ||= {})[typ] = (builds[pid][typ] || 0) + 1;
    }
    if (extra.refit) refit[extra.refit] = true;
    const f = forecast({ ...v, me: { ...v.me, builds, refit } });
    return f.bau.geplant.n === f.bau.gebucht.n && f.umr.geplant.n === f.umr.gebucht.n;
  }

  /**
   * Was eine Umrüstung kostet ('f:<flotte>' oder 'p:<welt>'), mit dem
   * Techstand nach der Forschung. Null, wenn dort keine Werft ist oder
   * nichts veraltet.
   */
  refitFor(key, tech) {
    const r = refitTotal(refitShips(this.view, key), tech);
    return r.count ? r : null;
  }

  /** Steckbrief eines Schiffstyps; ohne Angabe mit dem eigenen Techstand. */
  showShip(type, tech, color, note) {
    const me = this.view?.me;
    openShipInfo(type, { tech: tech || me?.tech || {}, color: color || me?.color, note });
  }

  /** Knopf zum Umrüsten, oder der laufende Auftrag samt Abbrechen. */
  refitBlock(key, label) {
    const pl = this.plan();
    const r = pl && this.refitFor(key, pl.tech);
    if (!r) return '';
    const ordered = !!this.view.me.refit?.[key];
    const preis = t('refit.cost', { n: r.count, count: r.count, money: fmt(r.money), metal: fmt(r.metal) });
    // Knopf oben, eine Zeile Text darunter - in beiden Zuständen gleich, damit
    // nichts darunter verrutscht, wenn man umrüstet oder abbricht.
    const text = ordered ? t('refit.ordered', { cost: preis }) : preis;
    return `<div class="sel-actions">${ordered
        ? `<button class="tiny" data-refit="${key}" data-off="1">${t('refit.cancel')}</button>`
        : `<button class="tiny" data-refit="${key}"${this.leistbar({ refit: key }) ? '' : ` disabled title="${t('yard.cantAfford')}"`}>${label}</button>`}</div>
      <p class="small oneline" style="margin-top:4px;color:${ordered ? 'var(--good)' : 'var(--ink-faint)'}" title="${text}">${text}</p>`;
  }

  wireRefit(box) {
    for (const b of box.querySelectorAll('[data-refit]')) {
      const key = b.dataset.refit;
      const ziel = key.startsWith('f:') ? { fleetId: key.slice(2) } : { planetId: Number(key.slice(2)) };
      b.onclick = () => this.app.send({ t: 'orders', refit: { ...ziel, value: !b.dataset.off } });
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
      const paused = !!v.pace?.paused;
      $('#sp-play').textContent = paused ? t('spectate.resume') : t('spectate.pause');
      $('#sp-step').disabled = !paused || v.state !== 'running';
      for (const b of document.querySelectorAll('.sp-speeds button')) {
        b.classList.toggle('active', +b.dataset.ms === (v.pace?.ms ?? 1500));
      }
      return;
    }
    const me = v.me;
    const em = $('#me-emblem');
    em.style.background = `linear-gradient(135deg, ${me.color}, ${shadeHex(me.color, 0.55)})`;
    em.style.color = me.color;
    // Mit Bild zeigt das Wappen das Bild, die Farbe bleibt als Rahmen.
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

    // Jetzt -> nach dem Rundenende. Wie es dazu kommt, steht im Haushalt
    // (Klick oder Zeiger auf die Zahlen) - eine Rechnung, keine Einzelteile.
    const hh = this.plan().haushalt;
    $('#r-money').textContent = fmt(hh.jetzt.geld);
    $('#r-metal').textContent = fmt(hh.jetzt.metall);
    const naechste = (el, wert, knapp) => {
      el.textContent = '→ ' + fmt(wert);
      el.classList.toggle('knapp', knapp);
    };
    naechste($('#r-money-next'), hh.danach.geld, hh.bau.ohneGeld || hh.umruest.ohneGeld || hh.terra.fehlt > 0);
    naechste($('#r-metal-next'), hh.danach.metall, hh.bau.ohneMetall || hh.umruest.ohneMetall);
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
  }

  /**
   * Haushalt der laufenden Runde: von oben nach unten genau so, wie der
   * Server am Rundenende abbucht, unten das Ergebnis aus der Kopfleiste.
   */
  ledger() {
    const hh = this.plan()?.haushalt;
    if (!hh) return;
    const minus = n => n ? '−' + fmt(n) : '';
    const plus = n => n ? '+' + fmt(n) : '';
    const und = (...teile) => teile.filter(Boolean).join(` ${t('word.and')} `);
    const zeile = (cls, label, geld, metall, rüge = '') => `
      <tr class="${cls}"><th>${label}${rüge ? `<small class="bad">${rüge}</small>` : ''}</th>
        <td>${geld}</td><td>${metall}</td></tr>`;
    const zeilen = [zeile('stand', t('ledger.now'), fmt(hh.jetzt.geld), fmt(hh.jetzt.metall))];
    zeilen.push(zeile('', t('ledger.research', { pct: hh.anteil }), minus(hh.forschung), ''));
    // Woran es scheitert: Geld, Metall oder beides
    const woran = (x) => und(x.ohneGeld && t('top.money'), x.ohneMetall && t('top.metal'));
    if (hh.bau.gesamt) {
      zeilen.push(zeile('', t('ledger.build'), minus(hh.bau.geld), minus(hh.bau.metall),
        hh.bau.ausfall ? t('ledger.buildShort', { n: hh.bau.ausfall, total: hh.bau.gesamt, what: woran(hh.bau) }) : ''));
    }
    if (hh.umruest.geld || hh.umruest.metall || hh.umruest.fehlt) {
      zeilen.push(zeile('', t('ledger.refit'), minus(hh.umruest.geld), minus(hh.umruest.metall),
        hh.umruest.fehlt ? t('ledger.refitShort', { what: woran(hh.umruest) }) : ''));
    }
    if (hh.terra.welten) {
      zeilen.push(zeile('', t('ledger.terra', { n: hh.terra.welten, count: hh.terra.welten }), minus(hh.terra.geld), '',
        hh.terra.fehlt ? t('ledger.terraShort', { missing: fmt(hh.terra.fehlt) }) : ''));
    }
    zeilen.push(zeile('ein', t('ledger.income'), plus(hh.ein.geld), plus(hh.ein.metall)));
    zeilen.push(zeile('summe', t('ledger.next'), fmt(hh.danach.geld), fmt(hh.danach.metall)));
    $('#ledger').innerHTML = `
      <h4 id="ledger-title">${t('ledger.title', { turn: this.view.turn })}</h4>
      <table>
        <thead><tr><th></th><td>${t('top.money')}</td><td>${t('top.metal')}</td></tr></thead>
        <tbody>${zeilen.join('')}</tbody>
      </table>
      <p class="small muted">${t('ledger.order')}</p>`;
  }

  // Läuft in der Zeichenschleife: nur schreiben, wenn sich der Text ändert.
  timer() {
    const v = this.view;
    let txt = '';
    if (v?.deadline) {
      const left = Math.max(0, Math.round((v.deadline - Date.now()) / 1000));
      txt = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    }
    if (txt === this._timerTxt) return;
    this._timerTxt = txt;
    $('#r-timer').textContent = txt;
  }

  // ------------------------------------------------------------ Forschung
  research() {
    const v = this.view, me = v.me;
    const total = TECH_FIELDS.reduce((a, f) => a + me.research.weights[f], 0) || 1;
    // Dieselbe Zahl wie im Haushalt (abgerundet, ohne Gewichtung keine Forschung).
    const budget = this.plan().forschung;
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
    // Beim Loslassen den Endwert ungedrosselt nachschicken
    rb.onchange = (e) => this.app.send({ t: 'orders', research: { budgetPct: +e.target.value } });
    for (const row of box.querySelectorAll('.tech-row')) {
      const f = row.dataset.f;
      const wt = row.querySelector('.wt');
      wt.oninput = (e) => this.sendSlider({ t: 'orders', research: { weights: { [f]: +e.target.value } } });
      wt.onchange = (e) => this.app.send({ t: 'orders', research: { weights: { [f]: +e.target.value } } });
      row.querySelector('.tech-head').title = t(`tech.${f}.desc`);
    }
  }

  // ---------------------------------------------------------------- Reich
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
        this.app.map.focus(p, this.app.freiesFeld());
        this.app.setSelection({ type: 'planet', id: p.id });
      };
    }
    for (const row of box.querySelectorAll('[data-f]')) {
      row.onclick = () => {
        const f = v.fleets.find(x => x.id === row.dataset.f);
        this.app.map.focus(f.at != null ? v.planets[f.at] : f, this.app.freiesFeld());
        this.app.setSelection({ type: 'fleet', id: f.id });
      };
    }
  }

  // -------------------------------------------------------------- Spieler
  players() {
    const v = this.view;
    const box = $('#tab-players');
    let platz = 0;
    box.innerHTML = `<p class="hint-line rank-hint">${v.maxTurns ? t('rank.hint', { n: v.maxTurns }) : t('rank.hintEndless')}</p>` + rangfolge(v.players).map(p => {
      if (p.alive) platz++;
      return `
      <div class="listrow rankrow ${p.ready ? 'rdy' : ''} ${p.id === v.you ? 'me' : ''} ${p.alive ? '' : 'dead'}">
        <span class="rank">${p.alive ? platz : '–'}</span>
        ${avatarHtml(p, 22)}
        <span class="who">
          <span class="nm" title="${p.name}${p.persona ? ' – ' + t(`persona.${p.persona}`) + ': ' + t(`persona.${p.persona}.desc`) : ''}">${p.name}</span>
          <small>${[p.isBot ? t('word.ai') + (p.persona ? ' · ' + t(`persona.${p.persona}`) : '') : null,
                    p.connected || p.isBot ? null : t('word.offline'),
                    p.alive ? `${t('word.worlds', { n: p.stats.planets, count: p.stats.planets })} · ${t('word.ships', { n: p.stats.ships, count: p.stats.ships })}` : null
                   ].filter(Boolean).join(' · ')}</small>
        </span>
        <span class="num"><b>${p.alive ? t('word.pop', { n: fmt1(p.stats.pop) }) : t('rank.out')}</b></span>
      </div>`;
    }).join('');
  }

  // ------------------------------------------------------------ Auswahl
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
    // Achtung: beim Zusehen ist v.you null - eine herrenlose Welt wäre sonst
    // "meine" (null === null) und das Panel böte Werft und Terraforming an.
    const isMine = !!v.you && p.owner === v.you;
    const econ = isMine || (v.spectator && !!p.owner);   // Zuschauer sehen jede Bilanz
    const unknown = p.known === 'unknown';
    const orbit = v.fleets.filter(f => f.at === p.id);
    const myFleets = orbit.filter(f => f.mine);
    const anflug = v.fleets.filter(f => f.dest === p.id && f.at !== p.id)
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
    // Zuschauer haben kein eigenes Reich: dann zählt die Technik des Besitzers.
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

      ${this.courseButton(p)}

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

      ${anflug.length ? `
      <div class="sec">
        <h4>${t('fleet.incoming')}</h4>
        <div class="shiplist">${anflug.map(f => this.fleetRow(f, p)).join('')}</div>
      </div>` : ''}

      ${myFleets.some(f => f.ships.some(s => s.colonists > 0)) ? (!p.owner
        ? `<p class="hint-line" style="color:var(--good)">${t('fleet.colonyAboard')}</p>`
        : (isMine && p.pop < cap
          ? `<div class="sel-actions"><button class="tiny" id="unload">${t('fleet.unload')}</button></div>`
          : '')) : ''}
    `;

    const th = box.querySelector('#thumb');
    if (th) th.appendChild(planetThumb(p, 46));
    // shipIcon haelt jedes Bild nur einmal vor - je Zeile eine Kopie, sonst
    // wandert es in die letzte Flotte gleicher Farbe.
    for (const g of box.querySelectorAll('.ci')) {
      const ic = shipIcon(g.dataset.t, 18, g.dataset.c);
      const kopie = document.createElement('canvas');
      kopie.width = ic.width; kopie.height = ic.height;
      kopie.getContext('2d').drawImage(ic, 0, 0);
      g.appendChild(kopie);
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

  /** Runden, bis eine Flotte die Welt erreicht - fremde nennt der Server. */
  eta(f, p) {
    if (!f.mine) return f.eta ?? Infinity;
    const speed = f.stats?.speed || 0;
    return speed > 0 ? Math.max(1, Math.ceil(travelDistance(f, p, holeZone(this.view.galaxy)) / speed)) : Infinity;
  }

  /** Schiffstypen einer Flotte als kleine Bilder mit Anzahl. */
  komposition(f, color) {
    const je = {};
    for (const s of f.ships) je[s.type] = (je[s.type] || 0) + 1;
    return SHIP_TYPES.filter(typ => je[typ]).map(typ =>
      `<span class="comp" title="${je[typ]}× ${t(`ship.${typ}.name`)}"><span class="ci" data-t="${typ}" data-c="${color}"></span>${je[typ]}</span>`).join('');
  }

  /**
   * Eine Flotte im Orbit oder im Anflug. Bei eigenen stehen Kampfkraft und
   * Huelle dabei; bei fremden ist nur zu sehen, welche Schiffe es sind.
   */
  fleetRow(f, p) {
    const v = this.view;
    const pl = v.players.find(q => q.id === f.owner);
    const color = pl?.color || '#9fb0c8';
    const ziel = f.dest != null && f.dest !== p.id ? v.planets[f.dest] : null;
    const kommt = f.dest === p.id && f.at !== p.id;
    const runden = kommt ? this.eta(f, p) : null;
    let rechts, unten = '';
    if (f.mine) {
      const hp = f.ships.reduce((a, s) => a + s.hp, 0), max = f.ships.reduce((a, s) => a + s.maxHp, 0);
      rechts = `${fmt1(f.stats.attack || 0)} ⚔ · ${fmt(hp)}/${fmt(max)} HP`;
      unten = `<div class="meter"><i style="width:${max ? hp / max * 100 : 0}%;background:${hp / max > 0.5 ? 'var(--good)' : hp / max > 0.25 ? 'var(--gold)' : 'var(--bad)'}"></i></div>`;
    } else {
      rechts = `<span class="muted">${t('fleet.strengthUnknown')}</span>`;
    }
    const wohin = kommt && Number.isFinite(runden) ? t('fleet.arrivesIn', { turns: t('word.turns', { n: runden, count: runden }) })
      : ziel ? `→ ${escapeHtml(ziel.name)}` : '';
    return `<div class="fleetrow ${f.mine ? '' : 'foe'}" data-fleet="${f.id}">
      <div class="fr-top">
        <span class="dot" style="background:${color}"></span>
        <span class="fr-name">${f.mine ? t('fleet.own') : escapeHtml(pl?.name || '?')}</span>
        <span class="hp">${rechts}</span>
      </div>
      ${unten}
      <div class="fr-sub"><span class="fr-comp">${this.komposition(f, color)}</span><span>${wohin}</span></div>
    </div>`;
  }

  /**
   * Verteidigung einer eigenen Welt: die planetare Abwehr, die mit der
   * Bevoelkerung waechst, die Satelliten samt Schild, die Kampfkraft im
   * Orbit - und eine Warnung, wenn Feinde da sind oder kommen.
   */
  defenseSection(p, orbit) {
    const v = this.view, me = v.me;
    const bat = batteryStats(p.pop, me.tech);
    const ds = p.defenseStats;
    const n = p.defenses || 0;
    const eigene = orbit.filter(f => f.mine).reduce((a, f) => a + (f.stats.attack || 0), 0);
    const gesamt = (bat?.attack || 0) + (ds?.attack || 0) + eigene;
    const feindOrbit = orbit.filter(f => !f.mine);
    const feindAnflug = v.fleets.filter(f => !f.mine && f.dest === p.id && f.at !== p.id);
    const schiffe = (f) => t('word.ships', { n: f.ships.length, count: f.ships.length });
    const warnungen = [
      ...feindOrbit.map(f => t('def.enemyOrbit', {
        player: escapeHtml(v.players.find(q => q.id === f.owner)?.name || '?'), ships: schiffe(f) })),
      ...feindAnflug.map(f => t(f.eta ? 'def.enemyIncoming' : 'def.enemyIncomingNoEta', {
        player: escapeHtml(v.players.find(q => q.id === f.owner)?.name || '?'), ships: schiffe(f),
        turns: f.eta ? t('word.turns', { n: f.eta, count: f.eta }) : '' }))
    ];
    const veraltet = ds && (ds.weapons < me.tech.weapons || ds.shields < me.tech.shields);
    return `
      <div class="sec">
        <h4>${t('def.title')}</h4>
        ${warnungen.map(w => `<p class="def-warn">⚠ ${w}</p>`).join('')}
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
        ${veraltet ? `<p class="hint-line">${t('def.satTech', { w: ds.weapons, s: ds.shields, W: me.tech.weapons, S: me.tech.shields })}</p>` : ''}
        <div class="def-total"><span>${t('def.total')}</span><b>${fmt1(gesamt)} ⚔</b></div>
        <div class="small muted">${t('def.totalHint')}</div>
      </div>`;
  }

  buildRows(rows, sum, p) {
    const me = this.view.me;
    const queue = me.builds[p.id] || {};
    // Preise nach dem Techstand, der beim Bau gilt - sonst stimmte die Summe
    // unten nicht mit den Zeilen darueber ueberein.
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
          <button class="tiny plus"${this.leistbar({ build: [p.id, type] }) ? '' : ` disabled title="${t('yard.cantAfford')}"`}>+</button>
        </span>`;
      row.querySelector('.bi').appendChild(shipIcon(type, 30, me.color));
      row.title = t(`ship.${type}.desc`) + ' ' + t('shipinfo.hint');
      for (const el of [row.querySelector('.bi'), row.querySelector('.bname')]) {
        el.parentElement.classList.add('clickable-ship');
        el.onclick = () => this.showShip(type, pl.tech, null, pl.durchbruch ? t('yard.breakthrough') : '');
      }
      row.querySelector('.plus').onclick = () => this.app.send({ t: 'orders', build: { planetId: p.id, type, count: 1 } });
      row.querySelector('.minus').onclick = () => this.app.send({ t: 'orders', build: { planetId: p.id, type, count: -1 } });
      rows.appendChild(row);
    }
    let cm = 0, ce = 0;
    for (const [typ, anzahl] of Object.entries(queue)) {
      const c = shipCost(typ, pl.tech);
      cm += c.money * anzahl; ce += c.metal * anzahl;
    }
    // Genau zwei Zeilen, immer: darunter liegen Umrüst-Knopf und Flotten, und
    // die duerfen beim Klicken auf + und - nicht wandern. Was nicht in eine
    // Zeile passt, steht vollstaendig im Tooltip. Ob das Geld reicht, prueft
    // schon der Server (gesperrtes +); der Haushalt oben zeigt die Rechnung.
    const knapp = pl.fehltGeld > 0 || pl.fehltErz > 0;      // sollte nicht vorkommen
    const andereGeld = pl.bauGeld - cm, andereErz = pl.bauErz - ce;
    const zeile1 = cm || ce
      ? t('yard.orderShort', { money: fmt(cm), metal: fmt(ce) })
      : t('yard.noOrder');
    const zeile2 = [
      pl.durchbruch && (cm || ce) ? t('yard.breakthrough') : null,
      andereGeld > 0 || andereErz > 0 ? t('yard.otherYards', { money: fmt(andereGeld), metal: fmt(andereErz) }) : null
    ].filter(Boolean).join(' ');
    sum.className = 'small buildsum';
    sum.innerHTML = `<div class="${cm || ce ? '' : 'muted'}" style="${knapp ? 'color:var(--bad)' : ''}"></div><div class="muted"></div>`;
    const [z1, z2] = sum.children;
    z1.textContent = zeile1; z1.title = zeile1;
    z2.textContent = zeile2 || '\u00a0'; z2.title = zeile2;
  }

/**
   * Kann diese Flotte dort hin? Gerechnet wie auf dem Server (gemeinsame
   * Funktionen aus shared/rules.js), damit die Oberflaeche nicht etwas
   * anbietet, was der Server gleich wieder ablehnt.
   * @returns {string|null} Grund, oder null wenn es geht
   */
  warumNicht(f, ziel) {
    const v = this.view;
    if (!f.stats || f.stats.speed <= 0) return t('err.fleetImmobile');
    const basen = v.planets.filter(q => q.owner === v.you && q.pop > 0.5);
    if (!basen.length) return t('err.outOfRange', { need: '∞', range: f.stats.range });
    const need = supplyDistance(basen, ziel, holeZone(v.galaxy));
    if (need > f.stats.range) {
      return t('err.outOfRange', { need: Math.round(need), range: f.stats.range });
    }
    return null;
  }

  /**
   * "Flotte hierher" fuer die zuletzt gewaehlte eigene Flotte. Gilt fuer jede
   * Welt - auch fuer die eigenen: Flotten nach Hause zu holen ist Verteidigung,
   * und bewohnte eigene Welten sind die Sprungbretter fuer die Reichweite.
   * Ausgeblendet wird er nur, wenn die Flotte schon dort liegt; geht es nicht,
   * steht der Grund darunter statt einer Ablehnung nach dem Klick.
   */
  courseButton(p) {
    const f = this.view.fleets.find(x => x.id === this.lastFleetId);
    if (!this.lastFleetId || !f || !f.mine || f.at === p.id) return '';
    const grund = this.warumNicht(f, p);
    const knopf = `<button id="setcourse" class="primary"${grund ? ' disabled' : ''}>`
      + `${t('planet.courseButton', { n: f.ships.length })}</button>`;
    return `<div class="sel-actions">${knopf}</div>`
      + (grund ? `<p class="hint-line" style="color:var(--bad)">${t('fleet.cannotReach', { reason: grund })}</p>` : '');
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
      // Geortet heisst: Kurs und Ankunft sind bekannt, die Schiffe selbst nicht.
      const ziel = f.dest != null ? v.planets[f.dest] : null;
      const wohin = ziel
        ? `<div class="sel-sub">${t('fleet.courseTo', { planet: ziel.name }).replace('<b>', '<b style="color:var(--gold)">')}`
          + (f.eta ? ' ' + t('fleet.etaSuffix', { turns: t('word.turns', { n: f.eta, count: f.eta }) }) : '')
          + '</div>'
        : `<div class="sel-sub">${t('fleet.noCourse')}</div>`;
      box.innerHTML = `<div class="sel-head"><div><div class="sel-title">${t('fleet.foreign')}</div>
        <div class="sel-sub" style="color:${pl?.color}">${pl?.name || '?'}</div>${wohin}</div></div>
        <p class="hint-line">${t('fleet.detected', { ships: t('word.ships', { n: f.ships.length, count: f.ships.length }) })}</p>`;
      return;
    }
    const groups = {};
    for (const s of f.ships) (groups[s.type] || (groups[s.type] = [])).push(s);
    const where = f.at != null ? v.planets[f.at] : null;
    const destP = f.dest != null ? v.planets[f.dest] : null;
    const st = f.stats;
    // Der Weg um das schwarze Loch zaehlt, nicht die Luftlinie.
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
      <div class="statgrid">
        <div class="stat"><div class="k">${t('fleet.speed')}</div><div class="v">${Math.round(st.speed)} ${t('unit.lyPerTurn')}</div></div>
        <div class="stat"><div class="k">${t('fleet.range')}</div><div class="v">${fmt(st.range)} ${t('unit.ly')}</div></div>
        <div class="stat"><div class="k">${t('fleet.attack')}</div><div class="v">${st.attack}</div></div>
        <div class="stat"><div class="k">${t('fleet.hull')}</div><div class="v">${Math.round(st.hp)}</div></div>
      </div>
      <div class="sec">
        <h4>${t('fleet.ships')}</h4>
        <div class="shiplist">
          ${Object.entries(groups).map(([typ, arr]) => `
            <div class="shipitem clickable-ship" data-info="${typ}" title="${t('shipinfo.hint')}">
              <span class="gi" data-t="${typ}"></span>
              <span>${arr.length}× ${t(`ship.${typ}.name`)}
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
        <div id="splitbox"></div>
        ${where ? this.refitBlock('f:' + f.id, t('refit.fleet')) : ''}
      </div>`}`;

    const col = (f.mine && v.me) ? v.me.color
      : ((v.players.find(q => q.id === f.owner) || {}).color || '#9fb0c8');
    for (const g of box.querySelectorAll('.gi')) g.appendChild(shipIcon(g.dataset.t, 26, col));
    // Die eingebaute Technik dieser Schiffe, nicht der aktuelle Stand
    for (const el of box.querySelectorAll('[data-info]')) {
      el.onclick = () => this.showShip(el.dataset.info, groups[el.dataset.info][0].tech, col);
    }
    const c = box.querySelector('#cancel');
    if (c) c.onclick = () => this.app.send({ t: 'orders', move: { fleetId: f.id, planetId: null } });
    const m = box.querySelector('#merge');
    if (m) m.onclick = () => this.app.send({ t: 'orders', merge: { planetId: f.at } });
    const sp = box.querySelector('#split');
    if (sp) sp.onclick = () => this.splitUi(box.querySelector('#splitbox'), f);
    this.wireRefit(box);
  }

  splitUi(host, f) {
    const pick = new Set();
    const groups = {};
    for (const s of f.ships) (groups[s.type] || (groups[s.type] = [])).push(s);
    host.innerHTML = `
      <div style="margin-top:8px">
        ${Object.entries(groups).map(([typ, arr]) => `
          <div class="buildrow" data-t="${typ}">
            <span class="bname">${t(`ship.${typ}.name`)}</span>
            <span class="bq"><button class="tiny minus">−</button><span class="n">0</span>
            <button class="tiny plus">+</button><span class="muted small">/${arr.length}</span></span>
          </div>`).join('')}
        <div class="sel-actions"><button class="tiny primary" id="do-split">${t('fleet.splitDo')}</button>
          <button class="tiny" id="cancel-split">${t('fleet.splitCancel')}</button></div>
      </div>`;
    const counts = {};
    for (const row of host.querySelectorAll('[data-t]')) {
      const typ = row.dataset.t;
      counts[typ] = 0;
      const feld = row.querySelector('.n');
      row.querySelector('.plus').onclick = () => {
        counts[typ] = Math.min(groups[typ].length - (groups[typ].length === f.ships.length ? 1 : 0), counts[typ] + 1);
        feld.textContent = counts[typ];
      };
      row.querySelector('.minus').onclick = () => { counts[typ] = Math.max(0, counts[typ] - 1); feld.textContent = counts[typ]; };
    }
    host.querySelector('#cancel-split').onclick = () => { host.innerHTML = ''; };
    host.querySelector('#do-split').onclick = () => {
      const ids = [];
      for (const [typ, k] of Object.entries(counts)) ids.push(...groups[typ].slice(0, k).map(s => s.id));
      if (ids.length && ids.length < f.ships.length) {
        this.app.send({ t: 'orders', split: { fleetId: f.id, ships: ids } });
      }
      host.innerHTML = '';
    };
  }

  // ------------------------------------------------------------------ Log
  /**
   * Ein Protokolleintrag in der gewaehlten Sprache. Der Server schickt nur
   * Schluessel und Werte - was davon ein Schiffstyp, eine Himmelsrichtung oder
   * eine Zahl mit Nachkommastelle ist, wird erst hier zu Text.
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
        const film = e.type === 'combat' && this.app.battles?.has(key)
          ? `<button class="tiny bt-watch" data-b="${key}" title="${escapeHtml(t('battle.watch'))}">▶</button>` : '';
        return `<div class="logline ${e.type} ${e.planetId != null ? 'clickable' : ''}"
        ${e.planetId != null ? `data-p="${e.planetId}"` : ''}>${film}${escapeHtml(this.logText(e))}</div>`;
      }).join('')}
    `).join('');
    for (const b of box.querySelectorAll('[data-b]')) {
      b.onclick = (ev) => { ev.stopPropagation(); this.app.openBattle(b.dataset.b); };
    }
    for (const line of box.querySelectorAll('[data-p]')) {
      line.onclick = () => {
        const p = this.view.planets[+line.dataset.p];
        if (!p) return;
        this.app.map.focus(p, this.app.freiesFeld());
        this.app.setSelection({ type: 'planet', id: p.id });
      };
    }
    if (atBottom) box.scrollTop = 0;
  }

  chat(from, text) {
    const box = $('#chat-list');
    const div = document.createElement('div');
    div.className = 'logline';
    div.innerHTML = `<b>${escapeHtml(from)}:</b> ${escapeHtml(text)}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  /** @param {Function} [onClick] macht den Toast anklickbar (Schlacht ansehen) */
  toast(text, color, onClick) {
    const host = $('#toasts');
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    if (color) d.style.borderLeftColor = color;
    if (onClick) {
      d.classList.add('clickable');
      const hint = document.createElement('span');
      hint.className = 'toast-action';
      hint.textContent = t('battle.watch');
      d.appendChild(hint);
      d.onclick = () => { d.remove(); onClick(); };
    }
    host.appendChild(d);
    setTimeout(() => d.remove(), onClick ? 7000 : 4200);
  }
}

/** "3 Welten · 16,9 Mio · 5 Schiffe" - jedes Stueck in seiner Mehrzahlform. */
/**
 * Reihenfolge der Rangliste - wie das Spiel am Rundenlimit wertet: wer die
 * meisten Einwohner hat, gewinnt (server/game.js). Bei Gleichstand zaehlen
 * Welten, dann Schiffe; ausgeschiedene Reiche stehen unten.
 */
function rangfolge(players) {
  return players.slice().sort((a, b) => (b.alive - a.alive)
    || b.stats.pop - a.stats.pop || b.stats.planets - a.stats.planets || b.stats.ships - a.stats.ships);
}

function statsText(welten, pop, schiffe) {
  return t('top.myStats', {
    worlds: t('word.worlds', { n: welten, count: welten }),
    pop: t('word.pop', { n: fmt1(pop) }),
    ships: t('word.ships', { n: schiffe, count: schiffe })
  });
}

/** Erster Aufruf sofort, danach höchstens einer pro Fenster - der letzte Wert
 *  geht am Ende immer raus. */
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
