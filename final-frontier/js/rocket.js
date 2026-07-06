// Rocket geometry (stacking layout) and cute canvas rendering.
// Drawing convention: caller translates the context to the rocket's centre and
// (optionally) rotates it; drawRocket() then draws in metres*ppm with the nose
// pointing toward -y (local "up"), engine toward +y.
import { PARTS } from './parts.js';
import { roundRect } from './util.js';

// Compute stacked layout + per-node stage index.
export function layout(design) {
  const stack = design.stack || [];
  const nodes = [];
  let y = 0, W = 0.1;
  for (const node of stack) {
    const p = PARTS[node.id];
    if (!p) continue;
    const radial = (node.radial || []).map(id => PARTS[id]).filter(Boolean);
    nodes.push({ node, part: p, top: y, h: p.h, w: p.w, cy: y + p.h / 2, radial });
    y += p.h;
    W = Math.max(W, p.w);
    for (const r of radial) W = Math.max(W, p.w + r.w * 2);
  }
  const H = y || 1;
  // stage index per node (bottom-first grouping, matches parts.buildStages)
  let stg = 0;
  const stageOf = new Map();
  for (let i = nodes.length - 1; i >= 0; i--) {
    stageOf.set(nodes[i], stg);
    if (nodes[i].part.kind === 'decoupler') stg++;
  }
  for (const n of nodes) n.stage = stageOf.get(n);
  return { nodes, H, W, stageCount: stg + 1 };
}

// Draw a whole rocket centred at the current origin, nose toward -y.
// opts: { ppm, activeStage, throttle, flame, chuteOpen, alpha, selectIndex, t }
export function drawRocket(ctx, design, opts = {}) {
  const lo = opts.layout || layout(design);
  const ppm = opts.ppm || 20;
  const { nodes, H } = lo;
  const active = opts.activeStage ?? -1;   // -1 = draw all (editor)
  const t = opts.t || 0;

  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  // draw from bottom to top so nose overlaps body nicely
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (active >= 0 && n.stage < active) continue;   // dropped stages gone
    const ly = (n.cy - H / 2) * ppm;                  // local y of part centre
    // radial parts first (behind body)
    for (const r of n.radial) drawRadial(ctx, r, n, ly, ppm);
    drawStackPart(ctx, n.part, ly, ppm, opts, i === opts.selectIndex);
    // flame for engines in the active (burning) stage
    if (opts.flame && n.part.thrust && (active < 0 || n.stage === active)) {
      const by = (n.top + n.h - H / 2) * ppm;
      drawFlame(ctx, n.part, by, ppm, opts.throttle ?? 1, t, i);
    }
  }
  // chute canopy
  if (opts.chuteOpen) {
    for (const n of nodes) {
      if (active >= 0 && n.stage < active) continue;
      if (n.part.kind === 'chute') drawCanopy(ctx, n, H, ppm);
    }
  }
  ctx.restore();
}

