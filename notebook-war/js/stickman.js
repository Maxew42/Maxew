// A stickman: 48px of angry ballpoint ink.
// Physics vs the tile grid + one-way platforms (tiles and unbroken desks).
import { TILE, T_SOLID, T_WALL, T_PLAT } from './map.js';
import { WEAPONS } from './weapons.js';
import { clamp, lerp } from './util.js';

export const MAN_W = 13, MAN_H = 48;
const RUN = 250, ACCEL = 2400, AIR_ACCEL = 1400, FRICTION = 2200;
const GRAV = 1500, JUMP_V = 560, MAX_FALL = 950;

export class Stickman {
  constructor({ id, name, isBot = false, authority = true }) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.authority = authority;   // simulated locally (me, or host-run bots)
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.onGround = false; this.coyote = 0; this.jumpBuf = 0; this.dropT = 0;
    this.aim = 0; this.facing = 1;
    this.hp = 100; this.armor = 0; this.helmetHp = 0;
    this.alive = true; this.respawnT = 0;
    this.slots = [null, null];    // {kind, ammo}
    this.cur = 0;
    this.fireCd = 0; this.swingT = 0; this.heat = 0;
    this.drugT = 0; this.jetFuel = 0;
    this.burnT = 0; this.burnBy = null; this.hurtT = 0;
    this.phase = 0;
    this.blockedWall = null;      // tile index of drywall we walked into (AI chews it)
    this.netTarget = null;
    this.duck = false;
    this.stepT = 0;
    this.input = { mx: 0, jump: false, jumpP: false, dropP: false, down: false, aim: 0, fire: false, fireP: false, swapP: false, throwP: false, pickP: false };
  }

  get weapon() { return this.slots[this.cur] || { kind: 'hands', ammo: Infinity }; }
  get wdef() { return WEAPONS[this.weapon.kind]; }
  get h() { return this.duck ? 32 : MAN_H; }       // collision height (ducking shrinks it)
  get headX() { return this.x + this.facing * 1.5; }
  get headY() { return this.y - this.h + 5; }

  giveWeapon(kind, ammo) {
    const slot = { kind, ammo: ammo != null ? ammo : WEAPONS[kind].ammo };
    if (!this.slots[this.cur]) { this.slots[this.cur] = slot; return null; }
    const other = 1 - this.cur;
    if (!this.slots[other]) { this.slots[other] = slot; this.cur = other; return null; }
    const dropped = this.slots[this.cur];
    this.slots[this.cur] = slot;
    return dropped;               // caller drops it on the ground
  }

  takeWeapon() {                  // remove current weapon (thrown away)
    const w = this.slots[this.cur];
    this.slots[this.cur] = null;
    return w;
  }

  respawn(x, y) {
    this.x = x; this.y = y; this.vx = this.vy = 0;
    this.hp = 100; this.armor = 0; this.helmetHp = 0;
    this.alive = true; this.burnT = 0; this.drugT = 0; this.jetFuel = 0;
    this.fireCd = 0.4; this.heat = 0; this.dropT = 0;
  }

  speedMul() {
    let m = this.drugT > 0 ? 1.38 : 1;
    const d = this.wdef;
    if (d.slow) m *= d.slow;
    return m;
  }

  update(dt, game) {
    this.coyote -= dt; this.jumpBuf -= dt; this.dropT -= dt;
    this.fireCd -= dt; this.swingT -= dt; this.hurtT -= dt;
    this.drugT -= dt;
    this.heat = Math.max(0, this.heat - dt * 0.09);
    if (!this.alive) return;

    // Burning: damage over time, owned by whoever lit the fire.
    if (this.burnT > 0) {
      this.burnT -= dt;
      if (this.authority) game.hurt(this, 7 * dt, { by: this.burnBy, kind: 'flamer', silent: true });
    }

    const inp = this.input;
    this.aim = inp.aim;
    this.facing = Math.cos(this.aim) >= 0 ? 1 : -1;

    // Duck: hold down on solid ground (a tap on a platform drops through instead).
    this.duck = !!inp.down && this.onGround;

    // Horizontal.
    const top = RUN * this.speedMul() * (this.duck ? 0.45 : 1);
    const want = clamp(inp.mx, -1, 1) * top;
    const acc = this.onGround ? ACCEL : AIR_ACCEL;
    if (Math.abs(want) > 1) {
      if (this.vx < want) this.vx = Math.min(want, this.vx + acc * dt);
      else if (this.vx > want) this.vx = Math.max(want, this.vx - acc * dt);
    } else if (this.onGround) {
      const f = FRICTION * dt;
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f;
    }

    // Jump (+ buffer & coyote).
    if (inp.jumpP) this.jumpBuf = 0.11;
    if (this.jumpBuf > 0 && (this.onGround || this.coyote > 0)) {
      this.vy = -JUMP_V; this.onGround = false; this.coyote = 0; this.jumpBuf = 0;
      this.duck = false;
      game.audio?.jump(game.spatial(this.x, this.y));
    }
    // Jetpack: hold jump in the air.
    if (inp.jump && !this.onGround && this.jetFuel > 0 && this.vy > -330) {
      this.vy -= 2000 * dt;
      this.jetFuel -= 32 * dt;
      game.jetFx(this);
    }
    // Drop through platforms.
    if (inp.dropP && this.onGround && this.standingOnPlat(game)) {
      this.dropT = 0.2; this.onGround = false; this.y += 3;
    }

    this.vy = Math.min(MAX_FALL, this.vy + GRAV * dt);
    this.move(dt, game);
    if (this.onGround) this.coyote = 0.09;
    this.phase += this.vx * dt * 0.045;

    // Weapons.
    const w = this.weapon, d = this.wdef;
    if (d.kind === 'melee') {
      if (inp.fire && this.fireCd <= 0) {
        this.fireCd = 1 / d.rate; this.swingT = 0.22;
        game.meleeAttack(this, d);
      }
    } else if (d.kind === 'gun') {
      if (inp.fire && this.fireCd <= 0) {
        if (w.ammo > 0) {
          this.fireCd = 1 / d.rate; w.ammo--;
          game.fireGun(this, d);
          this.heat = Math.min(1, this.heat + 0.09);
          if (d.push) this.vx -= Math.cos(this.aim) * d.push;
        } else if (inp.fireP) {
          game.audio?.click(game.spatial(this.x, this.y));
        }
      }
    } else if (d.kind === 'thrown') {
      if (inp.fireP && this.fireCd <= 0 && w.ammo > 0) {
        this.fireCd = 1 / d.rate; w.ammo--;
        game.throwGrenade(this, w.kind);
      }
    } else if (d.kind === 'placed') {
      if (inp.fireP && this.fireCd <= 0 && w.ammo > 0 && this.onGround) {
        this.fireCd = 1 / d.rate; w.ammo--;
        game.placeMine(this);
      }
    }
    if (inp.swapP) { this.cur = 1 - this.cur; this.fireCd = Math.max(this.fireCd, 0.18); game.audio?.swap(game.spatial(this.x, this.y)); }
    if (inp.throwP) game.throwWeapon(this);
  }

  standingOnPlat(game) {
    const yb = this.y + 2;
    const r = Math.floor(yb / TILE);
    for (const c of [Math.floor((this.x - MAN_W / 2) / TILE), Math.floor((this.x + MAN_W / 2) / TILE)]) {
      if (game.map.t(c, r) === T_PLAT) return true;
    }
    for (const dcr of game.map.decors) {
      if (!dcr.plat || dcr.broken) continue;
      if (Math.abs(this.y - dcr.y) < 4 && this.x > dcr.x - MAN_W && this.x < dcr.x + dcr.w + MAN_W) return true;
    }
    return false;
  }

  move(dt, game) {
    const map = game.map;
    const hw = MAN_W / 2;
    this.blockedWall = null;

    // X sweep.
    let nx = this.x + this.vx * dt;
    if (this.vx !== 0) {
      const dir = Math.sign(this.vx);
      const edge = nx + dir * hw;
      const c = Math.floor(edge / TILE);
      const r0 = Math.floor((this.y - this.h + 2) / TILE), r1 = Math.floor((this.y - 2) / TILE);
      for (let r = r0; r <= r1; r++) {
        const t = map.t(c, r);
        if (t === T_SOLID || t === T_WALL) {
          nx = dir > 0 ? c * TILE - hw - 0.01 : (c + 1) * TILE + hw + 0.01;
          if (t === T_WALL) this.blockedWall = { c, r };
          this.vx = 0;
          break;
        }
      }
    }
    this.x = clamp(nx, hw + 2, map.pxw - hw - 2);

    // Y sweep.
    let ny = this.y + this.vy * dt;
    this.onGround = false;
    if (this.vy > 0) {
      const c0 = Math.floor((this.x - hw) / TILE), c1 = Math.floor((this.x + hw) / TILE);
      const rStart = Math.floor(this.y / TILE), rEnd = Math.floor(ny / TILE);
      outer:
      for (let r = rStart; r <= rEnd; r++) {
        for (let c = c0; c <= c1; c++) {
          const t = map.t(c, r);
          const top = r * TILE;
          if (t === T_SOLID || t === T_WALL) {
            if (this.y <= top + 1 || ny >= top) { ny = top; this.vy = 0; this.onGround = true; break outer; }
          } else if (t === T_PLAT && this.dropT <= 0) {
            if (this.y <= top + 1 && ny >= top) { ny = top; this.vy = 0; this.onGround = true; break outer; }
          }
        }
      }
      // One-way decor platforms (desks, tables, counters, AC units).
      if (!this.onGround) {
        for (const d of map.decors) {
          if (!d.plat || d.broken) continue;
          if (this.x + hw < d.x || this.x - hw > d.x + d.w) continue;
          if (this.dropT > 0) continue;
          if (this.y <= d.y + 1 && ny >= d.y) { ny = d.y; this.vy = 0; this.onGround = true; break; }
        }
      }
    } else if (this.vy < 0) {
      const c0 = Math.floor((this.x - hw) / TILE), c1 = Math.floor((this.x + hw) / TILE);
      const r = Math.floor((ny - this.h) / TILE);
      for (let c = c0; c <= c1; c++) {
        const t = map.t(c, r);
        if (t === T_SOLID || t === T_WALL) {
          ny = (r + 1) * TILE + this.h;
          this.vy = 0;
          break;
        }
      }
    }
    // Top of the page is a hard ceiling (jetpack can't leave the sheet).
    if (ny < MAN_H + 4) { ny = MAN_H + 4; this.vy = Math.max(0, this.vy); }
    this.y = Math.min(ny, map.pxh - 2);
  }

  // ---------------------------------------------------------------------------
  // Drawing. Everything relative to feet (x, y).
  // ---------------------------------------------------------------------------
  render(ctx, game) {
    if (!this.alive) return;
    const hurt = this.hurtT > 0;
    const ink = hurt ? '#7a1616' : '#16181d';
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const duck = this.duck;
    const hipY = duck ? -12 : -19, neckY = duck ? -25 : -37, headY = duck ? -31.5 : -43.5, headR = 7;
    const lean = clamp(this.vx / RUN, -1, 1) * 4;
    const running = this.onGround && Math.abs(this.vx) > 25 && !duck;
    const s = Math.sin(this.phase), c2 = Math.sin(this.phase + Math.PI);

    // Legs.
    ctx.beginPath();
    if (duck) {
      // Squatting: knees out, feet planted.
      ctx.moveTo(0, hipY); ctx.lineTo(-9, hipY + 6); ctx.lineTo(-6, 0);
      ctx.moveTo(0, hipY); ctx.lineTo(9, hipY + 6); ctx.lineTo(7, 0);
    } else if (running) {
      ctx.moveTo(lean * 0.4, hipY);
      ctx.quadraticCurveTo(s * 6 + 3, hipY + 10, s * 11, -Math.max(0, Math.sin(this.phase + 0.6)) * 5);
      ctx.moveTo(lean * 0.4, hipY);
      ctx.quadraticCurveTo(c2 * 6 - 3, hipY + 10, c2 * 11, -Math.max(0, Math.sin(this.phase + Math.PI + 0.6)) * 5);
    } else if (!this.onGround) {
      const k = clamp(this.vy / 500, -1, 1);
      ctx.moveTo(0, hipY); ctx.quadraticCurveTo(this.facing * 7, hipY + 8, this.facing * (9 - k * 3), -4 - k * 3);
      ctx.moveTo(0, hipY); ctx.quadraticCurveTo(-this.facing * 3, hipY + 12, -this.facing * (5 + k * 2), -1);
    } else {
      ctx.moveTo(0, hipY); ctx.lineTo(-5, 0);
      ctx.moveTo(0, hipY); ctx.lineTo(5, 0);
    }
    ctx.stroke();

    // Torso.
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(lean, neckY);
    ctx.stroke();

    // Armor vest: a scribbled band on the torso.
    if (this.armor > 0) {
      ctx.strokeStyle = '#2a4d8f';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(lean * 0.4, hipY - 4); ctx.lineTo(lean, neckY + 5); ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 3;
    }

    // Arms + weapon.
    this.renderArms(ctx, lean, neckY, ink);

    // Head.
    const hx = lean + this.facing * 1.5;
    ctx.beginPath();
    ctx.arc(hx, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    if (this.helmetHp > 0) {
      // Full helmet: a solid dome over the whole top of the head, with a rim.
      ctx.fillStyle = '#4a6f43';
      ctx.beginPath();
      ctx.arc(hx, headY + 0.5, headR + 2.5, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx - headR - 3.5, headY + 1.5); ctx.lineTo(hx + headR + 3.5, headY + 1.5);
      ctx.stroke();
      ctx.fillStyle = ink; ctx.lineWidth = 3;
    }

    // Burning.
    if (this.burnT > 0) {
      ctx.strokeStyle = 'rgba(230,120,30,0.85)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const fx = (Math.random() - 0.5) * 16, fy = -Math.random() * 40;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(fx + 3, fy - 7, fx - 1, fy - 13); ctx.stroke();
      }
    }
    ctx.restore();
  }

  renderArms(ctx, lean, neckY, ink) {
    const shX = lean, shY = neckY + 4;
    const d = this.wdef;
    const kind = this.weapon.kind;
    const a = this.aim;

    const arm = (fromX, fromY, ang, len, bend = 0) => {
      const ex = fromX + Math.cos(ang) * len * 0.5 + Math.cos(ang + Math.PI / 2) * bend;
      const ey = fromY + Math.sin(ang) * len * 0.5 + Math.sin(ang + Math.PI / 2) * bend;
      const hx2 = fromX + Math.cos(ang) * len, hy2 = fromY + Math.sin(ang) * len;
      ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.quadraticCurveTo(ex, ey, hx2, hy2); ctx.stroke();
      return [hx2, hy2];
    };

    if (kind === 'hands') {
      if (this.swingT > 0) {
        const t = 1 - this.swingT / 0.22;
        const pa = a + (t - 0.5) * 0.7 * this.facing;
        arm(shX, shY, pa, 15);
        arm(shX, shY, a + this.facing * 0.9, 11, 2);
      } else {
        arm(shX, shY, Math.PI / 2 - this.facing * 0.35, 13, 2);
        arm(shX, shY, Math.PI / 2 + this.facing * 0.25, 13, -2);
      }
      return;
    }

    if (d.kind === 'melee') {
      const t = this.swingT > 0 ? 1 - this.swingT / 0.22 : null;
      const ang = t == null ? a + this.facing * 0.5 : a - this.facing * 1.1 + t * this.facing * 2.0;
      const [hx2, hy2] = arm(shX, shY, ang, 14);
      arm(shX, shY, Math.PI / 2 + this.facing * 0.3, 12, 2);
      ctx.save();
      ctx.translate(hx2, hy2);
      ctx.rotate(ang);
      if (this.facing < 0) ctx.scale(1, -1);
      drawWeapon(ctx, kind, ink);
      ctx.restore();
      return;
    }

    if (d.kind === 'thrown' || d.kind === 'placed') {
      const winding = this.fireCd > 0 && this.fireCd > 1 / d.rate - 0.25;
      const ang = winding ? a - this.facing * 0.8 : a + this.facing * 0.25;
      const [hx2, hy2] = arm(shX, shY, ang, 14);
      arm(shX, shY, Math.PI / 2 + this.facing * 0.3, 12, 2);
      if (!winding && this.weapon.ammo > 0) {
        ctx.save(); ctx.translate(hx2, hy2);
        drawWeapon(ctx, kind, ink);
        ctx.restore();
      }
      return;
    }

    // Guns.
    const twoHanded = ['shotgun', 'm4', 'ak47', 'negev', 'awp', 'bazooka', 'flamer'].includes(kind);
    const kick = Math.max(0, this.fireCd) * (d.recoil || 1) * 0.9;
    const ang = a - this.facing * kick * 0.04;
    const [hx2, hy2] = arm(shX, shY, ang, 14);
    if (twoHanded) arm(shX, shY, ang, 19, this.facing * 2);
    else if (kind === 'shield') {
      // Front arm carries the shield.
      const sx = shX + Math.cos(a) * 12, sy = shY + Math.sin(a) * 12 - 2;
      arm(shX, shY, a, 12, -this.facing * 2);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.fillStyle = 'rgba(60,70,90,0.9)';
      ctx.strokeStyle = ink;
      ctx.beginPath();
      const sw = 7 * this.facing;
      ctx.roundRect(-sw / 2 + this.facing * 5, -20, sw, 40, 3);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    } else arm(shX, shY, Math.PI / 2 + this.facing * 0.3, 12, 2);

    ctx.save();
    ctx.translate(hx2, hy2);
    ctx.rotate(ang);
    // Flip the sprite vertically when aiming left so it isn't upside down.
    if (this.facing < 0) ctx.scale(1, -1);
    drawWeapon(ctx, kind, ink);
    ctx.restore();

    // Backpack for flamer / jetpack — glued to the torso, no gap.
    if (kind === 'flamer' || this.jetFuel > 0) {
      const bx = this.facing > 0 ? shX - 8.5 : shX + 0.5;
      ctx.fillStyle = kind === 'flamer' ? '#7a3520' : '#555c68';
      ctx.beginPath();
      ctx.roundRect(bx, shY - 2, 8, 16, 3);
      ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
      // Strap across the chest.
      ctx.beginPath();
      ctx.moveTo(shX + (this.facing > 0 ? -1 : 1), shY);
      ctx.lineTo(shX + this.facing * 4, shY + 6);
      ctx.stroke();
      ctx.lineWidth = 3;
    }
  }
}

