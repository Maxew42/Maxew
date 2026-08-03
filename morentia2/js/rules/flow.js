// Déroulement d'une partie : mise en place, enchaînement des phases et
// actions de Journée. Tout est écrit sous forme de générateurs pour qu'un
// choix de joueur puisse interrompre n'importe quelle étape.

import { ZONE, PHASE, POT, UNTIL, REASON, ORDERS } from './constants.js';
import {
  shuffled, faceOf, placeRecord, cardsOnSlot, liveSlots, costOf,
  deployCost, restrictions, domainInfluence, rankSlot, influenceOf,
} from './state.js';
import { effectsOf, placeEffectsOf } from './registry.js';
import { KIND } from '../data/schema.js';
import { baseCard, factionDeck, marketDeck, placeDeck } from '../data/catalog.js';

// -------------------------------------------------------------- mise en place

function createInstance(engine, cardId, owner) {
  const id = engine.nextInstId();
  engine.emit({ t: 'create', inst: id, cardId, owner, controller: owner });
  return id;
}

export function* setupGame(engine) {
  const { state, catalog } = engine;
  const cfg = state.config;

  engine.emit({ t: 'phase', phase: PHASE.SETUP, day: 0 });

  // Bases et decks de faction.
  for (const p of state.players) {
    const base = baseCard(catalog, p.faction);
    if (base) {
      const id = createInstance(engine, base.id, p.index);
      engine.emit({ t: 'move', inst: id, to: { zone: ZONE.BASE, player: p.index }, reason: REASON.SETUP });
    }
    const ids = factionDeck(catalog, p.faction).map(cardId => createInstance(engine, cardId, p.index));
    for (const id of shuffled(ids, engine.rng)) {
      engine.emit({ t: 'move', inst: id, to: { zone: ZONE.DECK, player: p.index }, reason: REASON.SETUP });
    }
    engine.emit({ t: 'gold', player: p.index, delta: cfg.startingGold, pot: POT.ACTIVE });
    if (p.faction === 'kalassir') {
      engine.emit({ t: 'flag', scope: p.index, key: 'order', value: ORDERS[0] });
    }
  }

  // Deck de marché.
  const marketIds = marketDeck(catalog, { includeOptional: cfg.includeOptional })
    .map(cardId => createInstance(engine, cardId, null));
  for (const id of shuffled(marketIds, engine.rng)) {
    engine.emit({ t: 'move', inst: id, to: { zone: ZONE.MARKET_DECK }, reason: REASON.SETUP });
  }

  // Deck de lieux et révélation des emplacements.
  state.placeDeck.push(...shuffled(placeDeck(catalog, { includeOptional: cfg.includeOptional }), engine.rng));
  for (const slot of state.slots) yield* revealPlace(engine, slot.index);

  // Marché visible.
  const marketSize = state.players.length + cfg.marketExtra;
  for (let i = 0; i < marketSize; i++) yield* refillMarket(engine);

  // Mains de départ et mulligan.
  for (const p of state.players) yield* engine.draw(p.index, cfg.startingHand);
  if (cfg.mulligans > 0) {
    for (const p of state.players) {
      // Mulligan de la feuille « À lire » : une seule refonte gratuite de la
      // main de départ. On montre les cartes concernées avec la question.
      const keep = yield {
        ...engine.ctx(null, { player: p.index }).confirm(
          p.index,
          'Mulligan — vous pouvez refaire votre main de départ une fois. Gardez-vous ces cartes ?'),
        preview: p.hand.slice(),
      };
      if (keep === false) {
        const hand = p.hand.slice();
        for (const id of hand) {
          engine.emit({ t: 'move', inst: id, to: { zone: ZONE.DECK, player: p.index }, reason: REASON.SETUP });
        }
        const order = shuffled(state.players[p.index].deck.slice(), engine.rng);
        engine.emit({ t: 'order', zone: ZONE.DECK, player: p.index, order });
        yield* engine.draw(p.index, cfg.startingHand);
        engine.emit({ t: 'note', text: `${p.name} refait sa main.`, kind: 'mulligan' });
      }
    }
  }

  yield* gameLoop(engine);
}

