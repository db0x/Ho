// The ship profile as a solid: the detailed top view from shipshd.js, raised
// into a relief and turned in space with WebGL - no model files, no library.
//
// The drawing itself says where the hull is (its opacity). From the distance
// to the outline a height follows: thin at the rim, thick in the middle, so
// wings come out flat and tanks round. A grid of points is lifted by that
// height, once upwards and - a little flatter - once downwards, and carries
// the drawing as its skin; light falls on it from the slopes of the relief.
// Where that alone would be wrong - a solar panel is a plate, not a pillow -
// the type says what its parts are like (`solid` in its profile).
// What moves - flames, navigation lights, the aliens' glow - is drawn anew
// every frame as before and laid on: the flames as crossed sheets behind the
// nozzles, the lights onto the hull.
import { shipProfile } from './shipshd.js';
import { plume, light, tone, poly } from './shipshd/kit.js';

const TEX_FULL = 1024;   // the hull's skin, pixels along an edge
const FX_FULL = 512;     // flames and lights
const DT = 512;          // resolution the distance to the outline is measured at
const GRID = 192;        // cells of the relief along an edge
/** Up to this distance from the outline the hull gets thicker (units of ship length / 100) ... */
const RELIEF_R = 13;
/** ... and this thick at most, upwards; downwards a little less. */
const RELIEF_H = 9;
const BELLY = 0.7;
const FOV = 26 * Math.PI / 180;
const KEEP_FULL = 6;     // models kept ready

/** Size on a stage per type, 1 = the hull's circle touches the edge. */
export const SOLID_FILL = { colony: 0.9, destroyer: 1.1 };

// A wall takes its color from a little way inside the part it belongs to -
// on the outline itself the drawing only has its dark contour.
const RELIEF_VS = `
attribute vec2 aPos;
attribute vec3 aRelief;
uniform mat3 uRot;
uniform vec4 uCam;
uniform float uSide, uExt;
varying vec2 vUv;
varying vec2 vIn;
varying vec3 vN;
varying vec3 vM;
void main() {
  vec2 up = aRelief.yz * uSide;
  float steep = length(up);
  vec2 inset = steep > 0.001 ? up / steep * min(1.0, steep * 0.6) * 1.3 : vec2(0.0);
  vUv = vec2(aPos.x, -aPos.y) / (2.0 * uExt) + 0.5;
  vIn = vec2(inset.x, -inset.y) / (2.0 * uExt);
  vM = uSide * vec3(-aRelief.yz, 1.0);
  vN = uRot * vM;
  vec3 q = uRot * vec3(aPos, aRelief.x);
  float ze = q.z - uCam.y;
  gl_Position = vec4(uCam.x * q.xy, (uCam.w + uCam.z) / (uCam.z - uCam.w) * ze + 2.0 * uCam.w * uCam.z / (uCam.z - uCam.w), -ze);
}`;

const RELIEF_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uMode;
varying vec2 vUv;
varying vec2 vIn;
varying vec3 vN;
varying vec3 vM;
void main() {
  vec4 c = texture2D(uTex, vUv);
  if (uMode > 0.5) { gl_FragColor = c; return; }
  if (c.a < 0.5) discard;
  // The outline decides what is hull; the color comes from further inside
  vec4 inner = texture2D(uTex, vUv + vIn);
  if (inner.a > 0.9) c = inner;
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 36.0);
  float rim = smoothstep(-0.05, 0.5, n.z);
  // What faces down on the ship lies in its own shade
  float shade = mix(1.0, 0.62, smoothstep(0.0, 0.7, -normalize(vM).z));
  vec3 col = c.rgb / c.a * (0.4 + 0.85 * diff) * mix(0.45, 1.0, rim) * shade + spec * 0.28 * shade;
  gl_FragColor = vec4(col, 1.0);
}`;

const SHEET_VS = `
attribute vec3 aP;
attribute vec2 aUv;
uniform mat3 uRot;
uniform vec4 uCam;
varying vec2 vUv;
void main() {
  vUv = aUv;
  vec3 q = uRot * aP;
  float ze = q.z - uCam.y;
  gl_Position = vec4(uCam.x * q.xy, (uCam.w + uCam.z) / (uCam.z - uCam.w) * ze + 2.0 * uCam.w * uCam.z / (uCam.z - uCam.w), -ze);
}`;

// uSolid: 0 for a glow that is added to what lies behind; otherwise an
// opaque sheet, and the value is the light falling on it.
const SHEET_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uSolid;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uTex, vUv);
  if (uSolid > 0.0) {
    if (c.a < 0.5) discard;
    c = vec4(c.rgb / c.a * uSolid, 1.0);
  }
  gl_FragColor = c;
}`;

