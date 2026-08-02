// Résolution d'une manche. Module pur : mêmes entrées → mêmes sorties, aucune
// dépendance au DOM. C'est ce qui permet à l'hôte multijoueur de calculer la
// manche puis de diffuser la liste d'évènements que tout le monde rejoue à
// l'identique, et à l'IA de simuler des milliers de coups.
//
// ── Sièges et champs de joute ────────────────────────────────────────────────
// N joueurs assis en cercle. Le voisin de droite du siège i est (i+1) % N.
// Le champ de joute f oppose la carte « droite » du siège f à la carte
// « gauche » du siège f+1. Il y a donc autant de champs que de joueurs — et à
// deux joueurs, les deux adversaires s'affrontent bien sur deux champs.
//
// ── Deux écarts assumés avec la feuille de règles imprimée ───────────────────
// 1. Gontran (6) : la feuille le résout « après le combat » (ancienne version
//    où il s'échangeait avec une carte de la défausse). La carte imprimée en
//    fait un modificateur de force, donc il est résolu avant le combat.
// 2. Tracassin (9) : la feuille lui fait lancer un dé et ajouter le résultat.
//    La carte imprimée lui fait rapporter un trophée en cas de défaite — c'est
//    la version retenue, et les deux dés ne servent plus à rien.
//
// ── Arbitrages (la règle « aucun effet dans l'arène » précisée) ──────────────
// Les effets qui modifient le *combat* (force, échange, victoire automatique)
// ne s'appliquent que depuis un champ de joute. Ceux qui ne touchent qu'au
// *décompte des trophées* — David (1), Tracassin (9), Quasi-Maximus (11) —
// s'appliquent partout, arène comprise : c'est ce que dit leur texte, et c'est
// pourquoi David figure dans les exceptions de la règle. Henriette (4), qui
// renverse le combat d'arène, est l'autre exception explicite.

import { label } from './cards.js';

export const SIDES = ['left', 'right'];
const SIDE_FR = { left: 'gauche', right: 'droite', arena: 'arène' };

/** Voisin de gauche / de droite d'un siège. */
export const leftOf = (i, n) => (i - 1 + n) % n;
export const rightOf = (i, n) => (i + 1) % n;

/** Le champ de joute qui borde le siège i du côté demandé. */
export const fieldOf = (i, side, n) => (side === 'right' ? i : leftOf(i, n));

/** Les deux places d'un champ de joute : {seat, side} × 2. */
export const fieldSeats = (f, n) => [
  { seat: f, side: 'right' },
  { seat: rightOf(f, n), side: 'left' },
];

/**
 * @param {Array<{name?:string, discard:number[]}>} seats  discard[0] = dessus
 * @param {Array<{arena:Card, left:Card, right:Card}>} placements
 * @param {{quiet?:boolean}} [opts]  quiet : pas de récit (chemin rapide de l'IA)
 */
