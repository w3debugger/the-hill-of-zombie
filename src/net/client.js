// Thin WebSocket client used during multiplayer sessions.

import { C2S, S2C } from './protocol.js';

export class NetClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.handlers = new Map();
    this.queue = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) { reject(e); return; }
      this.ws.addEventListener('open', () => {
        this.connected = true;
        for (const m of this.queue) this.ws.send(m);
        this.queue.length = 0;
        resolve();
      });
      this.ws.addEventListener('error', (e) => {
        if (!this.connected) reject(new Error('WebSocket connection failed'));
      });
      this.ws.addEventListener('close', () => {
        this.connected = false;
        this.emit('_close', null);
      });
      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg && msg.t) this.emit(msg.t, msg);
      });
    });
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const set = this.handlers.get(type);
    if (set) set.delete(fn);
  }
  emit(type, data) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) { try { fn(data); } catch (e) { console.error(e); } }
  }
  send(type, payload = {}) {
    const msg = JSON.stringify({ t: type, ...payload });
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.queue.push(msg);
    }
  }
  close() {
    if (this.ws) try { this.ws.close(); } catch (e) {}
    this.handlers.clear();
  }
}

export const C2S_T = C2S;
export const S2C_T = S2C;
