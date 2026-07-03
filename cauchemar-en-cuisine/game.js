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

// =================== DÉCOR : LA CUISINE ===================
(function buildKitchen() {
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
  scene.add(floor);

  // sol sombre au-delà de la cuisine
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: 0x241c14 }));
  outer.rotation.x = -HALF_PI;
  outer.position.set(WORLD_W / 2, -1, WORLD_H / 2);
  scene.add(outer);

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
  scene.add(new THREE.Mesh(mergeParts(parts), matV));
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

// ondes de choc (coup de poêle au sol)
const shockPool = [];
for (let i = 0; i < 3; i++) {
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

// assiettes lancées par le boss
const plateInst = makeInstanced(mergeParts([
  { geo: cylG(9, 7, 2.2, 14), color: '#eceff1' },
  { geo: cylG(6, 6, 1.2, 14), color: '#cfd8dc', y: 1.2 },
]), 90);

// bonus : aimant à fromage
const magnetGeo = mergeParts([
  { geo: boxG(5, 12, 5), color: '#e53935', x: -5.5, y: 8 },
  { geo: boxG(5, 12, 5), color: '#e53935', x: 5.5, y: 8 },
  { geo: boxG(16, 5.5, 5), color: '#c62828', y: 16 },
  { geo: boxG(5, 3.5, 5), color: '#eceff1', x: -5.5, y: 3 },
  { geo: boxG(5, 3.5, 5), color: '#eceff1', x: 5.5, y: 3 },
]);
const magnetInst = makeInstanced(magnetGeo, 8);

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
for (const t in ENEMY_GEOS) enemyInst[t] = makeInstanced(ENEMY_GEOS[t], t === 'souris' || t === 'rat' || t === 'cafard' ? 360 : 80);
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

// flaques de sauce
const puddlePool = [];
for (let i = 0; i < 16; i++) {
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
};
const ANNOUNCE_MSGS = {
  rat: '🐀 Les rats infestent la cuisine !',
  cafard: '🪳 Des cafards sortent des murs !',
  millepattes: '🐛 Un mille-pattes rampe sous les fourneaux !',
  chat: '🐈 Un chat de gouttière rôde… méfiance !',
  ratgeant: '🐀 UN RAT GÉANT DÉFONCE LA PORTE !',
  raton: '🦝 Le raton laveur veut sa revanche !',
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
const aimWorld = { x: 0, y: 0 };

function xpNeedFor(lv) { return Math.floor(5 + (lv - 1) * 4 + Math.pow(lv - 1, 1.65)); }

function initGame() {
  player = {
    x: WORLD_W / 2, y: WORLD_H / 2, r: 16,
    hp: 100, maxHp: 100, speed: 200, aim: 0,
    level: 1, xp: 0, xpNeed: xpNeedFor(1),
    weapons: [makeWeapon('poele')],
    hurtCd: 0, magnetR: 110, moving: false,
  };
  enemies = []; projectiles = []; puddles = []; effects = [];
  pickups = []; dmgTexts = []; particles = []; announcements = [];
  time = 0; kills = 0; spawnTimer = 0.5; nextId = 1; shake = 0;
  pendingLevels = 0; announced = {};
  boss = null; bossProjs = []; bossSpawned = false; bossWarned = false;
  bonusTimer = 60 + Math.random() * 40;
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
  const hpMul = 1 + time * 0.012 + Math.pow(time / 300, 2) * 0.35;
  const dmgMul = 1 + time * 0.0022;
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
  if (d.dasher) { e.cstate = 'stalk'; e.ct = 1 + Math.random() * 1.5; e.dashAng = 0; }
  if (d.enrage) { e.et = 5; e.enraged = false; }
  enemies.push(e);
}

// =================== BOSS : PHILIPPE CHUILEBEST ===================
function startBossFight() {
  bossSpawned = true;
  // la vermine détale, place au chef
  enemies = [];
  const d = ENEMY_DEFS.boss;
  const bx = player.x < WORLD_W / 2 ? player.x + 650 : player.x - 650;
  const by = player.y < WORLD_H / 2 ? player.y + 450 : player.y - 450;
  boss = {
    id: nextId++, type: 'boss', def: d,
    x: clamp(bx, WALL + d.r, WORLD_W - WALL - d.r),
    y: clamp(by, WALL + d.r, WORLD_H - WALL - d.r),
    r: d.r, hp: d.hp, maxHp: d.hp, dmg: d.dmg, speed: d.speed, xp: 0,
    kvx: 0, kvy: 0, atkCd: 0, hitFlash: 0, beaterCd: 0, slowT: 0,
    vx: 0, vy: 0, dead: false, face: 0, phase: 0,
    bstate: 'walk', bt: 2.5, lastAtk: '', volleys: 0, pv: 0, dashAng: 0,
  };
  enemies.push(boss);
  announcements.push({ txt: '👨‍🍳 PHILIPPE CHUILEBEST ENTRE EN CUISINE !', ttl: 5 });
  announcements.push({ txt: '« ON VA VOIR SI VOUS TENEZ LE SERVICE ! »', ttl: 5 });
  shake = 14;
  beep(80, 40, 1.2, 'sawtooth', 0.15);
  setTimeout(() => beep(60, 35, 1.2, 'sawtooth', 0.15), 400);
}

function bossWalkDur() { return 1.4 + Math.random() * 1.2; }

function pickBossAttack(e) {
  const pool = ['plates', 'charge', 'slam', 'summon'].filter(a => a !== e.lastAtk);
  const atk = pool[Math.floor(Math.random() * pool.length)];
  e.lastAtk = atk;
  if (atk === 'plates') { e.bstate = 'plates'; e.bt = 1.6; e.volleys = 3; e.pv = 0.1; }
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
    case 'walk':
      e.face = Math.atan2(dy, dx);
      e.x += (dx / dd) * e.speed * spd * dt;
      e.y += (dy / dd) * e.speed * spd * dt;
      if (e.bt <= 0) pickBossAttack(e);
      break;
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
      const sp = 640 * spd;
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

  // contact avec le joueur
  if (e.atkCd <= 0 && dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) * (e.r + player.r)) {
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
        desc: '+22% de dégâts, +7% de cadence' + (w.type === 'batteur' && (w.level % 2 === 0) ? ', +1 fouet' : ''),
        act: () => w.level++,
      });
    }
  }
  if (player.weapons.length < MAX_WEAPONS) {
    for (const t in WEAPON_DEFS) {
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
      weight: 4, icon: '🍲', tag: 'Rare', title: 'Soupe du jour',
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
    if (e.dead) continue;
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
    }
  }
}

