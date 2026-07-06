// Pure flight physics: two-body gravity, atmosphere drag, staging, control.
// No DOM here so it can run headless (tuning harness) and inside flight.js.
import { PHYS, MOON } from './constants.js';
import { computeRocketStats, PARTS } from './parts.js';
import { clamp, wrapAngle } from './util.js';

const BODY_CD = 0.4;       // drag coefficient of the airframe cross-section
const CHUTE_CD = 1.0;      // chute drag-area is already effective, multiplier ~1
const K_TORQUE = 0.026;    // control authority -> angular accel scaling
const MAX_TURN = 1.35;     // rad/s max commanded turn rate
const LAND_SAFE = 9;       // m/s max impact speed for a soft landing
const CHUTE_SAFE = 16;     // m/s allowed under an open chute

export function buildSim(design) {
  const stats = computeRocketStats(design);
  // Base airframe drag scales with the widest part's frontal area (not a flat
  // constant) so a soda bottle and a Moon rocket are dragged proportionally.
  let maxW = 0.1;
  for (const n of (design.stack || [])) { const p = PARTS[n.id]; if (p) maxW = Math.max(maxW, p.w); }
  const baseDrag = Math.PI * (maxW / 2) * (maxW / 2) * BODY_CD;
  const stages = stats.stages.map(s => ({
    dry: s.dry, fuelMax: s.fuel, fuel: s.fuel,
    thrust: s.thrust, ve: s.ve, mdot: s.mdot,
    ctrlRW: s.ctrlRW, ctrlAero: s.ctrlAero,
    finArea: s.finArea, dragArea: s.dragArea, crew: s.crew,
    chutes: s.chutes.slice(),
  }));
  const sim = {
    design, stats, stages, baseDrag,
    pos: { x: 0, y: PHYS.R }, vel: { x: 0, y: 0 },
    ang: Math.PI / 2, angVel: 0,
    active: 0,
    throttle: 1, engineOn: false, sas: true,
    chuteOpen: false,
    t: 0, maxAlt: 0, maxSpeed: 0,
    done: false, crashed: false, recovered: false, launched: false,
    reached: { space: false, orbit: false, moon: false },
    crew: stats.crew,
    lastThrustAcc: 0, lastDrag: 0, dynP: 0,
    events: [],      // transient list flight.js drains for effects (staging etc.)
  };
  return sim;
}

export function ignite(sim) {
  if (sim.done) return;
  sim.engineOn = true;
  sim.launched = true;
}

// Drop the current stage and light the next one. Returns dropped stage index or -1.
export function stage(sim) {
  if (sim.done) return -1;
  // Deploy a chute if the top payload has one and there is nothing left to burn.
  if (sim.active >= sim.stages.length - 1) {
    if (hasChute(sim) && !sim.chuteOpen) { sim.chuteOpen = true; return -2; }
    return -1;
  }
  const dropped = sim.active;
  sim.active++;
  sim.engineOn = true;
  sim.events.push({ type: 'sep', stage: dropped });
  return dropped;
}

function hasChute(sim) {
  for (let i = sim.active; i < sim.stages.length; i++)
    if (sim.stages[i].chutes.length) return true;
  return false;
}

export function toggleChute(sim) {
  if (hasChute(sim)) sim.chuteOpen = !sim.chuteOpen;
}

export function currentMass(sim) {
  let m = 0;
  for (let i = sim.active; i < sim.stages.length; i++) m += sim.stages[i].dry + sim.stages[i].fuel;
  return m;
}

function sumFromActive(sim, key) {
  let v = 0;
  for (let i = sim.active; i < sim.stages.length; i++) v += sim.stages[i][key];
  return v;
}

function chuteArea(sim) {
  let a = 0;
  for (let i = sim.active; i < sim.stages.length; i++)
    for (const c of sim.stages[i].chutes) a += c.chuteArea;
  return a;
}

export function activeStage(sim) { return sim.stages[sim.active]; }

// Local gravitational acceleration at the current radius.
export function localG(sim) {
  const r = Math.hypot(sim.pos.x, sim.pos.y);
  return PHYS.mu / (r * r);
}

// Delta-v still available (active stage uses live fuel; upper stages are full).
export function remainingDv(sim) {
  let total = 0;
  for (let i = sim.active; i < sim.stages.length; i++) {
    const s = sim.stages[i];
    if (s.thrust <= 0 || s.fuel <= 0 || s.mdot <= 0) continue;
    let above = 0;
    for (let j = i + 1; j < sim.stages.length; j++) above += sim.stages[j].dry + sim.stages[j].fuel;
    const ve = s.thrust / s.mdot;
    total += ve * Math.log((above + s.dry + s.fuel) / (above + s.dry));
  }
  return total;
}

