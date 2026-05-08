// Canvas2D renderer. Stateful: owns particles, decals, camera, ground texture.
// Consumes snapshots from World plus events to spawn local-only effects.

import { TAU, HILL_R, HILL_CORE_R, ARENA_R, WEAPONS, ZTYPES } from './data.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = 0;
    this.viewH = 0;
    this.particles = [];
    this.decals = [];
    this.cam = { x: 0, y: 0, sx: 0, sy: 0, shake: 0 };
    this.timeMs = 0;
    this.localPlayerId = null;
    this.localMuzzleFlash = 0;
    this.groundCanvas = null;
    this.buildGround();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.canvas.style.width = this.viewW + 'px';
    this.canvas.style.height = this.viewH + 'px';
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

  worldToScreen(wx, wy) {
    return { x: (wx - this.cam.x) + this.viewW / 2 + this.cam.sx, y: (wy - this.cam.y) + this.viewH / 2 + this.cam.sy };
  }
  screenToWorld(sx, sy) {
    return { x: sx - this.viewW / 2 - this.cam.sx + this.cam.x, y: sy - this.viewH / 2 - this.cam.sy + this.cam.y };
  }

  setLocalPlayer(id) { this.localPlayerId = id; }
  addShake(amount) { this.cam.shake = Math.min(1, this.cam.shake + amount); }

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
    for (let i = 0; i < 22; i++) {
      const a = rand(0, TAU);
      this.particles.push({ x, y, vx: Math.cos(a)*rand(120, 320), vy: Math.sin(a)*rand(120, 320), life: rand(0.4, 0.9), max: 0.9, size: rand(3, 6), color: '#a01515', type: 'blood' });
    }
    this.bloodSplatter(x, y, rand(0, TAU), 1.4);
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
    // camera follow local player
    if (world) {
      const lp = world.players.find(p => p.id === this.localPlayerId) || world.players[0];
      if (lp) {
        this.cam.x = lerp(this.cam.x, lp.x, 1 - Math.exp(-8 * dt));
        this.cam.y = lerp(this.cam.y, lp.y, 1 - Math.exp(-8 * dt));
      }
    }
    if (this.cam.shake > 0) {
      this.cam.shake = Math.max(0, this.cam.shake - dt * 4);
      const m = this.cam.shake * this.cam.shake * 18;
      this.cam.sx = (Math.random() * 2 - 1) * m;
      this.cam.sy = (Math.random() * 2 - 1) * m;
    } else { this.cam.sx = 0; this.cam.sy = 0; }
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.type === 'blood') { p.vx *= 0.86; p.vy *= 0.86; }
      else if (p.type === 'smoke') { p.vx *= 0.95; p.vy *= 0.95; p.size += dt * 8; }
      else if (p.type === 'casing') { p.vx *= 0.9; p.vy *= 0.9; }
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    if (this.localMuzzleFlash > 0) this.localMuzzleFlash -= dt;
    for (const d of this.decals) d.age += dt;
  }

  // ----- Draw -----
  draw(world, mouse) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    if (!world) return;

    this.drawGround();
    this.drawArenaEdge();
    this.drawDecals();
    this.drawHill(world);
    this.drawPickups(world);
    this.drawZombies(world);
    this.drawPlayers(world);
    this.drawBullets(world);
    this.drawParticles();
    this.drawLighting(world);
    this.drawCrosshair(world, mouse);
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
    for (const z of world.zombies) this.drawZombie(z);
  }
  drawZombie(z) {
    const ctx = this.ctx;
    const s = this.worldToScreen(z.x, z.y);
    if (s.x < -100 || s.x > this.viewW + 100 || s.y < -100 || s.y > this.viewH + 100) return;
    const r = z.r;
    const flash = z.flash > 0;
    const seed = z.seed;

    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.ellipse(s.x + 2, s.y + r * 0.85, r * 1.05, r * 0.42, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(z.angle);
    const breath = Math.sin(this.timeMs * 0.005 + seed) * 0.5;
    const sway = Math.sin(this.timeMs * 0.012 + z.wobble) * 0.04;
    ctx.translate(0, breath);
    ctx.rotate(sway);

    // Tattered cloth silhouette
    const clothCol = flash ? '#5a3030' : (
      z.type === 'walker' ? '#241c12' :
      z.type === 'runner' ? '#1a1820' :
      z.type === 'brute'  ? '#1c0a0a' :
                            '#1d2a14'
    );
    ctx.fillStyle = clothCol;
    ctx.beginPath();
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const j = ((Math.sin(seed * 7.1 + i * 1.7) + 1) * 0.5);
      const k = ((Math.sin(seed * 3.3 + i * 4.2) + 1) * 0.5);
      const radius = r * (1.04 + 0.22 * j) * (0.85 + 0.18 * k);
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius * 0.86;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();

    if (!flash) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        const a = seed + i * 2.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.6);
        ctx.lineTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 0.95);
        ctx.stroke();
      }
    }

    const bodyCol = flash ? '#fff' : (
      z.type === 'walker' ? '#5d6a4a' :
      z.type === 'runner' ? '#6a5a3a' :
      z.type === 'brute'  ? '#4a3a36' :
                            '#7a8a4a'
    );
    ctx.fillStyle = bodyCol;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.86, r * 0.7, 0, 0, TAU); ctx.fill();

    if (!flash) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(0, r * 0.18, r * 0.82, r * 0.45, 0, 0, TAU); ctx.fill();
    }

    // decay patches (deterministic from seed)
    if (!flash) {
      const decayN = 4 + ((seed * 13) | 0) % 3;
      for (let i = 0; i < decayN; i++) {
        const px = Math.sin(seed * 11.1 + i * 3.7) * r * 0.6;
        const py = Math.cos(seed * 9.3 + i * 4.1) * r * 0.55;
        const pr = 1.6 + ((Math.sin(seed * 5.1 + i * 2.3) + 1) * 0.5) * 2;
        const hueIdx = ((seed * 7 + i) | 0) % 4;
        ctx.fillStyle = ['#3a1010', '#5a2010', '#2a2a14', '#1a0e0a'][hueIdx];
        ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      }
    }

    // wound + bone shards
    if (!flash) {
      const wx = Math.sin(seed * 2.1) * r * 0.15;
      const wy = Math.cos(seed * 3.3) * r * 0.2;
      ctx.fillStyle = '#5a0a0a';
      ctx.beginPath(); ctx.ellipse(wx, wy, r * 0.28, r * 0.16, seed, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a1414';
      ctx.beginPath(); ctx.ellipse(wx, wy, r * 0.18, r * 0.09, seed, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d8c8a8';
      ctx.fillRect(wx - 1, wy - 0.5, 4, 1);
      ctx.fillRect(wx + 1, wy - 1.5, 1, 3);
      // protruding bone shards
      ctx.fillStyle = '#e0d0b0';
      const sN = 1 + ((seed * 19) | 0) % 3;
      for (let i = 0; i < sN; i++) {
        const a = (seed * 17.3 + i * 2.4) % TAU;
        const d = r * (0.4 + ((Math.sin(seed + i) + 1) * 0.5) * 0.45);
        const len = 2 + ((seed * 3 + i * 1.7) % 3);
        ctx.save();
        ctx.translate(Math.cos(a) * d * 0.7, Math.sin(a) * d * 0.55);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, -0.6); ctx.lineTo(len, -0.4); ctx.lineTo(len + 1, 0); ctx.lineTo(len, 0.4); ctx.lineTo(0, 0.6);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    if (z.type === 'brute') {
      const boneCol = flash ? '#fff' : '#bda88a';
      ctx.fillStyle = boneCol;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.15, side * r * 0.5);
        ctx.lineTo(-r * 0.55, side * r * 0.85);
        ctx.lineTo(-r * 0.05, side * r * 0.78);
        ctx.closePath(); ctx.fill();
      }
      for (let i = 0; i < 4; i++) {
        const sx = -r * 0.1 - i * 5;
        ctx.beginPath();
        ctx.moveTo(sx, -2.5); ctx.lineTo(sx - 4, 0); ctx.lineTo(sx, 2.5);
        ctx.closePath(); ctx.fill();
      }
      if (!flash) {
        ctx.strokeStyle = 'rgba(20,10,10,0.6)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.4); ctx.lineTo(0, -r * 0.1); ctx.lineTo(r * 0.3, -r * 0.3);
        ctx.stroke();
      }
    }
    if (z.type === 'spitter') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + seed;
        const px = Math.cos(a) * r * 0.55;
        const py = Math.sin(a) * r * 0.45;
        ctx.fillStyle = flash ? '#fff' : '#3a4a18';
        ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.fill();
        ctx.fillStyle = flash ? '#fff' : '#d8e078';
        ctx.beginPath(); ctx.arc(px - 0.6, py - 0.6, 1.6, 0, TAU); ctx.fill();
      }
      if (!flash) {
        const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
        bg.addColorStop(0, 'rgba(180, 220, 80, 0.18)');
        bg.addColorStop(1, 'rgba(180, 220, 80, 0)');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, TAU); ctx.fill();
      }
    }

    // arms
    const limpSide = (Math.sin(seed * 17.7) > 0) ? -1 : 1;
    const armSwing = Math.sin(this.timeMs * 0.012 + z.wobble) * 0.35;
    const handCol = flash ? '#fff' : (
      z.type === 'walker' ? '#9c8a6c' :
      z.type === 'runner' ? '#8a6e4e' :
      z.type === 'brute'  ? '#7a5848' :
                            '#9aa878'
    );
    for (const side of [-1, 1]) {
      ctx.save();
      const reach = side === limpSide ? 0.78 : 1.08;
      ctx.translate(r * 0.25, side * r * 0.55);
      ctx.rotate(armSwing * side * 0.6);
      ctx.fillStyle = clothCol;
      ctx.beginPath(); ctx.ellipse(r * 0.18, 0, r * 0.3 * reach, r * 0.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = handCol;
      ctx.beginPath(); ctx.ellipse(r * 0.5 * reach, 0, r * 0.32 * reach, r * 0.16, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.78 * reach, 0, r * 0.16, 0, TAU); ctx.fill();
      ctx.strokeStyle = flash ? '#fff' : '#0a0202';
      ctx.lineWidth = 1.1; ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(r * 0.86 * reach, i * 3);
        ctx.lineTo(r * (0.98 + 0.04 * Math.abs(i)) * reach, i * 4);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      if (!flash && side !== limpSide) {
        ctx.fillStyle = 'rgba(120, 14, 14, 0.5)';
        ctx.beginPath(); ctx.ellipse(r * 0.45 * reach, 1, r * 0.18, r * 0.07, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // head
    const headOffset = r * 0.55;
    const headR = r * (z.type === 'brute' ? 0.42 : z.type === 'spitter' ? 0.55 : 0.5);
    const headTilt = Math.sin(seed * 23.1) * 0.18;
    ctx.save();
    ctx.translate(headOffset, 0);
    ctx.rotate(headTilt);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, headR * 0.75, headR * 0.95, headR * 0.35, 0, 0, TAU); ctx.fill();
    const headCol = flash ? '#fff' : (
      z.type === 'walker' ? '#a89878' :
      z.type === 'runner' ? '#a07858' :
      z.type === 'brute'  ? '#7a5848' :
                            '#a8b878'
    );
    ctx.fillStyle = headCol;
    ctx.beginPath(); ctx.arc(0, 0, headR, 0, TAU); ctx.fill();
    if (!flash) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.arc(-headR * 0.3, headR * 0.2, headR * 0.85, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(40, 14, 14, 0.55)';
      ctx.lineWidth = 0.6;
      for (let i = 0; i < 3; i++) {
        const a = seed * 1.7 + i * 1.4;
        const x0 = Math.cos(a) * headR * 0.2, y0 = Math.sin(a) * headR * 0.2;
        const x1 = Math.cos(a) * headR * 0.95, y1 = Math.sin(a) * headR * 0.95;
        const mx = (x0 + x1) / 2 + Math.cos(a + 1.5) * 1.5;
        const my = (y0 + y1) / 2 + Math.sin(a + 1.5) * 1.5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
      }
    }
    if (!flash && z.type !== 'brute') {
      ctx.fillStyle = '#150808';
      const hairN = z.type === 'runner' ? 7 : 5;
      for (let i = 0; i < hairN; i++) {
        const a = (i / (hairN - 1) - 0.5) * 1.8 + Math.PI;
        const hx = Math.cos(a) * headR * 0.92;
        const hy = Math.sin(a) * headR * 0.92;
        ctx.beginPath(); ctx.arc(hx, hy, 1.3 + (i % 2) * 0.6, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#150808'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 3, hy + Math.sin(a) * 3); ctx.stroke();
      }
    }
    if (!flash) {
      ctx.fillStyle = headCol;
      ctx.beginPath(); ctx.ellipse(0, -headR * 0.95, headR * 0.18, headR * 0.28, 0, 0, TAU); ctx.fill();
    }
    const mouthOpen = 0.7 + ((Math.sin(seed * 1.7) + 1) * 0.5) * 0.35;
    const jawW = headR * (z.type === 'spitter' ? 1.3 : z.type === 'runner' ? 1.0 : 0.9) * mouthOpen;
    const jawH = headR * (z.type === 'spitter' ? 0.6 : 0.5) * mouthOpen;
    const jawCx = headR * 0.55;
    ctx.fillStyle = flash ? '#aa3333' : '#080000';
    ctx.beginPath(); ctx.ellipse(jawCx, 0, jawW * 0.5, jawH, 0, 0, TAU); ctx.fill();
    if (!flash) {
      ctx.fillStyle = '#1a0303';
      ctx.beginPath(); ctx.ellipse(jawCx + jawW * 0.05, 0, jawW * 0.32, jawH * 0.65, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d4c4a4';
      const teethN = z.type === 'brute' ? 6 : 5;
      for (let i = 0; i < teethN; i++) {
        const tx = jawCx + (i / (teethN - 1) - 0.5) * jawW * 0.78;
        ctx.beginPath();
        ctx.moveTo(tx - 0.7, -jawH * 0.65); ctx.lineTo(tx, -jawH * 0.18); ctx.lineTo(tx + 0.7, -jawH * 0.65);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(tx - 0.7, jawH * 0.65); ctx.lineTo(tx, jawH * 0.18); ctx.lineTo(tx + 0.7, jawH * 0.65);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = 'rgba(120, 8, 8, 0.55)';
      ctx.beginPath(); ctx.ellipse(jawCx + 1, 0, jawW * 0.65, jawH * 1.35, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a0606';
      ctx.beginPath(); ctx.arc(jawCx + jawW * 0.5, jawH * 0.4, 1.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(jawCx + jawW * 0.55, jawH * 0.7, 0.8, 0, TAU); ctx.fill();
      if (z.type === 'spitter') {
        ctx.fillStyle = '#883a3a';
        ctx.beginPath(); ctx.ellipse(jawCx + jawW * 0.3, 0, jawW * 0.25, jawH * 0.4, 0, 0, TAU); ctx.fill();
      }
    }
    if (!flash) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(headR * 0.1, side * headR * 0.42, headR * 0.26, 0, TAU); ctx.fill();
      }
    }
    ctx.fillStyle = flash ? '#aa3333' : '#020000';
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.arc(headR * 0.15, side * headR * 0.4, headR * 0.18, 0, TAU); ctx.fill();
    }
    if (!flash) {
      const flicker = 0.65 + 0.35 * Math.sin(this.timeMs * 0.015 + seed * 11);
      const eyeCol = z.type === 'spitter'
        ? `rgba(220, 255, ${50 + flicker * 60}, 1)`
        : `rgba(255, ${20 + flicker * 50}, ${20 + flicker * 30}, 1)`;
      ctx.fillStyle = eyeCol;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(headR * 0.22, side * headR * 0.4, 1.3 + flicker * 0.6, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    ctx.restore();

    // hp bar
    if (z.hp < z.maxHp) {
      const ratio = clamp(z.hp / z.maxHp, 0, 1);
      const w = z.r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(s.x - w/2, s.y - z.r - 12, w, 4);
      ctx.fillStyle = ratio > 0.4 ? '#9affb6' : '#ff7d7d';
      ctx.fillRect(s.x - w/2 + 1, s.y - z.r - 11, (w - 2) * ratio, 2);
    }

    // eye glow
    if (!flash) {
      const flicker = 0.55 + 0.45 * Math.sin(this.timeMs * 0.015 + seed * 11);
      const eyeFwd = r * 0.55 + r * 0.5 * 0.18;
      const eyeWX = z.x + Math.cos(z.angle) * eyeFwd;
      const eyeWY = z.y + Math.sin(z.angle) * eyeFwd;
      const eyeS = this.worldToScreen(eyeWX, eyeWY);
      const haloR = r * 0.7 * flicker;
      const haloG = ctx.createRadialGradient(eyeS.x, eyeS.y, 0, eyeS.x, eyeS.y, haloR);
      const glowCol = z.type === 'spitter' ? '180, 255, 120' : '255, 60, 40';
      haloG.addColorStop(0, `rgba(${glowCol}, ${0.42 * flicker})`);
      haloG.addColorStop(1, `rgba(${glowCol}, 0)`);
      ctx.fillStyle = haloG;
      ctx.beginPath(); ctx.arc(eyeS.x, eyeS.y, haloR, 0, TAU); ctx.fill();
    }
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

  drawLighting(world) {
    const ctx = this.ctx;
    const lp = world.players.find(p => p.id === this.localPlayerId) || world.players[0];
    if (!lp) return;
    const c = this.worldToScreen(lp.x, lp.y);
    const grad = ctx.createRadialGradient(c.x, c.y, 80, c.x, c.y, Math.max(this.viewW, this.viewH) * 0.85);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, 'rgba(8, 2, 2, 0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    if (lp.muzzleFlash > 0) {
      const k = lp.muzzleFlash / 0.06;
      const fc = this.worldToScreen(lp.x + Math.cos(lp.angle) * 22, lp.y + Math.sin(lp.angle) * 22);
      const fg = ctx.createRadialGradient(fc.x, fc.y, 0, fc.x, fc.y, 180 * k);
      fg.addColorStop(0, `rgba(255, 220, 120, ${0.55 * k})`);
      fg.addColorStop(1, 'rgba(255, 220, 120, 0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
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
