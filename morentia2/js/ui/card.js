// Rendu d'une carte.
//
// Disposition demandée, de haut en bas :
//   1. influence, titre et prix sur la même ligne — l'influence à gauche du
//      nom, les deux prix empilés verticalement pour économiser la largeur ;
//   2. illustration ;
//   3. type ;
//   4. texte de règles.
//
// Toute la mise en forme dépend du bloc `design` du classeur : changer une
// couleur ou une police se fait dans la feuille Design ou dans le Studio.

import { factionColor } from '../data/schema.js';
import { resolveArt } from './art.js';

/** Couleur de cadre d'une fiche : surcharge par carte, sinon faction. */
export function colorFor(catalog, record) {
  if (record.color) return record.color;
  if (record.survivors !== undefined) return catalog.design.marketColor;
  return factionColor(catalog.design, record.faction || 'market');
}

/** Applique les variables de design au document. */
export function applyDesign(design, root = document.documentElement) {
  root.style.setProperty('--card-font', design.fontFamily);
  root.style.setProperty('--card-radius', `${design.cardRadius}px`);
  root.style.setProperty('--art-opacity', String(design.artOpacity));
  root.style.setProperty('--card-ink', design.cardInk);
  root.style.setProperty('--card-paper', design.cardPaper);
  // Exprimées en unités de conteneur : la taille suit la largeur de la carte,
  // quelle que soit l'échelle du plateau.
  root.style.setProperty('--title-size', String(design.titleSize));
  root.style.setProperty('--text-size', String(design.textSize));
  root.style.setProperty('--frame-width', `${design.frameWidth}px`);
  root.style.setProperty('--bg', design.backgroundColor);
  root.style.setProperty('--kalassir', design.kalassirColor);
  root.style.setProperty('--aqaba', design.aqabaColor);
  root.style.setProperty('--algarie', design.algarieColor);
  root.style.setProperty('--market', design.marketColor);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** Prix affichés : coût unique, ou coût de domaine puis coût de lieu. */
function priceRows(record) {
  if (record.singleCost) {
    return [{ kind: 'once', value: record.costUnique, title: 'Coût' }];
  }
  const rows = [];
  if (record.costDomain !== null && record.costDomain !== '') {
    rows.push({ kind: 'dom', value: record.costDomain, title: 'Coût de domaine' });
  }
  if (record.costLocation !== null && record.costLocation !== '') {
    rows.push({ kind: 'loc', value: record.costLocation, title: 'Coût de lieu' });
  }
  return rows;
}

/**
 * Construit l'élément d'une carte.
 * `opts.influence` remplace l'influence imprimée par la valeur en jeu.
 */
export function renderCard(catalog, record, opts = {}) {
  const accent = colorFor(catalog, record);
  const node = el('article', 'card');
  node.dataset.cardId = record.id;
  node.dataset.kind = record.kind || 'place';
  node.style.setProperty('--accent', accent);
  if (opts.light || record.lightText === true) node.classList.add('light');

  // ---- ligne du haut : influence · titre · prix empilés
  const top = el('div', 'card-top');

  const influence = opts.influence !== undefined ? opts.influence : record.influence;
  if (influence !== null && influence !== '' && influence !== undefined) {
    const inf = el('span', 'stat influence', String(influence));
    inf.title = 'Influence';
    if (opts.influence !== undefined && opts.influence !== record.influence) {
      inf.classList.add(opts.influence > (record.influence || 0) ? 'boosted' : 'weakened');
    }
    top.append(inf);
  }

  top.append(el('h3', 'card-name', record.name));

  const prices = el('div', 'prices');
  for (const row of priceRows(record)) {
    const p = el('span', `price ${row.kind}`, String(row.value));
    p.title = row.title;
    prices.append(p);
  }
  if (prices.children.length) top.append(prices);
  node.append(top);

  // ---- illustration
  const art = el('div', 'card-art');
  art.style.backgroundImage = resolveArt(catalog, record, accent);
  node.append(art);

  // ---- type
  const typeLine = [record.type, record.subtype].filter(Boolean).join(' — ');
  node.append(el('div', 'card-type', typeLine));

  // ---- texte de règles
  const body = el('div', 'card-text');
  for (const line of String(record.text || '').split('\n')) {
    if (line.trim()) body.append(el('p', null, line));
  }
  node.append(body);

  if (record.status === 'Verso') node.classList.add('back-face');
  return node;
}

/** Carte-lieu : mêmes règles de disposition, statistiques différentes. */
export function renderPlace(catalog, record, opts = {}) {
  const accent = record.color || catalog.design.marketColor;
  const node = el('article', 'card place-card');
  node.dataset.placeId = record.id;
  node.style.setProperty('--accent', accent);

  const top = el('div', 'card-top');
  const duration = opts.duration !== undefined ? opts.duration : record.duration;
  if (duration !== null && duration !== '' && duration !== undefined) {
    const d = el('span', 'stat duration', String(duration));
    d.title = 'Durée restante';
    top.append(d);
  }
  top.append(el('h3', 'card-name', record.name));
  node.append(top);

  const art = el('div', 'card-art');
  art.style.backgroundImage = resolveArt(catalog, record, accent);
  node.append(art);

  node.append(el('div', 'card-type', [record.type, record.subtype].filter(Boolean).join(' — ')));

  // Durée, Survivants et PV nommés : les trois pastilles du haut se ressemblent
  // trop pour être lues d'un coup d'œil pendant une partie.
  const stats = el('div', 'place-stats');
  const parts = [];
  if (duration !== null && duration !== '' && duration !== undefined) parts.push(['Durée', duration]);
  if (record.survivors !== null && record.survivors !== '') {
    parts.push(['Survivants', opts.survivors ?? record.survivors]);
  }
  if (record.vp) parts.push(['PV', String(record.vp).replace(/\s*\/\s*/g, '/')]);
  if (record.threshold) parts.push(['Seuil', record.threshold]);
  for (const [label, value] of parts) {
    const span = el('span');
    span.append(document.createTextNode(`${label} `), el('b', null, String(value)));
    stats.append(span);
  }
  if (stats.children.length) node.append(stats);

  const body = el('div', 'card-text');
  if (record.effect) body.append(el('p', null, record.effect));
  if (record.control) {
    const c = el('p', 'labelled');
    c.append(el('em', null, 'Contrôle — '));
    c.append(document.createTextNode(record.control));
    body.append(c);
  }
  node.append(body);
  return node;
}

/** Dos de carte, pour les mains adverses et les pioches. */
export function renderCardBack(accent = 'var(--market)', label = '') {
  const node = el('article', 'card card-back');
  node.style.setProperty('--accent', accent);
  node.append(el('div', 'back-mark', label));
  return node;
}
