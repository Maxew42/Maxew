// Ship builder: grid editor over the three decks with palette, stats and validation.
import { PARTS, PALETTE, GRID, CELL, BUDGET, partCells, placedCells, computeStats, validateDesign, PREMADE_SHIPS } from './parts.js';
import { drawPartShape, nextRenderFrame } from './ship.js';

const DECK_NAMES = ['Bottom', 'Mid', 'Top'];

export class Editor {
  constructor(root, { onTest, onBack } = {}) {
    this.root = root;
    this.onTest = onTest;
    this.onBack = onBack;
    this.canvas = root.querySelector('#editor-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.design = { name: 'Custom ship', parts: [] };
    this.deck = 1;
    this.selected = 'block_std';
    this.rot = 0;
    this.erase = false;
    this.hover = null;
    this.running = false;

    this.buildPalette();
    this.bindUI();
    this.bindCanvas();
  }

  open(design) {
    if (design) this.design = JSON.parse(JSON.stringify(design));
    this.root.querySelector('#ship-name').value = this.design.name || 'Custom ship';
    this.running = true;
    this.refresh();
    const tick = () => {
      if (!this.running) return;
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  close() { this.running = false; }

  // ---- UI ------------------------------------------------------------------
  buildPalette() {
    const pal = this.root.querySelector('#palette');
    pal.innerHTML = '';
    for (const [cat, ids] of Object.entries(PALETTE)) {
      const h = document.createElement('div');
      h.className = 'pal-cat';
      h.textContent = cat;
      pal.appendChild(h);
      for (const id of ids) {
        const def = PARTS[id];
        const btn = document.createElement('button');
        btn.className = 'pal-item';
        btn.dataset.id = id;
        btn.innerHTML = `<span class="pal-swatch" style="background:${def.color}"></span>
          <span class="pal-name">${def.name}</span><span class="pal-cost">${def.cost}</span>`;
        btn.title = `${def.name} — cost ${def.cost}, mass ${def.mass}, HP ${def.hp}` +
          (def.deck === 'mid' ? ' (mid deck)' : ' (top/bottom deck)');
        btn.addEventListener('click', () => {
          this.selected = id;
          this.erase = false;
          // Jump to a legal deck for this part.
          if (def.deck === 'mid') this.setDeck(1);
          else if (this.deck === 1) this.setDeck(2);
          this.refresh();
        });
        pal.appendChild(btn);
      }
    }
  }

  bindUI() {
    const $ = sel => this.root.querySelector(sel);
    for (const tab of this.root.querySelectorAll('.deck-tab')) {
      tab.addEventListener('click', () => this.setDeck(+tab.dataset.deck));
    }
    $('#btn-rotate').addEventListener('click', () => { this.rot = (this.rot + 1) & 3; this.refresh(); });
    $('#btn-erase').addEventListener('click', () => { this.erase = !this.erase; this.refresh(); });
    $('#btn-flip').addEventListener('click', () => this.flipDecks());
    $('#btn-clear').addEventListener('click', () => { this.design.parts = []; this.refresh(); });
    $('#btn-editor-back').addEventListener('click', () => { this.close(); this.onBack && this.onBack(); });
    $('#btn-save').addEventListener('click', () => this.save());
    $('#btn-test').addEventListener('click', () => {
      const v = validateDesign(this.design);
      if (!v.ok) return;
      this.design.name = $('#ship-name').value.trim() || 'Custom ship';
      this.save();
      this.close();
      this.onTest && this.onTest(JSON.parse(JSON.stringify(this.design)));
    });
    $('#ship-name').addEventListener('input', e => { this.design.name = e.target.value; });
    $('#load-premade').addEventListener('change', e => {
      const idx = +e.target.value;
      if (idx >= 0) {
        this.design = JSON.parse(JSON.stringify(PREMADE_SHIPS[idx]));
        this.design.name += ' (mod)';
        $('#ship-name').value = this.design.name;
        this.refresh();
      }
      e.target.value = '-1';
    });
    addEventListener('keydown', e => {
      if (!this.running) return;
      if (e.code === 'KeyR') { this.rot = (this.rot + 1) & 3; this.refresh(); }
    });

    const sel = $('#load-premade');
    sel.innerHTML = '<option value="-1">Load premade…</option>' +
      PREMADE_SHIPS.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
  }

  setDeck(d) {
    this.deck = d;
    for (const tab of this.root.querySelectorAll('.deck-tab')) {
      tab.classList.toggle('on', +tab.dataset.deck === d);
    }
    this.refresh();
  }

  flipDecks() {
    for (const p of this.design.parts) {
      if (p.deck === 0) p.deck = 2;
      else if (p.deck === 2) p.deck = 0;
    }
    if (this.deck !== 1) this.setDeck(this.deck === 0 ? 2 : 0);
    this.refresh();
  }

  save() {
    const name = this.root.querySelector('#ship-name').value.trim() || 'Custom ship';
    this.design.name = name;
    const saved = loadSavedShips();
    const i = saved.findIndex(s => s.name === name);
    if (i >= 0) saved[i] = this.design; else saved.push(this.design);
    localStorage.setItem('warp2-ships', JSON.stringify(saved));
    const btn = this.root.querySelector('#btn-save');
    btn.textContent = 'Saved ✓';
    setTimeout(() => (btn.textContent = 'Save'), 1200);
  }

  // ---- placement -------------------------------------------------------------
  cellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const cell = size / GRID;
    const ox = (rect.width - size) / 2, oy = (rect.height - size) / 2;
    const x = Math.floor((e.clientX - rect.left - ox) / cell);
    const y = Math.floor((e.clientY - rect.top - oy) / cell);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
    return [x, y];
  }

  bindCanvas() {
    this.canvas.addEventListener('pointermove', e => {
      this.hover = this.cellFromEvent(e);
    });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; });
    this.canvas.addEventListener('pointerdown', e => {
      const cell = this.cellFromEvent(e);
      if (!cell) return;
      if (e.button === 2 || this.erase) this.removeAt(cell);
      else this.placeAt(cell);
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  partAt(x, y, deck) {
    return this.design.parts.find(p =>
      p.deck === deck && placedCells(p).some(([cx, cy]) => cx === x && cy === y));
  }

  canPlace(x, y) {
    const def = PARTS[this.selected];
    if (!def) return false;
    if (def.deck === 'mid' && this.deck !== 1) return false;
    if (def.deck === 'ends' && this.deck === 1) return false;
    const stats = computeStats(this.design);
    if (stats.cost + def.cost > BUDGET) return false;
    const cells = partCells(def, this.rot).map(([dx, dy]) => [x + dx, y + dy]);
    for (const [cx, cy] of cells) {
      if (cx < 0 || cy < 0 || cx >= GRID || cy >= GRID) return false;
      if (this.partAt(cx, cy, this.deck)) return false;
      // Top/bottom parts need mid support.
      if (this.deck !== 1 && !this.partAt(cx, cy, 1)) return false;
    }
    return true;
  }

  placeAt([x, y]) {
    if (!this.canPlace(x, y)) return;
    this.design.parts.push({ id: this.selected, x, y, deck: this.deck, rot: this.rot });
    this.refresh();
  }

  removeAt([x, y]) {
    const p = this.partAt(x, y, this.deck);
    if (!p) return;
    this.design.parts = this.design.parts.filter(q => q !== p);
    // Removing a mid part drops unsupported top/bottom parts on those cells.
    if (p.deck === 1) {
      const gone = new Set(placedCells(p).map(([cx, cy]) => cx + ',' + cy));
      this.design.parts = this.design.parts.filter(q => {
        if (q.deck === 1) return true;
        return !placedCells(q).some(([cx, cy]) => gone.has(cx + ',' + cy));
      });
    }
    this.refresh();
  }

  // ---- stats / validation ------------------------------------------------------
  refresh() {
    const v = validateDesign(this.design);
    const s = v.stats;
    const $ = sel => this.root.querySelector(sel);
    $('#stat-budget').textContent = `${s.cost} / ${BUDGET}`;
    $('#stat-budget').style.color = s.cost > BUDGET ? '#ff7a7a' : '';
    $('#budget-fill').style.width = Math.min(100, s.cost / BUDGET * 100) + '%';
    $('#budget-fill').classList.toggle('over', s.cost > BUDGET);
    $('#stat-mass').textContent = s.mass.toFixed(1);
    $('#stat-hp').textContent = s.hp;
    $('#stat-thrust').textContent = s.thrust;
    $('#stat-speed').textContent = Math.round(s.topSpeed);
    $('#stat-turn').textContent = s.turnRate.toFixed(1);
    $('#stat-energy').textContent = `${s.energyMax} (+${s.energyRegen}/s)`;
    const err = $('#editor-errors');
    err.innerHTML = v.errors.slice(0, 3).map(e => `<div>⚠ ${e}</div>`).join('');
    $('#btn-test').disabled = !v.ok;
    $('#btn-test').title = v.ok ? '' : v.errors.join('\n');
    $('#btn-erase').classList.toggle('on', this.erase);
    for (const b of this.root.querySelectorAll('.pal-item')) {
      b.classList.toggle('on', !this.erase && b.dataset.id === this.selected);
    }
  }

  // ---- rendering ------------------------------------------------------------------
  render() {
    nextRenderFrame();
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const W = this.canvas.width = rect.width * devicePixelRatio;
    const H = this.canvas.height = rect.height * devicePixelRatio;
    ctx.clearRect(0, 0, W, H);

    const size = Math.min(W, H);
    const cell = size / GRID;
    const ox = (W - size) / 2, oy = (H - size) / 2;

    ctx.save();
    ctx.translate(ox, oy);

    // Grid.
    ctx.strokeStyle = 'rgba(94, 203, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
    }
    // Center guide + forward arrow.
    ctx.strokeStyle = 'rgba(94, 203, 255, 0.25)';
    ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke();
    ctx.fillStyle = 'rgba(94,203,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(size / 2, -8); ctx.lineTo(size / 2 - 7, 4); ctx.lineTo(size / 2 + 7, 4);
    ctx.closePath(); ctx.fill();

    const scale = cell / CELL;

    // Draw decks: others ghosted, current full.
    const order = this.deck === 0 ? [2, 1, 0] : this.deck === 2 ? [0, 1, 2] : [0, 2, 1];
    for (const deck of order) {
      const ghost = deck !== this.deck;
      ctx.globalAlpha = ghost ? (deck === 1 ? 0.28 : 0.15) : 1;
      for (const p of this.design.parts) {
        if (p.deck !== deck) continue;
        this.drawDesignPart(ctx, p, cell, scale);
      }
    }
    ctx.globalAlpha = 1;

    // Hover ghost.
    if (this.hover && !this.erase) {
      const [hx, hy] = this.hover;
      const def = PARTS[this.selected];
      const ok = this.canPlace(hx, hy);
      ctx.globalAlpha = 0.55;
      this.drawDesignPart(ctx, { id: this.selected, x: hx, y: hy, deck: this.deck, rot: this.rot }, cell, scale);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ok ? 'rgba(110,220,110,0.9)' : 'rgba(255,90,90,0.9)';
      ctx.lineWidth = 2;
      for (const [dx, dy] of partCells(def, this.rot)) {
        ctx.strokeRect((hx + dx) * cell + 1, (hy + dy) * cell + 1, cell - 2, cell - 2);
      }
    } else if (this.hover && this.erase) {
      const [hx, hy] = this.hover;
      ctx.strokeStyle = 'rgba(255,90,90,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx * cell + 1, hy * cell + 1, cell - 2, cell - 2);
    }

    ctx.restore();
  }

  drawDesignPart(ctx, p, cell, scale) {
    const def = PARTS[p.id];
    const fake = { uid: p.x * 31 + p.y * 7 + p.deck, id: p.id, def, rot: p.rot || 0, hp: def.hp, maxHp: def.hp, turretAngle: -Math.PI / 2 };
    for (const [x, y] of placedCells(p)) {
      ctx.save();
      ctx.translate((x + 0.5) * cell, (y + 0.5) * cell);
      ctx.scale(scale, scale);
      ctx.rotate((p.rot & 3) * Math.PI / 2);
      drawPartShape(ctx, fake, def, p.deck === 0 ? 0.6 : p.deck === 2 ? 1.1 : 1, null);
      ctx.restore();
    }
  }
}

export function loadSavedShips() {
  try { return JSON.parse(localStorage.getItem('warp2-ships')) || []; }
  catch { return []; }
}
export function deleteSavedShip(name) {
  const saved = loadSavedShips().filter(s => s.name !== name);
  localStorage.setItem('warp2-ships', JSON.stringify(saved));
}
