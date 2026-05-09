// Wire protocol for two transports:
//
//   - WebSocket to the signaling server: room/lobby management + SDP/ICE
//     relay. Used during connect and lobby; also used to set up WebRTC peer
//     connections at game-start time.
//   - WebRTC DataChannel between host and each joiner: gameplay traffic
//     (input, snapshot, events). The signaling server never sees these
//     messages — once the DataChannel is open, the cloud is out of the loop.
//
// Every message is JSON: { t: 'msgType', ...payload }.
//
// Snapshot is intentionally lean — bullets/enemyBullets are NOT shipped over
// the wire; clients spawn cosmetic bullets locally from 'fire' / 'spit'
// events. Immutable per-entity fields (player name/color, zombie type/seed,
// pickup type/value) are sent once via the events stream.

// --- Client -> signaling server (over WebSocket) ---
export const C2S = {
  HELLO:       'hello',         // { name, color }
  CREATE_ROOM: 'createRoom',    // {}
  JOIN_ROOM:   'joinRoom',      // { code }
  LEAVE_ROOM:  'leaveRoom',     // {}
  LOBBY_READY: 'lobbyReady',    // { ready: bool }
  START_GAME:  'startGame',     // {} (host only)
  RTC_OFFER:   'rtcOffer',      // { to, sdp }
  RTC_ANSWER:  'rtcAnswer',     // { to, sdp }
  RTC_ICE:     'rtcIce',        // { to, candidate }
  // --- Joiner -> Host (over RTC DataChannel) ---
  INPUT:       'input',         // { input }
};

// --- Server -> client (over WebSocket) ---
export const S2C = {
  WELCOME:    'welcome',     // { id }
  LOBBY:      'lobby',       // { code, players: [{id,name,color,ready}], host }
  GAME_START: 'gameStart',   // { yourId, hostId, peers: [{id,name,color}] }
  ERROR:      'error',       // { msg }
  KICKED:     'kicked',      // { reason }
  RTC_OFFER:  'rtcOffer',    // { from, sdp }
  RTC_ANSWER: 'rtcAnswer',   // { from, sdp }
  RTC_ICE:    'rtcIce',      // { from, candidate }
  // --- Host -> Joiner (over RTC DataChannel) ---
  SNAPSHOT:   'snapshot',    // World.snapshot()
  EVENTS:     'events',      // { events: [...] }
};
