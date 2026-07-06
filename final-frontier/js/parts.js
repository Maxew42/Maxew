// Part catalogue + rocket statistics (mass, staging, delta-v, TWR).
// All physical units SI: mass kg, thrust N, isp s, sizes in metres.
import { PHYS } from './constants.js';

// kind: nose | command | tank | engine | booster | decoupler | chute | fin | body
// attach: 'stack' (in the central column) | 'radial' (strapped to a stack node, mirrored as a pair)
const P = (o) => o;

export const PARTS = {
  // ---------------- Tier 0 — Backyard (water rocket) ----------------
  nose_cork:   P({ id:'nose_cork', name:'Cork Nose', tier:0, kind:'nose', attach:'stack',
                   w:0.09, h:0.12, dryMass:0.05, col:'#d9b382', edge:'#9c7b4e' }),
  body_bottle: P({ id:'body_bottle', name:'Soda Bottle', tier:0, kind:'tank', attach:'stack',
                   w:0.12, h:0.32, dryMass:0.08, fuel:0.9, col:'#bfe9ff', edge:'#7fb8d6', translucent:true }),
  engine_water:P({ id:'engine_water', name:'Water Nozzle', tier:0, kind:'engine', attach:'stack',
                   w:0.10, h:0.08, dryMass:0.06, thrust:260, isp:11, col:'#c8d0da', edge:'#8a94a3',
                   flameW:0.10, flameCol:'#bfe9ff' }),
  fin_wood:    P({ id:'fin_wood', name:'Balsa Fins', tier:0, kind:'fin', attach:'radial',
                   w:0.10, h:0.14, dryMass:0.04, finArea:0.02, dragArea:0.01, control:0,
                   col:'#c79a63', edge:'#8a6636' }),

  // ---------------- Tier 1 — Student club ----------------
  nose_alu:    P({ id:'nose_alu', name:'Alu Nose Cone', tier:1, kind:'nose', attach:'stack',
                   w:0.5, h:0.8, dryMass:8, col:'#e3e9f2', edge:'#a9b4c4' }),
  pod_hobby:   P({ id:'pod_hobby', name:'Avionics Pod', tier:1, kind:'command', attach:'stack',
                   w:0.55, h:0.55, dryMass:22, control:120000, crew:0, col:'#ffd9a8', edge:'#c99a5c' }),
  body_alu:    P({ id:'body_alu', name:'Alu Airframe', tier:1, kind:'body', attach:'stack',
                   w:0.5, h:0.9, dryMass:12, dragArea:0.02, col:'#dfe6f0', edge:'#a9b4c4' }),
  engine_solid_s:P({ id:'engine_solid_s', name:'Estes Motor', tier:1, kind:'engine', attach:'stack',
                   w:0.5, h:1.0, dryMass:16, fuel:45, thrust:4200, isp:165, control:0,
                   col:'#c9ccd4', edge:'#8a90a0', flameW:0.4, flameCol:'#ffce6b' }),
  engine_solid_m:P({ id:'engine_solid_m', name:'Solid Motor S2', tier:1, kind:'engine', attach:'stack',
                   w:0.6, h:1.7, dryMass:42, fuel:150, thrust:8000, isp:178, control:0,
                   col:'#c9ccd4', edge:'#8a90a0', flameW:0.5, flameCol:'#ffce6b' }),
  fin_ctrl:    P({ id:'fin_ctrl', name:'Control Flaps', tier:1, kind:'fin', attach:'radial',
                   w:0.5, h:0.55, dryMass:6, finArea:0.5, dragArea:0.03, control:90000,
                   col:'#ff9ec2', edge:'#c96a92' }),
  chute_small: P({ id:'chute_small', name:'Small Chute', tier:1, kind:'chute', attach:'stack',
                   w:0.5, h:0.45, dryMass:5, chuteArea:8, deployAlt:1600, col:'#ff9ec2', edge:'#c96a92' }),
  decoupler_s: P({ id:'decoupler_s', name:'Separator S', tier:1, kind:'decoupler', attach:'stack',
                   w:0.55, h:0.2, dryMass:4, col:'#b7bec9', edge:'#7f8896' }),

  // ---------------- Tier 2 — Startup (liquid) ----------------
  nose_cone_m: P({ id:'nose_cone_m', name:'Nose Fairing', tier:2, kind:'nose', attach:'stack',
                   w:0.9, h:1.3, dryMass:25, col:'#eef3fa', edge:'#b3bdcd' }),
  probe_core:  P({ id:'probe_core', name:'Probe Core', tier:2, kind:'command', attach:'stack',
                   w:0.9, h:0.4, dryMass:16, control:190000, crew:0, col:'#a8e6cf', edge:'#5fae8f' }),
  tank_liq_s:  P({ id:'tank_liq_s', name:'Fuel Tank S', tier:2, kind:'tank', attach:'stack',
                   w:0.9, h:1.3, dryMass:30, fuel:240, col:'#f2f4f8', edge:'#b3bdcd', band:'#ff9ec2' }),
  tank_liq_m:  P({ id:'tank_liq_m', name:'Fuel Tank M', tier:2, kind:'tank', attach:'stack',
                   w:0.9, h:2.5, dryMass:65, fuel:560, col:'#f2f4f8', edge:'#b3bdcd', band:'#ff9ec2' }),
  engine_liq_s:P({ id:'engine_liq_s', name:'Sprite Engine', tier:2, kind:'engine', attach:'stack',
                   w:0.9, h:1.0, dryMass:55, thrust:12000, isp:250, control:150000,
                   col:'#c9ccd4', edge:'#8a90a0', flameW:0.7, flameCol:'#ffb46b' }),
  fin_large:   P({ id:'fin_large', name:'Aero Fins', tier:2, kind:'fin', attach:'radial',
                   w:0.6, h:0.8, dryMass:12, finArea:0.9, dragArea:0.05, control:130000,
                   col:'#8fd3ff', edge:'#4f9fd0' }),
  chute_large: P({ id:'chute_large', name:'Main Chute', tier:2, kind:'chute', attach:'stack',
                   w:0.9, h:0.5, dryMass:14, chuteArea:24, deployAlt:2600, col:'#ff9ec2', edge:'#c96a92' }),
  decoupler_m: P({ id:'decoupler_m', name:'Separator M', tier:2, kind:'decoupler', attach:'stack',
                   w:0.9, h:0.25, dryMass:12, col:'#b7bec9', edge:'#7f8896' }),
  body_m:      P({ id:'body_m', name:'Interstage', tier:2, kind:'body', attach:'stack',
                   w:0.9, h:1.0, dryMass:18, dragArea:0.02, col:'#dfe6f0', edge:'#a9b4c4' }),

  // ---------------- Tier 3 — New Space (orbital) ----------------
  nose_cone_l: P({ id:'nose_cone_l', name:'Payload Fairing', tier:3, kind:'nose', attach:'stack',
                   w:1.3, h:1.9, dryMass:45, col:'#eef3fa', edge:'#b3bdcd' }),
  probe_core_adv:P({ id:'probe_core_adv', name:'Flight Computer', tier:3, kind:'command', attach:'stack',
                   w:1.3, h:0.5, dryMass:26, control:300000, crew:0, col:'#a8e6cf', edge:'#5fae8f' }),
  tank_liq_l:  P({ id:'tank_liq_l', name:'Fuel Tank L', tier:3, kind:'tank', attach:'stack',
                   w:1.3, h:3.0, dryMass:130, fuel:1150, col:'#f2f4f8', edge:'#b3bdcd', band:'#8fd3ff' }),
  tank_liq_xl: P({ id:'tank_liq_xl', name:'Fuel Tank XL', tier:3, kind:'tank', attach:'stack',
                   w:1.3, h:5.0, dryMass:260, fuel:2400, col:'#f2f4f8', edge:'#b3bdcd', band:'#8fd3ff' }),
  engine_liq_m:P({ id:'engine_liq_m', name:'Booster Engine', tier:3, kind:'engine', attach:'stack',
                   w:1.3, h:1.6, dryMass:140, thrust:42000, isp:285, control:260000,
                   col:'#c9ccd4', edge:'#8a90a0', flameW:1.0, flameCol:'#ffb46b' }),
  engine_vac_m:P({ id:'engine_vac_m', name:'Vacuum Engine', tier:3, kind:'engine', attach:'stack',
                   w:1.1, h:1.7, dryMass:110, thrust:20000, isp:340, control:200000,
                   col:'#c9ccd4', edge:'#8a90a0', flameW:0.9, flameCol:'#9fd0ff' }),
  booster_solid:P({ id:'booster_solid', name:'Strap-on SRB', tier:3, kind:'booster', attach:'radial',
                   w:0.7, h:4.0, dryMass:70, fuel:900, thrust:40000, isp:205, control:0,
                   col:'#e7ebf1', edge:'#a9b4c4', flameW:0.5, flameCol:'#ffce6b' }),
  decoupler_l: P({ id:'decoupler_l', name:'Separator L', tier:3, kind:'decoupler', attach:'stack',
                   w:1.3, h:0.3, dryMass:22, col:'#b7bec9', edge:'#7f8896' }),
  fin_l:       P({ id:'fin_l', name:'Grid Fins', tier:3, kind:'fin', attach:'radial',
                   w:0.9, h:1.1, dryMass:20, finArea:1.3, dragArea:0.09, control:180000,
                   col:'#8fd3ff', edge:'#4f9fd0' }),
  chute_xl:    P({ id:'chute_xl', name:'Cluster Chute', tier:3, kind:'chute', attach:'stack',
                   w:1.3, h:0.6, dryMass:24, chuteArea:42, deployAlt:3000, col:'#ff9ec2', edge:'#c96a92' }),

  // ---------------- Tier 4 — National program (crewed, Moon) ----------------
  capsule_crew:P({ id:'capsule_crew', name:'Crew Capsule', tier:4, kind:'command', attach:'stack',
                   w:1.6, h:1.7, dryMass:380, control:280000, crew:3, col:'#ffe1a8', edge:'#c99a5c' }),
  heatshield:  P({ id:'heatshield', name:'Heat Shield', tier:4, kind:'body', attach:'stack',
                   w:1.7, h:0.5, dryMass:120, dragArea:0.25, col:'#c88a5c', edge:'#8a5a34' }),
  nose_cone_xl:P({ id:'nose_cone_xl', name:'Heavy Fairing', tier:4, kind:'nose', attach:'stack',
                   w:1.9, h:2.4, dryMass:70, col:'#eef3fa', edge:'#b3bdcd' }),
  tank_xxl:    P({ id:'tank_xxl', name:'Core Tank', tier:4, kind:'tank', attach:'stack',
                   w:1.9, h:6.0, dryMass:480, fuel:4800, col:'#f2f4f8', edge:'#b3bdcd', band:'#ffd479' }),
  engine_heavy:P({ id:'engine_heavy', name:'Heavy Engine', tier:4, kind:'engine', attach:'stack',
                   w:1.9, h:2.2, dryMass:420, thrust:185000, isp:300, control:360000,
                   col:'#c9ccd4', edge:'#8a90a0', flameW:1.5, flameCol:'#ffb046' }),
  engine_vac_l:P({ id:'engine_vac_l', name:'Upper Engine', tier:4, kind:'engine', attach:'stack',
                   w:1.6, h:2.4, dryMass:240, thrust:48000, isp:352, control:260000,
                   col:'#c9ccd4', edge:'#8a90a0', flameW:1.2, flameCol:'#9fd0ff' }),
  decoupler_xl:P({ id:'decoupler_xl', name:'Separator XL', tier:4, kind:'decoupler', attach:'stack',
                   w:1.9, h:0.35, dryMass:40, col:'#b7bec9', edge:'#7f8896' }),
  fin_xl:      P({ id:'fin_xl', name:'Heavy Fins', tier:4, kind:'fin', attach:'radial',
                   w:1.2, h:1.5, dryMass:34, finArea:1.9, dragArea:0.14, control:220000,
                   col:'#8fd3ff', edge:'#4f9fd0' }),
  chute_xxl:   P({ id:'chute_xxl', name:'Descent Chutes', tier:4, kind:'chute', attach:'stack',
                   w:1.9, h:0.7, dryMass:40, chuteArea:75, deployAlt:3400, col:'#ff9ec2', edge:'#c96a92' }),
};

