"use client";

import { useEffect, useRef, useState } from "react";
import {
  CARD_INFO,
  SLOTS,
  cleanupRound,
  createGame,
  everyoneReady,
  markReady,
  placeCard,
  resolveCombat,
  resolveGontranChoice,
  sanitizeState,
  seedAI,
  unplaceCard,
  type GameState,
  type Player,
  type Slot,
} from "./game";

type Screen = "menu" | "lobby" | "game";
type NetworkRole = "none" | "host" | "guest";
type LobbyPlayer = { id: string; name: string; connected: boolean };
type PeerEntry = { pc: RTCPeerConnection; channel: RTCDataChannel | null };
type DragGhost = { card: number; x: number; y: number } | null;

const SLOT_LABELS: Record<Slot, string> = {
  left: "Joute gauche",
  arena: "Arène",
  right: "Joute droite",
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function encodeSignal(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function decodeSignal<T>(value: string): T {
  const binary = atob(value.trim());
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timeout = window.setTimeout(finish, 7000);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function CardImage({
  card,
  className = "",
  alt,
}: {
  card: number | null;
  className?: string;
  alt?: string;
}) {
  const hidden = card === null || card <= 0;
  const source = hidden ? "./cards/background.webp" : CARD_INFO[card].image;
  return (
    <img
      className={`card-image ${className}`}
      src={source}
      alt={alt ?? (hidden ? "Dos de carte" : CARD_INFO[card].name)}
      draggable={false}
    />
  );
}

function Pile({
  label,
  count,
  top,
}: {
  label: string;
  count: number;
  top?: number;
}) {
  return (
    <div className="pile" aria-label={`${label} : ${count} cartes`}>
      <div className={`pile-card ${count ? "has-cards" : "empty"}`}>
        {count > 0 ? <CardImage card={top ?? 0} /> : <span>—</span>}
        <b>{count}</b>
      </div>
      <span>{label}</span>
    </div>
  );
}

function MiniSeat({
  player,
  selfId,
  game,
}: {
  player: Player;
  selfId: string;
  game: GameState;
}) {
  return (
    <article className={`mini-seat ${player.ready ? "is-ready" : ""}`}>
      <header>
        <div>
          <span className="status-dot" />
          <strong>{player.name}</strong>
          {player.isAI && <small>IA</small>}
        </div>
        <span className="score"><i>◆</i> {player.trophies}</span>
      </header>
      <div className="mini-seat-body">
        <div className="mini-piles">
          <Pile label="Pioche" count={player.deck.length} />
          <Pile
            label="Défausse"
            count={player.discard.length}
            top={player.discard.at(-1)}
          />
        </div>
        <div className="mini-slots">
          {SLOTS.map((slot) => {
            const card = player.placed[slot];
            const winner = game.roundResult?.winnerSlots.includes(
              `${player.id}:${slot}`,
            );
            return (
              <div
                className={`mini-slot ${slot === "arena" ? "arena" : ""} ${winner ? "winner" : ""}`}
                key={slot}
                title={SLOT_LABELS[slot]}
              >
                {card !== null ? (
                  <CardImage
                    card={
                      game.phase === "preparation" && player.id !== selfId
                        ? 0
                        : card
                    }
                  />
                ) : (
                  <span>{slot === "arena" ? "A" : "J"}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <footer>
        {player.ready ? "Prêt pour le combat" : `${player.hand.length} cartes en main`}
      </footer>
    </article>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="rules-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="close-button" onClick={onClose} aria-label="Fermer">
          ×
        </button>
        <p className="eyebrow">RÈGLES DU TOURNOI</p>
        <h2 id="rules-title">Trois cartes. Trois combats. Dix manches.</h2>
        <div className="rules-columns">
          <div>
            <h3>1 · Préparation</h3>
            <p>
              Placez une carte dans chaque joute et une dans l’arène. Lorsque
              tout le monde est prêt, les combattants sont révélés.
            </p>
            <h3>2 · Combat</h3>
            <p>
              Les joutes opposent les voisins. Dans l’arène, la meilleure force
              affronte toutes les autres. Les égalités de joute ne rapportent rien.
            </p>
            <h3>3 · Fin de manche</h3>
            <p>
              La carte d’arène va dans la défausse, les cartes de joute reviennent
              en main, puis une carte est piochée. Après dix manches, le plus riche
              en trophées l’emporte.
            </p>
          </div>
          <div className="effect-order">
            <h3>Ordre des effets</h3>
            <p><b>Avant tout :</b> Rosalie.</p>
            <p><b>Avant le combat :</b> Morgane, Tracassin, Jeanne et Laurent.</p>
            <p><b>Pendant :</b> Goliath et le Père Pair.</p>
            <p><b>Après :</b> David, Quasi‑Maximus et Gontran.</p>
            <p><b>En dernier :</b> Aliénor.</p>
            <p className="rule-note">
              Dans l’arène, seuls les effets d’Henriette et de David s’appliquent.
            </p>
          </div>
        </div>
        <div className="card-codex">
          {Object.entries(CARD_INFO).map(([number, card]) => (
            <div key={number}>
              <b>{number}</b>
              <span><strong>{card.shortName}</strong>{card.effect}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [playerName, setPlayerName] = useState("Chevalier");
  const [aiCount, setAiCount] = useState(2);
  const [game, setGame] = useState<GameState | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const [selfId, setSelfId] = useState("local");
  const selfIdRef = useRef("local");
  const [role, setRole] = useState<NetworkRole>("none");
  const roleRef = useRef<NetworkRole>("none");
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const lobbyRef = useRef<LobbyPlayer[]>([]);
  const connections = useRef(new Map<string, PeerEntry>());
  const messageHandler = useRef<(peerId: string, data: string) => void>(() => {});
  const [inviteCode, setInviteCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [hostAnswer, setHostAnswer] = useState("");
  const [networkStatus, setNetworkStatus] = useState("");
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [inspectedCard, setInspectedCard] = useState<number | null>(null);
  const [dragGhost, setDragGhost] = useState<DragGhost>(null);
  const draggingCard = useRef<number | null>(null);

  const updateLobby = (next: LobbyPlayer[]) => {
    lobbyRef.current = next;
    setLobbyPlayers(next);
  };

  const send = (peerId: string, payload: unknown) => {
    const channel = connections.current.get(peerId)?.channel;
    if (channel?.readyState === "open") channel.send(JSON.stringify(payload));
  };

  const broadcastLobby = (players = lobbyRef.current) => {
    connections.current.forEach((entry) => {
      if (entry.channel?.readyState === "open") {
        entry.channel.send(JSON.stringify({ type: "LOBBY", players }));
      }
    });
  };

  const commitGame = (next: GameState) => {
    gameRef.current = next;
    setGame(next);
    if (roleRef.current === "host") {
      connections.current.forEach((entry, peerId) => {
        if (entry.channel?.readyState === "open") {
          entry.channel.send(
            JSON.stringify({ type: "STATE", state: sanitizeState(next, peerId) }),
          );
        }
      });
    }
  };

  const setIdentity = (id: string, nextRole: NetworkRole) => {
    selfIdRef.current = id;
    setSelfId(id);
    roleRef.current = nextRole;
    setRole(nextRole);
  };

  const installHostChannel = (peerId: string, channel: RTCDataChannel) => {
    const entry = connections.current.get(peerId);
    if (entry) entry.channel = channel;
    channel.onmessage = (event) => messageHandler.current(peerId, event.data);
    channel.onopen = () => {
      setNetworkStatus("Un chevalier a rejoint la table.");
      const existing = lobbyRef.current.find((player) => player.id === peerId);
      if (!existing) {
        const next = [
          ...lobbyRef.current,
          { id: peerId, name: "Invité", connected: true },
        ];
        updateLobby(next);
        broadcastLobby(next);
      }
    };
    channel.onclose = () => setNetworkStatus("Un joueur s’est déconnecté.");
  };

  const installGuestChannel = (peerId: string, channel: RTCDataChannel) => {
    const entry = connections.current.get(peerId);
    if (entry) entry.channel = channel;
    channel.onmessage = (event) => messageHandler.current(peerId, event.data);
    channel.onopen = () => {
      setNetworkStatus("Connexion directe établie avec l’hôte.");
      channel.send(JSON.stringify({ type: "HELLO", name: playerName.trim() || "Invité" }));
    };
    channel.onclose = () => setNetworkStatus("La connexion avec l’hôte est fermée.");
  };

  messageHandler.current = (peerId, raw) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (roleRef.current === "host") {
      if (message.type === "HELLO") {
        const name = String(message.name || "Invité").slice(0, 24);
        const next = lobbyRef.current.map((player) =>
          player.id === peerId ? { ...player, name, connected: true } : player,
        );
        updateLobby(next);
        broadcastLobby(next);
        return;
      }
      if (message.type === "ACTION" && gameRef.current) {
        const action = message.action as Record<string, unknown>;
        let next = gameRef.current;
        if (action.kind === "READY") {
          const placements = action.placements as Record<Slot, number>;
          const player = next.players.find((entry) => entry.id === peerId);
          const submitted = SLOTS.map((slot) => Number(placements?.[slot]));
          const valid =
            player &&
            new Set(submitted).size === 3 &&
            submitted.every((card) => player.hand.includes(card));
          if (valid) {
            SLOTS.forEach((slot) => {
              next = placeCard(next, peerId, Number(placements[slot]), slot);
            });
            next = markReady(next, peerId);
            if (everyoneReady(next)) next = resolveCombat(next);
            commitGame(next);
          }
        }
        if (action.kind === "GONTRAN") {
          next = resolveGontranChoice(
            next,
            peerId,
            action.discardIndex === null ? null : Number(action.discardIndex),
          );
          commitGame(next);
        }
      }
      return;
    }
    if (message.type === "LOBBY") {
      updateLobby(message.players as LobbyPlayer[]);
    }
    if (message.type === "STATE") {
      const next = message.state as GameState;
      gameRef.current = next;
      setGame(next);
      setScreen("game");
    }
  };

  useEffect(() => {
    return () => {
      connections.current.forEach(({ channel, pc }) => {
        channel?.close();
        pc.close();
      });
    };
  }, []);

  const startLocalGame = () => {
    setIdentity("local", "none");
    const aiNames = ["Ysabeau", "Sire Roland", "Mélusine", "Baudouin", "Agnès"];
    const roster = [
      { id: "local", name: playerName.trim() || "Chevalier" },
      ...aiNames.slice(0, aiCount).map((name, index) => ({
        id: `ia-${index + 1}`,
        name,
        isAI: true,
      })),
    ];
    commitGame(createGame(roster, "local"));
    setScreen("game");
  };

  const openMultiplayer = () => {
    setScreen("lobby");
    setNetworkStatus("");
    setInviteCode("");
    setAnswerCode("");
  };

  const becomeHost = () => {
    setIdentity("host", "host");
    const players = [
      { id: "host", name: playerName.trim() || "Hôte", connected: true },
    ];
    updateLobby(players);
    setNetworkStatus("Table créée. Invitez un joueur pour commencer.");
  };

  const createInvitation = async () => {
    try {
      setNetworkStatus("Préparation de l’invitation…");
      const peerId = `pair-${crypto.randomUUID()}`;
      const pc = new RTCPeerConnection(RTC_CONFIG);
      connections.current.set(peerId, { pc, channel: null });
      const channel = pc.createDataChannel("tournoi-des-douzes", { ordered: true });
      installHostChannel(peerId, channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      setInviteCode(
        encodeSignal({
          kind: "DOUZES_INVITE",
          peerId,
          hostName: playerName.trim() || "Hôte",
          description: pc.localDescription,
        }),
      );
      setNetworkStatus("Invitation prête à être envoyée.");
    } catch {
      setNetworkStatus("Impossible de préparer l’invitation dans ce navigateur.");
    }
  };

  const acceptHostAnswer = async () => {
    try {
      const answer = decodeSignal<{
        kind: string;
        peerId: string;
        description: RTCSessionDescriptionInit;
      }>(hostAnswer);
      if (answer.kind !== "DOUZES_ANSWER") throw new Error("bad answer");
      const entry = connections.current.get(answer.peerId);
      if (!entry) throw new Error("unknown peer");
      await entry.pc.setRemoteDescription(answer.description);
      setHostAnswer("");
      setInviteCode("");
      setNetworkStatus("Réponse acceptée. Connexion en cours…");
    } catch {
      setNetworkStatus("Cette réponse n’est pas valide pour l’invitation en cours.");
    }
  };

  const joinInvitation = async () => {
    try {
      setNetworkStatus("Connexion à la table…");
      const invitation = decodeSignal<{
        kind: string;
        peerId: string;
        hostName: string;
        description: RTCSessionDescriptionInit;
      }>(joinCode);
      if (invitation.kind !== "DOUZES_INVITE") throw new Error("bad invite");
      setIdentity(invitation.peerId, "guest");
      updateLobby([
        { id: "host", name: invitation.hostName, connected: true },
        {
          id: invitation.peerId,
          name: playerName.trim() || "Invité",
          connected: true,
        },
      ]);
      const pc = new RTCPeerConnection(RTC_CONFIG);
      connections.current.set("host", { pc, channel: null });
      pc.ondatachannel = (event) => installGuestChannel("host", event.channel);
      await pc.setRemoteDescription(invitation.description);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);
      setAnswerCode(
        encodeSignal({
          kind: "DOUZES_ANSWER",
          peerId: invitation.peerId,
          description: pc.localDescription,
        }),
      );
      setNetworkStatus("Réponse prête. Renvoyez-la à l’hôte.");
    } catch {
      setNetworkStatus("Cette invitation n’est pas valide ou a expiré.");
    }
  };

  const startP2PGame = () => {
    if (role !== "host" || lobbyPlayers.length < 2) return;
    const next = createGame(
      lobbyPlayers.map((player) => ({ id: player.id, name: player.name })),
      "p2p",
    );
    commitGame(next);
    setScreen("game");
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNetworkStatus("Code copié dans le presse‑papiers.");
    } catch {
      setNetworkStatus("Sélectionnez le code pour le copier manuellement.");
    }
  };

  const updatePlacement = (card: number, slot: Slot) => {
    if (!gameRef.current) return;
    const next = placeCard(gameRef.current, selfIdRef.current, card, slot);
    gameRef.current = next;
    setGame(next);
    setSelectedCard(null);
    setInspectedCard(card);
    if (roleRef.current === "host") commitGame(next);
  };

  const removePlacement = (slot: Slot) => {
    if (!gameRef.current) return;
    const next = unplaceCard(gameRef.current, selfIdRef.current, slot);
    gameRef.current = next;
    setGame(next);
    if (roleRef.current === "host") commitGame(next);
  };

  const submitReady = () => {
    if (!gameRef.current) return;
    const current = gameRef.current;
    const player = current.players.find((entry) => entry.id === selfIdRef.current);
    if (!player) return;
    if (roleRef.current === "guest") {
      const optimistic = markReady(current, selfIdRef.current);
      gameRef.current = optimistic;
      setGame(optimistic);
      send("host", {
        type: "ACTION",
        action: { kind: "READY", placements: player.placed },
      });
      return;
    }
    let next = markReady(current, selfIdRef.current);
    if (everyoneReady(next)) next = resolveCombat(next);
    commitGame(next);
  };

  const chooseGontran = (discardIndex: number | null) => {
    if (!gameRef.current) return;
    if (roleRef.current === "guest") {
      send("host", {
        type: "ACTION",
        action: { kind: "GONTRAN", discardIndex },
      });
      return;
    }
    commitGame(resolveGontranChoice(gameRef.current, selfIdRef.current, discardIndex));
  };

  const nextRound = () => {
    if (!gameRef.current || roleRef.current === "guest") return;
    commitGame(seedAI(cleanupRound(gameRef.current)));
  };

  const replay = () => {
    if (!gameRef.current || roleRef.current === "guest") return;
    const roster = gameRef.current.players.map((player) => ({
      id: player.id,
      name: player.name,
      isAI: player.isAI,
    }));
    commitGame(createGame(roster, gameRef.current.mode));
  };

  const leaveGame = () => {
    connections.current.forEach(({ channel, pc }) => {
      channel?.close();
      pc.close();
    });
    connections.current.clear();
    setIdentity("local", "none");
    setGame(null);
    gameRef.current = null;
    updateLobby([]);
    setScreen("menu");
  };

  const pointerStart = (event: React.PointerEvent, card: number) => {
    if (game?.phase !== "preparation") return;
    draggingCard.current = card;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragGhost({ card, x: event.clientX, y: event.clientY });
  };

  const pointerMove = (event: React.PointerEvent) => {
    if (draggingCard.current === null) return;
    setDragGhost({ card: draggingCard.current, x: event.clientX, y: event.clientY });
  };

  const pointerEnd = (event: React.PointerEvent) => {
    const card = draggingCard.current;
    draggingCard.current = null;
    setDragGhost(null);
    if (card === null) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-drop-slot]");
    const slot = target?.dataset.dropSlot as Slot | undefined;
    if (slot) updatePlacement(card, slot);
  };

  if (screen === "menu") {
    return (
      <main className="home-screen">
        <div className="torch-glow left" />
        <div className="torch-glow right" />
        <section className="hero-panel">
          <div className="crest" aria-hidden="true"><span>XII</span></div>
          <p className="eyebrow">LE JEU DE CARTES MÉDIÉVAL</p>
          <h1><span>LE TOURNOI</span> DES DOUZES</h1>
          <p className="hero-copy">
            Placez vos combattants. Déjouez les pouvoirs adverses.
            Remportez l’arène avant la dixième manche.
          </p>
          <label className="name-field">
            <span>VOTRE NOM DE TOURNOI</span>
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value.slice(0, 24))}
              placeholder="Chevalier"
            />
          </label>
          <div className="mode-grid">
            <article className="mode-card primary">
              <span className="mode-icon">♞</span>
              <div><small>PARTIE RAPIDE</small><h2>Affronter l’IA</h2></div>
              <p>Une table vivante, de 2 à 6 combattants.</p>
              <label>
                <span>Adversaires</span>
                <select value={aiCount} onChange={(event) => setAiCount(Number(event.target.value))}>
                  {[1, 2, 3, 4, 5].map((count) => (
                    <option value={count} key={count}>{count}</option>
                  ))}
                </select>
              </label>
              <button className="gold-button" onClick={startLocalGame}>Entrer dans l’arène</button>
            </article>
            <article className="mode-card">
              <span className="mode-icon">⚔</span>
              <div><small>MULTIJOUEUR</small><h2>Défier des amis</h2></div>
              <p>Connexion directe entre navigateurs, sans serveur de partie.</p>
              <div className="p2p-badge"><i /> WEBRTC · PAIR À PAIR</div>
              <button className="outline-button" onClick={openMultiplayer}>Créer ou rejoindre</button>
            </article>
          </div>
          <button className="rules-link" onClick={() => setRulesOpen(true)}>☰ &nbsp; Lire les règles</button>
        </section>
        <footer className="home-footer">12 combattants · 3 champs · 10 manches</footer>
        {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
      </main>
    );
  }

  if (screen === "lobby") {
    return (
      <main className="lobby-screen">
        <header className="brand-bar">
          <button className="back-button" onClick={leaveGame}>← Retour</button>
          <div className="mini-brand"><b>XII</b><span>LE TOURNOI<br />DES DOUZES</span></div>
          <button className="rules-link" onClick={() => setRulesOpen(true)}>Règles</button>
        </header>
        <section className="lobby-card">
          <p className="eyebrow">SALLE DES CHEVALIERS</p>
          <h1>Table multijoueur</h1>
          <p className="lobby-intro">
            L’hôte synchronise la partie directement avec chaque joueur. Les codes
            ci-dessous servent uniquement à établir la connexion WebRTC.
          </p>

          {role === "none" && (
            <div className="lobby-choice">
              <button onClick={becomeHost}>
                <b>♛</b><strong>Créer la table</strong><span>Vous serez l’hôte de la partie.</span>
              </button>
              <button onClick={() => setIdentity("pending", "guest")}>
                <b>♞</b><strong>Rejoindre</strong><span>J’ai reçu un code d’invitation.</span>
              </button>
            </div>
          )}

          {role === "host" && (
            <div className="host-lobby">
              <div className="roster-panel">
                <div className="section-title"><span>JOUEURS À TABLE</span><b>{lobbyPlayers.length}/6</b></div>
                <ul>
                  {lobbyPlayers.map((player, index) => (
                    <li key={player.id}>
                      <span>{index + 1}</span><strong>{player.name}</strong>
                      <i>{player.id === "host" ? "HÔTE" : player.connected ? "PRÊT" : "…"}</i>
                    </li>
                  ))}
                </ul>
                <button
                  className="gold-button"
                  disabled={lobbyPlayers.length < 2}
                  onClick={startP2PGame}
                >
                  Lancer la partie
                </button>
                <small>Aucune IA ne complétera les places libres.</small>
              </div>
              <div className="signal-panel">
                <div className="step"><b>1</b><span>Créez une invitation pour un joueur.</span></div>
                <button className="outline-button compact" onClick={createInvitation}>Nouvelle invitation</button>
                {inviteCode && (
                  <>
                    <textarea readOnly value={inviteCode} aria-label="Code d’invitation" />
                    <button className="copy-button" onClick={() => copyText(inviteCode)}>Copier l’invitation</button>
                  </>
                )}
                <div className="step"><b>2</b><span>Collez ici la réponse renvoyée par votre invité.</span></div>
                <textarea
                  value={hostAnswer}
                  onChange={(event) => setHostAnswer(event.target.value)}
                  placeholder="Code de réponse…"
                  aria-label="Réponse du joueur"
                />
                <button className="outline-button compact" disabled={!hostAnswer.trim()} onClick={acceptHostAnswer}>
                  Accepter la réponse
                </button>
              </div>
            </div>
          )}

          {role === "guest" && (
            <div className="join-panel">
              {!answerCode ? (
                <>
                  <div className="step"><b>1</b><span>Collez le code d’invitation reçu de l’hôte.</span></div>
                  <textarea
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    placeholder="Code d’invitation…"
                    aria-label="Code d’invitation reçu"
                  />
                  <button className="gold-button" disabled={!joinCode.trim()} onClick={joinInvitation}>
                    Préparer ma réponse
                  </button>
                </>
              ) : (
                <>
                  <div className="step"><b>2</b><span>Renvoyez ce code à l’hôte, puis attendez le départ.</span></div>
                  <textarea readOnly value={answerCode} aria-label="Code de réponse" />
                  <button className="copy-button" onClick={() => copyText(answerCode)}>Copier ma réponse</button>
                  <div className="waiting-rune"><span>✦</span> En attente de l’hôte…</div>
                </>
              )}
            </div>
          )}
          {networkStatus && <p className="network-status"><i />{networkStatus}</p>}
        </section>
        {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
      </main>
    );
  }

  if (!game) return null;
  const currentPlayer = game.players.find((player) => player.id === selfId)!;
  const opponents = game.players.filter((player) => player.id !== selfId);
  const canControlRound = role !== "guest";
  const isWinner = game.finalWinners.includes(selfId);
  const phaseLabel = {
    preparation: "PRÉPARATION",
    decisions: "CHOIX DE GONTRAN",
    results: "RÉSULTATS",
    over: "TOURNOI TERMINÉ",
  }[game.phase];
  const allPlaced = SLOTS.every((slot) => currentPlayer.placed[slot] !== null);
  const decisionPlayer = game.pendingGontran.includes(selfId);

  return (
    <main className="game-screen">
      <div className="rotate-device">
        <span>↻</span><b>Tournez votre appareil</b><p>Le tournoi se joue en mode paysage.</p>
      </div>
      <header className="game-topbar">
        <div className="mini-brand"><b>XII</b><span>LE TOURNOI<br />DES DOUZES</span></div>
        <div className="round-indicator">
          <span>MANCHE</span><strong>{game.round}<i>/10</i></strong>
          <div>{Array.from({ length: 10 }, (_, index) => <i className={index < game.round ? "on" : ""} key={index} />)}</div>
        </div>
        <div className="top-actions">
          <span className={`phase-pill ${game.phase}`}>{phaseLabel}</span>
          <button onClick={() => setRulesOpen(true)} aria-label="Voir les règles">?</button>
          <button onClick={leaveGame} aria-label="Quitter la partie">×</button>
        </div>
      </header>

      {game.phase === "over" ? (
        <section className="victory-screen">
          <div className="victory-radiance" />
          <div className="victory-medal">◆<span>{Math.max(...game.players.map((player) => player.trophies))}</span></div>
          <p className="eyebrow">LE TOURNOI EST ACHEVÉ</p>
          <h1>{isWinner ? "Victoire !" : `${game.players.find((p) => game.finalWinners.includes(p.id))?.name} triomphe`}</h1>
          <p>{isWinner ? "Votre bannière flottera au-dessus de l’arène." : "L’honneur est sauf. La revanche vous attend."}</p>
          <div className="final-ranking">
            {[...game.players].sort((a, b) => b.trophies - a.trophies).map((player, index) => (
              <div key={player.id} className={game.finalWinners.includes(player.id) ? "champion" : ""}>
                <span>{index + 1}</span><strong>{player.name}</strong><b>◆ {player.trophies}</b>
              </div>
            ))}
          </div>
          <div className="victory-actions">
            {canControlRound && <button className="gold-button" onClick={replay}>Rejouer</button>}
            <button className="outline-button" onClick={leaveGame}>Retour à l’accueil</button>
          </div>
        </section>
      ) : (
        <div className="game-layout">
          <section className="opponents-rail" aria-label="Adversaires">
            {opponents.map((player) => (
              <MiniSeat player={player} selfId={selfId} game={game} key={player.id} />
            ))}
          </section>

          <section className="arena-table">
            <div className="table-ornament" aria-hidden="true"><span>⚔</span></div>
            <div className="arena-copy">
              <p className="eyebrow">{game.phase === "preparation" ? "CHOISISSEZ VOS COMBATTANTS" : "LES CARTES SONT RÉVÉLÉES"}</p>
              <h2>{game.phase === "preparation" ? "Préparez vos trois positions" : "Que les combats commencent !"}</h2>
              <p>
                {game.phase === "preparation"
                  ? "Glissez une carte dans chaque emplacement."
                  : game.roundResult?.messages.at(-1)}
              </p>
            </div>
            {game.roundResult && (
              <details className="combat-log" open={game.phase === "results"}>
                <summary>Chronique du combat</summary>
                <div>{game.roundResult.messages.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}</div>
              </details>
            )}
          </section>

          <section className="player-board">
            <div className="player-piles">
              <Pile label="Pioche" count={currentPlayer.deck.length} />
              <Pile
                label="Défausse"
                count={currentPlayer.discard.length}
                top={currentPlayer.discard.at(-1)}
              />
            </div>
            <div className="placement-row">
              {SLOTS.map((slot) => {
                const card = currentPlayer.placed[slot];
                const winner = game.roundResult?.winnerSlots.includes(`${selfId}:${slot}`);
                return (
                  <button
                    className={`placement-slot ${slot === "arena" ? "arena" : ""} ${card !== null ? "filled" : ""} ${winner ? "winner" : ""}`}
                    key={slot}
                    data-drop-slot={slot}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const cardNumber = Number(event.dataTransfer.getData("text/card"));
                      if (cardNumber) updatePlacement(cardNumber, slot);
                    }}
                    onClick={() => {
                      if (selectedCard !== null) updatePlacement(selectedCard, slot);
                      else if (card !== null) removePlacement(slot);
                    }}
                    disabled={currentPlayer.ready || game.phase !== "preparation"}
                    aria-label={`${SLOT_LABELS[slot]}${card ? ` : ${CARD_INFO[card]?.name ?? "carte cachée"}` : " vide"}`}
                  >
                    <span className="slot-label">{slot === "arena" ? "◆ " : "⚔ "}{SLOT_LABELS[slot]}</span>
                    {card !== null ? (
                      <CardImage card={card} className={game.phase === "preparation" ? "concealed" : ""} />
                    ) : (
                      <span className="drop-hint"><i>+</i> Déposer</span>
                    )}
                    {winner && <span className="trophy-burst">◆</span>}
                  </button>
                );
              })}
            </div>
            <div className="player-status">
              <span><i className="status-dot" />{currentPlayer.name}</span>
              <b>◆ {currentPlayer.trophies}</b>
            </div>
          </section>

          <aside className="hand-dock">
            <div className="hand-title"><span>VOTRE MAIN</span><b>{currentPlayer.hand.length}</b></div>
            <div className="hand-cards">
              {currentPlayer.hand.map((card) => (
                <button
                  className={`hand-card ${selectedCard === card ? "selected" : ""}`}
                  key={card}
                  draggable={!currentPlayer.ready}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/card", String(card));
                    event.dataTransfer.effectAllowed = "move";
                    setInspectedCard(card);
                  }}
                  onPointerDown={(event) => pointerStart(event, card)}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerEnd}
                  onPointerCancel={() => { draggingCard.current = null; setDragGhost(null); }}
                  onMouseEnter={() => setInspectedCard(card)}
                  onClick={() => { setSelectedCard(selectedCard === card ? null : card); setInspectedCard(card); }}
                  disabled={currentPlayer.ready || game.phase !== "preparation"}
                  aria-label={`${CARD_INFO[card].name}, force ${card}`}
                >
                  <CardImage card={card} />
                </button>
              ))}
            </div>
            {inspectedCard && CARD_INFO[inspectedCard] && (
              <div className="card-detail">
                <b>{CARD_INFO[inspectedCard].name}</b>
                <p>{CARD_INFO[inspectedCard].effect}</p>
              </div>
            )}
            {game.phase === "preparation" && (
              <button
                className="ready-button"
                disabled={!allPlaced || currentPlayer.ready}
                onClick={submitReady}
              >
                {currentPlayer.ready ? "En attente…" : "Je suis prêt"}
              </button>
            )}
            {game.phase === "results" && (
              canControlRound ? (
                <button className="ready-button" onClick={nextRound}>
                  {game.round === 10 ? "Voir le vainqueur" : "Manche suivante"}
                </button>
              ) : (
                <p className="host-wait">L’hôte prépare la suite…</p>
              )
            )}
          </aside>
        </div>
      )}

      {game.phase === "decisions" && (
        <div className="modal-backdrop decision-backdrop">
          {decisionPlayer ? (
            <section className="decision-modal" role="dialog" aria-modal="true">
              <CardImage card={6} />
              <div>
                <p className="eyebrow">POUVOIR DE GONTRAN</p>
                <h2>Rappeler un combattant ?</h2>
                <p>Échangez Gontran contre une carte de votre défausse, ou laissez-le revenir en main.</p>
                <div className="discard-choice">
                  {currentPlayer.discard.map((card, index) => (
                    <button key={`${card}-${index}`} onClick={() => chooseGontran(index)}>
                      <CardImage card={card} /><span>{CARD_INFO[card].shortName}</span>
                    </button>
                  ))}
                </div>
                <button className="outline-button compact" onClick={() => chooseGontran(null)}>Ne rien échanger</button>
              </div>
            </section>
          ) : (
            <div className="waiting-decision"><span>✦</span><b>Gontran consulte les morts…</b><p>Un autre joueur doit faire son choix.</p></div>
          )}
        </div>
      )}

      {dragGhost && (
        <div className="drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }}>
          <CardImage card={dragGhost.card} />
        </div>
      )}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </main>
  );
}