// Orbital elements + altitudes derived from the current state.
export function orbitInfo(sim) {
  const { pos, vel } = sim;
  const r = Math.hypot(pos.x, pos.y);
  const v = Math.hypot(vel.x, vel.y);
  const alt = r - PHYS.R;
  const energy = v * v / 2 - PHYS.mu / r;
  const vr = (pos.x * vel.x + pos.y * vel.y) / r;             // radial (vertical) speed
  const vt = (pos.x * vel.y - pos.y * vel.x) / r;             // tangential (horizontal)
  const info = { r, v, alt, vr, vt, energy, bound: energy < 0, ap: NaN, pe: NaN, ecc: NaN, a: NaN };
  const a = -PHYS.mu / (2 * energy);
  const eVecX = ((v * v - PHYS.mu / r) * pos.x - (pos.x * vel.x + pos.y * vel.y) * vel.x) / PHYS.mu;
  const eVecY = ((v * v - PHYS.mu / r) * pos.y - (pos.x * vel.x + pos.y * vel.y) * vel.y) / PHYS.mu;
  const ecc = Math.hypot(eVecX, eVecY);
  info.a = a; info.ecc = ecc; info.eAng = Math.atan2(eVecY, eVecX);
  if (energy < 0) {
    info.ap = a * (1 + ecc) - PHYS.R;
    info.pe = a * (1 - ecc) - PHYS.R;
  } else {
    info.ap = Infinity;
    info.pe = a * (1 - ecc) - PHYS.R;
  }
  return info;
}

function airDensity(alt) {
  if (alt >= PHYS.atmoTop) return 0;
  return PHYS.rho0 * Math.exp(-Math.max(0, alt) / PHYS.scaleH);
}

// One integration step. dt already scaled by time-warp; sub-stepped internally.
export function stepSim(sim, dt, ctl) {
  if (sim.done) return;
  const SUB = 0.03;
  let remaining = dt;
  while (remaining > 1e-6) {
    const h = Math.min(SUB, remaining);
    substep(sim, h, ctl);
    remaining -= h;
    if (sim.done) break;
  }
  sim.t += dt;
  const oi = orbitInfo(sim);
  if (oi.alt > sim.maxAlt) sim.maxAlt = oi.alt;
  if (oi.v > sim.maxSpeed) sim.maxSpeed = oi.v;
  if (oi.alt >= PHYS.karman) sim.reached.space = true;
  if (oi.bound && oi.pe > PHYS.atmoTop) sim.reached.orbit = true;
  // On a path to the Moon: already out there, an ellipse that reaches it, or escaping outward.
  if (oi.r >= MOON.dist || (oi.bound && oi.ap >= MOON.dist) || (!oi.bound && oi.vr > 0))
    sim.reached.moon = true;
}

