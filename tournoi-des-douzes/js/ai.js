// IA de placement. Pas de règles écrites à la main : elle essaie les six
// répartitions possibles de sa main sur ses trois places, simule chacune contre
// des mains adverses tirées au sort parmi les cartes que les adversaires
// peuvent encore avoir, et garde la meilleure espérance de trophées.

import { resolveRound } from './rules.js';
import { CARD_NUMBERS } from './cards.js';

const SLOTS = ['left', 'arena', 'right'];

/** Nombre de tirages par répartition testée. */
const SAMPLES = { random: 0, easy: 3, normal: 14, hard: 40 };

// Valeur stratégique d'une carte qu'on garderait pour les manches suivantes.
// La carte posée dans l'arène part à la défausse : la perdre tôt coûte cher
// quand elle est forte, presque rien quand elle est quelconque.
const KEEP = {
  1: 0.85,  // David : trois trophées, et il tue Goliath
  2: 1.00,  // Le Père Pair bat une carte sur deux
  3: 0.70,  // Laurent : +4 sur les deux champs
  4: 0.30,
  5: 0.45,
  6: 0.30,
  7: 0.40,
  8: 0.35,
  9: 0.60,  // Tracassin : un trophée quasi garanti
  10: 0.45,
  11: 0.25, // Quasi-Maximus dépend de l'arène
  12: 0.55,
};
const KEEP_WEIGHT = 0.30;

/**
 * @param {import('./engine.js').Engine} engine
 * @param {number} me  siège
 * @param {() => number} rand
 * @returns {{left:Card, arena:Card, right:Card}}
 */
export function chooseMove(engine, me, rand = Math.random) {
  const hand = engine.seats[me].hand;
  if (hand.length < 3) throw new Error(`main de ${hand.length} carte(s), il en faut trois`);

  const level = engine.seats[me].level || 'normal';
  const samples = SAMPLES[level] ?? SAMPLES.normal;
  const options = arrangements(hand.slice(0, 3));

  if (!samples) return options[Math.floor(rand() * options.length)];

  const discards = engine.seats.map(s => s.discard);
  const pools = engine.seats.map((s, i) => (i === me ? null : unseen(s)));
  const names = engine.seats.map(s => s.name);
  const seatsView = discards.map((discard, i) => ({ name: names[i], discard }));

  let best = options[0], bestScore = -Infinity;
  for (const move of options) {
    let total = 0;
    for (let k = 0; k < samples; k++) {
      const placements = engine.seats.map((s, i) =>
        i === me ? move : randomPlacement(pools[i], rand));
      const r = resolveRound(seatsView, placements, { quiet: true });
      total += r.trophies[me];
    }
    // Espérance de trophées, moins le prix de la carte sacrifiée à l'arène.
    const score = total / samples - KEEP_WEIGHT * (KEEP[move.arena.n] ?? 0.4);
    if (score > bestScore) { bestScore = score; best = move; }
  }
  return best;
}

/** Les six façons de répartir trois cartes sur gauche / arène / droite. */
function arrangements([a, b, c]) {
  return [
    { left: a, arena: b, right: c },
    { left: a, arena: c, right: b },
    { left: b, arena: a, right: c },
    { left: b, arena: c, right: a },
    { left: c, arena: a, right: b },
    { left: c, arena: b, right: a },
  ];
}

/**
 * Ce qu'un adversaire peut encore avoir en main ou en pioche : son paquet de
 * douze moins sa défausse, publique puisque chaque carte d'arène est révélée.
 * (Les échanges d'Aliénor peuvent fausser légèrement cette estimation ; ce
 * n'est qu'un modèle d'adversaire, pas une information à laquelle l'IA triche.)
 */
function unseen(seat) {
  const left = new Set(CARD_NUMBERS);
  for (const n of seat.discard) left.delete(n);
  const pool = [...left];
  return pool.length >= 3 ? pool : CARD_NUMBERS.slice();
}

let fakeId = 0;
function randomPlacement(pool, rand) {
  // Trois cartes distinctes tirées du réservoir, réparties au hasard.
  const p = pool.slice();
  const out = [];
  for (let i = 0; i < 3; i++) out.push(p.splice(Math.floor(rand() * p.length), 1)[0]);
  return {
    left: { iid: 's' + fakeId++, n: out[0] },
    arena: { iid: 's' + fakeId++, n: out[1] },
    right: { iid: 's' + fakeId++, n: out[2] },
  };
}
