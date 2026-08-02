// Multijoueur pair-à-pair : WebRTC via Trystero, signalisation par relais
// Nostr publics. Aucun serveur de jeu — le navigateur d'un joueur fait l'hôte
// et détient le seul état autoritaire.
//
// L'hôte est le pair au plus petit identifiant, recalculé si quelqu'un part.
// Les canaux :
//   prof   ⇄  présentation (nom) dans le salon
//   start  →  l'hôte annonce la composition des sièges
//   view   →  l'hôte envoie à un pair sa vue privée (main comprise)
//   place  ←  un pair annonce ses trois cartes
//   res    →  l'hôte diffuse le compte rendu d'une manche
//   stop   →  interruption (départ, abandon)

import { joinRoom, selfId } from 'trystero';

const APP_ID = 'novatix-tournoi-des-douzes-v1';

export { selfId };

export class Net {
  constructor() {
    this.room = null;
    this.code = null;
    this.peers = new Set();
    this.profiles = new Map();   // peerId → {name}
    this.myProfile = null;

    // Rappels, réassignés selon la phase (salon puis partie).
    this.onPeers = () => {};
    this.onStart = () => {};
    this.onView = () => {};
    this.onPlace = () => {};
    this.onResolve = () => {};
    this.onAbort = () => {};
    this.onPeerLeave = () => {};
    this.onHostGone = () => {};
  }

  get connected() { return !!this.room; }
  get selfId() { return selfId; }

  /** L'hôte est le plus petit identifiant présent : même verdict chez tous. */
  get hostId() {
    return [selfId, ...this.peers].sort()[0];
  }
  get isHost() { return this.hostId === selfId; }

  /** Tous les participants connus, triés — l'ordre des sièges de la partie. */
  roster() {
    return [selfId, ...this.peers].sort().map(id => ({
      id,
      name: id === selfId
        ? (this.myProfile?.name || 'Hôte')
        : (this.profiles.get(id)?.name || 'Chevalier'),
    }));
  }

  join(code, profile) {
    this.leave();
    this.code = code;
    this.myProfile = profile;
    this.room = joinRoom({ appId: APP_ID }, 'tournoi-' + code);

    const act = name => this.room.makeAction(name);
    const prof = act('prof'), start = act('start'), view = act('view');
    const place = act('place'), res = act('res'), stop = act('stop');
    this._send = {
      prof: prof.send, start: start.send, view: view.send,
      place: place.send, res: res.send, stop: stop.send,
    };

    prof.onMessage = (p, m) => { this.profiles.set(m.peerId, p); this.onPeers(); };
    start.onMessage = cfg => this.onStart(cfg);
    view.onMessage = v => this.onView(v);
    place.onMessage = (msg, m) => this.onPlace(msg, m.peerId);
    res.onMessage = p => this.onResolve(p);
    stop.onMessage = msg => this.onAbort(msg?.reason);

    this.room.onPeerJoin = id => {
      this.peers.add(id);
      // Se présenter au nouvel arrivant.
      if (this.myProfile) prof.send(this.myProfile, { target: id }).catch(() => {});
      this.onPeers();
    };
    this.room.onPeerLeave = id => {
      const wasHost = this.hostId;
      this.peers.delete(id);
      this.profiles.delete(id);
      this.onPeerLeave(id);
      if (id === wasHost) this.onHostGone();
      this.onPeers();
    };
  }

  setProfile(p) {
    this.myProfile = p;
    this._fire('prof', p);
  }

  start(cfg) { this._fire('start', cfg); }
  sendView(v, target) { this._fire('view', v, { target }); }
  place(msg) { this._fire('place', msg, { target: this.hostId }); }
  resolve(payload) { this._fire('res', payload); }
  abort(reason) { this._fire('stop', { reason }); }

  _fire(chan, data, opts) {
    if (!this.room || !this._send?.[chan]) return;
    // Les envois échouent silencieusement si un pair vient de disparaître :
    // la perte d'un message ne doit pas casser la partie des autres.
    this._send[chan](data, opts).catch(() => {});
  }

  leave() {
    if (this.room) { try { this.room.leave(); } catch { /* déjà fermé */ } }
    this.room = null;
    this._send = null;
    this.peers.clear();
    this.profiles.clear();
  }
}
