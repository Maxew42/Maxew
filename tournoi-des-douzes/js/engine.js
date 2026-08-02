// État de la partie et cycle des manches. Autoritaire : en solo il tourne dans
// l'onglet du joueur, en multijoueur uniquement chez l'hôte, qui diffuse des
// « vues » (ce que chaque joueur a le droit de savoir) et le compte rendu des
// manches.

import { CARD_NUMBERS } from './cards.js';
import { resolveRound, rankPlayers, leftOf, rightOf } from './rules.js';
import { rng, shuffle } from './util.js';

export const MAX_ROUNDS = 10;
export const HAND_SIZE = 3;
export const SLOTS = ['left', 'arena', 'right'];

export class Engine {
  /**
   * @param {Array<{id:string, name:string, kind:'human'|'ai'|'remote', level?:string}>} players
   * @param {number} seed
   */
  constructor(players, seed = (Math.random() * 2 ** 31) | 0) {
    const rand = rng(seed);
    this.seed = seed;
    this.round = 1;
    this.phase = 'place'; // place → resolve → (place | over)
    this.seats = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      level: p.level || 'normal',
      // Chaque joueur mélange son propre paquet de douze, puis pioche trois cartes.
      deck: shuffle(CARD_NUMBERS.map(n => ({ iid: `${i}·${n}`, n })), rand),
      hand: [],
      discard: [],          // discard[0] = dessus, face visible
      trophies: 0,
      lastPlayed: [],
      placed: null,         // {left, arena, right} — cartes sorties de la main
      confirmed: false,     // le joueur a validé son placement
    }));
    for (const s of this.seats) s.hand = s.deck.splice(0, HAND_SIZE);
  }

  get n() { return this.seats.length; }
  get over() { return this.phase === 'over'; }

  neighbours(i) { return { left: leftOf(i, this.n), right: rightOf(i, this.n) }; }

  // ── Placement ─────────────────────────────────────────────────────────────

  /** Le joueur peut-il encore réarranger ? */
  editable(seat) { return this.phase === 'place' && !this.seats[seat].confirmed; }

  /** Pose une carte de la main sur une place. Renvoie false si le coup est invalide. */
  put(seat, slot, iid) {
    if (!this.editable(seat) || !SLOTS.includes(slot)) return false;
    const s = this.seats[seat];
    const from = s.hand.findIndex(c => c.iid === iid);
    if (from < 0) return false;
    s.placed = s.placed || { left: null, arena: null, right: null };
    if (s.placed[slot]) s.hand.push(s.placed[slot]);   // la place était occupée
    s.placed[slot] = s.hand.splice(from, 1)[0];
    return true;
  }

  /** Reprend en main la carte posée sur une place. */
  take(seat, slot) {
    if (!this.editable(seat)) return false;
    const s = this.seats[seat];
    if (!s.placed || !s.placed[slot]) return false;
    s.hand.push(s.placed[slot]);
    s.placed[slot] = null;
    return true;
  }

  /** Déplace une carte d'une place à l'autre, en échangeant si la cible est prise. */
  move(seat, from, to) {
    if (!this.editable(seat) || !SLOTS.includes(from) || !SLOTS.includes(to) || from === to) return false;
    const s = this.seats[seat];
    if (!s.placed || !s.placed[from]) return false;
    [s.placed[from], s.placed[to]] = [s.placed[to], s.placed[from]];
    return true;
  }

  /** Trois cartes posées ? */
  filled(seat) {
    const p = this.seats[seat].placed;
    return !!(p && p.left && p.arena && p.right);
  }

  /** Valide le placement — irréversible pour la manche. */
  confirm(seat) {
    if (!this.editable(seat) || !this.filled(seat)) return false;
    this.seats[seat].confirmed = true;
    return true;
  }

  ready(seat) { return this.seats[seat].confirmed; }

  allReady() { return this.seats.every(s => s.confirmed); }

  // ── Manche ────────────────────────────────────────────────────────────────

  /**
   * Résout la manche courante et avance l'état.
   * @returns {{events, placements, trophies, deltas, board, round, gameOver, ranking}}
   */
  resolve() {
    if (this.phase !== 'place' || !this.allReady()) return null;

    const placements = this.seats.map(s => ({ ...s.placed }));
    const r = resolveRound(
      this.seats.map(s => ({ name: s.name, discard: s.discard })),
      placements,
    );

    // Trophées, puis nettoyage : l'arène part sur la défausse face visible,
    // les jouteurs reviennent en main, on pioche une carte.
    this.seats.forEach((s, i) => {
      s.trophies += r.trophies[i];
      s.lastPlayed = r.played[i];
      s.discard.unshift(r.toDiscard[i].n);
      s.hand.push(...r.handBack[i]);
      const drawn = s.deck.shift();
      s.drawn = drawn || null;
      if (drawn) s.hand.push(drawn);
      s.placed = null;
      s.confirmed = false;
    });

    const gameOver = this.round >= MAX_ROUNDS;
    const payload = {
      round: this.round,
      events: r.events,
      placements: placements.map(p => mapPlacement(p, c => ({ iid: c.iid, n: c.n }))),
      trophies: r.trophies,
      totals: this.seats.map(s => s.trophies),
      board: r.board.map(b => ({
        left: cell(b.left), arena: cell(b.arena), right: cell(b.right),
      })),
      arenaWinners: r.arenaWinners,
      jousts: r.jousts,
      gameOver,
      ranking: gameOver ? rankPlayers(this.seats).map(x => ({ ...x, name: this.seats[x.seat].name })) : null,
    };

    if (gameOver) this.phase = 'over';
    else this.round++;
    return payload;
  }

  // ── Vues ──────────────────────────────────────────────────────────────────

  /** Ce que le siège `me` a le droit de voir. Sérialisable tel quel. */
  viewFor(me) {
    return {
      round: this.round,
      maxRounds: MAX_ROUNDS,
      phase: this.phase,
      mySeat: me,
      editable: this.editable(me),
      filled: this.filled(me),
      hand: this.seats[me].hand.map(c => ({ ...c })),
      placed: this.seats[me].placed
        ? mapPlacement(this.seats[me].placed, c => (c ? { ...c } : null))
        : { left: null, arena: null, right: null },
      seats: this.seats.map((s, i) => ({
        name: s.name,
        kind: s.kind,
        trophies: s.trophies,
        deckCount: s.deck.length,
        handCount: s.hand.length,
        discard: [...s.discard],
        ready: this.ready(i),
      })),
    };
  }
}

const cell = s => ({ n: s.card.n, base: s.base, force: s.force });

function mapPlacement(p, f) {
  return { left: f(p.left), arena: f(p.arena), right: f(p.right) };
}
