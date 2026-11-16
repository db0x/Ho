// Fleets on the maps as solids: the same ships in three dimensions as in the
// profile (ships3d.js), lying in the plane of the galaxy. On the 3D map that
// plane is tipped by the camera, on the flat map the ships are seen a little
// from above; either way the bow points where the flat icon would.
//
// A browser allows only a few WebGL contexts, and a map draws dozens of
// fleets: one hidden stage draws each ship once per pose, size and moment of
// its flames, and the picture is kept and copied onto the map from then on.
// The poses are rounded finely enough that the steps do not show. New
// pictures get a few milliseconds per frame; until a fleet's own is ready it shows
// its nearest one, or the flat icon.
import { shipStage3D, SOLID_FILL } from './ships3d.js';
import { shipProfile } from './shipshd.js';
import { bestFighter } from './fighterlook.js';

/** Types that stay flat: the station is drawn at a slant around its world already. */
const FLAT = new Set(['station', 'stationSite']);
const YAW_STEPS = 72;          // 5° per step
const TILT_STEP = 0.06;        // radians
const SIZE_STEP = 1.08;        // each size 8 % larger than the one before
const FLICKER = 6;             // moments of the flames, a second round
// A solid reads smaller than the flat icon of the same length: a little
// larger overall, the slender colony ship more so.
const GROW = 1.2, GROW_TYPE = { colony: 1.3 };
const EDGE = 0.42;             // within 24° of edge-on the tilt is drawn steeper
const MIN_LEN = 14;            // below this many pixels the flat icon is clearer
const BUDGET_MS = 6;           // time for new pictures per frame - at least one
const KEEP = 900;              // pictures kept
// The canvas reaches a little past the hull's circle, so the flames fit.
const ROOM = 0.8;

let stage = null, glCanvas = null, broken = false;
const pictures = new Map();    // key -> {cv, bow: where its bow points on screen}
// Stand-ins while a picture is not ready: the fleet's own last one, the
// ship's last one in the same pose at any size, else the ship's last at all.
const latest = new Map();      // key -> {cv, bow}
const models = new Set();      // ships the stage has built - a new one costs
let frameNo = -1, spent = 0, built = 0;

function ensureStage() {
  if (stage || broken) return stage;
  glCanvas = document.createElement('canvas');
  stage = shipStage3D(glCanvas, { tex: 512, fx: 256, keep: 24 });
  if (!stage) broken = true;
  return stage;
}

/**
 * The model's turn on the stage for a bow pointing at `angle` on screen
 * (canvas: 0 = right, clockwise) in a plane tipped by `tilt` from facing the
 * viewer: on screen the bow of a turned model points to (cos a, cos(tilt)
 * sin a) with y up, a = yaw + 90°.
 */
function yawFor(angle, tilt) {
  // Seen from below the galaxy (tilt past a right angle) the sign flips.
  const c = Math.cos(tilt), ct = Math.sign(c || 1) * Math.max(0.12, Math.abs(c));
  return Math.atan2(-Math.sin(angle) / ct, Math.cos(angle)) - Math.PI / 2;
}

/** The tilt as drawn: within EDGE of edge-on (π/2) pushed away from it, continuously. */
function steeper(t) {
  const d = t - Math.PI / 2, u = Math.abs(d) / EDGE;
  return u >= 1 ? t : Math.PI / 2 + Math.sign(d) * EDGE * u ** 0.6;
}

/** An angle brought into -π..π. */
const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

/** Where the bow of a picture points on screen (canvas angle), and how long it looks (0-1). */
function bowOf(yaw, tilt) {
  const a = yaw + Math.PI / 2;
  const x = Math.cos(a), y = Math.cos(tilt) * Math.sin(a);
  return { angle: Math.atan2(-y, x), len: Math.hypot(x, y) };
}

/**
 * Draws the fleet's leading ship as a solid. False if it cannot (no WebGL,
 * too small, a type that stays flat, an alien swarm, nothing ready yet) -
 * then the caller draws the flat icon.
 *
 * The picture is turned on the canvas so it lies as the exact pose would:
 * that evens out the rounding of the pose, a stand-in drawn while the right
 * picture is not ready, and the sideways lean of the plane away from the
 * middle of a perspective view. Given a yaw (the 3D map, from the true
 * heading) the pose alone decides, so a ship seen along its path keeps
 * still; without one (the flat map) the bow follows o.angle.
 * @param {{x:number,y:number,angle:number,len:number,color:string,phase:number}} o as for drawFleetShips
 * @param {{tilt:number, yaw?:number, roll?:number}} pose how far the plane of
 *   the galaxy is tipped from facing the viewer; the model's turn in it (from
 *   o.angle if not given); how far the plane leans sideways on screen
 */
