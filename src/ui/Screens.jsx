import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { INTRO_TEXT, PLAYER_COLORS } from '../game/data.js';
import { AudioBus } from '../game/audio.js';

// ---------- INTRO ----------
//
// Interactive horror cold-open. The user clicks (or presses Space/Enter) to
// unlock audio and advance chapter-by-chapter. Each click triggers a paired
// horror cue: tape hiss, whispers, distant moans, a jump-scare scream at the
// "none of them are breathing" beat, then a heartbeat that stays through the
// closing chapters. Final phase is an ENTER THE TOWER button.
//
// Audio note: browsers refuse Web Audio until a user gesture, so the very
// first phase is a "click to begin" gate. We build a local AudioBus there
// and tear it down (and stop ambience) on dismiss.
export function Intro({ onDone }) {
  const [phase, setPhase] = useState('start'); // 'start' | 'coldOpen' | 'chapter' | 'enter' | 'fading'
  const [chapter, setChapter] = useState(0);
  const [scare, setScare] = useState(0);   // bumped to retrigger flash/shake animations
  const audioRef = useRef(null);
  const advanceLockRef = useRef(false);
  const coldOpenTimerRef = useRef(null);

  // Group INTRO_TEXT into chapters by splitting on `space` separators.
  const chapters = useMemo(() => {
    const groups = [];
    let cur = [];
    for (const line of INTRO_TEXT) {
      if (line.kind === 'space') {
        if (cur.length) groups.push(cur);
        cur = [];
      } else {
        cur.push(line);
      }
    }
    if (cur.length) groups.push(cur);
    return groups;
  }, []);

  // Per-chapter horror cue. Index aligns with `chapters`. Chapter 2
  // (HILLTOP ECHO — "none of them are breathing") is the jump scare.
  const chapterCue = (idx) => {
    const a = audioRef.current;
    if (!a) return;
    switch (idx) {
      case 0: a.play('whisper'); break;
      case 1: a.play('groan'); setTimeout(() => a.play('whisper'), 600); break;
      case 2:
        a.play('scream');
        setTimeout(() => a.play('thunder'), 180);
        setScare(s => s + 1);
        break;
      case 3:
        a.play('drone');
        a.setHeartbeatIntensity(0.45);
        break;
      case 4:
        a.play('whisper');
        a.setHeartbeatIntensity(0.7);
        break;
      case 5:
        a.play('brute');
        a.setHeartbeatIntensity(0.95);
        break;
      default: a.play('whisper');
    }
  };

  const begin = () => {
    if (audioRef.current) return;
    const bus = new AudioBus();
    bus.ensure();
    audioRef.current = bus;
    bus.play('tape');
    setTimeout(() => bus.play('thunder'), 700);
    bus.startAmbience();
    setPhase('coldOpen');
    coldOpenTimerRef.current = setTimeout(() => {
      coldOpenTimerRef.current = null;
      setPhase('chapter');
      chapterCue(0);
    }, 3400);
  };

  const advance = () => {
    if (advanceLockRef.current) return;
    if (phase === 'start') { begin(); return; }
    if (phase === 'fading') return;
    if (phase === 'coldOpen') {
      if (coldOpenTimerRef.current) {
        clearTimeout(coldOpenTimerRef.current);
        coldOpenTimerRef.current = null;
      }
      setPhase('chapter');
      chapterCue(0);
      return;
    }
    if (phase === 'chapter') {
      const next = chapter + 1;
      if (next >= chapters.length) {
        audioRef.current?.play('drone');
        setPhase('enter');
        return;
      }
      // Brief lock so a held key doesn't flash through chapters.
      advanceLockRef.current = true;
      setTimeout(() => { advanceLockRef.current = false; }, 280);
      setChapter(next);
      chapterCue(next);
      return;
    }
    if (phase === 'enter') {
      finish();
    }
  };

  const finish = () => {
    if (phase === 'fading') return;
    if (coldOpenTimerRef.current) {
      clearTimeout(coldOpenTimerRef.current);
      coldOpenTimerRef.current = null;
    }
    setPhase('fading');
    const a = audioRef.current;
    if (a) {
      try { a.stopAmbience(); } catch (e) {}
    }
    setTimeout(onDone, 320);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Escape') { finish(); return; }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Cleanup if unmounted mid-intro (e.g. dev hot reload).
  useEffect(() => () => {
    if (coldOpenTimerRef.current) clearTimeout(coldOpenTimerRef.current);
    const a = audioRef.current;
    if (a) { try { a.stopAmbience(); } catch (e) {} }
  }, []);

  const handleClick = (e) => {
    // Skip button has its own handler — don't double-fire.
    if (e.target.closest('.intro-skip')) return;
    advance();
  };

  const isJumpScare = phase === 'chapter' && chapter === 2;
  const rootClass = [
    'intro',
    phase === 'fading' ? 'fading' : '',
    isJumpScare ? 'shake' : '',
  ].filter(Boolean).join(' ');

  return (
    <div class={rootClass} onClick={handleClick}>
      <div class="intro-bg" />
      <div class="intro-scan" />
      <div class="intro-flicker" />
      <div class="intro-vignette" />
      {scare > 0 && <div key={scare} class="intro-scare-flash" />}

      {phase === 'start' && (
        <div class="intro-start">
          <div class="intro-start-title">THE HILL OF ZOMBIE</div>
          <button class="intro-start-btn" onClick={(e) => { e.stopPropagation(); advance(); }}>
            <span class="intro-start-btn-line">▶ CLICK TO BEGIN</span>
            <span class="intro-start-btn-sub">headphones recommended</span>
          </button>
        </div>
      )}

      {phase === 'coldOpen' && (
        <div class="intro-coldopen">
          <div class="intro-tape-line">▌ FIELD RECORDING · TAPE 047</div>
          <div class="intro-tape-line dim">BLACK RIDGE · FALL 2031</div>
          <div class="intro-tape-line stamp">[ RECOVERED ]</div>
        </div>
      )}

      {phase === 'chapter' && (
        <div class="intro-chapter-wrap">
          <div class="intro-marker" />
          <div key={chapter} class="intro-chapter">
            {chapters[chapter].map((line) => (
              line.kind === 'header'
                ? <h1 class="intro-h">{line.text}</h1>
                : <p class="intro-p">{line.text}</p>
            ))}
          </div>
          <div class="intro-progress">
            {chapters.map((_, i) => (
              <span class={`intro-pip ${i === chapter ? 'on' : ''} ${i < chapter ? 'past' : ''}`} />
            ))}
          </div>
          <div class="intro-hint">— click anywhere · or press SPACE —</div>
        </div>
      )}

      {phase === 'enter' && (
        <div class="intro-enter-wrap">
          <div class="intro-h intro-enter-h">HOLD THE TOWER</div>
          <button class="intro-enter-btn" onClick={(e) => { e.stopPropagation(); finish(); }}>
            ENTER THE HILL
          </button>
          <div class="intro-hint dim">they are already on the slope</div>
        </div>
      )}

      <button class="intro-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>SKIP</button>
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
