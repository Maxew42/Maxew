'use strict';

// =================== CONSTANTES ===================
const WORLD_W = 2400, WORLD_H = 1800;
const WALL = 70;              // épaisseur des plans de travail (bordure infranchissable)
const MAX_ENEMIES = 350;
const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

let VW = innerWidth, VH = innerHeight;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const adiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// =================== RENDU 3D : BASE ===================
const glCanvas = document.getElementById('game');
const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.setClearColor(0x171310);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, VW / VH, 10, 5000);
const CAM_H = 700, CAM_ZOFF = 500;

function resize() {
  VW = innerWidth; VH = innerHeight;
  renderer.setSize(VW, VH);
  camera.aspect = VW / VH;
  camera.updateProjectionMatrix();
  hud.width = VW; hud.height = VH;
}
addEventListener('resize', resize);
resize();

scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xfff2e0, 0.6);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);

// matériau partagé : toutes les géométries fusionnées utilisent des couleurs de sommets
const matV = new THREE.MeshLambertMaterial({ vertexColors: true });

// fusionne des primitives colorées en une seule géométrie
const _mm = new THREE.Matrix4(), _mq = new THREE.Quaternion(), _me = new THREE.Euler();
function mergeParts(parts) {
  const positions = [], normals = [], colors = [];
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.toNonIndexed();
    _me.set(p.rx || 0, p.ry || 0, p.rz || 0);
    _mq.setFromEuler(_me);
    _mm.compose(
      new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0),
      _mq,
      new THREE.Vector3(p.sx || 1, p.sy || 1, p.sz || 1)
    );
    g.applyMatrix4(_mm);
    c.set(p.color);
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
    g.dispose();
    p.geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}
const sph = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const cylG = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const coneG = (r, h) => new THREE.ConeGeometry(r, h, 8);
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// =================== DÉCOR : LA CUISINE (NIVEAU 1) ===================
const kitchenGroup = (function buildKitchen() {
  const grp = new THREE.Group();
  let seed = 1337;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // sol carrelé (texture peinte)
  const fc = document.createElement('canvas');
  fc.width = 1200; fc.height = 900;
  const b = fc.getContext('2d');
  const T = 40; // 40 px = 80 unités monde
  for (let y = 0; y < fc.height / T; y++) {
    for (let x = 0; x < fc.width / T; x++) {
      b.fillStyle = (x + y) % 2 ? '#e8ddc8' : '#d9cbae';
      b.fillRect(x * T, y * T, T, T);
    }
  }
  b.strokeStyle = 'rgba(90,70,40,0.18)';
  b.lineWidth = 1;
  for (let x = 0; x <= fc.width; x += T) { b.beginPath(); b.moveTo(x, 0); b.lineTo(x, fc.height); b.stroke(); }
  for (let y = 0; y <= fc.height; y += T) { b.beginPath(); b.moveTo(0, y); b.lineTo(fc.width, y); b.stroke(); }
  for (let i = 0; i < 55; i++) {
    b.fillStyle = `rgba(110,80,35,${0.04 + rnd() * 0.06})`;
    b.beginPath();
    b.ellipse(rnd() * fc.width, rnd() * fc.height, 8 + rnd() * 22, 5 + rnd() * 15, rnd() * TAU, 0, TAU);
    b.fill();
  }
  const floorTex = new THREE.CanvasTexture(fc);
  floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -HALF_PI;
  floor.position.set(WORLD_W / 2, 0, WORLD_H / 2);
  grp.add(floor);

  // sol sombre au-delà de la cuisine
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: 0x241c14 }));
  outer.rotation.x = -HALF_PI;
  outer.position.set(WORLD_W / 2, -1, WORLD_H / 2);
  grp.add(outer);

  const parts = [];
  const steel = '#9aa5b1', steelDark = '#7d8994', wallC = '#6d4c41';
  // plans de travail (bordure)
  parts.push({ geo: boxG(WORLD_W, 55, WALL), color: steel, x: WORLD_W / 2, y: 27.5, z: WALL / 2 });
  parts.push({ geo: boxG(WORLD_W, 55, WALL), color: steel, x: WORLD_W / 2, y: 27.5, z: WORLD_H - WALL / 2 });
  parts.push({ geo: boxG(WALL, 55, WORLD_H), color: steel, x: WALL / 2, y: 27.5, z: WORLD_H / 2 });
  parts.push({ geo: boxG(WALL, 55, WORLD_H), color: steel, x: WORLD_W - WALL / 2, y: 27.5, z: WORLD_H / 2 });
  // plinthe sombre
  parts.push({ geo: boxG(WORLD_W - 2 * WALL, 12, 6), color: steelDark, x: WORLD_W / 2, y: 6, z: WALL + 3 });
  parts.push({ geo: boxG(WORLD_W - 2 * WALL, 12, 6), color: steelDark, x: WORLD_W / 2, y: 6, z: WORLD_H - WALL - 3 });
  parts.push({ geo: boxG(6, 12, WORLD_H - 2 * WALL), color: steelDark, x: WALL + 3, y: 6, z: WORLD_H / 2 });
  parts.push({ geo: boxG(6, 12, WORLD_H - 2 * WALL), color: steelDark, x: WORLD_W - WALL - 3, y: 6, z: WORLD_H / 2 });
  // murs extérieurs
  parts.push({ geo: boxG(WORLD_W + 40, 140, 20), color: wallC, x: WORLD_W / 2, y: 70, z: -10 });
  parts.push({ geo: boxG(WORLD_W + 40, 140, 20), color: wallC, x: WORLD_W / 2, y: 70, z: WORLD_H + 10 });
  parts.push({ geo: boxG(20, 140, WORLD_H + 40), color: wallC, x: -10, y: 70, z: WORLD_H / 2 });
  parts.push({ geo: boxG(20, 140, WORLD_H + 40), color: wallC, x: WORLD_W + 10, y: 70, z: WORLD_H / 2 });
  // plaques de cuisson au nord
  for (let x = 220; x < WORLD_W - 200; x += 300) {
    parts.push({ geo: cylG(20, 20, 3, 14), color: '#37474f', x, y: 56.5, z: WALL / 2 });
    parts.push({ geo: cylG(12, 12, 1.5, 12), color: '#212a30', x, y: 58.5, z: WALL / 2 });
  }
  // accessoires posés sur les plans de travail
  const propMakers = [
    (x, z) => [ // planche à découper
      { geo: boxG(42, 4, 26), color: '#a9825a', x, y: 57, z },
      { geo: boxG(14, 6, 4), color: '#e53935', x: x - 6, y: 61, z },
      { geo: boxG(12, 5, 4), color: '#e53935', x: x + 9, y: 60.5, z: z + 4 },
    ],
    (x, z) => [ // marmite
      { geo: cylG(15, 14, 16, 12), color: '#455a64', x, y: 63, z },
      { geo: cylG(15.5, 15.5, 2, 12), color: '#37474f', x, y: 71.5, z },
      { geo: sph(2.6), color: '#212a30', x, y: 74, z },
    ],
    (x, z) => [ // tomates
      { geo: sph(6.5), color: '#d84335', x, y: 60, z },
      { geo: sph(5.8), color: '#e53935', x: x + 10, y: 59.5, z: z + 4 },
      { geo: sph(5.2), color: '#c62828', x: x + 4, y: 59, z: z - 7 },
    ],
    (x, z) => [ // bouteille
      { geo: cylG(4.5, 4.5, 22, 10), color: '#2e5d32', x, y: 66, z },
      { geo: cylG(1.8, 3, 9, 8), color: '#2e5d32', x, y: 81, z },
      { geo: cylG(1.9, 1.9, 2.5, 8), color: '#b3902f', x, y: 86, z },
    ],
    (x, z) => [ // pile d'assiettes
      { geo: cylG(11, 11, 6, 14), color: '#eceff1', x, y: 58, z },
      { geo: cylG(9.5, 9.5, 3, 14), color: '#cfd8dc', x, y: 62.5, z },
    ],
    (x, z) => [ // fromage
      { geo: cylG(10, 10, 7, 3), color: '#fdd835', x, y: 58.5, z, ry: 0.6 },
    ],
  ];
  for (let i = 0; i < 22; i++) {
    const side = Math.floor(rnd() * 4);
    let x, z;
    if (side === 0) { x = 130 + rnd() * (WORLD_W - 260); z = WALL / 2; }
    else if (side === 1) { x = 130 + rnd() * (WORLD_W - 260); z = WORLD_H - WALL / 2; }
    else if (side === 2) { x = WALL / 2; z = 130 + rnd() * (WORLD_H - 260); }
    else { x = WORLD_W - WALL / 2; z = 130 + rnd() * (WORLD_H - 260); }
    const mk = propMakers[Math.floor(rnd() * propMakers.length)];
    for (const p of mk(x, z)) parts.push(p);
  }
  grp.add(new THREE.Mesh(mergeParts(parts), matV));
  scene.add(grp);
  return grp;
})();

// =================== DÉCOR : LA JUNGLE (NIVEAU 2) ===================
const jungleGroup = (function buildJungle() {
  const grp = new THREE.Group();
  grp.visible = false;
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // sol : herbe, terre, et une clairière au centre (où poussent les pastèques)
  const fc = document.createElement('canvas');
  fc.width = 1200; fc.height = 900;
  const b = fc.getContext('2d');
  b.fillStyle = '#4a7233';
  b.fillRect(0, 0, fc.width, fc.height);
  for (let i = 0; i < 260; i++) {
    b.fillStyle = `rgba(${30 + rnd() * 45 | 0},${70 + rnd() * 55 | 0},${25 + rnd() * 25 | 0},${0.12 + rnd() * 0.25})`;
    b.beginPath();
    b.ellipse(rnd() * fc.width, rnd() * fc.height, 20 + rnd() * 70, 12 + rnd() * 40, rnd() * TAU, 0, TAU);
    b.fill();
  }
  for (let i = 0; i < 9; i++) { // plaques de terre
    b.fillStyle = `rgba(112,86,52,${0.18 + rnd() * 0.2})`;
    b.beginPath();
    b.ellipse(rnd() * fc.width, rnd() * fc.height, 40 + rnd() * 90, 20 + rnd() * 45, rnd() * TAU, 0, TAU);
    b.fill();
  }
  b.fillStyle = 'rgba(142,112,66,0.55)';
  b.beginPath(); b.ellipse(600, 450, 95, 75, 0, 0, TAU); b.fill();
  b.strokeStyle = 'rgba(62,46,26,0.5)';
  b.lineWidth = 3;
  b.beginPath(); b.ellipse(600, 450, 95, 75, 0, 0, TAU); b.stroke();
  b.strokeStyle = 'rgba(150,205,92,0.32)';
  b.lineWidth = 2;
  for (let i = 0; i < 480; i++) { // brins d'herbe
    const x = rnd() * fc.width, y = rnd() * fc.height;
    b.beginPath(); b.moveTo(x, y); b.lineTo(x + (rnd() - 0.5) * 6, y - 4 - rnd() * 6); b.stroke();
  }
  const tex = new THREE.CanvasTexture(fc);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), new THREE.MeshLambertMaterial({ map: tex }));
  floor.rotation.x = -HALF_PI;
  floor.position.set(WORLD_W / 2, 0, WORLD_H / 2);
  grp.add(floor);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: 0x14210f }));
  outer.rotation.x = -HALF_PI;
  outer.position.set(WORLD_W / 2, -1, WORLD_H / 2);
  grp.add(outer);

  const parts = [];
  const hedge = '#2a4d1f', hedgeD = '#1a3314';
  // muraille végétale (même collision que les plans de travail : WALL)
  parts.push({ geo: boxG(WORLD_W, 70, WALL), color: hedge, x: WORLD_W / 2, y: 35, z: WALL / 2 });
  parts.push({ geo: boxG(WORLD_W, 70, WALL), color: hedge, x: WORLD_W / 2, y: 35, z: WORLD_H - WALL / 2 });
  parts.push({ geo: boxG(WALL, 70, WORLD_H), color: hedge, x: WALL / 2, y: 35, z: WORLD_H / 2 });
  parts.push({ geo: boxG(WALL, 70, WORLD_H), color: hedge, x: WORLD_W - WALL / 2, y: 35, z: WORLD_H / 2 });
  // rideau de jungle sombre au-delà
  parts.push({ geo: boxG(WORLD_W + 40, 190, 20), color: hedgeD, x: WORLD_W / 2, y: 95, z: -10 });
  parts.push({ geo: boxG(WORLD_W + 40, 190, 20), color: hedgeD, x: WORLD_W / 2, y: 95, z: WORLD_H + 10 });
  parts.push({ geo: boxG(20, 190, WORLD_H + 40), color: hedgeD, x: -10, y: 95, z: WORLD_H / 2 });
  parts.push({ geo: boxG(20, 190, WORLD_H + 40), color: hedgeD, x: 10 + WORLD_W, y: 95, z: WORLD_H / 2 });

  // troncs + canopée le long de la bordure
  const treeAt = (x, z) => {
    parts.push({ geo: cylG(7 + rnd() * 4, 10 + rnd() * 4, 110, 7), color: '#5d4030', x, y: 55, z });
    parts.push({ geo: sph(34 + rnd() * 22, 8, 6), color: rnd() < 0.5 ? '#2e5d24' : '#3a7030', x: x + (rnd() - 0.5) * 20, y: 115 + rnd() * 30, z: z + (rnd() - 0.5) * 20 });
    if (rnd() < 0.6) parts.push({ geo: sph(22 + rnd() * 14, 8, 6), color: '#356b2a', x: x + (rnd() - 0.5) * 50, y: 95 + rnd() * 25, z: z + (rnd() - 0.5) * 50 });
  };
  for (let x = 100; x < WORLD_W; x += 150 + rnd() * 80) { treeAt(x, WALL / 2 + (rnd() - 0.5) * 30); treeAt(x + 60, WORLD_H - WALL / 2 + (rnd() - 0.5) * 30); }
  for (let z = 150; z < WORLD_H; z += 150 + rnd() * 80) { treeAt(WALL / 2 + (rnd() - 0.5) * 30, z); treeAt(WORLD_W - WALL / 2 + (rnd() - 0.5) * 30, z + 60); }

  // accessoires du labo posés sur la bordure : fûts chimiques, sacs de coke, caisses de dollars
  const propMakers = [
    (x, z) => [ // fût chimique
      { geo: cylG(14, 14, 30, 10), color: '#1565c0', x, y: 85, z },
      { geo: cylG(14.5, 14.5, 3, 10), color: '#0d3c70', x, y: 101, z },
    ],
    (x, z) => [ // sacs de coke
      { geo: sph(12, 8, 6), color: '#f2f2ec', x, y: 78, sy: 0.8, z },
      { geo: sph(9, 8, 6), color: '#e8e8e0', x: x + 14, y: 75, sy: 0.75, z: z + 6 },
      { geo: cylG(2, 2, 5, 6), color: '#c9a24b', x, y: 89, z },
    ],
    (x, z) => [ // caisse de dollars
      { geo: boxG(34, 20, 24), color: '#7a5230', x, y: 80, z },
      { geo: boxG(26, 4, 16), color: '#2f9e4f', x, y: 92, z },
      { geo: boxG(10, 5, 8), color: '#b7e0bd', x: x + 4, y: 95, z: z - 2 },
    ],
    (x, z) => [ // rocher moussu
      { geo: sph(15, 8, 6), color: '#78766a', x, y: 76, sy: 0.7, z },
      { geo: sph(9, 8, 6), color: '#5f7a4a', x: x + 6, y: 84, sy: 0.5, z: z + 4 },
    ],
    (x, z) => [ // marmite du labo (on reste cuistot)
      { geo: cylG(16, 15, 16, 12), color: '#455a64', x, y: 78, z },
      { geo: cylG(16.5, 16.5, 2, 12), color: '#37474f', x, y: 87, z },
      { geo: sph(8, 8, 6), color: '#f2f2ec', x, y: 89, sy: 0.4, z },
    ],
    (x, z) => [ // tas de poudre blanche
      { geo: coneG(15, 14), color: '#f6f6f0', x, y: 77, z },
      { geo: coneG(9, 9), color: '#ffffff', x: x + 13, y: 74.5, z: z + 7 },
      { geo: coneG(7, 7), color: '#efefe8', x: x - 12, y: 73.5, z: z - 6 },
      { geo: sph(5, 8, 6), color: '#f6f6f0', x: x + 4, y: 71, sy: 0.4, z: z - 12 },
    ],
  ];
  for (let i = 0; i < 18; i++) {
    const side = Math.floor(rnd() * 4);
    let x, z;
    if (side === 0) { x = 130 + rnd() * (WORLD_W - 260); z = WALL / 2; }
    else if (side === 1) { x = 130 + rnd() * (WORLD_W - 260); z = WORLD_H - WALL / 2; }
    else if (side === 2) { x = WALL / 2; z = 130 + rnd() * (WORLD_H - 260); }
    else { x = WORLD_W - WALL / 2; z = 130 + rnd() * (WORLD_H - 260); }
    const mk = propMakers[Math.floor(rnd() * propMakers.length)];
    for (const p of mk(x, z)) parts.push(p);
  }
  // quelques tas de poudre garantis, un par côté
  const powder = propMakers[propMakers.length - 1];
  for (const [px, pz] of [
    [WORLD_W * 0.3, WALL / 2], [WORLD_W * 0.7, WORLD_H - WALL / 2],
    [WALL / 2, WORLD_H * 0.6], [WORLD_W - WALL / 2, WORLD_H * 0.35],
  ]) for (const p of powder(px, pz)) parts.push(p);
  grp.add(new THREE.Mesh(mergeParts(parts), matV));
  scene.add(grp);
  return grp;
})();

// =================== MODÈLES 3D ===================
function rodentGeo(bodyC, s, { earC = '#c98f8f', tailC = '#c98f8f', eyeC = '#151515' } = {}) {
  return mergeParts([
    { geo: sph(9 * s), color: bodyC, y: 8 * s, sx: 1.35, sy: 0.85, sz: 1 },
    { geo: sph(5.5 * s), color: bodyC, x: 11 * s, y: 8.5 * s, sx: 1.1, sy: 0.9, sz: 0.9 },
    { geo: sph(3 * s), color: earC, x: 10 * s, y: 13.5 * s, z: 4 * s, sz: 0.45 },
    { geo: sph(3 * s), color: earC, x: 10 * s, y: 13.5 * s, z: -4 * s, sz: 0.45 },
    { geo: sph(1.6 * s), color: '#f2a0a0', x: 17 * s, y: 8 * s },
    { geo: sph(1.3 * s), color: eyeC, x: 14.5 * s, y: 10.5 * s, z: 3 * s },
    { geo: sph(1.3 * s), color: eyeC, x: 14.5 * s, y: 10.5 * s, z: -3 * s },
    { geo: cylG(0.9 * s, 1.4 * s, 18 * s, 6), color: tailC, x: -16 * s, y: 6 * s, rz: HALF_PI },
  ]);
}

