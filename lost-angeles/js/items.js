// Les 8 objets des caisses + simulation des projectiles/pièges.
// Règle réseau : chaque machine simule tout visuellement, mais n'applique les dégâts
// qu'aux karts qu'elle possède (son joueur + les IA si elle est hôte).
import * as THREE from 'three';
import { clamp } from './util.js';

export const ITEM_DEFS = {
  nitro:   { icon: '🔥', name: 'Nitro' },
  missile: { icon: '🚀', name: 'Missile téléguidé' },
  spear:   { icon: '🗡️', name: 'Lance explosive' },
  nails:   { icon: '📌', name: 'Clous' },
  saw:     { icon: '🪚', name: 'Scies latérales' },
  grap:    { icon: '🪝', name: 'Grappin' },
  poop:    { icon: '💩', name: 'Bombe de caca' },
  armor:   { icon: '🛡️', name: 'Blindage' },
};

// tirage pondéré selon le rang (1 = premier) — les derniers ont les meilleurs objets
const LOOT = [
  /* rangs 1-2 */ [['nails', 30], ['saw', 28], ['poop', 22], ['spear', 20]],
  /* rangs 3-4 */ [['spear', 24], ['nails', 18], ['saw', 14], ['nitro', 16], ['grap', 18], ['poop', 10]],
  /* rangs 5-6 */ [['nitro', 26], ['grap', 22], ['spear', 14], ['armor', 16], ['missile', 10], ['saw', 12]],
  /* rangs 7-8 */ [['nitro', 30], ['armor', 25], ['missile', 20], ['grap', 25]],
];

export function rollItem(rank, rnd = Math.random) {
  const table = LOOT[clamp(Math.ceil(rank / 2) - 1, 0, 3)];
  const total = table.reduce((s, e) => s + e[1], 0);
  let r = rnd() * total;
  for (const [id, w] of table) { r -= w; if (r <= 0) return id; }
  return table[0][0];
}

// ——— meshes des projectiles ———
function missileMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, 1.7, 8), new THREE.MeshLambertMaterial({ color: 0xc22222 }));
  body.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.28, .6, 8), new THREE.MeshLambertMaterial({ color: 0x8f989f }));
  tip.rotation.x = Math.PI / 2; tip.position.z = 1.15;
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(.06, .45, .5), new THREE.MeshLambertMaterial({ color: 0x8f989f }));
    const a = i * Math.PI / 2;
    fin.position.set(Math.cos(a) * .3, Math.sin(a) * .3, -.8);
    fin.rotation.z = a;
    g.add(fin);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(.22, .9, 6),
    new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.x = -Math.PI / 2; flame.position.z = -1.3;
  g.add(body, tip, flame);
  g.userData.flame = flame;
  return g;
}

function spearMesh() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x7d5a33 }));
  shaft.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.2, .7, 6), new THREE.MeshLambertMaterial({ color: 0xd0d6dc }));
  tip.rotation.x = Math.PI / 2; tip.position.z = 1.55;
  const charge = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5030 }));
  charge.position.z = 1.1;
  g.add(shaft, tip, charge);
  return g;
}

function nailsMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, .16, 10), new THREE.MeshLambertMaterial({ color: 0x2c2620 }));
  base.position.y = .08;
  g.add(base);
  for (let i = 0; i < 7; i++) {
    const n = new THREE.Mesh(new THREE.ConeGeometry(.09, .55, 5), new THREE.MeshLambertMaterial({ color: 0xc9ced4 }));
    const a = i / 7 * Math.PI * 2;
    n.position.set(Math.cos(a) * .7, .4, Math.sin(a) * .7);
    n.rotation.set((Math.random() - .5) * .5, 0, (Math.random() - .5) * .5);
    g.add(n);
  }
  return g;
}

export class ItemWorld {
  // hooks : { ownedKarts(), allKarts(), kartBySlot(slot), localSlot(), emit(evt), sfx(name), splat(), toast(txt) }
  constructor(scene, track, hooks) {
    this.scene = scene;
    this.track = track;
    this.h = hooks;
    this.projectiles = [];
    this.nails = [];
    this.fx = [];
    this.counter = 0;
  }

  nextId(slot) { return slot * 1000 + (this.counter++); }

  // utilisé par le kart local et par l'hôte pour ses IA ; broadcast automatique
  // opts: { backward } — lance tirée vers l'arrière (rétroviseur)
  use(kart, itemId, opts) {
    const evt = this._apply(kart, itemId, null, opts);
    if (evt) this.h.emit(evt);
  }

