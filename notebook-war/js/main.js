// Screens, lobby and glue.
import { Game } from './game.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { audio } from './audio.js';
import { roomCode, hashString, escapeHtml } from './util.js';
import { botName } from './ai.js';

const $ = sel => document.querySelector(sel);
const screens = ['menu', 'lobby', 'game'];

const state = {
  name: localStorage.getItem('nwar-name') || 'Stick' + Math.floor(Math.random() * 900 + 100),
  game: null,
  net: null,
  roomCode: '',
  lastSolo: null,
};

const input = new Input();

function show(name) {
  for (const s of screens) $('#screen-' + s).classList.toggle('hidden', s !== name);
}

$('#player-name').value = state.name;
$('#player-name').addEventListener('input', e => {
  state.name = e.target.value.trim().slice(0, 14) || 'Stick';
  localStorage.setItem('nwar-name', state.name);
});

// ---------------------------------------------------------------------------
// Solo
// ---------------------------------------------------------------------------
$('#btn-solo').addEventListener('click', () => {
  audio.unlock();
  const count = +$('#bot-count').value;
  const diff = $('#bot-diff').value;
  const bots = Array.from({ length: count }, (_, i) => ({ name: botName(i), difficulty: diff }));
  const opts = { mode: 'solo', seed: (Math.random() * 1e9) >>> 0, bots };
  state.lastSolo = opts;
  launchGame(opts);
});

// ---------------------------------------------------------------------------
// Multiplayer lobby
// ---------------------------------------------------------------------------
$('#btn-multi').addEventListener('click', () => {
  audio.unlock();
  show('lobby');
  $('#lobby-join').classList.remove('hidden');
  $('#lobby-room').classList.add('hidden');
  $('#room-code-input').value = '';
});
$('#btn-lobby-back').addEventListener('click', () => {
  if (state.net) { state.net.leave(); state.net = null; }
  show('menu');
});
$('#btn-create-room').addEventListener('click', () => enterRoom(roomCode()));
$('#btn-join-room').addEventListener('click', () => {
  const code = $('#room-code-input').value.trim().toUpperCase();
  if (code.length >= 3) enterRoom(code);
});
$('#room-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join-room').click(); });

function enterRoom(code) {
  state.roomCode = code;
  state.net = new Net();
  state.net.join(code);
  state.net.setProfile({ name: state.name });
  $('#lobby-join').classList.add('hidden');
  $('#lobby-room').classList.remove('hidden');
  $('#room-code-display').textContent = code;
  state.net.onPeers = renderLobby;
  state.net.onHostChange = renderLobby;
  state.net.onStart = cfg => startMpGame(cfg);
  renderLobby();
}

$('#btn-room-leave').addEventListener('click', () => {
  if (state.net) { state.net.leave(); state.net = null; }
  show('menu');
});

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
}

function renderLobby() {
  const net = state.net;
  if (!net) return;
  const rows = [[net.selfId, { name: state.name + ' (toi)' }]];
  for (const [id, prof] of net.profiles) rows.push([id, prof]);
  $('#lobby-players').innerHTML = rows.map(([id, p]) =>
    `<div class="lobby-row">${id === net.hostId ? '✏️ ' : ''}${escapeHtml(p.name || '???')}</div>`).join('');
  $('#btn-start-match').classList.toggle('hidden', !net.isHost);
  $('#lobby-bots-row').classList.toggle('hidden', !net.isHost);
  $('#lobby-wait').classList.toggle('hidden', net.isHost);
}

$('#btn-start-match').addEventListener('click', () => {
  const net = state.net;
  if (!net || !net.isHost) return;
  const cfg = {
    seed: (hashString(state.roomCode) ^ (Date.now() % 1e9)) >>> 0,
    bots: +$('#lobby-bots').value,
    diff: 'normal',
    target: 10,
  };
  net.start(cfg);
  startMpGame(cfg);
});

function startMpGame(cfg) {
  if (state.game) {
    if (!state.game.matchOver) return;
    state.game.stop(); state.game = null;
  }
  const bots = Array.from({ length: cfg.bots || 0 }, (_, i) => ({ name: botName(i) + ' 🤖', difficulty: cfg.diff || 'normal' }));
  launchGame({ mode: 'mp', seed: cfg.seed, bots, net: state.net, killTarget: cfg.target || 10 });
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function launchGame(opts) {
  if (state.game) { state.game.stop(); state.game = null; }
  // Drop focus from menu buttons so Space/Enter don't re-trigger them in game.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  show('game');
  $('#game-over').classList.add('hidden');
  $('#killfeed').innerHTML = '';
  $('#game-msg').style.opacity = 0;
  $('#btn-rematch').textContent = opts.mode === 'mp' ? 'RETOUR AU SALON' : 'REVANCHE';
  input.enabled = true;
  input.buildTouchUI($('#screen-game'));
  audio.unlock();
  state.game = new Game({
    canvas: $('#game-canvas'),
    input,
    myName: state.name,
    onMatchOver: (winnerId, ranking) => showGameOver(winnerId, ranking),
    ...opts,
  });
  state.game.start();
  window.__game = state.game; // debug handle
}

function showGameOver(winnerId, ranking) {
  const win = winnerId === (state.net ? state.net.selfId : 'me');
  const h2 = $('#game-over h2');
  h2.textContent = win ? 'VICTOIRE' : 'DÉFAITE';
  h2.className = win ? 'win' : 'lose';
  $('#game-over-sub').textContent = `${state.game ? state.game.nameOf(winnerId) : '???'} remporte la partie !`;
  $('#final-scores').innerHTML = ranking.map((r, i) =>
    `<div class="sb-row"><span>${i + 1}. ${escapeHtml(r.name)}</span><span>☠ ${r.kills} · ✝ ${r.deaths}</span></div>`).join('');
  $('#game-over').classList.remove('hidden');
}

function exitGame() {
  if (state.game) { state.game.stop(); state.game = null; }
  input.enabled = false;
  if (state.net) { state.net.leave(); state.net = null; }
  show('menu');
}

$('#btn-exit-game').addEventListener('click', exitGame);
$('#btn-exit-over').addEventListener('click', exitGame);
$('#btn-rematch').addEventListener('click', () => {
  if (state.net) return returnToLobby();
  if (state.game) { state.game.stop(); state.game = null; }
  launchGame({ ...state.lastSolo, seed: (Math.random() * 1e9) >>> 0 });
});

addEventListener('keydown', e => {
  if (e.code === 'Escape' && state.game) exitGame();
});

show('menu');
