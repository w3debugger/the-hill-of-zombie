// Synthesized SFX via Web Audio. Browser-only.
// Layered synthesis (body + crack + tail + reverb) for grittier, more visceral
// sounds than pure beeps. Also runs a persistent Ambience track: wind, distant
// moans, and a low-HP heartbeat that ramps with the player's pulse.

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.dryBus = null;
    this.wetBus = null;
    this.convolver = null;
    this.muted = false;
    this.volume = 0.7;
    this.ambience = null;
    this.unsupported = false;
  }
  ensure() {
    if (this.unsupported) return;
    if (!this.ctx) {
      const C = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      // Old browsers (notably any IE, plus very early Android) have no Web
      // Audio. Mark unsupported once and become a silent no-op for the rest
      // of the session — the game still plays, just without sound.
      if (!C) { this.unsupported = true; return; }
      try {
        this.ctx = new C();
      } catch (e) {
        this.unsupported = true;
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      // Build a small reverb impulse so gunshots get a tail and zombies sound
      // like they're in a wide outdoor space.
      this._buildReverb();
      this.dryBus = this.ctx.createGain(); this.dryBus.gain.value = 1;
      this.wetBus = this.ctx.createGain(); this.wetBus.gain.value = 0.35;
      this.dryBus.connect(this.master);
      this.wetBus.connect(this.convolver).connect(this.master);
    }
    if (this.ctx.state === 'suspended') {
      try { this.ctx.resume(); } catch (e) {}
    }
  }
  _buildReverb() {
    const a = this.ctx;
    const len = Math.floor(a.sampleRate * 1.2);
    const buf = a.createBuffer(2, len, a.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Exponential decay with a touch of early reflection cluster
        const env = Math.pow(1 - t, 2.6);
        let v = (Math.random() * 2 - 1) * env;
        if (i < a.sampleRate * 0.04 && Math.random() < 0.02) v += (Math.random() * 2 - 1) * 0.6;
        d[i] = v;
      }
    }
    this.convolver = a.createConvolver();
    this.convolver.buffer = buf;
  }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  // ---- Synthesis primitives ----

  // Output node for SFX. SFX route through dry+wet busses to get a faint tail.
  _outNodes(wetMix = 0.3) {
    const a = this.ctx;
    const out = a.createGain(); out.gain.value = 1;
    const wet = a.createGain(); wet.gain.value = wetMix;
    out.connect(this.dryBus);
    out.connect(wet).connect(this.wetBus);
    return out;
  }

  // Tone with optional pitch slide and ADSR-ish envelope.
  _tone({ freq, freqEnd = freq, dur, type = 'square', vol = 0.15, attack = 0.002, out = null }) {
    if (!this.ctx) return;
    const a = this.ctx;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), a.currentTime + dur);
    g.gain.setValueAtTime(0, a.currentTime);
    g.gain.linearRampToValueAtTime(vol, a.currentTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(out || this.master);
    o.start();
    o.stop(a.currentTime + dur + 0.02);
  }

  // Filtered noise burst. `band` = optional [centerHz, q] for bandpass tone.
  _noise({ dur, vol, lp = 4000, hp = 60, band = null, attack = 0.003, out = null }) {
    if (!this.ctx) return;
    const a = this.ctx;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const lpF = a.createBiquadFilter(); lpF.type = 'lowpass'; lpF.frequency.value = lp;
    const hpF = a.createBiquadFilter(); hpF.type = 'highpass'; hpF.frequency.value = hp;
    const g = a.createGain();
    g.gain.setValueAtTime(0, a.currentTime);
    g.gain.linearRampToValueAtTime(vol, a.currentTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    let chain = src.connect(hpF).connect(lpF);
    if (band) {
      const bp = a.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = band[0]; bp.Q.value = band[1];
      chain = chain.connect(bp);
    }
    chain.connect(g).connect(out || this.master);
    src.start();
  }

  // Two-osc growl: detuned + slow vibrato + noise grit. Used for groans and brutes.
  _growl({ base, dur, vol = 0.18, vibratoHz = 5.5, vibratoDepth = 8, grit = 0.18, lp = 700, out = null }) {
    if (!this.ctx) return;
    const a = this.ctx;
    const dest = out || this.master;
    const g = a.createGain();
    g.gain.setValueAtTime(0, a.currentTime);
    g.gain.linearRampToValueAtTime(vol, a.currentTime + 0.05);
    g.gain.setValueAtTime(vol, a.currentTime + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    const lpF = a.createBiquadFilter(); lpF.type = 'lowpass'; lpF.frequency.value = lp;
    g.connect(lpF).connect(dest);

    // Two oscillators slightly detuned for that "two voices in one throat" feel.
    for (const det of [0, 7]) {
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base + det, a.currentTime);
      // Slow descent (zombies don't hold pitch).
      o.frequency.linearRampToValueAtTime((base + det) * 0.78, a.currentTime + dur);
      // Vibrato.
      const lfo = a.createOscillator(); lfo.frequency.value = vibratoHz + (det ? 0.7 : 0);
      const lfoGain = a.createGain(); lfoGain.gain.value = vibratoDepth;
      lfo.connect(lfoGain).connect(o.frequency);
      o.connect(g);
      o.start(); lfo.start();
      o.stop(a.currentTime + dur + 0.02);
      lfo.stop(a.currentTime + dur + 0.02);
    }
    // Grit: short noise layer, lowpass-filtered, modulated by the same envelope.
    if (grit > 0) {
      this._noise({ dur, vol: grit, lp: 800, hp: 80, out: g });
    }
  }
}

