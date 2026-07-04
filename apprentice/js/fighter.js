// Combattant au sabre : physique, machine à états de combat (attaques et parades
// directionnelles façon Mount & Blade), visuel procédural, interpolation réseau.
// Les combattants "local" et "ai" (chez l'hôte) sont simulés ; les "remote" interpolés.
import * as THREE from 'three';
import { clamp, lerp, angleDelta } from './util.js';
import { ARENA_R } from './arena.js';

export const SABERS = [
  { id: 'bleu', name: 'Bleu', color: 0x3b8cff },
  { id: 'vert', name: 'Vert', color: 0x45ff6e },
  { id: 'violet', name: 'Violet', color: 0xb45cff },
  { id: 'jaune', name: 'Jaune', color: 0xffd24d },
  { id: 'rouge', name: 'Rouge', color: 0xff4040 },
  { id: 'blanc', name: 'Blanc', color: 0xe8f4ff },
];
export const saberById = id => SABERS.find(s => s.id === id) || SABERS[0];

// états réseau
export const ST = { MOVE: 0, WINDUP: 1, SWING: 2, RECOVER: 3, BLOCK: 4, STAGGER: 5, DEAD: 6, DASH: 7 };
const FL_PERFECT = 1; // parade « réflexe » encore active

// réglages combat
export const CFG = {
  hp: 100,
  walk: 7.4,
  gravity: 26,
  jumpV: 9.2,
  dashV: 24, dashDur: .17, dashCd: 1.1,
  windup: .21, swing: .17, recover: .32,
  hitAt: .45,            // fraction du swing où la touche est testée
  range: 3.1, arc: 1.15, // portée et demi-angle (rad) du coup
  dmgSaber: 34,
  parryWindow: .28,      // parade « réflexe » → renvoi / contre
  forceCost: 45, forceRegen: 16,
  pushRange: 6.5, pushArc: .95, pushKb: 15,
  staggerHit: .5, staggerPush: .85, staggerParried: .8,
};

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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: t, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: .92,
  }));
  s.scale.set(.09, .0197, 1);
  return s;
}

// poses : rotations épaule droite [rx,ry,rz], sabre (au poignet) [rx,ry,rz], torsion du torse.
// Angles résolus numériquement (recherche sur position de main + direction de lame,
// personnage face à +Z, sa droite = −X). Voir README pour la convention.
const POSES = {
  idle: { arm: [-.7, 0, -.2], sab: [-2, 0, 2.9], tw: 0 },
  block: [
    { arm: [-2.38, 0, .44], sab: [-.6, 0, 1.3], tw: 0 },     // haut : lame horizontale au-dessus
    { arm: [-1.18, 0, -.12], sab: [1.4, 0, 0], tw: -.25 },   // droite : lame verticale côté droit
    { arm: [-.86, 0, .28], sab: [-2.9, 0, .1], tw: 0 },      // bas : lame basse pointe vers le sol
    { arm: [-1.18, 0, .84], sab: [-1.7, 0, -3], tw: .3 },    // gauche : lame verticale côté gauche
  ],
  windup: [
    { arm: [-3.1, 0, .28], sab: [2.6, 0, .5], tw: -.15 },    // haut : bras armé au-dessus/derrière
    { arm: [-1.02, 0, -1.08], sab: [3, 0, .9], tw: -.55 },   // droite : bras ouvert côté droit
    { arm: [.42, 0, -.12], sab: [-2.9, 0, .1], tw: .2 },     // bas : lame basse en arrière
    { arm: [-1.42, 0, .92], sab: [2.6, 0, .7], tw: .55 },    // gauche : bras croisé côté gauche
  ],
  end: [
    { arm: [-1.26, 0, .2], sab: [-3.1, 0, .3], tw: .15 },    // haut → tranche vers l'avant-bas
    { arm: [-1.42, 0, .68], sab: [2.8, 0, .5], tw: .5 },     // droite → balaie vers la gauche
    { arm: [-2.3, 0, .52], sab: [2.8, 0, .3], tw: -.2 },     // bas → remonte devant
    { arm: [-1.42, 0, -.04], sab: [.3, 0, 1.2], tw: -.5 },   // gauche → balaie vers la droite
  ],
  stagger: { arm: [-.46, 0, -.12], sab: [1, 0, .3], tw: -.3 },
};