function drawStackPart(ctx, p, ly, ppm, opts, selected) {
  const w = p.w * ppm, h = p.h * ppm;
  const x = -w / 2, y = ly - h / 2;
  ctx.lineWidth = Math.max(1, ppm * 0.03);
  ctx.strokeStyle = p.edge;
  ctx.fillStyle = p.col;

  switch (p.kind) {
    case 'nose': {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(x, y + h * 0.35, x, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.quadraticCurveTo(x + w, y + h * 0.35, 0, y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'command': {
      // rounded capsule with a window
      roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.35);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(120,190,255,0.9)';
      ctx.beginPath();
      ctx.ellipse(0, y + h * 0.42, w * 0.22, h * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.edge; ctx.stroke();
      break;
    }
    case 'tank': {
      roundRect(ctx, x, y, w, h, Math.min(w * 0.28, ppm * 0.4));
      ctx.fill(); ctx.stroke();
      if (p.band) {
        ctx.fillStyle = p.band;
        ctx.fillRect(x, y + h * 0.16, w, Math.max(1.5, h * 0.06));
        ctx.fillRect(x, y + h * 0.78, w, Math.max(1.5, h * 0.06));
      }
      // subtle vertical shading
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x + w * 0.14, y + h * 0.05, w * 0.14, h * 0.9);
      break;
    }
    case 'body': {
      roundRect(ctx, x, y, w, h, Math.min(w * 0.2, ppm * 0.25));
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'decoupler': {
      ctx.fillStyle = p.col;
      roundRect(ctx, x, y, w, h, h * 0.35);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      for (let i = 1; i < 6; i++) {
        const xx = x + (w / 6) * i;
        ctx.beginPath(); ctx.moveTo(xx, y + 1); ctx.lineTo(xx, y + h - 1); ctx.stroke();
      }
      break;
    }
    case 'chute': {
      roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.3);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(0, ly, Math.min(w, h) * 0.18, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'engine': {
      // body block
      roundRect(ctx, x + w * 0.1, y, w * 0.8, h * 0.55, ppm * 0.15);
      ctx.fill(); ctx.stroke();
      // bell nozzle
      const bw = (p.flameW || p.w * 0.7) * ppm;
      ctx.beginPath();
      ctx.moveTo(-w * 0.3, y + h * 0.5);
      ctx.lineTo(-bw / 2, y + h);
      ctx.lineTo(bw / 2, y + h);
      ctx.lineTo(w * 0.3, y + h * 0.5);
      ctx.closePath();
      ctx.fillStyle = '#9aa3b2'; ctx.fill(); ctx.stroke();
      break;
    }
    default: {
      roundRect(ctx, x, y, w, h, 3);
      ctx.fill(); ctx.stroke();
    }
  }

  if (selected) {
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = Math.max(2, ppm * 0.05);
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 6);
    ctx.stroke();
  }
}

function drawRadial(ctx, r, n, ly, ppm) {
  const bodyW = n.w * ppm;
  const rw = r.w * ppm, rh = r.h * ppm;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * bodyW / 2, ly);
    if (side < 0) ctx.scale(-1, 1);
    ctx.fillStyle = r.col; ctx.strokeStyle = r.edge;
    ctx.lineWidth = Math.max(1, ppm * 0.03);
    if (r.kind === 'fin') {
      // swept fin triangle
      ctx.beginPath();
      ctx.moveTo(0, -rh * 0.3);
      ctx.lineTo(rw, rh * 0.35);
      ctx.lineTo(rw, rh * 0.5);
      ctx.lineTo(0, rh * 0.5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else if (r.kind === 'booster') {
      // strap-on booster (rounded tube with a little nose)
      roundRect(ctx, 0, -rh / 2, rw, rh, rw * 0.4);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -rh / 2);
      ctx.quadraticCurveTo(rw / 2, -rh / 2 - rw * 0.9, rw, -rh / 2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      roundRect(ctx, 0, -rh / 2, rw, rh, 3);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFlame(ctx, p, by, ppm, throttle, t, seed) {
  if (throttle <= 0.01) return;
  const w = (p.flameW || p.w * 0.7) * ppm;
  const flick = 0.8 + 0.2 * Math.sin(t * 40 + seed);
  const len = w * (1.6 + throttle * 3.2) * flick;
  const col = p.flameCol || '#ffd36b';
  const grad = ctx.createLinearGradient(0, by, 0, by + len);
  grad.addColorStop(0, '#fff6d0');
  grad.addColorStop(0.35, col);
  grad.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, by);
  ctx.quadraticCurveTo(-w * 0.3, by + len * 0.6, 0, by + len);
  ctx.quadraticCurveTo(w * 0.3, by + len * 0.6, w * 0.5, by);
  ctx.closePath();
  ctx.fill();
  // inner bright core
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.22, by);
  ctx.quadraticCurveTo(0, by + len * 0.4, 0, by + len * 0.55);
  ctx.quadraticCurveTo(0, by + len * 0.4, w * 0.22, by);
  ctx.closePath();
  ctx.fill();
}

function drawCanopy(ctx, n, H, ppm) {
  const topY = (n.top - H / 2) * ppm;
  const cw = n.w * ppm * 3.2;
  const ch = cw * 0.55;
  const cy = topY - ch * 0.9;
  ctx.fillStyle = '#ff9ec2';
  ctx.strokeStyle = '#c96a92';
  ctx.lineWidth = Math.max(1, ppm * 0.03);
  ctx.beginPath();
  ctx.moveTo(-cw / 2, cy + ch);
  ctx.quadraticCurveTo(-cw / 2, cy - ch * 0.5, 0, cy - ch * 0.5);
  ctx.quadraticCurveTo(cw / 2, cy - ch * 0.5, cw / 2, cy + ch);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // scallops + lines
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(-cw / 2, cy + ch); ctx.lineTo(0, topY);
  ctx.moveTo(cw / 2, cy + ch); ctx.lineTo(0, topY);
  ctx.moveTo(0, cy - ch * 0.5); ctx.lineTo(0, topY);
  ctx.stroke();
}
