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

    const [sendProf, onProf] = this.room.makeAction('prof');
    const [sendStart, onStart] = this.room.makeAction('start');
    const [sendState, onState] = this.room.makeAction('st');
    const [sendAi, onAi] = this.room.makeAction('ai');
    const [sendEvt, onEvt] = this.room.makeAction('evt');
    const [sendFin, onFin] = this.room.makeAction('fin');
    this._sendProf = sendProf; this._sendStart = sendStart; this._sendState = sendState;
    this._sendAi = sendAi; this._sendEvt = sendEvt; this._sendFin = sendFin;

    onProf((p, id) => { this.profiles.set(id, p); this.onPeers(); });
    onStart(cfg => this.onStart(cfg));
    onState((s, id) => this.onState(s, id));
    onAi(arr => this.onAiState(arr));
    onEvt((e, id) => this.onEvent(e, id));
    onFin((f, id) => this.onFinish(f, id));

    this.room.onPeerJoin(id => {
      const wasHost = this.isHost;
      this.peers.add(id);
      if (this.myProfile) sendProf(this.myProfile, id); // se présenter au nouveau
      this.onPeers();
      if (wasHost !== this.isHost) this.onHostChange();
    });
    this.room.onPeerLeave(id => {
      const wasHost = this.isHost;
      this.peers.delete(id);
      this.profiles.delete(id);
      this.onPeers();
      if (wasHost !== this.isHost) this.onHostChange();
    });
  }

  setProfile(p) {
    this.myProfile = p;
    if (this._sendProf && this.peers.size) this._sendProf(p);
  }

  start(cfg) { this._sendStart && this._sendStart(cfg); }
  sendState(s) { this._sendState && this._sendState(s); }
  sendAi(arr) { this._sendAi && this._sendAi(arr); }
  sendEvent(e) { this._sendEvt && this._sendEvt(e); }
  sendFinish(f) { this._sendFin && this._sendFin(f); }

  leave() {
    if (this.room) { try { this.room.leave(); } catch (e) {} }
    this.room = null;
    this.peers.clear();
    this.profiles.clear();
    this.myProfile = null;
  }
}
