// Assemblage de l'application : écrans, session de jeu, réseau et studio.

import {
  getCatalog, setCatalog, saveCatalog, resetCatalog, isDefaultCatalog,
  FACTIONS, FACTION_LABELS,
} from './data/catalog.js';
import { catalogFromBuffer, xlsxBytes, exportBundle, importBundle } from './data/catalog-io.js';
import { DEFAULT_CONFIG, PHASE, ORDERS } from './rules/constants.js';
import { createState, faceOf } from './rules/state.js';
import { Engine } from './rules/engine.js';
import { legalActions } from './rules/flow.js';
import './rules/effects/index.js';
import { applyDesign, renderCard } from './ui/card.js';
import { BoardView, seatColor } from './ui/board.js';
import { Replayer } from './ui/anim.js';
import { DragLayer } from './ui/dnd.js';
import { Ai } from './ai/ai.js';
import { openStudio } from './ui/studio.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

let catalog = getCatalog();
let session = null;
let config = { ...DEFAULT_CONFIG, dawnGold: 2, drawAtDawn: 1 };
let net = null;
let relayStatus = () => ({ open: 0, total: 0 });
// Événements reçus avant que la session de l'invité n'existe.
const earlyEvents = [];

applyDesign(catalog.design);

// ============================================================ écrans

function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}

function toast(text, ms = 2400) {
  const node = $('#toast');
  node.textContent = text;
  node.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.remove('on'), ms);
}

// ============================================================ accueil

function fillFactionSelects() {
  for (const sel of ['#solo-faction', '#host-faction', '#join-faction']) {
    const node = $(sel);
    node.innerHTML = '';
    FACTIONS.forEach((f, i) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = FACTION_LABELS[f];
      node.append(opt);
    });
  }
}

let localSeats = [
  { name: 'Joueur 1', faction: 'kalassir', kind: 'human' },
  { name: 'Joueur 2', faction: 'aqaba', kind: 'human' },
];

function renderLocalSeats() {
  const host = $('#local-seats');
  host.innerHTML = '';
  localSeats.forEach((seat, i) => {
    const row = document.createElement('div');
    row.className = 'seat';
    const name = document.createElement('input');
    name.value = seat.name;
    name.oninput = () => { seat.name = name.value; };
    const faction = document.createElement('select');
    FACTIONS.forEach(f => {
      const o = document.createElement('option');
      o.value = f; o.textContent = FACTION_LABELS[f];
      faction.append(o);
    });
    faction.value = seat.faction;
    faction.onchange = () => { seat.faction = faction.value; };
    const kind = document.createElement('select');
    for (const [v, label] of [['human', 'Humain'], ['ai', 'IA']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      kind.append(o);
    }
    kind.value = seat.kind;
    kind.onchange = () => { seat.kind = kind.value; };
    const tag = document.createElement('span');
    tag.style.color = 'var(--faint)';
    tag.textContent = `#${i + 1}`;
    row.append(name, faction, kind, tag);
    host.append(row);
  });
}

const CONFIG_LABELS = {
  startingHand: 'Main de départ',
  startingGold: 'Or actif initial',
  dawnGold: 'Or gagné à l’Aube',
  drawAtDawn: 'Pioche à l’Aube',
  mulligans: 'Mulligans',
  marketExtra: 'Marché = joueurs +',
  placesExtra: 'Lieux actifs = joueurs +',
  endExpiredPerPlayer: 'Fin : lieux × joueurs',
  endExpiredBase: 'Fin : lieux en plus',
  dayLimit: 'Limite de Jours (0 = aucune)',
  deployCost: 'Coût de déploiement',
};

function renderConfig() {
  const host = $('#config-grid');
  host.innerHTML = '';
  for (const [key, label] of Object.entries(CONFIG_LABELS)) {
    const field = document.createElement('div');
    field.className = 'field';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = String(config[key] ?? 0);
    input.oninput = () => { config[key] = Number(input.value) || 0; };
    field.append(lab, input);
    host.append(field);
  }
  const relayField = document.createElement('div');
  relayField.className = 'field';
  const relayLabel = document.createElement('label');
  relayLabel.textContent = 'Relais de signalisation (un par ligne)';
  const relayInput = document.createElement('textarea');
  relayInput.rows = 3;
  relayInput.style.cssText = 'padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg-3);font-size:12px';
  import('./net/net.js').then(mod => {
    relayInput.value = mod.relayUrls().join('\n');
    relayInput.onchange = () => {
      mod.setRelayUrls(relayInput.value.split('\n').map(s2 => s2.trim()).filter(Boolean));
      toast('Relais enregistrés — rejoignez à nouveau le salon.');
    };
  });
  relayField.append(relayLabel, relayInput);
  host.append(relayField);

  const toggle = document.createElement('div');
  toggle.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = 'Module Jadis (cartes optionnelles)';
  const sel = document.createElement('select');
  for (const [v, t] of [['non', 'Exclu'], ['oui', 'Inclus']]) {
    const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o);
  }
  sel.value = config.includeOptional ? 'oui' : 'non';
  sel.onchange = () => { config.includeOptional = sel.value === 'oui'; };
  toggle.append(lab, sel);
  host.append(toggle);
}

