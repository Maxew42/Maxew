// Bot brains. Heuristic, not pathfinding: same-floor walking, stairwell
// hopping between floors, and chewing through drywall when stuck.
import { WEAPONS } from './weapons.js';
import { dist, clamp } from './util.js';

const NAMES = ['Stagiaire', 'Comptable', 'DRH', 'Le Boss', 'Dev Senior', 'Intérimaire', 'Commercial', 'Chef de Projet', 'Consultant', 'Alternant'];
export const botName = i => NAMES[i % NAMES.length];

const DIFF = {
  easy:   { aimErr: 0.3,  react: 0.55, burst: 0.35, dodge: 0.15 },
  normal: { aimErr: 0.16, react: 0.3,  burst: 0.55, dodge: 0.35 },
  hard:   { aimErr: 0.07, react: 0.14, burst: 0.8,  dodge: 0.6 },
};

// Preferred engagement distance per weapon.
function wantDist(kind) {
  const d = WEAPONS[kind];
  if (d.kind === 'melee') return 24;
  if (d.kind === 'thrown' || d.kind === 'placed') return 230;
  if (kind === 'shotgun' || kind === 'flamer') return 130;
  if (kind === 'awp') return 460;
  if (kind === 'bazooka') return 300;
  if (kind === 'pistol' || kind === 'shield' || kind === 'deagle') return 250;
  return 300;
}

export class AIController {
  constructor(man, difficulty = 'normal') {
    this.man = man;
    this.d = DIFF[difficulty] || DIFF.normal;
    this.wander = null;        // {x, y}
    this.wanderT = 0;
    this.strafe = 1;
    this.strafeT = 0;
    this.reactT = 0;
    this.fireT = 0;
    this.pause = 0.3;
    this.stuckT = 0;
    this.aimJit = 0;
    this.target = null;
    this.hunt = null;          // last known position of whoever shot us
    this.huntT = 0;
  }

  // Getting shot from the dark: remember where it came from and go look.
  onHurt(byId, game) {
    const attacker = game.manById(byId);
    if (!attacker || attacker === this.man) return;
    this.hunt = { x: attacker.x, y: attacker.y };
    this.huntT = 7;
    this.reactT = Math.min(this.reactT, 0.12);
  }

  update(dt, game) {
    const m = this.man;
    const inp = m.input;
    inp.mx = 0; inp.jumpP = false; inp.jump = false; inp.dropP = false;
    inp.fire = false; inp.fireP = false; inp.swapP = false; inp.throwP = false; inp.pickP = false;
    if (!m.alive) return;

    // --- find a target ---------------------------------------------------
    let best = null, bd = 680;
    for (const o of game.men) {
      if (o === m || !o.alive) continue;
      const dd = dist(m.x, m.y, o.x, o.y);
      if (dd < bd && game.losClear(m.x, m.y - 30, o.x, o.y - 30)) { best = o; bd = dd; }
    }
    if (best !== this.target) { this.target = best; this.reactT = this.d.react * (0.6 + Math.random() * 0.8); }
    this.reactT -= dt;
    this.strafeT -= dt;
    this.wanderT -= dt;
    this.fireT -= dt;
    if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0.7 + Math.random(); }

    // --- weapon upkeep ----------------------------------------------------
    const w = m.weapon, wd = m.wdef;
    if (wd.kind !== 'melee' && w.ammo <= 0) {
      const other = m.slots[1 - m.cur];
      if (other && (other.ammo > 0 || WEAPONS[other.kind].kind === 'melee')) inp.swapP = true;
      else if (this.target && Math.random() < 0.6) inp.throwP = true;  // chuck it at their face
      else inp.swapP = true;
    }

    // Grab better hardware when standing on it.
    const item = game.groundWeaponNear(m.x, m.y, 26);
    if (item) {
      const mine = m.slots[m.cur];
      if (!mine || !m.slots[1 - m.cur] || WEAPONS[item.wkind].tier > WEAPONS[mine.kind].tier) inp.pickP = true;
    }

