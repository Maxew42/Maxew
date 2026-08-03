// Construction de l'état et lectures dérivées.
//
// Rien ici ne modifie l'état : toutes les fonctions sont des sélecteurs purs,
// recalculés à la demande. L'influence conditionnelle (« tant que… ») est donc
// toujours juste, sans avoir à pister les changements.

import { ZONE, PHASE, DEFAULT_CONFIG, POT } from './constants.js';
import { effectsOf, placeEffectsOf } from './registry.js';
import { KIND, occupiesPlace } from '../data/schema.js';

/**
 * Effets actifs d'une instance. Héritier du Sang et Grand Imitateur copient les
 * effets d'une autre carte : le drapeau `day:copyOf` détourne la recherche sans
 * toucher au nom, à l'influence, aux types ni aux coûts, qui restent lus sur la
 * face imprimée.
 */
export function specFor(inst) {
  return effectsOf(inst?.flags?.['day:copyOf'] || inst?.faceId);
}

/**
 * Influence hors auras : imprimée plus modificateurs accumulés. Les effets qui
 * testent l'influence d'une autre carte s'en servent pour éviter une boucle
 * (une aura qui dépend d'une influence qui dépend de la même aura).
 */
export function rawInfluenceOf(state, catalog, inst) {
  if (!inst) return 0;
  const face = faceOf(catalog, inst);
  if (!face) return 0;
  const own = specFor(inst);
  const base = typeof own.printed === 'function'
    ? own.printed({ state, catalog, inst, face, purpose: 'raw' })
    : (typeof face.influence === 'number' ? face.influence : 0);
  let n = base;
  for (const m of inst.mods) n += m.delta;
  return Math.max(0, n);
}

// ------------------------------------------------------------ aléatoire semé

/** Générateur déterministe : même graine, même partie, chez tous les pairs. */
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

export function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ----------------------------------------------------------- création d'état

/**
 * État initial, avant la mise en place (qui est jouée par le moteur sous forme
 * d'événements pour que l'animation la montre).
 */
export function createState({ catalog, players, config = {}, seed = 1 }) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state = {
    seed,
    config: cfg,
    catalogName: catalog.name || 'Morentia',
    day: 0,
    phase: PHASE.SETUP,
    firstPlayer: 0,
    activePlayer: 0,
    expiredCount: 0,
    endTarget: cfg.endExpiredPerPlayer * players.length + cfg.endExpiredBase,
    players: players.map((p, i) => ({
      index: i,
      id: p.id,
      name: p.name,
      faction: p.faction,
      kind: p.kind || 'human',
      active: 0,
      reserve: 0,
      vp: 0,
      asleep: false,
      deck: [],
      hand: [],
      domain: [],
      discard: [],
      bases: [],
      flags: {},
    })),
    slots: [],
    placeDeck: [],
    placeDiscard: [],
    market: { deck: [], visible: [], boughtToday: false },
    limbo: [],
    cards: {},
    flags: {},
    result: null,
  };

  const slotCount = players.length + cfg.placesExtra;
  for (let i = 0; i < slotCount; i++) {
    state.slots.push({
      index: i, placeId: null, duration: null, controller: null,
      cards: [], placeCards: [], flags: {}, expired: false, revealedDay: 0,
    });
  }
  return state;
}

/** Copie profonde utilisée pour l'animation et les simulations de l'IA. */
export function cloneState(state) {
  return structuredClone(state);
}

// ---------------------------------------------------------------- références

/** Fiche de la face actuellement visible d'une carte. */
export function faceOf(catalog, inst) {
  return catalog.byId.get(inst.faceId) || catalog.byId.get(inst.baseCardId) || null;
}

export function placeRecord(catalog, slot) {
  return slot.placeId ? catalog.placeById.get(slot.placeId) : null;
}

/** Instances présentes sur un emplacement, attachements compris. */
export function cardsOnSlot(state, slotIndex) {
  return state.slots[slotIndex].cards.map(id => state.cards[id]);
}

/** Unités et attachements de lieu présents — hors attachements d'unité. */
export function occupantsOfSlot(state, catalog, slotIndex) {
  return cardsOnSlot(state, slotIndex).filter(inst => {
    const face = faceOf(catalog, inst);
    return face && occupiesPlace(face.kind) && !inst.attachedTo;
  });
}

/** Toutes les instances en jeu susceptibles de porter un effet actif. */
export function activeSources(state) {
  const out = [];
  for (const p of state.players) {
    for (const id of p.bases) out.push(state.cards[id]);
    for (const id of p.domain) out.push(state.cards[id]);
  }
  for (const slot of state.slots) {
    for (const id of slot.cards) out.push(state.cards[id]);
  }
  return out.filter(Boolean);
}