// =================== MISE À JOUR ===================
function update(dt) {
  time += dt;

  // annonces de nouveaux ennemis
  for (const key in ENEMY_DEFS) {
    const d = ENEMY_DEFS[key];
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
  if (player.moving) {
    const n = Math.hypot(mx, my);
    const sp = player.speed * Math.min(1, n); // joystick analogique : vitesse proportionnelle
    player.x += (mx / n) * sp * dt;
    player.y += (my / n) * sp * dt;
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

  // --- spawn (suspendu pendant le combat de boss) ---
  if (!boss) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = Math.max(0.22, 0.8 - time * 0.001);
      const batch = 2 + Math.floor(time / 65);
      for (let i = 0; i < batch; i++) spawnEnemy();
    }
  }

  // --- bonus (aimant à fromage, etc.) ---
  bonusTimer -= dt;
  if (bonusTimer <= 0) {
    bonusTimer = 55 + Math.random() * 45;
    if (pickups.filter(p => p.kind === 'aimant').length < 2) {
      for (let i = 0; i < 6; i++) {
        const x = WALL + 90 + Math.random() * (WORLD_W - 2 * WALL - 180);
        const y = WALL + 90 + Math.random() * (WORLD_H - 2 * WALL - 180);
        if (dist2(x, y, player.x, player.y) > 350 * 350) {
          pickups.push({ x, y, kind: 'aimant', bob: 0 });
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
    e.atkCd = Math.max(0, e.atkCd - dt);
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.beaterCd = Math.max(0, e.beaterCd - dt);
    e.slowT = Math.max(0, e.slowT - dt);

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
      e.ct -= dt;
      if (e.cstate === 'stalk') {
        if (e.ct <= 0) { e.cstate = 'windup'; e.ct = 0.45; }
      } else if (e.cstate === 'windup') {
        sp = 0;
        if (e.ct <= 0) { e.cstate = 'dash'; e.ct = 0.38; e.dashAng = Math.atan2(dy, dx); }
      } else { // dash
        sp = e.speed * 4.2;
        dirx = Math.cos(e.dashAng); diry = Math.sin(e.dashAng);
        if (e.ct <= 0) { e.cstate = 'stalk'; e.ct = 1.2 + Math.random() * 1.2; }
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
    if (e.dead || e.def.boss) continue;
    gridQuery(e.x, e.y, e.r + 35, o => {
      if (o.dead || o.id <= e.id || o.def.boss) return;
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
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.ttl -= dt;

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
        p.pierce--;
        if (p.pierce < 0) p.dead = true;
      }
    });
  }
  projectiles = projectiles.filter(p => !p.dead);

  // --- assiettes du boss ---
  for (const p of bossProjs) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.ttl -= dt;
    if (p.ttl <= 0 || p.x < WALL || p.x > WORLD_W - WALL || p.y < WALL || p.y > WORLD_H - WALL) {
      p.dead = true;
      splat(p.x, p.y, '#eceff1', 4);
    } else if (dist2(p.x, p.y, player.x, player.y) < (p.r + player.r) * (p.r + player.r)) {
      damagePlayer(p.dmg);
      splat(p.x, p.y, '#eceff1', 6);
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
      else if (pk.kind === 'soup') { heal(player.maxHp * 0.25); sndPickup(); }
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

  // poêle : en main, ou en train de frapper
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
  panMesh.visible = chefMesh.visible;
  panMesh.position.set(player.x + Math.cos(panAng) * panR, panY, player.y + Math.sin(panAng) * panR);
  panMesh.rotation.y = -panAng;

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
    bossMesh.visible = true;
    const tele = boss.bstate === 'chargeTele' || boss.bstate === 'slamTele' || boss.bstate === 'summon';
    const ox = tele ? (Math.random() - 0.5) * 7 : 0;
    const oz = tele ? (Math.random() - 0.5) * 7 : 0;
    const stomp = boss.bstate === 'walk' || boss.bstate === 'charge' ? Math.abs(Math.sin(t * 8)) * 5 : 0;
    bossMesh.position.set(boss.x + ox, stomp, boss.y + oz);
    bossMesh.rotation.y = -boss.face;
    bossMesh.rotation.z = boss.bstate === 'stun' ? 0.3 : 0;
    const pop = 1 + boss.hitFlash * 0.8;
    const enrPulse = boss.hp < boss.maxHp * 0.3 ? 1 + Math.sin(t * 14) * 0.03 : 1;
    bossMesh.scale.setScalar(3.4 * pop * enrPulse);
    if (shadowCount < 890) setInst(shadowInst, shadowCount++, boss.x, 0.5, boss.y, 0, 4.6);

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
    slamTeleMesh.visible = false;
    chargeTeleMesh.visible = false;
  }

  // ondes de choc
  const shocks = effects.filter(fx => fx.kind === 'shock');
  for (let i = 0; i < shockPool.length; i++) {
    const m = shockPool[i];
    if (i < shocks.length) {
      const fx = shocks[i];
      const pr = fx.t / fx.dur;
      m.visible = true;
      m.position.set(fx.x, 3, fx.y);
      m.scale.setScalar(fx.range * (0.15 + 0.85 * pr));
      m.material.opacity = 0.8 * (1 - pr);
    } else m.visible = false;
  }

  // assiettes du boss
  let plateCount = 0;
  for (const p of bossProjs) {
    if (plateCount >= plateInst.userData.cap) break;
    setInst(plateInst, plateCount++, p.x, 18, p.y, t * 7);
  }
  plateInst.count = plateCount;
  plateInst.instanceMatrix.needsUpdate = true;

  // --- ramassables ---
  let cheeseCount = 0, soupCount = 0, magnetCount = 0;
  for (const pk of pickups) {
    pk.bob += 0.1;
    const by = 2 + Math.sin(pk.bob) * 2.5;
    if (pk.kind === 'cheese' && cheeseCount < 420) {
      setInst(cheeseInst, cheeseCount++, pk.x, by, pk.y, pk.bob * 0.5);
      if (shadowCount < 890) setInst(shadowInst, shadowCount++, pk.x, 0.5, pk.y, 0, 0.7);
    } else if (pk.kind === 'soup' && soupCount < 40) {
      setInst(soupInst, soupCount++, pk.x, by, pk.y, 0);
      if (shadowCount < 890) setInst(shadowInst, shadowCount++, pk.x, 0.5, pk.y, 0, 0.8);
    } else if (pk.kind === 'aimant' && magnetCount < 8) {
      setInst(magnetInst, magnetCount++, pk.x, 4 + Math.sin(pk.bob) * 3, pk.y, t * 2.2);
      if (shadowCount < 890) setInst(shadowInst, shadowCount++, pk.x, 0.5, pk.y, 0, 1.1);
    }
  }
  cheeseInst.count = cheeseCount; cheeseInst.instanceMatrix.needsUpdate = true;
  soupInst.count = soupCount; soupInst.instanceMatrix.needsUpdate = true;
  magnetInst.count = magnetCount; magnetInst.instanceMatrix.needsUpdate = true;
  shadowInst.count = shadowCount; shadowInst.instanceMatrix.needsUpdate = true;

  // --- projectiles ---
  let knifeCount = 0, corkCount = 0, globCount = 0;
  for (const p of projectiles) {
    if (p.kind === 'knife' && knifeCount < 60) {
      setInst(knifeInst, knifeCount++, p.x, 16, p.y, -Math.atan2(p.vy, p.vx));
    } else if (p.kind === 'cork' && corkCount < 20) {
      setInst(corkInst, corkCount++, p.x, 12, p.y, -Math.atan2(p.vy, p.vx));
    } else if (p.kind === 'glob' && globCount < 20) {
      const h = Math.sin(Math.PI * (1 - p.ttl / p.ttl0)) * 42;
      setInst(globInst, globCount++, p.x, 8 + h, p.y, 0);
    }
  }
  knifeInst.count = knifeCount; knifeInst.instanceMatrix.needsUpdate = true;
  corkInst.count = corkCount; corkInst.instanceMatrix.needsUpdate = true;
  globInst.count = globCount; globInst.instanceMatrix.needsUpdate = true;

  // --- flaques ---
  for (let i = 0; i < puddlePool.length; i++) {
    const m = puddlePool[i];
    if (i < puddles.length) {
      const pu = puddles[i];
      m.visible = true;
      m.position.set(pu.x, 0.7 + i * 0.05, pu.y);
      m.scale.setScalar(pu.r);
      m.material.opacity = 0.55 * Math.min(1, pu.ttl / 0.8);
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

  // --- anneaux du hachoir ---
  const pulses = effects.filter(fx => fx.kind === 'pulse');
  for (let i = 0; i < pulsePool.length; i++) {
    const m = pulsePool[i];
    if (i < pulses.length) {
      const fx = pulses[i];
      const pr = fx.t / fx.dur;
      m.visible = true;
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

  // barre d'XP en haut
  hctx.fillStyle = 'rgba(0,0,0,0.6)';
  hctx.fillRect(0, 0, VW, 16);
  hctx.fillStyle = '#ffd54f';
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
    const bw = Math.min(520, VW * 0.55), bx = VW / 2 - bw / 2, by = 88;
    hctx.textAlign = 'center';
    hctx.font = 'bold 17px system-ui';
    hctx.strokeStyle = 'rgba(0,0,0,0.8)';
    hctx.lineWidth = 4;
    hctx.strokeText('👨‍🍳 PHILIPPE CHUILEBEST', VW / 2, by - 12);
    hctx.fillStyle = '#ff8a65';
    hctx.fillText('👨‍🍳 PHILIPPE CHUILEBEST', VW / 2, by - 12);
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
  const rightLines = [`💀 ${kills}`, `🏆 ${best > 0 ? fmtTime(best) : '—'}`];
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

function startGame() {
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

function victory() {
  state = 'victory';
  boss = null;
  bossProjs = [];
  shake = 18;
  const isRecord = time > best;
  if (isRecord) {
    best = time;
    localStorage.setItem('cauchemar_best', String(best));
  }
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
  const isRecord = time > best;
  if (isRecord) {
    best = time;
    localStorage.setItem('cauchemar_best', String(best));
  }
  document.getElementById('goTime').textContent = fmtTime(time);
  document.getElementById('goKills').textContent = kills;
  document.getElementById('goLevel').textContent = player.level;
  document.getElementById('goBest').textContent = fmtTime(best);
  elNewRecord.classList.toggle('hidden', !isRecord);
  elGameover.classList.remove('hidden');
  beep(300, 60, 0.8, 'sawtooth', 0.1);
}

document.getElementById('btnStart').addEventListener('click', startGame);
document.getElementById('btnRestart').addEventListener('click', startGame);
document.getElementById('btnRestart2').addEventListener('click', startGame);
document.getElementById('bestStart').textContent = best > 0 ? fmtTime(best) : '—';

// accès de debug (console)
window.DEBUG = {
  gainXp: v => gainXp(v),
  setTime: t => { time = t; },
  godMode: () => { player.maxHp = 99999; player.hp = 99999; },
  boss: () => { time = BOSS_TIME - 0.5; },
  aimant: () => { pickups.push({ x: player.x + 30, y: player.y, kind: 'aimant', bob: 0 }); },
  strong: () => {
    player.weapons = [['poele', 6], ['couteau', 6], ['electrique', 6], ['champagne', 6], ['batteur', 5]]
      .map(([tp, lv]) => { const w = makeWeapon(tp); w.level = lv; return w; });
    player.maxHp = 400; player.hp = 400;
  },
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