// A vault of glass: almost clear seen straight on, denser towards its rim,
// a hard gloss where the light strikes, thin ribs along it.
const GLASS_VS = `
attribute vec3 aP;
attribute vec3 aN;
uniform mat3 uRot;
uniform vec4 uCam;
varying vec3 vN;
varying vec3 vL;
void main() {
  vN = uRot * aN;
  vL = aN;
  vec3 q = uRot * aP;
  float ze = q.z - uCam.y;
  gl_Position = vec4(uCam.x * q.xy, (uCam.w + uCam.z) / (uCam.z - uCam.w) * ze + 2.0 * uCam.w * uCam.z / (uCam.z - uCam.w), -ze);
}`;

const GLASS_FS = `
precision mediump float;
varying vec3 vN;
varying vec3 vL;
void main() {
  vec3 n = normalize(vN);
  vec3 l = normalize(vL);
  vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
  float fres = pow(1.0 - abs(n.z), 2.2);
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 70.0);
  float soft = pow(max(dot(n, L), 0.0), 6.0);
  float m = abs(fract(atan(l.y, l.x) * 8.0 / 6.2831853 + 0.5) - 0.5);
  float rib = (1.0 - smoothstep(0.012, 0.03, m)) * smoothstep(0.02, 0.2, 1.0 - l.z);
  rib = max(rib, 1.0 - smoothstep(0.01, 0.025, abs(l.z - 0.62)));
  float a = 0.07 + 0.5 * fres + 0.16 * soft + 0.3 * rib;
  vec3 tint = vec3(0.72, 0.93, 1.0);
  gl_FragColor = vec4(tint * a + vec3(spec), min(1.0, a + spec));
}`;

/** The vaults of a model as triangles: position and normal per point. */
function domeMesh(domes) {
  const out = [], RINGS = 10, SEGS = 32;
  for (const d of domes) {
    const at = (i, j) => {
      const e = i / RINGS * Math.PI / 2, f = j / SEGS * Math.PI * 2;
      const c = Math.cos(e), sn = Math.sin(e);
      const n = [c * Math.cos(f) / d.r, c * Math.sin(f) / d.r, sn / d.h], len = Math.hypot(...n);
      return [d.x + d.r * c * Math.cos(f), -d.y + d.r * c * Math.sin(f), d.z + d.h * sn, n[0] / len, n[1] / len, n[2] / len];
    };
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEGS; j++) {
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), e = at(i + 1, j + 1);
      out.push(...a, ...b, ...c, ...c, ...b, ...e);
    }
  }
  return new Float32Array(out);
}

const BLADE_W = 256, BLADE_H = 128;
/** Outline of a fin from the side: along it from front to back, and up. */
const FIN = [[0, 0], [0.52, 1], [0.9, 1], [1, 0.3], [1, 0]];
const LIGHT = [-0.45, 0.6, 0.66].map(v => v / Math.hypot(0.45, 0.6, 0.66));

