// Rendu d'une carte.
//
// Disposition demandée, de haut en bas :
//   1. influence, titre et prix sur la même ligne — l'influence contre le coin
//      haut-gauche, les deux prix empilés contre le coin haut-droit ;
//   2. illustration ;
//   3. type ;
//   4. texte de règles ;
//   5. bandeau du code de référence.
//
// Les mots qui portent une règle sont marqués au passage (voir
// `js/rules/glossary.js`) : ils s'épaississent légèrement, et la vue détaillée
// en affiche la règle au survol.
//
// Toute la mise en forme dépend du bloc `design` du classeur : changer une
// couleur ou une police se fait dans la feuille Design ou dans le Studio.

import { factionColor } from '../data/schema.js';
import { buildGlossary, splitKeywords } from '../rules/glossary.js';
import { backUrl, resolveArt } from './art.js';

/** Couleur de cadre d'une fiche : surcharge par carte, sinon faction. */
export function colorFor(catalog, record) {
  if (record.color) return record.color;
  if (record.survivors !== undefined) return catalog.design.marketColor;
  return factionColor(catalog.design, record.faction || 'market');
}

/** Applique les variables de design au document. */
export function applyDesign(design, root = document.documentElement) {
  root.style.setProperty('--card-font', design.fontFamily);
  // Les chiffres ont leur propre police : celle des cartes peut être à chiffres
  // elzéviriens (Georgia), qui dépassent sous la ligne de base et ne se centrent
  // dans aucune pastille.
  root.style.setProperty('--card-num', design.numeralFont);
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

/**
 * Rattache un élément à une entrée du glossaire : gras léger et règle au survol.
 * Pas de `tabindex` ici — il y a des dizaines de mots-clés sur un plateau, et
 * autant d'arrêts de tabulation. C'est la vue détaillée qui les rend focalisables
 * (`markFocusable` dans `js/ui/keyword.js`).
 */
function keyed(node, key) {
  node.classList.add('kw');
  node.dataset.term = key;
  return node;
}

/** Prix affichés : coût unique, ou coût de domaine puis coût de lieu. */
function priceRows(record) {
  if (record.singleCost) {
    return [{ kind: 'once', value: record.costUnique, title: 'Coût unique', term: 'cout-unique' }];
  }
  const rows = [];
  if (record.costDomain !== null && record.costDomain !== '') {
    rows.push({ kind: 'dom', value: record.costDomain, title: 'Coût de domaine', term: 'cout-domaine' });
  }
  if (record.costLocation !== null && record.costLocation !== '') {
    rows.push({ kind: 'loc', value: record.costLocation, title: 'Coût de lieu', term: 'cout-lieu' });
  }
  return rows;
}

/**
 * Texte de règles, mots-clés marqués. `seen` est partagé par toutes les lignes
 * d'une même carte : seule la première occurrence d'une règle est marquée.
 */
function ruleText(catalog, text, seen) {
  const glossary = buildGlossary(catalog);
  const frag = document.createDocumentFragment();
  for (const part of splitKeywords(String(text), glossary, seen)) {
    if (!part.key) { frag.append(document.createTextNode(part.text)); continue; }
    frag.append(keyed(el('b', null, part.text), part.key));
  }
  return frag;
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
    const inf = keyed(el('span', 'stat influence', String(influence)), 'influence');
    inf.title = 'Influence';
    if (opts.influence !== undefined && opts.influence !== record.influence) {
      inf.classList.add(opts.influence > (record.influence || 0) ? 'boosted' : 'weakened');
    }
    top.append(inf);
  }

  top.append(el('h3', 'card-name', record.name));

  const prices = el('div', 'prices');
  for (const row of priceRows(record)) {
    const p = keyed(el('span', `price ${row.kind}`, String(row.value)), row.term);
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
  const seen = new Set();
  const typeLine = [record.type, record.subtype].filter(Boolean).join(' — ');
  const type = el('div', 'card-type');
  type.append(ruleText(catalog, typeLine, seen));
  node.append(type);

  // ---- texte de règles
  const body = el('div', 'card-text');
  for (const line of String(record.text || '').split('\n')) {
    if (!line.trim()) continue;
    const p = el('p');
    p.append(ruleText(catalog, line, seen));
    body.append(p);
  }
  node.append(body);
  appendCode(node, record);

  if (record.status === 'Verso') node.classList.add('back-face');
  return node;
}

/** Bandeau de pied : le code de référence, tel qu'il figure dans le classeur. */
function appendCode(node, record) {
  if (!record.id) return;
  node.append(el('footer', 'card-code', record.id));
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
    const d = keyed(el('span', 'stat duration', String(duration)), 'duree');
    d.title = 'Durée restante';
    top.append(d);
  }
  top.append(el('h3', 'card-name', record.name));
  node.append(top);

  const art = el('div', 'card-art');
  art.style.backgroundImage = resolveArt(catalog, record, accent);
  node.append(art);

  const seen = new Set();
  const type = el('div', 'card-type');
  type.append(ruleText(catalog, [record.type, record.subtype].filter(Boolean).join(' — '), seen));
  node.append(type);

  // Durée, Survivants et PV nommés : les trois pastilles du haut se ressemblent
  // trop pour être lues d'un coup d'œil pendant une partie.
  const stats = el('div', 'place-stats');
  const parts = [];
  if (duration !== null && duration !== '' && duration !== undefined) parts.push(['Durée', duration, 'duree']);
  if (record.survivors !== null && record.survivors !== '') {
    parts.push(['Survivants', opts.survivors ?? record.survivors, 'survivant']);
  }
  if (record.vp) parts.push(['PV', String(record.vp).replace(/\s*\/\s*/g, '/'), 'pv']);
  if (record.threshold) parts.push(['Seuil', record.threshold, 'seuil']);
  for (const [label, value, term] of parts) {
    const span = el('span');
    span.append(keyed(el('span', null, label), term), document.createTextNode(' '), el('b', null, String(value)));
    stats.append(span);
  }
  if (stats.children.length) node.append(stats);

  const seenText = new Set();
  const body = el('div', 'card-text');
  if (record.effect) {
    const p = el('p');
    p.append(ruleText(catalog, record.effect, seenText));
    body.append(p);
  }
  if (record.control) {
    const c = el('p', 'labelled');
    c.append(keyed(el('em', null, 'Contrôle'), 'controle'), document.createTextNode(' — '));
    seenText.add('controle');
    c.append(ruleText(catalog, record.control, seenText));
    body.append(c);
  }
  node.append(body);
  appendCode(node, record);
  return node;
}

/**
 * Dos de carte, pour les pioches et les paquets. `color` doit être une couleur
 * résolue — le dessin en tire sa teinte, une variable CSS ne lui dirait rien.
 */
export function renderCardBack(color, label = '') {
  const node = el('article', 'card card-back');
  node.style.setProperty('--accent', color);
  node.style.backgroundImage = backUrl(color);
  if (label) node.append(el('div', 'back-mark', label));
  return node;
}
