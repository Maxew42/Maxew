export type Slot = "left" | "arena" | "right";
export type Phase = "preparation" | "decisions" | "results" | "over";

export type Player = {
  id: string;
  name: string;
  isAI: boolean;
  hand: number[];
  deck: number[];
  discard: number[];
  placed: Record<Slot, number | null>;
  ready: boolean;
  trophies: number;
  playedTotals: number[];
};

export type RoundResult = {
  messages: string[];
  winnerSlots: string[];
  trophyGains: Record<string, number>;
  arenaWinners: string[];
};

export type GameState = {
  mode: "local" | "p2p";
  round: number;
  phase: Phase;
  players: Player[];
  pendingGontran: string[];
  roundResult: RoundResult | null;
  finalWinners: string[];
};

export const SLOTS: Slot[] = ["left", "arena", "right"];
export const DICE = [4, 2, 2, 0, -1, -5];

export const CARD_INFO: Record<
  number,
  { name: string; shortName: string; image: string; effect: string }
> = {
  1: {
    name: "David l’Halfelin",
    shortName: "David",
    image: "./cards/david.webp",
    effect: "S’il gagne, il rapporte 3 trophées au lieu d’un.",
  },
  2: {
    name: "Le Père Pair",
    shortName: "Père Pair",
    image: "./cards/le-pere-pair.webp",
    effect: "Il bat automatiquement les combattants de force de base paire.",
  },
  3: {
    name: "Laurent le Maître d’Armes",
    shortName: "Laurent",
    image: "./cards/laurent.webp",
    effect: "Tous vos autres combattants gagnent +4.",
  },
  4: {
    name: "Henriette Trompe-La-Mort",
    shortName: "Henriette",
    image: "./cards/henriette.webp",
    effect: "Dans l’arène, la force la plus faible l’emporte.",
  },
  5: {
    name: "Rosalie la Danseuse",
    shortName: "Rosalie",
    image: "./cards/rosalie.webp",
    effect: "Échange le combattant adverse avec sa carte d’arène.",
  },
  6: {
    name: "Gontran le Nécromant",
    shortName: "Gontran",
    image: "./cards/gontran.webp",
    effect: "Après le combat, peut être échangé avec votre défausse.",
  },
  7: {
    name: "Morgane la Sorcière",
    shortName: "Morgane",
    image: "./cards/morgane.webp",
    effect: "Copie la force de base de la première défausse adverse.",
  },
  8: {
    name: "Aliénor la Volage",
    shortName: "Aliénor",
    image: "./cards/alienor.webp",
    effect: "Après le combat, échange sa place avec l’opposant.",
  },
  9: {
    name: "Tracassin le Galopin",
    shortName: "Tracassin",
    image: "./cards/tracassin.webp",
    effect: "Lance le dé et ajoute son résultat à sa force.",
  },
  10: {
    name: "Jeanne la Preuse",
    shortName: "Jeanne",
    image: "./cards/jeanne.webp",
    effect: "+3 contre une base ≥ 10, sinon −3.",
  },
  11: {
    name: "Quasi-Maximus le Gladiateur",
    shortName: "Quasi-Maximus",
    image: "./cards/quasi-maximus.webp",
    effect: "Ne rapporte rien si vous perdez l’arène.",
  },
  12: {
    name: "Goliath le Géant",
    shortName: "Goliath",
    image: "./cards/goliath.webp",
    effect: "Goliath perd automatiquement contre David.",
  },
};

const emptyPlaced = (): Record<Slot, number | null> => ({
  left: null,
  arena: null,
  right: null,
});

const clone = <T,>(value: T): T => structuredClone(value);

const shuffled = <T,>(items: T[]): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

const makePlayer = (id: string, name: string, isAI: boolean): Player => {
  const deck = shuffled(Array.from({ length: 12 }, (_, index) => index + 1));
  const hand = [deck.pop()!, deck.pop()!, deck.pop()!];
  return {
    id,
    name,
    isAI,
    hand,
    deck,
    discard: [],
    placed: emptyPlaced(),
    ready: false,
    trophies: 0,
    playedTotals: [],
  };
};

export function createGame(
  roster: Array<{ id: string; name: string; isAI?: boolean }>,
  mode: "local" | "p2p",
): GameState {
  return seedAI({
    mode,
    round: 1,
    phase: "preparation",
    players: roster.map((entry) =>
      makePlayer(entry.id, entry.name, Boolean(entry.isAI)),
    ),
    pendingGontran: [],
    roundResult: null,
    finalWinners: [],
  });
}

