import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupRound,
  createGame,
  markReady,
  placeCard,
  resolveCombat,
  sanitizeState,
  type GameState,
  type Slot,
} from "../app/game.ts";

const slots: Slot[] = ["left", "arena", "right"];

function preparedGame(a: number[], b: number[]) {
  let game = createGame(
    [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    "local",
  );
  game.players[0].hand = [...a];
  game.players[1].hand = [...b];
  game.players.forEach((player) => {
    player.placed = { left: null, arena: null, right: null };
    player.ready = false;
    player.discard = [];
    player.trophies = 0;
    player.playedTotals = [];
  });
  slots.forEach((slot, index) => (game = placeCard(game, "a", a[index], slot)));
  slots.forEach((slot, index) => (game = placeCard(game, "b", b[index], slot)));
  game = markReady(game, "a");
  game = markReady(game, "b");
  return game;
}

test("le Père Pair bat une force de base paire", () => {
  const result = resolveCombat(preparedGame([9, 6, 2], [12, 4, 7]));
  assert.equal(result.phase, "results");
  assert.ok(result.roundResult?.winnerSlots.includes("a:right"));
});

test("deux Pères Pair font toujours match nul", () => {
  const result = resolveCombat(preparedGame([3, 4, 2], [2, 6, 8]));
  assert.ok(!result.roundResult?.winnerSlots.includes("a:right"));
  assert.ok(!result.roundResult?.winnerSlots.includes("b:left"));
});

test("David terrasse Goliath et gagne trois trophées", () => {
  const result = resolveCombat(preparedGame([8, 6, 12], [1, 4, 7]));
  assert.ok(result.roundResult?.winnerSlots.includes("b:left"));
  // Trois pour David dans la joute, plus un pour Henriette dans l’arène.
  assert.equal(result.roundResult?.trophyGains.b, 4);
});

test("l’hôte masque les mains et les pioches adverses", () => {
  const game = preparedGame([8, 6, 12], [1, 4, 7]);
  const safe = sanitizeState(game, "a");
  assert.deepEqual(safe.players[1].hand, []);
  assert.ok(safe.players[1].deck.every((card) => card === 0));
  assert.ok(slots.every((slot) => safe.players[1].placed[slot] === -1));
});

test("le départage final favorise la plus faible dernière sélection", () => {
  const game = preparedGame([8, 6, 12], [1, 4, 7]);
  const state: GameState = {
    ...game,
    round: 10,
    phase: "results",
    players: game.players.map((player, index) => ({
      ...player,
      trophies: 7,
      playedTotals: [index === 0 ? 26 : 12],
    })),
  };
  const final = cleanupRound(state);
  assert.equal(final.phase, "over");
  assert.deepEqual(final.finalWinners, ["b"]);
});
