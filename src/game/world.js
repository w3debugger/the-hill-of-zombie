// Pure game simulation. No DOM, no canvas, no audio.
// Runs identically in the browser (solo) and Node.js (multiplayer server).

import {
  TAU, HILL_R, HILL_CORE_R, ARENA_R, HILL_DRAIN_DPS,
  WEAPONS, WEAPON_ORDER, ZTYPES, SHOP_ITEMS, shopPrice, PLAYER_COLORS,
} from './data.js';

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

// Uniform-grid spatial hash. Used for O(N) zombie separation and
// O(B + Z) bullet/zombie hit tests, instead of O(N²) / O(B·Z).
class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }
  clear() { this.cells.clear(); }
  _key(cx, cy) { return ((cx + 1024) << 12) | (cy + 1024); }
  insert(item) {
    const cs = this.cellSize;
    const k = this._key(Math.floor(item.x / cs), Math.floor(item.y / cs));
    let arr = this.cells.get(k);
    if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push(item);
  }
  queryNear(x, y, radius, out) {
    out.length = 0;
    const cs = this.cellSize;
    const minCx = Math.floor((x - radius) / cs);
    const maxCx = Math.floor((x + radius) / cs);
    const minCy = Math.floor((y - radius) / cs);
    const maxCy = Math.floor((y + radius) / cs);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}

const EMPTY_INPUT = Object.freeze({
  mx: 0, my: 0, ang: 0,
  fire: false, fireEdge: false, sprint: false,
  dodge: false, reload: false,
  weapon: null, buy: null, ready: false,
});

let _idSeq = 1;
const nextId = () => _idSeq++;

function makePlayer(id, name, color) {
  return {
    id, name, color, dead: false, ready: false,
    x: 0, y: 0, vx: 0, vy: 0,
    hp: 100, maxHp: 100,
    r: 15, angle: 0,
    stamina: 1.5, maxStamina: 1.5,
    dodgeCd: 0, dodgeMs: 0, iframesMs: 0,
    moveSpeed: 230, dmgMult: 1,
    muzzleFlash: 0, hurtFlash: 0,
    weapon: 'pistol',
    owned: { pistol: true, shotgun: false, smg: false, rifle: false },
    mag: { pistol: Infinity, shotgun: 0, smg: 0, rifle: 0 },
    ammoReserve: { pistol: Infinity, shotgun: 0, smg: 0, rifle: 0 },
    fireCdMs: 0, reloadMs: 0,
    upgrades: { hp: 0, speed: 0, dmg: 0 },
    score: 0, kills: 0,
  };
}

function startReload(p) {
  const w = WEAPONS[p.weapon];
  if (w.magSize === Infinity) return false;
  if (p.mag[w.key] >= w.magSize) return false;
  if (p.ammoReserve[w.key] <= 0) return false;
  if (p.reloadMs > 0) return false;
  p.reloadMs = w.reloadMs;
  return true;
}
function finishReload(p) {
  const w = WEAPONS[p.weapon];
  if (w.magSize === Infinity) return;
  const need = w.magSize - p.mag[w.key];
  const give = Math.min(need, p.ammoReserve[w.key]);
  p.mag[w.key] += give;
  p.ammoReserve[w.key] -= give;
}
function refillMagsFromReserve(p) {
  for (const k of WEAPON_ORDER) {
    if (k === 'pistol' || !p.owned[k]) continue;
    const w = WEAPONS[k];
    const need = w.magSize - p.mag[k];
    const give = Math.min(need, p.ammoReserve[k]);
    p.mag[k] += give;
    p.ammoReserve[k] -= give;
  }
}

