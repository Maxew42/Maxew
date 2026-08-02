// Trois façons d'alimenter la même interface de jeu.
//
//   LocalSession   — le moteur tourne ici, les autres sièges sont des IA.
//   HostSession    — le moteur tourne ici et sert aussi les pairs distants.
//   ClientSession  — aucun moteur : on affiche les vues envoyées par l'hôte.
//
// L'interface (js/play.js) ne connaît que ces méthodes et ces rappels : elle
// ignore complètement si la partie est locale ou en réseau. La fin de partie
// n'a pas de canal spécial — le classement voyage dans le compte rendu de la
// dixième manche, que tout le monde reçoit.

import { Engine, SLOTS } from './engine.js';
import { chooseMove } from './ai.js';
import { sleep } from './util.js';

class BaseSession {
  constructor() {
    this.onView = () => {};       // (view)
    this.onResolve = () => {};    // (payload de manche)
    this.onNotice = () => {};     // (texte, fatal?)
  }
  start() {} put() {} take() {} move() {} random() {} confirm() {}
  advance() {} quit() {}
}

// ══════════════════════════════════════════════════════════════ solo ═════════

export class LocalSession extends BaseSession {
  /** @param {Array<{name:string, kind:string, level?:string}>} players — siège 0 = le joueur */
  constructor(players, seed) {
    super();
    this.e = new Engine(players.map((p, i) => ({ id: 'l' + i, ...p })), seed);
    this.me = 0;
    this.busy = false;
  }

  get mySeat() { return this.me; }

  start() { this.emit(); }
  emit() { this.onView(this.e.viewFor(this.me)); }

  put(slot, iid) { if (this.e.put(this.me, slot, iid)) this.emit(); }
  take(slot) { if (this.e.take(this.me, slot)) this.emit(); }
  move(from, to) { if (this.e.move(this.me, from, to)) this.emit(); }

  random() {
    const mv = chooseMove(this.e, this.me);
    for (const s of SLOTS) this.e.put(this.me, s, mv[s].iid);
    this.emit();
  }

  async confirm() {
    if (this.busy || !this.e.confirm(this.me)) return;
    this.busy = true;
    this.emit();
    // Les IA réfléchissent une fraction de seconde, pour qu'on les voie arriver.
    for (let i = 0; i < this.e.n; i++) {
      if (i === this.me) continue;
      await sleep(160 + Math.random() * 300);
      const mv = chooseMove(this.e, i);
      for (const s of SLOTS) this.e.put(i, s, mv[s].iid);
      this.e.confirm(i);
      this.emit();
    }
    this.busy = false;
    this.onResolve(this.e.resolve());
  }

  advance() { this.emit(); }
}

// ══════════════════════════════════════════════════════════ hôte P2P ═════════

export class HostSession extends BaseSession {
  /**
   * @param {import('./net.js').Net} net
   * @param {Array<{id:string, name:string}>} roster  ordre des sièges, hôte inclus
   */
  constructor(net, roster, seed) {
    super();
    this.net = net;
    this.roster = roster;
    this.e = new Engine(roster.map(p => ({ ...p, kind: 'human' })), seed);
    this.me = roster.findIndex(p => p.id === net.selfId);

    net.onPlace = (msg, peerId) => this.remotePlace(peerId, msg);
    net.onPeerLeave = id => {
      const gone = this.roster.find(p => p.id === id);
      if (!gone || this.e.over) return;
      this.net.abort(`${gone.name} a quitté la partie.`);
      this.onNotice(`${gone.name} a quitté la partie — tournoi interrompu.`, true);
    };
  }

  get mySeat() { return this.me; }

  start() {
    this.net.start({ seed: this.e.seed, roster: this.roster });
    this.push();
  }

  /** Envoie à chacun sa vue : l'hôte affiche la sienne, les pairs reçoivent la leur. */
  push() {
    this.onView(this.e.viewFor(this.me));
    this.roster.forEach((p, i) => {
      if (i !== this.me) this.net.sendView(this.e.viewFor(i), p.id);
    });
  }