    // --- combat -----------------------------------------------------------
    if (this.target && this.reactT <= 0) {
      const t = this.target;
      const dd = bd;
      this.aimJit += (Math.random() - 0.5) * 0.4;
      this.aimJit *= 0.9;
      const err = this.d.aimErr * (0.5 + Math.min(1, dd / 500)) + Math.abs(this.aimJit) * 0.1;
      // Lead a little on fast targets, badly.
      const lead = clamp(t.vx * dd / 1000 * 0.5, -40, 40) * (Math.random() < 0.6 ? 1 : 0);
      inp.aim = Math.atan2((t.y - 34) - (m.y - 30), (t.x + lead) - m.x) + (Math.random() - 0.5) * err;

      const want = wantDist(w.kind);
      if (wd.kind === 'melee') {
        inp.mx = Math.sign(t.x - m.x);
        if (dd < wd.range + 14) inp.fire = true;
        if (Math.abs(t.x - m.x) < 30 && t.y < m.y - 40) inp.jumpP = m.onGround;
      } else {
        if (dd > want * 1.25) inp.mx = Math.sign(t.x - m.x);
        else if (dd < want * 0.6) inp.mx = -Math.sign(t.x - m.x);
        else inp.mx = this.strafe * 0.7;
        // Don't rocket yourself in the foot.
        const tooClose = wd.rocket && dd < 160;
        if (!tooClose && dd < (wd.range || 700) * 1.05) {
          if (wd.kind === 'gun') {
            // Fire cycle: hold the trigger for `burst`, breathe for `pause`.
            if (this.fireT <= 0) {
              this.pause = 0.2 + Math.random() * 0.5;
              this.fireT = this.d.burst + this.pause;
            }
            inp.fire = this.fireT > this.pause;
          } else if (wd.kind === 'thrown') {
            if (dd > 120 && dd < 420 && Math.random() < 0.9 * dt * 2) inp.fireP = true;
          } else if (wd.kind === 'placed') {
            inp.swapP = true;   // mines are for corridors, not firefights
          }
        }
      }
      if (Math.random() < this.d.dodge * dt * 2 && m.onGround) inp.jumpP = true;
      this.navigate(dt, game, t.x, t.y, inp, true);
      return;
    }
    if (this.target) {
      // Spotted, still reacting: square up on the threat instead of wandering off.
      const t = this.target;
      inp.aim = Math.atan2((t.y - 34) - (m.y - 30), t.x - m.x);
      return;
    }

    // --- hunt the last shooter, else wander --------------------------------
    this.huntT -= dt;
    if (this.hunt && this.huntT > 0) {
      if (dist(m.x, m.y, this.hunt.x, this.hunt.y) < 60) { this.hunt = null; this.huntT = 0; }
    } else this.hunt = null;
    if (!this.hunt && (!this.wander || this.wanderT <= 0 || dist(m.x, m.y, this.wander.x, this.wander.y) < 40)) {
      const pads = [...game.map.weaponPads, ...game.map.itemPads, ...game.map.spawns];
      this.wander = pads[Math.floor(Math.random() * pads.length)];
      this.wanderT = 12 + Math.random() * 8;
    }
    const goal = this.hunt || this.wander;
    const wx = goal.x, wy = goal.y;
    inp.aim = m.facing > 0 ? 0 : Math.PI;
    this.navigate(dt, game, wx, wy, inp, false);
    if (Math.abs(inp.mx) > 0.1) inp.aim = inp.mx > 0 ? 0 : Math.PI;
    // Sometimes drop a mine while roaming.
    const mineSlot = m.slots.find(s => s && s.kind === 'mine' && s.ammo > 0);
    if (mineSlot && m.slots[m.cur] === mineSlot && Math.random() < 0.05 * dt && m.onGround) inp.fireP = true;
  }

  navigate(dt, game, tx, ty, inp, combat) {
    const m = this.man;
    const map = game.map;
    const fm = map.floorAt(m.y), ft = map.floorAt(ty);

    if (fm !== ft && (!combat || Math.abs(ty - m.y) > 70)) {
      // Head for the nearest stairwell, then hop or drop.
      let sx = map.shaftXs[0], sd = 1e9;
      for (const s of map.shaftXs) { const d = Math.abs(s - m.x); if (d < sd) { sd = d; sx = s; } }
      if (sd > 26) {
        inp.mx = Math.sign(sx - m.x);
      } else {
        inp.mx = (sx - m.x) * 0.1;
        if (ft > fm) {                    // going up: bounce through the one-way plats
          inp.jump = true;
          if (m.onGround) inp.jumpP = true;
        } else {
          if (m.onGround) inp.dropP = true;
        }
      }
    } else if (!combat) {
      if (Math.abs(tx - m.x) > 24) inp.mx = Math.sign(tx - m.x);
    }

    // Stuck against something? Jump; drywall gets chewed through.
    if (Math.abs(inp.mx) > 0.1 && Math.abs(m.vx) < 12) {
      this.stuckT += dt;
      if (this.stuckT > 0.25 && m.onGround) inp.jumpP = true;
      if (this.stuckT > 0.7 && m.blockedWall) {
        inp.aim = inp.mx > 0 ? 0 : Math.PI;
        const wd = m.wdef;
        if (wd.kind === 'melee') inp.fire = true;
        else if (wd.kind === 'gun' && m.weapon.ammo > 0) inp.fire = true;
        else inp.swapP = this.stuckT > 1.2;
      }
      if (this.stuckT > 4) { this.wander = null; this.stuckT = 0; }
    } else this.stuckT = Math.max(0, this.stuckT - dt * 2);
  }
}
