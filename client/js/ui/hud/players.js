// The other empires: the ranking with diplomacy for players - offering,
// accepting and ending alliances - and the full table with tech and
// treasuries for spectators.
import { TECH_FIELDS } from '../../../shared/rules.js';
import { allianceOf, alliesOf } from '../../allies.js';
import { t } from '../../i18n.js';
import { avatarHtml } from '../../ui/avatar.js';
import { fmt1, statsText, fmt, escapeHtml } from './format.js';

const $ = s => document.querySelector(s);

export const playersMethods = {
  players() {
    const v = this.view;
    const box = $('#tab-players');
    let place = 0;
    // Fog of war: the tallies of other empires are hidden (stats null) - then
    // there is no ranking either, only the own numbers and the allies'.
    const fog = v.players.some(p => !p.stats);
    box.innerHTML = `<p class="hint-line rank-hint">${v.maxTurns ? t('rank.hint', { n: v.maxTurns }) : t('rank.hintEndless')}${fog ? ' ' + t('rank.hintFog') : ''}</p>` + ranking(v.players).map(p => {
      if (p.alive) place++;
      return `
      <div class="listrow rankrow ${p.ready ? 'rdy' : ''} ${p.id === v.you ? 'me' : ''} ${p.alive ? '' : 'dead'}">
        <span class="rank">${!p.alive ? '–' : fog ? '' : place}</span>
        ${avatarHtml(p, 22)}
        <span class="who">
          <span class="nm" title="${p.name}${p.persona ? ' – ' + t(`persona.${p.persona}`) + ': ' + t(`persona.${p.persona}.desc`) : ''}">${p.name}</span>
          <small>${[p.id === v.host ? t('rank.host') : null,
                    p.isBot ? t('word.ai') + (p.persona ? ' · ' + t(`persona.${p.persona}`) : '')
                      + (p.level ? ' · ' + t(`ai.${p.level}`) : '') : null,
                    p.connected || p.isBot ? null : t('word.offline'),
                    p.alive && p.stats ? `${t('word.worlds', { n: p.stats.planets, count: p.stats.planets })} · ${t('word.ships', { n: p.stats.ships, count: p.stats.ships })}` : null,
                    p.alive && !p.stats ? t('rank.fogged') : null
                   ].filter(Boolean).join(' · ')}</small>
        </span>
        <span class="num"><b>${!p.alive ? t('rank.out') : p.stats ? t('word.pop', { n: fmt1(p.stats.pop) }) : '?'}</b></span>
      </div>${this.diplomacyRow(p)}`;
    }).join('');
    this.wireDiplomacy(box);
  },

  /**
   * Under every other empire: what binds us, what was offered - and the
   * buttons that go with it. Plus the alliances among the others, as far as
   * we know them.
   */
  diplomacyRow(p) {
    const v = this.view;
    // Our own alliances show under each partner - not again under us.
    if (!p.alive || v.spectator || p.id === v.you || v.alliances === false) return '';
    const name = id => escapeHtml(v.players.find(q => q.id === id)?.name || '?');
    const others = alliesOf(v, p.id).filter(x => x.id !== v.you)
      .map(x => (x.alliance.secret ? '🔒 ' : '') + name(x.id));
    const known = others.length ? `<div class="dip-known">${t('dip.alliedWith', { names: others.join(', ') })}</div>` : '';
    if (!v.me?.id) return known ? `<div class="dip">${known}</div>` : '';
    const d = v.diplomacy || { offers: [], refusedBy: [] };
    const btn = (action, label, extra = '') =>
      `<button class="tiny" data-dip="${action}" data-with="${p.id}"${extra}>${label}</button>`;
    const x = allianceOf(v, v.you, p.id);
    const incoming = d.offers.find(o => o.from === p.id && o.to === v.you);
    const outgoing = d.offers.find(o => o.from === v.you && o.to === p.id);
    let line;
    if (x && x.endsAt != null) {
      line = `<span class="dip-state ending">${t('dip.ending', { n: Math.max(0, x.endsAt - v.turn), count: Math.max(0, x.endsAt - v.turn) })}</span>`;
    } else if (x) {
      line = `<span class="dip-state allied" title="${escapeHtml(t(x.secret ? 'dip.secretTip' : 'dip.publicTip'))}">${t(x.secret ? 'dip.alliedSecret' : 'dip.allied')}</span>
        ${x.secret ? btn('announce', t('dip.announce'), ` title="${escapeHtml(t('dip.announceTip'))}"`) : ''}
        ${btn('end', t('dip.end'), ` data-confirm="${escapeHtml(t('dip.endConfirm'))}" title="${escapeHtml(t('dip.endTip'))}"`)}`;
    } else if (incoming) {
      line = `<span class="dip-state offer">${t(incoming.secret ? 'dip.offeredSecret' : 'dip.offered')}</span>
        ${btn('accept', t('dip.accept'))}${btn('decline', t('dip.decline'))}`;
    } else if (outgoing) {
      line = `<span class="dip-state">${t(outgoing.secret ? 'dip.sentSecret' : 'dip.sent')}</span>${btn('withdraw', t('dip.withdraw'))}`;
    } else {
      const refused = d.refusedBy?.find(r => r.id === p.id);
      const off = refused ? ` disabled title="${escapeHtml(t('dip.refused', { turn: refused.until }))}"` : '';
      line = btn('offer', t('dip.offer'), off || ` title="${escapeHtml(t('dip.offerTip'))}"`)
        + btn('offer', t('dip.offerSecret'), off || ` data-secret="1" title="${escapeHtml(t('dip.offerSecretTip'))}"`);
    }
    return `<div class="dip">${known}<div class="dip-line">${line}</div></div>`;
  },

  wireDiplomacy(box) {
    for (const b of box.querySelectorAll('[data-dip]')) {
      b.onclick = () => {
        // Ending an alliance takes a second click - a slip should not start a war.
        if (b.dataset.confirm && !b.classList.contains('armed')) {
          b.classList.add('armed');
          b.textContent = b.dataset.confirm;
          return;
        }
        this.app.send({ t: 'diplomacy', action: b.dataset.dip, with: b.dataset.with, secret: !!b.dataset.secret });
      };
    }
  },

  /** A new offer of an alliance pops up as a message - a tap opens the list. */
  noticeOffers() {
    const v = this.view;
    const now = new Set((v.diplomacy?.offers || []).filter(o => o.to === v.you).map(o => o.from));
    const before = this.offersSeen || new Set();
    this.offersSeen = now;
    for (const id of now) {
      if (before.has(id)) continue;
      const p = v.players.find(q => q.id === id);
      const o = v.diplomacy.offers.find(x => x.from === id && x.to === v.you);
      this.toast(t(o.secret ? 'dip.toastSecret' : 'dip.toast', { player: p?.name || '?' }), p?.color || null,
        () => document.querySelector('#leftdock .tabs button[data-tab="players"]')?.click(), '▶ ' + t('dip.toastOpen'));
    }
  },

  /** Table of all empires - the most interesting part of the picture when spectating. */
  league() {
    const v = this.view;
    const rows = ranking(v.players);
    const maxPop = Math.max(1, ...rows.map(p => p.stats.pop));
    const name = id => v.players.find(q => q.id === id)?.name || '?';
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
        ${alliesOf(v, p.id).length ? `<div class="dip-known">${t('dip.alliedWith', {
          names: escapeHtml(alliesOf(v, p.id).map(x => (x.alliance.secret ? '🔒 ' : '') + name(x.id)).join(', ')) })}</div>` : ''}
      </div>`).join('')}</div>`;
  }
};

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
  // In the fog: the known tallies first, the hidden ones after, by name.
  const known = p => p.stats ? 1 : 0;
  return players.slice().sort((a, b) => (b.alive - a.alive) || known(b) - known(a)
    || (!a.stats ? a.name.localeCompare(b.name)
      : b.stats.pop - a.stats.pop || b.stats.planets - a.stats.planets || b.stats.ships - a.stats.ships));
}
