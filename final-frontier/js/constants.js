// Final Frontier — world constants, tiers, XP milestones.
// Pure data/config. Importable headless (node) and in browser.

export const G0 = 9.81; // reference gravity for Isp

// A cozy toy planet, scaled so that orbit needs ~2.3-2.8 km/s of delta-v.
export const PLANET = {
  name: 'Bloo',
  R: 250_000,               // radius, m
  mu: 9.81 * 250_000 ** 2,  // = g0 * R^2  -> surface gravity 9.81
  rho0: 1.225,              // sea-level air density
  atmoH: 5_600,             // scale height, m
  atmoTop: 45_000,          // above this: vacuum
  spaceLine: 50_000,        // "You're in SPACE" line
};

export const MOON = {
  name: 'Croissant',
  R: 80_000,
  mu: 1.04e10,              // surface gravity ~1.6 m/s^2
  orbitR: 5_000_000,
  startAngle: 2.3,          // rad, position at t=0
};
// Sphere of influence  a*(mu_m/mu_p)^(2/5)
MOON.soi = MOON.orbitR * Math.pow(MOON.mu / PLANET.mu, 0.4);
// Circular orbit angular rate of the moon
MOON.n = Math.sqrt(PLANET.mu / MOON.orbitR ** 3);

export const TIERS = [
  { id: 0, name: 'Backyard',       tag: 'Water, tape & big dreams',      unlockXP: 0 },
  { id: 1, name: 'Student Club',   tag: 'Real motors. Real parachutes.', unlockXP: 40 },
  { id: 2, name: 'Startup',        tag: 'Touch space. Scare investors.', unlockXP: 160 },
  { id: 3, name: 'New Space',      tag: 'Stages, orbits, glory',         unlockXP: 400 },
  { id: 4, name: 'Space Agency',   tag: 'Crews, moonshots, history',     unlockXP: 900 },
];

export function tierForXP(xp) {
  let t = 0;
  for (const tier of TIERS) if (xp >= tier.unlockXP) t = tier.id;
  return t;
}

