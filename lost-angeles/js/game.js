// Orchestrateur de course : scène, boucle de jeu, collisions, classement,
// caisses, synchro réseau. Une instance = une course.
import * as THREE from 'three';
import { Track } from './track.js';
import { Kart } from './kart.js';
import { AIDriver } from './ai.js';
import { ItemWorld, rollItem } from './items.js';
import { charById } from './characters.js';
import { clamp, lerp, angleDelta, mulberry32 } from './util.js';

const STEP = 1 / 60;
const LAPS = 3;

export class Race {
  // cfg: { seed, slots: [{slot, type:'local'|'remote'|'ai', charId, name, peerId, tint}], localSlot }
  constructor({ renderer, input, hud, audio, net, cfg, onExit }) {
    this.renderer = renderer;
    this.input = input;
    this.hud = hud;
    this.audio = audio;
    this.net = net;
    this.cfg = cfg;
    this.onExit = onExit;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc8905a, 90, 620);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .1, 1600);

    const hemi = new THREE.HemisphereLight(0xe8b070, 0x3a2c20, 1.15);
    const sun = new THREE.DirectionalLight(0xffc890, 1.4);
    sun.position.set(300, 180, -400);
    this.scene.add(hemi, sun);

    this.track = new Track(cfg.seed);
    this.scene.add(this.track.group);

    // ——— karts ———
    this.karts = [];
    this.drivers = new Map(); // slot → AIDriver
    this.peerSlot = new Map(); // peerId → slot
    for (const s of cfg.slots) {
      const kart = new Kart(s.charId, this.track, {
        slot: s.slot, name: s.name,
        kind: s.type === 'local' ? 'local' : s.type === 'ai' ? 'ai' : 'remote',
        tint: s.tint || null,
      });
      kart.placeAtGrid();
      this.scene.add(kart.group);
      this.karts.push(kart);
      if (s.peerId) this.peerSlot.set(s.peerId, s.slot);
    }
    this.local = this.karts.find(k => k.kind === 'local');
    this._makeAiDrivers();

    // ——— objets ———
    this.items = new ItemWorld(this.scene, this.track, {
      ownedKarts: () => this.karts.filter(k => this._simulated(k)),
      allKarts: () => this.karts,
      kartBySlot: slot => this.karts.find(k => k.slot === slot),
      localSlot: () => this.local ? this.local.slot : -1,
      emit: evt => this.net && this.net.sendEvent(evt),
      sfx: n => this.audio.play(n),
      splat: () => this.hud.splat(),
      toast: txt => this.hud.toast(txt),
    });

    // ——— état de course ———
    this.phase = 'count';        // 'count' | 'race'
    this.clock = -3.4;           // temps de course (négatif = décompte)
    this.elapsed = 0;
    this.tick = 0;
    this.finishTimes = new Map(); // slot → temps
    this.finishOrder = [];
    this.resultsShown = false;
    this.camShake = 0;
    this._lastCount = 4;
    this._prevSpin = false; this._prevStun = false;
    this._raf = null;
    this._acc = 0;
    this._lastT = performance.now();

    this._wireNet();
    this._placeCamera(true);
    this.hud.show();
    this.hud.setLap(1, LAPS);
    this.hud.setItem(null);
  }

  _simulated(k) {
    return k.kind === 'local' || (k.kind === 'ai' && (!this.net || this.net.isHost));
  }

  _makeAiDrivers() {
    const host = !this.net || this.net.isHost;
    for (const k of this.karts) {
      if (k.kind === 'ai' && host && !this.drivers.has(k.slot)) {
        // rng dérivé de la seed + slot → même personnalité même si l'hôte change
        this.drivers.set(k.slot, new AIDriver(k, this.track, mulberry32(this.cfg.seed * 7 + k.slot)));
      }
    }
  }

  _wireNet() {
    if (!this.net) return;
    const now = () => performance.now() / 1000;
    this.net.onState = (s, id) => {
      const slot = this.peerSlot.get(id);
      const k = this.karts.find(x => x.slot === slot);
      if (k) k.pushSnapshot(s, now());
    };
    this.net.onAiState = arr => {
      if (this.net.isHost) return;
      const t = now();
      for (const s of arr) {
        const k = this.karts.find(x => x.slot === s.s && x.kind === 'ai');
        if (k) k.pushSnapshot(s, t);
      }
    };
    this.net.onEvent = evt => {
      if (evt.k === 'forfeit') this._removeKartBySlot(evt.s, '🏳️ %s a quitté la course');
      else this.items.onRemote(evt);
    };
    this.net.onFinish = f => this._recordFinish(f.slot, f.time);
    this.net.onHostChange = () => {
      if (this.net.isHost) {
        this.hud.toast('👑 Tu es maintenant l’hôte de la course');
        this._makeAiDrivers();
      }
    };
    this.net.onPeers = () => {
      // un joueur est parti en pleine course
      for (const [pid, slot] of this.peerSlot) {
        if (!this.net.peers.has(pid)) {
          this._removeKartBySlot(slot, '🏳️ %s a quitté la course');
          this.peerSlot.delete(pid);
        }
      }
    };
  }

  _removeKartBySlot(slot, msg) {
    const i = this.karts.findIndex(k => k.slot === slot);
    if (i < 0) return;
    const k = this.karts[i];
    if (k === this.local) return;
    if (msg) this.hud.toast(msg.replace('%s', k.name));
    this.scene.remove(k.group);
    this.karts.splice(i, 1);
  }

  start() {
    this._lastT = performance.now();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const t = performance.now();
      let dt = (t - this._lastT) / 1000;
      this._lastT = t;
      dt = Math.min(dt, .12);
      this._acc += dt;
      let n = 0;
      while (this._acc >= STEP && n < 6) { this._step(STEP); this._acc -= STEP; n++; }
      this._render(dt);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this.audio.engineStop();
    this.hud.hide();
    if (this.net) {
      this.net.onState = this.net.onAiState = this.net.onEvent = () => {};
      this.net.onFinish = this.net.onHostChange = () => {};
    }
    this.items.dispose();
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

  // ——— pas de simulation fixe ———
  _step(dt) {
    this.elapsed += dt;
    this.clock += dt;
    this.tick++;

    // décompte
    if (this.phase === 'count') {
      const c = Math.ceil(-this.clock);
      if (c !== this._lastCount) {
        this._lastCount = c;
        if (c > 0) { this.hud.countdown(String(c)); this.audio.play('count'); }
      }
      if (this.clock >= 0) {
        this.phase = 'race';
        this.hud.countdown('GO !');
        this.audio.play('go');
        this.audio.engineStart();
        setTimeout(() => this.hud.countdown(''), 800);
      }
    }

    const inRace = this.phase === 'race';
    const rawInput = this.input.read();
    if (rawInput.pause) { this._quit(); return; }

    // ——— kart local ———
    if (this.local && !this.local._autopilot) {
      const inp = inRace ? rawInput : { steer: 0, throttle: 0, brake: 0, drift: false, item: false };
      this.local.update(dt, inp);
      if (inp.item && this.local.item && this.local.rouletteT <= 0 && inRace) {
        const it = this.local.item;
        this.local.item = null;
        this.hud.setItem(null);
        this.items.use(this.local, it);
      }
    }

    // ——— IA (hôte ou solo) — le kart local fini passe aussi en autopilote ———
    const pacer = this._pacerProgress();
    const world = { phase: this.phase, nails: this.items.nails, pacerProgress: pacer };
    for (const k of this.karts) {
      if (k.kind === 'ai' && this._simulated(k)) {
        const drv = this.drivers.get(k.slot);
        if (!drv) continue;
        const inp = drv.think(dt, world);
        k.update(dt, inp);
        if (inp.item && k.item && k.rouletteT <= 0 && inRace) {
          const it = k.item; k.item = null;
          this.items.use(k, it);
        }
      } else if (k.kind === 'local' && k._autopilot) {
        const drv = this.drivers.get(k.slot);
        k.update(dt, drv ? drv.think(dt, world) : { steer: 0, throttle: .4, brake: 0, drift: false, item: false });
      }
    }

    // roulettes en attente → attribution de l'objet
    for (const k of this.karts) {
      if (k._pendingRoll && k.rouletteT <= 0 && this._simulated(k)) {
        k._pendingRoll = false;
        if (k.kind !== 'local') k.item = rollItem(k.rank);
      }
    }

    if (inRace) {
      this._collisions(dt);
      this._crates();
      this.items.update(dt);
      this._ranking();
      this._finishes();
    }

    this.track.update(dt, this.elapsed, this.camera.position);

    // ——— envois réseau ———
    if (this.net && this.local && this.tick % 4 === 0) this.net.sendState(this.local.snapshot());
    if (this.net && this.net.isHost && this.tick % 6 === 0) {
      const arr = this.karts.filter(k => k.kind === 'ai').map(k => ({ s: k.slot, ...k.snapshot() }));
      if (arr.length) this.net.sendAi(arr);
    }
  }

  _pacerProgress() {
    let best = -1e9;
    for (const k of this.karts) if (k.kind !== 'ai') best = Math.max(best, k.totalProgress);
    return best;
  }

  // collisions kart-kart : seuls les karts simulés localement sont déplacés
  _collisions(dt) {
    for (const a of this.karts) {
      if (!this._simulated(a) || a.finished) continue;
      for (const b of this.karts) {
        if (a === b || b.finished) continue;
        const dx = a.x - b.x, dz = a.z - b.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d < min && d > .01) {
          const nx = dx / d, nz = dz / d;
          const push = (min - d);
          const wRatio = clamp(b.mass / (a.mass + b.mass), .15, .85);
          a.x += nx * push * wRatio;
          a.z += nz * push * wRatio;
          // le blindage fait valser les autres
          if (b.armorT > 0 && a.armorT <= 0) {
            if (a.spinOut()) { this.audio.play('spin'); }
            a.x += nx * 2; a.z += nz * 2;
          } else if (d < min * .9) {
            a.speed *= (1 - .8 * dt * wRatio);
            if (a === this.local && Math.abs(a.speed) > 8 && this.tick % 12 === 0) {
              this.audio.play('bump');
              this.input.rumble(60, .3);
            }
          }
        }
      }
    }
  }

  _crates() {
    for (const c of this.track.crates) {
      if (!c.active) continue;
      for (const k of this.karts) {
        if (k.finished || Math.abs(k.y) > 1.2) continue;
        if (Math.hypot(k.x - c.x, k.z - c.z) < 2.3) {
          this.track.breakCrate(c);
          this.items.crateBurst(c.x, 1.2, c.z);
          if (this._simulated(k) && !k.item && !k._pendingRoll) {
            k._pendingRoll = true;
            k.rouletteT = .9;
            if (k.kind === 'local') {
              this.audio.play('pickup');
              const item = rollItem(k.rank);
              this.hud.itemRoulette(item, this.audio, () => { k.item = item; k._pendingRoll = false; });
            }
          } else if (k === this.local) {
            this.audio.play('pickup');
          }
          break;
        }
      }
    }
  }

  _ranking() {
    const racing = this.karts.filter(k => !k.finished);
    racing.sort((x, y) => y.totalProgress - x.totalProgress);
    const base = this.finishOrder.length;
    racing.forEach((k, i) => { k.rank = base + i + 1; });

    if (this.local) {
      // tours + toasts
      const lap = clamp(this.local.lap, 1, LAPS);
      if (lap !== this._lastLap) {
        if (this._lastLap != null && lap > this._lastLap && !this.local.finished) {
          this.audio.play('lap');
          this.hud.toast(lap === LAPS ? '🏁 Dernier tour !' : `Tour ${lap}/${LAPS}`);
        }
        this._lastLap = lap;
        this.hud.setLap(lap, LAPS);
      }
      this.hud.setRank(this.local.rank);
      this.hud.wrongWay(this.local.wrongWayT > 1.2 && !this.local.finished);
    }
  }

  _recordFinish(slot, time) {
    if (this.finishTimes.has(slot)) return;
    this.finishTimes.set(slot, time);
    this.finishOrder.push(slot);
    const k = this.karts.find(x => x.slot === slot);
    if (k) {
      k.finished = true;
      k.finishTime = time;
      k.rank = this.finishOrder.length;
      if (k !== this.local) this.hud.toast(`🏁 ${k.name} a fini ${k.rank}${k.rank === 1 ? 'ᵉʳ' : 'ᵉ'} !`);
    }
    if (this.resultsShown) this._refreshResults();
  }

  _finishes() {
    const goal = LAPS * this.track.N;
    for (const k of this.karts) {
      if (k.finished || !this._simulated(k)) continue;
      if (k.totalProgress >= goal) {
        const time = this.clock;
        this._recordFinish(k.slot, time);
        if (this.net) this.net.sendFinish({ slot: k.slot, time });
        if (k === this.local) {
          this.audio.play('finish');
          this.hud.toast(`🏁 Arrivée ! ${k.rank}${k.rank === 1 ? 'ᵉʳ' : 'ᵉ'} place`);
          k._autopilot = true;
          this.drivers.set(k.slot, new AIDriver(k, this.track, mulberry32(this.cfg.seed + 99)));
          setTimeout(() => this._showResults(), 1800);
        }
      }
    }
  }

  _resultRows() {
    const rows = [];
    const all = [...this.karts].sort((a, b) => {
      const fa = this.finishTimes.has(a.slot), fb = this.finishTimes.has(b.slot);
      if (fa && fb) return this.finishTimes.get(a.slot) - this.finishTimes.get(b.slot);
      if (fa) return -1;
      if (fb) return 1;
      return b.totalProgress - a.totalProgress;
    });
    all.forEach((k, i) => rows.push({
      rank: i + 1,
      name: k.name,
      charName: charById(k.charId).name,
      time: this.finishTimes.get(k.slot) ?? null,
      racing: !k.finished,
      isLocal: k === this.local,
    }));
    return rows;
  }

  _showResults() {
    this.resultsShown = true;
    this._refreshResults();
  }
  _refreshResults() {
    this.hud.showResults(this._resultRows());
  }

  _quit() {
    if (this.net && this.local) this.net.sendEvent({ k: 'forfeit', s: this.local.slot });
    this.onExit();
  }

  // pour les tests : l'IA prend le volant du joueur
  debugAutopilot() {
    if (!this.local) return;
    this.local._autopilot = true;
    this.drivers.set(this.local.slot, new AIDriver(this.local, this.track, mulberry32(42)));
  }

  // ——— rendu ———
  _render(dt) {
    const now = performance.now() / 1000;

    // interpolation des karts distants (+ IA côté clients)
    for (const k of this.karts) {
      if (!this._simulated(k)) k.interpolate(now);
      k.updateVisuals(dt, this.elapsed);
    }

    // résultats live : rafraîchit quand quelqu'un finit (léger)
    if (this.resultsShown && this.tick % 60 === 0) this._refreshResults();

    this._placeCamera(false, dt);

    if (this.local) {
      const boosting = this.local.boostT > 0;
      this.hud.setBoost(boosting);
      this.hud.setTime(this.clock);
      this.audio.engineUpdate(clamp(Math.abs(this.local.speed) / this.local.vmax, 0, 1.3), boosting, dt);
      // secousse caméra sur dégâts
      if ((this.local.spinT > 0 && !this._prevSpin) || (this.local.stunT > 0 && !this._prevStun)) {
        this.camShake = this.local.stunT > 0 ? .9 : .5;
        this.input.rumble(this.local.stunT > 0 ? 400 : 200, .9);
        if (this.local.stunT > 0) this.audio.play('spin');
      }
      this._prevSpin = this.local.spinT > 0;
      this._prevStun = this.local.stunT > 0;
      const fov = boosting ? 82 : 72;
      this.camera.fov = lerp(this.camera.fov, fov, clamp(dt * 5, 0, 1));
      this.camera.updateProjectionMatrix();
    }

    this.hud.drawMinimap(this.track, this.karts, this.local ? this.local.slot : -1);
    this.renderer.render(this.scene, this.camera);
  }

  _placeCamera(snap, dt = 1 / 60) {
    const k = this.local || this.karts[0];
    if (!k) return;
    const back = 8.2, up = 3.6;
    // la caméra suit le cap "lissé", pas le tête-à-queue
    const h = k.heading;
    const tx = k.x - Math.sin(h) * back;
    const tz = k.z - Math.cos(h) * back;
    const ty = up + k.y * .5;
    if (snap) {
      this.camera.position.set(tx, ty, tz);
    } else {
      const f = clamp(dt * 6.5, 0, 1);
      this.camera.position.x = lerp(this.camera.position.x, tx, f);
      this.camera.position.y = lerp(this.camera.position.y, ty, f);
      this.camera.position.z = lerp(this.camera.position.z, tz, f);
    }
    if (this.camShake > 0) {
      this.camShake -= dt;
      this.camera.position.x += (Math.random() - .5) * this.camShake * 1.1;
      this.camera.position.y += (Math.random() - .5) * this.camShake * .7;
    }
    this.camera.lookAt(k.x + Math.sin(h) * 5, 1.4 + k.y * .6, k.z + Math.cos(h) * 5);
  }
}
