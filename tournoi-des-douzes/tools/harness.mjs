// Banc d'essai du moteur : cas de règle un par un, puis milliers de parties
// aléatoires pour vérifier les invariants. `node tools/harness.mjs`
//
// À relancer après toute retouche de js/rules.js ou js/engine.js.

import { Engine, MAX_ROUNDS } from '../js/engine.js';
import { resolveRound, fieldOf, leftOf, rightOf } from '../js/rules.js';
import { chooseMove } from '../js/ai.js';
import { rng } from '../js/util.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.error('  ✗ ' + msg)); };
const eq = (a, b, msg) => ok(a === b, `${msg} — attendu ${b}, obtenu ${a}`);

// ── Utilitaires de scénario ──────────────────────────────────────────────────

const card = n => ({ iid: 'x' + n + Math.random().toString(36).slice(2, 6), n });

/** Monte une manche à la main. `players` = [{name, discard, arena, left, right}] */
function scenario(players) {
  const seats = players.map(p => ({ name: p.name, discard: p.discard || [] }));
  const placements = players.map(p => ({
    arena: card(p.arena), left: card(p.left), right: card(p.right),
  }));
  return resolveRound(seats, placements);
}

function section(title) { console.log('\n' + title); }

/** Siège vainqueur d'une joute, ou -1 en cas d'égalité. */
const winnerSeat = j => (j.winner === null ? -1 : (j.winner === 'a' ? j.a : j.b).seat);

// ── Géométrie des champs de joute ────────────────────────────────────────────
section('Champs de joute et voisinage');
{
  // À deux joueurs, les deux adversaires se rencontrent sur deux champs distincts.
  eq(fieldOf(0, 'right', 2), 0, '2j : champ à droite du siège 0');
  eq(fieldOf(0, 'left', 2), 1, '2j : champ à gauche du siège 0');
  eq(fieldOf(1, 'right', 2), 1, '2j : champ à droite du siège 1');
  eq(fieldOf(1, 'left', 2), 0, '2j : champ à gauche du siège 1');
  // Chaque champ est partagé par exactement deux places.
  for (const n of [2, 3, 4, 5, 6]) {
    const count = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (const s of ['left', 'right']) count[fieldOf(i, s, n)]++;
    ok(count.every(c => c === 2), `${n}j : chaque champ a deux combattants (${count})`);
  }
  eq(rightOf(5, 6), 0, 'le voisin de droite du dernier siège est le premier');
  eq(leftOf(0, 6), 5, 'le voisin de gauche du premier siège est le dernier');
}

// ── Le Père Pair (2) ─────────────────────────────────────────────────────────
section('Le Père Pair (2)');
{
  // 2 contre 12 : la force de base est paire, le Père Pair l'emporte malgré 2 < 12.
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 2 },
    { name: 'B', arena: 6, left: 12, right: 9 },
  ]);
  const j = r.jousts[0];  // A.right (2) vs B.left (12)
  eq(j.winner, 'a', 'le Père Pair bat Goliath (force paire)');
  eq(r.trophies[0] >= 1, true, 'A empoche le trophée de joute');
}
{
  // 2 contre 2 : nul, quels que soient les modificateurs (ici Laurent +4 chez A).
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 2 },
    { name: 'B', arena: 6, left: 2, right: 9 },
  ]);
  eq(r.jousts[0].winner, null, 'Père Pair contre Père Pair : égalité');
}
{
  // 2 contre 3 (impair) : comparaison de force normale, le 3 passe.
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 2 },
    { name: 'B', arena: 6, left: 3, right: 9 },
  ]);
  // Laurent (3) chez B s'applique : 3+4 = 7 contre 2.
  eq(r.jousts[0].winner, 'b', 'contre une base impaire, la force tranche');
}

// ── Goliath (12) et David (1) ────────────────────────────────────────────────
section('Goliath (12) et David (1)');
{
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 1 },
    { name: 'B', arena: 6, left: 12, right: 9 },
  ]);
  eq(r.jousts[0].winner, 'a', 'David bat Goliath');
  // David victorieux rapporte 3 trophées au lieu d'un.
  const fromDavid = r.events.find(e => e.k === 'trophy' && e.seat === 0 && e.side === 'right');
  eq(fromDavid.amount, 3, 'David rapporte 3 trophées');
}
{
  // David dans l'arène : son effet de trophée s'applique aussi là.
  const r = scenario([
    { name: 'A', arena: 1, left: 7, right: 3 },
    { name: 'B', arena: 4, left: 6, right: 9 },   // Henriette : la plus faible gagne
  ]);
  eq(r.arenaWinners.join(), '0', "Henriette fait gagner l'arène au 1");
  const t = r.events.find(e => e.k === 'trophy' && e.seat === 0 && e.side === 'arena');
  eq(t.amount, 3, "David rapporte 3 trophées dans l'arène");
}

