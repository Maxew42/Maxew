// Screens, hangar, lobby and glue.
import { PREMADE_SHIPS, validateDesign, computeStats, BUDGET } from './parts.js';
import { Ship, nextRenderFrame } from './ship.js';
import { Game } from './game.js';
import { Editor, loadSavedShips, deleteSavedShip } from './editor.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { roomCode, hashString } from './util.js';

const $ = sel => document.querySelector(sel);
const screens = ['menu', 'hangar', 'lobby', 'editor', 'game'];

const state = {
  name: localStorage.getItem('warp2-name') || 'Pilot' + Math.floor(Math.random() * 900 + 100),
  design: null,          // selected ship design
  mode: 'ai',            // what the hangar leads to
  returnTo: 'menu',      // where game exit goes back to
  game: null,
  net: null,
  lobbyReady: false,
};

const input = new Input();

function show(name) {
  for (const s of screens) $('#screen-' + s).classList.toggle('hidden', s !== name);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
$('#btn-vs-ai').addEventListener('click', () => { state.mode = 'ai'; openHangar(); });
$('#btn-multi').addEventListener('click', () => { state.mode = 'mp'; openHangar(); });
$('#btn-builder').addEventListener('click', () => openEditor(null));

// ---------------------------------------------------------------------------
// Hangar (ship selection)
// ---------------------------------------------------------------------------
function openHangar() {
  show('hangar');
  $('#hangar-title').textContent = state.mode === 'ai' ? 'Battle vs AI — choose your ship' : 'Multiplayer — choose your ship';
  $('#ai-options').classList.toggle('hidden', state.mode !== 'ai');
  $('#player-name').value = state.name;
  renderShipCards();
}

function allShips() {
  return [...PREMADE_SHIPS, ...loadSavedShips()];
}

function renderShipCards() {
  const grid = $('#ship-grid');
  grid.innerHTML = '';
  const saved = loadSavedShips();
  for (const design of allShips()) {
    const v = validateDesign(design);
    const s = v.stats;
    const isSaved = saved.includes(design);
    const card = document.createElement('div');
    card.className = 'ship-card' + (state.design && state.design.name === design.name ? ' on' : '');
    card.innerHTML = `
      <canvas width="150" height="150"></canvas>
      <div class="ship-card-name">${design.name}</div>
      <div class="ship-card-tag">${design.tagline || 'Custom design'}</div>
      <div class="ship-card-stats">HP ${s.hp} · ⚡${s.energyMax} · ${Math.round(s.topSpeed)} spd · ${s.cost}/${BUDGET}</div>
      <div class="ship-card-actions">
        ${isSaved ? '<button class="mini edit">Edit</button><button class="mini del">✕</button>' : '<button class="mini edit">Open in builder</button>'}
      </div>`;
    drawShipThumb(card.querySelector('canvas'), design);
    card.addEventListener('click', e => {
      if (e.target.closest('.mini')) return;
      if (!v.ok) return;
      state.design = design;
      renderShipCards();
    });
    card.querySelector('.edit').addEventListener('click', () => openEditor(design));
    const del = card.querySelector('.del');
    if (del) del.addEventListener('click', () => { deleteSavedShip(design.name); if (state.design === design) state.design = null; renderShipCards(); });
    if (!v.ok) card.classList.add('invalid');
    grid.appendChild(card);
  }
  $('#btn-launch').disabled = !state.design;
  $('#btn-launch').textContent = state.mode === 'ai' ? 'LAUNCH' : 'TO LOBBY';
}

function drawShipThumb(canvas, design) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  try {
    nextRenderFrame();
    const ship = new Ship(design, { id: 'thumb-' + design.name });
    ship.x = 0; ship.y = 0; ship.angle = -Math.PI / 2;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    const sc = Math.min(1.6, (canvas.width / 2 - 8) / ship.radius);
    ctx.scale(sc, sc);
    ship.render(ctx);
    ctx.restore();
  } catch (e) { /* invalid design: leave blank */ }
}

