// The shipyard of a world: ordering ships - and why the + is greyed out -
// refitting old ones and recycling them.
import { refitShips, forecast } from '../../../shared/budget.js';
import {
  buildTypesFor, buildCost, buildLock, stationReady, STATION, SHIP_DEFS, TECH_FIELDS, refitTotal, recycleRates, recycleValue
} from '../../../shared/rules.js';
import { t } from '../../i18n.js';
import { shipIcon } from '../../render/ships.js';
import { needsText } from '../../ui/shipinfo.js';
import { fmt, fmt1 } from './format.js';

export const shipyardMethods = {
  buildRows(rows, sum, p) {
    const me = this.view.me;
    const queue = me.builds[p.id] || {};
    // Prices by the tech levels that apply at build time - otherwise the sum
    // below would not match the rows above it.
    const pl = this.plan();
    rows.innerHTML = '';
    const why = new Map();
    const st = p.station || null;
    for (const type of buildTypesFor(this.view)) {
      // Only what can happen here: a station on a world large enough that has
      // none yet (ready or being built), the destroyer only at a ready station.
      // Missing research still shows - that is something to work towards.
      if (type === 'station' && (st || buildLock('station', {}, p.pop)?.pop)) continue;
      if (type === 'destroyer' && !stationReady(st)) continue;
      const cost = buildCost(type, pl.tech, p);
      const n = queue[type] || 0;
      // Big ships need research, a large world or a ready station - as the
      // server checks it: with today's levels, not those after this turn's research.
      const lock = buildLock(type, me.tech, p.pop, st);
      // One station per world: once ordered, the + is done.
      const ordered = type === 'station' && n > 0;
      const blocked = lock || ordered || !this.affordable({ build: [p.id, type] });
      if (blocked) why.set(type, ordered ? t('yard.why.stationOrdered')
        : lock ? this.lockTip(type, p, pl) : this.budgetTip(type, cost, pl));
      const price = `${fmt(cost.money)} ${t('unit.cr')} · ${fmt(cost.metal)} ${t('unit.metal')}`;
      const text = lock ? t('yard.needs', { list: needsText(lock) })
        : type === 'fighter' && stationReady(st) ? `${price} · ${t('yard.stationDiscount', { pct: Math.round(STATION.fighterDiscount * 100) })}`
        : price;
      const row = document.createElement('div');
      row.className = 'buildrow' + (lock ? ' locked' : '');
      row.innerHTML = `
        <span class="bi"></span>
        <span>
          <div class="bname">${t(`ship.${type}.name`)}</div>
          <div class="bcost">${text}</div>
        </span>
        <span class="bq">
          <button class="tiny minus">−</button>
          <span class="n">${n}</span>
          <span class="plus-wrap"${blocked ? ` data-tip="${type}"` : ''}><button class="tiny plus"${blocked ? ' disabled' : ''}>+</button></span>
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
    this.wireTips(rows, el => why.get(el.dataset.tip) || '');
    let cm = 0, ce = 0;
    for (const [type, count] of Object.entries(queue)) {
      const c = buildCost(type, pl.tech, p);
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
  },

  /**
   * Why a type cannot be built here yet, for the tooltip on the greyed +:
   * every requirement with what there is, the missing ones in red.
   */
  lockTip(type, p, pl) {
    const me = this.view.me, need = SHIP_DEFS[type].requires;
    const mark = ok => ok ? 'good' : 'bad';
    const lines = TECH_FIELDS.filter(f => need[f]).map(f => {
      const have = me.tech[f] || 1;
      return `<span class="k">${t(`tech.${f}.name`)}</span><span class="v ${mark(have >= need[f])}">${have} / ${need[f]}</span>`;
    });
    if (need.pop) {
      const ok = !buildLock(type, {}, p.pop)?.pop;
      lines.push(`<span class="k">${t('yard.why.pop')}</span><span class="v ${mark(ok)}">${t('yard.why.popValue', { have: fmt1(p.pop), need: need.pop })}</span>`);
    }
    if (need.station) {
      const st = p.station;
      lines.push(`<span class="k">${t('yard.why.station')}</span><span class="v ${mark(stationReady(st))}">${t(stationReady(st)
        ? 'yard.why.stationOk' : st ? 'yard.why.stationBuilding' : 'yard.why.stationNone', { n: st?.building || 0, count: st?.building || 0 })}</span>`);
    }
    // Research done this turn only counts from the next one on - as on the server.
    const soon = !buildLock(type, pl.tech) && buildLock(type, me.tech);
    return `<div class="tip-title">${t('yard.why.locked', { ship: t(`ship.${type}.name`) })}</div>
      <div class="tip-grid">${lines.join('')}</div>
      ${soon ? `<div class="tip-warn">${t('yard.why.techNow')}</div>` : ''}`;
  },

  /**
   * Why one more of this type no longer fits the budget: the price against
   * what is left after research and the other orders - the same forecast
   * the server checks the order with.
   */
  budgetTip(type, cost, pl) {
    const lg = pl.ledger;
    const used = { money: lg.build.money + lg.refit.money, metal: lg.build.metal + lg.refit.metal };
    const free = { money: Math.max(0, lg.now.money - lg.research - used.money), metal: Math.max(0, lg.now.metal - used.metal) };
    const res = (m, e) => `${fmt(m)} ${t('unit.cr')} · ${fmt(e)} ${t('unit.metal')}`;
    const missing = [
      cost.money > free.money ? `${fmt(cost.money - free.money)} ${t('unit.cr')}` : null,
      cost.metal > free.metal ? `${fmt(cost.metal - free.metal)} ${t('unit.metal')}` : null
    ].filter(Boolean);
    const row = (k, v, cls = '') => `<span class="k">${k}</span><span class="v ${cls}">${v}</span>`;
    return `<div class="tip-title">${t('yard.why.broke', { ship: t(`ship.${type}.name`) })}</div>
      <div class="tip-grid">
        ${row(t('yard.why.price'), res(cost.money, cost.metal))}
        ${row(t('yard.why.cash'), res(lg.now.money, lg.now.metal))}
        ${lg.research ? row(t('yard.why.research'), `${fmt(lg.research)} ${t('unit.cr')}`) : ''}
        ${used.money || used.metal ? row(t('yard.why.orders'), res(used.money, used.metal)) : ''}
        ${row(t('yard.why.free'), res(free.money, free.metal), missing.length ? 'bad' : '')}
      </div>
      <div class="tip-warn">${missing.length ? t('yard.why.missing', { list: missing.join(' · ') })
        : lg.tight ? t('yard.cantAfford') : t('yard.why.others')}</div>
      ${pl.breakthrough ? `<div class="tip-warn">${t('yard.why.breakthrough')}</div>` : ''}`;
  },

  /**
   * What a refit costs ('f:<fleet>' or 'p:<world>'), with the tech levels
   * after research. Null if there is no shipyard there or nothing is
   * outdated.
   */
  refitFor(key, tech) {
    const r = refitTotal(refitShips(this.view, key), tech);
    return r.count ? r : null;
  },

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
  },

  wireRefit(box) {
    for (const b of box.querySelectorAll('[data-refit]')) {
      const key = b.dataset.refit;
      const target = key.startsWith('f:') ? { fleetId: key.slice(2) } : { planetId: Number(key.slice(2)) };
      b.onclick = () => this.app.send({ t: 'orders', refit: { ...target, value: !b.dataset.off } });
    }
  },

  /**
   * The ships a recycling at 'f:<fleet>' or 'p:<world>' would take apart -
   * satellites the oldest first, like the server. Empty without a shipyard.
   */
  recycleShips(key, count) {
    const ships = refitShips(this.view, key);
    if (key.startsWith('f:')) return ships;
    const techSum = s => Object.values(s.tech || {}).reduce((a, x) => a + x, 0);
    return [...ships].sort((a, b) => techSum(a) - techSum(b)).slice(0, count);
  },

  /**
   * Recycling: button, price and yield. Happens right away and cannot be
   * undone - so the first click only arms it, the second one recycles.
   * Satellites get a counter; a fleet goes as a whole (split it first).
   */
  recycleBlock(key) {
    const v = this.view, me = v.me;
    if (!recycleRates(me.tech.recycling)) return '';
    const sats = key.startsWith('p:');
    const all = refitShips(v, key).length;
    if (!all) return '';
    if (sats) {
      if (this.recycleKey !== key) { this.recycleKey = key; this.recyclePick = all; }
      this.recyclePick = Math.max(1, Math.min(all, this.recyclePick));
    }
    const ships = this.recycleShips(key, sats ? this.recyclePick : all);
    const r = recycleValue(ships, me.tech.recycling);
    const ok = this.recycleAffordable(r);
    const armed = this.recycleArmed === key;
    const text = t('recycle.value', { n: r.count, count: r.count, money: fmt(r.money), metal: fmt(r.metal) });
    return `<div class="${sats ? 'buildrow' : 'sel-actions'}" style="margin-top:6px">
        ${sats ? `<span class="bq" style="margin-left:0">
          <button class="tiny" id="rq-minus"${all > 1 ? '' : ' disabled'}>−</button>
          <span class="n" id="rq">${this.recyclePick}</span>
          <button class="tiny" id="rq-plus"${all > 1 ? '' : ' disabled'}>+</button>
        </span>` : ''}
        <button class="tiny${armed ? ' danger' : ''}" data-recycle="${key}" data-sfx="${armed ? 'none' : 'click'}"${ok ? '' : ` disabled title="${t('recycle.cantAfford')}"`}>${t(armed ? 'recycle.confirm' : (sats ? 'recycle.satellites' : 'recycle.fleet'))}</button>
      </div>
      <p class="small oneline" style="margin-top:4px;color:${armed ? 'var(--gold)' : 'var(--ink-faint)'}" title="${text}">${text}</p>`;
  },

  /** Would the orders placed so far still work out after this recycling? Same check as the server. */
  recycleAffordable(r) {
    const me = this.view.me;
    if (me.money < r.money) return false;
    const f = forecast({ ...this.view, me: { ...me, money: me.money - r.money, metal: me.metal + r.metal } });
    return f.build.planned.n === f.build.booked.n && f.refit.planned.n === f.refit.booked.n;
  },

  wireRecycle(box) {
    const n = box.querySelector('#rq');
    if (n) {
      const step = (d) => {
        const all = refitShips(this.view, this.recycleKey).length;
        this.recyclePick = Math.max(1, Math.min(all, this.recyclePick + d));
        this.recycleArmed = null;
        this.selection();
      };
      box.querySelector('#rq-minus').onclick = () => step(-1);
      box.querySelector('#rq-plus').onclick = () => step(1);
    }
    for (const b of box.querySelectorAll('[data-recycle]')) {
      const key = b.dataset.recycle;
      b.onclick = () => {
        clearTimeout(this.recycleTimer);
        if (this.recycleArmed !== key) {
          // Disarms itself if the second click does not come
          this.recycleArmed = key;
          this.recycleTimer = setTimeout(() => { this.recycleArmed = null; this.selection(); }, 4000);
          this.selection();
          return;
        }
        this.recycleArmed = null;
        const target = key.startsWith('f:')
          ? { fleetId: key.slice(2) }
          : { planetId: Number(key.slice(2)), count: this.recyclePick };
        this.app.send({ t: 'orders', recycle: target });
      };
    }
  }
};