const ENEMY_GEOS = {
  souris: rodentGeo('#9e9e9e', 1),
  rat: rodentGeo('#6b6255', 1.35, { earC: '#8d8070', tailC: '#b98f8f' }),
  cafard: mergeParts([
    { geo: sph(8), color: '#4e3418', y: 5, sx: 1.5, sy: 0.55, sz: 0.95 },
    { geo: sph(4.2), color: '#2e1e0c', x: 10, y: 5, sy: 0.7 },
    { geo: sph(6), color: '#5d4023', y: 6.5, sx: 1.2, sy: 0.4, sz: 0.8 },
    { geo: cylG(0.4, 0.4, 13, 5), color: '#2e1e0c', x: 15, y: 9, z: 3, rz: 1.15, rx: 0.4 },
    { geo: cylG(0.4, 0.4, 13, 5), color: '#2e1e0c', x: 15, y: 9, z: -3, rz: 1.15, rx: -0.4 },
  ]),
  millepattes: mergeParts([
    { geo: sph(9), color: '#6b8e23', y: 8, sx: 1.1 },
    { geo: sph(1.6), color: '#151515', x: 6, y: 11, z: 3.5 },
    { geo: sph(1.6), color: '#151515', x: 6, y: 11, z: -3.5 },
    { geo: cylG(0.5, 0.5, 12, 5), color: '#4a6317', x: 8, y: 13, z: 3, rz: 1.1, rx: 0.4 },
    { geo: cylG(0.5, 0.5, 12, 5), color: '#4a6317', x: 8, y: 13, z: -3, rz: 1.1, rx: -0.4 },
  ]),
  chat: mergeParts([
    { geo: sph(13), color: '#546e7a', x: -3, y: 13, sx: 1.35, sy: 0.95 },
    { geo: sph(8.5), color: '#546e7a', x: 13, y: 19 },
    { geo: coneG(3.2, 6.5), color: '#455a64', x: 12, y: 27, z: 4.5 },
    { geo: coneG(3.2, 6.5), color: '#455a64', x: 12, y: 27, z: -4.5 },
    { geo: sph(2), color: '#9ccc65', x: 19.5, y: 21, z: 3.4 },
    { geo: sph(2), color: '#9ccc65', x: 19.5, y: 21, z: -3.4 },
    { geo: sph(1.7), color: '#ef9a9a', x: 21.5, y: 18 },
    { geo: cylG(1.6, 2.2, 20, 6), color: '#455a64', x: -19, y: 20, rz: 0.6 },
  ]),
  ratgeant: rodentGeo('#6e3a34', 2.3, { earC: '#8d5049', tailC: '#a56b64', eyeC: '#ff5252' }),
  // --- niveau 2 : la jungle ---
  fourmi: mergeParts([
    { geo: sph(6), color: '#a63125', x: -7, y: 5, sx: 1.25, sy: 0.85 },
    { geo: sph(4), color: '#c0392b', y: 5.5, sy: 0.85 },
    { geo: sph(3.6), color: '#a63125', x: 6.5, y: 6 },
    { geo: sph(1), color: '#151515', x: 8.5, y: 7, z: 1.8 },
    { geo: sph(1), color: '#151515', x: 8.5, y: 7, z: -1.8 },
    { geo: cylG(0.4, 0.4, 7, 5), color: '#5d1f16', x: 9, y: 10, z: 2, rz: 0.9, rx: 0.5 },
    { geo: cylG(0.4, 0.4, 7, 5), color: '#5d1f16', x: 9, y: 10, z: -2, rz: 0.9, rx: -0.5 },
  ]),
  araignee: mergeParts([
    { geo: sph(8), color: '#33251d', x: -3, y: 8, sy: 0.85 },
    { geo: sph(5), color: '#4a352a', x: 6, y: 7.5 },
    { geo: sph(2.4), color: '#c62828', x: -4, y: 13, sx: 0.7, sz: 0.7 },
    { geo: sph(1.1), color: '#e53935', x: 9.5, y: 9, z: 2 },
    { geo: sph(1.1), color: '#e53935', x: 9.5, y: 9, z: -2 },
    { geo: cylG(0.6, 0.6, 15, 5), color: '#2a1c15', x: 4, y: 8, z: 6, rx: 1.05, rz: 0.35 },
    { geo: cylG(0.6, 0.6, 15, 5), color: '#2a1c15', x: 4, y: 8, z: -6, rx: -1.05, rz: 0.35 },
    { geo: cylG(0.6, 0.6, 15, 5), color: '#2a1c15', x: 0, y: 8, z: 6.5, rx: 1.15 },
    { geo: cylG(0.6, 0.6, 15, 5), color: '#2a1c15', x: 0, y: 8, z: -6.5, rx: -1.15 },
    { geo: cylG(0.6, 0.6, 15, 5), color: '#2a1c15', x: -4, y: 8, z: 6.5, rx: 1.15, rz: -0.2 },
    { geo: cylG(0.6, 0.6, 15, 5), color: '#2a1c15', x: -4, y: 8, z: -6.5, rx: -1.15, rz: -0.2 },
    { geo: cylG(0.6, 0.6, 15, 5), color: '#2a1c15', x: -8, y: 8, z: 6, rx: 1.05, rz: -0.4 },
    { geo: cylG(0.6, 0.6, 15, 5), color: '#2a1c15', x: -8, y: 8, z: -6, rx: -1.05, rz: -0.4 },
  ]),
  serpent: mergeParts([
    { geo: sph(10), color: '#388e3c', y: 8, sx: 1.25, sy: 0.8 },
    { geo: sph(1.7), color: '#ffee58', x: 8, y: 11.5, z: 3.5 },
    { geo: sph(1.7), color: '#ffee58', x: 8, y: 11.5, z: -3.5 },
    { geo: sph(0.9), color: '#151515', x: 9, y: 11.5, z: 3.5 },
    { geo: sph(0.9), color: '#151515', x: 9, y: 11.5, z: -3.5 },
    { geo: boxG(7, 0.8, 1.2), color: '#e53935', x: 15, y: 8 },
  ]),
  singe: mergeParts([
    { geo: sph(10), color: '#6d4c41', x: -2, y: 12, sy: 1.15 },
    { geo: sph(7), color: '#6d4c41', x: 8, y: 22 },
    { geo: sph(4.5), color: '#d7b899', x: 12, y: 20.5, sz: 0.9 },
    { geo: sph(2.6), color: '#8d6e63', x: 7, y: 27, z: 5.5 },
    { geo: sph(2.6), color: '#8d6e63', x: 7, y: 27, z: -5.5 },
    { geo: sph(1.2), color: '#151515', x: 13.5, y: 23, z: 2.2 },
    { geo: sph(1.2), color: '#151515', x: 13.5, y: 23, z: -2.2 },
    { geo: cylG(1.2, 1.2, 20, 6), color: '#5d4037', x: -11, y: 18, rz: 0.8 },
    { geo: sph(3), color: '#5d4037', x: -18, y: 26 },
  ]),
  singemerde: mergeParts([
    { geo: sph(10), color: '#4e342a', x: -2, y: 12, sy: 1.15 },
    { geo: sph(7), color: '#4e342a', x: 8, y: 22 },
    { geo: sph(4.5), color: '#c9a084', x: 12, y: 20.5, sz: 0.9 },
    { geo: sph(2.6), color: '#6d4c41', x: 7, y: 27, z: 5.5 },
    { geo: sph(2.6), color: '#6d4c41', x: 7, y: 27, z: -5.5 },
    { geo: sph(1.2), color: '#e53935', x: 13.5, y: 23, z: 2.2 },
    { geo: sph(1.2), color: '#e53935', x: 13.5, y: 23, z: -2.2 },
    { geo: sph(4.2), color: '#5d4023', x: 10, y: 12 }, // munition en main
    { geo: sph(3), color: '#e57373', x: -9, y: 9 },
    { geo: cylG(1.2, 1.2, 20, 6), color: '#3e2723', x: -11, y: 18, rz: 0.8 },
    { geo: sph(3), color: '#3e2723', x: -18, y: 26 },
  ]),
  crocodile: mergeParts([
    { geo: sph(13), color: '#2f5d1e', x: -6, y: 9, sx: 1.9, sy: 0.7 },
    { geo: boxG(22, 5.5, 9), color: '#3f7d2a', x: 16, y: 9 },
    { geo: sph(2.4), color: '#ffe082', x: 8, y: 15, z: 4 },
    { geo: sph(2.4), color: '#ffe082', x: 8, y: 15, z: -4 },
    { geo: boxG(1.5, 2.4, 1.2), color: '#f5f5f5', x: 24, y: 5.5, z: 3.4 },
    { geo: boxG(1.5, 2.4, 1.2), color: '#f5f5f5', x: 24, y: 5.5, z: -3.4 },
    { geo: boxG(1.5, 2.4, 1.2), color: '#f5f5f5', x: 18, y: 5.5, z: 4 },
    { geo: boxG(1.5, 2.4, 1.2), color: '#f5f5f5', x: 18, y: 5.5, z: -4 },
    { geo: coneG(2.4, 4.5), color: '#26491a', x: -4, y: 16 },
    { geo: coneG(2.1, 4), color: '#26491a', x: -12, y: 15 },
    { geo: coneG(1.8, 3.5), color: '#26491a', x: -19, y: 13 },
    { geo: coneG(5, 22), color: '#2f5d1e', x: -33, y: 8, rz: HALF_PI },
  ]),
  jaguar: mergeParts([
    { geo: sph(14), color: '#e8a33d', x: -3, y: 14, sx: 1.45, sy: 0.95 },
    { geo: sph(9), color: '#e8a33d', x: 15, y: 21 },
    { geo: coneG(3.2, 6), color: '#c98a2b', x: 14, y: 29, z: 5 },
    { geo: coneG(3.2, 6), color: '#c98a2b', x: 14, y: 29, z: -5 },
    { geo: sph(2.2), color: '#2e7d32', x: 22, y: 23, z: 3.6 },
    { geo: sph(2.2), color: '#2e7d32', x: 22, y: 23, z: -3.6 },
    { geo: sph(2), color: '#37474f', x: 24.5, y: 20 },
    { geo: sph(2), color: '#5d4023', x: -8, y: 24, z: 6 },
    { geo: sph(1.8), color: '#5d4023', x: 0, y: 26, z: -7 },
    { geo: sph(1.8), color: '#5d4023', x: -12, y: 20, z: -9 },
    { geo: sph(1.6), color: '#5d4023', x: 4, y: 22, z: 9 },
    { geo: sph(1.6), color: '#5d4023', x: -14, y: 23, z: 3 },
    { geo: cylG(1.8, 2.4, 22, 6), color: '#c98a2b', x: -21, y: 20, rz: 0.6 },
  ]),
  pasteque: mergeParts([
    { geo: sph(22, 14, 10), color: '#3f9e3f', y: 20, sy: 0.95 },
    { geo: sph(22.4, 14, 10), color: '#1e661e', y: 20, sx: 0.14, sy: 0.93, sz: 1.02 },
    { geo: sph(22.4, 14, 10), color: '#1e661e', y: 20, sx: 0.14, sy: 0.93, sz: 1.02, ry: 1.05 },
    { geo: sph(22.4, 14, 10), color: '#1e661e', y: 20, sx: 0.14, sy: 0.93, sz: 1.02, ry: 2.1 },
    { geo: cylG(1.2, 1.8, 6, 6), color: '#5d4023', y: 42 },
  ]),
  raton: mergeParts([
    { geo: sph(12), color: '#78909c', x: -2, y: 11, sx: 1.4, sy: 0.95 },
    { geo: sph(8), color: '#90a4ae', x: 13, y: 15 },
    { geo: boxG(9, 4.5, 16), color: '#263238', x: 16, y: 17 },
    { geo: sph(3.2), color: '#eceff1', x: 20, y: 13 },
    { geo: sph(1.8), color: '#151515', x: 23, y: 13.5 },
    { geo: sph(2.8), color: '#607d8b', x: 11, y: 22, z: 5 },
    { geo: sph(2.8), color: '#607d8b', x: 11, y: 22, z: -5 },
    { geo: sph(4.5), color: '#78909c', x: -17, y: 12 },
    { geo: sph(4), color: '#37474f', x: -22, y: 13 },
    { geo: sph(3.5), color: '#78909c', x: -26.5, y: 14 },
    { geo: sph(3), color: '#37474f', x: -30, y: 15 },
  ]),
};

// le chef
const chefGeo = mergeParts([
  { geo: sph(3.4), color: '#3e2723', x: 3, y: 2.5, z: 4.5, sx: 1.5 },
  { geo: sph(3.4), color: '#3e2723', x: 3, y: 2.5, z: -4.5, sx: 1.5 },
  { geo: cylG(6.2, 6.9, 9, 12), color: '#37474f', y: 8 },
  { geo: cylG(7.4, 8.6, 15, 12), color: '#fafafa', y: 19.5 },
  { geo: sph(3), color: '#fafafa', x: 6.5, y: 21, z: 6 },
  { geo: sph(3), color: '#fafafa', x: 6.5, y: 21, z: -6 },
  { geo: sph(2.3), color: '#f0b98d', x: 10, y: 20, z: 6 },
  { geo: sph(2.3), color: '#f0b98d', x: 10, y: 20, z: -6 },
  { geo: sph(6.5), color: '#f0b98d', y: 32.5 },
  { geo: sph(1.6), color: '#37241a', x: 5.4, y: 34, z: 2.6 },
  { geo: sph(1.6), color: '#37241a', x: 5.4, y: 34, z: -2.6 },
  { geo: sph(2.2), color: '#8d6e63', x: 5.8, y: 30.5, sx: 0.8, sy: 0.5, sz: 1.6 },
  { geo: cylG(5.8, 6.2, 5, 12), color: '#ffffff', y: 39.5 },
  { geo: cylG(7.2, 6.2, 7.5, 12), color: '#ffffff', y: 45 },
]);
const chefMesh = new THREE.Mesh(chefGeo, matV);
chefMesh.scale.setScalar(1.3);
scene.add(chefMesh);

// poêle tenue en main (sert aussi d'animation de frappe)
const panGeo = mergeParts([
  { geo: cylG(8.5, 8.5, 2.2, 14), color: '#263238' },
  { geo: cylG(7, 7, 1.6, 14), color: '#37474f', y: 1 },
  { geo: boxG(15, 1.8, 3.2), color: '#4e342e', x: -14, y: 0.6 },
]);
const panMesh = new THREE.Mesh(panGeo, matV);
panMesh.scale.setScalar(1.2);
scene.add(panMesh);

// machette tenue en main au niveau 2
const macheteGeo = mergeParts([
  { geo: boxG(24, 1.4, 5.5), color: '#b8c4cc', x: 5 },
  { geo: boxG(6, 1.6, 7), color: '#9fadb6', x: 18 },
  { geo: boxG(9, 2.6, 3.2), color: '#4e342e', x: -10 },
]);
const macheteMesh = new THREE.Mesh(macheteGeo, matV);
macheteMesh.scale.setScalar(1.2);
macheteMesh.visible = false;
scene.add(macheteMesh);

// le boss : Philippe ChuileBest, chef géant en veste noire
const bossGeo = mergeParts([
  { geo: sph(3.6), color: '#1a1a1a', x: 3, y: 2.5, z: 4.5, sx: 1.5 },
  { geo: sph(3.6), color: '#1a1a1a', x: 3, y: 2.5, z: -4.5, sx: 1.5 },
  { geo: cylG(6.6, 7.3, 9, 12), color: '#37474f', y: 8 },
  { geo: cylG(7.8, 9.4, 16, 12), color: '#212121', y: 20 },
  { geo: sph(3.2), color: '#212121', x: 6.5, y: 22, z: 6.5 },
  { geo: sph(3.2), color: '#212121', x: 6.5, y: 22, z: -6.5 },
  { geo: sph(2.4), color: '#f0b98d', x: 10, y: 21, z: 6.5 },
  { geo: sph(2.4), color: '#f0b98d', x: 10, y: 21, z: -6.5 },
  { geo: cylG(5.4, 7, 3.5, 10), color: '#c62828', y: 29.5 },
  { geo: sph(6.8), color: '#f0b98d', y: 34.5 },
  { geo: sph(1.7), color: '#151515', x: 5.8, y: 36, z: 2.8 },
  { geo: sph(1.7), color: '#151515', x: 5.8, y: 36, z: -2.8 },
  { geo: boxG(4, 1.3, 1.3), color: '#3e2723', x: 5.8, y: 37.6, z: 2.8, rx: -0.5 },
  { geo: boxG(4, 1.3, 1.3), color: '#3e2723', x: 5.8, y: 37.6, z: -2.8, rx: 0.5 },
  { geo: sph(2.6), color: '#4e342e', x: 6.2, y: 32.5, sx: 0.8, sy: 0.6, sz: 2.6 },
  { geo: cylG(6, 6.4, 5, 12), color: '#fafafa', y: 42.5 },
  { geo: cylG(7.6, 6.6, 8, 12), color: '#fafafa', y: 48.5 },
  { geo: cylG(9.5, 9.5, 2.5, 14), color: '#1c262b', x: 15, y: 21, z: 9 },
  { geo: boxG(13, 2, 3.4), color: '#3e2723', x: 4, y: 21, z: 9 },
]);
const bossMesh = new THREE.Mesh(bossGeo, matV);
bossMesh.scale.setScalar(3.4);
bossMesh.visible = false;
scene.add(bossMesh);

// le boss du niveau 2 : l'Hippo de Pablo, avec sa chaîne en or
const hippoGeo = mergeParts([
  { geo: cylG(4.5, 5.2, 12, 8), color: '#6f7b8a', x: 7, y: 6, z: 8 },
  { geo: cylG(4.5, 5.2, 12, 8), color: '#6f7b8a', x: 7, y: 6, z: -8 },
  { geo: cylG(4.5, 5.2, 12, 8), color: '#6f7b8a', x: -13, y: 6, z: 8 },
  { geo: cylG(4.5, 5.2, 12, 8), color: '#6f7b8a', x: -13, y: 6, z: -8 },
  { geo: sph(15), color: '#7d8795', x: -4, y: 19, sx: 1.5, sy: 1.05, sz: 1.15 },
  { geo: sph(14), color: '#96a0ad', x: -4, y: 15, sx: 1.35, sy: 0.75, sz: 1.05 },
  { geo: sph(9.5), color: '#7d8795', x: 16, y: 25 },
  { geo: boxG(13, 9, 13), color: '#8b95a3', x: 25, y: 19 },
  { geo: sph(2), color: '#e8a0b0', x: 31.5, y: 22.5, z: 3.2 },
  { geo: sph(2), color: '#e8a0b0', x: 31.5, y: 22.5, z: -3.2 },
  { geo: cylG(1.6, 1, 5.5, 6), color: '#f5f0dc', x: 30, y: 12.5, z: 4.5 },
  { geo: cylG(1.6, 1, 5.5, 6), color: '#f5f0dc', x: 30, y: 12.5, z: -4.5 },
  { geo: sph(1.8), color: '#2b1d20', x: 21, y: 30, z: 4 },
  { geo: sph(1.8), color: '#2b1d20', x: 21, y: 30, z: -4 },
  { geo: sph(2.6), color: '#6f7b8a', x: 13, y: 33, z: 5 },
  { geo: sph(2.6), color: '#6f7b8a', x: 13, y: 33, z: -5 },
  { geo: new THREE.TorusGeometry(8.5, 1.6, 6, 18), color: '#ffd700', x: 11, y: 22, rx: HALF_PI, rz: 0.45 },
  { geo: boxG(5, 6, 2), color: '#ffd700', x: 18, y: 15 },
  { geo: cylG(1.2, 2, 9, 6), color: '#6f7b8a', x: -28, y: 23, rz: 0.7 },
]);
const hippoMesh = new THREE.Mesh(hippoGeo, matV);
hippoMesh.scale.setScalar(3.2);
hippoMesh.visible = false;
scene.add(hippoMesh);

// télégraphes du boss
const slamTeleMesh = new THREE.Mesh(
  new THREE.CircleGeometry(1, 32).rotateX(-HALF_PI),
  new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.3, depthWrite: false })
);
slamTeleMesh.position.y = 0.9;
slamTeleMesh.renderOrder = 2;
slamTeleMesh.visible = false;
scene.add(slamTeleMesh);

const chargeTeleMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 110).rotateX(-HALF_PI).translate(500, 0, 0),
  new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.25, depthWrite: false })
);
chargeTeleMesh.position.y = 0.9;
chargeTeleMesh.renderOrder = 2;
chargeTeleMesh.visible = false;
scene.add(chargeTeleMesh);

// ondes de choc (coup de poêle au sol, explosions de grenades)
const shockPool = [];
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.08, 6, 40),
    new THREE.MeshBasicMaterial({ color: 0xff5722, transparent: true, opacity: 0.8, depthWrite: false })
  );
  m.rotation.x = -HALF_PI;
  m.position.y = 3;
  m.visible = false;
  scene.add(m);
  shockPool.push(m);
}

// zones d'impact des obus de mortier de l'hippo (cercles d'esquive au sol)
const zonePool = [];
for (let i = 0; i < 26; i++) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24).rotateX(-HALF_PI),
    new THREE.MeshBasicMaterial({ color: 0xff1430, transparent: true, opacity: 0.3, depthWrite: false })
  );
  m.position.y = 0.8;
  m.renderOrder = 2;
  m.visible = false;
  scene.add(m);
  zonePool.push(m);
}

// assiettes lancées par le boss
const plateInst = makeInstanced(mergeParts([
  { geo: cylG(9, 7, 2.2, 14), color: '#eceff1' },
  { geo: cylG(6, 6, 1.2, 14), color: '#cfd8dc', y: 1.2 },
]), 90);

// projectiles ennemis du niveau 2 : cacas de singe et liasses vomies
const poopInst = makeInstanced(mergeParts([
  { geo: sph(6.5), color: '#5d4023' },
  { geo: sph(4.6), color: '#6d4c2f', y: 4.5 },
  { geo: sph(2.6), color: '#7a563a', y: 8.5 },
]), 40);
const billInst = makeInstanced(mergeParts([
  { geo: sph(8), color: '#3f9e4c', sx: 1.1 },
  { geo: cylG(8.6, 8.6, 3.4, 10), color: '#bfe3c2', rz: HALF_PI },
]), 60);

// bonus : aimant à fromage
const magnetGeo = mergeParts([
  { geo: boxG(5, 12, 5), color: '#e53935', x: -5.5, y: 8 },
  { geo: boxG(5, 12, 5), color: '#e53935', x: 5.5, y: 8 },
  { geo: boxG(16, 5.5, 5), color: '#c62828', y: 16 },
  { geo: boxG(5, 3.5, 5), color: '#eceff1', x: -5.5, y: 3 },
  { geo: boxG(5, 3.5, 5), color: '#eceff1', x: 5.5, y: 3 },
]);
const magnetInst = makeInstanced(magnetGeo, 8);