function buildWaveComposition(n, playerCount = 1) {
  // Scale wave size with squad size so 10 players don't crush a wave built for 1.
  // Sub-linear so a full squad isn't drowned: ~1 + 0.5·(P-1) at full tilt.
  // Early waves use a gentler per-player coefficient so a 10-player wave 1
  // doesn't dump 22 walkers on a fresh lobby.
  const extra = Math.max(0, playerCount - 1);
  const earlyScale = 1 + 0.25 * extra;        // waves 1–2
  const midScale   = 1 + 0.35 * extra;        // wave 3
  const scale      = 1 + 0.5  * extra;        // wave 4+
  const list = [];
  // Gentle ramp on waves 1–3 so players can learn the controls before the swarm.
  const walkers  = n === 1 ? Math.floor(4 * earlyScale)
                 : n === 2 ? Math.floor(6 * earlyScale)
                 : n === 3 ? Math.floor(9 * midScale)
                 : Math.min(140, Math.floor((6 + n * 2.2) * scale));
  const runners  = n >= 4 ? Math.min(90,  Math.floor((2 + (n - 3) * 1.6) * scale)) : 0;
  const brutes   = n >= 5 ? Math.min(24,  Math.floor((1 + (n - 5) / 2) * scale)) : 0;
  const spitters = n >= 6 ? Math.min(50,  Math.floor((2 + (n - 6) * 1.2) * scale)) : 0;
  for (let i = 0; i < walkers; i++) list.push('walker');
  for (let i = 0; i < runners; i++) list.push('runner');
  for (let i = 0; i < brutes; i++) list.push('brute');
  for (let i = 0; i < spitters; i++) list.push('spitter');
  list.sort(() => Math.random() - 0.5);
  return list;
}

export class World {
  constructor() {
    this.t = 0;
    this.tickN = 0;
    this.state = 'lobby'; // lobby | playing | shop | gameover | victory
    this.players = new Map();
    this.zombies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.pickups = [];
    this.hill = { hp: 1000, maxHp: 1000 };
    this.cash = 0;
    this.waveNum = 0;
    this.inWave = false;
    this.spawnQueue = [];
    this.spawnTimerMs = 0;
    this.hitstopMs = 0;
    this.events = [];
    this.flags = { hillLowAnnounced: false, anyPlayerDownAnnounced: false };
    // Spatial hash + scratch query buffer reused every tick (no GC churn).
    // Cell size 80 covers brute diameter (52) and bullet homing fan-out cleanly.
    this._zGrid = new SpatialHash(80);
    this._qBuf = [];
    // Hill HP scales with player count once the world starts.
    this._hillBaseMaxHp = 1000;
  }

  // ----- Lifecycle -----
  addPlayer(id, name, color) {
    const p = makePlayer(id, name, color);
    const ang = rand(0, TAU);
    p.x = Math.cos(ang) * (HILL_R - 60);
    p.y = Math.sin(ang) * (HILL_R - 60);
    this.players.set(id, p);
    this.events.push({ type: 'player_joined', id, name, color });
    return p;
  }
  removePlayer(id) {
    if (!this.players.has(id)) return;
    this.players.delete(id);
    this.events.push({ type: 'player_left', id });
  }
  startGame() {
    // Scale hill HP so 10 players don't trivially out-DPS a wave-1 hill drain.
    const players = Math.max(1, this.players.size);
    this.hill.maxHp = this._hillBaseMaxHp + (players - 1) * 200;
    this.hill.hp = this.hill.maxHp;
    this.startWave(1);
  }

  // ----- Tick -----
  step(dt, inputs) {
    if (this.hitstopMs > 0) {
      this.hitstopMs -= dt * 1000;
      return this.takeEvents();
    }
    this.t += dt;
    this.tickN++;

    if (this.state === 'playing') {
      this.updatePlayers(dt, inputs, false);
      this.updateZombies(dt);
      this.updateBullets(dt);
      this.updatePickups(dt);
      this.maybeSpawn(dt);
      if (this.inWave && this.spawnQueue.length === 0 && this.zombies.length === 0) {
        this.completeWave();
      }
      if (!this.flags.hillLowAnnounced && this.hill.hp < this.hill.maxHp * 0.5) {
        this.flags.hillLowAnnounced = true;
        this.events.push({ type: 'radio', kind: 'hillLow' });
      }
    } else if (this.state === 'shop') {
      this.updatePlayers(dt, inputs, true);
      this.processShop(inputs);
    } else if (this.state === 'gameover' || this.state === 'victory') {
      // run animations only (decay timers)
    }
    return this.takeEvents();
  }
  takeEvents() {
    const e = this.events; this.events = []; return e;
  }