/** A fin seen from the side: silver, a stripe in the empire color along its leading edge. */
function bladeSkin(g, color) {
  const P = FIN.map(([a, v]) => [4 + a * (BLADE_W - 8), BLADE_H - 2 - v * (BLADE_H - 6)]);
  const shape = () => poly(g, P);
  const fill = g.createLinearGradient(0, 0, 0, BLADE_H);
  fill.addColorStop(0, tone('#aeb8c9', 0.3)); fill.addColorStop(1, tone('#aeb8c9', -0.25));
  shape(); g.fillStyle = fill; g.fill();
  g.save(); shape(); g.clip();
  // Stripe parallel to the leading edge, a seam behind it, a hinge line near the trailing edge
  const [[ax, ay], [bx, by]] = P;
  g.strokeStyle = color; g.lineWidth = 9;
  g.beginPath(); g.moveTo(ax + 26, ay); g.lineTo(bx + 26, by); g.stroke();
  g.strokeStyle = 'rgba(10,14,24,.55)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(ax + 60, ay); g.lineTo(bx + 60, by);
  g.moveTo(BLADE_W * 0.86, 0); g.lineTo(BLADE_W * 0.86, BLADE_H); g.stroke();
  // Finer joints across the fin, rivets along its foot
  g.lineWidth = 1;
  g.beginPath();
  for (const v of [0.35, 0.62]) { g.moveTo(0, BLADE_H - v * BLADE_H); g.lineTo(BLADE_W, BLADE_H - v * BLADE_H); }
  g.moveTo(ax + 96, ay); g.lineTo(bx + 96, by);
  g.stroke();
  g.fillStyle = 'rgba(20,26,38,.55)';
  for (let x = 40; x < BLADE_W - 20; x += 14) { g.beginPath(); g.arc(x, BLADE_H - 10, 1.4, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  g.restore();
  shape(); g.strokeStyle = 'rgba(5,8,16,.9)'; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
}

const INF = 1e20;

/** Squared distances along one line (Felzenszwalb & Huttenlocher). */
function dist1(f, d, v, z, n) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s > z[k] || k === 0) break;
      k--;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** For every pixel the squared distance to the nearest one where `hit` is set. */
function distSq(hit, n) {
  const out = new Float32Array(n * n);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = hit[y * n + x] ? 0 : INF;
    dist1(f, d, v, z, n);
    for (let y = 0; y < n; y++) out[y * n + x] = d[y];
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) f[x] = out[y * n + x];
    dist1(f, d, v, z, n);
    for (let x = 0; x < n; x++) out[y * n + x] = d[x];
  }
  return out;
}

/** Evens out the grid: the ridges where two slopes meet become round. */
function soften(h, n, passes = 2, r = 2) {
  const tmp = new Float32Array(h.length);
  const at = (a, x, y) => a[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += at(h, x + k, y);
      tmp[y * n + x] = s / (2 * r + 1);
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += at(tmp, x, y + k);
      h[y * n + x] = s / (2 * r + 1);
    }
  }
}

/** Signed distance to the outline of a mask in its pixels: positive inside. */
function signedDist(g) {
  const px = g.getImageData(0, 0, DT, DT).data;
  const inside = new Uint8Array(DT * DT), outside = new Uint8Array(DT * DT);
  let any = false;
  for (let i = 0; i < inside.length; i++) { inside[i] = px[i * 4 + 3] > 127 ? 1 : 0; outside[i] = 1 - inside[i]; any ||= !!inside[i]; }
  if (!any) return null;
  const toOut = distSq(outside, DT), toIn = distSq(inside, DT);
  const d = new Float32Array(DT * DT);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? Math.sqrt(toOut[i]) - 0.5 : 0.5 - Math.sqrt(toIn[i]);
  return d;
}

/** This far outside its outline a part still counts, falling on; beyond it drops away steeply. */
const MARGIN = 3.25;

/**
 * The relief of a drawing: for the upper and the lower shell the position,
 * height and slope at every point of the grid.
 *
 * The hull is everything the drawing covers. Inside its outline the height
 * rises with the distance to it; outside it goes on falling a little, so
 * the two shells cross exactly on the outline and the rim is closed.
 *
 * A type can say more about its shape (`solid` in its profile):
 *   hull   {r, h, belly, z} for everything not named otherwise
 *   parts  [{path(ctx), r, h, belly, z, over}] - regions with a shape of
 *          their own: r how far in from the edge it keeps rising, h how
 *          high, belly the same downwards as a share of h, z how far the
 *          region lies above the plane of the ship - a number or z(x, y);
 *          `round` gives it the cross-section of a circle (a tube, a ball);
 *          scale(x, y) makes it thinner or thicker from place to place.
 *          A part replaces the hull where it lies; with `over` it sits on it.
 */