function refreshCatalogInfo() {
  const cards = catalog.cards.length;
  const places = catalog.places.length;
  $('#catalog-info').textContent = isDefaultCatalog()
    ? `Catalogue livré : ${cards} cartes, ${places} lieux.`
    : `Classeur importé le ${new Date(catalog.importedAt).toLocaleString('fr-CH')} — ${cards} cartes, ${places} lieux.`;
}

let mode = 'solo';
$('#mode-tabs').addEventListener('click', ev => {
  const tab = ev.target.closest('.tab');
  if (!tab) return;
  mode = tab.dataset.mode;
  $$('#mode-tabs .tab').forEach(t => t.classList.toggle('on', t === tab));
  for (const pane of ['solo', 'local', 'host', 'join']) {
    $(`#mode-${pane}`).hidden = pane !== mode;
  }
  if (mode === 'host' || mode === 'join') connectRoom();
});

$('#local-add').onclick = () => {
  if (localSeats.length >= 5) return;
  localSeats.push({
    name: `Joueur ${localSeats.length + 1}`,
    faction: FACTIONS[localSeats.length % FACTIONS.length], kind: 'human',
  });
  renderLocalSeats();
};
$('#local-remove').onclick = () => {
  if (localSeats.length > 2) localSeats.pop();
  renderLocalSeats();
};
$('#open-settings').onclick = () => {
  const panel = $('#settings-panel');
  panel.hidden = !panel.hidden;
};
$('#open-studio').onclick = () => {
  openStudio(catalog, {
    onSave: () => { saveCatalog(); applyDesign(catalog.design); refreshCatalogInfo(); },
    onClose: () => show('home'),
  });
  show('studio');
};
$('#open-rules').onclick = () => { renderRules(); show('rules'); };
$('#rules-back').onclick = () => show('home');

// ---------------------------------------------------------- import / export

