import { CATALOG as BASE_CATALOG } from "./catalog.js";
import {
  catalogIndex, createGame, dehydrateGame, getCard, getLocation, hydrateGame,
  costFor, influenceOf, isAttachment, isDomainPermanent, isEphemeral, isUnit, locationTotals, performAction, summary,
} from "./engine.js";
import { chooseAIAction } from "./ai.js";
import { P2PSession } from "./p2p.js";
import { blankCard, exportMorentiaWorkbook, importMorentiaWorkbook } from "./xlsx.js";

const STORAGE = {
  catalog: "morentia.catalog.v1",
  design: "morentia.design.v1",
  game: "morentia.game.v1",
  perspective: "morentia.perspective.v1",
};

const DEFAULT_DESIGN = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  cardRadius: 15,
  artOpacity: 0.72,
  kalassirColor: "#a54843",
  aqabaColor: "#c38b3e",
  algarieColor: "#598664",
  marketColor: "#6e6a85",
  backgroundColor: "#17130f",
};

const app = document.querySelector("#app");
const actionDialog = document.querySelector("#actionDialog");
const actionContent = document.querySelector("#actionDialogContent");
const networkDialog = document.querySelector("#networkDialog");
const networkContent = document.querySelector("#networkDialogContent");
const settingsDialog = document.querySelector("#settingsDialog");
const settingsContent = document.querySelector("#settingsDialogContent");
const workbookInput = document.querySelector("#workbookInput");

let catalog = repairCatalogArtwork(loadJson(STORAGE.catalog, BASE_CATALOG));
let design = { ...DEFAULT_DESIGN, ...loadJson(STORAGE.design, {}) };
let game = null;
let history = [];
let currentView = location.hash.slice(1) || "game";
let studioFilter = "Toutes";
let studioSearch = "";
let selectedStudioCardId = null;
let perspectiveId = localStorage.getItem(STORAGE.perspective) || null;
let aiTimer = null;
let deferredInstall = null;
let pendingHostPeerId = null;
let networkStatus = { message: "Mode local", state: "idle", connected: 0 };
let chronicleOpen = false;
let pointerDrag = null;
let boardPan = null;
let boardScroll = { left: 85, top: 105 };
let suppressCardClickUntil = 0;

try {
  const storedGame = loadJson(STORAGE.game, null);
  if (storedGame) game = hydrateGame(storedGame, catalog);
} catch (error) {
  console.warn("Sauvegarde ignorée", error);
}

const p2p = new P2PSession({
  onMessage: handlePeerMessage,
  onStatus(status) {
    networkStatus = status;
    document.querySelector("#networkButton .status-dot")?.classList.toggle("connected", status.state === "connected");
    if (status.state === "connected" && p2p.role === "host" && game) broadcastState();
    if (networkDialog.open) renderNetworkDialog();
  },
});

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? structuredClone(fallback); }
  catch { return structuredClone(fallback); }
}

