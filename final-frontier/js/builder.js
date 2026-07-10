// Final Frontier — the workshop / assembly bay.

import * as store from './save.js';
import { TIERS, tierForXP, fmtMass, fmtDist, G0 } from './constants.js';
import { PARTS, PART_BY_ID, rocketStats, parseEntry, entryPart } from './parts.js';
import { drawPartShape, drawFins, drawRocket, drawPad, drawCloud, stackHeight, shade } from './art.js';
import { refreshHeader, launchRocket } from './main.js';

const $ = (s) => document.querySelector(s);

let stack = [];          // part ids, top -> bottom
let selected = -1;       // index into stack
let bayCanvas, bayCtx;
let bayAnim = 0;

const TYPE_ORDER = { cone: 0, capsule: 0, chute: 1, guidance: 2, tank: 3, legs: 4, decoupler: 4.5, engine: 5, fins: 5.5 };

// ---------- palette ----------
function partIcon(p, w = 44, h = 52) {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const scale = Math.min((w - 10) / p.w, (h - 10) / (p.type === 'fins' ? p.h * 1.4 : p.h));
  ctx.translate(w / 2, (h - p.h * scale) / 2);
  if (p.type === 'fins') drawFins(ctx, p, p.w * scale, p.h * scale, p.w * scale * 0.36);
  else drawPartShape(ctx, p, p.w * scale, p.h * scale);
  return c;
}

function partStatsLine(p) {
  const bits = [fmtMass(p.mass + (p.tank?.prop ?? 0) + (p.engine?.prop ?? 0))];
  if (p.engine) {
    bits.push(`${p.engine.thrust >= 1000 ? (p.engine.thrust / 1000).toFixed(p.engine.thrust >= 100000 ? 0 : 1) + ' kN' : p.engine.thrust + ' N'}`);
    bits.push(`Isp ${p.engine.isp}s`);
    if (p.engine.gimbal) bits.push(`↔${p.engine.gimbal}°`);
  }
  if (p.tank?.prop) bits.push(`⛽ ${fmtMass(p.tank.prop)}`);
  if (p.chute) bits.push(`≤${p.chute.maxDeploy} m/s`);
  if (p.fins) bits.push(p.fins.control ? 'steerable' : 'stability');
  if (p.guidance) bits.push('SAS · map');
  if (p.capsule) bits.push(`👩‍🚀×${p.capsule.crew}`);
  return bits.join(' · ');
}

function renderPalette() {
  const s = store.load();
  const tier = tierForXP(s.xp);
  const showAll = s.showAll;
  const list = $('#partList');
  list.innerHTML = '';
  const groups = new Map();
  for (const p of PARTS) {
    if (p.tier > tier + 1) continue;               // future tiers beyond next: hidden entirely
    if (!showAll && p.tier < tier) continue;       // default: current tier only (+ next as teaser)
    if (!groups.has(p.tier)) groups.set(p.tier, []);
    groups.get(p.tier).push(p);
  }
  // current tier first, then older tiers, locked teaser last
  const order = [...groups.entries()].sort((a, b) => {
    const la = a[0] > tier, lb = b[0] > tier;
    if (la !== lb) return la ? 1 : -1;
    return b[0] - a[0];
  });
  for (const [t, parts] of order) {
    const locked = t > tier;
    const label = document.createElement('div');
    label.className = 'tier-label';
    label.textContent = locked
      ? `🔒 ${TIERS[t].name} — at ${TIERS[t].unlockXP} XP`
      : `${TIERS[t].name}${t === tier ? '' : ' (older)'}`;
    list.appendChild(label);
    for (const p of parts) {
      const card = document.createElement('div');
      card.className = 'part-card' + (locked ? ' locked' : '');
      card.title = locked ? `Unlocks with the ${TIERS[t].name} tier` : p.blurb;
      card.appendChild(partIcon(p));
      const meta = document.createElement('div');
      meta.innerHTML = `<div class="pc-name">${p.name}</div><div class="pc-stats">${locked ? '???' : partStatsLine(p)}</div>`;
      card.appendChild(meta);
      if (locked) {
        const lock = document.createElement('span');
        lock.className = 'pc-lock'; lock.textContent = '🔒';
        card.appendChild(lock);
      } else {
        card.onclick = () => addPart(p.id);
        if (p.radialOk && tier >= 3) {
          const side = document.createElement('button');
          side.className = 'pc-side';
          side.textContent = '⊻⊻ side ×2';
          side.title = 'Strap a symmetric pair to the sides of the bottom stage (jettisons itself when spent)';
          side.onclick = (e) => { e.stopPropagation(); addPart('R:' + p.id); };
          card.appendChild(side);
        } else if (p.radialOk) {
          const side = document.createElement('span');
          side.className = 'pc-side locked';
          side.textContent = '⊻⊻ side 🔒T4';
          side.title = 'Side mounting unlocks with the New Space tier';
          card.appendChild(side);
        }
      }
      list.appendChild(card);
    }
  }
}

