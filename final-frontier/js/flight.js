// Final Frontier — flight scene: world rendering, HUD, map, controls, report.

import * as store from './save.js';
import { PLANET, MOON, tierForXP, MILESTONES, flightXP, fmtDist, fmtSpeed, fmtTime, G0 } from './constants.js';
import { PART_BY_ID } from './parts.js';
import { Sim, WARP_LEVELS, moonPos } from './sim.js';
import { drawRocket, drawFlame, drawChuteCanopy, drawPad, drawCloud, stackHeight, shade } from './art.js';
import { enterBuilder, openModal, closeModal, tierBannerHTML } from './main.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

let sim = null;
let flownIds = null;
let canvas, ctx, raf = 0, lastMs = 0;
let launchTier = 0;
let mapMode = false, paused = false, reportShown = false, deadAt = 0;
let camZoom = 1, mapZoom = 1, viewSmooth = 0, shake = 0;
let pumpMode = false, pumpPressure = 0, pumpAnim = 0;
let clouds = [], stars = [], particles = [], debris = [];
let inputsBound = false;
const keys = {};

// ---------- colors ----------
const SKY_STOPS = [
  [0, [168, 218, 245]], [6000, [142, 196, 238]], [15000, [95, 146, 211]],
  [28000, [51, 81, 143]], [40000, [26, 40, 84]], [55000, [11, 16, 38]],
];
function skyColor(alt) {
  alt = Math.max(0, alt);
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const [a0, c0] = SKY_STOPS[i], [a1, c1] = SKY_STOPS[i + 1];
    if (alt <= a1) {
      const t = (alt - a0) / (a1 - a0);
      return c0.map((c, k) => Math.round(lerp(c, c1[k], t)));
    }
  }
  return SKY_STOPS[SKY_STOPS.length - 1][1];
}
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------- start / end ----------
export function startFlight(partIds) {
  flownIds = [...partIds];
  sim = new Sim(partIds);
  launchTier = tierForXP(store.load().xp);
  mapMode = false; paused = false; reportShown = false; deadAt = 0;
  camZoom = 1; mapZoom = 1; viewSmooth = 0; shake = 0;
  particles = []; debris = [];

  canvas = $('#flightCanvas');
  ctx = canvas.getContext('2d');

  // clouds around the launch site (deterministic-ish per flight)
  clouds = [];
  for (let i = 0; i < 26; i++) {
    clouds.push({
      ang: Math.PI / 2 + (Math.random() - 0.5) * (60000 / PLANET.R),
      alt: 600 + Math.random() * 7500,
      size: 25 + Math.random() * 70,
      tone: 0.75 + Math.random() * 0.25,
    });
  }
  stars = [];
  for (let i = 0; i < 240; i++) stars.push([Math.random(), Math.random(), 0.4 + Math.random() * 1.4]);

  bindInputs();
  pumpMode = sim.stages[0].parts.some(x => x.p.engine?.water);
  pumpPressure = 0; pumpAnim = 0;
  $('#pumpGame').classList.toggle('hidden', !pumpMode);
  if (pumpMode) updatePumpUI();
  const hasG = sim.hasGuidance;
  for (const el of document.querySelectorAll('.inst.orbital')) el.classList.toggle('locked', !hasG);
  $('#mapBtn').style.opacity = hasG ? 1 : 0.35;
  $('#sasBtn').style.opacity = hasG ? 1 : 0.35;
  toast(pumpMode ? 'Pump it up! Spam SPACE 🚴' : hasG ? 'Press SPACE to ignite 🔥' : 'Press SPACE to launch! (no avionics: instruments are basic)');

  cancelAnimationFrame(raf);
  lastMs = performance.now();
  raf = requestAnimationFrame(loop);

  // debug hook (used by the headless preview harness)
  window.__ff = {
    sim: () => sim,
    ff: (t) => { const n = Math.ceil(t / 0.1); for (let i = 0; i < n && !sim.dead; i++) sim.update(0.1); },
  };
}

function endToWorkshop() {
  cancelAnimationFrame(raf);
  raf = 0;
  closeModal();
  enterBuilder();
}

