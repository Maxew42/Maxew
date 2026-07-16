// Piste procédurale en boucle fermée + décor post-apocalyptique.
// Même seed → même piste sur toutes les machines (multijoueur).
// Relief : profil de hauteur seedé (collines), un pont effondré à sauter
// (rivière asséchée), une fosse aux fans qui bombarde, des plaques de turbo.
import * as THREE from 'three';
import { mulberry32, clamp, lerp, angleDelta } from './util.js';

const ROAD_HALF = 7;      // demi-largeur du bitume
const WALL_DIST = 16;     // murs infranchissables (zone hors-piste entre les deux)
const APRON = 34;         // épaulement extérieur qui fond vers la plaine
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

function dirtTex(rng) { // accotements entre route et murs
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#5c4c38'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = rng();
      g.fillStyle = v < .5 ? 'rgba(70,58,42,.55)' : 'rgba(110,94,68,.5)';
      g.fillRect(rng() * w, rng() * h, 2 + rng() * 3, 2 + rng() * 3);
    }
    for (let i = 0; i < 8; i++) { // traces de pneus
      g.fillStyle = 'rgba(40,32,24,.3)';
      g.fillRect(rng() * w, 0, 3 + rng() * 4, h);
    }
  }, 2, 1);
}

function mudTex(rng) { // lit de rivière asséché, boue craquelée
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4e4030'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = rng() < .5 ? 'rgba(58,48,36,.6)' : 'rgba(88,74,54,.45)';
      g.fillRect(rng() * w, rng() * h, 3, 3);
    }
    g.strokeStyle = 'rgba(30,24,16,.8)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) { // craquelures
      let x = rng() * w, y = rng() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 5; s++) { x += (rng() - .5) * 60; y += (rng() - .5) * 60; g.lineTo(x, y); }
      g.stroke();
    }
  }, 6, 2);
}

function padTex() { // chevrons de turbo (fond transparent, orange vif)
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (const [oy, col] of [[4, '#ff7010'], [24, '#ffa030'], [44, '#ffd060']]) {
      g.fillStyle = col;
      g.strokeStyle = '#2a1806'; g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(4, oy + 14); g.lineTo(32, oy); g.lineTo(60, oy + 14);
      g.lineTo(60, oy + 22); g.lineTo(32, oy + 8); g.lineTo(4, oy + 22);
      g.closePath(); g.fill(); g.stroke();
    }
  });
}

