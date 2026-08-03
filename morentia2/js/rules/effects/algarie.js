// Algarie — mobilité, Géants et déploiements.

import { defineCard } from '../registry.js';
import {
  POT, UNTIL, REASON, selfAura, alliedInPlay, alliedOnPlaces, askCard,
  askCards, giantOn, neighbours, moveToNeighbour, drawThenDiscard,
} from './helpers.js';

// À l'Aube, gagnez 2 ors actifs.
// La première fois chaque Jour que vous déployez une carte, gagnez 1 or dans
// votre réserve.
defineCard('ALG-BASE', {
  *onDawn(ctx) {
    yield* ctx.gain(ctx.player, ctx.state.config.dawnGold ?? 2, POT.ACTIVE);
  },
  *onDeployed(ctx, { player }) {
    if (player !== ctx.player) return;
    if (!ctx.once('base')) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

/** Corps commun aux trois Géants : unicité et déplacement au Crépuscule. */
function giant(extra = {}) {
  return {
    // Un seul Géant peut être présent sur un lieu.
    forbids(ctx, cand) {
      if (cand.slot === null || cand.slot === undefined) return null;
      if (!(cand.face.subtype || '').includes('Géant')) return null;
      if (cand.inst.id === ctx.inst.id) return null;
      if (ctx.inst.slot !== cand.slot) return null;
      return 'Un seul Géant peut être présent sur un lieu.';
    },
    // Au Crépuscule, vous pouvez déplacer une carte alliée vers ce lieu.
    *onDusk(ctx) {
      if (ctx.inst.slot === null || ctx.inst.slot === undefined) return;
      yield* giantPull(ctx);
      if (extra.dusk) yield* extra.dusk(ctx);
    },
    ...(extra.rest || {}),
  };
}

function* giantPull(ctx) {
  const dest = ctx.inst.slot;
  const movable = alliedOnPlaces(ctx).filter(c => c.slot !== dest && !c.flags.immobile);
  const pick = yield* askCard(ctx, 'Déplacez une carte alliée vers le Géant ?', movable, { optional: true });
  if (pick) yield* ctx.moveToSlot(pick, dest, REASON.MOVE);
}

// Le Nocturne — les autres effets « Au Crépuscule » des cartes présentes sur
// ce lieu et du lieu se déclenchent une fois supplémentaire.
defineCard('ALG-01', giant({
  *dusk(ctx) {
    if (ctx.inst.slot === null) return;
    // La passe supplémentaire est jouée par le moteur après les effets de
    // Crépuscule ordinaires, en excluant Le Nocturne lui-même.
    ctx.setSlotFlag(ctx.inst.slot, 'duskExtra', ctx.inst.id);
  },
  rest: {
    *onPlaceExpired(ctx, { slot }) {
      if (ctx.inst.slot === slot) ctx.setSlotFlag(slot, 'duskExtra', null);
    },
  },
}));

// Le Contrevent — à la Nuit, chaque joueur détruit une carte qu'il contrôle
// présente sur ce lieu, s'il le peut.
defineCard('ALG-02', giant({
  rest: {
    *onNight(ctx) {
      const slot = ctx.inst.slot;
      if (slot === null || slot === undefined) return;
      for (const p of ctx.players()) {
        const mine = ctx.cardsOn(slot).filter(c => (c.controller ?? c.owner) === p.index);
        if (!mine.length) continue;
        const pick = yield* askCard(ctx, 'Le Contrevent — détruisez une de vos cartes de ce lieu.',
          mine, { player: p.index });
        if (pick) yield* ctx.destroy(pick);
      }
    },
  },
}));

// Le Brasier Lent — au Crépuscule, chaque carte présente sur ce lieu gagne
// +1 influence.
defineCard('ALG-03', giant({
  *dusk(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    for (const c of ctx.cardsOn(slot)) yield* ctx.addInfluence(c, 1);
  },
}));

// Attachez cette carte à un lieu non-Monstre. Jusqu'à l'expiration de ce lieu,
// vos cartes présentes sur ce lieu ajoutent également leur influence à votre
// total pour la Guerre. Elles restent présentes sur ce lieu.
defineCard('ALG-04', {
  forbids(ctx, cand) {
    if (cand.inst.id !== ctx.inst.id) return null;
    return null;
  },
  warInfluence(ctx, playerIndex) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return 0;
    if ((ctx.inst.controller ?? ctx.inst.owner) !== playerIndex) return 0;
    let total = 0;
    for (const id of ctx.state.slots[slot].cards) {
      const c = ctx.state.cards[id];
      if (!c || c.attachedTo || c.controller !== playerIndex) continue;
      total += ctx.influence(c, 'war');
    }
    return total;
  },
});

// Lorsque le lieu sur lequel cette carte est présente expire, vous pouvez
// déplacer cette carte vers un lieu adjacent au lieu expiré au lieu de la
// détruire.
defineCard('ALG-05', {
  *keepOnExpiry(ctx, { inst, slot }) {
    if (inst.id !== ctx.inst.id || ctx.inst.slot !== slot) return false;
    const options = neighbours(ctx, slot);
    if (!options.length) return false;
    const dest = yield ctx.pickSlot(ctx.player, 'Éclaireur des Steppes — fuir vers un lieu adjacent ?',
      options, { optional: true });
    if (dest === null || dest === undefined) return false;
    yield* ctx.moveToSlot(ctx.inst, dest, REASON.MOVE);
    return true;
  },
});

// La première fois chaque Jour que cette carte change directement de lieu, vous
// pouvez déplacer avec elle une autre carte alliée présente sur son lieu de
// départ vers le même lieu d'arrivée. Ce déplacement ne déclenche pas l'effet
// d'une autre Monture des Plaines.
defineCard('ALG-06', {
  *onChangedPlace(ctx, { inst, from, to }) {
    if (inst.id !== ctx.inst.id) return;
    if (!ctx.once('monture')) return;
    const companions = ctx.cardsOn(from)
      .filter(c => (c.controller ?? c.owner) === ctx.player && c.id !== ctx.inst.id && !c.flags.immobile);
    const pick = yield* askCard(ctx, 'Emmenez une autre carte alliée avec la Monture ?',
      companions, { optional: true });
    if (!pick) return;
    // Le passager ne réveille pas une autre Monture : on court-circuite le
    // signal de changement de lieu pour ce déplacement précis.
    ctx.engine.emit({ t: 'move', inst: pick.id, to: { zone: 'place', slot: to }, reason: REASON.MOVE });
    yield* ctx.signal('enterPlace', { inst: pick, slot: to, from: 'place', reason: REASON.MOVE, controlBefore: null });
  },
});

// Lorsque cette carte est déployée depuis votre domaine, elle gagne
// +2 influence jusqu'à la prochaine Aube.
// Lorsque cette carte devrait être détruite, retournez-la sur sa face Vétéran
// des Rafales et placez-la dans votre domaine, épuisée, à la place.
defineCard('ALG-07', {
  *onDeployed(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    yield* ctx.addInfluence(ctx.inst, 2, UNTIL.DAWN);
  },
  *replaceDestroy(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return false;
    ctx.flip(ctx.inst, 'ALG-07B');
    yield* ctx.toDomain(ctx.inst, { exhausted: true });
    ctx.note('Le Cavalier des Rafales se relève en Vétéran.');
    return true;
  },
});

// Lorsque cette carte est déployée depuis votre domaine, vous pouvez détruire
// une carte adverse ayant 1 influence ou moins présente sur ce lieu.
defineCard('ALG-07B', {
  *onDeployed(ctx, { inst, slot }) {
    if (inst.id !== ctx.inst.id) return;
    const prey = ctx.cardsOn(slot).filter(c =>
      (c.controller ?? c.owner) !== ctx.player && ctx.influence(c) <= 1);
    const pick = yield* askCard(ctx, 'Détruisez une carte adverse ayant 1 influence ou moins ?',
      prey, { optional: true });
    if (pick) yield* ctx.destroy(pick);
  },
});

// Déplacez une carte présente sur un lieu vers un lieu adjacent.
defineCard('ALG-08', {
  *onPlay(ctx) {
    const movable = ctx.slots().flatMap(s => ctx.cardsOn(s.index)).filter(c => !c.flags.immobile);
    const pick = yield* askCard(ctx, 'Déplacez une carte vers un lieu adjacent.', movable);
    if (pick) yield* moveToNeighbour(ctx, pick);
  },
});

// Les cartes alliées que vous jouez directement sur ce lieu coûtent 1 or de
// moins, minimum 1. Cet effet ne réduit pas le coût des déploiements.
defineCard('ALG-09', {
  costFor(ctx, cand) {
    if (cand.slot !== ctx.inst.slot) return 0;
    if (cand.action === 'deploy') return 0;
    if (cand.player !== (ctx.inst.controller ?? ctx.inst.owner)) return 0;
    return { delta: -1, floor: 1 };
  },
});

// La première fois chaque Jour que cette carte change directement de lieu vers
// un lieu adjacent, gagnez 1 or dans votre réserve.
defineCard('ALG-10', {
  *onChangedPlace(ctx, { inst, from, to }) {
    if (inst.id !== ctx.inst.id) return;
    if (!ctx.adjacent(from).includes(to)) return;
    if (!ctx.once('passefrontiere')) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// Cette carte coûte 0 or à jouer directement sur un lieu où un Géant est
// présent.
defineCard('ALG-11', {
  costFor(ctx, cand) {
    if (cand.inst.id !== ctx.inst.id) return 0;
    if (cand.action !== 'play' && cand.action !== 'buy') return 0;
    if (cand.slot === null || cand.slot === undefined) return 0;
    return giantOn(ctx, cand.slot) ? { free: true } : 0;
  },
});

// Action — Une fois par Jour, vous pouvez payer 1 or pour déplacer une carte
// alliée présente sur un lieu vers un lieu adjacent.
defineCard('ALG-12', {
  actions(ctx) {
    return [{
      label: 'Déplacer une carte alliée vers un lieu adjacent',
      cost: 1,
      available: !ctx.inst.flags['day:route'],
      *run(c) {
        c.flag('day:route', true);
        const movable = alliedOnPlaces(c).filter(x => !x.flags.immobile);
        const pick = yield* askCard(c, 'Quelle carte déplacer ?', movable);
        if (pick) yield* moveToNeighbour(c, pick);
      },
    }];
  },
});

// La première fois chaque Jour qu'une carte alliée change directement de lieu,
// piochez une carte puis défaussez une carte.
defineCard('ALG-13', {
  *onChangedPlace(ctx, { inst }) {
    if ((inst.controller ?? inst.owner) !== ctx.player) return;
    if (!ctx.once('messager')) return;
    yield* drawThenDiscard(ctx);
  },
});

// Déplacez une carte alliée vers un lieu adjacent. Détruisez une carte adverse
// présente sur le lieu d'arrivée ayant moins d'influence que la carte déplacée.
defineCard('ALG-14', {
  *onPlay(ctx) {
    const movable = alliedOnPlaces(ctx).filter(c => !c.flags.immobile && neighbours(ctx, c.slot).length);
    const pick = yield* askCard(ctx, 'Quelle carte alliée charge ?', movable);
    if (!pick) return;
    const dest = yield* moveToNeighbour(ctx, pick, 'Vers quel lieu adjacent ?');
    if (dest === null) return;
    const power = ctx.influence(pick);
    const prey = ctx.cardsOn(dest).filter(c =>
      (c.controller ?? c.owner) !== ctx.player && ctx.influence(c) < power);
    const victim = yield* askCard(ctx, `Détruisez une carte adverse ayant moins de ${power} influence.`, prey);
    if (victim) yield* ctx.destroy(victim);
  },
});

// La première fois chaque Jour que cette carte change directement de lieu, elle
// gagne +1 influence.
defineCard('ALG-15', {
  *onChangedPlace(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    if (!ctx.once('guerrier')) return;
    yield* ctx.addInfluence(ctx.inst, 1);
  },
});

// Tant qu'un Géant est présent sur ce lieu, cette carte gagne +2 influence.
defineCard('ALG-16', {
  aura: selfAura(ctx => {
    if (ctx.inst.slot === null || ctx.inst.slot === undefined) return 0;
    const giantHere = ctx.state.slots[ctx.inst.slot].cards
      .map(id => ctx.state.cards[id])
      .some(c => (ctx.catalog.byId.get(c.faceId)?.subtype || '').includes('Géant'));
    return giantHere ? 2 : 0;
  }),
});

// Déplacez une carte alliée vers un lieu adjacent. La prochaine fois qu'elle
// devrait être détruite avant la prochaine Aube, placez-la dans votre domaine,
// épuisée, à la place.
defineCard('ALG-17', {
  *onPlay(ctx) {
    const movable = alliedOnPlaces(ctx).filter(c => !c.flags.immobile && neighbours(ctx, c.slot).length);
    const pick = yield* askCard(ctx, 'Quelle carte alliée se replie ?', movable);
    if (!pick) return;
    yield* moveToNeighbour(ctx, pick, 'Vers quel lieu adjacent ?');
    ctx.engine.setFlag(pick.id, 'day:retreat', true);
  },
});

// À l'Aube, vous pouvez déplacer une carte alliée présente sur ce lieu vers un
// lieu adjacent.
defineCard('ALG-18', {
  *onDawn(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    const mine = ctx.cardsOn(slot).filter(c =>
      (c.controller ?? c.owner) === ctx.player && !c.flags.immobile);
    const pick = yield* askCard(ctx, 'Feux des Ancêtres — déplacer une carte alliée ?', mine, { optional: true });
    if (pick) yield* moveToNeighbour(ctx, pick);
  },
});

// Déplacez jusqu'à deux cartes alliées présentes sur un même lieu vers un même
// lieu adjacent.
defineCard('ALG-19', {
  *onPlay(ctx) {
    const origins = ctx.slots().map(s => s.index)
      .filter(s => ctx.cardsOn(s).some(c => (c.controller ?? c.owner) === ctx.player)
        && neighbours(ctx, s).length);
    if (!origins.length) return;
    const from = yield ctx.pickSlot(ctx.player, 'Depuis quel lieu ?', origins);
    if (from === null || from === undefined) return;
    const mine = ctx.cardsOn(from).filter(c => (c.controller ?? c.owner) === ctx.player && !c.flags.immobile);
    const picks = yield* askCards(ctx, 'Déplacez jusqu’à deux cartes alliées.', mine, 2);
    if (!picks.length) return;
    const dest = yield ctx.pickSlot(ctx.player, 'Vers quel lieu adjacent ?', neighbours(ctx, from));
    if (dest === null || dest === undefined) return;
    for (const c of picks) yield* ctx.moveToSlot(c, dest, REASON.MOVE);
  },
});

// Lorsque vous remportez la Guerre, une carte alliée gagne +1 influence.
defineCard('ALG-20', {
  *onWarResolved(ctx, { winners }) {
    if (!winners.includes(ctx.player)) return;
    const pick = yield* askCard(ctx, 'Une carte alliée gagne +1 influence.', alliedInPlay(ctx));
    if (pick) yield* ctx.addInfluence(pick, 1);
  },
});
