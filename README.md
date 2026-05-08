# The Hill of Zombie

Top-down co-op zombie survival shooter. Vite + Preact client, Node WebSocket server.

## Quick start

```
npm install
npm run dev
```

This starts:

- The Vite client at http://localhost:5173
- The multiplayer server at ws://localhost:3001

Open the URL in two windows to test multiplayer locally.

## Multiplayer

- **Solo** — runs entirely client-side, no server needed.
- **Host** — creates a room, gives you a 4-letter code.
- **Join** — enter a code to join a room.

Up to 4 players co-op per room. Players share the hill and the wave clock; each player has their own HP, weapons, ammo, and score. Cash is shared.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| LMB | Fire |
| R | Reload |
| Shift | Sprint |
| Space | Dodge (i-frames) |
| 1–4 | Switch weapon |
| Esc | Pause / menu |
| Tab | Player list |

## Build

```
npm run build
npm run preview
```

The server is in `server/index.js` and runs independently. Deploy it to anywhere
Node runs (Fly.io, Render, Railway, Docker, etc.) and point the client at it via
the `VITE_WS_URL` environment variable at build time.

## Project layout

```
index.html          # Vite entry, mounts Preact
src/
  main.jsx          # Preact mount
  styles.css        # Global styles
  ui/
    App.jsx         # Top-level state machine + screens
    HUD.jsx         # In-game HUD overlay
    Shop.jsx        # Between-wave shop
    Radio.jsx       # Radio chatter
  game/
    data.js         # Constants, weapons, zombie types, story script
    world.js        # Pure simulation (runs in browser AND Node)
    render.js       # Canvas2D rendering
    audio.js        # Web Audio synth
    input.js        # Keyboard/mouse capture
    client.js       # Glues world+render+audio+input together
  net/
    client.js       # WebSocket client
    protocol.js     # Message types
server/
  index.js          # WebSocket multiplayer server with rooms
```
