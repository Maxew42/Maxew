import { CELL, clamp, localToWorld, uid, worldToLocal } from './util.js';
import { PARTS, blueprintStats, normalizeBlueprint, partLocalBounds } from './parts.js';

const LAYER_ALPHA = new Map([[-1, 0.74], [0, 1], [1, 0.94]]);

export class Ship {
  constructor({ id, name, blueprint, color = '#68e1fd', ai = false, peerId = null }) {
    this.id = id || uid('ship');
    this.peerId = peerId || this.id;
    this.name = name || 'Pilot';
    this.color = color;
    this.ai = ai;
    this.blueprint = normalizeBlueprint(blueprint);
    this.parts = this.blueprint.parts.map((part, index) => {
      const def = PARTS[part.type];
      return {
        ...part,
        uid: `${this.id}-part-${index}`,
        hp: def.hp,
        maxHp: def.hp,
        cooldown: Math.random() * 0.2,
        dead: false,
        flash: 0,
      };
    });
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.av = 0;
    this.energy = 0;
    this.maxEnergy = 1;
    this.regen = 1;
    this.radius = 38;
    this.dead = false;
    this.deathTimer = 0;
    this.shieldPulse = 0;
    this.thrustPulse = 0;
    this.lastDamageAt = null;
    this.score = 0;
    this._statsDirty = true;
    this.stats = {};
    this.recalculateStats();
    this.energy = this.maxEnergy;
  }

  recalculateStats() {
    const bp = { parts: this.liveParts().map(part => ({ type: part.type, x: part.x, y: part.y, layer: part.layer })) };
    const s = blueprintStats(bp);
    const bounds = this.liveParts().reduce((acc, part) => {
      const b = partLocalBounds(part);
      acc.x1 = Math.min(acc.x1, b.x1);
      acc.y1 = Math.min(acc.y1, b.y1);
      acc.x2 = Math.max(acc.x2, b.x2);
      acc.y2 = Math.max(acc.y2, b.y2);
      return acc;
    }, { x1: 0, y1: 0, x2: 0, y2: 0 });
    const width = bounds.x2 - bounds.x1;
    const height = bounds.y2 - bounds.y1;
    this.radius = Math.max(26, Math.hypot(width, height) * 0.52);
    this.maxEnergy = Math.max(40, s.energy);
    this.regen = Math.max(5, s.regen);
    this.stats = {
      hp: s.hp,
      mass: Math.max(18, s.mass + 12),
      thrust: s.thrust,
      torque: s.torque,
      maxSpeed: clamp(160 + (s.thrust / Math.max(28, s.mass + 12)) * 22, 185, 520),
      accel: clamp((s.thrust / Math.max(42, s.mass + 24)) * 215, 180, 1750),
      turnAccel: clamp(2.4 + (s.torque * 42) / Math.max(42, s.mass + 20), 2.8, 13),
      maxTurnRate: clamp(2.4 + (s.torque * 5.4) / Math.max(48, s.mass * 0.55), 3, 7.2),
      headingAssist: clamp(0.55 + s.torque / Math.max(40, s.mass) * 3.8, 0.65, 1.45),
      drag: clamp(0.55 + s.mass / 190, 0.7, 1.8),
    };
    this.energy = Math.min(this.energy, this.maxEnergy);
    this.dead = !this.hasLiveCockpit();
    this._statsDirty = false;
  }

  liveParts() {
    return this.parts.filter(part => !part.dead);
  }

  hasLiveCockpit() {
    return this.parts.some(part => !part.dead && PARTS[part.type]?.cockpit);
  }

  totalHp() {
    return this.liveParts().reduce((sum, part) => sum + Math.max(0, part.hp), 0);
  }