$('#import-file').onclick = () => $('#file-input').click();
$('#file-input').onchange = async ev => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    const next = /\.zip$/i.test(file.name)
      ? await importBundle(buffer)
      : catalogFromBuffer(buffer);
    next.name = file.name.replace(/\.(xlsx|zip)$/i, '');
    catalog = setCatalog(next);
    applyDesign(catalog.design);
    refreshCatalogInfo();
    toast(`${catalog.cards.length} cartes et ${catalog.places.length} lieux importés.`);
  } catch (err) {
    toast(`Import impossible : ${err.message}`, 5000);
  }
  ev.target.value = '';
};

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('#export-xlsx').onclick = () => {
  download(new Blob([xlsxBytes(catalog)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'Morentia_cartes.xlsx');
};
$('#export-zip').onclick = async () => {
  download(await exportBundle(catalog, 'Morentia_cartes'), 'Morentia.zip');
};
$('#reset-catalog').onclick = () => {
  catalog = resetCatalog();
  applyDesign(catalog.design);
  refreshCatalogInfo();
  toast('Catalogue livré restauré.');
};

// ============================================================ règles

function renderRules() {
  const host = $('#rules-list');
  host.innerHTML = '';
  const conventions = [
    ['Conventions de la table numérique',
      `Le classeur fixe les cartes ; certaines conventions restaient à trancher pour jouer.\n`
      + `• Ordres de Kalassir : l'Ordre actif débute sur « Lames de Karina ». En changer est une action qui coûte ${1} or (le Conseil des Trois Ordres), gratuite après un Messager du Conseil.\n`
      + `• Aube : la réserve devient or actif, les cartes se redressent, chaque joueur pioche ${config.drawAtDawn} carte, puis les effets d'Aube se résolvent dans l'ordre du premier joueur.\n`
      + `• Journée : chacun joue une action à son tour jusqu'à se coucher.\n`
      + `• Contrôle : recalculé en continu, pas seulement au Crépuscule — un effet qui change l'influence peut donc faire basculer un lieu immédiatement.\n`
      + `• Lieux adjacents : les emplacements forment une rangée ; seuls les voisins immédiats sont adjacents, plus les deux emplacements reliés par un Réseau Longmai.\n`
      + `• Deck de lieux épuisé : les lieux déjà expirés sont remélangés pour former une nouvelle réserve.`],
  ];
  for (const [label, body] of conventions) {
    host.append(ruleEntry(label, body));
  }
  for (const rule of catalog.rules) host.append(ruleEntry(rule.label, rule.body));
}

function ruleEntry(label, body) {
  const node = document.createElement('div');
  node.className = 'rule-entry';
  const h = document.createElement('h4');
  h.textContent = label;
  const p = document.createElement('p');
  p.textContent = body;
  node.append(h, p);
  return node;
}

// ============================================================ salon en ligne

async function ensureRoom() {
  if (net) return;
  const mod = await import('./net/net.js');
  relayStatus = mod.relayStatus;
  net = new mod.Net();
  net.onRoster = renderRoster;
  net.onStart = cfg => startAsGuest(cfg);
  net.onEvents = events => {
    if (!session) { earlyEvents.push(...events); return; }
    session.receiveEvents(events);
  };
  net.onAsk = req => session?.receiveAsk(req);
  net.onAnswer = (payload, peerId) => session?.receiveAnswer(payload.value, peerId);
  net.onAct = (payload, peerId) => session?.receiveAct(payload.action, peerId);
  net.onSync = payload => session?.receiveSync(payload);
  net.onBye = reason => { toast(`Partie interrompue : ${reason || 'un joueur a quitté'}.`, 5000); show('home'); };
}

function currentRoomCode() {
  const raw = (mode === 'host' ? $('#host-code').value : $('#join-code').value).trim();
  return raw || 'morentia';
}

function myProfile() {
  const nameNode = mode === 'host' ? '#host-name' : '#join-name';
  const factionNode = mode === 'host' ? '#host-faction' : '#join-faction';
  return { name: $(nameNode).value.trim() || 'Joueur', faction: $(factionNode).value };
}

async function connectRoom() {
  // `ensureRoom` charge le module réseau à la demande : il faut l'attendre,
  // sinon un changement de code arrive avant que la connexion existe.
  await ensureRoom();
  if (!net) return;
  net.join(currentRoomCode(), myProfile(), { asHost: mode === 'host' });
  net.announce();
  renderRoster();
}

setInterval(() => {
  if ($('#home').classList.contains('on') && (mode === 'host' || mode === 'join')) renderRoster();
}, 1500);

for (const id of ['#host-code', '#join-code', '#host-name', '#join-name', '#host-faction', '#join-faction']) {
  $(id).addEventListener('change', () => { if (mode === 'host' || mode === 'join') connectRoom(); });
}

function renderRoster() {
  const host = mode === 'host' ? $('#host-roster') : $('#join-roster');
  if (!host || !net) return;
  host.innerHTML = '';
  const relays = relayStatus();
  const link = document.createElement('span');
  link.className = 'phase-chip relay-chip';
  link.textContent = relays.open
    ? `Signalisation : ${relays.open}/${relays.total} relais`
    : 'Signalisation : connexion en cours…';
  host.append(link);
  for (const p of net.roster()) {
    const chip = document.createElement('span');
    chip.className = 'phase-chip roster-peer';
    chip.textContent = `${p.name} · ${FACTION_LABELS[p.faction] || '—'}${p.isHost ? ' (hôte)' : ''}`;
    host.append(chip);
  }
  if (!net.rosterComplete) {
    const wait = document.createElement('span');
    wait.className = 'phase-chip';
    wait.textContent = 'Présentation en cours…';
    host.append(wait);
  }
}

// ============================================================ session

/**
 * Une session relie le moteur (chez l'hôte), l'affichage et le réseau.
 * Les invités n'exécutent pas le moteur : ils replient le flux d'événements
 * reçu, ce qui produit exactement le même état.
 */
class Session {
  constructor({ players, seat, role, seed }) {
    this.players = players;
    this.seat = seat;               // siège local ; suit le joueur actif en mode partagé
    this.role = role;               // 'local' | 'host' | 'guest'
    this.ai = new Ai(catalog);
    this.pendingLocal = null;
    this.logEntries = [];

    this.board = new BoardView(document, { catalog });
    this.replayer = new Replayer({
      board: this.board, catalog,
      onLog: entry => this.log(entry),
      onIdle: () => this.handleStatus(),
    });

    this.drag = new DragLayer({
      isEnabled: () => this.canAct(),
      getActions: instId => this.actionsFor(instId),
      onDrop: action => this.submitAction(action),
    });

    if (role !== 'guest') {
      const state = createState({ catalog, players, config, seed });
      this.engine = new Engine({ catalog, state });
      this.replayer.reset(state, seat);
      this.step(() => this.engine.start());
    }
  }

  /** État affiché — toujours celui du rejoueur, hôte comme invité. */
  get view() { return this.replayer.view; }

  log(entry) {
    this.logEntries.push(entry);
    const list = $('#log-list');
    const node = document.createElement('div');
    node.className = `entry ${entry.kind || ''}`;
    node.textContent = entry.text;
    list.append(node);
    while (list.children.length > 400) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  }

  // ------------------------------------------------------------- moteur

  /** Exécute une opération du moteur puis fait suivre événements et statut. */
  step(fn) {
    if (!this.engine) return;
    fn();
    const events = this.engine.drain();
    if (this.role === 'host') net?.events(events);
    this.replayer.push(events);
    if (!this.replayer.busy) this.handleStatus();
  }

  /** Réagit à ce que le moteur attend, une fois l'animation à jour. */
  handleStatus() {
    if (this.replayer.busy) return;
    if (this.role === 'guest' || !this.engine) { this.refreshInteraction(); return; }
    const status = this.engine.status();

    if (status.status === 'over') { this.showResults(); return; }

    if (status.status === 'choice') {
      const req = this.engine.pending;
      const player = this.players[req.player];
      if (player.kind === 'ai') {
        setTimeout(() => this.step(() => this.engine.submit(
          this.ai.answer(this.engine.state, req))), 260);
        return;
      }
      if (player.kind === 'remote') { net?.ask(req, player.peerId); return; }
      this.askLocal(req);
      return;
    }

    if (status.status === 'action') {
      const player = this.players[status.player];
      if (player.kind === 'ai') {
        setTimeout(() => this.step(() => this.engine.act(status.player,
          this.ai.chooseAction(this.engine.state, status.player,
            this.engine.legal(status.player)))), 420);
        return;
      }
      if (player.kind === 'remote') { this.refreshInteraction(); return; }
      this.takeSeat(status.player);
      return;
    }
    this.refreshInteraction();
  }

  /** Bascule le siège affiché — parties à un seul écran. */
  takeSeat(playerIndex) {
    if (this.role !== 'local' || this.seat === playerIndex) {
      this.seat = playerIndex;
      this.replayer.seat = playerIndex;
      this.board.render(this.view, this.seat);
      this.refreshInteraction();
      return;
    }
    // Rideau entre deux joueurs pour ne pas dévoiler les mains.
    dialog({
      title: `Au tour de ${this.players[playerIndex].name}`,
      body: 'Passez l’appareil, puis dévoilez la main.',
      buttons: [{ label: 'Dévoiler', value: true, primary: true }],
    }).then(() => {
      this.seat = playerIndex;
      this.replayer.seat = playerIndex;
      this.board.render(this.view, this.seat);
      this.refreshInteraction();
    });
  }

  // ------------------------------------------------------------ actions

  /** Le joueur local peut-il agir en ce moment ? */
  canAct() {
    if (this.replayer.busy || this.pendingLocal) return false;
    const state = this.view;
    if (!state || state.phase !== PHASE.DAY) return false;
    if (state.activePlayer !== this.seat) return false;
    const player = this.players[this.seat];
    return player && player.kind !== 'ai' && player.kind !== 'remote';
  }

  actionsFor(instId) {
    if (!this.canAct()) return [];
    return legalActions(this.view, catalog, this.seat)
      .filter(a => a.inst === instId)
      .map(a => ({ ...a, player: a.player ?? this.seat }));
  }

  submitAction(action) {
    if (!this.canAct()) return;
    if (this.role === 'guest') { net?.act(action); this.refreshInteraction(); return; }
    this.step(() => this.engine.act(this.seat, action));
  }

  /** Actualise l'état des commandes du bas d'écran. */
  refreshInteraction() {
    if (!this.view) return;
    const can = this.canAct();
    $('#btn-pass').disabled = !can;
    const orderBtn = $('#btn-order');
    const player = this.view?.players?.[this.seat];
    const canOrder = can && player?.faction === 'kalassir';
    orderBtn.hidden = !canOrder;
    orderBtn.disabled = !canOrder;
    this.board.setTargets(null);
    this.board.render(this.view, this.seat);
  }

  // -------------------------------------------------------------- choix

  /** Pose une question au joueur assis devant l'écran. */
  async askLocal(req) {
    this.pendingLocal = req;
    if (this.role === 'local' && this.seat !== req.player) {
      await dialog({
        title: `Choix de ${this.players[req.player].name}`,
        body: 'Passez l’appareil pour répondre.',
        buttons: [{ label: 'Continuer', value: true, primary: true }],
      });
      this.seat = req.player;
      this.replayer.seat = req.player;
      this.board.render(this.view, this.seat);
    }
    const answer = await choiceDialog(req, this.view, catalog);
    this.pendingLocal = null;
    if (this.role === 'guest') { net?.answer(answer); return; }
    this.step(() => this.engine.submit(answer));
  }

  // ------------------------------------------------------------- réseau

  receiveEvents(events) {
    this.replayer.push(events);
    if (!this.replayer.busy) this.refreshInteraction();
  }

  receiveAsk(req) {
    if (req.player !== this.seat) return;
    this.askLocal(req);
  }

  receiveAnswer(value, peerId) {
    if (this.role !== 'host') return;
    const req = this.engine.pending;
    if (!req) return;
    if (this.players[req.player]?.peerId !== peerId) return;
    this.step(() => this.engine.submit(value));
  }

  receiveAct(action, peerId) {
    if (this.role !== 'host') return;
    const index = this.players.findIndex(p => p.peerId === peerId);
    if (index < 0) return;
    this.step(() => this.engine.act(index, action));
  }

  receiveSync(payload) {
    this.replayer.view = payload.state;
    this.players = payload.players;
    this.seat = payload.seat ?? this.seat;
    this.replayer.seat = this.seat;
    this.board.render(this.view, this.seat);
  }

  // -------------------------------------------------------------- fin

  showResults() {
    const ranked = this.view.result?.standings || [];
    const body = ranked
      .map((r, i) => `${i + 1}. ${r.name} — ${r.vp} PV (${r.gold} or)`)
      .join('\n');
    dialog({
      title: 'Fin de partie',
      body: body || 'Partie terminée.',
      buttons: [{ label: 'Retour à l’accueil', value: true, primary: true }],
    }).then(() => show('home'));
  }
}

// ============================================================ dialogues

function dialog({ title, body, buttons }) {
  return new Promise(resolve => {
    const overlay = $('#overlay');
    const node = $('#dialog');
    node.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = title;
    node.append(h);
    if (body) {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--muted);white-space:pre-line;line-height:1.6;margin-top:6px';
      p.textContent = body;
      node.append(p);
    }
    const foot = document.createElement('footer');
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `btn${b.primary ? ' primary' : ''}`;
      btn.textContent = b.label;
      btn.onclick = () => { overlay.classList.remove('on'); resolve(b.value); };
      foot.append(btn);
    }
    node.append(foot);
    overlay.classList.add('on');
  });
}

