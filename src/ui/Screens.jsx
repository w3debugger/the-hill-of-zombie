import { useState, useEffect, useRef } from 'preact/hooks';
import { INTRO_TEXT, PLAYER_COLORS } from '../game/data.js';

// ---------- INTRO ----------
export function Intro({ onDone }) {
  const [skipping, setSkipping] = useState(false);
  const [phase, setPhase] = useState('coldOpen'); // 'coldOpen' | 'crawl'
  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') onDone(); };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => setPhase('crawl'), 3400);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [onDone]);
  return (
    <div class={`intro ${skipping ? 'fading' : ''}`}>
      <div class="intro-bg" />
      <div class="intro-scan" />
      <div class="intro-flicker" />
      <div class="intro-vignette" />

      {phase === 'coldOpen' && (
        <div class="intro-coldopen">
          <div class="intro-tape-line">▌ FIELD RECORDING · TAPE 047</div>
          <div class="intro-tape-line dim">BLACK RIDGE · FALL 2031</div>
          <div class="intro-tape-line stamp">[ RECOVERED ]</div>
        </div>
      )}

      {phase === 'crawl' && (
        <div class="intro-scroll">
          <div class="intro-marker" />
          {INTRO_TEXT.map((line, i) => (
            line.kind === 'header'
              ? <h1 class="intro-h">{line.text}</h1>
              : line.kind === 'space'
              ? <div class="intro-space" />
              : <p class="intro-p">{line.text}</p>
          ))}
          <div class="intro-end">
            <p class="intro-tag">— PRESS ANY KEY —</p>
          </div>
        </div>
      )}

      <button class="intro-skip" onClick={() => { setSkipping(true); setTimeout(onDone, 220); }}>SKIP</button>
    </div>
  );
}

