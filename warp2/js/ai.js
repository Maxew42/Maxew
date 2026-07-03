// AI pilot: steers a Ship by writing into ship.input, like a player would.
import { wrapAngle, clamp } from './util.js';

const DIFFICULTY = {
  easy:   { aim: 0.28, react: 0.9, range: 1.25, flareChance: 0.4 },
  normal: { aim: 0.16, react: 0.45, range: 1.0, flareChance: 0.8 },
  hard:   { aim: 0.07, react: 0.2, range: 0.9, flareChance: 1 },
};

export class AIController {
  constructor(ship, difficulty = 'normal') {
    this.ship = ship;
    this.cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.target = null;
    this.retargetTimer = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 2 + Math.random() * 3;
    this.aimJitter = 0;
    this.jitterTimer = 0;

    // Preferred engagement range from loadout.
    const types = ship.design.parts
      .map(p => p.id)
      .filter(id => ['machinegun', 'beam', 'missile', 'rocket', 'turret'].includes(id));
    this.wantRange = 240;
    if (types.includes('missile') || types.includes('rocket')) this.wantRange = 400;
    if (types.includes('turret') && !types.includes('machinegun') && !types.includes('beam')) this.wantRange = 380;
    this.wantRange *= this.cfg.range;
    this.hasMines = types.length === 0 || ship.design.parts.some(p => p.id === 'mine_launcher');
    this.hasFlares = ship.design.parts.some(p => p.id === 'flare_launcher');
  }

  update(dt, world) {
    const ship = this.ship;
    const inp = ship.input;
    inp.fire = false; inp.missile = false; inp.mine = false; inp.flare = false; inp.boost = false;
    if (!ship.alive) return;

    // Retarget occasionally.
    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0 || !this.target || !this.target.alive) {
      this.retargetTimer = 1.5;
      this.target = world.nearestEnemy(ship, 10000);
    }
    const t = this.target;
    if (!t) { inp.thrust = 0; return; }

    // Strafe direction flips periodically so orbits are not perfect circles.
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeTimer = 2 + Math.random() * 3; this.strafeDir *= -1; }

    // Aim jitter refresh (skill).
    this.jitterTimer -= dt;
    if (this.jitterTimer <= 0) {
      this.jitterTimer = this.cfg.react;
      this.aimJitter = (Math.random() - 0.5) * 2 * this.cfg.aim;
    }

    const dx = t.x - ship.x, dy = t.y - ship.y;
    const dist = Math.hypot(dx, dy);

    // Goal point: orbit the target at wantRange.
    const toward = Math.atan2(dy, dx);
    let goalAngle;
    if (dist > this.wantRange * 1.25) {
      goalAngle = toward;                       // close in
    } else if (dist < this.wantRange * 0.6) {
      goalAngle = toward + Math.PI * 0.82 * this.strafeDir; // back off
    } else {
      goalAngle = toward + Math.PI * 0.5 * this.strafeDir;  // orbit
    }

    // Asteroid avoidance: probe ahead, steer away from the closest threat.
    let steer = goalAngle;
    const probe = 90 + Math.hypot(ship.vx, ship.vy) * 0.7;
    for (const ast of world.asteroids) {
      const ax = ast.x - ship.x, ay = ast.y - ship.y;
      const ad = Math.hypot(ax, ay) - ast.r;
      if (ad < probe + ship.radius) {
        const away = Math.atan2(-ay, -ax);
        const w = clamp(1 - ad / (probe + ship.radius), 0, 1);
        steer = steer + wrapAngle(away - steer) * w * 0.9;
      }
    }

    inp.targetAngle = steer;
    inp.turn = 0;
    inp.thrust = dist > this.wantRange * 0.5 ? 1 : 0.55;
    inp.boost = dist > this.wantRange * 2.2 && ship.energy > ship.energyMax * 0.55;

    // Fire when roughly facing the target (lead a little by target velocity).
    const lead = clamp(dist / 640, 0, 0.6);
    const aimAt = Math.atan2(t.y + t.vy * lead - ship.y, t.x + t.vx * lead - ship.x);
    const facing = Math.abs(wrapAngle(aimAt + this.aimJitter - ship.angle));
    if (facing < 0.3 && dist < this.wantRange * 1.9) inp.fire = true;
    // Missiles home, so a much looser cone is fine.
    if (facing < 0.7 && dist < this.wantRange * 2.2) inp.missile = true;

    // Drop a mine when an enemy tails us closely.
    if (this.hasMines && dist < 220) {
      const behind = Math.abs(wrapAngle(Math.atan2(-dy, -dx) - ship.angle));
      if (behind < 0.9 && Math.random() < 0.02) inp.mine = true;
    }

    // Pop flares when a missile is locked on us.
    if (this.hasFlares) {
      for (const m of world.missiles) {
        if (m.alive && m.targetId === ship.id && !m.flareTarget) {
          const md = Math.hypot(m.x - ship.x, m.y - ship.y);
          if (md < 320 && Math.random() < this.cfg.flareChance * 0.15) { inp.flare = true; break; }
        }
      }
    }
  }
}
