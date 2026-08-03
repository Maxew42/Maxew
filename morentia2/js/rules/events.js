// Réducteur d'événements : le seul endroit du programme qui modifie l'état.
//
// Le moteur n'écrit jamais dans l'état directement, il émet des événements.
// Conséquences recherchées :
//   • le multijoueur se résume à rediffuser les événements de l'hôte ;
//   • l'animation rejoue le même flux, un événement à la fois ;
//   • une règle qui change se voit dans le moteur, pas dans l'affichage.

import { ZONE, POT } from './constants.js';

/** Liste ordonnée des cartes d'une zone donnée. */
export function zoneList(state, zone, { player = null, slot = null } = {}) {
  switch (zone) {
    case ZONE.DECK: return state.players[player].deck;
    case ZONE.HAND: return state.players[player].hand;
    case ZONE.DOMAIN: return state.players[player].domain;
    case ZONE.DISCARD: return state.players[player].discard;
    case ZONE.PLACE: return state.slots[slot].cards;
    case ZONE.MARKET: return state.market.visible;
    case ZONE.MARKET_DECK: return state.market.deck;
    case ZONE.LIMBO: return state.limbo;
    case ZONE.BASE: return state.players[player].bases;
    case ZONE.PLACE_SLOT: return state.slots[slot].placeCards;
    default: return null;
  }
}

function detachFromCurrentZone(state, inst) {
  const list = zoneList(state, inst.zone, { player: inst.player, slot: inst.slot });
  if (!list) return;
  const i = list.indexOf(inst.id);
  if (i >= 0) list.splice(i, 1);
}

