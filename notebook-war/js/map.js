// The office tower: a tile grid drawn like ink on notebook paper.
// Concrete (slabs, outer shell) is indestructible; interior drywall breaks
// under bullets and blasts, rainbow-six style. Desks/tables are one-way
// platforms until someone smashes them.
import { seededRandom, pick } from './util.js';

export const TILE = 24;
export const T_EMPTY = 0, T_SOLID = 1, T_WALL = 2, T_PLAT = 3;
export const WALL_HP = 45;

const FLOORS = 4, FLOOR_H = 7, W = 110;
const SKY = 8;                       // open air rows above the roof
const H = SKY + FLOORS * (FLOOR_H + 1) + 1;
const ROOF = SKY;                    // roof slab row

const slabRow = f => H - 1 - f * (FLOOR_H + 1);

const DECOR_DEFS = {
  desk:        { w: 66, h: 28, hp: 60,  plat: true },
  monitor:     { w: 20, h: 16, hp: 18 },
  chair:       { w: 22, h: 30, hp: 22 },
  plant:       { w: 24, h: 44, hp: 20 },
  copier:      { w: 40, h: 44, hp: 80 },
  watercooler: { w: 20, h: 46, hp: 28 },
  fridge:      { w: 36, h: 60, hp: 120 },
  counter:     { w: 96, h: 32, hp: 90,  plat: true },
  micro:       { w: 26, h: 18, hp: 25 },
  sink:        { w: 30, h: 36, hp: 30 },
  wc:          { w: 26, h: 34, hp: 35 },
  stall:       { w: 8,  h: 60, hp: 30 },
  table:       { w: 130, h: 30, hp: 90, plat: true },
  whiteboard:  { w: 70, h: 44, hp: 30, mount: 60 },
  rack:        { w: 30, h: 62, hp: 90 },
  sofa:        { w: 70, h: 30, hp: 70 },
  vending:     { w: 40, h: 62, hp: 110 },
  ac:          { w: 52, h: 36, hp: 90,  plat: true },
  antenna:     { w: 8,  h: 70, hp: 40 },
};

