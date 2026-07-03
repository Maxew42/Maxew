// Piste procédurale en boucle fermée + décor post-apocalyptique.
// Même seed → même piste sur toutes les machines (multijoueur).
import * as THREE from 'three';
import { mulberry32, clamp, lerp, angleDelta } from './util.js';

const ROAD_HALF = 7;      // demi-largeur du bitume
const WALL_DIST = 16;     // murs infranchissables (zone hors-piste entre les deux)
const SAMPLES = 560;      // points d'échantillonnage de la boucle

// ————— textures canvas —————
function canvasTex(w, h, draw, repX = 1, repY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function asphaltTex(rng) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3d3b38'; g.fillRect(0, 0, w, h);
    // grain
    for (let i = 0; i < 2600; i++) {
      const v = 40 + rng() * 40;
      g.fillStyle = `rgba(${v},${v},${v * .96},.5)`;
      g.fillRect(rng() * w, rng() * h, 2, 2);
    }
    // fissures
    g.strokeStyle = 'rgba(15,13,11,.7)'; g.lineWidth = 1.6;
    for (let i = 0; i < 7; i++) {
      let x = rng() * w, y = rng() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 8; s++) { x += (rng() - .5) * 40; y += rng() * 30; g.lineTo(x, y); }
      g.stroke();
    }
    // plaques réparées
    for (let i = 0; i < 4; i++) {
      g.fillStyle = 'rgba(30,28,26,.55)';
      g.fillRect(rng() * w, rng() * h, 30 + rng() * 50, 24 + rng() * 40);
    }
    // lignes de bord usées + médiane pointillée
    g.fillStyle = 'rgba(220,210,190,.42)';
    g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
    g.fillStyle = 'rgba(230,180,60,.4)';
    for (let y = 0; y < h; y += 42) g.fillRect(w / 2 - 3, y, 6, 22);
  });
}

function wallTex(rng) {
  return canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#5a4632'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { // tôle ondulée
      g.fillStyle = x % 16 ? '#4c3a28' : '#66503a';
      g.fillRect(x, 0, 8, h);
    }
    for (let i = 0; i < 26; i++) { // rouille
      g.fillStyle = `rgba(${120 + rng() * 60},${50 + rng() * 30},20,${.25 + rng() * .3})`;
      g.beginPath(); g.arc(rng() * w, rng() * h, 3 + rng() * 9, 0, 7); g.fill();
    }
  }, 1, 1);
}

function buildingTex(rng) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#4a4038'; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 8; y += 22) {
      for (let x = 8; x < w - 8; x += 20) {
        const r = rng();
        g.fillStyle = r < .12 ? '#c9a24a' : r < .5 ? '#171a20' : '#242a32'; // rares fenêtres allumées
        if (r < .88) g.fillRect(x, y, 12, 14); // fenêtres manquantes = béton
        if (rng() < .15) { g.fillStyle = 'rgba(20,16,12,.8)'; g.fillRect(x - 2, y + 10, 16, 8); } // impacts
      }
    }
  }, 1, 1);
}

function groundTex(rng) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6e5c42'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3200; i++) {
      const v = rng();
      g.fillStyle = v < .5 ? 'rgba(90,74,52,.6)' : 'rgba(130,112,82,.5)';
      g.fillRect(rng() * w, rng() * h, 2 + rng() * 3, 2 + rng() * 3);
    }
    for (let i = 0; i < 14; i++) { // taches de cendre
      g.fillStyle = 'rgba(60,52,44,.35)';
      g.beginPath(); g.arc(rng() * w, rng() * h, 8 + rng() * 24, 0, 7); g.fill();
    }
  }, 40, 40);
}

function crateTex() {
  return canvasTex(96, 96, (g, w, h) => {
    g.fillStyle = '#9a713d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#825c2e';
    for (let y = 0; y < h; y += 24) g.fillRect(0, y, w, 3);
    g.strokeStyle = '#6b4a22'; g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.strokeStyle = 'rgba(60,40,18,.8)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(6, 6); g.lineTo(w - 6, h - 6); g.moveTo(w - 6, 6); g.lineTo(6, h - 6); g.stroke();
    g.fillStyle = '#ffd869'; g.font = '900 44px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', w / 2, h / 2 + 2);
  });
}

