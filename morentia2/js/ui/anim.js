// Rejoue le flux d'événements du moteur, un pas à la fois.
//
// Le moteur résout un Crépuscule entier en une fraction de milliseconde. Pour
// que la table reste lisible, l'affichage travaille sur un état retardé : il
// applique les événements l'un après l'autre, avec une pause et une animation
// adaptées à chacun. La partie n'attend jamais l'affichage — c'est l'affichage
// qui rattrape la partie.

import { applyEvent } from '../rules/events.js';
import { cloneState } from '../rules/state.js';
import { PHASE_LABELS, REASON } from '../rules/constants.js';
import { faceOf, placeRecord } from '../rules/state.js';

/** Durée de base, en millisecondes, selon la nature de l'événement. */
const BEATS = {
  phase: 620,
  move: 240,
  influence: 200,
  gold: 150,
  vp: 320,
  control: 240,
  expire: 520,
  placeIn: 380,
  flip: 340,
  attach: 220,
  note: 220,
  create: 120,
  turn: 120,
  sleep: 200,
  reserveToActive: 200,
  own: 0, flag: 0, clearFlags: 0, clearMods: 60, order: 0,
  duration: 200, marketStale: 0, firstPlayer: 0, placeDeckRefill: 200,
  exhaust: 90, gameOver: 600,
};

// Au-delà de ce nombre d'événements en attente, l'affichage accélère pour
// rattraper la partie plutôt que de faire patienter le joueur.
const BACKLOG_RUSH = 60;

export class Replayer {
  constructor({ board, catalog, onLog, onRender, onIdle }) {
    this.board = board;
    this.catalog = catalog;
    this.onLog = onLog;
    this.onRender = onRender;
    this.onIdle = onIdle;
    this.queue = [];
    this.view = null;
    this.running = false;
    this.speed = 1;
    this.seat = 0;
  }

  /** Fixe l'état de départ affiché — avant tout événement. */
  reset(initialState, seat) {
    this.view = cloneState(initialState);
    this.seat = seat;
    this.queue.length = 0;
  }

  /** Ajoute des événements à rejouer et relance la lecture si besoin. */
  push(events) {
    if (!events.length) return;
    this.queue.push(...events);
    if (!this.running) this._run();
  }

  /** Rejoue immédiatement tout ce qui reste, sans animation. */
  flush() {
    while (this.queue.length) this._apply(this.queue.shift());
    this._render();
  }

  get busy() { return this.running || this.queue.length > 0; }

  async _run() {
    this.running = true;
    while (this.queue.length) {
      const event = this.queue.shift();
      this._apply(event);
      const beat = this._beat(event);
      // Un événement sans temps propre (drapeau, appropriation, mise en place)
      // s'enchaîne sans redessiner : seule la fin de la salve est affichée.
      if (beat <= 0) continue;
      this._decorate(event);
      this._render();
      await sleep(beat);
    }
    this._render();
    this.running = false;
    this.onIdle?.();
  }

  _beat(event) {
    if (this.speed === 0) return 0;
    // La mise en place distribue près de cent cartes : elle est posée d'un bloc.
    if (event.reason === REASON.SETUP) return 0;
    if (event.t === 'phase' && event.phase === 'setup') return 0;
    if (event.t === 'create') return 0;
    let base = BEATS[event.t] ?? 150;
    if (event.t === 'move' && event.reason === REASON.DRAW) base = 110;
    const beat = base / this.speed;
    return this.queue.length > BACKLOG_RUSH ? Math.min(beat, 35) : beat;
  }

  _apply(event) {
    try {
      applyEvent(this.view, event);
    } catch (err) {
      console.warn('Événement non rejouable :', event, err);
    }
  }

  _render() {
    this.board.render(this.view, this.seat);
    this.onRender?.(this.view);
  }

