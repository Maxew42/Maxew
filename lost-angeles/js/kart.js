// Kart : physique arcade + visuel + interpolation réseau.
// Les karts "local" et "ai" (sur la machine hôte) sont simulés ; les "remote" sont interpolés.
import * as THREE from 'three';
import { clamp, lerp, angleDelta } from './util.js';
import { buildCarMesh, carRadius, charById } from './characters.js';

// drapeaux d'état compactés pour le réseau
export const FL_BOOST = 1, FL_SPIN = 2, FL_ARMOR = 4, FL_SAW = 8, FL_STUN = 16, FL_FIN = 32;

function nameSprite(text, color = '#ffd28a') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.font = '700 30px system-ui';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 7;
  g.strokeText(text, 128, 28);
  g.fillStyle = color;
  g.fillText(text, 128, 28);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // taille constante à l'écran (sizeAttenuation:false) pour rester lisible sans envahir
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: t, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: .92,
  }));
  s.scale.set(.09, .0197, 1);
  return s;
}

export class Kart {
  constructor(charId, track, { slot = 0, name = '', kind = 'local', tint = null } = {}) {
    this.charId = charId;
    this.char = charById(charId);
    this.track = track;
    this.slot = slot;
    this.name = name;
    this.kind = kind; // 'local' | 'remote' | 'ai'

    const s = this.char.stats;
    this.vmax = 28.5 + 8.5 * s.speed;
    this.accel = 10 + 14 * s.accel;
    this.turnRate = 1.2 + 1.3 * s.turn;
    this.mass = 0.6 + 1.4 * s.weight;
    this.radius = carRadius(charId);

    // état physique
    this.x = 0; this.z = 0; this.y = 0; this.yVel = 0;
    this.gY = 0;              // hauteur du sol sous le kart
    this.grounded = true;     // false = en l'air (rampe, explosion, chute)
    this._groundVy = 0;       // vitesse verticale imprimée par la pente
    this.justFell = false;    // vient de tomber dans le ravin (lu par game.js)
    this.fallPos = null;
    this._landedV = 0;        // vitesse d'impact du dernier atterrissage
    this.heading = 0;
    this.speed = 0;
    this.steerVis = 0;

    // progression
    this.hintIdx = 0; this.lastF = 0; this.lat = 0;
    this.totalProgress = 0;
    this.lap = 1; this.rank = 8;
    this.wrongWayT = 0;
    this.offroad = false;

    // objets / effets
    this.item = null;         // id d'objet tenu
    this.rouletteT = 0;       // roulette en cours (>0)
    this.boostT = 0; this.boostMult = 1.32;
    this.spinT = 0; this.stunT = 0; this.armorT = 0; this.sawT = 0; this.poopT = 0;
    this.stallT = 0;          // moteur noyé au départ : accélérateur inopérant
    this.spinAngle = 0;
    this.finished = false; this.finishTime = null;

    // drift
    this.driftDir = 0; this.driftCharge = 0; this.driftBoostTier = 0;

    // interpolation réseau
    this.snaps = [];

    // ——— visuel ———
    this.group = new THREE.Group();
    this.body = buildCarMesh(charId, tint);
    this.group.add(this.body);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius * 1.15, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .32, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04;
    this.group.add(shadow);
    this.shadow = shadow;

    // flammes de boost
    this.flames = [];
    for (const fx of [-.5, .5]) {
      const f = new THREE.Mesh(
        new THREE.ConeGeometry(.28, 1.4, 6),
        new THREE.MeshBasicMaterial({ color: 0xff9a30, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      f.rotation.x = Math.PI / 2;
      f.position.set(fx, .55, -(charId === 'fury' ? 3.4 : 2.4));
      f.visible = false;
      this.group.add(f);
      this.flames.push(f);
    }

    // scies latérales
    this.saws = [];
    for (const sx of [-2.1, 2.1]) {
      const saw = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, .12, 16), new THREE.MeshLambertMaterial({ color: 0xb9c2ca }));
      const hub2 = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .16, 8), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      // dents
      for (let i = 0; i < 8; i++) {
        const th = new THREE.Mesh(new THREE.ConeGeometry(.16, .4, 4), new THREE.MeshLambertMaterial({ color: 0x8f989f }));
        const a = i / 8 * Math.PI * 2;
        th.position.set(Math.cos(a) * 1.15, 0, Math.sin(a) * 1.15);
        th.rotation.z = -a - Math.PI / 2;
        th.rotation.x = Math.PI / 2;
        disc.add(th);
      }
      saw.add(disc, hub2);
      saw.position.set(sx, .55, 0);
      saw.visible = false;
      this.group.add(saw);
      this.saws.push(saw);
    }

    // bulle de blindage
    this.armorShell = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius + 1.0, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.armorShell.visible = false;
    this.armorShell.position.y = 1;
    this.group.add(this.armorShell);

    if (kind !== 'local' && name) {
      this.tag = nameSprite(name, kind === 'ai' ? '#b9c2ca' : '#ffd28a');
      this.tag.position.y = charId === 'fury' ? 4.4 : 3.2;
      this.group.add(this.tag);
    }
  }

