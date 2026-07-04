// Point d'entrée : navigation entre écrans, lobby multijoueur, lancement des parties.
import * as THREE from 'three';
import { SABERS, saberById, Fighter } from './fighter.js';
import { Input } from './input.js';
import { AudioFx } from './audio.js';
import { Hud } from './hud.js';
import { Net, selfId } from './net.js';
import { Match } from './game.js';
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
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !sessionStorage.getItem('devNoSw')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ——— singletons ———
const gameCanvas = $('game');
const input = new Input(gameCanvas);
input.bindTouch();
const audio = new AudioFx();
addEventListener('pointerdown', () => audio.ensure(), { capture: true });
const hud = new Hud();
const net = new Net();

let match = null;
let mode = 'solo'; // 'solo' | 'mp'
let lastCfg = null;

const renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
function sizeRenderer() {
  renderer.setSize(innerWidth, innerHeight);
  if (match) match.resize(innerWidth, innerHeight);
}
addEventListener('resize', sizeRenderer);
sizeRenderer();

// ——— aperçu 3D de l'apprenti (sabre tournant) ———
let saberIdx = Math.max(0, SABERS.findIndex(s => s.id === (localStorage.getItem('app-saber') || 'bleu')));
const prevCanvas = $('char-prev');
const prevRenderer = new THREE.WebGLRenderer({ canvas: prevCanvas, antialias: true, alpha: true });
prevRenderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
prevRenderer.setSize(240, 190, false);
const prevScene = new THREE.Scene();
const prevCam = new THREE.PerspectiveCamera(36, 240 / 190, .1, 50);
prevCam.position.set(0, 1.6, 4.2);
prevCam.lookAt(0, 1.0, 0);
prevScene.add(new THREE.HemisphereLight(0xdfeaf5, 0x40342a, 1.6));
const prevSun = new THREE.DirectionalLight(0xfff0d8, 1.6);
prevSun.position.set(3, 5, 4);
prevScene.add(prevSun);
let prevFighter = null;

function setSaber(i) {
  saberIdx = ((i % SABERS.length) + SABERS.length) % SABERS.length;
  const s = SABERS[saberIdx];
  localStorage.setItem('app-saber', s.id);
  $('char-name').textContent = 'Sabre ' + s.name.toLowerCase();
  $('lobby-char-name').textContent = 'Sabre ' + s.name.toLowerCase();
  if (prevFighter) prevScene.remove(prevFighter.group);
  prevFighter = new Fighter(s.id, { kind: 'remote', name: '' });
  prevFighter.invulnT = 0;
  prevFighter.syncVisual();
  prevScene.add(prevFighter.group);
  if (net.connected) sendMyProfile();
}
$('btn-char-prev').onclick = () => { setSaber(saberIdx - 1); audio.play('click'); };
$('btn-char-next').onclick = () => { setSaber(saberIdx + 1); audio.play('click'); };
$('lobby-char-prev').onclick = () => { setSaber(saberIdx - 1); audio.play('click'); };
$('lobby-char-next').onclick = () => { setSaber(saberIdx + 1); audio.play('click'); };

let prevLast = performance.now();
(function spinPreview() {
  requestAnimationFrame(spinPreview);
  if (screens.home.classList.contains('hidden') || !prevFighter) return;
  const now = performance.now();
  const dt = Math.min((now - prevLast) / 1000, .05);
  prevLast = now;
  prevFighter.group.rotation.y += .011;
  prevFighter.updateVisuals(dt, now / 1000);
  prevRenderer.render(prevScene, prevCam);
})();

// ——— nom (modifiable depuis l'accueil ET le lobby) ———
const nameInput = $('inp-name');
const lobbyNameInput = $('lobby-name');
nameInput.value = localStorage.getItem('app-name') || '';
function myName() { return nameInput.value.trim().substring(0, 14) || 'Apprenti'; }

let nameSendTimer = null;
nameInput.addEventListener('input', () => localStorage.setItem('app-name', nameInput.value));
lobbyNameInput.addEventListener('input', () => {
  nameInput.value = lobbyNameInput.value;
  localStorage.setItem('app-name', nameInput.value);
  clearTimeout(nameSendTimer);
  nameSendTimer = setTimeout(() => sendMyProfile(), 300);
});

// ——— lancement / fin de partie ———
function startMatch(cfg) {
  showScreen(null);
  hud.hideResults();
  audio.ensure();
  input.clearEdges();
  if (match) { match.stop(); match = null; }
  lastCfg = cfg;
  match = new Match({
    renderer, input, hud, audio,
    net: mode === 'mp' ? net : null,
    cfg,
    onExit: exitMatch,
  });
  match.resize(innerWidth, innerHeight);
  match.start();
  window.__match = match; // debug
}

function exitMatch() {
  if (match) { match.stop(); match = null; }
  hud.hideResults();
  renderer.clear();
  audio.play('off');
  if (mode === 'mp' && net.connected) {
    myReady = false;
    matchStartedFromLobby = false;
    wireLobbyNet();
    sendMyProfile();
    showScreen('lobby');
    renderLobby();
  } else {
    showScreen('home');
  }
}

function quitMatch() {
  if (match) match.quit();
  else exitMatch();
}

$('btn-quit').onclick = quitMatch;
$('btn-res-home').onclick = quitMatch;
$('btn-res-again').onclick = () => {
  if (mode === 'solo' && lastCfg) {
    startMatch(makeSoloCfg(lastCfg.mode));
  } else {
    quitMatch(); // retour lobby, l'hôte relance
  }
};