// One-time milestones. `test` runs on the end-of-flight summary.
export const MILESTONES = [
  { id: 'liftoff',   xp: 5,   name: 'Liftoff!',            desc: 'Leave the ground',            test: s => s.maxAlt > 2 },
  { id: 'alt50',     xp: 5,   name: 'Over the roof',       desc: 'Reach 50 m',                  test: s => s.maxAlt >= 50 },
  { id: 'alt100',    xp: 8,   name: 'Treetop tickler',     desc: 'Reach 100 m',                 test: s => s.maxAlt >= 100 },
  { id: 'alt150',    xp: 10,  name: 'Higher than birds',   desc: 'Reach 150 m',                 test: s => s.maxAlt >= 150 },
  { id: 'alt250',    xp: 12,  name: 'Tiny dot',            desc: 'Reach 250 m',                 test: s => s.maxAlt >= 250 },
  { id: 'recovery',  xp: 10,  name: 'Gentle landing',      desc: 'Recover a rocket softly',     test: s => s.landedSafe },
  { id: 'alt500',    xp: 14,  name: 'Half a kilometer',    desc: 'Reach 500 m',                 test: s => s.maxAlt >= 500 },
  { id: 'alt1k',     xp: 16,  name: 'Kilometer club',      desc: 'Reach 1 km',                  test: s => s.maxAlt >= 1_000 },
  { id: 'spd100',    xp: 8,   name: 'Highway speed ×3',    desc: 'Reach 100 m/s',               test: s => s.maxSpeed >= 100 },
  { id: 'alt2k',     xp: 18,  name: 'Cloud surfer',        desc: 'Reach 2 km',                  test: s => s.maxAlt >= 2_000 },
  { id: 'spd340',    xp: 15,  name: 'Boom! (sonic)',       desc: 'Go supersonic (340 m/s)',     test: s => s.maxSpeed >= 340 },
  { id: 'alt5k',     xp: 22,  name: 'Airliner altitude',   desc: 'Reach 5 km',                  test: s => s.maxAlt >= 5_000 },
  { id: 'alt10k',    xp: 26,  name: 'Thin air',            desc: 'Reach 10 km',                 test: s => s.maxAlt >= 10_000 },
  { id: 'alt25k',    xp: 32,  name: 'Stratos-baby',        desc: 'Reach 25 km',                 test: s => s.maxAlt >= 25_000 },
  { id: 'alt35k',    xp: 35,  name: 'Edge of the sky',     desc: 'Reach 35 km',                 test: s => s.maxAlt >= 35_000 },
  { id: 'space',     xp: 60,  name: 'SPACE!',              desc: 'Cross the 50 km space line',  test: s => s.maxAlt >= PLANET.spaceLine },
  { id: 'spd1k',     xp: 25,  name: 'Kilometer a second',  desc: 'Reach 1000 m/s',              test: s => s.maxSpeed >= 1_000 },
  { id: 'alt100k',   xp: 45,  name: 'Deep black',          desc: 'Reach 100 km',                test: s => s.maxAlt >= 100_000 },
  { id: 'alt200k',   xp: 35,  name: 'Higher still',        desc: 'Reach 200 km',                test: s => s.maxAlt >= 200_000 },
  { id: 'orbit',     xp: 150, name: 'ORBIT.',              desc: 'Periapsis above the air',     test: s => s.orbitAchieved },
  { id: 'orbitHome', xp: 60,  name: 'There and back',      desc: 'Orbit, then land softly',     test: s => s.orbitAchieved && s.landedSafe },
  { id: 'alt500k',   xp: 45,  name: 'Quarter million club',desc: 'Reach 500 km',                test: s => s.maxAlt >= 500_000 },
  { id: 'alt1m',     xp: 50,  name: 'Gravity is a suggestion', desc: 'Reach 1000 km',           test: s => s.maxAlt >= 1_000_000 },
  { id: 'crewed',    xp: 25,  name: 'Somebody on board',   desc: 'Fly a crewed capsule',        test: s => s.crewed && s.maxAlt > 1000 },
  { id: 'moonSoi',   xp: 200, name: 'Road to the Moon',    desc: `Enter ${MOON.name}'s sphere of influence`, test: s => s.moonSoi },
  { id: 'moonLand',  xp: 300, name: 'One small step',      desc: 'Land softly on the Moon',     test: s => s.moonLanded },
  { id: 'crewHome',  xp: 80,  name: 'Heroes come home',    desc: 'Crew to orbit and safely back', test: s => s.crewed && s.orbitAchieved && s.landedSafe },
];

// Repeatable per-flight XP (small; full when beating your best altitude).
export function flightXP(maxAlt, isNewBest) {
  const base = Math.round(6 * Math.log10(1 + maxAlt));
  return isNewBest ? base : Math.max(1, Math.ceil(base * 0.25));
}

export function fmtDist(m) {
  if (!isFinite(m)) return '—';
  const neg = m < 0; const a = Math.abs(m);
  let s;
  if (a < 1000) s = `${a.toFixed(0)} m`;
  else if (a < 100_000) s = `${(a / 1000).toFixed(2)} km`;
  else if (a < 10_000_000) s = `${(a / 1000).toFixed(0)} km`;
  else s = `${(a / 1_000_000).toFixed(2)} Mm`;
  return neg ? '−' + s : s;
}

export function fmtSpeed(v) {
  if (!isFinite(v)) return '—';
  return v < 3000 ? `${v.toFixed(v < 30 ? 1 : 0)} m/s` : `${(v / 1000).toFixed(2)} km/s`;
}

export function fmtMass(kg) {
  return kg < 3 ? `${(kg * 1000).toFixed(0)} g` : kg < 1000 ? `${kg.toFixed(1)} kg` : `${(kg / 1000).toFixed(2)} t`;
}

export function fmtTime(s) {
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