function skyTex() {
  return canvasTex(16, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2b1a2e');   // zénith mauve sombre
    gr.addColorStop(.45, '#7a3f28');
    gr.addColorStop(.62, '#c8763a'); // horizon orange sale
    gr.addColorStop(.72, '#e0954a');
    gr.addColorStop(1, '#8a5a34');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

// ————— fusion de géométries (même matériau → 1 draw call) —————
function mergeGeoms(geoms, withColor = false) {
  let nv = 0, ni = 0;
  for (const g of geoms) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = withColor ? new Float32Array(nv * 3) : null;
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3); nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    if (col) {
      const c = g.attributes.color;
      if (c) col.set(c.array, vo * 3);
      else col.fill(1, vo * 3, (vo + p.count) * 3);
    }
    const nIdx = g.index ? g.index.count : p.count; // géométries non indexées (ex: Dodecahedron)
    for (let i = 0; i < nIdx; i++) idx[io + i] = (g.index ? g.index.array[i] : i) + vo;
    vo += p.count; io += nIdx;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function tinted(geom, hex) {
  const c = new THREE.Color(hex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

const M4 = new THREE.Matrix4();
function place(geom, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
  M4.makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  M4.scale(new THREE.Vector3(s, s, s));
  M4.setPosition(x, y, z);
  geom.applyMatrix4(M4);
  return geom;
}

export class Track {
  constructor(seed) {
    this.seed = seed;
    const rng = this.rng = mulberry32(seed);
    this.halfW = ROAD_HALF;
    this.wallDist = WALL_DIST;
    this.group = new THREE.Group();

    // ——— tracé : boucle fermée volontairement biscornue ———
    // On tente plusieurs formes (déterministe par seed) et on garde la première
    // dont le couloir ne se recoupe pas lui-même.
    let raw = null;
    for (let att = 0; att < 14 && !raw; att++) {
      raw = this._genLoop(mulberry32(seed + att * 7919), att === 13);
    }
    this.N = raw.length;

    // place la ligne de départ (index 0) sur la portion la plus rectiligne
    const N = this.N;
    const hs = raw.map((p, i) => {
      const q = raw[(i + 1) % N];
      return Math.atan2(q.x - p.x, q.z - p.z);
    });
    let bestI = 0, bestC = 1e9;
    for (let i = 0; i < N; i += 2) {
      let c = 0;
      for (let k = -12; k < 12; k++) {
        c += Math.abs(angleDelta(hs[((i + k) % N + N) % N], hs[((i + k + 1) % N + N) % N]));
      }
      if (c < bestC) { bestC = c; bestI = i; }
    }
    this.pts = raw.slice(bestI).concat(raw.slice(0, bestI));

    // tangentes / vecteurs "gauche"
    this.tan = []; this.left = [];
    for (let i = 0; i < this.N; i++) {
      const a = this.pts[(i - 1 + this.N) % this.N], b = this.pts[(i + 1) % this.N];
      const t = new THREE.Vector3().subVectors(b, a).normalize();
      this.tan.push(t);
      this.left.push(new THREE.Vector3(t.z, 0, -t.x));
    }
    let len = 0;
    for (let i = 0; i < this.N; i++) len += this.pts[i].distanceTo(this.pts[(i + 1) % this.N]);
    this.length = len;
    this.segLen = len / this.N;

    this._buildRoad(rng);
    this._buildDecor(rng);
    this._buildCrates(rng);
    this._buildSky();

    // minimap
    this.minimapPts = this.pts.map(p => [p.x, p.z]);
  }

  // Génère une boucle candidate : secteurs angulaires irréguliers, marche
  // aléatoire du rayon, lobes globaux (cacahuète/trèfle), épingle éventuelle,
  // axes écrasés. Renvoie null si le couloir se rapproche trop de lui-même.
  _genLoop(rng, forceAccept = false) {
    const nc = 12 + Math.floor(rng() * 5); // 12..16 points de contrôle
    const sweepAt = Math.floor(rng() * nc);
    const inSweep = i => ((i - sweepAt + nc) % nc) < 4;

    // secteurs de tailles très inégales (réguliers dans la zone du grand virage)
    const weights = [];
    let wsum = 0;
    for (let i = 0; i < nc; i++) {
      const w = inSweep(i) ? 1 : .5 + rng() * 1.2;
      weights.push(w); wsum += w;
    }
    const angles = [];
    let acc = 0;
    for (let i = 0; i < nc; i++) { acc += weights[i] / wsum * Math.PI * 2; angles.push(acc); }

    // rayons : marche aléatoire à grands écarts
    const radii = [];
    let r = 150 + rng() * 100;
    for (let i = 0; i < nc; i++) {
      r = clamp(r + (rng() - .5) * 140, 110, 300);
      radii.push(r);
    }
    // une épingle bien marquée (creux serré entre deux points larges), hors du grand virage
    if (rng() < .65) {
      let h = Math.floor(rng() * nc);
      for (let tries = 0; tries < nc && (((h - sweepAt + nc) % nc) < 5 || ((sweepAt - h + nc) % nc) < 2); tries++) h = (h + 1) % nc;
      radii[h] = 92 + rng() * 25;
      radii[(h + 1) % nc] = clamp(radii[(h + 1) % nc], 175, 260);
      radii[(h - 1 + nc) % nc] = clamp(radii[(h - 1 + nc) % nc], 175, 260);
    }
    // garantit UN grand virage soutenu (~110°) à rayon constant, parfait pour drifter
    const sweepR = 145 + rng() * 25;
    for (let k = 0; k < 4; k++) radii[(sweepAt + k) % nc] = sweepR;
    radii[(sweepAt + nc - 1) % nc] = clamp(sweepR + 105, 130, 300);
    radii[(sweepAt + 4) % nc] = clamp(sweepR + 105, 130, 300);

    // lobes globaux (gelés dans la zone du grand virage pour garder son rayon constant)
    const lobes = 2 + Math.floor(rng() * 2);
    const lobeAmp = 18 + rng() * 38;
    const lobePhase = rng() * Math.PI * 2;
    const lobeAt = a => Math.sin(a * lobes + lobePhase) * lobeAmp;
    // écrasement doux des axes (l'ovale casse le côté "cercle")
    const sx = .8 + rng() * .4, sz = .8 + rng() * .4;

    const ctrl = [];
    for (let i = 0; i < nc; i++) {
      const a = angles[i];
      const rr = clamp(radii[i] + lobeAt(inSweep(i) ? angles[sweepAt] : a), 88, 330);
      ctrl.push(new THREE.Vector3(Math.cos(a) * rr * sx, 0, Math.sin(a) * rr * sz));
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'catmullrom', .6);
    const pts = curve.getSpacedPoints(SAMPLES);
    pts.pop(); // dernier == premier

    if (!forceAccept && this._selfTooClose(pts)) return null;
    return pts;
  }

  // deux portions éloignées sur le ruban mais proches dans l'espace → couloirs
  // (route + murs, ~32 u de large) qui se chevauchent : forme rejetée
  _selfTooClose(pts) {
    const N = pts.length;
    const MIN_D2 = 36 * 36, RING_GAP = 26;
    for (let i = 0; i < N; i += 2) {
      const p = pts[i];
      for (let j = i + RING_GAP; j < N; j += 2) {
        if (i + N - j < RING_GAP) continue; // voisins en passant par la fermeture
        const dx = p.x - pts[j].x, dz = p.z - pts[j].z;
        if (dx * dx + dz * dz < MIN_D2) return true;
      }
    }
    return false;
  }

  // ——— géométrie de la route, murs, ligne de départ ———
  _buildRoad(rng) {
    const N = this.N;
    const mkRibbon = (lat0, lat1, y, texture, vRep) => {
      const pos = new Float32Array((N + 1) * 2 * 3), uv = new Float32Array((N + 1) * 2 * 2), nor = new Float32Array((N + 1) * 2 * 3);
      const idx = new Uint32Array(N * 6);
      for (let i = 0; i <= N; i++) {
        const k = i % N, p = this.pts[k], l = this.left[k];
        const v = i / N * vRep;
        pos.set([p.x + l.x * lat0, y, p.z + l.z * lat0, p.x + l.x * lat1, y, p.z + l.z * lat1], i * 6);
        nor.set([0, 1, 0, 0, 1, 0], i * 6);
        uv.set([0, v, 1, v], i * 4);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        idx.set([a, b, c, b, d, c], i * 6); // CCW vu du dessus
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: texture }));
    };

    const road = mkRibbon(ROAD_HALF, -ROAD_HALF, 0.02, asphaltTex(rng), Math.round(this.length / 9));
    this.group.add(road);

    // murs de tôle des deux côtés
    const wallT = wallTex(rng);
    for (const side of [1, -1]) {
      const N2 = this.N;
      const pos = new Float32Array((N2 + 1) * 2 * 3), uv = new Float32Array((N2 + 1) * 2 * 2), nor = new Float32Array((N2 + 1) * 2 * 3);
      const idx = new Uint32Array(N2 * 6);
      for (let i = 0; i <= N2; i++) {
        const k = i % N2, p = this.pts[k], l = this.left[k];
        const x = p.x + l.x * WALL_DIST * side, z = p.z + l.z * WALL_DIST * side;
        pos.set([x, 0, z, x, 1.7, z], i * 6);
        nor.set([-l.x * side, 0, -l.z * side, -l.x * side, 0, -l.z * side], i * 6);
        const v = i / N2 * Math.round(this.length / 4);
        uv.set([v, 0, v, 1], i * 4);
      }
      for (let i = 0; i < N2; i++) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        idx.set([a, c, b, b, c, d], i * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: wallT, side: THREE.DoubleSide })));
    }

    // sol
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshLambertMaterial({ map: groundTex(rng) })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.group.add(ground);

    // ligne de départ : damier + portique
    const p0 = this.pts[0], l0 = this.left[0], t0 = this.tan[0];
    const checker = canvasTex(64, 8, (g) => {
      for (let x = 0; x < 8; x++) for (let y = 0; y < 1; y++) {
        g.fillStyle = x % 2 ? '#111' : '#eee';
        g.fillRect(x * 8, 0, 8, 8);
      }
    }, 1, 1);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 3), new THREE.MeshBasicMaterial({ map: checker }));
    line.rotation.order = 'YXZ'; // plat au sol PUIS orienté selon la piste
    line.rotation.y = Math.atan2(t0.x, t0.z);
    line.rotation.x = -Math.PI / 2;
    line.position.set(p0.x, 0.06, p0.z);
    this.group.add(line);

    const pyl = new THREE.MeshLambertMaterial({ color: 0x6e4a2a });
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(.35, .45, 9, 8), pyl);
      m.position.set(p0.x + l0.x * (ROAD_HALF + 1.5) * s, 4.5, p0.z + l0.z * (ROAD_HALF + 1.5) * s);
      this.group.add(m);
    }
    const bannerTex = canvasTex(512, 64, (g, w, h) => {
      g.fillStyle = '#2a1c10'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffb347'; g.font = '900 italic 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('☢ LOST ANGELES ☢', w / 2, h / 2);
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2 + 3, 2.2),
      new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
    banner.position.set(p0.x, 7.6, p0.z);
    banner.rotation.y = Math.atan2(t0.x, t0.z) + Math.PI; // lisible en arrivant sur la ligne
    this.group.add(banner);
  }

  // distance (approx.) d'un point au centre de la piste — pour placer le décor hors piste
  _distToTrack(x, z) {
    let best = 1e9;
    for (let i = 0; i < this.N; i += 6) {
      const p = this.pts[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  _buildDecor(rng) {
    const bGeoms = [], wreckGeoms = [], treeGeoms = [], rubbleGeoms = [], poleGeoms = [];

    // immeubles en ruine
    for (let i = 0; i < 70; i++) {
      const x = (rng() - .5) * 1300, z = (rng() - .5) * 1300;
      const d = this._distToTrack(x, z);
      if (d < WALL_DIST + 14 || d > 420) continue;
      const w = 10 + rng() * 16, h = 8 + rng() * (d > 60 ? 42 : 18), dp = 10 + rng() * 16;
      const g = new THREE.BoxGeometry(w, h, dp);
      // fenêtres à l'échelle
      const uvs = g.attributes.uv;
      for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * Math.max(2, Math.round(w / 6)), uvs.getY(k) * Math.max(2, Math.round(h / 6)));
      place(g, x, h / 2 - rng() * 2, z, rng() * Math.PI, (rng() - .5) * .06, (rng() - .5) * .06);
      bGeoms.push(g);
      // débris au pied
      if (rng() < .6) {
        const rb = new THREE.DodecahedronGeometry(1.2 + rng() * 2.2, 0);
        tinted(rb, 0x4a4038);
        place(rb, x + (rng() - .5) * w * 1.4, .6, z + (rng() - .5) * dp * 1.4, rng() * 7);
        rubbleGeoms.push(rb);
      }
    }

    // carcasses de voitures brûlées près de la piste
    const wreckCols = [0x3a3532, 0x52423a, 0x2e2b28, 0x5c3a28];
    for (let i = 0; i < 34; i++) {
      const k = Math.floor(rng() * this.N);
      const p = this.pts[k], l = this.left[k];
      const side = rng() < .5 ? 1 : -1;
      const off = WALL_DIST + 2.5 + rng() * 12;
      const x = p.x + l.x * off * side, z = p.z + l.z * off * side;
      const col = wreckCols[Math.floor(rng() * wreckCols.length)];
      const body = tinted(new THREE.BoxGeometry(2, .9, 4.2), col);
      place(body, x, .45, z, rng() * 7, 0, (rng() - .5) * .35);
      const cab = tinted(new THREE.BoxGeometry(1.7, .6, 1.8), col);
      place(cab, x + (rng() - .5), 1.1, z + (rng() - .5), rng() * 7, 0, (rng() - .5) * .3);
      wreckGeoms.push(body, cab);
    }

    // arbres morts
    for (let i = 0; i < 50; i++) {
      const x = (rng() - .5) * 1200, z = (rng() - .5) * 1200;
      const d = this._distToTrack(x, z);
      if (d < WALL_DIST + 4 || d > 380) continue;
      const h = 4 + rng() * 5;
      const trunk = tinted(new THREE.CylinderGeometry(.14, .3, h, 5), 0x3d3226);
      place(trunk, x, h / 2, z, 0, (rng() - .5) * .2, (rng() - .5) * .2);
      treeGeoms.push(trunk);
      for (let b = 0; b < 2 + Math.floor(rng() * 2); b++) {
        const bl = 1.5 + rng() * 2.2;
        const br = tinted(new THREE.CylinderGeometry(.05, .12, bl, 4), 0x3d3226);
        place(br, x + (rng() - .5) * 1.2, h * (.55 + rng() * .35), z + (rng() - .5) * 1.2, rng() * 7, (rng() - .5) * 1.6, (rng() - .5) * 1.6);
        treeGeoms.push(br);
      }
    }

    // lampadaires tordus le long de la piste
    for (let i = 0; i < this.N; i += 28) {
      if (rng() < .35) continue;
      const p = this.pts[i], l = this.left[i];
      const side = i % 56 ? 1 : -1;
      const x = p.x + l.x * (WALL_DIST + 1.8) * side, z = p.z + l.z * (WALL_DIST + 1.8) * side;
      const bend = (rng() - .5) * .7;
      const pole = tinted(new THREE.CylinderGeometry(.12, .18, 6.5, 5), 0x2f2f33);
      place(pole, x, 3.2, z, 0, bend * .4, bend);
      poleGeoms.push(pole);
      const arm = tinted(new THREE.CylinderGeometry(.08, .1, 2, 4), 0x2f2f33);
      place(arm, x - Math.sin(bend) * 2 - l.x * side * 1.2, 6.1, z - l.z * side * 1.2, 0, 0, Math.PI / 2 + bend);
      poleGeoms.push(arm);
    }

    // cailloux/gravats épars
    for (let i = 0; i < 60; i++) {
      const k = Math.floor(rng() * this.N);
      const p = this.pts[k], l = this.left[k];
      const side = rng() < .5 ? 1 : -1;
      const off = ROAD_HALF + 1.5 + rng() * (WALL_DIST - ROAD_HALF - 3);
      const g = new THREE.DodecahedronGeometry(.25 + rng() * .5, 0);
      tinted(g, rng() < .5 ? 0x54483a : 0x6a5c48);
      place(g, p.x + l.x * off * side, .2, p.z + l.z * off * side, rng() * 7);
      rubbleGeoms.push(g);
    }

    const addMerged = (geoms, material) => {
      if (!geoms.length) return;
      const m = new THREE.Mesh(mergeGeoms(geoms, material.vertexColors), material);
      m.matrixAutoUpdate = false;
      this.group.add(m);
    };
    addMerged(bGeoms, new THREE.MeshLambertMaterial({ map: buildingTex(rng) }));
    addMerged(wreckGeoms, new THREE.MeshLambertMaterial({ vertexColors: true }));
    addMerged(treeGeoms, new THREE.MeshLambertMaterial({ vertexColors: true }));
    addMerged(rubbleGeoms, new THREE.MeshLambertMaterial({ vertexColors: true }));
    addMerged(poleGeoms, new THREE.MeshLambertMaterial({ vertexColors: true }));
  }

  // ——— caisses d'objets ———
  _buildCrates(rng) {
    this.crates = [];
    const tex = crateTex();
    const geo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
    const rows = [.09, .21, .33, .46, .58, .71, .84];
    const lats = [-5.1, -1.7, 1.7, 5.1];
    this.cratesGroup = new THREE.Group();
    for (const fr of rows) {
      const i = Math.floor(fr * this.N);
      const p = this.pts[i], l = this.left[i];
      for (const lat of lats) {
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
        mesh.position.set(p.x + l.x * lat, 1.15, p.z + l.z * lat);
        this.cratesGroup.add(mesh);
        this.crates.push({ mesh, x: mesh.position.x, z: mesh.position.z, active: true, respawnT: 0, phase: rng() * 7 });
      }
    }
    this.group.add(this.cratesGroup);
  }

  // ——— ciel, soleil, poussière ———
  _buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(750, 24, 12),
      new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false })
    );
    this.group.add(sky);

    const sun = new THREE.Mesh(new THREE.CircleGeometry(52, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, transparent: true, opacity: .95 }));
    sun.position.set(420, 68, -560);
    sun.lookAt(0, 40, 0);
    this.group.add(sun);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(95, 24),
      new THREE.MeshBasicMaterial({ color: 0xe08a40, fog: false, transparent: true, opacity: .35 }));
    halo.position.copy(sun.position).multiplyScalar(1.01);
    halo.lookAt(0, 40, 0);
    this.group.add(halo);

    // cendres en suspension autour de la caméra
    const n = 260;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - .5) * 120;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - .5) * 120;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc9b090, size: .35, transparent: true, opacity: .55 }));
    this.group.add(this.dust);
  }

  // ——— requêtes géométriques utilisées par la physique ———
  nearestIdx(x, z, hint = 0) {
    const N = this.N;
    let best = -1, bd = 1e18;
    for (let o = -42; o <= 42; o++) {
      const i = ((hint + o) % N + N) % N;
      const p = this.pts[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // progression flottante + écart latéral (négatif = à droite)
  project(x, z, hint = 0) {
    const i = this.nearestIdx(x, z, hint);
    const p = this.pts[i], t = this.tan[i], l = this.left[i];
    const dx = x - p.x, dz = z - p.z;
    const along = dx * t.x + dz * t.z;
    const lat = dx * l.x + dz * l.z;
    return { idx: i, f: i + along / this.segLen, lat };
  }

  posAt(idxF) {
    const N = this.N;
    const i = Math.floor(((idxF % N) + N) % N);
    const fr = ((idxF % N) + N) % N - i;
    const a = this.pts[i], b = this.pts[(i + 1) % N];
    return new THREE.Vector3(lerp(a.x, b.x, fr), 0, lerp(a.z, b.z, fr));
  }

  headingAt(idxF) {
    const N = this.N;
    const i = Math.floor(((idxF % N) + N) % N);
    const t = this.tan[i];
    return Math.atan2(t.x, t.z);
  }

  leftAt(idxF) {
    const N = this.N;
    return this.left[Math.floor(((idxF % N) + N) % N)];
  }

  // emplacement de départ du slot k (0..7) : grille 2 colonnes derrière la ligne
  gridSlot(k) {
    const backMeters = 8 + Math.floor(k / 2) * 5.5;
    const idxF = this.N - backMeters / this.segLen;
    const lat = (k % 2 === 0 ? 2.8 : -2.8);
    const pos = this.posAt(idxF);
    const l = this.leftAt(idxF);
    pos.x += l.x * lat; pos.z += l.z * lat;
    return { pos, heading: this.headingAt(idxF), progress: idxF - this.N };
  }

  breakCrate(c, respawn = 6) {
    c.active = false;
    c.respawnT = respawn;
    c.mesh.visible = false;
  }

  update(dt, t, camPos) {
    for (const c of this.crates) {
      if (!c.active) {
        c.respawnT -= dt;
        if (c.respawnT <= 0) { c.active = true; c.mesh.visible = true; }
        continue;
      }
      c.mesh.rotation.y += dt * 1.2;
      c.mesh.position.y = 1.15 + Math.sin(t * 2 + c.phase) * .16;
    }
    // poussière qui dérive, recentrée sur la caméra
    if (camPos) {
      this.dust.position.x = camPos.x;
      this.dust.position.z = camPos.z;
      this.dust.rotation.y += dt * .02;
    }
  }
}
