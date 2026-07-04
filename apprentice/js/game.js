// Orchestrateur d'une partie : scène, boucle, caméra épaule, résolution du combat
// (attaques/parades directionnelles, bolts, force), modes Duel et Horde, synchro réseau.
//
// Autorité réseau (comme Warp II) : chaque client simule SON combattant et décide
// lui-même des dégâts qu'il subit ; l'hôte simule droïdes et duellistes IA.
import * as THREE from 'three';
import { Arena, ARENA_R } from './arena.js';
import { Fighter, CFG, saberById } from './fighter.js';
import { Droid, BOLT_SPEED, BOLT_DMG } from './droid.js';
import { SaberAI } from './ai.js';
import { clamp, lerp, mulberry32, DIR_NAMES } from './util.js';

const STEP = 1 / 60;
const DUEL_TARGET = 5;      // touches mortelles pour gagner
const RESPAWN_DUEL = 2.6;
const DMG_SABER_DROID = 40; // un droïde = un coup de sabre
const REFLECT_DMG = 40;

export class Match {
  // cfg : { mode:'duel'|'horde', seed, slots:[{slot, type:'local'|'remote'|'ai', saber, name, peerId}] }
  constructor({ renderer, input, hud, audio, net, cfg, onExit }) {
    this.renderer = renderer;
    this.input = input;
    this.hud = hud;
    this.audio = audio;
    this.net = net;
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.onExit = onExit;
    this.rnd = mulberry32(cfg.seed);

    // ——— scène ———
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fb4d8);
    this.scene.fog = new THREE.Fog(0x8fb4d8, 60, 160);
    this.scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x6a5a42, 1.05));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
    sun.position.set(40, 60, -30);
    this.scene.add(sun);

    this.arena = new Arena();
    this.scene.add(this.arena.group);

    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .1, 400);
    this.camYaw = 0; this.camPitch = .18;
    this.camShake = 0;

    // ——— combattants ———
    this.fighters = [];
    this.bySlot = new Map();
    this.peerSlot = new Map();
    this.ai = new Map(); // slot → SaberAI
    const n = cfg.slots.length;
    for (const s of cfg.slots) {
      const f = new Fighter(s.saber, { slot: s.slot, name: s.name, kind: s.type });
      f.spawnAt(this.arena.spawnPoint(s.slot, n));
      f.invulnT = 0;
      this.scene.add(f.group);
      this.fighters.push(f);
      this.bySlot.set(s.slot, f);
      if (s.peerId) this.peerSlot.set(s.peerId, s.slot);
    }
    this.local = this.fighters.find(f => f.kind === 'local');
    if (this.local) {
      this.camYaw = this.local.yaw;
      // masque la tête/capuche de trop près ? non : caméra épaule assez loin
    }
    this._makeAI();

    // ——— droïdes & bolts ———
    this.droids = new Map();
    this.bolts = new Map();
    this._boltSeq = 0;
    this.wave = 0;
    this.droidsToSpawn = [];
    this.waveDelay = 0;
    this.kills = new Map(cfg.slots.map(s => [s.slot, 0]));

    // ——— effets ———
    this._buildFx();

    // ——— état ———
    this.phase = 'count'; // 'count' | 'play' | 'over'
    this.clock = -3.2;
    this.elapsed = 0;
    this.tick = 0;
    this._lastCount = 4;
    this._raf = null; this._acc = 0; this._lastT = performance.now();
    this._overT = 0;

    this._wireNet();
    this.hud.show();
    this.hud.setObjective(this.mode === 'duel' ? `Duel — ${DUEL_TARGET} victoires` : '');
    this._updateScores();
    this._refreshControls();
    this.input.wantLock = true;
    this.audio.play('ignite');
    this.audio.humStart();
  }

  get isHost() { return !this.net || this.net.isHost; }
  _simulated(f) { return f.kind === 'local' || (f.kind === 'ai' && this.isHost); }

  _makeAI() {
    if (!this.isHost) return;
    for (const f of this.fighters) {
      if (f.kind === 'ai' && !this.ai.has(f.slot)) {
        this.ai.set(f.slot, new SaberAI(f, mulberry32(this.cfg.seed * 13 + f.slot), .45 + this.rnd() * .3));
      }
    }
  }

  // ——————— effets visuels (pool d'étincelles + onde de force) ———————
  _buildFx() {
    const N = 90;
    this.sparks = [];
    const geo = new THREE.PlaneGeometry(.09, .09);
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false;
      this.scene.add(m);
      this.sparks.push({ m, vx: 0, vy: 0, vz: 0, life: 0 });
    }
    this._sparkIdx = 0;

    this.shocks = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(1, .07, 6, 32),
        new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      m.rotation.x = Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this.shocks.push({ m, t: 0 });
    }
  }

  burst(x, y, z, color, count = 10, speed = 4) {
    for (let i = 0; i < count; i++) {
      const s = this.sparks[this._sparkIdx = (this._sparkIdx + 1) % this.sparks.length];
      s.m.visible = true;
      s.m.material.color.setHex(color);
      s.m.material.opacity = 1;
      s.m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, e = (Math.random() - .3) * 2;
      s.vx = Math.cos(a) * speed * (0.4 + Math.random());
      s.vz = Math.sin(a) * speed * (0.4 + Math.random());
      s.vy = e * speed * .6 + 1.5;
      s.life = .35 + Math.random() * .3;
    }
  }

  shockwave(x, y, z) {
    const s = this.shocks.find(s => s.t <= 0) || this.shocks[0];
    s.t = .5;
    s.m.visible = true;
    s.m.position.set(x, Math.max(y, .3) + .8, z);
  }

  _updateFx(dt) {
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.m.visible = false; continue; }
      s.vy -= 12 * dt;
      s.m.position.x += s.vx * dt;
      s.m.position.y += s.vy * dt;
      s.m.position.z += s.vz * dt;
      s.m.material.opacity = clamp(s.life * 2.5, 0, 1);
      s.m.lookAt(this.camera.position);
    }
    for (const s of this.shocks) {
      if (s.t <= 0) continue;
      s.t -= dt;
      const p = 1 - s.t / .5;
      s.m.scale.setScalar(.5 + p * CFG.pushRange);
      s.m.material.opacity = (1 - p) * .7;
      if (s.t <= 0) s.m.visible = false;
    }
  }

  // ——————— réseau ———————
  _wireNet() {
    if (!this.net) return;
    const now = () => performance.now() / 1000;
    this.net.onState = (s, id) => {
      const f = this.bySlot.get(this.peerSlot.get(id));
      if (f && f.kind === 'remote') f.pushSnapshot(s, now());
    };
    this.net.onBots = data => {
      if (this.isHost) return;
      const t = now();
      for (const s of data.f || []) {
        const f = this.bySlot.get(s.s);
        if (f && f.kind === 'ai') f.pushSnapshot(s, t);
      }
      for (const s of data.d || []) {
        let d = this.droids.get(s.i);
        if (d) d.pushSnapshot(s, t);
      }
    };
    this.net.onEvent = (e, id) => this._onEvent(e, id);
    this.net.onHostChange = () => {
      if (this.net.isHost) {
        this.hud.toast('👑 Tu diriges maintenant la partie');
        this._makeAI();
      }
    };
    this.net.onPeers = () => {
      for (const [pid, slot] of this.peerSlot) {
        if (!this.net.peers.has(pid)) {
          const f = this.bySlot.get(slot);
          if (f) {
            this.hud.toast(`🏳️ ${f.name} a quitté la partie`);
            this.scene.remove(f.group);
            this.fighters = this.fighters.filter(x => x !== f);
            this.bySlot.delete(slot);
            this.kills.delete(slot);
          }
          this.peerSlot.delete(pid);
        }
      }
      this._updateScores();
    };
  }

  _emit(e) { if (this.net) this.net.sendEvent(e); }

  _onEvent(e) {
    switch (e.k) {
      case 'atk': this._resolveStrike(e.s, e.d, e.x, e.z, false); break;
      case 'blk': {
        const att = this.bySlot.get(e.a);
        if (att) {
          this.audio.play('clash');
          const f = this.bySlot.get(e.s);
          if (f) { const tip = f.bladeTip(); this.burst(tip.x, tip.y, tip.z, 0xfff0a0, 12, 5); }
          if (this._simulated(att)) att.stagger(e.p ? CFG.staggerParried : .35);
          if (att === this.local && e.p) this.hud.toast('⚡ Parade parfaite adverse !');
        }
        break;
      }
      case 'hurt': {
        const f = this.bySlot.get(e.s);
        if (f) { f.hp = e.hp; this.burst(f.x, f.y + 1.2, f.z, 0xff5040, 8, 3); this.audio.play('hit'); }
        break;
      }
      case 'die': this._onDeath(e.s, e.by); break;
      case 'push': {
        this.audio.play('force');
        this.shockwave(e.x, e.y || 0, e.z);
        this._resolvePush(e.s, e.x, e.z, false);
        break;
      }
      case 'fparry': {
        const att = this.bySlot.get(e.a);
        if (att && this._simulated(att)) att.stagger(CFG.staggerParried);
        if (att === this.local) this.hud.toast('🛡️ Ta poussée a été parée !');
        this.audio.play('forcefail');
        break;
      }
      case 'bolt': this._spawnBolt(e, false); break;
      case 'refl': {
        const b = this.bolts.get(e.id);
        if (b) {
          b.dx = e.dx; b.dy = e.dy; b.dz = e.dz;
          b.x = e.x; b.y = e.y; b.z = e.z;
          b.refl = true; b.from = e.s; b.life = 3;
          this.audio.play('reflect');
        }
        break;
      }
      case 'defl': {
        const b = this.bolts.get(e.id);
        if (b) { this.burst(b.x, b.y, b.z, 0x9fd4ff, 6, 3); this._removeBolt(b); this.audio.play('deflect'); }
        break;
      }
      case 'dspawn': if (!this.isHost) this._spawnDroid(e.i, e.x, e.z); break;
      case 'ddie': {
        const d = this.droids.get(e.i);
        if (d && d.alive) this._droidDeath(d, e.by, false);
        break;
      }
      case 'wave': if (!this.isHost) this._setWave(e.n); break;
      case 'wclear': this._waveCleared(false); break;
      case 'over': this._gameOver(e); break;
    }
  }

  // ——————— boucle ———————
  start() {
    this._lastT = performance.now();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const t = performance.now();
      let dt = (t - this._lastT) / 1000;
      this._lastT = t;
      dt = Math.min(dt, .12);
      this._acc += dt;
      let i = 0;
      while (this._acc >= STEP && i < 6) { this._step(STEP); this._acc -= STEP; i++; }
      this._render(dt);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this.audio.humStop();
    this.hud.hide();
    this.hud.lockHint(false);
    this.input.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.net) {
      this.net.onState = this.net.onBots = this.net.onEvent = () => {};
      this.net.onHostChange = () => {};
    }
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    });
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _step(dt) {
    this.elapsed += dt;
    this.clock += dt;
    this.tick++;

    // décompte initial
    if (this.phase === 'count') {
      const c = Math.ceil(-this.clock);
      if (c !== this._lastCount) {
        this._lastCount = c;
        if (c > 0) { this.hud.countdown(String(c)); this.audio.play('count'); }
      }
      if (this.clock >= 0) {
        this.phase = 'play';
        this.hud.countdown('EN GARDE !');
        this.audio.play('go');
        setTimeout(() => this.hud.countdown(''), 900);
        if (this.mode === 'horde' && this.isHost) this._nextWave();
        // premier lancement : explique la parade directionnelle
        if (!localStorage.getItem('app-hint-parade')) {
          localStorage.setItem('app-hint-parade', '1');
          const touch = this.input.touchMode || document.body.classList.contains('touch');
          this.hud.toast(touch
            ? '🛡️ Maintiens PARADE pour bloquer — face au tireur, ça dévie les tirs !'
            : '🛡️ Parade : maintiens clic droit, un geste de souris choisit la direction', 6000);
        }
      }
    }

    const raw = this.input.read(dt);
    if (raw.pause) { this.quit(); return; }

    // caméra orbitale
    this.camYaw -= raw.lookDX;
    this.camPitch = clamp(this.camPitch + raw.lookDY, -.55, .8);

    // ——— mon combattant ———
    if (this.local) {
      // repère caméra : forward = (sin cy, cos cy), droite = (−cos cy, sin cy)
      const cy = this.camYaw;
      const inp = {
        mvx: Math.sin(cy) * raw.my - Math.cos(cy) * raw.mx,
        mvz: Math.cos(cy) * raw.my + Math.sin(cy) * raw.mx,
        yaw: cy,
        jump: raw.jump, dash: raw.dash, force: raw.force,
        attack: raw.attack, attackDir: raw.attackDir,
        block: raw.block, blockDir: raw.blockDir,
      };
      if (this.phase !== 'play') { inp.attack = inp.force = inp.dash = inp.jump = false; inp.block = false; }
      this.local.update(dt, inp);
      this._consumeEvents(this.local);

      // réapparition
      if (!this.local.alive) this._maybeRespawn(this.local);
    }

    // ——— IA duellistes (hôte/solo) ———
    if (this.isHost) {
      for (const f of this.fighters) {
        if (f.kind !== 'ai') continue;
        const drv = this.ai.get(f.slot);
        const inp = drv ? drv.think(dt, this.fighters) : { mvx: 0, mvz: 0, yaw: f.yaw };
        if (this.phase !== 'play') { inp.attack = inp.force = false; }
        f.update(dt, inp);
        this._consumeEvents(f);
        if (!f.alive) this._maybeRespawn(f);
      }
      // ——— droïdes ———
      if (this.mode === 'horde' && this.phase === 'play') this._hordeStep(dt);
    }

    this._updateBolts(dt);
    this.arena.update(dt, this.elapsed);

    // ——— envois réseau ———
    if (this.net && this.local && this.tick % 3 === 0) this.net.sendState(this.local.snapshot());
    if (this.net && this.isHost && this.tick % 4 === 0) {
      const fSnaps = this.fighters.filter(f => f.kind === 'ai').map(f => ({ s: f.slot, ...f.snapshot() }));
      const dSnaps = [...this.droids.values()].filter(d => d.alive || d.deadT < 1).map(d => d.snapshot());
      if (fSnaps.length || dSnaps.length) this.net.sendBots({ f: fSnaps, d: dSnaps });
    }

    // fin de partie différée → résultats
    if (this.phase === 'over') {
      this._overT += dt;
      if (this._overT > 1.6 && !this._resultsShown) {
        this._resultsShown = true;
        this._showResults();
      }
    }
  }

  // consomme les évènements générés par un combattant simulé localement
  _consumeEvents(f) {
    for (const ev of f.events) {
      switch (ev.k) {
        case 'windup': if (f === this.local) this.hud.setDir('attack', ev.d); break;
        case 'swing':
          this.audio.play('swing');
          break;
        case 'strike':
          this._emit({ k: 'atk', s: f.slot, d: ev.d, x: +f.x.toFixed(2), z: +f.z.toFixed(2) });
          this._resolveStrike(f.slot, ev.d, f.x, f.z, true);
          break;
        case 'block': break;
        case 'force': {
          this.audio.play('force');
          this.shockwave(f.x, f.y, f.z);
          this._emit({ k: 'push', s: f.slot, x: +f.x.toFixed(2), y: +f.y.toFixed(1), z: +f.z.toFixed(2) });
          this._resolvePush(f.slot, f.x, f.z, true);
          if (f === this.local) this.camShake = Math.max(this.camShake, .25);
          break;
        }
        case 'dash': this.audio.play('dash'); break;
        case 'jump': if (f === this.local) this.audio.play('jump'); break;
      }
    }
    f.events.length = 0;
  }

  // ——————— résolution du combat ———————
  // Une frappe de `slot` en direction `d` depuis (x,z) : chaque client ne l'applique
  // qu'aux entités qu'il simule (son joueur ; l'hôte : IA + droïdes).
  _resolveStrike(slot, d, x, z, isLocalSource) {
    const att = this.bySlot.get(slot);
    const yaw = att ? att.yaw : 0;
    // combattants
    for (const f of this.fighters) {
      if (f.slot === slot || !this._simulated(f) || !f.alive) continue;
      const dx = f.x - x, dz = f.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > CFG.range) continue;
      const ang = Math.atan2(dx, dz);
      let da = Math.abs(((ang - yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (da > CFG.arc) continue;
      if (att && Math.abs(f.y - att.y) > 1.8) continue;
      const r = f.takeHit(CFG.dmgSaber, x, z, d);
      if (r.result === 'blocked') {
        this._emit({ k: 'blk', s: f.slot, a: slot, p: r.perfect ? 1 : 0 });
        this.audio.play('clash');
        const tip = f.bladeTip();
        this.burst(tip.x, tip.y, tip.z, 0xfff0a0, 14, 5);
        if (att && this._simulated(att)) att.stagger(r.perfect ? CFG.staggerParried : .35);
        if (f === this.local) {
          this.input.rumble(80, .4);
          this.hud.toast(r.perfect ? '⚡ Parade parfaite !' : '🛡️ Paré !');
          if (r.perfect) this.camShake = Math.max(this.camShake, .2);
        }
        if (att === this.local && !r.perfect) this.hud.toast('🛡️ Coup paré');
      } else if (r.result === 'hit' || r.result === 'dead') {
        this.burst(f.x, f.y + 1.2, f.z, 0xff5040, 10, 4);
        this.audio.play('hit');
        this._emit({ k: 'hurt', s: f.slot, hp: f.hp | 0, by: slot });
        if (f === this.local) {
          this.hud.damageFlash(r.result === 'dead');
          this.input.rumble(200, .8);
          this.camShake = Math.max(this.camShake, .4);
        }
        if (r.result === 'dead') {
          this._emit({ k: 'die', s: f.slot, by: slot });
          this._onDeath(f.slot, slot);
        }
      }
    }
    // droïdes (autorité hôte)
    if (this.isHost) {
      for (const dr of this.droids.values()) {
        if (!dr.alive) continue;
        const dx = dr.x - x, dz = dr.z - z;
        const dist = Math.hypot(dx, dz);
        if (dist > CFG.range + .4) continue;
        const ang = Math.atan2(dx, dz);
        let da = Math.abs(((ang - yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        if (da > CFG.arc + .2) continue;
        if (dr.takeDamage(DMG_SABER_DROID)) this._droidDeath(dr, slot, true);
      }
    }
  }

  _resolvePush(slot, x, z, isLocalSource) {
    const pusher = this.bySlot.get(slot);
    const yaw = pusher ? pusher.yaw : 0;
    for (const f of this.fighters) {
      if (f.slot === slot || !this._simulated(f) || !f.alive) continue;
      const dx = f.x - x, dz = f.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > CFG.pushRange) continue;
      const ang = Math.atan2(dx, dz);
      let da = Math.abs(((ang - yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (da > CFG.pushArc) continue;
      const r = f.takePush(x, z);
      if (r === 'parried') {
        this._emit({ k: 'fparry', s: f.slot, a: slot });
        this.audio.play('forcefail');
        if (pusher && this._simulated(pusher)) pusher.stagger(CFG.staggerParried);
        if (f === this.local) this.hud.toast('🛡️ Poussée parée !');
        if (pusher === this.local) this.hud.toast('🛡️ Ta poussée a été parée !');
      } else if (r === 'pushed') {
        if (f === this.local) {
          this.hud.damageFlash(false);
          this.input.rumble(250, .7);
          this.camShake = Math.max(this.camShake, .45);
        }
      }
    }
    // droïdes : projetés et sonnés
    if (this.isHost) {
      for (const dr of this.droids.values()) {
        if (!dr.alive) continue;
        const dx = dr.x - x, dz = dr.z - z;
        const dist = Math.hypot(dx, dz);
        if (dist > CFG.pushRange) continue;
        const ang = Math.atan2(dx, dz);
        let da = Math.abs(((ang - yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        if (da > CFG.pushArc) continue;
        const l = dist || 1;
        dr.x += dx / l * 5;
        dr.z += dz / l * 5;
        dr.aimT = 0;
        dr.cool = Math.max(dr.cool, 1.6);
        const rr = Math.hypot(dr.x, dr.z);
        if (rr > ARENA_R - .5) { dr.x *= (ARENA_R - .5) / rr; dr.z *= (ARENA_R - .5) / rr; }
      }
    }
  }

  _onDeath(slot, by) {
    const f = this.bySlot.get(slot);
    if (f && f.alive) f.die(); // pour les remotes (l'état arrive aussi par snapshot)
    if (f) {
      this.burst(f.x, f.y + 1, f.z, 0xff8040, 20, 5);
      this.audio.play(f === this.local ? 'die' : 'kill');
    }
    if (by !== undefined && this.kills.has(by)) {
      this.kills.set(by, (this.kills.get(by) || 0) + 1);
      const killer = this.bySlot.get(by);
      if (killer === this.local && f) this.hud.toast(`⚔️ ${f.name} éliminé !`);
      if (f === this.local && killer) this.hud.toast(`💀 Tué par ${killer.name}`);
    }
    this._updateScores();

    if (this.mode === 'duel' && by !== undefined && (this.kills.get(by) || 0) >= DUEL_TARGET && this.phase === 'play') {
      this._gameOver({ winner: by });
      this._emit({ k: 'over', winner: by });
    }
    if (this.mode === 'horde') this._checkAllDead();
  }

  _maybeRespawn(f) {
    if (this.phase !== 'play') return;
    if (this.mode === 'duel') {
      if (f.deadT >= RESPAWN_DUEL) {
        const i = (this.rnd() * 8) | 0;
        f.spawnAt(this.arena.spawnPoint(i, 8));
        if (f === this.local) this.camYaw = f.yaw;
      }
    }
    // horde : réapparition gérée à la fin de vague (_waveCleared)
  }

  // ——————— mode horde ———————
  _nextWave() {
    this._setWave(this.wave + 1);
    this._emit({ k: 'wave', n: this.wave });
  }

  _setWave(n) {
    this.wave = n;
    this.audio.play('wave');
    this.hud.toast(`〰️ Vague ${n}`);
    if (this.isHost) {
      const count = Math.min(2 + n, 9);
      this.droidsToSpawn = [];
      for (let i = 0; i < count; i++) this.droidsToSpawn.push(.4 + i * .55);
      this._waveT = 0;
    }
    this._updateScores();
  }

  _hordeStep(dt) {
    this._waveT = (this._waveT || 0) + dt;
    // apparitions échelonnées aux portes
    while (this.droidsToSpawn.length && this.droidsToSpawn[0] <= this._waveT) {
      this.droidsToSpawn.shift();
      const g = this.arena.gateSpawn(this.rnd());
      const id = 'd' + (this._droidSeq = (this._droidSeq || 0) + 1);
      this._spawnDroid(id, g.x + (this.rnd() - .5), g.z + (this.rnd() - .5));
      this._emit({ k: 'dspawn', i: id, x: g.x, z: g.z });
    }

    // IA
    const alive = this.fighters.filter(f => f.alive);
    const arr = [...this.droids.values()];
    for (const d of arr) {
      const act = d.think(dt, alive, arr);
      if (act && act.shoot) {
        const id = 'b' + (++this._boltSeq) + '_h';
        const e = { k: 'bolt', id, from: d.id, ...act.shoot };
        this._spawnBolt(e, true);
        this._emit(e);
      }
    }

    // vague nettoyée ?
    if (!this.droidsToSpawn.length && arr.length && arr.every(d => !d.alive) && !this._clearPending) {
      this._clearPending = true;
      setTimeout(() => {
        this._clearPending = false;
        if (this.phase !== 'play') return;
        this._emit({ k: 'wclear' });
        this._waveCleared(true);
      }, 1800);
    }
  }

  _waveCleared(host) {
    this.audio.play('win');
    this.hud.toast(`✅ Vague ${this.wave} nettoyée !`);
    // chacun ressuscite / soigne SON combattant (autorité locale)
    if (this.local) {
      if (!this.local.alive) {
        this.local.spawnAt(this.arena.spawnPoint((this.rnd() * 8) | 0, 8));
        this.camYaw = this.local.yaw;
      } else {
        this.local.hp = Math.min(CFG.hp, this.local.hp + 35);
      }
    }
    if (this.isHost) {
      for (const f of this.fighters) {
        if (f.kind === 'ai') {
          if (!f.alive) f.spawnAt(this.arena.spawnPoint((this.rnd() * 8) | 0, 8));
          else f.hp = Math.min(CFG.hp, f.hp + 35);
        }
      }
      setTimeout(() => { if (this.phase === 'play') this._nextWave(); }, 2600);
    }
  }

  _checkAllDead() {
    if (this.mode !== 'horde' || this.phase !== 'play') return;
    if (this.fighters.every(f => !f.alive)) {
      const e = { k: 'over', wave: this.wave };
      this._gameOver(e);
      this._emit(e);
    }
  }

  _spawnDroid(id, x, z) {
    let d = this.droids.get(id);
    if (!d) {
      d = new Droid(id, mulberry32(this.cfg.seed + this.droids.size * 31));
      this.droids.set(id, d);
      this.scene.add(d.group);
    }
    d.spawnAt(x, z);
  }

  _droidDeath(d, by, host) {
    d.takeDamage(9999);
    d.alive = false;
    this.burst(d.x, 1.2, d.z, 0xffa040, 16, 5);
    this.audio.play('droidDie');
    if (by !== undefined && this.kills.has(by)) {
      this.kills.set(by, (this.kills.get(by) || 0) + 1);
      if (this.bySlot.get(by) === this.local) this.input.rumble(90, .4);
    }
    if (host) this._emit({ k: 'ddie', i: d.id, by });
    this._updateScores();
  }

  // ——————— bolts de blaster ———————
  _spawnBolt(e, local) {
    if (this.bolts.has(e.id)) return;
    const geo = new THREE.CylinderGeometry(.035, .035, .8, 6);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xff3020, blending: THREE.AdditiveBlending, transparent: true, opacity: .95, depthWrite: false,
    }));
    const b = { id: e.id, x: e.x, y: e.y, z: e.z, dx: e.dx, dy: e.dy, dz: e.dz, from: e.from, refl: false, life: 3, mesh: m };
    m.position.set(b.x, b.y, b.z);
    this.scene.add(m);
    this.bolts.set(e.id, b);
    this.audio.play('blaster');
  }

  _removeBolt(b) {
    this.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
    this.bolts.delete(b.id);
  }

  _updateBolts(dt) {
    for (const b of [...this.bolts.values()]) {
      b.life -= dt;
      b.x += b.dx * BOLT_SPEED * dt;
      b.y += b.dy * BOLT_SPEED * dt;
      b.z += b.dz * BOLT_SPEED * dt;
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.lookAt(b.x + b.dx, b.y + b.dy, b.z + b.dz);
      b.mesh.material.color.setHex(b.refl ? 0x40ff80 : 0xff3020);

      // sol / murs / temps
      if (b.life <= 0 || b.y < .02 || Math.hypot(b.x, b.z) > ARENA_R + 2.2) {
        this.burst(b.x, Math.max(b.y, .1), b.z, 0xff6040, 4, 2);
        this._removeBolt(b);
        continue;
      }

      // contre MES entités (joueur local ; l'hôte teste aussi IA + droïdes)
      let consumed = false;
      for (const f of this.fighters) {
        if (!this._simulated(f) || !f.alive) continue;
        if (b.from === f.slot) continue; // pas son propre bolt renvoyé
        const dx = f.x - b.x, dz = f.z - b.z;
        if (Math.hypot(dx, dz) > .75) continue;
        if (b.y < f.y || b.y > f.y + 2.0) continue;
        const r = f.takeBolt(BOLT_DMG, b.x - b.dx * 3, b.z - b.dz * 3);
        if (r === 'reflect') {
          // renvoi vers l'expéditeur !
          let tx = b.x - b.dx, ty = b.y, tz = b.z - b.dz;
          const src = typeof b.from === 'string' ? this.droids.get(b.from) : this.bySlot.get(b.from);
          if (src) { tx = src.x; ty = 1.1 + (src.hover ? 0 : .2); tz = src.z; }
          const dl = Math.hypot(tx - b.x, ty - b.y, tz - b.z) || 1;
          b.dx = (tx - b.x) / dl; b.dy = (ty - b.y) / dl; b.dz = (tz - b.z) / dl;
          b.refl = true; b.from = f.slot; b.life = 3;
          const tip = f.bladeTip();
          this.burst(tip.x, tip.y, tip.z, f.saberColor, 8, 4);
          this.audio.play('reflect');
          if (f === this.local) this.hud.toast('↩️ Tir renvoyé !');
          this._emit({ k: 'refl', id: b.id, s: f.slot, x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), dx: +b.dx.toFixed(3), dy: +b.dy.toFixed(3), dz: +b.dz.toFixed(3) });
        } else if (r === 'deflect') {
          this.burst(b.x, b.y, b.z, 0x9fd4ff, 6, 3);
          this.audio.play('deflect');
          this._emit({ k: 'defl', id: b.id });
          this._removeBolt(b);
          consumed = true;
          if (f === this.local) this.input.rumble(60, .3);
        } else if (r === 'hit' || r === 'dead') {
          this.burst(b.x, b.y, b.z, 0xff5040, 8, 3);
          this.audio.play('hit');
          this._emit({ k: 'hurt', s: f.slot, hp: f.hp | 0 });
          if (f === this.local) {
            this.hud.damageFlash(r === 'dead');
            this.input.rumble(150, .6);
            this.camShake = Math.max(this.camShake, .3);
          }
          if (r === 'dead') {
            this._emit({ k: 'die', s: f.slot, by: typeof b.from === 'string' ? undefined : b.from });
            this._onDeath(f.slot, typeof b.from === 'string' ? undefined : b.from);
          }
          this._emit({ k: 'defl', id: b.id });
          this._removeBolt(b);
          consumed = true;
        }
        if (consumed || r === 'reflect') break;
      }
      if (consumed) continue;

      // bolts renvoyés contre les droïdes (autorité hôte)
      if (b.refl && this.isHost) {
        for (const d of this.droids.values()) {
          if (!d.alive) continue;
          if (Math.hypot(d.x - b.x, d.z - b.z) > .7 || Math.abs(d.hover - b.y) > .9) continue;
          if (d.takeDamage(REFLECT_DMG)) this._droidDeath(d, typeof b.from === 'number' ? b.from : undefined, true);
          this._emit({ k: 'defl', id: b.id });
          this._removeBolt(b);
          break;
        }
      }
    }
  }

  // ——————— fin de partie ———————
  _gameOver(e) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this._overT = 0;
    this._overInfo = e;
    if (this.mode === 'duel') {
      const w = this.bySlot.get(e.winner);
      this.hud.countdown(w === this.local ? '🏆 VICTOIRE' : (w ? `${w.name} gagne` : 'Fin'));
      this.audio.play(w === this.local ? 'win' : 'lose');
    } else {
      this.hud.countdown('💀 DÉFAITE');
      this.audio.play('lose');
    }
  }

  _showResults() {
    this.hud.countdown('');
    let rows;
    let title;
    if (this.mode === 'duel') {
      const sorted = [...this.fighters].sort((a, b) => (this.kills.get(b.slot) || 0) - (this.kills.get(a.slot) || 0));
      rows = sorted.map((f, i) => ({
        rank: i + 1, name: f.name, me: f === this.local,
        detail: `${this.kills.get(f.slot) || 0} victoires`,
      }));
      title = 'FIN DU DUEL';
    } else {
      const sorted = [...this.fighters].sort((a, b) => (this.kills.get(b.slot) || 0) - (this.kills.get(a.slot) || 0));
      rows = sorted.map((f, i) => ({
        rank: i + 1, name: f.name, me: f === this.local,
        detail: `${this.kills.get(f.slot) || 0} droïdes`,
      }));
      title = `VAGUE ${this.wave} ATTEINTE`;
    }
    this.hud.showResults(title, rows);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _updateScores() {
    if (this.mode === 'duel') {
      const sorted = [...this.fighters].sort((a, b) => (this.kills.get(b.slot) || 0) - (this.kills.get(a.slot) || 0));
      this.hud.setScores(sorted.map(f => ({
        name: f.name, val: this.kills.get(f.slot) || 0, me: f === this.local, dead: !f.alive,
      })));
      this.hud.setObjective(`Duel — premier à ${DUEL_TARGET}`);
    } else {
      const alive = [...this.droids.values()].filter(d => d.alive).length;
      this.hud.setObjective(this.wave > 0 ? `Vague ${this.wave} — ${alive} droïde${alive > 1 ? 's' : ''}` : 'Les droïdes arrivent…');
      this.hud.setScores(this.fighters.map(f => ({
        name: f.name, val: this.kills.get(f.slot) || 0, me: f === this.local, dead: !f.alive,
      })));
    }
  }

  quit() {
    // les autres me verront partir via onPeerLeave
    this.onExit();
  }

  // ——————— rendu ———————
  _render(dt) {
    const now = performance.now() / 1000;

    for (const f of this.fighters) {
      if (!this._simulated(f)) f.interpolate(now);
      f.updateVisuals(dt, this.elapsed);
    }
    for (const d of this.droids.values()) {
      if (!this.isHost) d.interpolate(now);
      d.updateVisuals(dt);
    }
    this._updateFx(dt);

    // HUD local
    if (this.local) {
      this.hud.setHp(this.local.hp / CFG.hp);
      this.hud.setForce(this.local.force / 100, this.local.force >= CFG.forceCost);
      const f = this.local;
      if (f.state === 'attack') this.hud.setDir('attack', f.attackDir);
      else if (f.state === 'block') this.hud.setDir(f.blockDir === null ? 'assist' : 'block', f.blockDir);
      else this.hud.setDir('idle', null);
      const busy = f.state === 'attack' ? 1 : Math.hypot(f.vx, f.vz) / CFG.walk * .5;
      this.audio.humUpdate(clamp(busy, 0, 1));
      // indice pointer lock (bureau uniquement)
      const touch = this.input.touchMode || document.body.classList.contains('touch');
      this.hud.lockHint(!touch && !this.input.pointerLocked && this.phase !== 'over');
    }
    if (this.mode === 'horde' && this.tick % 30 === 0) this._updateScores();
    if (this.tick % 90 === 0) this._refreshControls(); // suit manette branchée / passage tactile

    this._placeCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // rappel des commandes non évidentes (déplacement/caméra exclus)
  _refreshControls() {
    const touch = this.input.touchMode || document.body.classList.contains('touch');
    let html;
    if (touch) {
      html = '<b>balayage</b> attaque (direction du geste) · <b>PARADE</b> parade auto · <b>✋</b> Force · <b>SAUT</b> ×2';
    } else if (this.input.padConnected) {
      html = '<b>RT</b> attaque + <b>stick D</b> direction · <b>LT</b> parade auto · <b>X</b> Force · <b>B</b> dash · <b>A</b> saut ×2';
    } else {
      html = '<b>clic G</b>+geste = attaque directionnelle · <b>clic D</b> maintenu+geste = parade directionnelle · <b>E</b> Force · <b>Maj</b> dash · <b>Espace</b> ×2';
    }
    this.hud.setControls(this.phase === 'over' ? '' : html);
  }

  _placeCamera(dt) {
    const f = this.local || this.fighters[0];
    if (!f) return;
    const dist = 5.6, baseH = 1.7;
    const cy = this.camYaw, cp = this.camPitch;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    // léger décalage épaule (droite)
    const sx = -Math.cos(cy) * .55, sz = Math.sin(cy) * .55;
    let tx = f.x - fx * dist * Math.cos(cp) + sx;
    let ty = f.y + baseH + dist * Math.sin(cp);
    let tz = f.z - fz * dist * Math.cos(cp) + sz;
    // ne traverse pas le mur d'enceinte
    const r = Math.hypot(tx, tz), maxR = ARENA_R + 1.2;
    if (r > maxR) { tx *= maxR / r; tz *= maxR / r; }
    if (ty < .4) ty = .4;

    const k = clamp(dt * 14, 0, 1);
    this.camera.position.x = lerp(this.camera.position.x || tx, tx, k);
    this.camera.position.y = lerp(this.camera.position.y || ty, ty, k);
    this.camera.position.z = lerp(this.camera.position.z || tz, tz, k);
    if (this.camShake > 0) {
      this.camShake -= dt;
      this.camera.position.x += (Math.random() - .5) * this.camShake * .5;
      this.camera.position.y += (Math.random() - .5) * this.camShake * .35;
    }
    this.camera.lookAt(f.x + fx * 3 + sx, f.y + 1.4 - Math.sin(cp) * 2.5, f.z + fz * 3 + sz);
  }
}