/** Révèle un lieu sur un emplacement vide. */
function* revealPlace(engine, slotIndex) {
  const { state, catalog } = engine;
  if (!state.placeDeck.length) {
    if (!state.placeDiscard.length) return;
    // Réserve de lieux épuisée : les lieux expirés sont remis en jeu, mélangés.
    engine.emit({ t: 'placeDeckRefill', order: shuffled(state.placeDiscard.slice(), engine.rng) });
    engine.emit({ t: 'note', text: 'Le deck de lieux est reconstitué.', kind: 'shuffle' });
  }
  const placeId = state.placeDeck.shift();
  if (!placeId) return;
  const rec = catalog.placeById.get(placeId);
  engine.emit({
    t: 'placeIn', slot: slotIndex, placeId,
    duration: typeof rec?.duration === 'number' ? rec.duration : null,
  });
  yield* engine.signal('placeRevealed', { slot: slotIndex, placeId });
}

/** Complète le marché depuis son deck. */
function* refillMarket(engine) {
  const { state } = engine;
  const id = state.market.deck[0];
  if (!id) return null;
  engine.emit({ t: 'move', inst: id, to: { zone: ZONE.MARKET }, reason: REASON.SETUP });
  return state.cards[id];
}

// ------------------------------------------------------------- boucle de jeu

function* gameLoop(engine) {
  const { state } = engine;
  while (state.phase !== PHASE.GAME_OVER) {
    yield* dawn(engine);
    yield* day(engine);
    yield* dusk(engine);
    yield* war(engine);
    yield* night(engine);
    if (state.phase === PHASE.GAME_OVER) break;
    yield* endOfDay(engine);
  }
}

// ------------------------------------------------------------------- Aube

function* dawn(engine) {
  const { state } = engine;
  engine.emit({ t: 'phase', phase: PHASE.DAWN, day: state.day + 1 });

  // Les limites journalières redeviennent disponibles ; les bonus temporaires
  // accordés « jusqu'à la prochaine Aube » expirent.
  engine.emit({ t: 'clearFlags', prefix: 'day:' });
  engine.emit({ t: 'clearMods', until: UNTIL.DAWN });
  for (const p of state.players) {
    if (p.asleep) engine.emit({ t: 'sleep', player: p.index, value: false });
  }

  for (const p of orderedPlayers(state)) {
    // La réserve rejoint l'or actif avant les autres effets d'Aube.
    if (p.reserve > 0) engine.emit({ t: 'reserveToActive', player: p.index });
    for (const id of [...p.domain, ...allSlotCards(state, p.index)]) {
      if (state.cards[id]?.exhausted) engine.emit({ t: 'exhaust', inst: id, value: false });
    }
    if (state.config.drawAtDawn !== 0) yield* engine.draw(p.index, state.config.drawAtDawn ?? 1);
  }

  yield* engine.phaseHooks('onDawn');
}

// --------------------------------------------------------------- Journée

function* day(engine) {
  const { state } = engine;
  engine.emit({ t: 'phase', phase: PHASE.DAY });
  engine.emit({ t: 'turn', player: state.firstPlayer });

  let guard = 0;
  while (state.players.some(p => !p.asleep)) {
    if (++guard > 500) break;   // filet de sécurité contre une boucle bloquée
    const cur = state.activePlayer;
    if (state.players[cur].asleep) { advanceTurn(engine); continue; }
    engine.awaitingAction = true;
    yield { req: 'awaitAction' };
    engine.awaitingAction = false;
    advanceTurn(engine);
  }
}

function advanceTurn(engine) {
  const { state } = engine;
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const idx = (state.activePlayer + k) % n;
    if (!state.players[idx].asleep) {
      engine.emit({ t: 'turn', player: idx });
      return;
    }
  }
}

// ------------------------------------------------------------- Crépuscule

function* dusk(engine) {
  const { state, catalog } = engine;
  engine.emit({ t: 'phase', phase: PHASE.DUSK });
  yield* engine.phaseHooks('onDusk');

  // Le Nocturne fait rejouer les effets de Crépuscule de son lieu.
  for (const slot of state.slots) {
    const extra = slot.flags.duskExtra;
    if (extra) yield* engine.duskExtraPass(slot.index, extra);
  }

  yield* engine.syncControl();

  // Effets de contrôle : une seule résolution par lieu contrôlé, sauf effet
  // qui en accorde une supplémentaire (Cœur des Sources Bouillantes).
  for (const slot of state.slots) {
    if (!slot.placeId || slot.expired || slot.controller === null) continue;
    if (slot.flags.timeless) continue;
    yield* resolveControlEffect(engine, slot.index);
  }
}

