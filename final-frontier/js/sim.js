// Final Frontier — flight simulation. Pure logic, headless-importable.
//
// Two modes:
//  - numeric: semi-implicit Euler with fixed substeps (thrust, atmosphere, landings)
//  - rails:   exact Kepler propagation (coasting in vacuum) -> free time warp
// Patched conics: gravity of one primary at a time, SOI handoff to/from the moon.

import { G0, PLANET, MOON } from './constants.js';
import { PART_BY_ID, splitStages, dragProfile, parseEntry } from './parts.js';

export const WARP_LEVELS = [1, 2, 4, 10, 50, 250, 1000, 5000, 25000, 100000];
export const MAX_NUMERIC_WARP = 4;

const TAU = Math.PI * 2;
const WIND = 1.8; // m/s steady breeze in the lower atmosphere
const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

export function moonPos(t) {
  const th = MOON.startAngle + MOON.n * t;
  return { x: MOON.orbitR * Math.cos(th), y: MOON.orbitR * Math.sin(th) };
}
export function moonVel(t) {
  const th = MOON.startAngle + MOON.n * t;
  const s = MOON.orbitR * MOON.n;
  return { x: -s * Math.sin(th), y: s * Math.cos(th) };
}

export function atmoDensity(alt) {
  if (alt >= PLANET.atmoTop || alt < -100) return 0;
  return PLANET.rho0 * Math.exp(-Math.max(0, alt) / PLANET.atmoH);
}

// ---- Orbit elements (2D). Returns null for degenerate states. ----
export function orbitElements(mu, pos, vel) {
  const r = Math.hypot(pos.x, pos.y);
  if (r < 1) return null;
  const v2 = vel.x * vel.x + vel.y * vel.y;
  const h = pos.x * vel.y - pos.y * vel.x;
  const rv = pos.x * vel.x + pos.y * vel.y;
  const E = v2 / 2 - mu / r;
  const ex = ((v2 - mu / r) * pos.x - rv * vel.x) / mu;
  const ey = ((v2 - mu / r) * pos.y - rv * vel.y) / mu;
  const e = Math.hypot(ex, ey);
  const a = Math.abs(E) < 1e-9 ? Infinity : -mu / (2 * E);
  const pe = e < 1 ? a * (1 - e) : a * (1 - e); // for hyperbolic a<0 -> positive periapsis
  const ap = e < 1 ? a * (1 + e) : Infinity;
  return { a, e, h, ex, ey, pe, ap, argP: Math.atan2(ey, ex), r, rv };
}