function repairCatalogArtwork(target) {
  const art = faction => faction === "Kalassir" ? "assets/art/kalassir.jpg"
    : faction === "Aqaba" ? "assets/art/aqaba.jpg"
    : faction === "Algarie" ? "assets/art/algarie.jpg"
    : "assets/art/neutral.jpg";
  for (const [faction, cards] of Object.entries(target.factions || {})) for (const card of cards) card.illustration ||= art(faction);
  for (const card of target.market || []) card.illustration ||= art("Marché");
  for (const card of target.specials || []) card.illustration ||= art("Spéciale");
  for (const card of target.locations || []) card.illustration ||= art("Lieu");
  return target;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function safeUrl(value) {
  const url = String(value || "assets/art/neutral.jpg").trim();
  if (/^(data:image\/|blob:)/i.test(url)) return url.replace(/["'()]/g, encodeURIComponent);
  if (/^https?:\/\//i.test(url)) return url.replace(/["'()]/g, encodeURIComponent);
  const relative = /^(assets\/|\.\/|\.\.\/)/i.test(url) ? url : "assets/art/neutral.jpg";
  return new URL(relative, document.baseURI).href.replace(/["'()]/g, encodeURIComponent);
}

function accentFor(faction, card = {}) {
  if (card.accent) return card.accent;
  return faction === "Kalassir" ? design.kalassirColor
    : faction === "Aqaba" ? design.aqabaColor
    : faction === "Algarie" ? design.algarieColor
    : design.marketColor;
}

function factionForCard(definition) {
  return definition?.faction || "Marché";
}

function applyDesign() {
  const root = document.documentElement.style;
  root.setProperty("--bg", design.backgroundColor);
  root.setProperty("--kalassir", design.kalassirColor);
  root.setProperty("--aqaba", design.aqabaColor);
  root.setProperty("--algarie", design.algarieColor);
  root.setProperty("--market", design.marketColor);
  root.setProperty("--card-radius", `${Number(design.cardRadius) || 15}px`);
  root.setProperty("--art-opacity", String(Number(design.artOpacity) || .72));
  root.setProperty("--font-display", design.fontFamily);
}

function toast(message, type = "info") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  document.querySelector("#toastRegion").append(element);
  setTimeout(() => element.remove(), 3600);
}

function saveAll() {
  localStorage.setItem(STORAGE.catalog, JSON.stringify(catalog));
  localStorage.setItem(STORAGE.design, JSON.stringify(design));
  if (game) localStorage.setItem(STORAGE.game, JSON.stringify(dehydrateGame(game)));
  else localStorage.removeItem(STORAGE.game);
}

function setView(view) {
  currentView = ["game", "studio", "rules"].includes(view) ? view : "game";
  window.history.replaceState(null, "", `#${currentView}`);
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === currentView));
  render();
}

function render() {
  applyDesign();
  if (currentView === "studio") renderStudio();
  else if (currentView === "rules") renderRules();
  else if (game) renderBoard();
  else renderSetup();
}

function renderSetup() {
  app.innerHTML = `
    <section class="setup-page">
      <div class="setup-hero">
        <div class="hero-copy">
          <p class="eyebrow">Un monde d’influence</p>
          <h1>Morentia</h1>
          <p class="lead">Prenez le contrôle des lieux, faites prospérer votre cité et survivez assez longtemps pour laisser votre marque.</p>
          <div class="button-row"><button class="ghost-button" data-nav="rules">Lire les règles</button><button class="ghost-button" data-nav="studio">Explorer les ${allCards().length} cartes</button></div>
        </div>
      </div>
      <div class="setup-panel">
        <form id="setupForm" class="setup-card">
          <p class="eyebrow">Nouvelle partie</p>
          <h2>Préparer la table</h2>
          <p>Jouez en tour partagé, contre l’automate ou connectez ensuite des navigateurs en P2P.</p>
          <div id="setupPlayers">
            ${setupPlayerRow(1, "Joueur", "Kalassir", false)}
            ${setupPlayerRow(2, "Automate", "Aqaba", true)}
          </div>
          <button type="button" class="ghost-button" id="addPlayer">+ Ajouter un troisième joueur</button>
          <div class="field-row" style="margin-top:18px">
            <div class="field"><label>Graine de partie</label><input name="seed" value="${Date.now().toString(36)}"></div>
            <div class="field"><label>Module Jadis</label><select name="jadis"><option value="false">Désactivé</option><option value="true">Activé</option></select></div>
          </div>
          <div class="setup-actions">
            <button class="primary-button" type="submit">Commencer la partie</button>
            <button class="icon-button" type="button" data-open-network title="Rejoindre une table P2P">⌁</button>
          </div>
          <div class="setup-note"><span>✦</span><span>Le premier déploiement de chaque Jour est gratuit ; les suivants coûtent 1 or. Les actions alternent jusqu’à ce que tous les joueurs passent.</span></div>
        </form>
      </div>
    </section>`;
}

function setupPlayerRow(index, name, faction, isAI) {
  return `<div class="player-row" data-player-row>
    <input name="playerName" value="${escapeHtml(name)}" aria-label="Nom du joueur ${index}">
    <select name="playerFaction" aria-label="Faction du joueur ${index}">${["Kalassir", "Aqaba", "Algarie"].map(item => `<option ${item === faction ? "selected" : ""}>${item}</option>`).join("")}</select>
    <button type="button" class="icon-button remove-player" data-remove-player aria-label="Retirer ce joueur">${isAI ? "IA" : "×"}</button>
    <label class="tiny" style="grid-column:1 / -1"><input type="checkbox" name="playerAI" ${isAI ? "checked" : ""}> Contrôlé par l’automate</label>
  </div>`;
}

function beginGame(form) {
  const rows = [...form.querySelectorAll("[data-player-row]")];
  const players = rows.map((row, index) => ({
    name: row.querySelector('[name="playerName"]').value.trim() || `Joueur ${index + 1}`,
    faction: row.querySelector('[name="playerFaction"]').value,
    isAI: row.querySelector('[name="playerAI"]').checked,
  }));
  if (new Set(players.map(player => player.faction)).size !== players.length) throw new Error("Chaque joueur doit choisir une faction différente.");
  game = createGame(catalog, { players, seed: form.seed.value, options: { includeJadis: form.jadis.value === "true" } });
  perspectiveId = game.players.find(player => !player.isAI)?.id || game.players[0].id;
  localStorage.setItem(STORAGE.perspective, perspectiveId);
  history = [];
  saveAll();
  render();
  runAIIfNeeded();
}

function cardHtml(card, definition, { source = "detail", selected = false } = {}) {
  const faction = factionForCard(definition);
  const accent = accentFor(faction, definition);
  const influence = game && card?.uid ? influenceOf(game, card) : definition.influence;
  const costs = [
    definition.domainCost != null ? `D${definition.domainCost}` : null,
    definition.locationCost != null ? `L${definition.locationCost}` : null,
    definition.uniqueCost != null ? `${definition.uniqueCost}` : null,
  ].filter(Boolean);
  const active = game?.players[game.activePlayer];
  const draggable = Boolean(card?.uid && ["hand", "market", "domain", "location"].includes(source)
    && active?.id === perspectiveId && game?.status === "playing" && game?.phase === "Journée"
    && !(source === "domain" && card.exhausted)
    && (source === "market" || card.controller === perspectiveId || card.owner === perspectiveId));
  return `<article class="game-card ${card?.exhausted ? "exhausted" : ""} ${selected ? "selected" : ""}" data-card-uid="${escapeHtml(card?.uid || "")}" data-drop-card-uid="${escapeHtml(card?.uid || "")}" data-card-id="${escapeHtml(definition.id)}" data-source="${source}" ${draggable ? `data-draggable="true"` : ""} style="--accent:${escapeHtml(accent)};--art:url('${safeUrl(definition.illustration)}')" tabindex="0" aria-label="${escapeHtml(definition.name)}">
    <div class="card-art"></div><div class="card-wash"></div><div class="card-frame"></div>
    <div class="card-titlebar"><h4 class="card-name">${escapeHtml(definition.name)}</h4><div class="card-type">${escapeHtml(definition.type)}${definition.subtype ? ` · ${escapeHtml(definition.subtype)}` : ""}</div></div>
    ${influence != null && influence !== "" ? `<div class="card-influence">${escapeHtml(influence)}</div>` : ""}
    <div class="card-costs">${costs.map(cost => `<span class="cost-orb">${escapeHtml(cost)}</span>`).join("")}</div>
    <span class="card-id">${escapeHtml(definition.id)}</span>
    <div class="card-content"><div class="card-text">${escapeHtml(definition.text || definition.effect || "")}</div></div>
  </article>`;
}

function playerColor(faction) { return accentFor(faction); }

function renderBoard() {
  const previousViewport = app.querySelector("[data-board-viewport]");
  if (previousViewport) boardScroll = { left: previousViewport.scrollLeft, top: previousViewport.scrollTop };
  game.index = catalogIndex(catalog);
  if (!perspectiveId || !game.players.some(player => player.id === perspectiveId)) perspectiveId = game.players[0].id;
  const active = game.players[game.activePlayer];
  const perspective = game.players.find(player => player.id === perspectiveId) || active;
  const info = summary(game);
  const percentage = Math.min(100, info.expiredLocations / info.endAt * 100);
  app.innerHTML = `<section class="game-shell">
    <header class="game-hud">
      <div class="phase-block"><div class="phase-seal">J${game.day}</div><div><strong>${escapeHtml(game.phase)}</strong><small>${game.status === "finished" ? "Partie terminée" : `À ${escapeHtml(active?.name || "—")} d’agir`}</small></div></div>
      <div class="progress-wrap"><div class="progress-label"><span>Lieux expirés</span><span>${game.expiredLocations} / ${info.endAt}</span></div><div class="progress"><span style="width:${percentage}%"></span></div></div>
      <div class="button-row hud-actions"><button class="ghost-button" data-undo ${history.length && p2p.role !== "guest" ? "" : "disabled"}>↶ Annuler</button><button class="primary-button" data-pass ${active?.id === perspective.id && game.status === "playing" && game.phase === "Journée" ? "" : "disabled"}>Passer</button></div>
    </header>
    <div class="game-stage">
      <div class="board-viewport" data-board-viewport>
        <div class="board-surface" data-board-surface>
          <div class="board-pan-hint">Maintenez et glissez le tapis pour vous déplacer</div>
          <section class="opponents-row">${game.players.filter(player => player.id !== perspective.id).map(player => opponentSeatHtml(player)).join("")}</section>
          <div class="central-table">
            <section class="table-zone locations-table"><div class="section-bar"><span class="section-title">Lieux</span><span class="section-meta">Déployez et déplacez vos unités</span></div><div class="location-grid">${game.locations.map(location => locationHtml(location)).join("")}</div></section>
            <section class="table-zone market-table"><div class="section-bar"><span class="section-title">Marché</span><span class="section-meta">${game.market.deck.length} dans la pioche</span></div><div class="market-row">${game.market.visible.map(card => cardHtml(card, game.index.cards[card.cardId], { source: "market" })).join("")}</div></section>
          </div>
          <section class="self-domain-table">${domainHtml(perspective, { self: true })}</section>
        </div>
      </div>
      <section class="player-console" style="--faction-color:${playerColor(perspective.faction)}">
        <div class="player-piles">
          ${pileHtml("Deck", perspective.deck.length, "deck")}
          ${pileHtml("Défausse", perspective.discard.length, "discard")}
        </div>
        <div class="player-hand"><div class="console-label"><span>Votre main</span><small>${perspective.hand.length} cartes</small></div><div class="hand-row">${perspective.hand.length ? perspective.hand.map(card => cardHtml(card, game.index.cards[card.cardId], { source: "hand" })).join("") : `<div class="empty-zone">Main vide</div>`}</div></div>
        <div class="player-treasury"><span class="treasury-label">Trésorerie</span><div class="treasury-vp"><strong>${perspective.vp}</strong><span>PV</span></div><div><strong>${perspective.activeGold}</strong><span>or actif</span></div><div><strong>${perspective.reserveGold}</strong><span>réserve</span></div></div>
      </section>
      <div class="drop-cost-preview" data-drop-cost hidden><span data-drop-label>Choisissez une zone</span><strong data-drop-price>—</strong></div>
      ${survivorChoiceHtml(perspective)}
      <details class="log-drawer" data-chronicle ${chronicleOpen ? "open" : ""}>
        <summary><span>Chronique</span><span class="tiny">${game.log.length} entrées</span></summary>
        <div class="log-stream">${game.log.map(item => `<div class="log-item ${item.tone}"><span class="log-meta">Jour ${item.day} · ${escapeHtml(item.phase)}</span>${escapeHtml(item.message)}</div>`).join("")}</div>
        <div class="log-tools"><button class="ghost-button" data-arbiter>Arbitre</button><button class="ghost-button" data-game-menu>Partie</button></div>
      </details>
    </div>
  </section>`;
  requestAnimationFrame(() => {
    const viewport = app.querySelector("[data-board-viewport]");
    if (!viewport) return;
    viewport.scrollLeft = boardScroll.left;
    viewport.scrollTop = boardScroll.top;
  });
}

function cardBackHtml(count = 1) {
  return `<div class="card-back" aria-label="${count} cartes cachées"><span>M</span>${count > 1 ? `<b>${count}</b>` : ""}</div>`;
}

function pileHtml(label, count, source) {
  return `<div class="pile" data-pile="${source}"><span>${label}</span>${cardBackHtml(count)}<b>${count}</b></div>`;
}

function opponentSeatHtml(player) {
  const influence = player.domain.reduce((total, card) => total + influenceOf(game, card), 0);
  const active = game.players[game.activePlayer]?.id === player.id;
  return `<section class="opponent-seat ${active ? "active" : ""}" style="--faction-color:${playerColor(player.faction)}">
    <div class="opponent-head"><div><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.faction)}${player.isAI ? " · IA" : ""}</span></div><div class="opponent-stats"><span>${player.vp} PV</span><span>${player.activeGold} or</span><span>${influence} influence</span></div></div>
    <div class="opponent-zones"><div><small>Main · ${player.hand.length}</small><div class="opponent-hand">${Array.from({ length: Math.min(player.hand.length, 5) }, () => cardBackHtml()).join("")}</div></div><div><small>Domaine · ${player.domain.length}</small><div class="opponent-domain">${player.domain.length ? player.domain.map(card => cardHtml(card, game.index.cards[card.cardId], { source: "opponent-domain" })).join("") : `<div class="empty-zone">Domaine vide</div>`}</div></div></div>
  </section>`;
}

function survivorChoiceHtml(perspective) {
  const pending = game.pendingSurvivors;
  if (!pending) return "";
  const currentPlayerId = pending.choicePlayerIds[pending.choiceIndex];
  const currentPlayer = game.players.find(player => player.id === currentPlayerId);
  if (currentPlayerId !== perspective.id) {
    return `<div class="survivor-panel waiting"><p class="eyebrow">${escapeHtml(pending.locationName)} expire</p><h3>${escapeHtml(currentPlayer?.name || "Un adversaire")} choisit ses Survivantes…</h3></div>`;
  }
  const cards = (pending.eligibleByPlayer[currentPlayerId] || []).map(uid => getCard(game, uid)).filter(Boolean);
  return `<div class="survivor-panel"><p class="eyebrow">${escapeHtml(pending.locationName)} expire</p><h3>Choisissez ${pending.survivorCount} Survivante${pending.survivorCount > 1 ? "s" : ""}</h3><p>Les cartes retenues retournent dans votre domaine. Les autres vont dans votre défausse.</p><form id="survivorForm"><div class="survivor-options">${cards.map(card => `<label class="survivor-option"><input type="checkbox" name="cardUid" value="${card.uid}">${cardHtml(card, game.index.cards[card.cardId], { source: "survivor-choice" })}</label>`).join("")}</div><button class="primary-button" type="submit">Confirmer les Survivantes</button></form></div>`;
}

function playerSummaryHtml(player, active, isPerspective) {
  const color = playerColor(player.faction);
  return `<section class="player-summary ${active ? "active" : ""}" style="--faction-color:${color}">
    <div class="player-summary-head"><div><h3>${escapeHtml(player.name)}</h3><div class="faction-label">${escapeHtml(player.faction)}</div></div>${player.isAI ? `<span class="ai-tag">IA</span>` : isPerspective ? `<span class="you-tag">VOUS</span>` : ""}</div>
    <div class="resource-grid"><div class="resource"><b>${player.vp}</b><span>PV</span></div><div class="resource"><b>${player.activeGold}</b><span>Actif</span></div><div class="resource"><b>${player.reserveGold}</b><span>Réserve</span></div></div>
    <div class="zone-strip"><span>Main ${player.hand.length}</span><span>Deck ${player.deck.length}</span><span>Défausse ${player.discard.length}</span></div>
    ${player.faction === "Kalassir" ? `<select class="order-select" data-order-player="${player.id}" ${player.id === perspectiveId && !player.flags.actionsTaken ? "" : "disabled"}><option ${player.order === "Lames de Karina" ? "selected" : ""}>Lames de Karina</option><option ${player.order === "Culte du Premier Sang" ? "selected" : ""}>Culte du Premier Sang</option><option ${player.order === "Disciples de Karlov" ? "selected" : ""}>Disciples de Karlov</option></select>` : ""}
  </section>`;
}

function domainHtml(player, { self = false } = {}) {
  const influence = player.domain.reduce((total, card) => total + influenceOf(game, card), 0);
  const canReceive = player.id === perspectiveId;
  const active = game.players[game.activePlayer]?.id === player.id;
  return `<section class="domain-zone ${self ? "self-domain" : ""} ${canReceive ? "drop-zone" : ""} ${active ? "active" : ""}" data-drop-zone="domain" data-player-id="${player.id}" style="--faction-color:${playerColor(player.faction)}">
    <div class="domain-header"><div><strong>${self ? "Votre domaine" : `Domaine de ${escapeHtml(player.name)}`}</strong><span>${player.domain.length} carte${player.domain.length === 1 ? "" : "s"}</span></div><b>${influence} influence</b></div>
    <div class="domain-cards">${player.domain.length ? player.domain.map(card => cardHtml(card, game.index.cards[card.cardId], { source: "domain" })).join("") : `<div class="empty-zone">Glissez une carte de votre main ici</div>`}</div>
    ${player.faction === "Kalassir" ? `<select class="order-select compact-order" data-order-player="${player.id}" ${player.id === perspectiveId && !player.flags.actionsTaken ? "" : "disabled"}><option ${player.order === "Lames de Karina" ? "selected" : ""}>Lames de Karina</option><option ${player.order === "Culte du Premier Sang" ? "selected" : ""}>Culte du Premier Sang</option><option ${player.order === "Disciples de Karlov" ? "selected" : ""}>Disciples de Karlov</option></select>` : ""}
  </section>`;
}

function locationHtml(location) {
  const definition = game.index.locations[location.locationId];
  const totals = locationTotals(game, location);
  const controller = location.controller || Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0];
  return `<section class="location-zone drop-zone" data-drop-zone="location" data-location-uid="${location.uid}" style="--location-art:url('${safeUrl(definition.illustration)}')">
    <div class="location-header"><div><div class="location-name">${escapeHtml(definition.name)}</div><div class="location-type">${escapeHtml(definition.type)}${definition.subtype ? ` · ${escapeHtml(definition.subtype)}` : ""}</div></div><div class="duration-badge">${location.remaining == null ? `Seuil` : `⧖ ${location.remaining}`}</div></div>
    <div class="location-totals">${game.players.map(player => `<span class="total-chip ${controller === player.id ? "control" : ""}" style="--chip-color:${playerColor(player.faction)}"><span>${escapeHtml(player.name.slice(0, 7))}</span><b>${totals[player.id] || 0}</b></span>`).join("")}</div>
    <div class="location-card-sides">${game.players.filter(player => player.id !== perspectiveId).map(player => locationPlayerSide(location, player, "opponent-side")).join("")}${locationPlayerSide(location, game.players.find(player => player.id === perspectiveId), "self-side")}</div>
    <div class="location-footer"><span>${escapeHtml(definition.vp)} PV · ${escapeHtml(definition.survivors)} survivant(s)</span><span class="attachment-list">${location.attachments.map(card => `<button class="attachment-pill" data-card-uid="${card.uid}" data-source="attachment">${escapeHtml(game.index.cards[card.cardId].name)}</button>`).join("")}</span></div>
  </section>`;
}

function locationPlayerSide(location, player, side) {
  if (!player) return "";
  const cards = location.cards.filter(card => card.controller === player.id);
  return `<div class="location-player-side ${side}" style="--side-color:${playerColor(player.faction)}"><span class="location-side-label">${player.id === perspectiveId ? "Vous" : escapeHtml(player.name)}</span><div class="location-player-cards">${cards.length ? cards.map(card => cardHtml(card, game.index.cards[card.cardId], { source: "location" })).join("") : `<span class="side-empty">Aucune carte</span>`}</div></div>`;
}

function allCards() {
  return [...Object.values(catalog.factions).flat(), ...catalog.market, ...catalog.specials, ...catalog.locations];
}

function studioGroups() {
  return ["Toutes", "Kalassir", "Aqaba", "Algarie", "Marché", "Spéciale", "Lieux"];
}

function studioCards() {
  return allCards().filter(card => {
    const group = card.faction === "Lieu" ? "Lieux" : card.faction;
    const matchesGroup = studioFilter === "Toutes" || group === studioFilter;
    const needle = studioSearch.toLocaleLowerCase("fr");
    return matchesGroup && (!needle || `${card.id} ${card.name} ${card.type} ${card.text || card.effect || ""}`.toLocaleLowerCase("fr").includes(needle));
  });
}

function renderStudio() {
  const cards = studioCards();
  const selected = allCards().find(card => card.id === selectedStudioCardId) || cards[0];
  if (selected && !selectedStudioCardId) selectedStudioCardId = selected.id;
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><p class="eyebrow">Collection vivante</p><h1>Studio de cartes</h1><p class="lead">Modifiez le catalogue, les illustrations et le cadre. Les colonnes de design sont conservées lors des échanges Excel.</p></div><div class="studio-toolbar"><span class="count-badge">${allCards().length} cartes</span><button class="ghost-button" data-new-card>+ Carte</button><button class="ghost-button" data-import-xlsx>Importer .xlsx</button><button class="primary-button" data-export-xlsx>Exporter .xlsx</button></div></div>
    <div class="studio-layout">
      <aside class="studio-sidebar"><input class="search-input" data-studio-search placeholder="Rechercher…" value="${escapeHtml(studioSearch)}"><div class="filter-group">${studioGroups().map(group => `<button class="filter-button ${group === studioFilter ? "active" : ""}" data-studio-filter="${group}">${group}</button>`).join("")}</div><p class="tiny">Les images locales restent disponibles hors connexion. Ajoutez une URL dans la colonne Illustration pour une image propre à une carte.</p></aside>
      <div class="studio-gallery">${cards.map(card => cardHtml(null, card, { source: "studio", selected: card.id === selected?.id })).join("") || `<div class="empty-zone">Aucune carte ne correspond.</div>`}</div>
      <aside class="studio-editor">${selected ? editorHtml(selected) : `<p class="muted">Sélectionnez une carte.</p>`}</aside>
    </div>
  </section>`;
}

function editorHtml(card) {
  return `${cardHtml(null, card, { source: "studio-preview" })}<form id="cardEditor" data-card-id="${escapeHtml(card.id)}">
    <div class="field-row"><div class="field"><label>ID</label><input data-card-field="id" value="${escapeHtml(card.id)}"></div><div class="field"><label>Faction / groupe</label><select data-card-field="faction">${["Kalassir","Aqaba","Algarie","Marché","Spéciale","Lieu"].map(value => `<option ${card.faction === value ? "selected" : ""}>${value}</option>`).join("")}</select></div></div>
    <div class="field"><label>Nom</label><input data-card-field="name" value="${escapeHtml(card.name)}"></div>
    <div class="field-row"><div class="field"><label>Type</label><input data-card-field="type" value="${escapeHtml(card.type)}"></div><div class="field"><label>Sous-type</label><input data-card-field="subtype" value="${escapeHtml(card.subtype || "")}"></div></div>
    <div class="field-row"><div class="field"><label>Influence</label><input data-card-field="influence" value="${escapeHtml(card.influence ?? "")}"></div><div class="field"><label>Quantité</label><input type="number" min="0" data-card-field="quantity" value="${escapeHtml(card.quantity ?? card.copies ?? 1)}"></div></div>
    <div class="field-row"><div class="field"><label>Coût domaine</label><input data-card-field="domainCost" value="${escapeHtml(card.domainCost ?? "")}"></div><div class="field"><label>Coût lieu</label><input data-card-field="locationCost" value="${escapeHtml(card.locationCost ?? "")}"></div></div>
    <div class="field"><label>Texte final / effet</label><textarea data-card-field="${card.faction === "Lieu" ? "effect" : "text"}">${escapeHtml(card.text || card.effect || "")}</textarea></div>
    <div class="field"><label>Illustration (URL ou chemin local)</label><input data-card-field="illustration" value="${escapeHtml(card.illustration || "")}"></div>
    <div class="field-row"><div class="field"><label>Couleur</label><input type="color" data-card-field="accent" value="${escapeHtml(card.accent || accentFor(card.faction, card))}"></div><div class="field"><label>Cadre</label><input data-card-field="frame" placeholder="standard" value="${escapeHtml(card.frame || "")}"></div></div>
    <div class="button-row"><button type="button" class="primary-button" data-save-card>Enregistrer</button><button type="button" class="danger-button" data-delete-card>Supprimer</button></div>
  </form>`;
}

function locateCatalogCard(cardId) {
  for (const [faction, cards] of Object.entries(catalog.factions)) {
    const index = cards.findIndex(card => card.id === cardId);
    if (index >= 0) return { list: cards, index, faction };
  }
  for (const [name, list] of [["Marché", catalog.market], ["Spéciale", catalog.specials], ["Lieu", catalog.locations]]) {
    const index = list.findIndex(card => card.id === cardId);
    if (index >= 0) return { list, index, faction: name };
  }
  return null;
}

function moveCardDefinition(card, previousFaction) {
  if (card.faction === previousFaction) return;
  const located = locateCatalogCard(card.id);
  if (located) located.list.splice(located.index, 1);
  if (catalog.factions[card.faction]) catalog.factions[card.faction].push(card);
  else if (card.faction === "Marché") catalog.market.push(card);
  else if (card.faction === "Spéciale") catalog.specials.push(card);
  else catalog.locations.push(card);
}

function renderRules() {
  const timeline = [
    ["Aube", "La réserve rejoint l’or actif, puis chaque cité produit 2 ors actifs. Les effets et limites “une fois par Jour” sont réinitialisés."],
    ["Journée", "Les joueurs alternent une action : jouer, acheter, déployer, déplacer ou activer. Quand tous passent, la Journée se termine."],
    ["Crépuscule", "Le contrôle strict de chaque lieu est calculé. Les effets de Crépuscule et de contrôle sont résolus."],
    ["Guerre", "Comparez l’influence des domaines. Les gagnants gagnent 1 or en réserve ; les perdants perdent 1 or actif si possible."],
    ["Nuit", "Résolvez les effets de Nuit, vérifiez les Seuils, réduisez les Durées et faites expirer/remplacer les lieux."],
  ];
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><p class="eyebrow">Référence de jeu</p><h1>Règles & cadence</h1><p class="lead">Cette référence reprend les décisions du classeur et rend visibles les conventions numériques nécessaires au simulateur.</p></div><button class="primary-button" data-nav="game">Revenir à la table</button></div>
    <div class="rules-layout"><div class="rule-cards">${catalog.rules.map(rule => `<article class="rule-card"><h3>${escapeHtml(rule.title)}</h3><p>${escapeHtml(rule.text)}</p></article>`).join("")}</div>
    <aside class="timeline"><p class="eyebrow">Un Jour complet</p><h2>Du lever au verdict</h2><ol class="timeline-list">${timeline.map(([title,text], index) => `<li class="timeline-item"><span class="timeline-index">${index + 1}</span><h3>${title}</h3><p>${text}</p></li>`).join("")}</ol>
    <div class="assumption-box"><strong>Conventions du simulateur.</strong> La table alterne une action par joueur jusqu’aux passes ; le premier déploiement du Jour est gratuit et les suivants coûtent 1 or. Chaque Aube fait piocher une carte. À l’expiration d’un lieu, chaque joueur choisit ses Survivantes : elles retournent au domaine et les autres cartes sont défaussées.</div></aside></div>
  </section>`;
}

function openCardDialog(cardUid, cardId, source) {
  const card = cardUid && game ? getCard(game, cardUid) : null;
  const definition = game && card ? game.index.cards[card.cardId] : allCards().find(item => item.id === cardId);
  if (!definition) return;
  const active = game?.players[game.activePlayer];
  const canAct = Boolean(game && game.status === "playing" && game.phase === "Journée" && active?.id === perspectiveId);
  let actionType = null;
  if (source === "hand") actionType = "playHand";
  if (source === "market") actionType = "buyMarket";
  if (source === "domain") actionType = String(definition.text || "").includes("Action —") ? "activate" : "deploy";
  if (source === "location" && card?.controller === perspectiveId) actionType = "move";
  const dragCopy = source === "domain" || source === "location"
    ? "Fermez cette fenêtre puis glissez la carte vers un lieu."
    : "Fermez cette fenêtre puis glissez la carte vers votre domaine, un lieu ou une cible.";
  actionContent.innerHTML = `<div class="detail-grid"><div>${cardHtml(card, definition, { source: "dialog" })}</div><div><p class="eyebrow">${escapeHtml(definition.faction)}</p><h2>${escapeHtml(definition.name)}</h2><div class="detail-stats"><span class="detail-stat">${escapeHtml(definition.type)}</span>${definition.influence != null ? `<span class="detail-stat">Influence ${escapeHtml(card && game ? influenceOf(game, card) : definition.influence)}</span>` : ""}<span class="detail-stat">${escapeHtml(definition.role || "Carte Morentia")}</span></div><p class="detail-text">${escapeHtml(definition.text || definition.effect || "")}</p>${definition.control ? `<p class="detail-text"><strong>Contrôle —</strong> ${escapeHtml(definition.control)}</p>` : ""}${definition.victory ? `<p class="detail-text"><strong>Victoire —</strong> ${escapeHtml(definition.victory)}</p>` : ""}</div></div>
    ${actionType && canAct ? `<p class="drag-tip">↗ ${dragCopy}</p><details class="advanced-actions"><summary>Résoudre manuellement un effet complexe</summary>${actionFormHtml(actionType, card, definition)}</details>` : `<p class="tiny" style="margin-top:16px">${actionType ? "Cette carte pourra agir lorsque ce sera votre tour." : "Consultation de la carte."}</p>`}`;
  actionDialog.showModal();
}

function cardOptions(filter = () => true) {
  if (!game) return "";
  const cards = [
    ...game.players.flatMap(player => [...player.hand, ...player.domain]),
    ...game.locations.flatMap(location => [...location.cards, ...location.attachments]),
  ].filter(filter);
  return `<option value="">— Auto / aucune —</option>${cards.map(card => `<option value="${card.uid}">${escapeHtml(game.index.cards[card.cardId]?.name)} · ${escapeHtml(game.players.find(player => player.id === card.controller)?.name || "neutre")}</option>`).join("")}`;
}

function locationOptions() {
  return game.locations.map(location => `<option value="${location.uid}">${escapeHtml(game.index.locations[location.locationId].name)}</option>`).join("");
}

function actionFormHtml(type, card, definition) {
  const isMove = type === "move" || type === "deploy" || type === "activate";
  return `<form class="action-form" id="cardActionForm" data-action-type="${type}" data-card-uid="${card.uid}">
    ${type === "playHand" || type === "buyMarket" ? `<div class="field"><label>Destination</label><select name="destination"><option value="domain">Domaine</option><option value="location">Lieu</option><option value="ephemeral">Résoudre l’éphémère</option></select></div>` : ""}
    <div class="field"><label>${isMove ? "Lieu d’arrivée" : "Lieu concerné"}</label><select name="locationUid"><option value="">— Aucun —</option>${locationOptions()}</select></div>
    <div class="field-row"><div class="field"><label>Cible principale</label><select name="targetUid">${cardOptions()}</select></div><div class="field"><label>Seconde cible</label><select name="targetUid2">${cardOptions()}</select></div></div>
    <div class="field-row"><div class="field"><label>Valeur X</label><input name="x" type="number" min="0" max="4" value="${definition.uniqueCost === "X" ? 1 : 0}"></div><div class="field"><label>Mode</label><select name="mode"><option value="protect">Protection</option><option value="destroy">Destruction</option></select></div></div>
    <label class="tiny"><input type="checkbox" name="payExtra"> Payer le coût optionnel de la carte si possible</label>
    <button class="primary-button" type="submit">Confirmer l’action</button>
  </form>`;
}

function dragPayloadFrom(element) {
  if (!element?.dataset.cardUid || element.dataset.draggable !== "true") return null;
  return { cardUid: element.dataset.cardUid, source: element.dataset.source };
}

function clearDropHighlights() {
  document.querySelectorAll(".is-drag-over").forEach(element => element.classList.remove("is-drag-over"));
}

function dropContext(target, sourceUid) {
  if (!(target instanceof Element)) return null;
  const targetCard = target.closest("[data-drop-card-uid]");
  const zone = target.closest("[data-drop-zone]");
  return {
    zone,
    targetUid: targetCard?.dataset.dropCardUid && targetCard.dataset.dropCardUid !== sourceUid ? targetCard.dataset.dropCardUid : null,
  };
}

function showDropHighlight(target, sourceUid) {
  clearDropHighlights();
  const context = dropContext(target, sourceUid);
  (context?.targetUid ? target.closest("[data-drop-card-uid]") : context?.zone)?.classList.add("is-drag-over");
}

function dropActionPreview(payload, target) {
  if (!game || !payload) return null;
  const context = dropContext(target, payload.cardUid);
  if (!context?.zone) return null;
  const card = getCard(game, payload.cardUid);
  const definition = card && game.index.cards[card.cardId];
  const player = game.players.find(item => item.id === perspectiveId);
  if (!card || !definition || !player) return null;
  const zoneType = context.zone.dataset.dropZone;
  const locationUid = context.zone.dataset.locationUid || null;
  const location = locationUid ? getLocation(game, locationUid) : null;
  const locationName = location ? game.index.locations[location.locationId]?.name : null;
  const impossible = label => ({ label, price: "Impossible", legal: false });

  if (zoneType === "domain" && context.zone.dataset.playerId !== perspectiveId) return impossible("Domaine adverse");
  if (payload.source === "domain") {
    if (zoneType !== "location" || !isUnit(definition)) return impossible("Cette carte reste au domaine");
    const cost = costFor(game, player, definition, "location", { type: "deploy", cardUid: card.uid, locationUid });
    return { label: `Déployer sur ${locationName}`, price: cost ? `${cost} or` : "Gratuit", legal: player.activeGold >= cost };
  }
  if (payload.source === "location") {
    if (zoneType !== "location" || card.locationUid === locationUid) return impossible("Choisissez l’autre lieu");
    return { label: `Déplacer vers ${locationName}`, price: "Gratuit", legal: true };
  }
  if (payload.source !== "hand" && payload.source !== "market") return null;
  if (isAttachment(definition) && zoneType !== "location") return impossible("Attachement réservé à un lieu");
  if (isAttachment(definition) && String(definition.type).toLowerCase().includes("unité") && !context.targetUid) return impossible("Visez directement une unité");
  let destination = zoneType;
  if (isDomainPermanent(definition)) destination = "domain";
  if (isEphemeral(definition)) destination = "ephemeral";
  if (isAttachment(definition)) destination = "location";
  const type = payload.source === "market" ? "buyMarket" : "playHand";
  const cost = costFor(game, player, definition, destination === "ephemeral" ? "domain" : destination, {
    type, cardUid: card.uid, locationUid, targetUid: context.targetUid,
    x: definition.uniqueCost === "X" ? 1 : 0, fromMarket: payload.source === "market",
  });
  const verb = payload.source === "market" ? "Acheter" : isEphemeral(definition) ? "Résoudre" : "Jouer";
  const destinationLabel = destination === "domain" ? "dans votre domaine" : locationName ? `sur ${locationName}` : "";
  return { label: `${verb} ${destinationLabel}`.trim(), price: cost ? `${cost} or` : "Gratuit", legal: player.activeGold >= cost };
}

function updateDropCost(payload, target) {
  const element = document.querySelector("[data-drop-cost]");
  if (!element) return;
  const preview = dropActionPreview(payload, target);
  element.hidden = !preview;
  if (!preview) return;
  element.querySelector("[data-drop-label]").textContent = preview.label;
  element.querySelector("[data-drop-price]").textContent = preview.price;
  element.classList.toggle("unaffordable", !preview.legal);
}

function hideDropCost() {
  const element = document.querySelector("[data-drop-cost]");
  if (element) element.hidden = true;
}

function handleCardDrop(payload, target) {
  if (!game || !payload) return;
  const context = dropContext(target, payload.cardUid);
  if (!context?.zone) return;
  const card = getCard(game, payload.cardUid);
  const definition = card && game.index.cards[card.cardId];
  if (!card || !definition) return;
  const zoneType = context.zone.dataset.dropZone;
  const locationUid = context.zone.dataset.locationUid || null;

  if (zoneType === "domain" && context.zone.dataset.playerId !== perspectiveId) {
    toast("Vous ne pouvez jouer une carte que dans votre propre domaine.", "error");
    return;
  }

  let action;
  if (payload.source === "domain") {
    if (zoneType !== "location") return toast("Une unité du domaine se déploie sur un lieu.", "error");
    if (!isUnit(definition)) return toast("Cette carte reste dans le domaine. Cliquez-la pour lire ou activer son effet.", "error");
    action = { type: "deploy", cardUid: card.uid, locationUid, targetUid: context.targetUid };
  } else if (payload.source === "location") {
    if (zoneType !== "location") return toast("Une unité en jeu se déplace vers l’autre lieu.", "error");
    if (card.locationUid === locationUid) return;
    action = { type: "move", cardUid: card.uid, destinationLocationUid: locationUid, locationUid };
  } else if (payload.source === "hand" || payload.source === "market") {
    const type = payload.source === "market" ? "buyMarket" : "playHand";
    if (isAttachment(definition) && zoneType !== "location") return toast("Glissez cet attachement sur une carte ou un lieu en jeu.", "error");
    if (isAttachment(definition) && String(definition.type).toLowerCase().includes("unité") && !context.targetUid) {
      return toast("Déposez cet attachement directement sur l’unité ciblée.", "error");
    }
    let destination = zoneType;
    if (isDomainPermanent(definition)) destination = "domain";
    if (isEphemeral(definition)) destination = "ephemeral";
    if (isAttachment(definition)) destination = "location";
    action = {
      type, cardUid: card.uid, destination,
      locationUid, destinationLocationUid: locationUid,
      targetUid: context.targetUid, x: definition.uniqueCost === "X" ? 1 : 0,
    };
  }

  if (action) dispatchAction(action);
}

function cleanupPointerDrag() {
  pointerDrag?.ghost?.remove();
  pointerDrag?.element?.classList.remove("dragging");
  pointerDrag = null;
  clearDropHighlights();
  hideDropCost();
}

function dispatchAction(action, actorId = perspectiveId) {
  if (!game) return;
  if (p2p.role === "guest") {
    p2p.send({ kind: "action", action, actorId });
    toast("Action envoyée à l’hôte.");
    return;
  }
  try {
    history.push(dehydrateGame(game));
    history = history.slice(-30);
    game = performAction(game, action, actorId);
    saveAll();
    broadcastState();
    render();
    runAIIfNeeded();
  } catch (error) {
    toast(error.message, "error");
  }
}

function runAIIfNeeded() {
  clearTimeout(aiTimer);
  if (!game || game.status !== "playing" || p2p.role === "guest") return;
  const active = game.players[game.activePlayer];
  if (!active?.isAI) return;
  aiTimer = setTimeout(() => {
    try {
      const action = chooseAIAction(game, active.id) || { type: "pass" };
      history.push(dehydrateGame(game));
      game = performAction(game, action, active.id);
      saveAll();
      broadcastState();
      render();
      runAIIfNeeded();
    } catch (error) {
      console.error(error);
      try { game = performAction(game, { type: "pass" }, active.id); saveAll(); render(); runAIIfNeeded(); }
      catch (nested) { toast(`Automate bloqué : ${nested.message}`, "error"); }
    }
  }, 650);
}

function broadcastState(record = null) {
  if (p2p.role !== "host" || !game) return;
  p2p.send({ kind: "snapshot", game: dehydrateGame(game), catalog }, record);
}

function handlePeerMessage(message, record) {
  if (message.kind === "snapshot" && p2p.role === "guest") {
    if (message.catalog) catalog = message.catalog;
    game = hydrateGame(message.game, catalog);
    saveAll();
    render();
  } else if (message.kind === "action" && p2p.role === "host") {
    try {
      history.push(dehydrateGame(game));
      game = performAction(game, message.action, message.actorId);
      saveAll();
      broadcastState();
      render();
      runAIIfNeeded();
    } catch (error) {
      p2p.send({ kind: "error", message: error.message }, record);
    }
  } else if (message.kind === "requestSnapshot" && p2p.role === "host") broadcastState(record);
  else if (message.kind === "error") toast(`Hôte : ${message.message}`, "error");
}

function renderNetworkDialog() {
  networkContent.innerHTML = `<p class="eyebrow">Sans serveur de jeu</p><h2>Multijoueur P2P</h2><p class="lead">Le navigateur hôte fait autorité. Échangez une invitation et une réponse par messagerie ; les actions passent ensuite directement par WebRTC.</p>
    <div class="network-status"><span class="status-dot ${networkStatus.state === "connected" ? "connected" : ""}"></span><span>${escapeHtml(networkStatus.message)} · ${networkStatus.connected || 0} pair(s)</span></div>
    <div class="signal-steps">
      <section class="signal-card"><h3>Je crée la table</h3><p class="tiny">Générez une invitation par navigateur distant (jusqu’à deux).</p><button type="button" class="ghost-button" data-host-offer>Générer une invitation</button><div class="field"><label>Invitation à transmettre</label><textarea class="signal-area" id="hostOffer" readonly></textarea></div><div class="field"><label>Réponse reçue</label><textarea class="signal-area" id="hostAnswer" placeholder="Collez ici la réponse du joueur…"></textarea></div><button type="button" class="primary-button" data-accept-answer>Accepter la réponse</button></section>
      <section class="signal-card"><h3>Je rejoins la table</h3><p class="tiny">Collez l’invitation, générez la réponse, puis renvoyez-la à l’hôte.</p><div class="field"><label>Invitation reçue</label><textarea class="signal-area" id="joinOffer" placeholder="Collez ici l’invitation…"></textarea></div><button type="button" class="ghost-button" data-join-answer>Générer ma réponse</button><div class="field"><label>Réponse à transmettre</label><textarea class="signal-area" id="joinAnswer" readonly></textarea></div><button type="button" class="primary-button" data-request-state>Récupérer la table</button></section>
    </div>
    ${game ? `<div class="field"><label>Joueur affiché sur cet appareil</label><select id="networkPerspective">${game.players.map(player => `<option value="${player.id}" ${player.id === perspectiveId ? "selected" : ""}>${escapeHtml(player.name)} · ${player.faction}</option>`).join("")}</select></div>` : ""}
    <p class="tiny">La signalisation est manuelle et aucun compte n’est requis. WebRTC utilise un serveur STUN public pour découvrir le chemin réseau ; certains réseaux d’entreprise ou NAT stricts peuvent exiger un relais TURN, non inclus ici.</p>`;
}

function openSettings() {
  settingsContent.innerHTML = `<p class="eyebrow">Direction artistique</p><h2>Design & données</h2><p class="lead">Ces valeurs forment le design de base. Une carte peut remplacer l’illustration, la couleur ou le cadre via le Studio ou Excel.</p>
    <form id="designForm" class="settings-grid">
      ${colorSetting("kalassirColor", "Kalassir")} ${colorSetting("aqabaColor", "Aqaba")} ${colorSetting("algarieColor", "Algarie")} ${colorSetting("marketColor", "Marché")}
      <div class="field"><label>Arrondi des cartes</label><input type="range" name="cardRadius" min="4" max="28" value="${design.cardRadius}"></div>
      <div class="field"><label>Opacité illustration</label><input type="range" name="artOpacity" min="0.2" max="1" step="0.05" value="${design.artOpacity}"></div>
      <div class="field" style="grid-column:1/-1"><label>Police de titre</label><input name="fontFamily" value="${escapeHtml(design.fontFamily)}"></div>
      <div class="button-row" style="grid-column:1/-1"><button class="primary-button" type="submit">Appliquer</button><button class="ghost-button" type="button" data-reset-design>Réinitialiser</button></div>
    </form>
    <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
    <div class="button-row"><button class="ghost-button" type="button" data-import-xlsx>Importer le classeur</button><button class="ghost-button" type="button" data-export-xlsx>Exporter le catalogue</button>${game ? `<button class="danger-button" type="button" data-new-game>Nouvelle partie</button>` : ""}</div>`;
  settingsDialog.showModal();
}

function colorSetting(name, label) {
  return `<div class="field"><label>${label}</label><div class="color-field"><input type="color" name="${name}" value="${design[name]}"><input value="${design[name]}" data-color-text="${name}"></div></div>`;
}

function openArbiter() {
  actionContent.innerHTML = `<p class="eyebrow">Outil de test</p><h2>Arbitre</h2><p class="lead">Résolvez une cible laissée au choix, corrigez un état ou testez rapidement une interaction. L’ajustement est consigné dans la Chronique et coûte une action.</p>
    <form id="arbiterForm" class="action-form"><div class="field-row"><div class="field"><label>Joueur</label><select name="playerId">${game.players.map(player => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("")}</select></div><div class="field"><label>Ressource</label><select name="resource"><option value="activeGold">Or actif</option><option value="reserveGold">Or en réserve</option><option value="vp">PV</option><option value="influence">Influence permanente</option><option value="draw">Piocher</option><option value="destroy">Détruire la cible</option></select></div></div>
    <div class="field-row"><div class="field"><label>Valeur (+/−)</label><input name="amount" type="number" value="1"></div><div class="field"><label>Cible carte</label><select name="targetUid">${cardOptions()}</select></div></div><div class="field"><label>Note</label><input name="note" placeholder="Raison de l’ajustement"></div><button class="primary-button">Appliquer et terminer l’action</button></form>`;
  actionDialog.showModal();
}

function openGameMenu() {
  actionContent.innerHTML = `<p class="eyebrow">Session de test</p><h2>Partie</h2><p class="lead">La sauvegarde locale est automatique après chaque action.</p><div class="button-row"><button class="ghost-button" data-export-game>Exporter l’état JSON</button><button class="ghost-button" data-copy-summary>Copier le résumé</button><button class="danger-button" data-new-game>Nouvelle partie</button></div>`;
  actionDialog.showModal();
}

function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  const element = event.target.closest?.(".game-card[data-draggable='true']");
  const payload = dragPayloadFrom(element);
  if (!payload) return;
  event.preventDefault();
  pointerDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, element, payload, active: false, ghost: null };
});