export function resolveRound(seats, placements, opts = {}) {
  const quiet = !!opts.quiet;
  const n = seats.length;
  const who = i => seats[i].name || `Joueur ${i + 1}`;

  const slot = (seat, side, card) => ({
    seat, side, card, base: card.n, force: card.n, movedByRosalie: false,
  });
  const board = placements.map((p, i) => ({
    arena: slot(i, 'arena', p.arena),
    left: slot(i, 'left', p.left),
    right: slot(i, 'right', p.right),
  }));
  const played = placements.map(p => [p.arena.n, p.left.n, p.right.n]);

  const events = [];
  // Le texte arrive sous forme de fonction : en mode silencieux on ne le
  // construit jamais, ce qui rend les simulations de l'IA bon marché.
  const ev = quiet
    ? () => {}
    : (k, text, extra) => { events.push({ k, text: text(), ...extra }); };
  const at = (seat, side) => ({ seat, side });
  const snap = (...slots) => slots.map(s => ({ seat: s.seat, side: s.side, force: s.force }));

  /** Le combattant qui fait face à {seat, side}. */
  const facing = (seat, side) =>
    side === 'left' ? board[leftOf(seat, n)].right : board[rightOf(seat, n)].left;

  ev('reveal', () => 'Les cartes sont révélées.', {});

  // ── Rosalie (5) — avant tout autre effet ─────────────────────────────────
  // Les déclencheurs sont relevés sur le placement initial : une Rosalie
  // amenée sur un champ de joute par une autre Rosalie n'agit pas. Et la
  // victime résout d'abord la Rosalie de sa gauche, puis celle de sa droite.
  const triggers = [];
  for (let v = 0; v < n; v++) {
    for (const side of SIDES) {
      const opp = facing(v, side);
      if (opp.base === 5) triggers.push({ victim: v, side, from: at(opp.seat, opp.side) });
    }
  }
  triggers.sort((a, b) => a.victim - b.victim || (a.side === 'left' ? -1 : 1));
  for (const t of triggers) {
    const src = board[t.from.seat][t.from.side];
    // Rosalie a-t-elle quitté son champ entre-temps (emportée dans l'arène) ?
    if (src.base !== 5 || src.movedByRosalie) continue;
    const field = board[t.victim][t.side];
    const arena = board[t.victim].arena;
    const wasField = field.card.n, wasArena = arena.card.n;
    swapContents(field, arena);
    field.movedByRosalie = arena.movedByRosalie = true;
    ev('rosalie', () =>
      `${label(5)} de ${who(t.from.seat)} fait danser ${who(t.victim)} : ${label(wasArena)} `
      + `quitte l'arène pour le champ de ${SIDE_FR[t.side]}, ${label(wasField)} y prend sa place.`,
    { seat: t.from.seat, focus: [at(t.victim, t.side), at(t.victim, 'arena')],
      swap: [at(t.victim, t.side), at(t.victim, 'arena')] });
  }

  // ── Gontran (6) : sa force devient le dessus de SA défausse ──────────────
  for (let s = 0; s < n; s++) {
    for (const side of SIDES) {
      const me = board[s][side];
      if (me.base !== 6) continue;
      const top = seats[s].discard[0];
      if (top == null) {
        ev('force', () => `${label(6)} de ${who(s)} n'a pas encore de défausse : sa force reste ${me.force}.`,
          { seat: s, focus: [at(s, side)] });
        continue;
      }
      const from = me.force;
      me.force = top;
      ev('force', () => `${label(6)} de ${who(s)} puise dans sa défausse : force ${from} → ${top}.`,
        { seat: s, focus: [at(s, side)], by: 6, forces: snap(me) });
    }
  }

  // ── Morgane (7) : la force de l'adversaire devient le dessus de SA défausse ─
  for (let s = 0; s < n; s++) {
    for (const side of SIDES) {
      const me = board[s][side];
      if (me.base !== 7) continue;
      const foe = facing(s, side);
      const top = seats[foe.seat].discard[0];
      if (top == null) {
        ev('force', () => `${label(7)} de ${who(s)} vise ${who(foe.seat)}, qui n'a pas de défausse : rien ne se passe.`,
          { seat: s, focus: [at(s, side), at(foe.seat, foe.side)] });
        continue;
      }
      const from = foe.force, fb = foe.base;
      foe.force = top;
      ev('force', () => `${label(7)} de ${who(s)} ensorcelle ${label(fb)} de ${who(foe.seat)} : force ${from} → ${top}.`,
        { seat: s, focus: [at(s, side), at(foe.seat, foe.side)], by: 7, forces: snap(foe) });
    }
  }

  // ── Jeanne (10) : +3 contre une base ≥ 10, sinon −3 ──────────────────────
  for (let s = 0; s < n; s++) {
    for (const side of SIDES) {
      const me = board[s][side];
      if (me.base !== 10) continue;
      const foe = facing(s, side);
      const d = foe.base >= 10 ? 3 : -3;
      const from = me.force, fb = foe.base, to = from + d;
      me.force = to;
      ev('force', () =>
        `${label(10)} de ${who(s)} affronte ${label(fb)} : ${d > 0 ? '+3' : '−3'}, force ${from} → ${to}.`,
      { seat: s, focus: [at(s, side)], by: 10, forces: snap(me) });
    }
  }

  // ── Laurent (3) : +4 à vos deux combattants de joute, lui compris ────────
  for (let s = 0; s < n; s++) {
    const count = SIDES.filter(side => board[s][side].base === 3).length;
    if (!count) continue;
    const bonus = 4 * count;
    for (const side of SIDES) board[s][side].force += bonus;
    ev('force', () => `${label(3)} entraîne les troupes de ${who(s)} : +${bonus} sur les deux champs de joute.`,
      { seat: s, focus: SIDES.map(side => at(s, side)), by: 3, forces: snap(board[s].left, board[s].right) });
  }

  // ── Combats de joute ─────────────────────────────────────────────────────
  const jousts = [];
  for (let f = 0; f < n; f++) {
    const [pa, pb] = fieldSeats(f, n);
    const a = board[pa.seat][pa.side], b = board[pb.seat][pb.side];
    const { winner, reason } = duel(a, b);
    jousts.push({ field: f, a: pa, b: pb, winner, reason });
    const win = winner === null ? null : (winner === 'a' ? pa : pb);
    const lose = winner === null ? null : (winner === 'a' ? pb : pa);
    ev('joust', () => {
      const verdict = winner === null ? 'égalité, aucun trophée' : `${who(win.seat)} l'emporte`;
      return `Joute ${who(a.seat)} ⚔ ${who(b.seat)} — ${label(a.base)} ${fmt(a)} contre `
        + `${label(b.base)} ${fmt(b)} : ${verdict}${reason ? ` (${reason})` : ''}.`;
    }, { field: f, winner, reason, win, lose, focus: [pa, pb] });
  }

  // ── Combat d'arène — aucun effet, sauf Henriette (4) ─────────────────────
  const arena = board.map(b => b.arena);
  const henriette = arena.some(s => s.base === 4);
  const forces = arena.map(s => s.force);
  const target = henriette ? Math.min(...forces) : Math.max(...forces);
  const arenaWinners = arena.filter(s => s.force === target).map(s => s.seat);
  ev('arena', () => henriette
    ? `Arène — ${label(4)} renverse tout : la plus faible force (${target}) l'emporte, pour ${arenaWinners.map(who).join(' et ')}.`
    : `Arène — la plus forte carte (${target}) l'emporte : ${arenaWinners.map(who).join(' et ')}.`,
  { henriette, target, winners: arenaWinners, focus: arena.map(s => at(s.seat, 'arena')) });

  // ── Trophées ─────────────────────────────────────────────────────────────
  const trophies = new Array(n).fill(0);
  for (let s = 0; s < n; s++) {
    const wonArena = arenaWinners.includes(s);
    const combats = [{ side: 'arena', outcome: wonArena ? 'win' : 'lose' }];
    for (const side of SIDES) {
      const j = jousts[fieldOf(s, side, n)];
      if (j.winner === null) combats.push({ side, outcome: 'tie' });
      else {
        const w = j.winner === 'a' ? j.a : j.b;
        combats.push({ side, outcome: w.seat === s && w.side === side ? 'win' : 'lose' });
      }
    }
    for (const c of combats) {
      const card = board[s][c.side];
      const { amount, why } = payout(card.base, c.outcome, wonArena);
      if (amount > 0) trophies[s] += amount;
      if (amount > 0 || why) {
        const cb = card.base;
        ev('trophy', () => amount > 0
          ? `${who(s)} — ${SIDE_FR[c.side]} : ${label(cb)} rapporte ${amount} trophée${amount > 1 ? 's' : ''}${why ? ` (${why})` : ''}.`
          : `${who(s)} — ${SIDE_FR[c.side]} : ${label(cb)} ne rapporte rien (${why}).`,
        { seat: s, side: c.side, amount, focus: [at(s, c.side)] });
      }
    }
  }

  // ── Aliénor (8) — après le combat, en dernier ────────────────────────────
  for (let f = 0; f < n; f++) {
    const [pa, pb] = fieldSeats(f, n);
    const a = board[pa.seat][pa.side], b = board[pb.seat][pb.side];
    if (a.base !== 8 && b.base !== 8) continue;
    const mutual = a.base === 8 && b.base === 8;
    const na = a.card.n, nb = b.card.n;
    swapContents(a, b);
    ev('alienor', () => mutual
      ? `${label(8)} contre ${label(8)} : ${who(a.seat)} et ${who(b.seat)} échangent leurs volages.`
      : `${label(8)} passe à l'ennemi : ${who(a.seat)} récupère ${label(nb)}, ${who(b.seat)} récupère ${label(na)}.`,
    { field: f, focus: [pa, pb], swap: [pa, pb] });
  }

  // ── Fin de manche : arène → défausse, jouteurs → main ────────────────────
  return {
    board, events, trophies, arenaWinners, jousts, played,
    toDiscard: board.map(b => b.arena.card),
    handBack: board.map(b => [b.left.card, b.right.card]),
  };
}

