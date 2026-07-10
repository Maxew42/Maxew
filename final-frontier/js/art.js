// Final Frontier — canvas painters. Cute, soft, rounded.
// All part painters draw centered on x=0 with the part's TOP at y=0,
// in pixels (caller scales meters -> px).

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function shade(hex, k) { // k in [-1,1]: darken/lighten
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function bodyGrad(ctx, w, body) {
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, shade(body, 0.25));
  g.addColorStop(0.45, body);
  g.addColorStop(1, shade(body, -0.22));
  return g;
}

export function drawPartShape(ctx, part, w, h) {
  const a = part.art ?? { style: 'tube', body: '#ddd', accent: '#999' };
  const { body, accent } = a;
  ctx.save();
  switch (a.style) {
    case 'cone': {
      ctx.fillStyle = bodyGrad(ctx, w, body);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(w * 0.42, h * 0.35, w * 0.5, h);
      ctx.lineTo(-w * 0.5, h);
      ctx.quadraticCurveTo(-w * 0.42, h * 0.35, 0, 0);
      ctx.fill();
      ctx.fillStyle = accent;
      rr(ctx, -w / 2, h * 0.82, w, h * 0.18, h * 0.04); ctx.fill();
      break;
    }
    case 'cone-round': {
      ctx.fillStyle = bodyGrad(ctx, w, body);
      ctx.beginPath();
      ctx.moveTo(-w / 2, h);
      ctx.ellipse(0, h * 0.62, w / 2, h * 0.62, 0, Math.PI, 0);
      ctx.lineTo(w / 2, h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      rr(ctx, -w / 2, h * 0.8, w, h * 0.2, h * 0.05); ctx.fill();
      // little window dot
      ctx.fillStyle = shade(accent, 0.5);
      ctx.beginPath(); ctx.arc(0, h * 0.45, Math.min(w, h) * 0.13, 0, 7); ctx.fill();
      break;
    }
    case 'bottle': {
      // upside-down soda bottle: neck/nozzle at bottom
      ctx.fillStyle = bodyGrad(ctx, w, body);
      ctx.beginPath();
      ctx.moveTo(-w / 2, h * 0.12);
      ctx.quadraticCurveTo(-w / 2, 0, 0, 0);
      ctx.quadraticCurveTo(w / 2, 0, w / 2, h * 0.12);
      ctx.lineTo(w / 2, h * 0.7);
      ctx.quadraticCurveTo(w / 2, h * 0.84, w * 0.13, h * 0.9);
      ctx.lineTo(w * 0.13, h);
      ctx.lineTo(-w * 0.13, h);
      ctx.lineTo(-w * 0.13, h * 0.9);
      ctx.quadraticCurveTo(-w / 2, h * 0.84, -w / 2, h * 0.7);
      ctx.closePath();
      ctx.fill();
      // water line
      ctx.fillStyle = shade(accent, 0.25);
      ctx.globalAlpha = 0.55;
      rr(ctx, -w * 0.44, h * 0.42, w * 0.88, h * 0.34, w * 0.1); ctx.fill();
      ctx.globalAlpha = 1;
      // label
      ctx.fillStyle = accent;
      rr(ctx, -w / 2, h * 0.2, w, h * 0.17, w * 0.05); ctx.fill();
      ctx.fillStyle = shade(body, 0.55);
      ctx.beginPath(); ctx.arc(-w * 0.15, h * 0.28, w * 0.06, 0, 7); ctx.fill();
      // cap nozzle
      ctx.fillStyle = shade(accent, -0.25);
      rr(ctx, -w * 0.15, h * 0.9, w * 0.3, h * 0.1, w * 0.04); ctx.fill();
      break;
    }
    case 'tube': {
      ctx.fillStyle = bodyGrad(ctx, w, body);
      rr(ctx, -w / 2, 0, w, h, Math.min(w * 0.12, h * 0.2)); ctx.fill();
      ctx.fillStyle = accent;
      rr(ctx, -w / 2, h * 0.06, w, Math.max(2, h * 0.09), 2); ctx.fill();
      rr(ctx, -w / 2, h * 0.85, w, Math.max(2, h * 0.09), 2); ctx.fill();
      // rivets
      ctx.fillStyle = shade(body, -0.3);
      const n = Math.max(2, Math.round(h / w * 2));
      for (let i = 1; i < n; i++) {
        ctx.globalAlpha = 0.35;
        ctx.fillRect(-w * 0.42, (h * i) / n, w * 0.84, Math.max(1, h * 0.008));
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'solid': case 'solid-big': {
      ctx.fillStyle = bodyGrad(ctx, w, body);
      rr(ctx, -w / 2, 0, w, h * 0.86, w * 0.12); ctx.fill();
      ctx.fillStyle = accent;
      rr(ctx, -w / 2, h * 0.1, w, h * 0.14, 2); ctx.fill();
      rr(ctx, -w / 2, h * 0.55, w, h * 0.1, 2); ctx.fill();
      // nozzle
      ctx.fillStyle = shade(accent, -0.45);
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, h * 0.86);
      ctx.lineTo(-w * 0.34, h);
      ctx.lineTo(w * 0.34, h);
      ctx.lineTo(w * 0.2, h * 0.86);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'liquid': case 'liquid-big': case 'nuclear': {
      // mount + bell
      ctx.fillStyle = bodyGrad(ctx, w, body);
      rr(ctx, -w * 0.42, 0, w * 0.84, h * 0.4, w * 0.08); ctx.fill();
      ctx.fillStyle = shade(body, -0.25);
      ctx.beginPath();
      ctx.moveTo(-w * 0.16, h * 0.38);
      ctx.bezierCurveTo(-w * 0.5, h * 0.6, -w * 0.5, h * 0.85, -w * 0.44, h);
      ctx.lineTo(w * 0.44, h);
      ctx.bezierCurveTo(w * 0.5, h * 0.85, w * 0.5, h * 0.6, w * 0.16, h * 0.38);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = accent;
      rr(ctx, -w * 0.42, h * 0.06, w * 0.84, h * 0.1, 2); ctx.fill();
      if (a.style === 'nuclear') {
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(0, h * 0.22, w * 0.12, 0, 7); ctx.fill();
        ctx.fillStyle = shade(accent, -0.4);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(0, h * 0.22, w * 0.11, i * 2.1 + 0.3, i * 2.1 + 1.3);
          ctx.lineTo(0, h * 0.22); ctx.fill();
        }
      }
      break;
    }
    case 'avionics': case 'probe': {
      ctx.fillStyle = bodyGrad(ctx, w, body);
      rr(ctx, -w / 2, 0, w, h, Math.min(w, h) * 0.18); ctx.fill();
      // little face screen :)
      ctx.fillStyle = a.style === 'probe' ? '#233' : shade(accent, -0.1);
      const sw = w * 0.44, sh = h * 0.55;
      rr(ctx, -sw / 2, h * 0.22, sw, sh, sh * 0.25); ctx.fill();
      ctx.fillStyle = '#9ff3c9';
      ctx.beginPath(); ctx.arc(-sw * 0.18, h * 0.22 + sh * 0.4, sh * 0.09, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(sw * 0.18, h * 0.22 + sh * 0.4, sh * 0.09, 0, 7); ctx.fill();
      ctx.lineWidth = Math.max(1, sh * 0.07); ctx.strokeStyle = '#9ff3c9';
      ctx.beginPath(); ctx.arc(0, h * 0.22 + sh * 0.55, sh * 0.18, 0.3, Math.PI - 0.3); ctx.stroke();
      // antenna
      ctx.strokeStyle = shade(body, -0.35); ctx.lineWidth = Math.max(1, w * 0.03);
      ctx.beginPath(); ctx.moveTo(w * 0.38, h * 0.15); ctx.lineTo(w * 0.48, -h * 0.35); ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(w * 0.48, -h * 0.35, w * 0.05, 0, 7); ctx.fill();
      break;
    }
    case 'capsule': {
      ctx.fillStyle = bodyGrad(ctx, w, body);
      ctx.beginPath();
      ctx.moveTo(-w * 0.16, 0);
      ctx.lineTo(w * 0.16, 0);
      ctx.quadraticCurveTo(w * 0.52, h * 0.42, w * 0.5, h);
      ctx.lineTo(-w * 0.5, h);
      ctx.quadraticCurveTo(-w * 0.52, h * 0.42, -w * 0.16, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = accent;
      rr(ctx, -w * 0.5, h * 0.86, w, h * 0.14, 3); ctx.fill();
      rr(ctx, -w * 0.2, 0, w * 0.4, h * 0.09, 3); ctx.fill();
      // window + astronaut
      ctx.fillStyle = '#2e3350';
      ctx.beginPath(); ctx.arc(0, h * 0.5, w * 0.16, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, h * 0.53, w * 0.1, 0, 7); ctx.fill();
      ctx.fillStyle = '#2e3350';
      ctx.beginPath(); ctx.arc(-w * 0.035, h * 0.52, w * 0.014, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(w * 0.035, h * 0.52, w * 0.014, 0, 7); ctx.fill();
      ctx.lineWidth = w * 0.012; ctx.strokeStyle = '#2e3350';
      ctx.beginPath(); ctx.arc(0, h * 0.54, w * 0.03, 0.4, Math.PI - 0.4); ctx.stroke();
      break;
    }
    case 'decoupler': {
      ctx.fillStyle = bodyGrad(ctx, w, body);
      rr(ctx, -w / 2, 0, w, h, h * 0.3); ctx.fill();
      ctx.fillStyle = accent;
      for (let i = -2; i <= 2; i++) {
        rr(ctx, i * w * 0.17 - w * 0.03, h * 0.2, w * 0.06, h * 0.6, 2); ctx.fill();
      }
      break;
    }
    case 'chute': {
      ctx.fillStyle = bodyGrad(ctx, w, body);
      rr(ctx, -w / 2, 0, w, h, Math.min(w, h) * 0.3); ctx.fill();
      ctx.fillStyle = accent;
      rr(ctx, -w * 0.2, -h * 0.12, w * 0.4, h * 0.24, h * 0.12); ctx.fill();
      break;
    }
    case 'legs': {
      ctx.strokeStyle = shade(body, -0.15);
      ctx.lineWidth = Math.max(2, w * 0.06);
      ctx.beginPath(); ctx.moveTo(-w * 0.18, 0); ctx.lineTo(-w * 0.48, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * 0.18, 0); ctx.lineTo(w * 0.48, h); ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, h * 0.15); ctx.lineTo(-w * 0.48, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.15); ctx.lineTo(w * 0.48, h); ctx.stroke();
      ctx.fillStyle = shade(body, -0.35);
      rr(ctx, -w * 0.56, h * 0.94, w * 0.2, h * 0.08, 2); ctx.fill();
      rr(ctx, w * 0.36, h * 0.94, w * 0.2, h * 0.08, 2); ctx.fill();
      break;
    }
    default: { // fins variants are handled by drawFins
      ctx.fillStyle = body;
      rr(ctx, -w / 2, 0, w, h, 3); ctx.fill();
    }
  }
  ctx.restore();
}

// Fins straddle the body: bodyW = width of the part they sit on.
export function drawFins(ctx, part, w, h, bodyW) {
  const a = part.art;
  const grid = a.style === 'fins-grid';
  const span = (w - bodyW) / 2;
  ctx.save();
  for (const s of [-1, 1]) {
    ctx.fillStyle = s < 0 ? shade(a.body, 0.15) : shade(a.body, -0.1);
    ctx.beginPath();
    if (grid) {
      rr(ctx, s > 0 ? bodyW / 2 : -bodyW / 2 - span, h * 0.05, span, h * 0.9, 2);
      ctx.fill();
      ctx.strokeStyle = shade(a.accent, -0.1);
      ctx.lineWidth = Math.max(1, h * 0.045);
      const x0 = s > 0 ? bodyW / 2 : -bodyW / 2 - span;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(x0 + (span * i) / 3, h * 0.08); ctx.lineTo(x0 + (span * i) / 3, h * 0.92);
        ctx.moveTo(x0 + span * 0.06, h * 0.05 + (h * 0.9 * i) / 3); ctx.lineTo(x0 + span * 0.94, h * 0.05 + (h * 0.9 * i) / 3);
      }
      ctx.stroke();
    } else {
      const x0 = s * bodyW / 2;
      ctx.moveTo(x0, 0);
      ctx.quadraticCurveTo(x0 + s * span * 0.35, h * 0.45, x0 + s * span, h * 1.05);
      ctx.lineTo(x0 + s * span * 0.96, h * 1.28);
      ctx.quadraticCurveTo(x0 + s * span * 0.4, h * 0.98, x0, h);
      ctx.closePath();
      ctx.fill();
      if (a.style === 'fins-tech') {
        ctx.fillStyle = a.accent;
        ctx.beginPath();
        ctx.arc(x0 + s * span * 0.45, h * 0.72, h * 0.13, 0, 7);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

// ---------------- rocket assembly painter ----------------
// stack: [{p, radial?, prop?, propFull?, isDec?}] top->bottom. Fins and radial
// side-booster pairs add no height.
export function stackHeight(stack) {
  return stack.reduce((s, x) => s + (x.p.type === 'fins' || x.radial ? 0 : x.p.h), 0);
}

// Base half-width: the bottom-most body part (what side boosters strap onto).
function baseHalfW(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const x = stack[i];
    if (x.p.type !== 'fins' && !x.radial) return x.p.w / 2;
  }
  return 0.05;
}

// Draw full rocket, origin at the BOTTOM CENTER (y=0 at base, negative y up).
export function drawRocket(ctx, stack, ppm, opts = {}) {
  const Hm = stackHeight(stack);
  const H = Hm * ppm;
  let y = -H; // top
  ctx.save();
  ctx.lineJoin = 'round';
  const placed = [];
  for (const x of stack) {
    const p = x.p;
    if (x.radial) { placed.push({ x, y: 0, radial: true }); continue; }
    if (p.type === 'fins') { placed.push({ x, y, fin: true }); continue; }
    placed.push({ x, y });
    y += p.h * ppm;
  }
  // fins body width: nearest non-fin neighbor below in the stack order
  for (let i = 0; i < placed.length; i++) {
    if (!placed[i].fin) continue;
    let bw = 0.06, below = false;
    for (let j = i + 1; j < placed.length; j++) if (!placed[j].fin && !placed[j].radial) { bw = placed[j].x.p.w; below = true; break; }
    if (!below) {
      for (let j = i - 1; j >= 0; j--) if (!placed[j].fin && !placed[j].radial) { bw = placed[j].x.p.w; break; }
      // bottom-mounted fins sit flush with the base
      placed[i].y -= placed[i].x.p.h * ppm * 1.28;
    }
    placed[i].bodyW = bw;
  }
  const coreHalf = baseHalfW(stack) * ppm;

  // fins first (behind), then side boosters, then bodies top->bottom
  for (const pl of placed) {
    if (!pl.fin) continue;
    const p = pl.x.p;
    ctx.save();
    ctx.translate(0, pl.y);
    drawFins(ctx, p, p.w * ppm, p.h * ppm, pl.bodyW * ppm);
    ctx.restore();
  }
  for (const pl of placed) {
    if (!pl.radial) continue;
    const p = pl.x.p;
    pl.offX = coreHalf + p.w * ppm * 0.52 + Math.max(1, ppm * 0.04);
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * pl.offX, -p.h * ppm);
      drawPartShape(ctx, p, p.w * ppm, p.h * ppm);
      // strap
      ctx.fillStyle = 'rgba(61,64,91,.55)';
      ctx.fillRect(s > 0 ? -p.w * ppm * 0.62 : p.w * ppm * 0.5 - p.w * ppm * 0.0, p.h * ppm * 0.2, p.w * ppm * 0.12, Math.max(2, p.h * ppm * 0.05));
      ctx.restore();
    }
  }
  const bodies = placed.filter(pl => !pl.fin && !pl.radial);
  for (const pl of bodies) {
    const p = pl.x.p;
    ctx.save();
    ctx.translate(0, pl.y);
    drawPartShape(ctx, p, p.w * ppm, p.h * ppm);
    ctx.restore();
  }
  // adapter shoulders where consecutive bodies differ in width
  for (let i = 0; i + 1 < bodies.length; i++) {
    const up = bodies[i].x.p, lo = bodies[i + 1].x.p;
    const wU = up.w * ppm, wL = lo.w * ppm;
    if (Math.abs(wU - wL) < Math.max(wU, wL) * 0.08) continue;
    const yJ = bodies[i + 1].y;
    const hTr = Math.min(Math.max(Math.abs(wU - wL) * 0.6, 3), lo.h * ppm * 0.45);
    ctx.fillStyle = shade(lo.art?.body ?? '#ccc', -0.12);
    ctx.beginPath();
    ctx.moveTo(-wU / 2, yJ);
    ctx.lineTo(wU / 2, yJ);
    ctx.lineTo(wL / 2, yJ + hTr);
    ctx.lineTo(-wL / 2, yJ + hTr);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(lo.art?.body ?? '#ccc', 0.25);
    ctx.fillRect(-wU / 2, yJ, wU, Math.max(1.5, hTr * 0.18));
  }
  // selection ring
  if (opts.selectedIdx != null) {
    const sel = stack[opts.selectedIdx];
    const pl = placed.find(q => q.x === sel);
    if (pl) {
      const p = sel.p;
      ctx.strokeStyle = '#ffb703'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
      const ring = (cx, cy, w, h) => { rr(ctx, cx - w / 2 - 4, cy - 4, w + 8, h + 8, 6); ctx.stroke(); };
      if (pl.radial) {
        for (const s of [-1, 1]) ring(s * pl.offX, -p.h * ppm, p.w * ppm, p.h * ppm);
      } else if (pl.fin) {
        ring(0, pl.y, p.w * ppm, p.h * ppm * 1.3);
      } else {
        ring(0, pl.y, p.w * ppm, p.h * ppm);
      }
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  return { heightPx: H, placed, coreHalf };
}

// ---------------- flames & particles ----------------
export function drawFlame(ctx, kind, w, len, t) {
  const flick = 0.85 + 0.15 * Math.sin(t * 47) + 0.08 * Math.sin(t * 31 + 2);
  const L = len * flick;
  ctx.save();
  if (kind === 'water') {
    ctx.fillStyle = 'rgba(160,215,245,0.85)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, 0);
    ctx.quadraticCurveTo(-w * 0.9, L * 0.6, -w * 0.5, L);
    ctx.lineTo(w * 0.5, L);
    ctx.quadraticCurveTo(w * 0.9, L * 0.6, w * 0.3, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 6; i++) {
      const a = t * 13 + i * 2.4;
      ctx.beginPath();
      ctx.arc(Math.sin(a) * w * 0.7, L * (0.3 + 0.6 * ((i * 0.37 + t * 2.1) % 1)), w * 0.12, 0, 7);
      ctx.fill();
    }
  } else {
    const core = kind === 'nuclear' ? '#c5ffd9' : '#fff6d8';
    const mid = kind === 'nuclear' ? '#80ed99' : kind === 'solid' ? '#ffb703' : '#ffd166';
    const outer = kind === 'nuclear' ? 'rgba(128,237,153,0)' : 'rgba(251,133,0,0)';
    const g = ctx.createLinearGradient(0, 0, 0, L);
    g.addColorStop(0, core); g.addColorStop(0.35, mid); g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, 0);
    ctx.quadraticCurveTo(-w * 0.55, L * 0.35, 0, L);
    ctx.quadraticCurveTo(w * 0.55, L * 0.35, w * 0.42, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.18, 0);
    ctx.quadraticCurveTo(-w * 0.2, L * 0.2, 0, L * 0.42);
    ctx.quadraticCurveTo(w * 0.2, L * 0.2, w * 0.18, 0);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

export function drawChuteCanopy(ctx, w, frac, color, accent) {
  // above the rocket top (origin at rocket top center)
  const R = w * (0.5 + 2.6 * frac);
  const rise = -R * 1.9;
  ctx.save();
  ctx.strokeStyle = 'rgba(90,90,110,0.8)';
  ctx.lineWidth = Math.max(1, w * 0.03);
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, 0); ctx.lineTo(-R * 0.85, rise);
  ctx.moveTo(w * 0.3, 0); ctx.lineTo(R * 0.85, rise);
  ctx.moveTo(0, 0); ctx.lineTo(0, rise - R * 0.28);
  ctx.stroke();
  const g = ctx.createLinearGradient(-R, rise - R * 0.4, R, rise);
  g.addColorStop(0, shade(color, 0.2)); g.addColorStop(1, shade(color, -0.15));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, rise, R, Math.PI, 0);
  ctx.quadraticCurveTo(R * 0.6, rise + R * 0.24, 0, rise + R * 0.12);
  ctx.quadraticCurveTo(-R * 0.6, rise + R * 0.24, -R, rise);
  ctx.fill();
  ctx.fillStyle = accent; ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(0, rise, R, Math.PI + 0.5, Math.PI + 1.1);
  ctx.arc(0, rise, R * 0.02, 0, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------- launch pads (evolving with tier) ----------------
// Draw around origin = pad center at ground level, ppm = px per meter. Ground spans widely.
export function drawPad(ctx, tier, ppm, t = 0) {
  const u = (m) => m * ppm;
  ctx.save();
  const props = {
    0: () => { // backyard: fence, doghouse, flowers, wooden launch stick
      ctx.fillStyle = '#c98d5f';
      for (let i = -7; i <= 7; i++) {
        if (Math.abs(i) < 2) continue;
        ctx.fillRect(u(i * 0.8) - u(0.06), -u(0.85), u(0.12), u(0.85));
      }
      ctx.fillRect(u(-5.6), -u(0.7), u(11.2), u(0.09));
      ctx.fillRect(u(-5.6), -u(0.35), u(11.2), u(0.09));
      // doghouse
      ctx.fillStyle = '#e07a5f';
      ctx.fillRect(u(-4.4), -u(0.9), u(1.3), u(0.9));
      ctx.fillStyle = '#b95b42';
      ctx.beginPath();
      ctx.moveTo(u(-4.6), -u(0.9)); ctx.lineTo(u(-3.75), -u(1.45)); ctx.lineTo(u(-2.9), -u(0.9));
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5a3825';
      ctx.beginPath(); ctx.arc(u(-3.75), -u(0.3), u(0.26), Math.PI, 0); ctx.fill();
      ctx.fillRect(u(-4.01), -u(0.3), u(0.52), u(0.3));
      // flowers
      for (let i = 0; i < 6; i++) {
        const x = u(1.6 + i * 0.75);
        ctx.strokeStyle = '#5f9e54'; ctx.lineWidth = u(0.03);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, -u(0.28)); ctx.stroke();
        ctx.fillStyle = ['#ff8fa3', '#ffd166', '#c8b6ff'][i % 3];
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.arc(x + Math.cos(k * 1.256) * u(0.07), -u(0.28) + Math.sin(k * 1.256) * u(0.07), u(0.05), 0, 7);
          ctx.fill();
        }
        ctx.fillStyle = '#f9f871';
        ctx.beginPath(); ctx.arc(x, -u(0.28), u(0.05), 0, 7); ctx.fill();
      }
      // launch rod
      ctx.strokeStyle = '#8d6e56'; ctx.lineWidth = u(0.05);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -u(0.9)); ctx.stroke();
      ctx.fillStyle = '#8d6e56';
      ctx.fillRect(u(-0.5), -u(0.06), u(1), u(0.06));
    },
    1: () => { // school field: rail launcher, flag, cones, bleacher
      ctx.fillStyle = '#e9ecef';
      ctx.fillRect(u(-1.2), -u(0.12), u(2.4), u(0.12));
      ctx.strokeStyle = '#74809a'; ctx.lineWidth = u(0.08);
      ctx.beginPath(); ctx.moveTo(u(-0.3), 0); ctx.lineTo(u(0.5), -u(2.6)); ctx.stroke();
      // flag
      ctx.strokeStyle = '#adb5bd'; ctx.lineWidth = u(0.05);
      ctx.beginPath(); ctx.moveTo(u(3.2), 0); ctx.lineTo(u(3.2), -u(2.4)); ctx.stroke();
      ctx.fillStyle = '#ef476f';
      ctx.beginPath();
      const wv = Math.sin(t * 2) * u(0.08);
      ctx.moveTo(u(3.2), -u(2.4));
      ctx.quadraticCurveTo(u(3.9), -u(2.35) + wv, u(4.3), -u(2.2) + wv);
      ctx.lineTo(u(3.2), -u(1.95));
      ctx.closePath(); ctx.fill();
      // traffic cones
      for (const x of [-2.2, -1.6, 1.8, 2.6]) {
        ctx.fillStyle = '#f77f00';
        ctx.beginPath();
        ctx.moveTo(u(x), -u(0.42)); ctx.lineTo(u(x - 0.16), 0); ctx.lineTo(u(x + 0.16), 0);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(u(x - 0.09), -u(0.24), u(0.18), u(0.07));
      }
      // bleacher
      ctx.fillStyle = '#9bc1bc';
      for (let i = 0; i < 3; i++) ctx.fillRect(u(-5.4 + i * 0.3), -u(0.35 + i * 0.35), u(1.8 - i * 0.6), u(0.14));
    },
    2: () => { // startup: concrete slab, container mission control, light mast
      ctx.fillStyle = '#ced4da';
      ctx.fillRect(u(-3), -u(0.22), u(6), u(0.22));
      ctx.fillStyle = '#adb5bd';
      ctx.fillRect(u(-3), -u(0.22), u(6), u(0.06));
      // container
      ctx.fillStyle = '#5390d9';
      ctx.fillRect(u(-7.2), -u(1.5), u(3), u(1.5));
      ctx.fillStyle = '#3a6fb0';
      for (let i = 0; i < 5; i++) ctx.fillRect(u(-7.0 + i * 0.55), -u(1.5), u(0.14), u(1.5));
      ctx.fillStyle = '#f4f1de';
      ctx.fillRect(u(-6.6), -u(1.15), u(0.8), u(0.5)); // window
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(u(-4.75), -u(1.9), u(0.5), u(0.4)); // satellite dish base
      ctx.beginPath(); ctx.arc(u(-4.5), -u(2.05), u(0.3), 0.4, Math.PI + 2.2); ctx.fill();
      // light mast
      ctx.strokeStyle = '#74809a'; ctx.lineWidth = u(0.09);
      ctx.beginPath(); ctx.moveTo(u(4.6), 0); ctx.lineTo(u(4.6), -u(3.4)); ctx.stroke();
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath(); ctx.arc(u(4.6), -u(3.5), u(0.22), 0, 7); ctx.fill();
    },
    3: () => { // new space: proper pad, strongback tower, water tower, hangar
      ctx.fillStyle = '#b9c0c8';
      ctx.fillRect(u(-6), -u(0.5), u(12), u(0.5));
      ctx.fillStyle = '#98a1ab';
      ctx.fillRect(u(-6), -u(0.5), u(12), u(0.12));
      // strongback
      ctx.fillStyle = '#74809a';
      ctx.fillRect(u(1.6), -u(11), u(0.7), u(11));
      ctx.fillStyle = '#5c6774';
      for (let i = 1; i < 9; i++) ctx.fillRect(u(1.6), -u(i * 1.25), u(1.35), u(0.09));
      ctx.fillRect(u(1.6), -u(11), u(1.4), u(0.2));
      // water tower
      ctx.fillStyle = '#e9ecef';
      ctx.beginPath(); ctx.arc(u(-8), -u(6.2), u(1.15), 0, 7); ctx.fill();
      ctx.fillStyle = '#f77f00';
      ctx.beginPath(); ctx.arc(u(-8), -u(6.2), u(1.15), Math.PI * 0.9, Math.PI * 1.55); ctx.lineTo(u(-8), -u(6.2)); ctx.fill();
      ctx.strokeStyle = '#98a1ab'; ctx.lineWidth = u(0.14);
      ctx.beginPath(); ctx.moveTo(u(-8.7), -u(5.3)); ctx.lineTo(u(-8.7), 0); ctx.moveTo(u(-7.3), -u(5.3)); ctx.lineTo(u(-7.3), 0); ctx.stroke();
      // hangar
      ctx.fillStyle = '#f4f1de';
      ctx.beginPath();
      ctx.moveTo(u(6.5), 0); ctx.lineTo(u(6.5), -u(2.6));
      ctx.arc(u(9.5), -u(2.6), u(3), Math.PI, 0);
      ctx.lineTo(u(12.5), 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e07a5f';
      ctx.fillRect(u(8.4), -u(2.2), u(2.2), u(2.2));
    },
    4: () => { // space agency: mega pad, gantry with arms, VAB, flags, crawlerway
      ctx.fillStyle = '#aab2bb';
      ctx.fillRect(u(-9), -u(0.9), u(18), u(0.9));
      ctx.fillStyle = '#929aa5';
      ctx.fillRect(u(-9), -u(0.9), u(18), u(0.18));
      // gantry tower
      ctx.fillStyle = '#c1666b';
      ctx.fillRect(u(2.6), -u(20), u(1.2), u(20));
      ctx.fillStyle = '#a34e52';
      for (let i = 1; i < 14; i++) ctx.fillRect(u(2.6), -u(i * 1.45), u(1.2), u(0.12));
      for (let i = 0; i < 4; i++) { // swing arms
        ctx.fillRect(u(1.3), -u(4 + i * 4), u(1.35), u(0.22));
      }
      ctx.fillStyle = '#e63946';
      ctx.fillRect(u(2.45), -u(21.2), u(1.5), u(1.3));
      // lightning mast
      ctx.strokeStyle = '#e9ecef'; ctx.lineWidth = u(0.1);
      ctx.beginPath(); ctx.moveTo(u(3.2), -u(21.2)); ctx.lineTo(u(3.2), -u(24)); ctx.stroke();
      // VAB in the distance
      ctx.fillStyle = '#dde3ea';
      ctx.fillRect(u(-16), -u(9), u(6.5), u(9));
      ctx.fillStyle = '#5390d9';
      ctx.fillRect(u(-14.6), -u(7.8), u(3.7), u(5.6));
      ctx.fillStyle = '#e63946';
      ctx.fillRect(u(-14.6), -u(7.8), u(3.7), u(0.8));
      ctx.fillStyle = '#f4f1de';
      ctx.fillRect(u(-13.2), -u(5.6), u(0.9), u(3.4));
      // flags
      for (let i = 0; i < 3; i++) {
        const x = -3.5 - i * 1.1;
        ctx.strokeStyle = '#e9ecef'; ctx.lineWidth = u(0.05);
        ctx.beginPath(); ctx.moveTo(u(x), -u(0.9)); ctx.lineTo(u(x), -u(2.6)); ctx.stroke();
        ctx.fillStyle = ['#e63946', '#5390d9', '#ffd166'][i];
        const wv = Math.sin(t * 2.4 + i) * u(0.06);
        ctx.beginPath();
        ctx.moveTo(u(x), -u(2.6));
        ctx.quadraticCurveTo(u(x + 0.45), -u(2.55) + wv, u(x + 0.75), -u(2.42) + wv);
        ctx.lineTo(u(x), -u(2.25)); ctx.closePath(); ctx.fill();
      }
    },
  };
  (props[tier] ?? props[0])();
  ctx.restore();
}

// Simple puffy cloud at origin, s = size px
export function drawCloud(ctx, s, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  for (const [dx, dy, r] of [[-0.6, 0, 0.42], [-0.15, -0.22, 0.55], [0.35, -0.05, 0.48], [0.75, 0.08, 0.35], [0, 0.1, 0.5]]) {
    ctx.beginPath(); ctx.arc(dx * s, dy * s, r * s, 0, 7); ctx.fill();
  }
  ctx.restore();
}

export { shade };
