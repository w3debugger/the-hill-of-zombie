import { useEffect, useRef, useState } from 'preact/hooks';
import { WEAPONS, WEAPON_ORDER, SHOP_ITEMS, shopPrice } from '../game/data.js';

// ---------- HUD ----------
// Updates DOM directly via refs each frame to keep Preact out of the hot path.
export function HUD({ gameRef }) {
  const refs = {
    wave: useRef(null),
    zombies: useRef(null),
    score: useRef(null),
    cash: useRef(null),
    health: useRef(null),
    hill: useRef(null),
    weaponName: useRef(null),
    weaponAmmo: useRef(null),
    slots: useRef(null),
    players: useRef(null),
    muteBtn: useRef(null),
  };
  const [tabHeld, setTabHeld] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Tab') setTabHeld(true); };
    const onUp  = (e) => { if (e.code === 'Tab') setTabHeld(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  useEffect(() => {
    let raf;
    const tick = () => {
      const game = gameRef.current;
      if (game && game.world) {
        const w = game.world;
        const me = w.players.find(p => p.id === game.localPlayerId) || w.players[0];
        if (refs.wave.current) refs.wave.current.textContent = w.waveNum || '—';
        if (refs.zombies.current) refs.zombies.current.textContent = w.remainingZombies ?? (w.zombies?.length || 0);
        if (refs.score.current) refs.score.current.textContent = me?.score ?? 0;
        if (refs.cash.current) refs.cash.current.textContent = '$' + (w.cash ?? 0);
        if (me) {
          const hpPct = Math.max(0, Math.min(1, me.hp / me.maxHp));
          if (refs.health.current) refs.health.current.style.width = (hpPct * 100) + '%';
        }
        const hillPct = Math.max(0, Math.min(1, w.hill.hp / w.hill.maxHp));
        if (refs.hill.current) refs.hill.current.style.width = (hillPct * 100) + '%';
        if (me) {
          const wpn = WEAPONS[me.weapon];
          if (refs.weaponName.current) refs.weaponName.current.textContent = wpn.name;
          if (refs.weaponAmmo.current) {
            refs.weaponAmmo.current.textContent = (wpn.magSize === Infinity)
              ? '∞'
              : `${me.mag[wpn.key]} / ${me.ammoReserve[wpn.key]}`;
          }
          if (refs.slots.current) {
            for (let i = 0; i < refs.slots.current.children.length; i++) {
              const node = refs.slots.current.children[i];
              const k = WEAPON_ORDER[i];
              node.classList.toggle('owned', !!me.owned[k]);
              node.classList.toggle('active', me.weapon === k);
            }
          }
        }
        // Players list (during Tab)
        if (refs.players.current) {
          refs.players.current.innerHTML = w.players.map(p => `
            <div class="pl-row${p.dead ? ' dead' : ''}">
              <span class="dot" style="background:${p.color}"></span>
              <span class="pl-name">${escapeHtml(p.name)}</span>
              <span class="pl-stat">${p.score}</span>
              <span class="pl-stat">${p.kills}k</span>
              <span class="pl-hp"><span style="width:${Math.max(0,p.hp/p.maxHp)*100}%;background:${p.dead ? '#5a1a1a' : (p.hp/p.maxHp>0.4?'#9affb6':'#ff7d7d')}"></span></span>
            </div>
          `).join('');
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    gameRef.current?.audio.setMuted(next);
  };
  const toggleFullscreen = () => {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFs) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else {
      const el = document.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }
  };

  return (
    <div class="hud">
      <div class="hud-top">
        <div class="hud-top-left">
          <div class="stats-strip">
            <span class="stat"><b ref={refs.wave}>—</b><i>WAVE</i></span>
            <span class="stat"><b ref={refs.zombies}>0</b><i>LEFT</i></span>
            <span class="stat"><b ref={refs.score}>0</b><i>SCORE</i></span>
            <span class="stat gold"><b ref={refs.cash}>$0</b><i>CASH</i></span>
          </div>
          <div class="hud-bars">
            <div class="bar health" title="Health">
              <span class="bar-fill" ref={refs.health}></span>
            </div>
            <div class="bar hill" title="Signal Tower">
              <span class="bar-fill" ref={refs.hill}></span>
            </div>
          </div>
        </div>
        <div class="hud-top-right">
          <button
            class={`icon-btn fs-btn ${fullscreen ? 'active' : ''}`}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? '⛶' : '⛶'}
          </button>
          <button class="icon-btn mute-btn" ref={refs.muteBtn} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      <div class={`players-overlay ${tabHeld ? 'visible' : ''}`}>
        <div class="po-head">SQUAD</div>
        <div class="po-list" ref={refs.players}></div>
      </div>

      <div class="hud-weapon">
        <div class="wp-line">
          <span class="wp-name" ref={refs.weaponName}>PISTOL</span>
          <span class="wp-ammo" ref={refs.weaponAmmo}>∞</span>
        </div>
        <div class="wp-slots" ref={refs.slots}>
          {WEAPON_ORDER.map((k, i) => (
            <div
              class={`slot ${k === 'pistol' ? 'owned active' : ''}`}
              key={k}
              onClick={() => { const g = gameRef.current; if (g) g.input.weaponEdge = k; }}
            >{i + 1}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------- WAVE BANNER ----------
export function WaveBanner({ banner }) {
  return (
    <div class="wave-banner" key={banner.n}>
      {banner.name && <div class="wb-name">{banner.name}</div>}
      <div class="wb-num">WAVE {banner.n}</div>
      {banner.sub && <div class="wb-sub">{banner.sub}</div>}
    </div>
  );
}

// ---------- HIT VIGNETTE ----------
export function HitVignette({ pulseKey }) {
  return <div class="hit-vignette" key={pulseKey} />;
}

// ---------- RADIO STACK ----------
export function RadioStack({ messages }) {
  return (
    <div class="radio-stack">
      {messages.map(m => (
        <div class="radio-msg" key={m.id}>
          <div class="radio-from">[{m.from}]</div>
          <div class="radio-text">{m.text}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- SHOP ----------
export function Shop({ gameRef }) {
  const cashRef = useRef(null);
  const itemsRef = useRef(null);
  const [readyHeld, setReadyHeld] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // Mirror selectedId into a ref so the rAF tick can read/clear it without
  // re-subscribing each render.
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;
  const setSelected = (id) => { selectedRef.current = id; setSelectedId(id); };

  useEffect(() => {
    let raf;
    const tick = () => {
      const game = gameRef.current;
      if (game && game.world) {
        const w = game.world;
        if (cashRef.current) cashRef.current.textContent = '$' + w.cash;
        // Update item enabled / owned / selected states
        if (itemsRef.current) {
          const me = w.players.find(p => p.id === game.localPlayerId);
          let selectedStillValid = false;
          for (const node of itemsRef.current.children) {
            const id = node.dataset.id;
            const item = SHOP_ITEMS.find(it => it.id === id);
            if (!item || !me) continue;
            const ownedLevel = item.type === 'upgrade' ? me.upgrades[item.key] : 0;
            const price = shopPrice(item, ownedLevel);
            const owned = (item.type === 'weapon' && me.owned[item.key])
              || (item.type === 'upgrade' && me.upgrades[item.key] >= item.max);
            const disabled = !owned && w.cash < price;
            node.classList.toggle('owned', !!owned);
            node.classList.toggle('disabled', disabled);
            const isSelected = selectedRef.current === id && !owned && !disabled;
            node.classList.toggle('selected', isSelected);
            if (isSelected) selectedStillValid = true;
            const priceEl = node.querySelector('.price');
            if (priceEl) {
              priceEl.textContent = owned
                ? 'OWNED'
                : (item.type === 'upgrade'
                    ? `$${price}  (Lv ${me.upgrades[item.key]}/${item.max})`
                    : '$' + price);
            }
          }
          // Selected item became owned or unaffordable — clear it.
          if (selectedRef.current && !selectedStillValid) setSelected(null);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleItemClick = (e, item) => {
    // Ignore clicks on owned or unaffordable items (their classes are managed
    // by the rAF tick on the DOM node, not in props).
    const node = e.currentTarget;
    if (node.classList.contains('owned') || node.classList.contains('disabled')) return;
    setSelected(selectedRef.current === item.id ? null : item.id);
  };
  const confirmBuy = () => {
    const id = selectedRef.current;
    if (!id) return;
    gameRef.current?.buy(id);
    setSelected(null);
  };
  const toggleReady = () => {
    const next = !readyHeld;
    setReadyHeld(next);
    gameRef.current?.setReady(next);
  };

  // Reset ready on unmount
  useEffect(() => () => gameRef.current?.setReady(false), []);

  const selectedItem = selectedId ? SHOP_ITEMS.find(it => it.id === selectedId) : null;

  return (
    <div class="overlay shop-overlay">
      <div class="shop-card">
        <div class="shop-head">
          <h2>BETWEEN WAVES</h2>
          <div class="shop-cash">CASH: <span ref={cashRef}>$0</span></div>
        </div>
        <div class="shop-body" ref={itemsRef}>
          {SHOP_ITEMS.map(item => (
            <div
              class="shop-item"
              key={item.id}
              data-id={item.id}
              onClick={(e) => handleItemClick(e, item)}
            >
              <div class="name">{item.name}</div>
              <div class="desc">{item.desc}</div>
              <div class="price">$0</div>
            </div>
          ))}
        </div>
        <div class="shop-foot">
          <button
            class="btn"
            disabled={!selectedItem}
            onClick={confirmBuy}
          >
            {selectedItem ? `BUY ${selectedItem.name}` : 'SELECT AN ITEM'}
          </button>
          <button class={`btn ${readyHeld ? 'primary' : ''}`} onClick={toggleReady}>
            {readyHeld ? 'READY ✓' : 'NEXT WAVE'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- PAUSE ----------
export function Pause({ onResume, onQuit }) {
  return (
    <div class="overlay solid">
      <div class="menu-card small">
        <h2 class="title small">PAUSED</h2>
        <button class="btn primary big-btn" onClick={onResume}>RESUME</button>
        <button class="btn ghost" onClick={onQuit}>QUIT TO MENU</button>
      </div>
    </div>
  );
}

// ---------- TOUCH CONTROLS ----------
// Left side: fixed thumbstick pinned to the bottom-left (its CSS position).
// Right side: fire button. Both use PointerEvents so a single finger on each
// side works simultaneously.
function nextOwnedWeapon(p) {
  const i = WEAPON_ORDER.indexOf(p.weapon);
  for (let off = 1; off < WEAPON_ORDER.length; off++) {
    const k = WEAPON_ORDER[(i + off) % WEAPON_ORDER.length];
    if (p.owned[k]) return k;
  }
  return p.weapon;
}

export function TouchControls({ gameRef }) {
  const stickZoneRef = useRef(null);
  const knobRef = useRef(null);
  const baseRef = useRef(null);
  const fireBtnRef = useRef(null);
  const swapBtnRef = useRef(null);
  const swapLabelRef = useRef(null);
  const stateRef = useRef({ joyId: null, cx: 0, cy: 0, fireId: null });

  // Keep the swap button's label synced to the next-cycle weapon, and hide it
  // when the player only owns the pistol (nothing to swap to).
  useEffect(() => {
    let raf;
    const tick = () => {
      const g = gameRef.current;
      const btn = swapBtnRef.current;
      const lbl = swapLabelRef.current;
      if (g && g.world && btn && lbl) {
        const me = g.world.players.find(p => p.id === g.localPlayerId);
        if (me) {
          const ownedCount = WEAPON_ORDER.reduce((n, k) => n + (me.owned[k] ? 1 : 0), 0);
          btn.style.display = ownedCount > 1 ? '' : 'none';
          if (ownedCount > 1) {
            const next = nextOwnedWeapon(me);
            lbl.textContent = WEAPONS[next].name;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const zone = stickZoneRef.current;
    const knob = knobRef.current;
    const base = baseRef.current;
    const fireBtn = fireBtnRef.current;
    if (!zone || !knob || !base || !fireBtn) return;

    const MAX = 60; // joystick travel radius in px

    const setKnob = (dx, dy) => {
      const m = Math.hypot(dx, dy);
      const k = m > MAX ? MAX / m : 1;
      const kx = dx * k, ky = dy * k;
      knob.style.transform = `translate(${kx}px, ${ky}px)`;
      const nx = kx / MAX, ny = ky / MAX;
      gameRef.current?.input.setJoystick(nx, ny);
    };

    const onZoneDown = (e) => {
      if (stateRef.current.joyId !== null) return;
      e.preventDefault();
      const id = e.pointerId;
      stateRef.current.joyId = id;
      const br = base.getBoundingClientRect();
      const cx = br.left + br.width / 2;
      const cy = br.top + br.height / 2;
      stateRef.current.cx = cx;
      stateRef.current.cy = cy;
      base.classList.add('active');
      setKnob(e.clientX - cx, e.clientY - cy);
      try { zone.setPointerCapture(id); } catch {}
    };
    const onZoneMove = (e) => {
      if (stateRef.current.joyId !== e.pointerId) return;
      const dx = e.clientX - stateRef.current.cx;
      const dy = e.clientY - stateRef.current.cy;
      setKnob(dx, dy);
    };
    const onZoneUp = (e) => {
      if (stateRef.current.joyId !== e.pointerId) return;
      stateRef.current.joyId = null;
      base.classList.remove('active');
      knob.style.transform = 'translate(0,0)';
      gameRef.current?.input.setJoystick(0, 0);
      try { zone.releasePointerCapture(e.pointerId); } catch {}
    };

    const onFireDown = (e) => {
      e.preventDefault();
      stateRef.current.fireId = e.pointerId;
      fireBtn.classList.add('active');
      gameRef.current?.input.setTouchFire(true);
      try { fireBtn.setPointerCapture(e.pointerId); } catch {}
    };
    const onFireUp = (e) => {
      if (stateRef.current.fireId !== e.pointerId) return;
      stateRef.current.fireId = null;
      fireBtn.classList.remove('active');
      gameRef.current?.input.setTouchFire(false);
      try { fireBtn.releasePointerCapture(e.pointerId); } catch {}
    };

    const swapBtn = swapBtnRef.current;
    const onSwap = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const g = gameRef.current;
      if (!g || !g.world) return;
      const me = g.world.players.find(p => p.id === g.localPlayerId);
      if (!me) return;
      const next = nextOwnedWeapon(me);
      if (next && next !== me.weapon) g.input.weaponEdge = next;
    };

    zone.addEventListener('pointerdown', onZoneDown);
    zone.addEventListener('pointermove', onZoneMove);
    zone.addEventListener('pointerup', onZoneUp);
    zone.addEventListener('pointercancel', onZoneUp);
    fireBtn.addEventListener('pointerdown', onFireDown);
    fireBtn.addEventListener('pointerup', onFireUp);
    fireBtn.addEventListener('pointercancel', onFireUp);
    if (swapBtn) swapBtn.addEventListener('pointerdown', onSwap);

    return () => {
      zone.removeEventListener('pointerdown', onZoneDown);
      zone.removeEventListener('pointermove', onZoneMove);
      zone.removeEventListener('pointerup', onZoneUp);
      zone.removeEventListener('pointercancel', onZoneUp);
      fireBtn.removeEventListener('pointerdown', onFireDown);
      fireBtn.removeEventListener('pointerup', onFireUp);
      fireBtn.removeEventListener('pointercancel', onFireUp);
      if (swapBtn) swapBtn.removeEventListener('pointerdown', onSwap);
    };
  }, []);

  return (
    <div class="touch-controls">
      <div class="touch-stick" ref={stickZoneRef}>
        <div class="touch-stick-base" ref={baseRef}>
          <div class="touch-stick-arrows" aria-hidden="true">
            <span class="ts-arrow up">▲</span>
            <span class="ts-arrow down">▼</span>
            <span class="ts-arrow left">◀</span>
            <span class="ts-arrow right">▶</span>
          </div>
          <div class="touch-stick-knob" ref={knobRef}></div>
        </div>
        <div class="touch-stick-hint">MOVE</div>
      </div>
      <button class="touch-fire" ref={fireBtnRef} aria-label="Fire">
        <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
          <path d="M32 4c-2 8-7 12-12 16-6 5-10 11-10 20a22 22 0 0 0 44 0c0-7-3-12-7-17-2 3-5 4-7 3 2-9-2-17-8-22z"
                fill="#ff5a3c" stroke="#ffd28a" stroke-width="2" stroke-linejoin="round" />
          <path d="M32 22c-1 5-4 8-7 11-3 3-5 6-5 11a12 12 0 0 0 24 0c0-4-2-7-4-9-2 2-4 2-5 1 1-5-1-10-3-14z"
                fill="#ffd166" />
        </svg>
        <span class="touch-fire-label">FIRE</span>
      </button>
      <button class="touch-swap" ref={swapBtnRef} aria-label="Switch weapon">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <path d="M7 7h11l-3-3M17 17H6l3 3" fill="none" stroke="#ffd6b0" stroke-width="2.4"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="touch-swap-label" ref={swapLabelRef}>SWAP</span>
      </button>
    </div>
  );
}