export function* resolveControlEffect(engine, slotIndex) {
  const { state } = engine;
  const slot = state.slots[slotIndex];
  const spec = placeEffectsOf(slot.placeId);
  if (typeof spec.onControl !== 'function') return;
  let repeats = 1;
  repeats = yield* engine.signalModify('controlRepeats', { slot: slotIndex, player: slot.controller, repeats }, 'repeats');
  for (let i = 0; i < repeats; i++) {
    const blocked = yield* engine.signalReplace('blockControlEffect', { slot: slotIndex, player: slot.controller });
    if (blocked) return;
    yield* wrapCall(spec.onControl, engine.ctx(null, { slot: slotIndex, player: slot.controller }));
  }
}

// ------------------------------------------------------------------ Guerre

function* war(engine) {
  const { state, catalog } = engine;
  engine.emit({ t: 'phase', phase: PHASE.WAR });
  if (!state.config.domainInfluenceWar) return;

  const scores = state.players.map(p => ({
    player: p.index,
    value: domainInfluence(state, catalog, p.index),
  }));
  const best = Math.max(...scores.map(s => s.value));
  const winners = scores.filter(s => s.value === best).map(s => s.player);
  const losers = scores.filter(s => s.value < best).map(s => s.player);

  engine.emit({
    t: 'note', kind: 'war',
    text: `Guerre — ${scores.map(s => `${state.players[s.player].name} ${s.value}`).join(' · ')}`,
  });

  for (const w of winners) {
    // Récolte Sanguine peut échanger cet or contre une pioche.
    const replaced = yield* engine.signalReplace('replaceWarGold', { player: w });
    if (!replaced) yield* engine.gain(w, 1, POT.RESERVE);
  }
  for (const l of losers) {
    if (state.players[l].active > 0) {
      engine.emit({ t: 'gold', player: l, delta: -1, pot: POT.ACTIVE });
    }
  }
  yield* engine.signal('warResolved', { winners, losers, scores, best });
}

// -------------------------------------------------------------------- Nuit

function* night(engine) {
  const { state, catalog } = engine;
  engine.emit({ t: 'phase', phase: PHASE.NIGHT });
  yield* engine.phaseHooks('onNight');

  // Durées et seuils.
  const expiring = [];
  for (const slot of state.slots) {
    if (!slot.placeId || slot.expired) continue;
    const rec = placeRecord(catalog, slot);
    if (typeof slot.duration === 'number') {
      engine.emit({ t: 'duration', slot: slot.index, delta: -1 });
      if (state.slots[slot.index].duration <= 0) expiring.push(slot.index);
    } else if (rec?.isMonster) {
      const total = state.players.reduce(
        (n, p) => n + cardsOnSlot(state, slot.index)
          .filter(c => c.controller === p.index && !c.attachedTo)
          .reduce((m, c) => m + influenceOf(state, catalog, c, 'control'), 0), 0);
      const threshold = monsterThreshold(rec, state.players.length);
      if (threshold !== null && total >= threshold) {
        engine.emit({ t: 'note', text: `${rec.name} est vaincu.`, kind: 'monster' });
        expiring.push(slot.index);
      }
    }
  }

  for (const idx of expiring) yield* expirePlace(engine, idx);

  if (state.expiredCount >= state.endTarget || (state.config.dayLimit && state.day >= state.config.dayLimit)) {
    // Nuit finale : tous les lieux encore actifs expirent avant le décompte.
    for (const slot of liveSlots(state).map(s => s.index)) {
      yield* expirePlace(engine, slot, { final: true });
    }
    yield* finishGame(engine);
  }
}

/** Seuil d'un monstre, exprimé en multiple du nombre de joueurs. */
function monsterThreshold(rec, playerCount) {
  const m = /(\d+)\s*×?\s*(?:x\s*)?(?:nombre de )?joueurs?/i.exec(rec.threshold || '');
  if (m) return Number(m[1]) * playerCount;
  const n = Number(rec.threshold);
  return Number.isFinite(n) ? n : null;
}

