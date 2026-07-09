// Part catalog, ship designs (lego grids) and stat computation.
//
// A ship is built on stacked decks of an 11x11 grid:
//   deck 1 = mid, deck 2 = top (deck 0 = legacy bottom, still simulated).
// The mid deck holds structure (blocks) and reactors; every placed part
// also feeds the shared energy banks. The top deck holds cockpits,
// weapons and systems; every cell must sit on a mid-deck part.
//
// Design format: { name, parts: [{ id, x, y, deck, rot }] }
// rot = 0..3 quarter turns clockwise. Local "forward" is -y (grid up).

export const GRID = 11;          // grid size per deck
export const CELL = 18;          // world units per cell
export const BUDGET = 2000;      // max build cost
export const BASE_ENERGY = 100;  // hull baseline energy
export const BASE_REGEN = 8;     // baseline energy/s
export const BASE_THRUST = 40;   // thrust without any reactor (limp home)
export const ENERGY_PER_PART = 6;   // every placed block feeds the banks
export const REGEN_PER_PART = 0.5;  // and trickles a little regen

export const PARTS = {
  // ---- Structure blocks (mid deck) --------------------------------------
  block_light:  { name: 'Light hull',   kind: 'block', deck: 'mid', shape: 'square', cost: 15, mass: 1.0, hp: 50,  color: '#8fa3b8' },
  block_std:    { name: 'Std hull',     kind: 'block', deck: 'mid', shape: 'square', cost: 30, mass: 2.2, hp: 110, color: '#7c8fa6' },
  block_heavy:  { name: 'Heavy hull',   kind: 'block', deck: 'mid', shape: 'square', cost: 50, mass: 4.0, hp: 200, color: '#5f7185' },
  wedge_light:  { name: 'Light wedge',  kind: 'block', deck: 'mid', shape: 'tri',    cost: 9,  mass: 0.6, hp: 30,  color: '#8fa3b8' },
  wedge_std:    { name: 'Std wedge',    kind: 'block', deck: 'mid', shape: 'tri',    cost: 18, mass: 1.3, hp: 65,  color: '#7c8fa6' },
  wedge_heavy:  { name: 'Heavy wedge',  kind: 'block', deck: 'mid', shape: 'tri',    cost: 30, mass: 2.4, hp: 120, color: '#5f7185' },

  // ---- Systems -----------------------------------------------------------
  reactor:      { name: 'Reactor',      kind: 'reactor',  deck: 'mid',  shape: 'reactor',  cost: 70,  mass: 3.0, hp: 60, thrust: 260, color: '#c97f3d' },
  repair_bay:   { name: 'Repair droids', kind: 'droidbay', deck: 'ends', shape: 'droidbay', cost: 120, mass: 1.5, hp: 50, maxDroids: 3, repairRate: 9, color: '#5fd9c9' },

  // ---- Cockpits (top/bottom deck) ----------------------------------------
  cockpit_jet:    { name: 'Jet cockpit',    kind: 'cockpit', deck: 'ends', shape: 'jet',    cells: [[0, 0], [0, 1]], cost: 90, mass: 2.0, hp: 110, color: '#57b8ff' },
  cockpit_sphere: { name: 'Sphere cockpit', kind: 'cockpit', deck: 'ends', shape: 'sphere', cost: 70, mass: 1.5, hp: 140, color: '#57b8ff' },

  // ---- Weapons (top/bottom deck) ------------------------------------------
  machinegun: { name: 'Machine gun', kind: 'weapon', deck: 'ends', shape: 'gun', cost: 65, mass: 1.0, hp: 40, color: '#b8b19a',
    weapon: { type: 'gun', dmg: 6, rate: 8, range: 800, speed: 640, spread: 0.05 } },
  // Charge laser: hold fire to charge (drains energy), release to discharge a
  // single thick, short ray. Full damage anywhere in the first half of the
  // ray, then it fades (in light and damage) toward the tip.
  beam: { name: 'Charge laser', kind: 'weapon', deck: 'ends', shape: 'beam', cost: 130, mass: 1.5, hp: 45, color: '#e05ce0',
    weapon: { type: 'chargebeam', dmg: 150, range: 260, chargeTime: 1.8, energyPerSec: 40, minCharge: 0.2, falloff: 0.6 } },
  missile: { name: 'Missile rack', kind: 'weapon', deck: 'ends', shape: 'missile', cost: 110, mass: 1.5, hp: 45, color: '#d94f4f',
    weapon: { type: 'missile', dmg: 55, radius: 45, rate: 0.225, speed: 360, turn: 2.05, life: 5, ammo: 5 } },
  rocket: { name: 'Rocket pod', kind: 'weapon', deck: 'ends', shape: 'rocket', cost: 70, mass: 1.2, hp: 40, color: '#d98a4f',
    weapon: { type: 'rocket', dmg: 45, radius: 38, rate: 0.7, speed: 480 } },
  turret: { name: 'Auto turret', kind: 'weapon', deck: 'ends', shape: 'turret', cost: 150, mass: 2.0, hp: 55, color: '#cbd34f',
    weapon: { type: 'turret', dmg: 8, rate: 3, range: 600, speed: 560 } },
  mine_launcher: { name: 'Mine launcher', kind: 'weapon', deck: 'ends', shape: 'mine', cost: 85, mass: 1.5, hp: 45, color: '#8a6dd9',
    weapon: { type: 'mine', dmg: 70, radius: 75, rate: 0.35, maxActive: 4 } },
  flare_launcher: { name: 'Flares', kind: 'weapon', deck: 'ends', shape: 'flare', cost: 45, mass: 0.8, hp: 35, color: '#e8d56a',
    weapon: { type: 'flare', rate: 0.18, count: 3, life: 2.6 } },
};

