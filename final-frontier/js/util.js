// Small shared helpers: maths, formatting, vectors.

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

// Wrap an angle to (-PI, PI].
export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}

// Format an altitude/length in metres to a friendly string.
export function fmtDist(m) {
  const a = Math.abs(m);
  if (a >= 1000000) return (m / 1000000).toFixed(a >= 10000000 ? 0 : 2) + ' Mm';
  if (a >= 10000) return (m / 1000).toFixed(1) + ' km';
  if (a >= 1000) return (m / 1000).toFixed(2) + ' km';
  return Math.round(m) + ' m';
}

// Speed in m/s (compact).
export function fmtSpeed(v) {
  if (Math.abs(v) >= 10000) return (v / 1000).toFixed(2) + ' km/s';
  return Math.round(v) + ' m/s';
}

// Mass in kg -> kg / t.
export function fmtMass(kg) {
  if (kg >= 1000) return (kg / 1000).toFixed(kg >= 10000 ? 0 : 1) + ' t';
  return Math.round(kg) + ' kg';
}

// Delta-v is just a speed but we like the label.
export const fmtDv = v => Math.round(v) + ' m/s';

export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return sec + 's';
  return m + 'm ' + String(sec).padStart(2, '0') + 's';
}

export function fmtXp(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

// vector helpers on {x,y}
export const vlen = v => Math.hypot(v.x, v.y);
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const vdot = (a, b) => a.x * b.x + a.y * b.y;
// 2D "cross product" scalar (z component).
export const vcross = (a, b) => a.x * b.y - a.y * b.x;

// A rounded-rect path helper for canvas.
export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Deterministic pseudo-random for star fields etc. (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
