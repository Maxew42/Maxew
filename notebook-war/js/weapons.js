// Weapon definitions. Tiers drive spawn odds: high tier = rare.
// kind: 'melee' | 'gun' | 'thrown' | 'placed'
// Ammo never refills — swap or throw your empty weapon at someone's face.

export const WEAPONS = {
  hands: {
    name: 'Poings', tier: 0, kind: 'melee',
    dmg: 8, rate: 3.0, range: 34, ammo: Infinity, throwDmg: 0, knock: 260,
  },
  knife: {
    name: 'Couteau', tier: 1, kind: 'melee',
    dmg: 17, rate: 3.2, range: 40, ammo: Infinity, throwDmg: 30, knock: 140,
  },
  tomahawk: {
    name: 'Tomahawk', tier: 2, kind: 'melee',
    dmg: 28, rate: 1.8, range: 46, ammo: Infinity, throwDmg: 55, knock: 220,
  },
  pistol: {
    name: 'Pistolet', tier: 1, kind: 'gun',
    dmg: 8, rate: 6.5, ammo: 64, spread: 0.035, vel: 950, range: 700, recoil: 1.4,
  },
  deagle: {
    name: 'Desert Eagle', tier: 2, kind: 'gun',
    dmg: 34, rate: 1.9, ammo: 21, spread: 0.012, vel: 1250, range: 1200, recoil: 5,
  },
  shotgun: {
    name: 'Fusil à pompe', tier: 2, kind: 'gun',
    dmg: 8, pellets: 7, rate: 1.15, ammo: 18, spread: 0.15, vel: 900, range: 330, recoil: 6, knock: 320,
  },
  m4: {
    name: 'M4', tier: 3, kind: 'gun',
    dmg: 11, rate: 10.5, ammo: 90, spread: 0.028, vel: 1100, range: 900, recoil: 1.6,
  },
  ak47: {
    name: 'AK-47', tier: 3, kind: 'gun',
    dmg: 15, rate: 8.5, ammo: 72, spread: 0.05, vel: 1080, range: 900, recoil: 2.6,
  },
  shield: {
    name: 'Bouclier + pistolet', tier: 3, kind: 'gun',
    dmg: 8, rate: 4.0, ammo: 84, spread: 0.05, vel: 950, range: 650, recoil: 1.2,
    shielded: true, slow: 0.78,
  },
  flamer: {
    name: 'Lance-flammes', tier: 3, kind: 'gun',
    dmg: 6, rate: 24, ammo: 140, spread: 0.14, vel: 430, range: 235, recoil: 0.4,
    flame: true, burn: 2.0,
  },
  grenade: {
    name: 'Grenade', tier: 2, kind: 'thrown',
    dmg: 0, rate: 1.1, ammo: 4, fuse: 2.3, blastR: 105, blastDmg: 85, breaks: true, throwVel: 620,
  },
  smoke: {
    name: 'Fumigène', tier: 1, kind: 'thrown',
    dmg: 0, rate: 1.1, ammo: 3, fuse: 1.6, smokeR: 105, smokeT: 10, throwVel: 620,
  },
  mine: {
    name: 'Mine', tier: 2, kind: 'placed',
    dmg: 0, rate: 1.4, ammo: 3, blastR: 95, blastDmg: 95, breaks: true,
  },
  bazooka: {
    name: 'Bazooka', tier: 4, kind: 'gun',
    dmg: 30, rate: 0.8, ammo: 4, spread: 0.01, vel: 640, range: 1400, recoil: 9,
    rocket: true, blastR: 125, blastDmg: 105, breaks: true,
  },
  negev: {
    name: 'Negev', tier: 4, kind: 'gun',
    dmg: 12, rate: 12.5, ammo: 150, spread: 0.02, spreadMax: 0.1, vel: 1050, range: 850,
    recoil: 3.2, push: 60, slow: 0.9,
  },
  awp: {
    name: 'AWP', tier: 4, kind: 'gun',
    dmg: 112, rate: 0.65, ammo: 10, spread: 0.002, vel: 2300, range: 1700, recoil: 12,
    scope: true,
  },
};

// Throwing any weapon deals at least this much on a direct hit.
export const THROW_BASE_DMG = 20;

// Spawn odds by tier (tier 0 = hands, never spawns).
const TIER_WEIGHT = { 1: 40, 2: 30, 3: 21, 4: 9 };

const byTier = t => Object.keys(WEAPONS).filter(k => WEAPONS[k].tier === t);

// Pick a weapon key, weighted by tier rarity.
export function randomWeapon(rng = Math.random) {
  let total = 0;
  for (const t in TIER_WEIGHT) total += TIER_WEIGHT[t];
  let r = rng() * total;
  for (const t in TIER_WEIGHT) {
    r -= TIER_WEIGHT[t];
    if (r <= 0) return pickFrom(byTier(+t), rng);
  }
  return 'pistol';
}

function pickFrom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// Loot (non-weapon pickups).
export const LOOT = {
  vest:   { name: 'Gilet pare-balles', weight: 22 },
  helmet: { name: 'Casque', weight: 20 },
  med:    { name: 'Trousse de soin', weight: 30 },
  drug:   { name: 'Stimulants', weight: 16 },
  jet:    { name: 'Jetpack', weight: 12 },
};

export function randomLoot(rng = Math.random) {
  let total = 0;
  for (const k in LOOT) total += LOOT[k].weight;
  let r = rng() * total;
  for (const k in LOOT) {
    r -= LOOT[k].weight;
    if (r <= 0) return k;
  }
  return 'med';
}