  onRemote(evt) { this._apply(this.h.kartBySlot(evt.s), evt.k === 'nailhit' ? null : evt.k, evt); }

  _apply(kart, itemId, remote, opts) {
    if (remote && remote.k === 'nailhit') { this.removeNails(remote.id); return null; }
    if (!kart && !remote) return null;

    switch (itemId) {
      case 'nitro': {
        if (!remote) { kart.startBoost(2.2, 1.35); this.h.sfx('boost'); return { k: 'nitro', s: kart.slot }; }
        this.h.sfx('boost'); return null; // le boost visuel arrive via l'état réseau
      }
      case 'armor': {
        if (!remote) { kart.startArmor(5.5); this.h.sfx('armor'); return { k: 'armor', s: kart.slot }; }
        this.h.sfx('armor'); return null;
      }
      case 'saw': {
        if (!remote) { kart.startSaw(6.5); this.h.sfx('saw'); return { k: 'saw', s: kart.slot }; }
        this.h.sfx('saw'); return null;
      }
      case 'missile': {
        let target = null, best = 1e18;
        for (const k of this.h.allKarts()) { // vise le premier
          if (k.finished) continue;
          if (k.rank < best) { best = k.rank; target = k; }
        }
        const data = remote || {
          k: 'missile', s: kart.slot, id: this.nextId(kart.slot),
          f: kart.lastF + 3, lat: clamp(kart.lat, -5, 5), t: target ? target.slot : -1,
        };
        this._spawnProjectile('missile', data);
        this.h.sfx('missile');
        this.h.toast(`🚀 Missile lancé sur ${target ? target.name : '???'} !`);
        return remote ? null : data;
      }
      case 'spear': {
        // tir rectiligne (pas de guidage), vers l'arrière si rétroviseur actif
        const data = remote || (() => {
          const h = kart.heading + (opts && opts.backward ? Math.PI : 0);
          return {
            k: 'spear', s: kart.slot, id: this.nextId(kart.slot),
            x: +(kart.x + Math.sin(h) * 2.6).toFixed(1),
            z: +(kart.z + Math.cos(h) * 2.6).toFixed(1),
            h: +h.toFixed(3),
          };
        })();
        this._spawnSpear(data);
        this.h.sfx('spear');
        return remote ? null : data;
      }
      case 'nails': {
        const data = remote || (() => {
          const bx = kart.x - kart.dirX() * 3.4, bz = kart.z - kart.dirZ() * 3.4;
          return { k: 'nails', s: kart.slot, id: this.nextId(kart.slot), x: +bx.toFixed(1), z: +bz.toFixed(1) };
        })();
        const mesh = nailsMesh();
        mesh.position.set(data.x, 0, data.z);
        this.scene.add(mesh);
        this.nails.push({ id: data.id, x: data.x, z: data.z, mesh, life: 40 });
        if (!remote) this.h.sfx('drop');
        return remote ? null : data;
      }
      case 'grap': {
        const RANGE = 38; // portée du grappin (ligne droite devant le kart)
        if (!remote) {
          // tir tout droit : accroche le kart le plus proche dans l'axe, sinon raté
          const dx = kart.dirX(), dz = kart.dirZ();
          let target = null, bestAlong = Infinity;
          for (const k of this.h.allKarts()) {
            if (k === kart || k.finished) continue;
            const rx = k.x - kart.x, rz = k.z - kart.z;
            const along = rx * dx + rz * dz;          // distance le long du tir
            if (along < 2 || along > RANGE) continue;
            const perp = Math.abs(rx * dz - rz * dx); // écart latéral au fil
            if (perp < 3 && along < bestAlong) { target = k; bestAlong = along; }
          }
          if (!target) {
            // le crochet part dans le vide et revient
            this._grapVfx(kart.x, kart.z, kart.x + dx * RANGE, kart.z + dz * RANGE);
            this.h.sfx('drop');
            return { k: 'grap', s: kart.slot, t: -1 };
          }
          this._grapVfx(kart.x, kart.z, target.x, target.z);
          // téléportation juste derrière la cible accrochée
          kart.x = target.x - target.dirX() * (target.radius + kart.radius + 1.2);
          kart.z = target.z - target.dirZ() * (target.radius + kart.radius + 1.2);
          kart.heading = target.heading;
          kart.speed = Math.max(kart.speed, target.speed * 1.05);
          const proj = this.track.project(kart.x, kart.z, target.hintIdx);
          kart.hintIdx = proj.idx; kart.lastF = proj.f;
          // recale la progression sur celle de la cible (dents de scie évitées)
          kart.totalProgress = target.totalProgress - (target.radius + kart.radius + 1.2) / this.track.segLen;
          kart.startBoost(.8, 1.25);
          this.h.sfx('grap');
          return { k: 'grap', s: kart.slot, t: target.slot };
        }
        const a = this.h.kartBySlot(remote.s);
        if (a) {
          const b = remote.t >= 0 ? this.h.kartBySlot(remote.t) : null;
          const ex = b ? b.x : a.x + a.dirX() * RANGE;
          const ez = b ? b.z : a.z + a.dirZ() * RANGE;
          this._grapVfx(a.x, a.z, ex, ez);
        }
        this.h.sfx(remote.t >= 0 ? 'grap' : 'drop');
        return null;
      }
      case 'poop': {
        if (!remote) {
          const targets = this.h.allKarts().filter(k => k.rank < kart.rank).map(k => k.slot);
          if (!targets.length) return null;
          const evt = { k: 'poop', s: kart.slot, ts: targets };
          this._applyPoop(evt);
          this.h.sfx('poop');
          this.h.toast('💩 La foule bombarde les leaders !');
          return evt;
        }
        this._applyPoop(remote);
        this.h.sfx('poop');
        return null;
      }
    }
    return null;
  }