export function seedAI(state: GameState): GameState {
  if (state.phase !== "preparation") return state;
  const next = clone(state);
  next.players.forEach((player) => {
    if (!player.isAI || player.ready) return;
    const cards = shuffled(player.hand);
    player.hand = [];
    player.placed = { left: cards[0], arena: cards[1], right: cards[2] };
    player.ready = true;
    player.playedTotals.push(cards[0] + cards[1] + cards[2]);
  });
  return next;
}

export function placeCard(
  state: GameState,
  playerId: string,
  card: number,
  slot: Slot,
): GameState {
  if (state.phase !== "preparation") return state;
  const next = clone(state);
  const player = next.players.find((entry) => entry.id === playerId);
  if (!player || player.ready) return state;
  const handIndex = player.hand.indexOf(card);
  if (handIndex < 0) return state;
  const previous = player.placed[slot];
  player.hand.splice(handIndex, 1);
  if (previous !== null) player.hand.push(previous);
  player.placed[slot] = card;
  return next;
}

export function unplaceCard(
  state: GameState,
  playerId: string,
  slot: Slot,
): GameState {
  if (state.phase !== "preparation") return state;
  const next = clone(state);
  const player = next.players.find((entry) => entry.id === playerId);
  if (!player || player.ready || player.placed[slot] === null) return state;
  player.hand.push(player.placed[slot]!);
  player.placed[slot] = null;
  return next;
}

export function markReady(state: GameState, playerId: string): GameState {
  if (state.phase !== "preparation") return state;
  const next = clone(state);
  const player = next.players.find((entry) => entry.id === playerId);
  if (!player || player.ready || SLOTS.some((slot) => player.placed[slot] === null)) {
    return state;
  }
  player.ready = true;
  player.playedTotals.push(
    SLOTS.reduce((total, slot) => total + (player.placed[slot] ?? 0), 0),
  );
  return next;
}

export const everyoneReady = (state: GameState) =>
  state.players.length >= 2 && state.players.every((player) => player.ready);

type Fighter = {
  playerId: string;
  slot: Slot;
  card: number;
  base: number;
  strength: number;
};

const fighterKey = (playerId: string, slot: Slot) => `${playerId}:${slot}`;

const opponentFor = (
  players: Player[],
  playerIndex: number,
  slot: "left" | "right",
) => {
  if (slot === "left") {
    return {
      player: players[(playerIndex - 1 + players.length) % players.length],
      slot: "right" as const,
    };
  }
  return {
    player: players[(playerIndex + 1) % players.length],
    slot: "left" as const,
  };
};

function joustWinner(a: Fighter, b: Fighter): Fighter | null {
  if (a.card === 2 && b.card === 2) return null;
  if (a.card === 12 && b.card === 1) return b;
  if (b.card === 12 && a.card === 1) return a;
  if (a.card === 2 && b.base % 2 === 0) return a;
  if (b.card === 2 && a.base % 2 === 0) return b;
  if (a.strength === b.strength) return null;
  return a.strength > b.strength ? a : b;
}

const trophyValue = (card: number) => (card === 1 ? 3 : 1);