// bonus niveau 2 : sachet de coke (boost de vitesse)
const cokeGeo = mergeParts([
  { geo: boxG(13, 9, 10), color: '#f4f4f0', y: 6 },
  { geo: boxG(13.6, 3.2, 10.6), color: '#c9a24b', y: 6 },
  { geo: boxG(4, 4, 1), color: '#c62828', y: 7.5, z: 5.2 },
]);
const cokeInst = makeInstanced(cokeGeo, 8);

// =================== INSTANCES & POOLS ===================
const _im = new THREE.Matrix4(), _ip = new THREE.Vector3(), _iq = new THREE.Quaternion(), _is = new THREE.Vector3(), _ie = new THREE.Euler();
function setInst(mesh, i, x, y, z, ry = 0, s = 1, sy = null) {
  _ip.set(x, y, z);
  _ie.set(0, ry, 0);
  _iq.setFromEuler(_ie);
  _is.set(s, sy === null ? s : sy, s);
  _im.compose(_ip, _iq, _is);
  mesh.setMatrixAt(i, _im);
}
function makeInstanced(geo, cap, material = matV) {
  const m = new THREE.InstancedMesh(geo, material, cap);
  m.count = 0;
  m.userData.cap = cap;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  scene.add(m);
  return m;
}

const enemyInst = {};
const SWARM_TYPES = new Set(['souris', 'rat', 'cafard', 'fourmi', 'araignee']);
for (const t in ENEMY_GEOS) enemyInst[t] = makeInstanced(ENEMY_GEOS[t], SWARM_TYPES.has(t) ? 360 : 80);
const segInst = makeInstanced(mergeParts([{ geo: sph(8), color: '#7a8c3a', y: 7 }]), 1200);

// ombres portées (disques sombres)
const shadowInst = makeInstanced(
  new THREE.CircleGeometry(10, 14).rotateX(-HALF_PI),
  900,
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
);
shadowInst.renderOrder = 1;

// ramassables
const cheeseInst = makeInstanced(mergeParts([{ geo: cylG(9, 9, 6, 3), color: '#fdd835', y: 3 }]), 420);
const soupInst = makeInstanced(mergeParts([
  { geo: cylG(8, 6, 6, 12), color: '#8d6e63', y: 3 },
  { geo: cylG(6.5, 6.5, 1.5, 12), color: '#d84315', y: 6 },
]), 40);
// ramassables niveau 2 : dollars de Pablo et empanadas
const dollarInst = makeInstanced(mergeParts([
  { geo: boxG(15, 1.4, 8), color: '#2f9e4f' },
  { geo: boxG(6.5, 1.8, 4.5), color: '#b7e0bd' },
]), 420);
const empanadaInst = makeInstanced(mergeParts([
  { geo: sph(8, 10, 8), color: '#e2a93e', sx: 1.15, sy: 0.5, y: 4 },
  { geo: sph(6.6, 10, 8), color: '#c98a2b', x: -1.5, sx: 1.05, sy: 0.42, y: 4.6 },
]), 40);

// projectiles
const knifeInst = makeInstanced(mergeParts([
  { geo: boxG(15, 1.2, 4), color: '#cfd8dc', x: 4 },
  { geo: boxG(7, 2.4, 3), color: '#4e342e', x: -7 },
]), 60);
const corkInst = makeInstanced(mergeParts([
  { geo: cylG(3.6, 3.2, 8, 8), color: '#a1887f', rz: HALF_PI },
  { geo: sph(3.8), color: '#8d6e4a', x: 4 },
]), 20);
const globInst = makeInstanced(mergeParts([{ geo: sph(6.5), color: '#e64a19' }]), 20);
// projectiles niveau 2 : fléchettes, balles d'AK, grenades
const dartInst = makeInstanced(mergeParts([
  { geo: cylG(0.9, 0.9, 11, 6), color: '#8d6e63', rz: HALF_PI },
  { geo: coneG(1.8, 4), color: '#66bb6a', x: -5.5, rz: -HALF_PI },
]), 40);
const bulletInst = makeInstanced(mergeParts([{ geo: boxG(8, 1.8, 1.8), color: '#ffd54f' }]), 80);
const nadeInst = makeInstanced(mergeParts([
  { geo: sph(6.5), color: '#33691e' },
  { geo: boxG(3.4, 3, 3.4), color: '#9e9e9e', y: 6 },
  { geo: cylG(0.7, 0.7, 4, 5), color: '#e53935', x: 2.4, y: 8, rz: 0.7 },
]), 40);

// flaques de sauce (et de feu, niveau 2)
const puddlePool = [];
for (let i = 0; i < 26; i++) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(1, 22),
    new THREE.MeshBasicMaterial({ color: 0xd84315, transparent: true, opacity: 0.55, depthWrite: false })
  );
  m.rotation.x = -HALF_PI;
  m.position.y = 0.7;
  m.renderOrder = 2;
  m.visible = false;
  scene.add(m);
  puddlePool.push(m);
}

// chalumeau : 4 jets en croix
const torchGroup = new THREE.Group();
const torchBeams = [];
for (let k = 0; k < 4; k++) {
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8c28, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 0.9, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  beam.add(inner);
  const holder = new THREE.Group();
  holder.rotation.y = k * HALF_PI;
  beam.rotation.z = -HALF_PI; // le cône pointe vers +X
  holder.add(beam);
  torchGroup.add(holder);
  torchBeams.push(beam);
}
torchGroup.visible = false;
scene.add(torchGroup);

// lance-flammes (niveau 2) : un seul jet, large, vers la visée
const flameBeam = new THREE.Mesh(
  new THREE.ConeGeometry(1, 1, 10),
  new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
);
const flameInner = new THREE.Mesh(
  new THREE.ConeGeometry(0.55, 0.92, 10),
  new THREE.MeshBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
);
flameBeam.add(flameInner);
flameBeam.rotation.z = HALF_PI; // pointe (l'embout) vers le joueur, base évasée au loin
const flameGroup = new THREE.Group();
flameGroup.add(flameBeam);
flameGroup.visible = false;
scene.add(flameGroup);

// fouet (niveau 2) : secteur d'onde de choc au sol
const whipMesh = new THREE.Mesh(
  new THREE.CircleGeometry(1, 20, -0.6, 1.2).rotateX(-HALF_PI),
  new THREE.MeshBasicMaterial({ color: 0xffe0b2, transparent: true, opacity: 0.5, depthWrite: false })
);
whipMesh.position.y = 1.2;
whipMesh.renderOrder = 2;
whipMesh.visible = false;
whipMesh.userData.cone = 1.2;
scene.add(whipMesh);

// éclairs
const zapPool = [];
for (let i = 0; i < 8; i++) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(64 * 3), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x9be7ff, transparent: true, opacity: 1 }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  zapPool.push(line);
}

// nuage de fumée du pesticide : bouffées qui gonflent, dérivent et se dissipent
const puffPool = [];
for (let i = 0; i < 30; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xd4e6c3, transparent: true, opacity: 0.4, depthWrite: false })
  );
  m.visible = false;
  scene.add(m);
  puffPool.push(m);
}

// anneaux du hachoir
const pulsePool = [];
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.045, 6, 36),
    new THREE.MeshBasicMaterial({ color: 0xdde3ea, transparent: true, opacity: 0.7, depthWrite: false })
  );
  m.rotation.x = -HALF_PI;
  m.position.y = 3;
  m.visible = false;
  scene.add(m);
  pulsePool.push(m);
}

// fouets du batteur
const whiskGeo = mergeParts([
  { geo: cylG(1.4, 1.4, 9, 8), color: '#9aa3ad', y: 16 },
  { geo: sph(6, 8, 6), color: '#e8edf2', y: 6, sx: 0.72, sy: 1.15, sz: 0.72 },
  { geo: sph(4.4, 8, 6), color: '#c3ccd4', y: 6, sx: 0.5, sy: 1, sz: 0.9 },
]);
const whiskPool = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(whiskGeo, matV);
  m.visible = false;
  scene.add(m);
  whiskPool.push(m);
}

// particules
const MAX_PARTS = 300;
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTS * 3), 3));
partGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTS * 3), 3));
const partPoints = new THREE.Points(partGeo, new THREE.PointsMaterial({ size: 6, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
partPoints.frustumCulled = false;
scene.add(partPoints);
const _pc = new THREE.Color();

// projection monde -> écran (pour le HUD)
const _pv = new THREE.Vector3();
function proj(x, h, z) {
  _pv.set(x, h, z).project(camera);
  return [(_pv.x + 1) / 2 * VW, (1 - (_pv.y + 1) / 2) * VH];
}

// =================== AUDIO ===================
let actx = null, muted = false, lastHitSnd = 0;
function beep(f0, f1, dur, type = 'square', vol = 0.06) {
  if (muted) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + dur);
  } catch (e) { /* audio indisponible */ }
}
function sndHit() { const n = performance.now(); if (n - lastHitSnd < 70) return; lastHitSnd = n; beep(220, 140, 0.06, 'square', 0.03); }
function sndKill() { beep(320, 60, 0.15, 'sawtooth', 0.05); }
function sndHurt() { beep(130, 60, 0.25, 'sawtooth', 0.12); }
function sndPickup() { beep(600, 900, 0.09, 'sine', 0.06); }
function sndSpray() { // pschiiit d'aérosol : attaque franche, souffle tenu, puis relâche
  if (muted) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime, dur = 0.45;
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    // bande médium-aiguë large : le "chhh" d'une bombe aérosol
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 0.55;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.018);
    g.gain.setValueAtTime(0.09, t + 0.26);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(actx.destination);
    src.start(t);
  } catch (e) { /* audio indisponible */ }
}
function sndLevel() { beep(440, 440, 0.1, 'sine', 0.08); setTimeout(() => beep(550, 550, 0.1, 'sine', 0.08), 100); setTimeout(() => beep(660, 880, 0.18, 'sine', 0.08), 200); }
function sndPop() { beep(900, 200, 0.18, 'square', 0.1); }
function sndZap() { beep(1200, 300, 0.1, 'sawtooth', 0.05); }

// =================== ARMES ===================
const WEAPON_DEFS = {
  poele: {
    name: 'Poêle', icon: '🍳',
    desc: "Frappe l'ennemi le plus proche d'un bon coup de poêle.",
    base: { dmg: 24, cd: 0.85, range: 90, knock: 300 },
  },
  couteau: {
    name: 'Couteau', icon: '🔪',
    desc: 'Lance un couteau vers la souris, transperce plusieurs ennemis.',
    base: { dmg: 15, cd: 0.6, speed: 560, pierce: 2 },
  },
  hachoir: {
    name: 'Hachoir', icon: '🪓',
    desc: 'Hache tout ce qui approche, en cercle, très rapidement.',
    base: { dmg: 8, cd: 0.45, range: 100 },
  },
  chalumeau: {
    name: 'Chalumeau', icon: '🔥',
    desc: 'Crache des jets de feu en croix autour de vous.',
    base: { dmg: 10, cd: 2.6, len: 175, dur: 1.0, tick: 0.14 },
  },
  electrique: {
    name: 'Couteau électrique', icon: '⚡',
    desc: "Arc électrique qui saute d'ennemi en ennemi.",
    base: { dmg: 18, cd: 1.4, range: 280, jumps: 3, jumpRange: 150 },
  },
  batteur: {
    name: 'Batteur à œufs', icon: '🥣',
    desc: 'Fouets en orbite qui repoussent la vermine en continu.',
    base: { dmg: 11, cd: 0, orbs: 2, radius: 72, rotSpeed: 2.8, hitCd: 0.45 },
  },
  siphon: {
    name: 'Siphon piquant', icon: '🌶️',
    desc: 'Projette de la sauce piquante qui reste au sol et brûle.',
    base: { dmg: 14, cd: 2.3, puddleR: 75, dur: 4.5, throwRange: 300 },
  },
  champagne: {
    name: 'Bouchon de champagne', icon: '🍾',
    desc: 'Bouchon dévastateur qui traverse tout et ricoche sur les murs.',
    base: { dmg: 65, cd: 2.6, speed: 740, pierce: 7, knock: 450, bounces: 2 },
  },
  // --- niveau 2 : la jungle ---
  machette: {
    lvl: 2, name: 'Machette', icon: '🗡️',
    desc: 'Taillade tout ce qui passe dans un arc devant vous.',
    up: 'arc élargi',
    base: { dmg: 26, cd: 0.8, range: 105, knock: 280, cone: 1.6 },
  },
  sarbacane: {
    lvl: 2, name: 'Sarbacane', icon: '🎯',
    desc: 'Fléchette qui ralentit et empoisonne les ennemis.',
    up: '+1 fléchette tous les 2 niveaux',
    base: { dmg: 9, cd: 1.0, speed: 640, poison: 7, spread: 0.14 },
  },
  fouet: {
    lvl: 2, name: 'Fouet', icon: '🪢',
    desc: 'Claque en cône court : dégâts et gros recul.',
    up: 'cône de plus en plus large',
    base: { dmg: 18, cd: 1.4, range: 150, cone: 1.15, knock: 520 },
  },
  ak47: {
    lvl: 2, name: 'AK-47 « Viva la revolución »', icon: '🔫',
    desc: 'Rafale à longue portée dans un cône étroit vers la visée.',
    up: '+1 balle par rafale et par niveau',
    base: { dmg: 11, cd: 1.6, bullets: 4, spread: 0.12, speed: 950 },
  },
  grenade: {
    lvl: 2, name: 'Grenade de la Liberté', icon: '💣',
    desc: 'Explose là où vous visez. Évolue : rebonds multiples, puis feu au sol.',
    up: '+1 direction de rebond, feu au sol au niveau 6',
    base: { dmg: 42, cd: 2.7, boomR: 105, throwRange: 330, fireDps: 10 },
  },
  lanceflamme: {
    lvl: 2, name: 'Lance-flammes', icon: '🔥',
    desc: 'Crache un jet de feu continu vers la visée.',
    up: 'portée de plus en plus longue',
    base: { dmg: 9, cd: 2.4, len: 170, dur: 1.1, tick: 0.12, cone: 0.55 },
  },
  pesticide: {
    lvl: 2, name: 'Maxi Repousse', icon: '🧴',
    desc: 'Pschiiit ! Nuage de pesticide autour de vous : empoisonne et repousse la vermine (pas les gros).',
    up: 'nuage de plus en plus large',
    base: { dmg: 9, cd: 2.3, range: 122, poison: 8, knock: 470 },
  },
};
const MAX_WEAPON_LEVEL = 8;
const MAX_WEAPONS = 5;

function makeWeapon(type) { return { type, level: 1, cd: 0.3, angle: 0 }; }
function wstat(w) {
  const d = WEAPON_DEFS[w.type].base;
  const lv = w.level;
  const s = Object.assign({}, d);
  s.dmg = d.dmg * Math.pow(1.22, lv - 1);
  s.cd = (d.cd || 0) * Math.pow(0.93, lv - 1);
  s.area = Math.pow(1.05, lv - 1);
  if (w.type === 'batteur') s.orbs = d.orbs + Math.floor((lv - 1) / 2);
  if (w.type === 'couteau') s.pierce = d.pierce + Math.floor((lv - 1) / 3);
  if (w.type === 'electrique') s.jumps = d.jumps + Math.floor((lv - 1) / 2);
  // niveau 2 : les améliorations changent aussi le motif de l'arme
  if (w.type === 'machette') s.cone = d.cone + 0.12 * (lv - 1);
  if (w.type === 'sarbacane') s.darts = 1 + Math.floor((lv - 1) / 2);
  if (w.type === 'fouet') s.cone = d.cone + 0.09 * (lv - 1);
  if (w.type === 'ak47') s.bullets = d.bullets + (lv - 1);
  if (w.type === 'grenade') { s.frags = Math.max(0, lv - 2); s.fire = lv >= 6; }
  if (w.type === 'lanceflamme') s.len = d.len + 24 * (lv - 1);
  if (w.type === 'pesticide') s.range = d.range + 13 * (lv - 1);
  return s;
}

// =================== ENNEMIS ===================
const ENEMY_DEFS = {
  souris:      { name: 'Souris',            icon: '🐭', hp: 12,  dmg: 5,  speed: 100, r: 13, xp: 1,  t: 0,   w: 100 },
  rat:         { name: 'Rat',               icon: '🐀', hp: 34,  dmg: 9,  speed: 82,  r: 16, xp: 2,  t: 30,  w: 85 },
  cafard:      { name: 'Cafard',            icon: '🪳', hp: 9,   dmg: 4,  speed: 140, r: 11, xp: 1,  t: 70,  w: 70,  jitter: true },
  millepattes: { name: 'Mille-pattes',      icon: '🐛', hp: 150, dmg: 13, speed: 62,  r: 15, xp: 8,  t: 130, w: 12,  segments: 6 },
  chat:        { name: 'Chat de gouttière', icon: '🐈', hp: 110, dmg: 16, speed: 105, r: 18, xp: 10, t: 210, w: 16,  dasher: true },
  ratgeant:    { name: 'Rat géant',         icon: '🐀', hp: 380, dmg: 22, speed: 55,  r: 28, xp: 22, t: 320, w: 10 },
  raton:       { name: 'Raton laveur',      icon: '🦝', hp: 850, dmg: 28, speed: 68,  r: 26, xp: 45, t: 440, w: 6,   enrage: true },
  boss:        { name: 'Philippe ChuileBest', icon: '👨‍🍳', hp: 26000, dmg: 30, speed: 78, r: 48, xp: 0, t: 1e9, w: 0, boss: true },
  // --- niveau 2 : la jungle (sans lvl = niveau 1) ---
  fourmi:     { lvl: 2, name: 'Fourmi rouge',  icon: '🐜', hp: 14,  dmg: 6,  speed: 118, r: 11, xp: 1,  t: 0,   w: 100, jitter: true },
  araignee:   { lvl: 2, name: 'Araignée',      icon: '🕷️', hp: 32,  dmg: 10, speed: 128, r: 14, xp: 2,  t: 40,  w: 80 },
  serpent:    { lvl: 2, name: 'Serpent',       icon: '🐍', hp: 190, dmg: 15, speed: 72,  r: 15, xp: 8,  t: 100, w: 13,  segments: 7 },
  singe:      { lvl: 2, name: 'Singe',         icon: '🐒', hp: 130, dmg: 17, speed: 112, r: 17, xp: 10, t: 170, w: 16,  dasher: true },
  singemerde: { lvl: 2, name: 'Singe hurleur', icon: '💩', hp: 110, dmg: 13, speed: 92,  r: 16, xp: 12, t: 250, w: 11,  ranged: true },
  crocodile:  { lvl: 2, name: 'Crocodile',     icon: '🐊', hp: 520, dmg: 26, speed: 55,  r: 30, xp: 25, t: 340, w: 9,   dasher: true, windup: 0.65, dashT: 0.5, dashMul: 5.6, stalkT: 2 },
  jaguar:     { lvl: 2, name: 'Jaguar',        icon: '🐆', hp: 980, dmg: 30, speed: 98,  r: 24, xp: 50, t: 450, w: 6,   dasher: true, windup: 0.35, dashT: 0.4, dashMul: 4.6, stalkT: 0.9 },
  pasteque:   { lvl: 2, name: 'Pastèque',      icon: '🍉', hp: 3300, dmg: 0, speed: 0,   r: 24, xp: 15, t: 1e9, w: 0,   stationary: true, noscale: true },
  hippo:      { lvl: 2, name: "L'Hippo de Pablo", icon: '🦛', hp: 30000, dmg: 34, speed: 84, r: 55, xp: 0, t: 1e9, w: 0, boss: true },
};
const ANNOUNCE_MSGS = {
  rat: '🐀 Les rats infestent la cuisine !',
  cafard: '🪳 Des cafards sortent des murs !',
  millepattes: '🐛 Un mille-pattes rampe sous les fourneaux !',
  chat: '🐈 Un chat de gouttière rôde… méfiance !',
  ratgeant: '🐀 UN RAT GÉANT DÉFONCE LA PORTE !',
  raton: '🦝 Le raton laveur veut sa revanche !',
  araignee: '🕷️ Des araignées descendent des arbres !',
  serpent: '🐍 Des serpents glissent entre les lianes !',
  singe: '🐒 Les singes défendent le labo !',
  singemerde: '💩 Singes hurleurs ! Gare à leurs projectiles…',
  crocodile: '🐊 UN CROCODILE SORT DU MARIGOT !',
  jaguar: '🐆 Le jaguar a senti votre odeur…',
};

// =================== ÉTAT ===================
let state = 'start'; // start | play | levelup | pause | over | victory
let time = 0, kills = 0, pendingLevels = 0;
let player, enemies, projectiles, puddles, effects, pickups, dmgTexts, particles, announcements;
let spawnTimer = 0, nextId = 1, shake = 0, announced = {};
let boss = null, bossProjs = [], bossSpawned = false, bossWarned = false, bonusTimer = 0;
const BOSS_TIME = 600;
const SLAM_R = 300;
let best = parseFloat(localStorage.getItem('cauchemar_best') || '0');
let best2 = parseFloat(localStorage.getItem('cauchemar_best2') || '0');
let level2Unlocked = localStorage.getItem('cauchemar_lvl2') === '1';
let currentLevel = 1;
let melonTimer = 0;
const aimWorld = { x: 0, y: 0 };

