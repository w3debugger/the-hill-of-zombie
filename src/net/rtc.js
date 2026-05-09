// WebRTC peer-to-peer transport with a thin WebSocket signaling layer.
//
// Architecture:
//   - SignalClient: shared base. Owns the WebSocket to the signaling server
//     (rooms, lobby, SDP/ICE relay).
//   - RTCHost: extends SignalClient. After 'startGame', opens a DataChannel
//     to each joiner. The game World runs in this browser; snapshots and
//     events are broadcast across all open channels every tick.
//   - RTCJoiner: extends SignalClient. Connects to one host via DataChannel.
//     Exposes the same `send(t, payload)` / `on(t, cb)` shape the rest of the
//     code expects, so the existing GameClient.startMultiplayer path works
//     unchanged — INPUT is routed to the DataChannel, lobby/signaling stays
//     on the WebSocket.

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

class SignalClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.queue = [];
    this.connected = false;
    this.localId = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      try { this.ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
      this.ws.addEventListener('open', () => {
        this.connected = true;
        for (const m of this.queue) this.ws.send(m);
        this.queue.length = 0;
        resolve();
      });
      this.ws.addEventListener('error', () => {
        if (!this.connected) {
          console.warn('[net] signaling failed:', this.url);
          reject(new Error('Could not reach signaling server'));
        }
      });
      this.ws.addEventListener('close', () => {
        this.connected = false;
        this._emit('_close');
      });
      this.ws.addEventListener('message', (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        if (msg.t === 'welcome') this.localId = msg.id;
        this._emit(msg.t, msg);
      });
    });
  }
  on(t, fn) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set());
    this.handlers.get(t).add(fn);
    return () => this.handlers.get(t)?.delete(fn);
  }
  _emit(t, data) {
    const set = this.handlers.get(t);
    if (set) for (const fn of set) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }
  // Sends a signaling message over the WebSocket. Queued until open.
  sendSig(t, payload = {}) {
    const m = JSON.stringify({ t, ...payload });
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(m);
    } else {
      this.queue.push(m);
    }
  }
  // Default `send` is signaling-only. RTCJoiner overrides to route INPUT
  // through the DataChannel.
  send(t, payload = {}) { this.sendSig(t, payload); }
  close() {
    if (this.ws) try { this.ws.close(); } catch (e) {}
    this.handlers.clear();
  }
}

// ---------- Host ----------

