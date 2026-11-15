// Detailed ship graphics for large displays (ship profile). Same silhouettes
// as ships.js, but with light edges, panel lines, rivets, nozzles, navigation
// lights and exhaust flames. Drawn pointing to the right on a grid of 100
// units of ship length; the caller rotates.
// Every type has its own module in ./shipshd/, drawn with the parts in
// ./shipshd/kit.js; this one keeps the finished images and draws them.
import { SHIP_SCALE } from './ships.js';
import { alienCarrier, alienFighter } from './shipshd/alien.js';
import { colony } from './shipshd/colony.js';
import { destroyer } from './shipshd/destroyer.js';
import { fighter } from './shipshd/fighter.js';
import { plume, light } from './shipshd/kit.js';
import { satellite } from './shipshd/satellite.js';
import { scout } from './shipshd/scout.js';
import { station, stationSite } from './shipshd/station.js';
import { tanker } from './shipshd/tanker.js';
import { transport } from './shipshd/transport.js';

const TYPES = { scout, fighter, satellite, colony, tanker, transport, destroyer, alienFighter, alienCarrier, station, stationSite };

const cache = new Map();

/**
 * What a type looks like with this tech: the fighter changes with it
 * (fighterlook.js), every other type always looks the same (null).
 */
function lookOf(def, tech) {
  return def.look ? def.look(tech) : null;
}
const part = (v, look) => typeof v === 'function' ? v(look) : v;

/**
 * What a type's profile is made of, for a stage that does not draw it flat
 * (ships3d.js): the still drawing, and what moves on it.
 * @returns {{key:string,r:number,engines:object[],lights:object[],body:Function,anim?:Function,solid?:object}}
 */
export function shipProfile(type, tech) {
  const def = TYPES[type] || fighter;
  const look = lookOf(def, tech);
  return {
    key: look?.key ?? '',
    r: part(def.r, look),
    engines: part(def.engines, look),
    lights: part(def.lights, look),
    // opts: {solid} drawn as the skin of a solid, {under} as its underside
    body: (g, color, S, opts) => def.body(g, color, S, look, opts),
    anim: def.anim && ((g, t) => def.anim(g, t, look)),
    // What the type says about its shape in space (relief in ships3d.js)
    solid: part(def.solid, look)
  };
}

/** Still image of a type in device pixels, drawn once. */
function sprite(type, len, color, look) {
  const key = `${type}|${len}|${color}|${look?.key ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = TYPES[type] || fighter;
  const S = len / 100;
  const half = Math.ceil(part(def.r, look) * S + 12);
  const cv = document.createElement('canvas');
  cv.width = cv.height = half * 2;
  const g = cv.getContext('2d');
  g.translate(half, half);
  g.scale(S, S);
  def.body(g, color, S, look);
  const sp = { canvas: cv, half };
  if (cache.size > 40) cache.clear();
  cache.set(key, sp);
  return sp;
}

/**
 * Draws a ship in full detail.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{type:string,x:number,y:number,angle?:number,len:number,color?:string,phase?:number,tech?:object}} o
 *   phase in seconds - drives flames and lights; tech the ship was built
 *   with - the fighter looks different with it
 */
export function drawShipHD(ctx, o) {
  const def = TYPES[o.type] || fighter;
  const len = Math.round(o.len * (SHIP_SCALE[o.type] || 1));
  const color = o.color || '#9fb0c8';
  const t = o.phase || 0;
  const S = len / 100;
  const look = lookOf(def, o.tech);
  const sp = sprite(o.type, len, color, look);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle || 0);
  ctx.save();
  ctx.scale(S, S);
  part(def.engines, look).forEach((e, i) => plume(ctx, e.x, e.y, e.r, e.color, t, i * 1.7, e.len));
  ctx.restore();
  ctx.drawImage(sp.canvas, -sp.half, -sp.half);
  ctx.scale(S, S);
  for (const l of part(def.lights, look)) light(ctx, l.x, l.y, l.r, l.color, t, l.off, l.strobe);
  // Moving parts of their own - the aliens' eye and glowing core.
  def.anim?.(ctx, t, look);
  ctx.restore();
}
