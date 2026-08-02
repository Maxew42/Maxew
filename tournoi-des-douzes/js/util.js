// Petits outils partagés.

/** PRNG déterministe (mulberry32) : mêmes graines → mêmes paquets partout. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates en place. */
export function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const pick = (arr, rand = Math.random) => arr[Math.floor(rand() * arr.length)];

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Code de salon lisible, sans caractères ambigus. */
export function roomCode(rand = Math.random) {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alpha[Math.floor(rand() * alpha.length)];
  return s;
}

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];

/** « 1 trophée » / « 3 trophées » */
export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Noms courts : les plaques de joueur sont étroites et on ne veut pas d'ellipse.
export const NAMES = [
  'Béatrice', 'Cédric', 'Ysolde', 'Godefroy', 'Alix',
  'Thibault', 'Mahaut', 'Renaud', 'Berthe', 'Foulques',
];
