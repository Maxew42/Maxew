// Tiny synthesized sound kit (WebAudio, no assets).
let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(dur, { freq = 1200, type = 'lowpass', vol = 0.25, decay = true } = {}) {
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
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

function tone(freq, dur, { type = 'square', vol = 0.12, slide = 0 } = {}) {
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}

export const audio = {
  unlock() { try { ac(); } catch (e) {} },
  shoot(kind) {
    try {
      switch (kind) {
        case 'pistol': case 'shield': noise(0.07, { freq: 2400, vol: 0.14 }); break;
        case 'deagle': noise(0.14, { freq: 1500, vol: 0.3 }); tone(140, 0.1, { vol: 0.1, slide: -80 }); break;
        case 'shotgun': noise(0.22, { freq: 900, vol: 0.38 }); break;
        case 'm4': noise(0.06, { freq: 2800, vol: 0.16 }); break;
        case 'ak47': noise(0.08, { freq: 2000, vol: 0.2 }); break;
        case 'negev': noise(0.07, { freq: 1600, vol: 0.24 }); break;
        case 'awp': noise(0.3, { freq: 1100, vol: 0.4 }); tone(90, 0.25, { vol: 0.12, slide: -40 }); break;
        case 'bazooka': noise(0.4, { freq: 700, vol: 0.3 }); tone(70, 0.35, { type: 'sawtooth', vol: 0.1, slide: 60 }); break;
        case 'flamer': noise(0.09, { freq: 500, vol: 0.07, decay: false }); break;
        default: noise(0.06, { freq: 2200, vol: 0.12 });
      }
    } catch (e) {}
  },
  swing() { try { noise(0.08, { freq: 600, type: 'bandpass', vol: 0.1 }); } catch (e) {} },
  hit() { try { tone(160, 0.08, { type: 'triangle', vol: 0.16, slide: -60 }); noise(0.05, { freq: 800, vol: 0.1 }); } catch (e) {} },
  hurt() { try { tone(110, 0.14, { type: 'sawtooth', vol: 0.14, slide: -50 }); } catch (e) {} },
  death() { try { tone(220, 0.4, { type: 'sawtooth', vol: 0.16, slide: -180 }); noise(0.3, { freq: 500, vol: 0.2 }); } catch (e) {} },
  boom() { try { noise(0.7, { freq: 320, vol: 0.5 }); tone(55, 0.5, { type: 'sine', vol: 0.25, slide: -25 }); } catch (e) {} },
  click() { try { tone(900, 0.03, { vol: 0.08 }); } catch (e) {} },
  swap() { try { tone(500, 0.05, { vol: 0.07 }); tone(700, 0.05, { vol: 0.07 }); } catch (e) {} },
  pickup() { try { tone(660, 0.07, { type: 'triangle', vol: 0.12 }); tone(990, 0.09, { type: 'triangle', vol: 0.12 }); } catch (e) {} },
  jump() { try { tone(300, 0.07, { type: 'triangle', vol: 0.05, slide: 120 }); } catch (e) {} },
  bounce() { try { tone(400, 0.04, { type: 'triangle', vol: 0.06 }); } catch (e) {} },
  wallBreak() { try { noise(0.2, { freq: 600, vol: 0.25 }); } catch (e) {} },
};
