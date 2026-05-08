// Synthesized SFX via Web Audio. Browser-only.

const rand = (a, b) => a + Math.random() * (b - a);

export class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.7;
  }
  ensure() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }
  beep(freq, dur, type = 'square', vol = 0.15, slide = 0.4) {
    if (!this.ctx) return;
    const a = this.ctx;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(a.currentTime + dur + 0.02);
  }
  noise(dur, vol, lp) {
    if (!this.ctx) return;
    const a = this.ctx;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp;
    const g = a.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }
  play(name) {
    try { this.ensure(); } catch (e) { return; }
    const fn = SFX[name];
    if (fn) fn(this);
  }
}

const SFX = {
  pistol:   bus => bus.beep(880 + rand(-30,30), 0.06, 'square', 0.10, 0.35),
  shotgun:  bus => { bus.beep(190, 0.18, 'sawtooth', 0.18, 0.3); bus.noise(0.2, 0.32, 1500); },
  smg:      bus => bus.beep(1100 + rand(-60,60), 0.03, 'square', 0.07, 0.4),
  rifle:    bus => { bus.beep(260, 0.13, 'sawtooth', 0.24, 0.25); bus.noise(0.12, 0.22, 700); },
  hit:      bus => bus.beep(160 + rand(-20,20), 0.05, 'triangle', 0.10, 0.4),
  death:    bus => { bus.beep(110, 0.22, 'sawtooth', 0.14, 0.2); bus.noise(0.16, 0.18, 700); },
  groan:    bus => bus.beep(70 + rand(-10,30), 0.5, 'sawtooth', 0.05, 0.7),
  pickup:   bus => { bus.beep(900, 0.04, 'sine', 0.12, 0.7); setTimeout(()=>bus.beep(1400, 0.04, 'sine', 0.12, 0.7), 50); },
  reload:   bus => { bus.beep(380, 0.04, 'square', 0.08, 0.7); setTimeout(()=>bus.beep(640, 0.04, 'square', 0.08, 0.7), 80); },
  hurt:     bus => { bus.beep(200, 0.16, 'sawtooth', 0.22, 0.3); bus.noise(0.1, 0.16, 1100); },
  wave:     bus => { bus.beep(440, 0.2, 'sine', 0.18, 0.7); setTimeout(()=>bus.beep(660, 0.2, 'sine', 0.18, 0.7), 140); setTimeout(()=>bus.beep(880, 0.25, 'sine', 0.18, 0.7), 280); },
  shopBuy:  bus => { bus.beep(700, 0.05, 'sine', 0.10, 0.7); setTimeout(()=>bus.beep(1100, 0.06, 'sine', 0.10, 0.7), 50); },
  noFunds:  bus => bus.beep(180, 0.12, 'square', 0.14, 0.3),
  brute:    bus => { bus.beep(56, 0.4, 'sawtooth', 0.20, 0.6); bus.noise(0.32, 0.18, 400); },
  empty:    bus => bus.beep(220, 0.04, 'square', 0.08, 1),
  dodge:    bus => bus.beep(380, 0.1, 'sine', 0.10, 1.4),
  spit:     bus => bus.beep(560, 0.2, 'triangle', 0.12, 0.4),
  radio:    bus => { bus.beep(1200, 0.04, 'square', 0.06, 0.9); setTimeout(()=>bus.beep(900, 0.04, 'square', 0.06, 0.9), 60); },
  victory:  bus => { bus.beep(440, 0.3, 'sine', 0.2, 0.9); setTimeout(()=>bus.beep(660, 0.3, 'sine', 0.2, 0.9), 200); setTimeout(()=>bus.beep(880, 0.6, 'sine', 0.2, 0.9), 400); },
  defeat:   bus => { bus.beep(220, 0.5, 'sawtooth', 0.2, 0.4); bus.noise(0.5, 0.2, 600); },
};
