// Lieux : effet permanent, effet de contrôle résolu au Crépuscule, et
// éventuel effet à l'expiration.
//
// `ctx` d'un effet de lieu porte `ctx.slot` (l'emplacement) et, pour un effet
// de contrôle, `ctx.player` (le contrôleur).

import { definePlace } from '../registry.js';
import { POT, REASON, KIND, askCard } from './helpers.js';

/** Cartes présentes sur l'emplacement du lieu. */
function on(ctx) {
  return ctx.cardsOn(ctx.slot);
}

function mine(ctx, player = ctx.player) {
  return on(ctx).filter(c => (c.controller ?? c.owner) === player);
}

// Plaine des Survivants — le coût de lieu des cartes jouées directement sur ce
// lieu est réduit de 1, minimum 1. Contrôle : gagnez 1 or dans votre réserve.
definePlace('LIE-01', {
  costFor(ctx, cand) {
    if (cand.slot !== ctx.slot) return 0;
    if (cand.action === 'deploy') return 0;
    return { delta: -1, floor: 1 };
  },
  *onControl(ctx) {
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// Domaine de Haute-Voûte — à la Nuit, la carte ayant la plus faible influence
// sur ce lieu perd 1 influence. En cas d'égalité, le contrôleur choisit. Si
// personne ne contrôle le lieu, aucune carte ne perd d'influence.
// Contrôle : piochez une carte.
definePlace('LIE-02', {
  *onNight(ctx) {
    const cards = on(ctx);
    if (!cards.length) return;
    const lowest = Math.min(...cards.map(c => ctx.influence(c)));
    const tied = cards.filter(c => ctx.influence(c) === lowest);
    if (tied.length === 1) { yield* ctx.addInfluence(tied[0], -1); return; }
    const holder = ctx.controllerOf(ctx.slot);
    if (holder === null) return;
    const pick = yield* askCard(ctx, 'Haute-Voûte — quelle carte perd 1 influence ?',
      tied, { player: holder });
    if (pick) yield* ctx.addInfluence(pick, -1);
  },
  *onControl(ctx) {
    yield* ctx.draw(ctx.player, 1);
  },
});

// Défilé des Pèlerins — chaque joueur ne peut jouer ou déployer qu'une seule
// carte sur ce lieu chaque Jour. Contrôle : une carte alliée ici gagne
// +1 influence.
definePlace('LIE-03', {
  forbids(ctx, cand) {
    if (cand.slot !== ctx.slot) return null;
    if (!['play', 'deploy', 'buy', 'attach'].includes(cand.action)) return null;
    const n = ctx.state.flags[`day:placed:${cand.player}:${cand.slot}`] || 0;
    return n >= 1 ? 'Défilé des Pèlerins : une seule carte par Jour sur ce lieu.' : null;
  },
  *onControl(ctx) {
    const pick = yield* askCard(ctx, 'Une carte alliée de ce lieu gagne +1 influence.', mine(ctx));
    if (pick) yield* ctx.addInfluence(pick, 1);
  },
});

// Arène des Cendres — chaque joueur ne peut avoir qu'une seule unité présente
// sur ce lieu. Contrôle : votre unité présente ici gagne +1 influence.
definePlace('LIE-04', {
  forbids(ctx, cand) {
    if (cand.slot !== ctx.slot) return null;
    if (cand.face.kind !== KIND.UNIT) return null;
    const already = ctx.cardsOn(ctx.slot).some(c =>
      (c.controller ?? c.owner) === cand.player && ctx.face_(c)?.kind === KIND.UNIT
      && c.id !== cand.inst.id);
    return already ? 'Arène des Cendres : une seule unité par joueur.' : null;
  },
  *onControl(ctx) {
    const units = mine(ctx).filter(c => ctx.isUnit(c));
    if (units.length) yield* ctx.addInfluence(units[0], 1);
  },
});

// Refuge d'Inna — les cartes ayant 2 influence imprimée ou moins présentes ici
// gagnent +1 influence et ne peuvent pas être détruites par des effets de
// cartes. Contrôle : reprenez en main une carte alliée de 1 influence imprimée
// ou moins depuis votre défausse.
definePlace('LIE-05', {
  aura(ctx, target) {
    if (target.slot !== ctx.slot || target.attachedTo) return 0;
    const face = ctx.catalog.byId.get(target.faceId);
    const printed = typeof face?.influence === 'number' ? face.influence : 0;
    return printed <= 2 && face?.kind === KIND.UNIT ? 1 : 0;
  },
  *protectsFromDestroy(ctx, { inst }) {
    if (inst.slot !== ctx.slot) return false;
    const face = ctx.catalog.byId.get(inst.faceId);
    const printed = typeof face?.influence === 'number' ? face.influence : 0;
    return printed <= 2;
  },
  *onControl(ctx) {
    const pool = ctx.discardOf(ctx.player).filter(c => ctx.printed(c) <= 1);
    const pick = yield* askCard(ctx, 'Reprenez une carte de 1 influence imprimée ou moins.',
      pool, { optional: true });
    if (pick) yield* ctx.toHand(pick, ctx.player);
  },
});

// Montagne des Oubliés — les cartes ayant exactement 1 influence comptent comme
// ayant 3 influence sur ce lieu. Contrôle : créez une Créature Oubliée ici si
// vous n'en contrôlez pas déjà une.
definePlace('LIE-06', {
  finalize(ctx, target, value) {
    if (target.slot !== ctx.slot || target.attachedTo) return value;
    return value === 1 ? 3 : value;
  },
  *onControl(ctx) {
    const already = mine(ctx).some(c => c.baseCardId === 'SPE-03');
    if (already) return;
    const token = ctx.createToken('SPE-03', ctx.player);
    yield* ctx.moveToSlot(token, ctx.slot, REASON.CREATE);
  },
});

// Bastion Scellé — les joueurs ne peuvent pas déployer de cartes depuis leur
// domaine sur ce lieu. Contrôle : choisissez une carte alliée ici ; si ce lieu
// expire cette Nuit, elle survit sans compter dans le nombre de Survivants.
definePlace('LIE-07', {
  forbids(ctx, cand) {
    if (cand.slot !== ctx.slot) return null;
    return cand.action === 'deploy' ? 'Bastion Scellé : aucun déploiement ici.' : null;
  },
  *onControl(ctx) {
    const pick = yield* askCard(ctx, 'Cette carte survivra hors quota si le lieu expire cette Nuit.',
      mine(ctx), { optional: true });
    if (pick) ctx.grantFreeSurvivor(ctx.slot, pick.id);
  },
});

// Ruines des Hommes de Jadis — les Artefacts de Jadis sont mélangés au deck de
// marché. Contrôle : regardez la première carte du deck de marché.
definePlace('LIE-08', {
  *onControl(ctx) {
    const top = ctx.marketTop();
    if (!top) return;
    const mode = yield ctx.pickMode(ctx.player,
      `Première carte du marché : ${ctx.face_(top)?.name}.`,
      [{ value: 'top', label: 'Laisser au-dessus' }, { value: 'bottom', label: 'Placer dessous' }]);
    if (mode === 'bottom') ctx.marketDeckToBottom(top);
  },
});

// Grande Route de Cirelion — à l'expiration, avant les Survivants, chaque
// joueur peut déplacer 1 carte alliée vers un lieu adjacent ; ces cartes ne
// comptent pas comme Survivantes. Contrôle : déplacez une carte alliée d'ici
// vers un lieu adjacent, ou d'un lieu adjacent vers ici.
definePlace('LIE-13', {
  *onExpiring(ctx) {
    const options = ctx.adjacent(ctx.slot);
    if (!options.length) return;
    for (const p of ctx.players()) {
      const movable = mine(ctx, p.index).filter(c => !c.flags.immobile);
      if (!movable.length) continue;
      const pick = yield* askCard(ctx, 'Grande Route — évacuer une carte vers un lieu adjacent ?',
        movable, { player: p.index, optional: true });
      if (!pick) continue;
      const dest = yield ctx.pickSlot(p.index, 'Vers quel lieu adjacent ?', options);
      if (dest !== null && dest !== undefined) yield* ctx.moveToSlot(pick, dest, REASON.MOVE);
    }
  },
  *onControl(ctx) {
    const options = ctx.adjacent(ctx.slot);
    if (!options.length) return;
    const inbound = options.flatMap(s => ctx.cardsOn(s))
      .filter(c => (c.controller ?? c.owner) === ctx.player && !c.flags.immobile);
    const outbound = mine(ctx).filter(c => !c.flags.immobile);
    const pick = yield* askCard(ctx, 'Grande Route — quelle carte alliée déplacer ?',
      [...outbound, ...inbound], { optional: true });
    if (!pick) return;
    if (pick.slot === ctx.slot) {
      const dest = yield ctx.pickSlot(ctx.player, 'Vers quel lieu adjacent ?', options);
      if (dest !== null && dest !== undefined) yield* ctx.moveToSlot(pick, dest, REASON.MOVE);
    } else {
      yield* ctx.moveToSlot(pick, ctx.slot, REASON.MOVE);
    }
  },
});

// Mines du Rideau — pour chaque joueur, la première fois chaque Jour qu'une
// carte qu'il contrôle rejoint ce lieu, il gagne 1 or dans sa réserve.
// Contrôle : gagnez 1 or dans votre réserve.
definePlace('LIE-14', {
  *onEnterPlace(ctx, { inst, slot }) {
    if (slot !== ctx.slot) return;
    const player = inst.controller ?? inst.owner;
    if (player === null || player === undefined) return;
    const key = `day:mines:${ctx.slot}:${player}`;
    if (ctx.state.flags[key]) return;
    ctx.engine.setFlag('game', key, true);
    yield* ctx.gain(player, 1, POT.RESERVE);
  },
  *onControl(ctx) {
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});
