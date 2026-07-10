// Final Frontier — headless tuning harness.
// Flies each tier's reference design with a simple autopilot and asserts goals.
// Run from final-frontier/tools/: node harness.mjs [-v]
// Re-run this after ANY rebalance of parts.js / sim.js / constants.js.

import { PLANET, MOON, G0 } from '../js/constants.js';
import { rocketStats } from '../js/parts.js';
import { Sim, railsFrom, railsState, WARP_LEVELS } from '../js/sim.js';

const VERBOSE = process.argv.includes('-v');
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
};

// ---------- rails vs numeric consistency ----------
function testRails() {
  // circular-ish orbit at 80 km
  const r = PLANET.R + 80_000;
  const v = Math.sqrt(PLANET.mu / r);
  for (const [label, vel] of [
    ['circular ccw', { x: -v, y: 0 }],
    ['elliptic cw', { x: v * 0.85, y: 0 }],
    ['hyperbolic', { x: -v * 1.6, y: 0.1 * v }],
  ]) {
    const pos = { x: 0, y: r };
    const rails = railsFrom(PLANET.mu, pos, vel, 0);
    // numeric integrate same state
    let p = { ...pos }, vv = { ...vel };
    const h = 0.05, T = 600;
    for (let t = 0; t < T; t += h) {
      const rr = Math.hypot(p.x, p.y);
      const g = -PLANET.mu / (rr * rr * rr);
      vv.x += g * p.x * h; vv.y += g * p.y * h;
      p.x += vv.x * h; p.y += vv.y * h;
    }
    const st = railsState(rails, T);
    const errP = Math.hypot(st.pos.x - p.x, st.pos.y - p.y);
    const errRel = errP / Math.hypot(p.x, p.y);
    check(`rails ${label}`, errRel < 0.01, `pos err ${errP.toFixed(0)} m (${(errRel * 100).toFixed(3)}%) after ${T}s`);
  }
}

// ---------- generic flight loop ----------
function fly(partIds, pilot, { maxT = 4000, log = false } = {}) {
  const sim = new Sim(partIds);
  const stats = rocketStats(partIds);
  sim.doStage(); // ignite
  const dt = 1 / 30;
  let lastLog = 0;
  while (!sim.dead && sim.t < maxT) {
    pilot?.(sim);
    // auto-stage on flameout if another stage exists
    for (const e of sim.drainEvents()) {
      if (e.type === 'flameout' && sim.activeStage < sim.stages.length - 1) sim.doStage();
      if (log && VERBOSE) console.log(`   [${e.t.toFixed(1)}s] ${e.msg}`);
    }
    sim.update(dt);
    if (log && VERBOSE && sim.t - lastLog > 20) {
      lastLog = sim.t;
      const o = sim.orbit();
      console.log(`   t=${sim.t.toFixed(0)}s alt=${(sim.alt() / 1000).toFixed(1)}km v=${sim.speed().toFixed(0)} ap=${(o?.apAlt / 1000).toFixed(0)}km pe=${(o?.peAlt / 1000).toFixed(0)}km warp=${sim.warp()}`);
    }
    // stop condition: apogee passed & coming down & low & no chute plans
    if (!pilot && sim.alt() < -1) break;
  }
  return { sim, stats };
}

// variant of fly() that also collects every event
function flyEv(partIds, pilot, opts) {
  const events = [];
  const sim0 = new Sim(partIds);
  const stats = rocketStats(partIds);
  sim0.doStage();
  const dt = 1 / 30;
  while (!sim0.dead && sim0.t < (opts?.maxT ?? 4000)) {
    pilot?.(sim0);
    for (const e of sim0.drainEvents()) {
      events.push(e);
      if (e.type === 'flameout' && sim0.activeStage < sim0.stages.length - 1) sim0.doStage();
    }
    sim0.update(dt);
  }
  return { sim: sim0, stats, events };
}

// simple pilots -------------------------------------------------
const pilotVertical = sim => { sim.holdTarget = null; }; // fins do the work

