// IA duelliste : pilote un Fighter avec les mêmes entrées qu'un joueur.
// Approche, tourne autour de sa cible, attaque dans des directions variées,
// pare (avec temps de réaction) la direction des coups adverses.
import { clamp, angleDelta } from './util.js';

export class SaberAI {
  constructor(fighter, rnd, skill = .55) {
    this.f = fighter;
    this.rnd = rnd;
    this.skill = skill;           // 0..1 : probabilité et vitesse de parade
    this.atkCool = 1 + rnd();
    this.strafeDir = rnd() < .5 ? 1 : -1;
    this.strafeT = 0;
    this.pendingBlock = null;     // {dir, at} : parade après temps de réaction
    this.blockHold = 0;
    this.forceCool = 4 + rnd() * 4;
    this.dashCool = 2;
    this.t = 0;
  }

  think(dt, enemies) {
    this.t += dt;
    const f = this.f;
    const inp = {
      mvx: 0, mvz: 0, yaw: f.yaw,
      jump: false, dash: false, force: false,
      attack: false, attackDir: 0, block: false, blockDir: null,
    };
    if (!f.alive) return inp;

    // cible : l'ennemi vivant le plus proche
    let target = null, bd = 1e9;
    for (const e of enemies) {
      if (!e.alive || e === f) continue;
      const d = Math.hypot(e.x - f.x, e.z - f.z);
      if (d < bd) { bd = d; target = e; }
    }
    if (!target) return inp;

    const dx = target.x - f.x, dz = target.z - f.z;
    const dist = Math.hypot(dx, dz) || 1;
    inp.yaw = Math.atan2(dx, dz);

    this.atkCool -= dt;
    this.forceCool -= dt;
    this.dashCool -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 1 + this.rnd() * 2; if (this.rnd() < .5) this.strafeDir *= -1; }

    // ——— défense : réagit au windup adverse ———
    const threat = enemies.find(e => e !== f && e.alive && e.state === 'attack' && e.attackPhase === 'windup' &&
      Math.hypot(e.x - f.x, e.z - f.z) < 4.2);
    if (threat && !this.pendingBlock && f.state !== 'attack') {
      if (this.rnd() < this.skill + .25) {
        const reaction = .1 + (1 - this.skill) * .22;
        this.pendingBlock = { dir: threat.attackDir, at: this.t + reaction };
      }
    }
    if (this.pendingBlock) {
      if (this.t >= this.pendingBlock.at) {
        inp.block = true;
        inp.blockDir = this.pendingBlock.dir;
        this.blockHold = .5 + this.rnd() * .3;
        this.pendingBlock = null;
      }
    } else if (this.blockHold > 0) {
      this.blockHold -= dt;
      inp.block = true;
      inp.blockDir = f.blockDir;
    }

    // ——— déplacement ———
    let mvx = 0, mvz = 0;
    if (dist > 2.4) { mvx += dx / dist; mvz += dz / dist; }
    else if (dist < 1.4) { mvx -= dx / dist * .8; mvz -= dz / dist * .8; }
    if (dist < 5) {
      mvx += -dz / dist * this.strafeDir * .7;
      mvz += dx / dist * this.strafeDir * .7;
    }
    const l = Math.hypot(mvx, mvz) || 1;
    inp.mvx = mvx / l; inp.mvz = mvz / l;

    // dash pour combler la distance
    if (dist > 6 && dist < 12 && this.dashCool <= 0 && this.rnd() < dt * .8) {
      inp.dash = true;
      this.dashCool = 2.5;
    }
    // petit saut de temps en temps (esquive)
    if (this.rnd() < dt * .1) inp.jump = true;

    // ——— attaque ———
    if (!inp.block && dist < 2.9 && this.atkCool <= 0 && f.state === 'move') {
      inp.attack = true;
      // évite la direction que l'adversaire pare déjà
      let dir = (this.rnd() * 4) | 0;
      if (target.blocking && target.blockDir === dir) dir = (dir + 1 + ((this.rnd() * 3) | 0)) % 4;
      inp.attackDir = dir;
      this.atkCool = .7 + this.rnd() * (1.4 - this.skill * .7);
    }

    // ——— force push : brise les parades ou éloigne ———
    if (this.forceCool <= 0 && dist < 5.5 && (target.blocking || this.rnd() < .3)) {
      const facing = Math.abs(angleDelta(f.yaw, Math.atan2(dx, dz))) < .5;
      if (facing) {
        inp.force = true;
        this.forceCool = 5 + this.rnd() * 4;
      }
    }
    return inp;
  }
}