// Palette ordering for the editor.
export const PALETTE = {
  Structure: ['block_light', 'block_std', 'block_heavy', 'wedge_light', 'wedge_std', 'wedge_heavy'],
  Systems: ['reactor', 'repair_bay'],
  Cockpits: ['cockpit_jet', 'cockpit_sphere'],
  Weapons: ['machinegun', 'beam', 'missile', 'rocket', 'turret', 'mine_launcher', 'flare_launcher'],
};

// Cell offsets of a part after rotation (default single cell).
export function partCells(def, rot = 0) {
  const base = def.cells || [[0, 0]];
  return base.map(([x, y]) => {
    let cx = x, cy = y;
    for (let i = 0; i < (rot & 3); i++) { const t = cx; cx = -cy; cy = t; }
    return [cx, cy];
  });
}

// Absolute cells occupied by a placed part.
export function placedCells(p) {
  return partCells(PARTS[p.id], p.rot || 0).map(([dx, dy]) => [p.x + dx, p.y + dy]);
}

// Local fire direction of a mounted weapon (unit vector, forward = -y).
export function fireDir(rot = 0) {
  return [[0, -1], [1, 0], [0, 1], [-1, 0]][rot & 3];
}

// ---------------------------------------------------------------------------
// Stats + validation, shared by the editor, hangar and runtime.
// ---------------------------------------------------------------------------
export function computeStats(design) {
  let cost = 0, mass = 0, hp = 0;
  let thrust = BASE_THRUST, energyMax = BASE_ENERGY, energyRegen = BASE_REGEN;
  let cockpits = 0;
  const weapons = [];
  for (const p of design.parts) {
    const def = PARTS[p.id];
    if (!def) continue;
    cost += def.cost; mass += def.mass; hp += def.hp;
    energyMax += ENERGY_PER_PART; energyRegen += REGEN_PER_PART;
    if (def.kind === 'reactor') thrust += def.thrust;
    if (def.kind === 'cockpit') cockpits++;
    if (def.kind === 'weapon') weapons.push(def.weapon.type);
  }
  const accel = 11.5 * thrust / Math.max(mass, 1);
  const turnRate = clampNum(1.6 + (thrust / Math.max(mass, 1)) * 0.07, 1.8, 5.0);
  const topSpeed = accel / 0.62; // accel balances the 0.62/s linear damping
  return { cost, mass, hp, thrust, energyMax, energyRegen, cockpits, weapons, accel, turnRate, topSpeed };
}

function clampNum(v, a, b) { return v < a ? a : v > b ? b : v; }

// Validate a design. Returns { ok, errors: [string] }.
export function validateDesign(design) {
  const errors = [];
  const stats = computeStats(design);
  if (stats.cost > BUDGET) errors.push(`Over budget: ${stats.cost}/${BUDGET}`);
  if (stats.cockpits < 1) errors.push('A cockpit is required');

  const mid = new Map(); // "x,y" -> part index
  const decksEnds = { 0: new Map(), 2: new Map() };
  design.parts.forEach((p, i) => {
    const def = PARTS[p.id];
    if (!def) { errors.push(`Unknown part ${p.id}`); return; }
    const cells = placedCells(p);
    const map = p.deck === 1 ? mid : decksEnds[p.deck];
    if (!map) { errors.push(`${def.name}: invalid deck`); return; }
    if (def.deck === 'mid' && p.deck !== 1) errors.push(`${def.name} must be on the mid deck`);
    if (def.deck === 'ends' && p.deck === 1) errors.push(`${def.name} must be on the top or bottom deck`);
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) errors.push(`${def.name} out of grid`);
      const key = x + ',' + y;
      if (map.has(key)) errors.push(`Overlap at ${key} (${def.name})`);
      map.set(key, i);
    }
  });

  // Top/bottom parts need mid support under every cell.
  for (const deck of [0, 2]) {
    for (const [key] of decksEnds[deck]) {
      if (!mid.has(key)) {
        const i = decksEnds[deck].get(key);
        errors.push(`${PARTS[design.parts[i].id].name} has no hull under it`);
        break;
      }
    }
  }

  // Mid deck must be one connected component.
  if (mid.size) {
    const start = mid.keys().next().value;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const [x, y] = stack.pop().split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (x + dx) + ',' + (y + dy);
        if (mid.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    if (seen.size < mid.size) errors.push('Hull is not fully connected');
  } else if (design.parts.length) {
    errors.push('Ship needs mid-deck hull');
  }

  return { ok: errors.length === 0, errors, stats };
}

