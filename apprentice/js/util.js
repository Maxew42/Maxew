// Petites fonctions partagées.

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;

// plus courte distance angulaire signée a→b
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// RNG déterministe (même seed → mêmes vagues chez tous les joueurs)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmtTime(s) {
  if (s == null || !isFinite(s)) return '—';
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(0).padStart(2, '0')}`;
}

export const isTouchDevice = () =>
  (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches);

// directions de combat (attaque / parade)
export const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
export const DIR_NAMES = ['haut', 'droite', 'bas', 'gauche'];