// ---------- stack ops ----------
function smartInsertIndex(p, radial) {
  if (!radial && selected >= 0 && selected < stack.length) return selected; // above selected
  const pr = radial ? 6 : (TYPE_ORDER[p.type] ?? 3);
  let idx = stack.length;
  for (let i = 0; i < stack.length; i++) {
    const e = parseEntry(stack[i]);
    const other = e.radial ? 6 : (TYPE_ORDER[entryPart(stack[i]).type] ?? 3);
    if (other > pr) { idx = i; break; }
  }
  return idx;
}

function addPart(entry) {
  const { id, radial } = parseEntry(entry);
  const p = PART_BY_ID[id];
  const idx = smartInsertIndex(p, radial);
  stack.splice(idx, 0, entry);
  selected = idx;
  onStackChange();
  wiggle = 1;
}

function onStackChange() {
  store.update({ rocket: [...stack] });
  renderStats();
  updateActions();
}

function updateActions() {
  $('#partActions').classList.toggle('hidden', selected < 0);
}

// ---------- stats panel ----------
function renderStats() {
  const el = $('#statTotals');
  const stagesEl = $('#stageList');
  const warnEl = $('#warnList');
  if (!stack.length) {
    el.innerHTML = `<i style="color:var(--ink-soft)">Click parts on the left to build.<br>Top of the list = nose of the rocket.</i>`;
    stagesEl.innerHTML = ''; warnEl.innerHTML = '';
    $('#launchBtn').disabled = true;
    return;
  }
  const st = rocketStats(stack);
  el.innerHTML = `
    Mass <b>${fmtMass(st.totalWet)}</b><br>
    Height <b>${st.height.toFixed(st.height < 3 ? 2 : 1)} m</b><br>
    Total Δv <b>${st.totalDeltaV.toFixed(0)} m/s</b><br>
    Instruments <b>${st.hasGuidance ? 'full 🛰' : 'basic'}</b>
  `;
  stagesEl.innerHTML = st.stageStats.map((sg, i) => {
    if (!sg.parts.length) return '';
    const twrCls = sg.twr === 0 ? '' : sg.twr > 1.02 ? 'good' : 'bad';
    return `<div class="stage-card">
      <div class="st-title">STAGE ${i + 1}${i === 0 ? ' · fires first' : ''}${sg.hasBoosters ? ' · +side pair' : ''}</div>
      ${sg.thrust > 0 ? `
        <div class="st-row"><span>Δv</span><b>${sg.deltaV.toFixed(0)} m/s</b></div>
        <div class="st-row"><span>TWR</span><b class="${twrCls}">${sg.twr.toFixed(2)}</b></div>
        <div class="st-row"><span>Burn</span><b>${sg.burnTime.toFixed(sg.burnTime < 10 ? 1 : 0)} s</b></div>`
        : `<div class="st-row"><span>No engine — payload</span></div>`}
    </div>`;
  }).join('');
  warnEl.innerHTML = st.warnings.map(w => `<div class="warn ${w.level}">${w.level === 'err' ? '⛔' : w.level === 'warn' ? '⚠️' : '💡'} ${w.msg}</div>`).join('');
  $('#launchBtn').disabled = st.warnings.some(w => w.level === 'err');
}

// ---------- bay canvas ----------
let wiggle = 0;

