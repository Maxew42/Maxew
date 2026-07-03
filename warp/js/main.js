import { Game } from './game.js';
import { Input } from './input.js';
import { Net, selfId } from './net.js';
import {
  BUDGET_MAX,
  GRID_MAX,
  GRID_MIN,
  LAYERS,
  PALETTE,
  PARTS,
  PREMADE_BLUEPRINTS,
  blueprintStats,
  cloneBlueprint,
  flipBlueprint,
  normalizeBlueprint,
  partFitsLayer,
  validateBlueprint,
} from './parts.js';
import { drawBlueprint, drawPartShape } from './ship.js';
import { CELL, clamp, formatRoomCode, hashString, randomRoomCode } from './util.js';

const $ = id => document.getElementById(id);

const els = {
  home: $('screen-home'),
  lobby: $('screen-lobby'),
  results: $('screen-results'),
  hud: $('hud'),
  preview: $('ship-preview'),
  editor: $('editor-grid'),
  premades: $('premade-list'),
  palette: $('palette'),
  layerTabs: $('layer-tabs'),
  pilotName: $('pilot-name'),
  roomCode: $('room-code'),
  status: $('home-status'),
  lobbyStatus: $('lobby-status'),
  lobbyCode: $('lobby-code'),
  lobbyPlayers: $('lobby-players'),
  btnStart: $('btn-start'),
  btnReady: $('btn-ready'),
  btnResultLobby: $('btn-result-lobby'),
  commandChips: [...document.querySelectorAll('[data-cmd]')],
};

const input = new Input();
input.bindTouch();
const game = new Game($('game'), input);
const net = new Net();

let selectedPremade = 0;
let currentBlueprint = cloneBlueprint(PREMADE_BLUEPRINTS[0]);
let customBlueprint = cloneBlueprint(PREMADE_BLUEPRINTS[0]);
let selectedLayer = 0;
let selectedPart = 'armorMedium';
let erasing = false;
let lobbyReady = false;
let currentRoomCode = '';
let lastLaunch = null;

els.pilotName.value = localStorage.getItem('warp-name') || '';

net.onPeers = updateLobby;
net.onHostChange = () => {
  game.controlsAi = net.isHost;
  updateLobby();
};
net.onStart = config => startNetworkBattle(config);
net.onState = (snapshot, peerId) => game.receiveState(snapshot, peerId, net.profiles.get(peerId));
net.onAiState = snapshots => game.receiveAiState(snapshots);
net.onEvent = event => game.receiveEvent(event);
net.onEnd = summary => showResults(summary || { title: 'Battle Over', detail: '' });

game.onHud = updateHud;
game.onFinish = summary => showResults(summary);

setupPremades();
setupLayers();
setupPalette();
setupEditorInput();
setupActions();
renderAll();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

function setupPremades() {
  els.premades.innerHTML = '';
  PREMADE_BLUEPRINTS.forEach((bp, index) => {
    const btn = document.createElement('button');
    btn.className = 'ship-choice';
    btn.type = 'button';
    btn.textContent = bp.name;
    btn.title = bp.tagline;
    btn.addEventListener('click', () => selectPremade(index));
    els.premades.appendChild(btn);
  });
}

function setupLayers() {
  els.layerTabs.innerHTML = '';
  LAYERS.forEach(layer => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost';
    btn.textContent = layer.name;
    btn.addEventListener('click', () => {
      selectedLayer = layer.id;
      erasing = false;
      renderAll();
    });
    els.layerTabs.appendChild(btn);
  });
}

function setupPalette() {
  els.palette.innerHTML = '';
  for (const id of PALETTE) {
    const def = PARTS[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool';
    btn.title = `${def.name} - ${def.role} - ${def.cost}`;
    btn.style.setProperty('--swatch', def.color);
    btn.innerHTML = `
      <canvas class="tool-icon" width="68" height="68" aria-hidden="true"></canvas>
      <span class="tool-name">${escapeHtml(def.name)}</span>
      <span class="tool-meta">${def.slot === 'core' ? 'Core' : 'Outer'} - ${def.cost}</span>
    `;
    btn.addEventListener('click', () => {
      selectedPart = id;
      erasing = false;
      renderAll();
    });
    els.palette.appendChild(btn);
    drawToolIcon(btn.querySelector('canvas'), def);
  }
}

function drawToolIcon(canvas, def) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(1.55, 1.55);
  drawPartShape(ctx, def, { type: def.id, layer: 0, hp: def.hp, maxHp: def.hp });
  ctx.restore();
}