/** Présente une question du moteur : cartes cliquables ou boutons. */
function choiceDialog(req, state, cat) {
  return new Promise(resolve => {
    const overlay = $('#overlay');
    const node = $('#dialog');
    node.innerHTML = '';

    const who = document.createElement('div');
    who.className = 'who-asks';
    who.textContent = state.players[req.player]?.name || 'Choix';
    const h = document.createElement('h3');
    h.textContent = req.prompt || 'Faites un choix.';
    node.append(who, h);

    const picked = new Set();
    const max = req.max ?? 1;

    const finish = value => { overlay.classList.remove('on'); resolve(value); };

    if (req.kind === 'card') {
      const wrap = document.createElement('div');
      wrap.className = 'choice-cards';
      for (const opt of req.options) {
        const inst = state.cards[opt.inst ?? opt.value];
        const face = inst ? faceOf(cat, inst) : null;
        const card = face ? renderCard(cat, face) : document.createElement('div');
        card.classList.add('mini', 'selectable');
        card.onclick = () => {
          if (max === 1) { finish(opt.value); return; }
          if (picked.has(opt.value)) { picked.delete(opt.value); card.classList.remove('chosen'); }
          else if (picked.size < max) { picked.add(opt.value); card.classList.add('chosen'); }
          confirmBtn.textContent = `Valider (${picked.size}/${max})`;
        };
        if (inst?.controller !== null && inst?.controller !== undefined) {
          const pip = document.createElement('span');
          pip.className = 'owner-pip';
          pip.style.setProperty('--seat', seatColor(state, inst.controller));
          card.append(pip);
        }
        wrap.append(card);
      }
      node.append(wrap);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'choices';
      for (const opt of req.options) {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = opt.label ?? labelForSlot(opt, state, cat) ?? String(opt.value);
        btn.onclick = () => finish(opt.value);
        wrap.append(btn);
      }
      node.append(wrap);
    }

    const foot = document.createElement('footer');
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn primary';
    confirmBtn.textContent = max > 1 ? `Valider (0/${max})` : 'Valider';
    confirmBtn.onclick = () => finish(max === 1 ? [...picked][0] ?? null : [...picked]);
    if (max > 1) foot.append(confirmBtn);
    if (req.optional || req.min === 0) {
      const skip = document.createElement('button');
      skip.className = 'btn ghost';
      skip.textContent = 'Passer';
      skip.onclick = () => finish(max === 1 ? null : []);
      foot.append(skip);
    }
    node.append(foot);
    overlay.classList.add('on');
  });
}

