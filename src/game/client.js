// GameClient: glues world + renderer + audio + input together.
// Supports solo (runs World locally) or multiplayer (renders snapshots from server).
//
// Multiplayer perf notes:
//  - Server snapshots are lean (no bullets, no immutable fields). The client
//    pieces together a "live"-shaped world from snapshots + cached static info.
//  - Snapshots are buffered and rendered ~INTERP_DELAY_MS in the past so 20 Hz
//    network ticks render as smooth 60 fps motion via lerp between two frames.
//  - The local player runs a lightweight prediction step each frame so input
//    feels instant; we reconcile against authoritative server position.
//  - Bullets are cosmetic on the wire — clients spawn them from 'fire' events
//    and simulate ballistics locally. Server stays authoritative for hits.

import { World } from './world.js';
import { Renderer } from './render.js';
import { AudioBus } from './audio.js';
import { Input } from './input.js';
import { RADIO_SCRIPT, WAVE_NAMES, WEAPONS, ZTYPES, TAU } from './data.js';
import { C2S } from '../net/protocol.js';

const INTERP_DELAY_MS = 100;
const SNAP_BUFFER_MS = 600;

let _cbId = 1;

export class GameClient {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.audio = new AudioBus();
    this.input = new Input(canvas);
    this.opts = opts;
    this.localWorld = null;
    this.world = null;       // current rendered world (live ref in solo, assembled in MP)
    this.localPlayerId = null;
    this.net = null;
    this.running = false;
    this.lastT = 0;
    this.lastState = null;
    this.lastWaveAnnounced = 0;
    this.paused = false;
    this.ambientGroanMs = 4000;

    // ----- Multiplayer-only state -----
    this.snapBuf = [];                 // array of { ts, snap }
    this.playerStatic = new Map();     // id -> { name, color, r }
    this.zombieStatic = new Map();     // id -> { type, r, maxHp, seed, wobble }
    this.pickupStatic = new Map();     // id -> { type, value }
    this.clientBullets = [];           // visual-only ballistic
    this.clientEnemyBullets = [];      // visual-only ballistic
    this.localPredict = null;          // { x, y, vx, vy, angle } for local player
    this.netStartTime = 0;

