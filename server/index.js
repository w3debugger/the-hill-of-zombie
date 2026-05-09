// Signaling-only server for WebRTC peer-to-peer multiplayer.
//
// Owns 4-character room codes, lobby state, and forwards SDP/ICE candidates
// between peers in the same room. Once peers have established their
// DataChannels, gameplay traffic flows browser-to-browser and this server is
// dormant — so a sleeping free-tier instance is fine: it only wakes for
// signaling moments (room create, join, start, peer disconnect), never during
// the actual match.

import http from 'http';
import os from 'os';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 3001;
const log = (...args) => console.log('[hoz-sig]', ...args);

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) out.push(it.address);
    }
  }
  return out;
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: false });

httpServer.listen(PORT, () => {
  log(`signaling on :${PORT}`);
  const ips = lanIPs();
  if (ips.length) log(`LAN: phones browse to http://${ips[0]}:5173 on the same WiFi`);
});

const rooms = new Map();   // code -> Room
const peers = new Map();   // ws   -> Peer

function send(ws, t, payload = {}) {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify({ t, ...payload })); } catch (e) {}
}
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 60; attempt++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(s)) return s;
  }
  throw new Error('out of codes');
}
function pid() {
  let s = '';
  for (let i = 0; i < 10; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

function broadcastLobby(room) {
  const players = [...room.peers.values()].map(p => ({
    id: p.id, name: p.name, color: p.color, ready: !!p.ready,
  }));
  for (const p of room.peers.values()) {
    send(p.ws, 'lobby', { code: room.code, players, host: room.hostId });
  }
}

wss.on('connection', (ws, req) => {
  // Disable Nagle on the underlying TCP socket — we send infrequent, small
  // signaling messages and don't want them batched into a 40 ms wait.
  try { req.socket.setNoDelay(true); } catch (e) {}
  const peer = {
    id: pid(),
    ws,
    name: 'Soldier',
    color: '#5cc8ff',
    room: null,
    ready: false,
  };
  peers.set(ws, peer);
  send(ws, 'welcome', { id: peer.id });
  log(`peer ${peer.id} connected (${req.socket.remoteAddress})`);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (_) { return; }
    handle(peer, msg);
  });
  ws.on('close', () => {
    if (peer.room) leaveRoom(peer);
    peers.delete(ws);
    log(`peer ${peer.id} disconnected`);
  });
  ws.on('error', () => {});
});

function handle(p, m) {
  if (!m || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'hello': {
      p.name = String(m.name || 'Soldier').slice(0, 16) || 'Soldier';
      p.color = String(m.color || '#5cc8ff');
      break;
    }
    case 'createRoom': {
      if (p.room) return send(p.ws, 'error', { msg: 'Already in a room' });
      let code;
      try { code = genCode(); } catch (_) { return send(p.ws, 'error', { msg: 'Server full' }); }
      const room = { code, hostId: p.id, peers: new Map(), started: false };
      rooms.set(code, room);
      room.peers.set(p.id, p);
      p.room = room;
      log(`${p.name} created room ${code}`);
      broadcastLobby(room);
      break;
    }
    case 'joinRoom': {
      const code = String(m.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(p.ws, 'error', { msg: 'Room not found' });
      if (room.started) return send(p.ws, 'error', { msg: 'Match already in progress' });
      if (room.peers.size >= 10) return send(p.ws, 'error', { msg: 'Room is full' });
      if (p.room) leaveRoom(p);
      room.peers.set(p.id, p);
      p.room = room;
      log(`${p.name} joined room ${code}`);
      broadcastLobby(room);
      break;
    }
    case 'leaveRoom': {
      if (p.room) leaveRoom(p);
      break;
    }
    case 'lobbyReady': {
      if (!p.room) return;
      p.ready = !!m.ready;
      broadcastLobby(p.room);
      break;
    }
    case 'startGame': {
      const room = p.room;
      if (!room) return;
      if (room.hostId !== p.id) return send(p.ws, 'error', { msg: 'Only host can start' });
      room.started = true;
      // Tell each peer who else is in the room. The host uses the list to
      // know whom to open a DataChannel to; joiners use it to remember the
      // host's id (they'll receive an SDP offer addressed from that id).
      for (const each of room.peers.values()) {
        const others = [...room.peers.values()]
          .filter(o => o.id !== each.id)
          .map(o => ({ id: o.id, name: o.name, color: o.color }));
        send(each.ws, 'gameStart', {
          yourId: each.id,
          hostId: room.hostId,
          peers: others,
        });
      }
      log(`room ${room.code} started`);
      break;
    }
    // RTC signaling — strict relay to one peer in the same room.
    case 'rtcOffer':
    case 'rtcAnswer':
    case 'rtcIce': {
      if (!p.room) return;
      const dest = p.room.peers.get(String(m.to));
      if (!dest) return;
      const fwd = { from: p.id };
      if (m.sdp) fwd.sdp = m.sdp;
      if (m.candidate) fwd.candidate = m.candidate;
      send(dest.ws, m.t, fwd);
      break;
    }
  }
}

function leaveRoom(peer) {
  const room = peer.room;
  peer.room = null;
  if (!room) return;
  room.peers.delete(peer.id);
  if (room.peers.size === 0) {
    rooms.delete(room.code);
    log(`room ${room.code} closed`);
  } else if (room.hostId === peer.id) {
    // Host left — boot everyone. We don't migrate hosts mid-match because
    // the host's browser owns the authoritative World; there's no state to
    // hand off.
    for (const p of room.peers.values()) {
      send(p.ws, 'kicked', { reason: 'Host left the match' });
      p.room = null;
    }
    rooms.delete(room.code);
    log(`room ${room.code} closed (host left)`);
  } else {
    broadcastLobby(room);
  }
}

const shutdown = () => {
  log('shutting down');
  wss.close();
  httpServer.close();
  setTimeout(() => process.exit(0), 100);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