function labelForSlot(opt, state, cat) {
  if (opt.slot === undefined || opt.slot === null) return null;
  const rec = cat.placeById.get(state.slots[opt.slot]?.placeId);
  return `Lieu ${opt.slot + 1}${rec ? ` — ${rec.name}` : ''}`;
}

// ============================================================ démarrage

function buildPlayers() {
  if (mode === 'solo') {
    const count = Number($('#solo-count').value);
    const mine = $('#solo-faction').value;
    const others = FACTIONS.filter(f => f !== mine);
    const list = [{
      id: 'me', name: $('#solo-name').value.trim() || 'Vous', faction: mine, kind: 'human',
    }];
    for (let i = 0; i < count; i++) {
      list.push({ id: `ai${i}`, name: `IA ${i + 1}`, faction: others[i % others.length], kind: 'ai' });
    }
    return { players: list, seat: 0, role: 'local' };
  }
  if (mode === 'local') {
    return {
      players: localSeats.map((s, i) => ({ id: `s${i}`, ...s })),
      seat: 0, role: 'local',
    };
  }
  // Parties en ligne : l'ordre des sièges suit l'ordre stable du salon.
  const roster = net?.roster() || [];
  const players = roster.map((r, i) => ({
    id: r.id, name: r.name, faction: r.faction || FACTIONS[i % FACTIONS.length],
    kind: r.id === net.selfId ? 'human' : 'remote', peerId: r.id,
  }));
  const seat = players.findIndex(p => p.id === net.selfId);
  return { players, seat: Math.max(0, seat), role: net.isHost ? 'host' : 'guest' };
}

