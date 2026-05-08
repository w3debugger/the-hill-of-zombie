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

  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Tab') setTabHeld(true); };
    const onUp  = (e) => { if (e.code === 'Tab') setTabHeld(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
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

  return (
    <div class="hud">
      <div class="hud-row top">
        <div class="badge"><div class="lbl">WAVE</div><div class="val" ref={refs.wave}>—</div></div>
        <div class="badge"><div class="lbl">INFECTED</div><div class="val" ref={refs.zombies}>0</div></div>
        <div class="badge"><div class="lbl">SCORE</div><div class="val" ref={refs.score}>0</div></div>
        <div class="badge gold"><div class="lbl">CASH</div><div class="val" ref={refs.cash}>$0</div></div>
        <div class="grow" />
        <button class="mute-btn" ref={refs.muteBtn} onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div class={`players-overlay ${tabHeld ? 'visible' : ''}`}>
        <div class="po-head">SQUAD</div>
        <div class="po-list" ref={refs.players}></div>
      </div>

      <div class="hud-row bottom">
        <div class="bars">
          <div class="bar health">
            <div class="bar-label">HEALTH</div>
            <div class="bar-track"><div class="bar-fill" ref={refs.health}></div></div>
          </div>
          <div class="bar hill">
            <div class="bar-label">SIGNAL TOWER</div>
            <div class="bar-track"><div class="bar-fill" ref={refs.hill}></div></div>
          </div>
        </div>
        <div class="weapon-panel">
          <div class="weapon-name" ref={refs.weaponName}>PISTOL</div>
          <div class="weapon-ammo" ref={refs.weaponAmmo}>∞</div>
          <div class="weapon-slots" ref={refs.slots}>
            {WEAPON_ORDER.map((k, i) => (
              <div class={`slot ${k === 'pistol' ? 'owned active' : ''}`} key={k}>{i + 1}</div>
            ))}
          </div>
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
  const [, force] = useState(0);
  const cashRef = useRef(null);
  const itemsRef = useRef(null);
  const [readyHeld, setReadyHeld] = useState(false);

  useEffect(() => {
    let raf;
    const tick = () => {
      const game = gameRef.current;
      if (game && game.world) {
        const w = game.world;
        if (cashRef.current) cashRef.current.textContent = '$' + w.cash;
        // Update item enabled / owned states
        if (itemsRef.current) {
          const me = w.players.find(p => p.id === game.localPlayerId);
          for (const node of itemsRef.current.children) {
            const id = node.dataset.id;
            const item = SHOP_ITEMS.find(it => it.id === id);
            if (!item || !me) continue;
            const ownedLevel = item.type === 'upgrade' ? me.upgrades[item.key] : 0;
            const price = shopPrice(item, ownedLevel);
            const owned = (item.type === 'weapon' && me.owned[item.key])
              || (item.type === 'upgrade' && me.upgrades[item.key] >= item.max);
            node.classList.toggle('owned', !!owned);
            node.classList.toggle('disabled', !owned && w.cash < price);
            const priceEl = node.querySelector('.price');
            if (priceEl) {
              priceEl.textContent = owned
                ? 'OWNED'
                : (item.type === 'upgrade'
                    ? `$${price}  (Lv ${me.upgrades[item.key]}/${item.max})`
                    : '$' + price);
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const buy = (id) => gameRef.current?.buy(id);
  const toggleReady = () => {
    const next = !readyHeld;
    setReadyHeld(next);
    gameRef.current?.setReady(next);
  };

  // Reset ready on unmount
  useEffect(() => () => gameRef.current?.setReady(false), []);

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
              onClick={() => buy(item.id)}
            >
              <div class="name">{item.name}</div>
              <div class="desc">{item.desc}</div>
              <div class="price">$0</div>
            </div>
          ))}
        </div>
        <div class="shop-foot">
          <div class="hint">tip: pickups still magnetize toward you in the shop</div>
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
