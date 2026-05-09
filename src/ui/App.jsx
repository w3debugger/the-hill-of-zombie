import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { GameClient } from '../game/client.js';
import { NetClient } from '../net/client.js';
import { C2S, S2C } from '../net/protocol.js';
import { Intro, MainMenu, Lobby, GameOver, ConnectingOverlay } from './Screens.jsx';
import { HUD, Shop, Pause, RadioStack, WaveBanner, HitVignette, TouchControls } from './InGame.jsx';
import { IS_TOUCH } from '../game/input.js';
import { PLAYER_COLORS } from '../game/data.js';

function defaultWsUrl() {
  if (typeof window === 'undefined') return 'ws://localhost:3001';
  // Match the page's protocol so an https-served client doesn't fail mixed-content
  // checks. The dev server defaults to plain http, but tunnels (ngrok, devtunnels)
  // and any deployed build will land on https.
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname || 'localhost';
  return `${proto}//${host}:3001`;
}
const WS_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_WS_URL)
  || defaultWsUrl();

const DEFAULT_NAMES = [
  'Khalid', 'Hamza', 'Tariq', 'Bilal', 'Yusuf', 'Umar', 'Salahuddin',
  'Zaid', 'Ibrahim', 'Idris', 'Ayyub', 'Saif', 'Imran', 'Faris', 'Anas',
];
function loadProfile() {
  try {
    const s = localStorage.getItem('hoz.profile');
    if (s) return JSON.parse(s);
  } catch (e) {}
  const name = DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
  return { name, color: PLAYER_COLORS[0] };
}
function saveProfile(p) {
  try { localStorage.setItem('hoz.profile', JSON.stringify(p)); } catch (e) {}
}