  // ----- Waves -----
  startWave(n) {
    this.waveNum = n;
    this.spawnQueue = buildWaveComposition(n, Math.max(1, this.players.size));
    this.inWave = true;
    this.spawnTimerMs = 0;
    this.state = 'playing';
    // refill mags free at wave start
    for (const p of this.players.values()) refillMagsFromReserve(p);
    this.flags.hillLowAnnounced = this.hill.hp < this.hill.maxHp * 0.5;
    this.flags.anyPlayerDownAnnounced = false;
    this.events.push({ type: 'wave_start', n, count: this.spawnQueue.length });
  }
  completeWave() {
    this.inWave = false;
    const bonus = 60 + this.waveNum * 30;
    this.cash += bonus;
    for (const p of this.players.values()) p.score += 100 * this.waveNum;
    this.events.push({ type: 'wave_end', n: this.waveNum, bonus });
    if (this.waveNum >= 10) {
      this.state = 'victory';
      this.events.push({ type: 'victory' });
    } else {
      this.state = 'shop';
      // revive any dead players for next wave (multiplayer co-op pacing)
      for (const p of this.players.values()) {
        if (p.dead) {
          p.dead = false;
          p.hp = Math.floor(p.maxHp * 0.6);
          this.events.push({ type: 'player_revived', id: p.id });
        }
      }
      for (const p of this.players.values()) refillMagsFromReserve(p);
    }
  }

  // ----- Shop -----
  processShop(inputs) {
    if (this.players.size === 0) return;
    let allReady = true;
    for (const [id, p] of this.players) {
      const input = inputs[id] || EMPTY_INPUT;
      if (input.buy) {
        const item = SHOP_ITEMS.find(it => it.id === input.buy);
        if (item) this.tryBuy(p, item);
      }
      p.ready = !!input.ready;
      if (!p.ready) allReady = false;
    }
    if (allReady) {
      for (const p of this.players.values()) p.ready = false;
      this.startWave(this.waveNum + 1);
    }
  }
  tryBuy(p, item) {
    const ownedLevel = item.type === 'upgrade' ? p.upgrades[item.key] : 0;
    const price = shopPrice(item, ownedLevel);
    if (item.type === 'weapon' && p.owned[item.key]) return;
    if (item.type === 'upgrade' && p.upgrades[item.key] >= item.max) return;
    if (this.cash < price) {
      this.events.push({ type: 'buy_fail', playerId: p.id, item: item.id });
      return;
    }
    if (item.type === 'weapon') {
      p.owned[item.key] = true;
      p.ammoReserve[item.key] += item.startAmmo;
      refillMagsFromReserve(p);
      p.weapon = item.key;
    } else if (item.type === 'ammo') {
      const w = WEAPONS[p.weapon];
      if (w.magSize === Infinity) return;
      p.ammoReserve[w.key] += w.magSize * 2;
    } else if (item.type === 'ammoAll') {
      for (const k of WEAPON_ORDER) {
        if (k === 'pistol' || !p.owned[k]) continue;
        p.ammoReserve[k] += WEAPONS[k].magSize * 2;
      }
    } else if (item.type === 'health') {
      p.hp = Math.min(p.maxHp, p.hp + 60);
    } else if (item.type === 'upgrade') {
      if (item.key === 'hp') { p.maxHp += 25; p.hp = p.maxHp; }
      else if (item.key === 'speed') p.moveSpeed *= 1.15;
      else if (item.key === 'dmg') p.dmgMult *= 1.20;
      p.upgrades[item.key]++;
    } else if (item.type === 'repair') {
      this.hill.hp = Math.min(this.hill.maxHp, this.hill.hp + 400);
    }
    this.cash -= price;
    this.events.push({ type: 'buy_ok', playerId: p.id, item: item.id });
  }