export function* expirePlace(engine, slotIndex, { final = false } = {}) {
  const { state, catalog } = engine;
  const slot = state.slots[slotIndex];
  if (!slot.placeId || slot.expired) return;
  const rec = placeRecord(catalog, slot);
  const spec = placeEffectsOf(slot.placeId);

  engine.emit({ t: 'note', text: `${rec?.name || 'Lieu'} expire.`, kind: 'expire' });

  // Effets déclenchés à l'expiration, avant le choix des Survivants.
  yield* engine.signal('placeExpiring', { slot: slotIndex });
  if (typeof spec.onExpiring === 'function') {
    yield* wrapCall(spec.onExpiring, engine.ctx(null, { slot: slotIndex }));
  }

  // Récompenses de Victoire.
  if (typeof spec.onVictory === 'function') {
    yield* wrapCall(spec.onVictory, engine.ctx(null, { slot: slotIndex }));
  } else if (rec?.vpTable) {
    for (const s of rankSlot(state, catalog, slotIndex)) {
      const gain = rec.vpTable[s.rank - 1] ?? 0;
      if (gain > 0) engine.emit({ t: 'vp', player: s.player, delta: gain, reason: `${rec.name} — ${s.rank}ᵉ` });
    }
  }

  // Survivants : chaque joueur retient jusqu'à N de ses cartes.
  const quota = survivorQuota(engine, slotIndex);
  const saved = new Set(slot.flags.freeSurvivors || []);
  for (const p of orderedPlayers(state)) {
    const mine = cardsOnSlot(state, slotIndex)
      .filter(c => c.controller === p.index && !c.attachedTo && !saved.has(c.id));
    if (!mine.length) continue;
    let picks = [];
    if (quota > 0) {
      const answer = yield engine.ctx(null, { player: p.index }).pickCard(
        p.index,
        `${rec?.name || 'Le lieu'} expire — retenez jusqu’à ${quota} carte(s) survivante(s).`,
        mine, { optional: true, max: Math.min(quota, mine.length) });
      picks = toArray(answer);
    }
    for (const id of picks) saved.add(id);
  }

  // Les Survivants rejoignent le domaine, épuisés ; le reste est détruit.
  for (const inst of cardsOnSlot(state, slotIndex).slice()) {
    if (inst.attachedTo) continue;
    if (saved.has(inst.id)) {
      yield* engine.toDomain(inst, { exhausted: true, reason: REASON.SURVIVE });
    } else {
      const kept = yield* engine.signalReplace('keepOnExpiry', { inst, slot: slotIndex });
      if (!kept) yield* engine.destroy(inst, { byEffect: false });
    }
  }
  // Les attachements de lieu sont défaussés avec lui.
  for (const inst of cardsOnSlot(state, slotIndex).slice()) {
    if (faceOf(catalog, inst)?.kind === KIND.PLACE_ATTACHMENT) yield* engine.discardCard(inst);
  }

  engine.emit({ t: 'expire', slot: slotIndex, placeId: slot.placeId });
  yield* engine.signal('placeExpired', { slot: slotIndex, placeId: slot.placeId });

  if (!final) {
    yield* revealPlace(engine, slotIndex);
  } else {
    engine.emit({ t: 'placeIn', slot: slotIndex, placeId: null, duration: null });
  }
}

/** Nombre de Survivants d'un lieu, attachements compris (Carnage, Refuge). */
export function survivorQuota(engine, slotIndex) {
  const { state, catalog } = engine;
  const slot = state.slots[slotIndex];
  const rec = placeRecord(catalog, slot);
  let n = typeof rec?.survivors === 'number' ? rec.survivors : 0;
  for (const inst of cardsOnSlot(state, slotIndex)) {
    const mod = effectsOf(inst.faceId).survivorMod;
    if (typeof mod === 'number') n += mod;
  }
  return Math.max(0, n);
}

// ------------------------------------------------------------- Fin du Jour

