// Projectiles, mines, flares, explosions and particle FX.
import { TAU, clamp, wrapAngle } from './util.js';

export class Bullet {
  constructor(owner, x, y, angle, w) {
    this.owner = owner.id;
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * w.speed + owner.vx * 0.5;
    this.vy = Math.sin(angle) * w.speed + owner.vy * 0.5;
    this.dmg = w.dmg;
    this.life = (w.range || 500) / w.speed;
    this.alive = true;
  }
  update(dt, world) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    // Substep so fast bullets do not tunnel through thin ships.
    const steps = 2;
    for (let i = 0; i < steps && this.alive; i++) {
      this.x += this.vx * dt / steps;
      this.y += this.vy * dt / steps;
      if (world.hitAsteroid(this.x, this.y)) { this.alive = false; world.spark(this.x, this.y, '#c9b28a'); return; }
      for (const ship of world.ships) {
        if (!ship.alive || ship.id === this.owner) continue;
        const dx = ship.x - this.x, dy = ship.y - this.y;
        if (dx * dx + dy * dy > ship.radius * ship.radius) continue;
        const part = ship.partAtWorld(this.x, this.y);
        if (part) {
          this.alive = false;
          world.spark(this.x, this.y, '#ffd27a');
          if (ship.authority) ship.applyDamageAt(this.x, this.y, this.dmg, this.owner, world);
          return;
        }
      }
    }
  }
  render(ctx) {
    ctx.strokeStyle = '#ffe9b0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.vx * 0.016, this.y - this.vy * 0.016);
    ctx.stroke();
  }
}

export class Rocket {
  constructor(owner, x, y, angle, w) {
    this.owner = owner.id;
    this.x = x; this.y = y; this.angle = angle;
    this.vx = Math.cos(angle) * w.speed + owner.vx * 0.6;
    this.vy = Math.sin(angle) * w.speed + owner.vy * 0.6;
    this.w = w;
    this.life = 2.2;
    this.alive = true;
  }
  update(dt, world) {
    this.life -= dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.life <= 0 || world.hitAsteroid(this.x, this.y)) { this.explode(world); return; }
    for (const ship of world.ships) {
      if (!ship.alive || ship.id === this.owner) continue;
      const dx = ship.x - this.x, dy = ship.y - this.y;
      if (dx * dx + dy * dy > ship.radius * ship.radius) continue;
      if (ship.partAtWorld(this.x, this.y)) { this.explode(world); return; }
    }
  }
  explode(world) {
    if (!this.alive) return;
    this.alive = false;
    world.explosion(this.x, this.y, this.w.radius, this.w.dmg, this.owner);
  }
  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.atan2(this.vy, this.vx));
    ctx.fillStyle = '#e8b06a';
    ctx.fillRect(-6, -2, 10, 4);
    ctx.fillStyle = '#ff8c42';
    ctx.fillRect(-10, -1.4, 4, 2.8);
    ctx.restore();
  }
}

