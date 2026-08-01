import { costFor, isAttachment, isDomainPermanent, isEphemeral, isUnit, legalLocation, locationTotals, influenceOf } from "./engine.js";

function def(state, card) { return state.index.cards[card.cardId]; }
function locationDef(state, location) { return state.index.locations[location.locationId]; }

function locationScore(state, player, location) {
  const totals = locationTotals(state, location);
  const mine = totals[player.id] || 0;
  const rival = Math.max(0, ...Object.entries(totals).filter(([id]) => id !== player.id).map(([, value]) => value));
  const urgency = location.remaining == null ? 1.4 : 1 + (4 - location.remaining) * 0.35;
  const monster = String(locationDef(state, location).type).includes("Monstre") ? 1.5 : 1;
  return (mine <= rival ? rival - mine + 3 : 1) * urgency * monster;
}

function bestLocation(state, player, card, context = {}) {
  return state.locations
    .filter(location => legalLocation(state, player, def(state, card), location, context))
    .sort((a, b) => locationScore(state, player, b) - locationScore(state, player, a))[0] || null;
}

function alliesAt(state, player, location) {
  return location?.cards.filter(card => card.controller === player.id) || [];
}

function enemiesAt(state, player, location) {
  return location?.cards.filter(card => card.controller !== player.id) || [];
}

function targetPackage(state, player, card, location) {
  const ally = alliesAt(state, player, location).sort((a, b) => influenceOf(state, a) - influenceOf(state, b))[0];
  const strongAlly = alliesAt(state, player, location).sort((a, b) => influenceOf(state, b) - influenceOf(state, a))[0];
  const enemy = enemiesAt(state, player, location).sort((a, b) => influenceOf(state, b) - influenceOf(state, a))[0];
  const weakEnemy = enemiesAt(state, player, location).sort((a, b) => influenceOf(state, a) - influenceOf(state, b))[0];
  const id = card.cardId;
  if (["AQA-16", "MAR-16"].includes(id)) return { targetUid: strongAlly?.uid };
  if (["AQA-19", "MAR-17"].includes(id)) return { targetUid: enemy?.uid, x: 3 };
  if (id === "KAL-05") return { targetUid: ally?.uid, targetUid2: strongAlly?.uid };
  if (id === "KAL-04" || id === "MAR-10") return { targetUid: enemy?.uid || ally?.uid };
  if (["MAR-28", "MAR-J03"].includes(id)) return { targetUid: strongAlly?.uid };
  if (["ALG-08", "ALG-14", "ALG-17", "ALG-19", "MAR-J01"].includes(id)) {
    const source = state.locations.find(item => item.cards.some(unit => unit.controller === player.id));
    if (!source) return {};
    const mover = source?.cards.filter(unit => unit.controller === player.id).sort((a, b) => influenceOf(state, b) - influenceOf(state, a))[0];
    const destination = state.locations.filter(item => item.uid !== source?.uid && (id === "MAR-J01" || Math.abs(item.slot - source.slot) === 1)).sort((a, b) => locationScore(state, player, b) - locationScore(state, player, a))[0];
    return { targetUid: mover?.uid, destinationLocationUid: destination?.uid, targetUid2: destination ? enemiesAt(state, player, destination)[0]?.uid : null };
  }
  if (id === "KAL-18") return { targetUid: player.hand.find(unit => unit.uid !== card.uid && isUnit(def(state, unit)))?.uid };
  if (id === "MAR-24") return { destinationLocationUid: state.locations.filter(item => item.remaining != null).sort((a, b) => a.remaining - b.remaining)[0]?.uid };
  if (id === "MAR-31") return { targetUid: [...state.players.flatMap(item => item.domain), ...state.locations.flatMap(item => item.attachments)].find(item => item.controller !== player.id)?.uid };
  return { targetUid: weakEnemy?.uid, targetUid2: strongAlly?.uid, x: id === "AQA-01" ? Math.min(3, Math.max(0, player.activeGold - 2)) : 0, payExtra: player.activeGold > 2 };
}

function playableCardAction(state, player, card, type) {
  const definition = def(state, card);
  if (isDomainPermanent(definition)) {
    const cost = costFor(state, player, definition, "domain", { fromMarket: type === "buyMarket" });
    return cost <= player.activeGold ? { type, cardUid: card.uid, destination: "domain" } : null;
  }
  if (isEphemeral(definition)) {
    const location = bestLocation(state, player, card, { type: "play" });
    const targets = targetPackage(state, player, card, location);
    const x = targets.x || 1;
    const cost = costFor(state, player, definition, "domain", { x, fromMarket: type === "buyMarket" });
    if (cost > player.activeGold) return null;
    return { type, cardUid: card.uid, destination: "ephemeral", locationUid: location?.uid, ...targets };
  }
  const location = bestLocation(state, player, card, { type: "play" });
  const preferLocation = location && (numeric(definition.locationCost) <= numeric(definition.domainCost) + 2 || player.domain.length > 4);
  const destination = isAttachment(definition) || preferLocation ? "location" : "domain";
  const targetInfo = targetPackage(state, player, card, location);
  if (isAttachment(definition) && String(definition.type).includes("unité") && !targetInfo.targetUid) return null;
  const cost = costFor(state, player, definition, destination, { locationUid: location?.uid, fromMarket: type === "buyMarket", ...targetInfo });
  if (cost > player.activeGold || (destination === "location" && !location)) return null;
  return { type, cardUid: card.uid, destination, locationUid: location?.uid, mode: "protect", ...targetInfo };
}

function numeric(value) { return typeof value === "number" ? value : Number.parseInt(value, 10) || 0; }

export function chooseAIAction(state, playerId) {
  const player = state.players.find(item => item.id === playerId);
  if (!player || state.players[state.activePlayer]?.id !== playerId) return null;
  if (state.pendingSurvivors) {
    const pending = state.pendingSurvivors;
    const expected = pending.choicePlayerIds[pending.choiceIndex];
    if (expected !== playerId) return null;
    const cardUids = (pending.eligibleByPlayer[playerId] || [])
      .map(uid => state.locations.flatMap(location => location.cards).find(card => card.uid === uid))
      .filter(Boolean)
      .sort((a, b) => influenceOf(state, b) - influenceOf(state, a))
      .slice(0, pending.survivorCount)
      .map(card => card.uid);
    return { type: "selectSurvivors", cardUids };
  }
  if ((player.flags.actionsTaken || 0) >= Math.max(3, Math.min(7, player.activeGold + 1))) return { type: "pass" };

  const deployable = player.domain.filter(card => isUnit(def(state, card)) && !card.exhausted);
  for (const card of deployable.sort((a, b) => influenceOf(state, b) - influenceOf(state, a))) {
    const location = bestLocation(state, player, card, { type: "deploy" });
    if (!location) continue;
    const cost = costFor(state, player, def(state, card), "location", { type: "deploy", cardUid: card.uid, locationUid: location.uid });
    if (cost <= player.activeGold) return { type: "deploy", cardUid: card.uid, locationUid: location.uid };
  }

  const candidates = [
    ...player.hand.map(card => ({ card, type: "playHand", score: numeric(def(state, card).influence) * 2 + 3 })),
    ...state.market.visible.map(card => ({ card, type: "buyMarket", score: numeric(def(state, card).influence) * 2 + 2 })),
  ].sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    const action = playableCardAction(state, player, candidate.card, candidate.type);
    if (action) return action;
  }

  return { type: "pass" };
}
