import { WORLD } from "./data.js";
import {
  activeRuntimeStage,
  computeStats,
  drawRocketStack,
  formatMeters,
  formatSpeed,
  makeRuntimeParts,
  runtimeMass,
  runtimeStageGroups,
} from "./rocket.js";

const WARP_LEVELS = [1, 2, 5, 10];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function len(v) {
  return Math.hypot(v.x, v.y);
}

function norm(v) {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul(v, s) {
  return { x: v.x * s, y: v.y * s };
}

function atmospherePressure(altitude) {
  if (altitude >= WORLD.atmosphere) return 0;
  return clamp(Math.exp(-altitude / 8500) * (1 - altitude / WORLD.atmosphere), 0, 1);
}

function orbitalElements(pos, vel) {
  const r = len(pos);
  const v2 = vel.x * vel.x + vel.y * vel.y;
  const h = pos.x * vel.y - pos.y * vel.x;
  const energy = v2 / 2 - WORLD.mu / r;
  const eTerm = 1 + (2 * energy * h * h) / (WORLD.mu * WORLD.mu);
  const eccentricity = Math.sqrt(Math.max(0, eTerm));
  let apoapsis = Infinity;
  let periapsis;
  if (energy < 0) {
    const a = -WORLD.mu / (2 * energy);
    apoapsis = a * (1 + eccentricity) - WORLD.radius;
    periapsis = a * (1 - eccentricity) - WORLD.radius;
  } else {
    const p = (h * h) / WORLD.mu;
    periapsis = p / (1 + eccentricity) - WORLD.radius;
  }
  return { apoapsis, periapsis, eccentricity, energy };
}

function consumeFuel(items, fuelType, amount) {
  let need = amount;
  let consumed = 0;
  for (const item of items) {
    if (item.def.fuelType !== fuelType || item.fuel <= 0) continue;
    const take = Math.min(item.fuel, need);
    item.fuel -= take;
    need -= take;
    consumed += take;
    if (need <= 0) break;
  }
  return consumed;
}

function stageFuelFraction(stage) {
  if (!stage) return 0;
  const engineTypes = new Set(stage.items.filter(item => item.def.engine).map(item => item.def.engine.fuelType));
  let left = 0;
  let max = 0;
  for (const item of stage.items) {
    if (!engineTypes.has(item.def.fuelType)) continue;
    left += item.fuel;
    max += item.def.fuelMass || 0;
  }
  return max > 0 ? left / max : 0;
}

function estimateRuntimeDv(items) {
  const groups = runtimeStageGroups(items).slice().reverse();
  let mass = runtimeMass(items);
  let total = 0;
  for (const group of groups) {
    const engineItems = group.items.filter(item => item.def.engine);
    if (!engineItems.length) {
      mass -= group.items.reduce((sum, item) => sum + item.def.dryMass + item.fuel, 0);
      continue;
    }
    let thrustWeight = 0;
    let ispWeighted = 0;
    const fuelTypes = new Set();
    for (const item of engineItems) {
      const engine = item.def.engine;
      thrustWeight += engine.thrust;
      ispWeighted += engine.ispVac * engine.thrust;
      fuelTypes.add(engine.fuelType);
    }
    const isp = thrustWeight > 0 ? ispWeighted / thrustWeight : 0;
    const fuel = group.items.reduce((sum, item) => fuelTypes.has(item.def.fuelType) ? sum + item.fuel : sum, 0);
    if (fuel > 0 && mass > fuel) total += isp * WORLD.g0 * Math.log(mass / (mass - fuel));
    mass -= group.items.reduce((sum, item) => sum + item.def.dryMass + item.fuel, 0);
    mass = Math.max(0, mass);
  }
  return total;
}

export class Flight {
  constructor(canvas, design, tier, onComplete, onHud) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.design = design;
    this.tier = tier;
    this.onComplete = onComplete;
    this.onHud = onHud;
    this.parts = makeRuntimeParts(design.parts);
    this.input = { left: false, right: false, up: false, down: false };
    this.pos = { x: 0, y: WORLD.radius };
    this.vel = { x: WORLD.surfaceRotation, y: 0 };
    this.pitch = 0;
    this.pitchHold = 0;
    this.throttle = 1;
    this.sas = true;
    this.map = false;
    this.warpIndex = 0;
    this.running = false;
    this.last = 0;
    this.time = 0;
    this.maxAltitude = 0;
    this.maxSpeed = 0;
    this.apoapsis = 0;
    this.periapsis = -WORLD.radius;
    this.orbitAchieved = false;
    this.moonRoad = false;
    this.landed = false;
    this.crashed = false;
    this.landingSpeed = 0;
    this.hadCrew = computeStats(design).crew;
    this.lastThrust = 0;
    this.message = "";
    this.messageUntil = 0;
    this.trail = [];
  }

  start() {
    this.running = true;
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
    this.last = now;
    const warp = WARP_LEVELS[this.warpIndex];
    const simTime = dt * warp;
    const steps = Math.max(1, Math.ceil(simTime / 0.025));
    for (let i = 0; i < steps; i++) this.step(simTime / steps);
    this.render();
    this.emitHud();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  setHeld(name, value) {
    if (name in this.input) this.input[name] = value;
  }

  changeThrottle(delta) {
    this.throttle = clamp(this.throttle + delta, 0, 1);
  }

  toggleSas() {
    this.sas = !this.sas;
    this.pitchHold = this.pitch;
  }

  toggleMap() {
    this.map = !this.map;
  }

  cycleWarp() {
    this.warpIndex = (this.warpIndex + 1) % WARP_LEVELS.length;
  }

  deployChutes() {
    let any = false;
    for (const item of this.parts) {
      if (item.def.parachute) {
        item.chuteDeployed = true;
        any = true;
      }
    }
    this.message = any ? "Parachutes armed" : "No parachutes installed";
    this.messageUntil = this.time + 3;
  }

  stage() {
    const stage = activeRuntimeStage(this.parts);
    if (!stage) return;
    if (stage.start > 0) {
      const dropped = this.parts.splice(stage.start, this.parts.length - stage.start);
      this.message = `Separated ${dropped.length} part${dropped.length === 1 ? "" : "s"}`;
      this.messageUntil = this.time + 3;
      this.pitchHold = this.pitch;
    } else {
      const fuelLeft = stageFuelFraction(stage);
      this.message = fuelLeft > 0.03 ? "Final stage is still attached" : "No lower stage left";
      this.messageUntil = this.time + 3;
    }
  }

  endFlight() {
    this.finish(false);
  }

  finish(auto) {
    if (!this.running) return;
    this.stop();
    this.onComplete({
      auto,
      maxAltitude: this.maxAltitude,
      maxSpeed: this.maxSpeed,
      apoapsis: this.apoapsis,
      periapsis: this.periapsis,
      orbitAchieved: this.orbitAchieved,
      moonRoad: this.moonRoad,
      landed: this.landed,
      crashed: this.crashed,
      landingSpeed: this.landingSpeed,
      hadCrew: this.hadCrew,
      time: this.time,
    });
  }

  step(dt) {
    const r = len(this.pos);
    const altitude = r - WORLD.radius;
    const up = norm(this.pos);
    const east = { x: up.y, y: -up.x };
    const radialSpeed = dot(this.vel, up);
    const horizontalSpeed = dot(this.vel, east);
    const mass = Math.max(0.05, runtimeMass(this.parts));
    const control = this.parts.reduce((sum, item) => sum + (item.def.control || 0), 0);
    const stability = this.parts.reduce((sum, item) => sum + (item.def.stability || 0), 0);
    const canControl = control > 0.01;
    const turnInput = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);

    if (canControl && turnInput) {
      const authority = (0.42 + control * 0.56) / Math.sqrt(Math.max(1, mass / 18));
      this.pitch += turnInput * authority * dt;
      this.pitchHold = this.pitch;
    } else if (this.sas && canControl) {
      this.pitch += (this.pitchHold - this.pitch) * clamp(dt * (1.3 + control * 0.55), 0, 1);
    } else if (!canControl && stability > 0.01 && altitude < WORLD.atmosphere) {
      this.pitch *= Math.max(0, 1 - dt * stability * 0.32);
    }
    this.pitch = clamp(this.pitch, -Math.PI * 0.92, Math.PI * 0.92);

    if (this.input.up) this.changeThrottle(dt * 0.65);
    if (this.input.down) this.changeThrottle(-dt * 0.65);

    let thrust = 0;
    const stage = activeRuntimeStage(this.parts);
    const pressure = atmospherePressure(Math.max(0, altitude));
    if (stage) {
      for (const item of stage.items) {
        const engine = item.def.engine;
        if (!engine) continue;
        const throttle = engine.throttle ? this.throttle : 1;
        if (throttle <= 0) continue;
        const isp = Math.max(1, engine.ispVac * (1 - pressure) + engine.ispSea * pressure);
        const requestedThrust = engine.thrust * throttle;
        const need = (requestedThrust / (isp * WORLD.g0)) * dt;
        const got = consumeFuel(stage.items, engine.fuelType, need);
        if (got > 0) thrust += requestedThrust * clamp(got / need, 0, 1);
      }
    }
    this.lastThrust = thrust;

    const thrustDir = {
      x: up.x * Math.cos(this.pitch) + east.x * Math.sin(this.pitch),
      y: up.y * Math.cos(this.pitch) + east.y * Math.sin(this.pitch),
    };
    let accel = mul(thrustDir, thrust / mass);
    const gravity = mul(up, -WORLD.mu / (r * r));
    accel = add(accel, gravity);

    const speed = len(this.vel);
    if (speed > 0.01 && altitude < WORLD.atmosphere) {
      const liveDefs = this.parts.map(item => item.def);
      const maxWidth = liveDefs.reduce((max, part) => Math.max(max, part.width), 0.2);
      const dragBase = liveDefs.reduce((sum, part) => sum + (part.drag || 0.5), 0) / Math.max(1, liveDefs.length);
      const chuteArea = this.parts.reduce((sum, item) => item.chuteDeployed && item.def.parachute ? sum + item.def.parachute.area * 0.18 : sum, 0);
      const rho = 1.225 * pressure;
      const area = maxWidth * maxWidth * 0.035 + chuteArea;
      const dragForce = 0.5 * rho * speed * speed * dragBase * area * 0.34;
      accel = add(accel, mul(norm(this.vel), -dragForce / mass));
    }

    this.vel = add(this.vel, mul(accel, dt));
    this.pos = add(this.pos, mul(this.vel, dt));
    this.time += dt;

    const newAltitude = len(this.pos) - WORLD.radius;
    const elements = orbitalElements(this.pos, this.vel);
    this.apoapsis = elements.apoapsis;
    this.periapsis = elements.periapsis;
    this.maxAltitude = Math.max(this.maxAltitude, newAltitude);
    this.maxSpeed = Math.max(this.maxSpeed, len(this.vel));
    this.orbitAchieved = this.orbitAchieved || (elements.apoapsis > WORLD.atmosphere && elements.periapsis > WORLD.atmosphere && elements.energy < 0);
    this.moonRoad = this.moonRoad || (elements.apoapsis > WORLD.moonRoadAltitude && elements.periapsis > WORLD.atmosphere);

    if (this.trail.length === 0 || this.time - this.trail[this.trail.length - 1].t > 0.8) {
      this.trail.push({ x: this.pos.x, y: this.pos.y, t: this.time });
      if (this.trail.length > 220) this.trail.shift();
    }

    if (newAltitude <= 0 && this.time > 0.8) {
      this.landingSpeed = Math.abs(radialSpeed) + Math.abs(horizontalSpeed) * 0.25;
      this.landed = this.landingSpeed < 18;
      this.crashed = !this.landed;
      this.finish(true);
    }
  }

  emitHud() {
    const r = len(this.pos);
    const altitude = Math.max(0, r - WORLD.radius);
    const up = norm(this.pos);
    const east = { x: up.y, y: -up.x };
    const speed = len(this.vel);
    const vs = dot(this.vel, up);
    const hs = dot(this.vel, east);
    const stage = activeRuntimeStage(this.parts);
    const firstStage = stage ? runtimeStageGroups(this.parts).length : 0;
    const stageThrust = stage ? stage.items.reduce((sum, item) => sum + (item.def.engine ? item.def.engine.thrust : 0), 0) : 0;
    const twr = runtimeMass(this.parts) > 0 ? stageThrust / (runtimeMass(this.parts) * WORLD.g0) : 0;
    this.onHud({
      altitude: formatMeters(altitude),
      speed: formatSpeed(speed),
      vspeed: formatSpeed(vs),
      hspeed: formatSpeed(hs),
      apoapsis: formatMeters(this.apoapsis),
      periapsis: formatMeters(this.periapsis),
      orbit: this.orbitAchieved ? "Stable" : (this.moonRoad ? "Moon road" : "Suborbital"),
      stage: String(firstStage || 1),
      twr: twr.toFixed(2),
      dv: formatSpeed(estimateRuntimeDv(this.parts)),
      throttle: `${Math.round(this.throttle * 100)}%`,
      pitch: `${Math.round(this.pitch * 180 / Math.PI)} deg`,
      time: `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, "0")}`,
      fuel: stageFuelFraction(stage),
      sas: this.sas,
      map: this.map,
      warp: WARP_LEVELS[this.warpIndex],
    });
  }

  render() {
    this.resize();
    if (this.map) this.renderMap();
    else this.renderWorld();
  }

  renderWorld() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const altitude = Math.max(0, len(this.pos) - WORLD.radius);
    const skyMix = clamp(altitude / WORLD.atmosphere, 0, 1);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, skyMix < 0.85 ? "#85cbff" : "#111d34");
    grad.addColorStop(0.55, skyMix < 0.85 ? "#dff5ff" : "#20355f");
    grad.addColorStop(1, skyMix < 0.85 ? "#f8e5ad" : "#070b17");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (skyMix > 0.35) {
      ctx.fillStyle = `rgba(255,255,255,${(skyMix - 0.35) * 0.9})`;
      for (let i = 0; i < 70; i++) {
        const x = (i * 97) % w;
        const y = (i * 53) % Math.max(1, h * 0.7);
        ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
      }
    }

    const pxPerM = clamp(270 / (altitude + 260), 0.00045, 0.75);
    const rocketX = w * 0.5;
    const rocketY = h * 0.52;
    const groundY = rocketY + altitude * pxPerM;
    if (groundY < h + 80) {
      ctx.fillStyle = this.tier.id >= 3 ? "#7c8f8d" : "#77aa67";
      ctx.fillRect(0, groundY, w, h - groundY);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(0, groundY, w, 4);
      this.drawPad(ctx, w * 0.5, groundY, pxPerM);
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.38)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = Math.max(0, this.trail.length - 90); i < this.trail.length; i++) {
      const p = this.trail[i];
      const dx = (p.x - this.pos.x) * pxPerM;
      const dy = -(p.y - this.pos.y) * pxPerM;
      if (i === Math.max(0, this.trail.length - 90)) ctx.moveTo(rocketX + dx, rocketY + dy);
      else ctx.lineTo(rocketX + dx, rocketY + dy);
    }
    ctx.stroke();
    ctx.restore();

    if (this.lastThrust > 0) this.drawFlame(ctx, rocketX, rocketY);

    const stats = computeStats({ name: this.design.name, parts: this.parts.map(item => item.id) });
    const scale = clamp(230 / Math.max(2, stats.totalHeight), 16, 52);
    ctx.save();
    ctx.translate(rocketX, rocketY);
    ctx.rotate(this.pitch);
    drawRocketStack(ctx, { parts: this.parts.map(item => item.id) }, { x: 0, y: -stats.totalHeight * scale / 2, scale });
    ctx.restore();

    if (this.message && this.time < this.messageUntil) {
      ctx.fillStyle = "rgba(255,250,235,0.92)";
      ctx.strokeStyle = "rgba(38,50,71,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(w / 2 - 120, 72, 240, 34, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#263247";
      ctx.font = "800 13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(this.message, w / 2, 94);
    }
  }

  drawPad(ctx, x, y, pxPerM) {
    const s = clamp(pxPerM * 45, 0.5, 1.4);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = this.tier.id <= 0 ? "#d8aa63" : this.tier.id < 3 ? "#8593a3" : "#657384";
    ctx.fillRect(-46, -8, 92, 8);
    if (this.tier.id >= 1) {
      ctx.fillRect(-62, -18, 124, 10);
      ctx.strokeStyle = "#4b5b6d";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(38, -18);
      ctx.lineTo(58, -82);
      ctx.lineTo(58, -18);
      ctx.stroke();
    }
    if (this.tier.id >= 3) {
      ctx.fillStyle = "#4b5b6d";
      ctx.fillRect(-92, -16, 184, 8);
      ctx.strokeStyle = "#4b5b6d";
      ctx.beginPath();
      ctx.moveTo(-78, -16);
      ctx.lineTo(-78, -96);
      ctx.moveTo(-78, -78);
      ctx.lineTo(-22, -42);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFlame(ctx, x, y) {
    const stats = computeStats({ parts: this.parts.map(item => item.id) });
    const scale = clamp(230 / Math.max(2, stats.totalHeight), 16, 52);
    const bottom = stats.totalHeight * scale / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.pitch);
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = "#ffb347";
    ctx.beginPath();
    ctx.moveTo(-12, bottom - 2);
    ctx.lineTo(0, bottom + 32 + Math.random() * 10);
    ctx.lineTo(12, bottom - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff1a8";
    ctx.beginPath();
    ctx.moveTo(-6, bottom);
    ctx.lineTo(0, bottom + 20 + Math.random() * 5);
    ctx.lineTo(6, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  renderMap() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = "#071023";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (let i = 0; i < 90; i++) ctx.fillRect((i * 113) % w, (i * 71) % h, 1, 1);

    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(w, h) * 0.26 / WORLD.radius;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "#5ea46a";
    ctx.beginPath();
    ctx.arc(0, 0, WORLD.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(132,197,244,0.34)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, (WORLD.radius + WORLD.atmosphere) * scale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.54)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const points = this.projectOrbit(620, 18);
    points.forEach((p, index) => {
      const x = p.x * scale;
      const y = -p.y * scale;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const shipX = this.pos.x * scale;
    const shipY = -this.pos.y * scale;
    ctx.fillStyle = "#f29e4c";
    ctx.beginPath();
    ctx.arc(shipX, shipY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff8eb";
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(255,250,235,0.9)";
    ctx.font = "800 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Map view: white path is coast trajectory, blue ring is atmosphere", w / 2, h - 26);
  }

  projectOrbit(count, dt) {
    let pos = { ...this.pos };
    let vel = { ...this.vel };
    const points = [];
    for (let i = 0; i < count; i++) {
      points.push({ ...pos });
      const r = len(pos);
      if (r < WORLD.radius) break;
      const up = norm(pos);
      const gravity = mul(up, -WORLD.mu / (r * r));
      vel = add(vel, mul(gravity, dt));
      pos = add(pos, mul(vel, dt));
      if (len(pos) > WORLD.radius * 6) break;
    }
    return points;
  }
}