function startSession(setup, seed) {
  session = new Session({ ...setup, seed });
  session.replayer.speed = SPEEDS[speedIndex];
  $('#log-list').innerHTML = '';
  show('table');
  requestAnimationFrame(() => session.board.fit());
}

$('#start-game').onclick = () => {
  if (mode === 'join') { toast('En attente du lancement par l’hôte.'); return; }
  const setup = buildPlayers();
  if (setup.players.length < 2) { toast('Il faut au moins deux joueurs.'); return; }
  const seed = (Math.random() * 0xffffffff) >>> 0 || 1;
  if (mode === 'host') {
    if (!net?.rosterComplete) {
      toast('Un joueur ne s’est pas encore présenté — réessayez dans un instant.');
      return;
    }
    net.start({ players: setup.players.map(p => ({ ...p })), seed, config });
  }
  startSession(setup, seed);
};

function startAsGuest(cfg) {
  config = { ...config, ...cfg.config };
  const players = cfg.players.map(p => ({
    ...p, kind: p.id === net.selfId ? 'human' : (p.kind === 'ai' ? 'ai' : 'remote'),
  }));
  const seat = Math.max(0, players.findIndex(p => p.id === net.selfId));
  session = new Session({ players, seat, role: 'guest', seed: cfg.seed });
  // L'invité part du même état initial que l'hôte, puis suit le flux reçu.
  session.replayer.reset(createState({ catalog, players, config, seed: cfg.seed }), seat);
  if (earlyEvents.length) {
    session.receiveEvents(earlyEvents.splice(0, earlyEvents.length));
  }
  $('#log-list').innerHTML = '';
  show('table');
  requestAnimationFrame(() => session.board.fit());
}