// ── Henriette (4) ────────────────────────────────────────────────────────────
// Les remplissages utilisent 11 (effet de trophée seulement) et 4/12 en joute
// (sans effet là), pour ne pas polluer le scénario avec une Rosalie ou une Aliénor.
section('Henriette (4)');
{
  const r = scenario([
    { name: 'A', arena: 12, left: 11, right: 4 },
    { name: 'B', arena: 2, left: 11, right: 4 },
    { name: 'C', arena: 4, left: 11, right: 12 },
  ]);
  eq(r.arenaWinners.join(), '1', "avec Henriette en jeu, l'arène va au 2");
}
{
  // Sans Henriette, la plus forte carte gagne ; égalité = tous les ex æquo.
  const r = scenario([
    { name: 'A', arena: 12, left: 11, right: 4 },
    { name: 'B', arena: 12, left: 11, right: 4 },
    { name: 'C', arena: 9, left: 11, right: 4 },
  ]);
  eq(r.arenaWinners.join(), '0,1', "égalité dans l'arène : les deux gagnent");
}

// ── Laurent (3) ──────────────────────────────────────────────────────────────
section("Laurent (3)");
{
  const r = scenario([
    { name: 'A', arena: 11, left: 3, right: 12 },
    { name: 'B', arena: 12, left: 4, right: 9 },
  ]);
  eq(r.board[0].left.force, 7, 'Laurent se booste lui aussi');
  eq(r.board[0].right.force, 16, "l'autre jouteur de A gagne +4");
  eq(r.board[0].arena.force, 11, "l'arène de A reste à sa force de base");
  // Sans le +4, l'arène de A (11) perd contre celle de B (12) : preuve que
  // Laurent ne franchit pas la bordure de l'arène.
  eq(r.arenaWinners.join(), '1', "Laurent ne booste pas l'arène");
  // Champ 0 : A.right (12+4=16) contre B.left (4) → A.
  eq(winnerSeat(r.jousts[0]), 0, 'le jouteur gonflé de A écrase Henriette');
  // Champ 1 : B.right (9) contre A.left (Laurent à 7) → B.
  eq(winnerSeat(r.jousts[1]), 1, 'le 9 de B passe devant Laurent à 7');
}

// ── Jeanne (10) ──────────────────────────────────────────────────────────────
section('Jeanne (10)');
{
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 10 },
    { name: 'B', arena: 6, left: 12, right: 9 },  // face à Jeanne : base 12 ≥ 10
  ]);
  eq(r.board[0].right.force, 13, 'Jeanne gagne +3 contre une base ≥ 10');
}
{
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 10 },
    { name: 'B', arena: 6, left: 4, right: 9 },   // face à Jeanne : base 4 < 10
  ]);
  eq(r.board[0].right.force, 7, 'Jeanne perd 3 contre une base < 10');
}

// ── Gontran (6) et Morgane (7) ───────────────────────────────────────────────
section('Gontran (6) et Morgane (7)');
{
  // A.right = Gontran face au 4 de B ; A.left = Morgane face au 9 de B.
  const r = scenario([
    { name: 'A', arena: 11, left: 7, right: 6, discard: [11, 2] },
    { name: 'B', arena: 12, left: 4, right: 9, discard: [12] },
  ]);
  eq(r.board[0].right.force, 11, 'Gontran prend le dessus de sa propre défausse');
  eq(r.board[1].right.force, 12, 'Morgane impose au 9 de B le dessus de la défausse de B');
}
{
  // Défausse vide : rien ne se passe (première manche).
  const r = scenario([
    { name: 'A', arena: 11, left: 7, right: 6 },
    { name: 'B', arena: 12, left: 4, right: 9 },
  ]);
  eq(r.board[0].right.force, 6, 'Gontran sans défausse garde sa force');
  eq(r.board[1].right.force, 9, 'Morgane sans défausse adverse ne fait rien');
}

