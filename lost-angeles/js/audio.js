// Sons 100 % synthétisés (WebAudio) : moteur + effets. Aucun fichier audio.
export class AudioFx {
  constructor() {
    this.ctx = null;
    this.engine = null;
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

  // ——— moteur ———
  // Deux dents de scie légèrement désaccordées + sous-octave triangle, le tout
  // derrière un passe-bas qui s'ouvre avec le régime : rond au ralenti, rauque
  // à fond, sans le côté criard de l'ancien carré.
  engineStart() {
    if (!this.ctx || this.engine) return;
    const c = this.ctx;
    const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 46;
    const osc2 = c.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = 46; osc2.detune.value = 14;
    const sub = c.createOscillator(); sub.type = 'triangle'; sub.frequency.value = 23;
    // à-coups de ralenti (vibrato lent qui s'estompe avec la vitesse)
    const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 12;
    const lfoG = c.createGain(); lfoG.gain.value = 4;
    lfo.connect(lfoG); lfoG.connect(osc.frequency); lfoG.connect(osc2.frequency);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = .9;
    const g = c.createGain(); g.gain.value = 0;
    const subG = c.createGain(); subG.gain.value = .55;
    osc.connect(f); osc2.connect(f); sub.connect(subG); subG.connect(f);
    f.connect(g); g.connect(this.master);
    osc.start(); osc2.start(); sub.start(); lfo.start();
    // souffle de boost
    const nz = c.createBufferSource(); nz.buffer = this._noiseBuf(); nz.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = .8;
    const ng = c.createGain(); ng.gain.value = 0;
    nz.connect(nf); nf.connect(ng); ng.connect(this.master);
    nz.start();
    this.engine = { osc, osc2, sub, lfo, lfoG, filter: f, g, ng };
  }

  engineUpdate(ratio, boosting, dt) {
    if (!this.engine) return;
    const e = this.engine, t = this.ctx.currentTime;
    const rpm = 46 + ratio * 98 + (boosting ? 18 : 0);
    e.osc.frequency.setTargetAtTime(rpm, t, .08);
    e.osc2.frequency.setTargetAtTime(rpm, t, .1); // le détune fixe crée le battement
    e.sub.frequency.setTargetAtTime(rpm / 2, t, .08);
    e.filter.frequency.setTargetAtTime(240 + ratio * 1050 + (boosting ? 500 : 0), t, .09);
    e.lfoG.gain.setTargetAtTime(4.5 * Math.max(0, 1 - ratio * 1.4), t, .12); // à-coups au ralenti seulement
    e.g.gain.setTargetAtTime(.09 + ratio * .07, t, .1);
    e.ng.gain.setTargetAtTime(boosting ? .14 : 0, t, .08);
  }

  engineStop() {
    if (!this.engine) return;
    try {
      this.engine.osc.stop(); this.engine.osc2.stop();
      this.engine.sub.stop(); this.engine.lfo.stop();
    } catch (e) {}
    this.engine.g.disconnect(); this.engine.ng.disconnect();
    this.engine = null;
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
      case 'pickup': this._tone(660, .09, 'square', .25); this._tone(880, .12, 'square', .25, null, .08); break;
      case 'roll': this._tone(440 + Math.random() * 220, .05, 'square', .12); break;
      case 'got': this._tone(523, .1, 'square', .3); this._tone(784, .18, 'square', .3, null, .09); break;
      case 'boost': this._burst(.7, .5, 2400, 'bandpass'); this._tone(220, .5, 'sawtooth', .2, 660); break;
      case 'armor': this._tone(330, .5, 'triangle', .35, 990); break;
      case 'saw': this._burst(.5, .3, 3000, 'highpass'); this._tone(180, .4, 'sawtooth', .2, 240); break;
      case 'sawHit': this._burst(.25, .6, 2600, 'highpass'); this._tone(160, .3, 'sawtooth', .4, 60); break;
      case 'missile': this._burst(1.0, .5, 900); this._tone(90, .9, 'sawtooth', .3, 350); break;
      case 'spear': this._burst(.4, .4, 1400, 'bandpass'); break;
      case 'drop': this._tone(240, .12, 'square', .3, 120); break;
      case 'grap': this._tone(880, .3, 'square', .25, 220); this._burst(.3, .3, 2000, 'bandpass', .15); break;
      case 'poop': this._tone(150, .35, 'sine', .5, 60); this._burst(.3, .4, 400, 'lowpass', .1); break;
      case 'boom': this._burst(.6, .7, 600); break;
      case 'boomBig': this._burst(1.1, .9, 500); this._tone(60, .8, 'sine', .5, 30); break;
      case 'spin': this._tone(500, .4, 'sawtooth', .35, 120); break;
      case 'bump': this._burst(.12, .45, 500); break;
      case 'count': this._tone(440, .18, 'square', .4); break;
      case 'go': this._tone(880, .5, 'square', .45); break;
      case 'lap': this._tone(587, .12, 'square', .3); this._tone(880, .2, 'square', .3, null, .1); break;
      case 'finish':
        [523, 659, 784, 1047].forEach((f, i) => this._tone(f, .22, 'square', .35, null, i * .13));
        break;
      case 'wrong': this._tone(200, .2, 'square', .25, 150); break;
      case 'lob': this._tone(300, .25, 'sine', .28, 140); break;
      case 'cheer': this._burst(1.3, .35, 1200, 'bandpass'); this._burst(.9, .22, 2400, 'bandpass', .18); break;
      case 'fall': this._tone(520, .7, 'sawtooth', .35, 70); this._burst(.5, .5, 300, 'lowpass', .35); break;
      case 'land': this._burst(.16, .5, 420); break;
    }
  }
}
