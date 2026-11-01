// Alliances: allies do not fight each other but side by side against
// others, share what they see, supply each other's fleets, win together -
// and a secret alliance gives itself away to whoever sees it in an orbit.
// Notice holds for NOTICE_TURNS turns; then fleets in the former ally's
// orbit fight. And the AI empires play along - unless the lobby switched
// alliances off.
import {
  offerAlliance, answerOffer, endAlliance, announceAlliance, allied, mayOffer, NOTICE_TURNS
} from '../server/game/diplomacy.js';
import { createGame, startGame } from '../server/game/game.js';
import { buildView } from '../server/game/intel.js';
import { canReach } from '../server/game/movement.js';
import { addPlayer } from '../server/game/players.js';
import { resolveTurn } from '../server/game/turn.js';
import { runBot } from '../server/ai/bot.js';
import { answerOffers } from '../server/ai/diplomacy.js';
import { shipStats, dist } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

/** Three empires A, B, C and a free world P near A's homeworld. */
function setup() {
  const g = createGame('Alliance');
  g.settings.seed = 42;
  g.settings.turnTimer = 0;
  g.settings.wormholes = false;
  for (const name of ['A', 'B', 'C']) addPlayer(g, { name });
  startGame(g);
  const [a, b, c] = g.players;
  const home = g.galaxy.planets[a.homeworld];
  const P = g.galaxy.planets.filter(p => p.owner === null).sort((x, y) => dist(x, home) - dist(y, home))[0];
  const template = (owner) => g.fleets.find(f => f.owner === owner).ships[0];
  const fleet = (owner, type, n, at = P) => {
    const model = template(owner);
    const st = shipStats(type, model.tech);
    const ships = Array.from({ length: n }, () => ({
      ...model, id: 's' + g.nextShipId++, type, hp: st.maxHp, maxHp: st.maxHp,
      attack: st.attack, speed: Math.round(st.speed), range: Math.round(st.range),
      colonists: type === 'colony' ? st.colonists || 1 : 0
    }));
    const f = { id: 'f' + g.nextFleetId++, owner, ships, at: at.id, x: at.x, y: at.y, z: at.z || 0, dest: null };
    g.fleets.push(f);
    return f;
  };
  const ally = (x, y, secret = false) => { offerAlliance(g, x, y.id, secret); answerOffer(g, y, x.id, true); };
  return { g, a, b, c, P, home, fleet, ally };
}
const battleAt = (entries, P) => entries.find(e => e.type === 'combat' && e.planetId === P.id && e.battle);

// 1) Offer, accept: allied; declined: not, and no new offer right away
{
  const { g, a, b, c } = setup();
  assert(!offerAlliance(g, a, b.id, false), 'Offer was refused');
  assert(!allied(g, a.id, b.id), 'Allied before the answer');
  answerOffer(g, b, a.id, true);
  assert(allied(g, a.id, b.id) && allied(g, b.id, a.id), 'Not allied after accepting');
  assert(offerAlliance(g, b, a.id, false)?.error === 'err.alreadyAllied', 'Second alliance between the same two');
  offerAlliance(g, a, c.id, false);
  answerOffer(g, c, a.id, false);
  assert(!allied(g, a.id, c.id), 'Allied although declined');
  assert(!mayOffer(g, a.id, c.id), 'May offer again right after being turned down');
  // Both offer each other: the second offer is the answer.
  const t = setup();
  offerAlliance(t.g, t.b, t.c.id, true);
  offerAlliance(t.g, t.c, t.b.id, false);
  assert(allied(t.g, t.b.id, t.c.id), 'Mutual offers did not make an alliance');
}

