// Point d'entrée : navigation entre écrans, lobby multijoueur, lancement des courses.
import * as THREE from 'three';
import { CHARACTERS, charById, buildCarMesh } from './characters.js';
import { Input } from './input.js';
import { AudioFx } from './audio.js';
import { Hud } from './hud.js';
import { Net, selfId } from './net.js';
import { Race } from './game.js';
import { isTouchDevice } from './util.js';

const $ = id => document.getElementById(id);
const screens = { home: $('screen-home'), lobby: $('screen-lobby'), results: $('screen-results') };
function showScreen(name) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
  if (!name) for (const el of Object.values(screens)) el.classList.add('hidden');
}

// ——— détection tactile / PWA ———
if (isTouchDevice()) document.body.classList.add('touch');
addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ——— singletons ———
const input = new Input();
input.bindTouch();
const audio = new AudioFx();
addEventListener('pointerdown', () => audio.ensure(), { capture: true });
const hud = new Hud();
const net = new Net();

let race = null;
let mode = 'solo'; // 'solo' | 'mp'

const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
function sizeRenderer() {
  renderer.setSize(innerWidth, innerHeight);
  if (race) race.resize(innerWidth, innerHeight);
}
addEventListener('resize', sizeRenderer);
sizeRenderer();

// ——— sélection du personnage (aperçu 3D tournant) ———
let charIdx = Math.max(0, CHARACTERS.findIndex(c => c.id === (localStorage.getItem('la-char') || 'shoe')));
const prevCanvas = $('char-prev');
const prevRenderer = new THREE.WebGLRenderer({ canvas: prevCanvas, antialias: true, alpha: true });
prevRenderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
prevRenderer.setSize(240, 150, false);
const prevScene = new THREE.Scene();
const prevCam = new THREE.PerspectiveCamera(38, 240 / 150, .1, 50);
prevCam.position.set(0, 3.2, 9);
prevCam.lookAt(0, 1, 0);
prevScene.add(new THREE.HemisphereLight(0xffe0b0, 0x40342a, 1.5));
const prevSun = new THREE.DirectionalLight(0xffd0a0, 1.6);
prevSun.position.set(4, 6, 3);
prevScene.add(prevSun);
let prevCar = null;

function setChar(i) {
  charIdx = ((i % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
  const c = CHARACTERS[charIdx];
  localStorage.setItem('la-char', c.id);
  $('char-name').textContent = c.name;
  $('char-tag').textContent = c.tag;
  $('st-speed').style.width = c.stats.speed * 100 + '%';
  $('st-accel').style.width = c.stats.accel * 100 + '%';
  $('st-turn').style.width = c.stats.turn * 100 + '%';
  $('st-weight').style.width = c.stats.weight * 100 + '%';
  if (prevCar) prevScene.remove(prevCar);
  prevCar = buildCarMesh(c.id);
  prevScene.add(prevCar);
  if (net.connected) sendMyProfile();
}
$('btn-char-prev').onclick = () => { setChar(charIdx - 1); audio.play('roll'); };
$('btn-char-next').onclick = () => { setChar(charIdx + 1); audio.play('roll'); };

(function spinPreview() {
  requestAnimationFrame(spinPreview);
  if (screens.home.classList.contains('hidden') || !prevCar) return;
  prevCar.rotation.y += .012;
  prevRenderer.render(prevScene, prevCam);
})();

// ——— nom du pilote ———
const nameInput = $('inp-name');
nameInput.value = localStorage.getItem('la-name') || '';
nameInput.addEventListener('input', () => localStorage.setItem('la-name', nameInput.value));
function myName() { return nameInput.value.trim().substring(0, 14) || 'Pilote'; }

// ——— construction des slots de course ———
function altTint(color, n) {
  // variantes de couleur pour les personnages en double
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const mix = [[130, 130, 140], [60, 90, 60], [140, 90, 40]][n % 3];
  const f = .55;
  return (Math.round(r * f + mix[0] * (1 - f)) << 16) |
         (Math.round(g * f + mix[1] * (1 - f)) << 8) |
         Math.round(b * f + mix[2] * (1 - f));
}

function fillWithAi(slots) {
  const used = {};
  for (const s of slots) used[s.charId] = (used[s.charId] || 0) + 1;
  let slot = slots.length;
  const pool = [...CHARACTERS].sort(() => Math.random() - .5);
  while (slots.length < 8) {
    let c = pool.find(x => !used[x.id]) || pool[slot % pool.length];
    const dup = used[c.id] || 0;
    used[c.id] = dup + 1;
    slots.push({
      slot, type: 'ai', charId: c.id,
      name: dup ? `${c.name.split(' ')[0]} ${['II', 'III', 'IV'][dup - 1] || 'X'}` : c.name,
      tint: dup ? altTint(c.color, dup - 1) : null,
    });
    slot++;
  }
  return slots;
}

// ——— lancement / fin de course ———
function startRace(cfg) {
  showScreen(null);
  hud.hideResults();
  audio.ensure();
  input.clearEdges();
  if (race) { race.stop(); race = null; }
  race = new Race({
    renderer, input, hud, audio,
    net: mode === 'mp' ? net : null,
    cfg,
    onExit: exitRace,
  });
  race.resize(innerWidth, innerHeight);
  race.start();
  window.__race = race; // pratique pour le debug
}

function exitRace() {
  if (race) { race.stop(); race = null; }
  hud.hideResults();
  renderer.clear();
  if (mode === 'mp' && net.connected) {
    myReady = false;
    raceStartedFromLobby = false;
    wireLobbyNet(); // la course a détourné les callbacks réseau
    sendMyProfile();
    showScreen('lobby');
    renderLobby();
  } else {
    showScreen('home');
  }
}

// quitter proprement (prévient les autres joueurs en multi)
function quitRace() {
  if (race) race._quit();
  else exitRace();
}

$('btn-quit').onclick = quitRace;
$('btn-res-home').onclick = quitRace;
$('btn-res-again').onclick = () => {
  if (mode === 'solo') {
    startRace(makeSoloCfg());
  } else {
    quitRace(); // retour lobby, l'hôte relance
  }
};

function makeSoloCfg() {
  const me = CHARACTERS[charIdx];
  const slots = fillWithAi([{ slot: 0, type: 'local', charId: me.id, name: myName() }]);
  return { seed: (Math.random() * 1e9) | 0, slots, localSlot: 0 };
}

$('btn-solo').onclick = () => {
  mode = 'solo';
  startRace(makeSoloCfg());
};

// ——— multijoueur ———
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const roomInput = $('inp-room');
let myReady = false;
let currentCode = null;
let raceStartedFromLobby = false;

function sendMyProfile() {
  net.setProfile({ name: myName(), charId: CHARACTERS[charIdx].id, ready: myReady });
  renderLobby();
}

function enterRoom(code) {
  currentCode = code;
  mode = 'mp';
  myReady = false;
  raceStartedFromLobby = false;
  $('home-err').textContent = '';
  $('lobby-code').textContent = code;
  wireLobbyNet();
  net.join(code);
  sendMyProfile();
  showScreen('lobby');
  renderLobby();
}

$('btn-create').onclick = () => {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  roomInput.value = code;
  enterRoom(code);
};

$('btn-join').onclick = () => {
  const code = roomInput.value.trim().toUpperCase();
  if (code.length !== 4) { $('home-err').textContent = 'Entre le code à 4 caractères du salon.'; return; }
  enterRoom(code);
};
roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });

$('btn-leave').onclick = () => {
  net.leave();
  showScreen('home');
};

$('btn-ready').onclick = () => {
  myReady = !myReady;
  sendMyProfile();
  audio.play(myReady ? 'got' : 'roll');
};

function lobbyRoster() {
  // moi + pairs, tri stable par id pour que tout le monde voie le même ordre
  const rows = [{ id: selfId, ...{ name: myName(), charId: CHARACTERS[charIdx].id, ready: myReady } }];
  for (const [id, p] of net.profiles) rows.push({ id, ...p });
  rows.sort((a, b) => a.id < b.id ? -1 : 1);
  return rows;
}

function renderLobby() {
  if (screens.lobby.classList.contains('hidden')) return;
  const list = $('lobby-players');
  const rows = lobbyRoster();
  list.innerHTML = '';
  for (const r of rows) {
    const c = charById(r.charId);
    const div = document.createElement('div');
    div.className = 'lobby-p';
    const isHost = r.id === net.hostId;
    div.innerHTML = `<span class="dot" style="background:#${c.color.toString(16).padStart(6, '0')}"></span>
      <span class="nm">${escapeHtml(r.name || 'Pilote')}${r.id === selfId ? ' (toi)' : ''} ${isHost ? '👑' : ''}</span>
      <span class="ch">${c.name}</span>
      <span class="st ${r.ready ? '' : 'off'}">${r.ready ? 'PRÊT' : '…'}</span>`;
    list.appendChild(div);
  }
  const humans = rows.length;
  const allReady = rows.every(r => r.ready);
  $('lobby-hint').textContent = humans < 2
    ? 'En attente de joueurs… Les places vides seront prises par des IA (8 pilotes au départ).'
    : `${humans} joueur${humans > 1 ? 's' : ''} — les ${8 - Math.min(humans, 8)} places restantes seront des IA.`;
  const startBtn = $('btn-start');
  startBtn.classList.toggle('hidden', !net.isHost);
  startBtn.disabled = !allReady;
  startBtn.textContent = allReady ? '🏁 Lancer la course' : 'En attente des PRÊT…';
  $('btn-ready').textContent = myReady ? 'Pas prêt' : 'Prêt !';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('btn-start').onclick = () => {
  if (!net.isHost) return;
  const rows = lobbyRoster().slice(0, 8);
  const slots = rows.map((r, i) => ({
    slot: i, type: 'human', peerId: r.id,
    charId: r.charId || 'shoe', name: r.name || 'Pilote',
  }));
  fillWithAi(slots);
  const cfg = { seed: (Math.random() * 1e9) | 0, slots };
  net.start(cfg);
  launchMpRace(cfg);
};

function launchMpRace(cfg) {
  if (raceStartedFromLobby) return;
  raceStartedFromLobby = true;
  // résout les types selon qui je suis
  for (const s of cfg.slots) {
    if (s.type === 'human') s.type = s.peerId === selfId ? 'local' : 'remote';
  }
  if (!cfg.slots.some(s => s.type === 'local')) {
    // je suis arrivé trop tard (course pleine) — je reste au lobby
    $('lobby-hint').textContent = 'Course pleine, attends la prochaine !';
    raceStartedFromLobby = false;
    return;
  }
  startRace(cfg);
}

function wireLobbyNet() {
  net.onPeers = () => renderLobby();
  net.onHostChange = () => renderLobby();
  net.onStart = cfg => launchMpRace(cfg);
}
wireLobbyNet();

// manette : bouton A pour se déclarer prêt dans le lobby
setInterval(() => {
  if (!screens.lobby.classList.contains('hidden') && input.padPressedA()) $('btn-ready').click();
}, 120);

// ——— init ———
setChar(charIdx);
showScreen('home');
