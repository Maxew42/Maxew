import { PARTS, WORLD, getPart } from "./data.js";

export function createDesign(name = "First Spark", parts = []) {
  return { id: String(Date.now()), name, parts: [...parts] };
}

export function sanitizeDesign(design) {
  const parts = Array.isArray(design?.parts) ? design.parts.filter(id => getPart(id)) : [];
  return {
    id: design?.id || String(Date.now()),
    name: String(design?.name || "Untitled Rocket").slice(0, 32),
    parts,
  };
}

export function defaultDesignForTier(tierId) {
  if (tierId <= 0) {
    return createDesign("Bottle One", ["paper-cone", "water-bottle", "wood-fins", "cork-nozzle"]);
  }
  if (tierId === 1) {
    return createDesign("School Bell", ["student-cone", "student-chute", "aluminum-body", "servo-fins", "powder-booster"]);
  }
  if (tierId === 2) {
    return createDesign("Garage Needle", [
      "avionics-core",
      "student-chute",
      "small-liquid-tank",
      "puddlehopper",
      "light-decoupler",
      "small-liquid-tank",
      "puddlehopper",
    ]);
  }
  if (tierId === 3) {
    return createDesign("Orbit Try", [
      "probe-core",
      "orbital-tank",
      "vacuum-engine",
      "orbital-decoupler",
      "booster-tank",
      "mainstay-engine",
    ]);
  }
  return createDesign("Moon Letter", [
    "crew-capsule",
    "service-module",
    "lunar-engine",
    "heavy-decoupler",
    "heavy-tank",
    "atlas-engine",
  ]);
}

export function partMass(part, fuelFraction = 1) {
  return part.dryMass + (part.fuelMass || 0) * fuelFraction;
}

export function stageGroups(partIds) {
  const parts = partIds.map(getPart).filter(Boolean);
  if (!parts.length) return [];
  const groups = [];
  let start = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].decoupler) {
      if (start < i) groups.push({ start, end: i - 1, parts: parts.slice(start, i) });
      start = i;
    }
  }
  if (start < parts.length) groups.push({ start, end: parts.length - 1, parts: parts.slice(start) });
  return groups;
}

export function bottomFirstStages(partIds) {
  return stageGroups(partIds).slice().reverse();
}

function stageEngineStats(parts, atmospherePressure = 0) {
  let thrust = 0;
  let weightedIsp = 0;
  let engineCount = 0;
  const fuelTypes = new Set();
  for (const part of parts) {
    if (!part.engine) continue;
    const isp = part.engine.ispVac * (1 - atmospherePressure) + part.engine.ispSea * atmospherePressure;
    thrust += part.engine.thrust;
    weightedIsp += isp * part.engine.thrust;
    engineCount += 1;
    fuelTypes.add(part.engine.fuelType);
  }
  return {
    thrust,
    isp: thrust > 0 ? weightedIsp / thrust : 0,
    engineCount,
    fuelTypes,
  };
}

function fuelForEngineTypes(parts, fuelTypes) {
  let fuel = 0;
  for (const part of parts) {
    if (part.fuelMass && fuelTypes.has(part.fuelType)) fuel += part.fuelMass;
  }
  return fuel;
}