$('#player-name').addEventListener('input', e => {
  state.name = e.target.value.trim() || 'Pilot';
  localStorage.setItem('warp2-name', state.name);
});
$('#btn-hangar-back').addEventListener('click', () => show('menu'));
$('#btn-hangar-new').addEventListener('click', () => openEditor(null));

$('#btn-launch').addEventListener('click', () => {
  if (!state.design) return;
  if (state.mode === 'ai') startAIGame();
  else openLobby();
});

// ---------------------------------------------------------------------------
// VS AI
// ---------------------------------------------------------------------------
function startAIGame(returnTo = 'hangar') {
  const count = +$('#ai-count').value;
  const diff = $('#ai-difficulty').value;
  const pool = PREMADE_SHIPS;
  const bots = Array.from({ length: count }, (_, i) => {
    const d = pool[Math.floor(Math.random() * pool.length)];
    return { design: d, name: d.name + ' ' + (i + 1), difficulty: diff };
  });
  state.returnTo = returnTo;
  launchGame({ mode: 'ai', myDesign: state.design, myName: state.name, bots });
}

// ---------------------------------------------------------------------------
// Multiplayer lobby
// ---------------------------------------------------------------------------
function openLobby() {
  show('lobby');
  $('#lobby-join').classList.remove('hidden');
  $('#lobby-room').classList.add('hidden');
  $('#room-code-input').value = '';
}

$('#btn-lobby-back').addEventListener('click', () => {
  if (state.net) { state.net.leave(); state.net = null; }
  openHangar();
});
$('#btn-create-room').addEventListener('click', () => enterRoom(roomCode()));
$('#btn-join-room').addEventListener('click', () => {
  const code = $('#room-code-input').value.trim().toUpperCase();
  if (code.length >= 3) enterRoom(code);
});

function enterRoom(code) {
  state.roomCode = code;
  state.net = new Net();
  state.net.join(code);
  state.net.setProfile({ name: state.name, design: state.design });
  $('#lobby-join').classList.add('hidden');
  $('#lobby-room').classList.remove('hidden');
  $('#room-code-display').textContent = code;
  state.net.onPeers = renderLobby;
  state.net.onHostChange = renderLobby;
  state.net.onStart = cfg => startMpGame(cfg);
  renderLobby();
  renderLobbyShip();
}

// Show the player's currently-selected ship in the lobby.
function renderLobbyShip() {
  if (!state.design) return;
  drawShipThumb($('#lobby-ship-canvas'), state.design);
  $('#lobby-ship-name').textContent = state.design.name;
}

// Cycle through valid designs and broadcast the change to peers.
function cycleLobbyShip(dir) {
  const ships = allShips().filter(d => validateDesign(d).ok);
  if (!ships.length || !state.net) return;
  let idx = ships.findIndex(d => d.name === state.design?.name);
  idx = ((idx < 0 ? 0 : idx) + dir + ships.length) % ships.length;
  state.design = ships[idx];
  state.net.setProfile({ name: state.name, design: state.design });
  renderLobbyShip();
  renderLobby();
}

$('#lobby-ship-prev').addEventListener('click', () => cycleLobbyShip(-1));
$('#lobby-ship-next').addEventListener('click', () => cycleLobbyShip(1));
$('#btn-room-leave').addEventListener('click', () => {
  if (state.net) { state.net.leave(); state.net = null; }
  openHangar();
});

// Return to the current room after a match instead of leaving it.
function returnToLobby() {
  if (state.game) { state.game.stop(); state.game = null; }
  input.enabled = false;
  show('lobby');
  $('#lobby-join').classList.add('hidden');
  $('#lobby-room').classList.remove('hidden');
  if (state.net) {
    state.net.onPeers = renderLobby;
    state.net.onHostChange = renderLobby;
    state.net.onStart = cfg => startMpGame(cfg);
  }
  renderLobby();
  renderLobbyShip();
}

