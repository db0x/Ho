// Fog of war: what the sensors of an empire reach. With the game setting
// "fog" on, an empire sees only what its own worlds and fleets - and those
// of its allies - cover: worlds, foreign fleets, wormhole mouths, rifts.
// Off, the older, wider rules stay as they were (intel.js, wormholes.js,
// aliens.js); every caller asks fogOn() first.
//
// The eyes are a plain list of spheres. Built once per view or move and
// handed around, instead of walking every world and fleet for every object
// looked at.
import { SENSOR, dist, stationReady } from '../../shared/rules.js';
import { teamOf } from './diplomacy.js';

/** Is fog of war on? Games from before the setting keep the old sight. */
export const fogOn = (game) => game.settings.fog === true;

/** Sensor range of one world, by its station. */
export const worldSensor = (planet) => stationReady(planet.station) ? SENSOR.station : SENSOR.world;

/** Sensor range of one fleet: a scout along carries it far. */
export const fleetSensor = (fleet) => fleet.ships.some(s => s.type === 'scout') ? SENSOR.scout : SENSOR.fleet;

/**
 * The eyes of an empire and its allies: { x, y, z, r } per world and fleet.
 * @returns {{x: number, y: number, z: number, r: number}[]}
 */
export function eyesOf(game, playerId) {
  const team = teamOf(game, playerId);
  const eyes = [];
  for (const q of game.galaxy.planets) {
    if (team.includes(q.owner)) eyes.push({ x: q.x, y: q.y, z: q.z || 0, r: worldSensor(q) });
  }
  for (const f of game.fleets) {
    if (team.includes(f.owner) && f.ships.length) eyes.push({ x: f.x, y: f.y, z: f.z || 0, r: fleetSensor(f) });
  }
  return eyes;
}

/** Does one of the eyes reach this point? */
export const covered = (eyes, point) => eyes.some(e => dist(e, point) < e.r);