const HANDLERS = {
  /** Changement de phase. Remet à zéro les compteurs propres à la phase. */
  phase(state, e) {
    state.phase = e.phase;
    if (e.day !== undefined) state.day = e.day;
    state.activePlayer = e.activePlayer ?? state.activePlayer;
  },

  firstPlayer(state, e) {
    state.firstPlayer = e.player;
  },

  /** Le joueur dont c'est le tour pendant la Journée. */
  turn(state, e) {
    state.activePlayer = e.player;
  },

  sleep(state, e) {
    state.players[e.player].asleep = e.value !== false;
  },

  /** Gain ou perte d'or. `pot` distingue l'or actif de la réserve. */
  gold(state, e) {
    const p = state.players[e.player];
    const pot = e.pot || POT.ACTIVE;
    p[pot] = Math.max(0, p[pot] + e.delta);
  },

  /** À l'Aube : toute la réserve devient de l'or actif. */
  reserveToActive(state, e) {
    const p = state.players[e.player];
    p.active += p.reserve;
    p.reserve = 0;
  },

  vp(state, e) {
    state.players[e.player].vp += e.delta;
  },

  /**
   * Déplacement universel d'une carte. `to` porte { zone, player, slot, top }.
   * Toute entrée en jeu, défausse, pioche ou déploiement passe par ici.
   */
  move(state, e) {
    const inst = state.cards[e.inst];
    if (!inst) return;
    detachFromCurrentZone(state, inst);

    const to = e.to;
    inst.zone = to.zone;
    inst.player = to.player ?? null;
    inst.slot = to.slot ?? null;
    // Une carte du marché n'a pas de propriétaire tant qu'elle n'a rejoint la
    // zone de personne : elle adopte celui de sa destination.
    if (inst.owner === null && to.player !== null && to.player !== undefined) {
      inst.owner = to.player;
      if (inst.controller === null) inst.controller = to.player;
    }

    // Quitter un lieu ou le jeu remet la carte à son état neutre.
    if (to.zone !== ZONE.PLACE && to.zone !== ZONE.DOMAIN) {
      inst.mods = [];
      inst.attachments = [];
      inst.attachedTo = null;
      inst.flags = {};
      inst.exhausted = false;
    }
    if (to.zone === ZONE.DISCARD || to.zone === ZONE.LIMBO || to.zone === ZONE.DECK) {
      inst.controller = inst.owner;
      inst.faceId = inst.baseCardId;
    }
    if (e.exhausted !== undefined) inst.exhausted = !!e.exhausted;
    if (e.controller !== undefined) inst.controller = e.controller;

    const list = zoneList(state, to.zone, { player: inst.player, slot: inst.slot });
    if (!list) return;
    if (to.top === 'bottom') list.push(inst.id);
    else if (to.top === true) list.unshift(inst.id);
    else if (typeof to.index === 'number') list.splice(to.index, 0, inst.id);
    else list.push(inst.id);
  },

  /** Création d'une carte hors deck : jetons, versos, récompenses. */
  create(state, e) {
    state.cards[e.inst] = {
      id: e.inst,
      baseCardId: e.cardId,
      faceId: e.cardId,
      owner: e.owner ?? null,
      controller: e.controller ?? e.owner ?? null,
      zone: ZONE.LIMBO,
      player: null,
      slot: null,
      mods: [],
      attachments: [],
      attachedTo: null,
      exhausted: false,
      flags: {},
      token: !!e.token,
    };
    state.limbo.push(e.inst);
  },

  /** Modificateur d'influence. `until: null` = permanent. */
  influence(state, e) {
    const inst = state.cards[e.inst];
    if (!inst) return;
    inst.mods.push({ delta: e.delta, until: e.until ?? null, source: e.source ?? null });
  },

  /** Retire des modificateurs, par durée ou par source. */
  clearMods(state, e) {
    for (const id of e.insts || Object.keys(state.cards)) {
      const inst = state.cards[id];
      if (!inst) continue;
      inst.mods = inst.mods.filter(m => {
        if (e.until !== undefined && m.until !== e.until) return true;
        if (e.source !== undefined && m.source !== e.source) return true;
        return false;
      });
    }
  },

  exhaust(state, e) {
    const inst = state.cards[e.inst];
    if (inst) inst.exhausted = e.value !== false;
  },

  /** Retourne une carte recto-verso sur sa face indiquée. */
  flip(state, e) {
    const inst = state.cards[e.inst];
    if (inst) inst.faceId = e.faceId;
  },

  attach(state, e) {
    const inst = state.cards[e.inst];
    if (!inst) return;
    if (inst.attachedTo) {
      const prev = state.cards[inst.attachedTo];
      if (prev) prev.attachments = prev.attachments.filter(x => x !== inst.id);
    }
    inst.attachedTo = e.target ?? null;
    if (e.target) {
      const host = state.cards[e.target];
      if (host && !host.attachments.includes(inst.id)) host.attachments.push(inst.id);
      // Un attachement suit son hôte : même lieu, même contrôleur d'emplacement.
      if (host) { inst.slot = host.slot; inst.player = host.player; }
    }
  },

  /** Propriétaire et contrôleur d'une carte — achat au marché, capture. */
  own(state, e) {
    const inst = state.cards[e.inst];
    if (!inst) return;
    if (e.owner !== undefined) inst.owner = e.owner;
    if (e.controller !== undefined) inst.controller = e.controller;
  },

  /** Contrôleur d'un emplacement de lieu, recalculé au Crépuscule. */
  control(state, e) {
    state.slots[e.slot].controller = e.player;
  },

  duration(state, e) {
    const slot = state.slots[e.slot];
    if (!slot) return;
    if (e.value !== undefined) slot.duration = e.value;
    else if (slot.duration !== null) slot.duration = Math.max(0, slot.duration + e.delta);
  },

  /** Installe un lieu sur un emplacement. */
  placeIn(state, e) {
    const slot = state.slots[e.slot];
    slot.placeId = e.placeId;
    slot.duration = e.duration ?? null;
    slot.controller = null;
    slot.flags = {};
    slot.expired = false;
    slot.revealedDay = state.day;
  },

  expire(state, e) {
    const slot = state.slots[e.slot];
    if (slot) slot.expired = true;
    state.expiredCount += 1;
    if (e.placeId) state.placeDiscard.push(e.placeId);
  },

  /**
   * Drapeau générique : limites « une fois par Jour », modes choisis, compteurs.
   * `scope` vaut 'game', un identifiant de joueur, de carte ou d'emplacement.
   */
  flag(state, e) {
    const bag = flagBag(state, e.scope);
    if (!bag) return;
    if (e.value === undefined || e.value === null) delete bag[e.key];
    else bag[e.key] = e.value;
  },

  /** Efface les drapeaux d'une catégorie — utilisé à l'Aube. */
  clearFlags(state, e) {
    const test = key => (e.prefix ? key.startsWith(e.prefix) : true);
    const wipe = bag => { for (const k of Object.keys(bag)) if (test(k)) delete bag[k]; };
    wipe(state.flags);
    for (const p of state.players) wipe(p.flags);
    for (const c of Object.values(state.cards)) wipe(c.flags);
    for (const s of state.slots) wipe(s.flags);
  },

  /** Nouvel ordre d'une pile. L'aléatoire est résolu par l'hôte puis diffusé. */
  order(state, e) {
    const list = zoneList(state, e.zone, { player: e.player, slot: e.slot });
    if (list) list.splice(0, list.length, ...e.order);
  },

  /** Reconstitue le deck de lieux à partir des lieux déjà expirés. */
  placeDeckRefill(state, e) {
    state.placeDeck.push(...e.order);
    state.placeDiscard.length = 0;
  },

  /** Le marché n'a pas été acheté ce Jour : rotation FIFO. */
  marketStale(state, e) {
    state.market.boughtToday = e.value;
  },

  gameOver(state, e) {
    state.phase = 'gameOver';
    state.result = e.result;
  },

  /** Entrée de journal sans effet sur l'état (commentaires, annonces). */
  note() {},
};

function flagBag(state, scope) {
  if (!scope || scope === 'game') return state.flags;
  if (typeof scope === 'number') return state.players[scope]?.flags;
  if (typeof scope === 'string' && scope.startsWith('slot:')) {
    return state.slots[Number(scope.slice(5))]?.flags;
  }
  return state.cards[scope]?.flags;
}

/** Applique un événement à l'état. Retourne l'état, muté en place. */
export function applyEvent(state, event) {
  const fn = HANDLERS[event.t];
  if (!fn) throw new Error(`Événement inconnu : ${event.t}`);
  fn(state, event);
  return state;
}

/** Applique une suite d'événements. */
export function applyEvents(state, events) {
  for (const e of events) applyEvent(state, e);
  return state;
}