function renderLobby() {
  const net = state.net;
  if (!net) return;
  const list = $('#lobby-players');
  const rows = [[net.selfId, { name: state.name + ' (you)', design: state.design }]];
  for (const [id, prof] of net.profiles) rows.push([id, prof]);
  list.innerHTML = rows.map(([id, p]) =>
    `<div class="lobby-row">${id === net.hostId ? '👑 ' : ''}${escapeHtml(p.name)} — ${escapeHtml(p.design?.name || '?')}</div>`).join('');
  $('#btn-start-match').classList.toggle('hidden', !net.isHost);
  $('#lobby-wait').classList.toggle('hidden', net.isHost);
}

$('#btn-start-match').addEventListener('click', () => {
  const net = state.net;
  if (!net || !net.isHost) return;
  const botCount = +$('#lobby-bots').value;
  const bots = Array.from({ length: botCount }, (_, i) => {
    const d = PREMADE_SHIPS[Math.floor(Math.random() * PREMADE_SHIPS.length)];
    return { designIdx: PREMADE_SHIPS.indexOf(d), name: d.name + ' [bot]', difficulty: 'normal' };
  });
  const cfg = { seed: hashString(state.roomCode) ^ Date.now() % 1e9, bots };
  net.start(cfg);
  startMpGame(cfg);
});

function startMpGame(cfg) {
  if (state.game) {
    if (!state.game.matchOver) return;           // a live match is already running
    state.game.stop(); state.game = null;        // tear down a finished match so we can rejoin
  }
  const bots = (cfg.bots || []).map(b => ({ design: PREMADE_SHIPS[b.designIdx], name: b.name, difficulty: b.difficulty }));
  state.returnTo = 'menu';
  launchGame({ mode: 'mp', myDesign: state.design, myName: state.name, net: state.net, seed: cfg.seed, bots });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
const editor = new Editor($('#screen-editor'), {
  onBack: () => { show('menu'); },
  onTest: design => {
    state.design = design;
    $('#ai-count').value = '1';
    startAIGame('editor');
  },
});

function openEditor(design) {
  show('editor');
  editor.open(design ? design : { name: 'Custom ship', parts: [] });
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function launchGame(opts) {
  show('game');
  $('#game-over').classList.add('hidden');
  $('#btn-rematch').textContent = opts.mode === 'mp' ? 'BACK TO LOBBY' : 'REMATCH';
  $('#btn-exit-over').textContent = opts.mode === 'mp' ? 'LEAVE ROOM' : 'BACK';
  $('#killfeed').innerHTML = '';
  input.enabled = true;
  input.buildTouchUI($('#screen-game'));
  state.game = new Game({ ...opts, canvas: $('#game-canvas'), input });
  state.game.start();
  state.lastGameOpts = opts;
  window.__game = state.game; // debug handle
}

function exitGame() {
  if (state.game) { state.game.stop(); state.game = null; }
  input.enabled = false;
  if (state.net) { state.net.leave(); state.net = null; }
  if (state.returnTo === 'editor') openEditor(editor.design);
  else if (state.returnTo === 'hangar') openHangar();
  else show('menu');
}

$('#btn-exit-game').addEventListener('click', exitGame);
$('#btn-exit-over').addEventListener('click', exitGame);
$('#btn-rematch').addEventListener('click', () => {
  if (!state.lastGameOpts) return exitGame();
  const opts = state.lastGameOpts;
  if (opts.mode === 'mp') return returnToLobby(); // rejoin the room, host can restart
  if (state.game) { state.game.stop(); state.game = null; }
  launchGame(opts);
});

addEventListener('keydown', e => {
  if (e.code === 'Escape' && state.game) exitGame();
});

// Default selection so LAUNCH works immediately.
state.design = PREMADE_SHIPS[0];
show('menu');