function solveKeplerE(M, e) {
  M = wrapPi(M);
  let Ea = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < 30; i++) {
    const d = (Ea - e * Math.sin(Ea) - M) / (1 - e * Math.cos(Ea));
    Ea -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return Ea;
}
function solveKeplerH(M, e) {
  let H = Math.asinh(M / e);
  for (let i = 0; i < 40; i++) {
    const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
    H -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return H;
}

// Build rails element set from state (mirrors clockwise orbits to CCW internally).
export function railsFrom(mu, pos, vel, t) {
  const flip = (pos.x * vel.y - pos.y * vel.x) < 0;
  const p = { x: pos.x, y: flip ? -pos.y : pos.y };
  const v = { x: vel.x, y: flip ? -vel.y : vel.y };
  const el = orbitElements(mu, p, v);
  if (!el || el.e > 50 || !isFinite(el.a)) return null;
  let { a, e, argP } = el;
  // near-circular: periapsis direction is noise — anchor it at the current position
  if (e < 1e-6) { e = 0; argP = Math.atan2(p.y, p.x); }
  const rv = p.x * v.x + p.y * v.y;
  const r = Math.hypot(p.x, p.y);
  let M0, n;
  if (e === 0) {
    n = Math.sqrt(mu / (a * a * a));
    return { mu, a, e, argP, M0: 0, t0: t, n, flip };
  }
  if (e < 1) {
    const E0 = Math.atan2(rv / Math.sqrt(mu * a), 1 - r / a);
    M0 = E0 - e * Math.sin(E0);
    n = Math.sqrt(mu / (a * a * a));
  } else {
    const H0 = Math.asinh(rv / (e * Math.sqrt(-mu * a)));
    M0 = e * Math.sinh(H0) - H0;
    n = Math.sqrt(mu / (-a * a * a));
  }
  return { mu, a, e, argP, M0, t0: t, n, flip };
}

export function railsState(rails, t) {
  const { mu, a, e, argP, M0, t0, n, flip } = rails;
  const M = M0 + n * (t - t0);
  let px, py, vx, vy;
  if (e < 1) {
    const E = solveKeplerE(M, e);
    const se = Math.sin(E), ce = Math.cos(E);
    const b = a * Math.sqrt(1 - e * e);
    const r = a * (1 - e * ce);
    px = a * (ce - e); py = b * se;
    const k = Math.sqrt(mu * a) / r;
    vx = -k * se; vy = k * Math.sqrt(1 - e * e) * ce;
  } else {
    const H = solveKeplerH(M, e);
    const sh = Math.sinh(H), ch = Math.cosh(H);
    const r = a * (1 - e * ch); // a<0 -> r>0
    px = a * (ch - e); py = -a * Math.sqrt(e * e - 1) * sh;
    const k = Math.sqrt(-mu * a) / r;
    vx = -k * sh; vy = k * Math.sqrt(e * e - 1) * ch;
  }
  // rotate by argP
  const c = Math.cos(argP), s = Math.sin(argP);
  let pos = { x: px * c - py * s, y: px * s + py * c };
  let vel = { x: vx * c - vy * s, y: vx * s + vy * c };
  if (flip) { pos.y = -pos.y; vel.y = -vel.y; }
  return { pos, vel };
}

let seq = 0;

export class Sim {
  constructor(partIds, opts = {}) {
    this.partIds = [...partIds];
    // stage structure: bottom-up list of {parts:[{p, prop, radial, mult}], decouplerAbove}
    const stacks = splitStages(partIds); // stage 0 = bottom, entries top->bottom order inside
    this.stages = stacks.map((ents, si) => ({
      parts: ents.map((x, pi) => ({
        p: x.p,
        radial: x.radial,
        mult: x.mult,
        prop: ((x.p.tank?.prop ?? 0) + (x.p.engine?.prop ?? 0)) * x.mult,
        // unguided engines are never mounted perfectly straight (pairs cancel out)
        mis: x.p.engine && !x.p.engine.gimbal && !x.radial
          ? 0.013 * Math.sin((seq + 1) * 12.9898 + si * 3.3 + pi * 7.7) : 0,
      })),
    }));
    const decs = partIds.filter(e => !parseEntry(e).radial && PART_BY_ID[parseEntry(e).id].type === 'decoupler')
      .map(e => PART_BY_ID[parseEntry(e).id]);
    // decoupler i sits above stage i (bottom-up)
    decs.reverse().forEach((d, i) => { if (this.stages[i]) this.stages[i].dec = d; });

    this.activeStage = 0;
    this.lit = false;
    this.throttle = 1;
    this.t = 0;
    this.primary = 'planet';
    // Launch site: top of planet.
    this.pos = { x: 0, y: PLANET.R };
    this.vel = { x: 0, y: 0 };
    this.ang = 0;           // attitude, 0 = radially up at launch site, CCW+
    this.angVel = 0;
    this.rotInput = 0;
    this.sas = false;
    this.holdTarget = null; // SAS/autopilot hold angle (world frame)
    this.landed = true;
    this.dead = false;      // flight over (crashed or recovered)
    this.deadReason = null;
    this.chuteState = 'stowed'; // stowed | open | ripped | none
    this.chuteFrac = 0;
    this.warpIdx = 0;
    this.curThrust = 0;
    this.waterThrustMult = 1; // set by the pump minigame (nominal 6 bar)
    this.waterIspMult = 1;
    this.rails = null;
    this.events = [];
    this.debris = [];       // cosmetic, for flight.js
    this.id = ++seq;

    this.summary = {
      maxAlt: 0, maxSpeed: 0, landedSafe: false, crashed: false,
      orbitAchieved: false, moonSoi: false, moonLanded: false,
      crewed: this.allParts().some(pp => pp.p.capsule),
      flightTime: 0, stagesUsed: 1,
    };
    this._recalcBody();
  }

  // ---------- helpers ----------
  allParts() { return this.stages.slice(this.activeStage).flatMap(s => s.parts); }

  // Ordered top->bottom live stack (with inter-stage decouplers) for rendering.
  liveStack() {
    const out = [];
    for (let i = this.stages.length - 1; i >= this.activeStage; i--) {
      out.push(...this.stages[i].parts.map(x => ({
        p: x.p, radial: x.radial, prop: x.prop,
        propFull: ((x.p.tank?.prop ?? 0) + (x.p.engine?.prop ?? 0)) * (x.mult ?? 1),
      })));
      if (i > this.activeStage && this.stages[i - 1]?.dec) out.push({ p: this.stages[i - 1].dec, isDec: true });
    }
    return out;
  }

  // Pump minigame (tier-0 water rockets): pressure in bar, nominal 6.
  setPumpPressure(bar) {
    const k = Math.max(0.25, bar / 6);
    this.waterThrustMult = k;
    this.waterIspMult = Math.sqrt(k);
  }

  pop() { // over-pumped on the pad
    if (this.dead) return;
    this.dead = true;
    this.deadReason = 'popped';
    this.emit('crash', 'POP!! The bottle burst on the pad 🫧');
  }
  emit(type, msg, data) { this.events.push({ t: this.t, type, msg, data }); }

  _recalcBody() {
    const live = this.allParts();
    this.mass = live.reduce((m, x) => m + x.p.mass * (x.mult ?? 1) + x.prop, 0)
      + this.stages.slice(this.activeStage).reduce((m, s) => m + (s.dec?.mass ?? 0), 0);
    this.height = Math.max(0.2, live.reduce((h, x) => h + (x.p.type === 'fins' || x.radial ? 0 : x.p.h), 0));
    const drag = dragProfile(live.map(x => ({ p: x.p, radial: x.radial })));
    this.cd = drag.cd; this.dragArea = drag.area;
    this.bareOffset = this.cd < 0.5 ? 0.30 : 0.55; // pointy tops are less unstable
    this.finStab = live.reduce((s, x) => s + (x.p.fins?.stability ?? 0), 0);
    this.finCtrl = live.reduce((s, x) => s + (x.p.fins ? x.p.fins.control * x.p.w * x.p.h * 0.12 : 0), 0);
    this.wheelTorque = live.reduce((s, x) => s + (x.p.guidance?.torque ?? 0), 0);
    const maxW = Math.max(0.05, ...live.map(x => x.p.w));
    this.slender = Math.min(3.5, Math.max(0.6, 0.8 * this.height / maxW)); // side-on drag penalty
    this.hasGuidance = live.some(x => x.p.guidance);
    this.chutes = live.filter(x => x.p.chute);
    if (!this.chutes.length && this.chuteState === 'stowed') this.chuteState = 'none';
    this.legsSoft = live.reduce((s, x) => Math.max(s, x.p.legs?.soft ?? 0), 0);
    this.inertia = this.mass * (this.height / 2) ** 2 * 0.35 + 0.02 * this.mass + 0.002;
  }

  activeEngines() {
    if (!this.lit) return [];
    return this.stages[this.activeStage].parts.filter(x => x.p.engine && x.p.engine.thrust > 0);
  }
  stageProp() {
    const st = this.stages[this.activeStage];
    return st.parts.reduce((s, x) => s + x.prop, 0);
  }
  stagePropFull() {
    const st = this.stages[this.activeStage];
    return st.parts.reduce((s, x) => s + (x.p.tank?.prop ?? 0) + (x.p.engine?.prop ?? 0), 0);
  }

  alt() {
    const R = this.primary === 'planet' ? PLANET.R : MOON.R;
    return Math.hypot(this.pos.x, this.pos.y) - R;
  }
  speed() { return Math.hypot(this.vel.x, this.vel.y); }
  mu() { return this.primary === 'planet' ? PLANET.mu : MOON.mu; }

  worldPos() { // planet-centric, for rendering & map
    if (this.primary === 'planet') return { ...this.pos };
    const mp = moonPos(this.t);
    return { x: this.pos.x + mp.x, y: this.pos.y + mp.y };
  }

  orbit() {
    const el = orbitElements(this.mu(), this.pos, this.vel);
    if (!el) return null;
    const R = this.primary === 'planet' ? PLANET.R : MOON.R;
    const out = {
      e: el.e, a: el.a, argP: el.argP, h: el.h,
      apAlt: isFinite(el.ap) ? el.ap - R : Infinity,
      peAlt: el.pe - R,
    };
    if (el.e < 1 && isFinite(el.a) && el.a > 0) {
      const n = Math.sqrt(this.mu() / el.a ** 3);
      out.period = TAU / n;
      // time to apoapsis: mean anomaly at apo = pi
      const rails = railsFrom(this.mu(), this.pos, this.vel, this.t);
      if (rails) {
        const M = wrapPi(rails.M0);
        out.tToAp = ((Math.PI - M + TAU) % TAU) / n;
        out.tToPe = ((TAU - M) % TAU) / n;
      }
    }
    return out;
  }

  // ---------- commands ----------
  setRot(u) { this.rotInput = Math.max(-1, Math.min(1, u)); if (u) this.holdTarget = null; }
  setThrottle(v) {
    const th = Math.max(0, Math.min(1, v));
    if (th !== this.throttle) this.throttle = th;
  }
  toggleSas() {
    if (!this.hasGuidance) { this.emit('info', 'No avionics on board — SAS unavailable'); return; }
    this.sas = !this.sas;
    this.holdTarget = this.sas ? this.ang : null;
    this.emit('info', this.sas ? 'SAS: holding attitude' : 'SAS off');
  }
  setWarp(i) {
    i = Math.max(0, Math.min(WARP_LEVELS.length - 1, i));
    if (WARP_LEVELS[i] > MAX_NUMERIC_WARP && !this._canRails()) {
      this.emit('info', 'Max warp ×4 while thrusting or in atmosphere');
      i = Math.min(i, 2);
    }
    this.warpIdx = i;
  }
  warp() { return WARP_LEVELS[this.warpIdx]; }

  doStage() {
    if (this.dead) return;
    const st = this.stages[this.activeStage];
    if (!this.lit) {
      const eng = st.parts.filter(x => x.p.engine);
      if (eng.length && this.stageProp() > 0) {
        this.lit = true;
        if (this.landed) { this.landed = false; this.emit('launch', 'Liftoff!! 🚀'); }
        else this.emit('ignite', 'Ignition!');
        this.summary.stagesUsed = Math.max(this.summary.stagesUsed, this.activeStage + 1);
        return;
      }
    }
    if (this.activeStage < this.stages.length - 1) {
      // separate: drop current stage + its decoupler
      const dropped = st;
      this.activeStage++;
      this.lit = false;
      this._recalcBody();
      this.emit('separate', 'Stage separation!', { parts: dropped.parts.map(x => x.p) });
      this.debris.push({
        t: this.t, parts: dropped.parts.map(x => x.p),
        pos: this.worldPos(), vel: { ...this.vel }, spin: (this.id % 2 ? 1 : -1) * 0.8, primary: this.primary,
      });
      this.rails = null;
      // hot-stage: try to ignite next
      const eng2 = this.stages[this.activeStage].parts.filter(x => x.p.engine);
      if (eng2.length && this.stageProp() > 0) { this.lit = true; this.emit('ignite', 'Ignition!'); }
      this.summary.stagesUsed = Math.max(this.summary.stagesUsed, this.activeStage + 1);
    } else if (this.chuteState === 'stowed') {
      this.doChute();
    }
  }

  doChute() {
    if (this.chuteState !== 'stowed' || this.dead) return;
    const v = this.speed();
    const maxD = Math.max(...this.chutes.map(x => x.p.chute.maxDeploy));
    if (this.primary === 'moon' || atmoDensity(this.alt()) < 1e-4) {
      this.emit('info', 'No air here — parachute would just sulk'); return;
    }
    if (v > maxD) {
      this.chuteState = 'ripped';
      this.emit('chuteRip', `Chute shredded! (deployed at ${v.toFixed(0)} m/s, max ${maxD})`);
    } else {
      this.chuteState = 'open';
      this.emit('chute', 'Parachute deployed! 🪂');
    }
  }

  _canRails() {
    return !this.landed && !this.dead
      && (!this.lit || this.throttle === 0 || this.stageProp() <= 0 || !this.activeEngines().length)
      && (this.primary === 'moon' || this.alt() > PLANET.atmoTop)
      && this.chuteState !== 'open';
  }

  // ---------- main update ----------
  update(realDt) {
    if (this.dead) return;
    if (this.landed && !this.lit) return; // waiting on the pad: clock stopped
    let dt = Math.min(realDt, 0.1) * this.warp();

    if (this.warp() > MAX_NUMERIC_WARP && !this._canRails() && !this.rails) {
      this.warpIdx = Math.min(this.warpIdx, 2);
      dt = Math.min(realDt, 0.1) * this.warp();
    }

    if (this._canRails() && this.warp() > 1) {
      if (!this.rails) this.rails = railsFrom(this.mu(), this.pos, this.vel, this.t);
      if (this.rails) { this._railsStep(dt, realDt); return; }
    }
    this.rails = null;
    // numeric substeps
    const SUB = 1 / 120;
    let steps = Math.ceil(dt / SUB);
    if (steps > 90) steps = 90;
    const h = dt / steps;
    for (let i = 0; i < steps && !this.dead; i++) this._physStep(h);
  }

  _railsStep(dt, realDt) {
    this.curThrust = 0;
    // check for events along the way with coarse sampling
    const steps = Math.max(1, Math.min(60, Math.ceil(dt / Math.max(1, dt / 32))));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.t += h;
      const st = railsState(this.rails, this.t);
      this.pos = st.pos; this.vel = st.vel;
      if (this._checkSoi()) { this.rails = null; break; }
      const alt = this.alt();
      if (this.primary === 'planet' && alt < PLANET.atmoTop + 500) {
        this.rails = null;
        if (this.warp() > MAX_NUMERIC_WARP) { this.warpIdx = 2; this.emit('info', 'Atmosphere ahead — warp reduced'); }
        break;
      }
      if (this.primary === 'moon' && alt < 12_000) {
        this.rails = null;
        if (this.warp() > 50) { this.warpIdx = 4; this.emit('info', 'Terrain ahead — warp reduced'); }
        break;
      }
    }
    // attitude still integrates in real-ish time on rails
    this._attitudeStep(Math.min(realDt, 0.05), 0, 0);
    this._track();
  }

  _physStep(h) {
    const mu = this.mu();
    const r = Math.hypot(this.pos.x, this.pos.y);
    const alt = r - (this.primary === 'planet' ? PLANET.R : MOON.R);
    const rho = this.primary === 'planet' ? atmoDensity(alt) : 0;

    // --- forces ---
    let ax = -mu * this.pos.x / (r * r * r);
    let ay = -mu * this.pos.y / (r * r * r);

    // thrust
    let thrust = 0;
    const engines = this.activeEngines();
    if (engines.length && this.stageProp() > 0) {
      let mdot = 0;
      for (const e of engines) {
        const eng = e.p.engine;
        const mult = e.mult ?? 1;
        let f = eng.thrust * mult * (eng.throttle ? this.throttle : 1);
        let isp = eng.isp;
        if (eng.vac) f *= 1 - 0.7 * (rho / PLANET.rho0);
        if (eng.water) {
          f *= (0.45 + 0.55 * (e.prop / Math.max(1e-9, eng.prop * mult))) * this.waterThrustMult;
          isp *= this.waterIspMult;
        }
        thrust += f;
        mdot += f / (isp * G0);
      }
      // drain: solids/water from own casing, liquids pooled from stage tanks
      let need = mdot * h;
      for (const e of engines) {
        if (e.p.engine.prop > 0) { // self-contained
          const eng = e.p.engine;
          const mult = e.mult ?? 1;
          let f = eng.thrust * mult;
          let isp = eng.isp;
          if (eng.water) { f *= (0.45 + 0.55 * (e.prop / (eng.prop * mult))) * this.waterThrustMult; isp *= this.waterIspMult; }
          const take = Math.min(e.prop, (f / (isp * G0)) * h);
          e.prop -= take; need -= take;
        }
      }
      if (need > 0) {
        const tanks = this.stages[this.activeStage].parts.filter(x => x.p.tank && x.prop > 0);
        let pool = tanks.reduce((s, x) => s + x.prop, 0);
        if (pool <= need) { tanks.forEach(x => x.prop = 0); }
        else for (const x of tanks) { const take = need * (x.prop / pool); x.prop -= take; }
      }
      if (this.stageProp() <= 1e-9) {
        this.lit = false;
        this.emit('flameout', this.activeStage < this.stages.length - 1 ? 'Flameout — press SPACE to stage' : 'Flameout — tanks dry');
      }
      const dirX = -Math.sin(this.ang), dirY = Math.cos(this.ang);
      ax += thrust / this.mass * dirX;
      ay += thrust / this.mass * dirY;
      this.mass = Math.max(0.01, this.mass - mdot * h);
    }
    this.curThrust = thrust;

    // spent side boosters drop off on their own
    const st0 = this.stages[this.activeStage];
    if (st0.parts.some(x => x.radial && x.p.engine && x.prop <= 1e-9)) {
      const dropped = st0.parts.filter(x => x.radial && x.p.engine && x.prop <= 1e-9);
      st0.parts = st0.parts.filter(x => !dropped.includes(x));
      this._recalcBody();
      this.emit('boosterSep', 'Side boosters away! 👋');
      for (const s of [-1, 1]) {
        this.debris.push({
          t: this.t, parts: dropped.map(x => x.p),
          pos: this.worldPos(), vel: { x: this.vel.x + s * 14, y: this.vel.y - 4 },
          spin: s * 1.2, primary: this.primary,
        });
      }
    }

    // drag (+ chute) — relative to a light steady breeze, so unstable rockets get nudged
    const wx = rho > 0 ? WIND : 0;
    const rvx = this.vel.x - wx, rvy = this.vel.y;
    const v = Math.hypot(rvx, rvy);
    if (rho > 0 && v > 0.01) {
      if (this.chuteState === 'open' && this.chuteFrac < 1) this.chuteFrac = Math.min(1, this.chuteFrac + h / 1.2);
      const chuteArea = this.chuteState === 'open'
        ? this.chutes.reduce((s, x) => s + x.p.chute.area, 0) * this.chuteFrac : 0;
      if (this.chuteState === 'open' && v > 1.45 * Math.max(...this.chutes.map(x => x.p.chute.maxDeploy))) {
        this.chuteState = 'ripped'; this.emit('chuteRip', 'The parachute tore off!');
      }
      // flying sideways is draggy — fins that keep the nose into the wind pay off
      const velAng = Math.atan2(-rvx, rvy);
      const aoa = wrapPi(this.ang - velAng);
      const aoaMult = 1 + 2.4 * Math.sin(aoa) ** 2 * this.slender;
      const fd = 0.5 * rho * v * v * (this.cd * this.dragArea * aoaMult + 1.4 * chuteArea);
      ax -= fd / this.mass * rvx / v;
      ay -= fd / this.mass * rvy / v;
      this.maxQ = Math.max(this.maxQ ?? 0, 0.5 * rho * v * v);
    }

    // --- integrate ---
    this.vel.x += ax * h; this.vel.y += ay * h;
    if (!this.landed) {
      this.pos.x += this.vel.x * h; this.pos.y += this.vel.y * h;
    } else {
      // sitting on the pad: stay put until thrust beats gravity
      if (thrust / this.mass > mu / (r * r)) {
        this.landed = false;
        this.emit('launch', 'Liftoff!! 🚀');
      } else { this.vel.x = 0; this.vel.y = 0; }
    }

    this._attitudeStep(h, rho, thrust);
    this.t += h;
    this._checkSoi();
    this._checkGround();
    this._track();
  }

  _attitudeStep(h, rho, thrust) {
    const v = rho > 0 ? Math.hypot(this.vel.x - WIND, this.vel.y) : this.speed();
    let torque = 0; // passive/aero torques (uncapped); control handled separately
    let u = this.rotInput;
    if (!u && this.holdTarget != null) {
      const err = wrapPi(this.holdTarget - this.ang);
      u = Math.max(-1, Math.min(1, 2.2 * err - 1.4 * this.angVel));
    }
    const lever = this.height * 0.38;
    const gimbalT = this.activeEngines().reduce((s, e) =>
      s + (e.p.engine.gimbal ? (thrust || 0) * Math.sin(e.p.engine.gimbal * Math.PI / 180) : 0), 0);
    const q = 0.5 * rho * v * v;
    const finT = this.finCtrl * q * 1.1;
    const auth = (gimbalT + finT) * lever + this.wheelTorque;
    // control is capped for playability; raw aerodynamics below are not
    const CAP = 2.6;
    const ctrlAcc = Math.max(-CAP, Math.min(CAP, u * auth / this.inertia));
    // crooked unguided motors torque the rocket while burning
    if (thrust > 0) {
      for (const e of this.activeEngines()) {
        if (e.mis) torque += e.p.engine.thrust * Math.sin(e.mis) * lever;
      }
    }

    // passive aero stability (nose into the wind) — or tumbling without fins
    if (rho > 1e-6 && v > 2 && !this.landed) {
      const velAng = Math.atan2(-(this.vel.x - WIND), this.vel.y); // 0 = +y
      const aoa = wrapPi(this.ang - velAng);
      const netStab = this.finStab - this.bareOffset; // bare bodies are unstable
      torque += -netStab * q * this.dragArea * lever * Math.sin(aoa) * 0.55;
      torque += -this.angVel * q * this.dragArea * lever * 0.12; // aero damping
    }
    // wheels damp on SAS
    if (this.sas || this.holdTarget != null) torque += -this.angVel * this.wheelTorque * 1.2;
    torque += -this.angVel * 0.02 * this.inertia; // tiny universal damping

    const aeroAcc = Math.max(-25, Math.min(25, torque / this.inertia));
    const angAcc = ctrlAcc + aeroAcc;
    this.angVel += angAcc * h;
    this.angVel = Math.max(-6, Math.min(6, this.angVel));
    if (!this.landed) this.ang = wrapPi(this.ang + this.angVel * h);
    else { this.angVel = 0; }
  }

  _checkSoi() {
    if (this.primary === 'planet') {
      const mp = moonPos(this.t);
      const dx = this.pos.x - mp.x, dy = this.pos.y - mp.y;
      if (dx * dx + dy * dy < MOON.soi ** 2) {
        const mv = moonVel(this.t);
        this.pos = { x: dx, y: dy };
        this.vel = { x: this.vel.x - mv.x, y: this.vel.y - mv.y };
        this.primary = 'moon';
        this.rails = null;
        this.summary.moonSoi = true;
        this.emit('soi', `Hello, ${MOON.name}! 🌙 Entered its sphere of influence`);
        return true;
      }
    } else {
      const r = Math.hypot(this.pos.x, this.pos.y);
      if (r > MOON.soi * 1.02) {
        const mp = moonPos(this.t), mv = moonVel(this.t);
        this.pos = { x: this.pos.x + mp.x, y: this.pos.y + mp.y };
        this.vel = { x: this.vel.x + mv.x, y: this.vel.y + mv.y };
        this.primary = 'planet';
        this.rails = null;
        this.emit('soi', `Back in ${PLANET.name}'s sphere of influence`);
        return true;
      }
    }
    return false;
  }

  _checkGround() {
    if (this.landed) return;
    const R = this.primary === 'planet' ? PLANET.R : MOON.R;
    const r = Math.hypot(this.pos.x, this.pos.y);
    if (r > R) return;
    const vImpact = this.speed();
    // clamp to surface
    const s = R / r;
    this.pos.x *= s; this.pos.y *= s;
    this.vel = { x: 0, y: 0 };
    this.landed = true;
    this.lit = false;
    this.dead = true;

    let tol = 6 + (this.mass < 5 ? 5 : 0) + this.legsSoft;
    if (this.chuteState === 'open' && this.chuteFrac > 0.6) tol = Math.max(tol, 14);
    const safe = vImpact <= tol;
    if (safe) {
      this.deadReason = 'landed';
      this.summary.landedSafe = true;
      if (this.primary === 'moon') {
        this.summary.moonLanded = true;
        this.emit('land', `Touchdown on ${MOON.name}!! 🌙 (${vImpact.toFixed(1)} m/s)`);
      } else this.emit('land', `Soft touchdown! (${vImpact.toFixed(1)} m/s)`);
    } else {
      this.deadReason = 'crashed';
      this.summary.crashed = true;
      this.emit('crash', this.mass < 5
        ? `Bonk! It hit the ground at ${vImpact.toFixed(0)} m/s 💥`
        : `Rapid unscheduled disassembly at ${vImpact.toFixed(0)} m/s 💥`);
    }
  }

  _track() {
    const s = this.summary;
    if (this.primary === 'planet') s.maxAlt = Math.max(s.maxAlt, this.alt());
    else s.maxAlt = Math.max(s.maxAlt, Math.hypot(...Object.values(moonPos(this.t))) - PLANET.R);
    s.maxSpeed = Math.max(s.maxSpeed, this.speed());
    s.flightTime = this.t;
    if (!s.spaceMsg && this.primary === 'planet' && this.alt() >= PLANET.spaceLine) {
      s.spaceMsg = true;
      this.emit('space', '⭐ You are in S P A C E ⭐');
    }
    if (!s.orbitAchieved && this.primary === 'planet' && !this.landed) {
      const o = this.orbit();
      if (o && o.e < 1 && o.peAlt > PLANET.atmoTop) {
        s.orbitAchieved = true;
        this.emit('orbit', '🛰️ ORBIT ACHIEVED! Periapsis is above the atmosphere!');
      }
    }
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}
