import { CELL, deepCopy } from './util.js';

export const LAYERS = [
  { id: 1, name: 'Upper' },
  { id: 0, name: 'Core' },
  { id: -1, name: 'Lower' },
];

export const BUDGET_MAX = 210;
export const GRID_MIN = -4;
export const GRID_MAX = 4;

export const PARTS = {
  armorLight: {
    id: 'armorLight',
    name: 'Light Plate',
    short: 'LP',
    slot: 'core',
    role: 'Armor',
    cost: 3,
    mass: 5,
    hp: 36,
    armor: 0.04,
    shape: 'block',
    color: '#7eb3c7',
  },
  armorMedium: {
    id: 'armorMedium',
    name: 'Medium Plate',
    short: 'MP',
    slot: 'core',
    role: 'Armor',
    cost: 5,
    mass: 9,
    hp: 58,
    armor: 0.12,
    shape: 'block',
    color: '#a6b0b5',
  },
  armorHeavy: {
    id: 'armorHeavy',
    name: 'Heavy Plate',
    short: 'HP',
    slot: 'core',
    role: 'Armor',
    cost: 8,
    mass: 15,
    hp: 88,
    armor: 0.23,
    shape: 'block',
    color: '#d4c1a0',
  },
  nose: {
    id: 'nose',
    name: 'Nose Cone',
    short: 'NO',
    slot: 'core',
    role: 'Armor',
    cost: 5,
    mass: 6,
    hp: 44,
    armor: 0.08,
    shape: 'nose',
    color: '#80d0d6',
  },
  wedgeLeft: {
    id: 'wedgeLeft',
    name: 'Left Wedge',
    short: 'LW',
    slot: 'core',
    role: 'Armor',
    cost: 4,
    mass: 6,
    hp: 42,
    armor: 0.08,
    shape: 'wedgeLeft',
    color: '#8ac6d0',
  },
  wedgeRight: {
    id: 'wedgeRight',
    name: 'Right Wedge',
    short: 'RW',
    slot: 'core',
    role: 'Armor',
    cost: 4,
    mass: 6,
    hp: 42,
    armor: 0.08,
    shape: 'wedgeRight',
    color: '#8ac6d0',
  },
  reactorSmall: {
    id: 'reactorSmall',
    name: 'Ion Reactor',
    short: 'IR',
    slot: 'core',
    role: 'Reactor',
    cost: 12,
    mass: 8,
    hp: 46,
    armor: 0.04,
    thrust: 560,
    torque: 4.4,
    shape: 'reactor',
    color: '#ff8a56',
  },
  reactorLarge: {
    id: 'reactorLarge',
    name: 'Fusion Reactor',
    short: 'FR',
    slot: 'core',
    role: 'Reactor',
    cost: 20,
    mass: 16,
    hp: 68,
    armor: 0.08,
    thrust: 1040,
    torque: 6.2,
    shape: 'reactor',
    color: '#ffbd5a',
  },
  energyCell: {
    id: 'energyCell',
    name: 'Energy Cell',
    short: 'EC',
    slot: 'core',
    role: 'Energy',
    cost: 8,
    mass: 4,
    hp: 34,
    armor: 0,
    energy: 48,
    regen: 0.9,
    shape: 'cell',
    color: '#64e7bc',
  },
  cockpitLong: {
    id: 'cockpitLong',
    name: 'Long Cockpit',
    short: 'LC',
    slot: 'outer',
    role: 'Cockpit',
    cost: 12,
    mass: 8,
    hp: 74,
    armor: 0.03,
    cockpit: true,
    shape: 'cockpitLong',
    color: '#75d7ff',
  },
  cockpitRound: {
    id: 'cockpitRound',
    name: 'Spherical Cockpit',
    short: 'SC',
    slot: 'outer',
    role: 'Cockpit',
    cost: 14,
    mass: 10,
    hp: 92,
    armor: 0.07,
    cockpit: true,
    shape: 'cockpitRound',
    color: '#a8f0ff',
  },
  mitrailleuse: {
    id: 'mitrailleuse',
    name: 'Mitrailleuse',
    short: 'MG',
    slot: 'outer',
    role: 'Weapon',
    cost: 9,
    mass: 6,
    hp: 42,
    armor: 0,
    shape: 'gun',
    color: '#f7d46d',
    weapon: { kind: 'gun', trigger: 'primary', interval: 0.115, speed: 820, damage: 8, life: 0.9, spread: 0.035 },
  },
  energyBeam: {
    id: 'energyBeam',
    name: 'Energy Beam',
    short: 'EB',
    slot: 'outer',
    role: 'Weapon',
    cost: 14,
    mass: 8,
    hp: 44,
    armor: 0,
    shape: 'beam',
    color: '#aa7dff',
    weapon: { kind: 'beam', trigger: 'primary', interval: 0.09, range: 500, damage: 8, energy: 5.5 },
  },
  missileSlot: {
    id: 'missileSlot',
    name: 'Missile Slot',
    short: 'MS',
    slot: 'outer',
    role: 'Weapon',
    cost: 15,
    mass: 9,
    hp: 42,
    armor: 0,
    shape: 'missile',
    color: '#ff6b78',
    weapon: { kind: 'missile', trigger: 'secondary', interval: 1.25, speed: 330, damage: 42, life: 3.8, energy: 9 },
  },
  turret: {
    id: 'turret',
    name: 'Omni Turret',
    short: 'TR',
    slot: 'outer',
    role: 'Weapon',
    cost: 16,
    mass: 10,
    hp: 52,
    armor: 0.04,
    shape: 'turret',
    color: '#eecb87',
    weapon: { kind: 'turret', trigger: 'primary', interval: 0.22, speed: 720, damage: 7, life: 1.15 },
  },
  mineLauncher: {
    id: 'mineLauncher',
    name: 'Mine Launcher',
    short: 'ML',
    slot: 'outer',
    role: 'Weapon',
    cost: 10,
    mass: 6,
    hp: 36,
    armor: 0,
    shape: 'mine',
    color: '#59dfa5',
    weapon: { kind: 'mine', trigger: 'secondary', interval: 1.45, damage: 48, life: 9 },
  },
  flares: {
    id: 'flares',
    name: 'Flares',
    short: 'FL',
    slot: 'outer',
    role: 'Defense',
    cost: 7,
    mass: 3,
    hp: 30,
    armor: 0,
    shape: 'flare',
    color: '#ff9f5f',
    weapon: { kind: 'flare', trigger: 'utility', interval: 2.2, life: 2.7, energy: 3 },
  },
};