// ------------------------------------------------------- contexte de lecture

/**
 * Contexte transmis aux crochets synchrones (aura, finalize, printed, costFor,
 * forbids, warInfluence). Il porte les mêmes lectures que le contexte complet
 * du moteur, afin qu'un effet puisse être écrit sans se demander depuis quel
 * crochet il est appelé. `slot` est toujours un **indice** d'emplacement.
 */
export function readCtx(state, catalog, { inst = null, slot = null, purpose = 'general', player = null } = {}) {
  const slotIndex = typeof slot === 'object' && slot !== null ? slot.index : slot;
  const owner = player ?? (inst ? (inst.controller ?? inst.owner) : null);
  return {
    state, catalog, inst,
    face: inst ? faceOf(catalog, inst) : null,
    slot: inst ? inst.slot : slotIndex,
    purpose,
    player: owner,
    influence: (i, p2) => influenceOf(state, catalog, i, p2 ?? purpose),
    raw: i => rawInfluenceOf(state, catalog, i),
    printed: i => printedInfluenceOf(catalog, i),
    face_: i => faceOf(catalog, i),
    cardsOn: s2 => cardsOnSlot(state, s2).filter(c => !c.attachedTo),
    occupants: s2 => occupantsOfSlot(state, catalog, s2),
    slots: () => liveSlots(state),
    adjacent: s2 => adjacentSlots(state, s2),
    controllerOf: s2 => state.slots[s2]?.controller ?? null,
    placeRec: s2 => placeRecord(catalog, state.slots[s2]),
    players: () => state.players,
    isUnit: i => faceOf(catalog, i)?.kind === KIND.UNIT,
    handOf: p2 => state.players[p2].hand.map(id => state.cards[id]),
    domainOf: p2 => state.players[p2].domain.map(id => state.cards[id]),
    discardOf: p2 => state.players[p2].discard.map(id => state.cards[id]),
    allInPlay: () => activeSources(state),
  };
}

// ----------------------------------------------------------------- influence

function sumMods(inst) {
  let n = 0;
  for (const m of inst.mods) n += m.delta;
  return n;
}

/**
 * Influence effective d'une carte.
 *
 * `purpose` distingue les lectures : 'control' (contrôle d'un lieu), 'war'
 * (comparaison des domaines), 'rank' (classement de Victoire) ou 'general'.
 * Certaines cartes ne comptent que pour l'un d'eux.
 */
export function influenceOf(state, catalog, instOrId, purpose = 'general') {
  const inst = typeof instOrId === 'string' ? state.cards[instOrId] : instOrId;
  if (!inst) return 0;
  const face = faceOf(catalog, inst);
  if (!face) return 0;
  if (face.kind !== KIND.UNIT && face.kind !== KIND.PERMANENT && face.kind !== KIND.BASE) {
    // Éphémères et attachements n'ont pas d'influence propre.
    if (typeof face.influence !== 'number') return 0;
  }

  const ctx = readCtx(state, catalog, { inst, purpose });
  const own = specFor(inst);

  let base;
  if (typeof own.printed === 'function') base = own.printed(ctx);
  else base = typeof face.influence === 'number' ? face.influence : 0;

  let value = base + sumMods(inst);

  // Auras : toute carte en jeu, plus le lieu qui accueille la cible.
  if (!isSilenced(state, catalog, inst)) {
    // Une carte réduite au silence garde son influence mais perd ses effets ;
    // les auras venant d'ailleurs continuent de s'appliquer à elle.
  }
  for (const src of activeSources(state)) {
    if (isSilenced(state, catalog, src)) continue;
    const spec = specFor(src);
    if (typeof spec.aura !== 'function') continue;
    value += spec.aura(readCtx(state, catalog, { inst: src, purpose }), inst) || 0;
  }
  if (inst.slot !== null && inst.slot !== undefined) {
    const slot = state.slots[inst.slot];
    const spec = placeEffectsOf(slot?.placeId);
    if (typeof spec.aura === 'function') {
      value += spec.aura(readCtx(state, catalog, { slot, purpose }), inst) || 0;
    }
  }

  // Dernier mot : « compte comme ayant N influence », plafonds, planchers.
  for (const src of activeSources(state)) {
    if (isSilenced(state, catalog, src)) continue;
    const spec = specFor(src);
    if (typeof spec.finalize !== 'function') continue;
    const v = spec.finalize(readCtx(state, catalog, { inst: src, purpose }), inst, value);
    if (typeof v === 'number') value = v;
  }
  if (inst.slot !== null && inst.slot !== undefined) {
    const slot = state.slots[inst.slot];
    const spec = placeEffectsOf(slot?.placeId);
    if (typeof spec.finalize === 'function') {
      const v = spec.finalize(readCtx(state, catalog, { slot, purpose }), inst, value);
      if (typeof v === 'number') value = v;
    }
  }
  if (typeof own.finalizeSelf === 'function') {
    const v = own.finalizeSelf(ctx, value);
    if (typeof v === 'number') value = v;
  }

  return Math.max(0, value);
}

