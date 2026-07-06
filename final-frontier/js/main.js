// Screens, menus, company creation, tech tree, progression glue.
import { TIERS, tierForXp, nextTier } from './constants.js';
import { PARTS, PRESETS } from './parts.js';
import { fmtDist, fmtXp } from './util.js';
import * as save from './save.js';
import { Editor, drawDesignThumb } from './editor.js';
import { Flight } from './flight.js';

const $ = s => document.querySelector(s);
const screens = ['menu', 'build', 'flight', 'outcome'];
function show(name) { for (const s of screens) $('#screen-' + s).classList.toggle('hidden', s !== name); }

let editor, flight;
let lastDesign = null;

function firstUnlockedPreset() {
  const unlocked = save.unlockedTiers();
  const list = PRESETS.filter(p => unlocked.includes(p.tier));
  return list[list.length - 1] || PRESETS[0];
}

// ---------------------------------------------------------------- boot
function boot() {
  editor = new Editor();
  flight = new Flight();
  editor.onLaunch = design => { lastDesign = design; startFlight(design); };
  editor.onExit = () => { renderMenu(); show('menu'); };
  flight.onFinish = flightData => finishFlight(flightData);

  $('#btn-build').addEventListener('click', () => openBuild());
  $('#btn-tech').addEventListener('click', () => openTech(true));
  $('#tech-close').addEventListener('click', () => openTech(false));
  $('#btn-reset').addEventListener('click', () => {
    if (confirm('Reset ALL progress and start a new company?')) { save.resetAll(); location.reload(); }
  });
  $('#found-btn').addEventListener('click', foundCompany);
  $('#company-input').addEventListener('keydown', e => { if (e.key === 'Enter') foundCompany(); });
  $('#out-again').addEventListener('click', () => openBuild());
  $('#out-menu').addEventListener('click', () => { renderMenu(); show('menu'); });

  if (!save.hasCompany()) {
    $('#company-modal').classList.remove('hidden');
  } else {
    renderMenu(); show('menu');
  }
}

function foundCompany() {
  const name = $('#company-input').value.trim();
  if (!name) { $('#company-input').focus(); return; }
  const date = new Date().toISOString().slice(0, 10);
  save.createCompany(name, date);
  $('#company-modal').classList.add('hidden');
  renderMenu(); show('menu');
}

// ---------------------------------------------------------------- menu
function renderMenu() {
  const st = save.getState();
  const tier = tierForXp(st.xp);
  const next = nextTier(st.xp);
  $('#m-company').textContent = st.company || 'Star Labs';
  $('#m-tier').textContent = tier.emoji + ' ' + tier.name;
  $('#m-xp').textContent = fmtXp(st.xp) + ' XP';
  $('#m-best').textContent = 'Best altitude: ' + (st.bestAlt > 0 ? fmtDist(st.bestAlt) : '—');
  $('#m-goal').textContent = tier.goal;

  // progress to next tier
  const bar = $('#m-progress'); const lbl = $('#m-progress-label');
  if (next) {
    const span = next.xp - tier.xp;
    const done = st.xp - tier.xp;
    bar.style.width = clamp01(done / span) * 100 + '%';
    lbl.textContent = `${fmtXp(st.xp)} / ${fmtXp(next.xp)} XP → ${next.emoji} ${next.name}`;
    $('#m-progress-wrap').classList.remove('hidden');
  } else {
    bar.style.width = '100%';
    lbl.textContent = 'Top tier reached — you run the world\'s best rocket program! 🌍';
    $('#m-progress-wrap').classList.remove('hidden');
  }
}

// ---------------------------------------------------------------- build
function openBuild() {
  const design = lastDesign || firstUnlockedPreset();
  show('build');
  editor.open(design);
}

// ---------------------------------------------------------------- flight
function startFlight(design) {
  show('flight');
  // ensure canvas has layout size before starting
  requestAnimationFrame(() => flight.start(design));
}

function finishFlight(flightData) {
  const report = save.recordFlight(flightData);
  renderOutcome(flightData, report);
  show('outcome');
}

function renderOutcome(f, report) {
  $('#out-title').textContent = f.moon ? 'To the Moon! 🌙'
    : f.orbit ? 'Orbit achieved! 🛰️'
    : f.space ? 'You touched space! ✨'
    : f.recovered ? 'Rocket recovered 🪂'
    : 'Flight complete';

  $('#out-alt').textContent = fmtDist(f.maxAlt);
  $('#out-alt-label').textContent = f.orbit ? 'stable orbit' : f.space ? 'peak (in space)' : 'peak altitude';

  // xp breakdown
  const list = $('#out-lines'); list.innerHTML = '';
  for (const line of report.lines) {
    const row = document.createElement('div');
    row.className = 'out-line';
    row.innerHTML = `<span>${line.label}</span><b>+${fmtXp(line.xp)}</b>`;
    list.appendChild(row);
  }
  const total = document.createElement('div');
  total.className = 'out-line total';
  total.innerHTML = `<span>Total earned</span><b>+${fmtXp(report.xpGained)} XP</b>`;
  list.appendChild(total);

  // level up / unlocks
  const unlockBox = $('#out-unlocks');
  unlockBox.innerHTML = '';
  if (report.unlockedTiers.length) {
    for (const id of report.unlockedTiers) {
      const tier = TIERS.find(t => t.id === id);
      const div = document.createElement('div');
      div.className = 'out-unlock';
      div.innerHTML = `<div class="out-unlock-emoji">${tier.emoji}</div>
        <div><div class="out-unlock-title">New tier unlocked: ${tier.name}</div>
        <div class="out-unlock-sub">${tier.tagline}</div></div>`;
      unlockBox.appendChild(div);
    }
    unlockBox.classList.remove('hidden');
  } else {
    unlockBox.classList.add('hidden');
  }
}

// ---------------------------------------------------------------- tech tree
function openTech(open) {
  const modal = $('#tech-modal');
  if (!open) { modal.classList.add('hidden'); return; }
  modal.classList.remove('hidden');
  const body = $('#tech-body');
  body.innerHTML = '';
  const xp = save.getState().xp;
  for (const tier of TIERS) {
    const unlocked = xp >= tier.xp;
    const card = document.createElement('div');
    card.className = 'tech-card' + (unlocked ? '' : ' locked');
    const parts = Object.values(PARTS).filter(p => p.tier === tier.id);
    card.innerHTML = `
      <div class="tech-head">
        <span class="tech-emoji">${tier.emoji}</span>
        <div>
          <div class="tech-name">${tier.name} ${unlocked ? '' : '<span class="lock">🔒 ' + fmtXp(tier.xp) + ' XP</span>'}</div>
          <div class="tech-tag">${tier.tagline}</div>
        </div>
      </div>
      <div class="tech-goal">🎯 ${tier.goal}</div>
      <div class="tech-parts">${parts.map(p => `<span class="chip">${p.name}</span>`).join('')}</div>`;
    body.appendChild(card);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

boot();