// ---- One-shot SFX ----
//
// All SFX are layered: a transient (crack/click), an optional body (low thump),
// and a tail (filtered noise). Real gunshots and impacts have all three.

const SFX = {
  pistol: bus => {
    const out = bus._outNodes(0.18);
    bus._tone({ freq: 1400, freqEnd: 250, dur: 0.045, type: 'square', vol: 0.16, out });
    bus._noise({ dur: 0.05, vol: 0.32, lp: 6000, hp: 1200, band: [2200, 2.0], out });
    bus._noise({ dur: 0.18, vol: 0.10, lp: 1400, hp: 200, out });
    bus._tone({ freq: 90, freqEnd: 50, dur: 0.10, type: 'sine', vol: 0.18, out });
  },
  shotgun: bus => {
    const out = bus._outNodes(0.45);
    bus._tone({ freq: 60, freqEnd: 30, dur: 0.18, type: 'sine', vol: 0.32, out });
    bus._noise({ dur: 0.22, vol: 0.42, lp: 2200, hp: 80, band: [900, 1.4], out });
    bus._noise({ dur: 0.45, vol: 0.16, lp: 1100, hp: 60, out });
  },
  smg: bus => {
    const out = bus._outNodes(0.12);
    bus._tone({ freq: 1300 + rand(-80, 80), freqEnd: 350, dur: 0.025, type: 'square', vol: 0.10, out });
    bus._noise({ dur: 0.04, vol: 0.18, lp: 5500, hp: 1400, out });
  },
  rifle: bus => {
    const out = bus._outNodes(0.55);
    bus._tone({ freq: 2000, freqEnd: 220, dur: 0.05, type: 'square', vol: 0.16, out });
    bus._noise({ dur: 0.07, vol: 0.5, lp: 7000, hp: 1500, band: [2800, 1.6], out });
    bus._tone({ freq: 70, freqEnd: 40, dur: 0.18, type: 'sine', vol: 0.28, out });
    bus._noise({ dur: 0.6, vol: 0.18, lp: 900, hp: 60, out });
  },
  hit: bus => {
    const out = bus._outNodes(0.15);
    // Wet meaty thump: short low body + brief noise squelch.
    bus._tone({ freq: 180, freqEnd: 70, dur: 0.07, type: 'sine', vol: 0.18, out });
    bus._noise({ dur: 0.08, vol: 0.18, lp: 1800, hp: 200, out });
  },
  death: bus => {
    const out = bus._outNodes(0.35);
    // Organic gurgle: descending pitch + crunchy noise tail.
    bus._tone({ freq: 220, freqEnd: 60, dur: 0.32, type: 'sawtooth', vol: 0.18, out });
    bus._noise({ dur: 0.28, vol: 0.22, lp: 1200, hp: 120, out });
    bus._growl({ base: 95, dur: 0.35, vol: 0.10, vibratoHz: 7, lp: 600, out });
  },
  groan: bus => {
    // Distant guttural moan. Pitch wanders.
    const out = bus._outNodes(0.5);
    const base = 70 + rand(-12, 28);
    bus._growl({ base, dur: 0.85 + rand(0, 0.4), vol: 0.10, vibratoHz: 4.5 + rand(-1, 1.5), grit: 0.07, lp: 600, out });
  },
  brute: bus => {
    // Monstrous roar: sub-oscillator + heavy growl + noise rumble.
    const out = bus._outNodes(0.55);
    bus._tone({ freq: 48, freqEnd: 36, dur: 0.6, type: 'sine', vol: 0.32, out });
    bus._growl({ base: 65, dur: 0.65, vol: 0.22, vibratoHz: 6, vibratoDepth: 14, grit: 0.22, lp: 520, out });
    bus._noise({ dur: 0.55, vol: 0.18, lp: 500, hp: 50, out });
  },
  spit: bus => {
    const out = bus._outNodes(0.25);
    // Wet hiss: short body + noise spray.
    bus._tone({ freq: 600, freqEnd: 220, dur: 0.18, type: 'triangle', vol: 0.10, out });
    bus._noise({ dur: 0.22, vol: 0.22, lp: 5000, hp: 800, band: [1800, 1.2], out });
  },
  hurt: bus => {
    const out = bus._outNodes(0.18);
    bus._tone({ freq: 240, freqEnd: 90, dur: 0.18, type: 'sawtooth', vol: 0.22, out });
    bus._noise({ dur: 0.16, vol: 0.18, lp: 1400, hp: 200, out });
    // Sharp inhaled gasp.
    bus._noise({ dur: 0.10, vol: 0.10, lp: 4200, hp: 1200, band: [2500, 1.4], out });
  },
  pickup: bus => {
    const out = bus._outNodes(0.15);
    bus._tone({ freq: 900, freqEnd: 1500, dur: 0.06, type: 'sine', vol: 0.12, out });
    setTimeout(() => bus._tone({ freq: 1500, freqEnd: 2200, dur: 0.06, type: 'sine', vol: 0.12, out }), 50);
  },
  reload: bus => {
    const out = bus._outNodes(0.10);
    // Two mechanical clack-clacks: a sharp HP-filtered noise click + small body.
    bus._noise({ dur: 0.04, vol: 0.20, lp: 6500, hp: 1500, band: [2400, 1.0], out });
    bus._tone({ freq: 380, freqEnd: 220, dur: 0.04, type: 'square', vol: 0.06, out });
    setTimeout(() => {
      bus._noise({ dur: 0.05, vol: 0.22, lp: 5500, hp: 1200, band: [1800, 1.0], out });
      bus._tone({ freq: 520, freqEnd: 280, dur: 0.05, type: 'square', vol: 0.06, out });
    }, 110);
  },
  wave: bus => {
    const out = bus._outNodes(0.55);
    // Ominous low rumble + warning bell.
    bus._tone({ freq: 60, freqEnd: 40, dur: 0.9, type: 'sine', vol: 0.22, out });
    bus._noise({ dur: 0.9, vol: 0.10, lp: 600, hp: 40, out });
    bus._tone({ freq: 220, freqEnd: 220, dur: 0.5, type: 'sine', vol: 0.10, out });
    setTimeout(() => bus._tone({ freq: 165, freqEnd: 165, dur: 0.7, type: 'sine', vol: 0.12, out }), 220);
  },
  shopBuy: bus => {
    const out = bus._outNodes(0.10);
    bus._tone({ freq: 700, freqEnd: 1000, dur: 0.05, type: 'sine', vol: 0.10, out });
    setTimeout(() => bus._tone({ freq: 1100, freqEnd: 1500, dur: 0.06, type: 'sine', vol: 0.10, out }), 50);
  },
  noFunds: bus => {
    const out = bus._outNodes(0.10);
    bus._tone({ freq: 200, freqEnd: 150, dur: 0.13, type: 'square', vol: 0.14, out });
  },
  empty: bus => {
    const out = bus._outNodes(0.05);
    // Dry click — sharp high noise crack, no body.
    bus._noise({ dur: 0.025, vol: 0.18, lp: 7000, hp: 2200, band: [3200, 1.0], out });
  },
  dodge: bus => {
    const out = bus._outNodes(0.18);
    bus._noise({ dur: 0.18, vol: 0.18, lp: 1600, hp: 200, out });
    bus._tone({ freq: 380, freqEnd: 540, dur: 0.10, type: 'sine', vol: 0.08, out });
  },
  radio: bus => {
    const out = bus._outNodes(0.05);
    bus._tone({ freq: 1200, freqEnd: 1100, dur: 0.04, type: 'square', vol: 0.06, out });
    setTimeout(() => bus._tone({ freq: 900, freqEnd: 850, dur: 0.04, type: 'square', vol: 0.06, out }), 60);
  },
  victory: bus => {
    const out = bus._outNodes(0.4);
    bus._tone({ freq: 440, dur: 0.3, type: 'sine', vol: 0.18, out });
    setTimeout(() => bus._tone({ freq: 660, dur: 0.3, type: 'sine', vol: 0.18, out }), 200);
    setTimeout(() => bus._tone({ freq: 880, dur: 0.6, type: 'sine', vol: 0.18, out }), 400);
  },
  defeat: bus => {
    const out = bus._outNodes(0.6);
    bus._tone({ freq: 220, freqEnd: 70, dur: 0.7, type: 'sawtooth', vol: 0.20, out });
    bus._noise({ dur: 0.7, vol: 0.20, lp: 600, hp: 40, out });
    bus._growl({ base: 80, dur: 0.9, vol: 0.16, vibratoHz: 4, lp: 500, out });
  },
  // Sky-wide thunder for the lightning effect.
  thunder: bus => {
    const out = bus._outNodes(0.7);
    bus._tone({ freq: 55, freqEnd: 30, dur: 1.4, type: 'sine', vol: 0.32, out });
    bus._noise({ dur: 1.6, vol: 0.28, lp: 500, hp: 30, out });
    setTimeout(() => bus._noise({ dur: 0.9, vol: 0.20, lp: 800, hp: 60, out }), 280);
  },
  heartbeat: bus => {
    const out = bus._outNodes(0.20);
    bus._tone({ freq: 70, freqEnd: 40, dur: 0.10, type: 'sine', vol: 0.32, out });
    setTimeout(() => bus._tone({ freq: 60, freqEnd: 35, dur: 0.13, type: 'sine', vol: 0.24, out }), 130);
  },
  // Blood-curdling shriek — high banshee tone collapsing into a guttural growl.
  // Used for intro jump scare beats.
  scream: bus => {
    const out = bus._outNodes(0.6);
    bus._tone({ freq: 1850, freqEnd: 320, dur: 0.55, type: 'sawtooth', vol: 0.22, out });
    bus._tone({ freq: 940, freqEnd: 180, dur: 0.65, type: 'square', vol: 0.16, out });
    bus._noise({ dur: 0.7, vol: 0.30, lp: 4500, hp: 400, band: [1600, 2.0], out });
    bus._growl({ base: 110, dur: 0.7, vol: 0.20, vibratoHz: 9, vibratoDepth: 18, grit: 0.20, lp: 720, out });
  },
  // Disembodied whisper — narrowband noise with a slow upward sweep, like
  // breath spoken right behind your ear.
  whisper: bus => {
    const out = bus._outNodes(0.65);
    bus._noise({ dur: 1.4, vol: 0.20, lp: 2200, hp: 350, band: [950, 4.5], out });
    bus._noise({ dur: 1.6, vol: 0.10, lp: 600, hp: 80, out });
    bus._tone({ freq: 60, freqEnd: 38, dur: 1.4, type: 'sine', vol: 0.10, out });
  },
  // Worn-tape hiss with a couple of crackle clicks. Plays when "tape" rolls.
  tape: bus => {
    const out = bus._outNodes(0.18);
    bus._noise({ dur: 1.2, vol: 0.10, lp: 8000, hp: 1200, out });
    bus._noise({ dur: 0.04, vol: 0.20, lp: 7000, hp: 2000, out });
    setTimeout(() => bus._noise({ dur: 0.04, vol: 0.16, lp: 7000, hp: 2200, out }), 230);
    setTimeout(() => bus._noise({ dur: 0.05, vol: 0.14, lp: 6500, hp: 1800, out }), 540);
  },
  // Long descending dread drone — chapter transition cue.
  drone: bus => {
    const out = bus._outNodes(0.55);
    bus._tone({ freq: 90, freqEnd: 42, dur: 1.6, type: 'sine', vol: 0.26, out });
    bus._tone({ freq: 132, freqEnd: 70, dur: 1.4, type: 'sawtooth', vol: 0.10, out });
    bus._noise({ dur: 1.7, vol: 0.10, lp: 700, hp: 60, out });
  },
};