function setupEditorInput() {
  const canvas = els.editor;
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    paintFromEvent(e);
  });
  canvas.addEventListener('pointermove', e => {
    if (e.buttons) {
      e.preventDefault();
      paintFromEvent(e);
    }
  });
}

function setupActions() {
  $('btn-solo').addEventListener('click', () => {
    const bp = playableBlueprint();
    if (!bp) return;
    const name = pilotName();
    localStorage.setItem('warp-name', name);
    showBattleUi();
    lastLaunch = () => {
      showBattleUi();
      game.startSolo({ name: pilotName(), blueprint: playableBlueprint() || bp });
    };
    game.startSolo({ name, blueprint: bp });
  });

  $('btn-create').addEventListener('click', () => joinLobby(randomRoomCode()));
  $('btn-join').addEventListener('click', () => {
    const code = formatRoomCode(els.roomCode.value);
    if (code.length !== 4) {
      setStatus('Enter a four-character room code.');
      return;
    }
    joinLobby(code);
  });
  els.roomCode.addEventListener('input', () => {
    els.roomCode.value = formatRoomCode(els.roomCode.value);
  });

  $('btn-flip').addEventListener('click', () => {
    customBlueprint = flipBlueprint({ ...currentBlueprint, name: 'Custom' });
    currentBlueprint = cloneBlueprint(customBlueprint);
    selectedPremade = -1;
    renderAll();
  });
  $('btn-eraser').addEventListener('click', () => {
    erasing = !erasing;
    renderAll();
  });
  $('btn-clear').addEventListener('click', () => {
    customBlueprint = { name: 'Custom', tagline: 'Custom build', parts: [] };
    currentBlueprint = cloneBlueprint(customBlueprint);
    selectedPremade = -1;
    renderAll();
  });

  els.pilotName.addEventListener('input', () => {
    localStorage.setItem('warp-name', pilotName());
    if (net.connected) pushProfile();
  });

  els.lobbyCode.addEventListener('click', () => {
    navigator.clipboard?.writeText(currentRoomCode).catch(() => {});
  });
  $('btn-ready').addEventListener('click', () => {
    lobbyReady = !lobbyReady;
    pushProfile();
    updateLobby();
  });
  $('btn-start').addEventListener('click', () => {
    if (!net.isHost) return;
    const config = makeStartConfig();
    if (!config) return;
    net.start(config);
    startNetworkBattle(config);
  });
  $('btn-leave').addEventListener('click', () => {
    net.leave();
    lobbyReady = false;
    showOnly(els.home);
  });

  $('btn-quit').addEventListener('click', () => showResults({ title: 'Battle Left', detail: 'Returned from the arena.' }));
  $('btn-result-home').addEventListener('click', () => {
    game.stop();
    net.leave();
    lobbyReady = false;
    showOnly(els.home);
    els.hud.classList.add('hidden');
  });
  $('btn-result-lobby').addEventListener('click', () => {
    game.stop();
    els.hud.classList.add('hidden');
    if (net.connected) {
      lobbyReady = false;
      pushProfile();
      showOnly(els.lobby);
      updateLobby();
    } else {
      showOnly(els.home);
    }
  });
  $('btn-result-again').addEventListener('click', () => {
    if (net.connected) {
      showOnly(els.lobby);
      updateLobby();
      return;
    }
    if (lastLaunch) lastLaunch();
  });
}

function selectPremade(index) {
  selectedPremade = index;
  currentBlueprint = cloneBlueprint(PREMADE_BLUEPRINTS[index]);
  customBlueprint = cloneBlueprint(currentBlueprint);
  erasing = false;
  renderAll();
  if (net.connected) pushProfile();
}

