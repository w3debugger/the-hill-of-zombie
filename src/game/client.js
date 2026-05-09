// GameClient: glues world + renderer + audio + input together.
// Supports three modes:
//   - solo:  runs World locally, no networking.
//   - host:  runs World locally AND broadcasts snapshots/events to joiners
//            via WebRTC DataChannels (see RTCHost).
//   - join:  no World; renders snapshots received from the host over the
//            DataChannel.
//
// Multiplayer notes (WebRTC P2P — no interp delay, no client prediction):
//  - Same-WiFi peers negotiate a direct LAN route via STUN, so latency is
//    LAN-equivalent (~1–5 ms). Across the internet, peers connect over their
//    public addresses; latency is whatever the direct route between them is.
//  - We render the latest snapshot directly — no interp buffer, zero added
//    latency. Snapshots are lean (no bullets, no immutable fields). The
//    client assembles a "live"-shaped world from the latest snap + cached
//    static info from 'player_joined' / 'zombie_spawned' / 'pickup_spawned'
//    events.
//  - Bullets are cosmetic on the wire — joiners spawn them from 'fire'
//    events and simulate ballistics locally. The host stays authoritative
//    for hits.

import { World } from './world.js';
import { Renderer } from './render.js';
import { AudioBus } from './audio.js';
import { Input } from './input.js';
import { RADIO_SCRIPT, WAVE_NAMES, WEAPONS, ZTYPES } from './data.js';
import { C2S } from '../net/protocol.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

    // ----- Multiplayer-only state -----
    this.latestSnap = null;            // most recent server snapshot (raw)
    this.playerStatic = new Map();     // id -> { name, color, r }
    this.zombieStatic = new Map();     // id -> { type, r, maxHp, seed, wobble }
    this.pickupStatic = new Map();     // id -> { type, value }
    this.clientBullets = [];           // visual-only ballistic
    this.clientEnemyBullets = [];      // visual-only ballistic

    // Cinematic kill-cam pacing
    this.localKillCount = 0;
    this.lastCinematicAt = -1e9;
    this.killCamEvery = 8;             // fire on every Nth local-player kill
    this.killCamCooldownMs = 12000;    // never fire more often than this (game freezes during cinematic)
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

  // Spectate / preview: builds a world with no player and never starts a wave,
  // so the menu canvas shows the empty hill while the user browses. The world
  // sits in 'lobby' state — World.step is a no-op there, so nothing spawns and
  // nothing decays. Renderer enters orbit-cam mode for ambient camera motion.
  startPreview() {
    this.previewMode = true;
    this.localWorld = new World();
    this.localPlayerId = null;
    this.renderer.setLocalPlayer(null);
    this.renderer.setPreviewMode(true);
    this.world = this.localWorld.live();
    this._begin();
  }

  // Multiplayer joiner — render snapshots received from the host.
  startMultiplayer(net, yourId) {
    this.net = net;
    this.localPlayerId = yourId;
    this.renderer.setLocalPlayer(yourId);
    net.on('snapshot', (msg) => this._onSnapshot(msg));
    net.on('events', (msg) => this._handleEvents(msg.events));
    this._begin();
  }

  // Multiplayer host — runs World locally with the host as one player and
  // each joiner as another. The loop pulls peer inputs from rtcHost each
  // tick, steps World, and broadcasts the resulting snapshot + events.
  startHost(rtcHost, { name = 'Sgt. Vance', color = '#5cc8ff' } = {}) {
    this.rtcHost = rtcHost;
    this.localWorld = new World();
    this.localPlayerId = rtcHost.localId;
    this.localWorld.addPlayer(rtcHost.localId, name, color);
    for (const info of rtcHost.peerList()) {
      this.localWorld.addPlayer(info.id, info.name, info.color);
    }
    rtcHost.on('peer_left', ({ id }) => {
      this.localWorld?.removePlayer(id);
    });
    this.renderer.setLocalPlayer(this.localPlayerId);
    this.localWorld.startGame();
    this.world = this.localWorld.live();
    this._begin();
  }

  _begin() {
    // Skip audio in preview — the menu shouldn't hijack the page with ambience
    // before the player actually opts into the game. Audio unlocks on the
    // first solo/MP start.
    if (!this.previewMode) {
      this.audio.ensure();
      this.audio.startAmbience();
    }
    this.running = true;
    this.lastT = performance.now();
    // Keep the cursor visible during preview — there's no aim, just the menu.
    this.canvas.style.cursor = this.previewMode ? '' : 'none';
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    this.audio.stopAmbience();
    this.input.destroy();
    if (this.net) this.net.close();
    this.canvas.style.cursor = '';
    if (this.previewMode) this.renderer.setPreviewMode(false);
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
    inputState.ready = !!this.input.readyHeld;

    if (this.localWorld) {
      // ----- Solo or host: authoritative simulation runs locally -----
      // In solo, kill-cam pauses the world so zombies aren't chewing the tower
      // while the camera admires a headshot. As host, we keep stepping so
      // joiners don't freeze — their cinematics fire independently in their
      // own clients.
      const skipStep = !this.rtcHost && this.renderer.isCinematicActive();
      if (!skipStep) {
        const inputs = this.rtcHost ? this.rtcHost.getPeerInputs() : {};
        inputs[this.localPlayerId] = inputState;
        const events = this.localWorld.step(dt, inputs);
        this._handleEvents(events);
        if (this.rtcHost) {
          this.rtcHost.broadcastEvents(events);
          this.rtcHost.broadcastSnapshot(this.localWorld.snapshot());
        }
      }
      this.world = this.localWorld.live();
      this._processStateTransitions();
    } else if (this.net) {
      // ----- Multiplayer (LAN): ship input, render the latest snapshot -----
      this.net.send(C2S.INPUT, { input: inputState });
      this._updateClientBullets(dt);
      this.world = this._buildWorldFromSnap(this.latestSnap);
      this._processStateTransitions();
    }

    if (this.input.consumeEsc() && !this.previewMode) this.opts.onEsc?.();

    // Heartbeat intensity rides local player HP — silent above 60%, ramps to
    // full panic at 0%. Killed players get no heartbeat (the silence sells the
    // fact that you're down).
    const lp = this.world?.players?.find?.(p => p.id === this.localPlayerId);
    if (lp && !lp.dead) {
      const hpFrac = clamp(lp.hp / Math.max(1, lp.maxHp), 0, 1);
      const intensity = hpFrac < 0.6 ? (0.6 - hpFrac) / 0.6 : 0;
      this.audio.setHeartbeatIntensity(intensity);
    } else {
      this.audio.setHeartbeatIntensity(0);
    }

    this.renderer.tick(dt, this.input.mouse, this.world);
    if (this.renderer.consumeThunder()) {
      // Slight delay so the audible boom trails the visual flash, like real
      // distance lightning.
      setTimeout(() => this.audio.play('thunder'), 220 + Math.random() * 320);
    }
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

  // ---------- Multiplayer snapshot intake ----------

  _onSnapshot(snap) {
    this.latestSnap = snap;
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

  // Decode the latest snapshot into a "live"-shaped world the renderer can
  // consume. Static fields (name/color, zombie type/seed, pickup type/value)
  // come from the per-id caches populated by spawn events.
  _buildWorldFromSnap(snap) {
    if (!snap) return null;

    const players = new Array(snap.players.length);
    for (let i = 0; i < snap.players.length; i++) {
      const p = { ...snap.players[i] };
      const st = this.playerStatic.get(p.id);
      if (st) { p.name = st.name; p.color = st.color; p.r = st.r; }
      else    { p.name = 'Player'; p.color = '#888'; p.r = 15; }
      players[i] = p;
    }

    // Wobble is a steady per-zombie animation phase. Server doesn't ship it,
    // so we advance from the spawn-time seed using local wall-clock seconds.
    const elapsed = performance.now() / 1000;
    const zombies = new Array(snap.zombies.length);
    for (let i = 0; i < snap.zombies.length; i++) {
      const z = { ...snap.zombies[i] };
      const st = this.zombieStatic.get(z.id);
      if (st) {
        z.type = st.type; z.r = st.r; z.maxHp = st.maxHp; z.seed = st.seed;
        z.wobble = st.wobble + elapsed * 4;
      } else {
        z.type = 'walker'; z.r = 15; z.maxHp = z.hp; z.seed = z.id; z.wobble = 0;
      }
      zombies[i] = z;
    }

    const pickups = new Array(snap.pickups.length);
    for (let i = 0; i < snap.pickups.length; i++) {
      const it = { ...snap.pickups[i] };
      const st = this.pickupStatic.get(it.id);
      if (st) { it.type = st.type; it.value = st.value; }
      else    { it.type = 'cash'; it.value = 0; }
      pickups[i] = it;
    }

    return {
      tickN: snap.tickN,
      state: snap.state,
      cash: snap.cash,
      hill: snap.hill,
      waveNum: snap.waveNum,
      inWave: snap.inWave,
      remainingZombies: snap.remainingZombies,
      players,
      zombies,
      pickups,
      bullets: this.clientBullets,
      enemyBullets: this.clientEnemyBullets,
    };
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
