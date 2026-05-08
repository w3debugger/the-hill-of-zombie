// Wire protocol shared between client and server.
// Every message is JSON: { t: 'msgType', ...payload }.

// --- Client -> Server ---
export const C2S = {
  HELLO:       'hello',         // { name, color }
  CREATE_ROOM: 'createRoom',    // {}
  JOIN_ROOM:   'joinRoom',      // { code }
  LEAVE_ROOM:  'leaveRoom',     // {}
  LOBBY_READY: 'lobbyReady',    // { ready: bool }
  START_GAME:  'startGame',     // {} (host only)
  INPUT:       'input',         // input state
};

// --- Server -> Client ---
export const S2C = {
  WELCOME:    'welcome',     // { id }
  LOBBY:      'lobby',       // { code, players: [{id,name,color,ready,host}], host }
  GAME_START: 'gameStart',   // { yourId }
  SNAPSHOT:   'snapshot',    // World.snapshot()
  EVENTS:     'events',      // array of events
  ERROR:      'error',       // { msg }
  KICKED:     'kicked',      // { reason }
};
