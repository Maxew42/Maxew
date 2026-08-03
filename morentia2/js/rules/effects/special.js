// Cartes créées et récompenses : jetons, compagnons et trophées de monstres.

import { defineCard } from '../registry.js';
import { UNTIL, REASON, askCard, askYes } from './helpers.js';
import { chooseLongmai } from './market.js';

// Shraou — lorsque cette carte rejoint un lieu, regardez la première carte du
// deck de lieux. Dès qu'elle possède 5 influence ou plus, retournez-la sur sa
// face Shraou Muté. Elle conserve ses Attachements.
defineCard('SPE-01', {
  *onEnterPlace(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    const next = ctx.state.placeDeck[0];
    const rec = next ? ctx.catalog.placeById.get(next) : null;
    ctx.note(`Prochain lieu du deck : ${rec?.name || '—'}.`);
  },
  *onInfluenceChanged(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    if (ctx.influence(ctx.inst) < 5) return;
    ctx.flip(ctx.inst, 'SPE-01B');
    ctx.note('Shraou mute.');
  },
});

// Shraou Muté — à la Nuit, les cartes adverses présentes sur ce lieu perdent
// 1 influence jusqu'à la prochaine Aube.
defineCard('SPE-01B', {
  *onNight(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    for (const c of ctx.cardsOn(slot)) {
      if ((c.controller ?? c.owner) === ctx.player) continue;
      yield* ctx.addInfluence(c, -1, UNTIL.DAWN);
    }
  },
});

// Réseau Longmai — placez un marqueur Réseau sur deux emplacements de lieu.
// À l'Aube, vous pouvez déplacer une carte alliée d'un emplacement marqué vers
// l'autre.
defineCard('SPE-02', {
  *onDawn(ctx) {
    const link = ctx.state.flags.longmai;
    if (!link) { yield* chooseLongmai(ctx, ctx.player); return; }
    const [a, b] = link;
    const movable = [a, b].flatMap(s => ctx.cardsOn(s))
      .filter(c => (c.controller ?? c.owner) === ctx.player && !c.flags.immobile);
    const pick = yield* askCard(ctx, 'Réseau Longmai — déplacer une carte alliée ?', movable, { optional: true });
    if (!pick) return;
    yield* ctx.moveToSlot(pick, pick.slot === a ? b : a, REASON.MOVE);
  },
});

// Créature Oubliée — cette carte ne compte pas dans le nombre de Survivants.
defineCard('SPE-03', {
  *keepOnExpiry(ctx, { inst, slot }) {
    if (inst.id !== ctx.inst.id || ctx.inst.slot !== slot) return false;
    // Jeton du lieu : il disparaît avec lui plutôt que d'occuper un Survivant.
    return false;
  },
  freeSurvivor: true,
});

// Écaille Rouge — la carte attachée gagne +2 influence.
defineCard('SPE-04', {
  aura(ctx, target) { return target.id === ctx.inst.attachedTo ? 2 : 0; },
});

// Écaille Bleue — +1 influence. Déployer la carte attachée depuis votre domaine
// coûte toujours 0 or.
defineCard('SPE-05', {
  aura(ctx, target) { return target.id === ctx.inst.attachedTo ? 1 : 0; },
  costFor(ctx, cand) {
    if (cand.action !== 'deploy') return 0;
    return cand.inst.id === ctx.inst.attachedTo ? { free: true } : 0;
  },
});

// Écaille Violette — +1 influence. Lorsqu'un lieu sur lequel elle est présente
// expire, la carte alliée avec le moins d'influence sur ce lieu survit sans
// compter dans le nombre de Survivants.
defineCard('SPE-06', {
  aura(ctx, target) { return target.id === ctx.inst.attachedTo ? 1 : 0; },
  *onPlaceExpiring(ctx, { slot }) {
    if (ctx.inst.slot !== slot) return;
    const owner = ctx.inst.controller ?? ctx.inst.owner;
    const mine = ctx.cardsOn(slot).filter(c => (c.controller ?? c.owner) === owner);
    if (!mine.length) return;
    const lowest = Math.min(...mine.map(c => ctx.influence(c)));
    const tied = mine.filter(c => ctx.influence(c) === lowest);
    const pick = tied.length === 1 ? tied[0]
      : yield* askCard(ctx, 'Écaille Violette — quelle carte survit ?', tied, { player: owner });
    if (pick) ctx.grantFreeSurvivor(slot, pick.id);
  },
});