export function drawFleetSolid(ctx, o, f, lead, pose) {
  if (o.len < MIN_LEN || FLAT.has(lead) || f.ships?.some(s => s.type === 'alienCarrier')) return false;
  if (!ensureStage()) return false;
  // Seen almost edge-on a ship would shrink to a sliver: near the edge the
  // view is drawn steeper than it is - but running on through edge-on, so a
  // camera passing from above the galaxy to below it turns the ship over
  // smoothly instead of flipping it at once.
  const tilt = steeper(pose.tilt);
  const tech = lead === 'fighter' ? bestFighter(f.ships)?.tech : undefined;
  const prof = shipProfile(lead, tech);
  const fill = (SOLID_FILL[lead] || 1) * ROOM;
  // Size on screen of the canvas: the hull's circle, r in hundredths of the length
  const len = o.len * GROW * (GROW_TYPE[lead] || 1);
  const side = 2 * prof.r * len / 100 / fill;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const sizeIdx = Math.round(Math.log(side * dpr) / Math.log(SIZE_STEP));
  const px = Math.round(SIZE_STEP ** sizeIdx);
  // The turn for that tilt, so the bow still points where it would at the
  // true one - where the bow points almost at the viewer, the true turn.
  let yaw = pose.yaw ?? yawFor(o.angle, tilt);
  if (pose.yaw != null && tilt !== pose.tilt) {
    const bow = bowOf(pose.yaw, pose.tilt), k = Math.min(1, Math.max(0, (bow.len - 0.15) / 0.2));
    yaw += k * wrap(yawFor(bow.angle, tilt) - pose.yaw);
  }
  const yawIdx = ((Math.round(yaw / (Math.PI * 2) * YAW_STEPS) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
  const tiltIdx = Math.round(tilt / TILT_STEP);
  const flick = ((Math.floor((o.phase || 0) * FLICKER) % FLICKER) + FLICKER) % FLICKER;
  const ship = `${lead}|${o.color}|${prof.key}`;
  const key = `${ship}|${px}|${yawIdx}|${tiltIdx}|${flick}`;

  let pic = pictures.get(key);
  if (pic) { pictures.delete(key); pictures.set(key, pic); }      // most recently used last
  else {
    // The frame's own time: the same for everything drawn in one frame
    const now = document.timeline?.currentTime ?? performance.now();
    if (now !== frameNo) { frameNo = now; spent = 0; built = 0; }
    const fresh = !models.has(ship);
    if (spent < BUDGET_MS && !(fresh && built >= 1)) {
      const t0 = performance.now();
      const qYaw = yawIdx * Math.PI * 2 / YAW_STEPS, qTilt = tiltIdx * TILT_STEP;
      const cv = paint(lead, o.color, tech, px, qYaw, qTilt, flick / FLICKER, fill);
      if (!cv) return false;
      pic = { cv, bow: bowOf(qYaw, qTilt) };
      // At least one per frame, however slow the device
      spent += Math.max(0.01, performance.now() - t0);
      if (fresh) { models.add(ship); built++; }
      pictures.set(key, pic);
      if (pictures.size > KEEP) pictures.delete(pictures.keys().next().value);
    }
  }
  // Stand-ins: this fleet's last picture, else the ship's in this pose, else any of it
  const own = `${f.id}|${ship}`, inPose = `${ship}|${yawIdx}|${tiltIdx}`;
  if (pic) {
    for (const k of [own, inPose, ship]) { latest.delete(k); latest.set(k, pic); }
    while (latest.size > KEEP) latest.delete(latest.keys().next().value);
  } else pic = latest.get(own) || latest.get(inPose) || latest.get(ship);
  if (!pic) return false;
  // Turned so the picture lies as the exact pose would: the bow where that
  // one's points on screen, plus the lean. Where the bow points almost at
  // the viewer its direction on screen says little - there only the lean.
  // On the flat map (no yaw given) the bow follows o.angle itself.
  const want = bowOf(yaw, tilt);
  const target = pose.yaw == null ? o.angle : want.angle + (pose.roll || 0);
  const k = Math.min(1, Math.max(0, (Math.min(want.len, pic.bow.len) - 0.15) / 0.2));
  const turn = (pose.roll || 0) + k * wrap(target - pic.bow.angle - (pose.roll || 0));
  ctx.save();
  ctx.translate(o.x, o.y);
  if (turn) ctx.rotate(turn);
  ctx.drawImage(pic.cv, -side / 2, -side / 2, side, side);
  ctx.restore();
  return true;
}

/** One picture from the stage, `px` device pixels square. */
function paint(type, color, tech, px, yaw, tilt, phase, fill) {
  // Twice the size, scaled down: smooth edges
  const big = px * 2;
  if (glCanvas.width !== big) glCanvas.width = glCanvas.height = big;
  if (!stage.draw({ type, color, tech, phase, yaw, tilt, fill })) {
    broken = true; stage = null;
    return null;
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(glCanvas, 0, 0, px, px);
  return cv;
}

/** Pictures in store, for tests and the debug panel. */
export function spriteStats() { return { pictures: pictures.size, models: models.size, broken }; }