function paintFromEvent(e) {
  const rect = els.editor.getBoundingClientRect();
  const sx = (e.clientX - rect.left) / rect.width * els.editor.width;
  const sy = (e.clientY - rect.top) / rect.height * els.editor.height;
  const grid = gridMetrics(els.editor);
  const gx = Math.floor((sx - grid.x) / grid.cell) + GRID_MIN;
  const gy = Math.floor((sy - grid.y) / grid.cell) + GRID_MIN;
  if (gx < GRID_MIN || gx > GRID_MAX || gy < GRID_MIN || gy > GRID_MAX) return;

  const parts = currentBlueprint.parts.filter(part => !(part.x === gx && part.y === gy && part.layer === selectedLayer));
  if (!erasing) {
    if (!partFitsLayer(selectedPart, selectedLayer)) {
      setStatus(selectedLayer === 0 ? 'Outer parts need Upper or Lower.' : 'Core parts need the Core layer.');
      return;
    }
    const next = normalizeBlueprint({ name: 'Custom', tagline: 'Custom build', parts: [...parts, { type: selectedPart, x: gx, y: gy, layer: selectedLayer }] });
    if (blueprintStats(next).cost > BUDGET_MAX) {
      setStatus('Budget limit reached.');
      return;
    }
    customBlueprint = next;
  } else {
    customBlueprint = normalizeBlueprint({ name: 'Custom', tagline: 'Custom build', parts });
  }
  currentBlueprint = cloneBlueprint(customBlueprint);
  selectedPremade = -1;
  setStatus('');
  renderAll();
  if (net.connected) pushProfile();
}

function renderAll() {
  drawBlueprint(els.preview.getContext('2d'), currentBlueprint);
  drawEditor();
  updateStatsPanel();
  [...els.premades.children].forEach((btn, i) => btn.classList.toggle('selected', i === selectedPremade));
  [...els.layerTabs.children].forEach((btn, i) => btn.classList.toggle('selected', LAYERS[i].id === selectedLayer));
  [...els.palette.children].forEach((btn, i) => btn.classList.toggle('selected', PALETTE[i] === selectedPart && !erasing));
  $('btn-eraser').classList.toggle('selected', erasing);
}

