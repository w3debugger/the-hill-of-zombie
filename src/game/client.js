// GameClient: glues world + renderer + audio + input together.
// Supports solo (runs World locally) or multiplayer (renders snapshots from server).

import { World } from './world.js';
import { Renderer } from './render.js';
import { AudioBus } from './audio.js';
import { Input } from './input.js';
import { RADIO_SCRIPT, WAVE_NAMES } from './data.js';
import { C2S } from '../net/protocol.js';

export class GameClient {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.audio = new AudioBus();
    this.input = new Input(canvas);
    this.opts = opts;
    this.localWorld = null;
    this.world = null;       // current rendered snapshot
    this.localPlayerId = null;
    this.net = null;
    this.running = false;
    this.lastT = 0;
    this.lastState = null;
    this.lastTickN = 0;
    this.lastZombieIds = new Set();
    this.lastWaveAnnounced = 0;
    this.paused = false;
    this.ambientGroanMs = 4000;
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
    net.on('snapshot', (msg) => {
      this.world = msg;
      this._processStateTransitions();
    });
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
      const events = this.localWorld.step(dt, { [this.localPlayerId]: inputState });
      this._handleEvents(events);
      this.world = this.localWorld.live();
      this._processStateTransitions();
    } else if (this.net) {
      this.net.send(C2S.INPUT, { input: inputState });
    }

    // Esc key -> pause request
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
    // Touch-mode aim: pick nearest zombie (auto-aim), then fall back to
    // joystick direction, then last facing angle.
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
    // Wave announcement (from snapshot, not events, to be robust)
    if (this.world?.waveNum && this.world.waveNum !== this.lastWaveAnnounced && this.world.inWave) {
      this.lastWaveAnnounced = this.world.waveNum;
      const n = this.world.waveNum;
      this.opts.onWaveBanner?.({ n, name: WAVE_NAMES[n] || '', sub: `${this.world.remainingZombies} infected approaching` });
    }
  }

  _handleEvents(events) {
    if (!events) return;
    const r = this.renderer;
    const a = this.audio;
    for (const ev of events) {
      switch (ev.type) {
        case 'fire': {
          if (ev.playerId === this.localPlayerId) {
            // local muzzle effect (in addition to networked)
          }
          r.muzzleEffect(ev.x, ev.y, ev.angle, weaponColor(ev.weapon));
          a.play(ev.weapon);
          if (ev.weapon === 'shotgun') r.addShake(0.072);
          else if (ev.weapon === 'rifle') r.addShake(0.108);
          else if (ev.weapon === 'pistol') r.addShake(0.012);
          else if (ev.weapon === 'smg') r.addShake(0.006);
          break;
        }
        case 'zombie_hit': {
          r.bloodSplatter(ev.x, ev.y, Math.atan2(ev.dy, ev.dx), 0.5);
          a.play('hit');
          break;
        }
        case 'zombie_died': {
          r.bigBlood(ev.x, ev.y);
          if (ev.ztype === 'brute') { a.play('brute'); r.addShake(0.4); }
          else a.play('death');
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
        case 'spit': a.play('spit'); break;
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
        case 'victory': /* state transition handles it */ break;
        case 'gameover': /* state transition handles it */ break;
      }
    }
  }
}

function weaponColor(key) {
  return ({ pistol:'#ffd96a', shotgun:'#ff8c4a', smg:'#5cc8ff', rifle:'#9affb6' })[key] || '#fff';
}