function* endOfDay(engine) {
  const { state } = engine;
  engine.emit({ t: 'phase', phase: PHASE.END_OF_DAY });

  // Marché : sans achat pendant le Jour, la plus ancienne carte visible part
  // sous le deck et une nouvelle la remplace.
  if (!state.market.boughtToday && state.market.visible.length) {
    const oldest = state.market.visible[0];
    engine.emit({ t: 'move', inst: oldest, to: { zone: ZONE.MARKET_DECK, top: 'bottom' }, reason: REASON.DISCARD });
    yield* refillMarket(engine);
    engine.emit({ t: 'note', text: 'Marché renouvelé faute d’achat.', kind: 'market' });
  }
  engine.emit({ t: 'marketStale', value: false });

  const next = (state.firstPlayer + 1) % state.players.length;
  engine.emit({ t: 'firstPlayer', player: next });
}

function* finishGame(engine) {
  const { state } = engine;
  const ranked = state.players
    .map(p => ({ player: p.index, name: p.name, vp: p.vp, gold: p.active + p.reserve }))
    .sort((a, b) => b.vp - a.vp || b.gold - a.gold);
  engine.emit({ t: 'gameOver', result: { standings: ranked, winner: ranked[0]?.player ?? null } });
}

// ----------------------------------------------------------------- actions

/**
 * Actions possibles pour un joueur au moment présent. Sert à l'interface
 * (surbrillance des cibles) comme à l'IA.
 */
export function legalActions(state, catalog, playerIndex) {
  const out = [];
  if (state.phase !== PHASE.DAY || state.activePlayer !== playerIndex) return out;
  const p = state.players[playerIndex];
  if (p.asleep) return out;

  for (const id of p.hand) {
    const inst = state.cards[id];
    const face = faceOf(catalog, inst);
    if (!face) continue;
    for (const dest of destinationsFor(face)) {
      if (dest === 'domain') {
        const cost = costOf(state, catalog, { inst, face, player: playerIndex, dest: 'domain', slot: null, action: 'play' });
        if (cost !== null && p.active >= cost) out.push({ type: 'play', inst: id, dest: 'domain', cost });
      } else if (dest === 'place') {
        for (const slot of liveSlots(state)) {
          const cand = { inst, face, player: playerIndex, dest: 'place', slot: slot.index, action: 'play' };
          const cost = costOf(state, catalog, cand);
          if (cost === null || p.active < cost) continue;
          if (restrictions(state, catalog, cand).length) continue;
          out.push({ type: 'play', inst: id, dest: 'place', slot: slot.index, cost });
        }
      } else if (dest === 'attachUnit') {
        for (const slot of liveSlots(state)) {
          for (const target of cardsOnSlot(state, slot.index)) {
            if (target.attachedTo || faceOf(catalog, target)?.kind !== KIND.UNIT) continue;
            const cand = { inst, face, player: playerIndex, dest: 'place', slot: slot.index, action: 'attach', target };
            const cost = costOf(state, catalog, cand);
            if (cost === null || p.active < cost) continue;
            out.push({ type: 'play', inst: id, dest: 'attachUnit', slot: slot.index, target: target.id, cost });
          }
        }
      } else if (dest === 'attachPlace') {
        for (const slot of liveSlots(state)) {
          const cand = { inst, face, player: playerIndex, dest: 'place', slot: slot.index, action: 'attach' };
          const cost = costOf(state, catalog, cand);
          if (cost === null || p.active < cost) continue;
          out.push({ type: 'play', inst: id, dest: 'attachPlace', slot: slot.index, cost });
        }
      } else if (dest === 'resolve') {
        const cost = costOf(state, catalog, { inst, face, player: playerIndex, dest: 'place', slot: null, action: 'play' });
        if (cost !== null && p.active >= cost) out.push({ type: 'play', inst: id, dest: 'resolve', cost });
      }
    }
  }

  // Achats : la carte du marché est jouée immédiatement.
  for (const id of state.market.visible) {
    const inst = state.cards[id];
    const face = faceOf(catalog, inst);
    if (!face) continue;
    for (const dest of destinationsFor(face)) {
      const slotList = dest === 'domain' || dest === 'resolve' ? [null] : liveSlots(state).map(s => s.index);
      for (const slot of slotList) {
        const cand = { inst, face, player: playerIndex, dest: dest === 'domain' ? 'domain' : 'place', slot, action: 'buy' };
        const cost = costOf(state, catalog, cand);
        if (cost === null || p.active < cost) continue;
        if (slot !== null && restrictions(state, catalog, cand).length) continue;
        if (dest === 'attachUnit') {
          for (const target of cardsOnSlot(state, slot)) {
            if (target.attachedTo || faceOf(catalog, target)?.kind !== KIND.UNIT) continue;
            out.push({ type: 'buy', inst: id, dest, slot, target: target.id, cost });
          }
        } else {
          out.push({ type: 'buy', inst: id, dest, slot, cost });
        }
      }
    }
  }

  // Déploiements : du domaine vers un lieu.
  const dcost = deployCost(state, playerIndex);
  if (p.active >= dcost) {
    for (const id of p.domain) {
      const inst = state.cards[id];
      const face = faceOf(catalog, inst);
      if (!face || face.kind !== KIND.UNIT) continue;
      if (inst.exhausted || inst.flags.arrivedDay === state.day) continue;
      for (const slot of liveSlots(state)) {
        const cand = { inst, face, player: playerIndex, dest: 'place', slot: slot.index, action: 'deploy' };
        if (restrictions(state, catalog, cand).length) continue;
        out.push({ type: 'deploy', inst: id, slot: slot.index, cost: dcost });
      }
    }
  }

  // Capacités « Action — ».
  for (const id of [...p.domain, ...allSlotCards(state, playerIndex)]) {
    const inst = state.cards[id];
    const spec = effectsOf(inst?.faceId);
    if (typeof spec.actions !== 'function') continue;
    const list = spec.actions({ state, catalog, inst, player: playerIndex }) || [];
    list.forEach((a, i) => {
      if (a.available === false) return;
      out.push({ type: 'activate', inst: id, index: i, label: a.label, cost: a.cost ?? 0 });
    });
  }

  // Conseil des Trois Ordres (Kalassir).
  if (p.faction === 'kalassir') {
    const free = !!p.flags.freeOrderChange;
    if (free || p.active >= 1) {
      for (const order of ORDERS) {
        if (order === p.flags.order) continue;
        out.push({ type: 'order', order, cost: free ? 0 : 1 });
      }
    }
  }

  out.push({ type: 'pass' });
  return out;
}