// ============================================================ commandes table

$('#btn-pass').onclick = () => session?.submitAction({ type: 'pass' });
$('#btn-order').onclick = async () => {
  if (!session?.canAct()) return;
  const current = session.view.players[session.seat].flags.order;
  const options = ORDERS.filter(o => o !== current).map(o => ({ value: o, label: o }));
  const value = await choiceDialog({
    kind: 'mode', player: session.seat, options, min: 1, max: 1, optional: true,
    prompt: 'Conseil des Trois Ordres — quel Ordre adopter ?',
  }, session.view, catalog);
  if (value) session.submitAction({ type: 'order', order: value });
};
// Vitesse de la résolution animée : le rythme lisible par défaut devient vite
// long quand on enchaîne les parties de test.
const SPEEDS = [1, 2, 4, 0];
const SPEED_LABELS = { 1: 'Vitesse ×1', 2: 'Vitesse ×2', 4: 'Vitesse ×4', 0: 'Instantané' };
let speedIndex = 0;
$('#btn-speed').onclick = () => {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  const speed = SPEEDS[speedIndex];
  $('#btn-speed').textContent = SPEED_LABELS[speed];
  if (session) session.replayer.speed = speed;
};

$('#btn-fit').onclick = () => session?.board.fit();
$('#zoom-in').onclick = () => session?.board.zoom(1.18);
$('#zoom-out').onclick = () => session?.board.zoom(1 / 1.18);
$('#btn-log').onclick = () => $('#log-panel').classList.toggle('on');
$('#log-close').onclick = () => $('#log-panel').classList.remove('on');
$('#btn-quit').onclick = async () => {
  const ok = await dialog({
    title: 'Quitter la partie ?', body: 'La partie en cours sera perdue.',
    buttons: [{ label: 'Rester', value: false }, { label: 'Quitter', value: true, primary: true }],
  });
  if (!ok) return;
  if (session?.role === 'host') net?.bye('l’hôte a quitté');
  session = null;
  show('home');
};

window.addEventListener('resize', () => {
  if ($('#table').classList.contains('on')) session?.board.fit();
});

// ============================================================ amorçage

fillFactionSelects();
renderLocalSeats();
renderConfig();
refreshCatalogInfo();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* hors-ligne indisponible */ });
  });
}