document.addEventListener("pointermove", event => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
  if (!pointerDrag.active && distance < 10) return;
  if (!pointerDrag.active) {
    pointerDrag.active = true;
    pointerDrag.element.classList.add("dragging");
    pointerDrag.ghost = pointerDrag.element.cloneNode(true);
    pointerDrag.ghost.classList.remove("dragging", "is-drag-over", "exhausted");
    pointerDrag.ghost.classList.add("drag-card-preview");
    pointerDrag.ghost.removeAttribute("data-draggable");
    pointerDrag.ghost.removeAttribute("tabindex");
    document.body.append(pointerDrag.ghost);
  }
  event.preventDefault();
  pointerDrag.ghost.style.left = `${event.clientX}px`;
  pointerDrag.ghost.style.top = `${event.clientY}px`;
  const viewport = document.querySelector("[data-board-viewport]");
  if (viewport && event.clientY > innerHeight - 210) viewport.scrollTop += 14;
  else if (viewport && event.clientY < 120) viewport.scrollTop -= 14;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  showDropHighlight(target, pointerDrag.payload.cardUid);
  updateDropCost(pointerDrag.payload, target);
}, { passive: false });

document.addEventListener("pointerup", event => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  if (pointerDrag.active) {
    event.preventDefault();
    const payload = pointerDrag.payload;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    suppressCardClickUntil = Date.now() + 450;
    cleanupPointerDrag();
    handleCardDrop(payload, target);
  } else pointerDrag = null;
});

