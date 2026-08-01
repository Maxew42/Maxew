import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "../js/catalog.js";
import { createGame, dehydrateGame, getPlayer, hydrateGame, isDomainPermanent, isUnit, locationTotals, performAction } from "../js/engine.js";
import { chooseAIAction } from "../js/ai.js";
import { signalCode } from "../js/p2p.js";

const twoPlayers = [
  { name: "Kara", faction: "Kalassir", isAI: false },
  { name: "Aq", faction: "Aqaba", isAI: false },
];

test("mise en place conforme au classeur", () => {
  const state = createGame(CATALOG, { players: twoPlayers, seed: "setup" });
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].hand.length, 4);
  assert.equal(state.players[0].activeGold, 3);
  assert.equal(state.players[0].deck.length, 21);
  assert.equal(state.market.visible.length, 3);
  assert.equal(state.locations.length, 2);
  assert.ok(state.locations.every(location => location.locationId !== "LIE-09"));
  assert.ok(state.locationDeck.every(locationId => locationId !== "LIE-09"));
  assert.equal(state.phase, "Journée");
});

test("une ancienne sauvegarde remplace le Nœud de Serpents de Mer sans perdre ses cartes", () => {
  const original = createGame(CATALOG, { players: twoPlayers, seed: "removed-location" });
  const location = original.locations[0];
  const card = original.players[0].hand.shift();
  card.zone = "location";
  card.locationUid = location.uid;
  location.cards.push(card);
  location.locationId = "LIE-09";
  original.locationDeck.unshift("LIE-09", "LIE-09");
  const restored = hydrateGame(dehydrateGame(original), CATALOG);
  assert.ok(restored.locations.every(item => item.locationId !== "LIE-09"));
  assert.ok(restored.locationDeck.every(locationId => locationId !== "LIE-09"));
  assert.ok(restored.locations.some(item => item.cards.some(candidate => candidate.uid === card.uid)));
});

test("un Jour avance après que tous les joueurs passent", () => {
  let state = createGame(CATALOG, { players: twoPlayers, seed: "round" });
  const handSizes = state.players.map(player => player.hand.length);
  const deckSizes = state.players.map(player => player.deck.length);
  state = performAction(state, { type: "pass" }, "player-1");
  state = performAction(state, { type: "pass" }, "player-2");
  assert.equal(state.day, 2);
  assert.equal(state.phase, "Journée");
  assert.ok(state.players[0].activeGold >= 5, "les gains de Guerre peuvent aussi rejoindre l’or actif à l’Aube");
  assert.equal(state.players[0].passed, false);
  assert.deepEqual(state.players.map(player => player.hand.length), handSizes.map(size => size + 1));
  assert.deepEqual(state.players.map(player => player.deck.length), deckSizes.map(size => size - 1));
});

test("une carte jouée dans le domaine arrive épuisée", () => {
  let state = createGame(CATALOG, { players: twoPlayers, seed: "domain-exhaustion" });
  state.players[0].activeGold = 99;
  const card = state.players[0].hand.find(item => isUnit(state.index.cards[item.cardId]) || isDomainPermanent(state.index.cards[item.cardId]));
  assert.ok(card);
  state = performAction(state, { type: "playHand", cardUid: card.uid, destination: "domain" }, "player-1");
  assert.equal(state.players[0].domain.find(item => item.uid === card.uid)?.exhausted, true);
});

test("acheter une unité du marché vers un lieu utilise exactement son coût de lieu", () => {
  let state = createGame(CATALOG, { players: twoPlayers, seed: "market-location-cost" });
  state.players[0].activeGold = 99;
  const card = state.market.visible.find(item => isUnit(state.index.cards[item.cardId]) && !isDomainPermanent(state.index.cards[item.cardId]));
  assert.ok(card);
  const printedCost = Number(state.index.cards[card.cardId].locationCost);
  const before = state.players[0].activeGold;
  state = performAction(state, { type: "buyMarket", cardUid: card.uid, destination: "location", locationUid: state.locations[0].uid }, "player-1");
  assert.equal(before - state.players[0].activeGold, printedCost);
});

test("à l’expiration chaque joueur choisit ses Survivantes, qui retournent au domaine", () => {
  let state = createGame(CATALOG, { players: twoPlayers, seed: "survivors" });
  const location = state.locations[0];
  location.locationId = "LIE-03";
  location.remaining = 1;
  const candidates = state.players[0].hand.filter(card => card.cardId === "KAL-13").slice(0, 2);
  assert.equal(candidates.length, 2);
  for (const card of candidates) {
    state.players[0].hand.splice(state.players[0].hand.indexOf(card), 1);
    card.zone = "location";
    card.locationUid = location.uid;
    location.cards.push(card);
  }
  state = performAction(state, { type: "pass" }, "player-1");
  state = performAction(state, { type: "pass" }, "player-2");
  assert.equal(state.phase, "Survivants");
  assert.equal(state.pendingSurvivors.survivorCount, 1);
  state = performAction(state, { type: "selectSurvivors", cardUids: [candidates[0].uid] }, "player-1");
  assert.equal(state.day, 2);
  assert.ok(state.players[0].domain.some(card => card.uid === candidates[0].uid));
  assert.ok(state.players[0].discard.some(card => card.uid === candidates[1].uid));
});

test("égalité stricte ne donne pas le contrôle", () => {
  const state = createGame(CATALOG, { players: twoPlayers, seed: "ties" });
  const location = state.locations[0];
  const cardA = state.players[0].hand.find(card => Number(state.index.cards[card.cardId].influence) > 0);
  const cardB = state.players[1].hand.find(card => Number(state.index.cards[card.cardId].influence) > 0);
  cardA.permanentInfluence = 10 - Number(state.index.cards[cardA.cardId].influence);
  cardB.permanentInfluence = 10 - Number(state.index.cards[cardB.cardId].influence);
  cardA.zone = cardB.zone = "location";
  cardA.locationUid = cardB.locationUid = location.uid;
  state.players[0].hand.splice(state.players[0].hand.indexOf(cardA), 1);
  state.players[1].hand.splice(state.players[1].hand.indexOf(cardB), 1);
  location.cards.push(cardA, cardB);
  assert.deepEqual(locationTotals(state, location), { "player-1": 10, "player-2": 10 });
});

test("offre WebRTC peut être encodée et relue", () => {
  const description = { type: "offer", sdp: "v=0\r\na=morentia-é\r\n" };
  assert.deepEqual(signalCode.decode(signalCode.encode(description)), description);
});

test("l’automate produit des actions jouables sur plusieurs tours", () => {
  const players = [
    { name: "K", faction: "Kalassir", isAI: true },
    { name: "A", faction: "Aqaba", isAI: true },
    { name: "G", faction: "Algarie", isAI: true },
  ];
  let state = createGame(CATALOG, { players, seed: "ai-smoke" });
  for (let step = 0; step < 80 && state.status === "playing"; step += 1) {
    const player = state.players[state.activePlayer];
    const action = chooseAIAction(state, player.id) || { type: "pass" };
    try {
      state = performAction(state, action, player.id);
    } catch (error) {
      assert.fail(`Action IA invalide à l’étape ${step}: ${JSON.stringify(action)} — ${error.message}`);
    }
  }
  assert.ok(state.day >= 2);
  assert.equal(getPlayer(state, "player-1").name, "K");
});