// ── Rosalie (5) ──────────────────────────────────────────────────────────────
section('Rosalie (5)');
{
  // La Rosalie de A (à droite) intervertit le combattant gauche de B avec son arène.
  const r = scenario([
    { name: 'A', arena: 12, left: 11, right: 5 },
    { name: 'B', arena: 11, left: 4, right: 9 },
  ]);
  eq(r.board[1].left.card.n, 11, "l'arène de B descend sur le champ");
  eq(r.board[1].arena.card.n, 4, "le jouteur de B monte dans l'arène");
}
{
  // Deux Rosalies subies : la victime résout d'abord celle de sa gauche, puis
  // celle de sa droite — et l'ordre inverse donnerait un autre résultat.
  // B (siège 1) est encadré par la Rosalie « droite » de A et la « gauche » de C.
  const r = scenario([
    { name: 'A', arena: 12, left: 11, right: 5 },
    { name: 'B', arena: 1, left: 4, right: 9 },
    { name: 'C', arena: 12, left: 5, right: 11 },
  ]);
  eq(r.board[1].left.card.n, 1, "d'abord la gauche : l'arène de B y descend");
  eq(r.board[1].arena.card.n, 9, "puis la droite : le 9 finit dans l'arène");
  eq(r.board[1].right.card.n, 4, 'le 4 a transité par l\'arène pour finir à droite');
}
{
  // Une Rosalie amenée depuis l'arène sur un champ de joute n'agit pas.
  const r = scenario([
    { name: 'A', arena: 12, left: 11, right: 5 },
    { name: 'B', arena: 5, left: 4, right: 9 },   // Rosalie dans l'arène de B
    { name: 'C', arena: 12, left: 11, right: 4 },
  ]);
  eq(r.board[1].left.card.n, 5, 'la Rosalie de B arrive sur le champ de gauche');
  eq(r.board[1].arena.card.n, 4, "le 4 de B monte dans l'arène");
  // Cette Rosalie déplacée ne doit rien avoir permuté chez A.
  eq(r.board[0].arena.card.n, 12, "l'arène de A est intacte");
  eq(r.board[0].right.card.n, 5, 'la Rosalie de A est restée sur son champ');
}

// ── Tracassin (9) ────────────────────────────────────────────────────────────
section('Tracassin (9)');
{
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 9 },
    { name: 'B', arena: 6, left: 12, right: 8 },  // 12 écrase 9 → Tracassin perd
  ]);
  const t = r.events.find(e => e.k === 'trophy' && e.seat === 0 && e.side === 'right');
  eq(t.amount, 1, 'Tracassin battu rapporte 1 trophée');
}
{
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 9 },
    { name: 'B', arena: 6, left: 1, right: 8 },   // 9 écrase 1 → Tracassin gagne
  ]);
  const t = r.events.find(e => e.k === 'trophy' && e.seat === 0 && e.side === 'right');
  eq(t.amount, 0, 'Tracassin vainqueur ne rapporte rien');
}
{
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 9 },
    { name: 'B', arena: 6, left: 9, right: 8 },   // 9 contre 9 → égalité
  ]);
  const t = r.events.find(e => e.k === 'trophy' && e.seat === 0 && e.side === 'right');
  eq(t, undefined, 'Tracassin à égalité ne rapporte rien et ne dit rien');
}

// ── Quasi-Maximus (11) ───────────────────────────────────────────────────────
section('Quasi-Maximus (11)');
{
  // Gagne sa joute mais perd l'arène → aucun trophée.
  const r = scenario([
    { name: 'A', arena: 2, left: 7, right: 11 },
    { name: 'B', arena: 12, left: 3, right: 8 },
  ]);
  eq(r.arenaWinners.includes(0), false, "A perd l'arène");
  const t = r.events.find(e => e.k === 'trophy' && e.seat === 0 && e.side === 'right');
  eq(t.amount, 0, "Quasi-Maximus ne rapporte rien sans l'arène");
}
{
  // Gagne sa joute et l'arène → 1 trophée.
  const r = scenario([
    { name: 'A', arena: 12, left: 7, right: 11 },
    { name: 'B', arena: 2, left: 3, right: 8 },
  ]);
  eq(r.arenaWinners.includes(0), true, "A remporte l'arène");
  const t = r.events.find(e => e.k === 'trophy' && e.seat === 0 && e.side === 'right');
  eq(t.amount, 1, "Quasi-Maximus rapporte avec l'arène en poche");
}

