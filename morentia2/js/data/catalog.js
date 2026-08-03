// Dépôt du catalogue : catalogue par défaut compilé, remplacé le cas échéant
// par un classeur importé et conservé dans le stockage local.

import { DEFAULT_CATALOG } from './catalog-default.js';
import { DEFAULT_DESIGN, KIND } from './schema.js';

const STORE_KEY = 'morentia2.catalog.v1';

const listeners = new Set();
let current = null;

function hydrate(raw) {
  const catalog = {
    cards: raw.cards || [],
    places: raw.places || [],
    design: { ...DEFAULT_DESIGN, ...(raw.design || {}) },
    rules: raw.rules || [],
    art: raw.art || {},
    name: raw.name || 'Morentia',
    importedAt: raw.importedAt || null,
  };
  catalog.byId = new Map();
  for (const c of catalog.cards) catalog.byId.set(c.id, c);
  catalog.placeById = new Map();
  for (const p of catalog.places) catalog.placeById.set(p.id, p);
  return catalog;
}

/** Catalogue actif. Chargé depuis le stockage local au premier appel. */
export function getCatalog() {
  if (current) return current;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      current = hydrate(JSON.parse(saved));
      return current;
    }
  } catch {
    // Stockage indisponible ou contenu corrompu : on repart du catalogue livré.
  }
  current = hydrate(DEFAULT_CATALOG);
  return current;
}

/** Remplace le catalogue actif et le conserve. Notifie les abonnés. */
export function setCatalog(raw, { persist = true } = {}) {
  current = hydrate({ ...raw, importedAt: new Date().toISOString() });
  if (persist) saveCatalog();
  for (const fn of listeners) fn(current);
  return current;
}

/** Réécrit le catalogue actif dans le stockage local (après édition Studio). */
export function saveCatalog() {
  if (!current) return;
  const { byId, placeById, ...plain } = current;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(plain));
  } catch (err) {
    // Le quota est vite atteint si beaucoup d'illustrations sont embarquées.
    console.warn('Catalogue non conservé :', err?.message);
  }
}

/** Revient au catalogue livré avec l'application. */
export function resetCatalog() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* stockage indisponible */ }
  current = hydrate(DEFAULT_CATALOG);
  for (const fn of listeners) fn(current);
  return current;
}

export function onCatalogChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Le catalogue est-il celui livré, ou un classeur importé ? */
export function isDefaultCatalog() {
  return !getCatalog().importedAt;
}

// ---------------------------------------------------------------- sélections

export const FACTIONS = ['kalassir', 'aqaba', 'algarie'];

export const FACTION_LABELS = {
  kalassir: 'Kalassir',
  aqaba: 'Aqaba',
  algarie: 'Algarie',
  market: 'Marché',
  special: 'Spéciales',
};

/** Carte Base d'une faction : le pouvoir permanent du joueur. */
export function baseCard(catalog, faction) {
  return catalog.cards.find(c => c.faction === faction && c.kind === KIND.BASE) || null;
}

/**
 * Deck de faction : chaque carte « Deck » répétée selon sa quantité.
 * Les versos (statut « Verso ») n'entrent pas dans le deck ; ils sont
 * atteints en retournant leur recto.
 */
export function factionDeck(catalog, faction) {
  const out = [];
  for (const c of catalog.cards) {
    if (c.faction !== faction || c.status !== 'Deck') continue;
    for (let i = 0; i < (c.deckQty || 0); i++) out.push(c.id);
  }
  return out;
}

/**
 * Deck de marché. Le module Jadis (cartes marquées « Optionnel ») n'entre en
 * jeu que si un lieu Ruines des Hommes de Jadis est présent dans la sélection.
 */
export function marketDeck(catalog, { includeOptional = false } = {}) {
  const out = [];
  for (const c of catalog.cards) {
    if (c.faction !== 'market') continue;
    if (c.include !== true && !includeOptional) continue;
    for (let i = 0; i < Math.max(1, c.deckQty || 1); i++) out.push(c.id);
  }
  return out;
}

/** Deck de lieux, chaque lieu répété selon « Copies deck lieux ». */
export function placeDeck(catalog, { includeOptional = false } = {}) {
  const out = [];
  for (const p of catalog.places) {
    if (p.include !== true && !includeOptional) continue;
    const copies = typeof p.deckCopies === 'number' ? p.deckCopies : (p.qty || 1);
    for (let i = 0; i < Math.max(1, copies); i++) out.push(p.id);
  }
  return out;
}

/** Verso d'une carte recto-verso : `ALG-07` → `ALG-07B`. */
export function backFaceId(cardId) {
  return `${cardId}B`;
}

/** Illustration effective d'une carte : personnalisée si importée. */
export function artFor(catalog, record) {
  if (!record?.art) return null;
  return catalog.art?.[record.art] || record.art;
}