export function computeStats(design) {
  const clean = sanitizeDesign(design);
  const parts = clean.parts.map(getPart);
  const groups = bottomFirstStages(clean.parts);
  const dryMass = parts.reduce((sum, part) => sum + part.dryMass, 0);
  const fuelMass = parts.reduce((sum, part) => sum + (part.fuelMass || 0), 0);
  const wetMass = dryMass + fuelMass;
  const totalHeight = parts.reduce((sum, part) => sum + part.height, 0);
  const maxWidth = parts.reduce((max, part) => Math.max(max, part.width), 0);
  const command = parts.some(part => part.command);
  const crew = parts.some(part => part.crew);
  const parachute = parts.some(part => part.parachute);
  const control = parts.reduce((sum, part) => sum + (part.control || 0), 0);
  const stability = parts.reduce((sum, part) => sum + (part.stability || 0), 0);
  const drag = parts.reduce((sum, part) => sum + (part.drag || 0.5) * part.width, 0) / Math.max(1, parts.length);
  const stageDetails = [];

  let carriedWetMass = wetMass;
  let totalDv = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const engine = stageEngineStats(group.parts, 0);
    const fuel = fuelForEngineTypes(group.parts, engine.fuelTypes);
    const massAfterBurn = Math.max(0.01, carriedWetMass - fuel);
    const dv = engine.thrust > 0 && fuel > 0
      ? Math.max(0, engine.isp * WORLD.g0 * Math.log(carriedWetMass / massAfterBurn))
      : 0;
    totalDv += dv;
    stageDetails.push({
      number: i + 1,
      start: group.start,
      end: group.end,
      parts: group.parts,
      wetMass: group.parts.reduce((sum, part) => sum + partMass(part), 0),
      dryMass: group.parts.reduce((sum, part) => sum + part.dryMass, 0),
      fuelMass: group.parts.reduce((sum, part) => sum + (part.fuelMass || 0), 0),
      thrust: engine.thrust,
      isp: engine.isp,
      twr: carriedWetMass > 0 ? engine.thrust / (carriedWetMass * WORLD.g0) : 0,
      dv,
      engineCount: engine.engineCount,
    });
    carriedWetMass -= group.parts.reduce((sum, part) => sum + partMass(part), 0);
    carriedWetMass = Math.max(0, carriedWetMass);
  }

  const warnings = [];
  if (!parts.length) warnings.push("Add at least one part.");
  if (!parts.some(part => part.engine)) warnings.push("No engine or nozzle is installed.");
  if (wetMass > 0 && stageDetails[0] && stageDetails[0].twr < 1.05) warnings.push("First stage TWR is below 1.05, so it may not lift off.");
  if (parts.length > 0 && !command && !parts.some(part => part.engine?.fuelType === "water")) warnings.push("Add a command part for guided flight.");
  if (parts.some(part => part.engine?.fuelType === "liquid") && !command) warnings.push("Liquid rockets need avionics or a capsule for SAS.");
  if (control <= 0 && parts.some(part => part.engine && part.engine.fuelType !== "water")) warnings.push("No active control surfaces or avionics.");
  if (stageDetails.length > 1 && !parts.some(part => part.decoupler)) warnings.push("Multi-stage designs need decouplers.");
  if (wetMass > 25 && !parachute && !crew) warnings.push("No parachute or landing system for recovery.");

  return {
    design: clean,
    parts,
    dryMass,
    fuelMass,
    wetMass,
    totalHeight,
    maxWidth,
    command,
    crew,
    parachute,
    control,
    stability,
    drag,
    stages: stageDetails,
    totalDv,
    warnings,
    canLaunch: parts.length > 0 && parts.some(part => part.engine) && (!stageDetails[0] || stageDetails[0].twr > 0.25),
  };
}

export function makeRuntimeParts(partIds) {
  return partIds.map((id, index) => {
    const part = getPart(id);
    return {
      uid: `${id}-${index}-${Math.random().toString(36).slice(2)}`,
      id,
      def: part,
      fuel: part.fuelMass || 0,
      chuteDeployed: false,
    };
  }).filter(item => item.def);
}

export function runtimeMass(runtimeParts) {
  return runtimeParts.reduce((sum, item) => sum + item.def.dryMass + item.fuel, 0);
}

export function runtimeDryMass(runtimeParts) {
  return runtimeParts.reduce((sum, item) => sum + item.def.dryMass, 0);
}

export function runtimeStageGroups(runtimeParts) {
  if (!runtimeParts.length) return [];
  const groups = [];
  let start = 0;
  for (let i = 0; i < runtimeParts.length; i++) {
    if (runtimeParts[i].def.decoupler) {
      if (start < i) groups.push({ start, end: i - 1, items: runtimeParts.slice(start, i) });
      start = i;
    }
  }
  if (start < runtimeParts.length) groups.push({ start, end: runtimeParts.length - 1, items: runtimeParts.slice(start) });
  return groups;
}

export function activeRuntimeStage(runtimeParts) {
  const groups = runtimeStageGroups(runtimeParts);
  return groups.length ? groups[groups.length - 1] : null;
}