// ── Aliénor (8) ──────────────────────────────────────────────────────────────
section('Aliénor (8)');
{
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 8 },
    { name: 'B', arena: 6, left: 12, right: 9 },
  ]);
  // Après le combat, A récupère le 12 et B hérite de l'Aliénor.
  eq(r.handBack[0][1].n, 12, 'A repart avec le combattant de B');
  eq(r.handBack[1][0].n, 8, "B hérite d'Aliénor");
  // Le combat, lui, s'est joué avant l'échange : 12 bat 8.
  eq(r.jousts[0].winner, 'b', "l'échange se fait après le combat");
}
{
  const r = scenario([
    { name: 'A', arena: 5, left: 7, right: 8 },
    { name: 'B', arena: 6, left: 8, right: 9 },
  ]);
  eq(r.jousts[0].winner, null, 'Aliénor contre Aliénor : égalité');
  eq(r.handBack[0][1].n, 8, 'échange mutuel : chacun garde une Aliénor');
}
{
  // Aliénor dans l'arène ne s'échange pas : elle part à la défausse.
  const r = scenario([
    { name: 'A', arena: 8, left: 7, right: 3 },
    { name: 'B', arena: 6, left: 12, right: 9 },
  ]);
  eq(r.toDiscard[0].n, 8, "Aliénor placée dans l'arène finit à la défausse");
}

// ── Invariants sur des parties complètes ─────────────────────────────────────
section('Parties complètes (invariants)');
{
  const rand = rng(1234);
  let games = 0, rounds = 0;
  for (let g = 0; g < 400; g++) {
    const n = 2 + Math.floor(rand() * 5);
    const players = Array.from({ length: n }, (_, i) => ({
      id: 'p' + i, name: 'J' + i, kind: 'ai', level: 'normal',
    }));
    const e = new Engine(players, (rand() * 2 ** 31) | 0);
    const totalCards = () => e.seats.reduce(
      (a, s) => a + s.deck.length + s.hand.length + s.discard.length
        + (s.placed ? Object.values(s.placed).filter(Boolean).length : 0), 0);

    eq(totalCards(), 12 * n, `${n}j : 12 cartes par joueur au départ`);

    let guard = 0;
    while (!e.over && guard++ < 50) {
      for (let i = 0; i < n; i++) {
        ok(e.seats[i].hand.length === (e.round < 10 ? 3 : 3),
          `manche ${e.round} : ${e.seats[i].hand.length} cartes en main`);
        const mv = chooseMove(e, i, rand);
        for (const slot of ['left', 'arena', 'right']) {
          ok(e.put(i, slot, mv[slot].iid), `pose ${slot} acceptée`);
        }
        ok(e.confirm(i), 'placement validé');
      }
      ok(e.allReady(), 'tout le monde a posé ses trois cartes');
      const p = e.resolve();
      ok(p != null, 'la manche se résout');
      ok(p.trophies.every(t => t >= 0 && t <= 5), `trophées de manche plausibles (${p.trophies})`);
      eq(totalCards(), 12 * n, `${n}j : le total de cartes ne bouge pas`);
      rounds++;
    }
    eq(e.round, MAX_ROUNDS, `${n}j : la partie tient dix manches`);
    eq(e.phase, 'over', 'la partie est terminée');
    // À la fin, la défausse compte dix cartes et la pioche est vide.
    for (const s of e.seats) {
      eq(s.discard.length, 10, 'dix cartes défaussées');
      eq(s.deck.length, 0, 'pioche épuisée');
    }
    games++;
  }
  console.log(`  ${games} parties, ${rounds} manches simulées`);
}

// ── L'IA doit être meilleure que le hasard ───────────────────────────────────
section("Qualité de l'IA");
{
  const rand = rng(99);
  let smart = 0, dumb = 0, games = 300;
  for (let g = 0; g < games; g++) {
    // Siège 0 = IA « difficile », siège 1 = placement au hasard.
    const e = new Engine([
      { id: 'a', name: 'Maligne', kind: 'ai', level: 'hard' },
      { id: 'b', name: 'Hasard', kind: 'ai', level: 'random' },
    ], (rand() * 2 ** 31) | 0);
    while (!e.over) {
      for (let i = 0; i < 2; i++) {
        const mv = chooseMove(e, i, rand);
        for (const slot of ['left', 'arena', 'right']) e.put(i, slot, mv[slot].iid);
        e.confirm(i);
      }
      e.resolve();
    }
    smart += e.seats[0].trophies;
    dumb += e.seats[1].trophies;
  }
  const a = (smart / games).toFixed(2), b = (dumb / games).toFixed(2);
  console.log(`  IA difficile ${a} trophées/partie contre ${b} au hasard`);
  ok(smart > dumb * 1.15, `l'IA bat nettement le hasard (${a} vs ${b})`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} vérifications passées, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