    // Cinematic kill-cam pacing
    this.localKillCount = 0;
    this.lastCinematicAt = -1e9;
    this.killCamEvery = 6;             // fire on every Nth local-player kill
    this.killCamCooldownMs = 8000;     // never fire more often than this
  }

  // Solo
  startSolo({ name = 'Sgt. Vance', color = '#5cc8ff' } = {}) {
    this.localWorld = new World();
    const me = this.localWorld.addPlayer('local', name, color);
    this.localPlayerId = me.id;
    this.renderer.setLocalPlayer(me.id);
    this.localWorld.startGame();
    this.world = this.localWorld.live();
    this._begin();
  }

  // Multiplayer (called after lobby Start)
  startMultiplayer(net, yourId) {
    this.net = net;
    this.localPlayerId = yourId;
    this.renderer.setLocalPlayer(yourId);
    this.netStartTime = performance.now();
    net.on('snapshot', (msg) => this._onSnapshot(msg));
    net.on('events', (msg) => this._handleEvents(msg.events));
    this._begin();
  }

  _begin() {
    this.audio.ensure();
    this.running = true;
    this.lastT = performance.now();
    this.canvas.style.cursor = 'none';
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    this.input.destroy();
    if (this.net) this.net.close();
    this.canvas.style.cursor = '';
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.lastT = performance.now(); }

  // UI hooks
  buy(itemId) { this.input.buyId = itemId; }
  setReady(b) { this.input.readyHeld = !!b; }

  _loop = (t) => {
    if (!this.running) return;
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.paused) {
      this.renderer.tick(0, this.input.mouse, this.world);
      this.renderer.draw(this.world, this.input.mouse);
      requestAnimationFrame(this._loop);
      return;
    }

    // Compute aim angle from local player
    const aim = this._computeAim();
    const inputState = this.input.snapshot(aim);
    inputState.buy = this.input.buyId;
    inputState.ready = !!this.input.readyHeld;
    this.input.buyId = null;

    if (this.localWorld) {
      // ----- Solo: authoritative simulation runs locally -----
      const events = this.localWorld.step(dt, { [this.localPlayerId]: inputState });
      this._handleEvents(events);
      this.world = this.localWorld.live();
      this._processStateTransitions();
    } else if (this.net) {
      // ----- Multiplayer: ship input, predict, simulate cosmetic bullets, build assembled world -----
      this.net.send(C2S.INPUT, { input: inputState });
      this._updateLocalPrediction(dt, inputState);
      this._updateClientBullets(dt);
      this.world = this._buildAssembledWorld(performance.now());
      this._processStateTransitions();
    }

    if (this.input.consumeEsc()) this.opts.onEsc?.();

    // Ambient groan
    this.ambientGroanMs -= dt * 1000;
    if (this.ambientGroanMs <= 0) {
      this.ambientGroanMs = 2200 + Math.random() * 3500;
      if (this.world && this.world.zombies && this.world.zombies.length > 0) this.audio.play('groan');
    }

    this.renderer.tick(dt, this.input.mouse, this.world);
    this.renderer.draw(this.world, this.input.mouse);
    requestAnimationFrame(this._loop);
  };

  _computeAim() {
    if (!this.world || !this.world.players) return 0;
    const lp = this.world.players.find(p => p.id === this.localPlayerId);
    if (!lp) return 0;
    if (this.input.touch.active) {
      const nz = this._nearestZombie(lp.x, lp.y, 700);
      if (nz) return Math.atan2(nz.y - lp.y, nz.x - lp.x);
      const t = this.input.touch;
      if (t.joyX !== 0 || t.joyY !== 0) return Math.atan2(t.joyY, t.joyX);
      return lp.angle ?? 0;
    }
    const mouse = this.input.mouse;
    const w = this.renderer.screenToWorld(mouse.sx, mouse.sy);
    return Math.atan2(w.y - lp.y, w.x - lp.x);
  }

  _nearestZombie(x, y, maxDist) {
    const zs = this.world?.zombies;
    if (!zs || zs.length === 0) return null;
    let best = null, bestD = maxDist * maxDist;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      const dx = z.x - x, dy = z.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = z; }
    }
    return best;
  }

  _processStateTransitions() {
    const state = this.world?.state;
    if (state !== this.lastState) {
      this.lastState = state;
      this.opts.onStateChange?.(state);
      if (state === 'victory') {
        this.audio.play('victory');
        for (const m of RADIO_SCRIPT.victory) this.opts.onRadio?.(m);
      } else if (state === 'gameover') {
        this.audio.play('defeat');
        for (const m of RADIO_SCRIPT.defeat) this.opts.onRadio?.(m);
      }
    }
    if (this.world?.waveNum && this.world.waveNum !== this.lastWaveAnnounced && this.world.inWave) {
      this.lastWaveAnnounced = this.world.waveNum;
      const n = this.world.waveNum;
      this.opts.onWaveBanner?.({ n, name: WAVE_NAMES[n] || '', sub: `${this.world.remainingZombies} infected approaching` });
    }
  }

  // ---------- Multiplayer: snapshot buffer + interpolation ----------

  _onSnapshot(snap) {
    const ts = performance.now();
    this.snapBuf.push({ ts, snap });
    while (this.snapBuf.length > 0 && this.snapBuf[0].ts < ts - SNAP_BUFFER_MS) {
      this.snapBuf.shift();
    }
    // Periodically prune static caches against the latest snapshot — cheap.
    this._pruneStatic(snap);
  }

  _pruneStatic(snap) {
    if (this.zombieStatic.size > snap.zombies.length + 16) {
      const live = new Set();
      for (const z of snap.zombies) live.add(z.id);
      for (const id of this.zombieStatic.keys()) if (!live.has(id)) this.zombieStatic.delete(id);
    }
    if (this.pickupStatic.size > snap.pickups.length + 16) {
      const live = new Set();
      for (const it of snap.pickups) live.add(it.id);
      for (const id of this.pickupStatic.keys()) if (!live.has(id)) this.pickupStatic.delete(id);
    }
  }

  _buildAssembledWorld(now) {
    if (this.snapBuf.length === 0) return null;
    const latest = this.snapBuf[this.snapBuf.length - 1].snap;
    const renderTime = now - INTERP_DELAY_MS;

    let s0 = null, s1 = null;
    for (let i = 0; i < this.snapBuf.length - 1; i++) {
      if (this.snapBuf[i].ts <= renderTime && this.snapBuf[i + 1].ts >= renderTime) {
        s0 = this.snapBuf[i]; s1 = this.snapBuf[i + 1]; break;
      }
    }
    if (!s0) {
      // Render time before our first snap, or after our latest — clamp.
      const tail = this.snapBuf[this.snapBuf.length - 1];
      const head = this.snapBuf[0];
      if (renderTime < head.ts) { s0 = head; s1 = head; }
      else { s0 = tail; s1 = tail; }
    }
    const span = s1.ts - s0.ts;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderTime - s0.ts) / span)) : 0;

    const players = lerpEntities(s0.snap.players, s1.snap.players, t);
    for (const p of players) {
      const st = this.playerStatic.get(p.id);
      if (st) { p.name = st.name; p.color = st.color; p.r = st.r; }
      else    { p.name = 'Player'; p.color = '#888'; p.r = 15; }
    }
    // Override the local player's transform with our prediction.
    if (this.localPredict && this.localPlayerId != null) {
      const me = players.find(pp => pp.id === this.localPlayerId);
      if (me && !me.dead) {
        me.x = this.localPredict.x;
        me.y = this.localPredict.y;
        me.vx = this.localPredict.vx;
        me.vy = this.localPredict.vy;
        me.angle = this.localPredict.angle;
      }
    }

    const zombies = lerpEntities(s0.snap.zombies, s1.snap.zombies, t);
    const elapsed = (now - this.netStartTime) / 1000;
    for (const z of zombies) {
      const st = this.zombieStatic.get(z.id);
      if (st) {
        z.type = st.type; z.r = st.r; z.maxHp = st.maxHp; z.seed = st.seed;
        // Server doesn't ship wobble; advance the per-zombie phase locally so
        // the renderer sees a steadily-animating value identical to the server's.
        z.wobble = st.wobble + elapsed * 4;
      } else {
        // Static info hasn't arrived yet — render with safe defaults for one
        // frame; the spawn event lands on the next 'events' burst.
        z.type = 'walker'; z.r = 15; z.maxHp = z.hp; z.seed = z.id; z.wobble = 0;
      }
    }

    const pickups = lerpEntities(s0.snap.pickups, s1.snap.pickups, t);
    for (const it of pickups) {
      const st = this.pickupStatic.get(it.id);
      if (st) { it.type = st.type; it.value = st.value; }
      else    { it.type = 'cash'; it.value = 0; }
    }

    return {
      tickN: latest.tickN,
      state: latest.state,
      cash: latest.cash,
      hill: latest.hill,
      waveNum: latest.waveNum,
      inWave: latest.inWave,
      remainingZombies: latest.remainingZombies,
      players,
      zombies,
      pickups,
      bullets: this.clientBullets,
      enemyBullets: this.clientEnemyBullets,
    };
  }

  // ---------- Local player prediction ----------
  // Mirrors a stripped-down version of World.updatePlayers movement so that
  // typing W/A/S/D moves the player on screen *immediately* instead of waiting
  // for the next round-trip. Snaps to authoritative position when error grows.
  _updateLocalPrediction(dt, inputState) {
    if (!this.localPlayerId || this.snapBuf.length === 0) return;
    const latestEntry = this.snapBuf[this.snapBuf.length - 1];
    const latest = latestEntry.snap;
    const serverMe = latest.players.find(p => p.id === this.localPlayerId);
    if (!serverMe) { this.localPredict = null; return; }
    if (serverMe.dead) {
      this.localPredict = { x: serverMe.x, y: serverMe.y, vx: 0, vy: 0, angle: serverMe.angle || 0 };
      return;
    }
    if (!this.localPredict) {
      this.localPredict = { x: serverMe.x, y: serverMe.y, vx: serverMe.vx, vy: serverMe.vy, angle: serverMe.angle };
    }

    // Reconcile against the server's *projected current* position, not the
    // raw snapshot. The latest snapshot describes where the server thought
    // we were `snapAge` seconds ago — naively comparing predict against that
    // stale value drags the predicted player backward every frame and makes
    // movement feel sluggish. Project forward by snapAge using server velocity.
    const snapAge = Math.min(0.5, Math.max(0, (performance.now() - latestEntry.ts) / 1000));
    const sx = serverMe.x + (serverMe.vx || 0) * snapAge;
    const sy = serverMe.y + (serverMe.vy || 0) * snapAge;
    const errX = sx - this.localPredict.x;
    const errY = sy - this.localPredict.y;
    const errMag = Math.hypot(errX, errY);
    const ix0 = clamp(inputState.mx || 0, -1, 1);
    const iy0 = clamp(inputState.my || 0, -1, 1);
    const inputMagPre = Math.hypot(ix0, iy0);
    if (errMag > 120) {
      // Hard snap on big drift (teleport / packet loss / dodge land).
      this.localPredict.x = serverMe.x;
      this.localPredict.y = serverMe.y;
      this.localPredict.vx = serverMe.vx;
      this.localPredict.vy = serverMe.vy;
    } else if (errMag > 0.5) {
      // Softer pull while actively moving — avoids fighting the player's input.
      // Faster pull when idle so we settle to authoritative position.
      const kRate = inputMagPre > 0 ? 2 : 8;
      const k = Math.min(1, kRate * dt);
      this.localPredict.x += errX * k;
      this.localPredict.y += errY * k;
    }

    // Apply input locally (matches World.updatePlayers movement curve).
    const ix = ix0;
    const iy = iy0;
    const inputMag = inputMagPre;
    const baseSpeed = 230 * Math.pow(1.15, serverMe.upgrades?.speed || 0);
    const sprinting = !!inputState.sprint && (serverMe.stamina || 0) > 0 && inputMag > 0;
    const speed = baseSpeed * (sprinting ? 1.45 : 1);
    const tvx = ix * speed, tvy = iy * speed;
    const lerpK = 1 - Math.exp(-12 * dt);
    this.localPredict.vx += (tvx - this.localPredict.vx) * lerpK;
    this.localPredict.vy += (tvy - this.localPredict.vy) * lerpK;
    this.localPredict.x += this.localPredict.vx * dt;
    this.localPredict.y += this.localPredict.vy * dt;
    this.localPredict.angle = (typeof inputState.ang === 'number') ? inputState.ang : this.localPredict.angle;
  }

  // ---------- Cosmetic bullet simulation ----------
  _updateClientBullets(dt) {
    const arr = this.clientBullets;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.ttl -= dt;
      if (b.ttl <= 0) arr.splice(i, 1);
    }
    const e = this.clientEnemyBullets;
    for (let i = e.length - 1; i >= 0; i--) {
      const b = e[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.ttl -= dt;
      if (b.ttl <= 0) e.splice(i, 1);
    }
  }

  _spawnClientBullets(ev) {
    const w = WEAPONS[ev.weapon];
    if (!w) return;
    for (let i = 0; i < w.shots; i++) {
      const a = ev.angle + (Math.random() - 0.5) * 2 * w.spread;
      this.clientBullets.push({
        id: ++_cbId,
        x: ev.x, y: ev.y,
        vx: Math.cos(a) * w.speed * 60,
        vy: Math.sin(a) * w.speed * 60,
        ttl: w.range / (w.speed * 60),
        color: w.ammoColor,
        tracer: w.tracerLen,
      });
    }
  }

  _spawnClientSpit(ev) {
    const cfg = ZTYPES.spitter;
    this.clientEnemyBullets.push({
      id: ++_cbId,
      x: ev.x, y: ev.y,
      vx: Math.cos(ev.angle) * cfg.rangedSpeed,
      vy: Math.sin(ev.angle) * cfg.rangedSpeed,
      ttl: cfg.rangedRange / cfg.rangedSpeed,
      color: '#a8d04a',
      r: 6,
    });
  }

  _maybeTriggerKillCam(ev) {
    if (!ev || ev.killerId !== this.localPlayerId) return;
    if (this.renderer.isCinematicActive()) return;
    this.localKillCount++;
    const now = performance.now();
    const sinceLast = now - this.lastCinematicAt;
    if (sinceLast < this.killCamCooldownMs) return;

    // Force a kill-cam on every Nth kill, plus a small chance otherwise once cooldown clears.
    const force = (this.localKillCount % this.killCamEvery === 0);
    const lucky = Math.random() < 0.08;
    // Brutes are always cinematic when off-cooldown.
    const brute = ev.ztype === 'brute';
    if (!force && !lucky && !brute) return;

    const lp = this.world?.players?.find(p => p.id === this.localPlayerId);
    this.lastCinematicAt = now;
    this.renderer.triggerKillCinematic({
      x: ev.x, y: ev.y,
      killerX: lp?.x, killerY: lp?.y,
      ztype: ev.ztype,
      weapon: lp?.weapon || 'pistol',
    });
  }

  _handleEvents(events) {
    if (!events) return;
    const r = this.renderer;
    const a = this.audio;
    const isMP = !this.localWorld;
    for (const ev of events) {
      switch (ev.type) {
        case 'player_joined':
          if (isMP) this.playerStatic.set(ev.id, { name: ev.name, color: ev.color, r: 15 });
          break;
        case 'player_left':
          if (isMP) this.playerStatic.delete(ev.id);
          break;
        case 'zombie_spawned':
          if (isMP) this.zombieStatic.set(ev.id, {
            type: ev.ztype, r: ev.r, maxHp: ev.maxHp, seed: ev.seed, wobble: ev.wobble,
          });
          break;
        case 'pickup_spawned':
          if (isMP) this.pickupStatic.set(ev.id, { type: ev.ptype, value: ev.value });
          break;
        case 'fire': {
          if (isMP) this._spawnClientBullets(ev);
          r.muzzleEffect(ev.x, ev.y, ev.angle, weaponColor(ev.weapon));
          a.play(ev.weapon);
          if (ev.weapon === 'shotgun') r.addShake(0.072);
          else if (ev.weapon === 'rifle') r.addShake(0.108);
          else if (ev.weapon === 'pistol') r.addShake(0.012);
          else if (ev.weapon === 'smg') r.addShake(0.006);
          break;
        }
        case 'spit': {
          if (isMP) this._spawnClientSpit(ev);
          a.play('spit');
          break;
        }
        case 'zombie_hit': {
          r.bloodSplatter(ev.x, ev.y, Math.atan2(ev.dy, ev.dx), 0.5);
          a.play('hit');
          break;
        }
        case 'zombie_died': {
          r.bigBlood(ev.x, ev.y);
          if (isMP) this.zombieStatic.delete(ev.id);
          if (ev.ztype === 'brute') { a.play('brute'); r.addShake(0.4); }
          else a.play('death');
          this._maybeTriggerKillCam(ev);
          break;
        }
        case 'player_hurt': {
          if (ev.id === this.localPlayerId) {
            this.opts.onPlayerHurt?.(ev.dmg);
            r.addShake(0.3);
          }
          a.play('hurt');
          break;
        }
        case 'player_died': {
          if (ev.id === this.localPlayerId) this.opts.onPlayerDied?.();
          break;
        }
        case 'player_revived': break;
        case 'enemy_bullet_hit': r.enemyBulletHit(ev.x, ev.y, ev.color); break;
        case 'drool': r.spawnDrool(ev.x, ev.y, ev.kind); break;
        case 'dodge': r.smokeBurst(ev.x, ev.y); a.play('dodge'); break;
        case 'reload_start': a.play('reload'); break;
        case 'pickup_cash':
        case 'pickup_health':
        case 'pickup_ammo': a.play('pickup'); break;
        case 'empty': a.play('empty'); break;
        case 'wave_start': {
          a.play('wave');
          const lines = RADIO_SCRIPT.start[ev.n];
          if (lines) for (const m of lines) this.opts.onRadio?.(m);
          break;
        }
        case 'wave_end': {
          const lines = RADIO_SCRIPT.end[ev.n];
          if (lines) for (const m of lines) this.opts.onRadio?.(m);
          break;
        }
        case 'radio': {
          const m = RADIO_SCRIPT[ev.kind];
          if (m) this.opts.onRadio?.(m);
          break;
        }
        case 'buy_ok': a.play('shopBuy'); break;
        case 'buy_fail': a.play('noFunds'); break;
        case 'victory':
        case 'gameover': break;
      }
    }
  }
}