// 2) Allies in one orbit: no battle - and against a third, they fight together
{
  const { g, a, b, c, P, fleet, ally } = setup();
  ally(a, b);
  fleet(a.id, 'fighter', 3);
  fleet(b.id, 'fighter', 3);
  let entries = resolveTurn(g);
  assert(!battleAt(entries, P), 'Allies fought each other');
  assert(g.fleets.filter(f => f.at === P.id).every(f => f.ships.length === 3), 'Allied ships lost without a battle');
  fleet(c.id, 'fighter', 2);
  entries = resolveTurn(g);
  const k = battleAt(entries, P);
  assert(k, 'No battle against the third empire');
  // Every shot goes between C and the allies, never between A and B.
  const side = k.battle.units.map(u => k.battle.sides[u[0]]);
  const shots = k.battle.rounds.flat();
  assert(shots.length > 0, 'Nobody shot');
  assert(shots.every(([s, t]) => (side[s] === c.id) !== (side[t] === c.id)), 'Allies shot at each other');
  assert(!g.fleets.some(f => f.owner === c.id && f.at === P.id && f.ships.length), 'C held out against two allies');
}

// 3) An allied fleet over an ally's world: no battle, no invasion
{
  const { g, a, b, fleet, ally } = setup();
  ally(a, b);
  const hw = g.galaxy.planets[b.homeworld];
  fleet(a.id, 'fighter', 20, hw);
  const entries = resolveTurn(g);
  assert(!battleAt(entries, hw), 'The battery fired at an ally');
  assert(hw.owner === b.id, 'An ally took the world');
}

// 4) Allies settle side by side: a colony ship lands with an allied escort
{
  const { g, a, b, P, fleet, ally } = setup();
  ally(a, b);
  fleet(a.id, 'colony', 1);
  fleet(b.id, 'fighter', 2);
  resolveTurn(g);
  assert(P.owner === a.id, 'The colony ship did not land under allied escort');
}

// 5) Supply: a target out of reach from own worlds is in reach from an ally's
{
  const { g, a, b, fleet, ally } = setup();
  const target = g.galaxy.planets[b.homeworld];
  const scout = fleet(a.id, 'scout', 1, g.galaxy.planets[a.homeworld]);
  for (const s of scout.ships) s.range = Math.round(dist(g.galaxy.planets[a.homeworld], target) / 2);
  assert(!canReach(g, scout, target).ok, 'Reachable already without the alliance');
  ally(a, b);
  assert(canReach(g, scout, target).ok, "The ally's world does not supply");
}

// 6) Shared sight: the ally's homeworld is live in the view, also as knowledge
{
  const { g, a, b, ally } = setup();
  const hw = b.homeworld;
  assert(buildView(g, a).planets[hw].known !== 'live', "B's homeworld live without an alliance");
  ally(a, b);
  resolveTurn(g);
  const v = buildView(g, a);
  assert(v.planets[hw].known === 'live', "The ally's world is not in sight");
  assert(a.explored.has(hw), "The ally's world is not explored");
  assert(v.me.allies.includes(b.id), 'The view does not name the ally');
}

// 7) Secret: unknown to C - until C sees both fleets in one orbit
{
  const { g, a, b, c, P, fleet, ally } = setup();
  ally(a, b, true);
  assert(!buildView(g, c).diplomacy.alliances.length, 'C knows of the secret alliance');
  assert(buildView(g, a).diplomacy.alliances.length === 1, 'A does not see its own alliance');
  fleet(a.id, 'scout', 1);
  fleet(b.id, 'scout', 1);
  const entries = resolveTurn(g);
  assert(!entries.some(e => e.key === 'log.allianceExposed'), 'Exposed without a witness');
  fleet(c.id, 'scout', 1);
  // Scouts are unarmed: nobody fights, C watches.
  const later = resolveTurn(g);
  const seen = later.find(e => e.key === 'log.allianceExposed');
  assert(seen && seen.private === c.id, 'C did not see through the secret alliance');
  assert(buildView(g, c).diplomacy.alliances.length === 1, 'C does not know of it now');
  // Announced: everyone knows, and the log says so to everyone.
  const t = setup();
  t.ally(t.a, t.b, true);
  announceAlliance(t.g, t.b, t.a.id);
  const told = resolveTurn(t.g).find(e => e.key === 'log.allianceAnnounced');
  assert(told && !told.playerIds, 'The announcement is not public');
  assert(buildView(t.g, t.c).diplomacy.alliances.length === 1, 'C does not know of the public alliance');
}

