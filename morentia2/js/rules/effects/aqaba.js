// Aqaba — or, marché et manipulation des coûts.

import { defineCard } from '../registry.js';
import {
  POT, UNTIL, KIND, selfAura, alliedInPlay, askCard, askYes,
  peekMarketDeck, drawThenDiscard, recycleMarket, cappedX,
} from './helpers.js';

// À l'Aube, gagnez 2 ors actifs.
// La première fois chaque Jour que vous achetez une carte du marché, gagnez
// 1 or dans votre réserve.
defineCard('AQA-BASE', {
  *onDawn(ctx) {
    yield* ctx.gain(ctx.player, ctx.state.config.dawnGold ?? 2, POT.ACTIVE);
  },
  *onBought(ctx, { player }) {
    if (player !== ctx.player) return;
    if (!ctx.once('base')) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// Lorsque cette carte est jouée, vous pouvez payer X ors. Elle gagne
// +X influence. X ne peut pas dépasser 3.
defineCard('AQA-01', {
  *onPlay(ctx) {
    const max = cappedX(ctx, 3);
    if (max <= 0) return;
    const x = yield ctx.pickNumber(ctx.player, 'Payez X ors pour +X influence (maximum 3).', 0, max);
    if (!x) return;
    yield* ctx.pay(ctx.player, x);
    yield* ctx.addInfluence(ctx.inst, x);
  },
});

// Action — Une fois par Jour, vous pouvez payer 1 or. Une carte alliée gagne
// +1 influence jusqu'à la prochaine Aube.
defineCard('AQA-02', {
  actions(ctx) {
    return [{
      label: 'Renforcer une carte alliée (+1 jusqu’à l’Aube)',
      cost: 1,
      available: !ctx.inst.flags['day:caravane'],
      *run(c) {
        c.flag('day:caravane', true);
        const mine = alliedInPlay(c);
        const target = yield* askCard(c, 'Quelle carte alliée renforcer ?', mine);
        if (target) yield* c.addInfluence(target, 1, UNTIL.DAWN);
      },
    }];
  },
});

// Lorsque cette carte est jouée, vous pouvez payer 2 ors. Si vous le faites,
// révélez la première carte du deck de marché. Si elle peut être légalement
// jouée, jouez-la immédiatement gratuitement, dans une zone légale de votre
// choix, sans dépenser d'action supplémentaire. Sinon, placez-la sous le deck.
defineCard('AQA-03', {
  *onPlay(ctx) {
    if (ctx.state.players[ctx.player].active < 2) return;
    if (!(yield* askYes(ctx, 'Payer 2 ors pour révéler la première carte du marché ?'))) return;
    yield* ctx.pay(ctx.player, 2);
    const top = ctx.marketTop();
    if (!top) return;
    const face = ctx.face_(top);
    ctx.note(`Révélé : ${face?.name}.`);
    const placed = yield* playForFree(ctx, top, face);
    if (!placed) {
      ctx.marketDeckToBottom(top);
      ctx.note('Carte injouable : elle passe sous le deck de marché.');
    }
  },
});

/** Joue gratuitement une carte révélée, si une zone légale existe. */
function* playForFree(ctx, inst, face) {
  const slots = ctx.slots().map(s => s.index);
  const targets = [];
  if (face.kind === KIND.UNIT || face.kind === KIND.PERMANENT) targets.push({ value: 'domain', label: 'Votre domaine' });
  if (face.kind === KIND.UNIT) for (const s of slots) targets.push({ value: `place:${s}`, label: `Lieu ${s + 1}`, slot: s });
  if (face.kind === KIND.PLACE_ATTACHMENT) for (const s of slots) targets.push({ value: `place:${s}`, label: `Lieu ${s + 1}`, slot: s });
  if (face.kind === KIND.UNIT_ATTACHMENT) {
    for (const s of slots) {
      for (const host of ctx.cardsOn(s)) {
        if (host.attachedTo || ctx.face_(host)?.kind !== KIND.UNIT) continue;
        targets.push({ value: `unit:${host.id}`, label: ctx.face_(host)?.name, inst: host.id, slot: s });
      }
    }
  }
  if (face.kind === KIND.EPHEMERAL) targets.push({ value: 'resolve', label: 'Résoudre l’effet' });
  if (!targets.length) return false;

  const choice = yield ctx.choose({
    kind: 'mode', player: ctx.player,
    prompt: `Où jouer ${face.name} gratuitement ?`, options: targets, min: 1, max: 1,
  });
  if (!choice) return false;

  ctx.engine.emit({ t: 'own', inst: inst.id, owner: ctx.player, controller: ctx.player });
  if (choice === 'domain') { yield* ctx.toDomain(inst, { exhausted: true, player: ctx.player }); return true; }
  if (choice === 'resolve') { yield* ctx.engine.playEphemeralFree(inst, ctx.player); return true; }
  if (choice.startsWith('place:')) { yield* ctx.moveToSlot(inst, Number(choice.slice(6))); return true; }
  if (choice.startsWith('unit:')) {
    const host = ctx.state.cards[choice.slice(5)];
    yield* ctx.moveToSlot(inst, host.slot);
    yield* ctx.attach(inst, host);
    return true;
  }
  return false;
}

// La première fois chaque Jour que cette carte fait perdre le contrôle d'un
// lieu à un adversaire, prenez-lui 1 or actif et placez-le dans votre réserve.
defineCard('AQA-04', {
  *onControlChanged(ctx, { slot, from, to }) {
    if (ctx.inst.slot !== slot) return;
    if (to !== ctx.player || from === null || from === ctx.player) return;
    if (!ctx.once('singe')) return;
    const victim = ctx.state.players[from];
    if (victim.active <= 0) { ctx.note('L’adversaire n’a pas d’or actif : rien ne se passe.'); return; }
    ctx.engine.emit({ t: 'gold', player: from, delta: -1, pot: POT.ACTIVE });
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// Lorsque cette carte rejoint un lieu, regardez la première carte du deck de
// marché. Vous pouvez la laisser au-dessus du deck ou la placer sous le deck.
defineCard('AQA-05', {
  *onEnterPlace(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    yield* peekMarketDeck(ctx);
  },
});

// Les cartes adverses ayant 5 influence ou plus ont -2 influence sur ce lieu.
defineCard('AQA-06', {
  // Exprimé en `finalize` et non en aura : le seuil porte sur l'influence déjà
  // calculée, ce qu'une aura ne peut pas lire sans boucler sur elle-même.
  finalize(ctx, target, value) {
    if (ctx.inst.slot === null || ctx.inst.slot === undefined) return value;
    if (target.slot !== ctx.inst.slot || target.attachedTo) return value;
    if (target.controller === (ctx.inst.controller ?? ctx.inst.owner)) return value;
    return value >= 5 ? value - 2 : value;
  },
});

// Lorsque le lieu sur lequel cette carte est présente expire, si vous le
// contrôlez, choisissez une unité adverse présente sur ce lieu ayant
// 3 influence imprimée ou moins. Au lieu de la détruire, placez-la dans votre
// domaine, épuisée, sous votre contrôle.
defineCard('AQA-07', {
  *onPlaceExpiring(ctx, { slot }) {
    if (ctx.inst.slot !== slot) return;
    if (ctx.controllerOf(slot) !== ctx.player) return;
    const prey = ctx.cardsOn(slot).filter(c =>
      (c.controller ?? c.owner) !== ctx.player && ctx.isUnit(c) && ctx.printed(c) <= 3);
    const pick = yield* askCard(ctx, 'Capturez une unité adverse (3 influence imprimée ou moins).',
      prey, { optional: true });
    if (!pick) return;
    yield* ctx.toDomain(pick, { exhausted: true, player: ctx.player });
    ctx.note(`${ctx.face_(pick)?.name} est capturé.`);
  },
});

// À l'Aube, choisissez un effet jusqu'à la prochaine Aube :
// • Les cartes du marché coûtent 1 or de moins à tous les joueurs, minimum 1.
// • Les cartes du marché coûtent 1 or de plus à tous les joueurs.
defineCard('AQA-08', {
  *onDawn(ctx) {
    const mode = yield ctx.pickMode(ctx.player, 'Banque Centrale — orientation du marché :', [
      { value: 'cheap', label: 'Marché moins cher (−1, minimum 1)' },
      { value: 'dear', label: 'Marché plus cher (+1)' },
    ]);
    ctx.flag('day:bank', mode);
  },
  costFor(ctx, cand) {
    if (cand.action !== 'buy') return 0;
    const mode = ctx.inst.flags['day:bank'];
    if (mode === 'cheap') return { delta: -1, floor: 1 };
    if (mode === 'dear') return { delta: 1 };
    return 0;
  },
});

// Chaque joueur ne peut jouer ou déployer qu'une seule carte sur ce lieu
// chaque Jour.
defineCard('AQA-09', {
  forbids(ctx, cand) {
    if (cand.slot !== ctx.inst.slot) return null;
    if (cand.action !== 'play' && cand.action !== 'deploy' && cand.action !== 'buy'
      && cand.action !== 'attach') return null;
    const n = ctx.state.flags[`day:placed:${cand.player}:${cand.slot}`] || 0;
    return n >= 1 ? 'Tempête de Sable : une seule carte par Jour sur ce lieu.' : null;
  },
});

// Lorsque cette carte est jouée, vous pouvez placer une carte visible du marché
// sous le deck de marché. Remplacez-la immédiatement.
defineCard('AQA-10', {
  *onPlay(ctx) {
    yield* recycleMarket(ctx);
  },
});

// Lorsque cette carte rejoint votre domaine, piochez la première carte du deck
// de marché et ajoutez-la à votre main.
defineCard('AQA-11', {
  *onEnterDomain(ctx, { inst, player }) {
    if (inst.id !== ctx.inst.id) return;
    const top = ctx.marketTop();
    if (!top) return;
    yield* ctx.toHand(top, player);
    ctx.note(`${ctx.face_(top)?.name} rejoint la main depuis le deck de marché.`);
  },
});

// La première fois chaque Jour qu'un effet place de l'or dans votre réserve,
// placez-y 1 or supplémentaire.
defineCard('AQA-12', {
  onReserveGain(ctx, { player, amount }) {
    if (player !== ctx.player || amount <= 0) return amount;
    if (!ctx.once('investisseur')) return amount;
    return amount + 1;
  },
});

// Tant qu'au moins un Attachement de lieu est attaché à ce lieu, cette carte
// gagne +1 influence.
defineCard('AQA-13', {
  aura: selfAura(ctx => {
    if (ctx.inst.slot === null || ctx.inst.slot === undefined) return 0;
    const hasAttachment = ctx.state.slots[ctx.inst.slot].cards
      .map(id => ctx.state.cards[id])
      .some(c => ctx.catalog.byId.get(c.faceId)?.kind === KIND.PLACE_ATTACHMENT);
    return hasAttachment ? 1 : 0;
  }),
});

// La première fois chaque Jour qu'un adversaire achète une carte du marché,
// gagnez 1 or dans votre réserve.
defineCard('AQA-14', {
  *onBought(ctx, { player }) {
    if (player === ctx.player) return;
    if (!ctx.once('collecteur')) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});

// Regardez les deux premières cartes de votre deck. Ajoutez-en une à votre main
// et placez l'autre sous votre deck.
defineCard('AQA-15', {
  *onPlay(ctx) {
    const top = ctx.deckTop(ctx.player, 2);
    if (!top.length) return;
    const pick = yield* askCard(ctx, 'Ajoutez une de ces cartes à votre main.', top);
    for (const c of top) {
      if (pick && c.id === pick.id) yield* ctx.toHand(c, ctx.player);
      else ctx.deckToBottom(c);
    }
  },
});

// Une carte alliée gagne +2 influence jusqu'à la prochaine Aube.
defineCard('AQA-16', {
  *onPlay(ctx) {
    const target = yield* askCard(ctx, 'Quelle carte alliée gagne +2 influence ?', alliedInPlay(ctx));
    if (target) yield* ctx.addInfluence(target, 2, UNTIL.DAWN);
  },
});

// La première fois chaque Jour que vous achetez une carte du marché, piochez
// une carte puis défaussez une carte.
defineCard('AQA-17', {
  *onBought(ctx, { player }) {
    if (player !== ctx.player) return;
    if (!ctx.once('negociant')) return;
    yield* drawThenDiscard(ctx);
  },
});

// Lorsque cette carte rejoint un lieu, vous pouvez payer X ors. Détruisez une
// carte adverse présente sur ce lieu ayant X influence ou moins. X ≤ 4.
defineCard('AQA-18', {
  *onEnterPlace(ctx, { inst, slot }) {
    if (inst.id !== ctx.inst.id) return;
    const max = cappedX(ctx, 4);
    if (max <= 0) return;
    const x = yield ctx.pickNumber(ctx.player, 'Payez X ors pour détruire une carte adverse (X ≤ 4).', 0, max);
    if (!x) return;
    const prey = ctx.cardsOn(slot).filter(c =>
      (c.controller ?? c.owner) !== ctx.player && ctx.influence(c) <= x);
    if (!prey.length) { ctx.note('Aucune cible à portée.'); return; }
    yield* ctx.pay(ctx.player, x);
    const pick = yield* askCard(ctx, `Détruisez une carte adverse ayant ${x} influence ou moins.`, prey);
    if (pick) yield* ctx.destroy(pick);
  },
});

// Choisissez une carte adverse. Elle perd X influence jusqu'à la prochaine
// Aube. X ne peut pas dépasser 3.
defineCard('AQA-19', {
  *onPlay(ctx) {
    const x = Math.min(3, ctx.inst.flags.x ?? 0);
    if (!x) return;
    const prey = ctx.allInPlay().filter(c =>
      (c.controller ?? c.owner) !== ctx.player && c.zone !== 'base' && ctx.influence(c) > 0);
    const pick = yield* askCard(ctx, `Une carte adverse perd ${x} influence jusqu’à l’Aube.`, prey);
    if (pick) yield* ctx.addInfluence(pick, -x, UNTIL.DAWN);
  },
});

// Cette carte gagne +1 influence pour chaque tranche complète de 2 ors dans
// votre réserve, avec un maximum de +3.
defineCard('AQA-20', {
  aura: selfAura(ctx => {
    const reserve = ctx.state.players[ctx.inst.controller ?? ctx.inst.owner]?.reserve ?? 0;
    return Math.min(3, Math.floor(reserve / 2));
  }),
});

// Lorsque cette carte rejoint un lieu, vous pouvez payer 1 or. Si vous le
// faites, elle gagne +1 influence jusqu'à la prochaine Aube.
defineCard('AQA-21', {
  *onEnterPlace(ctx, { inst }) {
    if (inst.id !== ctx.inst.id) return;
    if (ctx.state.players[ctx.player].active < 1) return;
    if (!(yield* askYes(ctx, 'Payer 1 or pour +1 influence jusqu’à l’Aube ?'))) return;
    yield* ctx.pay(ctx.player, 1);
    yield* ctx.addInfluence(ctx.inst, 1, UNTIL.DAWN);
  },
});

// Lorsque vous remportez la Guerre, gagnez 1 or supplémentaire dans votre
// réserve.
defineCard('AQA-22', {
  *onWarResolved(ctx, { winners }) {
    if (!winners.includes(ctx.player)) return;
    yield* ctx.gain(ctx.player, 1, POT.RESERVE);
  },
});