function relief(skin, ext, solid) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = DT;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const k = DT / (2 * ext);
  const parts = [];
  for (const p of solid?.parts || []) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, DT, DT);
    g.setTransform(k, 0, 0, k, DT / 2, DT / 2);
    g.fillStyle = '#fff';
    p.path(g); g.fill();
    const d = signedDist(g);
    if (d) parts.push({ ...p, d });
  }
  // The hull: the drawing without the parts that replace it
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, DT, DT);
  g.drawImage(skin, 0, 0, DT, DT);
  g.setTransform(k, 0, 0, k, DT / 2, DT / 2);
  g.globalCompositeOperation = 'destination-out';
  for (const p of parts) if (!p.over) { p.path(g); g.fill(); }
  g.globalCompositeOperation = 'source-over';
  const hull = signedDist(g);
  if (hull) parts.unshift({ ...solid?.hull, d: hull });

  const unit = 2 * ext / DT;     // one pixel of the measurement in ship units
  const n = GRID + 1, cell = 2 * ext / GRID;
  const top = new Float32Array(n * n).fill(-INF), bottom = new Float32Array(n * n).fill(INF);
  let lo = 0, hi = 0;
  for (const p of parts) {
    const R = p.r ?? RELIEF_R, H = p.h ?? RELIEF_H, belly = p.belly ?? BELLY;
    const zf = typeof p.z === 'function' ? p.z : null, z0 = zf ? 0 : p.z || 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = Math.min(DT - 1, Math.round(i / GRID * DT)), y = Math.min(DT - 1, Math.round(j / GRID * DT));
      // A round part is steep at its rim: there the shells have to meet a
      // little inside the outline, or a slit stays open between them.
      const d = p.d[y * DT + x] * unit - (p.round ? cell * 0.35 : 0);
      // `round`: the cross-section of a circle - a tube, a ball - instead of the softer swell
      const u = Math.min(1, d / R);
      let rise = d >= 0 ? H * (p.round ? Math.sqrt(u * (2 - u)) : Math.sin(Math.PI / 2 * u))
        : H * (p.round ? 3 : Math.PI / 2) * Math.max(d, -MARGIN) / R;
      const fall = 3 * Math.max(0, -d - MARGIN);
      const sx = -ext + i * cell, sy = -ext + j * cell;
      const z = zf ? zf(sx, sy) : z0;
      if (p.scale) rise *= Math.max(0.05, p.scale(sx, sy));
      const o = j * n + i;
      top[o] = Math.max(top[o], z + rise - fall);
      bottom[o] = Math.min(bottom[o], z - belly * rise + fall);
      if (d > 0) { lo = Math.min(lo, z); hi = Math.max(hi, z); }
    }
  }
  // Far from the hull the shells stay level, a little beyond where they
  // crossed: a glow that reaches past the outline (a shield) lies flat there.
  for (let o = 0; o < top.length; o++) {
    top[o] = Math.max(top[o], lo - 3);
    bottom[o] = Math.min(bottom[o], hi + 3);
  }
  return [top, bottom].map((h) => {
    soften(h, n);
    const data = new Float32Array(n * n * 5);
    const at = (i, j) => h[Math.min(GRID, Math.max(0, j)) * n + Math.min(GRID, Math.max(0, i))];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 5;
      data[o] = -ext + i * cell;
      data[o + 1] = ext - j * cell;          // the drawing's y points down, the model's up
      data[o + 2] = at(i, j);
      data[o + 3] = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
      data[o + 4] = -(at(i, j + 1) - at(i, j - 1)) / (2 * cell);
    }
    return data;
  });
}

function gridIndex() {
  const n = GRID + 1, idx = new Uint16Array(GRID * GRID * 6);
  let o = 0;
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  return idx;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(p, i).name; loc[name] = gl.getUniformLocation(p, name);
  }
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) {
    const name = gl.getActiveAttrib(p, i).name; loc[name] = gl.getAttribLocation(p, name);
  }
  return { p, loc };
}

function texture(gl, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}

/** How far a flame reaches behind its nozzle at most (see plume in kit.js). */
const flameLen = e => e.r * 4.3 * (e.len || 1);

/**
 * A stage for ships in three dimensions on a canvas of its own.
 * @param {HTMLCanvasElement} canvas
 * @param {{tex?: number, fx?: number, keep?: number}} [opt] resolution of the
 *   skin and of what moves, and how many models are kept ready - smaller for
 *   small pictures
 * @returns {{draw: (o: object) => boolean} | null} null where WebGL is missing
 */
