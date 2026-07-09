import { STORAGE_KEY, MILESTONES, tierForXp, nextTierForXp } from "./data.js";

const DEFAULT_SAVE = {
  version: 2,
  company: "",
  xp: 0,
  bestAltitude: 0,
  bestSpeed: 0,
  bestApoapsis: 0,
  bestPeriapsis: -Infinity,
  orbitAchieved: false,
  moonRoad: false,
  milestones: [],
  blueprints: [],
  lastRocketName: "First Spark",
};

function cleanSave(raw) {
  const save = { ...DEFAULT_SAVE, ...(raw || {}) };
  save.xp = Math.max(0, Number(save.xp) || 0);
  save.bestAltitude = Math.max(0, Number(save.bestAltitude) || 0);
  save.bestSpeed = Math.max(0, Number(save.bestSpeed) || 0);
  save.bestApoapsis = Math.max(0, Number(save.bestApoapsis) || 0);
  save.bestPeriapsis = Number.isFinite(save.bestPeriapsis) ? save.bestPeriapsis : -Infinity;
  save.milestones = Array.isArray(save.milestones) ? save.milestones : [];
  save.blueprints = Array.isArray(save.blueprints) ? save.blueprints : [];
  return save;
}

export function loadSave() {
  try {
    return cleanSave(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch (err) {
    return cleanSave(null);
  }
}

export function storeSave(save) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanSave(save)));
}

export function resetSave() {
  localStorage.removeItem(STORAGE_KEY);
  return loadSave();
}

export function currentTier(save) {
  return tierForXp(save.xp);
}

export function nextTier(save) {
  return nextTierForXp(save.xp);
}

function altitudeXpFor(meters) {
  if (meters <= 0) return 0;
  return Math.floor(80 * Math.log10(1 + meters / 20));
}

export function applyFlightRewards(save, flight) {
  const beforeTier = currentTier(save);
  const rewardLines = [];
  let gained = 0;

  const previousAltitudeXp = altitudeXpFor(save.bestAltitude);
  const newAltitudeXp = altitudeXpFor(Math.max(save.bestAltitude, flight.maxAltitude));
  const altitudeGain = Math.max(0, newAltitudeXp - previousAltitudeXp);
  if (altitudeGain > 0) {
    gained += altitudeGain;
    rewardLines.push({ label: "New altitude record", xp: altitudeGain });
  }

  const previousMilestones = new Set(save.milestones);
  for (const milestone of MILESTONES) {
    if (!previousMilestones.has(milestone.id) && milestone.test(flight)) {
      save.milestones.push(milestone.id);
      gained += milestone.xp;
      rewardLines.push({ label: milestone.label, xp: milestone.xp });
    }
  }

  save.xp += gained;
  save.bestAltitude = Math.max(save.bestAltitude, flight.maxAltitude);
  save.bestSpeed = Math.max(save.bestSpeed, flight.maxSpeed);
  save.bestApoapsis = Math.max(save.bestApoapsis, flight.apoapsis);
  save.bestPeriapsis = Math.max(save.bestPeriapsis, flight.periapsis);
  save.orbitAchieved = save.orbitAchieved || flight.orbitAchieved;
  save.moonRoad = save.moonRoad || flight.moonRoad;

  const afterTier = currentTier(save);
  storeSave(save);

  return {
    gained,
    rewardLines,
    unlockedTier: afterTier.id > beforeTier.id ? afterTier : null,
  };
}

export function saveBlueprint(save, design) {
  const clean = {
    id: design.id || String(Date.now()),
    name: design.name || "Untitled Rocket",
    parts: design.parts.map(partId => String(partId)),
    savedAt: Date.now(),
  };
  const existing = save.blueprints.findIndex(bp => bp.name.toLowerCase() === clean.name.toLowerCase());
  if (existing >= 0) save.blueprints.splice(existing, 1, clean);
  else save.blueprints.unshift(clean);
  save.blueprints = save.blueprints.slice(0, 18);
  save.lastRocketName = clean.name;
  storeSave(save);
  return clean;
}

export function deleteBlueprint(save, id) {
  save.blueprints = save.blueprints.filter(bp => bp.id !== id);
  storeSave(save);
}