export function generateMap(seed) {
  const rng = seededRandom(seed);
  const tiles = new Uint8Array(W * H);
  const wallHp = new Float32Array(W * H);
  const idx = (c, r) => r * W + c;

  // Outer shell + parapet.
  for (let r = ROOF; r < H; r++) for (const c of [0, 1, W - 2, W - 1]) tiles[idx(c, r)] = T_SOLID;
  for (let r = ROOF - 2; r < ROOF; r++) for (const c of [0, 1, W - 2, W - 1]) tiles[idx(c, r)] = T_SOLID;

  // Slabs (floor plates) + roof.
  for (let f = 0; f < FLOORS; f++) {
    const r = slabRow(f);
    for (let c = 0; c < W; c++) tiles[idx(c, r)] = T_SOLID;
  }
  for (let c = 0; c < W; c++) tiles[idx(c, ROOF)] = T_SOLID;

  // Stairwells: slab openings become one-way plats, with a mid step per floor.
  const shafts = [{ c: 9 }, { c: 53 }, { c: 97 }];
  const SHAFT_W = 4;
  for (const s of shafts) {
    for (let f = 0; f < FLOORS; f++) {
      const ceil = slabRow(f) - FLOOR_H - 1;   // = slab above / roof
      const roofAccess = ceil === ROOF;
      if (!roofAccess || s === shafts[1]) {    // only the central shaft opens onto the roof
        for (let c = s.c; c < s.c + SHAFT_W; c++) tiles[idx(c, ceil)] = T_PLAT;
      }
      // Mid step, alternating side.
      const step = slabRow(f) - 4;
      const off = f % 2 ? 0 : 1;
      for (let c = s.c + off; c < s.c + off + 3; c++) tiles[idx(c, step)] = T_PLAT;
    }
  }
  const inShaft = c => shafts.some(s => c >= s.c - 2 && c <= s.c + SHAFT_W + 1);

  // Interior drywall walls; some have door gaps, some are full (break through!).
  const decors = [];
  let decorId = 0;
  const addDecor = (kind, x, floorFeetY, opts = {}) => {
    const def = DECOR_DEFS[kind];
    const y = opts.y != null ? opts.y : floorFeetY - def.h - (def.mount || 0);
    decors.push({
      id: decorId++, kind, x: Math.round(x), y: Math.round(y), w: def.w, h: def.h,
      hp: def.hp, maxHp: def.hp, plat: !!def.plat, broken: false, flip: rng() < 0.5,
    });
  };

  const rooms = [];
  for (let f = 0; f < FLOORS; f++) {
    const sr = slabRow(f);
    const feetY = sr * TILE;
    let prev = 2;
    const wallCols = [];
    for (let c = 4 + Math.floor(rng() * 8); c < W - 6; c += 11 + Math.floor(rng() * 7)) {
      if (inShaft(c)) continue;
      wallCols.push(c);
      const full = rng() < 0.32;
      const top = sr - FLOOR_H;
      const bottom = full ? sr - 1 : sr - 4;
      for (let r = top; r <= bottom; r++) {
        tiles[idx(c, r)] = T_WALL;
        wallHp[idx(c, r)] = WALL_HP;
      }
    }
    const bounds = [...wallCols, W - 2];
    for (const b of bounds) {
      rooms.push({ f, c0: prev, c1: b, feetY });
      prev = b + 1;
    }
  }

  // Room types: guarantee a kitchen and toilets, fill the rest.
  const pool = ['open', 'open', 'open', 'meeting', 'office', 'server', 'lounge', 'open', 'office', 'meeting'];
  for (const room of rooms) room.type = pick(pool, rng);
  const wide = rooms.filter(r => r.c1 - r.c0 > 8);
  pick(wide, rng).type = 'kitchen';
  let wcRoom = pick(wide, rng);
  if (wcRoom.type === 'kitchen') wcRoom = wide[(wide.indexOf(wcRoom) + 1) % wide.length];
  wcRoom.type = 'wc';

  // Furnish rooms.
  for (const room of rooms) {
    const x0 = (room.c0 + 0.4) * TILE, x1 = (room.c1 - 0.2) * TILE;
    const width = x1 - x0;
    const fy = room.feetY;
    const at = t => x0 + width * t;
    if (width < 3 * TILE) continue;
    switch (room.type) {
      case 'open': {
        const n = Math.max(1, Math.floor(width / 130));
        for (let i = 0; i < n; i++) {
          const dx = at((i + 0.5) / n) - 33;
          if (shafts.some(s => Math.abs(dx + 33 - (s.c + 2) * TILE) < 70)) continue;
          addDecor('desk', dx, fy);
          addDecor('monitor', dx + 20, fy - 28);
          if (rng() < 0.8) addDecor('chair', dx - 26, fy);
        }
        if (rng() < 0.5) addDecor('plant', at(0.06), fy);
        if (rng() < 0.4) addDecor('copier', at(0.92), fy);
        if (rng() < 0.4) addDecor('watercooler', at(0.03), fy);
        break;
      }
      case 'kitchen': {
        addDecor('counter', at(0.1), fy);
        addDecor('micro', at(0.1) + 30, fy - 32);
        addDecor('fridge', at(0.75), fy);
        addDecor('table', at(0.4), fy);
        if (rng() < 0.7) addDecor('chair', at(0.35), fy);
        break;
      }
      case 'wc': {
        const n = Math.min(3, Math.floor(width / 90));
        for (let i = 0; i < n; i++) {
          addDecor('wc', at(0.15 + i * 0.25), fy);
          addDecor('stall', at(0.15 + i * 0.25) + 40, fy);
        }
        addDecor('sink', at(0.88), fy);
        break;
      }
      case 'meeting': {
        addDecor('table', at(0.5) - 65, fy);
        addDecor('chair', at(0.5) - 95, fy);
        addDecor('chair', at(0.5) + 70, fy);
        addDecor('whiteboard', at(0.1), fy);
        break;
      }
      case 'office': {
        addDecor('desk', at(0.6), fy);
        addDecor('monitor', at(0.6) + 22, fy - 28);
        addDecor('chair', at(0.6) - 26, fy);
        if (rng() < 0.7) addDecor('plant', at(0.12), fy);
        if (rng() < 0.5) addDecor('sofa', at(0.25), fy);
        break;
      }
      case 'server': {
        const n = Math.min(4, Math.floor(width / 60));
        for (let i = 0; i < n; i++) addDecor('rack', at(0.2 + i * 0.2), fy);
        break;
      }
      case 'lounge': {
        addDecor('sofa', at(0.3), fy);
        if (rng() < 0.8) addDecor('vending', at(0.75), fy);
        addDecor('plant', at(0.08), fy);
        if (rng() < 0.6) addDecor('watercooler', at(0.55), fy);
        break;
      }
    }
  }

  // Rooftop props.
  const roofY = ROOF * TILE;
  addDecor('ac', 20 * TILE, roofY);
  addDecor('ac', 78 * TILE, roofY);
  addDecor('antenna', 40 * TILE, roofY);

  // Weapon / item spawn pads and player spawns.
  const weaponPads = [], itemPads = [], spawns = [];
  let padId = 0;
  const padAt = (arr, x, y) => arr.push({ id: 'p' + padId++, x: Math.round(x), y, item: null, t: 0 });
  for (let f = 0; f < FLOORS; f++) {
    const feetY = slabRow(f) * TILE;
    const roomsF = rooms.filter(r => r.f === f && r.c1 - r.c0 > 5);
    for (let i = 0; i < 2; i++) {
      const room = pick(roomsF, rng);
      padAt(weaponPads, ((room.c0 + room.c1) / 2 + (rng() * 4 - 2)) * TILE, feetY);
    }
    const ir = pick(roomsF, rng);
    padAt(itemPads, (ir.c0 + 2 + rng() * (ir.c1 - ir.c0 - 4)) * TILE, feetY);
    spawns.push({ x: (roomsF[0].c0 + 2) * TILE, y: feetY });
    spawns.push({ x: (roomsF[roomsF.length - 1].c1 - 2) * TILE, y: feetY });
    if (roomsF.length > 2) spawns.push({ x: ((roomsF[1].c0 + roomsF[1].c1) / 2) * TILE, y: feetY });
  }
  padAt(weaponPads, 60 * TILE, roofY);
  padAt(itemPads, 30 * TILE, roofY);
  spawns.push({ x: 55 * TILE, y: roofY });

  // Background coffee stains + doodles (pure decoration).
  const stains = [];
  for (let i = 0; i < 7; i++) stains.push({ x: rng() * W * TILE, y: rng() * H * TILE, r: 18 + rng() * 34 });

  const map = {
    w: W, h: H, pxw: W * TILE, pxh: H * TILE, tiles, wallHp, decors, rooms,
    weaponPads, itemPads, spawns, stains,
    shaftXs: shafts.map(s => (s.c + SHAFT_W / 2) * TILE),
    floorsFeetY: [...Array(FLOORS)].map((_, f) => slabRow(f) * TILE).concat([ROOF * TILE]),
    roofY,
    idx,
    t(c, r) {
      if (c < 0 || c >= W) return T_SOLID;
      if (r < 0) return T_EMPTY;
      if (r >= H) return T_SOLID;
      return tiles[r * W + c];
    },
    tPx(x, y) { return this.t(Math.floor(x / TILE), Math.floor(y / TILE)); },
    solidPx(x, y) { const t = this.tPx(x, y); return t === T_SOLID || t === T_WALL; },
    // Which floor's walking level is closest below y (roof counts).
    floorAt(y) {
      let best = 0, bd = 1e9;
      this.floorsFeetY.forEach((fy, i) => {
        const d = fy >= y - 4 ? fy - y : 1e8 + (y - fy);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    },
    // Bullet chews drywall. Returns destroyed tile index or -1.
    damageWallPx(x, y, dmg) {
      const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
      if (c < 0 || c >= W || r < 0 || r >= H) return -1;
      const i = r * W + c;
      if (tiles[i] !== T_WALL) return -1;
      wallHp[i] -= dmg;
      if (wallHp[i] <= 0) { tiles[i] = T_EMPTY; return i; }
      return -1;
    },
    destroyTile(i) { if (tiles[i] === T_WALL) tiles[i] = T_EMPTY; },
    // Blast vs drywall; returns destroyed tile indices.
    explode(x, y, radius) {
      const out = [];
      const c0 = Math.max(0, Math.floor((x - radius) / TILE)), c1 = Math.min(W - 1, Math.floor((x + radius) / TILE));
      const r0 = Math.max(0, Math.floor((y - radius) / TILE)), r1 = Math.min(H - 1, Math.floor((y + radius) / TILE));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * W + c;
        if (tiles[i] !== T_WALL) continue;
        const d = Math.hypot((c + 0.5) * TILE - x, (r + 0.5) * TILE - y);
        if (d > radius) continue;
        wallHp[i] -= 320 * (1 - d / (radius * 1.15));
        if (wallHp[i] <= 0) { tiles[i] = T_EMPTY; out.push(i); }
      }
      return out;
    },
  };
  return map;
}

// ---------------------------------------------------------------------------
// Rendering — everything hand-inked on notebook paper.
// ---------------------------------------------------------------------------
let hatchDark = null, hatchLight = null;

function makePatterns(ctx) {
  const mk = (fg, bg, gap, lw) => {
    const c = document.createElement('canvas');
    c.width = c.height = gap * 2;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = fg; g.lineWidth = lw;
    g.beginPath();
    for (let i = -c.width; i < c.width * 2; i += gap) {
      g.moveTo(i, -2); g.lineTo(i + c.height + 4, c.height + 2);
    }
    g.stroke();
    return ctx.createPattern(c, 'repeat');
  };
  hatchDark = mk('rgba(20,22,28,0.55)', '#4a4f58', 7, 2);
  hatchLight = mk('rgba(120,110,90,0.35)', '#e6dfca', 9, 1.4);
}

export function renderPaper(ctx, map, x0, y0, x1, y1) {
  ctx.fillStyle = '#f6f2e3';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Graph-paper grid.
  ctx.strokeStyle = 'rgba(96, 138, 190, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(x0 / TILE) * TILE; x <= x1; x += TILE) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = Math.floor(y0 / TILE) * TILE; y <= y1; y += TILE) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
  // Coffee stains.
  for (const s of map.stains) {
    if (s.x + s.r < x0 || s.x - s.r > x1 || s.y + s.r < y0 || s.y - s.r > y1) continue;
    ctx.strokeStyle = 'rgba(150, 110, 50, 0.13)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(150, 110, 50, 0.05)';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }
}

export function renderTiles(ctx, map, x0, y0, x1, y1) {
  if (!hatchDark) makePatterns(ctx);
  const c0 = Math.max(0, Math.floor(x0 / TILE)), c1 = Math.min(map.w - 1, Math.floor(x1 / TILE));
  const r0 = Math.max(0, Math.floor(y0 / TILE)), r1 = Math.min(map.h - 1, Math.floor(y1 / TILE));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = map.tiles[r * map.w + c];
      if (t === T_EMPTY) continue;
      const x = c * TILE, y = r * TILE;
      if (t === T_SOLID) {
        ctx.fillStyle = hatchDark;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = '#22252c'; ctx.lineWidth = 2;
        ctx.beginPath();
        if (map.t(c, r - 1) !== T_SOLID) { ctx.moveTo(x, y + 1); ctx.lineTo(x + TILE, y + 1); }
        if (map.t(c, r + 1) !== T_SOLID) { ctx.moveTo(x, y + TILE - 1); ctx.lineTo(x + TILE, y + TILE - 1); }
        if (map.t(c - 1, r) !== T_SOLID) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + TILE); }
        if (map.t(c + 1, r) !== T_SOLID) { ctx.moveTo(x + TILE - 1, y); ctx.lineTo(x + TILE - 1, y + TILE); }
        ctx.stroke();
      } else if (t === T_WALL) {
        ctx.fillStyle = hatchLight;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = '#8d8471'; ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        const hp = map.wallHp[r * map.w + c];
        if (hp < WALL_HP * 0.7) {
          ctx.strokeStyle = '#4c453a'; ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 3); ctx.lineTo(x + 12, y + 13); ctx.lineTo(x + 8, y + 21);
          if (hp < WALL_HP * 0.35) { ctx.moveTo(x + 19, y + 2); ctx.lineTo(x + 14, y + 12); ctx.lineTo(x + 20, y + 22); }
          ctx.stroke();
        }
      } else if (t === T_PLAT) {
        ctx.strokeStyle = '#2b2e35'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x + TILE, y + 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(43,46,53,0.4)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x + 4, y + 5); ctx.lineTo(x + TILE - 4, y + 5); ctx.stroke();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Decor drawings — quick ballpoint sketches.