// ---------- inputs ----------
function bindInputs() {
  if (inputsBound) return;
  inputsBound = true;

  window.addEventListener('keydown', (e) => {
    if (!raf || paused && e.key !== 'Escape') { if (e.key === 'Escape' && raf) {} else if (!raf) return; }
    if ($('#flight').classList.contains('hidden')) return;
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
    if (e.repeat) { keys[k] = true; return; }
    keys[k] = true;
    if (k === ' ') { if (pumpMode) pumpStroke(); else sim.doStage(); }
    else if (k === 'Enter') { if (pumpMode) pumpRelease(); }
    else if (k === 'p' || k === 'P') sim.doChute();
    else if (k === 't' || k === 'T') { sim.toggleSas(); }
    else if (k === 'm' || k === 'M') { if (sim.hasGuidance) mapMode = !mapMode; else toast('No avionics — no map 🛰🔒'); }
    else if (k === ',') sim.setWarp(sim.warpIdx - 1);
    else if (k === '.') sim.setWarp(sim.warpIdx + 1);
    else if (k === 'z' || k === 'Z') sim.setThrottle(1);
    else if (k === 'x' || k === 'X') sim.setThrottle(0);
    else if (k === 'Escape') togglePause();
  });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0012);
    if (mapMode) mapZoom = clamp(mapZoom * f, 0.15, 40);
    else camZoom = clamp(camZoom / f, 0.3, 800);
  }, { passive: false });

  $('#pumpRelease').onclick = () => pumpRelease();
  $('#mapBtn').onclick = () => { if (sim.hasGuidance) mapMode = !mapMode; };
  $('#sasBtn').onclick = () => sim.toggleSas();
  $('#pauseBtn').onclick = togglePause;

  for (const b of document.querySelectorAll('.tbtn')) {
    const k = b.dataset.k;
    const press = (e) => {
      e.preventDefault();
      if (k === 'left') keys.ArrowLeft = true;
      else if (k === 'right') keys.ArrowRight = true;
      else if (k === 'thrUp') keys.ArrowUp = true;
      else if (k === 'thrDown') keys.ArrowDown = true;
      else if (k === 'stage') { if (pumpMode) pumpStroke(); else sim.doStage(); }
      else if (k === 'chute') sim.doChute();
      else if (k === 'warpUp') sim.setWarp(sim.warpIdx + 1);
      else if (k === 'warpDown') sim.setWarp(sim.warpIdx - 1);
    };
    const release = () => {
      if (k === 'left') keys.ArrowLeft = false;
      else if (k === 'right') keys.ArrowRight = false;
      else if (k === 'thrUp') keys.ArrowUp = false;
      else if (k === 'thrDown') keys.ArrowDown = false;
    };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', release);
  }
}

function togglePause() {
  if (reportShown) return;
  paused = !paused;
  if (paused) {
    openModal(`
      <h2>⏸ Paused</h2>
      <p style="font-size:13.5px;color:var(--ink-soft);margin-top:4px">The rocket politely waits.</p>
      <div class="modal-actions">
        <button class="btn ghost" id="pQuit">End flight</button>
        <button class="btn ghost" id="pRestart">Restart launch</button>
        <button class="btn primary" id="pResume">Resume</button>
      </div>`);
    $('#pResume').onclick = () => { paused = false; closeModal(); };
    $('#pRestart').onclick = () => { closeModal(); startFlight(flownIds); };
    $('#pQuit').onclick = () => { paused = false; closeModal(); showReport('ended'); };
  } else closeModal();
}

