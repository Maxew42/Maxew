// Cartes neutres du marché, accessibles à toutes les factions.

import { defineCard } from '../registry.js';
import {
  POT, UNTIL, REASON, KIND, selfAura, alliedInPlay, askCard, askYes,
  drawThenDiscard, recycleMarket,
} from './helpers.js';

// À l'Aube, choisissez un :
// • Si vous ne contrôlez aucune carte nommée Shraou, créez Shraou dans votre
//   domaine, épuisé.
// • Une carte nommée Shraou que vous contrôlez gagne +1 influence.
// • Retirez 1 influence à une carte nommée Shraou que vous contrôlez. Si vous
//   le faites, piochez une carte.
defineCard('MAR-01', {
  *onDawn(ctx) {
    const shraou = alliedInPlay(ctx).filter(c => c.baseCardId === 'SPE-01');
    const modes = [];
    if (!shraou.length) modes.push({ value: 'create', label: 'Créer Shraou dans votre domaine' });
    if (shraou.length) {
      modes.push({ value: 'grow', label: 'Shraou gagne +1 influence' });
      if (shraou.some(c => ctx.influence(c) > 0)) {
        modes.push({ value: 'bleed', label: 'Shraou perd 1 influence — piochez une carte' });
      }
    }
    if (!modes.length) return;
    const mode = yield ctx.pickMode(ctx.player, 'Krysta — que faites-vous ?', modes);
    if (mode === 'create') {
      const token = ctx.createToken('SPE-01', ctx.player);
      yield* ctx.toDomain(token, { exhausted: true, player: ctx.player, reason: REASON.CREATE });
    } else if (mode === 'grow') {
      const pick = yield* askCard(ctx, 'Quel Shraou renforcer ?', shraou);
      if (pick) yield* ctx.addInfluence(pick, 1);
    } else if (mode === 'bleed') {
      const pick = yield* askCard(ctx, 'Quel Shraou saigner ?', shraou.filter(c => ctx.influence(c) > 0));
      if (!pick) return;
      yield* ctx.addInfluence(pick, -1);
      yield* ctx.draw(ctx.player, 1);
    }
  },
});

// Lorsque cette carte rejoint votre domaine, si vous ne contrôlez pas de Réseau
// Longmai, créez-en un. Sinon, choisissez à nouveau les deux emplacements
// reliés par votre Réseau Longmai.
defineCard('MAR-02', {
  *onEnterDomain(ctx, { inst, player }) {
    if (inst.id !== ctx.inst.id) return;
    const existing = alliedInPlay(ctx, player).find(c => c.baseCardId === 'SPE-02');
    if (!existing) {
      const token = ctx.createToken('SPE-02', player);
      yield* ctx.toDomain(token, { exhausted: false, player, reason: REASON.CREATE });
    }
    yield* chooseLongmai(ctx, player);
  },
});

/** Pose ou déplace les deux marqueurs du Réseau Longmai. */
export function* chooseLongmai(ctx, player) {
  const slots = ctx.slots().map(s => s.index);
  if (slots.length < 2) return;
  const a = yield ctx.pickSlot(player, 'Réseau Longmai — premier emplacement.', slots);
  if (a === null || a === undefined) return;
  const b = yield ctx.pickSlot(player, 'Réseau Longmai — second emplacement.', slots.filter(s => s !== a));
  if (b === null || b === undefined) return;
  ctx.engine.setFlag('game', 'longmai', [a, b]);
  ctx.note(`Réseau Longmai : lieux ${a + 1} et ${b + 1}.`);
}

// Le joueur qui contrôle ce lieu doit payer 1 or supplémentaire pour jouer ou
// déployer des cartes sur ce lieu.
defineCard('MAR-03', {
  costFor(ctx, cand) {
    if (cand.slot !== ctx.inst.slot) return 0;
    if (ctx.state.slots[cand.slot]?.controller !== cand.player) return 0;
    return { delta: 1 };
  },
});