export function App() {
  const [screen, setScreen] = useState('intro');
  const [profile, setProfileState] = useState(loadProfile);
  const setProfile = (p) => { saveProfile(p); setProfileState(p); };
  const [mode, setMode] = useState(null);            // 'solo' | 'mp'
  const [lobby, setLobby] = useState(null);          // { code, players, hostId, yourId }
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(null); // string label or null

  const [gameState, setGameState] = useState('idle'); // 'playing'|'shop'|'paused'|'gameover'|'victory'
  const [paused, setPaused] = useState(false);
  // When true, the menu card hides so the user can browse the spectate canvas
  // behind it. A floating PLAY button is shown to bring the menu back.
  const [menuMinimized, setMenuMinimized] = useState(false);
  const [radio, setRadio] = useState([]);
  const [banner, setBanner] = useState(null);
  const [hurtPulse, setHurtPulse] = useState(0);
  const [endStats, setEndStats] = useState(null);

  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const netRef = useRef(null);
  const radioIdRef = useRef(0);

  // ---- Intro skip ----
  const finishIntro = () => {
    setScreen('menu');
  };

  // ---- Radio helper ----
  const pushRadio = useCallback((msg) => {
    const id = ++radioIdRef.current;
    setRadio(prev => [...prev, { id, ...msg }]);
    setTimeout(() => setRadio(prev => prev.filter(m => m.id !== id)), 7000);
  }, []);

  // ---- Banner ----
  const showBanner = useCallback((b) => {
    setBanner(b);
    setTimeout(() => setBanner(null), 2400);
  }, []);

  // ---- Game lifecycle ----
  const startSolo = () => {
    setMode('solo');
    setScreen('game');
    setGameState('playing');
    setEndStats(null);
    // canvas mounts via screen='game'; init game in effect below
  };

  const hostMP = async () => {
    setError(null);
    setConnecting('Connecting…');
    const net = new NetClient(WS_URL);
    try { await net.connect(); }
    catch (e) { setConnecting(null); setError(`Could not reach ${WS_URL}. Is the multiplayer server running on port 3001?`); return; }
    netRef.current = net;
    let myId = null;
    net.on(S2C.WELCOME, (m) => { myId = m.id; });
    net.on(S2C.LOBBY, (m) => {
      setLobby({ code: m.code, players: m.players, hostId: m.host, yourId: myId });
      setConnecting(null);
      setScreen('lobby');
    });
    net.on(S2C.GAME_START, (m) => {
      setMode('mp');
      setScreen('game');
      setGameState('playing');
      setEndStats(null);
      // GameClient will be initialized in effect below using the existing net
    });
    net.on(S2C.ERROR, (m) => { setError(m.msg); setConnecting(null); });
    net.on(S2C.KICKED, (m) => { setError(m.reason); leaveRoom(); });
    net.on('_close', () => { if (screen === 'lobby') { setError('Disconnected from server.'); setScreen('menu'); } });
    net.send(C2S.HELLO, { name: profile.name, color: profile.color });
    net.send(C2S.CREATE_ROOM, {});
  };

  const joinMP = async (code) => {
    setError(null);
    setConnecting('Connecting…');
    const net = new NetClient(WS_URL);
    try { await net.connect(); }
    catch (e) { setConnecting(null); setError(`Could not reach ${WS_URL}.`); return; }
    netRef.current = net;
    let myId = null;
    net.on(S2C.WELCOME, (m) => { myId = m.id; });
    net.on(S2C.LOBBY, (m) => {
      setLobby({ code: m.code, players: m.players, hostId: m.host, yourId: myId });
      setConnecting(null);
      setScreen('lobby');
    });
    net.on(S2C.GAME_START, (m) => {
      setMode('mp');
      setScreen('game');
      setGameState('playing');
      setEndStats(null);
    });
    net.on(S2C.ERROR, (m) => { setError(m.msg); setConnecting(null); });
    net.on(S2C.KICKED, (m) => { setError(m.reason); leaveRoom(); });
    net.on('_close', () => { if (screen === 'lobby') { setError('Disconnected from server.'); setScreen('menu'); } });
    net.send(C2S.HELLO, { name: profile.name, color: profile.color });
    net.send(C2S.JOIN_ROOM, { code: code.toUpperCase() });
  };

  const leaveRoom = () => {
    if (netRef.current) {
      try { netRef.current.send(C2S.LEAVE_ROOM, {}); } catch (e) {}
      try { netRef.current.close(); } catch (e) {}
      netRef.current = null;
    }
    setLobby(null);
    setMode(null);
    setScreen('menu');
  };

  const startGameAsHost = () => {
    if (netRef.current) netRef.current.send(C2S.START_GAME, {});
  };

  const setLobbyReady = (ready) => {
    if (netRef.current) netRef.current.send(C2S.LOBBY_READY, { ready });
  };

  // Initialize GameClient when entering 'game' screen, or a preview client on
  // the menu so the user can browse the arena behind the menu card.
  useEffect(() => {
    if (screen !== 'game' && screen !== 'menu') return;
    let cancelled = false;
    const init = async () => {
      // Wait one frame so the canvas is mounted
      await new Promise(r => requestAnimationFrame(r));
      if (cancelled || !canvasRef.current) return;
      const client = new GameClient(canvasRef.current, {
        onStateChange: (s) => {
          setGameState(s);
          if (s === 'gameover' || s === 'victory') {
            const w = client.world;
            const me = w?.players?.find(p => p.id === client.localPlayerId);
            setEndStats({
              won: s === 'victory',
              wave: w?.waveNum || 0,
              kills: me?.kills || 0,
              score: me?.score || 0,
              players: w?.players?.map(p => ({ name: p.name, color: p.color, score: p.score, kills: p.kills })) || [],
            });
          }
        },
        onRadio: pushRadio,
        onWaveBanner: showBanner,
        onPlayerHurt: () => setHurtPulse(Date.now()),
        onPlayerDied: () => {},
        onEsc: () => setPaused(p => !p),
      });
      gameRef.current = client;
      if (screen === 'menu') {
        client.startPreview();
      } else if (mode === 'solo') {
        client.startSolo({ name: profile.name, color: profile.color });
      } else if (mode === 'mp' && netRef.current && lobby) {
        client.startMultiplayer(netRef.current, lobby.yourId);
      }
    };
    init();
    return () => {
      cancelled = true;
      if (gameRef.current) { gameRef.current.stop(); gameRef.current = null; }
    };
  }, [screen, mode]);

  // Esc pause control
  useEffect(() => {
    if (paused && gameRef.current) gameRef.current.pause();
    else if (gameRef.current) gameRef.current.resume();
  }, [paused]);

  const quitToMenu = () => {
    if (gameRef.current) { gameRef.current.stop(); gameRef.current = null; }
    if (netRef.current) { try { netRef.current.close(); } catch (e) {} netRef.current = null; }
    setLobby(null);
    setPaused(false);
    setRadio([]);
    setBanner(null);
    setMode(null);
    setMenuMinimized(false);
    setScreen('menu');
  };

  const retry = () => {
    if (gameRef.current) { gameRef.current.stop(); gameRef.current = null; }
    setEndStats(null);
    if (mode === 'solo') {
      // remount canvas with new client
      setScreen('idle-tmp');
      setTimeout(() => { setScreen('game'); setGameState('playing'); }, 30);
    } else {
      // For MP, retry kicks back to lobby (host can restart)
      quitToMenu();
    }
  };

  return (
    <>
      {screen === 'intro' && <Intro onDone={finishIntro} />}
      {screen === 'menu' && (
        <>
          <canvas ref={canvasRef} class="game-canvas" />
          {!menuMinimized ? (
            <MainMenu
              profile={profile}
              setProfile={setProfile}
              onSolo={startSolo}
              onHost={hostMP}
              onJoin={joinMP}
              onMinimize={() => setMenuMinimized(true)}
              error={error}
              clearError={() => setError(null)}
            />
          ) : (
            <button class="floating-play" onClick={() => setMenuMinimized(false)}>
              <span class="fp-label">PLAY</span>
              <span class="fp-sub">Hilltop Echo · stand to</span>
            </button>
          )}
        </>
      )}
      {screen === 'lobby' && lobby && (
        <Lobby
          profile={profile}
          lobby={lobby}
          isHost={lobby.hostId === lobby.yourId}
          onStart={startGameAsHost}
          onLeave={leaveRoom}
          onReady={setLobbyReady}
          error={error}
          clearError={() => setError(null)}
        />
      )}
      {screen === 'game' && (
        <>
          <canvas ref={canvasRef} class="game-canvas" />
          <HUD gameRef={gameRef} localId={() => gameRef.current?.localPlayerId} />
          {banner && <WaveBanner banner={banner} />}
          <RadioStack messages={radio} />
          <HitVignette pulseKey={hurtPulse} />
          {IS_TOUCH && gameState === 'playing' && !paused && <TouchControls gameRef={gameRef} />}
          {gameState === 'shop' && <Shop gameRef={gameRef} />}
          {paused && <Pause onResume={() => setPaused(false)} onQuit={quitToMenu} />}
          {(gameState === 'gameover' || gameState === 'victory') && endStats && (
            <GameOver
              stats={endStats}
              onRetry={retry}
              onMenu={quitToMenu}
            />
          )}
        </>
      )}
      {connecting && <ConnectingOverlay label={connecting} onCancel={() => { setConnecting(null); if (netRef.current) netRef.current.close(); }} />}
    </>
  );
}
