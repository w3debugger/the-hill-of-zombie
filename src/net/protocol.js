// Wire protocol shared between client and server.
// Every message is JSON: { t: 'msgType', ...payload }.
//
// Snapshot is intentionally lean — bullets/enemyBullets are NOT shipped over
// the wire; clients spawn cosmetic bullets locally from 'fire' / 'spit'
// events. Immutable per-entity fields (player name/color, zombie type/seed,
// pickup type/value) are sent once via the events stream:
//   - player_joined  { id, name, color }
//   - zombie_spawned { id, ztype, x, y, r, maxHp, seed, wobble }
//   - pickup_spawned { id, ptype, value, x, y }
// The client caches these and merges them onto incoming snapshots.

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
