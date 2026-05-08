// Authoritative multiplayer server.
// Runs the World per room at 30Hz, broadcasts snapshots at 20Hz.

import { WebSocketServer } from 'ws';
import { World } from '../src/game/world.js';
import { C2S, S2C } from '../src/net/protocol.js';

const PORT = Number(process.env.PORT) || 3001;
const wss = new WebSocketServer({ port: PORT });

const log = (...args) => console.log('[hoz]', ...args);
log(`WebSocket server listening on :${PORT}`);

const rooms = new Map();   // code -> Room
const clients = new Map(); // ws -> Client

class Client {
  constructor(ws) {
    this.ws = ws;
    this.id = nanoid();
    this.name = 'Soldier';
    this.color = '#5cc8ff';
    this.room = null;
    this.input = {};
  }
  send(t, payload = {}) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    try { this.ws.send(JSON.stringify({ t, ...payload })); } catch (e) {}
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.clients = [];
    this.host = null;
    this.world = null;
    this.tickHandle = null;
    this.snapshotHandle = null;
    this.tickRate = 30;
    this.snapshotRate = 20;
    this.lobbyReady = new Map();
    this.lastTick = 0;
  }
  addClient(c) {
    if (this.clients.length === 0) this.host = c.id;
    this.clients.push(c);
    c.room = this;
    this.broadcastLobby();
  }
  removeClient(c) {
    this.clients = this.clients.filter(x => x !== c);
    c.room = null;
    this.lobbyReady.delete(c.id);
    if (this.host === c.id) this.host = this.clients[0]?.id || null;
    if (this.world) this.world.removePlayer(c.id);
    if (this.clients.length === 0) {
      this.shutdown();
      rooms.delete(this.code);
      log(`room ${this.code} closed`);
    } else {
      this.broadcastLobby();
    }
  }
  broadcastLobby() {
    const players = this.clients.map(c => ({
      id: c.id, name: c.name, color: c.color, ready: !!this.lobbyReady.get(c.id),
    }));
    for (const c of this.clients) {
      c.send(S2C.LOBBY, { code: this.code, players, host: this.host });
    }
  }
  start() {
    if (this.world) return;
    this.world = new World();
    for (const c of this.clients) {
      this.world.addPlayer(c.id, c.name, c.color);
    }
    this.world.startGame();
    for (const c of this.clients) c.send(S2C.GAME_START, { yourId: c.id });
    log(`room ${this.code} started with ${this.clients.length} player(s)`);

    this.lastTick = Date.now();
    this.tickHandle = setInterval(() => this.tick(), 1000 / this.tickRate);
    this.snapshotHandle = setInterval(() => this.broadcastSnapshot(), 1000 / this.snapshotRate);
  }
  tick() {
    if (!this.world) return;
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const inputs = {};
    for (const c of this.clients) inputs[c.id] = c.input || {};
    const events = this.world.step(dt, inputs);
    if (events && events.length) {
      const msg = JSON.stringify({ t: S2C.EVENTS, events });
      for (const c of this.clients) {
        if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
      }
    }
  }
  broadcastSnapshot() {
    if (!this.world) return;
    const snap = this.world.snapshot();
    const msg = JSON.stringify({ t: S2C.SNAPSHOT, ...snap });
    for (const c of this.clients) {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
    }
  }
  shutdown() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.snapshotHandle) clearInterval(this.snapshotHandle);
    this.world = null;
  }
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 60; attempt++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(s)) return s;
  }
  throw new Error('Could not generate unique code');
}
function nanoid(len = 10) {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

wss.on('connection', (ws, req) => {
  const c = new Client(ws);
  clients.set(ws, c);
  log(`client ${c.id} connected (${req.socket.remoteAddress})`);
  c.send(S2C.WELCOME, { id: c.id });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    handleMessage(c, msg);
  });
  ws.on('close', () => {
    if (c.room) c.room.removeClient(c);
    clients.delete(ws);
    log(`client ${c.id} disconnected`);
  });
  ws.on('error', () => {});
});

function handleMessage(c, msg) {
  if (!msg || typeof msg.t !== 'string') return;
  switch (msg.t) {
    case C2S.HELLO: {
      c.name = String(msg.name || 'Soldier').slice(0, 16) || 'Soldier';
      c.color = String(msg.color || '#5cc8ff');
      break;
    }
    case C2S.CREATE_ROOM: {
      if (c.room) return c.send(S2C.ERROR, { msg: 'Already in a room' });
      let code;
      try { code = genCode(); } catch (e) { return c.send(S2C.ERROR, { msg: 'Server full' }); }
      const r = new Room(code);
      rooms.set(code, r);
      r.addClient(c);
      log(`room ${code} created by ${c.name}`);
      break;
    }
    case C2S.JOIN_ROOM: {
      const code = String(msg.code || '').toUpperCase();
      const r = rooms.get(code);
      if (!r) return c.send(S2C.ERROR, { msg: 'Room not found' });
      if (r.world) return c.send(S2C.ERROR, { msg: 'Match already in progress' });
      if (r.clients.length >= 4) return c.send(S2C.ERROR, { msg: 'Room is full' });
      if (c.room) c.room.removeClient(c);
      r.addClient(c);
      log(`${c.name} joined room ${code}`);
      break;
    }
    case C2S.LEAVE_ROOM: {
      if (c.room) c.room.removeClient(c);
      break;
    }
    case C2S.LOBBY_READY: {
      if (!c.room) return;
      c.room.lobbyReady.set(c.id, !!msg.ready);
      c.room.broadcastLobby();
      break;
    }
    case C2S.START_GAME: {
      if (!c.room) return;
      if (c.room.host !== c.id) return c.send(S2C.ERROR, { msg: 'Only host can start' });
      c.room.start();
      break;
    }
    case C2S.INPUT: {
      c.input = msg.input || {};
      break;
    }
  }
}

const shutdown = () => {
  log('shutting down');
  for (const r of rooms.values()) r.shutdown();
  wss.close();
  setTimeout(() => process.exit(0), 100);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