function bayLayout() {
  const rect = bayCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (bayCanvas.width !== Math.round(rect.width * dpr)) {
    bayCanvas.width = Math.round(rect.width * dpr);
    bayCanvas.height = Math.round(rect.height * dpr);
  }
  return { w: rect.width, h: rect.height, dpr };
}

function stackForDraw() {
  return stack.map(e => { const { radial } = parseEntry(e); return { p: entryPart(e), radial }; });
}

// One coherent scale for pad + rocket: the scene is as tall as the launch
// installation of the current tier, or the rocket if it's bigger.
const PAD_SCENE_H = [2.6, 3.8, 4.6, 13, 27];

function bayPpm(w, h) {
  const s = store.load();
  const tier = tierForXP(s.xp);
  const parts = stackForDraw();
  const Hm = Math.max(stackHeight(parts) * 1.45 + 0.4, PAD_SCENE_H[tier]);
  const coreW = Math.max(0.09, ...parts.filter(x => !x.radial && x.p.type !== 'fins').map(x => x.p.w));
  const sideW = parts.filter(x => x.radial).reduce((m, x) => Math.max(m, x.p.w), 0);
  const totalW = coreW + 2.2 * sideW + 0.4;
  return Math.min(h * 0.8 / Hm, w * 0.5 / totalW);
}

function drawBay(t) {
  const { w, h, dpr } = bayLayout();
  const ctx = bayCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = store.load();
  const tier = tierForXP(s.xp);

  // sky
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#bfe3f7'); g.addColorStop(0.75, '#e8f6fd'); g.addColorStop(1, '#d9f0db');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // sun
  ctx.fillStyle = '#ffe28a';
  ctx.beginPath(); ctx.arc(w - 70, 64, 30, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,102,.6)'; ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + t * 0.1;
    ctx.beginPath();
    ctx.moveTo(w - 70 + Math.cos(a) * 38, 64 + Math.sin(a) * 38);
    ctx.lineTo(w - 70 + Math.cos(a) * 46, 64 + Math.sin(a) * 46);
    ctx.stroke();
  }
  // clouds
  drawCloud(ctx, 30, 0.9), ctx.save();
  ctx.translate((t * 6) % (w + 160) - 80, h * 0.18); drawCloud(ctx, 26, 0.85); ctx.restore();
  ctx.save(); ctx.translate((t * 3.4 + 300) % (w + 160) - 80, h * 0.3); drawCloud(ctx, 34, 0.7); ctx.restore();
  ctx.save(); ctx.translate((t * 4.6 + 620) % (w + 160) - 80, h * 0.09); drawCloud(ctx, 20, 0.8); ctx.restore();

  // ground
  const groundY = h * 0.86;
  ctx.fillStyle = '#8fce7f';
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = '#7bbf6a';
  ctx.fillRect(0, groundY, w, 5);

  // pad drawn at the SAME scale as the rocket — one coherent scene
  const scenePpm = bayPpm(w, h);
  ctx.save();
  ctx.translate(w / 2, groundY);
  drawPad(ctx, tier, scenePpm, t);
  ctx.restore();

  // rocket
  if (stack.length) {
    const ppm = scenePpm;
    const wig = wiggle > 0 ? Math.sin(t * 26) * wiggle * 0.04 : 0;
    ctx.save();
    ctx.translate(w / 2, groundY);
    ctx.rotate(wig);
    drawRocket(ctx, stackForDraw(), ppm, { selectedIdx: selected });
    ctx.restore();
    if (wiggle > 0) wiggle = Math.max(0, wiggle - 0.05);
    // height ruler
    const Hm = stackHeight(stackForDraw());
    ctx.strokeStyle = 'rgba(61,64,91,.35)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(w / 2 + 90, groundY); ctx.lineTo(w / 2 + 90, groundY - Hm * ppm);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(61,64,91,.6)';
    ctx.font = '12px "Arial Rounded MT Bold", sans-serif';
    ctx.fillText(`${Hm.toFixed(Hm < 3 ? 2 : 1)} m`, w / 2 + 96, groundY - Hm * ppm / 2);
  } else {
    ctx.fillStyle = 'rgba(61,64,91,.45)';
    ctx.font = '15px "Arial Rounded MT Bold", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⟵ pick parts to start building', w / 2, h * 0.4);
    ctx.textAlign = 'left';
  }
}