  /** Effets visuels attachés à un événement : bulles, bandeaux, journal. */
  _decorate(event) {
    switch (event.t) {
      case 'phase':
        if (event.phase !== 'setup') {
          banner(PHASE_LABELS[event.phase] || event.phase, this.speed);
          this.onLog?.({ kind: 'phase', text: `${PHASE_LABELS[event.phase]} — Jour ${this.view.day}` });
        }
        break;
      case 'influence': {
        const name = faceOf(this.catalog, this.view.cards[event.inst])?.name || '';
        floatOn(event.inst, `${event.delta > 0 ? '+' : ''}${event.delta}`, event.delta > 0 ? 'up' : 'down');
        this.onLog?.({ kind: 'influence', text: `${name} ${event.delta > 0 ? 'gagne' : 'perd'} ${Math.abs(event.delta)} influence.` });
        break;
      }
      case 'gold': {
        const p = this.view.players[event.player];
        floatOnSelector(`.hud-player:nth-child(${event.player + 1})`,
          `${event.delta > 0 ? '+' : ''}${event.delta} ◎`, 'gold');
        this.onLog?.({ kind: 'gold', text: `${p.name} ${event.delta > 0 ? 'gagne' : 'perd'} ${Math.abs(event.delta)} or (${event.pot === 'reserve' ? 'réserve' : 'actif'}).` });
        break;
      }
      case 'vp': {
        const p = this.view.players[event.player];
        floatOnSelector(`.hud-player:nth-child(${event.player + 1})`, `+${event.delta} ✦`, 'up');
        this.onLog?.({ kind: 'vp', text: `${p.name} marque ${event.delta} PV${event.reason ? ` (${event.reason})` : ''}.` });
        break;
      }
      case 'move': {
        const name = faceOf(this.catalog, this.view.cards[event.inst])?.name || 'Une carte';
        if (event.reason === REASON.DESTROY) this.onLog?.({ kind: 'destroy', text: `${name} est détruite.` });
        else if (event.reason === REASON.PLAY) this.onLog?.({ kind: 'play', text: `${name} entre en jeu.` });
        else if (event.reason === REASON.DEPLOY) this.onLog?.({ kind: 'play', text: `${name} est déployée.` });
        else if (event.reason === REASON.SURVIVE) this.onLog?.({ kind: 'survive', text: `${name} survit.` });
        break;
      }
      case 'control': {
        const slot = this.view.slots[event.slot];
        const rec = placeRecord(this.catalog, slot);
        this.onLog?.({
          kind: 'control',
          text: event.player === null
            ? `Personne ne contrôle ${rec?.name || 'le lieu'}.`
            : `${this.view.players[event.player].name} contrôle ${rec?.name || 'le lieu'}.`,
        });
        break;
      }
      case 'expire':
        this.onLog?.({ kind: 'expire', text: `Un lieu expire (${this.view.expiredCount}/${this.view.endTarget}).` });
        break;
      case 'note':
        if (event.text) this.onLog?.({ kind: event.kind || 'info', text: event.text });
        break;
      case 'gameOver':
        this.onLog?.({ kind: 'phase', text: 'Fin de partie.' });
        break;
      default:
        break;
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let bannerTimer = null;
function banner(text, speed) {
  const node = document.getElementById('phase-banner');
  if (!node) return;
  node.textContent = text;
  node.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => node.classList.remove('on'), 900 / Math.max(0.25, speed || 1));
}

function floatOn(instId, text, tone) {
  const node = document.querySelector(`[data-inst="${instId}"]`);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  spawnFloat(rect.left + rect.width / 2, rect.top + rect.height * 0.3, text, tone);
}

function floatOnSelector(selector, text, tone) {
  const node = document.querySelector(selector);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  spawnFloat(rect.left + rect.width / 2, rect.top, text, tone);
}

function spawnFloat(x, y, text, tone) {
  const node = document.createElement('div');
  node.className = `float ${tone}`;
  node.textContent = text;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  document.body.append(node);
  setTimeout(() => node.remove(), 1100);
}