export const PALETTE = [
  'armorLight',
  'armorMedium',
  'armorHeavy',
  'nose',
  'wedgeLeft',
  'wedgeRight',
  'reactorSmall',
  'reactorLarge',
  'energyCell',
  'cockpitLong',
  'cockpitRound',
  'mitrailleuse',
  'energyBeam',
  'missileSlot',
  'turret',
  'mineLauncher',
  'flares',
];

export const PREMADE_BLUEPRINTS = [
  {
    name: 'Needle',
    tagline: 'Fast interceptor with missiles and a slim cockpit.',
    parts: [
      p('nose', 0, -3, 0),
      p('armorLight', -1, -2, 0), p('armorLight', 0, -2, 0), p('armorLight', 1, -2, 0),
      p('armorMedium', -1, -1, 0), p('energyCell', 0, -1, 0), p('armorMedium', 1, -1, 0),
      p('armorLight', -1, 0, 0), p('armorMedium', 0, 0, 0), p('armorLight', 1, 0, 0),
      p('reactorSmall', -1, 1, 0), p('reactorSmall', 1, 1, 0),
      p('cockpitLong', 0, -2, 1),
      p('mitrailleuse', -1, -1, 1), p('mitrailleuse', 1, -1, 1),
      p('missileSlot', 0, 0, -1), p('flares', 0, 1, -1),
    ],
  },
  {
    name: 'Bulwark',
    tagline: 'Heavy armor, turret coverage, strong shield reserves.',
    parts: [
      p('armorHeavy', 0, -3, 0),
      p('armorHeavy', -1, -2, 0), p('armorHeavy', 0, -2, 0), p('armorHeavy', 1, -2, 0),
      p('armorMedium', -2, -1, 0), p('energyCell', -1, -1, 0), p('armorHeavy', 0, -1, 0), p('energyCell', 1, -1, 0), p('armorMedium', 2, -1, 0),
      p('armorMedium', -2, 0, 0), p('armorHeavy', -1, 0, 0), p('armorHeavy', 0, 0, 0), p('armorHeavy', 1, 0, 0), p('armorMedium', 2, 0, 0),
      p('reactorLarge', -1, 1, 0), p('reactorLarge', 1, 1, 0),
      p('cockpitRound', 0, -2, 1),
      p('turret', -1, -1, 1), p('turret', 1, -1, 1),
      p('energyBeam', 0, -3, -1), p('flares', 0, 0, -1),
    ],
  },
  {
    name: 'Manta',
    tagline: 'Wide control craft with mines and overlapping guns.',
    parts: [
      p('nose', 0, -3, 0),
      p('wedgeLeft', -2, -2, 0), p('armorMedium', -1, -2, 0), p('armorMedium', 0, -2, 0), p('armorMedium', 1, -2, 0), p('wedgeRight', 2, -2, 0),
      p('armorLight', -3, -1, 0), p('energyCell', -2, -1, 0), p('armorMedium', -1, -1, 0), p('armorMedium', 0, -1, 0), p('armorMedium', 1, -1, 0), p('energyCell', 2, -1, 0), p('armorLight', 3, -1, 0),
      p('armorLight', -2, 0, 0), p('armorMedium', -1, 0, 0), p('armorMedium', 0, 0, 0), p('armorMedium', 1, 0, 0), p('armorLight', 2, 0, 0),
      p('reactorSmall', -2, 1, 0), p('reactorLarge', 0, 1, 0), p('reactorSmall', 2, 1, 0),
      p('cockpitRound', 0, -2, 1),
      p('mitrailleuse', -2, -2, 1), p('mitrailleuse', 2, -2, 1),
      p('mineLauncher', -1, 0, -1), p('mineLauncher', 1, 0, -1), p('flares', 0, -1, -1),
    ],
  },
  {
    name: 'Prism',
    tagline: 'Energy duelist with a beam spine and agile frame.',
    parts: [
      p('nose', 0, -3, 0),
      p('armorLight', -1, -2, 0), p('energyCell', 0, -2, 0), p('armorLight', 1, -2, 0),
      p('armorLight', -1, -1, 0), p('energyCell', 0, -1, 0), p('armorLight', 1, -1, 0),
      p('armorLight', -1, 0, 0), p('armorMedium', 0, 0, 0), p('armorLight', 1, 0, 0),
      p('reactorLarge', 0, 1, 0), p('reactorSmall', -1, 1, 0), p('reactorSmall', 1, 1, 0),
      p('cockpitLong', 0, -2, 1),
      p('energyBeam', 0, -3, 1), p('turret', -1, -1, -1), p('turret', 1, -1, -1),
      p('flares', 0, 0, -1),
    ],
  },
];