// La première fois chaque Jour qu'une carte adverse gagne de l'influence sur ce
// lieu, cette carte gagne +1 influence jusqu'à la prochaine Aube.
defineCard('MAR-04', {
  *onInfluenceChanged(ctx, { inst, delta }) {
    if (delta <= 0 || inst.slot !== ctx.inst.slot) return;
    if ((inst.controller ?? inst.owner) === ctx.player) return;
    if (!ctx.once('miroir')) return;
    yield* ctx.addInfluence(ctx.inst, 1, UNTIL.DAWN);
  },
});

// À l'Aube, choisissez une autre unité présente sur ce lieu. Jusqu'à la
// prochaine Aube, cette carte remplace ses effets imprimés par ceux de l'unité
// choisie.
defineCard('MAR-05', {
  *onDawn(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    const units = ctx.cardsOn(slot).filter(c => c.id !== ctx.inst.id && ctx.isUnit(c));
    const pick = yield* askCard(ctx, 'Grand Imitateur — quelle unité copier ?', units, { optional: true });
    ctx.flag('day:copyOf', pick ? pick.faceId : null);
    if (pick) ctx.note(`Le Grand Imitateur copie ${ctx.face_(pick)?.name}.`);
  },
});

// Lorsque cette carte rejoint un lieu, choisissez un mode tant qu'elle reste
// sur ce lieu :
// • À chaque Aube, chaque joueur détruit une carte qu'il contrôle présente sur
//   ce lieu, s'il le peut.
// • Les cartes présentes sur ce lieu ne peuvent pas perdre d'influence.
defineCard('MAR-06', {
  *onEnterPlace(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    const mode = yield ctx.pickMode(ctx.player, 'Aelden — quelle règle imposer ?', [
      { value: 'purge', label: 'Chaque Aube, chacun détruit une de ses cartes ici' },
      { value: 'ward', label: 'Les cartes de ce lieu ne peuvent pas perdre d’influence' },
    ]);
    ctx.flag('aelden', mode);
  },
  *onDawn(ctx) {
    if (ctx.inst.flags.aelden !== 'purge') return;
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    for (const p of ctx.players()) {
      const mine = ctx.cardsOn(slot).filter(c => (c.controller ?? c.owner) === p.index);
      if (!mine.length) continue;
      const pick = yield* askCard(ctx, 'Aelden — détruisez une de vos cartes de ce lieu.',
        mine, { player: p.index });
      if (pick) yield* ctx.destroy(pick);
    }
  },
  onInfluenceLoss(ctx, { inst, delta }) {
    if (ctx.inst.flags.aelden !== 'ward') return delta;
    if (inst.slot !== ctx.inst.slot) return delta;
    return 0;
  },
});

// À l'Aube, choisissez une autre carte présente sur ce lieu. Elle perd
// 1 influence jusqu'à la prochaine Aube.
// À la Nuit, détruisez toutes les cartes présentes sur ce lieu ayant
// 0 influence.
defineCard('MAR-07', {
  *onDawn(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    const others = ctx.cardsOn(slot).filter(c => c.id !== ctx.inst.id);
    const pick = yield* askCard(ctx, 'Blanche — quelle carte affaiblir ?', others);
    if (pick) yield* ctx.addInfluence(pick, -1, UNTIL.DAWN);
  },
  *onNight(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    for (const c of ctx.cardsOn(slot).slice()) {
      if (ctx.isUnit(c) && ctx.influence(c) === 0) yield* ctx.destroy(c);
    }
  },
});

// Cette carte ne peut pas être déplacée.
// Lorsque le lieu sur lequel elle est présente expire, elle ne compte pas dans
// le nombre de Survivants et reste sur le même emplacement.
defineCard('MAR-08', {
  *onEnterPlace(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    ctx.flag('immobile', true);
  },
  *keepOnExpiry(ctx, { inst, slot }) {
    if (inst.id !== ctx.inst.id || ctx.inst.slot !== slot) return false;
    ctx.note('Manollo demeure sur l’emplacement.');
    return true;   // ni Survivant ni détruit : la carte reste en place
  },
});

