// Les 7 pilotes de l'apocalypse et leurs véhicules (meshes procéduraux low-poly).
// Convention : le véhicule regarde vers +Z, racine posée au sol (y=0).
import * as THREE from 'three';

// stats normalisées 0..1 (speed = vitesse max, accel, turn = maniabilité, weight = poids)
export const CHARACTERS = [
  { id: 'shoe',  name: 'Michael Shoe Maker',      tag: 'La chaussure la plus agile du désert', color: 0xa5682a,
    stats: { speed: .90, accel: .90, turn: 1.00, weight: .35 } },
  { id: 'max',   name: 'Max Veramoitiestaplein',  tag: 'Bolide ultime, mais long à lancer',    color: 0x2255cc,
    stats: { speed: 1.00, accel: .55, turn: .80, weight: .55 } },
  { id: 'nein',  name: 'Nein Nein',               tag: 'Taxi new-yorkais indestructible',      color: 0xf2b422,
    stats: { speed: .88, accel: .82, turn: .85, weight: .70 } },
  { id: 'fury',  name: 'Rob Fury',                tag: 'Un bus. Oui, un bus.',                 color: 0x8a2f22,
    stats: { speed: .84, accel: .50, turn: .60, weight: 1.00 } },
  { id: 'nails', name: 'Will Nails',              tag: 'Fiable, équilibré, increvable',        color: 0x4a7a4a,
    stats: { speed: .88, accel: .80, turn: .88, weight: .60 } },
  { id: 'lee',   name: 'Lee Tranchey',            tag: 'Du muscle et de la tôle',              color: 0x555a66,
    stats: { speed: .92, accel: .68, turn: .78, weight: .85 } },
  { id: 'shark', name: 'Shark Leclair',           tag: 'Rouge, léger, un aileron de requin',   color: 0xd42222,
    stats: { speed: .95, accel: .88, turn: .93, weight: .40 } },
];

export const charById = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const DARK = 0x1a1a1c, GLASS = 0x9fb8c9, RUST = 0x6e4a2a;

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

function wheel(r, w) {
  const g = new THREE.CylinderGeometry(r, r, w, 12);
  g.rotateZ(Math.PI / 2); // axe X → roule autour de X quand on tourne rotation.x
  const tire = new THREE.Mesh(g, mat(0x151515));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * .45, r * .45, w + .02, 8), mat(0x777777));
  hub.geometry.rotateZ(Math.PI / 2);
  tire.add(hub);
  return tire;
}

// roues ajoutées au groupe + référencées pour l'animation
function addWheels(g, r, w, xOff, zFront, zBack, y = null) {
  const ws = [];
  const yy = y == null ? r : y;
  for (const [x, z] of [[-xOff, zFront], [xOff, zFront], [-xOff, zBack], [xOff, zBack]]) {
    const wh = wheel(r, w);
    wh.position.set(x, yy, z);
    g.add(wh); ws.push(wh);
  }
  g.userData.wheels = ws;
  g.userData.frontWheels = ws.slice(0, 2);
  return ws;
}

// petites touches post-apo communes : pare-buffle rouillé, bidons…
function bullbar(width, y, z) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, width, 6), mat(RUST));
  bar.geometry.rotateZ(Math.PI / 2);
  bar.position.set(0, y, z);
  g.add(bar);
  const bar2 = bar.clone(); bar2.position.y = y - .28; g.add(bar2);
  return g;
}

