// Import / export du catalogue.
//
// Un catalogue complet est composé de :
//   cards[]   les cartes des trois factions, du marché et les cartes spéciales
//   places[]  les lieux
//   design{}  les paramètres visuels globaux
//   rules[]   la feuille « À lire », conservée pour référence dans l'app
//   art{}     illustrations personnalisées, chemin → data URI
//
// Le même code sert au chargement d'un `.xlsx` déposé par l'utilisateur et à la
// génération du catalogue par défaut compilé dans l'application.

import {
  CARD_SHEETS, PLACE_SHEET, DESIGN_SHEET, RULES_SHEET,
  CARD_COLUMNS, PLACE_COLUMNS,
  normalizeCard, normalizePlace,
  DEFAULT_DESIGN, DESIGN_LABELS, coerceDesign,
} from './schema.js';
import { zipFiles, unzip } from './zip.js';

/** SheetJS est chargé en balise script (navigateur) ou injecté (outillage). */
function sheetjs() {
  const X = globalThis.XLSX;
  if (!X) throw new Error('La bibliothèque de lecture de classeurs n’est pas chargée.');
  return X;
}

function rowsOf(X, wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return X.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

/** Classeur SheetJS → catalogue normalisé. */
export function catalogFromWorkbook(wb) {
  const X = sheetjs();
  const cards = [];
  for (const [sheetName, faction] of Object.entries(CARD_SHEETS)) {
    for (const row of rowsOf(X, wb, sheetName)) {
      const card = normalizeCard(row, faction, sheetName);
      if (card) cards.push(card);
    }
  }

  const places = [];
  for (const row of rowsOf(X, wb, PLACE_SHEET)) {
    const place = normalizePlace(row);
    if (place) places.push(place);
  }

  const design = { ...DEFAULT_DESIGN };
  for (const row of rowsOf(X, wb, DESIGN_SHEET)) {
    const key = String(row['Paramètre'] ?? '').trim();
    if (key) design[key] = coerceDesign(key, row['Valeur']);
  }

  const rules = [];
  for (const row of rowsOf(X, wb, RULES_SHEET)) {
    const values = Object.values(row);
    const label = String(values[0] ?? '').trim();
    const body = String(values[1] ?? '').trim();
    if (label && body) rules.push({ label, body });
  }

  return { cards, places, design, rules, art: {} };
}

/** Données binaires d'un `.xlsx` → catalogue. */
export function catalogFromBuffer(arrayBuffer) {
  const X = sheetjs();
  const wb = X.read(new Uint8Array(arrayBuffer), { type: 'array' });
  return catalogFromWorkbook(wb);
}

function sheetFromObjects(X, columns, records) {
  const headers = Object.keys(columns);
  const fields = Object.values(columns);
  const aoa = [headers];
  for (const rec of records) {
    aoa.push(fields.map(field => {
      const v = rec[field];
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
      return v;
    }));
  }
  const sheet = X.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = headers.map(h => ({ wch: h === 'Texte final' || h === 'Effet' ? 60 : Math.max(12, h.length + 2) }));
  return sheet;
}

/** Catalogue → classeur SheetJS, avec la même disposition que le fichier source. */
export function workbookFromCatalog(catalog) {
  const X = sheetjs();
  const wb = X.utils.book_new();

  const rulesAoa = [['Règle / décision', 'Version retenue pour le test numérique']];
  for (const r of catalog.rules || []) rulesAoa.push([r.label, r.body]);
  const rulesSheet = X.utils.aoa_to_sheet(rulesAoa);
  rulesSheet['!cols'] = [{ wch: 28 }, { wch: 100 }];
  X.utils.book_append_sheet(wb, rulesSheet, RULES_SHEET);

  for (const [sheetName, faction] of Object.entries(CARD_SHEETS)) {
    const records = catalog.cards.filter(c => c.faction === faction);
    X.utils.book_append_sheet(wb, sheetFromObjects(X, CARD_COLUMNS, records), sheetName);
  }

  X.utils.book_append_sheet(wb, sheetFromObjects(X, PLACE_COLUMNS, catalog.places), PLACE_SHEET);

  const designAoa = [['Paramètre', 'Valeur', 'Description']];
  for (const [key, value] of Object.entries(catalog.design)) {
    designAoa.push([key, value, DESIGN_LABELS[key] || '']);
  }
  const designSheet = X.utils.aoa_to_sheet(designAoa);
  designSheet['!cols'] = [{ wch: 20 }, { wch: 34 }, { wch: 46 }];
  X.utils.book_append_sheet(wb, designSheet, DESIGN_SHEET);

  return wb;
}

/** Catalogue → octets `.xlsx`. */
export function xlsxBytes(catalog) {
  const X = sheetjs();
  return X.write(workbookFromCatalog(catalog), { bookType: 'xlsx', type: 'array' });
}

const ART_DIR = 'illustrations/';
const MANIFEST = 'morentia.json';

/**
 * Paquet complet `.zip` : classeur, illustrations personnalisées et manifeste.
 * Les illustrations sont stockées sous leur chemin d'origine pour que la
 * colonne « Illustration » du classeur reste valable.
 */
export async function exportBundle(catalog, filename = 'morentia') {
  const entries = [
    { name: `${filename}.xlsx`, data: xlsxBytes(catalog) },
    {
      name: MANIFEST,
      data: JSON.stringify({
        format: 'morentia-bundle', version: 1,
        cards: catalog.cards.length, places: catalog.places.length,
        art: Object.keys(catalog.art || {}),
      }, null, 2),
    },
  ];

  for (const [path, dataUri] of Object.entries(catalog.art || {})) {
    const bytes = dataUriToBytes(dataUri);
    if (bytes) entries.push({ name: ART_DIR + safeName(path), data: bytes.data });
  }
  return zipFiles(entries);
}

/** Paquet `.zip` → catalogue, illustrations comprises. */
export async function importBundle(arrayBuffer) {
  const files = await unzip(arrayBuffer);
  const book = files.find(f => /\.xlsx$/i.test(f.name));
  if (!book) throw new Error('Le paquet ne contient pas de classeur .xlsx.');

  const catalog = catalogFromBuffer(book.bytes.buffer.slice(
    book.bytes.byteOffset, book.bytes.byteOffset + book.bytes.byteLength));

  // Les illustrations sont rattachées au chemin inscrit dans le classeur : on
  // apparie sur le nom de fichier, insensible aux dossiers intermédiaires.
  const wanted = new Map();
  for (const rec of [...catalog.cards, ...catalog.places]) {
    if (rec.art) wanted.set(safeName(rec.art), rec.art);
  }
  for (const f of files) {
    if (f === book || f.name === MANIFEST) continue;
    const base = safeName(f.name);
    const target = wanted.get(base);
    if (!target) continue;
    catalog.art[target] = bytesToDataUri(f.bytes, base);
  }
  return catalog;
}

function safeName(path) {
  return String(path).split('/').pop();
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
};

export function bytesToDataUri(bytes, name) {
  const ext = String(name).split('.').pop().toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function dataUriToBytes(uri) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri || '');
  if (!m) return null;
  if (!m[2]) return { mime: m[1], data: new TextEncoder().encode(decodeURIComponent(m[3])) };
  const bin = atob(m[3]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { mime: m[1], data: out };
}