function bayHitTest(mx, my) {
  const { w, h } = bayLayout();
  if (!stack.length) return -1;
  const ppm = bayPpm(w, h);
  const groundY = h * 0.86;
  const parts = stackForDraw();
  const Hm = stackHeight(parts);
  // radial boosters first: they sit beside the base
  const coreHalf = (parts.filter(x => !x.radial && x.p.type !== 'fins').at(-1)?.p.w ?? 0.1) / 2 * ppm;
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].radial) continue;
    const p = parts[i].p;
    const offX = coreHalf + p.w * ppm * 0.52;
    if (my >= groundY - p.h * ppm && my <= groundY &&
        (Math.abs(mx - w / 2 - offX) <= p.w * ppm / 2 + 4 || Math.abs(mx - w / 2 + offX) <= p.w * ppm / 2 + 4)) return i;
  }
  let y = groundY - Hm * ppm;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].radial) continue;
    const p = parts[i].p;
    const ph = (p.type === 'fins' ? 0 : p.h) * ppm;
    const halfW = Math.max(p.w * ppm / 2, 18) + (p.type === 'fins' ? 10 : 0);
    let hit;
    if (p.type === 'fins') {
      const isBottom = !parts.slice(i + 1).some(q => q.p.type !== 'fins');
      const y0 = isBottom ? y - p.h * ppm * 1.3 : y - 4;
      const y1 = isBottom ? y + 4 : y + p.h * ppm * 1.3;
      hit = my >= y0 && my <= y1 && Math.abs(mx - w / 2) <= p.w * ppm / 2 + 8;
    } else {
      hit = my >= y && my <= y + ph && Math.abs(mx - w / 2) <= halfW;
    }
    if (hit) return i;
    y += ph;
  }
  return -1;
}

// ---------- actions ----------
function doAction(act) {
  if (selected < 0) return;
  if (act === 'del') {
    stack.splice(selected, 1);
    selected = Math.min(selected, stack.length - 1);
    if (!stack.length) selected = -1;
  } else if (act === 'dup') {
    stack.splice(selected, 0, stack[selected]);
  } else if (act === 'up' && selected > 0) {
    [stack[selected - 1], stack[selected]] = [stack[selected], stack[selected - 1]];
    selected--;
  } else if (act === 'down' && selected < stack.length - 1) {
    [stack[selected + 1], stack[selected]] = [stack[selected], stack[selected + 1]];
    selected++;
  }
  onStackChange();
}

// ---------- public ----------
export function initBuilder() {
  bayCanvas = $('#bayCanvas');
  bayCtx = bayCanvas.getContext('2d');
  const s = store.load();
  stack = s.rocket ? s.rocket.filter(e => PART_BY_ID[parseEntry(e).id]) : ['cone-paper', 'bottle-s', 'fins-cardboard'];
  $('#rocketName').value = s.rocketName || '';
  $('#showAll').checked = !!s.showAll;

  $('#showAll').onchange = (e) => { store.update({ showAll: e.target.checked }); renderPalette(); };
  $('#rocketName').oninput = (e) => store.update({ rocketName: e.target.value });
  $('#clearBtn').onclick = () => { stack = []; selected = -1; onStackChange(); };
  $('#launchBtn').onclick = () => {
    if (!stack.length) return;
    launchRocket([...stack]);
  };
  for (const b of document.querySelectorAll('#partActions button')) {
    b.onclick = (e) => { e.stopPropagation(); doAction(b.dataset.act); };
  }
  bayCanvas.addEventListener('pointerdown', (e) => {
    const rect = bayCanvas.getBoundingClientRect();
    const hit = bayHitTest(e.clientX - rect.left, e.clientY - rect.top);
    selected = hit;
    updateActions();
  });

  const loop = (ms) => {
    if (!$('#builder').classList.contains('hidden')) drawBay(ms / 1000);
    bayAnim = requestAnimationFrame(loop);
  };
  bayAnim = requestAnimationFrame(loop);
  onStackChange();
}

export function refreshBuilder() {
  const s = store.load();
  stack = (s.rocket ?? stack).filter(e => PART_BY_ID[parseEntry(e).id]);
  renderPalette();
  renderStats();
  updateActions();
}