export class RTCHost extends SignalClient {
  constructor(url) {
    super(url);
    this.peerInfo = [];                // [{id,name,color}] from gameStart
    this.peers = new Map();            // peerId -> { info, pc, dc, lastInput, ready }
    this._allReadyResolve = null;

    this.on('gameStart', (m) => this._onGameStart(m));
    this.on('rtcAnswer', async (m) => {
      const p = this.peers.get(m.from);
      if (p && m.sdp) {
        try { await p.pc.setRemoteDescription(m.sdp); }
        catch (e) { console.warn('[host] setRemoteDescription failed', e); }
      }
    });
    this.on('rtcIce', async (m) => {
      const p = this.peers.get(m.from);
      if (p && m.candidate) {
        try { await p.pc.addIceCandidate(m.candidate); } catch (e) {}
      }
    });
  }
  _onGameStart(m) {
    this.peerInfo = m.peers || [];
    if (this.peerInfo.length === 0) {
      // Host plays alone — no RTC needed, ready immediately.
      this._signalAllReady();
      return;
    }
    for (const info of this.peerInfo) {
      this._createOfferTo(info).catch((e) => console.warn('[host] offer failed', e));
    }
  }
  async _createOfferTo(info) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const dc = pc.createDataChannel('game', { ordered: true });
    const peer = { info, pc, dc, lastInput: {}, ready: false };
    this.peers.set(info.id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSig('rtcIce', { to: info.id, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') {
        this._closePeer(info.id);
      }
    };

    dc.onopen = () => {
      peer.ready = true;
      this._emit('peer_ready', { id: info.id });
      if (this._allPeersReady()) this._signalAllReady();
    };
    dc.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'input') peer.lastInput = msg.input || {};
    };
    dc.onclose = () => this._closePeer(info.id);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSig('rtcOffer', { to: info.id, sdp: offer });
  }
  _closePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch (e) {}
    this.peers.delete(id);
    this._emit('peer_left', { id });
  }
  _allPeersReady() {
    if (this.peerInfo.length === 0) return true;
    if (this.peers.size !== this.peerInfo.length) return false;
    for (const p of this.peers.values()) if (!p.ready) return false;
    return true;
  }
  _signalAllReady() {
    if (this._allReadyResolve) {
      this._allReadyResolve();
      this._allReadyResolve = null;
    }
    this._emit('all_peers_ready');
  }
  // Resolves once every joiner's DataChannel is open (or immediately if there
  // are no joiners). App.jsx awaits this before transitioning to the game
  // screen, so the host doesn't start broadcasting into closed channels.
  waitForPeers() {
    if (this._allPeersReady()) return Promise.resolve();
    return new Promise((resolve) => { this._allReadyResolve = resolve; });
  }
  // World.step expects { peerId: input }. Host adds its own input on top.
  getPeerInputs() {
    const out = {};
    for (const [id, p] of this.peers) out[id] = p.lastInput;
    return out;
  }
  peerList() {
    return this.peerInfo.slice();
  }
  broadcast(t, payload = {}) {
    const m = JSON.stringify({ t, ...payload });
    for (const p of this.peers.values()) {
      if (p.ready && p.dc.readyState === 'open') {
        try { p.dc.send(m); } catch (e) {}
      }
    }
  }
  broadcastSnapshot(snap) { this.broadcast('snapshot', snap); }
  broadcastEvents(events) {
    if (events && events.length) this.broadcast('events', { events });
  }

  close() {
    for (const id of [...this.peers.keys()]) this._closePeer(id);
    super.close();
  }
}

// ---------- Joiner ----------

export class RTCJoiner extends SignalClient {
  constructor(url) {
    super(url);
    this.pc = null;
    this.dc = null;
    this.hostId = null;

    this.on('gameStart', (m) => { this.hostId = m.hostId; });
    this.on('rtcOffer', (m) => this._onOffer(m));
    this.on('rtcIce', async (m) => {
      if (this.pc && m.candidate) {
        try { await this.pc.addIceCandidate(m.candidate); } catch (e) {}
      }
    });
  }
  async _onOffer(m) {
    if (this.pc) return;
    this.hostId = this.hostId || m.from;
    this.pc = new RTCPeerConnection(RTC_CONFIG);

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSig('rtcIce', { to: this.hostId, candidate: e.candidate });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this._emit('_close');
    };
    this.pc.ondatachannel = (ev) => {
      this.dc = ev.channel;
      this.dc.onopen = () => this._emit('_rtc_ready');
      this.dc.onclose = () => this._emit('_close');
      this.dc.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        this._emit(msg.t, msg);
      };
    };

    try {
      await this.pc.setRemoteDescription(m.sdp);
      const ans = await this.pc.createAnswer();
      await this.pc.setLocalDescription(ans);
      this.sendSig('rtcAnswer', { to: this.hostId, sdp: ans });
    } catch (e) {
      console.warn('[joiner] negotiation failed', e);
    }
  }
  // INPUT goes peer-to-peer over the DataChannel; everything else (lobby,
  // signaling) stays on the WebSocket.
  send(t, payload = {}) {
    if (t === 'input') {
      if (this.dc && this.dc.readyState === 'open') {
        try { this.dc.send(JSON.stringify({ t, ...payload })); } catch (e) {}
      }
      return;
    }
    this.sendSig(t, payload);
  }
  close() {
    if (this.dc) try { this.dc.close(); } catch (e) {}
    if (this.pc) try { this.pc.close(); } catch (e) {}
    super.close();
  }
}