function xpNeedFor(lv) { return Math.floor(5 + (lv - 1) * 4 + Math.pow(lv - 1, 1.65)); }

function initGame() {
  player = {
    x: WORLD_W / 2, y: WORLD_H / 2, r: 16,
    hp: 100, maxHp: 100, speed: 200, aim: 0,
    level: 1, xp: 0, xpNeed: xpNeedFor(1),
    weapons: [makeWeapon(currentLevel === 2 ? 'machette' : 'poele')],
    hurtCd: 0, magnetR: 110, moving: false, boostT: 0,
  };
  enemies = []; projectiles = []; puddles = []; effects = [];
  pickups = []; dmgTexts = []; particles = []; announcements = [];
  time = 0; kills = 0; spawnTimer = 0.5; nextId = 1; shake = 0;
  pendingLevels = 0; announced = {};
  boss = null; bossProjs = []; bossSpawned = false; bossWarned = false;
  bonusTimer = 60 + Math.random() * 40;
  melonTimer = 8;
  kitchenGroup.visible = currentLevel === 1;
  jungleGroup.visible = currentLevel === 2;
  renderer.setClearColor(currentLevel === 2 ? 0x0c140b : 0x171310);
}

// =================== ENTRÉES ===================
const keys = new Set();
const mouse = { x: VW / 2, y: VH / 2 };
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  // touches de déplacement : le joueur repasse au clavier, la visée revient à la souris
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) padMode = false;
  if (e.code === 'KeyM') muted = !muted;
  if ((e.code === 'KeyP' || e.code === 'Escape') && (state === 'play' || state === 'pause')) {
    state = state === 'play' ? 'pause' : 'play';
  }
  if (e.code === 'Enter' && (state === 'start' || state === 'over')) startGame();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { if (state === 'play') state = 'pause'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') state = 'pause'; });
addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  // souris réellement utilisée (pas un événement synthétique post-tap) : retour au mode clavier/souris
  if (performance.now() - lastTouchAt > 800) {
    if (isTouch) setTouchMode(false);
    padMode = false;
  }
});

// =================== TACTILE (MOBILE) ===================
// joysticks virtuels dynamiques : gauche = déplacement, droit = visée.
// Sans stick droit, visée automatique sur l'ennemi le plus proche.
const STICK_R = 60;        // course maximale du joystick (px)
const AIM_DIST = 460;      // portée de visée avec le stick droit (unités monde)
const moveStick = { id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
const aimStick = { id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
let isTouch = matchMedia('(pointer: coarse)').matches;
let lastTouchAt = -1e9;

function setTouchMode(on) {
  isTouch = on;
  document.body.classList.toggle('touch', on);
  if (!on) releaseSticks();
}
function releaseSticks() {
  moveStick.id = aimStick.id = null;
  moveStick.dx = moveStick.dy = aimStick.dx = aimStick.dy = 0;
}
if (isTouch) document.body.classList.add('touch');

// boutons du HUD tactile (pause / son), en haut à droite sous la barre d'XP
const TBTN_R = 24;
const touchBtnPause = () => ({ x: VW - 38, y: 52 });
const touchBtnMute = () => ({ x: VW - 96, y: 52 });
const inTouchBtn = (t, b) => dist2(t.clientX, t.clientY, b.x, b.y) < (TBTN_R + 14) * (TBTN_R + 14);

glCanvas.addEventListener('touchstart', e => {
  e.preventDefault();
  lastTouchAt = performance.now();
  if (!isTouch) setTouchMode(true);
  padMode = false;
  for (const t of e.changedTouches) {
    if (state === 'play' || state === 'pause') {
      if (inTouchBtn(t, touchBtnPause())) { state = state === 'play' ? 'pause' : 'play'; continue; }
      if (inTouchBtn(t, touchBtnMute())) { muted = !muted; continue; }
    }
    if (state === 'pause') { state = 'play'; continue; }
    if (state !== 'play') continue;
    const stick = t.clientX < VW / 2 ? moveStick : aimStick;
    if (stick.id === null) {
      stick.id = t.identifier;
      stick.cx = t.clientX; stick.cy = t.clientY;
      stick.dx = 0; stick.dy = 0;
    }
  }
}, { passive: false });

glCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    for (const s of [moveStick, aimStick]) {
      if (s.id !== t.identifier) continue;
      let dx = t.clientX - s.cx, dy = t.clientY - s.cy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) {
        // au-delà de la course : le centre suit le doigt (changements de direction plus souples)
        s.cx = t.clientX - dx / d * STICK_R;
        s.cy = t.clientY - dy / d * STICK_R;
        dx = dx / d * STICK_R; dy = dy / d * STICK_R;
      }
      s.dx = dx / STICK_R; s.dy = dy / STICK_R;
    }
  }
}, { passive: false });

function touchRelease(e) {
  e.preventDefault();
  lastTouchAt = performance.now();
  for (const t of e.changedTouches) {
    for (const s of [moveStick, aimStick]) {
      if (s.id === t.identifier) { s.id = null; s.dx = s.dy = 0; }
    }
  }
}
glCanvas.addEventListener('touchend', touchRelease, { passive: false });
glCanvas.addEventListener('touchcancel', touchRelease, { passive: false });
glCanvas.addEventListener('contextmenu', e => e.preventDefault());

// en portrait sur tactile, l'overlay #rotate masque le jeu : on met en pause
addEventListener('resize', () => {
  if (isTouch && innerHeight > innerWidth && state === 'play') state = 'pause';
});

// plein écran + verrouillage paysage. Safari iOS (16.4+) n'expose parfois que la
// version préfixée webkit ; en dessous, seul l'ajout à l'écran d'accueil masque la barre.
function tryLockLandscape() {
  if (!isTouch) return;
  try {
    const el = document.documentElement;
    const inFs = document.fullscreenElement || document.webkitFullscreenElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    const fs = !inFs && req ? req.call(el, { navigationUI: 'hide' }) : null;
    Promise.resolve(fs)
      .then(() => screen.orientation && screen.orientation.lock ? screen.orientation.lock('landscape') : null)
      .catch(() => {});
  } catch (_) { /* non supporté */ }
}

// astuce iOS : hors mode standalone, la barre de Safari ne peut pas toujours être masquée ;
// proposer l'ajout à l'écran d'accueil (lancement sans interface navigateur)
{
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true
    || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (isIOS && !standalone) document.getElementById('iosTip').classList.remove('hidden');
}

// =================== MANETTE (GAMEPAD) ===================
// Stick gauche / croix : se déplacer · stick droit : viser (sinon visée auto) ·
// A : commencer / choisir une carte · Start : pause · Select : couper le son.
// Mappage « standard » du Gamepad API (Xbox, PlayStation, Backbone, Kishi…).
const PAD_DEAD = 0.22;
let padMode = false, padSeen = false, padSel = -1, padPrevPushX = 0;
const padMove = { x: 0, y: 0 };
const padAim = { x: 0, y: 0 };
const padPrev = [];

// zone morte radiale, magnitude relissée sur [0,1]
function padDeadzone(x, y, out) {
  const m = Math.hypot(x, y);
  if (m < PAD_DEAD) { out.x = 0; out.y = 0; return; }
  const k = Math.min(1, (m - PAD_DEAD) / (1 - PAD_DEAD)) / m;
  out.x = x * k; out.y = y * k;
}

function pollGamepad() {
  let gp = null;
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) { if (p && p.connected) { gp = p; break; } }
  } catch (_) { /* API indisponible */ }
  if (!gp) {
    padMove.x = padMove.y = padAim.x = padAim.y = 0;
    padMode = false;
    return;
  }
  if (!padSeen) { padSeen = true; document.body.classList.add('pad'); }

  padDeadzone(gp.axes[0] || 0, gp.axes[1] || 0, padMove);
  padDeadzone(gp.axes[2] || 0, gp.axes[3] || 0, padAim);

  const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const justPressed = i => pressed(i) && !padPrev[i];

  // poussée horizontale du stick seul (front montant, pour naviguer entre les cartes)
  const pushX = padMove.x > 0.5 ? 1 : padMove.x < -0.5 ? -1 : 0;

  // croix directionnelle = déplacement aussi
  if (pressed(14)) padMove.x = -1;
  if (pressed(15)) padMove.x = 1;
  if (pressed(12)) padMove.y = -1;
  if (pressed(13)) padMove.y = 1;

  let anyInput = !!(padMove.x || padMove.y || padAim.x || padAim.y);
  for (let i = 0; i < gp.buttons.length && !anyInput; i++) anyInput = pressed(i);
  if (anyInput) padMode = true;

  if (justPressed(9) && (state === 'play' || state === 'pause')) state = state === 'play' ? 'pause' : 'play';
  if (justPressed(8)) muted = !muted;

  // A : commencer / reprendre / valider la carte sélectionnée
  if (justPressed(0)) {
    if (state === 'start' || state === 'over' || state === 'victory') startGame();
    else if (state === 'pause') state = 'play';
    else if (state === 'levelup') {
      const cards = elCards.children;
      if (cards.length) cards[Math.max(0, padSel)].click();
    }
  }

  // navigation entre les cartes d'amélioration (croix ou stick gauche)
  if (state === 'levelup') {
    const dir = justPressed(15) || (pushX === 1 && padPrevPushX !== 1) ? 1
      : justPressed(14) || (pushX === -1 && padPrevPushX !== -1) ? -1 : 0;
    if (dir) {
      const cards = elCards.children;
      if (cards.length) {
        padSel = padSel < 0 ? (dir > 0 ? 0 : cards.length - 1) : (padSel + dir + cards.length) % cards.length;
        for (let i = 0; i < cards.length; i++) cards[i].classList.toggle('selected', i === padSel);
      }
    }
  }

  padPrevPushX = pushX;
  for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = gp.buttons[i].pressed;
}

addEventListener('gamepadconnected', () => {
  padSeen = true;
  document.body.classList.add('pad');
  if (state === 'play') announcements.push({ txt: '🎮 Manette connectée', ttl: 3 });
});
addEventListener('gamepaddisconnected', () => {
  let any = false;
  try {
    for (const p of navigator.getGamepads()) if (p && p.connected) any = true;
  } catch (_) {}
  if (!any) {
    if (padMode && state === 'play') state = 'pause'; // manette débranchée en pleine partie
    padMode = false; padSeen = false;
    document.body.classList.remove('pad');
  }
});

// visée : rayon caméra -> plan du sol
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const rayHit = new THREE.Vector3();
function updateCameraAndAim() {
  camera.position.set(player.x, CAM_H, player.y + CAM_ZOFF);
  camera.lookAt(player.x, 0, player.y);
  // écran droit = monde +x, écran bas = monde +y : les sticks donnent directement l'angle
  if (padMode && (padAim.x || padAim.y)) {
    player.aim = Math.atan2(padAim.y, padAim.x);
    aimWorld.x = player.x + Math.cos(player.aim) * AIM_DIST;
    aimWorld.y = player.y + Math.sin(player.aim) * AIM_DIST;
    return;
  }
  if (isTouch && aimStick.id !== null && (aimStick.dx || aimStick.dy)) {
    player.aim = Math.atan2(aimStick.dy, aimStick.dx);
    aimWorld.x = player.x + Math.cos(player.aim) * AIM_DIST;
    aimWorld.y = player.y + Math.sin(player.aim) * AIM_DIST;
    return;
  }
  if (isTouch || padMode) {
    // visée automatique : la vermine vivante la plus proche
    let tgt = null, bd = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = dist2(e.x, e.y, player.x, player.y);
      if (d < bd) { bd = d; tgt = e; }
    }
    if (tgt) {
      aimWorld.x = tgt.x; aimWorld.y = tgt.y;
      player.aim = Math.atan2(aimWorld.y - player.y, aimWorld.x - player.x);
    }
    return;
  }
  ndc.set((mouse.x / VW) * 2 - 1, -((mouse.y / VH) * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.ray.intersectPlane(floorPlane, rayHit)) {
    aimWorld.x = rayHit.x;
    aimWorld.y = rayHit.z;
    player.aim = Math.atan2(aimWorld.y - player.y, aimWorld.x - player.x);
  }
}

// =================== GRILLE SPATIALE ===================
const CELL = 100;
const gridMap = new Map();
function gridRebuild() {
  gridMap.clear();
  for (const e of enemies) {
    const k = ((e.x / CELL) | 0) * 100000 + ((e.y / CELL) | 0);
    let a = gridMap.get(k);
    if (!a) { a = []; gridMap.set(k, a); }
    a.push(e);
  }
}
function gridQuery(x, y, r, cb) {
  const x0 = ((x - r) / CELL) | 0, x1 = ((x + r) / CELL) | 0;
  const y0 = ((y - r) / CELL) | 0, y1 = ((y + r) / CELL) | 0;
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const a = gridMap.get(cx * 100000 + cy);
      if (a) for (let i = 0; i < a.length; i++) cb(a[i]);
    }
  }
}

// =================== SPAWN ===================
function pickEnemyType() {
  let total = 0;
  const pool = [];
  for (const key in ENEMY_DEFS) {
    const d = ENEMY_DEFS[key];
    if ((d.lvl || 1) !== currentLevel) continue;
    if (time >= d.t) { pool.push([key, d.w]); total += d.w; }
  }
  let r = Math.random() * total;
  for (const [key, w] of pool) { r -= w; if (r <= 0) return key; }
  return pool[pool.length - 1][0];
}

function spawnEnemy() {
  const type = pickEnemyType();
  let x = 0, y = 0;
  for (let tries = 0; tries < 5; tries++) {
    const a = Math.random() * TAU;
    const dd = 950 + Math.random() * 250;
    x = clamp(player.x + Math.cos(a) * dd, WALL + 25, WORLD_W - WALL - 25);
    y = clamp(player.y + Math.sin(a) * dd, WALL + 25, WORLD_H - WALL - 25);
    if (dist2(x, y, player.x, player.y) > 400 * 400) break;
  }
  spawnEnemyAt(type, x, y);
}

function spawnEnemyAt(type, x, y) {
  if (enemies.length >= MAX_ENEMIES) return;
  const d = ENEMY_DEFS[type];
  x = clamp(x, WALL + 25, WORLD_W - WALL - 25);
  y = clamp(y, WALL + 25, WORLD_H - WALL - 25);
  const hpMul = d.noscale ? 1 : currentLevel === 2
    ? 1 + time * 0.015 + Math.pow(time / 280, 2) * 0.5
    : 1 + time * 0.012 + Math.pow(time / 300, 2) * 0.35;
  const dmgMul = 1 + time * (currentLevel === 2 ? 0.0028 : 0.0022);
  const e = {
    id: nextId++, type, def: d,
    x, y, r: d.r,
    hp: d.hp * hpMul, maxHp: d.hp * hpMul,
    dmg: d.dmg * dmgMul, speed: d.speed * (0.9 + Math.random() * 0.2),
    xp: d.xp,
    kvx: 0, kvy: 0, atkCd: 0, hitFlash: 0, beaterCd: 0, slowT: 0,
    vx: 0, vy: 0, dead: false, face: Math.random() * TAU,
    phase: Math.random() * TAU,
  };
  if (d.segments) {
    e.segs = [];
    for (let i = 0; i < d.segments; i++) e.segs.push({ x: x, y: y });
  }
  if (d.dasher) { e.cstate = 'stalk'; e.ct = (d.stalkT || 1) + Math.random() * 1.5; e.dashAng = 0; }
  if (d.enrage) { e.et = 5; e.enraged = false; }
  enemies.push(e);
}

// =================== BOSS : PHILIPPE CHUILEBEST / L'HIPPO DE PABLO ===================
function startBossFight() {
  bossSpawned = true;
  // la vermine détale, place au boss
  enemies = [];
  bossProjs = [];
  const key = currentLevel === 2 ? 'hippo' : 'boss';
  const d = ENEMY_DEFS[key];
  const bx = player.x < WORLD_W / 2 ? player.x + 650 : player.x - 650;
  const by = player.y < WORLD_H / 2 ? player.y + 450 : player.y - 450;
  boss = {
    id: nextId++, type: key, def: d,
    x: clamp(bx, WALL + d.r, WORLD_W - WALL - d.r),
    y: clamp(by, WALL + d.r, WORLD_H - WALL - d.r),
    r: d.r, hp: d.hp, maxHp: d.hp, dmg: d.dmg, speed: d.speed, xp: 0,
    kvx: 0, kvy: 0, atkCd: 0, hitFlash: 0, beaterCd: 0, slowT: 0,
    vx: 0, vy: 0, dead: false, face: 0, phase: 0,
    bstate: 'walk', bt: 2.5, lastAtk: '', volleys: 0, pv: 0, dashAng: 0, healAcc: 0,
  };
  enemies.push(boss);
  if (currentLevel === 2) {
    announcements.push({ txt: "🦛 L'HIPPO DE PABLO DÉBARQUE !", ttl: 5 });
    announcements.push({ txt: '« PERSONNE NE QUITTE MON LABO ! »', ttl: 5 });
    announcements.push({ txt: "🍉 Détruisez ses pastèques avant qu'il ne les dévore !", ttl: 7 });
    melonTimer = 6;
  } else {
    announcements.push({ txt: '👨‍🍳 PHILIPPE CHUILEBEST ENTRE EN CUISINE !', ttl: 5 });
    announcements.push({ txt: '« ON VA VOIR SI VOUS TENEZ LE SERVICE ! »', ttl: 5 });
  }
  shake = 14;
  beep(80, 40, 1.2, 'sawtooth', 0.15);
  setTimeout(() => beep(60, 35, 1.2, 'sawtooth', 0.15), 400);
}

function bossWalkDur() { return 1.4 + Math.random() * 1.2; }

function pickBossAttack(e) {
  const atks = e.type === 'hippo' ? ['vomit', 'charge', 'slam'] : ['plates', 'charge', 'slam', 'summon'];
  const pool = atks.filter(a => a !== e.lastAtk);
  const atk = pool[Math.floor(Math.random() * pool.length)];
  e.lastAtk = atk;
  if (atk === 'plates') { e.bstate = 'plates'; e.bt = 1.6; e.volleys = 3; e.pv = 0.1; }
  else if (atk === 'vomit') { e.bstate = 'vomitTele'; e.bt = 0.8; beep(90, 45, 0.6, 'sawtooth', 0.09); }
  else if (atk === 'charge') { e.bstate = 'chargeTele'; e.bt = 0.8; beep(160, 320, 0.4, 'triangle', 0.08); }
  else if (atk === 'slam') { e.bstate = 'slamTele'; e.bt = 1.1; beep(140, 100, 0.5, 'triangle', 0.08); }
  else { e.bstate = 'summon'; e.bt = 0.9; }
}

