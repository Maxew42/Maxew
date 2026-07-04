// Droïde blaster : entité PvE volante, simulée par l'hôte (ou en solo).
// IA : orbite autour de sa cible, télégraphie son tir (œil qui s'allume), tire.
import * as THREE from 'three';
import { clamp, lerp, angleDelta } from './util.js';
import { ARENA_R } from './arena.js';

export const DROID_HP = 40;
export const BOLT_SPEED = 20;
export const BOLT_DMG = 8;

export class Droid {
  constructor(id, rnd) {
    this.id = id;
    this.x = 0; this.z = 0;
    this.hover = 1.25;
    this.yaw = 0;
    this.hp = DROID_HP;
    this.alive = true;
    this.deadT = 0;

    // IA
    this.rnd = rnd;
    this.orbitDir = rnd() < .5 ? 1 : -1;
    this.cool = 2.2 + rnd() * 2;    // délai de grâce avant la première visée
    this.aimT = 0;                  // >0 : télégraphie le tir
    this.retargetT = 0;
    this.target = null;
    this.wobble = rnd() * 10;

    // interpolation réseau (clients non-hôtes)
    this.snaps = [];

    this._build();
  }

  _build() {
    this.group = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x8a929c });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(.42, 10, 8), metal);
    body.scale.y = .8;
    const belly = new THREE.Mesh(new THREE.CylinderGeometry(.3, .18, .3, 8), dark);
    belly.position.y = -.32;

    // œil : s'allume pendant la visée
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x661111 });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.1, 8, 6), this.eyeMat);
    eye.position.set(0, .05, .38);

    // canon
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, .5, 6), dark);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(.22, -.12, .3);

    // antenne
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .35, 4), dark);
    ant.position.set(-.15, .45, 0);
    const antTip = new THREE.Mesh(new THREE.SphereGeometry(.04, 6, 4), this.eyeMat);
    antTip.position.set(-.15, .63, 0);

    // petits ailerons
    for (const sx of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(.3, .08, .18), metal);
      fin.position.set(sx * .5, 0, -.1);
      fin.rotation.z = sx * .3;
      this.group.add(fin);
    }

    this.group.add(body, belly, eye, gun, ant, antTip);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(.4, 10),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .25, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    this.shadow = shadow;
    this.group.add(shadow);
  }

  spawnAt(x, z) {
    this.x = x; this.z = z;
    this.hp = DROID_HP;
    this.alive = true;
    this.deadT = 0;
    this.group.visible = true;
    this.syncVisual(0);
  }

  get muzzle() {
    return { x: this.x + Math.sin(this.yaw) * .4, y: this.hover, z: this.z + Math.cos(this.yaw) * .4 };
  }

  // ——— IA (hôte / solo). fighters = combattants vivants. Renvoie éventuellement {shoot:{...}}
  think(dt, fighters, droids) {
    if (!this.alive) return null;
    this.retargetT -= dt;
    if (!this.target || !this.target.alive || this.retargetT <= 0) {
      this.retargetT = 2 + this.rnd() * 2;
      let best = null, bd = 1e9;
      for (const f of fighters) {
        if (!f.alive) continue;
        const d = Math.hypot(f.x - this.x, f.z - this.z);
        if (d < bd) { bd = d; best = f; }
      }
      this.target = best;
    }
    const t = this.target;
    let out = null;

    if (t) {
      const dx = t.x - this.x, dz = t.z - this.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.yaw += angleDelta(this.yaw, Math.atan2(dx, dz)) * clamp(dt * 5, 0, 1);

      // orbite : garde ses distances
      let mx = 0, mz = 0;
      const want = 10;
      const radial = clamp((dist - want) * .4, -1, 1);
      mx += dx / dist * radial; mz += dz / dist * radial;
      // tangentiel
      mx += -dz / dist * this.orbitDir * .6;
      mz += dx / dist * this.orbitDir * .6;
      if (this.rnd() < dt * .15) this.orbitDir *= -1;
      // évite les copains
      for (const d of droids) {
        if (d === this || !d.alive) continue;
        const ax = this.x - d.x, az = this.z - d.z;
        const ad = Math.hypot(ax, az);
        if (ad < 2.5 && ad > .01) { mx += ax / ad * .8; mz += az / ad * .8; }
      }
      const sp = 4.2;
      this.x += mx * sp * dt;
      this.z += mz * sp * dt;
      const r = Math.hypot(this.x, this.z);
      if (r > ARENA_R - .5) { this.x *= (ARENA_R - .5) / r; this.z *= (ARENA_R - .5) / r; }

      // tir : visée télégraphiée puis bolt
      if (this.aimT > 0) {
        this.aimT -= dt;
        if (this.aimT <= 0) {
          this.cool = 2 + this.rnd() * 2.2;
          const m = this.muzzle;
          // vise le torse, avec un peu d'anticipation et pas mal d'imprécision
          const lead = clamp(dist / BOLT_SPEED, 0, .8);
          const ax = t.x + t.vx * lead + (this.rnd() - .5) * 2.6;
          const az = t.z + t.vz * lead + (this.rnd() - .5) * 2.6;
          const ay = 1.2 + t.y + (this.rnd() - .5) * .6;
          const dl = Math.hypot(ax - m.x, ay - m.y, az - m.z) || 1;
          out = { shoot: { x: m.x, y: m.y, z: m.z, dx: (ax - m.x) / dl, dy: (ay - m.y) / dl, dz: (az - m.z) / dl } };
        }
      } else {
        this.cool -= dt;
        if (this.cool <= 0 && dist < 17) this.aimT = .65;
      }
    }
    this.syncVisual(dt);
    return out;
  }

  takeDamage(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deadT = 0;
      return true; // vient de mourir
    }
    return false;
  }

  // ——— réseau ———
  snapshot() {
    return {
      i: this.id, x: +this.x.toFixed(2), z: +this.z.toFixed(2),
      h: +this.yaw.toFixed(2), hp: this.hp | 0, a: this.aimT > 0 ? 1 : 0,
      al: this.alive ? 1 : 0,
    };
  }

  pushSnapshot(s, now) {
    this.snaps.push({ t: now, ...s });
    if (this.snaps.length > 10) this.snaps.shift();
  }

  interpolate(now) {
    const buf = this.snaps;
    if (!buf.length) return;
    const rt = now - .12;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= rt) { a = buf[i]; b = buf[Math.min(i + 1, buf.length - 1)]; break; }
    }
    const f = (b.t > a.t) ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    this.x = lerp(a.x, b.x, f);
    this.z = lerp(a.z, b.z, f);
    this.yaw = a.h + angleDelta(a.h, b.h) * f;
    this.hp = b.hp;
    this.aimT = b.a ? .3 : 0;
    if (this.alive && !b.al) { this.alive = false; this.deadT = 0; }
    else if (b.al) this.alive = true;
    this.syncVisual(0);
  }

  syncVisual(dt) {
    this.wobble += dt * 3;
    const y = this.alive ? this.hover + Math.sin(this.wobble) * .12 : Math.max(0.2, this.hover - this.deadT * 4);
    this.group.position.set(this.x, y, this.z);
    this.group.rotation.y = this.yaw;
    this.shadow.position.y = -y + .04;
  }

  updateVisuals(dt) {
    if (!this.alive) {
      this.deadT += dt;
      this.group.rotation.z += dt * 6;
      this.group.rotation.x += dt * 3;
      this.syncVisual(0);
      if (this.deadT > .6) this.group.visible = false;
      return;
    }
    // œil rouge vif pendant la visée
    this.eyeMat.color.setHex(this.aimT > 0 ? 0xff2020 : 0x661111);
  }
}