// ---------- MAIN MENU ----------
export function MainMenu({ profile, setProfile, onSolo, onHost, onJoin, onMinimize, error, clearError }) {
  const [showJoin, setShowJoin] = useState(false);
  const [code, setCode] = useState('');
  return (
    <div class="overlay">
      <div class="menu-card big">
        {onMinimize && (
          <button
            class="menu-minimize"
            onClick={onMinimize}
            title="Browse the area"
            aria-label="Browse the area"
          >–</button>
        )}
        <h1 class="title">THE HILL OF ZOMBIE</h1>
        <p class="subtitle">One sniper. One bunker tower. Hold until daybreak.</p>

        <div class="profile-row">
          <div class="field">
            <label>CALL SIGN</label>
            <input
              type="text"
              maxLength={16}
              value={profile.name}
              onInput={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>
          <div class="field">
            <label>COLOR</label>
            <div class="color-row">
              {PLAYER_COLORS.map(c => (
                <button
                  key={c}
                  class={`color-chip ${c === profile.color ? 'sel' : ''}`}
                  style={{ background: c }}
                  onClick={() => setProfile({ ...profile, color: c })}
                />
              ))}
            </div>
          </div>
        </div>

        {!showJoin ? (
          <>
            <button class="btn primary big-btn" onClick={onSolo}>PLAY SOLO</button>
            <div class="btn-row">
              <button class="btn" onClick={onHost}>HOST CO-OP</button>
              <button class="btn" onClick={() => { setShowJoin(true); clearError?.(); }}>JOIN CO-OP</button>
            </div>
          </>
        ) : (
          <div class="join-row">
            <input
              type="text"
              class="code-input"
              maxLength={4}
              placeholder="CODE"
              value={code}
              onInput={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              autoFocus
            />
            <button
              class="btn primary"
              disabled={code.length !== 4}
              onClick={() => onJoin(code)}
            >JOIN</button>
            <button class="btn ghost" onClick={() => setShowJoin(false)}>CANCEL</button>
          </div>
        )}

        {error && <div class="error">{error}</div>}

        <details class="controls-details">
          <summary>CONTROLS</summary>
          <div class="controls">
            <div class="ctrl"><kbd>WASD</kbd> Move</div>
            <div class="ctrl"><kbd>MOUSE</kbd> Aim</div>
            <div class="ctrl"><kbd>LMB</kbd> Fire</div>
            <div class="ctrl"><kbd>R</kbd> Reload</div>
            <div class="ctrl"><kbd>1-4</kbd> Weapons</div>
            <div class="ctrl"><kbd>SHIFT</kbd> Sprint</div>
            <div class="ctrl"><kbd>SPACE</kbd> Dodge</div>
            <div class="ctrl"><kbd>ESC</kbd> Pause</div>
          </div>
        </details>

        <div class="version">v1.0 · canvas2d · preact · ws</div>
      </div>
    </div>
  );
}

// ---------- LOBBY ----------
export function Lobby({ profile, lobby, isHost, onStart, onLeave, onReady, error }) {
  const [readyState, setReadyState] = useState(false);
  const allReady = lobby.players.length > 0 && lobby.players.every(p => p.ready || p.id === lobby.hostId);
  const canStart = isHost && lobby.players.length >= 1 && (lobby.players.length === 1 || allReady);

  const setReady = (r) => { setReadyState(r); onReady(r); };

  const copyCode = () => {
    try { navigator.clipboard?.writeText(lobby.code); } catch (e) {}
  };

  return (
    <div class="overlay">
      <div class="menu-card big">
        <h2 class="title small">SQUAD ASSEMBLY</h2>
        <div class="room-code">
          <div class="code-label">ROOM CODE</div>
          <button class="code-display" onClick={copyCode} title="Click to copy">{lobby.code}</button>
          <div class="hint">share this with your squadmates</div>
        </div>

        <div class="player-list">
          {lobby.players.map(p => (
            <div key={p.id} class={`player-row ${p.id === lobby.yourId ? 'you' : ''}`}>
              <span class="dot" style={{ background: p.color }} />
              <span class="player-name">{p.name}</span>
              {p.id === lobby.hostId && <span class="badge-tag host">HOST</span>}
              {p.id === lobby.yourId && <span class="badge-tag you-tag">YOU</span>}
              {p.id !== lobby.hostId && (
                p.ready ? <span class="badge-tag ready">READY</span> : <span class="badge-tag waiting">WAITING</span>
              )}
            </div>
          ))}
          {Array.from({ length: Math.max(0, 10 - lobby.players.length) }).map((_, i) => (
            <div key={`empty-${i}`} class="player-row empty">
              <span class="dot empty-dot" />
              <span class="player-name">— empty slot —</span>
            </div>
          ))}
        </div>

        {error && <div class="error">{error}</div>}

        <div class="lobby-buttons">
          {isHost ? (
            <button class="btn primary" disabled={!canStart} onClick={onStart}>
              {canStart ? 'START MATCH' : (lobby.players.length === 1 ? 'WAITING FOR SQUAD' : 'WAITING FOR READY')}
            </button>
          ) : (
            <button
              class={`btn ${readyState ? 'primary' : ''}`}
              onClick={() => setReady(!readyState)}
            >
              {readyState ? 'READY ✓' : 'MARK READY'}
            </button>
          )}
          <button class="btn ghost" onClick={onLeave}>LEAVE</button>
        </div>
      </div>
    </div>
  );
}

// ---------- GAME OVER ----------
export function GameOver({ stats, onRetry, onMenu }) {
  return (
    <div class="overlay solid">
      <div class="menu-card big">
        <h1 class={`title ${stats.won ? 'win' : 'dead'}`}>{stats.won ? 'DAYBREAK' : 'TOWER OVERRUN'}</h1>
        <p class="subtitle">{stats.won
          ? 'Sun’s up. The dead are pulling back. Hilltop Echo holds.'
          : 'The signal goes dark. The convoys will not make the coast.'}</p>
        <div class="stats">
          <div><span class="lbl">Waves survived</span><span>{stats.wave}</span></div>
          <div><span class="lbl">Personal kills</span><span>{stats.kills}</span></div>
          <div><span class="lbl">Personal score</span><span>{stats.score}</span></div>
        </div>
        {stats.players && stats.players.length > 1 && (
          <div class="leaderboard">
            <div class="lb-head">SQUAD</div>
            {stats.players.sort((a, b) => b.score - a.score).map((p) => (
              <div class="lb-row" key={p.name}>
                <span class="dot" style={{ background: p.color }} />
                <span class="lb-name">{p.name}</span>
                <span class="lb-stat">{p.kills} kills</span>
                <span class="lb-stat">{p.score} pts</span>
              </div>
            ))}
          </div>
        )}
        <div class="btn-row">
          <button class="btn primary" onClick={onRetry}>TRY AGAIN</button>
          <button class="btn ghost" onClick={onMenu}>MAIN MENU</button>
        </div>
      </div>
    </div>
  );
}

// ---------- CONNECTING ----------
export function ConnectingOverlay({ label, onCancel }) {
  return (
    <div class="overlay">
      <div class="menu-card small">
        <div class="spinner" />
        <p class="connecting-label">{label}</p>
        <button class="btn ghost" onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  );
}
