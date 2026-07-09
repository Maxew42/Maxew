// Runtime ship: built from a lego design, simulated part-by-part.
import { PARTS, CELL, GRID, BASE_ENERGY, BASE_REGEN, BASE_THRUST, ENERGY_PER_PART, REGEN_PER_PART, placedCells, fireDir, computeStats } from './parts.js';
import { TAU, clamp, wrapAngle, convexHull } from './util.js';

const DAMPING = 0.62;       // linear damping /s
const BOOST_MULT = 1.95;
const BOOST_DRAIN = 32;     // energy/s
const SHIELD_COST = 1.4;    // energy per point of damage blocked

let nextPartUid = 1;

export class Ship {
  constructor(design, { id, name, team = 0, authority = true } = {}) {
    this.id = id;
    this.name = name || design.name || 'Ship';
    this.team = team;
    this.authority = authority; // do we compute damage for this ship?
    this.design = design;

    this.x = 0; this.y = 0; this.angle = -Math.PI / 2;
    this.vx = 0; this.vy = 0;
    this.alive = true;
    this.kills = 0; this.deaths = 0;
    this.lastAttacker = null;
    this.respawnTimer = 0;

    this.input = { thrust: 0, turn: 0, targetAngle: null, fire: false, missile: false, boost: false, mine: false, flare: false };
    this.shieldFlash = 0;
    this.hitFlash = 0;
    this.ramCooldown = 0; // grace period between collision damage ticks

    // Remote interpolation buffer.
    this.netTarget = null;

    this.buildFromDesign();
  }

  buildFromDesign() {
    // Unknown ids (parts removed in newer versions) are skipped defensively.
    this.parts = this.design.parts.filter(p => PARTS[p.id]).map(p => {
      const def = PARTS[p.id];
      return {
        uid: nextPartUid++,
        id: p.id, def, x: p.x, y: p.y, deck: p.deck, rot: p.rot || 0,
        hp: def.hp, maxHp: def.hp, alive: true,
        cooldown: 0, charge: 0, turretAngle: 0, minesOut: [],
        ammo: def.weapon && def.weapon.ammo ? def.weapon.ammo : 0,
      };
    });
    this.droids = [];
    this.droidSpawnT = 0;
    // Geometric center of the occupied cells => local origin.
    let sx = 0, sy = 0, n = 0;
    for (const part of this.parts) for (const [x, y] of placedCells(part)) { sx += x + 0.5; sy += y + 0.5; n++; }
    this.cx = n ? sx / n : GRID / 2;
    this.cy = n ? sy / n : GRID / 2;

    this.rebuildGrids();
    this.recomputeStats();
    this.energy = this.energyMax;
    this.hp = this.maxHpTotal;
  }

  rebuildGrids() {
    this.grids = [new Map(), new Map(), new Map()]; // deck -> "x,y" -> part
    let maxR = 0;
    const corners = new Map(); // shield outline source points
    for (const part of this.parts) {
      if (!part.alive) continue;
      for (const [x, y] of placedCells(part)) {
        this.grids[part.deck].set(x + ',' + y, part);
        const dx = (x + 0.5 - this.cx) * CELL, dy = (y + 0.5 - this.cy) * CELL;
        maxR = Math.max(maxR, Math.hypot(dx, dy) + CELL * 0.72);
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          corners.set((x + ox) + ',' + (y + oy), [(x + ox - this.cx) * CELL, (y + oy - this.cy) * CELL]);
        }
      }
    }
    this.radius = Math.max(maxR, CELL);

