// Illustrations de remplacement, dessinées par le programme.
//
// Chaque carte reçoit un paysage déterministe tiré de son identifiant : deux
// parties affichent toujours la même image pour la même carte, et rien n'est
// téléchargé, ce qui laisse l'application jouable hors-ligne. Dès qu'une vraie
// illustration existe, la colonne « Illustration » du classeur ou le Studio la
// remplace sans toucher à ce fichier.

import { KIND } from '../data/schema.js';

/** Petit générateur pseudo-aléatoire semé par une chaîne. */
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 0x100000000;
  };
}

function hsl(h, s, l, a = 1) {
  return `hsla(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}% / ${a})`;
}

/** Teinte d'une couleur hexadécimale, pour accorder le paysage à la faction. */
function hueOf(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return 30;
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 30;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const W = 300, H = 200;

/**
 * SVG d'illustration pour une carte ou un lieu.
 * `record` est la fiche du classeur, `color` la couleur de faction retenue.
 */
export function proceduralArt(record, color) {
  const rng = seeded(`${record.id}|${record.name}`);
  const hue = (hueOf(color) + (rng() - 0.5) * 26 + 360) % 360;
  const parts = [];

  // Ciel dégradé et astre.
  const skyTop = hsl(hue, 26, 12);
  const skyLow = hsl((hue + 24) % 360, 42, 34);
  parts.push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyLow}"/>
  </linearGradient></defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);

  const orbX = 40 + rng() * (W - 80);
  const orbY = 30 + rng() * 46;
  const orbR = 14 + rng() * 16;
  parts.push(`<circle cx="${orbX.toFixed(1)}" cy="${orbY.toFixed(1)}" r="${orbR.toFixed(1)}"
    fill="${hsl((hue + 40) % 360, 70, 74, 0.55)}"/>`);

  // Étoiles.
  for (let i = 0; i < 26; i++) {
    const x = rng() * W, y = rng() * H * 0.6, r = rng() * 1.3 + 0.3;
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"
      fill="${hsl(hue, 30, 92, 0.15 + rng() * 0.3)}"/>`);
  }

  // Reliefs successifs, du plus lointain au plus proche.
  const layers = 3 + Math.floor(rng() * 2);
  for (let l = 0; l < layers; l++) {
    const baseY = H * (0.48 + 0.13 * l);
    const amp = 26 - l * 5;
    const step = 26 + rng() * 22;
    let d = `M -10 ${H} L -10 ${baseY.toFixed(1)}`;
    for (let x = -10; x <= W + 10; x += step) {
      const y = baseY - Math.abs(Math.sin(x * 0.017 + l * 2 + rng() * 0.6)) * amp;
      d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    d += ` L ${W + 10} ${H} Z`;
    parts.push(`<path d="${d}" fill="${hsl(hue, 30 - l * 4, 24 - l * 5)}" opacity="${(0.72 + l * 0.08).toFixed(2)}"/>`);
  }

  // Motif de premier plan, choisi selon la famille de la carte.
  parts.push(foreground(record, rng, hue));

  // Voile sombre en bas : le texte de la carte reste lisible par-dessus.
  parts.push(`<rect y="${H * 0.62}" width="${W}" height="${H * 0.38}"
    fill="${hsl(hue, 30, 8, 0.55)}"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

/** Silhouette caractéristique de la famille mécanique. */
function foreground(record, rng, hue) {
  const ink = hsl(hue, 34, 9, 0.92);
  const glow = hsl((hue + 30) % 360, 76, 66, 0.8);
  const kind = record.kind || (record.survivors !== undefined ? 'place' : KIND.UNIT);
  const cx = W * (0.3 + rng() * 0.4);
  const ground = H * 0.86;

  switch (kind) {
    case KIND.UNIT: {
      // Une figure debout, lance en main.
      const h = 46 + rng() * 22;
      const spear = rng() > 0.4;
      return `<g fill="${ink}">
        <ellipse cx="${cx}" cy="${ground}" rx="${(h * 0.42).toFixed(1)}" ry="4" opacity=".5"/>
        <path d="M ${cx} ${ground} l -${h * 0.19} 0 l ${h * 0.1} -${h * 0.42}
          l -${h * 0.16} -${h * 0.2} l ${h * 0.18} -${h * 0.08}
          a ${h * 0.13} ${h * 0.13} 0 1 1 ${h * 0.16} 0
          l ${h * 0.18} ${h * 0.08} l -${h * 0.16} ${h * 0.2}
          l ${h * 0.1} ${h * 0.42} Z"/>
        ${spear ? `<rect x="${cx + h * 0.3}" y="${ground - h * 1.15}" width="2.4" height="${h * 1.15}" fill="${glow}" opacity=".65"/>` : ''}
      </g>`;
    }
    case KIND.PERMANENT: {
      // Une bâtisse à tours.
      const w = 54 + rng() * 40, h = 40 + rng() * 26;
      const towers = 2 + Math.floor(rng() * 2);
      let g = `<rect x="${cx - w / 2}" y="${ground - h}" width="${w}" height="${h}" fill="${ink}"/>`;
      for (let i = 0; i < towers; i++) {
        const tx = cx - w / 2 + (w / (towers - 1 || 1)) * i - 5;
        const th = h * (0.5 + rng() * 0.6);
        g += `<rect x="${tx}" y="${ground - h - th}" width="12" height="${th + 4}" fill="${ink}"/>`;
        g += `<rect x="${tx + 4}" y="${ground - h - th * 0.6}" width="4" height="6" fill="${glow}"/>`;
      }
      return `<g>${g}</g>`;
    }
    case KIND.EPHEMERAL: {
      // Une volute d'énergie.
      let d = `M ${cx - 50} ${ground - 10}`;
      for (let i = 1; i <= 6; i++) {
        d += ` Q ${cx - 50 + i * 17} ${ground - 10 - (i % 2 ? 40 : -12) * (0.5 + rng() * 0.8)} ${cx - 50 + i * 17} ${ground - 10}`;
      }
      return `<path d="${d}" fill="none" stroke="${glow}" stroke-width="3" stroke-linecap="round" opacity=".85"/>`;
    }
    case KIND.UNIT_ATTACHMENT:
    case KIND.PLACE_ATTACHMENT: {
      // Un sceau gravé.
      const r = 22 + rng() * 10;
      let spokes = '';
      const n = 5 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n;
        spokes += `<line x1="${cx}" y1="${ground - 34}" x2="${(cx + Math.cos(a) * r).toFixed(1)}"
          y2="${(ground - 34 + Math.sin(a) * r).toFixed(1)}" stroke="${glow}" stroke-width="1.6"/>`;
      }
      return `<g opacity=".9"><circle cx="${cx}" cy="${ground - 34}" r="${r}" fill="none"
        stroke="${glow}" stroke-width="2"/>${spokes}</g>`;
    }
    default: {
      // Lieux : une porte de pierre ouverte sur l'horizon.
      const w = 40 + rng() * 26, h = 56 + rng() * 26;
      return `<g fill="${ink}">
        <rect x="${cx - w / 2 - 9}" y="${ground - h}" width="9" height="${h}"/>
        <rect x="${cx + w / 2}" y="${ground - h}" width="9" height="${h}"/>
        <rect x="${cx - w / 2 - 14}" y="${ground - h - 9}" width="${w + 28}" height="9"/>
        <rect x="${cx - w / 2}" y="${ground - h * 0.5}" width="${w}" height="${h * 0.5}"
          fill="${glow}" opacity=".25"/>
      </g>`;
    }
  }
}

const cache = new Map();

/** URI de données prête pour `background-image`, mise en cache. */
export function artUrl(record, color) {
  const key = `${record.id}|${color}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = `url("data:image/svg+xml,${encodeURIComponent(proceduralArt(record, color))}")`;
    cache.set(key, hit);
  }
  return hit;
}

/**
 * Illustration effective : image fournie par le classeur ou le paquet si elle
 * existe, paysage dessiné sinon.
 */
export function resolveArt(catalog, record, color) {
  const custom = record.art ? catalog.art?.[record.art] : null;
  if (custom) return `url("${custom}")`;
  // Un chemin qui pointe vers un fichier absent produirait un cadre vide : on
  // ne suit que les illustrations réellement fournies avec le paquet.
  return artUrl(record, color);
}