  put(slot, iid) { if (this.e.put(this.me, slot, iid)) this.push(); }
  take(slot) { if (this.e.take(this.me, slot)) this.push(); }
  move(from, to) { if (this.e.move(this.me, from, to)) this.push(); }

  random() {
    const mv = chooseMove(this.e, this.me);
    for (const s of SLOTS) this.e.put(this.me, s, mv[s].iid);
    this.push();
  }

  confirm() {
    if (!this.e.confirm(this.me)) return;
    this.push();
    this.tryResolve();
  }

  /** Un pair annonce ses trois cartes. L'hôte revalide tout. */
  remotePlace(peerId, msg) {
    const seat = this.roster.findIndex(p => p.id === peerId);
    if (seat < 0 || !this.e.editable(seat)) return;
    for (const s of SLOTS) {
      if (!this.e.put(seat, s, msg?.[s])) {
        this.onNotice(`Placement refusé pour ${this.roster[seat].name}.`);
        return;
      }
    }
    if (!this.e.confirm(seat)) return;
    this.push();
    this.tryResolve();
  }

  tryResolve() {
    if (!this.e.allReady()) return;
    const payload = this.e.resolve();
    this.net.resolve(payload);
    this.onResolve(payload);
  }

  advance() { if (!this.e.over) this.push(); }

  quit() {
    if (!this.e.over) this.net.abort("L'hôte a quitté la partie.");
    this.net.leave();
  }
}

// ═════════════════════════════════════════════════════════ pair P2P ══════════

export class ClientSession extends BaseSession {
  constructor(net) {
    super();
    this.net = net;
    this.view = null;
    this.local = { left: null, arena: null, right: null };

    net.onView = v => {
      // On garde le placement en cours : l'hôte pousse une vue chaque fois
      // qu'un autre joueur valide, et cela ne doit pas défaire notre travail.
      const fresh = !this.view || v.round !== this.view.round;
      this.view = v;
      if (fresh || !v.editable) this.local = { ...v.placed };
      this.onView(this.viewOut());
    };
    net.onResolve = p => this.onResolve(p);
    net.onAbort = reason => this.onNotice(reason || 'Partie interrompue.', true);
    net.onHostGone = () => this.onNotice("L'hôte a quitté : tournoi interrompu.", true);
  }

  get mySeat() { return this.view ? this.view.mySeat : 0; }

  /** Vue affichable : la main moins ce qu'on a posé en local. */
  viewOut() {
    const v = this.view;
    const placedIids = new Set(SLOTS.map(s => this.local[s]?.iid).filter(Boolean));
    return {
      ...v,
      hand: v.hand.filter(c => !placedIids.has(c.iid)),
      placed: { ...this.local },
      filled: SLOTS.every(s => !!this.local[s]),
    };
  }

  put(slot, iid) {
    const v = this.view;
    if (!v?.editable) return;
    const card = v.hand.find(c => c.iid === iid);
    if (!card) return;
    for (const s of SLOTS) if (this.local[s]?.iid === iid) this.local[s] = null;
    this.local[slot] = card;
    this.onView(this.viewOut());
  }

  take(slot) {
    if (!this.view?.editable) return;
    this.local[slot] = null;
    this.onView(this.viewOut());
  }

  move(from, to) {
    if (!this.view?.editable || !this.local[from]) return;
    [this.local[from], this.local[to]] = [this.local[to], this.local[from]];
    this.onView(this.viewOut());
  }

  random() {
    const v = this.view;
    if (!v?.editable) return;
    const pool = v.hand.slice();
    for (const s of SLOTS) {
      if (!pool.length) break;
      this.local[s] = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    }
    this.onView(this.viewOut());
  }

  confirm() {
    const out = this.viewOut();
    if (!out.filled || !this.view.editable) return;
    this.net.place({
      left: this.local.left.iid,
      arena: this.local.arena.iid,
      right: this.local.right.iid,
    });
    this.view = { ...this.view, editable: false };  // verrou optimiste
    this.onView(this.viewOut());
  }

  advance() { /* l'hôte enverra la vue de la manche suivante */ }

  quit() { this.net.leave(); }
}