// Poulpe-Navire Enchaîné — malus de Guerre tant qu'il n'est pas attaché,
// attachement payant à l'Aube, -1 Survivant, et affaiblissement au Crépuscule
// si vous ne contrôlez pas le lieu attaché.
defineCard('SPE-07', {
  survivorMod: -1,
  warInfluence(ctx, playerIndex) {
    const owner = ctx.inst.controller ?? ctx.inst.owner;
    if (playerIndex !== owner) return 0;
    return ctx.inst.zone === 'domain' && !ctx.inst.slot && ctx.inst.slot !== 0 ? -1 : 0;
  },
  *onDawn(ctx) {
    if (ctx.inst.zone !== 'domain') return;
    if (ctx.state.players[ctx.player].active < 1) return;
    const options = ctx.slots()
      .filter(s => !ctx.catalog.placeById.get(s.placeId)?.isMonster && !s.cards.length)
      .map(s => s.index);
    if (!options.length) return;
    if (!(yield* askYes(ctx, 'Payer 1 or pour enchaîner le Poulpe-Navire à un lieu ?'))) return;
    const slot = yield ctx.pickSlot(ctx.player, 'À quel lieu ?', options);
    if (slot === null || slot === undefined) return;
    yield* ctx.pay(ctx.player, 1);
    yield* ctx.moveToSlot(ctx.inst, slot, REASON.MOVE);
  },
  *onDusk(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    if (ctx.controllerOf(slot) === ctx.player) return;
    const prey = ctx.cardsOn(slot).filter(c => (c.controller ?? c.owner) !== ctx.player);
    const pick = yield* askCard(ctx, 'Poulpe-Navire — quelle carte adverse affaiblir ?', prey);
    if (pick) yield* ctx.addInfluence(pick, -1, UNTIL.DAWN);
  },
  *onPlaceExpiring(ctx, { slot }) {
    if (ctx.inst.slot !== slot) return;
    yield* ctx.toDomain(ctx.inst, { exhausted: false });
  },
});

// Mutation d'Ul — la carte attachée gagne +2 influence. Lorsqu'elle devrait
// être détruite, vous pouvez lui retirer 1 influence à la place.
defineCard('SPE-08', {
  aura(ctx, target) { return target.id === ctx.inst.attachedTo ? 2 : 0; },
  *replaceDestroy(ctx, { inst }) {
    if (inst.id !== ctx.inst.attachedTo) return false;
    if (ctx.influence(inst) <= 0) return false;
    if (!(yield* askYes(ctx, 'Mutation d’Ul — retirer 1 influence au lieu de détruire ?'))) return false;
    yield* ctx.addInfluence(inst, -1);
    return true;
  },
});

// Cœur des Sources Bouillantes — une fois par Jour, lorsque vous devriez
// résoudre l'effet de contrôle d'un lieu, vous pouvez retirer 1 influence à une
// carte alliée présente sur ce lieu pour le résoudre une fois de plus.
defineCard('SPE-09', {
  *onControlRepeats(ctx, { slot, player, repeats }) {
    if (player !== ctx.player) return repeats;
    if (ctx.inst.flags['day:coeur']) return repeats;
    const mine = ctx.cardsOn(slot).filter(c =>
      (c.controller ?? c.owner) === ctx.player && ctx.influence(c) > 0);
    if (!mine.length) return repeats;
    if (!(yield* askYes(ctx, 'Cœur des Sources — sacrifier 1 influence pour un second effet de contrôle ?'))) {
      return repeats;
    }
    const pick = yield* askCard(ctx, 'Quelle carte alliée perd 1 influence ?', mine);
    if (!pick) return repeats;
    ctx.flag('day:coeur', true);
    yield* ctx.addInfluence(pick, -1);
    return repeats + 1;
  },
});