export const part = id => PARTS[id];

// Categories used to group the editor palette.
export const CATEGORIES = [
  { key:'command', label:'Command', kinds:['command'] },
  { key:'nose',    label:'Aero',    kinds:['nose'] },
  { key:'tank',    label:'Tanks',   kinds:['tank','body'] },
  { key:'engine',  label:'Engines', kinds:['engine','booster'] },
  { key:'control', label:'Control', kinds:['fin'] },
  { key:'util',    label:'Utility', kinds:['decoupler','chute'] },
];

// ---------------------------------------------------------------------------
// Stage grouping + statistics.
// A "design" is: { name, tier, stack:[{id, radial:[id,...]}, ...] } (top -> bottom).
// Each radial entry is a *symmetric pair* (drawn both sides, counted x2).
// ---------------------------------------------------------------------------

function emptyGroup() {
  return { dry:0, fuel:0, thrust:0, mdot:0, control:0, ctrlRW:0, ctrlAero:0,
           finArea:0, dragArea:0, crew:0, chutes:[], engines:0, nodes:[] };
}

function addPartToGroup(g, p, mult) {
  g.dry += (p.dryMass || 0) * mult;
  g.fuel += (p.fuel || 0) * mult;
  g.control += (p.control || 0) * mult;
  // Fins only steer in atmosphere; command/engine gimbal works everywhere.
  if (p.kind === 'fin') g.ctrlAero += (p.control || 0) * mult;
  else g.ctrlRW += (p.control || 0) * mult;
  g.finArea += (p.finArea || 0) * mult;
  g.dragArea += (p.dragArea || 0) * mult;
  g.crew += (p.crew || 0) * mult;
  if (p.thrust) {
    g.thrust += p.thrust * mult;
    g.mdot += (p.thrust / (p.isp * PHYS.g0)) * mult; // kg/s at full throttle
    g.engines += mult;
  }
  if (p.kind === 'chute') g.chutes.push(p);
}

