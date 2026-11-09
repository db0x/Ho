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

/** Still image of a type in device pixels, drawn once. */
function sprite(type, len, color) {
  const key = `${type}|${len}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = TYPES[type] || fighter;
  const S = len / 100;
  const half = Math.ceil(def.r * S + 12);
  const cv = document.createElement('canvas');
  cv.width = cv.height = half * 2;
  const g = cv.getContext('2d');
  g.translate(half, half);
  g.scale(S, S);
  def.body(g, color, S);
  const sp = { canvas: cv, half };
  if (cache.size > 40) cache.clear();
  cache.set(key, sp);
  return sp;
}

/**
 * Draws a ship in full detail.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{type:string,x:number,y:number,angle?:number,len:number,color?:string,phase?:number}} o
 *   phase in seconds - drives flames and lights
 */
export function drawShipHD(ctx, o) {
  const def = TYPES[o.type] || fighter;
  const len = Math.round(o.len * (SHIP_SCALE[o.type] || 1));
  const color = o.color || '#9fb0c8';
  const t = o.phase || 0;
  const S = len / 100;
  const sp = sprite(o.type, len, color);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle || 0);
  ctx.save();
  ctx.scale(S, S);
  def.engines.forEach((e, i) => plume(ctx, e.x, e.y, e.r, e.color, t, i * 1.7));
  ctx.restore();
  ctx.drawImage(sp.canvas, -sp.half, -sp.half);
  ctx.scale(S, S);
  for (const l of def.lights) light(ctx, l.x, l.y, l.r, l.color, t, l.off, l.strobe);
  // Moving parts of their own - the aliens' eye and glowing core.
  def.anim?.(ctx, t);
  ctx.restore();
}
