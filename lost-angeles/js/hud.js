// HUD DOM : compteurs, roulette d'objet, minimap, écran sali, résultats.
import { ITEM_DEFS } from './items.js';
import { fmtTime, fmtRank } from './util.js';
import { charById } from './characters.js';

const $ = id => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), pos: $('hud-pos'), lap: $('hud-lap'), time: $('hud-time'),
      item: $('hud-item'), mini: $('hud-mini'), count: $('hud-count'),
      wrong: $('hud-wrong'), msg: $('hud-msg'), poop: $('poop'),
      results: $('screen-results'), rtable: $('results-table'), quit: $('btn-quit'),
    };
    this._rouletteTimer = null;
    this._toastTimer = null;
    this._miniCache = null;
  }

  show() { this.el.hud.classList.remove('hidden'); this.el.quit.style.display = 'block'; document.body.classList.add('racing'); }
  hide() {
    this.el.hud.classList.add('hidden'); this.el.quit.style.display = 'none';
    document.body.classList.remove('racing', 'boosting');
    this.el.poop.innerHTML = '';
    this.setItem(null);
    this.wrongWay(false);
    this.countdown('');
    if (this._rouletteTimer) { clearInterval(this._rouletteTimer); this._rouletteTimer = null; }
  }

  setLap(lap, total) { this.el.lap.textContent = `Tour ${Math.min(lap, total)}/${total}`; }
  setRank(r) { this.el.pos.innerHTML = fmtRank(r); }
  setTime(s) { const m = Math.floor(s / 60); const r = s - m * 60; this.el.time.textContent = s < 0 ? '0:00.0' : `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; }
  setBoost(on) { document.body.classList.toggle('boosting', on); }

  setItem(id) {
    this.el.item.textContent = id ? ITEM_DEFS[id].icon : '';
    this.el.item.classList.toggle('flash', !!id);
  }

  itemRoulette(finalId, audio, onDone) {
    if (this._rouletteTimer) clearInterval(this._rouletteTimer);
    const icons = Object.values(ITEM_DEFS).map(d => d.icon);
    let n = 0;
    this.el.item.classList.remove('flash');
    this._rouletteTimer = setInterval(() => {
      this.el.item.textContent = icons[n % icons.length];
      audio.play('roll');
      if (++n >= 13) {
        clearInterval(this._rouletteTimer);
        this._rouletteTimer = null;
        this.setItem(finalId);
        audio.play('got');
        onDone && onDone();
      }
    }, 65);
  }

  countdown(text) {
    this.el.count.textContent = text;
    this.el.count.classList.toggle('hidden', !text);
  }

  wrongWay(on) { this.el.wrong.classList.toggle('hidden', !on); }

  toast(text, dur = 3000) {
    this.el.msg.textContent = text;
    this.el.msg.style.opacity = 1;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.el.msg.style.opacity = 0; }, dur);
  }

  splat() {
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('div');
      d.className = 'splat';
      d.textContent = '💩';
      d.style.left = (5 + Math.random() * 75) + 'vw';
      d.style.top = (-5 + Math.random() * 60) + 'vh';
      d.style.transform = `rotate(${(Math.random() - .5) * 60}deg) scale(${.7 + Math.random() * .9})`;
      this.el.poop.appendChild(d);
      setTimeout(() => {
        d.style.opacity = 0;
        d.style.transform += ' translateY(30vh)';
      }, 2600 + Math.random() * 900);
      setTimeout(() => d.remove(), 5200);
    }
  }

  drawMinimap(track, karts, localSlot) {
    const cv = this.el.mini;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; this._miniCache = null; }
    const g = cv.getContext('2d');

    if (!this._miniCache || this._miniCache.track !== track) {
      // normalisation du tracé
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (const [x, z] of track.minimapPts) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      const pad = 14 * dpr;
      const sc = Math.min((w * dpr - pad * 2) / (maxX - minX), (h * dpr - pad * 2) / (maxZ - minZ));
      const ox = (w * dpr - (maxX - minX) * sc) / 2 - minX * sc;
      const oz = (h * dpr - (maxZ - minZ) * sc) / 2 - minZ * sc;
      this._miniCache = { track, sc, ox, oz };
    }
    const { sc, ox, oz } = this._miniCache;
    const px = (x, z) => [x * sc + ox, z * sc + oz];

    g.clearRect(0, 0, cv.width, cv.height);
    g.lineWidth = 4.5 * dpr;
    g.strokeStyle = 'rgba(20,14,8,.75)';
    g.beginPath();
    track.minimapPts.forEach(([x, z], i) => {
      const [a, b] = px(x, z);
      i ? g.lineTo(a, b) : g.moveTo(a, b);
    });
    g.closePath(); g.stroke();
    g.lineWidth = 2.5 * dpr;
    g.strokeStyle = 'rgba(245,233,208,.85)';
    g.stroke();
    // ligne de départ
    const [sx, sy] = px(...track.minimapPts[0]);
    g.fillStyle = '#111';
    g.fillRect(sx - 3 * dpr, sy - 3 * dpr, 6 * dpr, 6 * dpr);
    // dangers : saut (triangle orange) et fosse aux fans (rond violet)
    if (track.jump) {
      const [jx, jy] = px(...track.minimapPts[Math.floor(track.jump.center) % track.minimapPts.length]);
      g.fillStyle = '#ff8830';
      g.beginPath();
      g.moveTo(jx, jy - 5 * dpr); g.lineTo(jx + 4.5 * dpr, jy + 3.5 * dpr); g.lineTo(jx - 4.5 * dpr, jy + 3.5 * dpr);
      g.closePath(); g.fill();
      g.lineWidth = 1.2 * dpr; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
    }
    if (track.crowd) {
      const mid = Math.floor((track.crowd.f0 + track.crowd.f1) / 2) % track.minimapPts.length;
      const [cx2, cy2] = px(...track.minimapPts[mid]);
      g.fillStyle = '#c060d8';
      g.beginPath(); g.arc(cx2, cy2, 3.4 * dpr, 0, 7); g.fill();
      g.lineWidth = 1.2 * dpr; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
    }

    // karts (le local au-dessus)
    const sorted = [...karts].sort((a, b) => (a.slot === localSlot) - (b.slot === localSlot));
    for (const k of sorted) {
      const [x, y] = px(k.x, k.z);
      const me = k.slot === localSlot;
      g.beginPath();
      g.arc(x, y, (me ? 5 : 3.4) * dpr, 0, 7);
      g.fillStyle = me ? '#ffb347' : '#' + charById(k.charId).color.toString(16).padStart(6, '0');
      g.fill();
      g.lineWidth = 1.5 * dpr;
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.stroke();
    }
  }

  showResults(rows, localName) {
    const tb = this.el.rtable;
    tb.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.isLocal) tr.className = 'me';
      const rk = document.createElement('td'); rk.className = 'rk';
      rk.textContent = r.rank + (r.rank === 1 ? 'ᵉʳ' : 'ᵉ');
      const nm = document.createElement('td');
      nm.textContent = r.name + (r.isLocal ? ' (toi)' : '');
      const ch = document.createElement('td');
      ch.textContent = r.charName; ch.style.color = '#9c8a70'; ch.style.fontSize = '13px';
      const tm = document.createElement('td'); tm.className = 'tm';
      tm.textContent = r.time != null ? fmtTime(r.time) : (r.racing ? '…' : 'DNF');
      tr.append(rk, nm, ch, tm);
      tb.appendChild(tr);
    }
    this.el.results.classList.remove('hidden');
  }
  hideResults() { this.el.results.classList.add('hidden'); }
}