  update(dt, controls, arena) {
    if (this._statsDirty) this.recalculateStats();
    for (const part of this.parts) {
      part.cooldown = Math.max(0, part.cooldown - dt);
      part.flash = Math.max(0, part.flash - dt * 5);
    }
    this.shieldPulse = Math.max(0, this.shieldPulse - dt * 2.6);
    this.thrustPulse = Math.max(0, this.thrustPulse - dt * 3);

    if (this.dead) {
      this.deathTimer += dt;
      this.vx *= Math.exp(-dt * 0.6);
      this.vy *= Math.exp(-dt * 0.6);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.av *= Math.exp(-dt * 0.8);
      this.angle += this.av * dt;
      return;
    }

    this.energy = Math.min(this.maxEnergy, this.energy + this.regen * dt);
    const turn = clamp(controls.turn || 0, -1, 1);
    const thrust = clamp(controls.thrust || 0, 0, 1);
    const brake = clamp(controls.brake || 0, 0, 1);
    const boosting = controls.boost && this.energy > 2 && thrust > 0.1;
    const boostScale = boosting ? 1.35 : 1;
    if (boosting) {
      this.energy = Math.max(0, this.energy - 24 * dt);
      this.thrustPulse = 1;
    }

    this.av += turn * this.stats.turnAccel * dt;
    this.av *= Math.exp(-dt * (1.55 + brake * 1.15));
    this.av = clamp(this.av, -this.stats.maxTurnRate, this.stats.maxTurnRate);
    this.angle += this.av * dt;

    const fwdX = Math.sin(this.angle);
    const fwdY = -Math.cos(this.angle);
    if (thrust > 0) {
      this.vx += fwdX * this.stats.accel * boostScale * thrust * dt;
      this.vy += fwdY * this.stats.accel * boostScale * thrust * dt;
      this.thrustPulse = Math.max(this.thrustPulse, thrust * 0.65);
    }
    if (brake > 0) {
      this.vx -= fwdX * this.stats.accel * 0.45 * brake * dt;
      this.vy -= fwdY * this.stats.accel * 0.45 * brake * dt;
    }

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 20 && (thrust > 0 || brake > 0 || Math.abs(turn) > 0.08)) {
      const forwardSpeed = this.vx * fwdX + this.vy * fwdY;
      const sideSpeed = this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle);
      const assist = clamp(this.stats.headingAssist * dt, 0, 0.18);
      this.vx -= Math.cos(this.angle) * sideSpeed * assist;
      this.vy -= Math.sin(this.angle) * sideSpeed * assist;
      if (forwardSpeed > 0) {
        this.vx += fwdX * forwardSpeed * assist * 0.08;
        this.vy += fwdY * forwardSpeed * assist * 0.08;
      }
    }

    const speedAfterAssist = Math.hypot(this.vx, this.vy);
    const maxSpeed = this.stats.maxSpeed * boostScale;
    if (speedAfterAssist > maxSpeed) {
      const scale = maxSpeed / speedAfterAssist;
      this.vx *= scale;
      this.vy *= scale;
    }
    const drag = Math.exp(-dt * (this.stats.drag + brake * 1.5));
    this.vx *= drag;
    this.vy *= drag;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    keepInsideArena(this, arena);
  }

  takeDamage(amount, wx, wy, source = {}) {
    if (this.dead || amount <= 0) return { blocked: true, destroyed: false };
    let damage = amount;
    if (this.energy > 0.25) {
      const block = Math.min(damage * 0.78, this.energy * 1.8);
      this.energy = Math.max(0, this.energy - block / 1.8);
      damage -= block;
      this.shieldPulse = 1;
    }
    if (damage <= 0.7) return { blocked: true, destroyed: false };

    const hit = this.partAtWorld(wx, wy) || this.nearestLivePart(wx, wy);
    if (!hit) {
      this.dead = true;
      return { blocked: false, destroyed: true };
    }

    const def = PARTS[hit.type];
    const applied = damage * (1 - (def.armor || 0));
    hit.hp -= applied;
    hit.flash = 1;
    this.lastDamageAt = { x: wx, y: wy, amount: applied, angle: source.angle || 0 };
    if (hit.hp <= 0) {
      hit.dead = true;
      hit.hp = 0;
      this._statsDirty = true;
    }
    if (!this.hasLiveCockpit() || this.totalHp() <= 0) {
      this.dead = true;
      this.deathTimer = 0;
    }
    return { blocked: false, destroyed: hit.dead, part: hit };
  }

  nearestLivePart(wx, wy) {
    const loc = worldToLocal(this, wx, wy);
    let best = null;
    let bestD = Infinity;
    for (const part of this.liveParts()) {
      const dx = loc.x - part.x * CELL;
      const dy = loc.y - part.y * CELL;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = part;
      }
    }
    return best;
  }

  partAtWorld(wx, wy) {
    const loc = worldToLocal(this, wx, wy);
    return this.partAtLocal(loc.x, loc.y);
  }

  partAtLocal(lx, ly) {
    const parts = this.liveParts().slice().sort((a, b) => Math.abs(b.layer) - Math.abs(a.layer));
    return parts.find(part => pointHitsPart(part, lx, ly)) || null;
  }

  partMount(part, forwardOffset = 0.55) {
    return localToWorld(this, part.x * CELL, part.y * CELL - CELL * forwardOffset);
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      vx: Math.round(this.vx * 10) / 10,
      vy: Math.round(this.vy * 10) / 10,
      angle: Math.round(this.angle * 1000) / 1000,
      av: Math.round(this.av * 1000) / 1000,
      energy: Math.round(this.energy),
      maxEnergy: Math.round(this.maxEnergy),
      dead: this.dead,
      parts: this.parts.map(part => ({ hp: Math.round(part.hp), dead: part.dead })),
    };
  }

  applySnapshot(s, snap = 0.36) {
    this.x += (s.x - this.x) * snap;
    this.y += (s.y - this.y) * snap;
    this.vx = s.vx || 0;
    this.vy = s.vy || 0;
    this.angle += ((((s.angle || 0) - this.angle + Math.PI) % (Math.PI * 2)) - Math.PI) * snap;
    this.av = s.av || 0;
    this.energy = s.energy ?? this.energy;
    this.maxEnergy = s.maxEnergy ?? this.maxEnergy;
    this.dead = !!s.dead;
    if (Array.isArray(s.parts)) {
      for (let i = 0; i < Math.min(s.parts.length, this.parts.length); i++) {
        const remote = s.parts[i];
        this.parts[i].hp += ((remote.hp ?? this.parts[i].hp) - this.parts[i].hp) * 0.55;
        this.parts[i].dead = !!remote.dead;
      }
    }
  }

  draw(ctx, options = {}) {
    const alpha = options.alpha ?? 1;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    if (this.shieldPulse > 0 || (!this.dead && this.energy > this.maxEnergy * 0.35 && options.local)) {
      const a = Math.max(this.shieldPulse * 0.7, options.local ? 0.08 : 0);
      ctx.save();
      ctx.globalAlpha = a * alpha;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 9 + this.shieldPulse * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 0.28 * alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(5, 8, this.radius * 0.72, this.radius * 0.43, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;

    for (const layer of [-1, 0, 1]) {
      const layerParts = this.parts.filter(part => !part.dead && part.layer === layer);
      for (const part of layerParts) {
        const def = PARTS[part.type];
        ctx.save();
        ctx.translate(part.x * CELL, part.y * CELL);
        ctx.globalAlpha = alpha * (LAYER_ALPHA.get(layer) || 1);
        drawPartShape(ctx, def, part);
        drawDamage(ctx, part);
        if (part.flash > 0) {
          ctx.globalAlpha = part.flash * 0.55 * alpha;
          ctx.fillStyle = '#ffffff';
          fillShape(ctx, def.shape, CELL * 0.48);
        }
        ctx.restore();
      }
    }

    if (!this.dead && this.thrustPulse > 0) {
      const reactors = this.liveParts().filter(part => PARTS[part.type]?.thrust);
      for (const part of reactors) {
        ctx.save();
        ctx.translate(part.x * CELL, part.y * CELL + CELL * 0.53);
        const glow = this.thrustPulse;
        ctx.globalAlpha = glow * alpha;
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, CELL * 0.8);
        g.addColorStop(0, '#fff3a3');
        g.addColorStop(0.35, '#ff8a56');
        g.addColorStop(1, 'rgba(255,58,81,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, CELL * 0.23, CELL * 0.28, CELL * (0.65 + glow * 0.45), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();

    if (options.label !== false) {
      drawShipLabel(ctx, this, alpha);
    }
  }
}

export function drawBlueprint(ctx, blueprint, opts = {}) {
  const bp = normalizeBlueprint(blueprint);
  const parts = bp.parts || [];
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const bounds = parts.reduce((acc, part) => {
    const b = partLocalBounds(part);
    acc.x1 = Math.min(acc.x1, b.x1);
    acc.y1 = Math.min(acc.y1, b.y1);
    acc.x2 = Math.max(acc.x2, b.x2);
    acc.y2 = Math.max(acc.y2, b.y2);
    return acc;
  }, { x1: -CELL, y1: -CELL, x2: CELL, y2: CELL });
  const w = bounds.x2 - bounds.x1 + CELL;
  const h = bounds.y2 - bounds.y1 + CELL;
  const scale = Math.min((ctx.canvas.width - 16) / w, (ctx.canvas.height - 16) / h, opts.scale || 3);
  ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(bounds.x1 + bounds.x2) / 2, -(bounds.y1 + bounds.y2) / 2);
  for (const layer of [-1, 0, 1]) {
    for (const part of parts.filter(item => item.layer === layer)) {
      const def = PARTS[part.type];
      ctx.save();
      ctx.translate(part.x * CELL, part.y * CELL);
      ctx.globalAlpha = LAYER_ALPHA.get(layer) || 1;
      drawPartShape(ctx, def, { ...part, hp: def.hp, maxHp: def.hp, flash: 0 });
      ctx.restore();
    }
  }
  ctx.restore();
}

export function drawPartShape(ctx, def, part = {}) {
  const half = CELL * 0.48;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.fillStyle = def.color;
  ctx.strokeStyle = shade(def.color, -46);
  ctx.lineWidth = 2;
  fillShape(ctx, def.shape, half);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha *= 0.23;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-half * 0.55, -half * 0.42);
  ctx.lineTo(half * 0.42, -half * 0.42);
  ctx.stroke();
  ctx.restore();

  drawPartDetails(ctx, def, half, part);
}

export function fillShape(ctx, shape, half) {
  ctx.beginPath();
  switch (shape) {
    case 'nose':
      ctx.moveTo(0, -half);
      ctx.lineTo(half, half);
      ctx.lineTo(-half, half);
      ctx.closePath();
      break;
    case 'wedgeLeft':
      ctx.moveTo(-half, -half);
      ctx.lineTo(half, half);
      ctx.lineTo(-half, half);
      ctx.closePath();
      break;
    case 'wedgeRight':
      ctx.moveTo(half, -half);
      ctx.lineTo(half, half);
      ctx.lineTo(-half, half);
      ctx.closePath();
      break;
    case 'cockpitRound':
      ctx.arc(0, 0, half * 0.95, 0, Math.PI * 2);
      break;
    case 'cockpitLong':
      ctx.moveTo(0, -half);
      ctx.quadraticCurveTo(half * 0.74, -half * 0.28, half * 0.55, half);
      ctx.lineTo(-half * 0.55, half);
      ctx.quadraticCurveTo(-half * 0.74, -half * 0.28, 0, -half);
      ctx.closePath();
      break;
    default:
      ctx.rect(-half, -half, half * 2, half * 2);
      break;
  }
}

function drawPartDetails(ctx, def, half, part) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(def.color, -62);
  ctx.fillStyle = shade(def.color, -35);
  switch (def.shape) {
    case 'reactor':
      ctx.fillRect(-half * 0.42, half * 0.12, half * 0.84, half * 0.55);
      ctx.strokeRect(-half * 0.42, -half * 0.52, half * 0.84, half * 0.95);
      break;
    case 'cell':
      ctx.strokeStyle = '#1d6d5c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-half * 0.48, 0);
      ctx.lineTo(half * 0.48, 0);
      ctx.stroke();
      break;
    case 'gun':
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -half * 0.05);
      ctx.lineTo(0, -half * 1.05);
      ctx.stroke();
      ctx.fillRect(-half * 0.32, -half * 0.15, half * 0.64, half * 0.38);
      break;
    case 'beam':
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#5d35ce';
      ctx.beginPath();
      ctx.moveTo(0, half * 0.5);
      ctx.lineTo(0, -half * 0.9);
      ctx.stroke();
      ctx.fillStyle = '#d7c6ff';
      ctx.beginPath();
      ctx.arc(0, -half * 0.38, half * 0.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'missile':
      ctx.fillStyle = '#6c2630';
      ctx.fillRect(-half * 0.45, -half * 0.62, half * 0.32, half * 1.16);
      ctx.fillRect(half * 0.13, -half * 0.62, half * 0.32, half * 1.16);
      break;
    case 'turret':
      ctx.fillStyle = shade(def.color, -25);
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -half);
      ctx.stroke();
      break;
    case 'mine':
      ctx.strokeStyle = '#1e7e65';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * half * 0.2, Math.sin(a) * half * 0.2);
        ctx.lineTo(Math.cos(a) * half * 0.68, Math.sin(a) * half * 0.68);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.32, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'flare':
      ctx.fillStyle = '#6a2f16';
      ctx.fillRect(-half * 0.5, -half * 0.42, half, half * 0.84);
      ctx.fillStyle = '#ffe1a0';
      ctx.fillRect(-half * 0.32, -half * 0.22, half * 0.64, half * 0.16);
      ctx.fillRect(-half * 0.32, half * 0.12, half * 0.64, half * 0.16);
      break;
    case 'cockpitRound':
    case 'cockpitLong':
      ctx.fillStyle = 'rgba(8,22,34,0.5)';
      ctx.strokeStyle = '#c7f7ff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, -half * 0.12, half * 0.46, half * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    default:
      break;
  }
  if (part.layer === -1) {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#10151c';
    ctx.beginPath();
    ctx.moveTo(-half * 0.5, half * 0.55);
    ctx.lineTo(half * 0.5, half * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDamage(ctx, part) {
  const ratio = part.maxHp ? part.hp / part.maxHp : 1;
  if (ratio > 0.72) return;
  const half = CELL * 0.48;
  ctx.save();
  ctx.globalAlpha = Math.min(0.82, (0.74 - ratio) * 1.5);
  ctx.strokeStyle = '#1b0e12';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-half * 0.56, -half * 0.1);
  ctx.lineTo(-half * 0.1, half * 0.16);
  ctx.lineTo(half * 0.24, -half * 0.25);
  ctx.moveTo(half * 0.48, half * 0.26);
  ctx.lineTo(half * 0.08, half * 0.03);
  ctx.stroke();
  if (ratio < 0.38) {
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#06070a';
    ctx.beginPath();
    ctx.arc(half * 0.22, half * 0.1, half * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShipLabel(ctx, ship, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha * (ship.dead ? 0.45 : 0.9);
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = ship.color;
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 5;
  ctx.fillText(ship.name, ship.x, ship.y - ship.radius - 12);
  ctx.restore();
}

function pointHitsPart(part, lx, ly) {
  const rx = lx - part.x * CELL;
  const ry = ly - part.y * CELL;
  const half = CELL * 0.5;
  const def = PARTS[part.type];
  if (Math.abs(rx) > half || Math.abs(ry) > half) return false;
  switch (def.shape) {
    case 'cockpitRound':
      return Math.hypot(rx, ry) <= half * 0.95;
    case 'nose': {
      const t = clamp((ry + half) / (half * 2), 0, 1);
      return Math.abs(rx) <= half * t;
    }
    case 'wedgeLeft': {
      const t = clamp((ry + half) / (half * 2), 0, 1);
      return rx <= -half + half * 2 * t;
    }
    case 'wedgeRight': {
      const t = clamp((ry + half) / (half * 2), 0, 1);
      return rx >= half - half * 2 * t;
    }
    default:
      return true;
  }
}

function keepInsideArena(ship, arena) {
  if (!arena) return;
  const r = arena.radius || 1800;
  const d = Math.hypot(ship.x, ship.y);
  const limit = r - ship.radius;
  if (d > limit) {
    const nx = ship.x / (d || 1);
    const ny = ship.y / (d || 1);
    ship.x = nx * limit;
    ship.y = ny * limit;
    const outward = ship.vx * nx + ship.vy * ny;
    if (outward > 0) {
      ship.vx -= outward * nx * 1.35;
      ship.vy -= outward * ny * 1.35;
    }
  }
}

function shade(hex, amount) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map(ch => ch + ch).join('') : clean, 16);
  const r = clamp(((n >> 16) & 255) + amount, 0, 255);
  const g = clamp(((n >> 8) & 255) + amount, 0, 255);
  const b = clamp((n & 255) + amount, 0, 255);
  return `rgb(${r},${g},${b})`;
}