/** Influence imprimée, hors modificateurs — condition fréquente sur les cartes. */
export function printedInfluenceOf(catalog, inst) {
  const face = faceOf(catalog, inst);
  return typeof face?.influence === 'number' ? face.influence : 0;
}

/**
 * Les effets imprimés de la carte sont-ils ignorés ?
 * Provoqué par Mue Inachevée, Décret de Saisie ou une Écaille Violette.
 */
export function isSilenced(state, catalog, inst) {
  if (!inst) return false;
  if (inst.flags.silenced || inst.flags['day:silenced']) return true;
  for (const id of inst.attachments || []) {
    const att = state.cards[id];
    if (att && specFor(att).silences) return true;
  }
  return false;
}

// ------------------------------------------------------------------ contrôle

/** Influence totale d'un joueur sur un emplacement. */
export function influenceOnSlot(state, catalog, slotIndex, playerIndex, purpose = 'control') {
  let total = 0;
  for (const inst of cardsOnSlot(state, slotIndex)) {
    if (inst.controller !== playerIndex) continue;
    if (inst.attachedTo) continue;
    total += influenceOf(state, catalog, inst, purpose);
  }
  return total;
}

/**
 * Contrôleur d'un emplacement : influence totale strictement la plus haute.
 * Retourne null en cas d'égalité — personne ne contrôle.
 */
export function computeController(state, catalog, slotIndex) {
  let best = -1, holder = null, tied = false;
  for (const p of state.players) {
    const v = influenceOnSlot(state, catalog, slotIndex, p.index);
    if (v > best) { best = v; holder = p.index; tied = false; }
    else if (v === best) tied = true;
  }
  if (best <= 0 || tied) return null;
  return holder;
}

/** Influence totale du domaine d'un joueur, utilisée pour la Guerre. */
export function domainInfluence(state, catalog, playerIndex) {
  let total = 0;
  for (const id of state.players[playerIndex].domain) {
    total += influenceOf(state, catalog, state.cards[id], 'war');
  }
  // Certains effets ajoutent l'influence de cartes présentes sur un lieu
  // (Éveil de l'Endormi) ou retirent un malus (Poulpe-Navire non attaché).
  for (const src of activeSources(state)) {
    if (isSilenced(state, catalog, src)) continue;
    const spec = specFor(src);
    if (typeof spec.warInfluence !== 'function') continue;
    total += spec.warInfluence(readCtx(state, catalog, { inst: src, purpose: 'war' }), playerIndex) || 0;
  }
  return total;
}

/**
 * Classement d'un emplacement pour les récompenses de Victoire.
 * Les joueurs à égalité partagent la même place ; la suivante est sautée.
 */
export function rankSlot(state, catalog, slotIndex) {
  const scores = state.players
    .map(p => ({
      player: p.index,
      influence: influenceOnSlot(state, catalog, slotIndex, p.index, 'rank'),
      cards: cardsOnSlot(state, slotIndex).filter(c => c.controller === p.index && !c.attachedTo).length,
    }))
    .filter(s => s.cards > 0)
    .sort((a, b) => b.influence - a.influence);

  let rank = 0, prev = null, seen = 0;
  for (const s of scores) {
    seen += 1;
    if (prev === null || s.influence < prev) { rank = seen; prev = s.influence; }
    s.rank = rank;
  }
  return scores;
}

// -------------------------------------------------------------------- coûts

/**
 * Coût d'une carte pour une destination donnée.
 * `dest` vaut 'domain' ou 'place'. Retourne null si la destination est
 * interdite pour cette carte (par exemple un Permanent sur un lieu).
 */
export function baseCostFor(face, dest) {
  if (face.singleCost) return numeric(face.costUnique);
  if (dest === 'domain') return numeric(face.costDomain);
  if (dest === 'place') return numeric(face.costLocation);
  return null;
}

function numeric(v) {
  if (typeof v === 'number') return v;
  if (v === 'X') return 0;   // le joueur choisit X au moment de payer
  return null;
}

/**
 * Coût effectif, réductions et taxes appliquées. `cand` décrit la tentative :
 * { inst, face, player, dest, slot, action }.
 * Le coût ne descend jamais sous 1 sauf effet qui l'amène explicitement à 0.
 */
