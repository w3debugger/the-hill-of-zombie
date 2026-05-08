import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { GameClient } from '../game/client.js';
import { NetClient } from '../net/client.js';
import { C2S, S2C } from '../net/protocol.js';
import { Intro, MainMenu, Lobby, GameOver, ConnectingOverlay } from './Screens.jsx';
import { HUD, Shop, Pause, RadioStack, WaveBanner, HitVignette } from './InGame.jsx';
import { PLAYER_COLORS } from '../game/data.js';

const WS_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_WS_URL)
  || (typeof window !== 'undefined' ? `ws://${window.location.hostname}:3001` : 'ws://localhost:3001');

function loadProfile() {
  try {
    const s = localStorage.getItem('hoz.profile');
    if (s) return JSON.parse(s);
  } catch (e) {}
  return { name: 'Sgt. Vance', color: PLAYER_COLORS[0] };
}
function saveProfile(p) {
  try { localStorage.setItem('hoz.profile', JSON.stringify(p)); } catch (e) {}
}

export function App() {
  const [screen, setScreen] = useState(() => (localStorage.getItem('hoz.seenIntro') ? 'menu' : 'intro'));
  const [profile, setProfileState] = useState(loadProfile);
  const setProfile = (p) => { saveProfile(p); setProfileState(p); };
  const [mode, setMode] = useState(null);            // 'solo' | 'mp'
  const [lobby, setLobby] = useState(null);          // { code, players, hostId, yourId }
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(null); // string label or null

  const [gameState, setGameState] = useState('idle'); // 'playing'|'shop'|'paused'|'gameover'|'victory'
  const [paused, setPaused] = useState(false);
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
    localStorage.setItem('hoz.seenIntro', '1');
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
    catch (e) { setConnecting(null); setError('Could not reach server. Is it running on port 3001?'); return; }
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
    catch (e) { setConnecting(null); setError('Could not reach server.'); return; }
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

  // Initialize GameClient when entering 'game' screen
  useEffect(() => {
    if (screen !== 'game') return;
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
      // Wave banner for wave 1 (solo + mp)
      if (mode === 'solo') {
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
        <MainMenu
          profile={profile}
          setProfile={setProfile}
          onSolo={startSolo}
          onHost={hostMP}
          onJoin={joinMP}
          error={error}
          clearError={() => setError(null)}
        />
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
