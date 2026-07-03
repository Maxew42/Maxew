import { updateAiPilot } from './ai.js';
import { PREMADE_BLUEPRINTS } from './parts.js';
import { PARTS } from './parts.js';
import { Ship } from './ship.js';
import {
  TAU,
  angleTo,
  clamp,
  dist,
  dist2,
  hashString,
  lineIntersectsCircle,
  makeRng,
  randRange,
  uid,
  wrapAngle,
} from './util.js';

const ARENA_RADIUS = 1850;
const PLAYER_COLORS = ['#68e1fd', '#f7b955', '#ff6b98', '#78e08f', '#b88cff', '#ff8a56'];

export class Game {
  constructor(canvas, input) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.net = null;
    this.mode = 'idle';
    this.time = 0;
    this.localPeerId = 'local';
    this.localShip = null;
    this.remoteShips = new Map();
    this.aiShips = [];
    this.projectiles = [];
    this.beams = [];
    this.particles = [];
    this.asteroids = [];
    this.stars = [];
    this.arena = { radius: ARENA_RADIUS };
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.controlsAi = false;
    this.networked = false;
    this.onHud = () => {};
    this.onFinish = () => {};
    this.onEvent = () => {};
    this._sendStateT = 0;
    this._sendAiT = 0;
    this.lastControls = null;
    this._finished = false;
    this._last = performance.now();
    this._dpr = 1;
    this.resize();
    addEventListener('resize', () => this.resize());
    requestAnimationFrame(t => this.loop(t));
  }

  resize() {
    this._dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    this.canvas.width = Math.floor(w * this._dpr);
    this.canvas.height = Math.floor(h * this._dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setNetwork(net) {
    this.net = net;
    this.networked = !!net;
    this.controlsAi = !net || net.isHost;
  }

  startSolo({ name, blueprint }) {
    const seed = Date.now() & 0xffffffff;
    const players = [{ peerId: 'local', name, blueprint, color: PLAYER_COLORS[0] }];
    this.startBattle({ seed, players, aiCount: 5, localPeerId: 'local', net: null });
  }

  startBattle({ seed, players, aiCount = 3, localPeerId, net = null }) {
    this.mode = 'battle';
    this.time = 0;
    this.net = net;
    this.networked = !!net;
    this.localPeerId = localPeerId || 'local';
    this.controlsAi = !net || net.isHost;
    this.remoteShips.clear();
    this.aiShips = [];
    this.projectiles = [];
    this.beams = [];
    this.particles = [];
    this._finished = false;
    this._sendStateT = 0;
    this._sendAiT = 0;
    this.generateArena(seed || 1);

    const sortedPlayers = players.slice().sort((a, b) => a.peerId.localeCompare(b.peerId));
    sortedPlayers.forEach((player, i) => {
      const ship = new Ship({
        id: shipIdForPeer(player.peerId),
        peerId: player.peerId,
        name: player.name || 'Pilot',
        color: player.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
        blueprint: player.blueprint || PREMADE_BLUEPRINTS[i % PREMADE_BLUEPRINTS.length],
      });
      placeAtSpawn(ship, i, sortedPlayers.length + aiCount);
      if (player.peerId === this.localPeerId) this.localShip = ship;
      else this.remoteShips.set(player.peerId, ship);
    });

    if (!this.localShip) {
      const fallback = sortedPlayers[0] || { name: 'Pilot', blueprint: PREMADE_BLUEPRINTS[0] };
      this.localShip = new Ship({
        id: shipIdForPeer(this.localPeerId),
        peerId: this.localPeerId,
        name: fallback.name,
        color: PLAYER_COLORS[0],
        blueprint: fallback.blueprint,
      });
      placeAtSpawn(this.localShip, 0, 1 + aiCount);
    }

    if (this.controlsAi) {
      const startIndex = sortedPlayers.length;
      for (let i = 0; i < aiCount; i++) {
        const bp = PREMADE_BLUEPRINTS[(i + 1) % PREMADE_BLUEPRINTS.length];
        const ai = new Ship({
          id: `ai-${i}`,
          peerId: `ai-${i}`,
          ai: true,
          name: `AI ${i + 1}`,
          color: PLAYER_COLORS[(i + 2) % PLAYER_COLORS.length],
          blueprint: bp,
        });
        placeAtSpawn(ai, startIndex + i, sortedPlayers.length + aiCount);
        this.aiShips.push(ai);
      }
    }

    document.body.classList.add('racing');
  }

  stop() {
    this.mode = 'idle';
    this.localShip = null;
    this.remoteShips.clear();
    this.aiShips = [];
    this.projectiles = [];
    this.beams = [];
    this.particles = [];
    document.body.classList.remove('racing');
  }

  generateArena(seed) {
    const rng = makeRng(seed >>> 0);
    this.asteroids = [];
    this.stars = [];
    for (let i = 0; i < 280; i++) {
      const r = Math.sqrt(rng()) * ARENA_RADIUS * 1.35;
      const a = rng() * TAU;
      this.stars.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        z: randRange(rng, 0.25, 1),
        s: randRange(rng, 0.7, 2.2),
        c: rng() > 0.7 ? '#f7b955' : rng() > 0.5 ? '#68e1fd' : '#e9f3ff',
      });
    }
    for (let i = 0; i < 22; i++) {
      const a = rng() * TAU;
      const rr = randRange(rng, 290, ARENA_RADIUS - 170);
      const radius = randRange(rng, 36, 115);
      const points = [];
      const n = Math.floor(randRange(rng, 8, 14));
      for (let j = 0; j < n; j++) {
        points.push(randRange(rng, 0.72, 1.22));
      }
      this.asteroids.push({
        id: `ast-${i}`,
        x: Math.cos(a) * rr,
        y: Math.sin(a) * rr,
        r: radius,
        rot: rng() * TAU,
        spin: randRange(rng, -0.14, 0.14),
        points,
        seed: rng(),
      });
    }
  }

  loop(now) {
    const dt = Math.min(0.034, (now - this._last) / 1000 || 0.016);
    this._last = now;
    this.time += dt;
    this.update(dt);
    this.draw();
    requestAnimationFrame(t => this.loop(t));
  }

  update(dt) {
    for (const asteroid of this.asteroids) asteroid.rot += asteroid.spin * dt;
    if (this.mode !== 'battle' || !this.localShip) {
      this.updateParticles(dt);
      return;
    }

    this.controlsAi = !this.net || this.net.isHost;
    const controls = this.input.read();
    this.lastControls = controls;
    if (controls.pause) {
      this._finished = true;
      this.onFinish({ title: 'Paused', detail: 'Battle left.' });
      return;
    }

    this.localShip.update(dt, controls, this.arena);
    this.resolveAsteroids(this.localShip, dt, true);
    this.tryFire(this.localShip, controls);

    if (this.controlsAi) {
      for (const ai of this.aiShips) {
        const aiControls = updateAiPilot(ai, dt, this);
        ai.update(dt, aiControls, this.arena);
        this.resolveAsteroids(ai, dt, true);
        this.tryFire(ai, aiControls);
      }
    }

    this.updateProjectiles(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);
    this.sendNetwork(dt);
    this.checkFinish();
    this.onHud(this.makeHud());
  }

  updateCamera(dt) {
    const target = this.localShip || { x: 0, y: 0 };
    this.camera.x += (target.x - this.camera.x) * (1 - Math.exp(-dt * 5));
    this.camera.y += (target.y - this.camera.y) * (1 - Math.exp(-dt * 5));
    const shortSide = Math.min(this.canvas.width / this._dpr, this.canvas.height / this._dpr);
    this.camera.zoom = clamp(shortSide / 760, 0.56, 1);
  }

  sendNetwork(dt) {
    if (!this.net || !this.net.connected) return;
    this._sendStateT += dt;
    this._sendAiT += dt;
    if (this._sendStateT > 1 / 15) {
      this._sendStateT = 0;
      this.net.sendState(this.localShip.serialize());
    }
    if (this.controlsAi && this._sendAiT > 1 / 10) {
      this._sendAiT = 0;
      this.net.sendAiState(this.aiShips.map(ai => ({
        ...ai.serialize(),
        blueprint: ai.blueprint,
        ai: true,
      })));
    }
  }

  receiveState(snapshot, peerId, profile) {
    if (!snapshot || peerId === this.localPeerId) return;
    let ship = this.remoteShips.get(peerId);
    if (!ship) {
      ship = new Ship({
        id: snapshot.id || shipIdForPeer(peerId),
        peerId,
        name: snapshot.name || profile?.name || 'Pilot',
        color: snapshot.color || profile?.color || '#f7b955',
        blueprint: profile?.blueprint || PREMADE_BLUEPRINTS[0],
      });
      this.remoteShips.set(peerId, ship);
    }
    ship.applySnapshot(snapshot);
  }

  receiveAiState(snapshots) {
    if (this.controlsAi || !Array.isArray(snapshots)) return;
    const byId = new Map(this.aiShips.map(ship => [ship.id, ship]));
    const next = [];
    for (const snapshot of snapshots) {
      let ship = byId.get(snapshot.id);
      if (!ship) {
        ship = new Ship({
          id: snapshot.id,
          peerId: snapshot.id,
          ai: true,
          name: snapshot.name || 'AI',
          color: snapshot.color || '#78e08f',
          blueprint: snapshot.blueprint || PREMADE_BLUEPRINTS[1],
        });
      }
      ship.applySnapshot(snapshot);
      next.push(ship);
    }
    this.aiShips = next;
  }

  receiveEvent(event) {
    if (!event || event.ownerId === this.localShip?.id && event.echo !== true) return;
    if (event.kind === 'beam') {
      this.applyBeam(event);
      return;
    }
    this.spawnProjectile(event);
  }

  allShips() {
    const ships = [];
    if (this.localShip) ships.push(this.localShip);
    ships.push(...this.remoteShips.values());
    ships.push(...this.aiShips);
    return ships;
  }

  authoritativeTargets(ownerId) {
    const targets = [];
    if (this.localShip && this.localShip.id !== ownerId) targets.push(this.localShip);
    if (this.controlsAi) {
      for (const ai of this.aiShips) {
        if (ai.id !== ownerId) targets.push(ai);
      }
    }
    return targets;
  }

  tryFire(ship, controls) {
    if (ship.dead) return;
    for (const part of ship.liveParts()) {
      const def = PARTS[part.type];
      const weapon = def.weapon;
      if (!weapon || part.cooldown > 0) continue;
      if (!controls[weapon.trigger]) continue;
      if (weapon.energy && ship.energy < weapon.energy) continue;
      if (weapon.energy) ship.energy -= weapon.energy;
      part.cooldown = weapon.interval;
      const event = this.buildWeaponEvent(ship, part, def, weapon);
      if (!event) continue;
      if (event.kind === 'beam') this.applyBeam(event);
      else this.spawnProjectile(event);
      if (this.net && this.net.connected) this.net.sendEvent(event);
    }
  }

  buildWeaponEvent(ship, part, def, weapon) {
    const mount = ship.partMount(part, weapon.kind === 'mine' || weapon.kind === 'flare' ? -0.62 : 0.58);
    const target = nearestEnemy(ship, this, weapon.kind === 'turret' || weapon.kind === 'missile');
    const baseAngle = weapon.kind === 'turret' && target
      ? Math.atan2(target.x - mount.x, -(target.y - mount.y))
      : ship.angle;
    const spread = (weapon.spread || 0) * (Math.random() * 2 - 1);
    const angle = wrapAngle(baseAngle + spread);
    const id = uid(weapon.kind);
    const color = def.color || ship.color;

    if (weapon.kind === 'beam') {
      const ex = mount.x + Math.sin(angle) * weapon.range;
      const ey = mount.y - Math.cos(angle) * weapon.range;
      return { kind: 'beam', id, ownerId: ship.id, x1: mount.x, y1: mount.y, x2: ex, y2: ey, damage: weapon.damage, color };
    }

    if (weapon.kind === 'mine') {
      return {
        kind: 'projectile',
        type: 'mine',
        id,
        ownerId: ship.id,
        x: mount.x,
        y: mount.y,
        vx: ship.vx * 0.15,
        vy: ship.vy * 0.15,
        angle: ship.angle,
        damage: weapon.damage,
        life: weapon.life,
        radius: 12,
        arm: 0.45,
        color,
      };
    }

    if (weapon.kind === 'flare') {
      return {
        kind: 'projectile',
        type: 'flare',
        id,
        ownerId: ship.id,
        x: mount.x,
        y: mount.y,
        vx: ship.vx * 0.2 - Math.sin(ship.angle) * 60,
        vy: ship.vy * 0.2 + Math.cos(ship.angle) * 60,
        angle: ship.angle,
        damage: 0,
        life: weapon.life,
        radius: 8,
        color,
      };
    }

    const speed = weapon.speed || 500;
    return {
      kind: 'projectile',
      type: weapon.kind === 'missile' ? 'missile' : 'bullet',
      id,
      ownerId: ship.id,
      targetId: weapon.kind === 'missile' && target ? target.id : null,
      x: mount.x,
      y: mount.y,
      vx: Math.sin(angle) * speed + ship.vx * 0.35,
      vy: -Math.cos(angle) * speed + ship.vy * 0.35,
      angle,
      speed,
      damage: weapon.damage,
      life: weapon.life,
      radius: weapon.kind === 'missile' ? 8 : 4,
      color,
    };
  }

  spawnProjectile(event) {
    const p = {
      kind: 'projectile',
      type: event.type,
      id: event.id || uid(event.type || 'p'),
      ownerId: event.ownerId,
      targetId: event.targetId || null,
      x: event.x,
      y: event.y,
      vx: event.vx || 0,
      vy: event.vy || 0,
      angle: event.angle || 0,
      speed: event.speed || Math.hypot(event.vx || 0, event.vy || 0),
      damage: event.damage || 0,
      life: event.life || 1,
      maxLife: event.life || 1,
      radius: event.radius || 4,
      arm: event.arm || 0,
      color: event.color || '#f7b955',
    };
    this.projectiles.push(p);
    if (p.type === 'flare') this.spawnParticles(p.x, p.y, '#ffef9b', 10, 160);
  }

  updateProjectiles(dt) {
    const survivors = [];
    for (const p of this.projectiles) {
      p.life -= dt;
      p.arm = Math.max(0, p.arm - dt);
      if (p.life <= 0) {
        if (p.type === 'flare') this.spawnParticles(p.x, p.y, '#ff9f5f', 5, 80);
        continue;
      }

      if (p.type === 'missile') this.updateMissile(p, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      let gone = false;
      if (Math.hypot(p.x, p.y) > ARENA_RADIUS + 160) gone = true;
      if (!gone && p.type !== 'flare') {
        for (const asteroid of this.asteroids) {
          if (dist2(p.x, p.y, asteroid.x, asteroid.y) < (asteroid.r + p.radius) ** 2) {
            this.spawnParticles(p.x, p.y, p.type === 'missile' ? '#ff6b78' : '#aab1bd', p.type === 'missile' ? 22 : 6, p.type === 'missile' ? 260 : 90);
            gone = true;
            break;
          }
        }
      }

      if (!gone && p.type !== 'flare') {
        for (const ship of this.authoritativeTargets(p.ownerId)) {
          if (ship.dead) continue;
          const hitR = p.type === 'mine' ? 42 : ship.radius + p.radius;
          if (p.arm <= 0 && dist2(p.x, p.y, ship.x, ship.y) < hitR * hitR) {
            this.hitShipWithProjectile(ship, p);
            gone = true;
            break;
          }
        }
      }

      if (!gone) survivors.push(p);
    }
    this.projectiles = survivors;
    this.beams = this.beams.filter(beam => {
      beam.life -= dt;
      return beam.life > 0;
    });
  }

  updateMissile(p, dt) {
    let target = null;
    let targetD = Infinity;
    for (const flare of this.projectiles) {
      if (flare.type !== 'flare') continue;
      const d = dist2(p.x, p.y, flare.x, flare.y);
      if (d < targetD && d < 420 * 420) {
        targetD = d;
        target = flare;
      }
    }
    if (!target && p.targetId) target = this.allShips().find(ship => ship.id === p.targetId && !ship.dead);
    if (!target) target = nearestEnemy({ id: p.ownerId, x: p.x, y: p.y }, this, true);
    if (target) {
      const desired = Math.atan2(target.x - p.x, -(target.y - p.y));
      p.angle = wrapAngle(p.angle + clamp(angleTo(p.angle, desired), -dt * 3.6, dt * 3.6));
      p.vx = Math.sin(p.angle) * p.speed;
      p.vy = -Math.cos(p.angle) * p.speed;
    }
    this.spawnParticles(p.x - Math.sin(p.angle) * 6, p.y + Math.cos(p.angle) * 6, '#ff9f5f', 1, 28);
  }

  hitShipWithProjectile(ship, p) {
    if (p.type === 'mine' || p.type === 'missile') {
      this.spawnParticles(p.x, p.y, p.type === 'mine' ? '#78e08f' : '#ff6b78', 32, 310);
      for (const target of this.authoritativeTargets(p.ownerId)) {
        const d = dist(p.x, p.y, target.x, target.y);
        const radius = p.type === 'mine' ? 130 : 105;
        if (d < radius) target.takeDamage(p.damage * (1 - d / radius * 0.45), p.x, p.y, { angle: p.angle });
      }
    } else {
      ship.takeDamage(p.damage, p.x, p.y, { angle: p.angle });
      this.spawnParticles(p.x, p.y, p.color, 8, 120);
    }
  }

  applyBeam(event) {
    this.beams.push({ ...event, life: 0.115 });
    for (const ship of this.authoritativeTargets(event.ownerId)) {
      if (ship.dead) continue;
      if (lineIntersectsCircle(event.x1, event.y1, event.x2, event.y2, ship.x, ship.y, ship.radius)) {
        ship.takeDamage(event.damage, ship.x, ship.y, { angle: Math.atan2(event.x2 - event.x1, -(event.y2 - event.y1)) });
        this.spawnParticles(ship.x, ship.y, event.color || '#aa7dff', 4, 80);
      }
    }
  }

  resolveAsteroids(ship, dt, canDamage) {
    if (!ship || ship.dead) return;
    for (const asteroid of this.asteroids) {
      const dx = ship.x - asteroid.x;
      const dy = ship.y - asteroid.y;
      const d = Math.hypot(dx, dy) || 1;
      const min = asteroid.r + ship.radius * 0.55;
      if (d >= min) continue;
      const nx = dx / d;
      const ny = dy / d;
      const overlap = min - d;
      ship.x += nx * overlap;
      ship.y += ny * overlap;
      const toward = ship.vx * nx + ship.vy * ny;
      if (toward < 0) {
        const impact = Math.abs(toward);
        ship.vx -= toward * nx * 1.45;
        ship.vy -= toward * ny * 1.45;
        ship.av += (Math.random() - 0.5) * 1.7;
        if (canDamage && impact > 115) {
          ship.takeDamage((impact - 90) * 0.055, ship.x - nx * ship.radius * 0.45, ship.y - ny * ship.radius * 0.45);
          this.spawnParticles(ship.x - nx * ship.radius, ship.y - ny * ship.radius, '#aab1bd', 9, 120);
        }
      }
    }
  }

  updateParticles(dt) {
    const keep = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 2.3);
      p.vy *= Math.exp(-dt * 2.3);
      keep.push(p);
    }
    this.particles = keep;
  }

  spawnParticles(x, y, color, count = 8, power = 100) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = Math.random() * power;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.25 + Math.random() * 0.65,
        maxLife: 0.9,
        size: 1.5 + Math.random() * 4,
        color,
      });
    }
  }

  checkFinish() {
    if (this._finished || this.mode !== 'battle') return;
    if (this.localShip.dead && this.localShip.deathTimer > 1.1) {
      this._finished = true;
      this.onFinish({ title: 'Defeat', detail: 'Your cockpit is gone.' });
      return;
    }
    const enemies = [...this.remoteShips.values(), ...this.aiShips].filter(ship => !ship.dead);
    if (enemies.length === 0 && this.time > 1.5) {
      this._finished = true;
      this.onFinish({ title: 'Victory', detail: 'Arena cleared.' });
      if (this.net && this.net.connected && this.net.isHost) this.net.sendEnd({ title: 'Victory', detail: 'Arena cleared.' });
    }
  }

  makeHud() {
    const ship = this.localShip;
    if (!ship) return null;
    const hp = ship.totalHp();
    const maxHp = ship.parts.reduce((sum, part) => sum + part.maxHp, 0);
    const enemies = [...this.remoteShips.values(), ...this.aiShips].filter(s => !s.dead).length;
    return {
      hp,
      maxHp,
      energy: ship.energy,
      maxEnergy: ship.maxEnergy,
      speed: Math.hypot(ship.vx, ship.vy),
      enemies,
      dead: ship.dead,
      controls: this.lastControls || {},
      blips: this.allShips().filter(s => s !== ship).map(s => ({
        x: s.x - ship.x,
        y: s.y - ship.y,
        color: s.color,
        dead: s.dead,
        ai: s.ai,
      })),
      asteroids: this.asteroids.map(a => ({ x: a.x - ship.x, y: a.y - ship.y, r: a.r })),
    };
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#03050b');
    g.addColorStop(0.48, '#090b12');
    g.addColorStop(1, '#120812');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const zoom = this.camera.zoom * this._dpr;
    ctx.setTransform(zoom, 0, 0, zoom, w / 2 - this.camera.x * zoom, h / 2 - this.camera.y * zoom);
    this.drawStars(ctx);
    this.drawArena(ctx);
    this.drawAsteroids(ctx);
    this.drawBeams(ctx);
    this.drawProjectiles(ctx);
    this.drawShips(ctx);
    this.drawParticles(ctx);
  }

  drawStars(ctx) {
    ctx.save();
    for (const star of this.stars) {
      const px = star.x - this.camera.x * star.z * 0.22;
      const py = star.y - this.camera.y * star.z * 0.22;
      ctx.globalAlpha = 0.35 + star.z * 0.55;
      ctx.fillStyle = star.c;
      ctx.beginPath();
      ctx.arc(px, py, star.s / this.camera.zoom, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawArena(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(104,225,253,0.28)';
    ctx.lineWidth = 4 / this.camera.zoom;
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(247,185,85,0.1)';
    ctx.lineWidth = 1 / this.camera.zoom;
    for (let r = 420; r < ARENA_RADIUS; r += 420) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawAsteroids(ctx) {
    for (const asteroid of this.asteroids) {
      ctx.save();
      ctx.translate(asteroid.x, asteroid.y);
      ctx.rotate(asteroid.rot);
      ctx.fillStyle = '#5e6570';
      ctx.strokeStyle = '#262b32';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const n = asteroid.points.length;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        const r = asteroid.r * asteroid.points[i];
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = '#c5cad1';
      ctx.beginPath();
      ctx.arc(-asteroid.r * 0.24, -asteroid.r * 0.18, asteroid.r * 0.18, 0, TAU);
      ctx.arc(asteroid.r * 0.28, asteroid.r * 0.22, asteroid.r * 0.12, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawShips(ctx) {
    const ships = [...this.remoteShips.values(), ...this.aiShips];
    for (const ship of ships) ship.draw(ctx, { alpha: ship.dead ? 0.55 : 1 });
    if (this.localShip) this.localShip.draw(ctx, { local: true });
  }

  drawProjectiles(ctx) {
    for (const p of this.projectiles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      if (p.type === 'bullet') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, TAU);
        ctx.fill();
      } else if (p.type === 'missile') {
        ctx.fillStyle = '#252025';
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(6, 7);
        ctx.lineTo(-6, 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.type === 'mine') {
        ctx.globalAlpha = p.arm > 0 ? 0.5 : 1;
        ctx.strokeStyle = p.color;
        ctx.fillStyle = '#111a18';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, TAU);
        ctx.fill();
        ctx.stroke();
      } else if (p.type === 'flare') {
        ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 34);
        g.addColorStop(0, '#fff6b5');
        g.addColorStop(0.4, p.color);
        g.addColorStop(1, 'rgba(255,159,95,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawBeams(ctx) {
    for (const beam of this.beams) {
      ctx.save();
      ctx.globalAlpha = clamp(beam.life / 0.115, 0, 1);
      ctx.strokeStyle = beam.color || '#aa7dff';
      ctx.lineWidth = 7;
      ctx.shadowColor = beam.color || '#aa7dff';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(beam.x1, beam.y1);
      ctx.lineTo(beam.x2, beam.y2);
      ctx.stroke();
      ctx.strokeStyle = '#f6eeff';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

function nearestEnemy(ship, game, includeRemote = true) {
  let best = null;
  let bestD = Infinity;
  for (const other of game.allShips()) {
    if (other.id === ship.id || other.dead) continue;
    if (!includeRemote && !other.ai && other !== game.localShip) continue;
    if (ship.ai && other.ai) continue;
    const d = dist2(ship.x, ship.y, other.x, other.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function placeAtSpawn(ship, index, total) {
  const angle = index / Math.max(1, total) * TAU;
  const r = 670 + (index % 2) * 90;
  ship.x = Math.sin(angle) * r;
  ship.y = -Math.cos(angle) * r;
  ship.angle = wrapAngle(angle + Math.PI);
  ship.vx = 0;
  ship.vy = 0;
}

export function shipIdForPeer(peerId) {
  return `ship-${String(peerId || 'local').replace(/[^a-zA-Z0-9_-]/g, '') || hashString(String(peerId))}`;
}