// interpolation par le plus court chemin angulaire (certains angles frôlent ±π)
const lerpA = (a, b, f) => a + angleDelta(a, b) * f;

export class Fighter {
  constructor(saberId, { slot = 0, name = '', kind = 'local' } = {}) {
    this.slot = slot;
    this.name = name;
    this.kind = kind; // 'local' | 'remote' | 'ai'
    this.saberId = saberId;
    this.saberColor = saberById(saberId).color;

    // ——— état physique ———
    this.x = 0; this.z = 0; this.y = 0;
    this.yVel = 0;
    this.yaw = 0;
    this.vx = 0; this.vz = 0;
    this.kbx = 0; this.kbz = 0; // recul (force push)
    this.jumps = 2;

    // ——— état combat ———
    this.hp = CFG.hp;
    this.force = 100;
    this.state = 'move';   // move | attack | block | stagger | dead
    this.attackDir = 0; this.attackPhase = 'windup'; this.attackT = 0;
    this.struck = false;   // la touche du swing courant a déjà été testée
    this.blockDir = null; this.blockT = 0;
    this.staggerT = 0;
    this.dashT = 0; this.dashCd = 0; this.dashDX = 0; this.dashDZ = 0;
    this.deadT = 0;
    this.invulnT = 0;      // après réapparition
    this.kills = 0; this.deaths = 0;
    this.events = [];      // consommés par le jeu à chaque frame

    // interpolation réseau
    this.snaps = [];
    this._lastSt = ST.MOVE;
    this.animT = 0;

    this._buildBody();
  }

