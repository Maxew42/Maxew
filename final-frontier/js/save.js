// Browser-persisted company progress: XP, unlocks, saved designs, records.
import { unlockedTierIds, tierForXp, MILESTONES, altitudeXp } from './constants.js';

const KEY = 'final-frontier-save-v1';

const DEFAULT = () => ({
  version: 1,
  company: null,          // set on first run
  founded: null,
  xp: 0,
  bestAlt: 0,
  launches: 0,
  achievements: {},       // milestone key -> true
  designs: [],            // saved custom designs
});

let state = load();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Object.assign(DEFAULT(), JSON.parse(raw));
  } catch (e) { /* ignore */ }
  return DEFAULT();
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* full/blocked */ }
}

export const getState = () => state;
export const hasCompany = () => !!state.company;

export function createCompany(name, isoDate) {
  state = DEFAULT();
  state.company = name.trim().slice(0, 28) || 'Star Labs';
  state.founded = isoDate || null;
  save();
}

export function resetAll() { state = DEFAULT(); save(); }

export const unlockedTiers = () => unlockedTierIds(state.xp);
export const currentTier = () => tierForXp(state.xp);
export const isTierUnlocked = id => unlockedTiers().includes(id);

// Saved designs -------------------------------------------------------------
export function saveDesign(design) {
  const clean = { name: design.name, tier: design.tier || 0, stack: design.stack.map(n => ({ id: n.id, radial: (n.radial || []).slice() })) };
  const idx = state.designs.findIndex(d => d.name === clean.name);
  if (idx >= 0) state.designs[idx] = clean; else state.designs.push(clean);
  save();
}
export function deleteDesign(name) {
  state.designs = state.designs.filter(d => d.name !== name);
  save();
}
export const savedDesigns = () => state.designs;

// Flight results ------------------------------------------------------------
// flight = { maxAlt, orbit, moon, space, crew, recovered }
// Returns a report of XP gained + newly unlocked things.
export function recordFlight(flight) {
  const before = { xp: state.xp, tiers: unlockedTiers().slice(), best: state.bestAlt };
  state.launches++;

  let xp = 0;
  const lines = [];

  const altXp = altitudeXp(flight.maxAlt);
  xp += altXp;
  lines.push({ label: 'Peak altitude', xp: altXp });

  // record bonus for a new personal best
  if (flight.maxAlt > state.bestAlt + 1) {
    const bonus = Math.round(altitudeXp(flight.maxAlt) * 0.3);
    xp += bonus;
    lines.push({ label: 'New altitude record!', xp: bonus });
    state.bestAlt = flight.maxAlt;
  }

  const newAch = [];
  for (const m of MILESTONES) {
    if (m.test(flight) && !state.achievements[m.key]) {
      state.achievements[m.key] = true;
      xp += m.xp;
      lines.push({ label: m.label, xp: m.xp });
      newAch.push(m);
    }
  }

  state.xp += xp;
  save();

  const after = { xp: state.xp, tiers: unlockedTiers() };
  const unlockedTierIdsNew = after.tiers.filter(id => !before.tiers.includes(id));

  return {
    xpGained: xp,
    lines,
    totalXp: state.xp,
    newAchievements: newAch,
    unlockedTiers: unlockedTierIdsNew,
    leveledUp: unlockedTierIdsNew.length > 0,
  };
}