function weaponColor(key) {
  return ({ pistol:'#ffd96a', shotgun:'#ff8c4a', smg:'#5cc8ff', rifle:'#9affb6' })[key] || '#fff';
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Lerp two snapshot entity arrays by id. Entities present only in one frame
// pop in/out cleanly. Returns fresh objects safe to mutate (we attach static
// fields on top during world assembly).
function lerpEntities(a, b, t) {
  if (t <= 0) {
    const out = new Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = { ...a[i] };
    return out;
  }
  if (t >= 1) {
    const out = new Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = { ...b[i] };
    return out;
  }
  const out = [];
  const bMap = new Map();
  for (let i = 0; i < b.length; i++) bMap.set(b[i].id, b[i]);
  for (let i = 0; i < a.length; i++) {
    const ea = a[i];
    const eb = bMap.get(ea.id);
    if (eb) {
      out.push(lerpEntity(ea, eb, t));
      bMap.delete(ea.id);
    } else {
      out.push({ ...ea });
    }
  }
  for (const eb of bMap.values()) out.push({ ...eb });
  return out;
}

function lerpEntity(a, b, t) {
  const out = { ...b };
  if (typeof a.x === 'number')   out.x  = a.x  + (b.x  - a.x ) * t;
  if (typeof a.y === 'number')   out.y  = a.y  + (b.y  - a.y ) * t;
  if (typeof a.vx === 'number')  out.vx = a.vx + (b.vx - a.vx) * t;
  if (typeof a.vy === 'number')  out.vy = a.vy + (b.vy - a.vy) * t;
  if (typeof a.hp === 'number')  out.hp = a.hp + (b.hp - a.hp) * t;
  if (typeof a.angle === 'number' && typeof b.angle === 'number') {
    let da = b.angle - a.angle;
    if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
    out.angle = a.angle + da * t;
  }
  return out;
}
