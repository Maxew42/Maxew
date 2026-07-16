// Notebook War — match simulation, rendering and net sync.
//
// Authority model (same spirit as the other games in this repo):
//  - each peer simulates its own stickman and its own projectiles;
//  - the host (lowest peer id) simulates bots and item spawners;
//  - damage to a remote stickman is sent as a 'hit' event, applied by its owner;
//  - explosions are broadcast and applied deterministically by every peer.
import { TILE, T_SOLID, T_WALL, T_PLAT, WALL_HP, generateMap, renderPaper, renderTiles, drawDecor, drawDecorDebris } from './map.js';
import { Stickman, MAN_W, MAN_H, drawWeapon } from './stickman.js';
import { WEAPONS, THROW_BASE_DMG, randomWeapon, randomLoot } from './weapons.js';
import { AIController, botName } from './ai.js';
import { audio } from './audio.js';
import { clamp, lerp, dist, dist2, seededRandom, TAU, angleLerp, wrapAngle, escapeHtml } from './util.js';

const SNAP_DT = 1 / 12;
const VIEW = 660, VIEW_AWP = 1080, NEAR = 88, FOV = 2.7;
const WKEYS = Object.keys(WEAPONS);
const $ = sel => document.querySelector(sel);

export class Game {
  constructor({ canvas, input, mode, net = null, seed, myName, bots = [], killTarget = 10, onMatchOver = () => {} }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.mode = mode;
    this.net = net;
    this.seed = seed >>> 0;
    this.killTarget = killTarget;
    this.onMatchOver = onMatchOver;
    this.audio = audio;

    this.map = generateMap(this.seed);
    this.time = 0;
    this.snapT = 0;
    this.matchOver = false;
    this.running = false;

    // Persistent gore layer: blood, corpses, debris and scorch marks pile up here.
    this.gore = document.createElement('canvas');
    this.gore.width = this.map.pxw; this.gore.height = this.map.pxh;
    this.gctx = this.gore.getContext('2d');

    this.fog = document.createElement('canvas');
    this.fctx = this.fog.getContext('2d');

    this.men = [];
    this.controllers = new Map();
    this.bullets = [];
    this.lobbed = [];
    this.mines = [];
    this.smokes = [];
    this.items = [];
    this.particles = [];
    this.rings = [];
    this.corpses = [];
    this.scores = new Map();   // id -> kills
    this.deaths = new Map();
    this.names = new Map();
    this.itemSeq = 0;
    this.feedTimers = [];

    this.myId = net ? net.selfId : 'me';
    this.cam = { x: 0, y: 0, shake: 0 };

    // Me.
    const me = new Stickman({ id: this.myId, name: myName, authority: true });
    this.me = me;
    this.men.push(me);
    this.names.set(me.id, myName);
    this.spawnMan(me, true);
    this.giveStartingWeapon(me);

    // Bots (solo: mine; multi: everyone builds them, host runs them).
    bots.forEach((b, i) => {
      const bot = new Stickman({ id: 'bot' + i, name: b.name || botName(i), isBot: true, authority: !net || net.isHost });
      this.men.push(bot);
      this.names.set(bot.id, bot.name);
      this.spawnMan(bot, true);
      this.giveStartingWeapon(bot);
      if (bot.authority) this.controllers.set(bot.id, new AIController(bot, b.difficulty || 'normal'));
      this.botDiff = b.difficulty || 'normal';
    });

    // Remote players already in the room.
    if (net) {
      for (const [peerId, prof] of net.profiles) this.addRemote(peerId, prof);
      this.attachNet();
    }

    // Deterministic initial loot on every pad.
    const rng = seededRandom(this.seed ^ 0x9e3779b9);
    for (const pad of this.map.weaponPads) {
      const it = this.addItem({ id: 'seed' + this.itemSeq++, kind: 'weapon', wkind: randomWeapon(rng), x: pad.x, y: pad.y });
      pad.itemId = it.id; pad.t = 9 + rng() * 6;
    }
    for (const pad of this.map.itemPads) {
      const it = this.addItem({ id: 'seed' + this.itemSeq++, kind: randomLoot(rng), x: pad.x, y: pad.y });
      pad.itemId = it.id; pad.t = 12 + rng() * 8;
    }

    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
  }

  giveStartingWeapon(man) {
    man.slots[0] = null; man.slots[1] = null; man.cur = 0;
    const kind = randomWeapon();
    man.slots[0] = { kind, ammo: WEAPONS[kind].ammo };
  }

  spawnMan(man, initial = false) {
    const sp = this.pickSpawn();
    man.respawn(sp.x, sp.y);
    if (!initial && this.net && man === this.me) this.net.sendEvent({ k: 'spawn', x: sp.x, y: sp.y });
    if (!initial && this.net && man.isBot && man.authority) this.net.sendEvent({ k: 'bspawn', id: man.id, x: sp.x, y: sp.y });
  }

  pickSpawn() {
    const foes = this.men.filter(m => m.alive);
    let best = this.map.spawns[0], bd = -1;
    for (const sp of this.map.spawns) {
      let d = Infinity;
      for (const f of foes) d = Math.min(d, dist(sp.x, sp.y, f.x, f.y));
      d += Math.random() * 200;
      if (d > bd) { bd = d; best = sp; }
    }
    return best;
  }

  addRemote(peerId, prof) {
    if (this.men.some(m => m.id === peerId)) return;
    const man = new Stickman({ id: peerId, name: prof?.name || '???', authority: false });
    this.men.push(man);
    this.names.set(peerId, man.name);
    const sp = this.map.spawns[0];
    man.respawn(sp.x, sp.y);
  }

  manById(id) { return this.men.find(m => m.id === id); }
  nameOf(id) { return this.names.get(id) || '???'; }

  // ---------------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------------
  attachNet() {
    const net = this.net;
    net.onState = (s, peerId) => {
      const man = this.manById(peerId);
      if (man && !man.authority) this.applySnapshot(man, s);
    };
    net.onBots = arr => {
      if (net.isHost) return;
      for (const s of arr) {
        const man = this.manById(s.id);
        if (man && !man.authority) this.applySnapshot(man, s);
      }
    };
    net.onEvent = (e, peerId) => this.onEvent(e, peerId);
    net.onPeers = () => {
      const valid = new Set([this.myId, ...net.peers]);
      this.men = this.men.filter(m => m.isBot || valid.has(m.id));
      for (const [peerId, prof] of net.profiles) this.addRemote(peerId, prof);
      // Host migration: the new host adopts the bots.
      for (const m of this.men) {
        if (m.isBot) {
          m.authority = net.isHost;
          if (net.isHost && !this.controllers.has(m.id)) this.controllers.set(m.id, new AIController(m, this.botDiff || 'normal'));
          if (!net.isHost) this.controllers.delete(m.id);
        }
      }
    };
  }

  snapshotOf(man) {
    return {
      x: Math.round(man.x * 10) / 10, y: Math.round(man.y * 10) / 10,
      vx: Math.round(man.vx), vy: Math.round(man.vy),
      a: Math.round(man.aim * 500) / 500,
      f: (man.input.fire ? 1 : 0) | (man.onGround ? 2 : 0) | (man.alive ? 4 : 0),
      hp: Math.round(man.hp), ar: Math.round(man.armor), he: man.helmetHp > 0 ? 1 : 0,
      w: WKEYS.indexOf(man.weapon.kind),
      j: man.jetFuel > 0 ? 1 : 0, dr: man.drugT > 0 ? 1 : 0,
    };
  }

