// The launch: simulation loop, camera, world art, HUD, map view, controls.
import { PHYS, MOON, PAL } from './constants.js';
import { buildSim, ignite, stage, toggleChute, stepSim, orbitInfo,
         currentMass, remainingDv, localG, activeStage, predictTrajectory } from './sim.js';
import { layout, drawRocket } from './rocket.js';
import { clamp, lerp, TAU, fmtDist, fmtSpeed, fmtDv, rng, roundRect } from './util.js';

const WARPS = [1, 2, 5, 20, 100];

export class Flight {
  constructor() {
    this.canvas = $('#flight-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.onFinish = null;
    this.sim = null;
    this.raf = 0;
    this.keys = {};
    this.map = false;
    this.warpIdx = 0;
    this.stars = makeStars(220);
    this.clouds = makeClouds(14);
    this.particles = [];
    this.msgs = [];
    this.turnBtn = 0;      // touch turn state -1/0/1
    this.throttleBtn = 0;  // touch throttle nudge
    this._bind();
  }

  _bind() {
    addEventListener('keydown', e => {
      if ($('#screen-flight').classList.contains('hidden')) return;
      this.keys[e.key.toLowerCase()] = true;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this._stage(); }
      if (k === 'm') this.map = !this.map;
      if (k === 't') { if (this.sim) this.sim.sas = !this.sim.sas; }
      if (k === 'x') { if (this.sim) this.sim.throttle = 0; }
      if (k === 'z') { if (this.sim) this.sim.throttle = 1; }
      if (k === '.') this.warpIdx = Math.min(WARPS.length - 1, this.warpIdx + 1);
      if (k === ',') this.warpIdx = Math.max(0, this.warpIdx - 1);
    });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });

    // touch / click controls
    hold('#c-left',  () => this.turnBtn = -1, () => this.turnBtn = 0);
    hold('#c-right', () => this.turnBtn = 1,  () => this.turnBtn = 0);
    hold('#c-up',    () => this.throttleBtn = 1,  () => this.throttleBtn = 0);
    hold('#c-down',  () => this.throttleBtn = -1, () => this.throttleBtn = 0);
    $('#c-stage').addEventListener('click', () => this._stage());
    $('#c-map').addEventListener('click', () => this.map = !this.map);
    $('#c-warp').addEventListener('click', () => this.warpIdx = (this.warpIdx + 1) % WARPS.length);
    $('#c-sas').addEventListener('click', () => { if (this.sim) this.sim.sas = !this.sim.sas; });
    $('#flight-abort').addEventListener('click', () => this._finish(true));
    $('#flight-recover').addEventListener('click', () => this._finish(true));
  }

  start(design) {
    this.design = design;
    this.sim = buildSim(design);
    this.rocketH = layout(design).H;
    ignite(this.sim);
    this.map = false; this.warpIdx = 0; this.particles = []; this.msgs = [];
    this.cam = { x: this.sim.pos.x, y: this.sim.pos.y, ppm: 4 };
    this._reached = { space: false, orbit: false, moon: false };
    this._finished = false; this._landed = false;
    this._pushMsg('Lift-off! 🚀', 2.2);
    $('#flight-recover').classList.add('hidden');
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    const frame = now => {
      this._tick(now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  _stage() {
    if (!this.sim || this.sim.done) return;
    const r = stage(this.sim);
    if (r === -2) this._pushMsg('Parachute armed 🪂', 1.6);
    else if (r >= 0) { this._pushMsg('Stage ' + (r + 1) + ' separated', 1.6); this._sepPuff(); }
  }

  _tick(now) {
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const sim = this.sim;

    // controls
    let turn = 0;
    if (this.keys['arrowleft'] || this.keys['a']) turn -= 1;
    if (this.keys['arrowright'] || this.keys['d']) turn += 1;
    turn += this.turnBtn;
    turn = clamp(turn, -1, 1);
    if (!sim.done) {
      if (this.keys['shift']) sim.throttle = clamp(sim.throttle + realDt * 0.8, 0, 1);
      if (this.keys['control']) sim.throttle = clamp(sim.throttle - realDt * 0.8, 0, 1);
      if (this.throttleBtn) sim.throttle = clamp(sim.throttle + this.throttleBtn * realDt * 0.9, 0, 1);
    }

    // time warp (only when not thrusting hard in atmosphere)
    let warp = WARPS[this.warpIdx];
    const oiPre = orbitInfo(sim);
    if (sim.engineOn && sim.throttle > 0.02 && activeStage(sim)?.fuel > 0) warp = 1; // no warp under power
    if (oiPre.alt < PHYS.atmoTop && warp > 5) warp = 5;                                // gentle in atmosphere
    this.effWarp = warp;

    if (!sim.done) stepSim(sim, realDt * warp, { turn });

    // exhaust particles
    if (!sim.done && sim.engineOn && sim.throttle > 0.05 && activeStage(sim)?.fuel > 0 && warp <= 2) {
      this._exhaust(sim);
    }
    this._updateParticles(realDt * Math.min(warp, 2));
    this._drainEvents();
    this._milestones();

    // camera follow (smooth)
    const oi = orbitInfo(sim);
    if (this.map) this._camMap(oi);
    else this._camFlight(oi, realDt);

    this._render(oi, now / 1000);
    this._hud(oi);

    if (sim.done && !this._landed) { this._landed = true; this._onLanded(); }
  }

  _milestones() {
    const s = this.sim;
    if (s.reached.space && !this._reached.space) { this._reached.space = true; this._pushMsg('Welcome to space! ✨', 2.6); }
    if (s.reached.orbit && !this._reached.orbit) { this._reached.orbit = true; this._pushMsg('ORBIT ACHIEVED! 🛰️', 3.2); }
    if (s.reached.moon && !this._reached.moon) { this._reached.moon = true; this._pushMsg('On the way to the Moon! 🌙', 3.2); }
  }

  _onLanded() {
    const s = this.sim;
    if (s.recovered) this._pushMsg('Safe landing 🪂', 3);
    else { this._pushMsg('Crash! 💥', 3); this._boom(); }
    $('#flight-recover').classList.remove('hidden');
    // small delay then finish
    clearTimeout(this._endT);
    this._endT = setTimeout(() => this._finish(false), s.recovered ? 1400 : 1600);
  }

  _finish(manual) {
    if (this._finished) return;
    this._finished = true;
    this.stop();
    const s = this.sim;
    const oi = orbitInfo(s);
    const flight = {
      maxAlt: s.maxAlt,
      space: s.reached.space,
      orbit: s.reached.orbit,
      moon: s.reached.moon,
      crew: s.crew,
      recovered: s.recovered || (manual && oi.alt < 1),
      crashed: s.crashed,
      maxSpeed: s.maxSpeed,
    };
    this.onFinish && this.onFinish(flight);
  }

  // ---------------- camera ----------------
  _camFlight(oi, dt) {
    const rocketH = this.rocketH;
    const view = clamp(rocketH * 6 + oi.alt * 0.10 + oi.v * 0.5, rocketH * 6, 3200);
    const ch = this.canvas.clientHeight || 600;
    let ppm = (ch * 0.66) / view;
    ppm = clamp(ppm, 0.05, 16);
    const k = 1 - Math.pow(0.001, dt);
    this.cam.x = lerp(this.cam.x, this.sim.pos.x, k);
    this.cam.y = lerp(this.cam.y, this.sim.pos.y, k);
    this.cam.ppm = lerp(this.cam.ppm, ppm, k);
  }

  _camMap(oi) {
    const cw = this.canvas.clientWidth || 800, ch = this.canvas.clientHeight || 600;
    const r = Math.hypot(this.sim.pos.x, this.sim.pos.y);
    const showR = Math.max(r, PHYS.R * 1.25, isFinite(oi.ap) ? oi.ap + PHYS.R : r);
    const ppm = (Math.min(cw, ch) * 0.42) / showR;
    this.cam.ppm = ppm;
    this.cam.x = 0; this.cam.y = 0;   // centre on planet
  }

  _w2s(wx, wy) {
    const cw = this.canvas.clientWidth || 800, ch = this.canvas.clientHeight || 600;
    return [cw / 2 + (wx - this.cam.x) * this.cam.ppm,
            ch / 2 - (wy - this.cam.y) * this.cam.ppm];
  }

  // ---------------- rendering ----------------
  _render(oi, t) {
    const ctx = this.ctx;
    const dpr = devicePixelRatio || 1;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (this.canvas.width !== cw * dpr) this.canvas.width = cw * dpr;
    if (this.canvas.height !== ch * dpr) this.canvas.height = ch * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    if (this.map) { this._renderMap(oi, cw, ch); this._renderAttitude(oi, cw, ch); return; }

    this._renderSky(oi, cw, ch, t);
    this._renderGround(oi, cw, ch);
    this._renderParticles(ctx);
    this._renderRocket(t);
    this._renderAttitude(oi, cw, ch);
  }

  _renderSky(oi, cw, ch, t) {
    const ctx = this.ctx;
    const f = clamp(oi.alt / 90000, 0, 1);      // 0 ground -> 1 space
    const top = mix(PAL.skyMid, PAL.space, clamp(f * 1.3, 0, 1));
    const bot = mix(PAL.skyLow, PAL.spaceDeep, f);
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);

    // sun (upper-left, gentle)
    const sunA = 1;
    ctx.save();
    ctx.globalAlpha = sunA;
    const sg = ctx.createRadialGradient(cw * 0.16, ch * 0.2, 6, cw * 0.16, ch * 0.2, 90);
    sg.addColorStop(0, '#fff7cf'); sg.addColorStop(0.4, 'rgba(255,225,150,0.7)'); sg.addColorStop(1, 'rgba(255,225,150,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cw * 0.16, ch * 0.2, 90, 0, TAU); ctx.fill();
    ctx.restore();

    // stars fade in with altitude
    const starA = clamp((oi.alt - 12000) / 30000, 0, 1);
    if (starA > 0) {
      ctx.save();
      for (const s of this.stars) {
        const tw = 0.6 + 0.4 * Math.sin(t * 2 + s.p);
        ctx.globalAlpha = starA * s.b * tw;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(s.x * cw, s.y * ch, s.s, s.s);
      }
      ctx.restore();
    }

    // clouds (low altitude, parallax with camera)
    const cloudA = clamp(1 - oi.alt / 9000, 0, 1);
    if (cloudA > 0) {
      ctx.save();
      ctx.globalAlpha = cloudA;
      for (const c of this.clouds) {
        const px = mod(c.x * cw - this.cam.x * this.cam.ppm * c.par * 0.02, cw + 300) - 150;
        const py = c.y * ch * 0.8 + this.cam.ppm * (this.sim.pos.y - PHYS.R) * 0.0; // stay in sky band
        drawCloud(ctx, px, c.y * ch * 0.7, c.s * (1 + cloudA), cloudA);
      }
      ctx.restore();
    }
  }

  _renderGround(oi, cw, ch) {
    const ctx = this.ctx;
    // world point on the surface directly "below" the rocket
    const r = Math.hypot(this.sim.pos.x, this.sim.pos.y) || 1;
    const surfY = this._w2s(this.sim.pos.x * PHYS.R / r, this.sim.pos.y * PHYS.R / r)[1];
    if (surfY > ch + 40) return;         // ground below screen — we're high up
    // green ground fill (curvature is negligible at this scale, draw as band)
    const gg = ctx.createLinearGradient(0, surfY, 0, ch);
    gg.addColorStop(0, PAL.ground); gg.addColorStop(1, PAL.groundDark);
    ctx.fillStyle = gg;
    ctx.fillRect(0, surfY, cw, ch - surfY + 2);
    // grass rim
    ctx.fillStyle = '#9ee7a8';
    ctx.fillRect(0, surfY, cw, Math.max(2, this.cam.ppm * 0.6));
    // launch pad + gantry near world (0,R)
    const [px, py] = this._w2s(0, PHYS.R);
    const ppm = this.cam.ppm;
    if (px > -80 && px < cw + 80 && ppm > 0.6) {
      ctx.fillStyle = PAL.pad;
      ctx.fillRect(px - 3.2 * ppm, py - 0.4 * ppm, 6.4 * ppm, 1.2 * ppm);
      ctx.strokeStyle = '#8a94a3'; ctx.lineWidth = Math.max(1, ppm * 0.12);
      ctx.beginPath();
      ctx.moveTo(px + 2.6 * ppm, py); ctx.lineTo(px + 2.6 * ppm, py - 6 * ppm);
      ctx.moveTo(px + 2.6 * ppm, py - 6 * ppm); ctx.lineTo(px + 1.2 * ppm, py - 6 * ppm);
      ctx.stroke();
    }
    // a few cute hills in the distance
    if (ppm > 0.35 && ppm < 6) {
      ctx.fillStyle = 'rgba(120,210,150,0.5)';
      for (let i = -2; i <= 6; i++) {
        const hx = ((i * 60) - (this.cam.x * ppm * 0.4) % 60);
        ctx.beginPath();
        ctx.ellipse(mod(hx, cw + 120) - 60, surfY, 60, 22, 0, Math.PI, 0);
        ctx.fill();
      }
    }
  }

  _renderRocket(t) {
    const ctx = this.ctx;
    const sim = this.sim;
    const [sx, sy] = this._w2s(sim.pos.x, sim.pos.y);
    const ppm = this.cam.ppm;
    ctx.save();
    ctx.translate(sx, sy);
    // rotate so local up (-y) points along sim.ang. World angle ang measured from +x, ccw.
    // canvas y is down, so rotate by -(ang - PI/2).
    ctx.rotate(-(sim.ang - Math.PI / 2));
    if (!sim.done || sim.recovered) {
      drawRocket(ctx, this.design, {
        ppm, activeStage: sim.active, flame: sim.engineOn && activeStage(sim)?.fuel > 0,
        throttle: sim.throttle, chuteOpen: sim.chuteOpen, t,
      });
    }
    ctx.restore();
    // when very small, draw a locator ring
    if (ppm < 1.2 && !sim.done) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, 14, 0, TAU); ctx.stroke();
    }
    // messages
    this._renderMsgs();
  }

  // little attitude/navball indicator, bottom-right
  _renderAttitude(oi, cw, ch) {
    const ctx = this.ctx;
    const R = 42, cx = cw - R - 18, cy = ch - R - 18;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = 'rgba(10,14,30,0.75)'; ctx.fill();
    ctx.strokeStyle = 'rgba(180,205,255,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.clip();
    // local up direction (radial out) in screen space
    const upAng = Math.atan2(this.sim.pos.y, this.sim.pos.x);
    // horizon line perpendicular to up
    const horizA = -(upAng); // convert world angle to screen (y flip): screen angle = -world
    ctx.translate(cx, cy);
    // sky/ground split (rotate so 'up' is toward screen up)
    ctx.save();
    ctx.rotate(horizA + Math.PI / 2);
    ctx.fillStyle = 'rgba(120,180,255,0.5)'; ctx.fillRect(-R, -R, 2 * R, R);
    ctx.fillStyle = 'rgba(120,210,150,0.5)'; ctx.fillRect(-R, 0, 2 * R, R);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
    ctx.restore();
    // rocket heading marker (pointing up in this widget = its nose)
    const relAng = -(this.sim.ang) - (horizA); // rocket nose relative to widget frame
    ctx.rotate(-(this.sim.ang - Math.PI / 2)); // align with rocket
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.moveTo(0, -R * 0.6); ctx.lineTo(-5, -R * 0.35); ctx.lineTo(5, -R * 0.35); ctx.closePath(); ctx.fill();
    ctx.restore();
    // prograde marker
    if (oi.v > 5) {
      const pa = -Math.atan2(this.sim.vel.y, this.sim.vel.x); // screen angle
      const mx = cx + Math.cos(pa) * R * 0.62, my = cy + Math.sin(pa) * R * 0.62;
      ctx.strokeStyle = '#8df0a8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 4, 0, TAU); ctx.stroke();
    }
  }

  _renderMap(oi, cw, ch) {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.spaceDeep; ctx.fillRect(0, 0, cw, ch);
    // stars
    for (const s of this.stars) { ctx.globalAlpha = s.b * 0.7; ctx.fillStyle = '#fff'; ctx.fillRect(s.x * cw, s.y * ch, s.s, s.s); }
    ctx.globalAlpha = 1;
    const ppm = this.cam.ppm;
    const [ox, oy] = this._w2s(0, 0);
    // atmosphere ring
    ctx.beginPath(); ctx.arc(ox, oy, (PHYS.R + PHYS.atmoTop) * ppm, 0, TAU);
    ctx.fillStyle = 'rgba(120,190,255,0.10)'; ctx.fill();
    // planet
    ctx.beginPath(); ctx.arc(ox, oy, PHYS.R * ppm, 0, TAU);
    const pg = ctx.createRadialGradient(ox - PHYS.R * ppm * 0.3, oy - PHYS.R * ppm * 0.3, 4, ox, oy, PHYS.R * ppm);
    pg.addColorStop(0, '#8fd3a0'); pg.addColorStop(1, '#3f8f7a');
    ctx.fillStyle = pg; ctx.fill();
    // Kármán ring
    ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ox, oy, (PHYS.R + PHYS.karman) * ppm, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // Moon (if in range of view)
    const moonScreenR = MOON.dist * ppm;
    if (moonScreenR < Math.max(cw, ch) * 1.5) {
      const [mx, my] = this._w2s(MOON.dist * 0.7, MOON.dist * 0.72);
      ctx.beginPath(); ctx.arc(mx, my, Math.max(6, MOON.radius * ppm), 0, TAU);
      ctx.fillStyle = '#d8def0'; ctx.fill();
      // moon distance ring
      ctx.setLineDash([2, 8]); ctx.strokeStyle = 'rgba(200,210,240,0.2)';
      ctx.beginPath(); ctx.arc(ox, oy, MOON.dist * ppm, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    // predicted trajectory
    const pts = predictTrajectory(this.sim, 700);
    if (pts.length > 1) {
      ctx.strokeStyle = oi.bound ? '#8fd3ff' : '#ffb3d9';
      ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = this._w2s(pts[i].x, pts[i].y);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // Ap / Pe markers
    if (isFinite(oi.ap) && oi.bound) this._apsis(ox, oy, ppm, oi.eAng, PHYS.R + oi.ap, '#8df0a8', 'Ap ' + fmtDist(oi.ap));
    if (oi.bound && oi.pe > -PHYS.R) this._apsis(ox, oy, ppm, oi.eAng + Math.PI, PHYS.R + Math.max(oi.pe, -PHYS.R + 1), '#ffd479', 'Pe ' + fmtDist(oi.pe));
    // rocket
    const [rx, ry] = this._w2s(this.sim.pos.x, this.sim.pos.y);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(rx, ry, 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2;
    const pa = -Math.atan2(this.sim.vel.y, this.sim.vel.x);
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(pa) * 14, ry + Math.sin(pa) * 14); ctx.stroke();

    ctx.fillStyle = 'rgba(220,232,255,0.85)'; ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('MAP — press M to return', 14, 22);
    this._renderMsgs();
  }

  _apsis(ox, oy, ppm, ang, rWorld, col, label) {
    const ctx = this.ctx;
    const x = ox + Math.cos(ang) * rWorld * ppm;
    const y = oy - Math.sin(ang) * rWorld * ppm;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(label, x + 7, y + 4);
  }

  // ---------------- particles ----------------
  _exhaust(sim) {
    const lo = layout(this.design);
    // spawn from behind the rocket along -ang
    const back = { x: -Math.cos(sim.ang), y: -Math.sin(sim.ang) };
    const baseX = sim.pos.x + back.x * this.rocketH * 0.5;
    const baseY = sim.pos.y + back.y * this.rocketH * 0.5;
    for (let i = 0; i < 2; i++) {
      const spread = (Math.random() - 0.5) * 0.4;
      this.particles.push({
        x: baseX, y: baseY,
        vx: back.x * 40 + (Math.random() - 0.5) * 20 - sim.vel.x * 0.0,
        vy: back.y * 40 + (Math.random() - 0.5) * 20,
        life: 0.5 + Math.random() * 0.4, age: 0,
        r: this.rocketH * 0.18 * (0.6 + Math.random()), kind: 'smoke',
      });
    }
  }

  _sepPuff() {
    const s = this.sim;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU;
      this.particles.push({ x: s.pos.x, y: s.pos.y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30,
        life: 0.7, age: 0, r: this.rocketH * 0.12, kind: 'smoke' });
    }
  }

  _boom() {
    const s = this.sim;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU, sp = 40 + Math.random() * 120;
      this.particles.push({ x: s.pos.x, y: s.pos.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.9 + Math.random() * 0.6, age: 0, r: this.rocketH * 0.3 * Math.random(), kind: 'fire' });
    }
  }

  _updateParticles(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
    }
    if (ps.length > 400) ps.splice(0, ps.length - 400);
  }

  _renderParticles(ctx) {
    for (const p of this.particles) {
      const [x, y] = this._w2s(p.x, p.y);
      const k = 1 - p.age / p.life;
      const rr = p.r * this.cam.ppm * (1.2 - k * 0.4);
      if (rr < 0.4) continue;
      if (p.kind === 'fire') ctx.fillStyle = `rgba(255,${120 + Math.floor(120 * k)},60,${k * 0.9})`;
      else ctx.fillStyle = `rgba(230,235,245,${k * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
    }
  }

  // ---------------- messages ----------------
  _pushMsg(text, dur) { this.msgs.push({ text, t: dur, max: dur }); }
  _renderMsgs() {
    const ctx = this.ctx;
    const cw = this.canvas.clientWidth;
    let y = 70;
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i];
      m.t -= 1 / 60;
      if (m.t <= 0) { this.msgs.splice(i, 1); continue; }
      const a = clamp(m.t / 0.5, 0, 1) * clamp((m.max - m.t) / 0.2, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0b1026'; ctx.fillText(m.text, cw / 2 + 1, y + 1);
      ctx.fillStyle = '#ffe08a'; ctx.fillText(m.text, cw / 2, y);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
      y += 34;
    }
  }

  _drainEvents() { if (this.sim) this.sim.events.length = 0; }

  // ---------------- HUD (DOM) ----------------
  _hud(oi) {
    const sim = this.sim;
    const g = localG(sim);
    const st = activeStage(sim);
    const thrust = (sim.engineOn && st && st.fuel > 0) ? st.thrust * sim.throttle : 0;
    const twr = thrust / (currentMass(sim) * g);
    set('#h-alt', fmtDist(oi.alt));
    set('#h-speed', fmtSpeed(oi.v));
    set('#h-vspeed', (oi.vr >= 0 ? '+' : '') + fmtSpeed(oi.vr));
    set('#h-ap', oi.bound && isFinite(oi.ap) ? fmtDist(oi.ap) : (oi.alt > PHYS.atmoTop ? 'escape' : '—'));
    set('#h-pe', oi.bound ? fmtDist(oi.pe) : '—');
    set('#h-dv', fmtDv(remainingDv(sim)));
    set('#h-twr', twr > 0 ? twr.toFixed(2) : '—');
    set('#h-throttle', Math.round(sim.throttle * 100) + '%');
    set('#h-warp', '×' + (this.effWarp || 1));
    set('#c-sas', 'SAS ' + (sim.sas ? 'ON' : 'off'));
    const stageLabel = 'Stage ' + (sim.active + 1) + '/' + sim.stages.length;
    set('#h-stage', stageLabel);
    // throttle + fuel bars
    style('#h-throttle-fill', 'height', (sim.throttle * 100) + '%');
    const fuelPct = st && (st.dry + st.fuel) > 0 ? (st.fuel / (st.fuelMax || 1)) * 100 : 0;
    style('#h-fuel-fill', 'width', clamp(fuelPct, 0, 100) + '%');
    // orbit good indicator
    const orbitOk = oi.bound && oi.pe > PHYS.atmoTop;
    $('#h-pe').className = 'v ' + (orbitOk ? 'good' : oi.pe > 0 ? 'warn' : 'bad');
  }
}

// ------------------------------------------------------------------ helpers
const $ = s => document.querySelector(s);
function set(sel, v) { const e = $(sel); if (e) e.textContent = v; }
function style(sel, prop, v) { const e = $(sel); if (e) e.style[prop] = v; }

function hold(sel, on, off) {
  const el = $(sel); if (!el) return;
  const down = e => { e.preventDefault(); on(); };
  const up = e => { e.preventDefault(); off(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
}

function makeStars(n) {
  const r = rng(1337); const a = [];
  for (let i = 0; i < n; i++) a.push({ x: r(), y: r() * 0.85, s: r() < 0.85 ? 1 : 2, b: 0.4 + r() * 0.6, p: r() * TAU });
  return a;
}
function makeClouds(n) {
  const r = rng(99); const a = [];
  for (let i = 0; i < n; i++) a.push({ x: r(), y: 0.1 + r() * 0.5, s: 30 + r() * 60, par: 0.3 + r() });
  return a;
}
function drawCloud(ctx, x, y, s, a) {
  ctx.fillStyle = `rgba(255,255,255,${0.85 * a})`;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.5, 0, TAU);
  ctx.arc(x + s * 0.4, y + 4, s * 0.4, 0, TAU);
  ctx.arc(x - s * 0.4, y + 5, s * 0.38, 0, TAU);
  ctx.arc(x + s * 0.1, y - s * 0.18, s * 0.34, 0, TAU);
  ctx.fill();
}

function mod(a, n) { return ((a % n) + n) % n; }

// mix two hex colors
function mix(c1, c2, t) {
  const a = hex(c1), b = hex(c2);
  const r = Math.round(lerp(a[0], b[0], t)), g = Math.round(lerp(a[1], b[1], t)), bl = Math.round(lerp(a[2], b[2], t));
  return `rgb(${r},${g},${bl})`;
}
function hex(c) {
  c = c.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