// Weapon doodles, drawn pointing +x with the grip at the origin.
export function drawWeapon(ctx, kind, ink = '#16181d') {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const ln = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); };
  switch (kind) {
    case 'knife': ln(0, 0, 10, -2); ctx.lineWidth = 1.6; ln(3, 2, 3, -4); break;
    case 'tomahawk':
      ln(0, 2, 14, -4);
      ctx.beginPath(); ctx.moveTo(14, -9); ctx.quadraticCurveTo(20, -4, 15, 2); ctx.lineTo(12, -6); ctx.closePath(); ctx.fill();
      break;
    case 'pistol': ln(0, 0, 9, 0); ln(1, 0, 0, 5); break;
    case 'deagle': ctx.lineWidth = 3.4; ln(0, -1, 13, -1); ctx.lineWidth = 2.5; ln(1, 0, -1, 6); break;
    case 'shotgun': ctx.lineWidth = 3.2; ln(-6, 0, 18, 0); ctx.lineWidth = 2; ln(4, 2, 10, 2); ln(-6, 0, -9, 4); break;
    case 'm4': ctx.lineWidth = 3; ln(-7, 0, 17, 0); ln(2, 1, 1, 7); ln(-7, 0, -9, 5); ctx.lineWidth = 1.6; ln(6, -2, 10, -2); break;
    case 'ak47':
      ctx.lineWidth = 3; ln(-7, 0, 18, 0); ln(-7, 0, -10, 4);
      ctx.beginPath(); ctx.moveTo(3, 1); ctx.quadraticCurveTo(2, 7, -2, 9); ctx.stroke();
      break;
    case 'shield': ln(0, 0, 9, 0); ln(1, 0, 0, 5); break;
    case 'flamer':
      ctx.lineWidth = 4; ln(-4, 0, 12, 0); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(13.5, 0, 2.2, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'negev': ctx.lineWidth = 4; ln(-8, 0, 19, 0); ctx.lineWidth = 2.5; ctx.strokeRect(-2, 2, 7, 7); ln(-8, 0, -10, 5); break;
    case 'awp':
      ctx.lineWidth = 3; ln(-9, 0, 24, 0); ln(-9, 0, -12, 5);
      ctx.beginPath(); ctx.arc(3, -4, 3, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'bazooka':
      ctx.lineWidth = 7; ctx.strokeStyle = ink; ln(-10, -3, 16, -3);
      ctx.lineWidth = 2; ln(2, 0, 2, 6);
      break;
    case 'grenade':
      ctx.beginPath(); ctx.arc(2, 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5; ln(2, -2, 4, -5);
      break;
    case 'smoke':
      ctx.fillStyle = '#5c6670';
      ctx.fillRect(-1, -4, 6, 9); ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.strokeRect(-1, -4, 6, 9);
      break;
    case 'mine':
      ctx.fillStyle = '#3a3f37';
      ctx.beginPath(); ctx.ellipse(2, 2, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
      break;
  }
}