  placeAtGrid() {
    const g = this.track.gridSlot(this.slot);
    this.x = g.pos.x; this.z = g.pos.z;
    this.y = g.pos.y; this.gY = g.pos.y;
    this.grounded = true; this.yVel = 0;
    this.heading = g.heading;
    this.totalProgress = g.progress;
    this.lastF = ((g.progress % this.track.N) + this.track.N) % this.track.N;
    this.hintIdx = Math.floor(this.lastF);
    this.speed = 0;
    this.syncVisual();
  }

  get flags() {
    return (this.boostT > 0 ? FL_BOOST : 0) | (this.spinT > 0 ? FL_SPIN : 0) |
      (this.armorT > 0 ? FL_ARMOR : 0) | (this.sawT > 0 ? FL_SAW : 0) |
      (this.stunT > 0 ? FL_STUN : 0) | (this.finished ? FL_FIN : 0);
  }

  get vulnerable() { return this.armorT <= 0 && this.spinT <= 0 && this.stunT <= 0 && !this.finished; }

  // hauteur au-dessus du sol (0 = roues posées)
  get airH() { return Math.max(0, this.y - this.gY); }

  dirX() { return Math.sin(this.heading); }
  dirZ() { return Math.cos(this.heading); }

  // ——— effets ———
  startBoost(dur = 2.0, mult = 1.32) {
    this.boostT = Math.max(this.boostT, dur);
    this.boostMult = mult;
    this.speed = Math.max(this.speed, this.vmax * 1.05);
  }
  spinOut() {
    if (!this.vulnerable) return false;
    this.spinT = 1.1; this.spinAngle = 0;
    this.driftDir = 0; this.driftCharge = 0;
    this.boostT = 0;
    return true;
  }
  blast() {
    if (!this.vulnerable) return false;
    this.stunT = 1.5; this.spinAngle = 0;
    this.yVel = 7.5; this.grounded = false;
    this.speed *= .15;
    this.driftDir = 0; this.driftCharge = 0;
    this.boostT = 0;
    return true;
  }
  startArmor(dur = 5) { this.armorT = dur; }
  startSaw(dur = 6) { this.sawT = dur; }

