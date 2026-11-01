// The top bar: who you are, the treasury now and after the turn, the end of
// turn button, the host's pause - and the turn timer.
import { t } from '../../i18n.js';
import { statsText, fmt, escapeHtml } from './format.js';

const $ = s => document.querySelector(s);
// Pause and play as SVG on the same 16 px grid as the other top bar icons -
// text glyphs never sit quite in the middle.
const ICON_PAUSE = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3.5h2.4v9H4.5zM9.1 3.5h2.4v9H9.1z" fill="currentColor"/></svg>';
const ICON_PLAY = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L12.8 8z" fill="currentColor"/></svg>';

export const topbarMethods = {
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
    const over = v.state === 'over';
    const waiting = me.ready;
    btn.classList.toggle('waiting', waiting);
    const others = v.players.filter(p => p.alive && !p.isBot);
    const readyCount = others.filter(p => p.ready).length;
    // Over: the game can still be continued - the button offers that instead
    // of sitting there disabled.
    btn.textContent = waiting
      ? t('top.waiting', { ready: readyCount, total: others.length })
      : over ? t('top.continue') : t('top.endTurn');
    btn.disabled = v.state !== 'running' && !over;

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
  },

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
  },

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
};

function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