  applySnapshot(man, s) {
    man.netTarget = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, t: this.time };
    man.netAim = s.a;
    man.netFire = !!(s.f & 1);
    man.onGround = !!(s.f & 2);
    man.hp = s.hp; man.armor = s.ar; man.helmetHp = s.he ? 1 : 0;
    man.jetFuel = s.j ? 1 : 0; man.drugT = s.dr ? 1 : 0;
    const alive = !!(s.f & 4);
    if (alive && !man.alive) man.alive = true;
    const kind = WKEYS[s.w] || 'hands';
    if (man.weapon.kind !== kind) { man.slots[0] = { kind, ammo: WEAPONS[kind].ammo }; man.cur = 0; }
  }

  onEvent(e, peerId) {
    switch (e.k) {
      case 'hit': {
        const man = this.manById(e.t);
        if (man) {
          this.bloodBurst(e.x ?? man.x, (e.y ?? man.y - 30), e.dx || 0, e.d);
          if (man.authority) {
            this.hurt(man, e.d, { by: e.by, head: e.hs, kind: e.wk, kx: e.kx, ky: e.ky });
          }
        }
        break;
      }
      case 'die': this.handleDeath(e); break;
      case 'spawn': {
        const man = this.manById(peerId);
        if (man && !man.authority) { man.respawn(e.x, e.y); }
        break;
      }
      case 'bspawn': {
        const man = this.manById(e.id);
        if (man && !man.authority) man.respawn(e.x, e.y);
        break;
      }
      case 'boom': this.applyExplosion(e.x, e.y, e.r, e.dmg, e.by, e.br, false); break;
      case 'tile': {
        this.map.destroyTile(e.i);
        this.wallDebris((e.i % this.map.w + 0.5) * TILE, (Math.floor(e.i / this.map.w) + 0.5) * TILE);
        break;
      }
      case 'decor': {
        const d = this.map.decors.find(x => x.id === e.id);
        if (d && !d.broken) this.breakDecor(d, false);
        break;
      }
      case 'smoke': this.smokes.push({ x: e.x, y: e.y, r: 20, maxR: 105, t: 10 }); break;
      case 'mine': this.mines.push({ id: e.id, x: e.x, y: e.y, owner: e.by, armT: 0.9, local: false }); break;
      case 'mineoff': this.mines = this.mines.filter(mn => mn.id !== e.id); break;
      case 'item': this.addItem(e.it); break;
      case 'take': {
        const it = this.items.find(i => i.id === e.id);
        if (it) this.items = this.items.filter(i => i !== it);
        break;
      }
      case 'wpn': this.addItem(e.it); break;
    }
  }

  sendSnapshots() {
    if (!this.net) return;
    this.net.sendState(this.snapshotOf(this.me));
    if (this.net.isHost) {
      const bots = this.men.filter(m => m.isBot).map(m => ({ id: m.id, ...this.snapshotOf(m) }));
      if (bots.length) this.net.sendBots(bots);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  start() {
    this.running = true;
    addEventListener('resize', this.resize);
    this.resize();
    this.cam.x = this.me.x; this.cam.y = this.me.y - 60;
    this.lastT = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    removeEventListener('resize', this.resize);
    if (this.net) { this.net.onState = () => {}; this.net.onBots = () => {}; this.net.onEvent = () => {}; }
    for (const t of this.feedTimers) clearTimeout(t);
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.cssW = innerWidth; this.cssH = innerHeight;
    this.canvas.width = this.cssW * dpr; this.canvas.height = this.cssH * dpr;
    this.dpr = dpr;
    this.scale = clamp(this.cssH / 640, 0.85, 1.9) * (this.cssW < 700 ? 0.82 : 1);
    this.fog.width = this.canvas.width; this.fog.height = this.canvas.height;
  }

  loop(t) {
    if (!this.running) return;
    const dt = Math.min(0.033, (t - this.lastT) / 1000 || 0.016);
    this.lastT = t;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    const me = this.me;

    // My input.
    const inp = this.input.poll(mouse => {
      const w = this.screenToWorld(mouse.x, mouse.y);
      return Math.atan2(w.y - (me.y - 34), w.x - me.x);
    });
    this.showScore = inp.score || this.matchOver;
    if (me.alive && !this.matchOver) {
      me.input.mx = inp.mx;
      me.input.jump = inp.jump; me.input.jumpP = inp.jumpP; me.input.dropP = inp.dropP;
      if (inp.aim != null) me.input.aim = inp.aim;
      me.input.fire = inp.fire; me.input.fireP = inp.fireP;
      me.input.swapP = inp.swapP; me.input.throwP = inp.throwP; me.input.pickP = inp.pickP;
    } else {
      me.input.mx = 0; me.input.fire = false; me.input.fireP = false;
      me.input.jump = me.input.jumpP = me.input.swapP = me.input.throwP = me.input.pickP = false;
    }

    // Stickmen.
    for (const m of this.men) {
      if (m.authority) {
        const ctrl = this.controllers.get(m.id);
        if (ctrl && !this.matchOver) ctrl.update(dt, this);
        m.update(dt, this);
        if (!m.alive) {
          m.respawnT -= dt;
          if (m.respawnT <= 0 && !this.matchOver) this.spawnMan(m);
        }
      } else {
        this.updateRemote(m, dt);
      }
    }

    // Auto pickups + manual weapon pickups for authority men.
    for (const m of this.men) if (m.authority && m.alive) this.checkPickups(m);

    this.updateBullets(dt);
    this.updateLobbed(dt);
    this.updateMines(dt);
    this.updateSmokes(dt);
    this.updateItems(dt);
    this.updateParticles(dt);
    this.updateCorpses(dt);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter(r => r.t < r.dur);

    // Host: refill spawn pads.
    if (!this.net || this.net.isHost) this.updateSpawners(dt);

    // Snapshots.
    this.snapT -= dt;
    if (this.net && this.snapT <= 0) { this.snapT = SNAP_DT; this.sendSnapshots(); }

    // Camera.
    const lookX = Math.cos(me.input.aim || 0) * 70, lookY = Math.sin(me.input.aim || 0) * 30;
    const tx = me.x + lookX, ty = me.y - 50 + lookY;
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 7);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 7);
    const vw = this.cssW / this.scale, vh = this.cssH / this.scale;
    this.cam.x = clamp(this.cam.x, vw / 2 - 60, this.map.pxw - vw / 2 + 60);
    this.cam.y = clamp(this.cam.y, vh / 2 - 200, this.map.pxh - vh / 2 + 20);
    this.cam.shake = Math.max(0, this.cam.shake - dt * 26);
  }

  updateRemote(m, dt) {
    if (!m.netTarget) return;
    const nt = m.netTarget;
    const ext = Math.min(0.25, this.time - nt.t);
    const tx = nt.x + nt.vx * ext, ty = nt.y + nt.vy * ext;
    const k = Math.min(1, dt * 11);
    if (dist2(m.x, m.y, tx, ty) > 240 * 240) { m.x = tx; m.y = ty; }
    else { m.x += (tx - m.x) * k; m.y += (ty - m.y) * k; }
    m.vx = nt.vx; m.vy = nt.vy;
    if (m.netAim != null) m.aim = angleLerp(m.aim, m.netAim, Math.min(1, dt * 14));
    m.input.aim = m.aim;
    m.facing = Math.cos(m.aim) >= 0 ? 1 : -1;
    m.phase += m.vx * dt * 0.045;
    m.hurtT -= dt; m.swingT -= dt; m.fireCd -= dt;

    // Cosmetic fire: mirror their muzzle flashes and (harmless) tracers.
    if (m.netFire && m.alive) {
      const d = m.wdef;
      m.remoteCd = (m.remoteCd || 0) - dt;
      if (m.remoteCd <= 0) {
        if (d.kind === 'gun' && !d.rocket) {
          m.remoteCd = 1 / d.rate;
          this.spawnBullets(m, d, true);
          if (this.canSee(m.x, m.y - 30)) this.audio.shoot(m.weapon.kind);
        } else if (d.kind === 'melee') {
          m.remoteCd = 1 / d.rate;
          m.swingT = 0.22;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Combat
  // ---------------------------------------------------------------------------
  fireGun(man, def) {
    this.audio.shoot(man.weapon.kind);
    this.muzzleFx(man);
    if (man === this.me) this.cam.shake += (def.recoil || 1) * 0.7;
    if (def.rocket) {
      const a = man.aim;
      this.lobbed.push({
        type: 'rocket', x: man.x + Math.cos(a) * 22, y: man.y - 34 + Math.sin(a) * 22,
        vx: Math.cos(a) * def.vel, vy: Math.sin(a) * def.vel,
        owner: man.id, def, grav: 60, t: 0, local: true,
      });
      return;
    }
    this.spawnBullets(man, def, false);
    // Shell casing.
    if (!def.flame) this.particles.push({
      type: 'casing', x: man.x, y: man.y - 34, vx: -man.facing * (40 + Math.random() * 50), vy: -120 - Math.random() * 60,
      t: 0, life: 0.9,
    });
  }

  spawnBullets(man, def, cosmetic) {
    const n = def.pellets || 1;
    const heatSpread = def.spreadMax ? lerp(def.spread, def.spreadMax, man.heat) : def.spread;
    for (let i = 0; i < n; i++) {
      const a = man.aim + (Math.random() - 0.5) * 2 * heatSpread;
      const v = def.vel * (def.flame ? 0.8 + Math.random() * 0.4 : 1);
      this.bullets.push({
        x: man.x + Math.cos(man.aim) * 20, y: man.y - 34 + Math.sin(man.aim) * 20,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        dmg: def.dmg, owner: man.id, life: def.range / def.vel,
        kind: man.weapon.kind, flame: !!def.flame, burn: def.burn || 0,
        knock: def.knock || 60, cosmetic, t: 0, grav: def.flame ? -60 : 0,
      });
    }
  }

  meleeAttack(man, def) {
    this.audio.swing();
    const mul = man.drugT > 0 ? 1.9 : 1;
    const reach = def.range + 8;
    let hitSomething = false;
    for (const o of this.men) {
      if (o === man || !o.alive) continue;
      const dx = o.x - man.x, dy = (o.y - 24) - (man.y - 24);
      if (Math.abs(dy) > 46) continue;
      if (dx * man.facing < -6 || Math.abs(dx) > reach) continue;
      hitSomething = true;
      this.applyHit(o, def.dmg * mul, {
        by: man.id, wk: man.weapon.kind,
        kx: man.facing * (def.knock || 200), ky: -120,
        x: o.x, y: o.y - 34, dx: man.facing,
      });
    }
    // Furniture and drywall take punches too.
    const px = man.x + man.facing * (reach - 6), py = man.y - 28;
    for (const d of this.map.decors) {
      if (d.broken) continue;
      if (px > d.x - 4 && px < d.x + d.w + 4 && py > d.y - 4 && py < d.y + d.h + 4) {
        this.damageDecor(d, def.dmg * mul * 1.5, true);
        hitSomething = true;
        break;
      }
    }
    const destroyed = this.map.damageWallPx(px, py, def.dmg * mul * 1.6);
    if (destroyed >= 0) this.onWallDestroyed(destroyed);
    else if (this.map.tPx(px, py) === T_WALL) { this.wallChip(px, py); hitSomething = true; }
    if (hitSomething) this.audio.hit();
  }

  // Damage routed to whoever owns the target.
  applyHit(target, dmg, opts) {
    if (target.authority) {
      this.hurt(target, dmg, { by: opts.by, head: opts.hs, kind: opts.wk, kx: opts.kx, ky: opts.ky });
      this.bloodBurst(opts.x ?? target.x, opts.y ?? target.y - 30, opts.dx || 0, dmg);
    } else {
      this.bloodBurst(opts.x ?? target.x, opts.y ?? target.y - 30, opts.dx || 0, dmg);
      if (this.net) this.net.sendEvent({ k: 'hit', t: target.id, d: Math.round(dmg * 10) / 10, ...opts });
    }
  }

  hurt(man, dmg, { by = null, head = false, kind = 'pistol', kx = 0, ky = 0, silent = false } = {}) {
    if (!man.alive || this.matchOver) return;
    let eff = dmg;
    if (head) {
      if (man.helmetHp > 0) { man.helmetHp -= dmg; if (man.helmetHp <= 0 && man === this.me) this.flash('Casque détruit !'); }
      else eff = dmg * 1.75;
    }
    const ab = Math.min(man.armor, eff * 0.55);
    man.armor -= ab;
    eff -= ab;
    man.hp -= eff;
    man.hurtT = 0.25;
    man.vx += kx * 0.8; man.vy += ky * 0.5;
    if (!silent && man === this.me) { this.cam.shake += Math.min(6, eff * 0.25); this.audio.hurt(); }
    if (man.hp <= 0) {
      const ev = { k: 'die', v: man.id, by, wk: kind, x: Math.round(man.x), y: Math.round(man.y), dx: Math.sign(kx) || 1 };
      if (this.net) this.net.sendEvent(ev);
      this.handleDeath(ev);
    }
  }

  handleDeath(e) {
    const man = this.manById(e.v);
    if (!man || !man.alive) return;
    man.alive = false;
    man.respawnT = 3;
    this.deaths.set(e.v, (this.deaths.get(e.v) || 0) + 1);
    if (e.by && e.by !== e.v) this.scores.set(e.by, (this.scores.get(e.by) || 0) + 1);
    this.audio.death();
    this.addCorpse(man, e.dx || 1);
    this.bloodBurst(e.x, e.y - 30, e.dx || 0, 90);
    const wname = WEAPONS[e.wk]?.name || '???';
    this.addFeed(`${escapeHtml(this.nameOf(e.by))} ☠ ${escapeHtml(this.nameOf(e.v))} <span class="feed-w">(${wname})</span>`);

    // Authority drops the victim's arsenal on the floor.
    if (man.authority) {
      for (const slot of man.slots) {
        if (!slot || (WEAPONS[slot.kind].kind !== 'melee' && slot.ammo <= 0)) continue;
        this.dropWeapon(man.x + (Math.random() * 40 - 20), man.y - 20, slot.kind, slot.ammo, true);
      }
      man.slots = [null, null];
    }
    if (man === this.me) this.flash('☠ Tué ! Réapparition…');

    const score = this.scores.get(e.by) || 0;
    if (score >= this.killTarget && !this.matchOver) {
      this.matchOver = true;
      this.onMatchOver(e.by, this.ranking());
    }
  }

  ranking() {
    const ids = new Set([...this.men.map(m => m.id)]);
    return [...ids].map(id => ({ id, name: this.nameOf(id), kills: this.scores.get(id) || 0, deaths: this.deaths.get(id) || 0 }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  throwGrenade(man, kind) {
    const def = WEAPONS[kind];
    const a = man.aim;
    this.audio.swing();
    this.lobbed.push({
      type: kind, x: man.x + Math.cos(a) * 14, y: man.y - 38 + Math.sin(a) * 10,
      vx: Math.cos(a) * def.throwVel + man.vx * 0.4, vy: Math.sin(a) * def.throwVel - 60,
      fuse: def.fuse, owner: man.id, def, spin: 0, t: 0, local: man.authority,
    });
  }

  placeMine(man) {
    const id = this.myShort() + '-m' + this.itemSeq++;
    const mine = { id, x: man.x + man.facing * 20, y: man.y, owner: man.id, armT: 0.9, local: true };
    this.mines.push(mine);
    this.audio.swap();
    if (this.net) this.net.sendEvent({ k: 'mine', id, x: mine.x, y: mine.y, by: man.id });
  }

  throwWeapon(man) {
    const slot = man.takeWeapon();
    if (!slot) return;   // bare hands stay attached
    const def = WEAPONS[slot.kind];
    const a = man.aim;
    this.audio.swing();
    this.lobbed.push({
      type: 'wpnthrow', x: man.x + Math.cos(a) * 14, y: man.y - 38,
      vx: Math.cos(a) * 780 + man.vx * 0.4, vy: Math.sin(a) * 780 - 60,
      wkind: slot.kind, ammo: slot.ammo, owner: man.id,
      dmg: Math.max(THROW_BASE_DMG, def.throwDmg || 0),
      spin: 0, dealt: false, t: 0, local: man.authority, rest: 0,
    });
    if (man.slots[1 - man.cur]) man.cur = 1 - man.cur;
  }

  // ---------------------------------------------------------------------------
  // Projectiles
  // ---------------------------------------------------------------------------
  updateBullets(dt) {
    const map = this.map;
    for (const b of this.bullets) {
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      if (b.grav) b.vy += b.grav * dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 10));
      const sx = b.vx * dt / steps, sy = b.vy * dt / steps;
      for (let s = 0; s < steps && !b.dead; s++) {
        b.x += sx; b.y += sy;
        const t = map.tPx(b.x, b.y);
        if (t === T_SOLID) {
          b.dead = true;
          if (!b.flame) this.sparkFx(b.x - sx, b.y - sy);
          break;
        }
        if (t === T_WALL) {
          b.dead = true;
          if (!b.cosmetic) {
            const destroyed = map.damageWallPx(b.x, b.y, b.dmg * (b.kind === 'awp' ? 3 : 1));
            if (destroyed >= 0) this.onWallDestroyed(destroyed, true);
            else this.wallChip(b.x, b.y);
          }
          break;
        }
        // Stickmen.
        for (const m of this.men) {
          if (!m.alive || m.id === b.owner) continue;
          const dx = b.x - m.x, dyBody = b.y - (m.y - MAN_H / 2);
          const inBody = Math.abs(dx) < 9 && Math.abs(dyBody) < MAN_H / 2 + 2;
          const inHead = dist2(b.x, b.y, m.headX, m.headY) < 9 * 9;
          if (!inBody && !inHead) continue;
          // Ballistic shield blocks frontal fire.
          if (m.wdef.shielded && Math.sign(b.vx) === -m.facing) {
            b.dead = true;
            this.sparkFx(b.x, b.y);
            this.audio.hit();
            break;
          }
          b.dead = true;
          if (!b.cosmetic) {
            if (b.flame) {
              if (m.authority) { m.burnT = Math.max(m.burnT, b.burn); m.burnBy = b.owner; }
              this.applyHit(m, b.dmg, { by: b.owner, wk: b.kind, x: b.x, y: b.y, dx: Math.sign(b.vx) });
            } else {
              this.applyHit(m, b.dmg, {
                by: b.owner, hs: inHead, wk: b.kind,
                kx: Math.sign(b.vx) * (b.knock || 60) * 0.3, ky: -30,
                x: b.x, y: b.y, dx: Math.sign(b.vx),
              });
            }
            this.audio.hit();
          }
          break;
        }
        if (b.dead) break;
        // Furniture soaks bullets' damage but lets them pass (it's just office junk).
        if (!b.cosmetic && !b.checkedDecor) {
          for (const d of map.decors) {
            if (d.broken) continue;
            if (b.x > d.x && b.x < d.x + d.w && b.y > d.y && b.y < d.y + d.h) {
              this.damageDecor(d, b.dmg * 0.8, true);
              b.checkedDecor = true;
              break;
            }
          }
        }
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);
  }

  updateLobbed(dt) {
    const map = this.map;
    for (const p of this.lobbed) {
      p.t += dt;
      if (p.type === 'rocket') {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += (p.grav || 0) * dt;
        this.particles.push({ type: 'puff', x: p.x, y: p.y, vx: 0, vy: -10, t: 0, life: 0.4, r: 4 });
        // Detonate on world or flesh.
        let boom = map.solidPx(p.x, p.y) || p.t > 3;
        if (!boom) for (const m of this.men) {
          if (!m.alive || m.id === p.owner) continue;
          if (Math.abs(p.x - m.x) < 14 && Math.abs(p.y - (m.y - 24)) < 30) { boom = true; break; }
        }
        if (boom) {
          p.dead = true;
          if (p.local) this.explodeAt(p.x - p.vx * dt, p.y - p.vy * dt, p.def.blastR, p.def.blastDmg, p.owner, true);
        }
        continue;
      }

      // Lobbed physics: grenades, smokes, thrown weapons.
      p.vy += 1350 * dt;
      p.spin = (p.spin || 0) + dt * 14 * Math.sign(p.vx || 1);
      const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * dt / 12));
      const sx = p.vx * dt / steps, sy = p.vy * dt / steps;
      for (let s = 0; s < steps; s++) {
        const nx = p.x + sx, ny = p.y + sy;
        const hitX = map.solidPx(nx, p.y), hitY = map.solidPx(p.x, ny);
        if (hitX) { p.vx *= -0.42; if (Math.abs(p.vx) > 40) this.audio.bounce(); }
        else p.x = nx;
        if (hitY) {
          if (p.vy > 0) { p.vy *= -0.42; p.vx *= 0.6; if (Math.abs(p.vy) > 60) this.audio.bounce(); }
          else p.vy *= -0.4;
        } else p.y = ny;
        // Tomahawks stick into walls.
        if (p.type === 'wpnthrow' && p.wkind === 'tomahawk' && (hitX || hitY) && Math.hypot(p.vx, p.vy) > 250) {
          p.vx = 0; p.vy = 0; p.rest = 1;
        }
      }

      // Thrown weapon smacks someone.
      if (p.type === 'wpnthrow' && !p.dealt) {
        for (const m of this.men) {
          if (!m.alive || m.id === p.owner) continue;
          if (Math.abs(p.x - m.x) < 14 && Math.abs(p.y - (m.y - 24)) < 32) {
            p.dealt = true;
            this.applyHit(m, p.dmg, {
              by: p.owner, wk: p.wkind, kx: Math.sign(p.vx) * 180, ky: -80,
              x: p.x, y: p.y, dx: Math.sign(p.vx),
            });
            this.audio.hit();
            p.vx *= -0.3; p.vy = -120;
            break;
          }
        }
      }

      const speed = Math.hypot(p.vx, p.vy);
      const grounded = map.solidPx(p.x, p.y + 4);
      if (p.type === 'wpnthrow') {
        if ((speed < 50 && grounded) || p.rest || p.t > 6) {
          p.dead = true;
          if (p.local) this.dropWeapon(p.x, p.y, p.wkind, p.ammo, true);
        }
        continue;
      }

      // Grenades / smokes: fuse.
      p.fuse -= dt;
      if (p.fuse <= 0) {
        p.dead = true;
        if (p.type === 'smoke') {
          this.smokes.push({ x: p.x, y: p.y, r: 20, maxR: p.def.smokeR, t: p.def.smokeT });
          if (p.local && this.net) this.net.sendEvent({ k: 'smoke', x: Math.round(p.x), y: Math.round(p.y) });
        } else if (p.local) {
          this.explodeAt(p.x, p.y, p.def.blastR, p.def.blastDmg, p.owner, true);
        }
      }
    }
    this.lobbed = this.lobbed.filter(p => !p.dead);
  }

  explodeAt(x, y, r, dmg, by, local) {
    if (local && this.net) this.net.sendEvent({ k: 'boom', x: Math.round(x), y: Math.round(y), r, dmg, by, br: 1 });
    this.applyExplosion(x, y, r, dmg, by, 1, local);
  }

  applyExplosion(x, y, r, dmg, by, breaks, local) {
    this.audio.boom();
    this.cam.shake += Math.max(2, 14 - dist(x, y, this.me.x, this.me.y) / 60);
    this.rings.push({ x, y, r0: 12, r1: r * 1.15, t: 0, dur: 0.38 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, v = 80 + Math.random() * 380;
      this.particles.push({
        type: Math.random() < 0.4 ? 'ember' : 'boomsmoke',
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        t: 0, life: 0.5 + Math.random() * 0.7, r: 3 + Math.random() * 6,
      });
    }
    // Scorch mark on the paper, forever.
    this.gctx.fillStyle = 'rgba(30, 26, 24, 0.3)';
    this.gctx.beginPath(); this.gctx.arc(x, y, r * 0.55, 0, TAU); this.gctx.fill();

    if (breaks) {
      const destroyed = this.map.explode(x, y, r * 0.8);
      for (const i of destroyed) this.wallDebris((i % this.map.w + 0.5) * TILE, (Math.floor(i / this.map.w) + 0.5) * TILE);
      if (destroyed.length) this.audio.wallBreak();
    }
    for (const d of this.map.decors) {
      if (d.broken) continue;
      const dd = dist(x, y, d.x + d.w / 2, d.y + d.h / 2);
      if (dd < r + d.w / 2) this.damageDecor(d, dmg * (1 - dd / (r + d.w)), false);
    }
    // Stickmen: every peer damages the ones it owns.
    for (const m of this.men) {
      if (!m.alive || !m.authority) continue;
      const dd = dist(x, y, m.x, m.y - 24);
      if (dd > r) continue;
      const fall = 1 - dd / r;
      const dir = Math.sign(m.x - x) || 1;
      this.hurt(m, Math.max(8, dmg * fall), { by, kind: 'grenade', kx: dir * 380 * fall, ky: -320 * fall });
    }
    // Chain reaction: blasts set off nearby mines (each owner reports its own).
    for (const mn of this.mines) {
      if (mn.done || dist(x, y, mn.x, mn.y) > r) continue;
      mn.done = true;
      if (mn.local) this.triggerMine(mn, 0.12);
      else this.mines = this.mines.filter(m2 => m2 !== mn);
    }
  }

  updateMines(dt) {
    for (const mn of this.mines) {
      mn.armT -= dt;
      if (mn.armT > 0 || mn.done || !mn.local) continue;
      for (const m of this.men) {
        if (!m.alive || m.id === mn.owner) continue;
        if (Math.abs(m.x - mn.x) < 30 && m.y > mn.y - 52 && m.y < mn.y + 10) {
          mn.done = true;
          this.triggerMine(mn, 0.14);
          break;
        }
      }
    }
  }

  triggerMine(mn, delay) {
    setTimeout(() => {
      if (!this.running) return;
      this.mines = this.mines.filter(m => m !== mn);
      if (this.net) this.net.sendEvent({ k: 'mineoff', id: mn.id });
      const def = WEAPONS.mine;
      this.explodeAt(mn.x, mn.y - 4, def.blastR, def.blastDmg, mn.owner, true);
    }, delay * 1000);
  }

  updateSmokes(dt) {
    for (const s of this.smokes) {
      s.t -= dt;
      s.r = Math.min(s.maxR, s.r + dt * 160);
      if (Math.random() < dt * 20) this.particles.push({
        type: 'puff', x: s.x + (Math.random() - 0.5) * s.r, y: s.y - Math.random() * s.r * 0.6,
        vx: (Math.random() - 0.5) * 20, vy: -14, t: 0, life: 1.2, r: 10 + Math.random() * 14,
      });
    }
    this.smokes = this.smokes.filter(s => s.t > 0);
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------
  myShort() { return this.net ? this.myId.slice(0, 5) : 'l'; }

  addItem(it) {
    if (this.items.some(i => i.id === it.id)) return this.items.find(i => i.id === it.id);
    const item = { vy: 0, bob: Math.random() * TAU, ...it };
    this.items.push(item);
    return item;
  }

  dropWeapon(x, y, wkind, ammo, broadcast) {
    const it = { id: this.myShort() + '-' + this.itemSeq++, kind: 'weapon', wkind, ammo, x: Math.round(x), y: Math.round(y) };
    this.addItem(it);
    if (broadcast && this.net) this.net.sendEvent({ k: 'wpn', it });
  }

  updateItems(dt) {
    for (const it of this.items) {
      it.bob += dt * 3;
      if (!this.map.solidPx(it.x, it.y + 3)) {
        it.vy = Math.min(500, it.vy + 1200 * dt);
        it.y += it.vy * dt;
        if (it.y > this.map.pxh - 4) it.y = this.map.pxh - 4;
      } else {
        it.y = Math.floor((it.y + 3) / TILE) * TILE;
        it.vy = 0;
      }
    }
  }

  updateSpawners(dt) {
    for (const pads of [this.map.weaponPads, this.map.itemPads]) {
      const isWeapon = pads === this.map.weaponPads;
      for (const pad of pads) {
        if (pad.itemId && this.items.some(i => i.id === pad.itemId)) continue;
        pad.t -= dt;
        if (pad.t > 0) continue;
        pad.t = 10 + Math.random() * 8;
        const it = isWeapon
          ? { id: this.myShort() + '-' + this.itemSeq++, kind: 'weapon', wkind: randomWeapon(), x: pad.x, y: pad.y }
          : { id: this.myShort() + '-' + this.itemSeq++, kind: randomLoot(), x: pad.x, y: pad.y };
        pad.itemId = it.id;
        this.addItem(it);
        if (this.net) this.net.sendEvent({ k: 'item', it });
      }
    }
  }

  groundWeaponNear(x, y, r) {
    for (const it of this.items) {
      if (it.kind !== 'weapon') continue;
      if (Math.abs(it.x - x) < r && Math.abs(it.y - y) < 44) return it;
    }
    return null;
  }

  checkPickups(man) {
    for (const it of [...this.items]) {
      if (Math.abs(it.x - man.x) > 24 || Math.abs(it.y - man.y) > 46) continue;
      if (it.kind === 'weapon') {
        const emptySlot = man.slots[0] === null || man.slots[1] === null;
        const wants = man.input.pickP || emptySlot;
        if (!wants) continue;
        const dropped = man.giveWeapon(it.wkind, it.ammo);
        if (dropped && (WEAPONS[dropped.kind].kind === 'melee' || dropped.ammo > 0)) {
          this.dropWeapon(man.x, man.y - 10, dropped.kind, dropped.ammo, true);
        }
        this.takeItem(it);
        if (man === this.me) this.flash(WEAPONS[it.wkind].name + (it.ammo !== Infinity && WEAPONS[it.wkind].kind !== 'melee' ? ` · ${it.ammo}` : ''));
      } else {
        // Loot is grabbed automatically.
        switch (it.kind) {
          case 'vest': man.armor = Math.min(100, man.armor + 60); break;
          case 'helmet': man.helmetHp = 60; break;
          case 'med': if (man.hp >= 100) continue; man.hp = Math.min(100, man.hp + 50); break;
          case 'drug': man.drugT = 10; break;
          case 'jet': man.jetFuel = 100; break;
        }
        this.takeItem(it);
        if (man === this.me) this.flash(({ vest: 'Gilet pare-balles', helmet: 'Casque', med: '+50 PV', drug: 'Stimulants !', jet: 'Jetpack' })[it.kind]);
      }
      this.audio.pickup();
    }
  }

  takeItem(it) {
    this.items = this.items.filter(i => i !== it);
    if (this.net) this.net.sendEvent({ k: 'take', id: it.id });
  }

  // ---------------------------------------------------------------------------
  // Decor & walls
  // ---------------------------------------------------------------------------
  damageDecor(d, dmg, broadcast) {
    if (d.broken) return;
    d.hp -= dmg;
    if (d.hp <= 0) {
      this.breakDecor(d, broadcast);
    }
  }

  breakDecor(d, broadcast) {
    if (d.broken) return;
    d.broken = true;
    drawDecorDebris(this.gctx, d);
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        type: 'chip', x: d.x + Math.random() * d.w, y: d.y + Math.random() * d.h,
        vx: (Math.random() - 0.5) * 220, vy: -80 - Math.random() * 160,
        t: 0, life: 0.8, r: 2 + Math.random() * 2,
      });
    }
    this.audio.wallBreak();
    if (broadcast && this.net) this.net.sendEvent({ k: 'decor', id: d.id });
  }

  onWallDestroyed(idx, broadcast = true) {
    const x = (idx % this.map.w + 0.5) * TILE, y = (Math.floor(idx / this.map.w) + 0.5) * TILE;
    this.wallDebris(x, y);
    this.audio.wallBreak();
    if (broadcast && this.net) this.net.sendEvent({ k: 'tile', i: idx });
  }

  wallDebris(x, y) {
    for (let i = 0; i < 7; i++) {
      this.particles.push({
        type: 'chip', x: x + (Math.random() - 0.5) * 18, y: y + (Math.random() - 0.5) * 18,
        vx: (Math.random() - 0.5) * 260, vy: -60 - Math.random() * 200,
        t: 0, life: 0.9, r: 2 + Math.random() * 3,
      });
    }
    // Rubble stays on the page.
    this.gctx.fillStyle = 'rgba(120, 112, 95, 0.5)';
    for (let i = 0; i < 4; i++) {
      this.gctx.fillRect(x - 10 + Math.random() * 20, y + 4 + Math.random() * 8, 3 + Math.random() * 4, 2 + Math.random() * 3);
    }
  }

  wallChip(x, y) {
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        type: 'chip', x, y, vx: (Math.random() - 0.5) * 180, vy: -40 - Math.random() * 120,
        t: 0, life: 0.5, r: 1.5 + Math.random() * 2,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Gore & particles
  // ---------------------------------------------------------------------------
  bloodBurst(x, y, dirX, amount) {
    const n = Math.min(34, 4 + Math.round(amount * 0.35));
    for (let i = 0; i < n; i++) {
      const a = Math.atan2((Math.random() - 0.5) * 1.6, dirX || (Math.random() - 0.5)) + (Math.random() - 0.5) * 1.2;
      const v = 60 + Math.random() * 300;
      this.particles.push({
        type: 'blood', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 100 * Math.random(),
        t: 0, life: 1.6, r: 1.4 + Math.random() * 1.8,
      });
    }
  }

  jetFx(man) {
    if (Math.random() < 0.6) this.particles.push({
      type: 'ember', x: man.x - man.facing * 8, y: man.y - 16,
      vx: (Math.random() - 0.5) * 60, vy: 160 + Math.random() * 100,
      t: 0, life: 0.4, r: 2.5,
    });
  }

  muzzleFx(man) {
    const a = man.aim;
    const x = man.x + Math.cos(a) * 30, y = man.y - 34 + Math.sin(a) * 30;
    this.particles.push({ type: 'muzzle', x, y, a, t: 0, life: 0.06, r: 9 });
  }

  sparkFx(x, y) {
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        type: 'chip', x, y, vx: (Math.random() - 0.5) * 200, vy: (Math.random() - 0.5) * 200,
        t: 0, life: 0.3, r: 1.4,
      });
    }
  }

  updateParticles(dt) {
    const map = this.map;
    for (const p of this.particles) {
      p.t += dt;
      if (p.t > p.life) { p.dead = true; continue; }
      if (p.type === 'muzzle') continue;
      const grav = p.type === 'blood' ? 900 : p.type === 'chip' || p.type === 'casing' ? 1100 : p.type === 'ember' ? 300 : -30;
      p.vy += grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if ((p.type === 'blood' || p.type === 'chip' || p.type === 'casing') && map.solidPx(p.x, p.y + 2)) {
        if (p.type === 'blood') {
          // Splat: stamped into the page for the rest of the match.
          this.gctx.fillStyle = `rgba(${140 + Math.random() * 40 | 0}, 14, 20, ${0.5 + Math.random() * 0.3})`;
          this.gctx.beginPath();
          this.gctx.ellipse(p.x, Math.floor((p.y + 2) / TILE) * TILE - 1, p.r * (1.4 + Math.random()), p.r * 0.7, 0, 0, TAU);
          this.gctx.fill();
          p.dead = true;
        } else if (p.type === 'casing') {
          p.vy *= -0.3; p.vx *= 0.6;
          if (Math.abs(p.vy) < 30) p.dead = true;
        } else {
          p.dead = true;
        }
      }
      // Blood also sticks to walls sideways.
      if (p.type === 'blood' && map.solidPx(p.x + Math.sign(p.vx) * 2, p.y)) {
        this.gctx.fillStyle = 'rgba(150, 16, 22, 0.55)';
        this.gctx.beginPath();
        this.gctx.ellipse(p.x, p.y, p.r * 0.7, p.r * 1.3, 0, 0, TAU);
        this.gctx.fill();
        p.dead = true;
      }
    }
    this.particles = this.particles.filter(p => !p.dead);
  }

  addCorpse(man, dirX) {
    this.corpses.push({
      x: man.x, y: man.y - 10, vx: dirX * 120 + man.vx * 0.5, vy: -140,
      rest: 0, seed: Math.random() * 1000, dir: dirX >= 0 ? 1 : -1, t: 0,
    });
  }

  updateCorpses(dt) {
    const map = this.map;
    for (const c of this.corpses) {
      c.t += dt;
      c.vy += 1200 * dt;
      c.x += c.vx * dt;
      const ny = c.y + c.vy * dt;
      if (c.vy > 0 && map.solidPx(c.x, ny + 8)) {
        c.y = Math.floor((ny + 8) / TILE) * TILE - 8;
        c.vy = 0; c.vx *= 0.6;
        c.rest += dt;
      } else {
        c.y = ny;
      }
      if (c.rest > 1.4 || c.t > 5) {
        this.stampCorpse(c);
        c.dead = true;
      }
    }
    this.corpses = this.corpses.filter(c => !c.dead);
  }

  drawCorpse(ctx, c) {
    ctx.save();
    ctx.translate(c.x, c.y + 8);
    ctx.scale(c.dir, 1);
    ctx.strokeStyle = '#16181d';
    ctx.fillStyle = '#16181d';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const s = c.seed;
    ctx.beginPath();
    ctx.moveTo(-18, -2); ctx.quadraticCurveTo(-4, -7 - (s % 3), 8, -3);          // torso
    ctx.moveTo(8, -3); ctx.lineTo(16 + (s % 5), -1);                             // leg 1
    ctx.moveTo(8, -3); ctx.quadraticCurveTo(14, -9, 20, -7);                     // leg 2
    ctx.moveTo(-12, -4); ctx.lineTo(-6, -10 - (s % 4));                          // arm up
    ctx.moveTo(-14, -3); ctx.lineTo(-20, 0);                                     // arm down
    ctx.stroke();
    ctx.beginPath(); ctx.arc(-24, -4, 6.5, 0, TAU); ctx.fill();                  // head
    ctx.restore();
  }

  stampCorpse(c) {
    const g = this.gctx;
    // Blood pool first, body on top.
    g.fillStyle = 'rgba(140, 12, 18, 0.65)';
    g.beginPath();
    g.ellipse(c.x, c.y + 9, 30 + Math.random() * 16, 4.5, 0, 0, TAU);
    g.fill();
    this.drawCorpse(g, c);
  }

  // ---------------------------------------------------------------------------
  // Vision
  // ---------------------------------------------------------------------------
  losClear(x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1);
    const steps = Math.ceil(d / 14);
    const dx = (x1 - x0) / steps, dy = (y1 - y0) / steps;
    let x = x0, y = y0;
    for (let i = 1; i < steps; i++) {
      x += dx; y += dy;
      if (this.map.solidPx(x, y)) return false;
      for (const s of this.smokes) {
        if (dist2(x, y, s.x, s.y) < s.r * s.r) return false;
      }
    }
    return true;
  }

  viewDist() { return this.me.weapon.kind === 'awp' ? VIEW_AWP : VIEW; }

  // Can *I* see this world point? (fog-of-war gate for entities)
  canSee(x, y) {
    const me = this.me;
    const ox = me.x, oy = me.y - 34;
    const d = dist(ox, oy, x, y);
    if (d < NEAR) return true;
    if (d > this.viewDist()) return false;
    const da = Math.abs(wrapAngle(Math.atan2(y - oy, x - ox) - (me.input.aim || 0)));
    if (da > FOV / 2) return false;
    return this.losClear(ox, oy, x, y);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.cssW / 2) / this.scale + this.cam.x,
      y: (sy - this.cssH / 2) / this.scale + this.cam.y,
    };
  }

  render() {
    const ctx = this.ctx;
    const { dpr, scale } = this;
    const shakeX = (Math.random() - 0.5) * this.cam.shake, shakeY = (Math.random() - 0.5) * this.cam.shake;
    const camX = this.cam.x + shakeX, camY = this.cam.y + shakeY;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (this.cssW / 2 - camX * scale) * dpr, (this.cssH / 2 - camY * scale) * dpr);

    const x0 = camX - this.cssW / 2 / scale - 8, x1 = camX + this.cssW / 2 / scale + 8;
    const y0 = camY - this.cssH / 2 / scale - 8, y1 = camY + this.cssH / 2 / scale + 8;

    renderPaper(ctx, this.map, x0, y0, x1, y1);
    // Gore layer (blood, corpses, rubble) sits under live entities.
    ctx.drawImage(this.gore, 0, 0);
    renderTiles(ctx, this.map, x0, y0, x1, y1);

    // Spawn pads.
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(60,80,140,0.5)';
    ctx.lineWidth = 1.5;
    for (const pad of [...this.map.weaponPads, ...this.map.itemPads]) {
      if (pad.x < x0 || pad.x > x1) continue;
      ctx.strokeRect(pad.x - 16, pad.y - 5, 32, 5);
    }
    ctx.setLineDash([]);

    // Decor.
    for (const d of this.map.decors) {
      if (d.broken || d.x + d.w < x0 || d.x > x1 || d.y + d.h < y0 || d.y > y1) continue;
      drawDecor(ctx, d);
    }

    // Ground items (fog-gated).
    for (const it of this.items) {
      if (it.x < x0 || it.x > x1) continue;
      if (!this.canSee(it.x, it.y - 8)) continue;
      this.drawItem(ctx, it);
    }

    // Mines: mine are sneaky — enemies' show only in direct view.
    for (const mn of this.mines) {
      const mine = mn.owner === this.myId;
      if (!mine && !this.canSee(mn.x, mn.y - 4)) continue;
      ctx.fillStyle = mn.armT > 0 ? '#6b4226' : (mine ? '#3d6b35' : '#3a3f37');
      ctx.beginPath(); ctx.ellipse(mn.x, mn.y - 3, 7, 3.5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#181a1f'; ctx.lineWidth = 1.4; ctx.stroke();
      if (mine && mn.armT <= 0 && Math.sin(this.time * 6) > 0) {
        ctx.fillStyle = '#c33'; ctx.fillRect(mn.x - 1, mn.y - 6, 2, 2);
      }
    }

    // Corpses still falling (settled ones live in the gore layer).
    for (const c of this.corpses) this.drawCorpse(ctx, c);

    // Stickmen.
    for (const m of this.men) {
      if (!m.alive) continue;
      if (m !== this.me && !this.canSee(m.x, m.y - 30)) continue;
      m.render(ctx, this);
      // Name + health pip.
      ctx.font = '11px "Segoe Print", "Comic Sans MS", cursive';
      ctx.textAlign = 'center';
      ctx.fillStyle = m === this.me ? 'rgba(30,60,160,0.85)' : 'rgba(150,25,25,0.85)';
      ctx.fillText(m.name, m.x, m.y - 62);
      if (m !== this.me) {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(m.x - 14, m.y - 58, 28, 3);
        ctx.fillStyle = 'rgba(180,30,30,0.8)';
        ctx.fillRect(m.x - 14, m.y - 58, 28 * clamp(m.hp / 100, 0, 1), 3);
      }
    }

    // Lobbed objects.
    for (const p of this.lobbed) {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.type === 'rocket') {
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillStyle = '#16181d';
        ctx.fillRect(-8, -3, 16, 6);
        ctx.fillStyle = '#c9542e';
        ctx.beginPath(); ctx.moveTo(8, -3); ctx.lineTo(13, 0); ctx.lineTo(8, 3); ctx.fill();
      } else if (p.type === 'wpnthrow') {
        ctx.rotate(p.spin || 0);
        drawWeapon(ctx, p.wkind);
      } else {
        ctx.rotate(p.spin || 0);
        drawWeapon(ctx, p.type);
        if (p.type === 'grenade' && p.fuse < 0.9 && Math.sin(this.time * 20) > 0) {
          ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.arc(2, -4, 2, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }

    // Bullets.
    for (const b of this.bullets) {
      if (b.flame) {
        const k = 1 - b.life / (WEAPONS.flamer.range / WEAPONS.flamer.vel);
        ctx.fillStyle = `rgba(${230 - k * 60}, ${120 + k * 40}, 30, ${0.75 - k * 0.55})`;
        ctx.beginPath(); ctx.arc(b.x, b.y, 3 + k * 9, 0, TAU); ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(35,35,45,0.8)';
        ctx.lineWidth = b.kind === 'awp' ? 2.4 : 1.6;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.014, b.y - b.vy * 0.014);
        ctx.stroke();
      }
    }

    // Particles.
    for (const p of this.particles) {
      const k = p.t / p.life;
      if (p.type === 'blood') {
        ctx.fillStyle = `rgba(158, 16, 22, ${1 - k * 0.4})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      } else if (p.type === 'chip') {
        ctx.fillStyle = `rgba(110, 102, 88, ${1 - k})`;
        ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      } else if (p.type === 'casing') {
        ctx.fillStyle = `rgba(160, 130, 50, ${1 - k})`;
        ctx.fillRect(p.x - 1.5, p.y - 1, 3, 2);
      } else if (p.type === 'ember') {
        ctx.fillStyle = `rgba(235, ${150 - k * 100 | 0}, 30, ${1 - k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.5), 0, TAU); ctx.fill();
      } else if (p.type === 'boomsmoke' || p.type === 'puff') {
        ctx.fillStyle = `rgba(90, 88, 86, ${(1 - k) * 0.35})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k * 2), 0, TAU); ctx.fill();
      } else if (p.type === 'muzzle') {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.strokeStyle = 'rgba(240, 180, 40, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(p.r, 0);
        ctx.moveTo(0, -2); ctx.lineTo(p.r * 0.7, -4);
        ctx.moveTo(0, 2); ctx.lineTo(p.r * 0.7, 4);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Smoke clouds (they also block vision).
    for (const s of this.smokes) {
      const a = Math.min(0.75, s.t / 2);
      ctx.fillStyle = `rgba(120, 122, 126, ${a})`;
      for (let i = 0; i < 6; i++) {
        const ang = i / 6 * TAU + s.x;
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(ang) * s.r * 0.45, s.y - 6 + Math.sin(ang) * s.r * 0.3, s.r * 0.5, 0, TAU);
        ctx.fill();
      }
    }

    // Explosion rings.
    for (const r of this.rings) {
      const k = r.t / r.dur;
      ctx.strokeStyle = `rgba(200, 90, 30, ${1 - k})`;
      ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, lerp(r.r0, r.r1, k), 0, TAU);
      ctx.stroke();
    }

    // Aim reticle (mouse only).
    if (this.input.activeSource === 'key' && this.me.alive) {
      const w = this.screenToWorld(this.input.mouse.x, this.input.mouse.y);
      ctx.strokeStyle = 'rgba(30,30,40,0.75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(w.x - 6, w.y); ctx.lineTo(w.x - 2, w.y);
      ctx.moveTo(w.x + 2, w.y); ctx.lineTo(w.x + 6, w.y);
      ctx.moveTo(w.x, w.y - 6); ctx.lineTo(w.x, w.y - 2);
      ctx.moveTo(w.x, w.y + 2); ctx.lineTo(w.x, w.y + 6);
      ctx.stroke();
    }

    // Fog of war.
    this.renderFog(ctx, camX, camY);

    // HUD.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderHUD(ctx);
    this.updateScoreboard();
  }

  renderFog(ctx, camX, camY) {
    const me = this.me;
    const f = this.fctx;
    const { dpr, scale } = this;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, this.fog.width, this.fog.height);
    f.fillStyle = 'rgba(24, 26, 34, 0.9)';
    f.fillRect(0, 0, this.fog.width, this.fog.height);

    f.setTransform(scale * dpr, 0, 0, scale * dpr, (this.cssW / 2 - camX * scale) * dpr, (this.cssH / 2 - camY * scale) * dpr);
    f.globalCompositeOperation = 'destination-out';

    const ox = me.x, oy = me.y - 34;
    const aim = me.input.aim || 0;
    const R = this.viewDist();

    if (me.alive) {
      // Vision cone, raycast against walls and smoke.
      const N = 100;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const a = aim - FOV / 2 + (i / N) * FOV;
        const dx = Math.cos(a) * 12, dy = Math.sin(a) * 12;
        let x = ox, y = oy, traveled = 0;
        while (traveled < R) {
          x += dx; y += dy; traveled += 12;
          if (this.map.solidPx(x, y)) break;
          let smoked = false;
          for (const s of this.smokes) {
            if (dist2(x, y, s.x, s.y) < s.r * s.r) { smoked = true; break; }
          }
          if (smoked) break;
        }
        pts.push([x, y]);
      }
      const grad = f.createRadialGradient(ox, oy, R * 0.15, ox, oy, R);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.75, 'rgba(0,0,0,0.9)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = grad;
      f.beginPath();
      f.moveTo(ox, oy);
      for (const [x, y] of pts) f.lineTo(x, y);
      f.closePath();
      f.fill();
    }

    // Personal bubble (you always sense what's on top of you).
    const ng = f.createRadialGradient(ox, oy, 10, ox, oy, NEAR + 30);
    ng.addColorStop(0, 'rgba(0,0,0,1)');
    ng.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = ng;
    f.beginPath();
    f.arc(ox, oy, NEAR + 30, 0, TAU);
    f.fill();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fog, 0, 0);
  }

  renderHUD(ctx) {
    const me = this.me;
    const W = this.cssW, H = this.cssH;
    const pad = 14, bottom = H - (this.input.isTouchDevice ? 190 : 20);
    ctx.font = '13px "Segoe Print", "Comic Sans MS", cursive';
    ctx.textAlign = 'left';

    // Health / armor.
    const bx = pad, by = bottom - 34;
    ctx.fillStyle = 'rgba(246,242,227,0.85)';
    ctx.fillRect(bx - 6, by - 22, 180, 56);
    ctx.strokeStyle = '#2a2d35'; ctx.lineWidth = 1.5;
    ctx.strokeRect(bx - 6, by - 22, 180, 56);
    ctx.fillStyle = '#2a2d35';
    ctx.fillText('PV', bx, by - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(bx + 28, by - 14, 130, 9);
    ctx.fillStyle = me.hp > 30 ? '#b3232a' : '#e33540';
    ctx.fillRect(bx + 28, by - 14, 130 * clamp(me.hp / 100, 0, 1), 9);
    ctx.fillStyle = '#2a2d35';
    ctx.fillText('AR', bx, by + 12);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(bx + 28, by + 4, 130, 9);
    ctx.fillStyle = '#2a4d8f';
    ctx.fillRect(bx + 28, by + 4, 130 * clamp(me.armor / 100, 0, 1), 9);
    ctx.fillStyle = '#2a2d35';
    let extras = '';
    if (me.helmetHp > 0) extras += '🪖 ';
    if (me.drugT > 0) extras += `💊${Math.ceil(me.drugT)} `;
    if (me.jetFuel > 0) extras += `🚀${Math.round(me.jetFuel)} `;
    if (extras) ctx.fillText(extras, bx, by + 30);

    // Weapon slots (top-right on narrow screens so they don't collide with the bars).
    const sw = 128, sx = W - pad - sw * 2 - 8;
    const slotY = W < 640 ? 44 : bottom - 40;
    for (let i = 0; i < 2; i++) {
      const x = sx + i * (sw + 8), y = slotY;
      const slot = me.slots[i];
      const cur = me.cur === i;
      ctx.fillStyle = cur ? 'rgba(246,242,227,0.95)' : 'rgba(246,242,227,0.6)';
      ctx.fillRect(x, y, sw, 40);
      ctx.strokeStyle = cur ? '#b3232a' : '#2a2d35';
      ctx.lineWidth = cur ? 2.5 : 1.2;
      ctx.strokeRect(x, y, sw, 40);
      ctx.fillStyle = '#2a2d35';
      if (slot) {
        const d = WEAPONS[slot.kind];
        ctx.fillText(d.name, x + 8, y + 17);
        ctx.fillText(d.kind === 'melee' ? '∞' : `${slot.ammo}`, x + 8, y + 33);
        ctx.save();
        ctx.translate(x + sw - 28, y + 27);
        ctx.scale(1.1, 1.1);
        drawWeapon(ctx, slot.kind);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(42,45,53,0.5)';
        ctx.fillText('Poings', x + 8, y + 24);
      }
    }

    // Score line.
    ctx.textAlign = 'center';
    const lead = this.ranking()[0];
    const myK = this.scores.get(this.myId) || 0;
    ctx.fillStyle = 'rgba(246,242,227,0.85)';
    const txt = `☠ ${myK}/${this.killTarget}   ·   1er: ${lead ? lead.name + ' (' + lead.kills + ')' : '—'}`;
    ctx.font = '14px "Segoe Print", "Comic Sans MS", cursive';
    const tw = ctx.measureText(txt).width;
    ctx.fillRect(W / 2 - tw / 2 - 12, 8, tw + 24, 24);
    ctx.fillStyle = '#2a2d35';
    ctx.fillText(txt, W / 2, 25);

    // Respawn countdown.
    if (!me.alive && !this.matchOver) {
      ctx.font = '26px "Segoe Print", "Comic Sans MS", cursive';
      ctx.fillStyle = '#b3232a';
      ctx.fillText(`Réapparition dans ${Math.max(0, me.respawnT).toFixed(1)}…`, W / 2, H * 0.4);
    }
  }

  updateScoreboard() {
    const el = $('#scoreboard');
    if (!el) return;
    const show = this.showScore;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    if (this.time - (this._sbT || 0) < 0.25 && !this.matchOver) return;
    this._sbT = this.time;
    const rows = this.ranking();
    el.innerHTML = '<h3>Tableau des scores</h3>' + rows.map((r, i) =>
      `<div class="sb-row${r.id === this.myId ? ' me' : ''}"><span>${i + 1}. ${escapeHtml(r.name)}</span><span>☠ ${r.kills} · ✝ ${r.deaths}</span></div>`
    ).join('');
  }

  drawItem(ctx, it) {
    const bobY = Math.sin(it.bob) * 2;
    ctx.save();
    ctx.translate(it.x, it.y - 10 + bobY);
    if (it.kind === 'weapon') {
      ctx.scale(1.25, 1.25);
      drawWeapon(ctx, it.wkind);
      const near = Math.abs(this.me.x - it.x) < 26 && Math.abs(this.me.y - it.y) < 46 && this.me.alive;
      if (near) {
        ctx.scale(0.8, 0.8);
        ctx.font = '10px "Segoe Print", cursive';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#2a2d35';
        const d = WEAPONS[it.wkind];
        const hint = this.input.activeSource === 'gamepad' ? '□' : this.input.isTouchDevice ? 'PRENDRE' : 'E';
        ctx.fillText(`${d.name} [${hint}]`, 0, -16);
      }
    } else {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#22262e';
      switch (it.kind) {
        case 'med':
          ctx.fillStyle = '#f2ede0'; ctx.fillRect(-9, -7, 18, 14); ctx.strokeRect(-9, -7, 18, 14);
          ctx.fillStyle = '#c22'; ctx.fillRect(-2, -5, 4, 10); ctx.fillRect(-6, -2, 12, 4);
          break;
        case 'vest':
          ctx.fillStyle = '#2a4d8f';
          ctx.beginPath(); ctx.roundRect(-8, -9, 16, 18, 4); ctx.fill(); ctx.stroke();
          break;
        case 'helmet':
          ctx.fillStyle = '#4a6f43';
          ctx.beginPath(); ctx.arc(0, 2, 9, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        case 'drug':
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.roundRect(-8, -4, 16, 8, 4); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#c22'; ctx.beginPath(); ctx.roundRect(0, -4, 8, 8, 4); ctx.fill();
          break;
        case 'jet':
          ctx.fillStyle = '#555c68';
          ctx.beginPath(); ctx.roundRect(-7, -11, 6, 20, 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.roundRect(1, -11, 6, 20, 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#e6a23c';
          ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(-2, 14); ctx.lineTo(-6, 14); ctx.fill();
          break;
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  addFeed(html) {
    const feed = $('#killfeed');
    if (!feed) return;
    const div = document.createElement('div');
    div.innerHTML = html;
    feed.appendChild(div);
    while (feed.children.length > 5) feed.removeChild(feed.firstChild);
    this.feedTimers.push(setTimeout(() => div.remove(), 4500));
  }

  flash(text) {
    const el = $('#game-msg');
    if (!el) return;
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { el.style.opacity = 0; }, 1600);
    this.feedTimers.push(this._msgT);
  }
}