  // ——— physique (local & IA) ———
  update(dt, input) {
    const t = this.track;
    const controlled = this.spinT <= 0 && this.stunT <= 0;

    // vitesse max effective
    let vm = this.vmax;
    if (this.armorT > 0) vm *= 1.1;
    if (this.boostT > 0) vm *= this.boostMult;
    else if (this.offroad) vm *= .48;

    const throttle = this.stallT > 0 ? 0 : input.throttle;
    if (controlled) {
      if (throttle > 0) {
        const a = (this.accel * (1 - clamp(this.speed / vm, 0, 1)) + 2) * (this.grounded ? 1 : .15);
        this.speed += a * throttle * dt;
      } else if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - 7 * dt);
      }
      if (input.brake > 0) {
        this.speed -= 30 * input.brake * dt;
        this.speed = Math.max(this.speed, -9);
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + 14 * dt);
      }
    } else {
      this.speed = Math.max(0, this.speed - 12 * dt);
    }
    if (this.speed > vm) this.speed = Math.max(vm, this.speed - 20 * dt);

    // ——— drift ———
    if (controlled && this.grounded && input.drift && Math.abs(input.steer) > .2 && this.speed > 13 && this.driftDir === 0) {
      this.driftDir = Math.sign(input.steer);
      this.driftCharge = 0;
    }
    if (this.driftDir !== 0 && (!input.drift || this.speed < 9 || !controlled)) {
      // relâché → mini-turbo selon la charge
      if (controlled && this.driftCharge > .85) {
        const tier = this.driftCharge > 1.9 ? 2 : 1;
        this.startBoost(tier === 2 ? 1.5 : .85, 1.3);
        this.driftBoostTier = tier; // le jeu lit ça pour le son/particules
      }
      this.driftDir = 0; this.driftCharge = 0;
    }

    // ——— direction ———
    let yaw = 0;
    if (controlled) {
      const grip = clamp(Math.abs(this.speed) / 7, 0, 1) * (1 - .40 * clamp(Math.abs(this.speed) / this.vmax, 0, 1));
      if (this.driftDir !== 0) {
        const align = clamp(input.steer * this.driftDir, -0.4, 1); // module le rayon du drift
        yaw = this.driftDir * this.turnRate * grip * (0.9 + .45 * align);
        if (this.grounded) this.driftCharge += dt * (0.85 + .45 * Math.max(0, align));
      } else {
        yaw = input.steer * this.turnRate * grip;
      }
      if (this.speed < 0) yaw = -yaw;
      this.heading += yaw * dt * (this.grounded ? 1 : .35); // en l'air on ne braque presque plus
    }
    this.steerVis = lerp(this.steerVis, controlled ? input.steer : 0, clamp(dt * 10, 0, 1));

    // ——— intégration ———
    this.x += this.dirX() * this.speed * dt;
    this.z += this.dirZ() * this.speed * dt;
    // glisse extérieure pendant le drift
    if (this.driftDir !== 0) {
      const lx = Math.cos(this.heading), lz = -Math.sin(this.heading);
      const slide = -this.driftDir * this.speed * .16 * dt;
      this.x += lx * slide; this.z += lz * slide;
    }
    // ——— piste : progression, hors-piste, murs ———
    const proj = t.project(this.x, this.z, this.hintIdx);
    this.hintIdx = proj.idx;
    let df = proj.f - this.lastF;
    if (df > t.N / 2) df -= t.N; else if (df < -t.N / 2) df += t.N;
    if (Math.abs(df) < 25) this.totalProgress += df;
    this.lastF = proj.f;
    this.lat = proj.lat;
    this.offroad = Math.abs(proj.lat) > t.halfW + .6;

    // marche arrière prolongée = mauvais sens
    this.wrongWayT = (df < -0.008 && this.speed > 4) ? this.wrongWayT + dt : 0;

    const wallLim = t.wallDist - 1.1;
    if (Math.abs(proj.lat) > wallLim) {
      const c = t.posAt(proj.f), l = t.leftAt(proj.f);
      const s = Math.sign(proj.lat);
      this.x = c.x + l.x * wallLim * s;
      this.z = c.z + l.z * wallLim * s;
      this.speed *= (1 - 1.8 * dt);
      this.lat = wallLim * s;
    }

    // ——— relief : suivi du sol, envol (rampe/explosion), gouffre ———
    const gY = t.heightAt(proj.f);
    const inG = t.inGap(proj.f);
    let fell = false;
    if (this.grounded) {
      if (inG || gY <= this.y - .5) {
        // le sol se dérobe : bout de la rampe ou bord du gouffre
        this.grounded = false;
        this.yVel = Math.max(0, this._groundVy);
      } else {
        this._groundVy = dt > 0 ? (gY - this.y) / dt : 0;
        this.y = gY;
      }
    }
    if (!this.grounded) {
      this.y += this.yVel * dt;
      this.yVel -= 26 * dt;
      if (this.y <= gY + .01 && this.yVel <= 0) {
        if (!inG && this.y > gY - .9) {
          // arrivé par le haut : atterrissage
          this._landedV = -this.yVel;
          this.y = gY; this.yVel = 0; this.grounded = true; this._groundVy = 0;
        } else fell = true; // fond du ravin ou falaise en pleine face
      }
    }
    if (inG && this.y < t.jump.roadY - 2.6) fell = true;
    this.gY = gY;
    if (fell) {
      this.fallPos = { x: this.x, y: this.y, z: this.z };
      this._respawn();
    }

    // la pente freine en montée, pousse en descente
    if (this.grounded && Math.abs(this.speed) > 1.5) {
      const slope = (t.heightAt(proj.f + 2) - t.heightAt(proj.f - 2)) / (4 * t.segLen);
      const fwd = this.dirX() * t.tan[proj.idx].x + this.dirZ() * t.tan[proj.idx].z;
      this.speed -= slope * fwd * 7.5 * dt;
    }

    this.lap = clamp(Math.floor(this.totalProgress / t.N) + 1, 1, 99);

    // ——— minuteries d'effets ———
    if (this.boostT > 0) this.boostT -= dt;
    if (this.armorT > 0) this.armorT -= dt;
    if (this.sawT > 0) this.sawT -= dt;
    if (this.poopT > 0) this.poopT -= dt;
    if (this.stallT > 0) this.stallT -= dt;
    if (this.rouletteT > 0) this.rouletteT -= dt;
    if (this.spinT > 0) { this.spinT -= dt; this.spinAngle += dt * 11.4; }
    else if (this.stunT > 0) { this.stunT -= dt; this.spinAngle += dt * 8; }
    else this.spinAngle = 0;

    this.syncVisual();
  }

  // repêché façon Mario Kart : replacé juste avant le saut, sonné un instant
  _respawn() {
    const t = this.track, N = t.N;
    const f = t.jump.respawnF;
    const p = t.posAt(f), l = t.leftAt(f);
    const latOff = ((this.slot % 4) - 1.5) * 2.2; // évite d'empiler les repêchés
    this.x = p.x + l.x * latOff;
    this.z = p.z + l.z * latOff;
    this.heading = t.headingAt(f);
    this.speed = 0;
    this.y = t.heightAt(f); this.gY = this.y;
    this.yVel = 0; this.grounded = true; this._groundVy = 0;
    this.stunT = Math.max(this.stunT, 1.0);
    this.boostT = 0; this.driftDir = 0; this.driftCharge = 0;
    // progression recalée sans casser le compte de tours
    const cur = ((this.lastF % N) + N) % N;
    let df = f - cur;
    if (df > N / 2) df -= N; else if (df < -N / 2) df += N;
    this.totalProgress += df;
    this.lastF = f;
    this.hintIdx = Math.floor(f);
    this.justFell = true;
  }

  // ——— réseau ———
  snapshot() {
    return {
      x: +this.x.toFixed(2), z: +this.z.toFixed(2), y: +this.y.toFixed(2),
      h: +this.heading.toFixed(3), v: +this.speed.toFixed(2),
      tp: +this.totalProgress.toFixed(2), fl: this.flags,
    };
  }

  pushSnapshot(s, now) {
    this.snaps.push({ t: now, ...s });
    if (this.snaps.length > 12) this.snaps.shift();
  }

  // rendu différé de ~120 ms pour lisser
  interpolate(now) {
    const buf = this.snaps;
    if (!buf.length) return;
    const rt = now - .12;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= rt) { a = buf[i]; b = buf[Math.min(i + 1, buf.length - 1)]; break; }
    }
    let x, z, y, h;
    if (b.t > a.t && rt <= b.t) {
      const f = clamp((rt - a.t) / (b.t - a.t), 0, 1);
      x = lerp(a.x, b.x, f); z = lerp(a.z, b.z, f); y = lerp(a.y, b.y, f);
      h = a.h + angleDelta(a.h, b.h) * f;
    } else {
      // extrapolation courte si les paquets tardent
      const over = Math.max(0, Math.min(rt - b.t, .25));
      x = b.x + Math.sin(b.h) * b.v * over;
      z = b.z + Math.cos(b.h) * b.v * over;
      y = b.y; h = b.h;
    }
    this.x = x; this.z = z; this.y = y;
    this.heading = h;
    this.speed = b.v;
    this.totalProgress = b.tp;
    this.lap = clamp(Math.floor(this.totalProgress / this.track.N) + 1, 1, 99);
    const fl = b.fl;
    this.boostT = fl & FL_BOOST ? .2 : 0;
    this.armorT = fl & FL_ARMOR ? .2 : 0;
    this.sawT = fl & FL_SAW ? .2 : 0;
    this.finished = !!(fl & FL_FIN);
    if (fl & (FL_SPIN | FL_STUN)) this.spinAngle += .19; else this.spinAngle = 0;
    // pour les collisions locales et le guidage des projectiles
    const proj = this.track.project(this.x, this.z, this.hintIdx);
    this.hintIdx = proj.idx;
    this.lastF = proj.f;
    this.lat = proj.lat;
    this.gY = this.track.heightAt(proj.f);
    this.syncVisual();
  }

  syncVisual() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading + this.spinAngle +
      (this.driftDir !== 0 ? this.driftDir * .35 : 0);
    this.group.rotation.z = -this.steerVis * .07 * clamp(this.speed / this.vmax, 0, 1);
    // l'ombre reste plaquée au sol, même en plein vol
    this.shadow.position.y = (this.gY - this.y) + .04;
    this.shadow.material.opacity = clamp(.32 - this.airH * .03, .08, .32);
  }

  updateVisuals(dt, time) {
    // roues
    const ws = this.body.userData.wheels || [];
    for (const w of ws) w.rotation.x += this.speed * dt / .45;
    for (const w of this.body.userData.frontWheels || []) w.rotation.y = this.steerVis * .38;

    // flammes
    const showFlames = this.boostT > 0;
    for (const f of this.flames) {
      f.visible = showFlames;
      if (showFlames) f.scale.set(1, .7 + Math.random() * .7, 1);
    }
    // scies
    const showSaws = this.sawT > 0;
    for (const s of this.saws) {
      s.visible = showSaws;
      if (showSaws) s.children[0].rotation.y += dt * 22;
    }
    // blindage
    this.armorShell.visible = this.armorT > 0;
    if (this.armorT > 0) {
      const p = 1 + Math.sin(time * 14) * .05;
      this.armorShell.scale.set(p, p, p);
    }
  }
}
