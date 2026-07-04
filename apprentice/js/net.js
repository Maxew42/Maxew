// Multijoueur P2P sans serveur : Trystero (WebRTC, signalisation via relais Nostr publics).
// L'« hôte » est le pair au plus petit id — déterministe et recalculé si quelqu'un part.
// Autorité : chaque client simule SON combattant et s'inflige lui-même les dégâts
// (victime-autoritaire) ; l'hôte simule droïdes et duellistes IA.
import { joinRoom, selfId } from 'trystero';

const APP_ID = 'novatix-the-apprentice-v1';

export { selfId };

export class Net {
  constructor() {
    this.room = null;
    this.peers = new Set();
    this.profiles = new Map(); // peerId → {name, saber, ready}
    // callbacks à brancher
    this.onPeers = () => {};        // (liste changée)
    this.onStart = () => {};        // (config partie)
    this.onState = () => {};        // (snapshot joueur, peerId)
    this.onBots = () => {};         // (snapshots entités IA de l'hôte)
    this.onEvent = () => {};        // (évènement combat, peerId)
    this.onHostChange = () => {};
  }

  get connected() { return !!this.room; }
  get selfId() { return selfId; }

  get hostId() {
    const ids = [selfId, ...this.peers];
    ids.sort();
    return ids[0];
  }
  get isHost() { return this.hostId === selfId; }

  join(code) {
    this.leave();
    this.room = joinRoom({ appId: APP_ID }, 'salle-' + code);

    const act = name => this.room.makeAction(name);
    const prof = act('prof'), start = act('start'), state = act('st');
    const bots = act('bots'), evt = act('evt');
    this._sendProf = prof.send; this._sendStart = start.send; this._sendState = state.send;
    this._sendBots = bots.send; this._sendEvt = evt.send;

    prof.onMessage = (p, m) => { this.profiles.set(m.peerId, p); this.onPeers(); };
    start.onMessage = cfg => this.onStart(cfg);
    state.onMessage = (s, m) => this.onState(s, m.peerId);
    bots.onMessage = arr => this.onBots(arr);
    evt.onMessage = (e, m) => this.onEvent(e, m.peerId);

    this.room.onPeerJoin = id => {
      const wasHost = this.isHost;
      this.peers.add(id);
      if (this.myProfile) prof.send(this.myProfile, { target: id }).catch(() => {});
      this.onPeers();
      if (wasHost !== this.isHost) this.onHostChange();
    };
    this.room.onPeerLeave = id => {
      const wasHost = this.isHost;
      this.peers.delete(id);
      this.profiles.delete(id);
      this.onPeers();
      if (wasHost !== this.isHost) this.onHostChange();
    };
  }

  _safe(fn, data) { if (fn && this.room) fn(data).catch(() => {}); }

  setProfile(p) {
    this.myProfile = p;
    if (this.peers.size) this._safe(this._sendProf, p);
  }

  start(cfg) { this._safe(this._sendStart, cfg); }
  sendState(s) { this._safe(this._sendState, s); }
  sendBots(arr) { this._safe(this._sendBots, arr); }
  sendEvent(e) { this._safe(this._sendEvt, e); }

  leave() {
    if (this.room) { try { this.room.leave(); } catch (e) {} }
    this.room = null;
    this.peers.clear();
    this.profiles.clear();
    this.myProfile = null;
  }
}