// ---------- toasts ----------
function toast(msg, gold = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (gold ? ' gold' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .5s'; el.style.opacity = '0'; }, 2600);
  setTimeout(() => el.remove(), 3200);
}

// ---------- pump minigame (tier-0 water rockets) ----------
function pumpStroke() {
  if (!pumpMode || sim.dead) return;
  pumpPressure = Math.min(pumpPressure + 0.5 * (1 - pumpPressure / 16), 9.8);
  pumpAnim = 1;
  if (pumpPressure > 8.4 && Math.random() < 0.2) {
    pumpMode = false;
    $('#pumpGame').classList.add('hidden');
    sim.pop();
    return;
  }
  updatePumpUI();
}

function pumpRelease() {
  if (!pumpMode || sim.dead || pumpPressure < 1) return;
  sim.setPumpPressure(pumpPressure);
  pumpMode = false;
  $('#pumpGame').classList.add('hidden');
  sim.doStage();
  toast(pumpPressure > 7.5 ? 'Maximum fizz!! 🚀' : pumpPressure > 5 ? 'Nice pressure!' : 'A gentle pop. Pump more next time?');
}

function updatePumpUI() {
  const pct = Math.min(100, pumpPressure / 9.8 * 100);
  $('#pumpFill').style.height = (100 - pct).toFixed(1) + '%';
  $('#pumpBar').classList.toggle('danger', pumpPressure > 8.4);
  $('#pumpLabel').textContent = pumpPressure.toFixed(1) + ' bar' + (pumpPressure > 8.4 ? ' ⚠️' : '');
  $('#pumpHandle').style.transform = `translateY(${((1 - pumpAnim) * 16).toFixed(1)}px)`;
  const rel = $('#pumpRelease');
  rel.disabled = pumpPressure < 1;
  rel.textContent = pumpPressure >= 1 ? 'RELEASE 🚀 (Enter)' : 'pump first…';
}

// ---------- main loop ----------
function loop(ms) {
  raf = requestAnimationFrame(loop);
  const dt = clamp((ms - lastMs) / 1000, 0, 0.1);
  lastMs = ms;
  if (paused) return;

  // continuous inputs
  const rot = (keys.ArrowLeft || keys.a || keys.A ? 1 : 0) - (keys.ArrowRight || keys.d || keys.D ? 1 : 0);
  sim.setRot(rot);
  if (keys.ArrowUp) sim.setThrottle(sim.throttle + dt * 1.1);
  if (keys.ArrowDown) sim.setThrottle(sim.throttle - dt * 1.1);

  if (pumpMode && !sim.dead) {
    pumpPressure = Math.max(0, pumpPressure - dt * 0.1); // slow leak, keep pumping!
    pumpAnim = Math.max(0, pumpAnim - dt * 6);
    updatePumpUI();
  }
  if (!sim.dead) sim.update(dt);

  // events
  for (const e of sim.drainEvents()) {
    const gold = ['space', 'orbit', 'soi', 'land'].includes(e.type);
    toast(e.msg, gold);
    if (e.type === 'launch' || e.type === 'separate') shake = Math.max(shake, 0.5);
    if (e.type === 'crash') shake = 1;
    if (e.type === 'crash') spawnPoof();
  }
  while (sim.debris.length) {
    const d = sim.debris.shift();
    debris.push({ ...d, ang: sim.ang, w: Math.max(...d.parts.map(p => p.w)), age: 0 });
  }

  updateHUD();
  render(dt, ms / 1000);

  if (sim.dead && !reportShown) {
    if (!deadAt) deadAt = ms;
    else if (ms - deadAt > 1500) showReport(sim.deadReason);
  }
}

// ---------- HUD ----------
function updateHUD() {
  const alt = sim.alt();
  const v = sim.speed();
  const r = Math.hypot(sim.pos.x, sim.pos.y);
  const vr = (sim.pos.x * sim.vel.x + sim.pos.y * sim.vel.y) / r;
  $('#iAlt').textContent = fmtDist(alt) + (sim.primary === 'moon' ? ' ☾' : '');
  $('#iSpd').textContent = fmtSpeed(v);
  $('#iVspd').textContent = (vr >= 0 ? '▲ ' : '▼ ') + fmtSpeed(Math.abs(vr));
  if (sim.hasGuidance) {
    const o = sim.orbit();
    $('#iAp').textContent = o ? (o.e >= 1 ? 'escape ∞' : fmtDist(o.apAlt)) : '—';
    $('#iPe').textContent = o ? fmtDist(o.peAlt) : '—';
    const st = sim.stages[sim.activeStage];
    const eng = st.parts.filter(x => x.p.engine);
    if (eng.length) {
      const isp = eng.reduce((s, x) => s + x.p.engine.isp, 0) / eng.length;
      const prop = sim.stageProp();
      const dv = prop > 0 ? isp * G0 * Math.log(sim.mass / (sim.mass - prop)) : 0;
      $('#iDv').textContent = `${dv.toFixed(0)} m/s`;
    } else $('#iDv').textContent = '—';
  }
  $('#met').textContent = `T+ ${fmtTime(sim.t)}`;
  $('#warpLabel').textContent = `×${sim.warp()}`;
  $('#thrFill').style.height = `${(sim.throttle * 100).toFixed(0)}%`;
  const pf = sim.stagePropFull();
  $('#fuelFill').style.height = `${(pf > 0 ? sim.stageProp() / pf * 100 : 0).toFixed(1)}%`;
  $('#sasBtn').classList.toggle('on', sim.sas);
  $('#mapBtn').classList.toggle('on', mapMode);

  let status;
  if (sim.dead) status = sim.deadReason === 'crashed' ? '💥 flight over' : '🏁 flight over';
  else if (pumpMode) status = '<span class="next">SPACE: pump · ENTER: release</span>';
  else if (sim.landed) status = '<span class="next">SPACE: ignite &amp; launch</span>';
  else if (sim.lit && sim.curThrust > 0) status = '🔥 burning';
  else if (sim.lit) status = '<span class="next">engine idle — ↑ throttle</span>';
  else if (sim.stageProp() <= 0 && sim.activeStage < sim.stages.length - 1) status = '<span class="next">SPACE: separate + ignite</span>';
  else if (sim.chuteState === 'stowed') status = '<span class="next">P: parachute</span>';
  else status = 'coasting';
  $('#stageInfo').innerHTML =
    `Stage ${Math.min(sim.activeStage + 1, sim.stages.length)}/${sim.stages.length}` +
    (sim.chuteState === 'open' ? ' · 🪂' : sim.chuteState === 'ripped' ? ' · 🪂✂️' : '') +
    `<br>${status}`;
}

// ---------- world rendering ----------
function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W: w, H: h };
}