function stripesTex() { // panneau danger rayé jaune/noir
  return canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#e0b020'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#191410';
    for (let i = -2; i < 8; i++) {
      g.save(); g.translate(i * 16, 0); g.rotate(-.6); g.fillRect(0, -20, 8, 110); g.restore();
    }
  });
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

    // tangentes / vecteurs "gauche" (horizontaux — le relief vient après)
    this.tan = []; this.left = [];
    for (let i = 0; i < this.N; i++) {
      const a = this.pts[(i - 1 + this.N) % this.N], b = this.pts[(i + 1) % this.N];
      const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      this.tan.push(t);
      this.left.push(new THREE.Vector3(t.z, 0, -t.x));
    }
    let len = 0;
    for (let i = 0; i < this.N; i++) {
      const a = this.pts[i], b = this.pts[(i + 1) % this.N];
      len += Math.hypot(b.x - a.x, b.z - a.z);
    }
    this.length = len;
    this.segLen = len / this.N;

    this._pickZones();
    this._buildHeights(rng);
    this._buildRoad(rng);
    this._buildJump(rng);
    this._buildCrowdZone(rng);
    this._buildPads();
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

  _ringDist(a, b) {
    const N = this.N;
    const d = Math.abs(((a - b) % N + N) % N);
    return Math.min(d, N - d);
  }

  // ——— zones spéciales : saut, fosse aux fans, plaques de turbo ———
  // Tout est déterministe (dérivé de la géométrie du tracé), donc identique
  // sur toutes les machines.
  _pickZones() {
    const N = this.N, sl = this.segLen;
    const hs = this.pts.map((p, i) => {
      const q = this.pts[(i + 1) % N];
      return Math.atan2(q.x - p.x, q.z - p.z);
    });
    const curv = new Float32Array(N);
    for (let i = 0; i < N; i++) curv[i] = Math.abs(angleDelta(hs[i], hs[(i + 1) % N]));
    const winSum = (i, len) => { let s = 0; for (let k = 0; k < len; k++) s += curv[(i + k) % N]; return s; };

    // ——— saut : la fenêtre la plus rectiligne du milieu de parcours ———
    // turbo → rampe → brèche (rivière asséchée) → atterrissage
    const mJump = Math.ceil(56 / sl);
    let bj = Math.floor(N * .25), bs = 1e9;
    for (let i = Math.floor(N * .22); i < Math.floor(N * .8) - mJump; i++) {
      const s = winSum(i, mJump);
      if (s < bs) { bs = s; bj = i; }
    }
    const padF = bj + Math.round(6 / sl);
    const rampF0 = bj + Math.round(26 / sl);
    const gapF0 = rampF0 + Math.max(3, Math.round(9 / sl));   // bord de la brèche
    const gapF1 = gapF0 + Math.max(4, Math.round(15 / sl));   // bord d'atterrissage
    this.jump = {
      zoneF: bj, padF, rampF0, gapF0, gapF1,
      center: (gapF0 + gapF1) / 2,
      respawnF: bj + Math.round(1 / sl),
      rampH: 2.3, depth: 5, roadY: 0,
    };

    // ——— fosse aux fans : une autre portion calme, loin du saut et du départ ———
    const mCrowd = Math.ceil(75 / sl);
    let bc = -1, bcs = 1e9, alt = Math.floor(N * .5), altD = -1;
    for (let i = Math.floor(N * .07); i < Math.floor(N * .93) - mCrowd; i++) {
      const d = this._ringDist(i + mCrowd / 2, this.jump.center);
      if (d > altD) { altD = d; alt = i; }
      if (d < mJump + mCrowd) continue;
      const s = winSum(i, mCrowd);
      if (s < bcs) { bcs = s; bc = i; }
    }
    if (bc < 0) bc = alt; // repli : le plus loin possible du saut
    this.crowd = { f0: bc, f1: bc + mCrowd };

    // ——— turbos : un devant la rampe (garanti), deux en sortie des virages
    // les plus serrés (posés sur du plat pour que la plaque ne flotte pas) ———
    this.pads = [{ f: padF, halfW: 5.4, len: 5 / sl, phase: 0 }];
    const crowdMid = (this.crowd.f0 + this.crowd.f1) / 2;
    const smoothC = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let o = -5; o <= 5; o++) s += curv[((i + o) % N + N) % N];
      smoothC[i] = s;
    }
    const usable = i =>
      this._ringDist(i, this.jump.center) > mJump * 1.5 &&
      this._ringDist(i, crowdMid) > mCrowd &&
      this._ringDist(i, 0) > 26 / sl &&
      this.pads.every(p => this._ringDist(i, p.f) > 60 / sl);
    for (let n = 0; n < 2; n++) {
      let best = -1, bv = -1;
      for (let i = 0; i < N; i++) {
        const spot = (i + Math.round(12 / sl)) % N; // sortie de virage
        if (!usable(spot)) continue;
        if (smoothC[i] > bv) { bv = smoothC[i]; best = spot; }
      }
      if (best >= 0) this.pads.push({ f: best, halfW: 4.6, len: 5 / sl, phase: n + 1 });
    }
  }

  // ——— relief : collines seedées, plateaux sur les zones spéciales,
  // rampe et lit de rivière incrustés dans le profil ———
  _buildHeights(rng) {
    const N = this.N, sl = this.segLen;
    const h = new Float32Array(N);
    const k1 = 2 + Math.floor(rng() * 2), k2 = 4 + Math.floor(rng() * 2), k3 = 7 + Math.floor(rng() * 3);
    const a1 = 3.2 + rng() * 2.2, a2 = 1.6 + rng() * 1.4, a3 = .5 + rng() * .5;
    const p1 = rng() * 7, p2 = rng() * 7, p3 = rng() * 7;
    for (let i = 0; i < N; i++) {
      const u = i / N * Math.PI * 2;
      h[i] = a1 * Math.sin(u * k1 + p1) + a2 * Math.sin(u * k2 + p2) + a3 * Math.sin(u * k3 + p3);
    }
    // plateaux : départ, saut et tribunes restent plats
    const flat = (cf, r0m, r1m) => {
      const c = Math.round(cf), r0 = Math.ceil(r0m / sl), r1 = Math.ceil(r1m / sl);
      for (let o = -r1; o <= r1; o++) {
        const i = ((c + o) % N + N) % N;
        const t = clamp((Math.abs(o) - r0) / (r1 - r0), 0, 1);
        h[i] *= t * t * (3 - 2 * t);
      }
    };
    flat(0, 20, 48);
    flat(this.jump.zoneF + 32 / sl, 38, 74);
    flat((this.crowd.f0 + this.crowd.f1) / 2, 44, 82);
    // pente plafonnée (arcade : ça grimpe, mais ça ne bloque pas)
    let mg = 0;
    for (let i = 0; i < N; i++) mg = Math.max(mg, Math.abs(h[(i + 1) % N] - h[i]) / sl);
    const MAXG = .105;
    if (mg > MAXG) { const s = MAXG / mg; for (let i = 0; i < N; i++) h[i] *= s; }
    // max lissé avec 0 : les creux épousent la plaine (y = -0.12) au lieu de
    // passer dessous — sinon le sol plat enterre des portions de route
    for (let i = 0; i < N; i++) {
      const v = h[i];
      h[i] = (v + Math.sqrt(v * v + 1)) / 2;
    }
    // rampe (montée jusqu'au bord de la brèche) et lit de rivière en contrebas
    const j = this.jump;
    j.roadY = h[j.gapF1 % N];
    for (let i = Math.ceil(j.rampF0); i <= j.gapF0; i++) {
      const t = (i - j.rampF0) / (j.gapF0 - j.rampF0);
      h[i % N] = j.roadY + j.rampH * t;
    }
    for (let i = j.gapF0 + 1; i < j.gapF1; i++) h[i % N] = j.roadY - j.depth;
    this.h = h;
    for (let i = 0; i < N; i++) this.pts[i].y = h[i];
  }

  // le quad i→i+1 du ruban est-il au-dessus du vide ?
  _quadInGap(i) {
    return i >= this.jump.gapF0 && i < this.jump.gapF1;
  }

  // ——— géométrie de la route, accotements, murs, ligne de départ ———
  _buildRoad(rng) {
    const N = this.N;
    const gapSkip = i => this._quadInGap(i);
    // ruban générique : deux bords latéraux, hauteur par sommet, quads
    // optionnellement sautés (brèche du pont)
    const mkRibbon = (latA, latB, yFnA, texture, vRep, skipQuad = null, yFnB = null) => {
      const pos = [], uv = [], nor = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const k = i % N, p = this.pts[k], l = this.left[k];
        const yA = yFnA(k), yB = (yFnB || yFnA)(k);
        const v = i / N * vRep;
        pos.push(p.x + l.x * latA, yA, p.z + l.z * latA, p.x + l.x * latB, yB, p.z + l.z * latB);
        nor.push(0, 1, 0, 0, 1, 0);
        uv.push(0, v, 1, v);
      }
      for (let i = 0; i < N; i++) {
        if (skipQuad && skipQuad(i)) continue;
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c); // CCW vu du dessus
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
      g.setIndex(idx);
      return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: texture }));
    };

    const hAt = k => this.h[k];
    this.group.add(mkRibbon(ROAD_HALF, -ROAD_HALF, k => hAt(k) + .02, asphaltTex(rng), Math.round(this.length / 9), gapSkip));

    // accotements en terre entre la route et les murs, puis épaulement qui
    // redescend vers la plaine (sinon la route à flanc de colline flotterait)
    const dirt = dirtTex(rng);
    this.group.add(mkRibbon(WALL_DIST, ROAD_HALF, k => hAt(k) - .03, dirt, Math.round(this.length / 7), gapSkip));
    this.group.add(mkRibbon(-ROAD_HALF, -WALL_DIST, k => hAt(k) - .03, dirt, Math.round(this.length / 7), gapSkip));
    this.group.add(mkRibbon(WALL_DIST + APRON, WALL_DIST, () => -0.12, dirt, Math.round(this.length / 7), gapSkip, k => hAt(k) - .05));
    this.group.add(mkRibbon(-WALL_DIST, -(WALL_DIST + APRON), k => hAt(k) - .05, dirt, Math.round(this.length / 7), gapSkip, () => -0.12));

    // murs de tôle des deux côtés (interrompus au-dessus de la rivière)
    const wallT = wallTex(rng);
    for (const side of [1, -1]) {
      const N2 = this.N;
      const pos = new Float32Array((N2 + 1) * 2 * 3), uv = new Float32Array((N2 + 1) * 2 * 2), nor = new Float32Array((N2 + 1) * 2 * 3);
      const idx = [];
      for (let i = 0; i <= N2; i++) {
        const k = i % N2, p = this.pts[k], l = this.left[k];
        const x = p.x + l.x * WALL_DIST * side, z = p.z + l.z * WALL_DIST * side;
        const y = this.h[k];
        pos.set([x, y, z, x, y + 1.7, z], i * 6);
        nor.set([-l.x * side, 0, -l.z * side, -l.x * side, 0, -l.z * side], i * 6);
        const v = i / N2 * Math.round(this.length / 4);
        uv.set([v, 0, v, 1], i * 4);
      }
      for (let i = 0; i < N2; i++) {
        if (this._quadInGap(i)) continue;
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: wallT, side: THREE.DoubleSide })));
    }

    // sol — écarté de la route et poussé au fond du z-buffer, sinon il
    // scintille à travers le bitume au loin (« étoiles » de z-fighting)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshLambertMaterial({ map: groundTex(rng), polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
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
    line.position.set(p0.x, p0.y + 0.09, p0.z);
    this.group.add(line);

    const pyl = new THREE.MeshLambertMaterial({ color: 0x6e4a2a });
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(.35, .45, 9, 8), pyl);
      m.position.set(p0.x + l0.x * (ROAD_HALF + 1.5) * s, p0.y + 4.5, p0.z + l0.z * (ROAD_HALF + 1.5) * s);
      this.group.add(m);
    }
    const bannerTex = canvasTex(512, 64, (g, w, h) => {
      g.fillStyle = '#2a1c10'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffb347'; g.font = '900 italic 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('☢ LOST ANGELES ☢', w / 2, h / 2);
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2 + 3, 2.2),
      new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
    banner.position.set(p0.x, p0.y + 7.6, p0.z);
    banner.rotation.y = Math.atan2(t0.x, t0.z) + Math.PI; // lisible en arrivant sur la ligne
    this.group.add(banner);
  }

  // ——— le pont effondré : lit de rivière, berges, piliers, panneaux ———
  _buildJump(rng) {
    const j = this.jump, N = this.N;
    const bedY = j.roadY - j.depth;
    const bedW = WALL_DIST + APRON + 22;

    // lit de rivière asséché qui traverse sous la brèche
    const pos = [], uv = [], nor = [], idx = [];
    let n = 0;
    for (let i = j.gapF0 - 2; i <= j.gapF1 + 2; i++) {
      const k = ((i % N) + N) % N, p = this.pts[k], l = this.left[k];
      pos.push(p.x + l.x * bedW, bedY, p.z + l.z * bedW, p.x - l.x * bedW, bedY, p.z - l.z * bedW);
      nor.push(0, 1, 0, 0, 1, 0);
      uv.push(0, n * .4, 1, n * .4);
      if (n) {
        const a = (n - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: mudTex(rng) })));

    // berges en béton sous les deux tronçons coupés
    const bankMat = new THREE.MeshLambertMaterial({ color: 0x6a6258, side: THREE.DoubleSide });
    const mkBank = (fI, topY) => {
      const k = ((fI % N) + N) % N;
      const p = this.pts[k], t = this.tan[k];
      const hgt = topY - bedY;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(bedW * 2, hgt), bankMat);
      m.position.set(p.x, bedY + hgt / 2, p.z);
      m.rotation.y = Math.atan2(t.x, t.z);
      this.group.add(m);
    };
    mkBank(j.gapF0, j.roadY + j.rampH + .03);
    mkBank(j.gapF1, j.roadY + .03);

    // piliers du pont effondré + rochers dans le lit
    const rubb = [];
    for (let i = 0; i < 2; i++) {
      const k = Math.round(j.gapF0 + (i + 1) * (j.gapF1 - j.gapF0) / 3) % N;
      const p = this.pts[k];
      const pil = tinted(new THREE.BoxGeometry(3.2, j.depth * .8, 2.2), 0x5c554c);
      place(pil, p.x + (rng() - .5) * 8, bedY + j.depth * .35, p.z + (rng() - .5) * 8, rng() * 7, (rng() - .5) * .18, (rng() - .5) * .18);
      rubb.push(pil);
    }
    for (let i = 0; i < 10; i++) {
      const k = (j.gapF0 + Math.floor(rng() * (j.gapF1 - j.gapF0))) % N;
      const p = this.pts[k], l = this.left[k];
      const off = (rng() - .5) * bedW * 1.6;
      const rock = new THREE.DodecahedronGeometry(.5 + rng() * 1.4, 0);
      tinted(rock, rng() < .5 ? 0x4e463a : 0x6a5c48);
      place(rock, p.x + l.x * off, bedY + .4, p.z + l.z * off, rng() * 7);
      rubb.push(rock);
    }
    this.group.add(new THREE.Mesh(mergeGeoms(rubb, true), new THREE.MeshLambertMaterial({ vertexColors: true })));

    // toute la rampe est peinte en rayures danger (impossible à rater à pleine vitesse)
    const st = stripesTex();
    {
      const pos2 = [], uv2 = [], nor2 = [], idx2 = [];
      let m = 0;
      for (let i = j.rampF0; i <= j.gapF0; i++) {
        const k2 = ((i % N) + N) % N, p2 = this.pts[k2], l2 = this.left[k2];
        const w = ROAD_HALF - .4, y2 = this.h[k2] + .05;
        pos2.push(p2.x + l2.x * w, y2, p2.z + l2.z * w, p2.x - l2.x * w, y2, p2.z - l2.z * w);
        nor2.push(0, 1, 0, 0, 1, 0);
        uv2.push(0, m * .8, 2.5, m * .8);
        if (m) {
          const a = (m - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
          idx2.push(a, b, c, b, d, c);
        }
        m++;
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos2), 3));
      g2.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor2), 3));
      g2.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv2), 2));
      g2.setIndex(idx2);
      this.group.add(new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ map: st, transparent: true, opacity: .9 })));
    }
    // panneaux rayés d'avertissement avant la rampe
    const kW = ((Math.round(j.rampF0 - 10 / this.segLen) % N) + N) % N;
    const pW = this.pts[kW], lW = this.left[kW], tW = this.tan[kW];
    for (const s of [1, -1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, .18), new THREE.MeshLambertMaterial({ map: st }));
      b.position.set(pW.x + lW.x * (ROAD_HALF + 1.7) * s, this.h[kW] + 1.1, pW.z + lW.z * (ROAD_HALF + 1.7) * s);
      b.rotation.y = Math.atan2(tW.x, tW.z);
      this.group.add(b);
    }
  }

  // ——— la fosse aux fans : tribunes + spectateurs des deux côtés ———
  _buildCrowdZone(rng) {
    const N = this.N, c = this.crowd;
    const stands = [], people = [];
    const step = Math.max(2, Math.round(3.2 / this.segLen));
    const cols = [0xd05038, 0x3878c0, 0xd8b040, 0x50a058, 0x9858b8, 0xd07830, 0xc8c8d0];
    const skins = [0xd8a878, 0xb88858, 0x906848];
    for (let i = c.f0; i < c.f1; i += step) {
      const k = ((i % N) + N) % N;
      const p = this.pts[k], l = this.left[k], t = this.tan[k];
      const base = this.h[k];
      const ry = Math.atan2(t.x, t.z);
      for (const side of [1, -1]) {
        for (let tier = 0; tier < 3; tier++) {
          const off = WALL_DIST + 3 + tier * 2.4;
          const cx = p.x + l.x * off * side, cz = p.z + l.z * off * side;
          const sg = tinted(new THREE.BoxGeometry(2.4, 1.0, step * this.segLen + .3), 0x54504a);
          place(sg, cx, base + .5 + tier * 1.0, cz, ry);
          stands.push(sg);
          const nP = 1 + Math.floor(rng() * 3);
          for (let q = 0; q < nP; q++) {
            const along = (rng() - .5) * step * this.segLen * .8;
            const px = cx + t.x * along, pz = cz + t.z * along;
            const body = tinted(new THREE.BoxGeometry(.5, .75, .4), cols[Math.floor(rng() * cols.length)]);
            place(body, px, base + 1.37 + tier * 1.0, pz, ry + (rng() - .5) * .6);
            people.push(body);
            const head = tinted(new THREE.SphereGeometry(.16, 6, 5), skins[Math.floor(rng() * 3)]);
            place(head, px, base + 1.88 + tier * 1.0, pz, 0);
            people.push(head);
          }
        }
      }
    }
    const addM = geoms => {
      if (!geoms.length) return;
      const m = new THREE.Mesh(mergeGeoms(geoms, true), new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.matrixAutoUpdate = false;
      this.group.add(m);
    };
    addM(stands); addM(people);
  }

  // ——— plaques de turbo (chevrons orange pulsants) ———
  _buildPads() {
    const tex = padTex();
    for (const pad of this.pads) {
      const k = Math.round(pad.f) % this.N;
      const p = this.pts[k], t = this.tan[k];
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(pad.halfW * 2, pad.len * this.segLen),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .75, depthWrite: false })
      );
      m.rotation.order = 'YXZ';
      m.rotation.y = Math.atan2(t.x, t.z);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, this.h[k] + .06, p.z);
      this.group.add(m);
      pad.mesh = m;
    }
  }

  // point le plus proche du tracé (approx.) — pour poser le décor
  _nearTrack(x, z) {
    let best = 1e18, bi = 0;
    for (let i = 0; i < this.N; i += 6) {
      const p = this.pts[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best) { best = d; bi = i; }
    }
    return { d: Math.sqrt(best), i: bi };
  }

  _distToTrack(x, z) { return this._nearTrack(x, z).d; }

  // hauteur du sol hors piste : route → épaulement → plaine
  groundYApprox(x, z) {
    const { d, i } = this._nearTrack(x, z);
    if (d >= WALL_DIST + APRON) return -0.12;
    if (d <= WALL_DIST) return this.h[i];
    return lerp(this.h[i], -0.12, (d - WALL_DIST) / APRON);
  }

  _buildDecor(rng) {
    const bGeoms = [], wreckGeoms = [], treeGeoms = [], rubbleGeoms = [], poleGeoms = [];
    const sl = this.segLen;
    // hauteur du sol à un offset latéral donné du point k
    const gAt = (k, off) => off <= WALL_DIST ? this.h[k] : lerp(this.h[k], -0.12, Math.min(1, (off - WALL_DIST) / APRON));
    // près de la rivière ou des tribunes → pas de décor qui flotte/encombre
    const nearRiver = (k) => this._ringDist(k, this.jump.center) < 30 / sl;
    const nearStands = (k, off) => this.inCrowd(k, 6) && off < WALL_DIST + 11;

    // immeubles en ruine
    for (let i = 0; i < 90; i++) {
      const x = (rng() - .5) * 1300, z = (rng() - .5) * 1300;
      const { d, i: ni } = this._nearTrack(x, z);
      if (d < WALL_DIST + 18 || d > 420) continue; // pas trop près : la caméra passe derrière sinon
      if (d < 90 && nearRiver(ni)) continue;       // laisse la rivière respirer
      const gy = d >= WALL_DIST + APRON ? -0.12 : lerp(this.h[ni], -0.12, Math.max(0, (d - WALL_DIST) / APRON));
      const w = 10 + rng() * 16, h = 8 + rng() * (d > 60 ? 42 : 18), dp = 10 + rng() * 16;
      const g = new THREE.BoxGeometry(w, h, dp);
      // fenêtres à l'échelle
      const uvs = g.attributes.uv;
      for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * Math.max(2, Math.round(w / 6)), uvs.getY(k) * Math.max(2, Math.round(h / 6)));
      place(g, x, gy + h / 2 - rng() * 2, z, rng() * Math.PI, (rng() - .5) * .06, (rng() - .5) * .06);
      bGeoms.push(g);
      // débris au pied
      if (rng() < .6) {
        const rb = new THREE.DodecahedronGeometry(1.2 + rng() * 2.2, 0);
        tinted(rb, 0x4a4038);
        place(rb, x + (rng() - .5) * w * 1.4, gy + .6, z + (rng() - .5) * dp * 1.4, rng() * 7);
        rubbleGeoms.push(rb);
      }
    }

    // carcasses de voitures brûlées près de la piste (certaines sur le toit)
    const wreckCols = [0x3a3532, 0x52423a, 0x2e2b28, 0x5c3a28];
    for (let i = 0; i < 44; i++) {
      const k = Math.floor(rng() * this.N);
      const p = this.pts[k], l = this.left[k];
      const side = rng() < .5 ? 1 : -1;
      const off = WALL_DIST + 2.5 + rng() * 12;
      if (nearRiver(k) || nearStands(k, off)) continue;
      const x = p.x + l.x * off * side, z = p.z + l.z * off * side;
      const gy = gAt(k, off);
      const col = wreckCols[Math.floor(rng() * wreckCols.length)];
      if (rng() < .25) {
        // épave retournée : cabine écrasée dessous, châssis en l'air
        const body = tinted(new THREE.BoxGeometry(2, .9, 4.2), col);
        place(body, x, gy + .85, z, rng() * 7, 0, Math.PI + (rng() - .5) * .3);
        const cab = tinted(new THREE.BoxGeometry(1.6, .35, 1.7), col);
        place(cab, x + (rng() - .5) * .4, gy + .18, z + (rng() - .5) * .4, rng() * 7);
        wreckGeoms.push(body, cab);
      } else {
        const body = tinted(new THREE.BoxGeometry(2, .9, 4.2), col);
        place(body, x, gy + .45, z, rng() * 7, 0, (rng() - .5) * .35);
        const cab = tinted(new THREE.BoxGeometry(1.7, .6, 1.8), col);
        place(cab, x + (rng() - .5), gy + 1.1, z + (rng() - .5), rng() * 7, 0, (rng() - .5) * .3);
        wreckGeoms.push(body, cab);
      }
    }

    // tas de ferraille : caisses, bidons et pneus entassés hors des murs
    for (let i = 0; i < 20; i++) {
      const k = Math.floor(rng() * this.N);
      const p = this.pts[k], l = this.left[k];
      const side = rng() < .5 ? 1 : -1;
      const off = WALL_DIST + 3 + rng() * 18;
      if (nearRiver(k) || nearStands(k, off)) continue;
      const cx = p.x + l.x * off * side, cz = p.z + l.z * off * side;
      const gy = gAt(k, off);
      const n = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < n; j++) {
        const jx = cx + (rng() - .5) * 3.4, jz = cz + (rng() - .5) * 3.4;
        const r = rng();
        if (r < .45) {
          const bx = tinted(new THREE.BoxGeometry(.7 + rng() * .9, .5 + rng() * .7, .7 + rng() * .9),
            [0x5a4a38, 0x4a4440, 0x6e5030][Math.floor(rng() * 3)]);
          place(bx, jx, gy + .3 + rng() * .5, jz, rng() * 7, (rng() - .5) * .5, (rng() - .5) * .5);
          rubbleGeoms.push(bx);
        } else if (r < .75) {
          const drum = tinted(new THREE.CylinderGeometry(.34, .34, .95, 7), rng() < .5 ? 0x7a4a20 : 0x505860);
          const tipped = rng() < .4;
          place(drum, jx, gy + (tipped ? .34 : .48), jz, rng() * 7, 0, tipped ? Math.PI / 2 : (rng() - .5) * .15);
          rubbleGeoms.push(drum);
        } else {
          const tire = tinted(new THREE.TorusGeometry(.5, .2, 6, 10), 0x1c1c1e);
          place(tire, jx, gy + .22, jz, rng() * 7, Math.PI / 2 + (rng() - .5) * .4);
          rubbleGeoms.push(tire);
        }
      }
    }

    // piles de pneus le long des murs
    for (let i = 0; i < 12; i++) {
      const k = Math.floor(rng() * this.N);
      const p = this.pts[k], l = this.left[k];
      const side = rng() < .5 ? 1 : -1;
      const off = WALL_DIST + 1.6 + rng() * 5;
      if (nearRiver(k) || nearStands(k, off)) continue;
      const x = p.x + l.x * off * side, z = p.z + l.z * off * side;
      const gy = gAt(k, off);
      const nT = 2 + Math.floor(rng() * 3);
      for (let j = 0; j < nT; j++) {
        const tire = tinted(new THREE.TorusGeometry(.55, .22, 6, 10), 0x1c1c1e);
        place(tire, x + (rng() - .5) * .15, gy + .22 + j * .42, z + (rng() - .5) * .15, rng() * 7, Math.PI / 2);
        rubbleGeoms.push(tire);
      }
    }

    // bidons rouillés isolés près des murs
    for (let i = 0; i < 24; i++) {
      const k = Math.floor(rng() * this.N);
      const p = this.pts[k], l = this.left[k];
      const side = rng() < .5 ? 1 : -1;
      const off = WALL_DIST + 1.4 + rng() * 9;
      if (nearRiver(k) || nearStands(k, off)) continue;
      const gy = gAt(k, off);
      const tipped = rng() < .3;
      const drum = tinted(new THREE.CylinderGeometry(.34, .34, .95, 7), rng() < .6 ? 0x7a4a20 : 0x4a5560);
      place(drum, p.x + l.x * off * side, gy + (tipped ? .34 : .48), p.z + l.z * off * side, rng() * 7, 0, tipped ? Math.PI / 2 : 0);
      rubbleGeoms.push(drum);
    }

    // arbres morts
    for (let i = 0; i < 50; i++) {
      const x = (rng() - .5) * 1200, z = (rng() - .5) * 1200;
      const { d, i: ni } = this._nearTrack(x, z);
      if (d < WALL_DIST + 4 || d > 380) continue;
      if (d < 80 && nearRiver(ni)) continue;
      const gy = d >= WALL_DIST + APRON ? -0.12 : lerp(this.h[ni], -0.12, Math.max(0, (d - WALL_DIST) / APRON));
      const h = 4 + rng() * 5;
      const trunk = tinted(new THREE.CylinderGeometry(.14, .3, h, 5), 0x3d3226);
      place(trunk, x, gy + h / 2, z, 0, (rng() - .5) * .2, (rng() - .5) * .2);
      treeGeoms.push(trunk);
      for (let b = 0; b < 2 + Math.floor(rng() * 2); b++) {
        const bl = 1.5 + rng() * 2.2;
        const br = tinted(new THREE.CylinderGeometry(.05, .12, bl, 4), 0x3d3226);
        place(br, x + (rng() - .5) * 1.2, gy + h * (.55 + rng() * .35), z + (rng() - .5) * 1.2, rng() * 7, (rng() - .5) * 1.6, (rng() - .5) * 1.6);
        treeGeoms.push(br);
      }
    }

    // lampadaires tordus le long de la piste
    for (let i = 0; i < this.N; i += 28) {
      if (rng() < .35) continue;
      if (nearRiver(i) || this.inCrowd(i, 6)) continue;
      const p = this.pts[i], l = this.left[i];
      const side = i % 56 ? 1 : -1;
      const off = WALL_DIST + 1.8;
      const x = p.x + l.x * off * side, z = p.z + l.z * off * side;
      const gy = gAt(i, off);
      const bend = (rng() - .5) * .7;
      const pole = tinted(new THREE.CylinderGeometry(.12, .18, 6.5, 5), 0x2f2f33);
      place(pole, x, gy + 3.2, z, 0, bend * .4, bend);
      poleGeoms.push(pole);
      const arm = tinted(new THREE.CylinderGeometry(.08, .1, 2, 4), 0x2f2f33);
      place(arm, x - Math.sin(bend) * 2 - l.x * side * 1.2, gy + 6.1, z - l.z * side * 1.2, 0, 0, Math.PI / 2 + bend);
      poleGeoms.push(arm);
    }

    // cailloux/gravats épars
    for (let i = 0; i < 60; i++) {
      const k = Math.floor(rng() * this.N);
      const p = this.pts[k], l = this.left[k];
      const side = rng() < .5 ? 1 : -1;
      const off = ROAD_HALF + 1.5 + rng() * (WALL_DIST - ROAD_HALF - 3);
      if (nearRiver(k)) continue;
      const g = new THREE.DodecahedronGeometry(.25 + rng() * .5, 0);
      tinted(g, rng() < .5 ? 0x54483a : 0x6a5c48);
      place(g, p.x + l.x * off * side, this.h[k] + .2, p.z + l.z * off * side, rng() * 7);
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
    const jumpMid = this.jump.zoneF + 32 / this.segLen;
    for (const fr of rows) {
      const i = Math.floor(fr * this.N);
      if (this._ringDist(i, jumpMid) < 44 / this.segLen) continue; // pas de caisses sur le saut
      const p = this.pts[i], l = this.left[i];
      const baseY = this.h[i] + 1.15;
      for (const lat of lats) {
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
        mesh.position.set(p.x + l.x * lat, baseY, p.z + l.z * lat);
        this.cratesGroup.add(mesh);
        this.crates.push({ mesh, x: mesh.position.x, z: mesh.position.z, baseY, active: true, respawnT: 0, phase: rng() * 7 });
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

    // cendres en suspension autour de la caméra — sprite rond estompé :
    // les points carrés par défaut faisaient des « étoiles » plaquées sur le décor
    const spot = document.createElement('canvas');
    spot.width = spot.height = 32;
    const sg = spot.getContext('2d');
    const grad = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,.9)');
    grad.addColorStop(.5, 'rgba(255,255,255,.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 32, 32);
    const spotTex = new THREE.CanvasTexture(spot);
    const n = 200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - .5) * 100;
      pos[i * 3 + 1] = .5 + Math.random() * 12; // bas : de la cendre, pas des étoiles
      pos[i * 3 + 2] = (Math.random() - .5) * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x8a7660, size: .5, map: spotTex, transparent: true, opacity: .32, depthWrite: false,
    }));
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
    return new THREE.Vector3(lerp(a.x, b.x, fr), lerp(a.y, b.y, fr), lerp(a.z, b.z, fr));
  }

  // hauteur de la route au point de progression donné
  heightAt(idxF) {
    const N = this.N;
    const f = ((idxF % N) + N) % N;
    const i = Math.floor(f);
    return lerp(this.h[i], this.h[(i + 1) % N], f - i);
  }

  // f est-il au-dessus de la brèche du pont ?
  inGap(idxF) {
    const N = this.N;
    const f = ((idxF % N) + N) % N;
    return f > this.jump.gapF0 && f < this.jump.gapF1;
  }

  // f est-il dans la zone des tribunes (élargie de `beforeM` mètres en amont) ?
  inCrowd(idxF, beforeM = 0) {
    const N = this.N;
    const f = ((idxF % N) + N) % N;
    return f > this.crowd.f0 - beforeM / this.segLen && f < this.crowd.f1;
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
      c.mesh.position.y = c.baseY + Math.sin(t * 2 + c.phase) * .16;
    }
    // chevrons de turbo qui pulsent
    for (const pad of this.pads) {
      if (pad.mesh) pad.mesh.material.opacity = .8 + .2 * Math.sin(t * 7 + pad.phase * 2.1);
    }
    // poussière qui dérive, recentrée sur la caméra
    if (camPos) {
      this.dust.position.x = camPos.x;
      this.dust.position.z = camPos.z;
      this.dust.rotation.y += dt * .02;
    }
  }
}