  // ----- Players -----
  updatePlayers(dt, inputs, frozen) {
    for (const [id, p] of this.players) {
      const input = inputs[id] || EMPTY_INPUT;
      // weapon switch (always allowed)
      if (input.weapon && p.owned[input.weapon] && p.weapon !== input.weapon) {
        p.weapon = input.weapon;
        p.fireCdMs = 120;
        p.reloadMs = 0;
      }
      if (frozen || p.dead) {
        // decay flashes
        if (p.muzzleFlash > 0) p.muzzleFlash -= dt;
        if (p.hurtFlash > 0) p.hurtFlash -= dt * 2;
        continue;
      }

      const ix = clamp(input.mx || 0, -1, 1);
      const iy = clamp(input.my || 0, -1, 1);
      const inputMag = Math.hypot(ix, iy);
      const sprinting = !!input.sprint && p.stamina > 0 && inputMag > 0 && p.dodgeMs <= 0;
      if (sprinting) p.stamina = Math.max(0, p.stamina - dt);
      else p.stamina = Math.min(p.maxStamina, p.stamina + dt * 0.5);
      const speed = p.moveSpeed * (sprinting ? 1.45 : 1);
      if (p.dodgeMs > 0) {
        p.dodgeMs -= dt;
        p.vx *= 0.9; p.vy *= 0.9;
      } else {
        const tvx = ix * speed, tvy = iy * speed;
        p.vx = lerp(p.vx, tvx, 1 - Math.exp(-12 * dt));
        p.vy = lerp(p.vy, tvy, 1 - Math.exp(-12 * dt));
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const dr = Math.hypot(p.x, p.y);
      if (dr > ARENA_R - p.r - 10) {
        p.x *= (ARENA_R - p.r - 10) / dr;
        p.y *= (ARENA_R - p.r - 10) / dr;
        p.vx *= 0.5; p.vy *= 0.5;
      }
      p.angle = (typeof input.ang === 'number') ? input.ang : p.angle;

      if (input.dodge && p.dodgeCd <= 0) {
        let dx = ix, dy = iy;
        if (Math.hypot(dx, dy) < 0.001) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
        const m = Math.hypot(dx, dy); dx /= m; dy /= m;
        p.vx = dx * 720; p.vy = dy * 720;
        p.dodgeCd = 1.1; p.dodgeMs = 0.22; p.iframesMs = 0.32;
        this.events.push({ type: 'dodge', playerId: p.id, x: p.x, y: p.y });
      }
      if (p.dodgeCd > 0) p.dodgeCd -= dt;
      if (p.iframesMs > 0) p.iframesMs -= dt;
      if (p.muzzleFlash > 0) p.muzzleFlash -= dt;
      if (p.hurtFlash > 0) p.hurtFlash -= dt * 2;
      if (p.fireCdMs > 0) p.fireCdMs -= dt * 1000;
      if (p.reloadMs > 0) {
        p.reloadMs -= dt * 1000;
        if (p.reloadMs <= 0) { p.reloadMs = 0; finishReload(p); this.events.push({ type:'reload_done', playerId: p.id }); }
      }
      if (input.reload) {
        if (startReload(p)) this.events.push({ type:'reload_start', playerId: p.id });
      }
      const w = WEAPONS[p.weapon];
      if (input.fire && (w.auto || input.fireEdge)) this.fireWeapon(p);
    }
  }

  fireWeapon(p) {
    if (p.dead || p.reloadMs > 0 || p.fireCdMs > 0) return;
    const w = WEAPONS[p.weapon];
    if (w.magSize !== Infinity) {
      if (p.mag[w.key] <= 0) {
        if (p.ammoReserve[w.key] > 0) startReload(p);
        else { p.fireCdMs = 220; this.events.push({ type:'empty', playerId: p.id }); }
        return;
      }
      p.mag[w.key] -= 1;
    }
    p.fireCdMs = w.fireRate;
    const muzzleX = p.x + Math.cos(p.angle) * 22;
    const muzzleY = p.y + Math.sin(p.angle) * 22;
    for (let i = 0; i < w.shots; i++) {
      const a = p.angle + rand(-w.spread, w.spread);
      this.bullets.push({
        id: nextId(), x: muzzleX, y: muzzleY,
        vx: Math.cos(a) * w.speed * 60,
        vy: Math.sin(a) * w.speed * 60,
        ttl: w.range / (w.speed * 60),
        dmg: w.dmg * p.dmgMult,
        pierce: w.pierce || 0,
        color: w.ammoColor,
        tracer: w.tracerLen,
        hits: new Set(),
        ownerId: p.id,
      });
    }
    p.muzzleFlash = 0.06;
    this.events.push({ type:'fire', playerId: p.id, x: muzzleX, y: muzzleY, angle: p.angle, weapon: w.key });
  }

  // ----- Zombies -----
  spawnZombie(type) {
    const cfg = ZTYPES[type];
    const ang = rand(0, TAU);
    // pick a player (or origin) to spawn near edge of view of
    const targets = [...this.players.values()].filter(p => !p.dead);
    const focus = targets.length ? pick(targets) : { x: 0, y: 0 };
    const dist = 900 + rand(40, 200);
    let x = focus.x + Math.cos(ang) * dist;
    let y = focus.y + Math.sin(ang) * dist;
    const r = Math.hypot(x, y);
    if (r > ARENA_R - 40) { x *= (ARENA_R - 40) / r; y *= (ARENA_R - 40) / r; }
    // Soften HP creep on early waves so a fresh pistol can still drop walkers in 3 shots.
    const hpWave = Math.max(0, this.waveNum - 2);
    const baseHp = cfg.hp + Math.floor(hpWave * (type === 'brute' ? 30 : 4));
    const id = nextId();
    const seed = rand(0, 1000);
    const wobble = rand(0, TAU);
    this.zombies.push({
      id,
      type, x, y, vx: 0, vy: 0,
      hp: baseHp, maxHp: baseHp,
      r: cfg.r,
      speed: cfg.speed * (1 + Math.min(0.4, Math.max(0, this.waveNum - 2) * 0.02)),
      flash: 0,
      atkCdMs: rand(0, cfg.atkCd),
      wobble,
      angle: 0,
      target: null,
      rangedCdMs: rand(800, 2200),
      seed,
      droolMs: rand(800, 2400),
      lastHurtBy: null,
    });
    // Static info for clients — sent once, then snapshots only carry dynamics.
    this.events.push({ type: 'zombie_spawned', id, ztype: type, x: r1(x), y: r1(y), r: cfg.r, maxHp: baseHp, seed: r2(seed), wobble: r2(wobble) });
  }
  maybeSpawn(dt) {
    if (!this.inWave) return;
    this.spawnTimerMs -= dt * 1000;
    if (this.spawnTimerMs > 0) return;
    if (this.spawnQueue.length === 0) return;
    // Slower drip on the first couple of waves; tightens up as players gear up.
    const baseDelay = this.waveNum === 1 ? 1600
                    : this.waveNum === 2 ? 1350
                    : clamp(1100 - this.waveNum * 45, 250, 1100);
    this.spawnTimerMs = rand(baseDelay * 0.7, baseDelay * 1.3);
    const type = this.spawnQueue.shift();
    this.spawnZombie(type);
  }

  pickClosestPlayer(z) {
    let best = null, bestD = Infinity;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return [best, bestD];
  }

  updateZombies(dt) {
    for (const z of this.zombies) {
      if (z.dead) continue;
      const cfg = ZTYPES[z.type];
      if (z.flash > 0) z.flash -= dt;
      const [closestPlayer, dp] = this.pickClosestPlayer(z);
      const dh = Math.hypot(z.x, z.y);
      let tx, ty, td;
      if (closestPlayer && (dp < 220 || dp < dh - 80)) {
        tx = closestPlayer.x; ty = closestPlayer.y; td = dp; z.target = closestPlayer.id;
      } else {
        tx = 0; ty = 0; td = dh; z.target = 'hill';
      }
      const tax = (tx - z.x) / Math.max(0.001, td);
      const tay = (ty - z.y) / Math.max(0.001, td);
      z.angle = Math.atan2(tay, tax);

      if (cfg.ranged) {
        z.rangedCdMs -= dt * 1000;
        if (closestPlayer && dp < cfg.rangedRange && dp > 80 && z.rangedCdMs <= 0 && z.target !== 'hill') {
          z.rangedCdMs = rand(1800, 2600);
          const ang = Math.atan2(closestPlayer.y - z.y, closestPlayer.x - z.x) + rand(-0.06, 0.06);
          this.enemyBullets.push({
            id: nextId(),
            x: z.x, y: z.y,
            vx: Math.cos(ang) * cfg.rangedSpeed,
            vy: Math.sin(ang) * cfg.rangedSpeed,
            ttl: cfg.rangedRange / cfg.rangedSpeed,
            dmg: cfg.dmg, color: '#a8d04a', r: 6,
          });
          this.events.push({ type:'spit', x: z.x, y: z.y, angle: ang });
        }
        if (dp < cfg.rangedRange * 0.8 && dp > 100) {
          z.vx = -tay * z.speed * 0.7 + tax * z.speed * 0.2;
          z.vy = tax * z.speed * 0.7 + tay * z.speed * 0.2;
        } else {
          z.vx = lerp(z.vx, tax * z.speed, 1 - Math.exp(-6 * dt));
          z.vy = lerp(z.vy, tay * z.speed, 1 - Math.exp(-6 * dt));
        }
      } else {
        z.vx = lerp(z.vx, tax * z.speed, 1 - Math.exp(-7 * dt));
        z.vy = lerp(z.vy, tay * z.speed, 1 - Math.exp(-7 * dt));
      }

      z.wobble += dt * 4;
      const wob = Math.sin(z.wobble) * (z.type === 'runner' ? 16 : 8);
      z.x += z.vx * dt + Math.cos(z.angle + Math.PI/2) * wob * dt;
      z.y += z.vy * dt + Math.sin(z.angle + Math.PI/2) * wob * dt;

      if (z.atkCdMs > 0) z.atkCdMs -= dt * 1000;
      if (closestPlayer && z.target === closestPlayer.id) {
        const sumR = closestPlayer.r + z.r;
        if (dp < sumR + 4 && z.atkCdMs <= 0) {
          z.atkCdMs = cfg.atkCd;
          this.hurtPlayer(closestPlayer, cfg.dmg);
          if (cfg.knockback) {
            const dx = closestPlayer.x - z.x, dy = closestPlayer.y - z.y;
            const d = Math.max(0.001, Math.hypot(dx, dy));
            closestPlayer.vx += dx / d * cfg.knockback;
            closestPlayer.vy += dy / d * cfg.knockback;
          }
        }
      }

      // drool drip event (visual only)
      z.droolMs -= dt * 1000;
      if (z.droolMs <= 0) {
        z.droolMs = rand(1600, 4200);
        const mfwd = z.r * 0.55 + z.r * 0.5 * 0.55;
        const mx = z.x + Math.cos(z.angle) * mfwd;
        const my = z.y + Math.sin(z.angle) * mfwd;
        this.events.push({ type:'drool', x: mx, y: my, kind: z.type === 'spitter' ? 'green' : 'red' });
      }

      // hill drain
      if (dh < HILL_CORE_R + z.r) {
        this.hill.hp -= HILL_DRAIN_DPS * dt * (z.type === 'brute' ? 3.5 : 1);
        if (this.hill.hp <= 0) {
          this.hill.hp = 0;
          this.endGame(false);
        }
      }
    }

    // Drop dead zombies first (in-place, no allocation).
    let w = 0;
    for (let i = 0; i < this.zombies.length; i++) {
      if (!this.zombies[i].dead) this.zombies[w++] = this.zombies[i];
    }
    this.zombies.length = w;

    // Rebuild spatial hash on live zombies. Used both for separation below
    // and by updateBullets for hit/homing queries this tick.
    const grid = this._zGrid;
    const buf = this._qBuf;
    grid.clear();
    for (let i = 0; i < this.zombies.length; i++) grid.insert(this.zombies[i]);

    // Soft separation — only check pairs whose cells overlap.
    for (let i = 0; i < this.zombies.length; i++) {
      const a = this.zombies[i];
      const radius = a.r + 30; // 30 ≈ max other zombie radius
      grid.queryNear(a.x, a.y, radius, buf);
      for (let j = 0; j < buf.length; j++) {
        const b = buf[j];
        if (b.id <= a.id) continue; // process each pair once
        const dx = b.x - a.x, dy = b.y - a.y;
        const dd = dx*dx + dy*dy;
        const minR = a.r + b.r;
        if (dd < minR * minR && dd > 0.001) {
          const d = Math.sqrt(dd);
          const overlap = (minR - d) * 0.5;
          const ux = dx / d, uy = dy / d;
          a.x -= ux * overlap * 0.6; a.y -= uy * overlap * 0.6;
          b.x += ux * overlap * 0.6; b.y += uy * overlap * 0.6;
        }
      }
    }
  }

  damageZombie(z, dmg, kx, ky, ownerId) {
    z.hp -= dmg;
    z.flash = 0.08;
    z.vx += kx; z.vy += ky;
    z.lastHurtBy = ownerId;
    this.events.push({ type:'zombie_hit', id: z.id, x: z.x, y: z.y, dx: kx, dy: ky });
    if (z.hp <= 0) this.killZombie(z, ownerId);
  }
  killZombie(z, ownerId) {
    z.dead = true;
    const cfg = ZTYPES[z.type];
    const owner = ownerId != null ? this.players.get(ownerId) : null;
    if (owner) {
      owner.kills++;
      owner.score += Math.floor(10 * cfg.scoreMul);
    }
    if (z.type === 'brute') this.hitstopMs = Math.max(this.hitstopMs, 60);
    this.events.push({ type:'zombie_died', id: z.id, ztype: z.type, x: z.x, y: z.y });
    // pickups
    const drop = Math.random();
    let pk = null;
    if (drop < 0.85) pk = makePickup(z.x, z.y, 'cash', cfg.cash);
    else if (drop < 0.92) pk = makePickup(z.x, z.y, 'health', 12);
    else if (drop < 0.97) pk = makePickup(z.x, z.y, 'ammo', 1);
    if (pk) {
      this.pickups.push(pk);
      this.events.push({ type: 'pickup_spawned', id: pk.id, ptype: pk.type, value: pk.value, x: r1(pk.x), y: r1(pk.y) });
    }
  }

  hurtPlayer(p, dmg) {
    if (p.iframesMs > 0 || p.dead) return;
    p.hp -= dmg;
    p.hurtFlash = 0.4;
    p.iframesMs = 0.3;
    this.events.push({ type:'player_hurt', id: p.id, dmg });
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      this.events.push({ type:'player_died', id: p.id });
      if (!this.flags.anyPlayerDownAnnounced) {
        this.flags.anyPlayerDownAnnounced = true;
        this.events.push({ type:'radio', kind:'playerDown' });
      }
      // game over only if ALL players dead
      const anyAlive = [...this.players.values()].some(pl => !pl.dead);
      if (!anyAlive) this.endGame(false);
    }
  }
  endGame(win) {
    this.state = win ? 'victory' : 'gameover';
    this.events.push({ type: win ? 'victory' : 'gameover' });
  }

