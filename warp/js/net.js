import { joinRoom, selfId } from 'trystero';

const APP_ID = 'novatix-warp-v1';

export { selfId };

export class Net {
  constructor() {
    this.room = null;
    this.peers = new Set();
    this.profiles = new Map();
    this.myProfile = null;
    this.onPeers = () => {};
    this.onStart = () => {};
    this.onState = () => {};
    this.onAiState = () => {};
    this.onEvent = () => {};
    this.onEnd = () => {};
    this.onHostChange = () => {};
  }

  get connected() {
    return !!this.room;
  }

  get selfId() {
    return selfId;
  }

  get hostId() {
    const ids = [selfId, ...this.peers].sort();
    return ids[0];
  }

  get isHost() {
    return this.hostId === selfId;
  }

  join(code) {
    this.leave();
    this.room = joinRoom({ appId: APP_ID }, `room-${code}`);
    const action = name => this.room.makeAction(name);
    const profile = action('profile');
    const start = action('start');
    const state = action('state');
    const ai = action('ai');
    const event = action('event');
    const end = action('end');

    this._sendProfile = profile.send;
    this._sendStart = start.send;
    this._sendState = state.send;
    this._sendAiState = ai.send;
    this._sendEvent = event.send;
    this._sendEnd = end.send;

    profile.onMessage = (data, meta) => {
      this.profiles.set(meta.peerId, data);
      this.onPeers();
    };
    start.onMessage = data => this.onStart(data);
    state.onMessage = (data, meta) => this.onState(data, meta.peerId);
    ai.onMessage = data => this.onAiState(data);
    event.onMessage = (data, meta) => this.onEvent(data, meta.peerId);
    end.onMessage = data => this.onEnd(data);

    this.room.onPeerJoin = id => {
      const wasHost = this.isHost;
      this.peers.add(id);
      if (this.myProfile) profile.send(this.myProfile, { target: id }).catch(() => {});
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

  setProfile(profile) {
    this.myProfile = profile;
    this._safe(this._sendProfile, profile);
  }

  start(config) {
    this._safe(this._sendStart, config);
  }

  sendState(snapshot) {
    this._safe(this._sendState, snapshot);
  }

  sendAiState(snapshot) {
    this._safe(this._sendAiState, snapshot);
  }

  sendEvent(event) {
    this._safe(this._sendEvent, event);
  }

  sendEnd(summary) {
    this._safe(this._sendEnd, summary);
  }

  leave() {
    if (this.room) {
      try {
        this.room.leave();
      } catch (e) {
        // The room may already be closed by the browser.
      }
    }
    this.room = null;
    this.peers.clear();
    this.profiles.clear();
    this.myProfile = null;
  }

  _safe(fn, payload) {
    if (!this.room || !fn) return;
    fn(payload).catch(() => {});
  }
}