// ---------------------------------------------------------------------------
// Premade ships.
// ---------------------------------------------------------------------------
const P = (id, x, y, deck, rot = 0) => ({ id, x, y, deck, rot });

// Wedge rotation cheat-sheet (which edges are solid): rot 0 = left+bottom
// (front-right corner), rot 1 = left+top (back-right), rot 2 = right+top
// (back-left), rot 3 = right+bottom (front-left).
export const PREMADE_SHIPS = [
  {
    name: 'Dart',
    tagline: 'Twin-tail arrow — fast, swept wings, paper hull.',
    parts: [
      // mid deck: arrowhead with swept wings and a split twin tail
      P('block_light', 5, 2, 1),
      P('wedge_light', 4, 3, 1, 3), P('block_light', 5, 3, 1), P('wedge_light', 6, 3, 1, 0),
      P('wedge_light', 3, 4, 1, 3), P('block_light', 4, 4, 1), P('block_light', 5, 4, 1), P('block_light', 6, 4, 1), P('wedge_light', 7, 4, 1, 0),
      P('block_light', 4, 5, 1), P('block_light', 5, 5, 1), P('block_light', 6, 5, 1),
      P('reactor', 4, 6, 1), P('reactor', 6, 6, 1),
      // top deck
      P('cockpit_jet', 5, 2, 2),
      P('machinegun', 4, 4, 2), P('machinegun', 6, 4, 2),
      P('flare_launcher', 5, 5, 2),
    ],
  },
  {
    name: 'Vanguard',
    tagline: 'Twin-prow cruiser — charge laser, guns, missiles.',
    parts: [
      // mid deck: pointed twin prow, wing stubs
      P('wedge_std', 4, 2, 1, 3), P('block_std', 5, 2, 1), P('wedge_std', 6, 2, 1, 0),
      P('block_std', 4, 3, 1), P('block_std', 5, 3, 1), P('block_std', 6, 3, 1),
      P('wedge_light', 3, 4, 1, 3), P('block_std', 4, 4, 1), P('block_std', 5, 4, 1), P('block_std', 6, 4, 1), P('wedge_light', 7, 4, 1, 0),
      P('block_std', 4, 5, 1), P('block_std', 5, 5, 1), P('block_std', 6, 5, 1),
      P('reactor', 4, 6, 1), P('reactor', 6, 6, 1),
      // top deck
      P('beam', 5, 2, 2),
      P('cockpit_sphere', 5, 3, 2),
      P('machinegun', 4, 4, 2), P('missile', 5, 4, 2), P('machinegun', 6, 4, 2),
    ],
  },
  {
    name: 'Bastion',
    tagline: 'Wide-bow tank — twin auto turrets behind heavy plate.',
    parts: [
      // mid deck: broad chamfered slab
      P('wedge_heavy', 4, 3, 1, 3), P('block_heavy', 5, 3, 1), P('wedge_heavy', 6, 3, 1, 0),
      P('block_std', 3, 4, 1), P('block_heavy', 4, 4, 1), P('block_heavy', 5, 4, 1), P('block_heavy', 6, 4, 1), P('block_std', 7, 4, 1),
      P('wedge_std', 3, 5, 1, 2), P('block_std', 4, 5, 1), P('block_std', 5, 5, 1), P('block_std', 6, 5, 1), P('wedge_std', 7, 5, 1, 1),
      P('reactor', 4, 6, 1), P('reactor', 6, 6, 1),
      // top deck
      P('cockpit_sphere', 5, 4, 2),
      P('turret', 4, 4, 2), P('turret', 6, 4, 2),
      P('repair_bay', 5, 5, 2),
    ],
  },
  {
    name: 'Reaper',
    tagline: 'Catamaran missile boat — twin hulls, saturation fire.',
    parts: [
      // mid deck: two hulls joined by a rear bridge
      P('wedge_light', 3, 2, 1, 3), P('block_light', 4, 2, 1), P('block_light', 6, 2, 1), P('wedge_light', 7, 2, 1, 0),
      P('block_light', 3, 3, 1), P('block_std', 4, 3, 1), P('block_std', 6, 3, 1), P('block_light', 7, 3, 1),
      P('block_light', 3, 4, 1), P('block_std', 4, 4, 1), P('block_std', 5, 4, 1), P('block_std', 6, 4, 1), P('block_light', 7, 4, 1),
      P('block_std', 4, 5, 1), P('block_std', 5, 5, 1), P('block_std', 6, 5, 1),
      P('reactor', 4, 6, 1), P('block_light', 5, 6, 1), P('reactor', 6, 6, 1),
      // top deck
      P('cockpit_jet', 5, 4, 2),
      P('missile', 3, 3, 2), P('missile', 7, 3, 2),
      P('rocket', 4, 4, 2),
      P('flare_launcher', 5, 6, 2),
    ],
  },
];