function updateBoss(e, dt) {
  e.atkCd = Math.max(0, e.atkCd - dt);
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  e.beaterCd = Math.max(0, e.beaterCd - dt);
  e.slowT = Math.max(0, e.slowT - dt);
  e.kvx *= Math.max(0, 1 - 7 * dt);
  e.kvy *= Math.max(0, 1 - 7 * dt);

  const enraged = e.hp < e.maxHp * 0.3;
  const spd = enraged ? 1.35 : 1;
  const dx = player.x - e.x, dy = player.y - e.y;
  const dd = Math.hypot(dx, dy) || 1;
  e.bt -= dt * (enraged ? 1.2 : 1);

  switch (e.bstate) {
    case 'walk': {
      // l'hippo plonge dès qu'une pastèque pousse : il nage la dévorer
      if (e.type === 'hippo' && enemies.some(o => o.type === 'pasteque' && !o.dead)) {
        e.bstate = 'swim';
        e.rippleT = 0;
        splat(e.x, e.y, '#7fb6c9', 14);
        beep(220, 55, 0.4, 'sine', 0.11);
        break;
      }
      e.face = Math.atan2(dy, dx);
      e.x += (dx / dd) * e.speed * spd * dt;
      e.y += (dy / dd) * e.speed * spd * dt;
      if (e.bt <= 0) pickBossAttack(e);
      break;
    }
    case 'swim': {
      // sous l'eau : invulnérable, seule la tête dépasse, cap sur la pastèque
      const melon = enemies.find(o => o.type === 'pasteque' && !o.dead);
      if (!melon) {
        e.bstate = 'walk';
        e.bt = bossWalkDur();
        splat(e.x, e.y, '#7fb6c9', 12);
        beep(70, 240, 0.35, 'sine', 0.1);
        break;
      }
      const mx = melon.x - e.x, my = melon.y - e.y;
      const md = Math.hypot(mx, my) || 1;
      e.face = Math.atan2(my, mx);
      const swimSp = e.speed * 2.1 * spd;
      e.x += (mx / md) * swimSp * dt;
      e.y += (my / md) * swimSp * dt;
      e.rippleT = (e.rippleT || 0) - dt;
      if (e.rippleT <= 0) {
        e.rippleT = 0.3;
        effects.push({ kind: 'shock', x: e.x, y: e.y, t: 0, dur: 0.7, range: 95, color: 0x9ecfdd });
      }
      if (md < e.r + melon.r) {
        melon.dead = true;
        const chunk = e.maxHp * 0.09;
        e.hp = Math.min(e.maxHp, e.hp + chunk);
        addDmgText(e.x, e.y, '+' + Math.round(chunk), '#7dde7d', 22);
        announcements.push({ txt: '🦛 MIAM ! La pastèque est engloutie !', ttl: 3 });
        beep(150, 60, 0.4, 'square', 0.12);
        e.bstate = 'walk';
        e.bt = bossWalkDur();
      }
      break;
    }
    case 'plates':
      e.face = Math.atan2(dy, dx);
      e.pv -= dt;
      if (e.pv <= 0 && e.volleys > 0) {
        e.volleys--;
        e.pv = 0.5;
        const n = enraged ? 9 : 7, spread = 1.15;
        for (let i = 0; i < n; i++) {
          const a = e.face - spread / 2 + (spread * i) / (n - 1);
          bossProjs.push({
            x: e.x + Math.cos(a) * 70, y: e.y + Math.sin(a) * 70,
            vx: Math.cos(a) * 330, vy: Math.sin(a) * 330,
            r: 13, dmg: 14, ttl: 3.2,
          });
        }
        beep(520, 300, 0.1, 'triangle', 0.06);
      }
      if (e.bt <= 0) { e.bstate = 'walk'; e.bt = bossWalkDur(); }
      break;
    case 'chargeTele':
      e.face = Math.atan2(dy, dx);
      if (e.bt <= 0) {
        e.bstate = 'charge';
        e.bt = 1.5;
        e.dashAng = e.face;
        beep(200, 620, 0.3, 'sawtooth', 0.1);
      }
      break;
    case 'charge': {
      const sp = (e.type === 'hippo' ? 790 : 640) * spd;
      e.x += Math.cos(e.dashAng) * sp * dt;
      e.y += Math.sin(e.dashAng) * sp * dt;
      const hitWall = e.x <= WALL + e.r || e.x >= WORLD_W - WALL - e.r || e.y <= WALL + e.r || e.y >= WORLD_H - WALL - e.r;
      if (hitWall || e.bt <= 0) {
        if (hitWall) {
          shake = Math.min(16, shake + 12);
          beep(90, 40, 0.4, 'square', 0.14);
          splat(e.x, e.y, '#9aa5b1', 12);
        }
        e.bstate = 'stun';
        e.bt = 1.1;
      }
      break;
    }
    case 'stun':
      if (e.bt <= 0) { e.bstate = 'walk'; e.bt = bossWalkDur(); }
      break;
    case 'slamTele':
      e.face = Math.atan2(dy, dx);
      if (e.bt <= 0) {
        e.bstate = 'walk';
        e.bt = bossWalkDur();
        effects.push({ kind: 'shock', x: e.x, y: e.y, t: 0, dur: 0.5, range: SLAM_R });
        shake = Math.min(18, shake + 14);
        beep(70, 30, 0.5, 'square', 0.16);
        if (dist2(player.x, player.y, e.x, e.y) < SLAM_R * SLAM_R) damagePlayer(32);
      }
      break;
    case 'vomitTele':
      e.face = Math.atan2(dy, dx);
      if (e.bt <= 0) { e.bstate = 'vomit'; e.bt = 1.5; e.volleys = 3; e.pv = 0.1; }
      break;
    case 'vomit':
      e.face = Math.atan2(dy, dx);
      e.pv -= dt;
      if (e.pv <= 0 && e.volleys > 0) {
        e.volleys--;
        e.pv = 0.45;
        // mortier de boulettes de dollars digérés : chaque obus vise une zone
        // marquée au sol autour du joueur, à esquiver avant l'impact
        const n = enraged ? 8 : 5;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const d0 = 40 + Math.random() * 230;
          const tx = clamp(player.x + Math.cos(a) * d0, WALL + 40, WORLD_W - WALL - 40);
          const ty = clamp(player.y + Math.sin(a) * d0, WALL + 40, WORLD_H - WALL - 40);
          const x0 = e.x + Math.cos(e.face) * 70, y0 = e.y + Math.sin(e.face) * 70;
          const fly = 1.05 + Math.random() * 0.55;
          bossProjs.push({
            kind: 'bill', mortar: true, zoneR: 62,
            x: x0, y: y0, tx, ty,
            vx: (tx - x0) / fly, vy: (ty - y0) / fly,
            r: 20, dmg: 18, ttl: fly, ttl0: fly,
          });
        }
        beep(90, 260, 0.25, 'sawtooth', 0.1);
        splat(e.x + Math.cos(e.face) * 80, e.y + Math.sin(e.face) * 80, '#66bb6a', 5);
      }
      if (e.bt <= 0) { e.bstate = 'walk'; e.bt = bossWalkDur(); }
      break;
    case 'summon':
      if (e.bt <= 0) {
        e.bstate = 'walk';
        e.bt = bossWalkDur();
        const types = ['souris', 'rat', 'cafard'];
        const n = enraged ? 14 : 10;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          spawnEnemyAt(types[Math.floor(Math.random() * types.length)],
            e.x + Math.cos(a) * (130 + Math.random() * 130),
            e.y + Math.sin(a) * (130 + Math.random() * 130));
        }
        announcements.push({ txt: "« ET C'EST PAS TERMINÉ ! »", ttl: 2.5 });
        beep(110, 220, 0.5, 'sawtooth', 0.1);
      }
      break;
  }

  e.x = clamp(e.x, WALL + e.r, WORLD_W - WALL - e.r);
  e.y = clamp(e.y, WALL + e.r, WORLD_H - WALL - e.r);

  // contact avec le joueur (pas sous l'eau)
  if (e.bstate !== 'swim' && e.atkCd <= 0 && dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) * (e.r + player.r)) {
    damagePlayer(e.bstate === 'charge' ? e.dmg * 1.4 : e.dmg);
    e.atkCd = 0.8;
  }
}

// =================== DÉGÂTS ===================
function addDmgText(x, y, txt, color = '#fff', size = 15) {
  if (dmgTexts.length > 110) return;
  dmgTexts.push({ x: x + (Math.random() - 0.5) * 14, y, txt, color, size, ttl: 0.7, ttl0: 0.7 });
}

function splat(x, y, color, n = 6) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = 40 + Math.random() * 140;
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      h: 8 + Math.random() * 12, vh: 50 + Math.random() * 90,
      ttl: 0.4 + Math.random() * 0.3, ttl0: 0.6, color,
    });
  }
}

function damageEnemy(e, dmg, kx = 0, ky = 0, silent = false) {
  if (e.dead) return;
  if (e.def.boss && e.bstate === 'swim') {
    // l'hippo sous l'eau est intouchable
    if (!silent && Math.random() < 0.25) addDmgText(e.x, e.y, 'PLOUF', '#9ecfdd', 13);
    return;
  }
  e.hp -= dmg;
  e.hitFlash = 0.1;
  const kb = e.def.boss ? 0.04 : 1; // le boss ne recule presque pas
  e.kvx += kx * kb; e.kvy += ky * kb;
  addDmgText(e.x, e.y, Math.round(dmg), '#ffe08a');
  if (!silent) sndHit();
  if (e.hp <= 0) {
    e.dead = true;
    kills++;
    if (e.def.boss) { victory(); return; }
    sndKill();
    splat(e.x, e.y, e.type === 'cafard' ? '#5a7a2e' : '#7a2e2e', 8);
    pickups.push({ x: e.x, y: e.y, kind: 'cheese', v: e.xp, bob: Math.random() * TAU });
    if (Math.random() < 0.015) pickups.push({ x: e.x + 12, y: e.y, kind: 'soup', bob: 0 });
  }
}

function damagePlayer(dmg) {
  if (player.hurtCd > 0) return;
  player.hurtCd = 0.35;
  player.hp -= dmg;
  shake = Math.min(14, shake + 8);
  sndHurt();
  addDmgText(player.x, player.y, '-' + Math.round(dmg), '#ff6b5e', 18);
  if (player.hp <= 0) { player.hp = 0; gameOver(); }
}

function heal(amount) {
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + amount);
  const gained = Math.round(player.hp - before);
  if (gained > 0) addDmgText(player.x, player.y, '+' + gained, '#7dde7d', 18);
}

// =================== XP / NIVEAUX ===================
function gainXp(v) {
  player.xp += v;
  while (player.xp >= player.xpNeed) {
    player.xp -= player.xpNeed;
    player.level++;
    player.xpNeed = xpNeedFor(player.level);
    pendingLevels++;
  }
  if (pendingLevels > 0 && state === 'play') openLevelUp();
}

function buildOptions() {
  const opts = [];
  for (const w of player.weapons) {
    const def = WEAPON_DEFS[w.type];
    if (w.level < MAX_WEAPON_LEVEL) {
      opts.push({
        weight: 10, icon: def.icon, tag: `Niveau ${w.level + 1}`,
        title: def.name,
        desc: '+22% de dégâts, +7% de cadence' + (w.type === 'batteur' && (w.level % 2 === 0) ? ', +1 fouet' : '') + (def.up ? ', ' + def.up : ''),
        act: () => w.level++,
      });
    }
  }
  if (player.weapons.length < MAX_WEAPONS) {
    for (const t in WEAPON_DEFS) {
      if ((WEAPON_DEFS[t].lvl || 1) !== currentLevel) continue;
      if (!player.weapons.some(w => w.type === t)) {
        const def = WEAPON_DEFS[t];
        opts.push({
          weight: 8, icon: def.icon, tag: 'Nouvelle arme',
          title: def.name, desc: def.desc,
          act: () => player.weapons.push(makeWeapon(t)),
        });
      }
    }
  }
  opts.push({
    weight: 6, icon: '👟', tag: 'Chef', title: 'Coup de fouet',
    desc: '+8% de vitesse de déplacement.',
    act: () => player.speed *= 1.08,
  });
  opts.push({
    weight: 6, icon: '❤️', tag: 'Chef', title: 'Bon repas',
    desc: '+20 PV max, et récupère 20 PV.',
    act: () => { player.maxHp += 20; heal(20); },
  });
  if (player.hp < player.maxHp * 0.7) {
    opts.push({
      weight: 4, icon: currentLevel === 2 ? '🥟' : '🍲', tag: 'Rare',
      title: currentLevel === 2 ? 'Empanada géante' : 'Soupe du jour',
      desc: 'Récupère 50% de vos PV max.',
      act: () => heal(player.maxHp * 0.5),
    });
  }

  // tirage pondéré de 3 options distinctes
  const chosen = [];
  const pool = opts.slice();
  while (chosen.length < 3 && pool.length > 0) {
    let total = 0;
    for (const o of pool) total += o.weight;
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r <= 0) { idx = i; break; } }
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen;
}