export function costOf(state, catalog, cand) {
  const base = baseCostFor(cand.face, cand.dest);
  if (base === null) return null;
  let cost = base;
  let floor = 1;
  let zeroed = false;

  for (const src of activeSources(state)) {
    if (isSilenced(state, catalog, src)) continue;
    const spec = specFor(src);
    if (typeof spec.costFor !== 'function') continue;
    const r = spec.costFor(readCtx(state, catalog, { inst: src }), cand);
    if (!r) continue;
    if (typeof r === 'number') cost += r;
    else {
      if (typeof r.delta === 'number') cost += r.delta;
      if (typeof r.floor === 'number') floor = Math.max(floor, r.floor);
      if (r.free) zeroed = true;
    }
  }

  if (cand.slot !== null && cand.slot !== undefined) {
    const slot = state.slots[cand.slot];
    const spec = placeEffectsOf(slot?.placeId);
    if (typeof spec.costFor === 'function') {
      const r = spec.costFor(readCtx(state, catalog, { slot }), cand);
      if (typeof r === 'number') cost += r;
      else if (r) {
        if (typeof r.delta === 'number') cost += r.delta;
        if (typeof r.floor === 'number') floor = Math.max(floor, r.floor);
        if (r.free) zeroed = true;
      }
    }
  }

  if (zeroed) return 0;
  return Math.max(floor, cost);
}

/** Coût du prochain déploiement du Jour pour un joueur. */
export function deployCost(state, playerIndex) {
  const p = state.players[playerIndex];
  const done = p.flags.deploysToday || 0;
  if (state.config.firstDeployFree && done === 0) return 0;
  return state.config.deployCost;
}

// ------------------------------------------------------------- interdictions

/**
 * Recense les interdictions qui pèsent sur une tentative. Retourne un tableau
 * de motifs lisibles ; vide si l'action est permise.
 */
export function restrictions(state, catalog, cand) {
  const out = [];
  for (const src of activeSources(state)) {
    if (isSilenced(state, catalog, src)) continue;
    const spec = specFor(src);
    if (typeof spec.forbids !== 'function') continue;
    const r = spec.forbids(readCtx(state, catalog, { inst: src }), cand);
    if (r) out.push(typeof r === 'string' ? r : 'Interdit par un effet en jeu.');
  }
  if (cand.slot !== null && cand.slot !== undefined) {
    const slot = state.slots[cand.slot];
    const spec = placeEffectsOf(slot?.placeId);
    if (typeof spec.forbids === 'function') {
      const r = spec.forbids(readCtx(state, catalog, { slot }), cand);
      if (r) out.push(typeof r === 'string' ? r : 'Interdit par le lieu.');
    }
  }
  return out;
}

// ------------------------------------------------------------------ adjacence

/** Les emplacements forment une rangée : voisins immédiats seulement. */
export function adjacentSlots(state, slotIndex) {
  const out = [];
  if (slotIndex > 0) out.push(slotIndex - 1);
  if (slotIndex < state.slots.length - 1) out.push(slotIndex + 1);
  // Le Réseau Longmai relie deux emplacements quelconques.
  for (const link of state.flags.longmai ? [state.flags.longmai] : []) {
    if (link[0] === slotIndex) out.push(link[1]);
    if (link[1] === slotIndex) out.push(link[0]);
  }
  return [...new Set(out)].filter(i => !state.slots[i].expired && state.slots[i].placeId);
}

/** Emplacements encore en jeu. */
export function liveSlots(state) {
  return state.slots.filter(s => s.placeId && !s.expired);
}

// ------------------------------------------------------------------- divers

export function totalGold(player) {
  return player.active + player.reserve;
}

export function canAfford(player, cost) {
  return player.active >= cost;
}

export function pot(kind) {
  return kind === 'active' ? POT.ACTIVE : POT.RESERVE;
}

/** Cartes d'un joueur dans une zone. */
export function zoneOf(state, playerIndex, zone) {
  const p = state.players[playerIndex];
  switch (zone) {
    case ZONE.HAND: return p.hand;
    case ZONE.DECK: return p.deck;
    case ZONE.DOMAIN: return p.domain;
    case ZONE.DISCARD: return p.discard;
    default: return [];
  }
}

/** La partie est-elle terminée ? */
export function isOver(state) {
  return state.phase === PHASE.GAME_OVER;
}

/** Classement final par PV, puis or total en cas d'égalité. */
export function standings(state) {
  return state.players
    .map(p => ({ player: p.index, name: p.name, vp: p.vp, gold: p.active + p.reserve }))
    .sort((a, b) => b.vp - a.vp || b.gold - a.gold);
}
