const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  iceCandidatePoolSize: 4,
};

function toBase64(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value.trim());
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function waitForIce(peer) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", listener);
      reject(new Error("La collecte réseau a expiré. Réessayez."));
    }, 12000);
    function listener() {
      if (peer.iceGatheringState === "complete") {
        clearTimeout(timeout);
        peer.removeEventListener("icegatheringstatechange", listener);
        resolve();
      }
    }
    peer.addEventListener("icegatheringstatechange", listener);
  });
}

export class P2PSession {
  constructor({ onMessage, onStatus } = {}) {
    this.role = "solo";
    this.peers = [];
    this.channel = null;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
  }

  status(message, state = "pending") {
    this.onStatus({ message, state, role: this.role, connected: this.connectedCount });
  }

  get connectedCount() {
    if (this.role === "host") return this.peers.filter(item => item.channel?.readyState === "open").length;
    return this.channel?.readyState === "open" ? 1 : 0;
  }

  wireChannel(channel, peerRecord) {
    peerRecord.channel = channel;
    if (this.role === "guest") this.channel = channel;
    channel.addEventListener("open", () => this.status("Connexion P2P établie.", "connected"));
    channel.addEventListener("close", () => this.status("Connexion P2P fermée.", "closed"));
    channel.addEventListener("error", () => this.status("Erreur du canal P2P.", "error"));
    channel.addEventListener("message", event => {
      try { this.onMessage(JSON.parse(event.data), peerRecord); }
      catch (error) { this.status(`Message P2P invalide : ${error.message}`, "error"); }
    });
  }

  wirePeer(peer, record) {
    peer.addEventListener("connectionstatechange", () => {
      const state = peer.connectionState;
      this.status(`Connexion : ${state}.`, state === "connected" ? "connected" : state);
    });
    peer.addEventListener("datachannel", event => this.wireChannel(event.channel, record));
  }

  async createHostOffer() {
    this.role = "host";
    const peer = new RTCPeerConnection(RTC_CONFIG);
    const record = { peer, channel: null, id: `guest-${this.peers.length + 1}` };
    this.peers.push(record);
    this.wirePeer(peer, record);
    const channel = peer.createDataChannel("morentia-state", { ordered: true });
    this.wireChannel(channel, record);
    await peer.setLocalDescription(await peer.createOffer());
    this.status("Invitation créée, collecte des routes réseau…");
    await waitForIce(peer);
    return { code: toBase64(peer.localDescription), peerId: record.id };
  }

  async acceptAnswer(peerId, answerCode) {
    const record = this.peers.find(item => item.id === peerId);
    if (!record) throw new Error("Invitation hôte introuvable.");
    await record.peer.setRemoteDescription(fromBase64(answerCode));
    this.status("Réponse acceptée, connexion en cours…");
  }

  async createJoinAnswer(offerCode) {
    this.close();
    this.role = "guest";
    const peer = new RTCPeerConnection(RTC_CONFIG);
    const record = { peer, channel: null, id: "host" };
    this.peers = [record];
    this.wirePeer(peer, record);
    await peer.setRemoteDescription(fromBase64(offerCode));
    await peer.setLocalDescription(await peer.createAnswer());
    this.status("Réponse créée, collecte des routes réseau…");
    await waitForIce(peer);
    return toBase64(peer.localDescription);
  }

  send(message, onlyRecord = null) {
    const payload = JSON.stringify(message);
    if (this.role === "host") {
      const records = onlyRecord ? [onlyRecord] : this.peers;
      for (const record of records) if (record.channel?.readyState === "open") record.channel.send(payload);
      return;
    }
    if (this.channel?.readyState === "open") this.channel.send(payload);
    else {
      const guestChannel = this.peers[0]?.channel;
      if (guestChannel?.readyState === "open") guestChannel.send(payload);
      else throw new Error("La connexion P2P n’est pas ouverte.");
    }
  }

  close() {
    for (const record of this.peers) {
      record.channel?.close();
      record.peer?.close();
    }
    this.peers = [];
    this.channel = null;
    this.role = "solo";
  }
}

export const signalCode = { encode: toBase64, decode: fromBase64 };
