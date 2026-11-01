// The other empires: the ranking for players, and the full table with tech
// and treasuries for spectators.
import { TECH_FIELDS } from '../../../shared/rules.js';
import { t } from '../../i18n.js';
import { avatarHtml } from '../../ui/avatar.js';
import { fmt1, statsText, fmt } from './format.js';

const $ = s => document.querySelector(s);

export const playersMethods = {
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
  },

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
  return players.slice().sort((a, b) => (b.alive - a.alive)
    || b.stats.pop - a.stats.pop || b.stats.planets - a.stats.planets || b.stats.ships - a.stats.ships);
}
