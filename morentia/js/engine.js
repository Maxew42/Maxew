const PHASES = ["Aube", "Journée", "Crépuscule", "Guerre", "Nuit"];

export const DEFAULT_GAME_OPTIONS = {
  startingHand: 4,
  startingGold: 3,
  marketSize: 3,
  locationCount: 2,
  endLocationMultiplier: 2,
  endLocationBonus: 2,
  firstDeploymentFree: true,
  laterDeploymentCost: 1,
  includeJadis: false,
};

const deepCopy = value => structuredClone(value);
const numeric = value => typeof value === "number" ? value : Number.parseInt(value, 10) || 0;
const isUnit = card => String(card?.type || "").includes("Unité");
const isAttachment = card => String(card?.type || "").includes("Attachement");
const isEphemeral = card => String(card?.type || "").includes("Éphémère");
const isDomainPermanent = card => String(card?.type || "").includes("Permanent") || String(card?.type || "").includes("Trophée — Domaine");
const isMonster = location => String(location?.type || "").includes("Monstre");

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(state) {
  let x = state.rngState >>> 0;
  x += 0x6D2B79F5;
  let t = x;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  state.rngState = x >>> 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(state, values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(randomFrom(state) * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function uid(state, prefix = "c") {
  state.sequence += 1;
  return `${prefix}${state.sequence.toString(36)}`;
}

export function catalogIndex(catalog) {
  const cards = [
    ...Object.values(catalog.factions).flat(),
    ...catalog.market,
    ...catalog.specials,
  ];
  return {
    cards: Object.fromEntries(cards.map(card => [card.id, card])),
    locations: Object.fromEntries(catalog.locations.map(location => [location.id, location])),
  };
}

function makeCard(state, cardId, owner, controller = owner) {
  return {
    uid: uid(state), cardId, owner, controller, zone: "deck", locationUid: null,
    permanentInfluence: 0, temporaryInfluence: 0, exhausted: false, face: "front",
    attachedTo: null, ignoredUntilDay: 0, mode: null, flags: {},
  };
}

function expandDeck(state, definitions, playerId) {
  return definitions
    .filter(card => card.status === "Deck" && numeric(card.quantity) > 0)
    .flatMap(card => Array.from({ length: numeric(card.quantity) }, () => makeCard(state, card.id, playerId)));
}

function log(state, message, tone = "info") {
  state.log.unshift({ id: uid(state, "l"), day: state.day, phase: state.phase, message, tone });
  state.log = state.log.slice(0, 160);
}

function drawFaction(state, player, count = 1) {
  for (let index = 0; index < count; index += 1) {
    if (!player.deck.length && player.discard.length) {
      player.deck = shuffle(state, player.discard.splice(0).map(card => ({ ...card, zone: "deck" })));
      log(state, `${player.name} remélange sa défausse.`);
    }
    const card = player.deck.shift();
    if (!card) return;
    card.zone = "hand";
    player.hand.push(card);
  }
}

function drawMarket(state) {
  const card = state.market.deck.shift();
  if (!card) return null;
  card.zone = "market";
  return card;
}

function refillMarket(state) {
  while (state.market.visible.length < state.options.marketSize && state.market.deck.length) {
    state.market.visible.push(drawMarket(state));
  }
}

function drawLocation(state, slot) {
  let tries = state.locationDeck.length;
  while (tries > 0) {
    tries -= 1;
    const locationId = state.locationDeck.shift();
    const def = state.index.locations[locationId];
    if (locationId === "LIE-09" && state.locations.some(location => location.locationId === "LIE-09")) {
      state.locationDeck.push(locationId);
      continue;
    }
    return {
      uid: uid(state, "p"), locationId, slot,
      remaining: Number.isFinite(Number(def.duration)) ? Number(def.duration) : null,
      cards: [], attachments: [], controller: null, flags: {},
    };
  }
  return null;
}

export function createGame(catalog, setup = {}) {
  const state = {
    version: 1,
    catalog,
    index: catalogIndex(catalog),
    seed: setup.seed || `${Date.now()}`,
    rngState: hashSeed(setup.seed || `${Date.now()}`),
    sequence: 0,
    options: { ...DEFAULT_GAME_OPTIONS, ...(setup.options || {}) },
    day: 1,
    phase: "Aube",
    activePlayer: 0,
    consecutivePasses: 0,
    expiredLocations: 0,
    monsterVictories: 0,
    status: "playing",
    winnerIds: [],
    players: [],
    market: { deck: [], visible: [] },
    locationDeck: [],
    locations: [],
    log: [],
  };
  const playerSetups = setup.players || [
    { name: "Joueur", faction: "Kalassir", isAI: false },
    { name: "Automate", faction: "Aqaba", isAI: true },
  ];
  state.players = playerSetups.map((playerSetup, index) => {
    const player = {
      id: `player-${index + 1}`,
      name: playerSetup.name || `Joueur ${index + 1}`,
      faction: playerSetup.faction,
      isAI: Boolean(playerSetup.isAI),
      activeGold: state.options.startingGold,
      reserveGold: 0,
      vp: 0,
      hand: [], domain: [], discard: [], deck: [],
      order: "Lames de Karina",
      passed: false,
      deployedToday: false,
      flags: {},
    };
    player.deck = shuffle(state, expandDeck(state, catalog.factions[player.faction], player.id));
    return player;
  });
  const marketDefs = catalog.market.filter(card => card.included === "Oui" || (state.options.includeJadis && card.included === "Optionnel"));
  state.market.deck = shuffle(state, marketDefs.map(card => makeCard(state, card.id, "market", null)));
  state.locationDeck = shuffle(state, catalog.locations
    .filter(location => location.included === "Oui" || (state.options.includeJadis && location.included === "Optionnel"))
    .flatMap(location => Array.from({ length: numeric(location.copies) || 1 }, () => location.id)));
  for (const player of state.players) drawFaction(state, player, state.options.startingHand);
  refillMarket(state);
  for (let slot = 0; slot < state.options.locationCount; slot += 1) {
    const location = drawLocation(state, slot);
    if (location) state.locations.push(location);
  }
  resolveDawn(state, true);
  state.phase = "Journée";
  log(state, `La partie commence — ${state.players.length} joueurs, fin après ${endThreshold(state)} lieux expirés.`, "system");
  return state;
}

export function hydrateGame(raw, catalog) {
  const state = deepCopy(raw);
  state.catalog = catalog;
  state.index = catalogIndex(catalog);
  state.options = { ...DEFAULT_GAME_OPTIONS, ...(state.options || {}), locationCount: DEFAULT_GAME_OPTIONS.locationCount, marketSize: DEFAULT_GAME_OPTIONS.marketSize };
  if (state.market.visible.length > state.options.marketSize) {
    state.market.deck.unshift(...state.market.visible.splice(state.options.marketSize));
  }
  const overflow = state.locations.slice(state.options.locationCount);
  if (overflow.length && overflow.every(location => !location.cards.length && !location.attachments.length)) {
    state.locations = state.locations.slice(0, state.options.locationCount);
    state.locationDeck.push(...overflow.map(location => location.locationId));
  }
  return state;
}

export function dehydrateGame(state) {
  const output = deepCopy(state);
  delete output.catalog;
  delete output.index;
  return output;
}

function endThreshold(state) {
  return state.options.endLocationMultiplier * state.players.length + state.options.endLocationBonus;
}

export function getPlayer(state, playerId) {
  return state.players.find(player => player.id === playerId);
}

export function getCard(state, cardUid) {
  for (const player of state.players) {
    const card = [...player.hand, ...player.domain, ...player.discard, ...player.deck].find(item => item.uid === cardUid);
    if (card) return card;
  }
  for (const location of state.locations) {
    const card = [...location.cards, ...location.attachments].find(item => item.uid === cardUid);
    if (card) return card;
  }
  return state.market.visible.find(card => card.uid === cardUid) || state.market.deck.find(card => card.uid === cardUid) || null;
}

export function getLocation(state, locationUid) {
  return state.locations.find(location => location.uid === locationUid) || null;
}

function cardDefinition(state, cardOrUid) {
  const card = typeof cardOrUid === "string" ? getCard(state, cardOrUid) : cardOrUid;
  return card ? state.index.cards[card.cardId] : null;
}

function playerHas(state, playerId, cardId, zone) {
  const player = getPlayer(state, playerId);
  if (!player) return false;
  const cards = zone ? player[zone] : [...player.hand, ...player.domain, ...player.discard];
  return cards.some(card => card.cardId === cardId);
}

function attachmentsFor(state, cardUid) {
  return state.locations.flatMap(location => location.attachments).filter(card => card.attachedTo === cardUid);
}

function locationOfCard(state, card) {
  return state.locations.find(location => location.uid === card.locationUid) || null;
}

export function influenceOf(state, cardOrUid) {
  const card = typeof cardOrUid === "string" ? getCard(state, cardOrUid) : cardOrUid;
  const def = cardDefinition(state, card);
  if (!card || !def || !isUnit(def)) return 0;
  const owner = getPlayer(state, card.controller);
  let value = numeric(def.influence);
  if (def.id === "KAL-17") value = Math.min(5, 1 + owner.discard.filter(item => isUnit(cardDefinition(state, item))).length);
  value += numeric(card.permanentInfluence) + numeric(card.temporaryInfluence);
  if (card.zone === "domain" && owner.faction === "Kalassir" && owner.order === "Culte du Premier Sang") value += 1;
  if (def.id === "KAL-13" && owner.order === "Lames de Karina") value += 2;
  if (def.id === "AQA-20") value += Math.min(3, Math.floor(owner.reserveGold / 2));
  if (def.id === "MAR-30" && card.zone === "domain") value = Math.max(value, 4);
  if (playerHas(state, card.controller, "MAR-09", "domain") && numeric(def.influence) <= 1) value += 1;
  const location = locationOfCard(state, card);
  if (location) {
    const locationDef = state.index.locations[location.locationId];
    if (def.id === "ALG-16" && location.cards.some(item => String(cardDefinition(state, item)?.subtype || "").includes("Géant"))) value += 2;
    if (def.id === "MAR-25" && isMonster(locationDef)) value += 2;
    if (locationDef.id === "LIE-05" && numeric(def.influence) <= 2) value += 1;
    const curse = location.attachments.find(item => item.cardId === "KAL-04" && item.attachedTo !== card.uid);
    if (curse) {
      const cursed = getCard(state, curse.attachedTo);
      if (cursed?.controller === card.controller) value -= 1;
    }
    if (location.cards.some(item => item.cardId === "AQA-06" && item.controller !== card.controller) && value >= 5) value -= 2;
    if (locationDef.id === "LIE-06" && value === 1) value = 3;
  }
  for (const attachment of attachmentsFor(state, card.uid)) {
    if (attachment.cardId === "MAR-28" || attachment.cardId === "SPE-04" || attachment.cardId === "SPE-08") value += 2;
    if (["SPE-05", "SPE-06", "MAR-J03"].includes(attachment.cardId)) value += 1;
    if (attachment.cardId === "MAR-10") value += 3;
  }
  return Math.max(0, value);
}

export function locationTotals(state, locationOrUid) {
  const location = typeof locationOrUid === "string" ? getLocation(state, locationOrUid) : locationOrUid;
  const totals = Object.fromEntries(state.players.map(player => [player.id, 0]));
  if (!location) return totals;
  for (const card of location.cards) totals[card.controller] = (totals[card.controller] || 0) + influenceOf(state, card);
  return totals;
}

export function controllerOf(state, locationOrUid) {
  const totals = locationTotals(state, locationOrUid);
  const best = Math.max(0, ...Object.values(totals));
  const leaders = Object.entries(totals).filter(([, total]) => total === best && total > 0);
  return leaders.length === 1 ? leaders[0][0] : null;
}

function removeFromEverywhere(state, cardUid) {
  for (const player of state.players) {
    for (const zone of ["hand", "domain", "discard", "deck"]) {
      const index = player[zone].findIndex(card => card.uid === cardUid);
      if (index >= 0) return player[zone].splice(index, 1)[0];
    }
  }
  for (const location of state.locations) {
    for (const zone of ["cards", "attachments"]) {
      const index = location[zone].findIndex(card => card.uid === cardUid);
      if (index >= 0) return location[zone].splice(index, 1)[0];
    }
  }
  const marketIndex = state.market.visible.findIndex(card => card.uid === cardUid);
  if (marketIndex >= 0) return state.market.visible.splice(marketIndex, 1)[0];
  return null;
}

function placeInDomain(state, card, playerId, exhausted = false, triggerJoin = true) {
  removeFromEverywhere(state, card.uid);
  const player = getPlayer(state, playerId);
  card.owner = card.owner === "market" ? playerId : card.owner;
  card.controller = playerId;
  card.zone = "domain";
  card.locationUid = null;
  card.exhausted = exhausted;
  player.domain.push(card);
  if (triggerJoin) trigger(state, "joinDomain", { card, player });
}

function placeAtLocation(state, card, location, playerId, context = {}) {
  removeFromEverywhere(state, card.uid);
  card.owner = card.owner === "market" ? playerId : card.owner;
  card.controller = playerId;
  card.zone = isAttachment(cardDefinition(state, card)) ? "attachment" : "location";
  card.locationUid = location.uid;
  card.exhausted = false;
  if (isAttachment(cardDefinition(state, card))) location.attachments.push(card);
  else location.cards.push(card);
  trigger(state, "joinLocation", { card, player: getPlayer(state, playerId), location, context });
}

function discardCard(state, card, destroyed = false) {
  const def = cardDefinition(state, card);
  const player = getPlayer(state, card.owner) || getPlayer(state, card.controller);
  const formerLocation = locationOfCard(state, card);
  if (destroyed && replacementForDestruction(state, card, formerLocation)) return;
  removeFromEverywhere(state, card.uid);
  card.zone = "discard";
  card.locationUid = null;
  card.attachedTo = null;
  player.discard.push(card);
  for (const attachment of formerLocation?.attachments.filter(item => item.attachedTo === card.uid) || []) discardCard(state, attachment, false);
  log(state, `${def.name} est ${destroyed ? "détruite" : "défaussée"}.`, destroyed ? "danger" : "info");
  trigger(state, destroyed ? "destroyed" : "discarded", { card, player, location: formerLocation });
}

function replacementForDestruction(state, card, location) {
  const def = cardDefinition(state, card);
  if (def?.id === "ALG-07" && card.face === "front") {
    card.cardId = "ALG-07B";
    card.face = "back";
    placeInDomain(state, card, card.controller, true);
    log(state, `${def.name} devient Vétéran des Rafales et retourne épuisé au domaine.`, "effect");
    return true;
  }
  if (card.flags.retreatUntilDay >= state.day) {
    delete card.flags.retreatUntilDay;
    placeInDomain(state, card, card.controller, true);
    log(state, `${def.name} bat en retraite vers le domaine.`, "effect");
    return true;
  }
  const mutation = attachmentsFor(state, card.uid).find(item => item.cardId === "SPE-08");
  if (mutation && influenceOf(state, card) > 0) {
    card.permanentInfluence -= 1;
    log(state, `${def.name} perd 1 influence grâce à Mutation d’Ul au lieu d’être détruite.`, "effect");
    return true;
  }
  const owner = getPlayer(state, card.controller);
  if (location && owner?.faction === "Kalassir" && owner.order === "Disciples de Karlov" && location.controller === owner.id && !owner.flags.karlovSaved) {
    owner.flags.karlovSaved = true;
    removeFromEverywhere(state, card.uid);
    card.zone = "hand";
    card.locationUid = null;
    owner.hand.push(card);
    log(state, `${def.name} revient en main grâce aux Disciples de Karlov.`, "effect");
    return true;
  }
  const anchor = attachmentsFor(state, card.uid).some(item => item.cardId === "MAR-J03");
  if (anchor) return true;
  return false;
}

function adjustInfluence(state, card, amount, temporary = false) {
  if (!card || !isUnit(cardDefinition(state, card))) return;
  if (amount < 0 && locationOfCard(state, card)?.cards.some(item => item.cardId === "MAR-06" && item.mode === "protect")) return;
  const solarBlade = attachmentsFor(state, card.uid).find(item => item.cardId === "MAR-28" && !item.flags.preventedLossDay);
  if (amount < 0 && solarBlade) {
    amount += 1;
    solarBlade.flags.preventedLossDay = state.day;
  }
  const location = locationOfCard(state, card);
  if (location?.locationId === "LIE-11" && amount !== 0) amount += Math.sign(amount);
  if (temporary) card.temporaryInfluence += amount;
  else card.permanentInfluence += amount;
  log(state, `${cardDefinition(state, card).name} ${amount >= 0 ? "gagne" : "perd"} ${Math.abs(amount)} influence${temporary ? " jusqu’à l’Aube" : ""}.`, "effect");
}

function pay(state, player, amount) {
  if (amount < 0 || player.activeGold < amount) return false;
  player.activeGold -= amount;
  return true;
}

function gainReserve(state, player, amount) {
  player.reserveGold += amount;
  if (playerHas(state, player.id, "AQA-12", "domain") && !player.flags.investorTriggered) {
    player.reserveGold += 1;
    player.flags.investorTriggered = true;
    log(state, `${player.name} gagne 1 or supplémentaire grâce à l’Investisseur du Désert.`, "effect");
  }
}

function costFor(state, player, def, destination, context = {}) {
  if (context.type === "deploy") {
    if (attachmentsFor(state, context.cardUid).some(item => item.cardId === "SPE-05")) return 0;
    return !player.deployedToday && state.options.firstDeploymentFree ? 0 : state.options.laterDeploymentCost;
  }
  let value = isEphemeral(def) || isAttachment(def) ? def.uniqueCost : destination === "domain" ? def.domainCost : def.locationCost;
  if (value === "X") value = Math.max(1, numeric(context.x) || 1);
  value = numeric(value);
  if (destination === "location") {
    const location = getLocation(state, context.locationUid);
    if (context.type !== "deploy" && location?.locationId === "LIE-01") value = Math.max(1, value - 1);
    if (context.type !== "deploy" && location?.attachments.some(card => card.cardId === "ALG-09" && card.controller === player.id)) value = Math.max(1, value - 1);
    if (def.id === "ALG-11" && location?.cards.some(card => String(cardDefinition(state, card)?.subtype || "").includes("Géant"))) value = 0;
    if (location?.cards.some(card => card.cardId === "MAR-03") && controllerOf(state, location) === player.id) value += 1;
  }
  if (context.fromMarket) {
    for (const opponent of state.players) {
      const bank = opponent.domain.find(card => card.cardId === "AQA-08");
      if (bank?.mode === "cheaper") value = Math.max(1, value - 1);
      if (bank?.mode === "dearer") value += 1;
    }
  }
  return value;
}

function legalLocation(state, player, def, location, context = {}) {
  if (!location) return false;
  if (isUnit(def) && String(def.subtype || "").includes("Géant") && location.cards.some(card => String(cardDefinition(state, card)?.subtype || "").includes("Géant"))) return false;
  if (isUnit(def) && location.locationId === "LIE-04" && location.cards.some(card => card.controller === player.id && isUnit(cardDefinition(state, card)))) return false;
  if (context.type === "deploy" && location.locationId === "LIE-07") return false;
  if (isAttachment(def) && def.id === "ALG-04" && isMonster(state.index.locations[location.locationId])) return false;
  if (isAttachment(def) && String(def.type).includes("unité") && !context.targetUid) return false;
  if (isAttachment(def) && String(def.type).includes("unité") && getCard(state, context.targetUid)?.locationUid !== location.uid) return false;
  return true;
}

function targetDefaults(state, playerId, locationUid, enemy = false) {
  const location = getLocation(state, locationUid);
  const cards = location?.cards.filter(card => enemy ? card.controller !== playerId : card.controller === playerId) || [];
  return [...cards].sort((a, b) => influenceOf(state, enemy ? a : b) - influenceOf(state, enemy ? b : a))[0] || null;
}

function nextPlayer(state) {
  const length = state.players.length;
  for (let offset = 1; offset <= length; offset += 1) {
    const index = (state.activePlayer + offset) % length;
    if (!state.players[index].passed) {
      state.activePlayer = index;
      return;
    }
  }
}

function finishAction(state, player, didPass = false) {
  if (didPass) {
    player.passed = true;
    state.consecutivePasses += 1;
  } else {
    state.consecutivePasses = 0;
    player.flags.actionsTaken = (player.flags.actionsTaken || 0) + 1;
  }
  if (state.players.every(item => item.passed)) {
    resolveRoundEnd(state);
  } else {
    nextPlayer(state);
  }
}

export function performAction(currentState, action, actorId) {
  const state = deepCopy(currentState);
  state.catalog = currentState.catalog;
  state.index = catalogIndex(state.catalog);
  const player = getPlayer(state, actorId);
  if (state.status !== "playing") throw new Error("La partie est terminée.");
  if (action.type === "selectSurvivors") {
    resolveSurvivorSelection(state, action, actorId);
    return state;
  }
  if (state.phase !== "Journée") throw new Error("Les actions ne sont possibles que pendant la Journée.");
  if (state.players[state.activePlayer]?.id !== actorId) throw new Error("Ce n’est pas votre tour d’action.");
  if (!player || player.passed) throw new Error("Ce joueur a déjà passé.");
  if (action.type === "pass") {
    log(state, `${player.name} passe.`);
    finishAction(state, player, true);
    return state;
  }
  if (action.type === "manual") {
    applyManual(state, player, action);
    finishAction(state, player, false);
    return state;
  }
  if (action.type === "playHand" || action.type === "buyMarket") {
    playCardAction(state, player, action);
  } else if (action.type === "deploy") {
    deployAction(state, player, action);
  } else if (action.type === "move") {
    moveAction(state, player, action);
  } else if (action.type === "activate") {
    activateAction(state, player, action);
  } else {
    throw new Error("Action inconnue.");
  }
  finishAction(state, player, false);
  return state;
}

function playCardAction(state, player, action) {
  const fromMarket = action.type === "buyMarket";
  const source = fromMarket ? state.market.visible : player.hand;
  const card = source.find(item => item.uid === action.cardUid);
  if (!card) throw new Error("Carte introuvable.");
  const def = cardDefinition(state, card);
  let destination = action.destination;
  if (isDomainPermanent(def)) destination = "domain";
  if (isAttachment(def)) destination = "location";
  if (isEphemeral(def)) destination = "ephemeral";
  if (!destination) destination = isUnit(def) ? "domain" : "ephemeral";
  const location = action.locationUid ? getLocation(state, action.locationUid) : null;
  if ((destination === "location" || isAttachment(def)) && !legalLocation(state, player, def, location, { ...action, type: "play" })) throw new Error("Destination illégale.");
  const cost = action.free ? 0 : costFor(state, player, def, destination === "ephemeral" ? "domain" : destination, { ...action, fromMarket });
  if (!pay(state, player, cost)) throw new Error(`Il faut ${cost} ors actifs.`);
  removeFromEverywhere(state, card.uid);
  if (fromMarket) {
    card.owner = player.id;
    card.controller = player.id;
    refillMarket(state);
    trigger(state, "marketBuy", { player, card });
  }
  log(state, `${player.name} ${fromMarket ? "achète et joue" : "joue"} ${def.name} pour ${cost} or${cost > 1 ? "s" : ""}.`, "action");
  if (isEphemeral(def)) {
    resolveEphemeral(state, player, card, action);
    card.zone = "discard";
    player.discard.push(card);
  } else if (isAttachment(def)) {
    card.attachedTo = action.targetUid || null;
    placeAtLocation(state, card, location, player.id, action);
  } else if (destination === "domain") {
    placeInDomain(state, card, player.id, true);
  } else {
    placeAtLocation(state, card, location, player.id, action);
  }
  trigger(state, "played", { player, card, location, context: action });
}

function deployAction(state, player, action) {
  const card = player.domain.find(item => item.uid === action.cardUid);
  if (!card || !isUnit(cardDefinition(state, card))) throw new Error("Seule une unité du domaine peut être déployée.");
  if (card.exhausted) throw new Error("Cette carte est épuisée jusqu’à la prochaine Aube.");
  const location = getLocation(state, action.locationUid);
  const def = cardDefinition(state, card);
  if (!legalLocation(state, player, def, location, { ...action, type: "deploy" })) throw new Error("Déploiement illégal.");
  const cost = costFor(state, player, def, "location", { ...action, type: "deploy", cardUid: card.uid });
  if (!pay(state, player, cost)) throw new Error(`Il faut ${cost} ors actifs.`);
  placeAtLocation(state, card, location, player.id, { ...action, type: "deploy" });
  player.deployedToday = true;
  log(state, `${player.name} déploie ${def.name} pour ${cost} or${cost > 1 ? "s" : ""}.`, "action");
  trigger(state, "deployed", { player, card, location, context: action });
}

function areAdjacent(state, fromUid, toUid) {
  const from = getLocation(state, fromUid);
  const to = getLocation(state, toUid);
  return from && to && Math.abs(from.slot - to.slot) === 1;
}

function moveCard(state, player, card, destination, unrestricted = false) {
  const from = locationOfCard(state, card);
  if (!from || !destination) throw new Error("Déplacement impossible.");
  if (!unrestricted && !areAdjacent(state, from.uid, destination.uid)) throw new Error("Le lieu d’arrivée doit être adjacent.");
  if (card.cardId === "MAR-08" || attachmentsFor(state, card.uid).some(item => item.cardId === "MAR-J03")) throw new Error("Cette carte ne peut pas être déplacée.");
  if (from.locationId === "LIE-10" && card.controller === player.id) throw new Error("Le Faux-Navire empêche ce déplacement.");
  if (!legalLocation(state, player, cardDefinition(state, card), destination, { type: "move" })) throw new Error("Le lieu ne peut pas accueillir cette carte.");
  removeFromEverywhere(state, card.uid);
  card.locationUid = destination.uid;
  card.zone = "location";
  destination.cards.push(card);
  log(state, `${cardDefinition(state, card).name} se déplace vers ${state.index.locations[destination.locationId].name}.`, "action");
  trigger(state, "moved", { player, card, from, location: destination });
  trigger(state, "joinLocation", { player, card, location: destination, context: { type: "move" } });
}

function moveAction(state, player, action) {
  const card = getCard(state, action.cardUid);
  if (!card || card.controller !== player.id || card.zone !== "location") throw new Error("Carte alliée introuvable sur un lieu.");
  moveCard(state, player, card, getLocation(state, action.locationUid), Boolean(action.unrestricted));
}

function activateAction(state, player, action) {
  const card = getCard(state, action.cardUid);
  if (!card || card.controller !== player.id || card.zone !== "domain") throw new Error("Permanent introuvable dans votre domaine.");
  if (card.flags.activatedDay === state.day) throw new Error("Cet effet a déjà été utilisé ce Jour.");
  if (card.cardId === "ALG-12") {
    if (!pay(state, player, 1)) throw new Error("Il faut 1 or actif.");
    const target = getCard(state, action.targetUid);
    moveCard(state, player, target, getLocation(state, action.locationUid));
  } else if (card.cardId === "AQA-02") {
    if (!pay(state, player, 1)) throw new Error("Il faut 1 or actif.");
    adjustInfluence(state, getCard(state, action.targetUid), 1, true);
  } else {
    throw new Error("Cette carte ne possède pas d’effet Action automatisé.");
  }
  card.flags.activatedDay = state.day;
  log(state, `${player.name} active ${cardDefinition(state, card).name}.`, "action");
}

function applyManual(state, player, action) {
  const targetPlayer = getPlayer(state, action.playerId) || player;
  const amount = numeric(action.amount);
  if (action.resource === "activeGold") targetPlayer.activeGold = Math.max(0, targetPlayer.activeGold + amount);
  else if (action.resource === "reserveGold") targetPlayer.reserveGold = Math.max(0, targetPlayer.reserveGold + amount);
  else if (action.resource === "vp") targetPlayer.vp = Math.max(0, targetPlayer.vp + amount);
  else if (action.resource === "influence") adjustInfluence(state, getCard(state, action.targetUid), amount, Boolean(action.temporary));
  else if (action.resource === "destroy") discardCard(state, getCard(state, action.targetUid), true);
  else if (action.resource === "draw") drawFaction(state, targetPlayer, Math.max(1, amount));
  else throw new Error("Ajustement manuel inconnu.");
  log(state, `${player.name} applique un ajustement arbitre : ${action.note || action.resource}.`, "manual");
}

function rotateMarket(state, cardUid) {
  const index = state.market.visible.findIndex(card => card.uid === cardUid);
  if (index < 0) return;
  const [card] = state.market.visible.splice(index, 1);
  card.zone = "deck";
  state.market.deck.push(card);
  refillMarket(state);
}

function resolveEphemeral(state, player, card, action) {
  const target = getCard(state, action.targetUid);
  const target2 = getCard(state, action.targetUid2);
  const destination = getLocation(state, action.destinationLocationUid || action.locationUid);
  switch (card.cardId) {
    case "KAL-05":
      if (target?.controller === player.id) discardCard(state, target, true);
      if (target2?.controller === player.id) adjustInfluence(state, target2, 3);
      break;
    case "KAL-18": {
      const sacrifice = player.hand.find(item => item.uid === action.targetUid && isUnit(cardDefinition(state, item)));
      if (sacrifice) { gainReserve(state, player, Math.min(3, numeric(cardDefinition(state, sacrifice).influence))); discardCard(state, sacrifice, false); }
      break;
    }
    case "AQA-15": {
      const top = player.deck.splice(0, 2);
      if (top[0]) { top[0].zone = "hand"; player.hand.push(top[0]); }
      if (top[1]) player.deck.push(top[1]);
      break;
    }
    case "AQA-16": adjustInfluence(state, target, 2, true); break;
    case "AQA-19": adjustInfluence(state, target, -Math.min(3, Math.max(1, numeric(action.x))), true); break;
    case "ALG-08": if (target && destination) moveCard(state, player, target, destination); break;
    case "ALG-14": {
      if (target && destination) {
        moveCard(state, player, target, destination);
        const victim = target2 || targetDefaults(state, player.id, destination.uid, true);
        if (victim && influenceOf(state, victim) < influenceOf(state, target)) discardCard(state, victim, true);
      }
      break;
    }
    case "ALG-17":
      if (target && destination) { moveCard(state, player, target, destination); target.flags.retreatUntilDay = state.day; }
      break;
    case "ALG-19":
      if (target && destination) moveCard(state, player, target, destination);
      if (target2 && target2.locationUid !== destination?.uid) moveCard(state, player, target2, destination);
      break;
    case "MAR-16": adjustInfluence(state, target, 1, true); break;
    case "MAR-17": adjustInfluence(state, target, -1, true); break;
    case "MAR-24": if (destination?.remaining != null) destination.remaining = Math.min(5, destination.remaining + 1); break;
    case "MAR-31": if (target) target.ignoredUntilDay = state.day + 1; break;
    case "MAR-J01": if (target && destination) moveCard(state, player, target, destination, true); break;
    case "MAR-J02": {
      const choices = state.market.deck.splice(0, 3);
      if (choices[0]) { choices[0].owner = player.id; choices[0].controller = player.id; choices[0].zone = "hand"; player.hand.push(choices[0]); }
      state.market.deck.push(...choices.slice(1));
      break;
    }
    default: log(state, `${cardDefinition(state, card).name} demande une résolution manuelle. Utilisez l’outil Arbitre.`, "manual");
  }
}

function trigger(state, event, context) {
  const { player, card, location } = context;
  const def = card ? cardDefinition(state, card) : null;
  if (event === "marketBuy") {
    if (player.faction === "Aqaba" && !player.flags.aqabaBuyGold) { gainReserve(state, player, 1); player.flags.aqabaBuyGold = true; }
    for (const opponent of state.players) if (opponent.id !== player.id && playerHas(state, opponent.id, "AQA-14", "domain") && !opponent.flags.taxCollector) { gainReserve(state, opponent, 1); opponent.flags.taxCollector = true; }
    if (playerHas(state, player.id, "AQA-17", "domain") && !player.flags.curiosity) { drawFaction(state, player, 1); if (player.hand.length) discardCard(state, player.hand[0], false); player.flags.curiosity = true; }
  }
  if (event === "deployed" && player.faction === "Algarie" && !player.flags.algarieDeployGold) { gainReserve(state, player, 1); player.flags.algarieDeployGold = true; }
  if ((event === "destroyed" || event === "discarded") && player.faction === "Kalassir" && !player.flags.kalassirDiscardGold) { gainReserve(state, player, 1); player.flags.kalassirDiscardGold = true; }
  if (event === "joinDomain") {
    if (def.id === "KAL-16" && player.discard.length) {
      const recovered = player.discard.find(item => item.uid !== card.uid);
      if (recovered) { removeFromEverywhere(state, recovered.uid); recovered.zone = "hand"; player.hand.push(recovered); }
    }
    if (def.id === "AQA-11") {
      const gained = state.market.deck.shift();
      if (gained) { gained.owner = player.id; gained.controller = player.id; gained.zone = "hand"; player.hand.push(gained); }
    }
    if (def.id === "MAR-13") gainReserve(state, player, 1);
    if (def.id === "MAR-29" && state.market.visible[0]) rotateMarket(state, state.market.visible[0].uid);
    if (def.id === "MAR-02") log(state, "Réseau Longmai créé : utilisez l’effet de carte depuis le journal pour choisir ses deux emplacements.", "manual");
  }
  if (event === "played") {
    if (def?.id === "AQA-01") adjustInfluence(state, card, Math.min(3, Math.max(0, numeric(context.context?.x))));
    if (def?.id === "AQA-03" && numeric(context.context?.x) >= 2 && pay(state, player, 2)) {
      const revealed = state.market.deck.shift();
      if (revealed) { revealed.owner = player.id; revealed.controller = player.id; revealed.zone = "hand"; player.hand.push(revealed); log(state, `${cardDefinition(state, revealed).name} rejoint gratuitement la main ; jouez-la via l’Arbitre si elle est légale.`, "manual"); }
    }
    if (def?.id === "AQA-10" && state.market.visible[0]) rotateMarket(state, state.market.visible[0].uid);
    if (def?.id === "AQA-21" && context.context?.payExtra && pay(state, player, 1)) adjustInfluence(state, card, 1, true);
  }
  if (event === "joinLocation") {
    const enemy = targetDefaults(state, player.id, location.uid, true);
    if (def.id === "KAL-01") {
      const victim = context.context?.targetUid ? getCard(state, context.context.targetUid) : enemy;
      if (victim && victim.uid !== card.uid && influenceOf(state, victim) <= 1) discardCard(state, victim, true);
    }
    if (def.id === "AQA-18" && context.context?.x && pay(state, player, Math.min(4, numeric(context.context.x)))) {
      const victim = getCard(state, context.context.targetUid) || enemy;
      if (victim && influenceOf(state, victim) <= numeric(context.context.x)) discardCard(state, victim, true);
    }
    if (def.id === "ALG-07B" && context.context?.type === "deploy" && enemy && influenceOf(state, enemy) <= 1) discardCard(state, enemy, true);
    if (def.id === "MAR-06") card.mode = context.context?.mode || "protect";
    if (["MAR-15", "ALG-13"].includes(def.id) && card.flags.filterDay !== state.day) { drawFaction(state, player, 1); if (player.hand.length) discardCard(state, player.hand[0], false); card.flags.filterDay = state.day; }
    if (def.id === "MAR-26" && context.context?.payExtra && pay(state, player, 1)) {
      const attachment = location.attachments[0];
      if (attachment) discardCard(state, attachment, false);
    }
    if (location.locationId === "LIE-14" && player.flags.minesDay !== state.day) { gainReserve(state, player, 1); player.flags.minesDay = state.day; }
    if (location.controller && location.controller !== player.id && player.faction === "Kalassir" && player.order === "Lames de Karina" && !player.flags.karinaBoost) { adjustInfluence(state, card, 2, true); player.flags.karinaBoost = true; }
  }
  if (event === "moved") {
    if (player.faction === "Algarie" && card.flags.aelunnDay !== state.day) { adjustInfluence(state, card, 1, true); card.flags.aelunnDay = state.day; }
    if (def.id === "ALG-10" && card.flags.routeGoldDay !== state.day) { gainReserve(state, player, 1); card.flags.routeGoldDay = state.day; }
    if (def.id === "ALG-15" && card.flags.nomadDay !== state.day) { adjustInfluence(state, card, 1); card.flags.nomadDay = state.day; }
    if (playerHas(state, player.id, "ALG-13", "domain") && !player.flags.windMessenger) { drawFaction(state, player, 1); if (player.hand.length) discardCard(state, player.hand[0], false); player.flags.windMessenger = true; }
  }
  if (event === "destroyed") {
    if (def.id === "KAL-07" && location) {
      const ally = targetDefaults(state, player.id, location.uid, false);
      if (ally) adjustInfluence(state, ally, 2);
    }
    if (location) for (const saint of location.cards.filter(item => item.cardId === "KAL-03" && item.flags.saintDay !== state.day)) { adjustInfluence(state, saint, 1); saint.flags.saintDay = state.day; }
    if (player.order === "Disciples de Karlov" && playerHas(state, player.id, "KAL-14") && !player.flags.archivistDraw) { drawFaction(state, player, 1); player.flags.archivistDraw = true; }
  }
}

function resolveDawn(state, initial = false) {
  state.phase = "Aube";
  for (const player of state.players) {
    if (!initial) {
      player.activeGold += player.reserveGold;
      player.reserveGold = 0;
      player.activeGold += 2;
      drawFaction(state, player, 1);
    }
    player.passed = false;
    player.deployedToday = false;
    player.flags = {};
    for (const card of [...player.hand, ...player.domain, ...player.discard, ...player.deck]) {
      card.temporaryInfluence = 0;
      card.exhausted = false;
      card.flags = Object.fromEntries(Object.entries(card.flags || {}).filter(([key]) => key.includes("UntilDay")));
    }
    const bank = player.domain.find(card => card.cardId === "AQA-08");
    if (bank) bank.mode = bank.mode === "dearer" ? "cheaper" : "dearer";
    const lab = player.domain.find(card => card.cardId === "KAL-08");
    if (lab && player.domain.length > 1) {
      const discarded = player.domain.find(card => card.uid !== lab.uid);
      if (discarded) { discardCard(state, discarded, false); drawFaction(state, player, 1); }
    }
    for (const card of player.domain) {
      if (card.cardId === "MAR-19") player.activeGold += 0;
    }
  }
  for (const location of state.locations) {
    for (const card of [...location.cards, ...location.attachments]) {
      card.temporaryInfluence = 0;
      if (card.cardId === "MAR-19") {
        const values = location.cards.map(item => influenceOf(state, item));
        if (values.filter(value => value === influenceOf(state, card)).length === 1 && influenceOf(state, card) === Math.max(...values)) getPlayer(state, card.controller).activeGold += 1;
      }
      if (card.cardId === "MAR-07") {
        const target = targetDefaults(state, card.controller, location.uid, true);
        if (target) adjustInfluence(state, target, -1, true);
      }
    }
  }
  log(state, initial ? "Mise en place : 4 cartes en main et 3 ors actifs par faction." : `Aube du Jour ${state.day} : chaque joueur pioche 1 carte, transfère sa réserve et gagne 2 ors actifs.`, "phase");
}

function refreshControllers(state) {
  for (const location of state.locations) location.controller = controllerOf(state, location);
}

function resolveTwilight(state) {
  state.phase = "Crépuscule";
  refreshControllers(state);
  for (const location of state.locations) {
    const def = state.index.locations[location.locationId];
    const muted = location.attachments.some(card => card.cardId === "MAR-21");
    if (!muted) {
      for (const card of [...location.cards]) {
        const player = getPlayer(state, card.controller);
        if (card.cardId === "ALG-03") for (const target of location.cards) adjustInfluence(state, target, 1);
        if (card.cardId === "MAR-14" && location.controller === player.id) gainReserve(state, player, 1);
        if (card.cardId === "MAR-20" && location.controller === player.id && location.cards.some(item => item.controller !== player.id)) adjustInfluence(state, card, 1);
      }
    }
    if (!location.controller) continue;
    const player = getPlayer(state, location.controller);
    if (dragonBlocksControl(state, player)) continue;
    const ally = targetDefaults(state, player.id, location.uid, false);
    switch (def.id) {
      case "LIE-01": case "LIE-14": gainReserve(state, player, 1); break;
      case "LIE-02": drawFaction(state, player, 1); break;
      case "LIE-03": case "LIE-04": case "LIE-15": if (ally) adjustInfluence(state, ally, 1); break;
      case "LIE-05": {
        const recovered = player.discard.find(card => numeric(cardDefinition(state, card).influence) <= 1);
        if (recovered) { removeFromEverywhere(state, recovered.uid); recovered.zone = "hand"; player.hand.push(recovered); }
        break;
      }
      case "LIE-06": {
        if (!location.cards.some(card => card.controller === player.id && card.cardId === "SPE-03")) {
          const token = makeCard(state, "SPE-03", player.id); placeAtLocation(state, token, location, player.id);
        }
        break;
      }
      case "LIE-09": {
        const enemy = targetDefaults(state, player.id, location.uid, true);
        if (enemy) adjustInfluence(state, enemy, -1, true);
        break;
      }
      case "LIE-10": if (ally && influenceOf(state, ally) > 0) { adjustInfluence(state, ally, -1); gainReserve(state, player, 1); } break;
      case "LIE-11": {
        const allies = location.cards.filter(card => card.controller === player.id);
        if (allies.length > 1) { adjustInfluence(state, allies[0], -1); adjustInfluence(state, allies[1], 1); }
        break;
      }
      case "LIE-12": break;
      default: break;
    }
  }
  refreshControllers(state);
  log(state, "Crépuscule : contrôle et effets de contrôle résolus.", "phase");
}

function dragonBlocksControl(state, player) {
  const dragon = state.locations.find(location => location.locationId === "LIE-12");
  if (!dragon || dragon.controller === player.id) return false;
  const sacrifice = state.locations.flatMap(location => location.cards).filter(card => card.controller === player.id && influenceOf(state, card) > 0).sort((a, b) => influenceOf(state, a) - influenceOf(state, b))[0];
  if (!sacrifice) return true;
  adjustInfluence(state, sacrifice, -1);
  return false;
}

function resolveWar(state) {
  state.phase = "Guerre";
  const totals = Object.fromEntries(state.players.map(player => [player.id, player.domain.reduce((sum, card) => sum + influenceOf(state, card), 0)]));
  for (const location of state.locations.filter(item => item.attachments.some(card => card.cardId === "ALG-04"))) {
    for (const card of location.cards) totals[card.controller] += influenceOf(state, card);
  }
  for (const player of state.players) if (player.domain.some(card => card.cardId === "SPE-07" && !card.attachedTo)) totals[player.id] = Math.max(0, totals[player.id] - 1);
  const best = Math.max(...Object.values(totals));
  const winners = state.players.filter(player => totals[player.id] === best);
  const losers = state.players.filter(player => totals[player.id] < best);
  for (const player of winners) {
    if (playerHas(state, player.id, "KAL-11", "domain")) drawFaction(state, player, 1);
    else gainReserve(state, player, 1);
    if (playerHas(state, player.id, "AQA-22", "domain")) gainReserve(state, player, 1);
    if (playerHas(state, player.id, "ALG-20", "domain")) {
      const ally = [...player.domain, ...state.locations.flatMap(location => location.cards)].find(card => card.controller === player.id && isUnit(cardDefinition(state, card)));
      if (ally) adjustInfluence(state, ally, 1);
    }
  }
  for (const player of losers) player.activeGold = Math.max(0, player.activeGold - 1);
  for (const player of state.players.filter(item => !losers.includes(item))) if (player.faction === "Kalassir" && player.order === "Culte du Premier Sang") {
    const apostle = player.domain.find(card => card.cardId === "KAL-19");
    const ally = player.domain.find(card => card.uid !== apostle?.uid && isUnit(cardDefinition(state, card)));
    if (apostle && ally) adjustInfluence(state, ally, 1);
  }
  log(state, `Guerre : ${winners.map(player => player.name).join(", ")} ${winners.length > 1 ? "l’emportent" : "l’emporte"} (${best} influence).`, "phase");
}

function resolveNight(state) {
  state.phase = "Nuit";
  const expiring = [];
  for (const location of [...state.locations]) {
    const def = state.index.locations[location.locationId];
    const muted = location.attachments.some(card => card.cardId === "MAR-21");
    if (!muted) {
      if (location.cards.some(card => card.cardId === "ALG-02")) {
        for (const player of state.players) {
          const victim = location.cards.filter(card => card.controller === player.id).sort((a, b) => influenceOf(state, a) - influenceOf(state, b))[0];
          if (victim) discardCard(state, victim, true);
        }
      }
      if (location.cards.some(card => card.cardId === "MAR-07")) for (const card of [...location.cards].filter(item => influenceOf(state, item) === 0)) discardCard(state, card, true);
      if (location.cards.some(card => card.cardId === "SPE-01B")) {
        const shraou = location.cards.find(card => card.cardId === "SPE-01B");
        for (const enemy of location.cards.filter(card => card.controller !== shraou.controller)) adjustInfluence(state, enemy, -1, true);
      }
      if (def.id === "LIE-02" && location.controller) {
        const lowest = [...location.cards].sort((a, b) => influenceOf(state, a) - influenceOf(state, b));
        if (lowest.length && (lowest.length === 1 || influenceOf(state, lowest[0]) < influenceOf(state, lowest[1]))) adjustInfluence(state, lowest[0], -1);
      }
    }
    if (isMonster(def)) {
      const threshold = monsterThreshold(def, state.players.length);
      const total = Object.values(locationTotals(state, location)).reduce((sum, value) => sum + value, 0);
      if (total >= threshold) expiring.push(location.uid);
    } else if (location.remaining != null) {
      location.remaining -= 1;
      if (location.remaining <= 0) expiring.push(location.uid);
    }
  }
  state.pendingExpirations = expiring;
  continueExpirations(state);
}

function monsterThreshold(def, playerCount) {
  if (def.id === "LIE-09") return 3 * playerCount;
  if (def.id === "LIE-10" || def.id === "LIE-11") return 5 * playerCount;
  if (def.id === "LIE-12") return 7 * playerCount;
  const match = String(def.threshold || "").match(/(\d+)/);
  return match ? Number(match[1]) * playerCount : Number.POSITIVE_INFINITY;
}

function awardNormalVp(state, location, def) {
  const rewards = String(def.vp || "0").split("/").map(part => numeric(part));
  const ranked = Object.entries(locationTotals(state, location)).sort((a, b) => b[1] - a[1]);
  ranked.forEach(([playerId, total], index) => {
    if (total <= 0) return;
    const player = getPlayer(state, playerId);
    const reward = rewards[Math.min(index, rewards.length - 1)] || 0;
    player.vp += reward;
  });
}

function awardSpecialVictory(state, location, def) {
  const totals = locationTotals(state, location);
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const winnerId = ranked[0]?.[1] > ranked[1]?.[1] ? ranked[0][0] : null;
  if (def.id === "LIE-15") {
    const highest = [...location.cards].sort((a, b) => influenceOf(state, b) - influenceOf(state, a));
    const counts = Object.fromEntries(state.players.map(player => [player.id, location.cards.filter(card => card.controller === player.id).length]));
    const biggestWinner = highest[0] && (!highest[1] || influenceOf(state, highest[0]) > influenceOf(state, highest[1])) ? highest[0].controller : null;
    const maxCount = Math.max(...Object.values(counts));
    const countWinners = Object.entries(counts).filter(([, count]) => count === maxCount).map(([id]) => id);
    const countWinner = countWinners.length === 1 ? countWinners[0] : null;
    if (biggestWinner) getPlayer(state, biggestWinner).vp += biggestWinner === countWinner ? 5 : 3;
    if (countWinner && countWinner !== biggestWinner) getPlayer(state, countWinner).vp += 3;
    return;
  }
  if (!winnerId) { awardNormalVp(state, location, def); return; }
  const winner = getPlayer(state, winnerId);
  if (def.id === "LIE-09") {
    winner.vp += 4; grantSpecial(state, winner, "SPE-04");
    for (const [playerId, total] of ranked.slice(1)) if (total >= 3) getPlayer(state, playerId).vp += 2;
  } else if (def.id === "LIE-10") {
    winner.vp += 5; gainReserve(state, winner, 4);
    for (const [playerId, total] of ranked.slice(1)) if (total >= 3) getPlayer(state, playerId).vp += 2;
  } else if (def.id === "LIE-11") {
    winner.vp += 4; grantSpecial(state, winner, "SPE-08");
    for (const [playerId, total] of ranked.slice(1)) if (total >= 3) getPlayer(state, playerId).vp += 2;
  } else if (def.id === "LIE-12") {
    winner.vp += 6; grantSpecial(state, winner, "SPE-09");
    for (const [playerId, total] of ranked.slice(1)) if (total >= 4) getPlayer(state, playerId).vp += 3;
  } else awardNormalVp(state, location, def);
}

function grantSpecial(state, player, cardId) {
  const card = makeCard(state, cardId, player.id);
  placeInDomain(state, card, player.id);
  log(state, `${player.name} gagne ${cardDefinition(state, card).name}.`, "effect");
}

function effectiveSurvivors(location) {
  let count = numeric(location._def?.survivors);
  for (const attachment of location.attachments) {
    if (attachment.cardId === "MAR-22") count -= 1;
    if (attachment.cardId === "MAR-23") count += 1;
  }
  return Math.max(0, count);
}

function prepareExpiration(state, locationUid) {
  const location = getLocation(state, locationUid);
  if (!location) return null;
  const def = state.index.locations[location.locationId];
  location._def = def;
  refreshControllers(state);
  if (def.vp === "Spécial" || isMonster(def)) awardSpecialVictory(state, location, def);
  else awardNormalVp(state, location, def);
  const survivorCount = effectiveSurvivors(location);
  const automatic = location.cards.filter(card => card.cardId === "MAR-08" || card.cardId === "SPE-03");
  const eligibleByPlayer = Object.fromEntries(state.players.map(player => [
    player.id,
    location.cards.filter(card => !automatic.includes(card) && card.controller === player.id).map(card => card.uid),
  ]));
  const selections = {};
  const choicePlayerIds = [];
  for (const player of state.players) {
    const eligible = eligibleByPlayer[player.id];
    if (survivorCount > 0 && eligible.length > survivorCount) choicePlayerIds.push(player.id);
    else selections[player.id] = eligible.slice(0, survivorCount);
  }
  return {
    locationUid, locationName: def.name, survivorCount,
    automaticUids: automatic.map(card => card.uid), eligibleByPlayer, selections,
    choicePlayerIds, choiceIndex: 0,
  };
}

function finalizeExpiration(state, pending) {
  const location = getLocation(state, pending.locationUid);
  if (!location) return;
  const def = state.index.locations[location.locationId];
  const automatic = new Set(pending.automaticUids);
  const survivors = new Set([...pending.automaticUids, ...Object.values(pending.selections).flat()]);
  for (const card of [...location.cards]) {
    if (automatic.has(card.uid)) continue;
    if (survivors.has(card.uid)) {
      placeInDomain(state, card, card.controller, false, false);
      continue;
    }
    if (card.cardId === "ALG-05") {
      const adjacent = state.locations.find(item => item.uid !== location.uid && Math.abs(item.slot - location.slot) === 1);
      if (adjacent) { moveCard(state, getPlayer(state, card.controller), card, adjacent); continue; }
    }
    discardCard(state, card, false);
  }
  for (const attachment of [...location.attachments]) discardCard(state, attachment, false);
  const replacement = drawLocation(state, location.slot);
  if (replacement) {
    replacement.cards = location.cards.filter(card => automatic.has(card.uid));
    for (const card of replacement.cards) card.locationUid = replacement.uid;
    state.locations[state.locations.indexOf(location)] = replacement;
  } else {
    for (const card of location.cards.filter(card => automatic.has(card.uid))) placeInDomain(state, card, card.controller, false, false);
    state.locations.splice(state.locations.indexOf(location), 1);
  }
  state.expiredLocations += 1;
  if (isMonster(def)) state.monsterVictories += 1;
  const returned = [...survivors].filter(uid => !automatic.has(uid)).length;
  log(state, `${def.name} expire. ${returned} carte(s) retournent dans leur domaine.`, "phase");
}

function continueExpirations(state) {
  while (state.pendingExpirations?.length) {
    const locationUid = state.pendingExpirations.shift();
    const pending = prepareExpiration(state, locationUid);
    if (!pending) continue;
    if (pending.choicePlayerIds.length) {
      state.pendingSurvivors = pending;
      state.phase = "Survivants";
      state.activePlayer = state.players.findIndex(player => player.id === pending.choicePlayerIds[0]);
      log(state, `${getPlayer(state, pending.choicePlayerIds[0]).name} doit choisir ${pending.survivorCount} Survivante(s) sur ${pending.locationName}.`, "phase");
      return;
    }
    finalizeExpiration(state, pending);
  }
  delete state.pendingExpirations;
  completeNight(state);
}

function resolveSurvivorSelection(state, action, actorId) {
  const pending = state.pendingSurvivors;
  if (!pending) throw new Error("Aucune sélection de Survivantes n’est attendue.");
  const expectedPlayerId = pending.choicePlayerIds[pending.choiceIndex];
  if (actorId !== expectedPlayerId) throw new Error("Ce n’est pas à ce joueur de choisir ses Survivantes.");
  const eligible = new Set(pending.eligibleByPlayer[actorId] || []);
  const selected = [...new Set(action.cardUids || [])];
  if (selected.length !== pending.survivorCount || selected.some(uid => !eligible.has(uid))) {
    throw new Error(`Choisissez exactement ${pending.survivorCount} carte(s).`);
  }
  pending.selections[actorId] = selected;
  pending.choiceIndex += 1;
  if (pending.choiceIndex < pending.choicePlayerIds.length) {
    const nextPlayerId = pending.choicePlayerIds[pending.choiceIndex];
    state.activePlayer = state.players.findIndex(player => player.id === nextPlayerId);
    log(state, `${getPlayer(state, nextPlayerId).name} doit choisir ses Survivantes sur ${pending.locationName}.`, "phase");
    return;
  }
  finalizeExpiration(state, pending);
  delete state.pendingSurvivors;
  continueExpirations(state);
}

function completeNight(state) {
  log(state, "Nuit : effets, Seuils et Durées résolus.", "phase");
  if (state.expiredLocations >= endThreshold(state) || !state.locationDeck.length && !state.locations.length) {
    finishGame(state);
    return;
  }
  state.day += 1;
  state.activePlayer = (state.day - 1) % state.players.length;
  resolveDawn(state);
  state.phase = "Journée";
}

function resolveRoundEnd(state) {
  resolveTwilight(state);
  resolveWar(state);
  resolveNight(state);
}

function finishGame(state) {
  state.status = "finished";
  const best = Math.max(...state.players.map(player => player.vp));
  state.winnerIds = state.players.filter(player => player.vp === best).map(player => player.id);
  log(state, `Fin de partie : ${state.winnerIds.map(id => getPlayer(state, id).name).join(", ")} ${state.winnerIds.length > 1 ? "gagnent" : "gagne"} avec ${best} PV.`, "system");
}

export function availableActions(state, playerId) {
  const player = getPlayer(state, playerId);
  if (!player || state.status !== "playing" || state.phase !== "Journée" || state.players[state.activePlayer]?.id !== playerId || player.passed) return [];
  const actions = [{ type: "pass", label: "Passer" }];
  for (const card of player.hand) actions.push({ type: "playHand", cardUid: card.uid, label: `Jouer ${cardDefinition(state, card).name}` });
  for (const card of state.market.visible) actions.push({ type: "buyMarket", cardUid: card.uid, label: `Acheter ${cardDefinition(state, card).name}` });
  for (const card of player.domain.filter(item => isUnit(cardDefinition(state, item)) && !item.exhausted)) actions.push({ type: "deploy", cardUid: card.uid, label: `Déployer ${cardDefinition(state, card).name}` });
  for (const location of state.locations) for (const card of location.cards.filter(item => item.controller === playerId)) actions.push({ type: "move", cardUid: card.uid, label: `Déplacer ${cardDefinition(state, card).name}` });
  for (const card of player.domain.filter(item => ["ALG-12", "AQA-02"].includes(item.cardId) && item.flags.activatedDay !== state.day)) actions.push({ type: "activate", cardUid: card.uid, label: `Activer ${cardDefinition(state, card).name}` });
  return actions;
}

export function summary(state) {
  return {
    day: state.day, phase: state.phase, activePlayerId: state.players[state.activePlayer]?.id,
    expiredLocations: state.expiredLocations, endAt: endThreshold(state), status: state.status,
    players: state.players.map(player => ({ id: player.id, name: player.name, faction: player.faction, vp: player.vp, activeGold: player.activeGold, reserveGold: player.reserveGold, hand: player.hand.length, deck: player.deck.length, discard: player.discard.length })),
  };
}

export { PHASES, isUnit, isAttachment, isEphemeral, isDomainPermanent, costFor, legalLocation, endThreshold };
