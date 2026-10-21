// Interception: whoever departs from an orbit holding an armed enemy fights
// along for INTERCEPT_ROUNDS rounds and is then gone. Previously every scout
// escaped because movement is resolved before combat.
import { createGame, addPlayer, startGame, resolveTurn } from '../server/game.js';
import { shipStats, INTERCEPT_ROUNDS } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

/** Two empires, a free world near your own homeworld, two empty fleets. */
function setup() {
  const g = createGame('Intercept');
  g.settings.seed = 42;
  g.settings.turnTimer = 0;
  addPlayer(g, { name: 'Me' });
  addPlayer(g, { name: 'Enemy' });
  startGame(g);
  const [me, foe] = g.players;
  const home = g.galaxy.planets.find(p => p.id === me.homeworld);
  const P = g.galaxy.planets.filter(p => p.owner === null)
    .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
  // An existing ship as a template: then tech levels and fields are right.
  const template = (owner) => g.fleets.find(f => f.owner === owner).ships[0];
  const fleet = (owner, type, n) => {
    const model = template(owner);
    const st = shipStats(type, model.tech);
    const ships = Array.from({ length: n }, () => ({
      ...model, id: 's' + g.nextShipId++, type, hp: st.maxHp, maxHp: st.maxHp,
      attack: st.attack, speed: Math.round(st.speed), range: Math.round(st.range), colonists: 0
    }));
    const f = { id: 'f' + g.nextFleetId++, owner, ships, at: P.id, x: P.x, y: P.y, z: P.z || 0, dest: null };
    g.fleets.push(f);
    return f;
  };
  // The fighter arrives this turn: right next to the world, heading for it
  const incoming = (f) => Object.assign(f, { at: null, x: P.x + 5, dest: P.id });
  return { g, me, foe, P, fleet, incoming };
}

const combatAt = (entries, P) => entries.find(e => e.type === 'combat' && e.planetId === P.id && e.battle);

// 1) A single scout flees from an arriving fighter - and gets caught
{
  const { g, me, foe, P, fleet, incoming } = setup();
  incoming(fleet(me.id, 'fighter', 1));
  const scout = fleet(foe.id, 'scout', 1);
  scout.dest = foe.homeworld;
  const entries = resolveTurn(g);
  const k = combatAt(entries, P);
  assert(k, 'Fleeing scout was not intercepted');
  assert(!g.fleets.includes(scout) || !scout.ships.length, 'Scout survived the interception');
  assert(k?.battle.fled.length === 1, 'Record does not name the fleeing ship');
}

// 2) A strong fleet flees from a fighter: it only fights the first rounds
//    and is gone afterwards, not held in orbit.
{
  const { g, me, foe, P, fleet, incoming } = setup();
  incoming(fleet(me.id, 'fighter', 1));
  const strong = fleet(foe.id, 'fighter', 6);
  strong.dest = foe.homeworld;
  const entries = resolveTurn(g);
  const k = combatAt(entries, P);
  assert(k, 'Fleeing fleet was not intercepted');
  assert(strong.ships.length > 0 && strong.at !== P.id, 'Strong fleet did not escape');
  const fled = new Set(k.battle.fled);
  k.battle.rounds.forEach((shots, r) => {
    if (r < INTERCEPT_ROUNDS) return;
    for (const [from, to] of shots) {
      assert(!fled.has(from) && !fled.has(to), `Fleeing ship still fights in round ${r + 1}`);
    }
  });
}

// 3) Without an armed enemy you depart unhindered
{
  const { g, me, foe, P, fleet } = setup();
  fleet(me.id, 'scout', 1).dest = me.homeworld;
  const scout = fleet(foe.id, 'scout', 1);
  scout.dest = foe.homeworld;
  const entries = resolveTurn(g);
  assert(!combatAt(entries, P), 'Combat without armed ships');
  assert(scout.ships.length === 1, 'Scout lost for no reason');
}

// 4) Whoever just arrives and stays fights the full battle as before
{
  const { g, me, foe, P, fleet, incoming } = setup();
  incoming(fleet(me.id, 'fighter', 1));
  fleet(foe.id, 'scout', 1);
  const k = combatAt(resolveTurn(g), P);
  assert(k && k.battle.fled.length === 0, 'Staying scout listed as fleeing');
}

if (errors) process.exit(1);
console.log('All interception checks passed.');