/** « force 7 » ou « force 7 (base 3) » quand un effet est passé par là. */
const fmt = s => (s.force === s.base ? `force ${s.force}` : `force ${s.force} (base ${s.base})`);

function swapContents(x, y) {
  for (const k of ['card', 'base', 'force', 'movedByRosalie']) {
    const t = x[k]; x[k] = y[k]; y[k] = t;
  }
}

/**
 * Vainqueur d'un champ de joute.
 * Le Père Pair passe avant Goliath : face à deux forces paires, sa règle tranche.
 */
function duel(a, b) {
  if (a.base === 2 && b.base === 2) return { winner: null, reason: 'deux Pères Pairs, nul quoi qu\'il arrive' };
  if (a.base === 2 && b.base % 2 === 0) return { winner: 'a', reason: 'le Père Pair bat les forces de base paires' };
  if (b.base === 2 && a.base % 2 === 0) return { winner: 'b', reason: 'le Père Pair bat les forces de base paires' };
  if (a.base === 12 && b.base === 1) return { winner: 'b', reason: 'Goliath perd contre David' };
  if (b.base === 12 && a.base === 1) return { winner: 'a', reason: 'Goliath perd contre David' };
  if (a.force === b.force) return { winner: null, reason: '' };
  return { winner: a.force > b.force ? 'a' : 'b', reason: '' };
}

/** Trophées rapportés par une carte selon l'issue de son combat. */
function payout(n, outcome, wonArena) {
  let amount = outcome === 'win' ? 1 : 0;
  let why = '';
  if (n === 1 && outcome === 'win') { amount = 3; why = 'David triomphe'; }
  if (n === 9) {
    amount = outcome === 'lose' ? 1 : 0;
    // Une égalité n'est ni une victoire ni une défaite : Tracassin repart
    // bredouille, et le compte rendu de la joute l'a déjà dit.
    why = outcome === 'lose' ? 'Tracassin adore perdre'
      : outcome === 'win' ? 'Tracassin ne gagne rien en gagnant' : '';
  }
  if (n === 11 && !wonArena && amount > 0) {
    amount = 0;
    why = "Quasi-Maximus n'a pas remporté l'arène";
  }
  return { amount, why };
}

/** Classement final : trophées, puis la plus faible force de base jouée en dernier. */
export function rankPlayers(seats) {
  return seats
    .map((s, i) => ({
      seat: i,
      trophies: s.trophies,
      tiebreak: (s.lastPlayed || []).reduce((a, b) => a + b, 0),
    }))
    .sort((x, y) => y.trophies - x.trophies || x.tiebreak - y.tiebreak);
}