const builders = {
  // ——— Michael Shoe Maker : une basket de course ———
  shoe(c) {
    const g = new THREE.Group();
    const sole = box(1.9, .45, 4.0, 0xe8e0d0, 0, .45, 0);
    const body = box(1.7, .8, 2.9, c, 0, 1.05, -0.35);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(.85, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(c));
    toe.scale.set(1, .95, 1.35); toe.position.set(0, .68, 1.35);
    const tongue = box(.9, .5, 1.2, 0xd9c9a8, 0, 1.5, .35);
    tongue.rotation.x = -.35;
    const collar = box(1.75, .55, 1.1, 0x3a2c1c, 0, 1.55, -1.3);
    g.add(sole, body, toe, tongue, collar);
    // lacets
    for (let i = 0; i < 3; i++) {
      const lace = box(1.0, .09, .14, 0xf5f0e0, 0, 1.28 + i * .18, .75 - i * .32);
      lace.rotation.x = -.3;
      g.add(lace);
    }
    addWheels(g, .42, .3, .95, 1.35, -1.35);
    return g;
  },

  // ——— Max : monoplace F1 ———
  max(c) {
    const g = new THREE.Group();
    const nose = box(.7, .4, 2.2, c, 0, .55, 1.6);
    nose.scale.z = 1;
    const body = box(1.1, .55, 2.6, c, 0, .6, -0.2);
    const cockpit = box(.75, .45, 1.0, DARK, 0, .95, -0.4);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.45, .06, 6, 12, Math.PI), mat(0x222222));
    halo.position.set(0, 1.05, -0.4); halo.rotation.z = Math.PI;
    const frontWing = box(2.1, .1, .55, 0x0a0a0a, 0, .3, 2.5);
    const rearWing = box(1.9, .5, .1, 0x0a0a0a, 0, 1.15, -2.15);
    const rearWingTop = box(1.9, .08, .5, c, 0, 1.4, -2.1);
    const sidepodL = box(.45, .45, 1.4, 0x18181a, -.75, .55, -0.5);
    const sidepodR = sidepodL.clone(); sidepodR.position.x = .75;
    g.add(nose, body, cockpit, halo, frontWing, rearWing, rearWingTop, sidepodL, sidepodR);
    addWheels(g, .5, .42, 1.05, 1.55, -1.55);
    return g;
  },

  // ——— Nein Nein : taxi jaune NY ———
  nein(c) {
    const g = new THREE.Group();
    const body = box(2.0, .85, 4.3, c, 0, .85, 0);
    const cabin = box(1.8, .75, 2.2, c, 0, 1.6, -0.2);
    const winF = box(1.65, .55, .1, GLASS, 0, 1.62, .92);
    winF.rotation.x = .18;
    const winB = box(1.65, .55, .1, GLASS, 0, 1.62, -1.32);
    winB.rotation.x = -.18;
    const sign = box(1.1, .35, .5, 0xfff6d8, 0, 2.15, -0.2);
    const checkerL = box(.02, .28, 3.6, 0x111111, -1.01, 1.0, 0);
    const checkerR = checkerL.clone(); checkerR.position.x = 1.01;
    const bumF = box(2.05, .3, .3, 0x8f8f8f, 0, .45, 2.2);
    const bumB = box(2.05, .3, .3, 0x8f8f8f, 0, .45, -2.2);
    g.add(body, cabin, winF, winB, sign, checkerL, checkerR, bumF, bumB, bullbar(2.1, .8, 2.35));
    addWheels(g, .45, .32, 1.0, 1.45, -1.45);
    return g;
  },

  // ——— Rob Fury : bus de guerre ———
  fury(c) {
    const g = new THREE.Group();
    const body = box(2.3, 2.1, 6.0, c, 0, 1.55, 0);
    const roofJunk = box(2.0, .5, 3.5, RUST, 0, 2.85, -0.6);
    const winF = box(2.0, .8, .12, GLASS, 0, 2.0, 3.02);
    // fenêtres latérales condamnées par des planches
    for (let i = 0; i < 4; i++) {
      const pL = box(.06, .8, 1.0, 0x7d5a33, -1.19, 2.0, 2.0 - i * 1.4);
      pL.rotation.x = (i % 2 ? .12 : -.12);
      const pR = pL.clone(); pR.position.x = 1.19;
      g.add(pL, pR);
    }
    const plow = new THREE.Mesh(new THREE.CylinderGeometry(.2, 1.4, 1.1, 4, 1), mat(0x50565e));
    plow.rotation.set(Math.PI, Math.PI / 4, 0);
    plow.scale.set(1.9, 1, .8);
    plow.position.set(0, .8, 3.3);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, 1.2, 6), mat(0x2a2a2a));
    chimney.position.set(.8, 3.2, -2.2);
    g.add(body, roofJunk, winF, plow, chimney);
    addWheels(g, .58, .45, 1.15, 2.0, -2.0);
    return g;
  },

  // ——— Will Nails : berline classique ———
  nails(c) {
    const g = new THREE.Group();
    const body = box(1.95, .8, 4.2, c, 0, .8, 0);
    const cabin = box(1.75, .7, 2.0, c, 0, 1.5, -0.3);
    const winF = box(1.6, .5, .1, GLASS, 0, 1.55, .74);
    winF.rotation.x = .3;
    const winB = box(1.6, .5, .1, GLASS, 0, 1.55, -1.34);
    winB.rotation.x = -.3;
    const bumF = box(2.0, .28, .3, 0x9a9a9a, 0, .42, 2.15);
    const bumB = box(2.0, .28, .3, 0x9a9a9a, 0, .42, -2.15);
    // capot rouillé dépareillé, très posts-apo
    const hood = box(1.7, .1, 1.2, RUST, 0, 1.22, 1.35);
    g.add(body, cabin, winF, winB, bumF, bumB, hood);
    addWheels(g, .45, .32, .98, 1.4, -1.4);
    return g;
  },

  // ——— Lee Tranchey : muscle car lourde ———
  lee(c) {
    const g = new THREE.Group();
    const body = box(2.15, .85, 4.5, c, 0, .85, 0);
    const cabin = box(1.85, .65, 1.7, c, 0, 1.55, -0.5);
    const winF = box(1.7, .5, .1, GLASS, 0, 1.58, .38);
    winF.rotation.x = .38;
    const scoop = box(.7, .35, 1.0, DARK, 0, 1.35, 1.3);
    const exhL = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, 1.1, 6), mat(0x888888));
    exhL.rotation.x = .5; exhL.position.set(-.95, 1.15, .3);
    const exhR = exhL.clone(); exhR.position.x = .95;
    const spoiler = box(2.1, .1, .45, DARK, 0, 1.45, -2.2);
    const blade = box(2.3, .08, .4, 0xb9bfc7, 0, .6, 2.45); // lame avant
    g.add(body, cabin, winF, scoop, exhL, exhR, spoiler, blade, bullbar(2.2, .85, 2.3));
    addWheels(g, .5, .4, 1.08, 1.5, -1.5);
    return g;
  },

  // ——— Shark Leclair : rouge, aileron de requin ———
  shark(c) {
    const g = new THREE.Group();
    const body = box(1.8, .7, 4.0, c, 0, .72, 0);
    const noseCone = new THREE.Mesh(new THREE.ConeGeometry(.85, 1.3, 4), mat(c));
    noseCone.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    noseCone.scale.set(1.25, 1, .8);
    noseCone.position.set(0, .72, 2.5);
    const cabin = box(1.5, .55, 1.5, c, 0, 1.32, -0.3);
    const win = box(1.35, .4, .1, GLASS, 0, 1.35, .5);
    win.rotation.x = .35;
    // l'aileron requin
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0); finShape.lineTo(1.5, 0); finShape.lineTo(.55, 1.1); finShape.lineTo(.15, 1.15); finShape.lineTo(0, 0);
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: .12, bevelEnabled: false }), mat(0xb8bec6));
    fin.rotation.y = -Math.PI / 2;
    fin.position.set(.06, 1.55, -0.1);
    const gill1 = box(.05, .35, .1, 0x7a1010, -.91, .85, .8);
    const gill2 = gill1.clone(); gill2.position.z = .55;
    const gill1R = gill1.clone(); gill1R.position.x = .91;
    const gill2R = gill2.clone(); gill2R.position.x = .91;
    g.add(body, noseCone, cabin, win, fin, gill1, gill2, gill1R, gill2R);
    addWheels(g, .44, .34, .95, 1.35, -1.35);
    return g;
  },
};

// tint : variante de couleur pour les doublons IA
export function buildCarMesh(charId, tint = null) {
  const c = charById(charId);
  const color = tint != null ? tint : c.color;
  const g = builders[c.id](color);
  g.traverse(o => { if (o.isMesh) { o.matrixAutoUpdate = true; } });
  return g;
}

// rayon de collision & dimensions par véhicule
export function carRadius(charId) {
  return charId === 'fury' ? 2.3 : charId === 'lee' ? 1.75 : 1.55;
}
