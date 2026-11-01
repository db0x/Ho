// AI empires with character. They play by the same rules as humans and only
// use worlds they have explored themselves. What sets them apart is their
// personality (personas.js): it decides where the money goes, whom the
// empire attacks and how it answers when it gets hit itself. On top of that
// comes a pinch of variance per empire, so two conquerors do not play like
// twins.
//
// A move: first the situation (situation.js), then research, diplomacy,
// terraforming, building, the fleets, war and wormholes - each in its own
// module, all working on the same situation `s`.
import { diplomacy } from './diplomacy.js';
import { planResearch, terraform } from './economy.js';
import { organizeFleets, orderFleets, logistics } from './fleets.js';
import { scrap, build, refit } from './shipyard.js';
import { survey, assessEnemies } from './situation.js';
import { planCampaign, takePositions, recall, detach } from './war.js';
import { wormholeTrips, comeBack } from './wormholes.js';

export function runBot(game, bot) {
  const s = survey(game, bot);
  planResearch(s);
  // Short of ore: old junk goes into the scrap press before anything is built.
  if (s.oreScarce) scrap(s);
  s.treasury = bot.money * (1 - s.research / 100);
  assessEnemies(s);
  s.camp = planCampaign(s);
  diplomacy(s);
  terraform(s);
  takePositions(s);
  if (s.yard) build(s);
  organizeFleets(s);
  // --- Wormholes: a probe first, then settlers or a raid to the far side
  if (s.P.wormholes) wormholeTrips(s);
  orderFleets(s);
  if (s.hard) recall(s);
  if (s.hard) detach(s);
  if (bot.knownHoles.size) comeBack(s);
  logistics(s);
  refit(s);

  bot.ready = true;
}
