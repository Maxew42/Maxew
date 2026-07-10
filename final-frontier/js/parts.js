// Final Frontier — part catalogue + rocket stats (stages, delta-v, TWR).
// Pure logic, importable headless.

import { G0, PLANET } from './constants.js';

// Part fields:
//  id, tier, type, name, blurb, mass (dry kg), w/h (meters, for art & drag)
//  engine: { thrust N, isp s, throttle bool, gimbal deg, prop kg (solid/water: built-in) }
//  tank:   { prop kg }
//  chute:  { area m2, maxDeploy m/s (faster -> rips) }
//  fins:   { stability, control }         control -> steerable in atmosphere
//  guidance:{ torque, sas }               reaction wheel + instruments (map, Ap/Pe)
//  capsule:{ crew }  + guidance fields
//  legs:   { soft m/s }                   safe touchdown speed bonus
//  streamline: drag Cd if this part is on top (cones/fairings/capsules)
//  art:    { style, body, accent }        for the painters

export const PARTS = [
  // ---------- TIER 0 · Backyard (water pressure) ----------
  {
    id: 'cone-paper', tier: 0, type: 'cone', name: 'Paper Cone',
    blurb: 'School glue and hope. Cuts the air surprisingly well.',
    mass: 0.02, w: 0.09, h: 0.14, streamline: 0.42,
    art: { style: 'cone', body: '#f6d365', accent: '#e8a33d' },
  },
  {
    id: 'cone-egg', tier: 0, type: 'cone', name: 'Egg Capsule Cone',
    blurb: 'Room for one (1) brave egg. Slightly heavier, very aerodynamic.',
    mass: 0.06, w: 0.10, h: 0.18, streamline: 0.36,
    art: { style: 'cone-round', body: '#fdf3e3', accent: '#f4a26b' },
  },
  {
    id: 'bottle-s', tier: 0, type: 'engine', name: 'Fizzy 0.5L',
    blurb: 'A soda bottle, a bike pump, 6 bars of ambition.',
    mass: 0.10, w: 0.09, h: 0.28,
    engine: { thrust: 110, isp: 12, throttle: false, gimbal: 0, prop: 0.40, water: true },
    art: { style: 'bottle', body: '#bfe8f7', accent: '#63b3d1' },
  },
  {
    id: 'bottle-l', tier: 0, type: 'engine', name: 'Mega Fizz 1.5L',
    blurb: 'The big bottle. Neighbors WILL notice.',
    mass: 0.22, w: 0.11, h: 0.40,
    engine: { thrust: 210, isp: 14, throttle: false, gimbal: 0, prop: 1.05, water: true },
    art: { style: 'bottle', body: '#c9f0e4', accent: '#5fc9a8' },
  },
  {
    id: 'fins-cardboard', tier: 0, type: 'fins', name: 'Cardboard Fins',
    blurb: 'Cereal-box tech. Keeps the pointy end up.',
    mass: 0.04, w: 0.22, h: 0.12,
    fins: { stability: 1.0, control: 0 },
    art: { style: 'fins', body: '#d9a066', accent: '#b07a45' },
  },
  {
    id: 'fins-balsa', tier: 0, type: 'fins', name: 'Balsa Fins',
    blurb: 'Feather-light hobby wood, lovingly sanded.',
    mass: 0.02, w: 0.20, h: 0.12,
    fins: { stability: 1.2, control: 0 },
    art: { style: 'fins', body: '#f3dcb2', accent: '#cfa76a' },
  },
  {
    id: 'streamer', tier: 0, type: 'chute', name: 'Party Streamer',
    blurb: 'Crepe paper ribbon. Flutters your rocket down-ish.',
    mass: 0.02, w: 0.09, h: 0.08,
    chute: { area: 0.06, maxDeploy: 80 },
    art: { style: 'chute', body: '#ffb3c6', accent: '#f76f8e' },
  },

  // ---------- TIER 1 · Student Club (solid motors) ----------
  {
    id: 'cone-plastic', tier: 1, type: 'cone', name: 'Plastic Nose Cone',
    blurb: 'Injection-molded. Smells like a new toy.',
    mass: 0.05, w: 0.10, h: 0.20, streamline: 0.34,
    art: { style: 'cone', body: '#ff8fa3', accent: '#e15b74' },
  },
  {
    id: 'chute-1', tier: 1, type: 'chute', name: 'Parachute Mk1',
    blurb: 'Rip-stop nylon. Deploy below 120 m/s or it shreds.',
    mass: 0.06, w: 0.10, h: 0.10,
    chute: { area: 0.28, maxDeploy: 120 },
    art: { style: 'chute', body: '#ffd166', accent: '#ef8354' },
  },
  {
    id: 'motor-a', tier: 1, type: 'engine', name: '“Acorn” A-motor',
    blurb: 'A polite little solid motor. One push, no take-backs.',
    mass: 0.08, w: 0.08, h: 0.22,
    engine: { thrust: 60, isp: 80, throttle: false, gimbal: 0, prop: 0.10 },
    art: { style: 'solid', body: '#c9b29b', accent: '#8d6e56' },
  },
  {
    id: 'motor-c', tier: 1, type: 'engine', name: '“Chestnut” C-motor',
    blurb: 'The club favorite. Loud enough to feel important.',
    mass: 0.18, w: 0.10, h: 0.30,
    engine: { thrust: 150, isp: 95, throttle: false, gimbal: 0, prop: 0.45 },
    art: { style: 'solid', body: '#b8a08a', accent: '#7c5f49' },
  },
  {
    id: 'motor-e', tier: 1, type: 'engine', name: '“Mighty Oak” E-motor',
    blurb: 'Club president signature required. Shakes the bleachers.',
    mass: 0.60, w: 0.13, h: 0.42,
    engine: { thrust: 540, isp: 120, throttle: false, gimbal: 0, prop: 2.50 },
    art: { style: 'solid', body: '#a68a6d', accent: '#6b4f37' },
  },
  {
    id: 'fins-guided', tier: 1, type: 'fins', name: 'Servo Fins',
    blurb: 'Hobby servos + fins = steering! (Only where there is air.)',
    mass: 0.09, w: 0.24, h: 0.14,
    fins: { stability: 1.4, control: 1.0 },
    art: { style: 'fins-tech', body: '#9bc1bc', accent: '#4f7c8a' },
  },
  {
    id: 'body-alu', tier: 1, type: 'tank', name: 'Alu Body Tube',
    blurb: 'Empty aluminium airframe. Stretch your rocket, look pro.',
    mass: 0.12, w: 0.10, h: 0.35,
    tank: { prop: 0 },
    art: { style: 'tube', body: '#e8ecef', accent: '#aeb8c2' },
  },

  // ---------- TIER 2 · Startup (liquid fuel, avionics) ----------
  {
    id: 'cone-composite', tier: 2, type: 'cone', name: 'Composite Nose',
    blurb: 'Carbon weave. Photographs beautifully for the pitch deck.',
    mass: 2.0, w: 0.35, h: 0.7, streamline: 0.30,
    art: { style: 'cone', body: '#3d405b', accent: '#e07a5f' },
  },
  {
    id: 'avionics', tier: 2, type: 'guidance', name: '“Brainbox” Avionics',
    blurb: 'Flight computer + reaction wheel. Unlocks the map, Ap/Pe, and SAS hold.',
    mass: 3.0, w: 0.30, h: 0.18,
    guidance: { torque: 60, sas: true },
    art: { style: 'avionics', body: '#f4f1de', accent: '#3d405b' },
  },
  {
    id: 'tank-tin-s', tier: 2, type: 'tank', name: 'Tin Can S',
    blurb: '40 kg of fizzy fuel in a lovingly welded can.',
    mass: 9, w: 0.35, h: 0.9,
    tank: { prop: 40 },
    art: { style: 'tube', body: '#f4f1de', accent: '#e07a5f' },
  },
  {
    id: 'tank-tin-m', tier: 2, type: 'tank', name: 'Tin Can M',
    blurb: 'The stretched can. Founders sleep under it at night.',
    mass: 22, w: 0.35, h: 1.7,
    tank: { prop: 125 },
    art: { style: 'tube', body: '#f4f1de', accent: '#81b29a' },
  },
  {
    id: 'eng-kestrel', tier: 2, type: 'engine', name: '“Kestrel” Engine',
    blurb: 'Our first liquid engine! Throttle + 3° of gimbal steering.',
    mass: 14, w: 0.30, h: 0.45,
    engine: { thrust: 4800, isp: 150, throttle: true, gimbal: 3, prop: 0 },
    art: { style: 'liquid', body: '#adb5bd', accent: '#e07a5f' },
  },
  {
    id: 'booster-wood', tier: 2, type: 'engine', name: '“Woodpecker” Booster',
    blurb: 'Big dumb solid. Point up before lighting.', radialOk: true,
    mass: 24, w: 0.40, h: 1.4,
    engine: { thrust: 11000, isp: 115, throttle: false, gimbal: 0, prop: 120 },
    art: { style: 'solid-big', body: '#d9a066', accent: '#8d5b2e' },
  },
  {
    id: 'fins-composite', tier: 2, type: 'fins', name: 'Composite Fins',
    blurb: 'Swept carbon fins with servo tabs. Keeps big rockets honest.',
    mass: 4, w: 0.8, h: 0.55,
    fins: { stability: 1.6, control: 1.2 },
    art: { style: 'fins-tech', body: '#3d405b', accent: '#e07a5f' },
  },
  {
    id: 'chute-2', tier: 2, type: 'chute', name: 'Parachute Mk2',
    blurb: 'Startup-grade canopy. Deploy below 160 m/s.',
    mass: 6, w: 0.35, h: 0.25,
    chute: { area: 8, maxDeploy: 160 },
    art: { style: 'chute', body: '#81b29a', accent: '#3d405b' },
  },

  // ---------- TIER 3 · New Space (orbit!) ----------
  {
    id: 'fairing', tier: 3, type: 'cone', name: 'Aero Fairing',
    blurb: 'Sleek shell for your upper stage. Slippery as soap.',
    mass: 55, w: 1.5, h: 1.9, streamline: 0.26,
    art: { style: 'cone-round', body: '#ffffff', accent: '#5390d9' },
  },
  {
    id: 'probe-core', tier: 3, type: 'guidance', name: '“Pathfinder” Core',
    blurb: 'A very confident computer. Strong reaction wheels, SAS, full instruments.',
    mass: 45, w: 0.9, h: 0.5,
    guidance: { torque: 6000, sas: true },
    art: { style: 'probe', body: '#f4f1de', accent: '#5390d9' },
  },
  {
    id: 'tank-drum-m', tier: 3, type: 'tank', name: 'Steel Drum M',
    blurb: 'Flight-proven*. (*proven to be a drum full of fuel)',
    mass: 330, w: 1.4, h: 2.6,
    tank: { prop: 1100 },
    art: { style: 'tube', body: '#e9ecef', accent: '#5390d9' },
  },
  {
    id: 'tank-drum-l', tier: 3, type: 'tank', name: 'Steel Drum L',
    blurb: 'The big drum. Contains one entire Series B round.',
    mass: 950, w: 1.4, h: 5.2,
    tank: { prop: 3600 },
    art: { style: 'tube', body: '#e9ecef', accent: '#f77f00' },
  },
  {
    id: 'eng-mainstay', tier: 3, type: 'engine', name: '“Mainstay” Engine',
    blurb: 'Workhorse booster engine. 4° gimbal, deep throttle.',
    mass: 340, w: 1.2, h: 1.5,
    engine: { thrust: 125_000, isp: 150, throttle: true, gimbal: 6, prop: 0 },
    art: { style: 'liquid-big', body: '#6c757d', accent: '#f77f00' },
  },
  {
    id: 'eng-wisp', tier: 3, type: 'engine', name: '“Wisp” Vacuum Engine',
    blurb: 'Barely whispers at sea level; sings in vacuum.',
    mass: 95, w: 0.9, h: 1.1,
    engine: { thrust: 26_000, isp: 195, throttle: true, gimbal: 6, prop: 0, vac: true },
    art: { style: 'liquid', body: '#adb5bd', accent: '#5390d9' },
  },
  {
    id: 'decoupler', tier: 3, type: 'decoupler', name: '“Snap Ring” Decoupler',
    blurb: 'Springs + explosive bolts. Press space, wave goodbye.',
    mass: 28, w: 1.4, h: 0.25,
    art: { style: 'decoupler', body: '#ffd166', accent: '#3d405b' },
  },
  {
    id: 'booster-kicker', tier: 3, type: 'engine', name: '“Kicker” Booster',
    blurb: 'Strap a pair on the sides and feel the shove. Drops off when spent.',
    radialOk: true,
    mass: 300, w: 1.0, h: 6.0,
    engine: { thrust: 95_000, isp: 140, throttle: false, gimbal: 0, prop: 2200 },
    art: { style: 'solid-big', body: '#e9ecef', accent: '#f77f00' },
  },
  {
    id: 'fins-grid', tier: 3, type: 'fins', name: 'Grid Fins',
    blurb: 'Waffle-iron steering. Very orbital-class. Very photogenic.',
    mass: 90, w: 2.0, h: 0.9,
    fins: { stability: 1.5, control: 1.5 },
    art: { style: 'fins-grid', body: '#adb5bd', accent: '#f77f00' },
  },
  {
    id: 'chute-3', tier: 3, type: 'chute', name: 'Parachute Mk3',
    blurb: 'Orbital-class canopy cluster. Deploy below 220 m/s.',
    mass: 48, w: 0.9, h: 0.5,
    chute: { area: 140, maxDeploy: 220 },
    art: { style: 'chute', body: '#5390d9', accent: '#f4f1de' },
  },

  // ---------- TIER 4 · Space Agency (moon!) ----------
  {
    id: 'capsule', tier: 4, type: 'capsule', name: '“Star Robin” Capsule',
    blurb: 'Seats three brave friends. Windows included. Snacks extra.',
    mass: 950, w: 1.9, h: 1.7, streamline: 0.34,
    capsule: { crew: 3 }, guidance: { torque: 9000, sas: true },
    art: { style: 'capsule', body: '#f4f1de', accent: '#e07a5f' },
  },
  {
    id: 'chute-xl', tier: 4, type: 'chute', name: 'Parachute XL',
    blurb: 'Three canopies, agency orange. Deploy below 260 m/s.',
    mass: 130, w: 1.2, h: 0.6,
    chute: { area: 320, maxDeploy: 260 },
    art: { style: 'chute', body: '#f77f00', accent: '#f4f1de' },
  },
  {
    id: 'tank-behemoth', tier: 4, type: 'tank', name: '“Behemoth” Tank XL',
    blurb: 'You can hear the fuel echo in there.',
    mass: 1450, w: 2.4, h: 7.5,
    tank: { prop: 5600 },
    art: { style: 'tube', body: '#ffffff', accent: '#e63946' },
  },
  {
    id: 'eng-titan', tier: 4, type: 'engine', name: '“Titan” Engine',
    blurb: 'National-anthem levels of thrust. 5° gimbal.',
    mass: 1900, w: 2.2, h: 2.4,
    engine: { thrust: 520_000, isp: 165, throttle: true, gimbal: 7, prop: 0 },
    art: { style: 'liquid-big', body: '#495057', accent: '#e63946' },
  },
  {
    id: 'eng-glowworm', tier: 4, type: 'engine', name: '“Glowworm” Nuclear',
    blurb: 'Gentle green glow, tremendous efficiency. Vacuum only, really.',
    mass: 800, w: 1.4, h: 1.9,
    engine: { thrust: 62_000, isp: 340, throttle: true, gimbal: 4, prop: 0, vac: true },
    art: { style: 'nuclear', body: '#6c757d', accent: '#80ed99' },
  },
  {
    id: 'booster-anvil', tier: 4, type: 'engine', name: '“Anvil” Booster',
    blurb: 'The pad shakes. The county shakes. Ideal in side pairs.',
    radialOk: true,
    mass: 900, w: 1.6, h: 9.0,
    engine: { thrust: 320_000, isp: 150, throttle: false, gimbal: 0, prop: 7000 },
    art: { style: 'solid-big', body: '#495057', accent: '#e63946' },
  },
  {
    id: 'decoupler-hd', tier: 4, type: 'decoupler', name: 'Heavy Decoupler',
    blurb: 'For separations you can feel in your teeth.',
    mass: 130, w: 2.4, h: 0.35,
    art: { style: 'decoupler', body: '#e63946', accent: '#f4f1de' },
  },
  {
    id: 'legs', tier: 4, type: 'legs', name: 'Lander Legs',
    blurb: 'Springy legs for touching other worlds. Touch down under 12 m/s.',
    mass: 220, w: 2.0, h: 0.6,
    legs: { soft: 12 },
    art: { style: 'legs', body: '#adb5bd', accent: '#f77f00' },
  },
];