export function resolveCombat(state: GameState): GameState {
  if (state.phase !== "preparation" || !everyoneReady(state)) return state;
  const next = clone(state);
  const messages: string[] = [];
  const winnerSlots: string[] = [];
  const trophyGains: Record<string, number> = Object.fromEntries(
    next.players.map((player) => [player.id, 0]),
  );

  // Rosalie agit avant tous les autres effets. Une Rosalie amenée de l’arène
  // n’est pas ajoutée à cette liste et ne déclenche donc jamais son effet.
  const initialRosalies = next.players.flatMap((player, index) =>
    (["left", "right"] as const)
      .filter((slot) => player.placed[slot] === 5)
      .map((slot) => ({ playerId: player.id, playerIndex: index, slot })),
  );
  initialRosalies.forEach((actor) => {
    const player = next.players[actor.playerIndex];
    if (player.id !== actor.playerId || player.placed[actor.slot] !== 5) return;
    const opponent = opponentFor(next.players, actor.playerIndex, actor.slot);
    const fieldCard = opponent.player.placed[opponent.slot];
    opponent.player.placed[opponent.slot] = opponent.player.placed.arena;
    opponent.player.placed.arena = fieldCard;
    messages.push(`${player.name} fait danser les cartes de ${opponent.player.name}.`);
  });

  const fighters = new Map<string, Fighter>();
  next.players.forEach((player) => {
    SLOTS.forEach((slot) => {
      const card = player.placed[slot]!;
      fighters.set(fighterKey(player.id, slot), {
        playerId: player.id,
        slot,
        card,
        base: card,
        strength: card,
      });
    });
  });

  // Morgane modifie d’abord la force de base adverse.
  next.players.forEach((player, index) => {
    (["left", "right"] as const).forEach((slot) => {
      if (player.placed[slot] !== 7) return;
      const opponent = opponentFor(next.players, index, slot);
      const topDiscard = opponent.player.discard.at(-1);
      if (topDiscard === undefined) return;
      const target = fighters.get(fighterKey(opponent.player.id, opponent.slot))!;
      target.base = topDiscard;
      target.strength = topDiscard;
      messages.push(`Morgane donne une force de base de ${topDiscard} à son adversaire.`);
    });
  });

  // Laurent renforce toutes les autres positions, y compris l’arène.
  next.players.forEach((player) => {
    const laurents = (["left", "right"] as const).filter(
      (slot) => player.placed[slot] === 3,
    ).length;
    if (!laurents) return;
    SLOTS.forEach((slot) => {
      if (player.placed[slot] !== 3) {
        fighters.get(fighterKey(player.id, slot))!.strength += 4 * laurents;
      }
    });
    messages.push(`${player.name} reçoit l’enseignement de Laurent (+4).`);
  });

  next.players.forEach((player, index) => {
    (["left", "right"] as const).forEach((slot) => {
      const fighter = fighters.get(fighterKey(player.id, slot))!;
      if (fighter.card === 9) {
        const roll = DICE[Math.floor(Math.random() * DICE.length)];
        fighter.strength += roll;
        messages.push(`Tracassin lance le dé : ${roll >= 0 ? "+" : ""}${roll}.`);
      }
      if (fighter.card === 10) {
        const opponent = opponentFor(next.players, index, slot);
        const opposing = fighters.get(
          fighterKey(opponent.player.id, opponent.slot),
        )!;
        const modifier = opposing.base >= 10 ? 3 : -3;
        fighter.strength += modifier;
        messages.push(`Jeanne reçoit ${modifier > 0 ? "+3" : "−3"}.`);
      }
    });
  });

  // Combat d’arène : Henriette inverse le critère si elle est présente.
  const arena = next.players.map((player) =>
    fighters.get(fighterKey(player.id, "arena"))!,
  );
  const reversedArena = arena.some((fighter) => fighter.card === 4);
  const targetStrength = reversedArena
    ? Math.min(...arena.map((fighter) => fighter.strength))
    : Math.max(...arena.map((fighter) => fighter.strength));
  const arenaWinners = arena
    .filter((fighter) => fighter.strength === targetStrength)
    .map((fighter) => fighter.playerId);
  arena.forEach((fighter) => {
    if (!arenaWinners.includes(fighter.playerId)) return;
    const points = trophyValue(fighter.card);
    trophyGains[fighter.playerId] += points;
    winnerSlots.push(fighterKey(fighter.playerId, "arena"));
  });
  messages.push(
    reversedArena
      ? "Henriette renverse l’arène : la force la plus faible l’emporte."
      : arenaWinners.length > 1
        ? "Égalité dans l’arène : chaque meilleure force gagne."
        : "L’arène a trouvé son champion.",
  );

  // Chaque arête de la table est une joute : droite d’un joueur contre gauche du suivant.
  next.players.forEach((player, index) => {
    const opponent = next.players[(index + 1) % next.players.length];
    const a = fighters.get(fighterKey(player.id, "right"))!;
    const b = fighters.get(fighterKey(opponent.id, "left"))!;
    const winner = joustWinner(a, b);
    if (!winner) {
      messages.push(`${CARD_INFO[a.card].shortName} et ${CARD_INFO[b.card].shortName} font match nul.`);
      return;
    }
    winnerSlots.push(fighterKey(winner.playerId, winner.slot));
    if (winner.card === 11 && !arenaWinners.includes(winner.playerId)) {
      messages.push("Quasi-Maximus gagne sa joute mais pas de trophée sans l’arène.");
      return;
    }
    trophyGains[winner.playerId] += trophyValue(winner.card);
  });

  next.players.forEach((player) => {
    const gain = trophyGains[player.id];
    player.trophies += gain;
    if (gain > 0) messages.push(`${player.name} gagne ${gain} trophée${gain > 1 ? "s" : ""}.`);
  });

  const pending: string[] = [];
  next.players.forEach((player) => {
    const gontranSlot = (["left", "right"] as const).find(
      (slot) => player.placed[slot] === 6,
    );
    if (!gontranSlot || player.discard.length === 0) return;
    if (player.isAI) {
      const best = Math.max(...player.discard);
      if (best > 6) {
        const discardIndex = player.discard.lastIndexOf(best);
        player.discard[discardIndex] = 6;
        player.placed[gontranSlot] = best;
        messages.push(`${player.name} rappelle une force ${best} avec Gontran.`);
      }
    } else {
      pending.push(player.id);
    }
  });

  next.roundResult = { messages, winnerSlots, trophyGains, arenaWinners };
  next.pendingGontran = pending;
  next.phase = pending.length ? "decisions" : "results";
  if (!pending.length) applyAlienor(next);
  return next;
}