/** Destinations légales d'une carte selon sa famille. */
export function destinationsFor(face) {
  switch (face.kind) {
    case KIND.UNIT: return ['domain', 'place'];
    case KIND.PERMANENT: return ['domain'];
    case KIND.EPHEMERAL: return ['resolve'];
    case KIND.UNIT_ATTACHMENT: return ['attachUnit'];
    case KIND.PLACE_ATTACHMENT: return ['attachPlace'];
    default: return [];
  }
}

/** Exécute une action de Journée. Une action par tour. */
export function* performAction(engine, playerIndex, action) {
  const { state, catalog } = engine;
  const p = state.players[playerIndex];

  switch (action.type) {
    case 'pass':
      engine.emit({ t: 'sleep', player: playerIndex, value: true });
      engine.emit({ t: 'note', text: `${p.name} se couche.`, kind: 'pass' });
      return;

    case 'order': {
      const free = !!p.flags.freeOrderChange;
      if (!free) yield* engine.pay(playerIndex, 1);
      else engine.emit({ t: 'flag', scope: playerIndex, key: 'freeOrderChange', value: null });
      engine.emit({ t: 'flag', scope: playerIndex, key: 'order', value: action.order });
      engine.emit({ t: 'note', text: `${p.name} adopte ${action.order}.`, kind: 'order' });
      yield* engine.signal('orderChanged', { player: playerIndex, order: action.order });
      return;
    }

    case 'activate': {
      const inst = state.cards[action.inst];
      const spec = effectsOf(inst?.faceId);
      const list = spec.actions?.({ state, catalog, inst, player: playerIndex }) || [];
      const entry = list[action.index];
      if (!entry) return;
      if (entry.cost) yield* engine.pay(playerIndex, entry.cost);
      yield* wrapCall(entry.run, engine.ctx(inst, { player: playerIndex }));
      return;
    }

    case 'deploy': {
      const inst = state.cards[action.inst];
      const cost = deployCost(state, playerIndex);
      if (cost) yield* engine.pay(playerIndex, cost);
      engine.emit({
        t: 'flag', scope: playerIndex, key: 'deploysToday',
        value: (p.flags.deploysToday || 0) + 1,
      });
      yield* engine.moveToSlot(inst, action.slot, REASON.DEPLOY);
      yield* engine.signal('deployed', { inst, slot: action.slot, player: playerIndex });
      return;
    }

    case 'buy':
    case 'play': {
      const inst = state.cards[action.inst];
      const face = faceOf(catalog, inst);
      const dest = action.dest === 'domain' ? 'domain' : 'place';
      const cand = {
        inst, face, player: playerIndex, dest,
        slot: action.slot ?? null, action: action.type,
      };
      let cost = costOf(state, catalog, cand) ?? 0;

      // Coût X : le joueur choisit combien il investit.
      if (face.costUnique === 'X' || face.costDomain === 'X' || face.costLocation === 'X') {
        const max = Math.min(3, p.active);
        const x = yield engine.ctx(inst, { player: playerIndex }).pickNumber(
          playerIndex, `Choisissez X pour ${face.name} (or disponible : ${p.active}).`, 0, max);
        cost = Number(x) || 0;
        engine.emit({ t: 'flag', scope: inst.id, key: 'x', value: cost });
      }
      if (cost) yield* engine.pay(playerIndex, cost);

      if (action.type === 'buy') {
        engine.emit({ t: 'marketStale', value: true });
        engine.emit({ t: 'flag', scope: inst.id, key: 'bought', value: true });
      }
      // L'appropriation est un événement : les pairs rejouent le même flux.
      engine.emit({ t: 'own', inst: inst.id, owner: playerIndex, controller: playerIndex });

      yield* resolvePlay(engine, inst, playerIndex, action);

      if (action.type === 'buy') {
        yield* engine.signal('bought', { inst, player: playerIndex, cost });
        yield* refillMarket(engine);
      }
      return;
    }
    default:
      return;
  }
}

