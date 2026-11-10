// The research tab: the presets, the share of the treasury and the weights per field.
import { researchWeight } from '../../../shared/budget.js';
import { PRESET_MAX, presetMatches } from '../../../shared/presets.js';
import { TECH_FIELDS, techMaxLevel, recycleRates } from '../../../shared/rules.js';
import { t } from '../../i18n.js';
import { getPresets, setPresets } from '../../presets.js';
import { fmt, escapeHtml } from './format.js';

const $ = s => document.querySelector(s);

export const researchMethods = {
  research() {
    const v = this.view, me = v.me;
    const total = TECH_FIELDS.reduce((a, f) => a + researchWeight(me, f), 0) || 1;
    // The same number as in the ledger (rounded down, no weights means no research).
    const budget = this.plan().research;
    const box = $('#tab-research');
    // While a name is being typed, a new view must not throw the field away.
    const keep = this.presetMode && box.querySelector('#presets-box');
    if (keep) keep.remove();
    box.innerHTML = `
      <div id="presets-box"></div>
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
    if (keep) box.querySelector('#presets-box').replaceWith(keep);
    else this.presetsBox();
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

  /**
   * Research presets on top of the tab. A tap on a chip applies it; "+ Save"
   * keeps the current settings under a name; "Manage" renames, overwrites
   * with the current settings, deletes - and marks the one (★) that every
   * new game starts with. Modes: null, 'new', 'manage'.
   */
  presetsBox() {
    const box = $('#presets-box');
    if (!box) return;
    const v = this.view, me = v.me;
    const list = getPresets();
    const mode = this.presetMode || null;
    const chip = p => `<button class="pr-chip${presetMatches(p, me.research) ? ' on' : ''}" data-apply="${p.id}"
      title="${escapeHtml(t('research.presetApply', { name: p.name }))}">${p.auto ? '<span class="pr-star">★</span>' : ''}${escapeHtml(p.name)}</button>`;
    let body;
    if (mode === 'manage') {
      body = `<div class="pr-manage">${list.map(p => `
        <div class="pr-row" data-id="${p.id}">
          <button class="pr-auto${p.auto ? ' on' : ''}" title="${escapeHtml(t('research.presetAuto'))}" aria-pressed="${!!p.auto}">★</button>
          <input class="pr-name" maxlength="24" value="${escapeHtml(p.name)}" aria-label="${escapeHtml(t('research.presetName'))}">
          <button class="tiny pr-over" title="${escapeHtml(t('research.presetOverwriteTip'))}">${t('research.presetOverwrite')}</button>
          <button class="tiny pr-del${this.presetDel === p.id ? ' danger' : ''}">${t(this.presetDel === p.id ? 'research.presetDeleteSure' : 'research.presetDelete')}</button>
        </div>`).join('')}
        <p class="small muted pr-note">${t('research.presetAutoHint')}</p>
        <div class="pr-actions"><button class="tiny primary pr-done">${t('research.presetDone')}</button></div>
      </div>`;
    } else if (mode === 'new') {
      body = `<div class="pr-new">
        <input class="pr-name" maxlength="24" value="${escapeHtml(t('research.presetNameDefault', { n: list.length + 1 }))}"
          aria-label="${escapeHtml(t('research.presetName'))}">
        <button class="tiny primary pr-save">${t('research.presetSave')}</button>
        <button class="tiny pr-cancel">${t('research.presetCancel')}</button>
      </div>`;
    } else {
      body = `<div class="pr-chips">${list.map(chip).join('')}
        ${list.length < PRESET_MAX ? `<button class="pr-chip pr-add" title="${escapeHtml(t('research.presetAddTip'))}">+ ${t('research.presetAdd')}</button>` : ''}</div>
        ${list.length ? '' : `<p class="small muted pr-note">${t('research.presetsHint')}</p>`}`;
    }
    box.innerHTML = `<div class="presets">
      <div class="pr-head"><span>${t('research.presets')}</span>
        ${list.length && !mode ? `<button class="tiny pr-manage-btn">${t('research.presetManage')}</button>` : ''}</div>
      ${body}</div>`;

    const redraw = () => this.presetsBox();
    // Read when used: the box may outlive the view it was drawn for (research()).
    const current = () => ({ budgetPct: this.view.me.research.budgetPct, weights: { ...this.view.me.research.weights } });
    const nameOf = id => getPresets().find(p => p.id === id)?.name || '';
    for (const b of box.querySelectorAll('[data-apply]')) {
      b.onclick = () => {
        const p = list.find(x => x.id === b.dataset.apply);
        if (p) this.app.send({ t: 'orders', research: { budgetPct: p.budgetPct, weights: { ...p.weights } } });
      };
    }
    const on = (sel, fn) => { const el = box.querySelector(sel); if (el) el.onclick = fn; };
    on('.pr-add', () => { this.presetMode = 'new'; redraw(); const i = box.querySelector('.pr-name'); i?.focus(); i?.select(); });
    on('.pr-manage-btn', () => { this.presetMode = 'manage'; this.presetDel = null; redraw(); });
    on('.pr-cancel', () => { this.presetMode = null; redraw(); });
    on('.pr-done', () => { this.presetMode = null; this.presetDel = null; redraw(); });
    const save = () => {
      const name = box.querySelector('.pr-name').value.trim();
      if (!name) return;
      // The first one becomes the start preset right away - that is what it is for.
      setPresets([...getPresets(), { name, ...current(), auto: !getPresets().length }]);
      this.presetMode = null;
      redraw();
    };
    on('.pr-save', save);
    const input = box.querySelector('.pr-new .pr-name');
    if (input) input.onkeydown = (e) => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') { e.stopPropagation(); this.presetMode = null; redraw(); }
    };
    for (const row of box.querySelectorAll('.pr-row')) {
      const id = row.dataset.id;
      const change = (fn) => setPresets(getPresets().map(p => p.id === id ? fn(p) : p));
      const name = row.querySelector('.pr-name');
      name.onchange = () => { if (name.value.trim()) change(p => ({ ...p, name: name.value })); else name.value = nameOf(id); };
      name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
      row.querySelector('.pr-auto').onclick = () => {
        setPresets(getPresets().map(p => ({ ...p, auto: p.id === id ? !p.auto : false })));
        redraw();
      };
      row.querySelector('.pr-over').onclick = () => { change(p => ({ ...p, ...current() })); this.toast(t('research.presetOverwritten', { name: nameOf(id) })); };
      row.querySelector('.pr-del').onclick = () => {
        // Deleting takes a second tap.
        if (this.presetDel !== id) { this.presetDel = id; redraw(); return; }
        this.presetDel = null;
        setPresets(getPresets().filter(p => p.id !== id));
        if (!getPresets().length) this.presetMode = null;
        redraw();
      };
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
