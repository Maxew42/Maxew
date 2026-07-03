// Multijoueur P2P sans serveur : Trystero (WebRTC, signalisation via relais Nostr publics).
// L'« hôte » est le pair au plus petit id — déterministe et recalculé si quelqu'un part.
import { joinRoom, selfId } from 'trystero';

const APP_ID = 'novatix-lost-angeles-v1';

export { selfId };

export class Net {
  constructor() {
    this.room = null;
    this.peers = new Set();
    this.profiles = new Map(); // peerId → {name, charId, ready}
    // callbacks à brancher
    this.onPeers = () => {};        // (liste changée)
    this.onStart = () => {};        // (config course)
    this.onState = () => {};        // (snapshot, peerId)
    this.onAiState = () => {};      // (tableau de snapshots IA)
    this.onEvent = () => {};        // (évènement objet, peerId)
    this.onFinish = () => {};       // ({slot, time}, peerId)
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
    this.room = joinRoom({ appId: APP_ID }, 'salon-' + code);

    // trystero ≥0.25 : makeAction renvoie {send, onMessage} ; onMessage/onPeerJoin
    // sont des propriétés à assigner, et le 2ᵉ argument des handlers est {peerId}.
    const act = name => this.room.makeAction(name);
    const prof = act('prof'), start = act('start'), state = act('st');
    const ai = act('ai'), evt = act('evt'), fin = act('fin');
    this._sendProf = prof.send; this._sendStart = start.send; this._sendState = state.send;
    this._sendAi = ai.send; this._sendEvt = evt.send; this._sendFin = fin.send;

    prof.onMessage = (p, m) => { this.profiles.set(m.peerId, p); this.onPeers(); };
    start.onMessage = cfg => this.onStart(cfg);
    state.onMessage = (s, m) => this.onState(s, m.peerId);
    ai.onMessage = arr => this.onAiState(arr);
    evt.onMessage = (e, m) => this.onEvent(e, m.peerId);
    fin.onMessage = (f, m) => this.onFinish(f, m.peerId);

    this.room.onPeerJoin = id => {
      const wasHost = this.isHost;
      this.peers.add(id);
      if (this.myProfile) prof.send(this.myProfile, { target: id }).catch(() => {}); // se présenter au nouveau
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
  sendAi(arr) { this._safe(this._sendAi, arr); }
  sendEvent(e) { this._safe(this._sendEvt, e); }
  sendFinish(f) { this._safe(this._sendFin, f); }

  leave() {
    if (this.room) { try { this.room.leave(); } catch (e) {} }
    this.room = null;
    this.peers.clear();
    this.profiles.clear();
    this.myProfile = null;
  }
}
