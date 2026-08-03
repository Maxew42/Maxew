// Vérifie qu'un catalogue exporté puis réimporté est identique à l'original.
//
//   node tools/roundtrip.mjs
//
// Le classeur est le format d'échange du jeu : une perte d'information à
// l'export ferait disparaître des cartes ou des règles au prochain import.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadSheetJs } from './sheetjs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
globalThis.XLSX = loadSheetJs(root);
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};

const { getCatalog } = await import(resolve(root, 'js/data/catalog.js'));
const { xlsxBytes, catalogFromBuffer, exportBundle, importBundle } =
  await import(resolve(root, 'js/data/catalog-io.js'));

const source = getCatalog();
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' ÉCHEC'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------- classeur

// SheetJS rend un ArrayBuffer en mode « array » ; le navigateur passe le même
// objet au constructeur de Blob, on le relit donc tel quel.
const bytes = xlsxBytes(source);
const back = catalogFromBuffer(asArrayBuffer(bytes));

function asArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

check('nombre de cartes', back.cards.length === source.cards.length,
  `${back.cards.length} / ${source.cards.length}`);
check('nombre de lieux', back.places.length === source.places.length,
  `${back.places.length} / ${source.places.length}`);
check('entrées de règles', back.rules.length === source.rules.length,
  `${back.rules.length} / ${source.rules.length}`);

const COMPARED = ['id', 'name', 'type', 'subtype', 'influence', 'costDomain', 'costLocation',
  'costUnique', 'deckQty', 'text', 'faction', 'kind', 'singleCost', 'art'];
let drift = 0;
for (const original of source.cards) {
  const copy = back.cards.find(c => c.id === original.id);
  if (!copy) { drift++; console.log(`   carte perdue : ${original.id}`); continue; }
  for (const field of COMPARED) {
    if (String(original[field] ?? '') !== String(copy[field] ?? '')) {
      drift++;
      console.log(`   ${original.id}.${field} : « ${original[field]} » → « ${copy[field]} »`);
    }
  }
}
check('champs de cartes conservés', drift === 0, `${drift} écart(s)`);

const PLACE_COMPARED = ['id', 'name', 'type', 'survivors', 'duration', 'vp', 'threshold',
  'effect', 'control', 'deckCopies'];
let placeDrift = 0;
for (const original of source.places) {
  const copy = back.places.find(p => p.id === original.id);
  if (!copy) { placeDrift++; continue; }
  for (const field of PLACE_COMPARED) {
    if (String(original[field] ?? '') !== String(copy[field] ?? '')) {
      placeDrift++;
      console.log(`   ${original.id}.${field} : « ${original[field]} » → « ${copy[field]} »`);
    }
  }
}
check('champs de lieux conservés', placeDrift === 0, `${placeDrift} écart(s)`);

let designDrift = 0;
for (const [key, value] of Object.entries(source.design)) {
  if (String(back.design[key]) !== String(value)) {
    designDrift++;
    console.log(`   design.${key} : « ${value} » → « ${back.design[key]} »`);
  }
}
check('paramètres de design conservés', designDrift === 0, `${designDrift} écart(s)`);

// ------------------------------------------------------------------ paquet

const withArt = { ...source, art: { 'assets/art/kalassir.jpg': PNG_PIXEL() } };
const zip = await exportBundle(withArt, 'Morentia_cartes');
const fromZip = await importBundle(await zip.arrayBuffer());

check('paquet : cartes', fromZip.cards.length === source.cards.length,
  `${fromZip.cards.length} / ${source.cards.length}`);
check('paquet : illustration récupérée',
  typeof fromZip.art['assets/art/kalassir.jpg'] === 'string'
  && fromZip.art['assets/art/kalassir.jpg'].startsWith('data:image/'),
  Object.keys(fromZip.art).join(', ') || 'aucune');

function PNG_PIXEL() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
}

console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nAller-retour du classeur intact.');
process.exit(failures ? 1 : 0);
