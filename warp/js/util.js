export const TAU = Math.PI * 2;
export const CELL = 28;

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function angleTo(from, to) {
  return wrapAngle(to - from);
}

export function dist2(a, b, c, d) {
  const dx = a - c;
  const dy = b - d;
  return dx * dx + dy * dy;
}

export function dist(a, b, c, d) {
  return Math.hypot(a - c, b - d);
}

export function randRange(rng, min, max) {
  return min + (max - min) * rng();
}

export function makeRng(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ x >>> 15, x | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function localToWorld(ship, lx, ly) {
  const c = Math.cos(ship.angle);
  const s = Math.sin(ship.angle);
  return {
    x: ship.x + lx * c - ly * s,
    y: ship.y + lx * s + ly * c,
  };
}

export function worldToLocal(ship, wx, wy) {
  const dx = wx - ship.x;
  const dy = wy - ship.y;
  const c = Math.cos(-ship.angle);
  const s = Math.sin(-ship.angle);
  return {
    x: dx * c - dy * s,
    y: dx * s + dy * c,
  };
}

export function segmentPointDistance(ax, ay, bx, by, px, py) {
  const abx = bx - ax;
  const aby = by - ay;
  const len = abx * abx + aby * aby || 1;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / len, 0, 1);
  const x = ax + abx * t;
  const y = ay + aby * t;
  return Math.hypot(px - x, py - y);
}

export function lineIntersectsCircle(ax, ay, bx, by, cx, cy, radius) {
  return segmentPointDistance(ax, ay, bx, by, cx, cy) <= radius;
}

export function formatRoomCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}

export function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