// Returns stage groups, bottom-first (index 0 fires first).
export function buildStages(design) {
  const stack = design.stack || [];
  const groups = [];
  let cur = emptyGroup();
  for (let i = stack.length - 1; i >= 0; i--) {   // bottom -> top
    const node = stack[i];
    const p = PARTS[node.id];
    if (!p) continue;
    addPartToGroup(cur, p, 1);
    cur.nodes.push(node);
    for (const rid of (node.radial || [])) {
      const rp = PARTS[rid];
      if (rp) addPartToGroup(cur, rp, 2);        // symmetric pair
    }
    if (p.kind === 'decoupler') { groups.push(cur); cur = emptyGroup(); }
  }
  groups.push(cur);
  return groups.filter(g => g.nodes.length);
}

// Full rocket statistics for the editor readouts + the sim.
export function computeRocketStats(design) {
  const groups = buildStages(design);
  // total mass of everything above group i (its payload), and delta-v per stage.
  let totalMass = 0;
  for (const g of groups) { g.total = g.dry + g.fuel; totalMass += g.total; }

  let upper = 0;
  let totalDv = 0, totalCrew = 0, hasCommand = false, hasEngine = false;
  const stages = [];
  // groups[0] is bottom (fires first). Payload of stage i = sum of groups above it.
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    upper = 0;
    for (let j = i + 1; j < groups.length; j++) upper += groups[j].total;
    const m0 = upper + g.dry + g.fuel;
    const m1 = upper + g.dry;
    const ve = g.mdot > 0 ? g.thrust / g.mdot : 0;
    const dv = (g.thrust > 0 && g.fuel > 0 && m1 > 0) ? ve * Math.log(m0 / m1) : 0;
    const twr = g.thrust > 0 ? g.thrust / (m0 * PHYS.g0) : 0;
    if (g.thrust > 0) hasEngine = true;
    if (g.control > 0) hasCommand = hasCommand || g.control > 0;
    totalCrew += g.crew;
    totalDv += dv;
    stages.push({
      index:i, dry:g.dry, fuel:g.fuel, thrust:g.thrust, ve, dv, twr, mdot:g.mdot,
      control:g.control, ctrlRW:g.ctrlRW, ctrlAero:g.ctrlAero,
      finArea:g.finArea, dragArea:g.dragArea, crew:g.crew,
      chutes:g.chutes, m0, m1, payload:upper,
    });
  }
  return {
    stages, totalMass, totalDv, crew: totalCrew,
    hasEngine, hasControl: stages.some(s => s.control > 0),
    liftoffTwr: stages.length ? stages[0].twr : 0,
    stageCount: stages.length,
  };
}