  _applyPoop(evt) {
    for (const slot of evt.ts) {
      if (slot === this.h.localSlot()) this.h.splat();
      const k = this.h.kartBySlot(slot);
      if (k && k.kind === 'ai') k.poopT = 4.5;
    }
  }

  _grapVfx(x1, z1, x2, z2) {
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, 1.2, z1), new THREE.Vector3(x2, 1.2, z2)]);
    g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true })));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.3, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xd0d6dc, transparent: true }));
    tip.position.set(x2, 1.2, z2);
    g.add(tip);
    this.scene.add(g);
    this.fx.push({ kind: 'line', mesh: g, life: .4, maxLife: .4 });
  }

  _spawnProjectile(kind, data) {
    const mesh = kind === 'missile' ? missileMesh() : spearMesh();
    this.scene.add(mesh);
    this.projectiles.push({
      kind, id: data.id, owner: data.s, target: data.t,
      f: data.f, lat: data.lat, mesh, life: 14,
      speed: 64,
    });
  }

  // lance : ligne droite en coordonnées monde, portée limitée (~90 u)
  _spawnSpear(data) {
    const mesh = spearMesh();
    mesh.position.set(data.x, 1.0, data.z);
    mesh.rotation.y = data.h;
    this.scene.add(mesh);
    const o = this.h.kartBySlot(data.s);
    this.projectiles.push({
      kind: 'spear', id: data.id, owner: data.s,
      x: data.x, z: data.z, h: data.h, hint: o ? o.hintIdx : 0,
      mesh, life: 1.5, speed: 60,
    });
  }

  removeNails(id) {
    const i = this.nails.findIndex(n => n.id === id);
    if (i >= 0) { this.scene.remove(this.nails[i].mesh); this.nails.splice(i, 1); }
  }

  explode(x, z, radius, big) {
    // visuel
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }));
    ball.position.set(x, 1.2, z);
    this.scene.add(ball);
    this.fx.push({ kind: 'boom', mesh: ball, life: .55, maxLife: .55, radius });
    this.h.sfx(big ? 'boomBig' : 'boom');
    // dégâts sur les karts possédés localement
    for (const k of this.h.ownedKarts()) {
      const d = Math.hypot(k.x - x, k.z - z);
      if (d < radius && k.blast()) { /* le kart broadcast son état tout seul */ }
    }
  }

  crateBurst(x, y, z) {
    const g = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(.35, .35, .35), new THREE.MeshLambertMaterial({ color: 0x9a713d }));
      p.position.set(x, y, z);
      p.userData.vel = new THREE.Vector3((Math.random() - .5) * 9, 4 + Math.random() * 5, (Math.random() - .5) * 9);
      p.userData.rot = new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0);
      g.add(p);
    }
    this.scene.add(g);
    this.fx.push({ kind: 'burst', mesh: g, life: .9, maxLife: .9 });
  }

  update(dt) {
    const track = this.track;

    // projectiles : missile guidé le long de la piste, lance en ligne droite
    for (const p of this.projectiles) {
      if (!p.mesh.parent) continue;
      p.life -= dt;
      let x, z, boom = false;

      if (p.kind === 'spear') {
        // tout droit, explose sur un kart, un mur ou en bout de course
        p.x += Math.sin(p.h) * p.speed * dt;
        p.z += Math.cos(p.h) * p.speed * dt;
        x = p.x; z = p.z;
        p.mesh.position.set(x, 1.0, z);
        p.mesh.rotation.z += dt * 6;
        const proj = track.project(x, z, p.hint);
        p.hint = proj.idx;
        if (Math.abs(proj.lat) > track.wallDist - .5) boom = true; // mur de tôle
        for (const k of this.h.allKarts()) {
          if (k.slot === p.owner || k.finished) continue;
          if (Math.hypot(k.x - x, k.z - z) < 2.2) { boom = true; break; }
        }
      } else {
        const target = p.target >= 0 ? this.h.kartBySlot(p.target) : null;
        // avance le long de la piste
        p.f += (p.speed / track.segLen) * dt;
        if (target && !target.finished) {
          // se rabat sur l'écart latéral de la cible
          const tl = clamp(target.lat, -track.halfW, track.halfW);
          p.lat += clamp(tl - p.lat, -6 * dt, 6 * dt);
        }
        const pos = track.posAt(p.f);
        const l = track.leftAt(p.f);
        x = pos.x + l.x * p.lat; z = pos.z + l.z * p.lat;
        p.mesh.position.set(x, 1.6 + Math.sin(p.life * 9) * .2, z);
        p.mesh.rotation.y = track.headingAt(p.f);
        if (p.mesh.userData.flame) p.mesh.userData.flame.scale.set(1, .7 + Math.random() * .6, 1);

        if (target && !target.finished) {
          if (Math.hypot(target.x - x, target.z - z) < 2.6) boom = true;
        } else {
          // sans cible : explose au contact de n'importe quel kart (sauf le tireur)
          for (const k of this.h.allKarts()) {
            if (k.slot === p.owner || k.finished) continue;
            if (Math.hypot(k.x - x, k.z - z) < 2.2) { boom = true; break; }
          }
        }
      }
      if (p.life <= 0) boom = true;
      if (boom) {
        this.explode(x, z, p.kind === 'missile' ? 9 : 4.5, p.kind === 'missile');
        this.scene.remove(p.mesh);
      }
    }
    this.projectiles = this.projectiles.filter(p => p.mesh.parent);

    // clous
    for (const n of this.nails) {
      n.life -= dt;
      if (n.life <= 0) { this.scene.remove(n.mesh); continue; }
      for (const k of this.h.ownedKarts()) {
        if (Math.abs(k.y) > .5 || k.finished) continue;
        if (Math.hypot(k.x - n.x, k.z - n.z) < 2.0 && k.spinOut()) {
          this.h.sfx('spin');
          this.scene.remove(n.mesh);
          this.h.emit({ k: 'nailhit', id: n.id, s: k.slot });
          break;
        }
      }
    }
    this.nails = this.nails.filter(n => n.mesh.parent);

    // scies : tout kart avec l'effet actif cogne les karts possédés voisins
    for (const attacker of this.h.allKarts()) {
      if (attacker.sawT <= 0 || attacker.finished) continue;
      for (const k of this.h.ownedKarts()) {
        if (k === attacker || k.finished) continue;
        const d = Math.hypot(k.x - attacker.x, k.z - attacker.z);
        if (d < attacker.radius + 2.6 && k.vulnerable) {
          // éjection latérale + tête-à-queue
          const nx = (k.x - attacker.x) / (d || 1), nz = (k.z - attacker.z) / (d || 1);
          k.x += nx * 2.2; k.z += nz * 2.2;
          k.spinOut();
          this.h.sfx('sawHit');
        }
      }
    }

    // effets visuels temporaires
    for (const f of this.fx) {
      f.life -= dt;
      const t = 1 - f.life / f.maxLife;
      if (f.kind === 'boom') {
        const s = 1 + t * (f.radius * .85);
        f.mesh.scale.set(s, s, s);
        f.mesh.material.opacity = .95 * (1 - t);
      } else if (f.kind === 'burst') {
        for (const p of f.mesh.children) {
          p.position.addScaledVector(p.userData.vel, dt);
          p.userData.vel.y -= 18 * dt;
          p.rotation.x += p.userData.rot.x * dt;
          p.rotation.y += p.userData.rot.y * dt;
        }
      } else if (f.kind === 'line') {
        for (const c of f.mesh.children) c.material.opacity = 1 - t;
      }
      if (f.life <= 0) this.scene.remove(f.mesh);
    }
    this.fx = this.fx.filter(f => f.life > 0);
  }

  dispose() {
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const n of this.nails) this.scene.remove(n.mesh);
    for (const f of this.fx) this.scene.remove(f.mesh);
    this.projectiles = []; this.nails = []; this.fx = [];
  }
}