  // ——————— visuel procédural ———————
  _buildBody() {
    this.group = new THREE.Group();
    const robe = new THREE.MeshLambertMaterial({ color: this.kind === 'ai' ? 0x55607a : 0x776850 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a332a });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd8b090 });

    // jambes
    this.legs = [];
    for (const sx of [-.16, .16]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.24, .8, .24), dark);
      leg.geometry.translate(0, -.4, 0);
      leg.position.set(sx, .85, 0);
      this.group.add(leg);
      this.legs.push(leg);
    }

    // torse (tunique) + torsion
    this.torso = new THREE.Group();
    this.torso.position.y = .85;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(.56, .62, .34), robe);
    chest.position.y = .32;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(.58, .12, .36), dark);
    belt.position.y = .02;
    this.torso.add(chest, belt);

    // tête + capuche
    const head = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 8), skin);
    head.position.set(0, .78, .05);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(.21, 9, 7), robe);
    hood.scale.set(1, 1.05, .95);
    hood.position.set(0, .82, -.04);
    // yeux : rendent l'orientation lisible (le personnage regarde vers +Z local)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1410 });
    for (const ex of [-.055, .055]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.022, 6, 4), eyeMat);
      eye.position.set(ex, .81, .19);
      this.torso.add(eye);
    }
    this.torso.add(head, hood);

    // bras gauche (côté +X quand on regarde vers +Z)
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(.15, .6, .15), robe);
    this.armL.geometry.translate(0, -.3, 0);
    this.armL.position.set(.36, .55, 0);
    this.armL.rotation.set(-.2, 0, -.15);
    this.torso.add(this.armL);

    // bras droit (porte-sabre, côté −X : la vraie droite du personnage)
    this.armR = new THREE.Group();
    this.armR.position.set(-.36, .55, 0);
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(.15, .6, .15), robe);
    armMesh.geometry.translate(0, -.3, 0);
    this.armR.add(armMesh);

    // sabre : poignée + lame (cœur blanc + halo couleur) + lueur
    this.saber = new THREE.Group();
    this.saber.position.y = -.62;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(.035, .04, .24, 8), new THREE.MeshLambertMaterial({ color: 0x9aa2ad }));
    const BLADE_L = 1.25;
    this.blade = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(.022, .016, BLADE_L, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    core.position.y = BLADE_L / 2 + .12;
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(.06, .045, BLADE_L + .06, 8),
      new THREE.MeshBasicMaterial({ color: this.saberColor, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.y = BLADE_L / 2 + .12;
    const glow2 = new THREE.Mesh(
      new THREE.CylinderGeometry(.13, .09, BLADE_L + .1, 8),
      new THREE.MeshBasicMaterial({ color: this.saberColor, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow2.position.y = BLADE_L / 2 + .12;
    this.blade.add(core, glow, glow2);
    this.saber.add(hilt, this.blade);
    this.armR.add(this.saber);
    this.torso.add(this.armR);
    this.group.add(this.torso);
    this.bladeLen = BLADE_L;

    // arc de « swoosh » pendant le swing
    this.swoosh = new THREE.Mesh(
      new THREE.RingGeometry(.9, 2.3, 14, 1, 0, 1.9),
      new THREE.MeshBasicMaterial({ color: this.saberColor, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.swoosh.position.y = 1.25;
    this.group.add(this.swoosh);

    // ombre
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(.55, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .3, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = .03;
    this.group.add(shadow);
    this.shadow = shadow;

    if (this.kind !== 'local' && this.name) {
      this.tag = nameSprite(this.name, this.kind === 'ai' ? '#b9c2ca' : '#ffd28a');
      this.tag.position.y = 2.15;
      this.group.add(this.tag);
    }
  }

  get alive() { return this.state !== 'dead'; }
  get blocking() { return this.state === 'block'; }

  dirX() { return Math.sin(this.yaw); }
  dirZ() { return Math.cos(this.yaw); }

  // position de la pointe de lame (pour étincelles / renvois)
  bladeTip(v) {
    this.blade.updateWorldMatrix(true, false);
    return (v || new THREE.Vector3(0, this.bladeLen, 0)).setY(this.bladeLen).setX(0).setZ(0)
      .applyMatrix4(this.blade.matrixWorld);
  }

  spawnAt(p) {
    this.x = p.x; this.z = p.z; this.yaw = p.yaw ?? 0;
    this.y = 0; this.yVel = 0; this.vx = this.vz = this.kbx = this.kbz = 0;
    this.hp = CFG.hp; this.force = 100;
    this.state = 'move'; this.staggerT = 0; this.dashT = 0; this.dashCd = 0;
    this.jumps = 2; this.deadT = 0; this.invulnT = 2;
    this.group.rotation.x = 0;
    this.group.visible = true;
    this.syncVisual();
  }

  // ——————— simulation (local + IA) ———————
  // input : { mvx, mvz (direction monde), yaw, jump, dash, force, attack, attackDir, block, blockDir }
  update(dt, input) {
    const ev = this.events;

    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    this.force = Math.min(100, this.force + CFG.forceRegen * dt);

    if (this.state === 'dead') {
      this.deadT += dt;
      this._physics(dt, 0, 0);
      this.syncVisual();
      return;
    }

    // orientation : suit la caméra (ou la cible pour l'IA)
    if (this.state !== 'stagger') {
      this.yaw += angleDelta(this.yaw, input.yaw) * clamp(dt * 14, 0, 1);
    }

    // ——— machine à états ———
    if (this.state === 'stagger') {
      this.staggerT -= dt;
      if (this.staggerT <= 0) this.state = 'move';
    } else if (this.state === 'attack') {
      this.attackT += dt;
      const ph = this.attackPhase;
      if (ph === 'windup' && this.attackT >= CFG.windup) { this.attackPhase = 'swing'; this.attackT = 0; this.struck = false; ev.push({ k: 'swing', d: this.attackDir }); }
      else if (ph === 'swing') {
        if (!this.struck && this.attackT >= CFG.swing * CFG.hitAt) { this.struck = true; ev.push({ k: 'strike', d: this.attackDir }); }
        if (this.attackT >= CFG.swing) { this.attackPhase = 'recover'; this.attackT = 0; }
      }
      else if (ph === 'recover' && this.attackT >= CFG.recover) this.state = 'move';
    } else if (this.state === 'block') {
      this.blockT += dt;
      if (input.blockDir !== undefined && input.block) this.blockDir = input.blockDir;
      if (!input.block) this.state = 'move';
    }

    // ——— déclencheurs (depuis move ou block) ———
    const can = this.state === 'move' || this.state === 'block';
    if (can && input.attack) {
      this.state = 'attack';
      this.attackPhase = 'windup'; this.attackT = 0;
      this.attackDir = input.attackDir ?? this._autoDir(input);
      ev.push({ k: 'windup', d: this.attackDir });
    } else if (this.state === 'move' && input.block) {
      this.state = 'block';
      this.blockT = 0;
      this.blockDir = input.blockDir;
      ev.push({ k: 'block' });
    }

    if (can && input.force && this.force >= CFG.forceCost) {
      this.force -= CFG.forceCost;
      if (this.state === 'block') this.state = 'move';
      ev.push({ k: 'force' });
    }

    if (input.dash && this.dashCd <= 0 && this.state !== 'stagger') {
      const l = Math.hypot(input.mvx, input.mvz);
      this.dashDX = l > .1 ? input.mvx / l : this.dirX();
      this.dashDZ = l > .1 ? input.mvz / l : this.dirZ();
      this.dashT = CFG.dashDur;
      this.dashCd = CFG.dashCd;
      ev.push({ k: 'dash' });
    }

    if (input.jump && this.jumps > 0 && this.state !== 'stagger') {
      this.yVel = CFG.jumpV * (this.jumps === 2 ? 1 : .92);
      this.jumps--;
      ev.push({ k: 'jump' });
    }

    // ——— déplacement ———
    let sp = CFG.walk;
    if (this.state === 'block') sp *= .45;
    else if (this.state === 'attack') sp *= .55;
    else if (this.state === 'stagger') sp = 0;
    let tx = input.mvx * sp, tz = input.mvz * sp;
    const ground = this.y <= 0.001;
    const f = clamp(dt * (ground ? 12 : 5), 0, 1);
    this.vx = lerp(this.vx, tx, f);
    this.vz = lerp(this.vz, tz, f);

    this._physics(dt, this.vx, this.vz);
    this.syncVisual();
  }

  // direction automatique quand l'entrée n'en donne pas (manette sans stick, tactile bouton)
  _autoDir(input) {
    const lx = -Math.cos(this.yaw), lz = Math.sin(this.yaw); // vecteur « droite »
    const side = input.mvx * lx + input.mvz * lz;
    const fwd = input.mvx * this.dirX() + input.mvz * this.dirZ();
    if (Math.abs(side) > .4) return side > 0 ? 1 : 3;
    if (fwd < -.4) return 2;
    this._cycleDir = ((this._cycleDir ?? 0) + 1) % 4;
    return this._cycleDir;
  }

  _physics(dt, vx, vz) {
    // dash : vitesse imposée
    if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashDX * CFG.dashV;
      vz = this.dashDZ * CFG.dashV;
    }
    // recul
    this.x += (vx + this.kbx) * dt;
    this.z += (vz + this.kbz) * dt;
    this.kbx *= Math.max(0, 1 - 6 * dt);
    this.kbz *= Math.max(0, 1 - 6 * dt);

    // gravité
    this.y += this.yVel * dt;
    this.yVel -= CFG.gravity * dt;
    if (this.y <= 0) { this.y = 0; this.yVel = 0; this.jumps = 2; }

    // enceinte circulaire
    const d = Math.hypot(this.x, this.z);
    if (d > ARENA_R) {
      this.x *= ARENA_R / d;
      this.z *= ARENA_R / d;
    }
  }

  // ——————— dégâts (autorité : le simulateur de CE combattant) ———————
  // renvoie {result:'immune'|'blocked'|'hit'|'dead', perfect}
  takeHit(dmg, fromX, fromZ, dir) {
    if (!this.alive || this.invulnT > 0) return { result: 'immune' };
    const toA = Math.atan2(fromX - this.x, fromZ - this.z);
    const facing = Math.abs(angleDelta(this.yaw, toA)) < 1.5;
    if (this.blocking && facing && (this.blockDir === null || this.blockDir === dir)) {
      return { result: 'blocked', perfect: this.blockT < CFG.parryWindow };
    }
    return this._damage(dmg);
  }

  // tir de blaster ; renvoie 'reflect' | 'deflect' | 'hit' | 'dead' | 'immune'
  takeBolt(dmg, fromX, fromZ) {
    if (!this.alive || this.invulnT > 0) return 'immune';
    const toA = Math.atan2(fromX - this.x, fromZ - this.z);
    const facing = Math.abs(angleDelta(this.yaw, toA)) < 1.35;
    if (this.blocking && facing) {
      return this.blockT < CFG.parryWindow ? 'reflect' : 'deflect';
    }
    return this._damage(dmg).result;
  }

  // poussée de force ; renvoie 'parried' | 'pushed' | 'immune'
  takePush(fromX, fromZ) {
    if (!this.alive || this.invulnT > 0) return 'immune';
    const toA = Math.atan2(fromX - this.x, fromZ - this.z);
    const facing = Math.abs(angleDelta(this.yaw, toA)) < 1.2;
    if (this.blocking && facing && this.blockT < .5) return 'parried';
    const dx = this.x - fromX, dz = this.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.kbx = dx / l * CFG.pushKb;
    this.kbz = dz / l * CFG.pushKb;
    this.yVel = Math.max(this.yVel, 4.5);
    this.stagger(CFG.staggerPush);
    return 'pushed';
  }

  _damage(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      return { result: 'dead' };
    }
    this.stagger(CFG.staggerHit);
    return { result: 'hit' };
  }

  stagger(t) {
    this.state = 'stagger';
    this.staggerT = Math.max(this.staggerT, t);
    this.attackT = 0;
  }

  die() {
    this.state = 'dead';
    this.deadT = 0;
    this.deaths++;
  }

  // ——————— réseau ———————
  get netState() {
    if (this.state === 'move') return this.dashT > 0 ? ST.DASH : ST.MOVE;
    if (this.state === 'attack') return this.attackPhase === 'windup' ? ST.WINDUP : this.attackPhase === 'swing' ? ST.SWING : ST.RECOVER;
    if (this.state === 'block') return ST.BLOCK;
    if (this.state === 'stagger') return ST.STAGGER;
    return ST.DEAD;
  }

  snapshot() {
    return {
      x: +this.x.toFixed(2), z: +this.z.toFixed(2), y: +this.y.toFixed(2),
      h: +this.yaw.toFixed(3), vx: +this.vx.toFixed(1), vz: +this.vz.toFixed(1),
      st: this.netState, d: (this.state === 'block' ? (this.blockDir ?? 4) : this.attackDir),
      hp: this.hp | 0,
      fl: (this.blocking && this.blockT < CFG.parryWindow) ? FL_PERFECT : 0,
    };
  }

  pushSnapshot(s, now) {
    this.snaps.push({ t: now, ...s });
    if (this.snaps.length > 12) this.snaps.shift();
  }

  // combattants distants : interpolation ~120 ms en arrière + états d'anim
  interpolate(now) {
    const buf = this.snaps;
    if (!buf.length) return;
    const rt = now - .12;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= rt) { a = buf[i]; b = buf[Math.min(i + 1, buf.length - 1)]; break; }
    }
    if (b.t > a.t && rt <= b.t) {
      const f = clamp((rt - a.t) / (b.t - a.t), 0, 1);
      this.x = lerp(a.x, b.x, f); this.z = lerp(a.z, b.z, f); this.y = lerp(a.y, b.y, f);
      this.yaw = a.h + angleDelta(a.h, b.h) * f;
    } else {
      const over = Math.max(0, Math.min(rt - b.t, .2));
      this.x = b.x + b.vx * over;
      this.z = b.z + b.vz * over;
      this.y = b.y; this.yaw = b.h;
    }
    this.vx = b.vx; this.vz = b.vz;
    this.hp = b.hp;

    // reflète l'état pour l'anim et les tests de parade côté attaquant distant
    const st = b.st;
    this.state = st === ST.BLOCK ? 'block' : st === ST.STAGGER ? 'stagger' : st === ST.DEAD ? 'dead' : (st === ST.WINDUP || st === ST.SWING || st === ST.RECOVER) ? 'attack' : 'move';
    if (this.state === 'attack') {
      this.attackPhase = st === ST.WINDUP ? 'windup' : st === ST.SWING ? 'swing' : 'recover';
      this.attackDir = b.d;
    } else if (this.state === 'block') {
      this.blockDir = b.d === 4 ? null : b.d;
      this.blockT = (b.fl & FL_PERFECT) ? 0 : 1; // approx pour l'affichage
    }
    if (st !== this._lastSt) { this.animT = 0; this._lastSt = st; }
    this.syncVisual();
  }

  // ——————— animation ———————
  syncVisual() {
    this.group.position.set(this.x, this.y, this.z);
    if (this.state !== 'dead') this.group.rotation.y = this.yaw;
    this.shadow.material.opacity = clamp(.3 - this.y * .03, .08, .3);
    this.shadow.position.y = .03 - this.y; // l'ombre reste au sol
  }

  _applyPose(pose, f) {
    this.armR.rotation.x = lerpA(this.armR.rotation.x, pose.arm[0], f);
    this.armR.rotation.y = lerpA(this.armR.rotation.y, pose.arm[1], f);
    this.armR.rotation.z = lerpA(this.armR.rotation.z, pose.arm[2], f);
    this.saber.rotation.x = lerpA(this.saber.rotation.x, pose.sab[0], f);
    this.saber.rotation.y = lerpA(this.saber.rotation.y, pose.sab[1], f);
    this.saber.rotation.z = lerpA(this.saber.rotation.z, pose.sab[2], f);
    this.torso.rotation.y = lerpA(this.torso.rotation.y, pose.tw, f);
  }

  updateVisuals(dt, time) {
    this.animT += dt;

    if (this.state === 'dead') {
      // s'effondre, la lame s'éteint
      this.group.rotation.x = lerp(this.group.rotation.x, -Math.PI / 2 * .9, clamp(this.deadT * 3 || this.animT * 3, 0, 1) * .2);
      this.blade.scale.y = Math.max(0, this.blade.scale.y - dt * 3);
      this.blade.visible = this.blade.scale.y > .02;
      this.swoosh.material.opacity = 0;
      return;
    }
    this.group.rotation.x = 0;
    this.blade.visible = true;
    this.blade.scale.y = Math.min(1, this.blade.scale.y + dt * 4);

    // jambes : course
    const speed = Math.hypot(this.vx, this.vz);
    const run = clamp(speed / CFG.walk, 0, 1.3);
    this._runPhase = (this._runPhase || 0) + dt * (4 + speed * 1.6);
    const lp = this.y > 0.05 ? .5 : Math.sin(this._runPhase) * .65 * run;
    this.legs[0].rotation.x = lp;
    this.legs[1].rotation.x = this.y > 0.05 ? -.4 : -lp;

    // bras gauche : balancier / équilibre
    this.armL.rotation.x = -.2 + (this.y > .05 ? -.7 : Math.sin(this._runPhase) * .4 * run);

    // pose du bras droit selon l'état
    let sw = 0; // opacité du swoosh
    if (this.state === 'attack') {
      const d = this.attackDir;
      if (this.attackPhase === 'windup') {
        this._applyPose(POSES.windup[d], clamp(dt * 16, 0, 1));
      } else if (this.attackPhase === 'swing') {
        const t = clamp((this.kind === 'remote' ? this.animT : this.attackT) / CFG.swing, 0, 1);
        const e = t * t * (3 - 2 * t); // easing
        const w = POSES.windup[d], en = POSES.end[d];
        this.armR.rotation.set(lerpA(w.arm[0], en.arm[0], e), lerpA(w.arm[1], en.arm[1], e), lerpA(w.arm[2], en.arm[2], e));
        this.saber.rotation.set(lerpA(w.sab[0], en.sab[0], e), lerpA(w.sab[1], en.sab[1], e), lerpA(w.sab[2], en.sab[2], e));
        this.torso.rotation.y = lerpA(w.tw, en.tw, e);
        sw = .55;
        // oriente l'arc de swoosh selon la direction
        const s = this.swoosh;
        if (d === 0) { s.rotation.set(0, 0, 1.9 * (1 - e) - .4); s.position.set(0, 1.3, .75); }
        else if (d === 2) { s.rotation.set(0, 0, -1.9 * e + .6); s.position.set(0, 1.1, .75); }
        else {
          s.rotation.set(-Math.PI / 2, 0, (d === 1 ? 1 : -1) * (e * 2.4 - 1.2));
          s.position.set(0, 1.35, .3);
        }
      } else {
        this._applyPose(POSES.idle, clamp(dt * 7, 0, 1));
        sw = Math.max(0, .35 - this.animT * 1.6);
      }
    } else if (this.state === 'block') {
      const d = this.blockDir === null || this.blockDir === undefined ? 0 : this.blockDir;
      this._applyPose(POSES.block[this.blockDir ?? 0], clamp(dt * 14, 0, 1));
    } else if (this.state === 'stagger') {
      this._applyPose(POSES.stagger, clamp(dt * 10, 0, 1));
    } else {
      this._applyPose(POSES.idle, clamp(dt * 8, 0, 1));
    }
    this.swoosh.material.opacity = sw;

    // clignote pendant l'invulnérabilité de réapparition
    this.group.visible = this.invulnT > 0 ? (Math.sin(time * 20) > -0.4) : true;
  }
}