// Design validation warnings for the editor.
export function validateDesign(design) {
  const warn = [];
  const stack = design.stack || [];
  const stats = computeRocketStats(design);
  if (!stack.length) warn.push('Add some parts to build a rocket.');
  if (!stats.hasEngine) warn.push('No engine — this will never leave the pad.');
  if (stats.hasEngine && stats.liftoffTwr < 1) warn.push('Lift-off thrust is below weight (TWR < 1). It won\'t rise.');
  if (!stats.hasControl && stack.some(n => PARTS[n.id]?.tier > 0))
    warn.push('No control part — you won\'t be able to steer.');
  return { ok: warn.length === 0, warn, stats };
}

// ---------------------------------------------------------------------------
// Ready-made blueprints — one guaranteed-good rocket per tier.
// ---------------------------------------------------------------------------
const S = (id, ...radial) => ({ id, radial });

export const PRESETS = [
  {
    name: 'Backyard Bottle', tier: 0,
    tagline: 'Two pumps and a prayer.',
    stack: [ S('nose_cork'), S('body_bottle','fin_wood'), S('engine_water') ],
  },
  {
    name: 'Blue Streak', tier: 1,
    tagline: 'Solid motor, safe recovery.',
    stack: [ S('nose_alu'), S('chute_small'), S('pod_hobby'), S('engine_solid_m','fin_ctrl') ],
  },
  {
    name: 'Pioneer I', tier: 2,
    tagline: 'A liquid rocket that scrapes space.',
    stack: [ S('nose_cone_m'), S('probe_core'), S('chute_large'),
             S('tank_liq_s'), S('tank_liq_s'), S('engine_liq_s','fin_large') ],
  },
  {
    name: 'Orbiter One', tier: 3,
    tagline: 'Two stages to a stable orbit.',
    stack: [
      S('nose_cone_l'), S('probe_core_adv'), S('tank_liq_s'), S('engine_vac_m'),
      S('decoupler_l'),
      S('tank_liq_l'), S('engine_liq_m','fin_l'),
    ],
  },
  {
    name: 'Lunar Arrow', tier: 4,
    tagline: 'Three stages, three seats, one Moon.',
    stack: [
      S('capsule_crew'), S('heatshield'), S('chute_xxl'),
      S('tank_liq_l'), S('engine_vac_m'),
      S('decoupler_xl'),
      S('tank_liq_xl'), S('engine_vac_l'),
      S('decoupler_xl'),
      S('tank_xxl'), S('engine_heavy','fin_xl'),
    ],
  },
];
