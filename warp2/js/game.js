// Game world: simulation loop, arena, projectiles, networking glue, HUD.
import { Ship, nextRenderFrame } from './ship.js';
import { Bullet, Rocket, Missile, Mine, Flare, Particle } from './weapons.js';
import { AIController } from './ai.js';
import { TAU, clamp, lerp, angleLerp, seededRandom, hashString } from './util.js';

const WORLD_SIZE = 4200;
const SNAP_RATE = 1 / 12; // net snapshots per second
const RESPAWN_DELAY = 4;
const KILL_TARGET = 5;    // deathmatch: first to 5 kills wins
const RADAR_REV = 2.0;    // seconds for one radar sweep revolution

// Did the sweep, moving from `prev` to `cur`, cross the given bearing this frame?
function angleInSweep(bearing, prev, cur) {
  const norm = a => ((a % TAU) + TAU) % TAU;
  bearing = norm(bearing); prev = norm(prev); cur = norm(cur);
  return prev <= cur ? (bearing > prev && bearing <= cur) : (bearing > prev || bearing <= cur);
}

export class Game {
  // opts: { mode: 'ai'|'mp', canvas, input, myDesign, myName, net, seed, bots: [{design,name,difficulty}], onExit }
  constructor(opts) {
    this.opts = opts;
    this.mode = opts.mode;
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.input = opts.input;
    this.net = opts.mode === 'mp' ? opts.net : null;
    this.size = WORLD_SIZE;

    this.ships = [];
    this.controllers = new Map(); // shipId -> AIController (only ones we simulate)
    this.bullets = []; this.rockets = []; this.missiles = [];
    this.mines = []; this.flares = []; this.particles = [];
    this.beamPulses = []; // charge-laser discharges, fading over a few frames
    this.shockwaves = []; this.delayedBooms = [];
    this.shake = 0;
    // Sweeping radar: the beam rotates, and an enemy blip only refreshes when
    // the beam crosses its bearing. Range scales with hull mass (below).
    this.radarSweep = 0;
    this.radarBlips = new Map(); // shipId -> { x, y, t }
    this.radarRange = 2400;
    this.time = 0;
    this.snapTimer = 0;
    this.running = false;
    this.matchOver = false;
    this.myRespawn = 0;

    const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.seed = seed;
    this.generateField(seed);
    this.stars = this.generateStars(seed ^ 0x5f3759df);

    this.myId = this.mode === 'mp' ? this.net.selfId : 'me';

    // My ship.
    const me = new Ship(opts.myDesign, { id: this.myId, name: opts.myName || 'You', authority: true });
    this.addShipAtSpawn(me, 0);
    this.me = me;

    if (this.mode === 'ai') {
      (opts.bots || []).forEach((b, i) => {
        const ship = new Ship(b.design, { id: 'bot' + i, name: b.name, authority: true });
        this.addShipAtSpawn(ship, i + 1);
        this.controllers.set(ship.id, new AIController(ship, b.difficulty));
      });
    } else {
      this.attachNet();
      // Peer ships from lobby profiles.
      let slot = 1;
      for (const [peerId, prof] of this.net.profiles) {
        this.addRemoteShip(peerId, prof, slot++);
      }
      // Bots (simulated by host, mirrored elsewhere).
      (opts.bots || []).forEach((b, i) => {
        const ship = new Ship(b.design, { id: 'bot' + i, name: b.name, authority: this.net.isHost });
        this.addShipAtSpawn(ship, slot++);
        if (this.net.isHost) this.controllers.set(ship.id, new AIController(ship, b.difficulty));
      });
    }

    this.msg('');
  }

