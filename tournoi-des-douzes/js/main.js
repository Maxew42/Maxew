// Assemblage : écrans, réglages, salon pair-à-pair, et branchement de
// l'interface de jeu sur la bonne session.

import { CARDS, CARD_NUMBERS, TIMINGS, cardImg, fullName } from './cards.js';
import { Play } from './play.js';
import { LocalSession, HostSession, ClientSession } from './session.js';
import { Net } from './net.js';
import { $, el, roomCode, NAMES, shuffle, plural } from './util.js';

const MAX_PLAYERS = 6;

// ── Écrans ────────────────────────────────────────────────────────────────────

let previous = 'menu';
function show(name) {
  const cur = document.querySelector('.screen.on');
  if (cur && cur.id !== 'screen-' + name) previous = cur.id.replace('screen-', '');
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === 'screen-' + name);
  document.querySelector('.screen.on .sheet')?.scrollTo(0, 0);
}

document.addEventListener('click', e => {
  const go = e.target.closest?.('[data-go]')?.dataset.go;
  if (!go) return;
  if (go === 'back') show(previous === 'rules' ? 'menu' : previous);
  else show(go);
});

// ── Notification passagère ────────────────────────────────────────────────────

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3400);
}

// ── Zoom sur une carte ────────────────────────────────────────────────────────

const veil = $('#zoom-veil');
function openZoom(n) {
  const c = CARDS[n];
  $('#zoom-img').src = cardImg(n);
  $('#zoom-img').alt = fullName(n);
  const when = TIMINGS.find(t => t.key === c.timing);
  $('#zoom-info').innerHTML = `
    <h2>${c.name}</h2>
    <div class="epi">${c.epithet || '&nbsp;'} — force de base <b>${c.n}</b></div>
    <div class="fx">${c.effect}</div>
    <div class="when">${when ? when.label : ''}</div>`;
  veil.classList.add('on');
}
veil.addEventListener('click', () => veil.classList.remove('on'));
addEventListener('keydown', e => { if (e.key === 'Escape') veil.classList.remove('on'); });

// ── Écran des règles ──────────────────────────────────────────────────────────

{
  const list = $('#rules-timings');
  for (const t of TIMINGS) {
    const li = el('li');
    li.append(el('b', null, t.label), document.createTextNode(
      ' — ' + t.cards.map(n => `${CARDS[n].name} (${n})`).join(', ')));
    list.append(li);
  }
  const gal = $('#rules-gallery');
  for (const n of CARD_NUMBERS) {
    const b = el('button', 'gal-item');
    b.type = 'button';
    const img = document.createElement('img');
    img.src = cardImg(n); img.alt = fullName(n); img.loading = 'lazy';
    b.append(img, el('b', null, `${CARDS[n].name} (${n})`), el('span', null, CARDS[n].epithet || ''));
    b.addEventListener('click', () => openZoom(n));
    gal.append(b);
  }
}

// ── Réglages du solo ──────────────────────────────────────────────────────────

const settings = {
  name: localStorage.getItem('tdd.name') || '',
  count: +(localStorage.getItem('tdd.count') || 4),
  level: localStorage.getItem('tdd.level') || 'normal',
};
$('#solo-name').value = settings.name;
$('#mp-name').value = settings.name;

function segment(host, items, current, onPick) {
  host.textContent = '';
  for (const it of items) {
    const b = el('button', null, it.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(it.value === current()));
    b.addEventListener('click', () => {
      onPick(it.value);
      for (const other of host.children) other.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
    });
    host.append(b);
  }
}
segment($('#solo-count'), [2, 3, 4, 5, 6].map(v => ({ value: v, label: String(v) })),
  () => settings.count, v => { settings.count = v; localStorage.setItem('tdd.count', v); });
segment($('#solo-level'), [
  { value: 'easy', label: 'Écuyer' },
  { value: 'normal', label: 'Chevalier' },
  { value: 'hard', label: 'Champion' },
], () => settings.level, v => { settings.level = v; localStorage.setItem('tdd.level', v); });

const myName = input => {
  const v = ($(input).value || '').trim().slice(0, 14);
  settings.name = v;
  localStorage.setItem('tdd.name', v);
  return v || 'Vous';
};

// ── Interface de jeu ──────────────────────────────────────────────────────────

const play = new Play({
  screen: $('#screen-game'),
  board: $('#board'),
  boardWrap: $('#board-wrap'),
  hand: $('#hand'),
  handWrap: $('#hand-wrap'),
  ready: $('#btn-ready'),
  auto: $('#btn-auto'),
  skip: $('#narr-skip'),
  prev: $('#narr-prev'),
  next: $('#narr-next'),
  playPause: $('#narr-play'),
  pos: $('#narr-pos'),
  quit: $('#btn-quit'),
  narr: $('#narr'),
  narrText: $('#narr-text'),
  round: $('#hud-round'),
  hint: $('#hud-hint'),
}, {
  onQuit: fatal => quitGame(fatal),
  onEnd: payload => showEnd(payload),
  onZoom: openZoom,
  toast,
});

$('#btn-rules').addEventListener('click', () => show('rules'));

let mode = null;   // 'solo' | 'host' | 'client'

function startSolo() {
  const name = myName('#solo-name');
  const bots = shuffle(NAMES.slice()).slice(0, settings.count - 1);
  const players = [
    { name, kind: 'human' },
    ...bots.map(n => ({ name: n, kind: 'ai', level: settings.level })),
  ];
  mode = 'solo';
  play.attach(new LocalSession(players));
  show('game');
}
$('#solo-start').addEventListener('click', startSolo);