// ---------------------------------------------------------------------------
const INK = '#22262e';

export function drawDecor(ctx, d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  if (d.flip) { ctx.translate(d.w, 0); ctx.scale(-1, 1); }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  const { w, h } = d;
  const dmg = 1 - d.hp / d.maxHp;
  switch (d.kind) {
    case 'desk':
      ctx.strokeRect(1, 1, w - 2, 6);
      line(ctx, 5, 7, 5, h); line(ctx, w - 5, 7, w - 5, h);
      break;
    case 'monitor':
      ctx.strokeRect(1, 1, w - 2, h - 6);
      fill(ctx, 3, 3, w - 6, h - 10, 'rgba(90,140,200,0.25)');
      line(ctx, w / 2, h - 5, w / 2, h);
      break;
    case 'chair':
      line(ctx, 3, 0, 3, h); line(ctx, 3, h * 0.55, w - 2, h * 0.55);
      line(ctx, w - 4, h * 0.55, w - 4, h); line(ctx, w / 2, h * 0.55, w / 2, h);
      break;
    case 'plant':
      ctx.strokeRect(w / 2 - 8, h - 14, 16, 14);
      curve(ctx, w / 2, h - 14, w / 2 - 10, 4); curve(ctx, w / 2, h - 14, w / 2 + 9, 2);
      curve(ctx, w / 2, h - 14, w / 2, 0);
      break;
    case 'copier':
      ctx.strokeRect(1, h * 0.3, w - 2, h * 0.7 - 1);
      ctx.strokeRect(5, h * 0.12, w - 14, h * 0.18);
      fill(ctx, 4, h * 0.45, w - 8, 6, 'rgba(90,140,200,0.2)');
      break;
    case 'watercooler':
      ctx.strokeRect(3, h * 0.35, w - 6, h * 0.65 - 1);
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.2, w / 2 - 3, h * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
      fill(ctx, 5, h * 0.06, w - 10, h * 0.26, 'rgba(90,150,210,0.25)');
      break;
    case 'fridge':
      ctx.strokeRect(1, 1, w - 2, h - 2);
      line(ctx, 1, h * 0.35, w - 1, h * 0.35);
      line(ctx, w - 7, 8, w - 7, h * 0.28); line(ctx, w - 7, h * 0.42, w - 7, h * 0.7);
      break;
    case 'counter':
      ctx.strokeRect(1, 1, w - 2, 7);
      ctx.strokeRect(4, 8, w - 8, h - 9);
      line(ctx, w * 0.35, 8, w * 0.35, h); line(ctx, w * 0.65, 8, w * 0.65, h);
      break;
    case 'micro':
      ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.strokeRect(4, 4, w * 0.6, h - 8);
      break;
    case 'sink':
      ctx.strokeRect(2, h * 0.35, w - 4, 8);
      line(ctx, w / 2, h * 0.35 + 8, w / 2, h);
      curve(ctx, w * 0.25, h * 0.35, w * 0.5, h * 0.1);
      break;
    case 'wc':
      ctx.strokeRect(2, 0, 8, h * 0.6);
      ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.62, w * 0.4, 7, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeRect(w * 0.3, h * 0.68, w * 0.5, h * 0.3);
      break;
    case 'stall':
      fill(ctx, 0, 0, w, h, 'rgba(120,130,150,0.3)');
      ctx.strokeRect(0.5, 0, w - 1, h);
      break;
    case 'table':
      ctx.strokeRect(1, 1, w - 2, 7);
      line(ctx, 10, 8, 10, h); line(ctx, w - 10, 8, w - 10, h);
      break;
    case 'whiteboard':
      fill(ctx, 0, 0, w, h, 'rgba(255,255,255,0.8)');
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      ctx.strokeStyle = 'rgba(200,60,60,0.6)'; ctx.lineWidth = 1.5;
      line(ctx, 8, 10, w - 20, 14); line(ctx, 8, 22, w - 30, 25); line(ctx, 8, 33, w - 14, 35);
      break;
    case 'rack':
      ctx.strokeRect(1, 1, w - 2, h - 2);
      for (let y = 8; y < h - 6; y += 10) {
        line(ctx, 5, y, w - 5, y);
        fill(ctx, w - 11, y + 2, 4, 4, y % 20 ? 'rgba(90,200,120,0.8)' : 'rgba(220,80,80,0.8)');
      }
      break;
    case 'sofa':
      ctx.strokeRect(1, h * 0.4, w - 2, h * 0.6 - 1);
      ctx.strokeRect(1, 0, 10, h - 2);
      line(ctx, 11, h * 0.42, w - 3, h * 0.42);
      break;
    case 'vending':
      ctx.strokeRect(1, 1, w - 2, h - 2);
      fill(ctx, 5, 6, w - 16, h * 0.55, 'rgba(90,140,200,0.2)');
      ctx.strokeRect(5, 6, w - 16, h * 0.55);
      ctx.strokeRect(6, h * 0.7, w - 12, 10);
      break;
    case 'ac':
      ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.beginPath(); ctx.arc(w * 0.35, h / 2, h * 0.3, 0, Math.PI * 2); ctx.stroke();
      line(ctx, w * 0.35 - h * 0.2, h / 2, w * 0.35 + h * 0.2, h / 2);
      line(ctx, w * 0.35, h / 2 - h * 0.2, w * 0.35, h / 2 + h * 0.2);
      line(ctx, w * 0.7, 8, w * 0.7, h - 8); line(ctx, w * 0.82, 8, w * 0.82, h - 8);
      break;
    case 'antenna':
      line(ctx, w / 2, h, w / 2, 0);
      line(ctx, w / 2, 8, w / 2 + 14, 20); line(ctx, w / 2, 8, w / 2 - 14, 20);
      ctx.beginPath(); ctx.arc(w / 2, 4, 3, 0, Math.PI * 2); ctx.stroke();
      break;
  }
  // Damage scribbles.
  if (dmg > 0.35) {
    ctx.strokeStyle = 'rgba(40,36,30,0.7)'; ctx.lineWidth = 1.4;
    line(ctx, w * 0.2, h * 0.2, w * 0.5, h * 0.55); line(ctx, w * 0.5, h * 0.55, w * 0.35, h * 0.8);
    if (dmg > 0.7) { line(ctx, w * 0.75, h * 0.15, w * 0.55, h * 0.5); line(ctx, w * 0.55, h * 0.5, w * 0.8, h * 0.85); }
  }
  ctx.restore();
}

// Broken decor collapses into a debris pile, stamped once on the gore layer.
export function drawDecorDebris(ctx, d) {
  ctx.save();
  ctx.translate(d.x + d.w / 2, d.y + d.h);
  ctx.strokeStyle = 'rgba(40, 42, 50, 0.85)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const r = Math.max(10, d.w * 0.55);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI - Math.PI, len = 4 + (i * 7919 % 13);
    const x = Math.cos(a * 0.7) * r * ((i % 3) + 1) / 3;
    ctx.beginPath();
    ctx.moveTo(x, -2 - (i % 4) * 3);
    ctx.lineTo(x + Math.cos(a) * len, -2 - (i % 4) * 3 + Math.abs(Math.sin(a)) * 5);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(40,42,50,0.5)';
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
  ctx.restore();
}

function line(ctx, a, b, c, d) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
function curve(ctx, x0, y0, x1, y1) {
  ctx.beginPath(); ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + 6, (y0 + y1) / 2, x1, y1); ctx.stroke();
}
function fill(ctx, x, y, w, h, style) { ctx.fillStyle = style; ctx.fillRect(x, y, w, h); }
