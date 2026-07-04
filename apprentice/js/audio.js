// Sons 100 % synthétisés (WebAudio) : bourdon de sabre + effets. Aucun fichier audio.
export class AudioFx {
  constructor() {
    this.ctx = null;
    this.hum = null;
    this.muted = false;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = .5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _noiseBuf() {
    if (this._nb) return this._nb;
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this._nb = b);
  }

  // ——— bourdon du sabre local ———
  humStart() {
    if (!this.ctx || this.hum) return;
    const c = this.ctx;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 62;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 124;
    // léger battement caractéristique
    const lfo = c.createOscillator(); lfo.frequency.value = 5.2;
    const lfoG = c.createGain(); lfoG.gain.value = 3.5;
    lfo.connect(lfoG); lfoG.connect(o1.frequency);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 1.5;
    const g = c.createGain(); g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start();
    g.gain.setTargetAtTime(.075, c.currentTime, .3);
    this.hum = { o1, o2, lfo, g };
  }

  // le bourdon monte quand on bouge / attaque
  humUpdate(intensity) {
    if (!this.hum) return;
    const t = this.ctx.currentTime;
    this.hum.o1.frequency.setTargetAtTime(62 + intensity * 26, t, .08);
    this.hum.g.gain.setTargetAtTime(.07 + intensity * .05, t, .1);
  }

  humStop() {
    if (!this.hum) return;
    try { this.hum.o1.stop(); this.hum.o2.stop(); this.hum.lfo.stop(); } catch (e) {}
    this.hum.g.disconnect();
    this.hum = null;
  }

  // ——— briques de synthèse ———
  _tone(freq, dur, type = 'square', vol = .3, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + .02);
  }

  _burst(dur, vol = .5, freq = 800, type = 'lowpass', delay = 0) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this._noiseBuf();
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * .12), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t0); s.stop(t0 + dur + .02);
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'ignite': this._burst(.35, .4, 1200, 'bandpass'); this._tone(70, .4, 'sawtooth', .3, 140); break;
      case 'off': this._tone(140, .3, 'sawtooth', .25, 60); break;
      case 'swing': this._burst(.18, .3, 900 + Math.random() * 500, 'bandpass'); this._tone(160, .16, 'sawtooth', .12, 90); break;
      case 'clash': // sabre contre sabre / parade
        this._burst(.22, .7, 3400, 'highpass');
        this._tone(880 + Math.random() * 400, .25, 'sawtooth', .3, 220);
        this._tone(1560, .1, 'square', .2);
        break;
      case 'hit': this._burst(.25, .6, 1800, 'bandpass'); this._tone(200, .3, 'sawtooth', .35, 70); break;
      case 'blaster': this._tone(1500, .12, 'square', .28, 380); this._burst(.08, .2, 2500, 'highpass'); break;
      case 'deflect': this._tone(700, .14, 'square', .3, 1900); this._burst(.1, .3, 3000, 'highpass'); break;
      case 'reflect': this._tone(600, .2, 'square', .35, 2400); break;
      case 'force': this._burst(.55, .6, 300, 'lowpass'); this._tone(90, .5, 'sine', .5, 40); break;
      case 'forcefail': this._tone(220, .18, 'square', .25, 160); break;
      case 'dash': this._burst(.16, .3, 1600, 'bandpass'); break;
      case 'jump': this._tone(300, .12, 'sine', .2, 460); break;
      case 'stagger': this._tone(320, .22, 'sawtooth', .3, 110); break;
      case 'droidDie': this._burst(.5, .6, 900); this._tone(500, .4, 'square', .3, 60); this._tone(1200, .15, 'square', .2, 300, .1); break;
      case 'die': this._tone(400, .8, 'sawtooth', .4, 50); this._burst(.6, .5, 700); break;
      case 'kill': this._tone(523, .12, 'square', .3); this._tone(784, .2, 'square', .3, null, .1); break;
      case 'wave': [392, 523, 659].forEach((f, i) => this._tone(f, .2, 'square', .3, null, i * .12)); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this._tone(f, .24, 'square', .35, null, i * .13)); break;
      case 'lose': [400, 340, 280, 200].forEach((f, i) => this._tone(f, .3, 'sawtooth', .3, null, i * .16)); break;
      case 'count': this._tone(440, .18, 'square', .4); break;
      case 'go': this._tone(880, .5, 'square', .45); break;
      case 'click': this._tone(440 + Math.random() * 220, .05, 'square', .12); break;
      case 'lowhp': this._tone(180, .25, 'square', .2, 140); break;
    }
  }
}
