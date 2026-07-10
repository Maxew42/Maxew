// Final Frontier — app shell: onboarding, screen routing, tier celebrations.

import * as store from './save.js';
import { TIERS, tierForXP, fmtDist, MILESTONES } from './constants.js';
import { initBuilder, refreshBuilder } from './builder.js';
import { startFlight } from './flight.js';

const $ = (s) => document.querySelector(s);

const NAME_BITS_A = ['Bloo', 'Astro', 'Comet', 'Star', 'Luna', 'Nova', 'Orbit', 'Rocket', 'Cosmo', 'Apogee', 'Zenith', 'Fizz', 'Turbo', 'Moon'];
const NAME_BITS_B = ['Origin', 'Works', 'Dynamics', 'Labs', 'Express', 'Industries', '& Sons', 'Garage', 'Collective', 'Unlimited', 'Club', 'Co.'];

export function showScreen(id) {
  for (const s of ['onboard', 'builder', 'flight']) $('#' + s).classList.toggle('hidden', s !== id);
}

export function openModal(html) {
  $('#modalCard').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
export function closeModal() { $('#modal').classList.add('hidden'); }

// ---------- header ----------
export function refreshHeader() {
  const s = store.load();
  const tier = tierForXP(s.xp);
  const t = TIERS[tier];
  const next = TIERS[tier + 1];
  $('#companyBadge').textContent = (s.company || '?').trim()[0]?.toUpperCase() ?? '?';
  $('#companyName').textContent = s.company ?? '';
  $('#tierName').textContent = `Tier ${tier + 1} · ${t.name} — ${t.tag}`;
  const lo = t.unlockXP, hi = next?.unlockXP;
  const frac = next ? Math.min(1, (s.xp - lo) / (hi - lo)) : 1;
  $('#xpFill').style.width = `${(frac * 100).toFixed(1)}%`;
  $('#xpLabel').textContent = next
    ? `${s.xp} XP — ${next.unlockXP - s.xp} to "${next.name}"`
    : `${s.xp} XP — top tier reached ⭐`;
  $('#bestAlt').textContent = s.bestAlt > 0 ? `best flight\n${fmtDist(s.bestAlt)}` : 'no flights yet';
}

// ---------- milestones modal ----------
function showMilestones() {
  const s = store.load();
  const rows = MILESTONES.map(m => {
    const got = s.milestones.includes(m.id);
    return `<div class="mile-row ${got ? '' : 'locked'}">
      <span>${got ? '🏅' : '·'}</span>
      <span><b>${m.name}</b><br><span class="mdesc">${m.desc}</span></span>
      <span class="mxp">+${m.xp} XP</span>
    </div>`;
  }).join('');
  openModal(`
    <h2>🏆 Milestones</h2>
    <p style="font-size:13px;color:var(--ink-soft)">One-time XP rewards. ${s.milestones.length}/${MILESTONES.length} earned.</p>
    <div style="margin-top:12px">${rows}</div>
    <div class="modal-actions"><button class="btn primary" id="mClose">Close</button></div>
  `);
  $('#mClose').onclick = closeModal;
}

// ---------- tier-up celebration ----------
export function tierBannerHTML(oldXP, newXP) {
  const oldTier = tierForXP(oldXP), newTier = tierForXP(newXP);
  if (newTier <= oldTier) return '';
  const t = TIERS[newTier];
  return `<div class="tier-banner">🎉 Your company grew!<br><b>Tier ${newTier + 1}: ${t.name}</b><br>
    <span style="font-size:13px">${t.tag} — new parts and a bigger launch pad are waiting in the workshop.</span></div>`;
}

// ---------- onboarding ----------
function randomName() {
  const a = NAME_BITS_A[Math.floor(Math.random() * NAME_BITS_A.length)];
  const b = NAME_BITS_B[Math.floor(Math.random() * NAME_BITS_B.length)];
  return `${a} ${b}`;
}

function initOnboarding() {
  const input = $('#companyInput');
  input.value = randomName();
  $('#diceBtn').onclick = () => { input.value = randomName(); input.focus(); };
  const go = () => {
    const name = input.value.trim() || randomName();
    store.update({ company: name });
    enterBuilder();
  };
  $('#startBtn').onclick = go;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  showScreen('onboard');
  setTimeout(() => input.select(), 60);
}

// ---------- flow ----------
export function enterBuilder() {
  refreshHeader();
  refreshBuilder();
  showScreen('builder');
}

export function launchRocket(partIds) {
  showScreen('flight');
  startFlight(partIds);
}

// boot
const s = store.load();
initBuilder();
$('#milestonesBtn').onclick = showMilestones;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') { /* keep modal: force explicit button */ } });
if (!s.company) initOnboarding();
else enterBuilder();
