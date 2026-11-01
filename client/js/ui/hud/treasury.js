// The treasury of the turn: what happens to money and metal at the end of
// it, whether one more order still fits, and the ledger that shows how.
import { forecast } from '../../../shared/budget.js';
import { t } from '../../i18n.js';
import { fmt } from './format.js';

const $ = s => document.querySelector(s);

export const treasuryMethods = {
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
  },

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
  },

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
};