function substep(sim, h, ctl) {
  const mass = currentMass(sim);
  const r = Math.hypot(sim.pos.x, sim.pos.y);
  const alt = r - PHYS.R;

  // ---- rotation ----
  const rho = airDensity(alt);
  const speed = Math.hypot(sim.vel.x, sim.vel.y);
  const dynP = 0.5 * rho * speed * speed;
  sim.dynP = dynP;
  const atmoF = clamp(rho / PHYS.rho0, 0, 1);
  const authority = sumFromActive(sim, 'ctrlRW') + sumFromActive(sim, 'ctrlAero') * atmoF;
  const authAcc = mass > 0 ? (authority * K_TORQUE) / mass : 0;   // rad/s^2 available
  const turnIn = ctl ? (ctl.turn || 0) : 0;
  const targetW = turnIn * MAX_TURN;
  // Move angular velocity toward the commanded rate within available authority.
  let dw = targetW - sim.angVel;
  const maxDw = authAcc * h;
  dw = clamp(dw, -maxDw, maxDw);
  // SAS damps residual spin toward zero when no input.
  if (turnIn === 0 && sim.sas) {
    let damp = clamp(-sim.angVel, -maxDw, maxDw);
    sim.angVel += damp;
  } else {
    sim.angVel += dw;
  }
  // Aero weathervaning: fins nudge the nose toward prograde in thick air.
  const finArea = sumFromActive(sim, 'finArea');
  if (finArea > 0 && speed > 15 && rho > 0) {
    const prograde = Math.atan2(sim.vel.y, sim.vel.x);
    const err = wrapAngle(prograde - sim.ang);
    const weather = clamp(err, -0.6, 0.6) * dynP * finArea * 0.00018 / Math.max(1, mass);
    sim.angVel += weather * h;
  }
  sim.ang = wrapAngle(sim.ang + sim.angVel * h);

  // ---- forces ----
  let ax = 0, ay = 0;
  // gravity
  const g = PHYS.mu / (r * r * r);
  ax -= g * sim.pos.x;
  ay -= g * sim.pos.y;

  // thrust
  const st = sim.stages[sim.active];
  let thrustAcc = 0;
  if (sim.engineOn && st && st.thrust > 0 && st.fuel > 0 && sim.throttle > 0) {
    const thr = st.thrust * sim.throttle;
    const use = st.mdot * sim.throttle * h;
    st.fuel = Math.max(0, st.fuel - use);
    thrustAcc = thr / mass;
    ax += thrustAcc * Math.cos(sim.ang);
    ay += thrustAcc * Math.sin(sim.ang);
  }
  sim.lastThrustAcc = thrustAcc;

  // drag
  let dragMag = 0;
  if (rho > 0 && speed > 0) {
    let cdArea = sim.baseDrag + sumFromActive(sim, 'dragArea');
    if (sim.chuteOpen) cdArea += chuteArea(sim) * CHUTE_CD;
    const fDrag = 0.5 * rho * speed * speed * cdArea;
    const aDrag = fDrag / mass;
    dragMag = aDrag;
    ax -= aDrag * (sim.vel.x / speed);
    ay -= aDrag * (sim.vel.y / speed);
  }
  sim.lastDrag = dragMag;

  // auto-open chute when falling low in the atmosphere
  if (!sim.chuteOpen && hasChute(sim)) {
    const vr = (sim.pos.x * sim.vel.x + sim.pos.y * sim.vel.y) / r;
    const deployAlt = Math.max(...allChuteAlts(sim));
    if (vr < -1 && alt < deployAlt && alt < PHYS.atmoTop) sim.chuteOpen = true;
  }

  // ---- integrate (semi-implicit Euler) ----
  sim.vel.x += ax * h;
  sim.vel.y += ay * h;
  sim.pos.x += sim.vel.x * h;
  sim.pos.y += sim.vel.y * h;

  // ---- ground contact ----
  const nr = Math.hypot(sim.pos.x, sim.pos.y);
  if (nr <= PHYS.R) {
    const impact = Math.hypot(sim.vel.x, sim.vel.y);
    // clamp to surface
    const s = PHYS.R / nr;
    sim.pos.x *= s; sim.pos.y *= s;
    if (!sim.launched && impact < 0.5) {
      // sitting on the pad before launch
      sim.vel.x = 0; sim.vel.y = 0;
      return;
    }
    const limit = sim.chuteOpen ? CHUTE_SAFE : LAND_SAFE;
    sim.done = true;
    if (impact <= limit) { sim.recovered = true; }
    else { sim.crashed = true; }
    sim.vel.x = 0; sim.vel.y = 0;
    sim.impactSpeed = impact;
  }
}

function allChuteAlts(sim) {
  const a = [];
  for (let i = sim.active; i < sim.stages.length; i++)
    for (const c of sim.stages[i].chutes) a.push(c.deployAlt);
  return a.length ? a : [0];
}

// Forward-integrate a coasting trajectory (gravity only) for the map view.
// Returns array of {x,y} in world coords. Stops at ground / after ~1 orbit / cap.
export function predictTrajectory(sim, maxPts = 900) {
  const pts = [];
  let px = sim.pos.x, py = sim.pos.y, vx = sim.vel.x, vy = sim.vel.y;
  const r0 = Math.hypot(px, py);
  const v0 = Math.hypot(vx, vy);
  const energy = v0 * v0 / 2 - PHYS.mu / r0;
  const a = -PHYS.mu / (2 * energy);
  const period = energy < 0 ? 2 * Math.PI * Math.sqrt(a * a * a / PHYS.mu) : 6000;
  const span = energy < 0 ? period * 1.02 : Math.min(period, 8000);
  const steps = maxPts;
  const dt = span / steps;
  const startAng = Math.atan2(py, px);
  for (let i = 0; i < steps; i++) {
    const r = Math.hypot(px, py);
    const g = PHYS.mu / (r * r * r);
    vx -= g * px * dt; vy -= g * py * dt;
    px += vx * dt; py += vy * dt;
    pts.push({ x: px, y: py });
    if (Math.hypot(px, py) <= PHYS.R) break;                 // impact
    if (Math.hypot(px, py) > MOON.dist * 1.4) break;          // way out
  }
  return pts;
}