function render(dt, tSec) {
  const { W, H } = sizeCanvas();
  if (mapMode) { renderMap(W, H, tSec); return; }

  const wp = sim.worldPos();
  const alt = Math.max(0, sim.primary === 'planet' ? sim.alt() : Math.hypot(wp.x, wp.y) - PLANET.R);
  const localAlt = Math.max(0, sim.alt()); // above current primary
  const rocketH = Math.max(sim.height, 0.3);

  // camera zoom (meters of view height), smoothed — stays close to the rocket;
  // scroll to zoom out manually (up to planet scale)
  const autoView = clamp(Math.max(rocketH * 8, localAlt * 0.5), rocketH * 8, rocketH * 55);
  const targetView = clamp(autoView * camZoom, 2, 6e6);
  viewSmooth = viewSmooth ? lerp(viewSmooth, targetView, 1 - Math.exp(-dt * 3)) : targetView;
  const ppm = H / viewSmooth;

  // camera position: keep ground in frame near the surface
  const primC = sim.primary === 'planet' ? { x: 0, y: 0 } : moonPos(sim.t);
  const primR = sim.primary === 'planet' ? PLANET.R : MOON.R;
  const upAng = Math.atan2(wp.y - primC.y, wp.x - primC.x);
  const camAlt = Math.max(localAlt, viewSmooth * 0.26);
  const camR = primR + camAlt;
  const cam = { x: primC.x + Math.cos(upAng) * camR, y: primC.y + Math.sin(upAng) * camR };
  const beta = -(upAng - Math.PI / 2);
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const shx = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;
  const shy = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;
  shake = Math.max(0, shake - dt * 1.4);
  const w2s = (x, y) => {
    const dx = x - cam.x, dy = y - cam.y;
    return { x: W / 2 + ppm * (cb * dx - sb * dy) + shx, y: H * 0.5 + ppm * (-sb * dx - cb * dy) + shy };
  };
  const dirRot = (ax, ay) => { // screen rotation for a world-frame "up" unit vector
    const sx = cb * ax - sb * ay, sy = -sb * ax - cb * ay;
    return Math.atan2(sx, -sy);
  };

  // --- sky ---
  const cTop = skyColor(alt + viewSmooth * 0.45), cBot = skyColor(Math.max(0, alt - viewSmooth * 0.45));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgb(cTop)); g.addColorStop(1, rgb(cBot));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // stars
  const starA = clamp((alt - 22000) / 30000, 0, 1);
  if (starA > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.9 * starA})`;
    for (const [sx, sy, ss] of stars) {
      ctx.fillRect(sx * W, sy * H, ss, ss);
    }
  }

  // sun (low altitude decoration)
  if (alt < 30000) {
    const sunA = clamp(1 - alt / 30000, 0, 1);
    ctx.globalAlpha = sunA;
    ctx.fillStyle = '#ffe28a';
    ctx.beginPath(); ctx.arc(W - 90, 90, 34, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // --- planet & moon (far view) ---
  drawWorldBodies(w2s, ppm, tSec, alt);

  // --- terrain (near view of current primary) ---
  drawTerrain(w2s, ppm, primC, primR, upAng, W, H);

  // pad
  if (sim.primary === 'planet' && ppm > 0.35) {
    const padPos = w2s(0, PLANET.R);
    if (padPos.x > -600 && padPos.x < W + 600 && padPos.y > -600 && padPos.y < H + 600) {
      ctx.save();
      ctx.translate(padPos.x, padPos.y);
      ctx.rotate(dirRot(0, 1));
      drawPad(ctx, launchTier, ppm, tSec);
      ctx.restore();
    }
  }

  // clouds
  if (sim.primary === 'planet' && alt < 26000 && ppm > 0.02) {
    for (const c of clouds) {
      const cr = PLANET.R + c.alt;
      const p = w2s(Math.cos(c.ang) * cr, Math.sin(c.ang) * cr);
      const s = c.size * ppm;
      if (s < 2 || p.x < -200 || p.x > W + 200 || p.y < -200 || p.y > H + 200) continue;
      ctx.save(); ctx.translate(p.x, p.y);
      drawCloud(ctx, s, 0.85 * c.tone);
      ctx.restore();
    }
  }

  // particles & debris
  stepParticles(dt, w2s, ppm);
  stepDebris(dt, w2s, ppm);

  // --- rocket ---
  const rp = w2s(wp.x, wp.y);
  const ax = -Math.sin(sim.ang), ay = Math.cos(sim.ang);
  const rot = dirRot(ax, ay);
  const hPx = rocketH * ppm;
  if (hPx >= 7) {
    ctx.save();
    ctx.translate(rp.x, rp.y);
    ctx.rotate(rot);
    // flames (core + side boosters)
    const lstack = sim.liveStack();
    if (sim.lit && sim.curThrust > 0 && sim.stageProp() > 0) {
      const stageParts = sim.stages[sim.activeStage].parts;
      const core = stageParts.filter(x => !x.radial);
      const coreEng = core.find(x => x.p.engine)?.p ?? sim.activeEngines()[0]?.p;
      const kind = coreEng?.engine.water ? 'water' : coreEng?.art.style === 'nuclear' ? 'nuclear' : coreEng?.engine.prop ? 'solid' : 'liquid';
      const thrFrac = coreEng?.engine.throttle ? sim.throttle : 1;
      if (coreEng && (!coreEng.engine.throttle || sim.throttle > 0)) {
        ctx.save();
        drawFlame(ctx, kind, Math.max(4, (core.at(-1)?.p.w ?? 0.2) * ppm * 0.5), hPx * (0.35 + 0.55 * thrFrac), tSec);
        ctx.restore();
      }
      // side boosters burn at full chat until dry
      const coreHalfPx = ((core.filter(x => x.p.type !== 'fins').at(-1)?.p.w ?? 0.2) / 2) * ppm;
      for (const x of stageParts) {
        if (!x.radial || !x.p.engine || x.prop <= 0) continue;
        const offX = coreHalfPx + x.p.w * ppm * 0.52 + Math.max(1, ppm * 0.04);
        for (const sgn of [-1, 1]) {
          ctx.save();
          ctx.translate(sgn * offX, 0);
          drawFlame(ctx, 'solid', Math.max(3, x.p.w * ppm * 0.45), x.p.h * ppm * (1.1 + 0.3 * Math.sin(tSec * 9 + sgn)), tSec + sgn);
          ctx.restore();
        }
      }
    }
    drawRocket(ctx, lstack, ppm, {});
    if (sim.chuteState === 'open') {
      const ch = sim.chutes[0]?.p;
      ctx.save();
      ctx.translate(0, -hPx);
      drawChuteCanopy(ctx, Math.max(hPx * 0.4, 14), sim.chuteFrac, ch?.art.body ?? '#ffd166', ch?.art.accent ?? '#e07a5f');
      ctx.restore();
    }
    ctx.restore();
  } else {
    // tiny marker
    ctx.save();
    ctx.translate(rp.x, rp.y);
    ctx.rotate(rot);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
    ctx.fill();
    if (sim.lit && sim.curThrust > 0 && sim.stageProp() > 0) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(0, 8, 2.5, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  // space line indicator
  if (sim.primary === 'planet' && Math.abs(alt - PLANET.spaceLine) < viewSmooth * 0.6) {
    const p1 = w2s(Math.cos(upAng - 0.5) * (PLANET.R + PLANET.spaceLine), Math.sin(upAng - 0.5) * (PLANET.R + PLANET.spaceLine));
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.setLineDash([14, 18]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // approximate as horizontal line at that altitude
    const yLine = H * 0.5 + (localAlt - PLANET.spaceLine) * ppm;
    ctx.moveTo(0, yLine); ctx.lineTo(W, yLine);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = '11px "Arial Rounded MT Bold", sans-serif';
    ctx.fillText('· · ✦ SPACE ✦ · ·', W / 2 - 40, yLine - 6);
  }

  drawCompass(W, H);
}

// ---------- compass / navball ----------
// 0° = locally straight up; positive = downrange (east, screen-left).
function drawCompass(W, H) {
  const r = 46;
  const cx = W / 2, cy = H - r - 64;
  const um = Math.hypot(sim.pos.x, sim.pos.y) || 1;
  const ux = sim.pos.x / um, uy = sim.pos.y / um;
  const angOf = (dx, dy) => Math.atan2(ux * dy - uy * dx, ux * dx + uy * dy);
  const pitch = angOf(-Math.sin(sim.ang), Math.cos(sim.ang));
  const place = (a, rad) => ({ x: -Math.sin(a) * rad, y: -Math.cos(a) * rad });

  ctx.save();
  ctx.translate(cx, cy);
  // dial background: sky above the local horizon, ground below
  ctx.fillStyle = 'rgba(15,20,40,.55)';
  ctx.beginPath(); ctx.arc(0, 0, r + 13, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0); // upper half
  ctx.fillStyle = 'rgba(140,196,238,.35)'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI);
  ctx.fillStyle = 'rgba(123,196,127,.3)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke(); // horizon

  // ticks every 30°
  for (let d = 0; d < 360; d += 30) {
    const a = d * Math.PI / 180;
    const p1 = place(a, r - (d % 90 === 0 ? 7 : 4)), p2 = place(a, r);
    ctx.strokeStyle = d % 90 === 0 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  // "up" caret
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.beginPath(); ctx.moveTo(0, -r - 9); ctx.lineTo(-4, -r - 2); ctx.lineTo(4, -r - 2); ctx.closePath(); ctx.fill();

  const v = sim.speed();
  if (v > 1) {
    const pg = angOf(sim.vel.x / v, sim.vel.y / v);
    // prograde: green circled dot
    const pp = place(pg, r - 13);
    ctx.strokeStyle = '#7ce38b'; ctx.fillStyle = '#7ce38b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 5.5, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 1.6, 0, 7); ctx.fill();
    // retrograde: hollow orange x-circle
    const pr = place(pg + Math.PI, r - 13);
    ctx.strokeStyle = '#ffab70'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(pr.x, pr.y, 5, 0, 7); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pr.x - 3.2, pr.y - 3.2); ctx.lineTo(pr.x + 3.2, pr.y + 3.2);
    ctx.moveTo(pr.x + 3.2, pr.y - 3.2); ctx.lineTo(pr.x - 3.2, pr.y + 3.2);
    ctx.stroke();
  }
  // SAS hold marker
  if (sim.holdTarget != null) {
    const ph = place(angOf(-Math.sin(sim.holdTarget), Math.cos(sim.holdTarget)), r - 5);
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(ph.x * 0.88, ph.y * 0.88); ctx.lineTo(ph.x * 1.08, ph.y * 1.08); ctx.stroke();
  }
  // attitude needle (little rocket)
  ctx.rotate(-pitch);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -r + 16); ctx.lineTo(5.5, -r + 32); ctx.lineTo(0, -r + 28); ctx.lineTo(-5.5, -r + 32);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, -r + 30); ctx.lineTo(0, 0); ctx.stroke();
  ctx.rotate(pitch);
  // numeric pitch
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = '11px "Arial Rounded MT Bold", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.abs(pitch * 180 / Math.PI).toFixed(0)}°${Math.abs(pitch) > 0.02 ? (pitch > 0 ? ' →' : ' ←') : ''}`, 0, 4);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawWorldBodies(w2s, ppm, tSec, alt) {
  // planet as a disc when far enough
  const pR = PLANET.R * ppm;
  const pC = w2s(0, 0);
  if (pR < Math.max(canvas.clientWidth, canvas.clientHeight) * 3) {
    // atmosphere glow
    const glowR = (PLANET.R + PLANET.atmoTop * 1.8) * ppm;
    const grad = ctx.createRadialGradient(pC.x, pC.y, pR, pC.x, pC.y, glowR);
    grad.addColorStop(0, 'rgba(140,196,238,.5)');
    grad.addColorStop(1, 'rgba(140,196,238,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(pC.x, pC.y, glowR, 0, 7); ctx.fill();
    // body
    ctx.fillStyle = '#5fb2dd';
    ctx.beginPath(); ctx.arc(pC.x, pC.y, pR, 0, 7); ctx.fill();
    // cute continents (fixed pseudo-random blobs)
    ctx.save();
    ctx.beginPath(); ctx.arc(pC.x, pC.y, pR, 0, 7); ctx.clip();
    ctx.fillStyle = '#7bc47f';
    const blobs = [[0.3, 0.55, 0.35], [1.7, 0.7, 0.28], [2.9, 0.4, 0.3], [4.2, 0.75, 0.33], [5.3, 0.5, 0.24]];
    for (const [a, rr, s] of blobs) {
      const bx = pC.x + Math.cos(a) * pR * rr, by = pC.y + Math.sin(a) * pR * rr;
      ctx.beginPath();
      ctx.ellipse(bx, by, pR * s, pR * s * 0.72, a, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (const [a, rr, s] of [[0.9, 0.8, 0.12], [3.6, 0.6, 0.15], [5.8, 0.85, 0.1]]) {
      ctx.beginPath();
      ctx.ellipse(pC.x + Math.cos(a) * pR * rr, pC.y + Math.sin(a) * pR * rr, pR * s * 1.8, pR * s, a + 1, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }
  // moon
  const mp = moonPos(sim.t);
  const mC = w2s(mp.x, mp.y);
  const mR = Math.max(MOON.R * ppm, alt > 100000 ? 2 : 0);
  if (mR > 0.5 && mC.x > -mR && mC.x < canvas.clientWidth + mR && mC.y > -mR && mC.y < canvas.clientHeight + mR) {
    ctx.fillStyle = '#e8e0c8';
    ctx.beginPath(); ctx.arc(mC.x, mC.y, mR, 0, 7); ctx.fill();
    if (mR > 8) {
      ctx.fillStyle = '#d3c9ab';
      for (const [a, rr, s] of [[0.7, 0.5, 0.18], [2.4, 0.65, 0.13], [4.4, 0.4, 0.2], [5.6, 0.75, 0.1]]) {
        ctx.beginPath();
        ctx.arc(mC.x + Math.cos(a) * mR * rr, mC.y + Math.sin(a) * mR * rr, mR * s, 0, 7);
        ctx.fill();
      }
    }
  }
}

function drawTerrain(w2s, ppm, primC, primR, upAng, W, H) {
  const surfacePx = primR * ppm;
  if (surfacePx < 50) return; // planet already drawn as a disc
  const isMoon = sim.primary === 'moon';
  // sample the surface arc around the rocket
  const halfSpan = clamp((W / ppm) / primR * 1.4 + 0.02, 0.02, Math.PI);
  const N = 60;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = upAng - halfSpan + (2 * halfSpan * i) / N;
    const p = w2s(primC.x + Math.cos(a) * primR, primC.y + Math.sin(a) * primR);
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  }
  // close deep below
  const depth = Math.min(primR, (H / ppm) * 2.5);
  for (let i = N; i >= 0; i--) {
    const a = upAng - halfSpan + (2 * halfSpan * i) / N;
    const p = w2s(primC.x + Math.cos(a) * (primR - depth), primC.y + Math.sin(a) * (primR - depth));
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  if (isMoon) {
    ctx.fillStyle = '#d8cfae';
    ctx.fill();
    ctx.strokeStyle = '#bfb491'; ctx.lineWidth = Math.max(2, 4 * ppm); ctx.stroke();
  } else {
    ctx.fillStyle = ppm > 0.01 ? '#8fce7f' : '#6db788';
    ctx.fill();
    ctx.strokeStyle = '#7bbf6a'; ctx.lineWidth = Math.max(2, 3 * ppm); ctx.stroke();
  }
}

// ---------- particles ----------
function spawnPoof() {
  const wp = sim.worldPos();
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 4 + Math.random() * 14;
    particles.push({
      x: wp.x, y: wp.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 6,
      life: 0.9 + Math.random() * 0.8, age: 0,
      size: (sim.height * 0.2 + 0.4) * (0.6 + Math.random()),
      kind: i % 4 === 0 ? 'star' : 'poof',
    });
  }
}

function stepParticles(dt, w2s, ppm) {
  // spawn engine smoke near the ground
  if (sim.lit && sim.curThrust > 0 && sim.stageProp() > 0 && sim.alt() < 2200 && sim.primary === 'planet') {
    const wp = sim.worldPos();
    const eng = sim.activeEngines()[0]?.p;
    const water = eng?.engine.water;
    const n = water ? 2 : 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const side = (Math.random() - 0.5);
      particles.push({
        x: wp.x + side * sim.height * 0.1, y: wp.y,
        vx: side * (6 + Math.random() * 8) + sim.vel.x * 0.1,
        vy: -2 - Math.random() * 3,
        life: water ? 0.7 : 1.6 + Math.random() * 1.2, age: 0,
        size: water ? sim.height * 0.06 + 0.03 : sim.height * 0.12 + 0.2,
        kind: water ? 'drop' : 'smoke',
      });
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt * sim.warp();
    if (p.age > p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'drop') p.vy -= 9.8 * dt;
    const s = w2s(p.x, p.y);
    const t = p.age / p.life;
    const px = Math.max(1.5, p.size * ppm * (p.kind === 'smoke' || p.kind === 'poof' ? 1 + t * 2.2 : 1));
    if (p.kind === 'drop') ctx.fillStyle = `rgba(140,200,240,${0.9 * (1 - t)})`;
    else if (p.kind === 'star') ctx.fillStyle = `rgba(255,209,102,${1 - t})`;
    else ctx.fillStyle = `rgba(245,244,240,${0.75 * (1 - t)})`;
    if (p.kind === 'star') {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(t * 5);
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const rr = k % 2 ? px * 0.4 : px;
        ctx.lineTo(Math.cos(k * Math.PI / 4) * rr, Math.sin(k * Math.PI / 4) * rr);
      }
      ctx.closePath(); ctx.fill(); ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(s.x, s.y, px, 0, 7); ctx.fill();
    }
  }
}

function stepDebris(dt, w2s, ppm) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.age += dt * sim.warp();
    if (d.age > 14) { debris.splice(i, 1); continue; }
    const h = dt * sim.warp();
    const r = Math.hypot(d.pos.x, d.pos.y);
    const mu = PLANET.mu;
    d.vel.x += -mu * d.pos.x / (r * r * r) * h;
    d.vel.y += -mu * d.pos.y / (r * r * r) * h;
    d.pos.x += d.vel.x * h; d.pos.y += d.vel.y * h;
    d.ang += d.spin * h;
    if (r < PLANET.R) { debris.splice(i, 1); continue; }
    const s = w2s(d.pos.x, d.pos.y);
    if (s.x < -300 || s.x > canvas.clientWidth + 300 || s.y < -300 || s.y > canvas.clientHeight + 300) continue;
    const hPx = d.parts.reduce((q, p) => q + p.h, 0) * ppm;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(d.ang);
    ctx.globalAlpha = clamp(1.2 - d.age / 12, 0, 1);
    if (hPx > 5) drawRocket(ctx, d.parts.map(p => ({ p })), ppm, {});
    else { ctx.fillStyle = '#cbd2da'; ctx.fillRect(-2, -2, 4, 4); }
    ctx.restore();
  }
}

// ---------- map ----------
function renderMap(W, H, tSec) {
  ctx.fillStyle = '#0b1026';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  for (const [sx, sy, ss] of stars) ctx.fillRect(sx * W, sy * H, ss * 0.8, ss * 0.8);

  const wp = sim.worldPos();
  const o = sim.orbit();
  // fit scale
  const rNow = Math.hypot(wp.x, wp.y);
  let fitR = Math.max(rNow * 1.25, PLANET.R * 2.2);
  if (sim.primary === 'planet' && o && o.e < 1 && isFinite(o.apAlt)) fitR = Math.max(fitR, (o.apAlt + PLANET.R) * 1.2);
  if (rNow > MOON.orbitR * 0.28 || sim.primary === 'moon') fitR = Math.max(fitR, MOON.orbitR * 1.18);
  const mps = Math.min(W, H) / 2 / fitR * mapZoom;
  const cx = W / 2, cy = H / 2;
  const m2s = (x, y) => ({ x: cx + x * mps, y: cy - y * mps });

  // planet + atmosphere
  const pc = m2s(0, 0);
  ctx.fillStyle = 'rgba(140,196,238,.18)';
  ctx.beginPath(); ctx.arc(pc.x, pc.y, (PLANET.R + PLANET.atmoTop) * mps, 0, 7); ctx.fill();
  ctx.fillStyle = '#5fb2dd';
  ctx.beginPath(); ctx.arc(pc.x, pc.y, PLANET.R * mps, 0, 7); ctx.fill();
  ctx.fillStyle = '#7bc47f';
  ctx.save();
  ctx.beginPath(); ctx.arc(pc.x, pc.y, PLANET.R * mps, 0, 7); ctx.clip();
  for (const [a, rr, s] of [[0.3, 0.55, 0.35], [1.7, 0.7, 0.28], [2.9, 0.4, 0.3], [4.2, 0.75, 0.33]]) {
    ctx.beginPath();
    ctx.ellipse(pc.x + Math.cos(a) * PLANET.R * mps * rr, pc.y + Math.sin(a) * PLANET.R * mps * rr,
      PLANET.R * mps * s, PLANET.R * mps * s * 0.7, a, 0, 7);
    ctx.fill();
  }
  ctx.restore();

  // moon + orbit + SOI
  const mp = moonPos(sim.t);
  const mc = m2s(mp.x, mp.y);
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(pc.x, pc.y, MOON.orbitR * mps, 0, 7); ctx.stroke();
  ctx.fillStyle = '#e8e0c8';
  ctx.beginPath(); ctx.arc(mc.x, mc.y, Math.max(MOON.R * mps, 3), 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(232,224,200,.3)';
  ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.arc(mc.x, mc.y, MOON.soi * mps, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(232,224,200,.75)';
  ctx.font = '11px "Arial Rounded MT Bold", sans-serif';
  ctx.fillText(MOON.name, mc.x + 8, mc.y - 8);

  // trajectory conic around current primary
  const center = sim.primary === 'planet' ? { x: 0, y: 0 } : mp;
  if (o && !sim.landed) {
    const { a, e, argP, h } = o;
    const flip = h < 0;
    const cA = Math.cos(argP), sA = Math.sin(argP);
    ctx.strokeStyle = sim.primary === 'planet' ? 'rgba(255,209,102,.9)' : 'rgba(157,241,201,.9)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    let first = true;
    const plot = (px, py) => {
      if (flip) py = -py;
      const wx = center.x + px * cA - py * sA;
      const wy = center.y + px * sA + py * cA;
      const s = m2s(wx, wy);
      first ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
      first = false;
    };
    if (e < 1) {
      const b = a * Math.sqrt(1 - e * e);
      for (let i = 0; i <= 128; i++) {
        const E = (i / 128) * Math.PI * 2;
        plot(a * (Math.cos(E) - e), b * Math.sin(E));
      }
    } else {
      const rMax = fitR * 2.2 / mapZoom;
      const HH = Math.acosh(Math.max(1.0001, (1 - rMax / a) / e));
      for (let i = 0; i <= 96; i++) {
        const Hh = -HH + (i / 96) * 2 * HH;
        plot(a * (Math.cosh(Hh) - e), -a * Math.sqrt(e * e - 1) * Math.sinh(Hh));
      }
    }
    ctx.stroke();

    // Ap/Pe markers (elliptic only)
    if (e < 1 && e > 1e-4) {
      const mark = (px, py, label, val) => {
        if (flip) py = -py;
        const wx = center.x + px * cA - py * sA, wy = center.y + px * sA + py * cA;
        const s = m2s(wx, wy);
        ctx.fillStyle = '#ffd166';
        ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(`${label} ${fmtDist(val)}`, s.x + 7, s.y - 5);
      };
      const R0 = sim.primary === 'planet' ? PLANET.R : MOON.R;
      mark(a * (1 - e), 0, 'Pe', a * (1 - e) - R0);
      mark(-a * (1 + e), 0, 'Ap', a * (1 + e) - R0);
    }
  }

  // rocket marker
  const rp = m2s(wp.x, wp.y);
  ctx.save();
  ctx.translate(rp.x, rp.y);
  const ax = -Math.sin(sim.ang), ay = Math.cos(sim.ang);
  ctx.rotate(Math.atan2(ax, ay));
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3.5); ctx.lineTo(-5, 6);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.font = '11.5px "Arial Rounded MT Bold", sans-serif';
  ctx.fillText('MAP — scroll to zoom, M to close', 14, H - 44);
}

// ---------- report ----------
function showReport(reason) {
  reportShown = true;
  const s = store.load();
  const sum = sim.summary;
  const newMilestones = MILESTONES.filter(m => !s.milestones.includes(m.id) && m.test(sum));
  const isNewBest = sum.maxAlt > s.bestAlt;
  const baseXP = flightXP(sum.maxAlt, isNewBest);
  const mileXP = newMilestones.reduce((q, m) => q + m.xp, 0);
  const gained = baseXP + mileXP;
  const oldXP = s.xp;
  const flightNo = s.flights + 1;
  const company = s.company;

  store.update({
    xp: s.xp + gained,
    milestones: [...s.milestones, ...newMilestones.map(m => m.id)],
    bestAlt: Math.max(s.bestAlt, sum.maxAlt),
    bestSpeed: Math.max(s.bestSpeed, sum.maxSpeed),
    flights: s.flights + 1,
  });

  const title = reason === 'popped'
    ? '🫧 POP! Fizzled on the pad'
    : reason === 'crashed'
    ? (sim.mass < 5 ? '💥 Bonk.' : '💥 Rapid unscheduled disassembly')
    : reason === 'landed'
      ? (sum.moonLanded ? '🌙 MOON LANDING!!' : '🪂 Recovered in one piece!')
      : '📋 Flight complete';
  const rocketName = s.rocketName?.trim() || 'Untitled rocket';

  const mileRows = newMilestones.map(m => `
    <div class="mile-row new"><span>🏅</span>
      <span><b>${m.name}</b><br><span class="mdesc">${m.desc}</span></span>
      <span class="mxp">+${m.xp} XP</span></div>`).join('');

  openModal(`
    <h2>${title}</h2>
    <p style="font-size:13px;color:var(--ink-soft)">${rocketName} · flight #${flightNo} · ${company}</p>
    <div class="report-big">
      <div class="rb"><b>${fmtDist(sum.maxAlt)}</b><span>MAX ALTITUDE${isNewBest ? ' ⭐ NEW BEST' : ''}</span></div>
      <div class="rb"><b>${fmtSpeed(sum.maxSpeed)}</b><span>MAX SPEED</span></div>
      <div class="rb"><b>${fmtTime(sum.flightTime)}</b><span>FLIGHT TIME</span></div>
    </div>
    ${sum.orbitAchieved ? `<div class="mile-row" style="border-color:var(--blue)"><span>🛰</span><b>This rocket reached a stable orbit.</b></div>` : ''}
    ${mileRows}
    <div class="xp-gain">flight XP +${baseXP}${mileXP ? ` · milestones +${mileXP}` : ''} → <b>+${gained} XP</b></div>
    ${tierBannerHTML(oldXP, oldXP + gained)}
    <div class="modal-actions">
      <button class="btn ghost" id="rAgain">Fly it again 🔁</button>
      <button class="btn primary" id="rWorkshop">To the workshop 🔧</button>
    </div>
  `);
  $('#rWorkshop').onclick = endToWorkshop;
  $('#rAgain').onclick = () => { closeModal(); startFlight(flownIds); };
}