  // ----- Bullets -----
  updateBullets(dt) {
    const arr = this.bullets;
    // Hit-magnet: near-misses still count as hits. Bullet flies straight,
    // but its effective hit radius is z.r + MAGNET_R.
    const MAGNET_R = 30;
    const grid = this._zGrid;
    const buf = this._qBuf;
    const hasZombies = this.zombies.length > 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.ttl -= dt;
      let removed = false;
      if (hasZombies) {
        grid.queryNear(b.x, b.y, 30 + MAGNET_R, buf);
        for (let q = 0; q < buf.length; q++) {
          const z = buf[q];
          if (z.dead || b.hits.has(z.id)) continue;
          const dx = z.x - b.x, dy = z.y - b.y;
          const hitR = z.r + MAGNET_R;
          if (dx*dx + dy*dy < hitR * hitR) {
            const ang = Math.atan2(b.vy, b.vx);
            const k = 240 / Math.max(1, z.r) * 2;
            this.damageZombie(z, b.dmg, Math.cos(ang) * k, Math.sin(ang) * k, b.ownerId);
            b.hits.add(z.id);
            if (b.pierce > 0) { b.pierce -= 1; b.dmg *= 0.85; }
            else { arr.splice(i, 1); removed = true; break; }
          }
        }
      }
      if (removed) continue;
      if (b.ttl <= 0 || Math.abs(b.x) > ARENA_R + 200 || Math.abs(b.y) > ARENA_R + 200) arr.splice(i, 1);
    }
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.ttl -= dt;
      let hit = false;
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const dx = p.x - b.x, dy = p.y - b.y;
        if (dx*dx + dy*dy < (p.r + b.r) * (p.r + b.r)) {
          this.hurtPlayer(p, b.dmg);
          this.events.push({ type:'enemy_bullet_hit', x: b.x, y: b.y, color: b.color });
          hit = true; break;
        }
      }
      if (hit || b.ttl <= 0) this.enemyBullets.splice(i, 1);
    }
  }

  // ----- Pickups -----
  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const it = this.pickups[i];
      it.age += dt; it.life -= dt;
      it.x += it.vx * dt; it.y += it.vy * dt;
      it.vx *= 0.9; it.vy *= 0.9;
      // magnet to nearest live player
      let nearest = null, nd = Infinity;
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const d = Math.hypot(p.x - it.x, p.y - it.y);
        if (d < nd) { nd = d; nearest = p; }
      }
      if (nearest && nd < 110) {
        const dx = nearest.x - it.x, dy = nearest.y - it.y;
        const k = 240 * (1 - nd / 110);
        it.vx += dx / Math.max(1, nd) * k * dt;
        it.vy += dy / Math.max(1, nd) * k * dt;
        const pickR = it.type === 'cash' ? 36 : 28;
        if (nd < pickR) { this.collectPickup(nearest, it); this.pickups.splice(i, 1); continue; }
      }
      if (it.life <= 0) this.pickups.splice(i, 1);
    }
  }
  collectPickup(p, it) {
    if (it.type === 'cash') { this.cash += it.value; this.events.push({type:'pickup_cash', x: it.x, y: it.y, value: it.value, playerId: p.id}); }
    else if (it.type === 'health') { p.hp = Math.min(p.maxHp, p.hp + it.value); this.events.push({type:'pickup_health', x: it.x, y: it.y, playerId: p.id}); }
    else if (it.type === 'ammo') {
      const w = WEAPONS[p.weapon];
      if (w.magSize !== Infinity) p.ammoReserve[w.key] += w.magSize;
      else {
        const opts = WEAPON_ORDER.filter(k => k !== 'pistol' && p.owned[k]);
        if (opts.length) { const k = pick(opts); p.ammoReserve[k] += WEAPONS[k].magSize; }
        else this.cash += 10;
      }
      this.events.push({type:'pickup_ammo', x: it.x, y: it.y, playerId: p.id});
    }
  }

  // ----- Live view for solo mode -----
  // No deep-copy: returns references to the live entity arrays.
  // Same shape as snapshot() so the renderer treats them identically.
  // DO NOT mutate the returned object.
  live() {
    if (!this._liveView) {
      this._liveView = { hill: this.hill };
    }
    const v = this._liveView;
    v.tickN = this.tickN;
    v.state = this.state;
    v.cash = this.cash;
    v.hill = this.hill;
    v.waveNum = this.waveNum;
    v.inWave = this.inWave;
    v.remainingZombies = this.zombies.length + this.spawnQueue.length;
    // players is a Map; build a transient array (small, <=4)
    if (!v.players || v.players.length !== this.players.size) v.players = new Array(this.players.size);
    let i = 0; for (const p of this.players.values()) v.players[i++] = p;
    v.zombies = this.zombies;
    v.bullets = this.bullets;
    v.enemyBullets = this.enemyBullets;
    v.pickups = this.pickups;
    return v;
  }

  // ----- Snapshot for network sync -----
  // Lean: drop bullets/enemyBullets entirely (clients simulate visuals from
  // 'fire' / 'spit' events), drop player name/color/r (sent at join), drop
  // zombie seed/wobble/maxHp/r/type (sent in 'zombie_spawned'), drop pickup
  // type/value (sent in 'pickup_spawned'). Numbers rounded to cut JSON bytes.
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        dead: p.dead, ready: p.ready,
        x: r1(p.x), y: r1(p.y),
        vx: r1(p.vx), vy: r1(p.vy),
        hp: r1(p.hp), maxHp: p.maxHp,
        angle: r2(p.angle),
        weapon: p.weapon,
        owned: p.owned, mag: p.mag, ammoReserve: p.ammoReserve,
        upgrades: p.upgrades, score: p.score, kills: p.kills,
        muzzleFlash: p.muzzleFlash > 0 ? r2(p.muzzleFlash) : 0,
        hurtFlash: p.hurtFlash > 0 ? r2(p.hurtFlash) : 0,
        iframesMs: p.iframesMs > 0 ? r2(p.iframesMs) : 0,
        reloadMs: p.reloadMs | 0,
        fireCdMs: p.fireCdMs | 0,
        stamina: r2(p.stamina), maxStamina: p.maxStamina,
        dodgeMs: p.dodgeMs > 0 ? r2(p.dodgeMs) : 0,
      });
    }
    const zombies = new Array(this.zombies.length);
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      zombies[i] = {
        id: z.id,
        x: r1(z.x), y: r1(z.y),
        hp: r1(z.hp),
        angle: r2(z.angle),
        flash: z.flash > 0 ? 1 : 0,
      };
    }
    const pickups = new Array(this.pickups.length);
    for (let i = 0; i < this.pickups.length; i++) {
      const it = this.pickups[i];
      pickups[i] = { id: it.id, x: r1(it.x), y: r1(it.y), life: r2(it.life) };
    }
    return {
      tickN: this.tickN,
      state: this.state,
      cash: this.cash,
      hill: { hp: r1(this.hill.hp), maxHp: this.hill.maxHp },
      waveNum: this.waveNum,
      inWave: this.inWave,
      remainingZombies: this.zombies.length + this.spawnQueue.length,
      players,
      zombies,
      pickups,
    };
  }
}

function makePickup(x, y, type, value) {
  return { id: nextId(), x, y, type, value, life: 16, age: 0, vx: rand(-30, 30), vy: rand(-30, 30) };
}