function makeAscentPilot({ targetAp = 64_000, turnStart = 1_200, turnEnd = 40_000, turnExp = 0.65, circTo = 52_000, moon = false }) {
  let phase = 'ascend';
  let burnStartAngDone = false;
  return sim => {
    const o = sim.orbit();
    const alt = sim.alt();
    if (phase === 'ascend') {
      const prog = Math.max(0, Math.min(1, (alt - turnStart) / (turnEnd - turnStart)));
      const desired = (Math.PI / 2) * Math.pow(prog, turnExp) * 0.98;
      // limit angle of attack while the air is thick — like a real gravity turn
      const velAng = Math.atan2(-sim.vel.x, sim.vel.y);
      const maxAoA = (3 + 30 * Math.min(1, alt / PLANET.atmoTop)) * Math.PI / 180;
      const lo = velAng - maxAoA, hi = velAng + maxAoA;
      sim.holdTarget = sim.speed() < 60 ? desired : Math.max(lo, Math.min(hi, desired));
      sim.setThrottle(1);
      if (alt > 500 && o && o.apAlt >= targetAp) { sim.setThrottle(0); phase = 'coast'; }
    } else if (phase === 'coast') {
      sim.setThrottle(0);
      // hold prograde while coasting
      sim.holdTarget = Math.atan2(-sim.vel.x, sim.vel.y);
      if (alt > PLANET.atmoTop + 2000) sim.setWarp(4); // rails
      if (o?.tToAp != null && o.tToAp < 12) { sim.setWarp(0); phase = 'circ'; }
    } else if (phase === 'circ') {
      sim.holdTarget = Math.atan2(-sim.vel.x, sim.vel.y);
      const aimed = Math.abs(((sim.ang - sim.holdTarget + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.12;
      sim.setThrottle(aimed ? 1 : 0);
      if (o && o.peAlt >= circTo) { sim.setThrottle(0); phase = moon ? 'phase' : 'done'; sim.setWarp(0); }
      if (sim.stageProp() <= 0 && sim.activeStage >= sim.stages.length - 1) phase = 'done';
    } else if (phase === 'phase' ) {
      // wait for transfer phase angle to the moon, warping down as alignment nears
      sim.setThrottle(0);
      sim.holdTarget = Math.atan2(-sim.vel.x, sim.vel.y);
      const rNow = Math.hypot(sim.pos.x, sim.pos.y);
      const aT = (rNow + MOON.orbitR) / 2;
      const tTrans = Math.PI * Math.sqrt(aT ** 3 / PLANET.mu);
      const moonAng = MOON.startAngle + MOON.n * sim.t;
      const meAng = Math.atan2(sim.pos.y, sim.pos.x);
      const phaseNeeded = Math.PI - MOON.n * tTrans;
      const h = sim.pos.x * sim.vel.y - sim.pos.y * sim.vel.x;
      const nRocket = h / (rNow * rNow); // signed angular rate
      let diff = (h > 0 ? moonAng - meAng : meAng - moonAng) - phaseNeeded;
      diff = ((diff % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); // 0..2π, shrinking
      const rate = Math.abs(MOON.n - Math.abs(nRocket));
      const tAlign = diff / rate;
      if (diff < 0.03 || diff > Math.PI * 2 - 0.03) { sim.setWarp(0); phase = 'transfer'; }
      else if (tAlign < 40) sim.setWarp(0);
      else if (tAlign < 400) sim.setWarp(3);
      else sim.setWarp(5);
    } else if (phase === 'transfer') {
      sim.holdTarget = Math.atan2(-sim.vel.x, sim.vel.y);
      const aimed = Math.abs(((sim.ang - sim.holdTarget + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.1;
      sim.setThrottle(aimed ? 1 : 0);
      if (o && o.apAlt >= MOON.orbitR - PLANET.R - MOON.soi * 0.45) { sim.setThrottle(0); phase = 'ride'; }
    } else if (phase === 'ride') {
      sim.setThrottle(0);
      if (sim.primary === 'moon') { phase = 'done'; sim.setWarp(0); }
      else sim.setWarp(6);
    }
  };
}

// ---------- tier presets ----------
function t0() {
  const { sim } = fly(['cone-paper', 'fins-cardboard', 'bottle-s'], null, { maxT: 120 });
  check('T0 small water rocket', sim.summary.maxAlt >= 45 && sim.summary.maxAlt <= 160,
    `apogee ${sim.summary.maxAlt.toFixed(0)} m (want 45-160)`);

  const { sim: s2 } = fly(['cone-egg', 'fins-balsa', 'bottle-l'], null, { maxT: 120 });
  check('T0 big water rocket', s2.summary.maxAlt >= 150 && s2.summary.maxAlt <= 400,
    `apogee ${s2.summary.maxAlt.toFixed(0)} m (want 150-400, must pass 250 milestone)`);

  // no fins -> should NOT gain much altitude (tumbles)
  const { sim: s3 } = fly(['cone-paper', 'bottle-l'], null, { maxT: 120 });
  check('T0 finless tumbles', s3.summary.maxAlt < s2.summary.maxAlt * 0.7,
    `finless apogee ${s3.summary.maxAlt.toFixed(0)} m vs finned ${s2.summary.maxAlt.toFixed(0)} m`);

  // streamer recovery
  const st = new Sim(['cone-paper', 'streamer', 'fins-cardboard', 'bottle-s']);
  st.doStage();
  let deployed = false;
  while (!st.dead && st.t < 300) {
    st.drainEvents();
    if (!deployed && st.vel.y < -2 && st.alt() > 10) { st.doChute(); deployed = true; }
    st.update(1 / 30);
  }
  check('T0 streamer recovery', st.summary.landedSafe, `landed safe=${st.summary.landedSafe} (${st.deadReason})`);
}

function t1() {
  const { sim } = fly(['cone-plastic', 'chute-1', 'fins-cardboard', 'motor-c'], null, { maxT: 200 });
  check('T1 C-motor', sim.summary.maxAlt >= 700 && sim.summary.maxAlt <= 3000,
    `apogee ${sim.summary.maxAlt.toFixed(0)} m (want 0.7-3 km)`);

  const { sim: s2 } = fly(['cone-plastic', 'chute-1', 'fins-guided', 'motor-e'], null, { maxT: 400 });
  check('T1 E-motor', s2.summary.maxAlt >= 2200 && s2.summary.maxAlt <= 9000,
    `apogee ${(s2.summary.maxAlt / 1000).toFixed(1)} km (want 2.2-9, clears the 2 km milestone), maxV ${s2.summary.maxSpeed.toFixed(0)} m/s`);
  check('T1 supersonic possible', s2.summary.maxSpeed >= 340, `max speed ${s2.summary.maxSpeed.toFixed(0)} m/s`);

  // chute recovery from high flight
  const st = new Sim(['cone-plastic', 'chute-1', 'fins-cardboard', 'motor-c']);
  st.doStage();
  while (!st.dead && st.t < 600) {
    st.drainEvents();
    const falling = st.vel.x * st.pos.x + st.vel.y * st.pos.y < 0;
    if (falling && st.chuteState === 'stowed' && st.speed() < 100) st.doChute();
    st.update(1 / 30);
  }
  check('T1 chute recovery', st.summary.landedSafe, `landed safe=${st.summary.landedSafe} impact-ok (${st.deadReason})`);
}

function t2() {
  const parts = ['cone-composite', 'chute-2', 'avionics', 'tank-tin-m', 'fins-composite', 'eng-kestrel'];
  const stats = rocketStats(parts);
  const { sim } = fly(parts, sim => { sim.holdTarget = 0; sim.setThrottle(1); }, { maxT: 1200 });
  check('T2 sounding rocket touches space', sim.summary.maxAlt >= PLANET.spaceLine && sim.summary.maxAlt <= 220_000,
    `apogee ${(sim.summary.maxAlt / 1000).toFixed(0)} km (want 50-220), Δv ${stats.totalDeltaV.toFixed(0)} m/s, TWR ${stats.stageStats[0].twr.toFixed(2)}`);

  // best-case orbital attempt with max tier-2 stack must FAIL to orbit
  const greedy = ['cone-composite', 'avionics', 'tank-tin-m', 'tank-tin-m', 'tank-tin-m', 'fins-composite', 'eng-kestrel'];
  const gs = rocketStats(greedy);
  const { sim: s2 } = fly(greedy, makeAscentPilot({ targetAp: 55_000, turnStart: 800, turnEnd: 30_000 }), { maxT: 2500 });
  check('T2 cannot orbit', !s2.summary.orbitAchieved,
    `greedy stack Δv ${gs.totalDeltaV.toFixed(0)} m/s TWR ${gs.stageStats[0].twr.toFixed(2)} → orbit=${s2.summary.orbitAchieved} (ap ${(s2.summary.maxAlt / 1000).toFixed(0)} km)`);
}

function t3() {
  const parts = [
    'fairing', 'probe-core', 'chute-3', 'tank-drum-m', 'eng-wisp',
    'decoupler',
    'tank-drum-m', 'tank-drum-l', 'fins-grid', 'eng-mainstay',
  ];
  const stats = rocketStats(parts);
  const pilot = makeAscentPilot({ targetAp: 64_000, turnStart: 1200, turnEnd: 40_000 });
  const { sim } = fly(parts, pilot, { maxT: 4000, log: true });
  const o = sim.orbit();
  check('T3 reaches orbit', sim.summary.orbitAchieved,
    `Δv ${stats.totalDeltaV.toFixed(0)} m/s (s1 ${stats.stageStats[0].deltaV.toFixed(0)} TWR ${stats.stageStats[0].twr.toFixed(2)}, s2 ${stats.stageStats[1].deltaV.toFixed(0)} TWR ${stats.stageStats[1].twr.toFixed(2)}) → pe ${(o?.peAlt / 1000).toFixed(1)} km ap ${(o?.apAlt / 1000).toFixed(1)} km, prop left ${sim.stageProp().toFixed(0)} kg`);
  return sim;
}

function t3boosters() {
  // side-booster variant: kicker pair replaces the second core tank
  const parts = [
    'fairing', 'probe-core', 'chute-3', 'tank-drum-m', 'eng-wisp',
    'decoupler',
    'tank-drum-l', 'fins-grid', 'eng-mainstay', 'R:booster-kicker',
  ];
  const stats = rocketStats(parts);
  const pilot = makeAscentPilot({ targetAp: 64_000, turnStart: 1200, turnEnd: 40_000 });
  const { sim, events } = flyEv(parts, pilot, { maxT: 4000 });
  const o = sim.orbit();
  const seps = events.filter(e => e.type === 'boosterSep').length;
  check('T3 side boosters reach orbit', sim.summary.orbitAchieved && seps === 1,
    `Δv ${stats.totalDeltaV.toFixed(0)} m/s, s1 TWR ${stats.stageStats[0].twr.toFixed(2)} → orbit=${sim.summary.orbitAchieved}, boosterSep events=${seps}, pe ${(o?.peAlt / 1000).toFixed(1)} km`);
}

function t4() {
  const parts = [
    'capsule', 'chute-xl',
    'tank-behemoth', 'eng-glowworm',
    'decoupler-hd',
    'tank-behemoth', 'tank-behemoth', 'tank-behemoth', 'fins-grid', 'eng-titan',
  ];
  const stats = rocketStats(parts);
  const pilot = makeAscentPilot({ targetAp: 64_000, turnStart: 1500, turnEnd: 42_000, moon: true });
  const { sim } = fly(parts, pilot, { maxT: 400_000, log: true });
  check('T4 reaches moon SOI', sim.summary.moonSoi,
    `Δv ${stats.totalDeltaV.toFixed(0)} m/s (s1 ${stats.stageStats[0].deltaV.toFixed(0)} TWR ${stats.stageStats[0].twr.toFixed(2)}, s2 ${stats.stageStats[1].deltaV.toFixed(0)}) → moonSoi=${sim.summary.moonSoi}, prop left ${sim.stageProp().toFixed(0)} kg`);
  if (sim.summary.moonSoi) {
    // enough Δv left to brake + land? rough: need ~ moon escape-ish 500-700 m/s
    const live = sim.stages[sim.activeStage];
    const eng = live.parts.find(x => x.p.engine && !x.p.engine.water);
    const isp = eng?.p.engine.isp ?? 0;
    const m1 = sim.mass - sim.stageProp();
    const dvLeft = isp * G0 * Math.log(sim.mass / m1);
    check('T4 moon landing Δv margin', dvLeft > 800, `Δv remaining in moon SOI: ${dvLeft.toFixed(0)} m/s (want >800)`);
  }
}

console.log(`planet R=${PLANET.R / 1000}km  orbit v@50km=${Math.sqrt(PLANET.mu / (PLANET.R + 50000)).toFixed(0)} m/s  moon SOI=${(MOON.soi / 1000).toFixed(0)}km`);
testRails();
t0(); t1(); t2(); t3(); t3boosters(); t4();

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
