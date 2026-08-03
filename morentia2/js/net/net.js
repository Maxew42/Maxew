// Multijoueur pair-à-pair.
//
// Le navigateur d'un joueur héberge la partie : lui seul fait tourner le
// moteur. Il diffuse aux autres le flux d'événements, qui suffit à reconstruire
// exactement le même état — c'est le même flux que celui utilisé par
// l'animation locale. Les invités renvoient leurs actions et leurs réponses.
// Aucun serveur de jeu ; la signalisation passe par des relais Nostr publics.
//
// Canaux :
//   hi     ⇄ présentation (nom, faction) dans le salon
//   start  → l'hôte annonce la composition et la graine
//   evt    → l'hôte diffuse des événements de partie
//   ask    → l'hôte pose une question à un joueur précis
//   ans    ← réponse d'un invité
//   act    ← action de Journée d'un invité
//   sync   → état complet (arrivée tardive, reprise)
//   bye    → interruption

import { joinRoom, selfId, getRelaySockets } from 'trystero';

const APP_ID = 'novatix-morentia-v1';

/**
 * Relais Nostr utilisés pour la mise en relation. Trystero en choisit par
 * défaut une poignée dérivée de l'identifiant d'application, et cette liste
 * vieillit : plusieurs des relais retenus ne répondaient plus. On fixe donc
 * une liste explicite de relais publics ouverts en écriture.
 *
 * Ces relais ne voient jamais l'état de la partie : ils ne servent qu'à
 * échanger les descriptions de connexion WebRTC. Si le salon ne s'ouvre plus,
 * remplacer cette liste (ou la surcharger depuis les réglages) suffit.
 */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.mostr.pub',
  'wss://nostr-pub.wellorder.net',
  'wss://offchain.pub',
  'wss://nostr.bitcoiner.social',
];

const RELAY_KEY = 'morentia2.relays.v1';