function p(type, x, y, layer) {
  return { type, x, y, layer };
}

export function cloneBlueprint(bp) {
  return deepCopy(bp);
}

export function partFitsLayer(type, layer) {
  const def = PARTS[type];
  if (!def) return false;
  if (def.slot === 'core') return layer === 0;
  return layer === 1 || layer === -1;
}

export function blueprintCost(bp) {
  return (bp.parts || []).reduce((sum, part) => sum + (PARTS[part.type]?.cost || 0), 0);
}

export function blueprintHasCockpit(bp) {
  return (bp.parts || []).some(part => PARTS[part.type]?.cockpit);
}

export function blueprintStats(bp) {
  const stats = {
    cost: 0,
    hp: 0,
    mass: 0,
    thrust: 0,
    torque: 0,
    energy: 70,
    regen: 8,
    weapons: 0,
    cockpits: 0,
  };
  for (const part of bp.parts || []) {
    const def = PARTS[part.type];
    if (!def) continue;
    stats.cost += def.cost;
    stats.hp += def.hp;
    stats.mass += def.mass;
    stats.thrust += def.thrust || 0;
    stats.torque += def.torque || 0;
    stats.energy += def.energy || 0;
    stats.regen += def.regen || 0;
    if (def.weapon) stats.weapons++;
    if (def.cockpit) stats.cockpits++;
  }
  stats.speed = stats.thrust / Math.max(24, stats.mass);
  stats.agility = (stats.torque + 0.8) / Math.max(18, stats.mass * 0.08);
  return stats;
}

export function validateBlueprint(bp) {
  const stats = blueprintStats(bp);
  const issues = [];
  if (!stats.cockpits) issues.push('Add a cockpit.');
  if (!stats.thrust) issues.push('Add a reactor.');
  if (!stats.weapons) issues.push('Add at least one weapon.');
  if (stats.cost > BUDGET_MAX) issues.push(`Budget ${stats.cost}/${BUDGET_MAX}.`);
  return { ok: issues.length === 0, issues, stats };
}

export function normalizeBlueprint(bp) {
  const byCell = new Map();
  for (const part of bp.parts || []) {
    if (!PARTS[part.type]) continue;
    if (part.x < GRID_MIN || part.x > GRID_MAX || part.y < GRID_MIN || part.y > GRID_MAX) continue;
    if (!partFitsLayer(part.type, part.layer)) continue;
    byCell.set(`${part.layer}:${part.x}:${part.y}`, { type: part.type, x: part.x, y: part.y, layer: part.layer });
  }
  return {
    name: bp.name || 'Custom',
    tagline: bp.tagline || 'Custom build',
    parts: [...byCell.values()].sort((a, b) => (a.layer - b.layer) || (a.y - b.y) || (a.x - b.x)),
  };
}

export function flipBlueprint(bp) {
  const next = cloneBlueprint(bp);
  for (const part of next.parts) {
    if (part.layer === 1) part.layer = -1;
    else if (part.layer === -1) part.layer = 1;
  }
  next.name = bp.name === 'Custom' ? 'Custom' : `${bp.name} Flip`;
  return normalizeBlueprint(next);
}

export function partLocalBounds(part) {
  const half = CELL * 0.48;
  return {
    x1: part.x * CELL - half,
    y1: part.y * CELL - half,
    x2: part.x * CELL + half,
    y2: part.y * CELL + half,
  };
}