export class Missile {
  constructor(owner, x, y, angle, w, targetId) {
    this.owner = owner.id;
    this.x = x; this.y = y; this.angle = angle;
    this.speed = w.speed * 0.5; // accelerates after launch
    this.w = w;
    this.targetId = targetId;   // ship id or flare object
    this.flareTarget = null;
    this.life = w.life;
    this.alive = true;
    this.trail = 0;
  }
  update(dt, world) {
    this.life -= dt;
    if (this.life <= 0) { this.explode(world); return; }
    this.speed = Math.min(this.w.speed * 1.35, this.speed + 260 * dt);

    // Flares within seek cone steal the lock.
    if (!this.flareTarget) {
      let best = null, bd = 220 * 220;
      for (const f of world.flares) {
        if (!f.alive || f.owner === this.owner) continue;
        const d2 = (f.x - this.x) ** 2 + (f.y - this.y) ** 2;
        if (d2 < bd) { bd = d2; best = f; }
      }
      if (best) this.flareTarget = best;
    }
    let tx = null, ty = null;
    if (this.flareTarget && this.flareTarget.alive) {
      tx = this.flareTarget.x; ty = this.flareTarget.y;
    } else {
      this.flareTarget = null;
      const t = world.shipById(this.targetId);
      if (t && t.alive) { tx = t.x; ty = t.y; }
    }
    if (tx != null) {
      const want = Math.atan2(ty - this.y, tx - this.x);
      const diff = wrapAngle(want - this.angle);
      this.angle += clamp(diff, -this.w.turn * dt, this.w.turn * dt);
    }
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;

    this.trail -= dt;
    if (this.trail <= 0) { this.trail = 0.03; world.smoke(this.x, this.y); }

    if (world.hitAsteroid(this.x, this.y)) { this.explode(world); return; }
    for (const ship of world.ships) {
      if (!ship.alive || ship.id === this.owner) continue;
      const dx = ship.x - this.x, dy = ship.y - this.y;
      if (dx * dx + dy * dy > ship.radius * ship.radius) continue;
      if (ship.partAtWorld(this.x, this.y)) { this.explode(world); return; }
    }
    // Flares also detonate missiles on contact.
    if (this.flareTarget && this.flareTarget.alive) {
      const d2 = (this.flareTarget.x - this.x) ** 2 + (this.flareTarget.y - this.y) ** 2;
      if (d2 < 18 * 18) { this.explode(world); }
    }
  }
  explode(world) {
    if (!this.alive) return;
    this.alive = false;
    world.explosion(this.x, this.y, this.w.radius, this.w.dmg, this.owner);
  }
  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#d94f4f';
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-6, -3.4); ctx.lineTo(-4, 0); ctx.lineTo(-6, 3.4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

export class Mine {
  constructor(owner, x, y, w) {
    this.owner = owner.id;
    this.x = x; this.y = y;
    this.w = w;
    this.arm = 0.9;
    this.life = 40;
    this.alive = true;
  }
  update(dt, world) {
    this.arm -= dt; this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    if (this.arm > 0) return;
    for (const ship of world.ships) {
      if (!ship.alive || ship.id === this.owner) continue;
      const d2 = (ship.x - this.x) ** 2 + (ship.y - this.y) ** 2;
      const trig = ship.radius + 34;
      if (d2 < trig * trig) {
        this.alive = false;
        world.explosion(this.x, this.y, this.w.radius, this.w.dmg, this.owner);
        return;
      }
    }
  }
  render(ctx) {
    const blink = this.arm <= 0 && Math.floor(performance.now() / 400) % 2 === 0;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = '#4a3f66';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#6a5d8a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
      ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
    }
    ctx.stroke();
    ctx.fillStyle = blink ? '#ff5d5d' : '#7a2b2b';
    ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

export class Flare {
  constructor(owner, x, y, angle, life) {
    this.owner = owner.id;
    this.x = x; this.y = y;
    const sp = 90 + Math.random() * 60;
    this.vx = Math.cos(angle) * sp + owner.vx * 0.8;
    this.vy = Math.sin(angle) * sp + owner.vy * 0.8;
    this.life = life;
    this.alive = true;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.vx *= Math.exp(-1.4 * dt); this.vy *= Math.exp(-1.4 * dt);
    this.x += this.vx * dt; this.y += this.vy * dt;
  }
  render(ctx) {
    const f = 0.6 + 0.4 * Math.sin(performance.now() / 60 + this.x);
    ctx.fillStyle = `rgba(255, 220, 110, ${f})`;
    ctx.beginPath(); ctx.arc(this.x, this.y, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 255, ${f * 0.8})`;
    ctx.beginPath(); ctx.arc(this.x, this.y, 1.6, 0, TAU); ctx.fill();
  }
}

// Lightweight particle for sparks / smoke / debris / explosions.
export class Particle {
  constructor(x, y, vx, vy, life, size, color, drag = 2, fade = true) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.size = size; this.color = color; this.drag = drag; this.fade = fade;
    this.alive = true;
    this.rot = Math.random() * TAU;
    this.vrot = (Math.random() - 0.5) * 6;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    const d = Math.exp(-this.drag * dt);
    this.vx *= d; this.vy *= d;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.rot += this.vrot * dt;
  }
  render(ctx) {
    const t = this.life / this.maxLife;
    ctx.globalAlpha = this.fade ? t : 1;
    ctx.fillStyle = this.color;
    const s = this.size * (0.5 + t * 0.5);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