const elLevelup = document.getElementById('levelup');
const elCards = document.getElementById('cards');
function openLevelUp() {
  state = 'levelup';
  sndLevel();
  elCards.innerHTML = '';
  for (const opt of buildOptions()) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<span class="ic">${opt.icon}</span><h3>${opt.title}</h3><p>${opt.desc}</p><span class="tag">${opt.tag}</span>`;
    card.addEventListener('click', () => {
      opt.act();
      pendingLevels--;
      beep(500, 700, 0.1, 'sine', 0.06);
      if (pendingLevels > 0) openLevelUp();
      else { elLevelup.classList.add('hidden'); state = 'play'; }
    });
    elCards.appendChild(card);
  }
  // à la manette : première carte présélectionnée, navigation stick/croix + A
  padSel = padMode ? 0 : -1;
  if (padSel === 0) elCards.firstChild.classList.add('selected');
  elLevelup.classList.remove('hidden');
}

// =================== ARMES : TIR ===================
function nearestEnemy(x, y, maxR) {
  let bestE = null, bestD = maxR * maxR;
  for (const e of enemies) {
    if (e.dead || (e.def.boss && e.bstate === 'swim')) continue; // pas de visée sur l'hippo sous l'eau
    const d = dist2(x, y, e.x, e.y);
    if (d < bestD) { bestD = d; bestE = e; }
  }
  return bestE;
}

function fireWeapons(dt) {
  for (const w of player.weapons) {
    const st = wstat(w);
    w.cd -= dt;

    switch (w.type) {
      case 'poele': {
        if (w.cd <= 0) {
          const range = st.range * st.area;
          const e = nearestEnemy(player.x, player.y, range);
          if (e) {
            const ang = Math.atan2(e.y - player.y, e.x - player.x);
            damageEnemy(e, st.dmg, Math.cos(ang) * st.knock, Math.sin(ang) * st.knock);
            effects.push({ kind: 'swing', ang, t: 0, dur: 0.18, range });
            beep(180, 90, 0.08, 'square', 0.05);
            w.cd = st.cd;
          } else w.cd = 0.1;
        }
        break;
      }
      case 'couteau': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          projectiles.push({
            kind: 'knife', x: player.x, y: player.y,
            vx: Math.cos(player.aim) * st.speed, vy: Math.sin(player.aim) * st.speed,
            r: 10, dmg: st.dmg, pierce: st.pierce, knock: 80,
            ttl: 1.3, hit: new Set(), bounces: 0,
          });
          beep(700, 500, 0.05, 'triangle', 0.03);
        }
        break;
      }
      case 'hachoir': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          const range = st.range * st.area;
          let touched = false;
          gridQuery(player.x, player.y, range + 110, e => {
            if (e.dead) return;
            if (dist2(e.x, e.y, player.x, player.y) < (range + e.r) * (range + e.r)) {
              const ang = Math.atan2(e.y - player.y, e.x - player.x);
              damageEnemy(e, st.dmg, Math.cos(ang) * 60, Math.sin(ang) * 60, true);
              touched = true;
            }
          });
          if (touched) sndHit();
          effects.push({ kind: 'pulse', t: 0, dur: 0.25, range });
        }
        break;
      }
      case 'chalumeau': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          effects.push({ kind: 'torch', t: 0, dur: st.dur, tickT: 0, tick: st.tick, dmg: st.dmg, len: st.len * st.area });
          beep(120, 80, 0.3, 'sawtooth', 0.04);
        }
        break;
      }
      case 'electrique': {
        if (w.cd <= 0) {
          const range = st.range * st.area;
          const first = nearestEnemy(player.x, player.y, range);
          if (!first) { w.cd = 0.15; break; }
          w.cd = st.cd;
          const targets = [first];
          let cur = first;
          for (let j = 0; j < st.jumps; j++) {
            let nxt = null, bd = st.jumpRange * st.jumpRange;
            for (const e of enemies) {
              if (e.dead || targets.includes(e)) continue;
              const d = dist2(cur.x, cur.y, e.x, e.y);
              if (d < bd) { bd = d; nxt = e; }
            }
            if (!nxt) break;
            targets.push(nxt);
            cur = nxt;
          }
          const pts = [{ x: player.x, y: player.y }];
          targets.forEach((e, i) => {
            damageEnemy(e, st.dmg * Math.pow(0.82, i), 0, 0, true);
            pts.push({ x: e.x, y: e.y });
          });
          sndZap();
          effects.push({ kind: 'zap', t: 0, dur: 0.16, pts });
        }
        break;
      }
      case 'batteur': {
        w.angle += st.rotSpeed * dt;
        for (let i = 0; i < st.orbs; i++) {
          const a = w.angle + (i / st.orbs) * TAU;
          const ox = player.x + Math.cos(a) * st.radius * st.area;
          const oy = player.y + Math.sin(a) * st.radius * st.area;
          gridQuery(ox, oy, 130, e => {
            if (e.dead || e.beaterCd > 0) return;
            if (dist2(e.x, e.y, ox, oy) < (16 + e.r) * (16 + e.r)) {
              const ang = Math.atan2(e.y - oy, e.x - ox);
              damageEnemy(e, st.dmg, Math.cos(ang) * 180, Math.sin(ang) * 180);
              e.beaterCd = st.hitCd;
            }
          });
        }
        break;
      }
      case 'siphon': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          const range = Math.min(st.throwRange, Math.hypot(aimWorld.x - player.x, aimWorld.y - player.y));
          const speed = 420;
          const ttl = Math.max(0.15, range / speed);
          projectiles.push({
            kind: 'glob', x: player.x, y: player.y,
            vx: Math.cos(player.aim) * speed, vy: Math.sin(player.aim) * speed,
            r: 9, noHit: true, ttl, ttl0: ttl,
            puddle: { r: st.puddleR * st.area, dur: st.dur, dps: st.dmg },
          });
          beep(300, 500, 0.08, 'sine', 0.04);
        }
        break;
      }
      case 'champagne': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          projectiles.push({
            kind: 'cork', x: player.x, y: player.y,
            vx: Math.cos(player.aim) * st.speed, vy: Math.sin(player.aim) * st.speed,
            r: 8, dmg: st.dmg, pierce: st.pierce, knock: st.knock,
            ttl: 2.2, hit: new Set(), bounces: st.bounces,
          });
          sndPop();
          shake = Math.min(10, shake + 3);
        }
        break;
      }
      case 'machette': {
        if (w.cd <= 0) {
          const range = st.range * st.area;
          if (nearestEnemy(player.x, player.y, range)) {
            let touched = 0;
            gridQuery(player.x, player.y, range + 110, e => {
              if (e.dead) return;
              if (dist2(e.x, e.y, player.x, player.y) > (range + e.r) * (range + e.r)) return;
              const ea = Math.atan2(e.y - player.y, e.x - player.x);
              if (Math.abs(adiff(ea, player.aim)) > st.cone / 2) return;
              damageEnemy(e, st.dmg, Math.cos(ea) * st.knock, Math.sin(ea) * st.knock, true);
              touched++;
            });
            if (touched) sndHit();
            effects.push({ kind: 'swing', ang: player.aim, t: 0, dur: 0.16, range });
            beep(240, 120, 0.07, 'square', 0.05);
            w.cd = st.cd;
          } else w.cd = 0.1;
        }
        break;
      }
      case 'sarbacane': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          for (let i = 0; i < st.darts; i++) {
            const a = player.aim + (st.darts > 1 ? (i / (st.darts - 1) - 0.5) * st.spread * (st.darts - 1) : 0);
            projectiles.push({
              kind: 'dart', x: player.x, y: player.y,
              vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed,
              r: 8, dmg: st.dmg, pierce: 0, knock: 40,
              poison: st.poison * Math.pow(1.18, w.level - 1),
              ttl: 1.1, hit: new Set(),
            });
          }
          beep(900, 1400, 0.06, 'sine', 0.04);
        }
        break;
      }
      case 'fouet': {
        if (w.cd <= 0) {
          const range = st.range * st.area;
          // claque automatiquement vers l'ennemi le plus proche
          const tgt = nearestEnemy(player.x, player.y, range);
          if (!tgt) { w.cd = 0.1; break; }
          w.cd = st.cd;
          const ang = Math.atan2(tgt.y - player.y, tgt.x - player.x);
          let touched = 0;
          gridQuery(player.x, player.y, range + 110, e => {
            if (e.dead) return;
            if (dist2(e.x, e.y, player.x, player.y) > (range + e.r) * (range + e.r)) return;
            const ea = Math.atan2(e.y - player.y, e.x - player.x);
            if (Math.abs(adiff(ea, ang)) > st.cone / 2) return;
            damageEnemy(e, st.dmg, Math.cos(ea) * st.knock, Math.sin(ea) * st.knock, true);
            touched++;
          });
          if (touched) sndHit();
          effects.push({ kind: 'whip', ang, t: 0, dur: 0.16, range, cone: st.cone });
          beep(1500, 90, 0.09, 'square', 0.07);
          shake = Math.min(8, shake + 1.5);
        }
        break;
      }
      case 'ak47': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          for (let i = 0; i < st.bullets; i++) {
            const a = player.aim + (Math.random() - 0.5) * st.spread;
            const sp = st.speed * (0.9 + Math.random() * 0.2);
            projectiles.push({
              kind: 'bullet', x: player.x, y: player.y,
              vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
              r: 7, dmg: st.dmg, pierce: 0, knock: 90,
              ttl: 1.6, hit: new Set(), delay: i * 0.05,
            });
          }
          beep(180, 90, 0.12, 'square', 0.07);
        }
        break;
      }
      case 'grenade': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          const range = Math.max(120, Math.min(st.throwRange, Math.hypot(aimWorld.x - player.x, aimWorld.y - player.y)));
          const speed = 380;
          const ttl = range / speed;
          projectiles.push({
            kind: 'nade', x: player.x, y: player.y,
            vx: Math.cos(player.aim) * speed, vy: Math.sin(player.aim) * speed,
            r: 8, noHit: true, ttl, ttl0: ttl,
            boom: { r: st.boomR * st.area, dmg: st.dmg, frags: st.frags, fire: st.fire, fireDps: st.fireDps * Math.pow(1.15, w.level - 1), gen: 0 },
          });
          beep(500, 300, 0.08, 'triangle', 0.04);
        }
        break;
      }
      case 'lanceflamme': {
        if (w.cd <= 0) {
          w.cd = st.cd;
          effects.push({ kind: 'flame', t: 0, dur: st.dur, tickT: 0, tick: st.tick, dmg: st.dmg, len: st.len * st.area, cone: st.cone });
          beep(110, 70, 0.35, 'sawtooth', 0.05);
        }
        break;
      }
      case 'pesticide': {
        if (w.cd <= 0) {
          const range = st.range * st.area;
          if (nearestEnemy(player.x, player.y, range)) {
            w.cd = st.cd;
            let touched = 0;
            gridQuery(player.x, player.y, range + 110, e => {
              if (e.dead) return;
              if (dist2(e.x, e.y, player.x, player.y) > (range + e.r) * (range + e.r)) return;
              const ea = Math.atan2(e.y - player.y, e.x - player.x);
              // les gros (boss, crocodiles, jaguars, pastèques…) ne reculent pas
              const push = !e.def.boss && e.r < 24 ? st.knock : 0;
              damageEnemy(e, st.dmg, Math.cos(ea) * push, Math.sin(ea) * push, true);
              e.slowT = Math.max(e.slowT, 0.8);
              e.poisonT = 3;
              e.poisonDps = Math.max(e.poisonDps || 0, st.poison * Math.pow(1.18, w.level - 1));
              touched++;
            });
            if (touched) sndHit();
            // vraie fumée : bouffées projetées en anneau qui gonflent et se dissipent
            for (let i = 0; i < 16; i++) {
              const a = (i / 16) * TAU + Math.random() * 0.5;
              const sp = range * 3.5 * (0.65 + Math.random() * 0.5);
              effects.push({
                kind: 'puff', t: 0, dur: 0.6 + Math.random() * 0.4,
                x: player.x + Math.cos(a) * 14, y: player.y + Math.sin(a) * 14,
                h: 6 + Math.random() * 16, vh: 20 + Math.random() * 25,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                r: 13 + Math.random() * 11,
              });
            }
            sndSpray();
          } else w.cd = 0.15;
        }
        break;
      }
    }
  }
}

// explosion de grenade : dégâts de zone, rebonds en éventail, feu au sol
function explodeNade(p) {
  p.dead = true;
  const b = p.boom;
  effects.push({ kind: 'boom', x: p.x, y: p.y, t: 0, dur: 0.35, range: b.r });
  splat(p.x, p.y, '#ffab40', 8);
  shake = Math.min(12, shake + 4);
  beep(110, 35, 0.3, 'square', 0.1);
  let touched = false;
  gridQuery(p.x, p.y, b.r + 120, e => {
    if (e.dead) return;
    if (dist2(e.x, e.y, p.x, p.y) < (b.r + e.r) * (b.r + e.r)) {
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      damageEnemy(e, b.dmg, Math.cos(a) * 260, Math.sin(a) * 260, true);
      touched = true;
    }
  });
  if (touched) sndHit();
  if (b.fire) {
    puddles.push({ x: p.x, y: p.y, r: b.r * 0.8, ttl: 3.5, dps: b.fireDps, tickT: 0, fire: true, seed: Math.random() * TAU });
  }
  if (b.frags > 0 && b.gen === 0) {
    for (let i = 0; i < b.frags; i++) {
      const a = (TAU * i) / b.frags + Math.random() * 0.6;
      const d = 110 + Math.random() * 90;
      const sp = 330;
      projectiles.push({
        kind: 'nade', x: p.x, y: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 7, noHit: true, ttl: d / sp, ttl0: d / sp,
        boom: { r: b.r * 0.7, dmg: b.dmg * 0.6, frags: 0, fire: b.fire, fireDps: b.fireDps, gen: 1 },
      });
    }
  }
}

// =================== MISE À JOUR ===================
function update(dt) {
  time += dt;

  // annonces de nouveaux ennemis
  for (const key in ENEMY_DEFS) {
    const d = ENEMY_DEFS[key];
    if ((d.lvl || 1) !== currentLevel) continue;
    if (d.t > 0 && time >= d.t && !announced[key]) {
      announced[key] = true;
      announcements.push({ txt: ANNOUNCE_MSGS[key] || `${d.icon} ${d.name} !`, ttl: 3.5 });
      beep(200, 400, 0.2, 'triangle', 0.06);
    }
  }

  // --- joueur ---
  let mx = 0, my = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) mx -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) mx += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) my -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) my += 1;
  if (moveStick.id !== null) { mx = moveStick.dx; my = moveStick.dy; }
  if (padMode && (padMove.x || padMove.y)) { mx = padMove.x; my = padMove.y; }
  player.moving = !!(mx || my);
  player.boostT = Math.max(0, player.boostT - dt);
  if (player.moving) {
    const n = Math.hypot(mx, my);
    // joystick analogique : vitesse proportionnelle · coke : gros boost temporaire
    const sp = player.speed * (player.boostT > 0 ? 1.55 : 1) * Math.min(1, n);
    player.x += (mx / n) * sp * dt;
    player.y += (my / n) * sp * dt;
    if (player.boostT > 0 && particles.length < 250 && Math.random() < dt * 24) {
      particles.push({
        x: player.x, y: player.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
        h: 10, vh: 30, ttl: 0.35, ttl0: 0.35, color: '#ffffff',
      });
    }
  }
  player.x = clamp(player.x, WALL + player.r, WORLD_W - WALL - player.r);
  player.y = clamp(player.y, WALL + player.r, WORLD_H - WALL - player.r);
  player.hurtCd = Math.max(0, player.hurtCd - dt);

  updateCameraAndAim();

  // --- boss ---
  if (!bossWarned && time >= BOSS_TIME - 10) {
    bossWarned = true;
    announcements.push({ txt: '⚠️ Quelque chose de GROS approche des cuisines…', ttl: 5 });
    beep(120, 60, 0.8, 'sawtooth', 0.1);
  }
  if (!bossSpawned && time >= BOSS_TIME) startBossFight();

  // --- pastèques : tant qu'il y en a une, l'Hippo de Pablo se régale et se soigne ---
  if (boss && !boss.dead && boss.type === 'hippo') {
    const melon = enemies.find(e => e.type === 'pasteque' && !e.dead);
    if (melon) {
      const rate = boss.maxHp * 0.013;
      boss.hp = Math.min(boss.maxHp, boss.hp + rate * dt);
      boss.healAcc += dt;
      if (boss.healAcc > 0.6) {
        boss.healAcc = 0;
        addDmgText(boss.x, boss.y, '+' + Math.round(rate * 0.6), '#7dde7d', 17);
      }
    } else {
      melonTimer -= dt;
      if (melonTimer <= 0) {
        melonTimer = 15;
        spawnEnemyAt('pasteque', WORLD_W / 2, WORLD_H / 2);
        announcements.push({ txt: '🍉 Une pastèque pousse au centre — détruisez-la !', ttl: 3.5 });
        beep(500, 700, 0.2, 'sine', 0.07);
      }
    }
  }

  // --- spawn (suspendu pendant le combat de boss) ---
  if (!boss) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = currentLevel === 2 ? Math.max(0.2, 0.72 - time * 0.0011) : Math.max(0.22, 0.8 - time * 0.001);
      const batch = 2 + Math.floor(time / (currentLevel === 2 ? 55 : 65));
      for (let i = 0; i < batch; i++) spawnEnemy();
    }
  }

  // --- bonus (aimant à fromage au niveau 1, sachet de coke au niveau 2) ---
  bonusTimer -= dt;
  if (bonusTimer <= 0) {
    bonusTimer = 55 + Math.random() * 45;
    const bonusKind = currentLevel === 2 ? 'coke' : 'aimant';
    if (pickups.filter(p => p.kind === bonusKind).length < 2) {
      for (let i = 0; i < 6; i++) {
        const x = WALL + 90 + Math.random() * (WORLD_W - 2 * WALL - 180);
        const y = WALL + 90 + Math.random() * (WORLD_H - 2 * WALL - 180);
        if (dist2(x, y, player.x, player.y) > 350 * 350) {
          pickups.push({ x, y, kind: bonusKind, bob: 0 });
          break;
        }
      }
    }
  }

  gridRebuild();

  // --- ennemis ---
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.def.boss) { updateBoss(e, dt); continue; }
    if (e.def.stationary) { e.hitFlash = Math.max(0, e.hitFlash - dt); continue; }
    e.atkCd = Math.max(0, e.atkCd - dt);
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.beaterCd = Math.max(0, e.beaterCd - dt);
    e.slowT = Math.max(0, e.slowT - dt);

    // poison de sarbacane
    if (e.poisonT > 0) {
      e.poisonT -= dt;
      e.poisonTick = (e.poisonTick || 0) - dt;
      if (e.poisonTick <= 0) {
        e.poisonTick = 0.5;
        damageEnemy(e, e.poisonDps * 0.5, 0, 0, true);
      }
      if (e.dead) continue;
    }

    // knockback
    e.x += e.kvx * dt; e.y += e.kvy * dt;
    e.kvx *= Math.max(0, 1 - 7 * dt);
    e.kvy *= Math.max(0, 1 - 7 * dt);

    const dx = player.x - e.x, dy = player.y - e.y;
    const dd = Math.hypot(dx, dy) || 1;
    let sp = e.speed * (e.slowT > 0 ? 0.7 : 1);
    let dirx = dx / dd, diry = dy / dd;

    if (e.def.jitter) {
      const j = Math.sin(time * 9 + e.phase) * 0.8;
      const px = -diry, py = dirx;
      dirx += px * j; diry += py * j;
      const n = Math.hypot(dirx, diry) || 1;
      dirx /= n; diry /= n;
    }

    if (e.def.segments) {
      const sway = Math.sin(time * 2.5 + e.phase) * 0.6;
      const px = -diry, py = dirx;
      dirx += px * sway; diry += py * sway;
      const n = Math.hypot(dirx, diry) || 1;
      dirx /= n; diry /= n;
    }

    if (e.def.dasher) {
      const D = e.def;
      e.ct -= dt;
      if (e.cstate === 'stalk') {
        if (e.ct <= 0) { e.cstate = 'windup'; e.ct = D.windup || 0.45; }
      } else if (e.cstate === 'windup') {
        sp = 0;
        if (e.ct <= 0) { e.cstate = 'dash'; e.ct = D.dashT || 0.38; e.dashAng = Math.atan2(dy, dx); }
      } else { // dash
        sp = e.speed * (D.dashMul || 4.2);
        dirx = Math.cos(e.dashAng); diry = Math.sin(e.dashAng);
        if (e.ct <= 0) { e.cstate = 'stalk'; e.ct = (D.stalkT || 1.2) + Math.random() * 1.2; }
      }
    }

    // singe hurleur : garde ses distances et bombarde
    if (e.def.ranged) {
      if (dd < 230) { dirx = -dirx; diry = -diry; }
      else if (dd < 400) {
        if (!e.strafe) e.strafe = Math.random() < 0.5 ? -1 : 1;
        const px = -diry, py = dirx;
        dirx = px * e.strafe; diry = py * e.strafe;
      }
      e.shootT = (e.shootT === undefined ? 1 + Math.random() * 1.5 : e.shootT) - dt;
      if (e.shootT <= 0 && dd < 560) {
        e.shootT = 2.4 + Math.random();
        const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.25;
        const psp = 270;
        const ttl = Math.min(1.8, dd / psp);
        bossProjs.push({
          kind: 'poop',
          x: e.x + Math.cos(a) * 20, y: e.y + Math.sin(a) * 20,
          vx: Math.cos(a) * psp, vy: Math.sin(a) * psp,
          r: 12, dmg: e.dmg, ttl, ttl0: ttl,
        });
        beep(300, 120, 0.12, 'triangle', 0.05);
      }
    }

    if (e.def.enrage) {
      e.et -= dt;
      if (e.et <= 0) { e.enraged = !e.enraged; e.et = e.enraged ? 2 : 5; }
      if (e.enraged) sp *= 1.9;
    }

    e.vx = dirx * sp; e.vy = diry * sp;
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.x = clamp(e.x, WALL + e.r, WORLD_W - WALL - e.r);
    e.y = clamp(e.y, WALL + e.r, WORLD_H - WALL - e.r);
    if (sp > 1) e.face = Math.atan2(e.vy, e.vx);

    // segments du mille-pattes
    if (e.segs) {
      let prev = e;
      for (const s of e.segs) {
        const sdx = prev.x - s.x, sdy = prev.y - s.y;
        const sd = Math.hypot(sdx, sdy);
        if (sd > 20) { s.x += (sdx / sd) * (sd - 20); s.y += (sdy / sd) * (sd - 20); }
        prev = s;
      }
    }

    // contact avec le joueur
    if (e.atkCd <= 0) {
      let touching = dist2(e.x, e.y, player.x, player.y) < (e.r + player.r + 2) * (e.r + player.r + 2);
      if (!touching && e.segs) {
        for (const s of e.segs) {
          if (dist2(s.x, s.y, player.x, player.y) < (14 + player.r) * (14 + player.r)) { touching = true; break; }
        }
      }
      if (touching) { damagePlayer(e.dmg); e.atkCd = 0.9; }
    }
  }

  // séparation des ennemis
  for (const e of enemies) {
    if (e.dead || e.def.boss || e.def.stationary) continue;
    gridQuery(e.x, e.y, e.r + 35, o => {
      if (o.dead || o.id <= e.id || o.def.boss || o.def.stationary) return;
      const dx = o.x - e.x, dy = o.y - e.y;
      const d = Math.hypot(dx, dy);
      const min = e.r + o.r;
      if (d > 0.001 && d < min) {
        const push = (min - d) / 2;
        const nx = dx / d, ny = dy / d;
        e.x -= nx * push; e.y -= ny * push;
        o.x += nx * push; o.y += ny * push;
      }
    });
  }

  // --- armes ---
  fireWeapons(dt);

  // --- projectiles ---
  for (const p of projectiles) {
    // rafale d'AK : les balles partent l'une après l'autre, depuis le canon
    if (p.delay) {
      p.delay -= dt;
      if (p.delay > 0) continue;
      p.delay = 0;
      p.x = player.x; p.y = player.y;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.ttl -= dt;

    if (p.kind === 'nade') {
      if (p.ttl <= 0) explodeNade(p);
      continue;
    }

    if (p.kind === 'glob') {
      if (p.ttl <= 0) {
        puddles.push({ x: p.x, y: p.y, r: p.puddle.r, ttl: p.puddle.dur, dps: p.puddle.dps, tickT: 0, seed: Math.random() * TAU });
        splat(p.x, p.y, '#d84315', 10);
        beep(150, 90, 0.12, 'sine', 0.05);
        p.dead = true;
      }
      continue;
    }

    // rebond du bouchon sur les murs
    if (p.kind === 'cork' && p.bounces > 0) {
      let bounced = false;
      if (p.x < WALL + p.r) { p.x = WALL + p.r; p.vx = Math.abs(p.vx); bounced = true; }
      if (p.x > WORLD_W - WALL - p.r) { p.x = WORLD_W - WALL - p.r; p.vx = -Math.abs(p.vx); bounced = true; }
      if (p.y < WALL + p.r) { p.y = WALL + p.r; p.vy = Math.abs(p.vy); bounced = true; }
      if (p.y > WORLD_H - WALL - p.r) { p.y = WORLD_H - WALL - p.r; p.vy = -Math.abs(p.vy); bounced = true; }
      if (bounced) { p.bounces--; p.hit.clear(); sndPop(); }
    }

    if (p.ttl <= 0 || p.x < -60 || p.x > WORLD_W + 60 || p.y < -60 || p.y > WORLD_H + 60) {
      p.dead = true;
      continue;
    }

    gridQuery(p.x, p.y, p.r + 120, e => {
      if (p.dead || e.dead || p.hit.has(e.id)) return;
      let hit = dist2(p.x, p.y, e.x, e.y) < (p.r + e.r) * (p.r + e.r);
      if (!hit && e.segs) {
        for (const s of e.segs) {
          if (dist2(p.x, p.y, s.x, s.y) < (p.r + 14) * (p.r + 14)) { hit = true; break; }
        }
      }
      if (hit) {
        p.hit.add(e.id);
        const sp = Math.hypot(p.vx, p.vy) || 1;
        damageEnemy(e, p.dmg, (p.vx / sp) * p.knock, (p.vy / sp) * p.knock);
        if (p.poison) { e.slowT = Math.max(e.slowT, 1.2); e.poisonT = 3; e.poisonDps = p.poison; }
        p.pierce--;
        if (p.pierce < 0) p.dead = true;
      }
    });
  }
  projectiles = projectiles.filter(p => !p.dead);

  // --- projectiles ennemis (assiettes, cacas, boulettes de dollars) ---
  for (const p of bossProjs) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.ttl -= dt;
    const col = p.kind === 'poop' ? '#6d4c2f' : p.kind === 'bill' ? '#66bb6a' : '#eceff1';
    if (p.mortar) {
      // obus de mortier : ne blesse qu'à l'atterrissage, sur la zone marquée au sol
      if (p.ttl <= 0) {
        p.dead = true;
        splat(p.tx, p.ty, col, 8);
        effects.push({ kind: 'boom', x: p.tx, y: p.ty, t: 0, dur: 0.32, range: p.zoneR, color: 0x8bc34a });
        beep(130, 45, 0.18, 'square', 0.07);
        if (dist2(p.tx, p.ty, player.x, player.y) < (p.zoneR + player.r * 0.4) * (p.zoneR + player.r * 0.4)) damagePlayer(p.dmg);
      }
      continue;
    }
    // les projectiles en cloche ne touchent qu'à basse altitude (esquivables sous l'arc)
    const arcH = p.ttl0 ? Math.sin(Math.PI * clamp(1 - p.ttl / p.ttl0, 0, 1)) * 42 : 0;
    if (p.ttl <= 0 || p.x < WALL || p.x > WORLD_W - WALL || p.y < WALL || p.y > WORLD_H - WALL) {
      p.dead = true;
      splat(p.x, p.y, col, 4);
    } else if (arcH < 24 && dist2(p.x, p.y, player.x, player.y) < (p.r + player.r) * (p.r + player.r)) {
      damagePlayer(p.dmg);
      splat(p.x, p.y, col, 6);
      p.dead = true;
    }
  }
  bossProjs = bossProjs.filter(p => !p.dead);

  // --- flaques de sauce ---
  for (const pu of puddles) {
    pu.ttl -= dt;
    pu.tickT -= dt;
    if (pu.tickT <= 0) {
      pu.tickT = 0.3;
      gridQuery(pu.x, pu.y, pu.r + 110, e => {
        if (e.dead) return;
        if (dist2(e.x, e.y, pu.x, pu.y) < (pu.r + e.r * 0.5) * (pu.r + e.r * 0.5)) {
          damageEnemy(e, pu.dps * 0.3, 0, 0, true);
          e.slowT = 0.35;
        }
      });
    }
  }
  puddles = puddles.filter(pu => pu.ttl > 0);

  // --- effets ---
  for (const fx of effects) {
    fx.t += dt;
    if (fx.kind === 'puff') {
      // bouffée de fumée : dérive vers l'extérieur en freinant, monte doucement
      fx.x += fx.vx * dt; fx.y += fx.vy * dt; fx.h += fx.vh * dt;
      const drag = Math.max(0, 1 - 4.5 * dt);
      fx.vx *= drag; fx.vy *= drag;
      continue;
    }
    if (fx.kind === 'flame') {
      // lance-flammes : cône unique qui suit la visée
      fx.tickT -= dt;
      if (fx.tickT <= 0) {
        fx.tickT = fx.tick;
        const ca = Math.cos(player.aim), sa = Math.sin(player.aim);
        const tanC = Math.tan(fx.cone / 2);
        gridQuery(player.x + ca * fx.len / 2, player.y + sa * fx.len / 2, fx.len / 2 + 140, e => {
          if (e.dead) return;
          const rx = e.x - player.x, ry = e.y - player.y;
          const along = rx * ca + ry * sa;
          const perp = Math.abs(-rx * sa + ry * ca);
          if (along > 0 && along < fx.len && perp < along * tanC + e.r * 0.7) {
            damageEnemy(e, fx.dmg, ca * 40, sa * 40, true);
          }
        });
        if (particles.length < 250) {
          for (let k = 0; k < 3; k++) {
            const a = player.aim + (Math.random() - 0.5) * fx.cone;
            const d = Math.random() * fx.len;
            particles.push({
              x: player.x + Math.cos(a) * d, y: player.y + Math.sin(a) * d,
              vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
              h: 12, vh: 60 + Math.random() * 60,
              ttl: 0.35, ttl0: 0.35, color: '#ff8c28',
            });
          }
        }
      }
    }
    if (fx.kind === 'torch') {
      fx.tickT -= dt;
      if (fx.tickT <= 0) {
        fx.tickT = fx.tick;
        for (let k = 0; k < 4; k++) {
          const ang = player.aim + k * HALF_PI;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          gridQuery(player.x + ca * fx.len / 2, player.y + sa * fx.len / 2, fx.len / 2 + 130, e => {
            if (e.dead) return;
            const rx = e.x - player.x, ry = e.y - player.y;
            const along = rx * ca + ry * sa;
            const perp = Math.abs(-rx * sa + ry * ca);
            if (along > 0 && along < fx.len && perp < 20 + e.r) {
              damageEnemy(e, fx.dmg, 0, 0, true);
              e.slowT = 0.2;
            }
          });
        }
        // braises
        if (particles.length < 250) {
          for (let k = 0; k < 4; k++) {
            const ang = player.aim + k * HALF_PI;
            const d = Math.random() * fx.len;
            particles.push({
              x: player.x + Math.cos(ang) * d, y: player.y + Math.sin(ang) * d,
              vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
              h: 12, vh: 60 + Math.random() * 60,
              ttl: 0.35, ttl0: 0.35, color: '#ffab40',
            });
          }
        }
      }
    }
  }
  effects = effects.filter(fx => fx.t < fx.dur);

  // --- ramassage ---
  for (const pk of pickups) {
    const d = Math.hypot(player.x - pk.x, player.y - pk.y) || 0.01;
    let sp = 0;
    if (pk.magnet) sp = 780; // fromage aspiré par l'aimant : fonce vers le chef
    else if (d < player.magnetR) sp = 420 * (1.2 - d / player.magnetR);
    if (sp > 0) {
      pk.x += ((player.x - pk.x) / d) * sp * dt;
      pk.y += ((player.y - pk.y) / d) * sp * dt;
    }
    if (d < 26) {
      pk.dead = true;
      if (pk.kind === 'cheese') { gainXp(pk.v); sndPickup(); }
      else if (pk.kind === 'soup') { heal(currentLevel === 2 ? player.maxHp : player.maxHp * 0.25); sndPickup(); }
      else if (pk.kind === 'coke') {
        player.boostT = 8;
        announcements.push({ txt: '💊 SNIFF ! Vitesse +55% pendant 8 s !', ttl: 2.5 });
        beep(600, 1400, 0.3, 'sine', 0.09);
      }
      else if (pk.kind === 'aimant') {
        let n = 0;
        for (const o of pickups) {
          if (o.kind === 'cheese' && !o.dead) { o.magnet = true; n++; }
        }
        announcements.push({ txt: `🧲 Aimant ! ${n} fromage${n > 1 ? 's' : ''} fonce${n > 1 ? 'nt' : ''} vers vous !`, ttl: 2.5 });
        beep(400, 1200, 0.35, 'sine', 0.09);
      }
    }
  }
  pickups = pickups.filter(pk => !pk.dead);

  // --- particules / textes ---
  for (const pa of particles) {
    pa.x += pa.vx * dt; pa.y += pa.vy * dt;
    pa.vx *= 0.92; pa.vy *= 0.92;
    pa.h += pa.vh * dt;
    pa.vh -= 320 * dt;
    if (pa.h < 2) { pa.h = 2; pa.vh = 0; }
    pa.ttl -= dt;
  }
  particles = particles.filter(pa => pa.ttl > 0);

  for (const d of dmgTexts) d.ttl -= dt;
  dmgTexts = dmgTexts.filter(d => d.ttl > 0);

  for (const a of announcements) a.ttl -= dt;
  announcements = announcements.filter(a => a.ttl > 0);

  enemies = enemies.filter(e => !e.dead);
  shake = Math.max(0, shake - 40 * dt);
}

// =================== RENDU ===================
function render3d() {
  if (!player) return;

  // caméra (avec tremblement)
  camera.position.set(
    player.x + (shake > 0 ? (Math.random() - 0.5) * shake : 0),
    CAM_H,
    player.y + CAM_ZOFF + (shake > 0 ? (Math.random() - 0.5) * shake : 0)
  );
  camera.lookAt(player.x, 0, player.y);

  const t = performance.now() / 1000;

  // --- chef ---
  const blink = player.hurtCd > 0 && Math.floor(player.hurtCd * 20) % 2 === 0;
  chefMesh.visible = !blink;
  const chefBob = player.moving ? Math.abs(Math.sin(t * 11)) * 2.2 : 0;
  chefMesh.position.set(player.x, chefBob, player.y);
  chefMesh.rotation.y = -player.aim;

  // arme en main (poêle ou machette), ou en train de frapper
  const swing = effects.find(fx => fx.kind === 'swing');
  let panAng, panR, panY;
  if (swing) {
    const pr = swing.t / swing.dur;
    panAng = swing.ang - 0.9 + pr * 1.8;
    panR = swing.range * 0.55;
    panY = 16 + Math.sin(pr * Math.PI) * 10;
  } else {
    panAng = player.aim + 0.5;
    panR = 15;
    panY = 20 + chefBob;
  }
  const heldMesh = currentLevel === 2 ? macheteMesh : panMesh;
  (currentLevel === 2 ? panMesh : macheteMesh).visible = false;
  heldMesh.visible = chefMesh.visible;
  heldMesh.position.set(player.x + Math.cos(panAng) * panR, panY, player.y + Math.sin(panAng) * panR);
  heldMesh.rotation.y = -panAng;

  // --- ennemis (instanciés par type) ---
  const counts = {};
  for (const type in enemyInst) counts[type] = 0;
  let segCount = 0, shadowCount = 0;

  setInst(shadowInst, shadowCount++, player.x, 0.5, player.y, 0, 1.4);

  for (const e of enemies) {
    if (e.def.boss) continue; // rendu séparé
    const inst = enemyInst[e.type];
    const i = counts[e.type];
    if (i >= inst.userData.cap) continue;
    const pop = 1 + e.hitFlash * 2.2;
    let squash = 1;
    if (e.cstate === 'windup') squash = 0.75;
    const bob = e.def.jitter ? 0 : Math.abs(Math.sin(t * 10 + e.phase)) * 2;
    const enrPulse = e.enraged ? 1 + Math.sin(t * 18) * 0.06 : 1;
    setInst(inst, i, e.x, bob, e.y, -e.face, pop * enrPulse, pop * squash * enrPulse);
    counts[e.type] = i + 1;

    if (e.segs && segCount + e.segs.length < 1200) {
      for (let s = 0; s < e.segs.length; s++) {
        const sc = 1 - s * 0.09;
        setInst(segInst, segCount++, e.segs[s].x, Math.abs(Math.sin(t * 6 + e.phase + s)) * 1.5, e.segs[s].y, 0, sc);
      }
    }
    if (shadowCount < 890) setInst(shadowInst, shadowCount++, e.x, 0.5, e.y, 0, e.r / 10);
  }
  for (const type in enemyInst) {
    enemyInst[type].count = counts[type];
    enemyInst[type].instanceMatrix.needsUpdate = true;
  }
  segInst.count = segCount;
  segInst.instanceMatrix.needsUpdate = true;

  // --- boss ---
  if (boss && !boss.dead) {
    const bMesh = boss.type === 'hippo' ? hippoMesh : bossMesh;
    (boss.type === 'hippo' ? bossMesh : hippoMesh).visible = false;
    bMesh.visible = true;
    const tele = boss.bstate === 'chargeTele' || boss.bstate === 'slamTele' || boss.bstate === 'summon' || boss.bstate === 'vomitTele';
    const swim = boss.bstate === 'swim';
    const ox = tele ? (Math.random() - 0.5) * 7 : 0;
    const oz = tele ? (Math.random() - 0.5) * 7 : 0;
    const stomp = boss.bstate === 'walk' || boss.bstate === 'charge' ? Math.abs(Math.sin(t * 8)) * 5 : 0;
    // en nage, le corps est immergé : seule la tête (et un bout de dos) émerge
    bMesh.position.set(boss.x + ox, swim ? -76 + Math.sin(t * 3.2) * 4 : stomp, boss.y + oz);
    bMesh.rotation.y = -boss.face;
    bMesh.rotation.z = boss.bstate === 'stun' ? 0.3 : 0;
    const pop = 1 + boss.hitFlash * 0.8;
    const enrPulse = boss.hp < boss.maxHp * 0.3 ? 1 + Math.sin(t * 14) * 0.03 : 1;
    bMesh.scale.setScalar((boss.type === 'hippo' ? 3.2 : 3.4) * pop * enrPulse);
    if (!swim && shadowCount < 890) setInst(shadowInst, shadowCount++, boss.x, 0.5, boss.y, 0, boss.type === 'hippo' ? 5.4 : 4.6);

    slamTeleMesh.visible = boss.bstate === 'slamTele';
    if (slamTeleMesh.visible) {
      slamTeleMesh.position.set(boss.x, 0.9, boss.y);
      slamTeleMesh.scale.setScalar(SLAM_R);
      slamTeleMesh.material.opacity = 0.2 + 0.18 * Math.abs(Math.sin(t * 14));
    }
    chargeTeleMesh.visible = boss.bstate === 'chargeTele';
    if (chargeTeleMesh.visible) {
      chargeTeleMesh.position.set(boss.x, 0.9, boss.y);
      chargeTeleMesh.rotation.y = -boss.face;
      chargeTeleMesh.material.opacity = 0.15 + 0.15 * Math.abs(Math.sin(t * 14));
    }
  } else {
    bossMesh.visible = false;
    hippoMesh.visible = false;
    slamTeleMesh.visible = false;
    chargeTeleMesh.visible = false;
  }

  // ondes de choc (boss) et explosions de grenades
  const shocks = effects.filter(fx => fx.kind === 'shock' || fx.kind === 'boom');
  for (let i = 0; i < shockPool.length; i++) {
    const m = shockPool[i];
    if (i < shocks.length) {
      const fx = shocks[i];
      const pr = fx.t / fx.dur;
      m.visible = true;
      m.material.color.setHex(fx.color || (fx.kind === 'boom' ? 0xffa726 : 0xff5722));
      m.position.set(fx.x, 3, fx.y);
      m.scale.setScalar(fx.range * (0.15 + 0.85 * pr));
      m.material.opacity = 0.8 * (1 - pr);
    } else m.visible = false;
  }

  // projectiles ennemis : assiettes, cacas et boulettes de dollars (en cloche)
  let plateCount = 0, poopCount = 0, billCount = 0, zoneCount = 0;
  for (const p of bossProjs) {
    const arc = p.ttl0 ? Math.sin(Math.PI * clamp(1 - p.ttl / p.ttl0, 0, 1)) : 0;
    const h = p.mortar ? 14 + arc * 130 : (p.ttl0 ? 12 + arc * 42 : 18);
    if (p.kind === 'poop' && poopCount < poopInst.userData.cap) setInst(poopInst, poopCount++, p.x, h, p.y, t * 5);
    else if (p.kind === 'bill' && billCount < billInst.userData.cap) setInst(billInst, billCount++, p.x, h, p.y, t * 6, p.mortar ? 1.6 : 1);
    else if (!p.kind && plateCount < plateInst.userData.cap) setInst(plateInst, plateCount++, p.x, 18, p.y, t * 7);
    // zone d'impact annoncée au sol pour les obus de mortier
    if (p.mortar && zoneCount < zonePool.length) {
      const m = zonePool[zoneCount++];
      const pr = clamp(1 - p.ttl / p.ttl0, 0, 1);
      m.visible = true;
      m.position.set(p.tx, 0.8, p.ty);
      m.scale.setScalar(p.zoneR * (0.45 + 0.55 * pr));
      m.material.opacity = 0.2 + 0.3 * pr + 0.08 * Math.sin(t * 16);
    }
  }
  for (let i = zoneCount; i < zonePool.length; i++) zonePool[i].visible = false;
  plateInst.count = plateCount;
  plateInst.instanceMatrix.needsUpdate = true;
  poopInst.count = poopCount;
  poopInst.instanceMatrix.needsUpdate = true;
  billInst.count = billCount;
  billInst.instanceMatrix.needsUpdate = true;

  // --- ramassables (fromage/soupe en cuisine, dollars/empanadas dans la jungle) ---
  let cheeseCount = 0, soupCount = 0, magnetCount = 0, dollarCount = 0, empCount = 0, cokeCount = 0;
  for (const pk of pickups) {
    pk.bob += 0.1;
    const by = 2 + Math.sin(pk.bob) * 2.5;
    if (pk.kind === 'cheese') {
      if (currentLevel === 2) {
        if (dollarCount < 420) setInst(dollarInst, dollarCount++, pk.x, by + 3, pk.y, pk.bob * 0.5);
      } else if (cheeseCount < 420) setInst(cheeseInst, cheeseCount++, pk.x, by, pk.y, pk.bob * 0.5);
      if (shadowCount < 890) setInst(shadowInst, shadowCount++, pk.x, 0.5, pk.y, 0, 0.7);
    } else if (pk.kind === 'soup') {
      if (currentLevel === 2) {
        if (empCount < 40) setInst(empanadaInst, empCount++, pk.x, by, pk.y, pk.bob * 0.3);
      } else if (soupCount < 40) setInst(soupInst, soupCount++, pk.x, by, pk.y, 0);
      if (shadowCount < 890) setInst(shadowInst, shadowCount++, pk.x, 0.5, pk.y, 0, 0.8);
    } else if (pk.kind === 'aimant' && magnetCount < 8) {
      setInst(magnetInst, magnetCount++, pk.x, 4 + Math.sin(pk.bob) * 3, pk.y, t * 2.2);
      if (shadowCount < 890) setInst(shadowInst, shadowCount++, pk.x, 0.5, pk.y, 0, 1.1);
    } else if (pk.kind === 'coke' && cokeCount < 8) {
      setInst(cokeInst, cokeCount++, pk.x, 4 + Math.sin(pk.bob) * 3, pk.y, t * 2.2);
      if (shadowCount < 890) setInst(shadowInst, shadowCount++, pk.x, 0.5, pk.y, 0, 1.1);
    }
  }
  cheeseInst.count = cheeseCount; cheeseInst.instanceMatrix.needsUpdate = true;
  soupInst.count = soupCount; soupInst.instanceMatrix.needsUpdate = true;
  magnetInst.count = magnetCount; magnetInst.instanceMatrix.needsUpdate = true;
  dollarInst.count = dollarCount; dollarInst.instanceMatrix.needsUpdate = true;
  empanadaInst.count = empCount; empanadaInst.instanceMatrix.needsUpdate = true;
  cokeInst.count = cokeCount; cokeInst.instanceMatrix.needsUpdate = true;
  shadowInst.count = shadowCount; shadowInst.instanceMatrix.needsUpdate = true;

  // --- projectiles ---
  let knifeCount = 0, corkCount = 0, globCount = 0, dartCount = 0, bulletCount = 0, nadeCount = 0;
  for (const p of projectiles) {
    if (p.delay > 0) continue; // balles d'AK pas encore parties
    if (p.kind === 'knife' && knifeCount < 60) {
      setInst(knifeInst, knifeCount++, p.x, 16, p.y, -Math.atan2(p.vy, p.vx));
    } else if (p.kind === 'cork' && corkCount < 20) {
      setInst(corkInst, corkCount++, p.x, 12, p.y, -Math.atan2(p.vy, p.vx));
    } else if (p.kind === 'glob' && globCount < 20) {
      const h = Math.sin(Math.PI * (1 - p.ttl / p.ttl0)) * 42;
      setInst(globInst, globCount++, p.x, 8 + h, p.y, 0);
    } else if (p.kind === 'dart' && dartCount < 40) {
      setInst(dartInst, dartCount++, p.x, 14, p.y, -Math.atan2(p.vy, p.vx));
    } else if (p.kind === 'bullet' && bulletCount < 80) {
      setInst(bulletInst, bulletCount++, p.x, 15, p.y, -Math.atan2(p.vy, p.vx));
    } else if (p.kind === 'nade' && nadeCount < 40) {
      const h = Math.sin(Math.PI * (1 - p.ttl / p.ttl0)) * 46;
      setInst(nadeInst, nadeCount++, p.x, 6 + h, p.y, t * 4);
    }
  }
  knifeInst.count = knifeCount; knifeInst.instanceMatrix.needsUpdate = true;
  corkInst.count = corkCount; corkInst.instanceMatrix.needsUpdate = true;
  globInst.count = globCount; globInst.instanceMatrix.needsUpdate = true;
  dartInst.count = dartCount; dartInst.instanceMatrix.needsUpdate = true;
  bulletInst.count = bulletCount; bulletInst.instanceMatrix.needsUpdate = true;
  nadeInst.count = nadeCount; nadeInst.instanceMatrix.needsUpdate = true;

  // --- flaques (sauce piquante ou feu de grenade) ---
  for (let i = 0; i < puddlePool.length; i++) {
    const m = puddlePool[i];
    if (i < puddles.length) {
      const pu = puddles[i];
      m.visible = true;
      m.material.color.setHex(pu.fire ? 0xff8a3c : 0xd84315);
      m.position.set(pu.x, 0.7 + i * 0.05, pu.y);
      m.scale.setScalar(pu.r);
      m.material.opacity = (pu.fire ? 0.5 + Math.sin(t * 16 + pu.seed) * 0.1 : 0.55) * Math.min(1, pu.ttl / 0.8);
    } else m.visible = false;
  }

  // --- chalumeau ---
  const torch = effects.find(fx => fx.kind === 'torch');
  if (torch) {
    torchGroup.visible = true;
    torchGroup.position.set(player.x, 16, player.y);
    torchGroup.rotation.y = -player.aim;
    const fade = Math.min(1, (torch.dur - torch.t) * 3, torch.t * 8 + 0.2);
    for (const beam of torchBeams) {
      const flick = 0.85 + Math.random() * 0.3;
      beam.scale.set(14 * flick, torch.len, 14 * flick);
      beam.position.x = torch.len / 2;
      beam.material.opacity = 0.8 * fade;
    }
  } else torchGroup.visible = false;

  // --- lance-flammes ---
  const flame = effects.find(fx => fx.kind === 'flame');
  if (flame) {
    flameGroup.visible = true;
    flameGroup.position.set(player.x, 15, player.y);
    flameGroup.rotation.y = -player.aim;
    const fade = Math.min(1, (flame.dur - flame.t) * 3, flame.t * 8 + 0.2);
    const flick = 0.85 + Math.random() * 0.3;
    const w = Math.tan(flame.cone / 2) * flame.len * flick;
    flameBeam.scale.set(w, flame.len, w);
    flameBeam.position.x = flame.len / 2;
    flameBeam.material.opacity = 0.8 * fade;
    flameInner.material.opacity = 0.9 * fade;
  } else flameGroup.visible = false;

  // --- fouet ---
  const whipFx = effects.find(fx => fx.kind === 'whip');
  if (whipFx) {
    if (Math.abs(whipMesh.userData.cone - whipFx.cone) > 0.01) {
      whipMesh.geometry.dispose();
      whipMesh.geometry = new THREE.CircleGeometry(1, 20, -whipFx.cone / 2, whipFx.cone).rotateX(-HALF_PI);
      whipMesh.userData.cone = whipFx.cone;
    }
    const pr = whipFx.t / whipFx.dur;
    whipMesh.visible = true;
    whipMesh.position.set(player.x, 1.2, player.y);
    whipMesh.rotation.y = -whipFx.ang;
    whipMesh.scale.setScalar(whipFx.range * (0.5 + 0.5 * pr));
    whipMesh.material.opacity = 0.5 * (1 - pr);
  } else whipMesh.visible = false;

  // --- éclairs ---
  const zaps = effects.filter(fx => fx.kind === 'zap');
  for (let i = 0; i < zapPool.length; i++) {
    const line = zapPool[i];
    if (i < zaps.length) {
      const fx = zaps[i];
      if (!fx.built) {
        fx.built = true;
        const posAttr = line.geometry.getAttribute('position');
        let n = 0;
        for (let j = 0; j < fx.pts.length - 1 && n < 60; j++) {
          const a = fx.pts[j], b = fx.pts[j + 1];
          for (let k = 0; k <= 3; k++) {
            const f = k / 3;
            const jx = k === 0 || k === 3 ? 0 : (Math.random() - 0.5) * 24;
            const jz = k === 0 || k === 3 ? 0 : (Math.random() - 0.5) * 24;
            posAttr.setXYZ(n++, a.x + (b.x - a.x) * f + jx, 20 + Math.random() * 8, a.y + (b.y - a.y) * f + jz);
          }
        }
        line.geometry.setDrawRange(0, n);
        posAttr.needsUpdate = true;
      }
      line.visible = true;
      line.material.opacity = 1 - fx.t / fx.dur;
    } else line.visible = false;
  }

  // --- fumée du pesticide ---
  const puffs = effects.filter(fx => fx.kind === 'puff');
  for (let i = 0; i < puffPool.length; i++) {
    const m = puffPool[i];
    if (i < puffs.length) {
      const fx = puffs[i];
      const pr = fx.t / fx.dur;
      m.visible = true;
      m.position.set(fx.x, fx.h, fx.y);
      m.scale.setScalar(fx.r * (0.5 + 1.9 * pr)); // la bouffée gonfle en se dissipant
      m.material.opacity = 0.45 * (1 - pr * pr);
    } else m.visible = false;
  }

  // --- anneaux du hachoir ---
  const pulses = effects.filter(fx => fx.kind === 'pulse');
  for (let i = 0; i < pulsePool.length; i++) {
    const m = pulsePool[i];
    if (i < pulses.length) {
      const fx = pulses[i];
      const pr = fx.t / fx.dur;
      m.visible = true;
      m.material.color.setHex(fx.color || 0xdde3ea);
      m.position.set(player.x, 3, player.y);
      m.scale.setScalar(fx.range * (0.4 + 0.6 * pr));
      m.material.opacity = 0.7 * (1 - pr);
    } else m.visible = false;
  }

  // --- fouets du batteur ---
  let whiskCount = 0;
  const bw = player.weapons.find(w => w.type === 'batteur');
  if (bw && state !== 'over') {
    const st = wstat(bw);
    for (let i = 0; i < st.orbs && whiskCount < whiskPool.length; i++) {
      const a = bw.angle + (i / st.orbs) * TAU;
      const m = whiskPool[whiskCount++];
      m.visible = true;
      m.position.set(player.x + Math.cos(a) * st.radius * st.area, 6, player.y + Math.sin(a) * st.radius * st.area);
      m.rotation.y = t * 9;
    }
  }
  for (let i = whiskCount; i < whiskPool.length; i++) whiskPool[i].visible = false;

  // --- particules ---
  const posA = partGeo.getAttribute('position');
  const colA = partGeo.getAttribute('color');
  let pn = 0;
  for (const pa of particles) {
    if (pn >= MAX_PARTS) break;
    posA.setXYZ(pn, pa.x, pa.h, pa.y);
    _pc.set(pa.color);
    colA.setXYZ(pn, _pc.r, _pc.g, _pc.b);
    pn++;
  }
  partGeo.setDrawRange(0, pn);
  posA.needsUpdate = true;
  colA.needsUpdate = true;

  renderer.render(scene, camera);
  drawHUD();
}

// =================== HUD (canvas 2D par-dessus) ===================
function drawHUD() {
  hctx.clearRect(0, 0, VW, VH);

  // éléments projetés depuis le monde
  hctx.textAlign = 'center';
  hctx.textBaseline = 'middle';

  // barres de vie des gros ennemis + alerte du chat
  for (const e of enemies) {
    if (e.cstate === 'windup') {
      const [sx, sy] = proj(e.x, 55, e.y);
      hctx.font = 'bold 26px system-ui';
      hctx.strokeStyle = 'rgba(0,0,0,0.8)';
      hctx.lineWidth = 4;
      hctx.strokeText('!', sx, sy);
      hctx.fillStyle = '#ff5252';
      hctx.fillText('!', sx, sy);
    }
    if (e.maxHp > 80 && e.hp < e.maxHp && !e.def.boss) {
      const [sx, sy] = proj(e.x, e.r * 1.8 + 18, e.y);
      const bw = 46;
      hctx.fillStyle = 'rgba(0,0,0,0.5)';
      hctx.fillRect(sx - bw / 2, sy, bw, 5);
      hctx.fillStyle = '#e53935';
      hctx.fillRect(sx - bw / 2, sy, bw * (e.hp / e.maxHp), 5);
    }
  }

  // barre de vie du joueur
  {
    const [sx, sy] = proj(player.x, 74, player.y);
    const bw = 46;
    hctx.fillStyle = 'rgba(0,0,0,0.5)';
    hctx.fillRect(sx - bw / 2, sy, bw, 6);
    hctx.fillStyle = player.hp / player.maxHp > 0.35 ? '#66bb6a' : '#e53935';
    hctx.fillRect(sx - bw / 2, sy, bw * (player.hp / player.maxHp), 6);
  }

  // textes de dégâts
  for (const d of dmgTexts) {
    const [sx, sy] = proj(d.x, 30, d.y);
    const rise = (d.ttl0 - d.ttl) * 55;
    hctx.globalAlpha = Math.min(1, d.ttl / d.ttl0 * 2);
    hctx.font = `bold ${d.size}px system-ui`;
    hctx.strokeStyle = 'rgba(0,0,0,0.7)';
    hctx.lineWidth = 3;
    hctx.strokeText(d.txt, sx, sy - rise);
    hctx.fillStyle = d.color;
    hctx.fillText(d.txt, sx, sy - rise);
  }
  hctx.globalAlpha = 1;

  // barre d'XP en haut (dorée en cuisine, billets verts dans la jungle)
  hctx.fillStyle = 'rgba(0,0,0,0.6)';
  hctx.fillRect(0, 0, VW, 16);
  hctx.fillStyle = currentLevel === 2 ? '#7ed87e' : '#ffd54f';
  hctx.fillRect(0, 0, VW * clamp(player.xp / player.xpNeed, 0, 1), 16);
  hctx.fillStyle = '#14100c';
  hctx.font = 'bold 12px system-ui';
  hctx.textAlign = 'left';
  hctx.fillText(`Nv ${player.level}`, 8, 9);

  // chrono
  hctx.textAlign = 'center';
  hctx.font = 'bold 36px system-ui';
  hctx.strokeStyle = 'rgba(0,0,0,0.7)';
  hctx.lineWidth = 5;
  hctx.strokeText(fmtTime(time), VW / 2, 48);
  hctx.fillStyle = '#f5e9d0';
  hctx.fillText(fmtTime(time), VW / 2, 48);

  // barre de vie du boss
  if (boss && !boss.dead) {
    const bTitle = `${boss.def.icon} ${boss.def.name.toUpperCase()}`;
    const bw = Math.min(520, VW * 0.55), bx = VW / 2 - bw / 2, by = 88;
    hctx.textAlign = 'center';
    hctx.font = 'bold 17px system-ui';
    hctx.strokeStyle = 'rgba(0,0,0,0.8)';
    hctx.lineWidth = 4;
    hctx.strokeText(bTitle, VW / 2, by - 12);
    hctx.fillStyle = '#ff8a65';
    hctx.fillText(bTitle, VW / 2, by - 12);
    hctx.fillStyle = 'rgba(0,0,0,0.65)';
    hctx.fillRect(bx - 2, by - 2, bw + 4, 18);
    hctx.fillStyle = boss.hp < boss.maxHp * 0.3 ? '#ff1744' : '#e53935';
    hctx.fillRect(bx, by, bw * clamp(boss.hp / boss.maxHp, 0, 1), 14);
    hctx.strokeStyle = 'rgba(255,255,255,0.35)';
    hctx.lineWidth = 1;
    hctx.strokeRect(bx - 2, by - 2, bw + 4, 18);
  }

  // stats à droite (décalées en tactile pour laisser la place aux boutons pause/son)
  hctx.textAlign = 'right';
  hctx.font = 'bold 16px system-ui';
  hctx.lineWidth = 3;
  const statsX = isTouch ? VW - 132 : VW - 14;
  const bestNow = currentLevel === 2 ? best2 : best;
  const rightLines = [`💀 ${kills}`, `🏆 ${bestNow > 0 ? fmtTime(bestNow) : '—'}`];
  if (player.boostT > 0) rightLines.push(`💊 ${Math.ceil(player.boostT)}s`);
  rightLines.forEach((txt, i) => {
    hctx.strokeText(txt, statsX, 40 + i * 26);
    hctx.fillStyle = '#f5e9d0';
    hctx.fillText(txt, statsX, 40 + i * 26);
  });

  // PV en bas (centrés en tactile pour ne pas passer sous le pouce gauche)
  const hbw = 220, hbx = isTouch ? (VW - hbw) / 2 : 14, hby = VH - 34;
  hctx.fillStyle = 'rgba(0,0,0,0.6)';
  hctx.fillRect(hbx, hby, hbw, 20);
  hctx.fillStyle = player.hp / player.maxHp > 0.35 ? '#66bb6a' : '#e53935';
  hctx.fillRect(hbx, hby, hbw * (player.hp / player.maxHp), 20);
  hctx.strokeStyle = 'rgba(255,255,255,0.3)';
  hctx.lineWidth = 1;
  hctx.strokeRect(hbx, hby, hbw, 20);
  hctx.fillStyle = '#fff';
  hctx.font = 'bold 13px system-ui';
  hctx.textAlign = 'center';
  hctx.fillText(`${Math.ceil(player.hp)} / ${player.maxHp}`, hbx + hbw / 2, hby + 10);

  // armes à gauche
  player.weapons.forEach((w, i) => {
    const def = WEAPON_DEFS[w.type];
    const y = 40 + i * 48;
    hctx.fillStyle = 'rgba(0,0,0,0.45)';
    hctx.beginPath();
    hctx.roundRect(10, y, 42, 42, 8);
    hctx.fill();
    hctx.font = '24px sans-serif';
    hctx.textAlign = 'center';
    hctx.fillText(def.icon, 31, y + 19);
    hctx.font = 'bold 11px system-ui';
    hctx.fillStyle = '#ffd54f';
    hctx.fillText(`Nv${w.level}`, 31, y + 35);
  });

  // annonces
  hctx.textAlign = 'center';
  announcements.forEach((a, i) => {
    hctx.globalAlpha = Math.min(1, a.ttl);
    hctx.font = 'bold 22px system-ui';
    hctx.strokeStyle = 'rgba(0,0,0,0.8)';
    hctx.lineWidth = 4;
    hctx.strokeText(a.txt, VW / 2, 100 + i * 32);
    hctx.fillStyle = '#ffb347';
    hctx.fillText(a.txt, VW / 2, 100 + i * 32);
    hctx.globalAlpha = 1;
  });

  // vignette rouge si PV bas
  const hpRatio = player.hp / player.maxHp;
  if (hpRatio < 0.35 && state !== 'over') {
    const g = hctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.35, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
    g.addColorStop(0, 'rgba(180,0,0,0)');
    g.addColorStop(1, `rgba(180,0,0,${0.5 * (1 - hpRatio / 0.35)})`);
    hctx.fillStyle = g;
    hctx.fillRect(0, 0, VW, VH);
  }

  // réticule de visée souris (bien visible même au milieu de la horde)
  if ((state === 'play' || state === 'pause') && !isTouch && !padMode) {
    const mx = mouse.x, my = mouse.y;
    const R = 14;
    hctx.save();
    hctx.lineCap = 'round';
    // double trait : contour noir épais + trait clair par-dessus
    for (const [lw, col] of [[5, 'rgba(0,0,0,0.75)'], [2.5, '#ffcf40']]) {
      hctx.strokeStyle = col;
      hctx.lineWidth = lw;
      hctx.beginPath();
      hctx.arc(mx, my, R, 0, TAU);
      hctx.stroke();
      hctx.beginPath();
      hctx.moveTo(mx - R - 7, my); hctx.lineTo(mx - R + 3, my);
      hctx.moveTo(mx + R - 3, my); hctx.lineTo(mx + R + 7, my);
      hctx.moveTo(mx, my - R - 7); hctx.lineTo(mx, my - R + 3);
      hctx.moveTo(mx, my + R - 3); hctx.lineTo(mx, my + R + 7);
      hctx.stroke();
    }
    // point central
    hctx.fillStyle = 'rgba(0,0,0,0.75)';
    hctx.beginPath(); hctx.arc(mx, my, 3.5, 0, TAU); hctx.fill();
    hctx.fillStyle = '#ffcf40';
    hctx.beginPath(); hctx.arc(mx, my, 2, 0, TAU); hctx.fill();
    hctx.restore();
  }

  if (state === 'pause') {
    hctx.fillStyle = 'rgba(10,7,5,0.6)';
    hctx.fillRect(0, 0, VW, VH);
    hctx.fillStyle = '#f5e9d0';
    hctx.font = 'bold 52px system-ui';
    hctx.textAlign = 'center';
    hctx.fillText('⏸️ PAUSE', VW / 2, VH / 2 - 20);
    hctx.font = '18px system-ui';
    hctx.fillText(
      padMode ? 'Appuyez sur Start ou A pour reprendre'
        : isTouch ? "Touchez l'écran pour reprendre"
          : 'Appuyez sur Échap ou P pour reprendre', VW / 2, VH / 2 + 30);
  }

  // réticule projeté sur la cible (stick droit, manette ou visée auto)
  if ((isTouch || padMode) && state === 'play') {
    const [ax, ay] = proj(aimWorld.x, 0, aimWorld.y);
    const manual = aimStick.id !== null || (padMode && (padAim.x || padAim.y));
    hctx.save();
    hctx.globalAlpha = manual ? 0.95 : 0.55;
    hctx.lineCap = 'round';
    for (const [lw, col] of [[4.5, 'rgba(0,0,0,0.75)'], [2.2, '#ffcf40']]) {
      hctx.strokeStyle = col;
      hctx.lineWidth = lw;
      hctx.beginPath(); hctx.arc(ax, ay, 14, 0, TAU); hctx.stroke();
    }
    hctx.restore();
  }

  // interface tactile : joysticks, boutons pause/son
  if (isTouch && (state === 'play' || state === 'pause')) {
    if (state === 'play') {
      // joysticks
      for (const s of [moveStick, aimStick]) {
        if (s.id === null) continue;
        hctx.fillStyle = 'rgba(255,255,255,0.12)';
        hctx.beginPath(); hctx.arc(s.cx, s.cy, STICK_R, 0, TAU); hctx.fill();
        hctx.strokeStyle = 'rgba(255,255,255,0.35)';
        hctx.lineWidth = 2;
        hctx.beginPath(); hctx.arc(s.cx, s.cy, STICK_R, 0, TAU); hctx.stroke();
        hctx.fillStyle = s === aimStick ? 'rgba(255,207,64,0.8)' : 'rgba(245,233,208,0.8)';
        hctx.beginPath(); hctx.arc(s.cx + s.dx * STICK_R, s.cy + s.dy * STICK_R, 22, 0, TAU); hctx.fill();
      }
    }

    // boutons pause + son
    const btns = [[touchBtnPause(), state === 'pause' ? '▶' : '⏸'], [touchBtnMute(), muted ? '🔇' : '🔊']];
    for (const [b, icon] of btns) {
      hctx.fillStyle = 'rgba(0,0,0,0.45)';
      hctx.beginPath(); hctx.arc(b.x, b.y, TBTN_R, 0, TAU); hctx.fill();
      hctx.strokeStyle = 'rgba(255,255,255,0.3)';
      hctx.lineWidth = 1.5;
      hctx.beginPath(); hctx.arc(b.x, b.y, TBTN_R, 0, TAU); hctx.stroke();
      hctx.font = '22px system-ui';
      hctx.textAlign = 'center';
      hctx.fillStyle = '#f5e9d0';
      hctx.fillText(icon, b.x, b.y + 1);
    }
  }
}

// =================== CYCLE DE JEU ===================
const elStart = document.getElementById('start');
const elGameover = document.getElementById('gameover');
const elNewRecord = document.getElementById('newrecord');

function startGame(lv = currentLevel) {
  currentLevel = lv;
  initGame();
  releaseSticks();
  tryLockLandscape();
  state = 'play';
  elStart.classList.add('hidden');
  elGameover.classList.add('hidden');
  elLevelup.classList.add('hidden');
  document.getElementById('victory').classList.add('hidden');
  beep(330, 660, 0.2, 'sine', 0.06);
}

function saveRecord() {
  const prev = currentLevel === 2 ? best2 : best;
  const isRecord = time > prev;
  if (isRecord) {
    if (currentLevel === 2) {
      best2 = time;
      localStorage.setItem('cauchemar_best2', String(best2));
    } else {
      best = time;
      localStorage.setItem('cauchemar_best', String(best));
    }
  }
  document.getElementById('bestStart').textContent = best > 0 ? fmtTime(best) : '—';
  document.getElementById('bestStart2').textContent = best2 > 0 ? fmtTime(best2) : '—';
  return isRecord;
}

function victory() {
  state = 'victory';
  boss = null;
  bossProjs = [];
  shake = 18;
  const isRecord = saveRecord();
  if (currentLevel === 1 && !level2Unlocked) {
    level2Unlocked = true;
    localStorage.setItem('cauchemar_lvl2', '1');
    updateLevelButtons();
  }
  document.getElementById('vTitle').textContent = currentLevel === 2 ? '🌴 LIBRE !' : '🏆 SERVICE VALIDÉ !';
  document.getElementById('vSub').textContent = currentLevel === 2
    ? "L'Hippo de Pablo mord la poussière. La jungle est derrière vous : direction la liberté, les poches pleines de dollars !"
    : "Philippe ChuileBest s'incline… mais vos dettes vous rattrapent : vous voilà Cuisinier d'un labo de coke au fond de la jungle. Il va falloir s'évader.";
  document.getElementById('btnNext').classList.toggle('hidden', currentLevel !== 1);
  document.getElementById('vTime').textContent = fmtTime(time);
  document.getElementById('vKills').textContent = kills;
  document.getElementById('vLevel').textContent = player.level;
  document.getElementById('newrecord2').classList.toggle('hidden', !isRecord);
  document.getElementById('victory').classList.remove('hidden');
  beep(523, 523, 0.15, 'sine', 0.1);
  setTimeout(() => beep(659, 659, 0.15, 'sine', 0.1), 150);
  setTimeout(() => beep(784, 784, 0.15, 'sine', 0.1), 300);
  setTimeout(() => beep(1046, 1046, 0.4, 'sine', 0.1), 450);
}

function gameOver() {
  state = 'over';
  const isRecord = saveRecord();
  document.getElementById('goTime').textContent = fmtTime(time);
  document.getElementById('goKills').textContent = kills;
  document.getElementById('goLevel').textContent = player.level;
  document.getElementById('goBest').textContent = fmtTime(currentLevel === 2 ? best2 : best);
  elNewRecord.classList.toggle('hidden', !isRecord);
  elGameover.classList.remove('hidden');
  beep(300, 60, 0.8, 'sawtooth', 0.1);
}

const btnLevel2 = document.getElementById('btnLevel2');
function updateLevelButtons() {
  btnLevel2.textContent = (level2Unlocked ? '🌴' : '🔒') + ' Niveau 2 — La cuisine de Pablo';
  btnLevel2.classList.toggle('locked', !level2Unlocked);
}
document.getElementById('btnStart').addEventListener('click', () => startGame(1));
btnLevel2.addEventListener('click', () => {
  // accès secret pour le debug : maintenir H en cliquant
  if (level2Unlocked || keys.has('KeyH')) { startGame(2); return; }
  const hint = document.getElementById('lockHint');
  hint.classList.remove('hidden');
  clearTimeout(updateLevelButtons._hintT);
  updateLevelButtons._hintT = setTimeout(() => hint.classList.add('hidden'), 2500);
  beep(200, 120, 0.15, 'square', 0.06);
});
document.getElementById('btnRestart').addEventListener('click', () => startGame());
document.getElementById('btnRestart2').addEventListener('click', () => startGame());
document.getElementById('btnNext').addEventListener('click', () => startGame(2));
updateLevelButtons();
document.getElementById('bestStart').textContent = best > 0 ? fmtTime(best) : '—';
document.getElementById('bestStart2').textContent = best2 > 0 ? fmtTime(best2) : '—';

// accès de debug (console)
window.DEBUG = {
  gainXp: v => gainXp(v),
  setTime: t => { time = t; },
  godMode: () => { player.maxHp = 99999; player.hp = 99999; },
  boss: () => { time = BOSS_TIME - 0.5; },
  aimant: () => { pickups.push({ x: player.x + 30, y: player.y, kind: 'aimant', bob: 0 }); },
  coke: () => { pickups.push({ x: player.x + 30, y: player.y, kind: 'coke', bob: 0 }); },
  strong: () => {
    player.weapons = [['poele', 6], ['couteau', 6], ['electrique', 6], ['champagne', 6], ['batteur', 5]]
      .map(([tp, lv]) => { const w = makeWeapon(tp); w.level = lv; return w; });
    player.maxHp = 400; player.hp = 400;
  },
  level: (lv = 2) => startGame(lv),
  strong2: () => {
    player.weapons = [['machette', 6], ['ak47', 6], ['grenade', 6], ['lanceflamme', 5], ['fouet', 5]]
      .map(([tp, lv]) => { const w = makeWeapon(tp); w.level = lv; return w; });
    player.maxHp = 400; player.hp = 400;
  },
  unlock: () => { level2Unlocked = true; localStorage.setItem('cauchemar_lvl2', '1'); updateLevelButtons(); },
  killBoss: () => { if (boss) boss.hp = 1; },
  step: (n = 60) => { for (let i = 0; i < n && state === 'play'; i++) update(1 / 60); render3d(); },
  info: () => ({ state, time, kills, enemies: enemies.length, projectiles: projectiles.length, hp: player.hp, level: player.level, weapons: player.weapons.map(w => w.type + ':' + w.level), boss: boss ? { hp: Math.round(boss.hp), state: boss.bstate } : null, aimants: pickups.filter(p => p.kind === 'aimant').length, cheese: pickups.filter(p => p.kind === 'cheese').length }),
};

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  pollGamepad();
  if (state === 'play') update(dt);
  render3d();
  requestAnimationFrame(frame);
}
initGame(); // pré-initialise pour dessiner la cuisine derrière l'écran titre
updateCameraAndAim();
requestAnimationFrame(frame);
