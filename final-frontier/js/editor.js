// The rocket assembly bay: palette, stack canvas, staging + delta-v readouts.
import { PARTS, CATEGORIES, PRESETS, computeRocketStats, validateDesign } from './parts.js';
import { layout, drawRocket } from './rocket.js';
import { PHYS, TIERS } from './constants.js';
import { fmtMass, fmtDv, fmtDist } from './util.js';
import { isTierUnlocked, savedDesigns, saveDesign, deleteDesign } from './save.js';

const $ = s => document.querySelector(s);

export class Editor {
  constructor() {
    this.canvas = $('#build-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.design = emptyDesign();
    this.selected = -1;
    this.nodeRects = [];
    this.onLaunch = null;
    this.onExit = null;
    this._bind();
  }

  _bind() {
    this.canvas.addEventListener('pointerdown', e => this._pick(e));
    $('#build-launch').addEventListener('click', () => {
      const v = validateDesign(this.design);
      if (!v.ok) { this._flashWarn(); return; }
      this.onLaunch && this.onLaunch(this._exportDesign());
    });
    $('#build-clear').addEventListener('click', () => { this.design = emptyDesign(); this.selected = -1; this.render(); });
    $('#build-save').addEventListener('click', () => this._save());
    $('#build-load').addEventListener('click', () => this._toggleLoad(true));
    $('#load-close').addEventListener('click', () => this._toggleLoad(false));
    $('#build-exit').addEventListener('click', () => this.onExit && this.onExit());
    $('#sel-up').addEventListener('click', () => this._move(-1));
    $('#sel-down').addEventListener('click', () => this._move(1));
    $('#sel-del').addEventListener('click', () => this._delete());
    $('#build-name').addEventListener('input', e => { this.design.name = e.target.value; });
    window.addEventListener('resize', () => { if (!$('#screen-build').classList.contains('hidden')) this.render(); });
  }

  open(design) {
    this.design = design ? cloneDesign(design) : emptyDesign();
    this.selected = -1;
    this._toggleLoad(false);
    this.renderPalette();
    this.render();
  }

  _exportDesign() {
    const d = cloneDesign(this.design);
    d.tier = maxTier(d);
    if (!d.name || !d.name.trim()) d.name = 'Rocket ' + (savedDesigns().length + 1);
    return d;
  }

  // ---- palette ----
  renderPalette() {
    const pal = $('#palette');
    pal.innerHTML = '';
    for (const cat of CATEGORIES) {
      const items = Object.values(PARTS).filter(p => cat.kinds.includes(p.kind) && isTierUnlocked(p.tier));
      if (!items.length) continue;
      const head = document.createElement('div');
      head.className = 'pal-cat';
      head.textContent = cat.label;
      pal.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'pal-grid';
      for (const p of items) grid.appendChild(this._palCard(p));
      pal.appendChild(grid);
    }
  }

  _palCard(p) {
    const card = document.createElement('button');
    card.className = 'pal-card';
    const cv = document.createElement('canvas');
    cv.width = 76; cv.height = 76;
    drawPartThumb(cv, p);
    const name = document.createElement('div');
    name.className = 'pal-name';
    name.textContent = p.name;
    const stat = document.createElement('div');
    stat.className = 'pal-stat';
    stat.textContent = partBlurb(p);
    card.append(cv, name, stat);
    card.title = partBlurb(p);
    card.addEventListener('click', () => this._add(p));
    return card;
  }

  _add(p) {
    if (p.attach === 'radial') {
      let idx = this.selected;
      if (idx < 0) idx = this.design.stack.length - 1;    // default: last (bottom) node
      const host = this.design.stack[idx];
      if (!host) { this._toast('Add a body part first, then attach fins.'); return; }
      host.radial = host.radial || [];
      host.radial.push(p.id);
      this.selected = idx;
    } else {
      this.design.stack.push({ id: p.id, radial: [] });
      this.selected = this.design.stack.length - 1;
    }
    this.render();
  }

  // ---- canvas + selection ----
  _pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let hit = -1;
    for (let i = 0; i < this.nodeRects.length; i++) {
      const b = this.nodeRects[i];
      if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) hit = i;
    }
    this.selected = hit;
    this.render();
  }

  _move(dir) {
    const i = this.selected;
    const j = i + dir;
    const s = this.design.stack;
    if (i < 0 || j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    this.selected = j;
    this.render();
  }

  _delete() {
    if (this.selected < 0) return;
    const node = this.design.stack[this.selected];
    if (node.radial && node.radial.length) { node.radial.pop(); this.render(); return; }
    this.design.stack.splice(this.selected, 1);
    this.selected = Math.min(this.selected, this.design.stack.length - 1);
    this.render();
  }

  render() {
    this._sizeCanvas();
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, dpr = devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // soft bay background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#141a33'); g.addColorStop(1, '#0d1226');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawBayGrid(ctx, W, H, dpr);

    this.nodeRects = [];
    const s = this.design.stack;
    if (s.length) {
      const lo = layout(this.design);
      const cw = W / dpr, ch = H / dpr;
      const ppm = Math.min((ch * 0.82) / lo.H, (cw * 0.42) / lo.W);
      const cx = cw * 0.52, cy = ch * 0.5;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // stage brackets
      drawStageBrackets(ctx, lo, cx, cy, ppm);
      ctx.save();
      ctx.translate(cx, cy);
      drawRocket(ctx, this.design, { layout: lo, ppm, selectIndex: this.selected });
      ctx.restore();
      // record hit rects (screen px, no dpr)
      for (let i = 0; i < lo.nodes.length; i++) {
        const n = lo.nodes[i];
        const w = Math.max(n.w, 0.3) * ppm, h = n.h * ppm;
        const ly = (n.cy - lo.H / 2) * ppm;
        this.nodeRects[i] = { x: cx - w / 2, y: cy + ly - h / 2, w, h };
      }
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(200,215,255,0.5)';
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pick parts on the left to build your rocket 🚀', (W / dpr) * 0.52, (H / dpr) * 0.5);
      ctx.fillText('Tip: nose on top, engine at the bottom.', (W / dpr) * 0.52, (H / dpr) * 0.5 + 26);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._renderStats();
    this._renderSelBar();
  }

  _renderSelBar() {
    const bar = $('#sel-bar');
    const node = this.selected >= 0 ? this.design.stack[this.selected] : null;
    if (!node) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const p = PARTS[node.id];
    const rad = (node.radial || []).length ? ` +${node.radial.length} fin/booster` : '';
    $('#sel-name').textContent = p.name + rad;
  }

  _renderStats() {
    const st = computeRocketStats(this.design);
    const v = validateDesign(this.design);
    $('#build-name').value = this.design.name || '';

    const twrClass = t => t >= 1.3 ? 'good' : t >= 1 ? 'warn' : 'bad';
    const box = $('#stats-body');
    let html = '';
    html += `<div class="stat-row"><span>Total mass</span><b>${fmtMass(st.totalMass)}</b></div>`;
    html += `<div class="stat-row"><span>Stages</span><b>${st.stageCount}</b></div>`;
    html += `<div class="stat-row"><span>Total Δv</span><b>${fmtDv(st.totalDv)}</b></div>`;
    html += `<div class="stat-row"><span>Lift-off TWR</span><b class="${twrClass(st.liftoffTwr)}">${st.liftoffTwr.toFixed(2)}</b></div>`;
    html += `<div class="dv-hint">Orbit needs ≈ ${fmtDv(2300)} · Moon ≈ ${fmtDv(4800)}</div>`;

    if (st.stageCount) {
      html += '<div class="stage-list">';
      // display top-first (stage numbers high at top), fire order is bottom-first
      for (let i = st.stages.length - 1; i >= 0; i--) {
        const s = st.stages[i];
        const burn = s.thrust > 0 ? `Δv ${Math.round(s.dv)} · TWR <b class="${twrClass(s.twr)}">${s.twr.toFixed(1)}</b>` : '<span class="muted">payload</span>';
        html += `<div class="stage-item"><span class="stg-num">S${i + 1}</span><span>${burn}</span></div>`;
      }
      html += '</div>';
    }
    box.innerHTML = html;

    const warnEl = $('#build-warn');
    warnEl.innerHTML = v.warn.map(w => `<div>⚠ ${w}</div>`).join('');
    $('#build-launch').disabled = !v.ok;
  }

  _sizeCanvas() {
    const dpr = devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(200, Math.round(r.width * dpr)), h = Math.max(200, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // ---- load / save panel ----
  _toggleLoad(show) {
    const p = $('#load-panel');
    if (!show) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    const list = $('#load-list');
    list.innerHTML = '';
    const blueprints = PRESETS.filter(pr => isTierUnlocked(pr.tier));
    if (blueprints.length) list.appendChild(sectionTitle('Blueprints'));
    for (const pr of blueprints) list.appendChild(this._loadRow(pr, false));
    const saved = savedDesigns();
    if (saved.length) list.appendChild(sectionTitle('Your rockets'));
    for (const d of saved) list.appendChild(this._loadRow(d, true));
    if (!blueprints.length && !saved.length) {
      const e = document.createElement('div'); e.className = 'muted'; e.style.padding = '12px';
      e.textContent = 'No blueprints yet — build one!'; list.appendChild(e);
    }
  }

  _loadRow(d, deletable) {
    const st = computeRocketStats(d);
    const row = document.createElement('div');
    row.className = 'load-row';
    const cv = document.createElement('canvas'); cv.width = 60; cv.height = 90;
    drawDesignThumb(cv, d);
    const info = document.createElement('div');
    info.className = 'load-info';
    info.innerHTML = `<div class="load-name">${d.name}</div><div class="load-sub">${st.stageCount} stg · Δv ${fmtDv(st.totalDv)} · ${fmtMass(st.totalMass)}</div>`;
    row.append(cv, info);
    row.addEventListener('click', e => {
      if (e.target.closest('.load-del')) return;
      this.open(d);
    });
    if (deletable) {
      const del = document.createElement('button');
      del.className = 'load-del'; del.textContent = '✕';
      del.addEventListener('click', () => { deleteDesign(d.name); this._toggleLoad(true); });
      row.appendChild(del);
    }
    return row;
  }

  _save() {
    if (!this.design.stack.length) { this._toast('Nothing to save yet.'); return; }
    let name = (this.design.name || '').trim();
    name = prompt('Name this rocket:', name || 'My Rocket');
    if (!name) return;
    this.design.name = name.slice(0, 28);
    this.design.tier = maxTier(this.design);
    saveDesign(this.design);
    this._toast('Saved ✓');
  }

  _flashWarn() {
    const w = $('#build-warn');
    w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake');
  }

  _toast(msg) {
    const t = $('#build-toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), 1600);
  }
}

// ---- helpers ----
function emptyDesign() { return { name: '', tier: 0, stack: [] }; }
function cloneDesign(d) { return { name: d.name, tier: d.tier || 0, stack: (d.stack || []).map(n => ({ id: n.id, radial: (n.radial || []).slice() })) }; }
function maxTier(d) { return d.stack.reduce((m, n) => Math.max(m, PARTS[n.id]?.tier || 0), 0); }

function partBlurb(p) {
  if (p.kind === 'engine' || p.kind === 'booster') return `${Math.round(p.thrust / 1000)} kN · Isp ${p.isp}`;
  if (p.kind === 'tank') return `${fmtMass(p.fuel)} fuel`;
  if (p.kind === 'command') return `crew ${p.crew || 0} · control`;
  if (p.kind === 'fin') return p.control ? 'steering' : 'stability';
  if (p.kind === 'chute') return 'recovery';
  if (p.kind === 'decoupler') return 'stage separator';
  return fmtMass(p.dryMass);
}

function sectionTitle(t) { const d = document.createElement('div'); d.className = 'load-section'; d.textContent = t; return d; }

function drawBayGrid(ctx, W, H, dpr) {
  ctx.strokeStyle = 'rgba(120,150,220,0.10)';
  ctx.lineWidth = 1;
  const step = 34 * dpr;
  for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function drawStageBrackets(ctx, lo, cx, cy, ppm) {
  const colors = ['#8fd3ff', '#ff9ec2', '#a8e6cf', '#ffd479', '#c9a8ff'];
  const byStage = new Map();
  for (const n of lo.nodes) {
    const s = n.stage;
    const top = cy + (n.top - lo.H / 2) * ppm;
    const bot = top + n.h * ppm;
    const cur = byStage.get(s) || { top: Infinity, bot: -Infinity };
    cur.top = Math.min(cur.top, top); cur.bot = Math.max(cur.bot, bot);
    byStage.set(s, cur);
  }
  const bx = cx - (lo.W / 2) * ppm - 16;
  for (const [s, rng] of byStage) {
    const c = colors[s % colors.length];
    ctx.strokeStyle = c; ctx.fillStyle = c;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bx + 6, rng.top); ctx.lineTo(bx, rng.top);
    ctx.lineTo(bx, rng.bot); ctx.lineTo(bx + 6, rng.bot);
    ctx.stroke();
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('S' + (s + 1), bx - 3, (rng.top + rng.bot) / 2 + 4);
  }
}

// Thumbnail of a single part (for the palette).
export function drawPartThumb(cv, p) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const design = p.attach === 'radial'
    ? { stack: [{ id: hostFor(p), radial: [p.id] }] }
    : { stack: [{ id: p.id, radial: [] }] };
  const lo = layout(design);
  const ppm = Math.min((cv.height * 0.8) / lo.H, (cv.width * 0.7) / lo.W);
  ctx.save();
  ctx.translate(cv.width / 2, cv.height / 2);
  drawRocket(ctx, design, { layout: lo, ppm });
  ctx.restore();
}

// pick a neutral host body so a radial part has something to sit on in the thumb
function hostFor(p) {
  if (p.tier <= 1) return 'body_alu';
  if (p.tier === 2) return 'body_m';
  return 'tank_liq_l';
}

export function drawDesignThumb(cv, design) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const lo = layout(design);
  if (!lo.nodes.length) return;
  const ppm = Math.min((cv.height * 0.9) / lo.H, (cv.width * 0.8) / lo.W);
  ctx.save();
  ctx.translate(cv.width / 2, cv.height / 2);
  drawRocket(ctx, design, { layout: lo, ppm });
  ctx.restore();
}