/** Liste de relais retenue : celle des réglages, sinon celle par défaut. */
export function relayUrls() {
  try {
    const saved = JSON.parse(localStorage.getItem(RELAY_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* réglage illisible : on garde la liste par défaut */ }
  return DEFAULT_RELAYS;
}

export function setRelayUrls(list) {
  try {
    if (list?.length) localStorage.setItem(RELAY_KEY, JSON.stringify(list));
    else localStorage.removeItem(RELAY_KEY);
  } catch { /* stockage indisponible */ }
}

/** Relais effectivement connectés — affiché dans le salon. */
export function relayStatus() {
  try {
    const sockets = getRelaySockets();
    const entries = Object.entries(sockets || {});
    return {
      total: entries.length,
      open: entries.filter(([, s]) => s?.readyState === 1).length,
    };
  } catch {
    return { total: 0, open: 0 };
  }
}

export { selfId };

export class Net {
  constructor() {
    this.room = null;
    this.code = null;
    this.peers = new Set();
    this.profiles = new Map();
    this.me = null;
    // L'hôte est celui qui a choisi « Héberger ». Un invité ne se proclame
    // jamais hôte : sans cela, chacun pourrait se croire l'hôte le temps que
    // les présentations arrivent, et personne ne ferait tourner le moteur.
    this.claimHost = false;
    this.remoteHost = null;

    this.onRoster = () => {};
    this.onStart = () => {};
    this.onEvents = () => {};
    this.onAsk = () => {};
    this.onAnswer = () => {};
    this.onAct = () => {};
    this.onSync = () => {};
    this.onBye = () => {};
  }

  get connected() { return !!this.room; }
  get selfId() { return selfId; }

  /** Identifiant de l'hôte : soi-même si on héberge, sinon le pair qui l'annonce. */
  get hostId() {
    if (this.claimHost) return selfId;
    return this.remoteHost;
  }
  get isHost() { return this.claimHost; }
  /** L'hôte est-il connu ? Un invité ne peut pas commencer avant. */
  get hostKnown() { return !!this.hostId; }

  /** Participants connus, ordre stable chez tout le monde. */
  roster() {
    const ids = [selfId, ...this.peers].sort();
    const host = this.hostId;
    if (host && ids.includes(host)) ids.splice(0, 0, ...ids.splice(ids.indexOf(host), 1));
    return ids.map(id => ({
      id,
      name: id === selfId ? (this.me?.name || 'Joueur') : (this.profiles.get(id)?.name || 'Joueur'),
      faction: id === selfId ? this.me?.faction : this.profiles.get(id)?.faction,
      isHost: id === this.hostId,
    }));
  }

  join(code, profile, { asHost = false } = {}) {
    this.leave();
    this.code = code;
    this.me = profile;
    this.claimHost = !!asHost;
    this.remoteHost = null;
    this.room = joinRoom(
      { appId: APP_ID, relayConfig: { urls: relayUrls(), redundancy: relayUrls().length } },
      `morentia-${code}`);

    const make = name => this.room.makeAction(name);
    const hi = make('hi'), start = make('start'), evt = make('evt');
    const ask = make('ask'), ans = make('ans'), act = make('act');
    const sync = make('sync'), bye = make('bye');
    this._send = {
      hi: hi.send, start: start.send, evt: evt.send, ask: ask.send,
      ans: ans.send, act: act.send, sync: sync.send, bye: bye.send,
    };

    // Trystero passe (données, métadonnées) : l'identifiant du pair est dans
    // les métadonnées, pas en deuxième argument.
    hi.onMessage = (p, meta) => {
      this.profiles.set(meta.peerId, p);
      if (p.isHost && !this.claimHost) this.remoteHost = meta.peerId;
      this.onRoster();
    };
    start.onMessage = cfg => this.onStart(cfg);
    evt.onMessage = payload => this.onEvents(payload.events);
    ask.onMessage = payload => this.onAsk(payload.req);
    ans.onMessage = (payload, meta) => this.onAnswer(payload, meta.peerId);
    act.onMessage = (payload, meta) => this.onAct(payload, meta.peerId);
    sync.onMessage = payload => this.onSync(payload);
    bye.onMessage = payload => this.onBye(payload?.reason);

    this.room.onPeerJoin = id => {
      this.peers.add(id);
      hi.send({ ...this.me, isHost: this.claimHost }, { target: id }).catch(() => {});
      this.onRoster();
    };

    // Le canal de données peut s'ouvrir après l'annonce : tant qu'un pair reste
    // sans nom, on se represente. Sinon la partie démarrerait avec « Joueur ».
    clearInterval(this._reannounce);
    this._reannounce = setInterval(() => {
      const unknown = [...this.peers].filter(id => !this.profiles.has(id));
      if (!unknown.length) return;
      for (const id of unknown) {
        hi.send({ ...this.me, isHost: this.claimHost }, { target: id }).catch(() => {});
      }
    }, 1200);
    this.room.onPeerLeave = id => {
      this.peers.delete(id);
      this.profiles.delete(id);
      if (this.remoteHost === id) this.remoteHost = null;
      this.onRoster();
    };
  }

  announce() { this._fire('hi', { ...this.me, isHost: this.claimHost }); }
  start(cfg) { this._fire('start', cfg); }
  /** Les événements partent en lots : un message par résolution, pas par carte. */
  events(list) { if (list.length) this._fire('evt', { events: list }); }
  ask(req, target) { this._fire('ask', { req }, { target }); }
  answer(value) { this._fire('ans', { value }, { target: this.hostId }); }
  act(action) { this._fire('act', { action }, { target: this.hostId }); }
  sync(payload, target) { this._fire('sync', payload, target ? { target } : undefined); }
  bye(reason) { this._fire('bye', { reason }); }

  _fire(channel, data, opts) {
    if (!this.room || !this._send?.[channel]) return;
    // Un pair qui vient de disparaître ne doit pas interrompre la partie.
    this._send[channel](data, opts).catch(() => {});
  }

  /** Tous les pairs se sont-ils présentés ? La partie attend ce feu vert. */
  get rosterComplete() {
    return [...this.peers].every(id => this.profiles.has(id));
  }

  leave() {
    clearInterval(this._reannounce);
    if (this.room) { try { this.room.leave(); } catch { /* déjà fermé */ } }
    this.room = null;
    this._send = null;
    this.peers.clear();
    this.profiles.clear();
    this.remoteHost = null;
  }
}