export const PART_BY_ID = Object.fromEntries(PARTS.map(p => [p.id, p]));

// ---------------- Rocket assembly & stats ----------------

// A rocket design is an array of stack entries, TOP first (nose ... engine).
// An entry is a part id, or "R:<id>" — a symmetric SIDE-BOOSTER PAIR (x2 of the
// part, strapped beside the stage it sits in, auto-jettisoned when spent).
// Stages split at decouplers, numbered from the bottom (stage 0 fires first).

export function parseEntry(e) {
  return e.startsWith('R:') ? { id: e.slice(2), radial: true } : { id: e, radial: false };
}
export function entryPart(e) { return PART_BY_ID[parseEntry(e).id]; }

// -> bottom-up stages of {p, radial, mult}
export function splitStages(entries) {
  const stages = [];
  let cur = [];
  for (const e of entries) {
    const { id, radial } = parseEntry(e);
    const p = PART_BY_ID[id];
    if (p.type === 'decoupler' && !radial) {
      stages.push(cur); // everything above this decoupler
      cur = [];
    } else {
      cur.push({ p, radial, mult: radial ? 2 : 1 });
    }
  }
  stages.push(cur);
  // stages[] is top->bottom; reverse so stage 0 = bottom
  return stages.reverse();
}

export function partMassWet(p) {
  return p.mass + (p.tank?.prop ?? 0) + (p.engine?.prop ?? 0);
}