function quitGame(fatal = false) {
  if (!fatal && !confirm('Quitter la partie en cours ?')) return;
  play.session?.quit();
  play.detach();
  if (mode !== 'solo') { net.leave(); resetLobby(); }
  mode = null;
  show('menu');
}

// ── Fin de partie ─────────────────────────────────────────────────────────────

function showEnd(payload) {
  // Le classement est déjà trié : trophées, puis la plus faible force de base
  // sur les trois dernières cartes jouées. Il n'y a vraie égalité que si ce
  // second critère ne départage pas non plus.
  const rank = payload.ranking || [];
  const first = rank[0];
  const champs = rank.filter(r => r.trophies === first?.trophies && r.tiebreak === first?.tiebreak);
  const mine = play.session?.mySeat ?? 0;
  const won = champs.some(r => r.seat === mine);
  const tied = rank.filter(r => r.trophies === first?.trophies).length > champs.length;

  $('#end-title').textContent = won ? 'Vous remportez le tournoi !' : 'Fin du tournoi';
  $('#end-sub').textContent = champs.length > 1
    ? `${champs.map(c => c.name).join(' et ')} finissent à égalité parfaite.`
    : `${first?.name || '—'} l'emporte avec ${plural(first?.trophies ?? 0, 'trophée', 'trophées')}`
      + (tied ? ', départagé sur la force de ses trois dernières cartes.' : '.');

  const list = $('#end-podium');
  list.textContent = '';
  rank.forEach((r, i) => {
    const li = el('li', i === 0 ? 'first' : '');
    const nm = el('span', 'nm');
    nm.append(
      document.createTextNode(r.name + (r.seat === mine ? ' (vous)' : '')),
      el('small', null, ` · dernières forces jouées : ${r.tiebreak}`),
    );
    li.append(el('span', 'rk', String(i + 1)), nm, el('span', 'tr', `${r.trophies} 🏆`));
    list.append(li);
  });

  play.detach();
  show('end');
}

$('#end-again').addEventListener('click', () => {
  if (mode === 'solo') startSolo();
  else { net.leave(); resetLobby(); show('mp'); }
});

// ── Salon pair-à-pair ─────────────────────────────────────────────────────────

const net = new Net();
let lobbyOpen = false;

function resetLobby() {
  lobbyOpen = false;
  $('#mp-join').hidden = false;
  $('#mp-lobby').hidden = true;
  net.onPeers = net.onStart = net.onAbort = net.onHostGone = net.onPeerLeave = () => {};
}

function joinRoom(code) {
  const name = myName('#mp-name');
  net.join(code, { name });
  lobbyOpen = true;
  $('#mp-join').hidden = true;
  $('#mp-lobby').hidden = false;
  $('#mp-shown-code').textContent = code;
  net.onPeers = renderLobby;
  net.onPeerLeave = () => renderLobby();
  net.onHostGone = () => { if (lobbyOpen) toast("L'hôte a quitté le salon."); };
  net.onStart = cfg => beginAsClient(cfg);
  net.onAbort = reason => { if (lobbyOpen) toast(reason || 'Salon fermé.'); };
  renderLobby();
}

function renderLobby() {
  if (!lobbyOpen) return;
  const all = net.roster();
  const seated = all.slice(0, MAX_PLAYERS);
  const list = $('#mp-roster');
  list.textContent = '';
  all.forEach((p, i) => {
    const li = el('li');
    const dot = el('span', 'dot');
    dot.style.background = i < MAX_PLAYERS ? hueFor(i) : '#555';
    li.append(dot, el('span', null, p.name + (p.id === net.selfId ? ' (vous)' : '')));
    const tags = [];
    if (p.id === net.hostId) tags.push('hôte');
    if (i >= MAX_PLAYERS) tags.push('salon complet');
    li.append(el('span', 'tag', tags.join(' · ')));
    list.append(li);
  });
  const enough = seated.length >= 2;
  $('#mp-start').disabled = !(net.isHost && enough);
  $('#mp-status').textContent = net.isHost
    ? (enough ? `${seated.length} joueurs assis — à vous de lancer.` : 'Il faut au moins deux joueurs.')
    : `En attente de l'hôte (${seated.length} joueur${seated.length > 1 ? 's' : ''} au salon).`;
}

const LOBBY_HUES = ['#f0c14b', '#5aa8e6', '#57b87a', '#e0714d', '#b07bd8', '#d95f8e'];
const hueFor = i => LOBBY_HUES[i % LOBBY_HUES.length];

$('#mp-create').addEventListener('click', () => {
  const code = roomCode();
  $('#mp-code').value = code;
  joinRoom(code);
});

$('#mp-go').addEventListener('click', () => {
  const code = ($('#mp-code').value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) { toast('Entrez un code de salon valide.'); return; }
  joinRoom(code);
});
$('#mp-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

$('#mp-leave').addEventListener('click', () => { net.leave(); resetLobby(); });

$('#mp-start').addEventListener('click', () => {
  const seated = net.roster().slice(0, MAX_PLAYERS);
  if (!net.isHost || seated.length < 2) return;
  lobbyOpen = false;
  mode = 'host';
  net.onStart = () => {};
  play.attach(new HostSession(net, seated));
  show('game');
});

function beginAsClient(cfg) {
  // Synchrone : l'hôte enchaîne aussitôt avec les vues privées, et le rappel
  // onView doit déjà être branché quand elles arrivent.
  const seated = cfg?.roster || [];
  if (!seated.some(p => p.id === net.selfId)) {
    toast('Le salon était complet : vous n\'êtes pas de ce tournoi.');
    return;
  }
  lobbyOpen = false;
  mode = 'client';
  play.attach(new ClientSession(net));
  show('game');
}

resetLobby();

// ── Service worker (jeu hors-ligne en solo) ───────────────────────────────────

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
