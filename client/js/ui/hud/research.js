// The research tab: the share of the treasury and the weights per field.
import { researchWeight } from '../../../shared/budget.js';
import { TECH_FIELDS, techMaxLevel, recycleRates } from '../../../shared/rules.js';
import { t } from '../../i18n.js';
import { fmt } from './format.js';

const $ = s => document.querySelector(s);

export const researchMethods = {
  research() {
    const v = this.view, me = v.me;
    const total = TECH_FIELDS.reduce((a, f) => a + researchWeight(me, f), 0) || 1;
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
        const maxed = lvl >= techMaxLevel(f);
        const share = researchWeight(me, f) / total;
        return `<div class="tech-row" data-f="${f}">
          <div class="tech-head"><span class="nm">${t(`tech.${f}.name`)}</span>
            <span class="lvl">${t(maxed ? 'tech.levelMax' : 'tech.level', { n: lvl })}</span></div>
          <div class="tech-bar"><i style="width:${maxed ? 100 : Math.min(100, pr.points / pr.next * 100).toFixed(1)}%"></i></div>
          <div class="wrow">
            <input type="range" class="wt" min="0" max="10" step="1" value="${me.research.weights[f]}"${maxed ? ' disabled' : ''}>
            <span class="pct">${Math.round(share * 100)}%</span>
          </div>
          ${f === 'recycling' ? `<div class="small muted">${this.recycleLine(lvl)}</div>` : ''}
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
  },

  /** What recycling yields at this level - and what the next one brings. */
  recycleLine(level) {
    const pct = x => Math.round(x * 100);
    const now = recycleRates(level);
    const next = level < techMaxLevel('recycling') ? recycleRates(level + 1) : null;
    const line = now ? t('recycle.rates', { metal: pct(now.metal), cost: pct(now.cost) }) : t('recycle.locked');
    return next ? `${line} ${t('recycle.next', { metal: pct(next.metal), cost: pct(next.cost) })}` : line;
  }
};