// Aggregate stats for the builder panel + sim setup.
export function rocketStats(entries) {
  const ents = entries.map(e => ({ ...parseEntry(e), p: entryPart(e) }));
  const parts = ents.map(x => x.p);
  const stages = splitStages(entries);
  const totalWet = ents.reduce((m, x) => m + partMassWet(x.p) * (x.radial ? 2 : 1), 0);
  const height = ents.reduce((h, x) => h + (x.p.type === 'fins' || x.radial ? 0 : x.p.h), 0);
  const maxW = Math.max(0.05, ...ents.map(x => (x.p.type === 'fins' || x.radial ? x.p.w * 0.45 : x.p.w)));

  // per-stage: delta-v & TWR, accounting for mass above
  const stageStats = [];
  const topDown = [...stages].reverse(); // top stage first
  const decouplerMasses = decouplersBottomUp(entries).reverse(); // aligned with gaps between topDown stages
  let carried = 0;
  for (let i = 0; i < topDown.length; i++) {
    const stageEnts = topDown[i];
    const wet = stageEnts.reduce((m, x) => m + partMassWet(x.p) * x.mult, 0);
    const dry = stageEnts.reduce((m, x) => m + x.p.mass * x.mult, 0);
    const engines = stageEnts.filter(x => x.p.engine && x.p.engine.thrust > 0);
    const thrust = engines.reduce((t, x) => t + x.p.engine.thrust * x.mult, 0);
    const isp = thrust > 0
      ? thrust / engines.reduce((s, x) => s + (x.p.engine.thrust * x.mult) / x.p.engine.isp, 0)
      : 0;
    const decMass = i < topDown.length - 1 ? decouplerMasses[i] ?? 0 : 0;
    const m0 = carried + wet + decMass;
    const m1 = carried + dry + decMass;
    stageStats.push({
      parts: stageEnts.map(x => x.p), engines,
      hasBoosters: stageEnts.some(x => x.radial),
      wet, dry, m0, m1, thrust, isp,
      deltaV: thrust > 0 && m1 > 0 ? isp * G0 * Math.log(m0 / m1) : 0,
      twr: thrust > 0 ? thrust / (m0 * G0) : 0,
      burnTime: thrust > 0 ? propOfStage(stageEnts) * isp * G0 / thrust : 0,
    });
    carried = m0; // everything incl this stage rides on the one below
  }
  stageStats.reverse(); // stage 0 = bottom = first fired

  const warnings = [];
  const hasEngineBottom = stages[0].some(x => x.p.engine);
  const hasFins = parts.some(p => p.fins);
  const hasChute = parts.some(p => p.chute);
  const hasGuidance = parts.some(p => p.guidance);
  if (parts.length === 0) warnings.push({ level: 'err', msg: 'Add some parts!' });
  if (parts.length && !parts.some(p => p.engine)) warnings.push({ level: 'err', msg: 'No engine — it will sit there looking pretty.' });
  if (parts.some(p => p.engine) && !hasEngineBottom) warnings.push({ level: 'warn', msg: 'No engine in the bottom stage — stage 1 has nothing to fire.' });
  if (stageStats[0] && stageStats[0].twr > 0 && stageStats[0].twr < 1.02) warnings.push({ level: 'err', msg: `TWR ${stageStats[0].twr.toFixed(2)} — too heavy to lift off.` });
  if (stageStats[0] && stageStats[0].twr > 7 && totalWet > 5) warnings.push({ level: 'warn', msg: 'Very high TWR — it will slam into a wall of air. Add fuel or ease off.' });
  if (!hasFins && !hasGuidance && parts.some(p => p.engine)) warnings.push({ level: 'warn', msg: 'No fins or guidance — expect enthusiastic tumbling.' });
  if (!hasChute && parts.length) warnings.push({ level: 'info', msg: 'No parachute — landing will be… decisive.' });
  for (let i = 1; i < stageStats.length; i++) {
    if (!stageStats[i].engines.length && stageStats[i].parts.length) {
      const isLast = i === stageStats.length - 1;
      if (!isLast || !stageStats[i].parts.some(p => p.chute || p.capsule)) {
        warnings.push({ level: 'info', msg: `Stage ${i + 1} has no engine (fine if it is just a payload).` });
      }
    }
  }

  const totalDeltaV = stageStats.reduce((s, st) => s + st.deltaV, 0);
  return { parts, stages, stageStats, totalWet, totalDeltaV, height, maxW, warnings, hasGuidance, hasChute, hasFins };
}