export function drawPartShape(ctx, part, cx, top, scale, opts = {}) {
  const w = part.width * scale;
  const h = part.height * scale;
  const x = cx - w / 2;
  const y = top;
  ctx.save();
  ctx.lineWidth = Math.max(1.2, scale * 0.025);
  ctx.strokeStyle = opts.selected ? "#25334c" : "rgba(38,50,71,0.34)";
  ctx.fillStyle = part.color || "#ddd";
  ctx.shadowColor = opts.selected ? "rgba(68,120,196,0.28)" : "transparent";
  ctx.shadowBlur = opts.selected ? 12 : 0;

  if (part.shape === "cone") {
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.36)";
    ctx.beginPath();
    ctx.moveTo(cx, y + h * 0.18);
    ctx.lineTo(cx + w * 0.18, y + h * 0.82);
    ctx.lineTo(cx, y + h * 0.82);
    ctx.closePath();
    ctx.fill();
  } else if (part.shape === "capsule") {
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.bezierCurveTo(x + w, y + h * 0.14, x + w * 0.86, y + h, cx, y + h);
    ctx.bezierCurveTo(x + w * 0.14, y + h, x, y + h * 0.14, cx, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#85c8ef";
    ctx.beginPath();
    ctx.arc(cx, y + h * 0.5, Math.min(w, h) * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (part.shape === "engine") {
    ctx.beginPath();
    ctx.roundRect(x + w * 0.13, y, w * 0.74, h * 0.58, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#263247";
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.32, y + h * 0.58);
    ctx.lineTo(cx + w * 0.32, y + h * 0.58);
    ctx.lineTo(cx + w * 0.44, y + h);
    ctx.lineTo(cx - w * 0.44, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (part.shape === "ring") {
    ctx.beginPath();
    ctx.roundRect(x, y + h * 0.18, w, h * 0.64, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(38,50,71,0.18)";
    ctx.fillRect(x + w * 0.12, y + h * 0.43, w * 0.76, h * 0.16);
  } else if (part.shape === "fins") {
    ctx.beginPath();
    ctx.roundRect(cx - w * 0.22, y + h * 0.12, w * 0.44, h * 0.76, 4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.22, y + h * 0.28);
    ctx.lineTo(x, y + h);
    ctx.lineTo(cx - w * 0.2, y + h * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.22, y + h * 0.28);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(cx + w * 0.2, y + h * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (part.shape === "wings") {
    ctx.beginPath();
    ctx.roundRect(cx - w * 0.22, y + h * 0.1, w * 0.44, h * 0.8, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8ed5f5";
    ctx.strokeStyle = "rgba(38,50,71,0.24)";
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.22, y + h * 0.18);
    ctx.lineTo(x, y + h * 0.8);
    ctx.lineTo(cx - w * 0.22, y + h * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.22, y + h * 0.18);
    ctx.lineTo(x + w, y + h * 0.8);
    ctx.lineTo(cx + w * 0.22, y + h * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (part.shape === "chute") {
    ctx.beginPath();
    ctx.roundRect(x + w * 0.08, y + h * 0.22, w * 0.84, h * 0.56, 7);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(38,50,71,0.28)";
    for (let i = 1; i < 4; i++) {
      const px = x + (w * i) / 4;
      ctx.beginPath();
      ctx.moveTo(px, y + h * 0.26);
      ctx.lineTo(px, y + h * 0.74);
      ctx.stroke();
    }
  } else if (part.shape === "legs") {
    ctx.beginPath();
    ctx.roundRect(cx - w * 0.24, y + h * 0.18, w * 0.48, h * 0.48, 4);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#263247";
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.18, y + h * 0.62);
    ctx.lineTo(x + w * 0.05, y + h);
    ctx.moveTo(cx + w * 0.18, y + h * 0.62);
    ctx.lineTo(x + w * 0.95, y + h);
    ctx.stroke();
  } else {
    const radius = part.shape === "bottle" ? 12 : 6;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.roundRect(x + w * 0.12, y + h * 0.08, w * 0.22, h * 0.84, 5);
    ctx.fill();
    if (part.fuelMass) {
      ctx.fillStyle = "rgba(68,120,196,0.18)";
      ctx.fillRect(x + w * 0.08, y + h * 0.58, w * 0.84, h * 0.34);
    }
  }
  ctx.restore();
}

export function drawPartIcon(canvas, part) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const scale = Math.min(cssW / (part.width * 1.5), cssH / (part.height * 1.18));
  drawPartShape(ctx, part, cssW / 2, (cssH - part.height * scale) / 2, scale);
}

export function drawRocketStack(ctx, design, options = {}) {
  const parts = sanitizeDesign(design).parts.map(getPart);
  const scale = options.scale || 46;
  const cx = options.x || 0;
  const top = options.y || 0;
  let y = top;
  const boxes = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const h = part.height * scale;
    const w = part.width * scale;
    if (options.stageBands) {
      ctx.save();
      ctx.globalAlpha = part.decoupler ? 0.22 : 0.08;
      ctx.fillStyle = part.decoupler ? "#f29e4c" : "#4478c4";
      ctx.fillRect(cx - Math.max(w, 70) / 2 - 5, y, Math.max(w, 70) + 10, h);
      ctx.restore();
    }
    drawPartShape(ctx, part, cx, y, scale, { selected: options.selectedIndex === i });
    boxes.push({ index: i, x: cx - w / 2, y, w, h });
    y += h;
  }
  return boxes;
}

export function formatMass(kg) {
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  if (kg < 1000) return `${kg.toFixed(1)} kg`;
  return `${(kg / 1000).toFixed(2)} t`;
}

export function formatMeters(meters) {
  if (!Number.isFinite(meters)) return "escape";
  const abs = Math.abs(meters);
  if (abs < 1000) return `${Math.round(meters)} m`;
  if (abs < 1000000) return `${(meters / 1000).toFixed(abs < 10000 ? 1 : 0)} km`;
  return `${(meters / 1000000).toFixed(2)} Mm`;
}

export function formatSpeed(speed) {
  if (Math.abs(speed) < 1000) return `${Math.round(speed)} m/s`;
  return `${(speed / 1000).toFixed(2)} km/s`;
}
