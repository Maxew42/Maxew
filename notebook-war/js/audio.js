// Tiny synthesized sound kit (WebAudio, no assets).
// Every effect takes an optional {pan, vol} so the game can place sounds in
// stereo space relative to the player (directional gunfire, footsteps…).
let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const CENTER = { pan: 0, vol: 1 };

function route(a, node, p) {
  const g = a.createGain();
  g.gain.value = p.vol;
  if (a.createStereoPanner) {
    const sp = a.createStereoPanner();
    sp.pan.value = Math.max(-1, Math.min(1, p.pan || 0));
    node.connect(g).connect(sp).connect(a.destination);
  } else {
    node.connect(g).connect(a.destination);
  }
}

function noise(dur, { freq = 1200, type = 'lowpass', vol = 0.25, decay = true } = {}, p = CENTER) {
  if (p.vol <= 0.02) return;
  const a = ac();
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (decay ? 1 - i / len : 1);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g);
  route(a, g, p);
  src.start();
}

function tone(freq, dur, { type = 'square', vol = 0.12, slide = 0 } = {}, p = CENTER) {
  if (p.vol <= 0.02) return;
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g);
  route(a, g, p);
  o.start(); o.stop(a.currentTime + dur);
}

export const audio = {
  unlock() { try { ac(); } catch (e) {} },
  shoot(kind, p = CENTER) {
    try {
      switch (kind) {
        case 'pistol': case 'shield': noise(0.07, { freq: 2400, vol: 0.14 }, p); break;
        case 'deagle': noise(0.14, { freq: 1500, vol: 0.3 }, p); tone(140, 0.1, { vol: 0.1, slide: -80 }, p); break;
        case 'shotgun': noise(0.22, { freq: 900, vol: 0.38 }, p); break;
        case 'm4': noise(0.06, { freq: 2800, vol: 0.16 }, p); break;
        case 'ak47': noise(0.08, { freq: 2000, vol: 0.2 }, p); break;
        case 'negev': noise(0.07, { freq: 1600, vol: 0.24 }, p); break;
        case 'awp': noise(0.3, { freq: 1100, vol: 0.4 }, p); tone(90, 0.25, { vol: 0.12, slide: -40 }, p); break;
        case 'bazooka': noise(0.4, { freq: 700, vol: 0.3 }, p); tone(70, 0.35, { type: 'sawtooth', vol: 0.1, slide: 60 }, p); break;
        case 'flamer': noise(0.09, { freq: 500, vol: 0.07, decay: false }, p); break;
        default: noise(0.06, { freq: 2200, vol: 0.12 }, p);
      }
    } catch (e) {}
  },
  swing(p = CENTER) { try { noise(0.08, { freq: 600, type: 'bandpass', vol: 0.1 }, p); } catch (e) {} },
  hit(p = CENTER) { try { tone(160, 0.08, { type: 'triangle', vol: 0.16, slide: -60 }, p); noise(0.05, { freq: 800, vol: 0.1 }, p); } catch (e) {} },
  hurt(p = CENTER) { try { tone(110, 0.14, { type: 'sawtooth', vol: 0.14, slide: -50 }, p); } catch (e) {} },
  death(p = CENTER) { try { tone(220, 0.4, { type: 'sawtooth', vol: 0.16, slide: -180 }, p); noise(0.3, { freq: 500, vol: 0.2 }, p); } catch (e) {} },
  boom(p = CENTER) { try { noise(0.7, { freq: 320, vol: 0.5 }, p); tone(55, 0.5, { type: 'sine', vol: 0.25, slide: -25 }, p); } catch (e) {} },
  click(p = CENTER) { try { tone(900, 0.03, { vol: 0.08 }, p); } catch (e) {} },
  swap(p = CENTER) { try { tone(500, 0.05, { vol: 0.07 }, p); tone(700, 0.05, { vol: 0.07 }, p); } catch (e) {} },
  pickup(p = CENTER) { try { tone(660, 0.07, { type: 'triangle', vol: 0.12 }, p); tone(990, 0.09, { type: 'triangle', vol: 0.12 }, p); } catch (e) {} },
  jump(p = CENTER) { try { tone(300, 0.07, { type: 'triangle', vol: 0.05, slide: 120 }, p); } catch (e) {} },
  bounce(p = CENTER) { try { tone(400, 0.04, { type: 'triangle', vol: 0.06 }, p); } catch (e) {} },
  wallBreak(p = CENTER) { try { noise(0.2, { freq: 600, vol: 0.25 }, p); } catch (e) {} },
  step(p = CENTER) { try { noise(0.045, { freq: 380, type: 'bandpass', vol: 0.09 }, p); } catch (e) {} },
};
