// Kalassir — sacrifice, destruction et économie de la défausse.
// Le commentaire au-dessus de chaque carte reprend le texte du classeur.

import { defineCard } from '../registry.js';
import {
  POT, UNTIL, KIND, selfAura, alliedInPlay, alliedOnPlaces, askCard,
  askYes, peekOwnDeck,
} from './helpers.js';

// À l'Aube, gagnez 2 ors actifs.
// La première fois chaque Jour qu'une carte alliée rejoint votre défausse,
// gagnez 1 or dans votre réserve.
defineCard('KAL-BASE', {
  *onDawn(ctx) {
    yield* ctx.gain(ctx.player, ctx.state.config.dawnGold ?? 2, POT.ACTIVE);
  },
  *onCardToDiscard(ctx, { inst }) {
    if (inst.owner !== ctx.player) return;
    if (!ctx.once('base')) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// Lorsque cette carte rejoint un lieu, détruisez une autre carte présente sur
// ce lieu ayant 1 influence ou moins.
defineCard('KAL-01', {
  *onEnterPlace(ctx, { inst, slot }) {
    if (inst.id !== ctx.inst.id) return;
    const cands = ctx.cardsOn(slot).filter(c => c.id !== ctx.inst.id && ctx.influence(c) <= 1);
    const target = yield* askCard(ctx, 'Détruisez une carte ayant 1 influence ou moins.', cands);
    if (target) yield* ctx.destroy(target);
  },
});

// Une fois par Jour, lorsqu'une carte alliée rejoint votre défausse, regardez
// la première carte de votre deck. Vous pouvez la laisser au-dessus du deck ou
// la placer sous votre deck.
defineCard('KAL-02', {
  *onCardToDiscard(ctx, { inst }) {
    if (inst.owner !== ctx.player) return;
    if (!ctx.once('archive')) return;
    yield* peekOwnDeck(ctx);
  },
});

// La première fois chaque Jour qu'une autre carte est détruite sur ce lieu,
// cette carte gagne +1 influence.
defineCard('KAL-03', {
  *onCardDestroyed(ctx, { inst, slot }) {
    if (inst.id === ctx.inst.id || slot === null || slot !== ctx.inst.slot) return;
    if (!ctx.once('saint')) return;
    yield* ctx.addInfluence(ctx.inst, 1);
  },
});

// Attachez cette carte à une unité présente sur un lieu.
// Les autres unités contrôlées par le contrôleur de la carte attachée présentes
// sur ce lieu ont -1 influence.
defineCard('KAL-04', {
  aura(ctx, target) {
    const host = ctx.state.cards[ctx.inst.attachedTo];
    if (!host || target.id === host.id) return 0;
    if (target.slot !== host.slot || target.attachedTo) return 0;
    if (target.controller !== host.controller) return 0;
    if (ctx.catalog.byId.get(target.faceId)?.kind !== KIND.UNIT) return 0;
    return -1;
  },
});

// Détruisez une carte alliée présente sur un lieu. Une autre carte alliée
// présente sur ce même lieu gagne +3 influence.
defineCard('KAL-05', {
  *onPlay(ctx) {
    const mine = alliedOnPlaces(ctx);
    const victim = yield* askCard(ctx, 'Détruisez une carte alliée présente sur un lieu.', mine);
    if (!victim) return;
    const others = ctx.cardsOn(victim.slot)
      .filter(c => c.id !== victim.id && (c.controller ?? c.owner) === ctx.player && !c.attachedTo);
    const gainer = yield* askCard(ctx, 'Une autre carte alliée de ce lieu gagne +3 influence.', others);
    yield* ctx.destroy(victim);
    if (gainer) yield* ctx.addInfluence(gainer, 3);
  },
});

// Lorsque cette carte rejoint un lieu contrôlé par un adversaire, vous pouvez
// détruire une de vos autres cartes présentes sur ce lieu.
// Si vous le faites, cette carte gagne +3 influence.
defineCard('KAL-06', {
  *onEnterPlace(ctx, { inst, slot, controlBefore }) {
    if (inst.id !== ctx.inst.id) return;
    if (controlBefore === null || controlBefore === ctx.player) return;
    const mine = ctx.cardsOn(slot)
      .filter(c => c.id !== ctx.inst.id && (c.controller ?? c.owner) === ctx.player);
    const victim = yield* askCard(ctx, 'Détruisez une de vos autres cartes de ce lieu ?', mine, { optional: true });
    if (!victim) return;
    yield* ctx.destroy(victim);
    yield* ctx.addInfluence(ctx.inst, 3);
  },
});

// Lorsque cette carte est détruite, une autre carte alliée présente sur ce lieu
// gagne +2 influence.
defineCard('KAL-07', {
  *onSelfDestroyed(ctx, { slot, controller }) {
    if (slot === null || slot === undefined) return;
    const mine = ctx.cardsOn(slot).filter(c => (c.controller ?? c.owner) === controller);
    const gainer = yield* askCard(ctx, 'Une autre carte alliée de ce lieu gagne +2 influence.',
      mine, { player: controller });
    if (gainer) yield* ctx.addInfluence(gainer, 2);
  },
});

// À l'Aube, vous pouvez défausser une carte alliée de votre domaine.
// Si vous le faites, piochez une carte ou gagnez 1 or dans votre réserve.
defineCard('KAL-08', {
  *onDawn(ctx) {
    const domain = ctx.domainOf(ctx.player).filter(c => c.id !== ctx.inst.id);
    const victim = yield* askCard(ctx, 'Défaussez une carte de votre domaine ?', domain, { optional: true });
    if (!victim) return;
    yield* ctx.discard(victim);
    const mode = yield ctx.pickMode(ctx.player, 'Que gagnez-vous ?',
      [{ value: 'draw', label: 'Piocher une carte' }, { value: 'gold', label: '1 or en réserve' }]);
    if (mode === 'draw') yield* ctx.draw(ctx.player, 1);
    else yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// À l'Aube, choisissez une unité alliée dans votre défausse. Cette carte gagne
// les effets imprimés de l'unité choisie jusqu'à la prochaine Aube.
defineCard('KAL-09', {
  *onDawn(ctx) {
    const units = ctx.discardOf(ctx.player).filter(c => ctx.isUnit(c));
    const pick = yield* askCard(ctx, 'Copiez les effets d’une unité de votre défausse.', units, { optional: true });
    // Le drapeau porte le préfixe « day: » : il disparaît à la prochaine Aube.
    ctx.flag('day:copyOf', pick ? pick.faceId : null);
    if (pick) ctx.note(`Héritier du Sang copie ${ctx.face_(pick)?.name}.`);
  },
});

// La première fois chaque Jour que vous prenez le contrôle d'un lieu à un
// adversaire, gagnez 1 or dans votre réserve et une carte alliée présente sur
// ce lieu gagne +1 influence.
defineCard('KAL-10', {
  *onControlChanged(ctx, { slot, from, to }) {
    if (to !== ctx.player || from === null || from === ctx.player) return;
    if (!ctx.once('croisade')) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
    const mine = ctx.cardsOn(slot).filter(c => (c.controller ?? c.owner) === ctx.player);
    const gainer = yield* askCard(ctx, 'Une carte alliée de ce lieu gagne +1 influence.', mine);
    if (gainer) yield* ctx.addInfluence(gainer, 1);
  },
});

// Lorsque vous remportez la Guerre, vous pouvez piocher une carte au lieu de
// gagner l'or accordé par la Guerre.
defineCard('KAL-11', {
  *replaceWarGold(ctx, { player }) {
    if (player !== ctx.player) return false;
    if (!(yield* askYes(ctx, 'Piocher une carte au lieu de l’or de la Guerre ?'))) return false;
    yield* ctx.draw(ctx.player, 1);
    return true;
  },
});

// La première fois chaque Jour que vous changez d'Ordre actif, cette carte
// gagne +1 influence.
defineCard('KAL-12', {
  *onOrderChanged(ctx, { player }) {
    if (player !== ctx.player) return;
    if (!ctx.once('converti')) return;
    yield* ctx.addInfluence(ctx.inst, 1);
  },
});

// Tant que les Lames de Karina sont l'Ordre actif, cette carte gagne
// +2 influence.
defineCard('KAL-13', {
  aura: selfAura(ctx => (ctx.state.players[ctx.player]?.flags.order === 'Lames de Karina' ? 2 : 0)),
});

// Tant que les Disciples de Karlov sont l'Ordre actif, la première fois chaque
// Jour qu'une carte alliée est détruite, piochez une carte.
defineCard('KAL-14', {
  *onCardDestroyed(ctx, { inst, controller }) {
    if (ctx.state.players[ctx.player]?.flags.order !== 'Disciples de Karlov') return;
    if (controller !== ctx.player && inst.owner !== ctx.player) return;
    if (!ctx.once('archiviste')) return;
    yield* ctx.draw(ctx.player, 1);
  },
});

// À l'Aube, vous pouvez retirer 1 influence à une carte alliée. Si vous le
// faites, une autre carte alliée gagne +2 influence jusqu'à la prochaine Aube.
defineCard('KAL-15', {
  *onDawn(ctx) {
    const mine = alliedInPlay(ctx).filter(c => ctx.influence(c) > 0);
    const donor = yield* askCard(ctx, 'Retirez 1 influence à une carte alliée ?', mine, { optional: true });
    if (!donor) return;
    yield* ctx.addInfluence(donor, -1);
    const others = alliedInPlay(ctx).filter(c => c.id !== donor.id);
    const gainer = yield* askCard(ctx, 'Une autre carte alliée gagne +2 influence jusqu’à l’Aube.', others);
    if (gainer) yield* ctx.addInfluence(gainer, 2, UNTIL.DAWN);
  },
});

// Lorsque cette carte rejoint votre domaine, vous pouvez remettre dans votre
// main une carte alliée de votre défausse.
defineCard('KAL-16', {
  *onEnterDomain(ctx, { inst, player }) {
    if (inst.id !== ctx.inst.id) return;
    const pool = ctx.discardOf(player);
    const pick = yield* askCard(ctx, 'Reprenez une carte de votre défausse ?', pool, { optional: true });
    if (pick) yield* ctx.toHand(pick, player);
  },
});

// Cette carte possède une influence égale à 1 plus le nombre d'unités alliées
// dans votre défausse, avec un maximum de 5.
defineCard('KAL-17', {
  printed(ctx) {
    const owner = ctx.inst.controller ?? ctx.inst.owner;
    if (owner === null || owner === undefined) return 1;
    const units = ctx.state.players[owner].discard
      .map(id => ctx.state.cards[id])
      .filter(c => ctx.catalog.byId.get(c.faceId)?.kind === KIND.UNIT);
    return Math.min(5, 1 + units.length);
  },
});

// Défaussez une unité de votre main. Gagnez dans votre réserve un nombre d'ors
// égal à son influence imprimée, avec un maximum de 3.
defineCard('KAL-18', {
  *onPlay(ctx) {
    const units = ctx.handOf(ctx.player).filter(c => ctx.isUnit(c) && c.id !== ctx.inst.id);
    const pick = yield* askCard(ctx, 'Défaussez une unité de votre main.', units);
    if (!pick) return;
    const value = Math.min(3, ctx.printed(pick));
    yield* ctx.discard(pick);
    yield* ctx.gain(ctx.player, value, POT.RESERVE);
  },
});

// Tant que le Culte du Premier Sang est l'Ordre actif, après la Guerre, si vous
// n'êtes pas parmi les perdants, une carte alliée dans votre domaine gagne
// +1 influence.
defineCard('KAL-19', {
  *onWarResolved(ctx, { losers }) {
    if (ctx.state.players[ctx.player]?.flags.order !== 'Culte du Premier Sang') return;
    if (losers.includes(ctx.player)) return;
    const domain = ctx.domainOf(ctx.player);
    const gainer = yield* askCard(ctx, 'Une carte de votre domaine gagne +1 influence.', domain);
    if (gainer) yield* ctx.addInfluence(gainer, 1);
  },
});

// Lorsque cette carte rejoint votre domaine, vous pouvez changer d'Ordre actif
// sans payer le coût du Conseil des Trois Ordres.
defineCard('KAL-20', {
  *onEnterDomain(ctx, { inst, player }) {
    if (inst.id !== ctx.inst.id) return;
    ctx.engine.setFlag(player, 'freeOrderChange', true);
    ctx.note('Le prochain changement d’Ordre est gratuit.');
  },
});
