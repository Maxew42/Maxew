// Final Frontier — world physics, planet, progression config.
// A "toy" solar system tuned so that reaching orbit takes ~2 km/s of delta-v:
// small enough to be beginner-friendly, KSP-flavoured enough to feel real.

export const PHYS = {
  R: 250000,        // planet radius (m)
  g0: 9.8,          // surface gravity (m/s^2)
  atmoTop: 45000,   // top of the (drag-producing) atmosphere (m)
  karman: 50000,    // "space" begins here (m)
  rho0: 0.85,       // sea-level air density (toy kg/m^3)
  scaleH: 5600,     // atmosphere scale height (m)
};
// Standard gravitational parameter mu = g0 * R^2.
PHYS.mu = PHYS.g0 * PHYS.R * PHYS.R;
// Velocity of a circular orbit skimming the surface (reference number).
PHYS.vCircSurface = Math.sqrt(PHYS.mu / PHYS.R);
// Escape velocity at the surface.
PHYS.vEscape = Math.sqrt(2 * PHYS.mu / PHYS.R);

export const MOON = {
  dist: 3000000,    // orbital distance from planet centre (m)
  radius: 68000,    // moon radius (m)
};

// ---- Progression -----------------------------------------------------------
// Tiers unlock as the player's company gains XP. Each tier unlocks a family of
// parts and sets the narrative goal.
export const TIERS = [
  {
    id: 0, key: 'backyard', name: 'Backyard',
    xp: 0,
    emoji: '🧒',
    tagline: 'A kid, a bottle, and a dream.',
    goal: 'Pump it up and see how high a water rocket flies.',
  },
  {
    id: 1, key: 'student', name: 'Student Club',
    xp: 220,
    emoji: '🎓',
    tagline: 'Aluminium airframes and solid motors.',
    goal: 'Fly a controlled rocket and bring it home on a parachute.',
  },
  {
    id: 2, key: 'startup', name: 'Startup',
    xp: 1600,
    emoji: '🚀',
    tagline: 'Liquid engines. First taste of space.',
    goal: 'Cross the Kármán line at 50 km — touch space.',
  },
  {
    id: 3, key: 'newspace', name: 'New Space',
    xp: 12000,
    emoji: '🛰️',
    tagline: 'Multi-stage machines built to stay up.',
    goal: 'Reach a stable orbit — apoapsis AND periapsis above the atmosphere.',
  },
  {
    id: 4, key: 'nasa', name: 'National Program',
    xp: 60000,
    emoji: '🌙',
    tagline: 'Crewed giants aimed at the Moon.',
    goal: 'Send a crew on a free-return path to the Moon.',
  },
];

export function tierForXp(xp) {
  let t = TIERS[0];
  for (const tier of TIERS) if (xp >= tier.xp) t = tier;
  return t;
}
export function unlockedTierIds(xp) {
  return TIERS.filter(t => xp >= t.xp).map(t => t.id);
}
export function nextTier(xp) {
  return TIERS.find(t => xp < t.xp) || null;
}

// XP awarded for a flight, from the peak altitude reached (metres).
export function altitudeXp(maxAltM) {
  if (maxAltM <= 0) return 0;
  return Math.round(Math.pow(maxAltM, 0.72));
}

// One-time-ish milestone bonuses (also given as flat per-flight rewards).
export const MILESTONES = [
  { key: 'alt1k',  test: f => f.maxAlt >= 1000,             xp: 60,    label: 'Broke 1 km' },
  { key: 'alt10k', test: f => f.maxAlt >= 10000,            xp: 250,   label: 'Broke 10 km' },
  { key: 'space',  test: f => f.maxAlt >= PHYS.karman,      xp: 1500,  label: 'Reached space (50 km)' },
  { key: 'highspace', test: f => f.maxAlt >= 120000,        xp: 2500,  label: 'Deep space — 120 km' },
  { key: 'orbit',  test: f => f.orbit,                      xp: 9000,  label: 'Achieved orbit' },
  { key: 'crewOrbit', test: f => f.orbit && f.crew > 0,     xp: 6000,  label: 'Crewed orbit' },
  { key: 'moon',   test: f => f.moon,                       xp: 40000, label: 'Reached the Moon' },
  { key: 'crewMoon', test: f => f.moon && f.crew > 0,       xp: 25000, label: 'Crew to the Moon' },
  { key: 'safe',   test: f => f.recovered,                  xp: 120,   label: 'Safe recovery' },
];

// ---- Cute pastel palette ---------------------------------------------------
export const PAL = {
  space: '#0b1026',
  spaceDeep: '#05060f',
  skyLow: '#afe0ff',
  skyMid: '#7bb8f0',
  sun: '#fff2b0',
  ground: '#7fd18a',
  groundDark: '#4faa63',
  pad: '#b9c2cf',
  cloud: '#ffffff',
  ink: '#eaf1ff',
  panel: 'rgba(16,22,44,0.82)',
  accent: '#ffb3d9',
  accent2: '#8fd3ff',
  good: '#8df0a8',
  warn: '#ffd479',
  bad: '#ff8f8f',
  flame: '#ffd36b',
  flameHot: '#fff6d0',
};
