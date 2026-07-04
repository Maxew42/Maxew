// Le Colisée : arène circulaire de sable, mur d'enceinte, gradins étagés,
// foule instanciée, arcade à colonnes. Géométrie 100 % procédurale, pensée mobile
// (InstancedMesh, 2 lumières, aucune texture externe).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export const ARENA_R = 21;      // rayon jouable (clamp des combattants)
const WALL_R = 23;              // mur d'enceinte

function sandTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9a25f';
  g.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(7);
  for (let i = 0; i < 2600; i++) {
    const v = 150 + rnd() * 90;
    g.fillStyle = `rgba(${v},${v * .78 | 0},${v * .45 | 0},${.25 + rnd() * .4})`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // traces circulaires d'anciens combats
  g.strokeStyle = 'rgba(120,90,50,.18)';
  for (let i = 0; i < 6; i++) {
    g.lineWidth = 2 + rnd() * 5;
    g.beginPath();
    g.arc(128, 128, 25 + rnd() * 100, rnd() * 7, rnd() * 7);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

function stoneMat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

export class Arena {
  constructor() {
    this.group = new THREE.Group();
    this.radius = ARENA_R;
    const rnd = mulberry32(42);

    // ——— sol de sable ———
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(WALL_R + .5, 48),
      new THREE.MeshLambertMaterial({ map: sandTexture() })
    );
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    // cercle central décoratif
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.2, 3.5, 40),
      new THREE.MeshBasicMaterial({ color: 0x9a7440, transparent: true, opacity: .55 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .02;
    this.group.add(ring);

    // ——— mur d'enceinte ———
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(WALL_R, WALL_R, 5, 48, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xb8a184, side: THREE.DoubleSide })
    );
    wall.position.y = 2.5;
    this.group.add(wall);

    // corniche au sommet du mur
    const cornice = new THREE.Mesh(
      new THREE.TorusGeometry(WALL_R + .2, .35, 6, 48),
      stoneMat(0xcbb597)
    );
    cornice.rotation.x = Math.PI / 2;
    cornice.position.y = 5;
    this.group.add(cornice);

    // ——— portes (4 points cardinaux) — les droïdes en surgissent ———
    this.gates = [];
    const gateMat = new THREE.MeshBasicMaterial({ color: 0x14100c });
    const frameMat = stoneMat(0x8f7a5e);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const gx = Math.sin(a) * (WALL_R - .3), gz = Math.cos(a) * (WALL_R - .3);
      const gate = new THREE.Group();
      const hole = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4, .5), gateMat);
      hole.position.y = 2;
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, .5, 12, 1, false, 0, Math.PI), frameMat);
      arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2;
      arch.position.y = 4;
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(.7, 4.6, .9), frameMat);
      p1.position.set(-2.05, 2.3, 0);
      const p2 = p1.clone(); p2.position.x = 2.05;
      gate.add(hole, arch, p1, p2);
      gate.position.set(gx, 0, gz);
      gate.lookAt(0, 0, 0);
      this.group.add(gate);
      this.gates.push({ x: Math.sin(a) * (ARENA_R - 1.5), z: Math.cos(a) * (ARENA_R - 1.5), angle: a });
    }

    // ——— gradins étagés + foule ———
    const standMat = stoneMat(0xc4ae8e);
    const crowdSeats = [];
    let r0 = WALL_R + .4, y0 = 5;
    for (let step = 0; step < 5; step++) {
      const r1 = r0 + 2.6;
      // marche horizontale
      const tread = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), standMat);
      tread.rotation.x = -Math.PI / 2;
      tread.position.y = y0;
      this.group.add(tread);
      // contremarche
      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(r1, r1, 1.5, 48, 1, true),
        new THREE.MeshLambertMaterial({ color: 0xa892728 & 0xffffff, side: THREE.DoubleSide })
      );
      riser.material.color.setHex(0xa89272);
      riser.position.y = y0 + .75;
      this.group.add(riser);
      // places assises pour la foule
      const n = 40 + step * 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * .1;
        if (rnd() < .25) continue; // sièges vides
        crowdSeats.push({ x: Math.sin(a) * (r0 + 1.3), y: y0 + .55, z: Math.cos(a) * (r0 + 1.3), a });
      }
      r0 = r1; y0 += 1.5;
    }

    // foule : boîtes instanciées, couleurs variées, léger balancement global
    const crowdGeo = new THREE.BoxGeometry(.55, 1.0, .45);
    const crowdMat = new THREE.MeshLambertMaterial();
    this.crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdSeats.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const palette = [0x8a4a3a, 0x5a6a8a, 0x7a6a3a, 0x4a6a4a, 0x6a4a6a, 0x9a8a6a, 0x3a5a6a];
    crowdSeats.forEach((s, i) => {
      m4.makeRotationY(s.a + Math.PI);
      m4.setPosition(s.x, s.y, s.z);
      this.crowd.setMatrixAt(i, m4);
      col.setHex(palette[(rnd() * palette.length) | 0]).offsetHSL(0, 0, (rnd() - .5) * .15);
      this.crowd.setColorAt(i, col);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
    this.group.add(this.crowd);

    // têtes de la foule (sphères instanciées)
    const headGeo = new THREE.SphereGeometry(.16, 6, 5);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xd8b090 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, crowdSeats.length);
    crowdSeats.forEach((s, i) => {
      m4.makeRotationY(s.a);
      m4.setPosition(s.x, s.y + .68, s.z);
      heads.setMatrixAt(i, m4);
    });
    this.group.add(heads);

    // ——— arcade sommitale : colonnes + linteau ———
    const colR = r0 + .8;
    const nCols = 28;
    const colGeo = new THREE.CylinderGeometry(.45, .55, 5, 8);
    const colInst = new THREE.InstancedMesh(colGeo, stoneMat(0xd3c0a4), nCols);
    for (let i = 0; i < nCols; i++) {
      const a = (i / nCols) * Math.PI * 2;
      m4.makeRotationY(0);
      m4.setPosition(Math.sin(a) * colR, y0 + 2.5, Math.cos(a) * colR);
      colInst.setMatrixAt(i, m4);
    }
    this.group.add(colInst);
    const lintel = new THREE.Mesh(new THREE.TorusGeometry(colR, .6, 6, 48), stoneMat(0xc9b697));
    lintel.rotation.x = Math.PI / 2;
    lintel.position.y = y0 + 5.2;
    this.group.add(lintel);

    // bannières sur le mur intérieur
    const banMat = new THREE.MeshLambertMaterial({ color: 0x7a1f1f, side: THREE.DoubleSide });
    const banMat2 = new THREE.MeshLambertMaterial({ color: 0x1f3a7a, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.2), i % 2 ? banMat : banMat2);
      ban.position.set(Math.sin(a) * (WALL_R - .35), 3.1, Math.cos(a) * (WALL_R - .35));
      ban.lookAt(0, 3.1, 0);
      this.group.add(ban);
    }

    // ——— poussière en suspension ———
    const dustN = 120;
    const dustPos = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * ARENA_R;
      dustPos[i * 3] = Math.sin(a) * r;
      dustPos[i * 3 + 1] = .3 + rnd() * 6;
      dustPos[i * 3 + 2] = Math.cos(a) * r;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0xe8d0a0, size: .07, transparent: true, opacity: .5, depthWrite: false,
    }));
    this.group.add(this.dust);
  }

  // point d'apparition du joueur `i` parmi `n`, en cercle autour du centre
  spawnPoint(i, n) {
    const a = (i / Math.max(n, 1)) * Math.PI * 2;
    const r = Math.min(6 + n * 1.2, 14);
    return { x: Math.sin(a) * r, z: Math.cos(a) * r, yaw: a + Math.PI }; // face au centre
  }

  // porte d'apparition de droïde
  gateSpawn(rnd01) {
    const g = this.gates[(rnd01 * this.gates.length) | 0];
    return { x: g.x, z: g.z };
  }

  update(dt, time) {
    // poussière qui dérive lentement
    this.dust.rotation.y += dt * .01;
    // la foule « respire »
    this.crowd.position.y = Math.sin(time * 2.1) * .03;
  }
}