    // Shield: convex hull of the hull outline, pushed outward — it hugs the
    // ship's silhouette instead of being a plain circle.
    const hull = convexHull([...corners.values()]);
    const PAD = 9;
    this.shieldPts = hull.map(([x, y]) => {
      const d = Math.hypot(x, y) || 1;
      return [x + x / d * PAD, y + y / d * PAD];
    });
  }

  recomputeStats() {
    let mass = 0, thrust = BASE_THRUST, energyMax = BASE_ENERGY, regen = BASE_REGEN, hpTotal = 0, maxHpTotal = 0;
    let cockpits = 0;
    for (const p of this.parts) {
      maxHpTotal += p.maxHp;
      if (!p.alive) continue;
      mass += p.def.mass; hpTotal += p.hp;
      energyMax += ENERGY_PER_PART; regen += REGEN_PER_PART;
      if (p.def.kind === 'reactor') thrust += p.def.thrust;
      if (p.def.kind === 'cockpit') cockpits++;
    }
    this.mass = Math.max(mass, 1);
    this.thrust = thrust;
    this.energyMax = energyMax;
    this.energyRegen = regen;
    this.hp = hpTotal;
    this.maxHpTotal = maxHpTotal;
    this.cockpitsAlive = cockpits;
    this.accel = 11.5 * this.thrust / this.mass;
    this.turnRate = clamp(1.6 + (this.thrust / this.mass) * 0.07, 1.8, 5.0);
    if (this.energy > energyMax) this.energy = energyMax;
  }

  // ---- transforms ---------------------------------------------------------
  // Local frame: grid cell centers relative to (cx, cy), forward = -y.
  localToWorld(lx, ly) {
    const th = this.angle + Math.PI / 2;
    const c = Math.cos(th), s = Math.sin(th);
    return [this.x + lx * c - ly * s, this.y + lx * s + ly * c];
  }
  worldToLocal(wx, wy) {
    const th = this.angle + Math.PI / 2;
    const c = Math.cos(th), s = Math.sin(th);
    const dx = wx - this.x, dy = wy - this.y;
    return [dx * c + dy * s, -dx * s + dy * c];
  }
  cellCenterLocal(x, y) { return [(x + 0.5 - this.cx) * CELL, (y + 0.5 - this.cy) * CELL]; }
  cellCenterWorld(x, y) { const [lx, ly] = this.cellCenterLocal(x, y); return this.localToWorld(lx, ly); }

  // Part at a world point, or null. Mid deck armor absorbs first, then top, then bottom.
  partAtWorld(wx, wy) {
    const [lx, ly] = this.worldToLocal(wx, wy);
    const gx = Math.floor(lx / CELL + this.cx), gy = Math.floor(ly / CELL + this.cy);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return null;
    const key = gx + ',' + gy;
    return this.grids[1].get(key) || this.grids[2].get(key) || this.grids[0].get(key) || null;
  }

  // ---- simulation ---------------------------------------------------------
  update(dt, world) {
    if (!this.alive) return;
    const inp = this.input;

    // Rotation: either steer toward a target angle (stick/AI) or turn rate (keys).
    if (inp.targetAngle != null) {
      const diff = wrapAngle(inp.targetAngle - this.angle);
      const step = this.turnRate * dt;
      this.angle += clamp(diff, -step, step);
    } else {
      this.angle += inp.turn * this.turnRate * dt;
    }
    this.angle = wrapAngle(this.angle);

    // Thrust + boost (boost eats energy).
    let boost = 1;
    this.boosting = false;
    if (inp.boost && inp.thrust > 0.05 && this.energy > 2) {
      boost = BOOST_MULT;
      this.energy -= BOOST_DRAIN * dt;
      this.boosting = true;
    }
    const a = this.accel * inp.thrust * boost;
    this.vx += Math.cos(this.angle) * a * dt;
    this.vy += Math.sin(this.angle) * a * dt;

    const damp = Math.exp(-DAMPING * dt);
    this.vx *= damp; this.vy *= damp;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Energy regen.
    this.energy = clamp(this.energy + this.energyRegen * dt, 0, this.energyMax);

    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2.5);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.ramCooldown = Math.max(0, this.ramCooldown - dt);

    // Arena bounds: soft bounce.
    const B = world.size / 2 - this.radius;
    if (this.x < -B) { this.x = -B; this.vx = Math.abs(this.vx) * 0.5; }
    if (this.x > B) { this.x = B; this.vx = -Math.abs(this.vx) * 0.5; }
    if (this.y < -B) { this.y = -B; this.vy = Math.abs(this.vy) * 0.5; }
    if (this.y > B) { this.y = B; this.vy = -Math.abs(this.vy) * 0.5; }

    // Asteroid collisions: bounce + scrape damage.
    for (const ast of world.asteroids) {
      const dx = this.x - ast.x, dy = this.y - ast.y;
      const d = Math.hypot(dx, dy), min = ast.r + this.radius * 0.8;
      if (d < min && d > 0.001) {
        const nx = dx / d, ny = dy / d;
        this.x = ast.x + nx * min; this.y = ast.y + ny * min;
        const vn = this.vx * nx + this.vy * ny;
        if (vn < 0) {
          this.vx -= 1.6 * vn * nx; this.vy -= 1.6 * vn * ny;
          if (vn < -80 && this.authority && this.ramCooldown <= 0) {
            this.ramCooldown = 0.35;
            const [wx, wy] = [this.x - nx * this.radius * 0.7, this.y - ny * this.radius * 0.7];
            this.damageNearestAt(wx, wy, Math.min(40, -vn * 0.12), null, world);
          }
        }
      }
    }
  }

  // ---- weapons -------------------------------------------------------------
  updateWeapons(dt, world) {
    if (!this.alive) return;
    const inp = this.input;
    for (const part of this.parts) {
      if (!part.alive || part.def.kind !== 'weapon') continue;
      const w = part.def.weapon;
      part.cooldown = Math.max(0, part.cooldown - dt);
      const [lx, ly] = this.cellCenterLocal(part.x, part.y);
      const [fdx, fdy] = fireDir(part.rot);
      const th = this.angle + Math.PI / 2;
      const c = Math.cos(th), s = Math.sin(th);
      const dirX = fdx * c - fdy * s, dirY = fdx * s + fdy * c;
      const [mx, my] = this.localToWorld(lx + fdx * CELL * 0.6, ly + fdy * CELL * 0.6);

      switch (w.type) {
        case 'gun':
          if (inp.fire && part.cooldown <= 0) {
            part.cooldown = 1 / w.rate;
            world.spawnBullet(this, mx, my, Math.atan2(dirY, dirX) + (Math.random() - 0.5) * w.spread, w);
          }
          break;
        case 'rocket':
          if (inp.missile && part.cooldown <= 0) {
            part.cooldown = 1 / w.rate;
            world.spawnRocket(this, mx, my, Math.atan2(dirY, dirX), w);
          }
          break;
        case 'chargebeam':
          // Hold fire to charge (drains energy), release to discharge one
          // thick short ray — the longer the charge, the harder it hits.
          if (inp.fire && this.energy > 2) {
            if (part.charge < 1) {
              this.energy -= w.energyPerSec * dt;
              part.charge = Math.min(1, part.charge + dt / w.chargeTime);
            }
          } else if (part.charge > 0) {
            if (part.charge >= w.minCharge) {
              world.fireChargeBeam(this, mx, my, Math.atan2(dirY, dirX), w, part.charge);
            }
            part.charge = 0;
          }
          break;
        case 'missile':
          if (inp.missile && part.cooldown <= 0 && part.ammo > 0) {
            part.cooldown = 1 / w.rate;
            part.ammo--;
            const target = world.nearestEnemy(this, 900);
            world.spawnMissile(this, mx, my, Math.atan2(dirY, dirX), w, target ? target.id : null, true);
            // That was the last one across every rack — tell the pilot.
            if (world.me === this && !this.parts.some(p => p.alive && p.def.weapon && p.def.weapon.type === 'missile' && p.ammo > 0)) {
              world.comms && world.comms('noammo');
            }
          }
          break;
        case 'turret': {
          const target = world.nearestEnemy(this, w.range, part);
          if (target) {
            const [twx, twy] = [target.x, target.y];
            const [pwx, pwy] = this.cellCenterWorld(part.x, part.y);
            // Lead the target a bit.
            const d = Math.hypot(twx - pwx, twy - pwy);
            const t = d / w.speed;
            const want = Math.atan2(twy + target.vy * t - pwy, twx + target.vx * t - pwx);
            const diff = wrapAngle(want - part.turretAngle);
            part.turretAngle = wrapAngle(part.turretAngle + clamp(diff, -4.5 * dt, 4.5 * dt));
            if (Math.abs(diff) < 0.2 && part.cooldown <= 0 && d < w.range) {
              part.cooldown = 1 / w.rate;
              const [bx, by] = [pwx + Math.cos(part.turretAngle) * CELL * 0.95, pwy + Math.sin(part.turretAngle) * CELL * 0.95];
              world.spawnBullet(this, bx, by, part.turretAngle, w);
            }
          } else {
            // Idle: align with ship.
            part.turretAngle = wrapAngle(part.turretAngle + wrapAngle(this.angle - part.turretAngle) * dt * 2);
          }
          break;
        }
        case 'mine':
          if (inp.mine && part.cooldown <= 0) {
            part.minesOut = part.minesOut.filter(m => m.alive);
            if (part.minesOut.length < w.maxActive) {
              part.cooldown = 1 / w.rate;
              const [bx, by] = this.localToWorld(lx + fdx * CELL, ly + fdy * CELL);
              const m = world.spawnMine(this, bx, by, w);
              if (m) part.minesOut.push(m);
            }
          }
          break;
        case 'flare':
          if (inp.flare && part.cooldown <= 0) {
            part.cooldown = 1 / w.rate;
            world.spawnFlares(this, mx, my, Math.atan2(dirY, dirX), w);
          }
          break;
      }
    }
  }

  // ---- damage ---------------------------------------------------------------
  // Apply damage at a world point. Returns true if something was hit.
  applyDamageAt(wx, wy, dmg, attackerId, world) {
    const part = this.partAtWorld(wx, wy);
    if (!part) return false;
    this.damagePart(part, dmg, attackerId, world, wx, wy);
    return true;
  }

  // Damage the alive part closest to a world point (used for collisions,
  // where the exact contact point can fall between hull cells).
  damageNearestAt(wx, wy, dmg, attackerId, world) {
    let best = null, bd = Infinity;
    for (const part of this.parts) {
      if (!part.alive) continue;
      for (const [x, y] of placedCells(part)) {
        const [cwx, cwy] = this.cellCenterWorld(x, y);
        const d2 = (cwx - wx) ** 2 + (cwy - wy) ** 2;
        if (d2 < bd) { bd = d2; best = part; }
      }
    }
    if (best) this.damagePart(best, dmg, attackerId, world, wx, wy);
  }

  damagePart(part, dmg, attackerId, world, wx, wy, pierce = false) {
    if (!this.alive || !part.alive) return;
    if (attackerId != null) this.lastAttacker = attackerId;

    // Shield: blocks the hit entirely if there is enough energy.
    // Piercing damage (mines) skips it and bites the hull directly.
    if (!pierce) {
      const cost = dmg * SHIELD_COST;
      if (this.energy >= cost) {
        this.energy -= cost;
        this.shieldFlash = 1;
        world.onShieldHit && world.onShieldHit(this, wx, wy);
        return;
      }
    }

    part.hp -= dmg;
    this.hitFlash = 0.6;
    world.onHullHit && world.onHullHit(this, part, wx, wy, dmg);
    if (part.hp <= 0) {
      part.hp = 0;
      this.destroyPart(part, world);
    } else {
      this.hp = Math.max(0, this.hp - dmg);
    }
    if (this.authority && world.net) {
      world.net.sendEvent({ k: 'dmg', ship: this.id, part: this.parts.indexOf(part), hp: Math.max(0, Math.round(part.hp)) });
    }
  }

  // Explosion: damages every part whose cell center is inside the radius.
  applyExplosion(wx, wy, radius, dmg, attackerId, world, pierce = false) {
    if (!this.alive) return;
    const hits = [];
    for (const part of this.parts) {
      if (!part.alive) continue;
      for (const [x, y] of placedCells(part)) {
        const [cwx, cwy] = this.cellCenterWorld(x, y);
        const d = Math.hypot(cwx - wx, cwy - wy);
        if (d < radius + CELL * 0.5) { hits.push([part, d]); break; }
      }
    }
    for (const [part, d] of hits) {
      const fall = clamp(1 - d / (radius + CELL), 0.25, 1);
      // Top/bottom parts sheltered by intact mid-deck hull take much less splash.
      let cover = 1;
      if (part.deck !== 1 && placedCells(part).every(([x, y]) => this.grids[1].has(x + ',' + y))) cover = 0.35;
      this.damagePart(part, dmg * fall * cover, attackerId, world, ...this.cellCenterWorld(part.x, part.y), pierce);
    }
  }

  destroyPart(part, world) {
    part.alive = false;
    part.hp = 0;
    world.onPartDestroyed && world.onPartDestroyed(this, part);
    if (this.authority && world.net) {
      world.net.sendEvent({ k: 'destroy', ship: this.id, part: this.parts.indexOf(part) });
    }
    this.cascadeDetach(world);
    this.rebuildGrids();
    this.recomputeStats();
    if (this.cockpitsAlive === 0) this.die(world);
  }

  // Remote mirror of a damage/destroy event.
  applyNetDamage(partIndex, hp, world) {
    const part = this.parts[partIndex];
    if (!part || !part.alive) return;
    if (hp < part.hp) this.hitFlash = 0.6; // repairs shouldn't flash red
    part.hp = hp;
    if (hp <= 0) {
      part.alive = false;
      world.onPartDestroyed && world.onPartDestroyed(this, part);
      this.cascadeDetach(world);
      this.rebuildGrids();
      this.recomputeStats();
    } else {
      this.recomputeStats();
    }
  }

  // Detach parts that lost their support: ends-parts over dead mid cells and
  // mid parts no longer connected to a cockpit's support cells.
  cascadeDetach(world) {
    const midMap = new Map();
    for (const p of this.parts) {
      if (!p.alive || p.deck !== 1) continue;
      for (const [x, y] of placedCells(p)) midMap.set(x + ',' + y, p);
    }
    // Ends parts need all their cells supported.
    for (const p of this.parts) {
      if (!p.alive || p.deck === 1) continue;
      const ok = placedCells(p).every(([x, y]) => midMap.has(x + ',' + y));
      if (!ok) { p.alive = false; world.onPartDestroyed && world.onPartDestroyed(this, p, true); }
    }
    // Mid connectivity: flood fill from cells under living cockpits.
    const roots = [];
    for (const p of this.parts) {
      if (!p.alive || p.def.kind !== 'cockpit') continue;
      for (const [x, y] of placedCells(p)) if (midMap.has(x + ',' + y)) roots.push(x + ',' + y);
    }
    if (roots.length) {
      const seen = new Set(roots);
      const stack = [...roots];
      while (stack.length) {
        const [x, y] = stack.pop().split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (x + dx) + ',' + (y + dy);
          if (midMap.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
        }
      }
      let changed = false;
      for (const p of this.parts) {
        if (!p.alive) continue;
        if (p.deck === 1 && !placedCells(p).some(([x, y]) => seen.has(x + ',' + y))) {
          p.alive = false; changed = true;
          world.onPartDestroyed && world.onPartDestroyed(this, p, true);
        }
      }
      if (changed) this.cascadeDetach(world); // ends parts above newly detached mids
    }
  }

  die(world) {
    if (!this.alive) return;
    this.alive = false;
    this.deaths++;
    world.onShipDestroyed && world.onShipDestroyed(this, this.lastAttacker);
  }

  respawn(x, y, angle) {
    this.buildFromDesign();
    this.x = x; this.y = y; this.angle = angle ?? -Math.PI / 2;
    this.vx = 0; this.vy = 0;
    this.alive = true;
    this.lastAttacker = null;
  }

  // ---- repair droids ---------------------------------------------------------
  // Tiny drones launched by a repair bay. They fly to a damaged (still alive)
  // block, weld it back up, then pick the next one or dock. A droid working on
  // a block that gets destroyed is destroyed with it. At most 3 per ship.
  updateDroids(dt, world) {
    if (!this.droids) return;
    if (!this.alive) { this.droids.length = 0; return; }
    const bays = this.parts.filter(p => p.alive && p.def.kind === 'droidbay');
    if (!bays.length) { this.droids.length = 0; return; }
    const rate = bays[0].def.repairRate;
    const cap = bays[0].def.maxDroids;

    const candidates = () => this.parts.filter(p =>
      p.alive && p.hp < p.maxHp - 0.5 && !this.droids.some(d => d.part === p));

    // Launch a new droid when there is work and a free slot.
    this.droidSpawnT -= dt;
    if (this.droids.length < cap && this.droidSpawnT <= 0) {
      const cands = candidates();
      if (cands.length) {
        this.droidSpawnT = 1.0;
        const bay = bays[Math.floor(Math.random() * bays.length)];
        const [bx, by] = this.cellCenterWorld(bay.x, bay.y);
        cands.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
        this.droids.push({ part: cands[0], x: bx, y: by, state: 'fly', syncT: 0, wobble: Math.random() * TAU });
      }
    }

    for (const d of this.droids) {
      d.wobble += dt * 7;
      // The block it was welding just blew up — the droid goes with it.
      if (d.state === 'work' && (!d.part || !d.part.alive)) {
        d.dead = true;
        world.spark(d.x, d.y, '#9fe1ff');
        world.smoke(d.x, d.y);
        continue;
      }
      if (d.part && (!d.part.alive || d.part.hp >= d.part.maxHp)) {
        if (d.state === 'work' && d.part.alive && world.me === this) world.comms && world.comms('droid');
        d.part = null;
      }
      if (!d.part) {
        const cands = candidates();
        if (cands.length) {
          cands.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
          d.part = cands[0];
          d.state = 'fly';
        } else {
          d.state = 'return';
        }
      }

      // Chase the work site (or home bay), riding along with the ship.
      let tx, ty;
      if (d.state === 'return') {
        [tx, ty] = this.cellCenterWorld(bays[0].x, bays[0].y);
      } else {
        [tx, ty] = this.cellCenterWorld(d.part.x, d.part.y);
        tx += Math.cos(d.wobble) * 4;
        ty += Math.sin(d.wobble * 1.3) * 4;
      }
      d.x += this.vx * dt; d.y += this.vy * dt;
      const dx = tx - d.x, dy = ty - d.y, dist = Math.hypot(dx, dy);
      const step = Math.min(dist, (60 + dist * 4) * dt);
      if (dist > 0.01) { d.x += dx / dist * step; d.y += dy / dist * step; }

      if (d.state === 'return') {
        if (dist < 5) d.dead = true; // docked
        continue;
      }
      if (d.state === 'fly' && dist < 8) d.state = 'work';
      if (d.state === 'work') {
        if (this.authority) {
          const healed = Math.min(d.part.maxHp - d.part.hp, rate * dt);
          d.part.hp += healed;
          this.hp = Math.min(this.maxHpTotal, this.hp + healed);
          d.syncT -= dt;
          if (world.net && d.syncT <= 0) {
            d.syncT = 0.5;
            world.net.sendEvent({ k: 'dmg', ship: this.id, part: this.parts.indexOf(d.part), hp: Math.round(d.part.hp) });
          }
        }
        if (Math.random() < dt * 12) world.spark(d.x, d.y, '#ffe98a');
      }
    }
    this.droids = this.droids.filter(d => !d.dead);
  }

  renderDroids(ctx) {
    if (!this.alive || !this.droids) return;
    for (const d of this.droids) {
      ctx.save();
      ctx.translate(d.x, d.y);
      // soft glow
      ctx.fillStyle = 'rgba(95,217,201,0.22)';
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
      // little grabber arms
      ctx.strokeStyle = '#7fb8ae';
      ctx.lineWidth = 1;
      const a = d.wobble * 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 2, Math.sin(a) * 2); ctx.lineTo(Math.cos(a) * 4.4, Math.sin(a) * 4.4);
      ctx.moveTo(-Math.cos(a) * 2, -Math.sin(a) * 2); ctx.lineTo(-Math.cos(a) * 4.4, -Math.sin(a) * 4.4);
      ctx.stroke();
      // body + eye
      ctx.fillStyle = '#cfe8e4';
      ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(10,16,24,0.8)';
      ctx.stroke();
      ctx.fillStyle = '#2bd9c0';
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      // weld flash while working
      if (d.state === 'work' && Math.random() < 0.5) {
        ctx.strokeStyle = 'rgba(255,240,180,0.95)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const wa = Math.random() * TAU, wr = 2.5 + Math.random() * 3.5;
          ctx.moveTo(0, 0); ctx.lineTo(Math.cos(wa) * wr, Math.sin(wa) * wr);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---- rendering -------------------------------------------------------------
  render(ctx) {
    if (!this.alive) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle + Math.PI / 2);

    // Decks: bottom (dark), mid, top (bright).
    for (const deck of [0, 1, 2]) {
      const off = deck === 0 ? 2.5 : deck === 2 ? -2 : 0;
      const shade = deck === 0 ? 0.55 : deck === 2 ? 1.12 : 1;
      for (const part of this.parts) {
        if (!part.alive || part.deck !== deck) continue;
        this.renderPart(ctx, part, off, shade);
      }
    }

    // Shield: smooth energy skin following the hull silhouette.
    if (this.shieldFlash > 0 && this.shieldPts && this.shieldPts.length > 2) {
      const a = this.shieldFlash;
      const ripple = 1 + 0.035 * Math.sin(performance.now() / 55) * a;
      ctx.save();
      ctx.scale(ripple, ripple);
      traceBlob(ctx, this.shieldPts);
      ctx.globalAlpha = a * 0.10;
      ctx.fillStyle = '#5ecbff';
      ctx.fill();
      ctx.globalAlpha = a * 0.22;         // wide outer glow
      ctx.strokeStyle = '#5ecbff';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.globalAlpha = a * 0.95;         // crisp core line
      ctx.strokeStyle = '#bfeaff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    ctx.restore();
  }

  renderPart(ctx, part, off, shade) {
    const def = part.def;
    const dmg = 1 - part.hp / part.maxHp;
    for (const [x, y] of placedCells(part)) {
      const lx = (x + 0.5 - this.cx) * CELL, ly = (y + 0.5 - this.cy) * CELL + off;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate((part.rot & 3) * Math.PI / 2);
      drawPartShape(ctx, part, def, shade, this);
      // Damage: darken + cracks.
      if (dmg > 0.02) {
        ctx.globalAlpha = Math.min(0.55, dmg * 0.6);
        ctx.fillStyle = '#000';
        ctx.fillRect(-CELL / 2, -CELL / 2, CELL, CELL);
        if (dmg > 0.3) {
          ctx.globalAlpha = Math.min(0.9, dmg);
          ctx.strokeStyle = '#1a1006';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          const s = (part.uid * 37 + x * 13 + y * 7) % 8; // stable pseudo-random cracks
          ctx.moveTo(-CELL / 2 + s, -CELL / 2);
          ctx.lineTo(s - 3, 1);
          ctx.lineTo(CELL / 2 - s, CELL / 2);
          if (dmg > 0.6) { ctx.moveTo(-CELL / 2, 2 - s / 2); ctx.lineTo(2, -2); ctx.lineTo(CELL / 2, s / 2); }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // Electric-fault blocks (half of them; the rest smoke) flicker with arcs.
      if (dmg > 0.35 && !(part.uid & 1) && Math.random() < 0.16) {
        ctx.strokeStyle = `rgba(170,225,255,${0.5 + Math.random() * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let ax = -CELL / 2 + Math.random() * 4, ay = (Math.random() - 0.5) * CELL * 0.7;
        ctx.moveTo(ax, ay);
        for (let i = 0; i < 3; i++) {
          ax += CELL / 3.4;
          ay = (Math.random() - 0.5) * CELL * 0.7;
          ctx.lineTo(ax, ay);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    // Turret head: tracks its world-space aim (ctx is rotated by angle+PI/2,
    // so convert the world aim angle into this frame).
    if (def.shape === 'turret') {
      const [lx, ly] = this.cellCenterLocal(part.x, part.y);
      const recoil = Math.min(2.6, (part.cooldown || 0) * 9);
      ctx.save();
      ctx.translate(lx, ly + off);
      ctx.rotate(part.turretAngle - this.angle - Math.PI / 2);
      // twin barrels
      ctx.fillStyle = '#43461f';
      ctx.fillRect(2 - recoil, -3.6, CELL * 0.72, 2.6);
      ctx.fillRect(2 - recoil, 1.0, CELL * 0.72, 2.6);
      ctx.fillStyle = '#9aa040';
      ctx.fillRect(CELL * 0.72 - 2 - recoil, -3.6, 3, 2.6);
      ctx.fillRect(CELL * 0.72 - 2 - recoil, 1.0, 3, 2.6);
      // rotating housing on top of the barrels
      ctx.fillStyle = shadeColor('#767c2e', shade);
      ctx.beginPath();
      ctx.moveTo(-5.5, -5);
      ctx.lineTo(4, -5); ctx.lineTo(6.5, -2.5); ctx.lineTo(6.5, 2.5); ctx.lineTo(4, 5);
      ctx.lineTo(-5.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,16,24,0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-4.5, -3.8, 8, 2.2);
      ctx.restore();
    }
    // Reactor flame.
    if (def.kind === 'reactor' && this.input.thrust > 0.05) {
      const [lx, ly] = this.cellCenterLocal(part.x, part.y);
      const len = (8 + Math.random() * 8) * this.input.thrust * (this.boosting ? 1.8 : 1);
      ctx.save();
      ctx.translate(lx, ly + off);
      const g = ctx.createLinearGradient(0, CELL / 2, 0, CELL / 2 + len);
      g.addColorStop(0, this.boosting ? '#9fdcff' : '#ffd27a');
      g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-5, CELL / 2 - 2);
      ctx.lineTo(5, CELL / 2 - 2);
      ctx.lineTo(0, CELL / 2 + len);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

// Closed smooth curve through a point loop (quadratic through midpoints).
function traceBlob(ctx, pts) {
  const n = pts.length;
  ctx.beginPath();
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(pts[0], pts[1]);
  ctx.moveTo(m[0], m[1]);
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n], next = pts[(i + 1) % n];
    m = mid(p, next);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

// Shape painters (local frame of one cell, already rotated by part.rot).
export function drawPartShape(ctx, part, def, shade, ship) {
  const h = CELL / 2;
  const col = shadeColor(def.color, shade);
  ctx.fillStyle = col;
  ctx.strokeStyle = 'rgba(10,16,24,0.8)';
  ctx.lineWidth = 1;
  switch (def.shape) {
    case 'square':
      ctx.fillRect(-h, -h, CELL, CELL);
      ctx.strokeRect(-h + 0.5, -h + 0.5, CELL - 1, CELL - 1);
      // rivet
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(-h + 2, -h + 2, CELL - 4, 3);
      break;
    case 'tri':
      ctx.beginPath();
      ctx.moveTo(-h, h); ctx.lineTo(h, h); ctx.lineTo(-h, -h);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    case 'reactor':
      ctx.fillRect(-h, -h, CELL, CELL);
      ctx.strokeRect(-h + 0.5, -h + 0.5, CELL - 1, CELL - 1);
      ctx.fillStyle = shadeColor('#7a4a20', shade);
      ctx.beginPath(); // nozzle
      ctx.moveTo(-h + 3, h - 4); ctx.lineTo(h - 3, h - 4); ctx.lineTo(h - 6, h); ctx.lineTo(-h + 6, h);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,120,0.5)';
      ctx.fillRect(-3, -h + 3, 6, 6);
      break;
    case 'droidbay': {
      ctx.fillStyle = shadeColor('#2e5a54', shade);
      ctx.fillRect(-h + 1, -h + 1, CELL - 2, CELL - 2);
      ctx.strokeRect(-h + 1.5, -h + 1.5, CELL - 3, CELL - 3);
      // split launch hatch
      ctx.fillStyle = shadeColor(def.color, shade * 0.8);
      ctx.fillRect(-h + 4, -h + 4, CELL - 8, CELL - 10);
      ctx.strokeStyle = 'rgba(10,16,24,0.6)';
      ctx.beginPath(); ctx.moveTo(0, -h + 4); ctx.lineTo(0, h - 6); ctx.stroke();
      // docked-droid pips (all lit in the editor preview)
      const out = ship && ship.droids ? Math.min(def.maxDroids, ship.droids.length) : 0;
      for (let i = 0; i < def.maxDroids; i++) {
        ctx.fillStyle = i < def.maxDroids - out ? '#bfffe9' : 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.arc((i - 1) * 5, h - 4, 1.6, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'sphere':
      ctx.fillStyle = shadeColor('#3a4c5e', shade);
      ctx.fillRect(-h + 1, -h + 1, CELL - 2, CELL - 2);
      ctx.beginPath();
      ctx.arc(0, 0, h - 2.5, 0, TAU);
      const gr = ctx.createRadialGradient(-3, -3, 1, 0, 0, h - 2);
      gr.addColorStop(0, '#bfeaff'); gr.addColorStop(0.6, def.color); gr.addColorStop(1, '#1d5f8a');
      ctx.fillStyle = gr;
      ctx.fill(); ctx.stroke();
      break;
    case 'jet':
      // Two-cell canopy: draw only on the anchor cell pass; the shape spans both.
      if (drawOncePerPart(ctx, part)) {
        ctx.beginPath();
        ctx.moveTo(0, -h - 1);
        ctx.quadraticCurveTo(h - 3, -h + 5, h - 3, 0);
        ctx.lineTo(h - 3, CELL + h - 4);
        ctx.quadraticCurveTo(0, CELL + h + 1, -h + 3, CELL + h - 4);
        ctx.lineTo(-h + 3, 0);
        ctx.quadraticCurveTo(-h + 3, -h + 5, 0, -h - 1);
        const gj = ctx.createLinearGradient(0, -h, 0, CELL + h);
        gj.addColorStop(0, '#cfeeff'); gj.addColorStop(0.45, def.color); gj.addColorStop(1, '#1d5f8a');
        ctx.fillStyle = gj;
        ctx.fill(); ctx.stroke();
      }
      break;
    case 'gun':
      ctx.fillStyle = shadeColor('#4a4636', shade);
      ctx.fillRect(-h + 3, -h + 5, CELL - 6, CELL - 8);
      ctx.fillStyle = col;
      ctx.fillRect(-2.5, -h - 3, 5, h + 4); // barrel forward
      ctx.fillRect(-4.5, -h + 4, 9, 5);
      break;
    case 'beam': {
      ctx.fillStyle = shadeColor('#4a2a4a', shade);
      ctx.fillRect(-h + 2, -h + 4, CELL - 4, CELL - 6);
      // Emitter glows brighter as the shot charges; white pulse when full.
      const ch = part.charge || 0;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, -h + 4, 4.5, 0, TAU); ctx.fill();
      if (ch > 0) {
        const pulse = ch >= 1 ? 0.75 + 0.25 * Math.sin(performance.now() / 60) : 1;
        ctx.globalAlpha = (0.35 + 0.65 * ch) * pulse;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, -h + 4, 1.5 + 3 * ch, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // charge bar along the bottom edge
      const cbx = -h + 3, cby = h - 4, cbw = CELL - 6;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cbx, cby, cbw, 2);
      ctx.fillStyle = ch >= 1 ? '#ffffff' : col; ctx.fillRect(cbx, cby, cbw * ch, 2);
      break;
    }
    case 'missile': {
      ctx.fillStyle = shadeColor('#5e3535', shade);
      ctx.fillRect(-h + 2, -h + 2, CELL - 4, CELL - 4);
      // Two tubes act as reload gauges: they fill bottom-up as the rack reloads,
      // glowing bright red the instant a missile is ready. Grey when out of ammo.
      const rf = reloadFrac(part);
      const hasAmmo = (part.ammo ?? 1) > 0;
      const by = -h + 3, bh = CELL - 9;
      for (const bx of [-6, 2]) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx, by, 4, bh);
        const fh = bh * rf;
        ctx.fillStyle = !hasAmmo ? '#3a3a42' : rf >= 1 ? '#ff6a6a' : col;
        ctx.fillRect(bx, by + bh - fh, 4, fh);
      }
      // Ammo pips along the bottom edge, centered inside the housing.
      const cap = def.weapon.ammo || 0;
      if (cap) {
        const ammo = part.ammo ?? cap;
        const pw = 1.5, gap = 2.2;
        const x0 = -((cap - 1) * gap + pw) / 2;
        for (let i = 0; i < cap; i++) {
          ctx.fillStyle = i < ammo ? '#ffd27a' : 'rgba(0,0,0,0.5)';
          ctx.fillRect(x0 + i * gap, h - 4.5, pw, 2.4);
        }
      }
      break;
    }
    case 'rocket': {
      ctx.fillStyle = shadeColor('#5e4535', shade);
      ctx.fillRect(-h + 2, -h + 2, CELL - 4, CELL - 4);
      const rf = reloadFrac(part);
      ctx.fillStyle = rf >= 1 ? col : 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(-4, 0, 2.6, 0, TAU); ctx.arc(4, 0, 2.6, 0, TAU); ctx.fill();
      // Reload bar along the bottom edge.
      const bx = -h + 3, by = h - 4, bw = CELL - 6;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, 2);
      ctx.fillStyle = rf >= 1 ? col : '#ff9d4f'; ctx.fillRect(bx, by, bw * rf, 2);
      break;
    }
    case 'turret': {
      // Base plate only — the rotating head is drawn separately in ship space.
      ctx.fillStyle = shadeColor('#3f421c', shade);
      ctx.fillRect(-h + 1, -h + 1, CELL - 2, CELL - 2);
      ctx.strokeRect(-h + 1.5, -h + 1.5, CELL - 3, CELL - 3);
      ctx.beginPath(); ctx.arc(0, 0, h - 3, 0, TAU);
      ctx.fillStyle = shadeColor('#565b24', shade); ctx.fill(); ctx.stroke();
      // bearing ring bolts
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU;
        ctx.beginPath(); ctx.arc(Math.cos(a) * (h - 4.5), Math.sin(a) * (h - 4.5), 1.1, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'mine': {
      ctx.fillStyle = shadeColor('#3d3355', shade);
      ctx.fillRect(-h + 2, -h + 2, CELL - 4, CELL - 4);
      const rf = reloadFrac(part);
      // Ring fills clockwise as the launcher reloads; solid core when armed.
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.arc(0, 0, 5.4, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rf >= 1 ? '#b39dff' : col;
      ctx.beginPath(); ctx.arc(0, 0, 5.4, -Math.PI / 2, -Math.PI / 2 + TAU * rf); ctx.stroke();
      ctx.fillStyle = rf >= 1 ? col : shadeColor(def.color, shade * 0.45);
      ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, TAU); ctx.fill();
      break;
    }
    case 'flare': {
      ctx.fillStyle = shadeColor('#6a6136', shade);
      ctx.fillRect(-h + 2, -h + 2, CELL - 4, CELL - 4);
      // Three charge strips fill bottom-up; bright gold when a salvo is ready.
      const rf = reloadFrac(part);
      const by = -h + 4, bh = CELL - 10;
      for (let i = -1; i <= 1; i++) {
        const bx = i * 5 - 1.5;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx, by, 3, bh);
        const fh = bh * rf;
        ctx.fillStyle = rf >= 1 ? '#ffe98a' : col;
        ctx.fillRect(bx, by + bh - fh, 3, fh);
      }
      break;
    }
    default:
      ctx.fillRect(-h, -h, CELL, CELL);
  }
}

// The jet cockpit spans 2 cells but is drawn as one shape from its anchor cell.
const drawnFrame = new WeakMap();
let frameTick = 0;
export function nextRenderFrame() { frameTick++; }
function drawOncePerPart(ctx, part) {
  if (drawnFrame.get(part) === frameTick) return false;
  drawnFrame.set(part, frameTick);
  return true;
}

// Reload progress of a weapon part: 0 just fired → 1 ready to fire again.
// Editor/preview parts have no cooldown, so they render fully charged.
function reloadFrac(part) {
  const rate = part.def.weapon && part.def.weapon.rate;
  if (!rate) return 1;
  return clamp(1 - (part.cooldown || 0) * rate, 0, 1);
}

function shadeColor(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}