function applyAlienor(state: GameState) {
  const messages = state.roundResult?.messages ?? [];
  state.players.forEach((player, index) => {
    const opponent = state.players[(index + 1) % state.players.length];
    const a = player.placed.right;
    const b = opponent.placed.left;
    if (a !== 8 && b !== 8) return;
    player.placed.right = b;
    opponent.placed.left = a;
    messages.push(`Aliénor échange les cartes de ${player.name} et ${opponent.name}.`);
  });
}

export function resolveGontranChoice(
  state: GameState,
  playerId: string,
  discardIndex: number | null,
): GameState {
  if (state.phase !== "decisions" || !state.pendingGontran.includes(playerId)) {
    return state;
  }
  const next = clone(state);
  const player = next.players.find((entry) => entry.id === playerId)!;
  const gontranSlot = (["left", "right"] as const).find(
    (slot) => player.placed[slot] === 6,
  );
  if (
    gontranSlot &&
    discardIndex !== null &&
    discardIndex >= 0 &&
    discardIndex < player.discard.length
  ) {
    const recalled = player.discard[discardIndex];
    player.discard[discardIndex] = 6;
    player.placed[gontranSlot] = recalled;
    next.roundResult?.messages.push(
      `${player.name} échange Gontran contre ${CARD_INFO[recalled].shortName}.`,
    );
  }
  next.pendingGontran = next.pendingGontran.filter((id) => id !== playerId);
  if (!next.pendingGontran.length) {
    applyAlienor(next);
    next.phase = "results";
  }
  return next;
}

export function cleanupRound(state: GameState): GameState {
  if (state.phase !== "results") return state;
  const next = clone(state);
  next.players.forEach((player) => {
    player.discard.push(player.placed.arena!);
    player.hand.push(player.placed.left!, player.placed.right!);
    if (player.deck.length) player.hand.push(player.deck.pop()!);
    player.placed = emptyPlaced();
    player.ready = false;
  });
  next.pendingGontran = [];
  next.roundResult = null;
  if (next.round >= 10) {
    next.phase = "over";
    const bestScore = Math.max(...next.players.map((player) => player.trophies));
    const finalists = next.players.filter((player) => player.trophies === bestScore);
    const lowestLastTotal = Math.min(
      ...finalists.map((player) => player.playedTotals.at(-1) ?? 99),
    );
    next.finalWinners = finalists
      .filter((player) => (player.playedTotals.at(-1) ?? 99) === lowestLastTotal)
      .map((player) => player.id);
    return next;
  }
  next.round += 1;
  next.phase = "preparation";
  return seedAI(next);
}

export function sanitizeState(state: GameState, viewerId: string): GameState {
  const safe = clone(state);
  safe.players.forEach((player) => {
    if (player.id === viewerId) return;
    player.hand = player.hand.map(() => 0);
    player.deck = player.deck.map(() => 0);
    if (safe.phase === "preparation") {
      SLOTS.forEach((slot) => {
        if (player.placed[slot] !== null) player.placed[slot] = -1;
      });
    }
  });
  return safe;
}