document.addEventListener("pointercancel", cleanupPointerDrag);

document.addEventListener("pointerdown", event => {
  if (event.button !== 0 || pointerDrag || !event.target.closest?.("[data-board-surface]")) return;
  if (event.target.closest(".game-card, button, input, select, textarea, summary, a")) return;
  const viewport = event.target.closest("[data-board-viewport]");
  if (!viewport) return;
  boardPan = { pointerId: event.pointerId, viewport, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
  viewport.classList.add("panning");
});

document.addEventListener("pointermove", event => {
  if (!boardPan || boardPan.pointerId !== event.pointerId || pointerDrag) return;
  const dx = event.clientX - boardPan.x;
  const dy = event.clientY - boardPan.y;
  if (Math.hypot(dx, dy) > 4) boardPan.moved = true;
  if (!boardPan.moved) return;
  event.preventDefault();
  boardPan.viewport.scrollLeft = boardPan.left - dx;
  boardPan.viewport.scrollTop = boardPan.top - dy;
}, { passive: false });

document.addEventListener("pointerup", event => {
  if (!boardPan || boardPan.pointerId !== event.pointerId) return;
  boardScroll = { left: boardPan.viewport.scrollLeft, top: boardPan.viewport.scrollTop };
  boardPan.viewport.classList.remove("panning");
  if (boardPan.moved) suppressCardClickUntil = Date.now() + 250;
  boardPan = null;
});

document.addEventListener("pointercancel", () => {
  boardPan?.viewport?.classList.remove("panning");
  boardPan = null;
});

document.addEventListener("click", async event => {
  if (Date.now() < suppressCardClickUntil) { event.preventDefault(); return; }
  const dialogClose = event.target.closest("[data-dialog-close]");
  if (dialogClose) { dialogClose.closest("dialog")?.close(); return; }
  const nav = event.target.closest("[data-nav], [data-view]");
  if (nav) { setView(nav.dataset.nav || nav.dataset.view); return; }
  if (event.target.closest("#settingsButton")) { openSettings(); return; }
  if (event.target.closest("#networkButton, [data-open-network]")) { renderNetworkDialog(); networkDialog.showModal(); return; }
  if (event.target.closest("#addPlayer")) {
    const container = document.querySelector("#setupPlayers");
    if (container.children.length < 3) container.insertAdjacentHTML("beforeend", setupPlayerRow(3, "Joueur 3", "Algarie", false));
    return;
  }
  const remove = event.target.closest("[data-remove-player]");
  if (remove && document.querySelectorAll("[data-player-row]").length > 2) { remove.closest("[data-player-row]").remove(); return; }
  const cardElement = event.target.closest("[data-card-id]");
  if (cardElement && !event.target.closest("button")) {
    if (cardElement.dataset.source === "survivor-choice") return;
    if (cardElement.dataset.source === "studio" || cardElement.dataset.source === "studio-preview") { selectedStudioCardId = cardElement.dataset.cardId; renderStudio(); }
    else openCardDialog(cardElement.dataset.cardUid, cardElement.dataset.cardId, cardElement.dataset.source);
    return;
  }
  const attachment = event.target.closest("[data-card-uid][data-source='attachment']");
  if (attachment) { openCardDialog(attachment.dataset.cardUid, null, "attachment"); return; }
  if (event.target.closest("[data-pass]")) { dispatchAction({ type: "pass" }); return; }
  if (event.target.closest("[data-undo]")) {
    const previous = history.pop();
    if (previous) { game = hydrateGame(previous, catalog); saveAll(); broadcastState(); render(); }
    return;
  }
  if (event.target.closest("[data-arbiter]")) { openArbiter(); return; }
  if (event.target.closest("[data-game-menu]")) { openGameMenu(); return; }
  if (event.target.closest("[data-import-xlsx]")) { workbookInput.click(); return; }
  if (event.target.closest("[data-export-xlsx]")) { exportMorentiaWorkbook(catalog, design); toast("Classeur Morentia exporté."); return; }
  if (event.target.closest("[data-new-card]")) {
    const card = blankCard(studioFilter === "Toutes" || studioFilter === "Lieux" ? "Marché" : studioFilter);
    if (catalog.factions[card.faction]) catalog.factions[card.faction].push(card); else catalog.market.push(card);
    selectedStudioCardId = card.id; saveAll(); renderStudio(); return;
  }
  if (event.target.closest("[data-save-card]")) { saveEditedCard(); return; }
  if (event.target.closest("[data-delete-card]")) {
    const located = locateCatalogCard(selectedStudioCardId);
    if (located && confirm(`Supprimer ${located.list[located.index].name} ?`)) { located.list.splice(located.index, 1); selectedStudioCardId = null; saveAll(); renderStudio(); }
    return;
  }
  if (event.target.closest("[data-new-game]")) {
    if (confirm("Abandonner la partie actuelle et revenir à la préparation ?")) { game = null; history = []; saveAll(); actionDialog.close(); settingsDialog.close(); setView("game"); }
    return;
  }
  if (event.target.closest("[data-export-game]")) { downloadJson({ game: dehydrateGame(game), catalog, design }, `morentia-partie-jour-${game.day}.json`); return; }
  if (event.target.closest("[data-copy-summary]")) { await navigator.clipboard.writeText(JSON.stringify(summary(game), null, 2)); toast("Résumé copié."); return; }
  if (event.target.closest("[data-reset-design]")) { design = { ...DEFAULT_DESIGN }; saveAll(); applyDesign(); openSettings(); render(); return; }
  if (event.target.closest("[data-host-offer]")) {
    try {
      const invitation = await p2p.createHostOffer(); pendingHostPeerId = invitation.peerId;
      document.querySelector("#hostOffer").value = invitation.code; toast("Invitation P2P prête.");
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (event.target.closest("[data-accept-answer]")) {
    try { await p2p.acceptAnswer(pendingHostPeerId, document.querySelector("#hostAnswer").value); toast("Réponse acceptée."); }
    catch (error) { toast(error.message, "error"); }
    return;
  }
  if (event.target.closest("[data-join-answer]")) {
    try { document.querySelector("#joinAnswer").value = await p2p.createJoinAnswer(document.querySelector("#joinOffer").value); toast("Réponse P2P prête."); }
    catch (error) { toast(error.message, "error"); }
    return;
  }
  if (event.target.closest("[data-request-state]")) {
    try { p2p.send({ kind: "requestSnapshot" }); toast("Table demandée à l’hôte."); }
    catch (error) { toast(error.message, "error"); }
    return;
  }
});

document.addEventListener("submit", event => {
  if (event.target.id === "setupForm") {
    event.preventDefault();
    try { beginGame(event.target); } catch (error) { toast(error.message, "error"); }
  }
  if (event.target.id === "cardActionForm") {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const action = {
      type: form.dataset.actionType, cardUid: form.dataset.cardUid,
      destination: data.get("destination"), locationUid: data.get("locationUid") || null,
      targetUid: data.get("targetUid") || null, targetUid2: data.get("targetUid2") || null,
      destinationLocationUid: data.get("locationUid") || null, x: Number(data.get("x")) || 0,
      mode: data.get("mode"), payExtra: data.get("payExtra") === "on",
    };
    actionDialog.close(); dispatchAction(action);
  }
  if (event.target.id === "survivorForm") {
    event.preventDefault();
    const cardUids = [...event.target.querySelectorAll('[name="cardUid"]:checked')].map(input => input.value);
    dispatchAction({ type: "selectSurvivors", cardUids });
  }
  if (event.target.id === "arbiterForm") {
    event.preventDefault(); const data = new FormData(event.target);
    actionDialog.close(); dispatchAction({ type: "manual", playerId: data.get("playerId"), resource: data.get("resource"), amount: Number(data.get("amount")), targetUid: data.get("targetUid"), note: data.get("note") });
  }
  if (event.target.id === "designForm") {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.target));
    design = { ...design, ...data, cardRadius: Number(data.cardRadius), artOpacity: Number(data.artOpacity) };
    saveAll(); applyDesign(); settingsDialog.close(); render(); toast("Design appliqué.");
  }
});

document.addEventListener("input", event => {
  if (event.target.matches("[data-studio-search]")) { studioSearch = event.target.value; renderStudio(); }
  if (event.target.matches("[data-color-text]")) {
    const color = document.querySelector(`[name="${event.target.dataset.colorText}"]`);
    if (/^#[0-9a-f]{6}$/i.test(event.target.value)) color.value = event.target.value;
  }
});

document.addEventListener("change", event => {
  if (event.target.matches("[data-studio-filter]")) return;
  if (event.target.id === "networkPerspective") {
    perspectiveId = event.target.value; localStorage.setItem(STORAGE.perspective, perspectiveId); render();
  }
  if (event.target.matches("[data-order-player]")) {
    const player = game.players.find(item => item.id === event.target.dataset.orderPlayer);
    if (player && player.activeGold >= 1 && !player.flags.actionsTaken) {
      history.push(dehydrateGame(game)); player.activeGold -= 1; player.order = event.target.value; player.flags.actionsTaken = 0;
      game.log.unshift({ id: `manual-order-${Date.now()}`, day: game.day, phase: game.phase, message: `${player.name} paie 1 or et choisit ${player.order}.`, tone: "effect" });
      saveAll(); broadcastState(); render();
    } else { toast("Le changement d’Ordre coûte 1 or et doit précéder vos actions.", "error"); render(); }
  }
});

document.addEventListener("toggle", event => {
  if (event.target.matches?.("[data-chronicle]")) chronicleOpen = event.target.open;
}, true);

document.addEventListener("pointerup", event => {
  const filter = event.target.closest("[data-studio-filter]");
  if (filter) { studioFilter = filter.dataset.studioFilter; selectedStudioCardId = null; renderStudio(); }
});

function saveEditedCard() {
  const form = document.querySelector("#cardEditor");
  const located = locateCatalogCard(form.dataset.cardId);
  if (!located) return;
  const card = located.list[located.index];
  const previousFaction = card.faction;
  for (const input of form.querySelectorAll("[data-card-field]")) {
    let value = input.value.trim();
    if (["influence", "quantity", "domainCost", "locationCost", "uniqueCost"].includes(input.dataset.cardField) && /^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    card[input.dataset.cardField] = value || null;
  }
  const newId = card.id;
  selectedStudioCardId = newId;
  moveCardDefinition(card, previousFaction);
  saveAll(); renderStudio(); toast("Carte enregistrée.");
}

workbookInput.addEventListener("change", async () => {
  const file = workbookInput.files[0];
  if (!file) return;
  try {
    const imported = await importMorentiaWorkbook(file, catalog, design);
    catalog = repairCatalogArtwork(imported.catalog); design = imported.design;
    if (game && !confirm("Le catalogue a changé. Conserver la partie en cours peut rendre certaines cartes incohérentes. Continuer ?")) game = null;
    if (game) game = hydrateGame(dehydrateGame(game), catalog);
    saveAll(); applyDesign(); render(); settingsDialog.close(); toast(`${file.name} importé.`);
  } catch (error) { toast(error.message, "error"); }
  workbookInput.value = "";
});

window.addEventListener("hashchange", () => setView(location.hash.slice(1)));
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault(); deferredInstall = event;
  document.querySelector("#installButton").hidden = false;
});
document.querySelector("#installButton").addEventListener("click", async () => {
  if (!deferredInstall) return;
  await deferredInstall.prompt(); deferredInstall = null; document.querySelector("#installButton").hidden = true;
});

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(console.warn);

applyDesign();
setView(currentView);
runAIIfNeeded();