function drawEditor() {
  const canvas = els.editor;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const grid = gridMetrics(canvas);
  ctx.fillStyle = 'rgba(3,5,11,0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = GRID_MIN; y <= GRID_MAX; y++) {
    for (let x = GRID_MIN; x <= GRID_MAX; x++) {
      const px = grid.x + (x - GRID_MIN) * grid.cell;
      const py = grid.y + (y - GRID_MIN) * grid.cell;
      ctx.strokeStyle = x === 0 || y === 0 ? 'rgba(247,185,85,0.22)' : 'rgba(104,225,253,0.11)';
      ctx.lineWidth = x === 0 || y === 0 ? 1.5 : 1;
      ctx.strokeRect(px, py, grid.cell, grid.cell);
    }
  }

  const parts = currentBlueprint.parts.slice().sort((a, b) => {
    if (a.layer === selectedLayer && b.layer !== selectedLayer) return 1;
    if (a.layer !== selectedLayer && b.layer === selectedLayer) return -1;
    return a.layer - b.layer;
  });
  for (const part of parts) {
    const def = PARTS[part.type];
    const cx = grid.x + (part.x - GRID_MIN + 0.5) * grid.cell;
    const cy = grid.y + (part.y - GRID_MIN + 0.5) * grid.cell;
    ctx.save();
    ctx.translate(cx, cy);
    const scale = grid.cell / CELL * 0.92;
    ctx.scale(scale, scale);
    ctx.globalAlpha = part.layer === selectedLayer ? 1 : 0.27;
    drawPartShape(ctx, def, { ...part, hp: def.hp, maxHp: def.hp });
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(247,185,85,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(grid.x, grid.y, grid.cell * 9, grid.cell * 9);
  ctx.restore();
}

function gridMetrics(canvas) {
  const pad = 18;
  const cell = Math.floor((Math.min(canvas.width, canvas.height) - pad * 2) / 9);
  return {
    cell,
    x: Math.floor((canvas.width - cell * 9) / 2),
    y: Math.floor((canvas.height - cell * 9) / 2),
  };
}

function updateStatsPanel() {
  const stats = blueprintStats(currentBlueprint);
  const validation = validateBlueprint(currentBlueprint);
  $('ship-name').textContent = selectedPremade >= 0 ? currentBlueprint.name : 'Custom';
  $('ship-tagline').textContent = selectedPremade >= 0 ? currentBlueprint.tagline : 'Built in the shipyard.';
  $('stat-budget').textContent = `${stats.cost}/${BUDGET_MAX}`;
  $('stat-hp').textContent = Math.round(stats.hp);
  $('stat-mass').textContent = Math.round(stats.mass);
  $('stat-energy').textContent = Math.round(stats.energy);
  $('stat-speed').textContent = Math.round(stats.speed * 10);
  $('stat-agility').textContent = Math.round(stats.agility * 10);
  $('editor-budget').textContent = `${stats.cost}/${BUDGET_MAX}`;
  $('editor-budget').classList.toggle('good', validation.ok);
  $('editor-budget').classList.toggle('bad', !validation.ok);
  if (validation.ok) els.status.textContent = '';
  else setStatus(validation.issues.join(' '), false);
}

function setStatus(text, force = true) {
  if (force || text) els.status.textContent = text || '';
}

function playableBlueprint() {
  const bp = normalizeBlueprint(currentBlueprint);
  const validation = validateBlueprint(bp);
  if (!validation.ok) {
    setStatus(validation.issues.join(' '));
    return null;
  }
  return bp;
}

function pilotName() {
  const raw = els.pilotName.value.trim();
  return raw || 'Nova';
}

function makeProfile() {
  const bp = playableBlueprint() || cloneBlueprint(PREMADE_BLUEPRINTS[0]);
  return {
    name: pilotName(),
    shipName: bp.name || 'Custom',
    blueprint: bp,
    ready: lobbyReady,
  };
}

function pushProfile() {
  if (!net.connected) return;
  net.setProfile(makeProfile());
}

function joinLobby(code) {
  const bp = playableBlueprint();
  if (!bp) return;
  currentRoomCode = code;
  lobbyReady = false;
  localStorage.setItem('warp-name', pilotName());
  net.join(code);
  pushProfile();
  showOnly(els.lobby);
  updateLobby();
}

function lobbyPlayers() {
  const players = [{ peerId: selfId, ...net.myProfile }];
  for (const [peerId, profile] of net.profiles) players.push({ peerId, ...profile });
  return players.sort((a, b) => a.peerId.localeCompare(b.peerId));
}

function updateLobby() {
  if (!net.connected) return;
  els.lobbyCode.textContent = currentRoomCode || '----';
  const players = lobbyPlayers();
  els.lobbyPlayers.innerHTML = '';
  players.forEach((player, i) => {
    const row = document.createElement('div');
    row.className = 'lobby-player';
    row.style.setProperty('--dot', PLAYER_COLOR(i));
    row.innerHTML = `<i class="dot"></i><b>${escapeHtml(player.name || 'Pilot')}</b><span>${escapeHtml(player.shipName || 'Ship')} ${player.ready ? 'READY' : 'IDLE'}</span>`;
    els.lobbyPlayers.appendChild(row);
  });
  els.btnReady.textContent = lobbyReady ? 'Unready' : 'Ready';
  const allReady = players.length > 0 && players.every(player => player.ready);
  els.btnStart.disabled = !net.isHost || !allReady;
  els.btnStart.classList.toggle('hidden', !net.isHost);
  els.lobbyStatus.textContent = net.isHost ? (allReady ? 'Host lock is green.' : 'Waiting for ready ships.') : 'Waiting for host.';
}

function makeStartConfig() {
  const players = lobbyPlayers();
  if (!players.every(player => player.ready)) {
    els.lobbyStatus.textContent = 'Every pilot must be ready.';
    return null;
  }
  const sorted = players.map((player, i) => ({
    peerId: player.peerId,
    name: player.name || 'Pilot',
    shipName: player.shipName || 'Ship',
    blueprint: player.blueprint || PREMADE_BLUEPRINTS[0],
    color: PLAYER_COLOR(i),
  }));
  return {
    seed: hashString(`${currentRoomCode}-${Date.now()}`),
    players: sorted,
    aiCount: clamp(6 - sorted.length, 1, 5),
  };
}

function startNetworkBattle(config) {
  showBattleUi();
  lastLaunch = null;
  game.startBattle({
    seed: config.seed,
    players: config.players,
    aiCount: config.aiCount,
    localPeerId: selfId,
    net,
  });
}

function showBattleUi() {
  els.home.classList.add('hidden');
  els.lobby.classList.add('hidden');
  els.results.classList.add('hidden');
  els.hud.classList.remove('hidden');
  document.body.classList.add('racing');
}

function showOnly(screen) {
  els.home.classList.add('hidden');
  els.lobby.classList.add('hidden');
  els.results.classList.add('hidden');
  screen.classList.remove('hidden');
  els.hud.classList.add('hidden');
  document.body.classList.remove('racing');
}

function showResults(summary) {
  game.stop();
  els.hud.classList.add('hidden');
  $('result-title').textContent = summary?.title || 'Battle Over';
  $('result-detail').textContent = summary?.detail || '';
  els.btnResultLobby.classList.toggle('hidden', !net.connected);
  showOnly(els.results);
}

function updateHud(hud) {
  if (!hud || els.hud.classList.contains('hidden')) return;
  const hpRatio = clamp(hud.hp / Math.max(1, hud.maxHp), 0, 1);
  const energyRatio = clamp(hud.energy / Math.max(1, hud.maxEnergy), 0, 1);
  $('hp-bar').querySelector('i').style.width = `${hpRatio * 100}%`;
  $('energy-bar').querySelector('i').style.width = `${energyRatio * 100}%`;
  $('hp-text').textContent = `${Math.max(0, Math.round(hud.hp))}/${Math.round(hud.maxHp)}`;
  $('energy-text').textContent = `${Math.round(hud.energy)}/${Math.round(hud.maxEnergy)}`;
  $('speed-text').textContent = `${Math.round(hud.speed)} m/s`;
  $('enemy-text').textContent = `${hud.enemies} targets`;
  updateCommandPanel(hud.controls || {});
  drawRadar(hud);
}

function updateCommandPanel(controls) {
  const active = {
    turn: Math.abs(controls.turn || 0) > 0.08,
    thrust: (controls.thrust || 0) > 0.08,
    brake: (controls.brake || 0) > 0.08,
    primary: !!controls.primary,
    secondary: !!controls.secondary,
    boost: !!controls.boost,
    utility: !!controls.utility,
    quit: !!controls.pause,
  };
  for (const chip of els.commandChips) {
    chip.classList.toggle('on', !!active[chip.dataset.cmd]);
  }
}

function drawRadar(hud) {
  const canvas = $('radar');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.43;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(104,225,253,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#edf7ff';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
  const scale = r / 1100;
  for (const asteroid of hud.asteroids) {
    const x = cx + clamp(asteroid.x * scale, -r, r);
    const y = cy + clamp(asteroid.y * scale, -r, r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    ctx.fillStyle = 'rgba(170,177,189,0.45)';
    ctx.beginPath();
    ctx.arc(x, y, clamp(asteroid.r * scale, 1.4, 5), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const blip of hud.blips) {
    const x = cx + clamp(blip.x * scale, -r, r);
    const y = cy + clamp(blip.y * scale, -r, r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    ctx.globalAlpha = blip.dead ? 0.25 : 1;
    ctx.fillStyle = blip.ai ? '#f7b955' : blip.color;
    ctx.beginPath();
    ctx.arc(x, y, blip.ai ? 3 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function PLAYER_COLOR(index) {
  const colors = ['#68e1fd', '#f7b955', '#ff6b98', '#78e08f', '#b88cff', '#ff8a56'];
  return colors[index % colors.length];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