// 8) Notice: allied for NOTICE_TURNS more turns, then the guest in orbit fights
{
  const { g, a, b, P, fleet, ally } = setup();
  ally(a, b);
  fleet(a.id, 'fighter', 4);
  fleet(b.id, 'fighter', 1);
  endAlliance(g, a, b.id);
  for (let i = 0; i < NOTICE_TURNS; i++) {
    assert(allied(g, a.id, b.id), `Not allied any more during the notice (turn ${i + 1})`);
    assert(!battleAt(resolveTurn(g), P), `Fought during the notice (turn ${i + 1})`);
  }
  assert(!allied(g, a.id, b.id), 'Still allied after the notice');
  assert(battleAt(resolveTurn(g), P), 'No battle after the notice ran out');
}

// 9) Only allies left: they win together
{
  const { g, a, b, c, ally } = setup();
  ally(a, b);
  c.alive = false;
  g.fleets = g.fleets.filter(f => f.owner !== c.id);
  for (const p of g.galaxy.planets) if (p.owner === c.id) p.owner = null;
  resolveTurn(g);
  assert(g.state === 'over', 'The game did not end with only allies left');
  assert(g.winners?.length === 2 && g.winners.includes(a.id) && g.winners.includes(b.id), 'Not both allies won');
  // Under notice there is no shared victory.
  const t = setup();
  t.ally(t.a, t.b);
  endAlliance(t.g, t.a, t.b.id);
  t.c.alive = false;
  t.g.fleets = t.g.fleets.filter(f => f.owner !== t.c.id);
  for (const p of t.g.galaxy.planets) if (p.owner === t.c.id) p.owner = null;
  resolveTurn(t.g);
  assert(t.g.state === 'running', 'Shared victory although notice was given');
}

// 10) The AI answers offers - and keeps its word against its rival
{
  const { g, a } = setup();
  const bot = g.players[1];
  bot.isBot = true; bot.persona = 'settler'; bot.level = 'normal';
  offerAlliance(g, a, bot.id, false);
  answerOffers(g, bot);
  assert(!g.offers.length, 'The AI left the offer unanswered');
}

// 11) AI empires form alliances among themselves, and a game runs through
{
  let seed = 4242;
  const random = Math.random;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = createGame('Bots');
  g.settings.seed = 'alliance-bots';
  for (let i = 0; i < 6; i++) addPlayer(g, { isBot: true, level: i % 2 ? 'hard' : 'normal' });
  startGame(g);
  let formed = 0;
  while (g.state === 'running' && g.turn < 160) {
    for (const p of g.players.filter(p => p.alive)) runBot(g, p);
    formed += resolveTurn(g).filter(e => e.key === 'log.alliance' || e.key === 'log.allianceSecret').length;
  }
  Math.random = random;
  assert(formed > 0, 'The AI empires never allied');
  console.log(`AI game: ${formed} alliance(s) in ${g.turn} turns.`);
}

// 12) Switched off in the lobby: no offers, the AI stays out of it
{
  const { g, a, b } = setup();
  g.settings.alliances = false;
  assert(offerAlliance(g, a, b.id, false)?.error === 'err.alliancesOff', 'Offer accepted with alliances switched off');
  assert(!g.offers.length && buildView(g, a).alliances === false, 'The view does not tell the client');
  let seed = 4242;
  const random = Math.random;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bots = createGame('Bots');
  bots.settings.seed = 'alliance-bots';
  bots.settings.alliances = false;
  for (let i = 0; i < 6; i++) addPlayer(bots, { isBot: true, level: i % 2 ? 'hard' : 'normal' });
  startGame(bots);
  while (bots.state === 'running' && bots.turn < 160) {
    for (const p of bots.players.filter(p => p.alive)) runBot(bots, p);
    resolveTurn(bots);
  }
  Math.random = random;
  assert(!bots.log.some(l => l.entries.some(e => e.type === 'diplomacy')), 'AI empires allied although switched off');
}

if (errors) { console.error(`${errors} error(s).`); process.exit(1); }
console.log('Alliances: OK');