  // ---- setup ---------------------------------------------------------------
  spawnPoint(i) {
    const a = (i * 2.399963) % TAU; // golden angle: spreads any count nicely
    const r = 1150 + (i % 3) * 160;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, angle: Math.atan2(-Math.sin(a), -Math.cos(a)) };
  }

  addShipAtSpawn(ship, slot) {
    const s = this.spawnPoint(slot);
    ship.x = s.x; ship.y = s.y; ship.angle = s.angle;
    this.ships.push(ship);
  }

  addRemoteShip(peerId, prof, slot) {
    if (this.ships.some(s => s.id === peerId)) return;
    const ship = new Ship(prof.design, { id: peerId, name: prof.name, authority: false });
    this.addShipAtSpawn(ship, slot);
  }

  generateField(seed) {
    const rng = seededRandom(seed);
    this.asteroids = [];
    const spawns = Array.from({ length: 10 }, (_, i) => this.spawnPoint(i));
    let guard = 0;
    while (this.asteroids.length < 26 && guard++ < 500) {
      const x = (rng() - 0.5) * (this.size - 500);
      const y = (rng() - 0.5) * (this.size - 500);
      const r = 40 + rng() * 105;
      if (spawns.some(s => Math.hypot(s.x - x, s.y - y) < r + 220)) continue;
      if (this.asteroids.some(a => Math.hypot(a.x - x, a.y - y) < a.r + r + 90)) continue;
      // Precompute a lumpy polygon outline.
      const n = 9 + Math.floor(rng() * 5);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const rr = r * (0.75 + rng() * 0.3);
        pts.push([Math.cos(i / n * TAU) * rr, Math.sin(i / n * TAU) * rr]);
      }
      this.asteroids.push({ x, y, r, pts, tone: 0.75 + rng() * 0.4 });
    }
    // Missile resupply station: one per map, deterministic from the seed so
    // every peer sees it in the same spot, clear of spawns and rocks.
    let sx = 0, sy = 0, ok = false, tries = 0;
    while (!ok && tries++ < 80) {
      const a = rng() * TAU, r = this.size * (0.26 + rng() * 0.14);
      sx = Math.cos(a) * r; sy = Math.sin(a) * r;
      ok = !this.asteroids.some(ast => Math.hypot(ast.x - sx, ast.y - sy) < ast.r + 170)
        && spawns.every(s => Math.hypot(s.x - sx, s.y - sy) > 320);
    }
    this.ammoStation = { x: sx, y: sy, r: 80 };
  }

  generateStars(seed) {
    const rng = seededRandom(seed);
    const layers = [];
    for (const [count, parallax, size] of [[140, 0.25, 1.2], [90, 0.5, 1.8], [50, 0.8, 2.4]]) {
      const pts = [];
      for (let i = 0; i < count; i++) pts.push([rng() * 2048, rng() * 2048, 0.3 + rng() * 0.7]);
      layers.push({ pts, parallax, size });
    }
    return layers;
  }

  // ---- networking ------------------------------------------------------------
  attachNet() {
    const net = this.net;
    const applySnapshot = (ship, s) => {
      ship.netTarget = { ...s, t: this.time };
      ship.input.fire = !!(s.f & 1);
      ship.input.boost = !!(s.f & 2);
      ship.input.mine = !!(s.f & 4);
      ship.input.flare = !!(s.f & 8);
      ship.input.missile = !!(s.f & 16);
      ship.input.thrust = s.th;
      ship.energy = s.en;
    };
    net.onState = (s, peerId) => {
      const ship = this.shipById(peerId);
      if (ship) applySnapshot(ship, s);
    };
    net.onBots = arr => {
      if (net.isHost) return;
      for (const s of arr) {
        const ship = this.shipById(s.id);
        if (ship) applySnapshot(ship, s);
      }
    };
    net.onEvent = (e) => {
      const ship = this.shipById(e.ship);
      switch (e.k) {
        case 'dmg':
          if (ship && !ship.authority) ship.applyNetDamage(e.part, e.hp, this);
          break;
        case 'destroy':
          if (ship && !ship.authority) ship.applyNetDamage(e.part, 0, this);
          break;
        case 'die':
          if (ship && ship.alive && !ship.authority) {
            ship.lastAttacker = e.by;
            ship.die(this);
          }
          break;
        case 'spawn':
          if (ship && !ship.authority) {
            ship.respawn(e.x, e.y, e.a);
          }
          break;
      }
    };
    net.onPeers = () => {
      // Drop ships of peers that left; add ships for lobby profiles seen late.
      const valid = new Set([this.myId, ...net.peers]);
      this.ships = this.ships.filter(s => s.id.startsWith('bot') || valid.has(s.id));
      let slot = this.ships.length;
      for (const [peerId, prof] of net.profiles) this.addRemoteShip(peerId, prof, slot++);
      // Host adopts orphaned bots on host migration.
      if (net.isHost) {
        for (const s of this.ships) {
          if (s.id.startsWith('bot') && !this.controllers.has(s.id)) {
            s.authority = true;
            this.controllers.set(s.id, new AIController(s, 'normal'));
          }
        }
      }
    };
  }

  static COMMS = {
    droid: ['Damage contained, Commandant.', 'Fire controlled, Commandant.', 'Hull patched up, Commandant.', 'All welded, Commandant.'],
    noammo: ['Out of missiles, Sir!', 'Missile racks empty, Sir!'],
    resupply: ['Missiles restocked, Sir!', 'Racks full again, Commandant.'],
  };

  static inputFlags(inp) {
    return (inp.fire ? 1 : 0) | (inp.boost ? 2 : 0) | (inp.mine ? 4 : 0) | (inp.flare ? 8 : 0) | (inp.missile ? 16 : 0);
  }

  sendSnapshot() {
    if (!this.net) return;
    const s = this.me;
    const flags = Game.inputFlags(s.input);
    this.net.sendState({
      x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10,
      a: Math.round(s.angle * 1000) / 1000,
      vx: Math.round(s.vx), vy: Math.round(s.vy),
      en: Math.round(s.energy), th: Math.round(s.input.thrust * 10) / 10, f: flags,
    });
    if (this.net.isHost) {
      const bots = this.ships.filter(sh => sh.id.startsWith('bot') && sh.alive).map(sh => ({
        id: sh.id, x: Math.round(sh.x * 10) / 10, y: Math.round(sh.y * 10) / 10,
        a: Math.round(sh.angle * 1000) / 1000, vx: Math.round(sh.vx), vy: Math.round(sh.vy),
        en: Math.round(sh.energy), th: Math.round(sh.input.thrust * 10) / 10,
        f: Game.inputFlags(sh.input),
      }));
      if (bots.length) this.net.sendBots(bots);
    }
  }

  // ---- world API used by ships/weapons ---------------------------------------
  shipById(id) { return this.ships.find(s => s.id === id); }

  nearestEnemy(ship, range, _part) {
    let best = null, bd = range * range;
    for (const s of this.ships) {
      if (!s.alive || s.id === ship.id) continue;
      const d2 = (s.x - ship.x) ** 2 + (s.y - ship.y) ** 2;
      if (d2 < bd) { bd = d2; best = s; }
    }
    return best;
  }

  hitAsteroid(x, y) {
    for (const a of this.asteroids) {
      const dx = x - a.x, dy = y - a.y;
      if (dx * dx + dy * dy < a.r * a.r) return a;
    }
    return null;
  }

  spawnBullet(owner, x, y, angle, w) {
    this.bullets.push(new Bullet(owner, x, y, angle, w));
  }
  spawnRocket(owner, x, y, angle, w) {
    this.rockets.push(new Rocket(owner, x, y, angle, w));
  }
  spawnMissile(owner, x, y, angle, w, targetId) {
    this.missiles.push(new Missile(owner, x, y, angle, w, targetId));
  }
  spawnMine(owner, x, y, w) {
    const m = new Mine(owner, x, y, w);
    this.mines.push(m);
    return m;
  }
  // Flares leave the launcher itself, spread around the block's fire direction —
  // so a rear-facing block sheds them behind, a forward/side block ahead or aside.
  spawnFlares(owner, x, y, baseAngle, w) {
    for (let i = 0; i < w.count; i++) {
      const a = baseAngle + (i - (w.count - 1) / 2) * 0.6;
      this.flares.push(new Flare(owner, x, y, a, w.life));
    }
  }

  // Charge-laser discharge: one thick short ray. Brightest and hardest-hitting
  // at the muzzle; both the light and the damage fade along its length.
  fireChargeBeam(owner, x, y, angle, w, power) {
    const step = 8;
    const dx = Math.cos(angle) * step, dy = Math.sin(angle) * step;
    let px = x, py = y, dist = 0;
    let hit = false;
    while (dist < w.range && !hit) {
      px += dx; py += dy; dist += step;
      if (this.hitAsteroid(px, py)) { hit = true; break; }
      for (const ship of this.ships) {
        if (!ship.alive || ship.id === owner.id) continue;
        const ddx = ship.x - px, ddy = ship.y - py;
        if (ddx * ddx + ddy * ddy > ship.radius * ship.radius) continue;
        if (ship.partAtWorld(px, py)) {
          // Full damage through the first half of the ray, fading past it.
          const fade = Math.max(0, dist / w.range - 0.5) * 2;
          const dmg = w.dmg * power * (1 - w.falloff * fade);
          if (ship.authority) ship.applyDamageAt(px, py, dmg, owner.id, this);
          this.spark(px, py, '#ff9df5');
          hit = true;
          break;
        }
      }
    }
    // Store the ray in the owner's local frame so it stays glued to the
    // laser block while the ship keeps moving during the flash.
    const [lx, ly] = owner.worldToLocal(x, y);
    this.beamPulses.push({
      ship: owner, lx, ly, la: angle - owner.angle, len: dist,
      x1: x, y1: y, x2: px, y2: py, power, t: 0, life: 0.22,
    });
    const dc = Math.hypot(this.camX - x, this.camY - y);
    this.shake = Math.min(14, this.shake + (2 + 5 * power) * clamp(1 - dc / 900, 0, 1));
  }

  // pierce: the blast ignores shields and bites the hull directly (mines).
  explosion(x, y, radius, dmg, ownerId, pierce = false) {
    // FX
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * TAU, sp = 40 + Math.random() * 220;
      this.particles.push(new Particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.3 + Math.random() * 0.5, 3 + Math.random() * 5,
        ['#ffdf8a', '#ff8a1e', '#ff5a10', '#e23a06'][i % 4], 3));
    }
    const dc = Math.hypot(this.camX - x, this.camY - y);
    this.shake = Math.min(14, this.shake + clamp(1 - dc / 900, 0, 1) * 10);
    // Damage (only ships we have authority over).
    for (const ship of this.ships) {
      if (!ship.alive || !ship.authority || ship.id === ownerId) continue;
      const d = Math.hypot(ship.x - x, ship.y - y);
      if (d < radius + ship.radius) ship.applyExplosion(x, y, radius, dmg, ownerId, this, pierce);
    }
  }

  spark(x, y, color) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * TAU, sp = 30 + Math.random() * 120;
      this.particles.push(new Particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + Math.random() * 0.25, 2, color, 4));
    }
  }
  smoke(x, y) {
    this.particles.push(new Particle(x, y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20,
      0.4 + Math.random() * 0.3, 3.5, 'rgba(180,180,190,0.5)', 1.5));
  }

  // Damaged blocks show it: half of them trail smoke, the other half throw
  // little electric arcs (the on-block flicker is drawn in renderPart).
  emitDamageFX(dt) {
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      for (const part of ship.parts) {
        if (!part.alive) continue;
        const dmg = 1 - part.hp / part.maxHp;
        if (dmg < 0.35) continue;
        if (Math.random() > (dmg - 0.2) * dt * 2.4) continue;
        const [wx, wy] = ship.cellCenterWorld(part.x, part.y);
        if (part.uid & 1) {
          this.smoke(wx + (Math.random() - 0.5) * 8, wy + (Math.random() - 0.5) * 8);
        } else {
          for (let i = 0; i < 3; i++) {
            this.particles.push(new Particle(wx, wy,
              ship.vx + (Math.random() - 0.5) * 90, ship.vy + (Math.random() - 0.5) * 90,
              0.1 + Math.random() * 0.14, 1.6, '#aee6ff', 3));
          }
        }
      }
    }
  }

  // Any ship gliding over the station leaves with full missile racks.
  updateStation() {
    const st = this.ammoStation;
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      if (Math.hypot(ship.x - st.x, ship.y - st.y) > st.r + ship.radius * 0.5) continue;
      let refilled = false;
      for (const p of ship.parts) {
        const cap = p.alive && p.def.weapon && p.def.weapon.ammo;
        if (cap && p.ammo < cap) { p.ammo = cap; refilled = true; }
      }
      if (refilled) {
        this.spark(ship.x, ship.y, '#7ee787');
        if (ship === this.me) { this.killFeed('Missiles resupplied'); this.comms('resupply'); }
      }
    }
  }

  // Supply platform, drawn under the ships; the pickup missiles hover above
  // it at ship level (renderStationMissiles).
  renderStation(ctx) {
    const s = this.ammoStation, t = this.time;
    ctx.save();
    ctx.translate(s.x, s.y);
    // resupply radius ring, gently pulsing
    ctx.globalAlpha = 0.16 + 0.08 * Math.sin(t * 2.4);
    ctx.strokeStyle = '#ffd257';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(0, 0, s.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // octagonal pad
    ctx.rotate(Math.PI / 8);
    const R = 46;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      i ? ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R) : ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    ctx.closePath();
    ctx.fillStyle = '#232a38';
    ctx.fill();
    ctx.strokeStyle = '#10141d';
    ctx.lineWidth = 3;
    ctx.stroke();
    // inner deck + hazard ring
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      i ? ctx.lineTo(Math.cos(a) * R * 0.68, Math.sin(a) * R * 0.68) : ctx.moveTo(Math.cos(a) * R * 0.68, Math.sin(a) * R * 0.68);
    }
    ctx.closePath();
    ctx.fillStyle = '#2e374a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 201, 92, 0.75)';
    ctx.lineWidth = 4;
    ctx.setLineDash([9, 7]);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.84, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // center pad
    ctx.fillStyle = '#1b202c';
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
    // corner beacons blink in pairs
    for (let i = 0; i < 8; i += 2) {
      const a = i / 8 * TAU;
      const on = Math.floor(t * 2 + i / 2) % 2 === 0;
      ctx.fillStyle = on ? '#ffd257' : 'rgba(255,210,87,0.2)';
      ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92, 2.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  renderStationMissiles(ctx) {
    const s = this.ammoStation, t = this.time;
    for (let i = 0; i < 3; i++) {
      const a = t * 0.7 + i * TAU / 3;
      const x = s.x + Math.cos(a) * 26, y = s.y + Math.sin(a) * 26 + Math.sin(t * 2 + i) * 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = 'rgba(255, 120, 120, 0.25)';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d94f4f';
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(-6, -3.4); ctx.lineTo(-4, 0); ctx.lineTo(-6, 3.4);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---- damage callbacks --------------------------------------------------------
  onShieldHit(ship, x, y) {
    if (x != null) this.spark(x, y, '#5ecbff');
  }
  onHullHit(ship, part, x, y) {
    if (x != null) this.spark(x, y, '#ffb35c');
  }
  onPartDestroyed(ship, part, detached) {
    const [wx, wy] = ship.cellCenterWorld(part.x, part.y);
    for (let i = 0; i < (detached ? 4 : 8); i++) {
      const a = Math.random() * TAU, sp = 30 + Math.random() * 140;
      this.particles.push(new Particle(wx, wy, ship.vx * 0.5 + Math.cos(a) * sp, ship.vy * 0.5 + Math.sin(a) * sp,
        0.6 + Math.random() * 0.8, 3 + Math.random() * 4, part.def.color, 1.8));
    }
  }
  // The whole ship goes up: flash, expanding shockwave rings, debris in the
  // hull's own colors, secondary pops, and a physical push on nearby ships.
  shipExplosion(ship) {
    const { x, y } = ship;
    // Debris colored like the ship's remaining parts.
    for (const part of ship.parts) {
      if (Math.random() > 0.8) continue;
      const a = Math.random() * TAU, sp = 50 + Math.random() * 320;
      this.particles.push(new Particle(
        x + (Math.random() - 0.5) * ship.radius, y + (Math.random() - 0.5) * ship.radius,
        ship.vx * 0.4 + Math.cos(a) * sp, ship.vy * 0.4 + Math.sin(a) * sp,
        0.7 + Math.random() * 1.4, 3 + Math.random() * 5, part.def.color, 1.4));
    }
    // Fireball core — hot orange flame: a white-hot flash fading through amber,
    // orange and deep red, with just a little dark smoke.
    for (let i = 0; i < 72; i++) {
      const a = Math.random() * TAU, sp = 20 + Math.random() * 420;
      this.particles.push(new Particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.45 + Math.random() * 1.1, 4 + Math.random() * 8,
        ['#fff0c2', '#ffbe57', '#ff8a1e', '#ff5a10', '#e23a06', '#5a4038'][i % 6], 2.2));
    }
    // Rolling flame puffs: slower, bigger, lingering orange to sell the "flame".
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU, sp = 10 + Math.random() * 130;
      this.particles.push(new Particle(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        0.7 + Math.random() * 0.9, 8 + Math.random() * 9,
        ['#ff8a1e', '#ff6a12', '#ffae4a'][i % 3], 1.1));
    }
    // Shockwave rings (second one slightly delayed).
    this.shockwaves.push({ x, y, t: 0, life: 0.75, max: 210 + ship.radius * 1.7 });
    this.shockwaves.push({ x, y, t: -0.14, life: 0.6, max: 120 + ship.radius });
    // Secondary pops crackling in the wreck.
    for (let i = 0; i < 5; i++) {
      this.delayedBooms.push({
        t: this.time + 0.1 + Math.random() * 0.55,
        x: x + (Math.random() - 0.5) * ship.radius * 1.8,
        y: y + (Math.random() - 0.5) * ship.radius * 1.8,
      });
    }
    // Blast pushes nearby ships away.
    for (const s of this.ships) {
      if (!s.alive || !s.authority || s === ship) continue;
      const dx = s.x - x, dy = s.y - y;
      const d = Math.hypot(dx, dy);
      if (d < 460 && d > 1) {
        const imp = (1 - d / 460) * 340;
        s.vx += dx / d * imp; s.vy += dy / d * imp;
      }
    }
    const dc = Math.hypot(this.camX - x, this.camY - y);
    this.shake = Math.min(28, this.shake + 8 + 16 * clamp(1 - dc / 1100, 0, 1));
  }

  onShipDestroyed(ship, killerId) {
    this.shipExplosion(ship);

    const killer = killerId ? this.shipById(killerId) : null;
    if (killer) killer.kills++;
    this.killFeed(`${killer ? killer.name : 'The void'} destroyed ${ship.name}`);

    if (ship.authority && this.net) this.net.sendEvent({ k: 'die', ship: ship.id, by: killerId || null });

    // Deathmatch: first to KILL_TARGET wins; everyone else respawns.
    if (killer && killer.kills >= KILL_TARGET) this.endMatch(killer);
    if (!this.matchOver && ship.authority) {
      ship.respawnTimer = RESPAWN_DELAY;
      if (ship === this.me) this.msg(`Destroyed! Respawn in ${RESPAWN_DELAY}s`);
    }
  }

  endMatch(winner) {
    if (this.matchOver) return;
    this.matchOver = true;
    this.msg('');
    const won = winner === this.me;
    const el = document.getElementById('game-over');
    el.classList.remove('hidden');
    el.querySelector('h2').textContent = won ? 'VICTORY' : `${winner.name} WINS`;
    el.querySelector('h2').className = won ? 'win' : 'lose';
  }

  killFeed(text) {
    const feed = document.getElementById('killfeed');
    const li = document.createElement('div');
    li.textContent = text;
    feed.appendChild(li);
    setTimeout(() => li.remove(), 5000);
  }

  msg(text) {
    document.getElementById('game-msg').textContent = text;
  }

  // Crew chatter bubble (bottom-left, desktop only — the touch UI needs the room).
  comms(kind) {
    if (this.input.isTouchDevice) return;
    const el = document.getElementById('comms-bubble');
    const msgs = Game.COMMS[kind];
    if (!el || !msgs) return;
    this._commsLast = this._commsLast || {};
    if (this.time - (this._commsLast[kind] ?? -99) < 3) return; // don't chatter
    this._commsLast[kind] = this.time;
    el.querySelector('.comms-icon').textContent = kind === 'droid' ? '🤖' : '🚀';
    el.querySelector('#comms-text').textContent = msgs[Math.floor(Math.random() * msgs.length)];
    el.classList.remove('hidden');
    clearTimeout(this._commsT);
    this._commsT = setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // ---- main loop -----------------------------------------------------------------
  start() {
    this.running = true;
    this.camX = this.me.x; this.camY = this.me.y; this.zoom = 1;
    let last = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.net) { this.net.onState = () => {}; this.net.onBots = () => {}; this.net.onEvent = () => {}; }
  }

  update(dt) {
    this.time += dt;

    // My input.
    if (this.me.alive && !this.matchOver) {
      Object.assign(this.me.input, this.input.poll());
    }

    // AI controllers (local bots, or host-owned bots in MP).
    for (const [id, ctrl] of this.controllers) {
      const ship = this.shipById(id);
      if (ship) ctrl.update(dt, this);
    }

    // Remote ships: interpolate toward their snapshot.
    for (const ship of this.ships) {
      if (ship.authority || !ship.netTarget) continue;
      const s = ship.netTarget;
      const age = this.time - s.t;
      const px = s.x + s.vx * age, py = s.y + s.vy * age;
      const k = 1 - Math.exp(-12 * dt);
      ship.x = lerp(ship.x, px, k);
      ship.y = lerp(ship.y, py, k);
      ship.angle = angleLerp(ship.angle, s.a, k);
      ship.vx = s.vx; ship.vy = s.vy;
    }

    // Physics + weapons.
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      if (ship.authority) ship.update(dt, this);
      else {
        // Remote: still tick timers used by FX.
        ship.shieldFlash = Math.max(0, ship.shieldFlash - dt * 2.5);
        ship.hitFlash = Math.max(0, ship.hitFlash - dt * 4);
      }
      ship.updateWeapons(dt, this);
    }

    // Repair droids (healing + FX) for every ship, ours and mirrored ones.
    for (const ship of this.ships) ship.updateDroids(dt, this);

    // Damaged blocks vent smoke or crackle with electric arcs.
    this.emitDamageFX(dt);

    // Passing over the supply station refills every missile rack.
    this.updateStation();

    // Ship-ship collision: mass-weighted bounce + ram damage at the contact point.
    for (let i = 0; i < this.ships.length; i++) {
      for (let j = i + 1; j < this.ships.length; j++) {
        const a = this.ships[i], b = this.ships[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy), min = (a.radius + b.radius) * 0.75;
        if (d < min && d > 0.001) {
          const nx = dx / d, ny = dy / d;
          const push = (min - d) * 0.5;
          if (a.authority) { a.x -= nx * push; a.y -= ny * push; }
          if (b.authority) { b.x += nx * push; b.y += ny * push; }
          // Closing speed along the normal (positive = ramming each other).
          const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (vn > 0) {
            const mt = a.mass + b.mass;
            if (a.authority) { a.vx -= nx * vn * (2 * b.mass / mt) * 0.9; a.vy -= ny * vn * (2 * b.mass / mt) * 0.9; }
            if (b.authority) { b.vx += nx * vn * (2 * a.mass / mt) * 0.9; b.vy += ny * vn * (2 * a.mass / mt) * 0.9; }
            // Hard impacts crumple hulls — the heavier ship dishes out more.
            if (vn > 140) {
              const base = Math.min(70, (vn - 140) * 0.18);
              this.spark(a.x + nx * a.radius * 0.7, a.y + ny * a.radius * 0.7, '#ffd27a');
              this.shake = Math.min(16, this.shake + 5);
              if (a.authority && a.ramCooldown <= 0) {
                a.ramCooldown = 0.4;
                a.damageNearestAt(a.x + nx * a.radius * 0.7, a.y + ny * a.radius * 0.7, base * (2 * b.mass / mt), b.id, this);
              }
              if (b.authority && b.ramCooldown <= 0) {
                b.ramCooldown = 0.4;
                b.damageNearestAt(b.x - nx * b.radius * 0.7, b.y - ny * b.radius * 0.7, base * (2 * a.mass / mt), a.id, this);
              }
            }
          }
        }
      }
    }

    // Projectiles & FX.
    for (const arr of [this.bullets, this.rockets, this.missiles, this.mines, this.flares, this.particles]) {
      for (const p of arr) p.update(dt, this);
      let w = 0;
      for (let r = 0; r < arr.length; r++) if (arr[r].alive) arr[w++] = arr[r];
      arr.length = w;
    }

    // Deathmatch respawns (every mode, every ship we simulate).
    if (!this.matchOver) {
      for (const ship of this.ships) {
        if (!ship.authority || ship.alive || ship.respawnTimer <= 0) continue;
        ship.respawnTimer -= dt;
        if (ship === this.me) this.msg(`Destroyed! Respawn in ${Math.max(0, ship.respawnTimer).toFixed(1)}s`);
        if (ship.respawnTimer <= 0) {
          const sp = this.spawnPoint(Math.floor(Math.random() * 10));
          ship.respawn(sp.x, sp.y, sp.angle);
          if (ship === this.me) this.msg('');
          if (this.net) this.net.sendEvent({ k: 'spawn', ship: ship.id, x: sp.x, y: sp.y, a: sp.angle });
        }
      }
    }

    // Net snapshots.
    if (this.mode === 'mp') {
      this.snapTimer -= dt;
      if (this.snapTimer <= 0) { this.snapTimer = SNAP_RATE; this.sendSnapshot(); }
    }

    // Shockwaves + delayed secondary explosions.
    this.beamPulses = this.beamPulses.filter(b => (b.t += dt) < b.life);
    this.shockwaves = this.shockwaves.filter(w => (w.t += dt) < w.life);
    this.delayedBooms = this.delayedBooms.filter(b => {
      if (this.time < b.t) return true;
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * TAU, sp = 30 + Math.random() * 180;
        this.particles.push(new Particle(b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp,
          0.25 + Math.random() * 0.4, 2.5 + Math.random() * 4,
          ['#ffbe57', '#ff8a1e', '#ff5a10'][i % 3], 3));
      }
      this.shockwaves.push({ x: b.x, y: b.y, t: 0, life: 0.35, max: 65 });
      this.shake = Math.min(20, this.shake + 3);
      return false;
    });

    // Radar sweep: advance the beam, refresh a blip only as the beam passes it.
    // Heavier hulls carry a bigger dish → they see a little farther, light ones less.
    this.radarRange = clamp(1650 + this.me.mass * 20, 1500, 3400);
    const prevSweep = this.radarSweep;
    this.radarSweep = (this.radarSweep + (TAU / RADAR_REV) * dt) % TAU;
    const r2 = this.radarRange * this.radarRange;
    for (const s of this.ships) {
      if (s === this.me || !s.alive) continue;
      const dx = s.x - this.me.x, dy = s.y - this.me.y;
      if (dx * dx + dy * dy > r2) continue;
      if (angleInSweep(Math.atan2(dy, dx), prevSweep, this.radarSweep)) {
        this.radarBlips.set(s.id, { x: s.x, y: s.y, t: this.time });
      }
    }
    for (const [id, b] of this.radarBlips) {
      const s = this.shipById(id);
      if (!s || !s.alive || this.time - b.t > RADAR_REV * 1.05) this.radarBlips.delete(id);
    }

    // Camera.
    const focus = this.me.alive ? this.me : (this.ships.find(s => s.alive) || this.me);
    const sp = Math.hypot(focus.vx, focus.vy);
    const targetZoom = clamp(1.05 - sp / 900, 0.72, 1.0);
    this.zoom = lerp(this.zoom, targetZoom, 1 - Math.exp(-2 * dt));
    const k = 1 - Math.exp(-5 * dt);
    this.camX = lerp(this.camX, focus.x + focus.vx * 0.25, k);
    this.camY = lerp(this.camY, focus.y + focus.vy * 0.25, k);
    this.shake = Math.max(0, this.shake - dt * 30);
  }

  // ---- rendering --------------------------------------------------------------------
  render() {
    nextRenderFrame();
    const ctx = this.ctx;
    const W = this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
    const H = this.canvas.height = this.canvas.clientHeight * devicePixelRatio;
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, W, H);

    const scale = this.zoom * devicePixelRatio;
    const shx = (Math.random() - 0.5) * this.shake, shy = (Math.random() - 0.5) * this.shake;

    // Starfield (parallax, tiled).
    for (const layer of this.stars) {
      ctx.fillStyle = '#cfd8e8';
      const ox = (-this.camX * layer.parallax) % 2048, oy = (-this.camY * layer.parallax) % 2048;
      for (const [sx, sy, b] of layer.pts) {
        let x = (sx + ox) % 2048; if (x < 0) x += 2048;
        let y = (sy + oy) % 2048; if (y < 0) y += 2048;
        // tile across screen
        for (let tx = x * devicePixelRatio; tx < W + 2048; tx += 2048 * devicePixelRatio) {
          for (let ty = y * devicePixelRatio; ty < H + 2048; ty += 2048 * devicePixelRatio) {
            if (tx > W || ty > H) continue;
            ctx.globalAlpha = b * 0.8;
            ctx.fillRect(tx, ty, layer.size * devicePixelRatio, layer.size * devicePixelRatio);
          }
        }
      }
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(W / 2 + shx, H / 2 + shy);
    ctx.scale(scale, scale);
    ctx.translate(-this.camX, -this.camY);

    // Arena border.
    ctx.strokeStyle = 'rgba(120, 60, 200, 0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(-this.size / 2, -this.size / 2, this.size, this.size);

    // Asteroids.
    for (const a of this.asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.beginPath();
      ctx.moveTo(a.pts[0][0], a.pts[0][1]);
      for (const [px, py] of a.pts) ctx.lineTo(px, py);
      ctx.closePath();
      ctx.fillStyle = `rgb(${74 * a.tone | 0}, ${70 * a.tone | 0}, ${66 * a.tone | 0})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,18,16,0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // craters
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(a.r * 0.25, -a.r * 0.2, a.r * 0.18, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-a.r * 0.3, a.r * 0.28, a.r * 0.12, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // Supply station platform (under ships).
    this.renderStation(ctx);

    // Mines, flares (under ships).
    for (const m of this.mines) m.render(ctx);
    for (const f of this.flares) f.render(ctx);

    // Ships + overhead labels.
    for (const ship of this.ships) {
      ship.render(ctx);
      if (ship.alive && ship !== this.me) {
        ctx.save();
        ctx.translate(ship.x, ship.y - ship.radius - 14);
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(ship.name, 0, 0);
        // hp bar
        const w = 44, frac = clamp(ship.hp / ship.maxHpTotal, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-w / 2, 4, w, 4);
        ctx.fillStyle = frac > 0.5 ? '#6fdc6f' : frac > 0.25 ? '#e8c95c' : '#e85c5c';
        ctx.fillRect(-w / 2, 4, w * frac, 4);
        ctx.restore();
      }
    }

    // Charge-laser rays: luminous at the muzzle, shading out toward the tip.
    ctx.lineCap = 'round';
    for (const b of this.beamPulses) {
      const k = 1 - b.t / b.life;
      // Re-anchor to the (moving) firing ship; keep last coords if it died.
      if (b.ship && b.ship.alive) {
        [b.x1, b.y1] = b.ship.localToWorld(b.lx, b.ly);
        const a = b.la + b.ship.angle;
        b.x2 = b.x1 + Math.cos(a) * b.len;
        b.y2 = b.y1 + Math.sin(a) * b.len;
      }
      const g = ctx.createLinearGradient(b.x1, b.y1, b.x2, b.y2);
      g.addColorStop(0, `rgba(255,255,255,${0.95 * k})`);
      g.addColorStop(0.3, `rgba(255,157,245,${0.8 * k})`);
      g.addColorStop(0.75, `rgba(190,70,180,${0.4 * k})`);
      g.addColorStop(1, 'rgba(90,20,85,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1 + (4 + 10 * b.power) * k;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      // hot white core, fading out sooner than the glow
      const g2 = ctx.createLinearGradient(b.x1, b.y1, b.x2, b.y2);
      g2.addColorStop(0, `rgba(255,255,255,${0.95 * k})`);
      g2.addColorStop(0.55, `rgba(255,225,255,${0.35 * k})`);
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g2;
      ctx.lineWidth = Math.max(1, 2.5 * k);
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // Station pickup missiles + repair droids fly at ship level.
    this.renderStationMissiles(ctx);
    for (const ship of this.ships) ship.renderDroids(ctx);

    // Projectiles above ships.
    for (const b of this.bullets) b.render(ctx);
    for (const r of this.rockets) r.render(ctx);
    for (const m of this.missiles) m.render(ctx);
    for (const p of this.particles) p.render(ctx);

    // Shockwaves on top of everything.
    for (const w of this.shockwaves) {
      if (w.t < 0) continue;
      const k = w.t / w.life;
      const r = w.max * (1 - Math.pow(1 - k, 2.4)); // fast start, eased end
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.strokeStyle = '#cfeeff';
      ctx.lineWidth = 1.5 + 11 * (1 - k);
      ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.25;
      ctx.strokeStyle = '#5ecbff';
      ctx.lineWidth = 3 + 22 * (1 - k);
      ctx.beginPath(); ctx.arc(w.x, w.y, r * 0.92, 0, TAU); ctx.stroke();
      // hot white flash at the start
      if (k < 0.22) {
        ctx.globalAlpha = (1 - k / 0.22) * 0.9;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(w.x, w.y, 16 + w.max * 0.35 * k, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    this.renderHUD(ctx, W, H);
    this.updateControlsHint();
  }

  // Bottom-center control cheat-sheet, keyed to the input scheme in use.
  // Hidden on touch (the on-screen joystick/buttons speak for themselves).
  updateControlsHint() {
    const el = document.getElementById('controls-hint');
    if (!el) return;
    const src = this.input.activeSource;
    if (src === this._hintSrc) return;
    this._hintSrc = src;
    if (src === 'touch') { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const rows = src === 'gamepad'
      ? [['RT', 'Thrust'], ['L-Stick', 'Aim'], ['✕', 'Guns'], ['□', 'Missiles'], ['○', 'Mines'], ['△', 'Flares'], ['L1', 'Boost']]
      : [['W ↑', 'Thrust'], ['A D', 'Turn'], ['Space', 'Guns'], ['E', 'Missiles'], ['X', 'Mines'], ['F', 'Flares'], ['Shift', 'Boost']];
    el.innerHTML = rows.map(([k, a]) => `<span class="ck"><b>${k}</b>${a}</span>`).join('');
    el.classList.remove('hidden');
  }

  renderHUD(ctx, W, H) {
    const dpr = devicePixelRatio;
    const me = this.me;

    // HP + energy bars.
    const bw = Math.min(300 * dpr, W * 0.4), bh = 12 * dpr, x = 18 * dpr, y = 18 * dpr;
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, bw, bh);
    const hpFrac = clamp(me.hp / me.maxHpTotal, 0, 1);
    ctx.fillStyle = hpFrac > 0.5 ? '#6fdc6f' : hpFrac > 0.25 ? '#e8c95c' : '#e85c5c';
    ctx.fillRect(x, y, bw * hpFrac, bh);
    ctx.fillStyle = '#dfe8f2';
    ctx.fillText(`HULL ${Math.round(me.hp)}`, x + 4 * dpr, y + bh - 3 * dpr);

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y + bh + 6 * dpr, bw, bh);
    ctx.fillStyle = '#5ecbff';
    ctx.fillRect(x, y + bh + 6 * dpr, bw * clamp(me.energy / me.energyMax, 0, 1), bh);
    ctx.fillStyle = '#dfe8f2';
    ctx.fillText(`ENERGY ${Math.round(me.energy)}`, x + 4 * dpr, y + bh * 2 + 3 * dpr);

    // Missile reload bar — fills with red as the launcher reloads, bright red
    // when armed; goes dark when the racks are out of ammo.
    let bottom = y + bh * 2 + 6 * dpr;
    const missileParts = me.parts.filter(p => p.alive && p.def.kind === 'weapon' && p.def.weapon.type === 'missile');
    if (missileParts.length) {
      const my = bottom + 6 * dpr;
      // Least-ready rack drives the bar: full only once every launcher has reloaded.
      let frac = 1, ammo = 0, cap = 0;
      for (const p of missileParts) {
        frac = Math.min(frac, 1 - clamp(p.cooldown * p.def.weapon.rate, 0, 1));
        ammo += p.ammo; cap += p.def.weapon.ammo;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, my, bw, bh);
      if (ammo <= 0) {
        ctx.fillStyle = 'rgba(255, 210, 87, 0.9)';
        ctx.fillText('NO MISSILES — FIND THE SUPPLY STATION ◆', x + 4 * dpr, my + bh - 3 * dpr);
      } else {
        const ready = frac >= 1;
        ctx.fillStyle = ready ? '#ff5a5a' : '#d94f4f';
        ctx.fillRect(x, my, bw * frac, bh);
        ctx.fillStyle = '#dfe8f2';
        ctx.fillText(`${ready ? 'MISSILE READY' : 'MISSILE'} · AMMO ${ammo}/${cap}`, x + 4 * dpr, my + bh - 3 * dpr);
      }
      bottom = my + bh;
    }

    // Scoreboard.
    let sy = bottom + 18 * dpr;
    ctx.font = `bold ${9 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(159, 220, 255, 0.6)';
    ctx.fillText(`DEATHMATCH — FIRST TO ${KILL_TARGET}`, x, sy);
    sy += 15 * dpr;
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    const sorted = [...this.ships].sort((a, b) => b.kills - a.kills);
    for (const s of sorted.slice(0, 6)) {
      ctx.fillStyle = s === me ? '#8fd0ff' : s.alive ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
      ctx.fillText(`${s.name}  ${s.kills}`, x, sy);
      sy += 14 * dpr;
    }

    // Radar (top right): a real sweeping scope. The beam rotates; enemy blips
    // are painted at their last-pinged spot and fade until the beam finds them again.
    const rr = 62 * dpr, rx = W - rr - 16 * dpr, ry = rr + 16 * dpr, range = this.radarRange;
    ctx.save();
    ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU);
    ctx.fillStyle = 'rgba(6, 18, 14, 0.72)';
    ctx.fill();
    ctx.clip();
    // Range rings + cross-hair grid.
    ctx.strokeStyle = 'rgba(94, 255, 160, 0.28)';
    ctx.lineWidth = 1 * dpr;
    for (const f of [1, 0.66, 0.33]) { ctx.beginPath(); ctx.arc(rx, ry, rr * f, 0, TAU); ctx.stroke(); }
    ctx.beginPath();
    ctx.moveTo(rx - rr, ry); ctx.lineTo(rx + rr, ry);
    ctx.moveTo(rx, ry - rr); ctx.lineTo(rx, ry + rr);
    ctx.stroke();

    // Sweep beam: a fading trailing wedge chasing the leading edge.
    const sweep = this.radarSweep, span = TAU * 0.30, segs = 26;
    for (let i = 0; i < segs; i++) {
      const a0 = sweep - span * (i / segs), a1 = sweep - span * ((i + 1) / segs);
      ctx.globalAlpha = 0.18 * (1 - i / segs);
      ctx.fillStyle = '#5cffa0';
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.arc(rx, ry, rr, a1, a0); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(140, 255, 180, 0.9)';
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(sweep) * rr, ry + Math.sin(sweep) * rr); ctx.stroke();

    // Static terrain: asteroids always show, dim green.
    for (const a of this.asteroids) {
      const dx = (a.x - me.x) / range * rr, dy = (a.y - me.y) / range * rr;
      if (dx * dx + dy * dy > rr * rr) continue;
      ctx.fillStyle = 'rgba(120, 170, 140, 0.35)';
      ctx.beginPath(); ctx.arc(rx + dx, ry + dy, Math.max(1.3 * dpr, a.r / range * rr), 0, TAU); ctx.fill();
    }
    // Enemy blips from the last ping, fading over one revolution.
    for (const [, b] of this.radarBlips) {
      const dx = (b.x - me.x) / range * rr, dy = (b.y - me.y) / range * rr;
      if (dx * dx + dy * dy > rr * rr) continue;
      const fade = clamp(1 - (this.time - b.t) / RADAR_REV, 0, 1);
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#ff6f6f';
      ctx.beginPath(); ctx.arc(rx + dx, ry + dy, 3 * dpr, 0, TAU); ctx.fill();
      ctx.globalAlpha = fade * 0.4;
      ctx.beginPath(); ctx.arc(rx + dx, ry + dy, 5.5 * dpr, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Supply-station beacon — always on scope, pinned to the rim when out of range.
    {
      const st = this.ammoStation;
      let dx = (st.x - me.x) / range * rr, dy = (st.y - me.y) / range * rr;
      const dd = Math.hypot(dx, dy) || 1;
      if (dd > rr * 0.9) { dx *= rr * 0.9 / dd; dy *= rr * 0.9 / dd; }
      const bl = 0.6 + 0.4 * Math.sin(this.time * 5);
      ctx.fillStyle = `rgba(255, 210, 87, ${bl})`;
      const ds = 3.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(rx + dx, ry + dy - ds); ctx.lineTo(rx + dx + ds, ry + dy);
      ctx.lineTo(rx + dx, ry + dy + ds); ctx.lineTo(rx + dx - ds, ry + dy);
      ctx.closePath(); ctx.fill();
    }
    // Own ship at the center, pointing where we face.
    ctx.save();
    ctx.translate(rx, ry); ctx.rotate(me.angle);
    ctx.fillStyle = '#8effc0';
    ctx.beginPath(); ctx.moveTo(5 * dpr, 0); ctx.lineTo(-3.5 * dpr, -3 * dpr); ctx.lineTo(-3.5 * dpr, 3 * dpr); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
    // Scope rim.
    ctx.strokeStyle = 'rgba(94, 255, 160, 0.55)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.stroke();

    // Incoming-missile lock: full-screen pilot warning overlay.
    if (this.missiles.some(m => m.alive && m.targetId === me.id)) {
      this.renderMissileLock(ctx, W, H, dpr);
    }
  }

  // Missile-lock overlay: a clean pulsing red HUD frame with corner brackets and
  // edge tick marks, plus a warning label. No filled bands — just crisp lines.
  renderMissileLock(ctx, W, H, dpr) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
    ctx.save();
    ctx.lineJoin = 'miter';
    // Soft outer glow line, then a crisp inner line — a double frame.
    const m = 9 * dpr;
    ctx.strokeStyle = `rgba(255, 40, 40, ${0.14 + 0.16 * pulse})`;
    ctx.lineWidth = 12 * dpr;
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
    ctx.strokeStyle = `rgba(255, 70, 70, ${0.6 + 0.35 * pulse})`;
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
    // Corner brackets.
    ctx.strokeStyle = `rgba(255, 100, 100, ${0.75 + 0.25 * pulse})`;
    ctx.lineWidth = 3 * dpr;
    const c = 30 * dpr, o = m;
    for (const [cx, cy, sx, sy] of [[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * c); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * c, cy);
      ctx.stroke();
    }
    // Mid-edge tick marks.
    ctx.lineWidth = 2 * dpr;
    const t = 11 * dpr;
    ctx.beginPath();
    ctx.moveTo(W / 2 - t, m); ctx.lineTo(W / 2 + t, m);
    ctx.moveTo(W / 2 - t, H - m); ctx.lineTo(W / 2 + t, H - m);
    ctx.moveTo(m, H / 2 - t); ctx.lineTo(m, H / 2 + t);
    ctx.moveTo(W - m, H / 2 - t); ctx.lineTo(W - m, H / 2 + t);
    ctx.stroke();
    // Warning label, top-center.
    ctx.textAlign = 'center';
    ctx.font = `bold ${18 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = `rgba(255, 80, 80, ${0.7 + 0.3 * pulse})`;
    ctx.fillText('⚠  MISSILE LOCK  ⚠', W / 2, 40 * dpr);
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255, 180, 180, 0.85)';
    ctx.fillText('DEPLOY FLARES', W / 2, 58 * dpr);
    ctx.restore();
  }
}
