// Canvas2D renderer. Stateful: owns particles, decals, camera, ground texture.
// Consumes snapshots from World plus events to spawn local-only effects.

import { TAU, HILL_R, HILL_CORE_R, ARENA_R, WEAPONS, ZTYPES } from './data.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = 0;
    this.viewH = 0;
    this.particles = [];
    this.decals = [];
    this.cam = { x: 0, y: 0, sx: 0, sy: 0, shake: 0, zoom: 1, targetX: null, targetY: null, focusBlend: 0 };
    this.timeMs = 0;
    this.localPlayerId = null;
    this.localMuzzleFlash = 0;
    this.groundCanvas = null;
    this.zombieSprites = new Map(); // zombie id -> { canvas, flashCanvas, seed }
    this.lightingSprite = null;     // cached vignette
    this.glowSprites = null;        // cached eye/muzzle glows
    this._tmpScreen = { x: 0, y: 0 }; // scratch for worldToScreen
    this.cinematic = null;          // see triggerKillCinematic
    this.bloodSpreadAccum = 0;      // schedules blood-spread bursts during cinematic
    this.fog = [];                  // drifting fog wisps in world space
    this.fogSpawnAccum = 0;
    this.lightning = null;          // { age, dur, intensity } when a flash is active
    this.lightningCooldown = 6 + Math.random() * 12;
    this.pendingThunder = false;    // raised when lightning starts; client clears
    this._fogSprite = null;
    this._buildFogSprite();
    this.buildGround();
    this._buildGlowSprites();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildFogSprite() {
    // Soft radial alpha disc — drawn many times per frame for cheap fog wisps.
    const c = document.createElement('canvas');
    const s = 256; c.width = c.height = s;
    const cx = c.getContext('2d');
    const g = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(170, 175, 180, 0.55)');
    g.addColorStop(0.6, 'rgba(120, 125, 130, 0.18)');
    g.addColorStop(1, 'rgba(80, 85, 90, 0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, s, s);
    this._fogSprite = c;
  }

  consumeThunder() {
    const v = this.pendingThunder;
    this.pendingThunder = false;
    return v;
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.canvas.style.width = this.viewW + 'px';
    this.canvas.style.height = this.viewH + 'px';
    this._buildLightingSprite();
  }

  _buildGlowSprites() {
    const make = (rgb, size = 128) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const cx = c.getContext('2d');
      const g = cx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, `rgba(${rgb}, 1)`);
      g.addColorStop(0.5, `rgba(${rgb}, 0.35)`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      cx.fillStyle = g;
      cx.fillRect(0, 0, size, size);
      return c;
    };
    this.glowSprites = {
      red: make('255, 60, 40'),
      green: make('180, 255, 120'),
      yellow: make('255, 220, 120'),
    };
  }

  _buildLightingSprite() {
    if (!this.viewW || !this.viewH) return;
    const c = document.createElement('canvas');
    c.width = this.viewW; c.height = this.viewH;
    const cx = c.getContext('2d');
    const grad = cx.createRadialGradient(
      this.viewW / 2, this.viewH / 2, 80,
      this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.85
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, 'rgba(8, 2, 2, 0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0.88)');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, this.viewW, this.viewH);
    this.lightingSprite = c;
  }

  _pruneZombieSprites(world) {
    if (this.zombieSprites.size === 0) return;
    const live = world?.zombies;
    if (!live) return;
    const liveIds = new Set();
    for (let i = 0; i < live.length; i++) liveIds.add(live[i].id);
    for (const id of this.zombieSprites.keys()) {
      if (!liveIds.has(id)) this.zombieSprites.delete(id);
    }
  }

  buildGround() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#1b2418';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const s = Math.random() * 1.6 + 0.3;
      const v = 12 + Math.random() * 28;
      g.fillStyle = `rgba(${30 + v}, ${42 + v}, ${24 + v * 0.5}, ${0.35 + Math.random() * 0.25})`;
      g.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 4 + Math.random() * 12;
      g.fillStyle = `rgba(56, 38, 22, ${0.18 + Math.random() * 0.25})`;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      g.strokeStyle = `rgba(80, ${110 + Math.random() * 30}, 50, 0.5)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 6, y - 3 - Math.random() * 4);
      g.stroke();
    }
    this.groundCanvas = c;
  }

  // worldToScreen returns *un-zoomed* canvas pixels. The world layer is drawn
  // inside a ctx.scale(zoom) transform, so visual size scales automatically.
  worldToScreen(wx, wy) {
    return { x: (wx - this.cam.x) + this.viewW / 2 + this.cam.sx, y: (wy - this.cam.y) + this.viewH / 2 + this.cam.sy };
  }
  // screenToWorld inverts the ctx.scale so mouse aim stays correct during a zoomed cinematic.
  screenToWorld(sx, sy) {
    const z = this.cam.zoom || 1;
    const cx = this.viewW / 2 + this.cam.sx;
    const cy = this.viewH / 2 + this.cam.sy;
    return { x: (sx - cx) / z + this.cam.x, y: (sy - cy) / z + this.cam.y };
  }

  setLocalPlayer(id) { this.localPlayerId = id; }
  addShake(amount) { this.cam.shake = Math.min(1, this.cam.shake + amount); }

  // Cinematic kill cam. Phases (total ~1700ms — solo mode pauses world during it).
  //  0..220ms    IN:   zoom 1 → 2.5, camera lerps to halfway
  //  220..1400ms HOLD: stay zoomed, deep slow-mo on particles, blood spreads outward
  //  1400..1700ms OUT: zoom back to 1
  triggerKillCinematic(opts) {
    if (this.cinematic) return; // one at a time; cooldown is enforced by caller
    const { x, y, killerX, killerY, ztype = 'walker', weapon = 'pistol' } = opts || {};
    this.cinematic = {
      age: 0, dur: 1.7,
      x, y, kx: killerX, ky: killerY,
      ztype, weapon,
      phase: 'in',
      flashed: false,
    };
    // Initial impact pop: a heavy spray + extra decals around the kill site
    this.bigBlood(x, y);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU;
      const d = rand(2, 22);
      this.decals.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: rand(4, 9), alpha: 0.7, age: 0 });
    }
    if (this.decals.length > 260) this.decals.splice(0, this.decals.length - 260);
    this.addShake(0.45);
  }
  isCinematicActive() { return !!this.cinematic; }
  cinematicTimeScale() {
    if (!this.cinematic) return 1;
    // Slow-mo during the hold phase, ramp out at the tail.
    const t = this.cinematic.age;
    if (t < 0.22) return lerp(1, 0.10, t / 0.22);
    if (t < 1.40) return 0.10 + 0.04 * Math.sin(t * 14); // tiny pulse
    return lerp(0.14, 1, (t - 1.40) / 0.30);
  }

  // ----- Effects API (called by client in response to events) -----
  bloodSplatter(x, y, dirAngle, intensity = 1) {
    const n = Math.floor(6 + intensity * 8);
    for (let i = 0; i < n; i++) {
      const a = dirAngle + rand(-0.9, 0.9);
      const s = rand(80, 220) * intensity;
      this.particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: rand(0.25, 0.55), max: 0.55, size: rand(2, 5), color: '#a01515', type: 'blood' });
    }
    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU);
      const d = rand(2, 18) * intensity;
      this.decals.push({ x: x + Math.cos(a)*d, y: y + Math.sin(a)*d, r: rand(3, 7) * intensity, alpha: 0.55, age: 0 });
    }
    if (this.decals.length > 220) this.decals.splice(0, this.decals.length - 220);
  }
  muzzleEffect(x, y, angle, color) {
    for (let i = 0; i < 4; i++) {
      const a = angle + rand(-0.3, 0.3);
      const s = rand(140, 260);
      this.particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: rand(0.05, 0.12), max: 0.12, size: rand(2, 4), color, type: 'flash' });
    }
    for (let i = 0; i < 3; i++) {
      const a = angle + rand(-1.6, 1.6);
      const s = rand(40, 90);
      this.particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: rand(0.4, 0.7), max: 0.7, size: rand(1, 2), color: 'rgba(180,180,180,0.5)', type: 'smoke' });
    }
    const ca = angle + Math.PI / 2 + rand(-0.2, 0.2);
    this.particles.push({ x: x - Math.cos(angle) * 6, y: y - Math.sin(angle) * 6, vx: Math.cos(ca) * rand(60, 120), vy: Math.sin(ca) * rand(60, 120), life: 0.6, max: 0.6, size: 1.6, color: '#d4a060', type: 'casing' });
  }
  bigBlood(x, y) {
    for (let i = 0; i < 28; i++) {
      const a = rand(0, TAU);
      this.particles.push({ x, y, vx: Math.cos(a)*rand(120, 360), vy: Math.sin(a)*rand(120, 360), life: rand(0.4, 1.0), max: 1.0, size: rand(3, 6), color: '#a01515', type: 'blood' });
    }
    // darker arterial droplets that linger
    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU);
      this.particles.push({ x, y, vx: Math.cos(a)*rand(40, 140), vy: Math.sin(a)*rand(40, 140), life: rand(0.7, 1.2), max: 1.2, size: rand(2, 4), color: '#5a0808', type: 'blood' });
    }
    this.bloodSplatter(x, y, rand(0, TAU), 1.6);
  }
  spawnDrool(x, y, kind) {
    const c = kind === 'green' ? '#5a7a14' : '#5a0808';
    this.particles.push({ x, y, vx: rand(-12, 12), vy: rand(20, 60), life: rand(0.5, 0.9), max: 0.9, size: 1.4, color: c, type: 'blood' });
  }
  smokeBurst(x, y) {
    for (let i = 0; i < 8; i++) {
      this.particles.push({ x, y, vx: rand(-40, 40), vy: rand(-40, 40), life: rand(0.3, 0.6), max: 0.6, size: rand(2, 4), color: 'rgba(180,180,180,0.4)', type: 'smoke' });
    }
  }
  enemyBulletHit(x, y, color) {
    for (let i = 0; i < 6; i++) this.particles.push({ x, y, vx: rand(-100,100), vy: rand(-100,100), life: rand(0.2,0.4), max: 0.4, size: 2, color, type: 'blood' });
  }

  // ----- Per-frame -----
  tick(dt, mouse, world) {
    this.timeMs += dt * 1000;

    // Cinematic kill cam: drives camera focus + zoom + slow-mo particles.
    if (this.cinematic) {
      this.cinematic.age += dt;
      const c = this.cinematic;
      if (c.age >= c.dur) {
        this.cinematic = null;
        this.cam.zoom = 1;
        this.cam.focusBlend = 0;
      }
    }

    // camera follow: local player by default, blended toward kill spot during cinematic
    if (world) {
      const lp = world.players.find(p => p.id === this.localPlayerId) || world.players[0];
      this.localPlayerPos = lp ? { x: lp.x, y: lp.y } : null;
      let targetX = lp ? lp.x : this.cam.x;
      let targetY = lp ? lp.y : this.cam.y;
      let targetZoom = 1;
      let targetBlend = 0;
      if (this.cinematic) {
        const c = this.cinematic;
        // Focus on a point biased toward the zombie (more dramatic than midpoint).
        const focusX = c.x * 0.7 + (c.kx ?? c.x) * 0.3;
        const focusY = c.y * 0.7 + (c.ky ?? c.y) * 0.3;
        // Blend: 0..1 in, hold at 1, 1..0 out
        if (c.age < 0.22)      targetBlend = c.age / 0.22;
        else if (c.age < 1.40) targetBlend = 1;
        else                   targetBlend = Math.max(0, 1 - (c.age - 1.40) / 0.30);
        const k = ease(targetBlend);
        targetX = lerp(targetX, focusX, k);
        targetY = lerp(targetY, focusY, k);
        targetZoom = lerp(1, 2.5, k);
      }
      this.cam.focusBlend = targetBlend;
      this.cam.x = lerp(this.cam.x, targetX, 1 - Math.exp(-(this.cinematic ? 14 : 8) * dt));
      this.cam.y = lerp(this.cam.y, targetY, 1 - Math.exp(-(this.cinematic ? 14 : 8) * dt));
      this.cam.zoom = lerp(this.cam.zoom, targetZoom, 1 - Math.exp(-12 * dt));
    }

    if (this.cam.shake > 0) {
      this.cam.shake = Math.max(0, this.cam.shake - dt * 4);
      const m = this.cam.shake * this.cam.shake * 18;
      this.cam.sx = (Math.random() * 2 - 1) * m;
      this.cam.sy = (Math.random() * 2 - 1) * m;
    } else { this.cam.sx = 0; this.cam.sy = 0; }

    // particles (apply slow-mo during cinematic)
    const pdt = dt * this.cinematicTimeScale();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * pdt; p.y += p.vy * pdt; p.life -= pdt;
      if (p.type === 'blood') { p.vx *= Math.pow(0.86, pdt / 0.0166); p.vy *= Math.pow(0.86, pdt / 0.0166); }
      else if (p.type === 'smoke') { p.vx *= Math.pow(0.95, pdt / 0.0166); p.vy *= Math.pow(0.95, pdt / 0.0166); p.size += pdt * 8; }
      else if (p.type === 'casing') { p.vx *= Math.pow(0.9, pdt / 0.0166); p.vy *= Math.pow(0.9, pdt / 0.0166); }
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // During cinematic hold phase, schedule periodic blood-spread bursts so
    // the splatter visibly grows over the slow-mo window.
    if (this.cinematic && this.cinematic.age > 0.22 && this.cinematic.age < 1.40) {
      this.bloodSpreadAccum += dt;
      const interval = 0.06;
      while (this.bloodSpreadAccum >= interval) {
        this.bloodSpreadAccum -= interval;
        const c = this.cinematic;
        const a = Math.random() * TAU;
        const d = rand(6, 28);
        this.particles.push({
          x: c.x, y: c.y,
          vx: Math.cos(a) * rand(40, 130),
          vy: Math.sin(a) * rand(40, 130),
          life: rand(0.4, 0.7), max: 0.7, size: rand(2, 4),
          color: '#a01515', type: 'blood',
        });
        if (Math.random() < 0.6) {
          this.decals.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, r: rand(2, 5), alpha: 0.55, age: 0 });
        }
      }
      if (this.decals.length > 260) this.decals.splice(0, this.decals.length - 260);
    } else {
      this.bloodSpreadAccum = 0;
    }

    if (this.localMuzzleFlash > 0) this.localMuzzleFlash -= dt;
    for (const d of this.decals) d.age += dt;
    // Prune sprite cache every 30 frames (~0.5s)
    if ((this.timeMs | 0) % 500 < 17) this._pruneZombieSprites(world);

    this._tickFog(dt);
    this._tickLightning(dt);
  }

  _tickFog(dt) {
    // Keep ~26 wisps in the camera's vicinity. Spawn new ones on the upwind
    // edge so they drift across view.
    const target = 28;
    while (this.fog.length < target) {
      const ox = (Math.random() - 0.5) * (this.viewW + 600);
      const oy = (Math.random() - 0.5) * (this.viewH + 400);
      this.fog.push({
        x: this.cam.x + ox,
        y: this.cam.y + oy,
        vx: rand(-12, 18),
        vy: rand(-6, 6),
        size: rand(180, 360),
        alpha: rand(0.18, 0.42),
        rot: rand(0, TAU),
        rotV: rand(-0.05, 0.05),
        life: rand(8, 16),
      });
    }
    for (let i = this.fog.length - 1; i >= 0; i--) {
      const f = this.fog[i];
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.rot += f.rotV * dt;
      f.life -= dt;
      // Drop wisps that wandered far off-camera or expired.
      const dx = f.x - this.cam.x, dy = f.y - this.cam.y;
      if (f.life <= 0 || Math.abs(dx) > this.viewW * 0.9 || Math.abs(dy) > this.viewH * 0.9) {
        this.fog.splice(i, 1);
      }
    }
  }

  _tickLightning(dt) {
    if (this.lightning) {
      this.lightning.age += dt;
      if (this.lightning.age >= this.lightning.dur) this.lightning = null;
    } else {
      this.lightningCooldown -= dt;
      if (this.lightningCooldown <= 0) {
        // Most "rolls" produce no flash; the rare ones land hard.
        if (Math.random() < 0.55) {
          this.lightning = { age: 0, dur: rand(0.45, 0.85), intensity: rand(0.45, 0.95) };
          this.pendingThunder = true;
        }
        this.lightningCooldown = 12 + Math.random() * 22;
      }
    }
  }

  // ----- Draw -----
  draw(world, mouse) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    if (!world) return;

    const zoom = this.cam.zoom || 1;
    const zoomed = Math.abs(zoom - 1) > 0.001;

    if (zoomed) {
      ctx.save();
      ctx.translate(this.viewW / 2 + this.cam.sx, this.viewH / 2 + this.cam.sy);
      ctx.scale(zoom, zoom);
      ctx.translate(-(this.viewW / 2 + this.cam.sx), -(this.viewH / 2 + this.cam.sy));
    }

    this.drawGround();
    this.drawArenaEdge();
    this.drawDecals();
    this.drawHill(world);
    this.drawPickups(world);
    this.drawZombies(world);
    this.drawPlayers(world);
    this.drawBullets(world);
    this.drawParticles();
    this.drawFog();
    this.drawMuzzleGlow(world);

    if (zoomed) ctx.restore();

    this.drawLighting(world);
    this.drawLightning();
    this.drawHpVignette(world);
    this.drawCinematicOverlay();
    this.drawCrosshair(world, mouse);
  }

  drawFog() {
    const ctx = this.ctx;
    const prevAlpha = ctx.globalAlpha;
    const prevComp = ctx.globalCompositeOperation;
    // 'screen' lifts dark areas — wisps look gauzy rather than gray slabs.
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < this.fog.length; i++) {
      const f = this.fog[i];
      const sx = (f.x - this.cam.x) + this.viewW / 2 + this.cam.sx;
      const sy = (f.y - this.cam.y) + this.viewH / 2 + this.cam.sy;
      ctx.globalAlpha = f.alpha;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(f.rot);
      ctx.drawImage(this._fogSprite, -f.size / 2, -f.size / 2, f.size, f.size);
      ctx.restore();
    }
    ctx.globalCompositeOperation = prevComp;
    ctx.globalAlpha = prevAlpha;
  }

  drawLightning() {
    if (!this.lightning) return;
    const ctx = this.ctx;
    const c = this.lightning;
    const t = c.age / c.dur;
    // Sharp double-flash: bright impact, brief drop, second flicker, then darken.
    let k;
    if (t < 0.06)      k = t / 0.06;
    else if (t < 0.18) k = 1 - (t - 0.06) / 0.12 * 0.7;
    else if (t < 0.24) k = 0.3 + (t - 0.18) / 0.06 * 0.5;
    else               k = Math.max(0, 0.8 - (t - 0.24) / 0.45);
    const a = k * c.intensity;
    ctx.fillStyle = `rgba(220, 230, 255, ${(a * 0.55).toFixed(3)})`;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    // Aftershadow — slight darken once the flash fades, makes the world feel
    // unsettled instead of just bright-bright-done.
    if (t > 0.55) {
      const after = (t - 0.55) / 0.45;
      ctx.fillStyle = `rgba(0, 0, 0, ${(after * 0.18 * c.intensity).toFixed(3)})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
  }

  drawHpVignette(world) {
    if (!world) return;
    const lp = world.players?.find?.(p => p.id === this.localPlayerId) || world.players?.[0];
    if (!lp || lp.dead) return;
    const hpFrac = Math.max(0, Math.min(1, lp.hp / Math.max(1, lp.maxHp)));
    if (hpFrac >= 0.6) return;
    const ctx = this.ctx;
    const danger = (0.6 - hpFrac) / 0.6; // 0..1
    // Pulse with a fake heartbeat: 1.4 Hz at low danger, 2.6 Hz at full panic.
    const beatHz = 1.4 + danger * 1.2;
    const pulse = 0.7 + 0.3 * Math.sin(this.timeMs * 0.001 * beatHz * TAU);
    const grad = ctx.createRadialGradient(
      this.viewW / 2, this.viewH / 2, this.viewH * 0.18,
      this.viewW / 2, this.viewH / 2, this.viewH * 0.78
    );
    const edgeA = (0.20 + 0.55 * danger) * pulse;
    grad.addColorStop(0, 'rgba(120, 0, 0, 0)');
    grad.addColorStop(0.6, `rgba(140, 8, 8, ${(edgeA * 0.35).toFixed(3)})`);
    grad.addColorStop(1, `rgba(160, 12, 12, ${edgeA.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  drawGround() {
    const ctx = this.ctx;
    const tile = 512;
    const ox = ((this.cam.x % tile) + tile) % tile;
    const oy = ((this.cam.y % tile) + tile) % tile;
    for (let y = -tile; y < this.viewH + tile; y += tile) {
      for (let x = -tile; x < this.viewW + tile; x += tile) {
        ctx.drawImage(this.groundCanvas, x - ox + this.cam.sx, y - oy + this.cam.sy);
      }
    }
  }

  drawArenaEdge() {
    // Cull: if the camera is far from the arena ring, the stroke arcs aren't visible.
    const camDist = Math.hypot(this.cam.x, this.cam.y);
    const viewReach = Math.max(this.viewW, this.viewH) * 0.6;
    if (camDist + viewReach < ARENA_R - 100) return;
    const ctx = this.ctx;
    const c = this.worldToScreen(0, 0);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 60;
    ctx.beginPath(); ctx.arc(0, 0, ARENA_R + 30, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(70, 60, 40, 0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, ARENA_R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(140, 120, 80, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 10]);
    ctx.beginPath(); ctx.arc(0, 0, ARENA_R - 6, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawHill(world) {
    const ctx = this.ctx;
    const c = this.worldToScreen(0, 0);
    ctx.save();
    ctx.translate(c.x, c.y);
    const grad = ctx.createRadialGradient(0, -20, HILL_CORE_R * 0.4, 0, 0, HILL_R);
    grad.addColorStop(0, '#5b6a3c');
    grad.addColorStop(0.6, '#3e4a28');
    grad.addColorStop(1, 'rgba(40, 50, 28, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, HILL_R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(20, 24, 16, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(0, 0, HILL_R - 28 - i * 32, 0, TAU); ctx.stroke();
    }
    const hpRatio = clamp(world.hill.hp / world.hill.maxHp, 0, 1);
    const coreGrad = ctx.createRadialGradient(0, -10, 5, 0, 0, HILL_CORE_R);
    const coreCol = lerp(120, 50, 1 - hpRatio);
    coreGrad.addColorStop(0, `rgb(${coreCol + 60}, ${coreCol + 80}, ${coreCol + 40})`);
    coreGrad.addColorStop(1, `rgb(${coreCol}, ${coreCol + 20}, ${coreCol - 10})`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath(); ctx.arc(0, 0, HILL_CORE_R, 0, TAU); ctx.fill();
    // signal tower instead of just a flag
    this.drawSignalTower(hpRatio);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, HILL_CORE_R - 4, -2.4, -0.6); ctx.stroke();
    ctx.restore();
    if (hpRatio < 1) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath(); ctx.arc(0, 0, HILL_CORE_R + 10, 0, TAU); ctx.stroke();
      ctx.strokeStyle = hpRatio > 0.4 ? '#9affb6' : '#ff7d7d';
      ctx.beginPath(); ctx.arc(0, 0, HILL_CORE_R + 10, -Math.PI / 2, -Math.PI / 2 + TAU * hpRatio); ctx.stroke();
      ctx.restore();
    }
  }

  drawSignalTower(hpRatio) {
    const ctx = this.ctx;
    // base
    ctx.fillStyle = '#1c1812';
    ctx.fillRect(-10, -10, 20, 20);
    // tower lattice (top-down view: a small cross/plus)
    ctx.fillStyle = '#3a2e1e';
    ctx.fillRect(-3, -42, 6, 42);
    ctx.fillRect(-12, -38, 24, 3);
    ctx.fillRect(-9, -28, 18, 2);
    ctx.fillRect(-7, -18, 14, 2);
    // beacon (top, blinking)
    const blink = Math.floor(this.timeMs / 600) % 2 === 0;
    ctx.fillStyle = blink && hpRatio > 0.2 ? '#ff3b3b' : '#5a1a1a';
    ctx.beginPath(); ctx.arc(0, -46, 3, 0, TAU); ctx.fill();
    if (blink && hpRatio > 0.2) {
      const g = ctx.createRadialGradient(0, -46, 0, 0, -46, 24);
      g.addColorStop(0, 'rgba(255, 60, 60, 0.6)');
      g.addColorStop(1, 'rgba(255, 60, 60, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -46, 24, 0, TAU); ctx.fill();
    }
    // antenna
    ctx.strokeStyle = '#3a2e1e';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -46);
    ctx.lineTo(0, -58);
    ctx.stroke();
  }

  drawDecals() {
    const ctx = this.ctx;
    for (const d of this.decals) {
      const s = this.worldToScreen(d.x, d.y);
      if (s.x < -40 || s.x > this.viewW + 40 || s.y < -40 || s.y > this.viewH + 40) continue;
      const fade = Math.max(0, 1 - d.age / 80);
      ctx.fillStyle = `rgba(120, 14, 14, ${(d.alpha * fade).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, d.r, 0, TAU); ctx.fill();
    }
  }

  drawPickups(world) {
    const ctx = this.ctx;
    for (const it of world.pickups) {
      const s = this.worldToScreen(it.x, it.y);
      const bob = Math.sin((this.timeMs + it.x * 13) * 0.006) * 2;
      ctx.save();
      ctx.translate(s.x, s.y + bob);
      if (it.type === 'cash') {
        ctx.fillStyle = '#5a3a14';
        ctx.beginPath(); ctx.arc(0, 2, 8, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffc857';
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff5a8';
        ctx.beginPath(); ctx.arc(-2, -2, 2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7a5408';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 1);
      } else if (it.type === 'health') {
        ctx.fillStyle = '#3a1010'; ctx.fillRect(-7, -5, 14, 10);
        ctx.fillStyle = '#ff5757'; ctx.fillRect(-6, -4, 12, 8);
        ctx.fillStyle = '#fff'; ctx.fillRect(-1, -3, 2, 6); ctx.fillRect(-3, -1, 6, 2);
      } else if (it.type === 'ammo') {
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-8, -5, 16, 10);
        ctx.fillStyle = '#5cc8ff'; ctx.fillRect(-7, -4, 14, 8);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('AMMO', 0, 0);
      }
      if (it.life < 4) {
        ctx.globalAlpha = 0.5 + Math.sin(this.timeMs * 0.02) * 0.4;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawZombies(world) {
    for (let i = 0; i < world.zombies.length; i++) this.drawZombie(world.zombies[i]);
  }

  // Draws the static body parts (everything except arms, eye pupils, glow halo).
  // Used by sprite baking and during a one-time-per-zombie call.
  _paintZombieBody(cx, z) {
    const r = z.r;
    const seed = z.seed;
    // tattered cloth silhouette
    const clothCol = (
      z.type === 'walker' ? '#241c12' :
      z.type === 'runner' ? '#1a1820' :
      z.type === 'brute'  ? '#1c0a0a' :
                            '#1d2a14'
    );
    cx.fillStyle = clothCol;
    cx.beginPath();
    const N = 14;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const j = ((Math.sin(seed * 7.1 + i * 1.7) + 1) * 0.5);
      const k = ((Math.sin(seed * 3.3 + i * 4.2) + 1) * 0.5);
      const radius = r * (1.04 + 0.22 * j) * (0.85 + 0.18 * k);
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius * 0.86;
      if (i === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
    }
    cx.closePath(); cx.fill();
    cx.strokeStyle = 'rgba(0,0,0,0.55)';
    cx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const a = seed + i * 2.4;
      cx.beginPath();
      cx.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.6);
      cx.lineTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 0.95);
      cx.stroke();
    }
    // body
    const bodyCol = (
      z.type === 'walker' ? '#5d6a4a' :
      z.type === 'runner' ? '#6a5a3a' :
      z.type === 'brute'  ? '#4a3a36' :
                            '#7a8a4a'
    );
    cx.fillStyle = bodyCol;
    cx.beginPath(); cx.ellipse(0, 0, r * 0.86, r * 0.7, 0, 0, TAU); cx.fill();
    cx.fillStyle = 'rgba(0,0,0,0.28)';
    cx.beginPath(); cx.ellipse(0, r * 0.18, r * 0.82, r * 0.45, 0, 0, TAU); cx.fill();
    // decay patches
    const decayN = 4 + ((seed * 13) | 0) % 3;
    const palette = ['#3a1010', '#5a2010', '#2a2a14', '#1a0e0a'];
    for (let i = 0; i < decayN; i++) {
      const px = Math.sin(seed * 11.1 + i * 3.7) * r * 0.6;
      const py = Math.cos(seed * 9.3 + i * 4.1) * r * 0.55;
      const pr = 1.6 + ((Math.sin(seed * 5.1 + i * 2.3) + 1) * 0.5) * 2;
      cx.fillStyle = palette[((seed * 7 + i) | 0) % 4];
      cx.beginPath(); cx.arc(px, py, pr, 0, TAU); cx.fill();
    }
    // wound + bone shards
    const wx = Math.sin(seed * 2.1) * r * 0.15;
    const wy = Math.cos(seed * 3.3) * r * 0.2;
    cx.fillStyle = '#5a0a0a';
    cx.beginPath(); cx.ellipse(wx, wy, r * 0.28, r * 0.16, seed, 0, TAU); cx.fill();
    cx.fillStyle = '#7a1414';
    cx.beginPath(); cx.ellipse(wx, wy, r * 0.18, r * 0.09, seed, 0, TAU); cx.fill();
    cx.fillStyle = '#d8c8a8';
    cx.fillRect(wx - 1, wy - 0.5, 4, 1);
    cx.fillRect(wx + 1, wy - 1.5, 1, 3);
    cx.fillStyle = '#e0d0b0';
    const sN = 1 + ((seed * 19) | 0) % 3;
    for (let i = 0; i < sN; i++) {
      const a = (seed * 17.3 + i * 2.4) % TAU;
      const d = r * (0.4 + ((Math.sin(seed + i) + 1) * 0.5) * 0.45);
      const len = 2 + ((seed * 3 + i * 1.7) % 3);
      cx.save();
      cx.translate(Math.cos(a) * d * 0.7, Math.sin(a) * d * 0.55);
      cx.rotate(a);
      cx.beginPath();
      cx.moveTo(0, -0.6); cx.lineTo(len, -0.4); cx.lineTo(len + 1, 0); cx.lineTo(len, 0.4); cx.lineTo(0, 0.6);
      cx.closePath(); cx.fill();
      cx.restore();
    }
    // brute plates / spitter pustules
    if (z.type === 'brute') {
      cx.fillStyle = '#bda88a';
      for (const side of [-1, 1]) {
        cx.beginPath();
        cx.moveTo(-r * 0.15, side * r * 0.5);
        cx.lineTo(-r * 0.55, side * r * 0.85);
        cx.lineTo(-r * 0.05, side * r * 0.78);
        cx.closePath(); cx.fill();
      }
      for (let i = 0; i < 4; i++) {
        const sx = -r * 0.1 - i * 5;
        cx.beginPath();
        cx.moveTo(sx, -2.5); cx.lineTo(sx - 4, 0); cx.lineTo(sx, 2.5);
        cx.closePath(); cx.fill();
      }
      cx.strokeStyle = 'rgba(20,10,10,0.6)';
      cx.lineWidth = 0.8;
      cx.beginPath();
      cx.moveTo(-r * 0.5, -r * 0.4); cx.lineTo(0, -r * 0.1); cx.lineTo(r * 0.3, -r * 0.3);
      cx.stroke();
    }
    if (z.type === 'spitter') {
      // belly underglow
      const bg = cx.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
      bg.addColorStop(0, 'rgba(180, 220, 80, 0.18)');
      bg.addColorStop(1, 'rgba(180, 220, 80, 0)');
      cx.fillStyle = bg;
      cx.beginPath(); cx.arc(0, 0, r * 0.9, 0, TAU); cx.fill();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + seed;
        const px = Math.cos(a) * r * 0.55;
        const py = Math.sin(a) * r * 0.45;
        cx.fillStyle = '#3a4a18';
        cx.beginPath(); cx.arc(px, py, 3, 0, TAU); cx.fill();
        cx.fillStyle = '#d8e078';
        cx.beginPath(); cx.arc(px - 0.6, py - 0.6, 1.6, 0, TAU); cx.fill();
      }
    }
    // head
    const headOffset = r * 0.55;
    const headR = r * (z.type === 'brute' ? 0.42 : z.type === 'spitter' ? 0.55 : 0.5);
    const headTilt = Math.sin(seed * 23.1) * 0.18;
    cx.save();
    cx.translate(headOffset, 0);
    cx.rotate(headTilt);
    cx.fillStyle = 'rgba(0,0,0,0.35)';
    cx.beginPath(); cx.ellipse(0, headR * 0.75, headR * 0.95, headR * 0.35, 0, 0, TAU); cx.fill();
    const headCol = (
      z.type === 'walker' ? '#a89878' :
      z.type === 'runner' ? '#a07858' :
      z.type === 'brute'  ? '#7a5848' :
                            '#a8b878'
    );
    cx.fillStyle = headCol;
    cx.beginPath(); cx.arc(0, 0, headR, 0, TAU); cx.fill();
    cx.fillStyle = 'rgba(0,0,0,0.18)';
    cx.beginPath(); cx.arc(-headR * 0.3, headR * 0.2, headR * 0.85, 0, TAU); cx.fill();
    cx.strokeStyle = 'rgba(40, 14, 14, 0.55)';
    cx.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      const a = seed * 1.7 + i * 1.4;
      const x0 = Math.cos(a) * headR * 0.2, y0 = Math.sin(a) * headR * 0.2;
      const x1 = Math.cos(a) * headR * 0.95, y1 = Math.sin(a) * headR * 0.95;
      const mx = (x0 + x1) / 2 + Math.cos(a + 1.5) * 1.5;
      const my = (y0 + y1) / 2 + Math.sin(a + 1.5) * 1.5;
      cx.beginPath(); cx.moveTo(x0, y0); cx.quadraticCurveTo(mx, my, x1, y1); cx.stroke();
    }
    if (z.type !== 'brute') {
      cx.fillStyle = '#150808';
      const hairN = z.type === 'runner' ? 7 : 5;
      for (let i = 0; i < hairN; i++) {
        const a = (i / (hairN - 1) - 0.5) * 1.8 + Math.PI;
        const hx = Math.cos(a) * headR * 0.92;
        const hy = Math.sin(a) * headR * 0.92;
        cx.beginPath(); cx.arc(hx, hy, 1.3 + (i % 2) * 0.6, 0, TAU); cx.fill();
        cx.strokeStyle = '#150808'; cx.lineWidth = 1;
        cx.beginPath(); cx.moveTo(hx, hy); cx.lineTo(hx + Math.cos(a) * 3, hy + Math.sin(a) * 3); cx.stroke();
      }
    }
    cx.fillStyle = headCol;
    cx.beginPath(); cx.ellipse(0, -headR * 0.95, headR * 0.18, headR * 0.28, 0, 0, TAU); cx.fill();
    // mouth
    const mouthOpen = 0.7 + ((Math.sin(seed * 1.7) + 1) * 0.5) * 0.35;
    const jawW = headR * (z.type === 'spitter' ? 1.3 : z.type === 'runner' ? 1.0 : 0.9) * mouthOpen;
    const jawH = headR * (z.type === 'spitter' ? 0.6 : 0.5) * mouthOpen;
    const jawCx = headR * 0.55;
    cx.fillStyle = '#080000';
    cx.beginPath(); cx.ellipse(jawCx, 0, jawW * 0.5, jawH, 0, 0, TAU); cx.fill();
    cx.fillStyle = '#1a0303';
    cx.beginPath(); cx.ellipse(jawCx + jawW * 0.05, 0, jawW * 0.32, jawH * 0.65, 0, 0, TAU); cx.fill();
    cx.fillStyle = '#d4c4a4';
    const teethN = z.type === 'brute' ? 6 : 5;
    for (let i = 0; i < teethN; i++) {
      const tx = jawCx + (i / (teethN - 1) - 0.5) * jawW * 0.78;
      cx.beginPath();
      cx.moveTo(tx - 0.7, -jawH * 0.65); cx.lineTo(tx, -jawH * 0.18); cx.lineTo(tx + 0.7, -jawH * 0.65);
      cx.closePath(); cx.fill();
      cx.beginPath();
      cx.moveTo(tx - 0.7, jawH * 0.65); cx.lineTo(tx, jawH * 0.18); cx.lineTo(tx + 0.7, jawH * 0.65);
      cx.closePath(); cx.fill();
    }
    cx.fillStyle = 'rgba(120, 8, 8, 0.55)';
    cx.beginPath(); cx.ellipse(jawCx + 1, 0, jawW * 0.65, jawH * 1.35, 0, 0, TAU); cx.fill();
    cx.fillStyle = '#5a0606';
    cx.beginPath(); cx.arc(jawCx + jawW * 0.5, jawH * 0.4, 1.4, 0, TAU); cx.fill();
    cx.beginPath(); cx.arc(jawCx + jawW * 0.55, jawH * 0.7, 0.8, 0, TAU); cx.fill();
    if (z.type === 'spitter') {
      cx.fillStyle = '#883a3a';
      cx.beginPath(); cx.ellipse(jawCx + jawW * 0.3, 0, jawW * 0.25, jawH * 0.4, 0, 0, TAU); cx.fill();
    }
    // eye sockets (dark)
    cx.fillStyle = 'rgba(0,0,0,0.45)';
    for (const side of [-1, 1]) {
      cx.beginPath(); cx.arc(headR * 0.1, side * headR * 0.42, headR * 0.26, 0, TAU); cx.fill();
    }
    cx.fillStyle = '#020000';
    for (const side of [-1, 1]) {
      cx.beginPath(); cx.arc(headR * 0.15, side * headR * 0.4, headR * 0.18, 0, TAU); cx.fill();
    }
    cx.restore();
  }

  _buildZombieSprite(z) {
    const SS = 100;
    const c = document.createElement('canvas');
    c.width = c.height = SS;
    const cx = c.getContext('2d');
    cx.translate(SS / 2, SS / 2);
    this._paintZombieBody(cx, z);
    // flash variant: white-tinted via source-atop
    const flashC = document.createElement('canvas');
    flashC.width = flashC.height = SS;
    const fcx = flashC.getContext('2d');
    fcx.drawImage(c, 0, 0);
    fcx.globalCompositeOperation = 'source-atop';
    fcx.fillStyle = 'rgba(255, 240, 240, 0.78)';
    fcx.fillRect(0, 0, SS, SS);
    return { canvas: c, flashCanvas: flashC, seed: z.seed, size: SS };
  }

  drawZombie(z) {
    const ctx = this.ctx;
    // worldToScreen inlined to avoid object alloc
    const sx = (z.x - this.cam.x) + this.viewW / 2 + this.cam.sx;
    const sy = (z.y - this.cam.y) + this.viewH / 2 + this.cam.sy;
    if (sx < -100 || sx > this.viewW + 100 || sy < -100 || sy > this.viewH + 100) return;
    const r = z.r;
    const flash = z.flash > 0;

    // ground shadow (screen space)
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.ellipse(sx + 2, sy + r * 0.85, r * 1.05, r * 0.42, 0, 0, TAU);
    ctx.fill();

    // sprite (cached)
    let sprite = this.zombieSprites.get(z.id);
    if (!sprite || sprite.seed !== z.seed) {
      sprite = this._buildZombieSprite(z);
      this.zombieSprites.set(z.id, sprite);
    }

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(z.angle);
    const breath = Math.sin(this.timeMs * 0.005 + z.seed) * 0.5;
    const sway = Math.sin(this.timeMs * 0.012 + z.wobble) * 0.04;
    ctx.translate(0, breath);
    ctx.rotate(sway);
    ctx.drawImage(flash ? sprite.flashCanvas : sprite.canvas, -sprite.size / 2, -sprite.size / 2);

    // live arms (with swing)
    this._drawZombieArms(ctx, z);

    // live eye pupils with flicker
    if (!flash) this._drawZombieEyes(ctx, z);

    ctx.restore();

    // hp bar
    if (z.hp < z.maxHp) {
      const ratio = clamp(z.hp / z.maxHp, 0, 1);
      const bw = z.r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sx - bw / 2, sy - z.r - 12, bw, 4);
      ctx.fillStyle = ratio > 0.4 ? '#9affb6' : '#ff7d7d';
      ctx.fillRect(sx - bw / 2 + 1, sy - z.r - 11, (bw - 2) * ratio, 2);
    }

    // eye glow halo (cached glow sprite, drawn at world-space eye position)
    if (!flash) {
      const flicker = 0.55 + 0.45 * Math.sin(this.timeMs * 0.015 + z.seed * 11);
      // Twitch: brief intense flare every few seconds (matches eye twitch phase).
      const twitch = Math.sin(this.timeMs * 0.0009 + z.seed * 3.7) > 0.92 ? 1.45 : 1;
      // Proximity aura: zombies near the local player glow much more menacingly.
      let proxBoost = 1;
      if (this.localPlayerPos) {
        const dx = z.x - this.localPlayerPos.x;
        const dy = z.y - this.localPlayerPos.y;
        const d = Math.hypot(dx, dy);
        const NEAR = 200, FAR = 520;
        if (d < FAR) {
          const k = Math.max(0, Math.min(1, (FAR - d) / (FAR - NEAR)));
          proxBoost = 1 + k * 1.4;
        }
      }
      const eyeFwd = r * 0.55 + r * 0.5 * 0.18;
      const exwx = z.x + Math.cos(z.angle) * eyeFwd;
      const exwy = z.y + Math.sin(z.angle) * eyeFwd;
      const esx = (exwx - this.cam.x) + this.viewW / 2 + this.cam.sx;
      const esy = (exwy - this.cam.y) + this.viewH / 2 + this.cam.sy;
      const haloR = r * 1.05 * flicker * twitch * proxBoost;
      const sprite = z.type === 'spitter' ? this.glowSprites.green : this.glowSprites.red;
      const a = ctx.globalAlpha;
      ctx.globalAlpha = Math.min(0.95, 0.42 * flicker * proxBoost);
      ctx.drawImage(sprite, esx - haloR, esy - haloR, haloR * 2, haloR * 2);
      // Outer body aura when zombie is close — a wider faint red wash around the corpse silhouette
      if (proxBoost > 1.4) {
        const auraR = r * 2.4 * proxBoost;
        const intensity = (proxBoost - 1) / 1.4;
        ctx.globalAlpha = 0.22 * intensity;
        ctx.drawImage(sprite, sx - auraR, sy - auraR, auraR * 2, auraR * 2);
      }
      ctx.globalAlpha = a;
    }
  }

  _drawZombieArms(cx, z) {
    const r = z.r;
    const seed = z.seed;
    const limpSide = (Math.sin(seed * 17.7) > 0) ? -1 : 1;
    const armSwing = Math.sin(this.timeMs * 0.012 + z.wobble) * 0.35;
    const clothCol = (
      z.type === 'walker' ? '#241c12' :
      z.type === 'runner' ? '#1a1820' :
      z.type === 'brute'  ? '#1c0a0a' :
                            '#1d2a14'
    );
    const handCol = (
      z.type === 'walker' ? '#9c8a6c' :
      z.type === 'runner' ? '#8a6e4e' :
      z.type === 'brute'  ? '#7a5848' :
                            '#9aa878'
    );
    for (let s = -1; s <= 1; s += 2) {
      cx.save();
      const reach = s === limpSide ? 0.78 : 1.08;
      cx.translate(r * 0.25, s * r * 0.55);
      cx.rotate(armSwing * s * 0.6);
      cx.fillStyle = clothCol;
      cx.beginPath(); cx.ellipse(r * 0.18, 0, r * 0.3 * reach, r * 0.2, 0, 0, TAU); cx.fill();
      cx.fillStyle = handCol;
      cx.beginPath(); cx.ellipse(r * 0.5 * reach, 0, r * 0.32 * reach, r * 0.16, 0, 0, TAU); cx.fill();
      cx.beginPath(); cx.arc(r * 0.78 * reach, 0, r * 0.16, 0, TAU); cx.fill();
      cx.strokeStyle = '#0a0202';
      cx.lineWidth = 1.1; cx.lineCap = 'round';
      cx.beginPath();
      cx.moveTo(r * 0.86 * reach, -3); cx.lineTo(r * 1.02 * reach, -4);
      cx.moveTo(r * 0.86 * reach, 0);  cx.lineTo(r * 0.98 * reach, 0);
      cx.moveTo(r * 0.86 * reach, 3);  cx.lineTo(r * 1.02 * reach, 4);
      cx.stroke();
      cx.lineCap = 'butt';
      cx.restore();
    }
  }

  _drawZombieEyes(cx, z) {
    const r = z.r;
    const seed = z.seed;
    const headOffset = r * 0.55;
    const headR = r * (z.type === 'brute' ? 0.42 : z.type === 'spitter' ? 0.55 : 0.5);
    const headTilt = Math.sin(seed * 23.1) * 0.18;
    cx.save();
    cx.translate(headOffset, 0);
    cx.rotate(headTilt);
    const flicker = 0.65 + 0.35 * Math.sin(this.timeMs * 0.015 + seed * 11);
    // Occasional rapid twitch — eye blast brighter & jitters for ~120ms every few seconds.
    const twitchPhase = Math.sin(this.timeMs * 0.0009 + seed * 3.7);
    const twitching = twitchPhase > 0.92;
    const intensity = twitching ? 1 : flicker;
    const jitterX = twitching ? (Math.sin(this.timeMs * 0.06 + seed) * 0.6) : 0;
    const jitterY = twitching ? (Math.cos(this.timeMs * 0.07 + seed) * 0.6) : 0;
    // Inner sclera glow (white-hot core)
    cx.fillStyle = z.type === 'spitter'
      ? `rgba(255, 255, 200, ${0.55 * intensity})`
      : `rgba(255, 220, 200, ${0.55 * intensity})`;
    const coreR = (1.6 + intensity * 0.9) + (twitching ? 0.6 : 0);
    cx.beginPath();
    cx.arc(headR * 0.22 + jitterX, -headR * 0.4 + jitterY, coreR, 0, TAU);
    cx.arc(headR * 0.22 + jitterX,  headR * 0.4 + jitterY, coreR, 0, TAU);
    cx.fill();
    // Pupil (saturated)
    const eyeCol = z.type === 'spitter'
      ? `rgba(200, 255, ${(40 + intensity * 70) | 0}, 1)`
      : `rgba(255, ${(20 + intensity * 50) | 0}, ${(20 + intensity * 30) | 0}, 1)`;
    cx.fillStyle = eyeCol;
    const eyeR = 1.3 + intensity * 0.7;
    cx.beginPath();
    cx.arc(headR * 0.22 + jitterX, -headR * 0.4 + jitterY, eyeR, 0, TAU);
    cx.arc(headR * 0.22 + jitterX,  headR * 0.4 + jitterY, eyeR, 0, TAU);
    cx.fill();
    cx.restore();
  }

  drawPlayers(world) {
    for (const p of world.players) this.drawPlayer(p, p.id === this.localPlayerId);
  }
  drawPlayer(p, isLocal) {
    const ctx = this.ctx;
    const s = this.worldToScreen(p.x, p.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(0, p.r * 0.8, p.r * 1.1, p.r * 0.45, 0, 0, TAU); ctx.fill();
    if (p.dead) {
      // corpse: cross out
      ctx.fillStyle = 'rgba(60, 30, 30, 0.6)';
      ctx.beginPath(); ctx.arc(0, 0, p.r * 0.9, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#a01515'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-p.r * 0.5, -p.r * 0.5); ctx.lineTo(p.r * 0.5, p.r * 0.5);
      ctx.moveTo(p.r * 0.5, -p.r * 0.5); ctx.lineTo(-p.r * 0.5, p.r * 0.5);
      ctx.stroke();
      ctx.restore();
      // name above
      this.drawNameTag(p, s);
      return;
    }
    if (p.iframesMs > 0 && Math.floor(this.timeMs / 60) % 2 === 0) ctx.globalAlpha = 0.5;
    ctx.rotate(p.angle);
    const baseCol = p.color;
    const bodyCol = p.hurtFlash > 0 ? '#ff7d7d' : darken(baseCol, 0.5);
    ctx.fillStyle = bodyCol;
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
    ctx.fillStyle = darken(baseCol, 0.3);
    ctx.beginPath(); ctx.ellipse(-2, 0, p.r * 0.95, p.r * 0.4, 0, 0, TAU); ctx.fill();
    // shoulders use player color (team identification)
    ctx.fillStyle = baseCol;
    ctx.beginPath(); ctx.ellipse(0, -p.r * 0.7, p.r * 0.6, p.r * 0.35, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, p.r * 0.7, p.r * 0.6, p.r * 0.35, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#caa67a';
    ctx.beginPath(); ctx.arc(p.r * 0.25, 0, p.r * 0.55, 0, TAU); ctx.fill();
    // helmet
    ctx.fillStyle = darken(baseCol, 0.25);
    ctx.beginPath(); ctx.arc(p.r * 0.15, 0, p.r * 0.5, -Math.PI*0.55, Math.PI*0.55); ctx.fill();
    const w = WEAPONS[p.weapon];
    drawWeaponInHand(ctx, w, p.r);
    if (p.muzzleFlash > 0) {
      const k = p.muzzleFlash / 0.06;
      ctx.fillStyle = `rgba(255, 220, 100, ${k})`;
      ctx.beginPath(); ctx.arc(p.r + 14, 0, 8 * k, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // reload bar
    if (p.reloadMs > 0) {
      const wmax = WEAPONS[p.weapon].reloadMs;
      const ratio = 1 - p.reloadMs / wmax;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(s.x - 22, s.y - p.r - 16, 44, 5);
      ctx.fillStyle = '#ffc857';
      ctx.fillRect(s.x - 21, s.y - p.r - 15, 42 * ratio, 3);
    }
    if (p.stamina < p.maxStamina - 0.05) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(s.x - 18, s.y + p.r + 8, 36, 3);
      ctx.fillStyle = '#5cc8ff';
      ctx.fillRect(s.x - 17, s.y + p.r + 8.5, 34 * (p.stamina / p.maxStamina), 2);
    }
    // name + hp pip for non-local players
    if (!isLocal) this.drawNameTag(p, s);
  }
  drawNameTag(p, s) {
    const ctx = this.ctx;
    const text = p.name || 'PLAYER';
    ctx.font = 'bold 11px "Rubik", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(s.x - w/2, s.y - p.r - 28, w, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(s.x - w/2, s.y - p.r - 14, w, 3);
    const ratio = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = ratio > 0.4 ? '#9affb6' : '#ff7d7d';
    ctx.fillRect(s.x - w/2 + 1, s.y - p.r - 13, (w - 2) * ratio, 1);
    ctx.fillStyle = p.color;
    ctx.fillText(text, s.x, s.y - p.r - 21);
  }

  drawBullets(world) {
    const ctx = this.ctx;
    for (const b of world.bullets) {
      const s = this.worldToScreen(b.x, b.y);
      const ang = Math.atan2(b.vy, b.vx);
      const len = b.tracer;
      const tx = s.x - Math.cos(ang) * len;
      const ty = s.y - Math.sin(ang) * len;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.8, 0, TAU); ctx.fill();
    }
    for (const b of world.enemyBullets) {
      const s = this.worldToScreen(b.x, b.y);
      ctx.fillStyle = 'rgba(168, 208, 74, 0.3)';
      ctx.beginPath(); ctx.arc(s.x, s.y, b.r * 2, 0, TAU); ctx.fill();
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, b.r, 0, TAU); ctx.fill();
    }
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const s = this.worldToScreen(p.x, p.y);
      const k = clamp(p.life / p.max, 0, 1);
      if (p.type === 'flash') {
        ctx.fillStyle = p.color; ctx.globalAlpha = k;
        ctx.beginPath(); ctx.arc(s.x, s.y, p.size, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.type === 'smoke') {
        ctx.fillStyle = p.color.replace(/[\d.]+\)$/, `${(0.4 * k).toFixed(2)})`);
        ctx.beginPath(); ctx.arc(s.x, s.y, p.size, 0, TAU); ctx.fill();
      } else if (p.type === 'casing') {
        ctx.fillStyle = p.color; ctx.globalAlpha = clamp(k * 1.5, 0, 1);
        ctx.fillRect(s.x - p.size, s.y - p.size * 0.4, p.size * 2, p.size * 0.8);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, p.size * (0.5 + k * 0.5), 0, TAU); ctx.fill();
      }
    }
  }

  drawMuzzleGlow(world) {
    const ctx = this.ctx;
    const lp = world.players.find(p => p.id === this.localPlayerId) || world.players[0];
    if (!lp || !(lp.muzzleFlash > 0)) return;
    const k = lp.muzzleFlash / 0.06;
    const fwx = lp.x + Math.cos(lp.angle) * 22;
    const fwy = lp.y + Math.sin(lp.angle) * 22;
    const fcx = (fwx - this.cam.x) + this.viewW / 2 + this.cam.sx;
    const fcy = (fwy - this.cam.y) + this.viewH / 2 + this.cam.sy;
    const size = 360 * k;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = 0.55 * k;
    ctx.drawImage(this.glowSprites.yellow, fcx - size / 2, fcy - size / 2, size, size);
    ctx.globalAlpha = a;
  }

  drawLighting(world) {
    const ctx = this.ctx;
    if (this.lightingSprite) ctx.drawImage(this.lightingSprite, 0, 0);
  }

  drawCinematicOverlay() {
    if (!this.cinematic) return;
    const ctx = this.ctx;
    const c = this.cinematic;
    const blend = this.cam.focusBlend; // 0..1 in/hold/out
    if (blend <= 0) return;

    // Letterbox bars
    const barH = this.viewH * 0.11 * blend;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.viewW, barH);
    ctx.fillRect(0, this.viewH - barH, this.viewW, barH);

    // Edge vignette (heavier than the normal one)
    const grad = ctx.createRadialGradient(
      this.viewW / 2, this.viewH / 2, this.viewH * 0.18,
      this.viewW / 2, this.viewH / 2, this.viewH * 0.7
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(8,0,0,${0.55 * blend})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Brief impact white-flash at the start of the hold phase
    if (c.age >= 0.14 && c.age < 0.28) {
      const t = (c.age - 0.14) / 0.14;
      const a = (1 - t) * 0.55;
      ctx.fillStyle = `rgba(255, 230, 220, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    // Subtle red bloom that fades through the cinematic
    const bloomA = 0.18 * blend * (0.6 + 0.4 * Math.sin(c.age * 9));
    ctx.fillStyle = `rgba(120, 8, 8, ${bloomA.toFixed(3)})`;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // "KILL" stamp upper-right during hold
    if (c.age > 0.18 && c.age < 0.85) {
      const stampA = blend * (c.age < 0.32 ? (c.age - 0.18) / 0.14 : 1) * (c.age > 0.7 ? Math.max(0, 1 - (c.age - 0.7) / 0.15) : 1);
      ctx.save();
      ctx.globalAlpha = stampA;
      const label = (
        c.ztype === 'brute' ? 'BRUTE DOWN' :
        c.ztype === 'spitter' ? 'SPITTER DOWN' :
        c.ztype === 'runner' ? 'RUNNER DOWN' :
        'WALKER DOWN'
      );
      ctx.font = '900 26px "Rubik", system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      const padX = 28, padY = barH + 16;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const w = ctx.measureText(label).width;
      ctx.fillRect(this.viewW - padX - w - 14, padY - 4, w + 18, 36);
      ctx.fillStyle = '#ff3030';
      ctx.fillText(label, this.viewW - padX, padY);
      ctx.font = '600 11px "Rubik", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('CONFIRMED', this.viewW - padX, padY + 22);
      ctx.restore();
    }
  }

  drawCrosshair(world, mouse) {
    const lp = world.players.find(p => p.id === this.localPlayerId);
    if (!lp || lp.dead) return;
    const w = WEAPONS[lp.weapon];
    const r = 14 + w.spread * 100;
    const x = mouse.sx, y = mouse.sy;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - r - 6, y); ctx.lineTo(x - r, y);
    ctx.moveTo(x + r + 6, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r - 6); ctx.lineTo(x, y - r);
    ctx.moveTo(x, y + r + 6); ctx.lineTo(x, y + r);
    ctx.stroke();
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fill();
  }
}

function drawWeaponInHand(ctx, w, pr) {
  ctx.save();
  if (w.key === 'pistol') {
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(pr - 2, -3, 16, 6);
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(pr + 8, -2, 6, 4);
  } else if (w.key === 'shotgun') {
    ctx.fillStyle = '#3a2418'; ctx.fillRect(pr - 4, -3, 6, 6);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(pr + 2, -3, 22, 6);
  } else if (w.key === 'smg') {
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(pr - 2, -3, 18, 6);
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(pr + 4, 3, 5, 6);
  } else if (w.key === 'rifle') {
    ctx.fillStyle = '#3a2418'; ctx.fillRect(pr - 4, -3, 8, 6);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(pr + 4, -2, 26, 4);
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(pr + 26, -3, 4, 6);
  }
  ctx.restore();
}

function darken(hex, k) {
  // hex is "#rrggbb"
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.floor(((n >> 16) & 255) * k));
  const g = Math.max(0, Math.floor(((n >> 8) & 255) * k));
  const b = Math.max(0, Math.floor((n & 255) * k));
  return `rgb(${r}, ${g}, ${b})`;
}