function makeSoloCfg(gameMode) {
  const me = SABERS[saberIdx];
  const slots = [{ slot: 0, type: 'local', saber: me.id, name: myName() }];
  if (gameMode === 'duel') {
    const foe = SABERS[(saberIdx + 4) % SABERS.length];
    slots.push({ slot: 1, type: 'ai', saber: foe.id, name: 'Maître Kaal' });
  }
  return { mode: gameMode, seed: (Math.random() * 1e9) | 0, slots };
}

$('btn-solo-duel').onclick = () => { mode = 'solo'; startMatch(makeSoloCfg('duel')); };
$('btn-solo-horde').onclick = () => { mode = 'solo'; startMatch(makeSoloCfg('horde')); };

// ——— multijoueur ———
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const roomInput = $('inp-room');
let myReady = false;
let currentCode = null;
let matchStartedFromLobby = false;

function sendMyProfile() {
  net.setProfile({ name: myName(), saber: SABERS[saberIdx].id, ready: myReady });
  renderLobby();
}

function enterRoom(code) {
  currentCode = code;
  mode = 'mp';
  myReady = false;
  matchStartedFromLobby = false;
  $('home-err').textContent = '';
  $('lobby-code').textContent = code;
  $('lobby-copy').textContent = '👆 touche le code pour le copier';
  lobbyNameInput.value = nameInput.value;
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
  if (code.length !== 4) { $('home-err').textContent = 'Entre le code à 4 caractères de la salle.'; return; }
  enterRoom(code);
};
roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });

$('btn-leave').onclick = () => {
  net.leave();
  showScreen('home');
};

$('lobby-code').onclick = async () => {
  if (!currentCode) return;
  let ok = false;
  try { await navigator.clipboard.writeText(currentCode); ok = true; } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = currentCode;
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch (e2) {}
  }
  $('lobby-copy').textContent = ok ? '✅ Code copié !' : '⚠️ Copie impossible — note-le à la main';
  setTimeout(() => { $('lobby-copy').textContent = '👆 touche le code pour le copier'; }, 2500);
};

$('btn-ready').onclick = () => {
  myReady = !myReady;
  sendMyProfile();
  audio.play(myReady ? 'ignite' : 'click');
};

function lobbyRoster() {
  const rows = [{ id: selfId, name: myName(), saber: SABERS[saberIdx].id, ready: myReady }];
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
    const s = saberById(r.saber);
    const div = document.createElement('div');
    div.className = 'lobby-p';
    const isHost = r.id === net.hostId;
    div.innerHTML = `<span class="dot" style="background:#${s.color.toString(16).padStart(6, '0')}"></span>
      <span class="nm">${escapeHtml(r.name || 'Apprenti')}${r.id === selfId ? ' (toi)' : ''} ${isHost ? '👑' : ''}</span>
      <span class="ch">Sabre ${s.name.toLowerCase()}</span>
      <span class="st ${r.ready ? '' : 'off'}">${r.ready ? 'PRÊT' : '…'}</span>`;
    list.appendChild(div);
  }
  const humans = rows.length;
  const allReady = rows.every(r => r.ready);
  $('lobby-hint').textContent = humans < 2
    ? 'En attente d’adversaires… Seul, un duelliste IA te fera face en duel.'
    : `${humans} apprentis — Duel : chacun pour soi · Horde : coopération contre les droïdes.`;
  const isHost = net.isHost;
  $('btn-start-duel').classList.toggle('hidden', !isHost);
  $('btn-start-horde').classList.toggle('hidden', !isHost);
  $('btn-start-duel').disabled = !allReady;
  $('btn-start-horde').disabled = !allReady;
  $('btn-ready').textContent = myReady ? 'Pas prêt' : 'Prêt !';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hostStart(gameMode) {
  if (!net.isHost) return;
  const rows = lobbyRoster().slice(0, 8);
  const slots = rows.map((r, i) => ({
    slot: i, type: 'human', peerId: r.id,
    saber: r.saber || 'bleu', name: r.name || 'Apprenti',
  }));
  if (gameMode === 'duel' && slots.length < 2) {
    slots.push({ slot: slots.length, type: 'ai', saber: 'rouge', name: 'Maître Kaal' });
  }
  const cfg = { mode: gameMode, seed: (Math.random() * 1e9) | 0, slots };
  net.start(cfg);
  launchMpMatch(cfg);
}
$('btn-start-duel').onclick = () => hostStart('duel');
$('btn-start-horde').onclick = () => hostStart('horde');

function launchMpMatch(cfg) {
  if (matchStartedFromLobby) return;
  matchStartedFromLobby = true;
  for (const s of cfg.slots) {
    if (s.type === 'human') s.type = s.peerId === selfId ? 'local' : 'remote';
  }
  if (!cfg.slots.some(s => s.type === 'local')) {
    $('lobby-hint').textContent = 'Partie pleine, attends la prochaine !';
    matchStartedFromLobby = false;
    return;
  }
  startMatch(cfg);
}

function wireLobbyNet() {
  net.onPeers = () => renderLobby();
  net.onHostChange = () => renderLobby();
  net.onStart = cfg => launchMpMatch(cfg);
}
wireLobbyNet();

// manette : bouton A pour se déclarer prêt dans le lobby
setInterval(() => {
  if (!screens.lobby.classList.contains('hidden') && input.padPressedA()) $('btn-ready').click();
}, 120);

// ——— init ———
setSaber(saberIdx);
showScreen('home');
