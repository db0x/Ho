// The panel of a selected wormhole mouth.
import { t } from '../../i18n.js';
import { nearestPlanet } from '../../render/courses.js';
import { shipIcon } from '../../render/ships.js';
import { escapeHtml } from './format.js';

export const wormholeMethods = {
  /**
   * A wormhole mouth: where it lies, whether it holds, where it leads - and
   * the course button for the fleet last selected.
   */
  holePanel(box, m) {
    if (!m) { box.innerHTML = ''; return; }
    const v = this.view;
    const near = nearestPlanet(v, m);
    const exit = m.link && v.wormholes.find(x => x.id === m.link);
    const far = exit && nearestPlanet(v, exit);
    const bound = v.fleets.filter(f => f.hole === m.id);
    box.innerHTML = `
      <div class="sel-head"><div>
        <div class="sel-title">${t('hole.name')}</div>
        <div class="sel-sub">${near ? t('hole.near', { planet: escapeHtml(near.name) }) : ''}</div>
        <div class="sel-sub" style="color:${m.unstable ? 'var(--bad)' : '#cdb4ff'}">${t(m.unstable ? 'hole.unstable' : 'hole.stable')}</div>
      </div></div>
      <p class="hint-line">${far ? t('hole.knownHint', { planet: escapeHtml(far.name) }) : t('hole.unknownHint')}</p>
      <p class="hint-line">${t('hole.supplyHint')}</p>
      ${exit ? `<div class="sel-actions"><button class="tiny" data-goto>${t('hole.gotoExit')}</button></div>` : ''}
      ${bound.length ? `<div class="sec"><h4>${t('hole.bound')}</h4>${bound.map(f => this.fleetRow(f, m)).join('')}</div>` : ''}
      ${v.spectator ? '' : this.courseButton(m)}`;
    // One copy per row - shipIcon keeps every image only once (see planetPanel).
    for (const g of box.querySelectorAll('.ci')) {
      const ic = shipIcon(g.dataset.t, 18, g.dataset.c);
      const copy = document.createElement('canvas');
      copy.width = ic.width; copy.height = ic.height;
      copy.getContext('2d').drawImage(ic, 0, 0);
      g.appendChild(copy);
    }
    for (const item of box.querySelectorAll('[data-fleet]')) {
      item.onclick = () => this.app.setSelection({ type: 'fleet', id: item.dataset.fleet });
    }
    const b = box.querySelector('#setcourse');
    if (b) b.onclick = () => this.app.orderHole(m.id);
    if (exit) {
      const go = box.querySelector('[data-goto]');
      if (go) go.onclick = () => { this.app.map.focus(exit, this.app.freeArea()); this.app.setSelection({ type: 'hole', id: exit.id }); };
    }
  }
};