AudioBus.prototype.play = function (name) {
  try { this.ensure(); } catch (e) { return; }
  if (!this.ctx) return;
  const fn = SFX[name];
  if (fn) {
    try { fn(this); } catch (e) {}
  }
};

// ---- Ambience controller ----
//
// Owns three simultaneous layers that run as long as the game is active:
//   1) Wind: pink-ish noise pushed through a slow LFO-modulated lowpass.
//   2) Distant moans: schedules a quiet `groan` SFX every few seconds.
//   3) Heartbeat: pulses every ~0.7s when intensity > 0 (low HP). Pulse rate
//      and volume rise with intensity.
//
// Call `setHeartbeatIntensity(0..1)` from the game loop based on player HP %.

class Ambience {
  constructor(bus) {
    this.bus = bus;
    this.windNodes = null;
    this.moanTimer = null;
    this.beatTimer = null;
    this.beatIntensity = 0;
    this.running = false;
  }
  start() {
    if (this.running) return;
    this.bus.ensure();
    if (!this.bus.ctx) return;
    this.running = true;
    this._startWind();
    this._scheduleMoan();
    this._scheduleBeat();
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.windNodes) {
      try { this.windNodes.src.stop(); } catch (e) {}
      this.windNodes = null;
    }
    if (this.moanTimer) { clearTimeout(this.moanTimer); this.moanTimer = null; }
    if (this.beatTimer) { clearTimeout(this.beatTimer); this.beatTimer = null; }
    this.beatIntensity = 0;
  }
  setHeartbeatIntensity(v) {
    this.beatIntensity = clamp(v, 0, 1);
  }

  _startWind() {
    const a = this.bus.ctx;
    // 4-second pink-ish noise loop. Cheap and seamless once filtered.
    const len = Math.floor(a.sampleRate * 4);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Crude low-pass of white noise to bias toward pink.
      const w = Math.random() * 2 - 1;
      last = last * 0.96 + w * 0.04;
      d[i] = last * 4;
    }
    const src = a.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
    const g = a.createGain(); g.gain.value = 0.0;
    src.connect(hp).connect(lp).connect(g).connect(this.bus.master);
    // Slow LFO on the lowpass so the wind "breathes".
    const lfo = a.createOscillator(); lfo.frequency.value = 0.13;
    const lfoGain = a.createGain(); lfoGain.gain.value = 280;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    src.start();
    g.gain.linearRampToValueAtTime(0.085, a.currentTime + 1.2);
    this.windNodes = { src, g, lp, lfo };
  }

  _scheduleMoan() {
    if (!this.running) return;
    // 4–9s between moans; ~30% chance to skip and stay quiet (the silence is
    // scarier than constant moaning).
    const next = 4000 + Math.random() * 5000;
    this.moanTimer = setTimeout(() => {
      if (this.running && Math.random() < 0.7) this.bus.play('groan');
      this._scheduleMoan();
    }, next);
  }

  _scheduleBeat() {
    if (!this.running) return;
    const i = this.beatIntensity;
    if (i <= 0.01) {
      this.beatTimer = setTimeout(() => this._scheduleBeat(), 800);
      return;
    }
    // Faster beat as intensity rises: 720ms at low → 320ms at full panic.
    const interval = 720 - 400 * i;
    // Volume rides intensity — duck the SFX gain via a temporary master tap.
    const a = this.bus.ctx;
    const out = a.createGain();
    out.gain.value = 0.4 + 0.7 * i;
    out.connect(this.bus.master);
    // Inline beat (don't go through play() so we can control gain).
    const beat = () => {
      this.bus._tone({ freq: 70, freqEnd: 40, dur: 0.10, type: 'sine', vol: 0.32, out });
      setTimeout(() => this.bus._tone({ freq: 60, freqEnd: 35, dur: 0.13, type: 'sine', vol: 0.24, out }), 130);
    };
    beat();
    this.beatTimer = setTimeout(() => this._scheduleBeat(), interval);
  }
}

AudioBus.prototype.startAmbience = function () {
  try { this.ensure(); } catch (e) { return; }
  if (!this.ctx) return;
  if (!this.ambience) this.ambience = new Ambience(this);
  this.ambience.start();
};
AudioBus.prototype.stopAmbience = function () {
  if (this.ambience) this.ambience.stop();
};
AudioBus.prototype.setHeartbeatIntensity = function (v) {
  if (this.ambience) this.ambience.setHeartbeatIntensity(v);
};