export function shipStage3D(canvas, opt = {}) {
  const TEX = opt.tex || TEX_FULL, FX = opt.fx || FX_FULL, KEEP = opt.keep || KEEP_FULL;
  let gl = null, ok = true;
  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
  } catch { /* no WebGL here */ }
  if (!gl) return null;
  let reliefProg, sheetProg, glassProg;
  try {
    reliefProg = program(gl, RELIEF_VS, RELIEF_FS);
    sheetProg = program(gl, SHEET_VS, SHEET_FS);
    glassProg = program(gl, GLASS_VS, GLASS_FS);
  } catch {
    return null;
  }
  // A lost context (the tab was in the background for long, the driver gave
  // up) is not restored: the caller goes back to the flat drawing.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ok = false; });

  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const index = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gridIndex(), gl.STATIC_DRAW);
  const count = GRID * GRID * 6;

  const fx = [0, 1].map(() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = FX;
    const tex = texture(gl, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    return { cv, g: cv.getContext('2d'), tex };
  });
  const [flames, lamps] = fx;

  const models = new Map();

  function build(type, color, tech) {
    const prof = shipProfile(type, tech);
    const key = `${type}|${color}|${prof.key}`;
    const hit = models.get(key);
    if (hit) { models.delete(key); models.set(key, hit); return hit; }
    // The square the drawing sits in: the hull, and the flames behind it.
    let ext = prof.r + 6;
    for (const e of prof.engines) ext = Math.max(ext, Math.abs(e.x) + flameLen(e) + 2, Math.abs(e.y) + e.r * 2.6);
    const skin = document.createElement('canvas');
    skin.width = skin.height = TEX;
    const g = skin.getContext('2d');
    const k = TEX / (2 * ext);
    g.translate(TEX / 2, TEX / 2);
    g.scale(k, k);
    prof.body(g, color, k, { solid: true });

    const upload = (cv) => {
      const t = texture(gl, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      return t;
    };
    const tex = upload(skin);
    // A type whose underside is not its top seen from below draws it anew
    let texUnder = null;
    if (prof.solid?.under) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = TEX;
      const gu = cv.getContext('2d');
      gu.translate(TEX / 2, TEX / 2);
      gu.scale(k, k);
      prof.body(gu, color, k, { solid: true, under: true });
      texUnder = upload(cv);
    }
    // Vaults of glass (`solid.domes`: x, y, radius r, height h, standing at z)
    let glass = null, glassCount = 0;
    if (prof.solid?.domes?.length) {
      const data = domeMesh(prof.solid.domes);
      glass = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, glass);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      glassCount = data.length / 6;
    }
    // Upper and lower shell
    const mesh = relief(skin, ext, prof.solid).map((data) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buf;
    });

    // Sheets for the flames: behind every nozzle one lying in the plane of
    // the ship and one standing upright in it - so a flame keeps its body
    // from every side. Every flame is drawn alone into a band of its own
    // (see animate), so no sheet shows a slice of its neighbour; `z` lifts
    // a nozzle that sits above the plane.
    const quads = [];
    const quad = (pts) => { for (const i of [0, 1, 2, 2, 1, 3]) quads.push(...pts[i]); };
    const bands = prof.engines.map((e, i) => {
      const w = e.r * 2.6, x0 = e.x - flameLen(e), x1 = e.x + w;
      const v0 = i / prof.engines.length, v1 = (i + 1) / prof.engines.length;
      const z = e.z || 0;
      quad([[x0, -e.y + w, z, 0, v0], [x1, -e.y + w, z, 1, v0], [x0, -e.y - w, z, 0, v1], [x1, -e.y - w, z, 1, v1]]);
      quad([[x0, -e.y, z + w, 0, v0], [x1, -e.y, z + w, 1, v0], [x0, -e.y, z - w, 0, v1], [x1, -e.y, z - w, 1, v1]]);
      return { x0, x1, w };
    });
    const sheets = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sheets);

    const sheetCount = quads.length / 5;
    // Blades: thin parts standing upright on the hull (`solid.blades`) - a
    // tail fin. From (x0, y) at the front of its foot to (x1, y1) at the
    // back, from height z up by h, the top leaning sideways by `lean`.
    const blades = (prof.solid?.blades || []).map((b) => {
      const y1 = b.y1 ?? b.y, lean = b.lean || 0;
      const foot = [[b.x0, -b.y, b.z], [b.x1, -y1, b.z]];
      const head = foot.map(([x, y, z]) => [x, y - lean, z + b.h]);
      const first = quads.length / 5;
      quad([[...head[0], 0, 0], [...head[1], 1, 0], [...foot[0], 0, 1], [...foot[1], 1, 1]]);
      // Its normal, for the light: across the foot and the rise
      const u = [b.x1 - b.x0, b.y - y1, 0], v = [0, -lean, b.h];
      const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(...nrm) || 1;
      return { first, normal: nrm.map(c => c / len) };
    });
    let bladeTex = null;
    if (blades.length) {
      const cv = document.createElement('canvas');
      cv.width = BLADE_W; cv.height = BLADE_H;
      bladeSkin(cv.getContext('2d'), color);
      bladeTex = texture(gl, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, sheets);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quads), gl.STATIC_DRAW);
    const m = { prof, ext, bands, tex, texUnder, mesh, sheets, sheetCount, blades, bladeTex, glass, glassCount };
    models.set(key, m);
    if (models.size > KEEP) {
      const [old, gone] = models.entries().next().value;
      models.delete(old);
      gl.deleteTexture(gone.tex); gone.mesh.forEach(b => gl.deleteBuffer(b)); gl.deleteBuffer(gone.sheets);
      if (gone.bladeTex) gl.deleteTexture(gone.bladeTex);
      if (gone.texUnder) gl.deleteTexture(gone.texUnder);
      if (gone.glass) gl.deleteBuffer(gone.glass);
    }
    return m;
  }

  /** Draws what moves into its two layers and hands them to the graphics card. */
  function animate(m, t) {
    const k = FX / (2 * m.ext);
    for (const layer of fx) {
      layer.g.setTransform(1, 0, 0, 1, 0, 0);
      layer.g.clearRect(0, 0, FX, FX);
      layer.g.setTransform(k, 0, 0, k, FX / 2, FX / 2);
    }
    // Every flame in its own band: from the tip of the flame to past the nozzle
    const bandH = FX / (m.bands.length || 1);
    m.prof.engines.forEach((e, i) => {
      const b = m.bands[i], g = flames.g;
      const ax = FX / (b.x1 - b.x0), ay = bandH / (2 * b.w);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.beginPath(); g.rect(0, i * bandH, FX, bandH); g.clip();
      g.setTransform(ax, 0, 0, ay, -b.x0 * ax, i * bandH + bandH / 2 - e.y * ay);
      plume(g, e.x, e.y, e.r, e.color, t, i * 1.7, e.len);
      g.restore();
    });
    for (const l of m.prof.lights) light(lamps.g, l.x, l.y, l.r, l.color, t, l.off, l.strobe);
    m.prof.anim?.(lamps.g, t);
    for (const layer of fx) {
      gl.bindTexture(gl.TEXTURE_2D, layer.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, layer.cv);
    }
  }

  /**
   * @param {{type:string,color?:string,tech?:object,phase?:number,yaw?:number,tilt?:number,fill?:number}} o
   *   yaw   turned around its vertical axis; 0 = the bow points up the screen
   *   tilt  how far the view has come down from straight above
   *   fill  size on the stage, 1 = the hull's circle touches the edge
   * @returns {boolean} false once the context is lost - nothing was drawn
   */
  function draw(o) {
    if (!ok || gl.isContextLost()) return false;
    const m = build(o.type, o.color || '#9fb0c8', o.tech);
    const t = o.phase || 0;
    animate(m, t);

    // Turn around the vertical axis, then tip the far side away.
    const a = (o.yaw || 0) + Math.PI / 2, b = -(o.tilt || 0);
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    // Rx(b) * Rz(a), column by column
    const rot = [ca, cb * sa, sb * sa, -sa, cb * ca, sb * ca, 0, -sb, cb];
    const f = 1 / Math.tan(FOV / 2);
    const half = m.prof.r / (o.fill || 1);
    const dist = half * f, depth = m.ext * 1.6;
    const cam = [f, dist, Math.max(1, dist - depth), dist + depth];

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0);

    const sheetsOn = () => {
      const S = sheetProg.loc;
      gl.useProgram(sheetProg.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.sheets);
      gl.enableVertexAttribArray(S.aP);
      gl.enableVertexAttribArray(S.aUv);
      gl.vertexAttribPointer(S.aP, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(S.aUv, 2, gl.FLOAT, false, 20, 12);
      gl.uniformMatrix3fv(S.uRot, false, rot);
      gl.uniform4fv(S.uCam, cam);
      gl.uniform1i(S.uTex, 0);
      return S;
    };
    const sheetsOff = (S) => { gl.disableVertexAttribArray(S.aP); gl.disableVertexAttribArray(S.aUv); };

    // Fins: opaque, lit from whichever side the light falls on
    if (m.blades.length) {
      const S = sheetsOn();
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, m.bladeTex);
      for (const b of m.blades) {
        const [nx, ny, nz] = b.normal;
        const n = [rot[0] * nx + rot[3] * ny + rot[6] * nz, rot[1] * nx + rot[4] * ny + rot[7] * nz, rot[2] * nx + rot[5] * ny + rot[8] * nz];
        gl.uniform1f(S.uSolid, 0.5 + 0.7 * Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]));
        gl.drawArrays(gl.TRIANGLES, b.first, 6);
      }
      sheetsOff(S);
    }

    // The hull: upper and lower shell
    let L = reliefProg.loc;
    gl.useProgram(reliefProg.p);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.enableVertexAttribArray(L.aPos);
    gl.enableVertexAttribArray(L.aRelief);
    const shell = (upper) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.mesh[upper ? 0 : 1]);
      gl.vertexAttribPointer(L.aPos, 2, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(L.aRelief, 3, gl.FLOAT, false, 20, 8);
      gl.uniform1f(L.uSide, upper ? 1 : -1);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    };
    gl.uniformMatrix3fv(L.uRot, false, rot);
    gl.uniform4fv(L.uCam, cam);
    gl.uniform1f(L.uExt, m.ext);
    gl.uniform1i(L.uTex, 0);
    gl.uniform1f(L.uMode, 0);
    gl.bindTexture(gl.TEXTURE_2D, m.tex);
    gl.disable(gl.BLEND);
    gl.uniform1f(L.uShade, 1);
    shell(true);
    gl.uniform1f(L.uShade, 0.62);
    if (m.texUnder) gl.bindTexture(gl.TEXTURE_2D, m.texUnder);
    shell(false);

    gl.enable(gl.BLEND);
    gl.depthMask(false);
    // Glass: over the hull, behind the lights
    if (m.glass) {
      const G = glassProg.loc;
      gl.disableVertexAttribArray(L.aPos);
      gl.disableVertexAttribArray(L.aRelief);
      gl.useProgram(glassProg.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.glass);
      gl.enableVertexAttribArray(G.aP);
      gl.enableVertexAttribArray(G.aN);
      gl.vertexAttribPointer(G.aP, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(G.aN, 3, gl.FLOAT, false, 24, 12);
      gl.uniformMatrix3fv(G.uRot, false, rot);
      gl.uniform4fv(G.uCam, cam);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, m.glassCount);
      gl.disableVertexAttribArray(G.aP);
      gl.disableVertexAttribArray(G.aN);
      gl.useProgram(reliefProg.p);
      gl.enableVertexAttribArray(L.aPos);
      gl.enableVertexAttribArray(L.aRelief);
    }

    // The lights lie on the shell that faces the viewer
    if (m.prof.lights.length || m.prof.anim) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(L.uMode, 1);
      gl.bindTexture(gl.TEXTURE_2D, lamps.tex);
      shell(cb >= 0);
    }
    gl.disableVertexAttribArray(L.aPos);
    gl.disableVertexAttribArray(L.aRelief);

    // The flames glow on top of whatever is behind them
    if (m.prof.engines.length) {
      const S = sheetsOn();
      gl.uniform1f(S.uSolid, 0);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindTexture(gl.TEXTURE_2D, flames.tex);
      gl.drawArrays(gl.TRIANGLES, 0, m.sheetCount);
      sheetsOff(S);
    }
    gl.depthMask(true);
    return true;
  }

  return { draw };
}