/** Met la carte jouée dans sa zone et déclenche ses effets d'arrivée. */
export function* resolvePlay(engine, inst, playerIndex, action) {
  const { catalog } = engine;
  const face = faceOf(catalog, inst);
  yield* engine.signal('played', { inst, player: playerIndex, dest: action.dest });

  const spec = effectsOf(inst.faceId);
  if (typeof spec.onPlay === 'function') {
    yield* wrapCall(spec.onPlay, engine.ctx(inst, { player: playerIndex, action }));
  }

  switch (action.dest) {
    case 'domain':
      yield* engine.toDomain(inst, { exhausted: true, player: playerIndex, reason: REASON.PLAY });
      break;
    case 'place':
      yield* engine.moveToSlot(inst, action.slot, REASON.PLAY);
      break;
    case 'attachUnit': {
      const host = engine.state.cards[action.target];
      yield* engine.moveToSlot(inst, action.slot, REASON.PLAY);
      yield* engine.attachTo(inst, host);
      break;
    }
    case 'attachPlace':
      yield* engine.moveToSlot(inst, action.slot, REASON.PLAY);
      break;
    case 'resolve':
      // Éphémère : l'effet a été résolu par onPlay, la carte part à la défausse.
      yield* engine.discardCard(inst);
      break;
    default:
      break;
  }
}

// --------------------------------------------------------------- utilitaires

function orderedPlayers(state) {
  const n = state.players.length;
  const out = [];
  for (let k = 0; k < n; k++) out.push(state.players[(state.firstPlayer + k) % n]);
  return out;
}

function allSlotCards(state, playerIndex) {
  const out = [];
  for (const slot of state.slots) {
    for (const id of slot.cards) {
      if (state.cards[id]?.controller === playerIndex) out.push(id);
    }
  }
  return out;
}

function toArray(v) {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function* wrapCall(fn, ctx, ...args) {
  if (typeof fn !== 'function') return undefined;
  const r = fn(ctx, ...args);
  if (r && typeof r.next === 'function') return yield* r;
  return r;
}

export { orderedPlayers, refillMarket, revealPlace, toArray, wrapCall };