function propOfStage(stageEnts) {
  return stageEnts.reduce((s, x) => s + ((x.p.tank?.prop ?? 0) + (x.p.engine?.prop ?? 0)) * x.mult, 0);
}

function decouplersBottomUp(entries) {
  return entries.filter(e => !parseEntry(e).radial && entryPart(e).type === 'decoupler')
    .map(e => entryPart(e).mass).reverse();
}

// Drag model inputs for the sim. Takes {p, radial?} entries (or bare parts).
export function dragProfile(ents) {
  const xs = ents.map(x => (x.p ? x : { p: x, radial: false }));
  const top = xs.find(x => !x.radial && x.p.type !== 'fins' && x.p.type !== 'chute')?.p ?? xs[0]?.p;
  const maxW = Math.max(0.05, ...xs.map(x => (x.p.type === 'fins' || x.radial ? x.p.w * 0.45 : x.p.w)));
  const cd = top?.streamline ?? 0.75;
  const finArea = xs.filter(x => x.p.fins).reduce((s, x) => s + x.p.w * x.p.h * 0.035, 0);
  // strapped-on booster pairs add their own frontal area
  const boosterArea = xs.filter(x => x.radial).reduce((s, x) => s + 2 * Math.PI * (x.p.w / 2) ** 2 * 0.9, 0);
  return { cd, area: Math.PI * (maxW / 2) ** 2 + finArea + boosterArea };
}