// Vos unités ayant 1 influence imprimée ou moins gagnent +1 influence.
defineCard('MAR-09', {
  aura(ctx, target) {
    if ((target.controller ?? target.owner) !== (ctx.inst.controller ?? ctx.inst.owner)) return 0;
    const face = ctx.catalog.byId.get(target.faceId);
    if (!face || face.kind !== KIND.UNIT) return 0;
    return (typeof face.influence === 'number' ? face.influence : 0) <= 1 ? 1 : 0;
  },
});

// Attachez cette carte à une unité présente sur un lieu.
// Les effets imprimés de la carte attachée sont ignorés. Elle gagne
// +3 influence.
defineCard('MAR-10', {
  silences: true,
  aura(ctx, target) {
    return target.id === ctx.inst.attachedTo ? 3 : 0;
  },
});

// La première fois chaque Jour qu'une carte alliée revient dans votre domaine,
// gagnez 1 or dans votre réserve.
defineCard('MAR-11', {
  *onEnterDomain(ctx, { player }) {
    if (player !== ctx.player) return;
    if (!ctx.once('refuge')) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// La première fois chaque Jour qu'une autre carte présente sur ce lieu devrait
// être détruite, vous pouvez la placer dans le domaine de son propriétaire,
// épuisée, à la place.
defineCard('MAR-12', {
  *replaceDestroy(ctx, { inst }) {
    if (inst.id === ctx.inst.id || inst.slot !== ctx.inst.slot) return false;
    if (ctx.inst.flags['day:veilleuse']) return false;
    if (!(yield* askYes(ctx, `Sauver ${ctx.face_(inst)?.name} vers le domaine de son propriétaire ?`))) return false;
    ctx.flag('day:veilleuse', true);
    yield* ctx.toDomain(inst, { exhausted: true, player: inst.owner });
    return true;
  },
});

// Lorsque cette carte rejoint votre domaine, gagnez 1 or dans votre réserve.
defineCard('MAR-13', {
  *onEnterDomain(ctx, { inst, player }) {
    if (inst.id !== ctx.inst.id) return;
    yield* ctx.gain(player, 1, POT.RESERVE);
  },
});

// Au Crépuscule, si vous contrôlez le lieu sur lequel cette carte est présente,
// gagnez 1 or dans votre réserve.
defineCard('MAR-14', {
  *onDusk(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    if (ctx.controllerOf(slot) !== ctx.player) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// La première fois chaque Jour que cette carte rejoint un lieu, piochez une
// carte puis défaussez une carte.
defineCard('MAR-15', {
  *onEnterPlace(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    if (!ctx.once('archiviste')) return;
    yield* drawThenDiscard(ctx);
  },
});

// Une carte gagne +1 influence jusqu'à la prochaine Aube.
defineCard('MAR-16', {
  *onPlay(ctx) {
    const targets = ctx.allInPlay().filter(c => c.zone !== 'base');
    const pick = yield* askCard(ctx, 'Quelle carte gagne +1 influence ?', targets);
    if (pick) yield* ctx.addInfluence(pick, 1, UNTIL.DAWN);
  },
});

// Une carte perd 1 influence jusqu'à la prochaine Aube.
defineCard('MAR-17', {
  *onPlay(ctx) {
    const targets = ctx.allInPlay().filter(c => c.zone !== 'base' && ctx.influence(c) > 0);
    const pick = yield* askCard(ctx, 'Quelle carte perd 1 influence ?', targets);
    if (pick) yield* ctx.addInfluence(pick, -1, UNTIL.DAWN);
  },
});

// Les cartes jouées directement sur ce lieu arrivent avec -1 influence jusqu'à
// l'expiration de ce lieu. Cet effet ne concerne pas les déploiements.
defineCard('MAR-18', {
  *onEnterPlace(ctx, { inst, slot, reason }) {
    if (slot !== ctx.inst.slot || inst.id === ctx.inst.id) return;
    if (reason !== REASON.PLAY && reason !== REASON.BUY) return;
    yield* ctx.addInfluence(inst, -1);
  },
});

// À l'Aube, si cette carte possède strictement la plus haute influence parmi
// les cartes présentes sur ce lieu, gagnez 1 or actif.
defineCard('MAR-19', {
  *onDawn(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    const mine = ctx.influence(ctx.inst);
    const best = ctx.cardsOn(slot)
      .filter(c => c.id !== ctx.inst.id)
      .reduce((n, c) => Math.max(n, ctx.influence(c)), -1);
    if (mine > best) yield* ctx.gain(ctx.player, 1, POT.ACTIVE);
  },
});

// Au Crépuscule, si vous contrôlez le lieu et qu'au moins une carte adverse y
// est présente, cette carte gagne +1 influence.
defineCard('MAR-20', {
  *onDusk(ctx) {
    const slot = ctx.inst.slot;
    if (slot === null || slot === undefined) return;
    if (ctx.controllerOf(slot) !== ctx.player) return;
    const contested = ctx.cardsOn(slot).some(c => (c.controller ?? c.owner) !== ctx.player);
    if (contested) yield* ctx.addInfluence(ctx.inst, 1);
  },
});

// Les autres effets « Au Crépuscule » et « À la Nuit » des cartes présentes sur
// ce lieu et du lieu ne se déclenchent pas.
defineCard('MAR-21', {
  *onEnterPlace(ctx, { inst, slot }) {
    if (inst.id !== ctx.inst.id) return;
    ctx.setSlotFlag(slot, 'timeless', true);
  },
  *onPlaceExpired(ctx, { slot }) {
    if (ctx.inst.slot === slot) ctx.setSlotFlag(slot, 'timeless', null);
  },
});

// Ce lieu a -1 Survivant, avec un minimum de 0.
defineCard('MAR-22', { survivorMod: -1 });

// Ce lieu a +1 Survivant.
defineCard('MAR-23', { survivorMod: 1 });

// Augmentez de 1 la Durée d'un lieu possédant une Durée, avec un maximum de 5.
defineCard('MAR-24', {
  *onPlay(ctx) {
    const options = ctx.slots()
      .filter(s => typeof s.duration === 'number' && s.duration < 5)
      .map(s => s.index);
    if (!options.length) return;
    const slot = yield ctx.pickSlot(ctx.player, 'Quel lieu prolonger d’un Jour ?', options);
    if (slot === null || slot === undefined) return;
    ctx.duration(slot, 1);
  },
});

// Tant que cette carte est présente sur un Lieu — Monstre, elle gagne
// +2 influence.
defineCard('MAR-25', {
  aura: selfAura(ctx => {
    if (ctx.inst.slot === null || ctx.inst.slot === undefined) return 0;
    const rec = ctx.catalog.placeById.get(ctx.state.slots[ctx.inst.slot].placeId);
    return rec?.isMonster ? 2 : 0;
  }),
});

// Lorsque cette carte rejoint un lieu, vous pouvez payer 1 or. Si vous le
// faites, défaussez un Attachement de lieu présent sur ce lieu.
defineCard('MAR-26', {
  *onEnterPlace(ctx, { inst, slot }) {
    if (inst.id !== ctx.inst.id) return;
    const attachments = ctx.cardsOn(slot)
      .filter(c => ctx.face_(c)?.kind === KIND.PLACE_ATTACHMENT && c.id !== ctx.inst.id);
    if (!attachments.length || ctx.state.players[ctx.player].active < 1) return;
    if (!(yield* askYes(ctx, 'Payer 1 or pour défausser un Attachement de lieu ?'))) return;
    yield* ctx.pay(ctx.player, 1);
    const pick = yield* askCard(ctx, 'Quel Attachement de lieu défausser ?', attachments);
    if (pick) yield* ctx.discard(pick);
  },
});

// Lorsque ce lieu expire, avant de choisir les Survivants, vous pouvez détruire
// cette carte. Si vous le faites, une autre carte alliée présente sur ce lieu
// survit sans compter dans le nombre de Survivants.
defineCard('MAR-27', {
  *onPlaceExpiring(ctx, { slot }) {
    if (ctx.inst.slot !== slot) return;
    const others = ctx.cardsOn(slot).filter(c =>
      c.id !== ctx.inst.id && (c.controller ?? c.owner) === ctx.player);
    if (!others.length) return;
    if (!(yield* askYes(ctx, 'Sacrifier la Passeuse pour sauver une carte alliée ?'))) return;
    const pick = yield* askCard(ctx, 'Quelle carte sauver ?', others);
    if (!pick) return;
    ctx.grantFreeSurvivor(slot, pick.id);
    yield* ctx.destroy(ctx.inst);
  },
});

// La carte attachée gagne +2 influence.
// La première fois chaque Jour qu'elle devrait perdre de l'influence, réduisez
// cette perte de 1.
defineCard('MAR-28', {
  aura(ctx, target) {
    return target.id === ctx.inst.attachedTo ? 2 : 0;
  },
  onInfluenceLoss(ctx, { inst, delta }) {
    if (inst.id !== ctx.inst.attachedTo || delta >= 0) return delta;
    if (!ctx.once('lame')) return delta;
    return Math.min(0, delta + 1);
  },
});

// Lorsque cette carte rejoint votre domaine, vous pouvez placer une carte
// visible du marché sous le deck de marché. Remplacez-la immédiatement.
defineCard('MAR-29', {
  *onEnterDomain(ctx, { inst, player }) {
    if (inst.id !== ctx.inst.id) return;
    yield* recycleMarket(ctx, player);
  },
});

// Tant que cette carte est dans votre domaine, elle compte comme ayant
// 4 influence pour la Guerre.
defineCard('MAR-30', {
  finalizeSelf(ctx, value) {
    if (ctx.purpose !== 'war') return value;
    return ctx.inst.zone === 'domain' ? 4 : value;
  },
});

// Choisissez un Permanent ou un Attachement. Ses effets sont ignorés jusqu'à la
// prochaine Aube.
defineCard('MAR-31', {
  *onPlay(ctx) {
    const targets = ctx.allInPlay().filter(c => {
      const k = ctx.face_(c)?.kind;
      return k === KIND.PERMANENT || k === KIND.UNIT_ATTACHMENT || k === KIND.PLACE_ATTACHMENT;
    });
    const pick = yield* askCard(ctx, 'Quel Permanent ou Attachement neutraliser ?', targets);
    if (pick) ctx.engine.setFlag(pick.id, 'day:silenced', true);
  },
});

// --- Module Jadis (cartes optionnelles) ---

// Déplacez une carte présente sur un lieu vers n'importe quel autre lieu.
defineCard('MAR-J01', {
  *onPlay(ctx) {
    const movable = ctx.slots().flatMap(s => ctx.cardsOn(s.index)).filter(c => !c.flags.immobile);
    const pick = yield* askCard(ctx, 'Quelle carte translater ?', movable);
    if (!pick) return;
    const dests = ctx.slots().map(s => s.index).filter(s => s !== pick.slot);
    const dest = yield ctx.pickSlot(ctx.player, 'Vers quel lieu ?', dests);
    if (dest !== null && dest !== undefined) yield* ctx.moveToSlot(pick, dest, REASON.MOVE);
  },
});

// Regardez les trois premières cartes du deck de marché. Ajoutez-en une à votre
// main et placez les autres sous le deck dans l'ordre de votre choix.
defineCard('MAR-J02', {
  *onPlay(ctx) {
    const top = ctx.state.market.deck.slice(0, 3).map(id => ctx.state.cards[id]);
    if (!top.length) return;
    const pick = yield* askCard(ctx, 'Ajoutez une carte à votre main.', top);
    for (const c of top) {
      if (pick && c.id === pick.id) yield* ctx.toHand(c, ctx.player);
      else ctx.marketDeckToBottom(c);
    }
  },
});

// La carte attachée gagne +1 influence et ne peut pas être déplacée ou détruite
// par des effets de cartes.
defineCard('MAR-J03', {
  aura(ctx, target) {
    return target.id === ctx.inst.attachedTo ? 1 : 0;
  },
  *onAttached(ctx, { inst, host }) {
    if (inst.id !== ctx.inst.id) return;
    ctx.engine.setFlag(host.id, 'immobile', true);
  },
  *protectsFromDestroy(ctx, { inst }) {
    return inst.id === ctx.inst.attachedTo;
  },
});
