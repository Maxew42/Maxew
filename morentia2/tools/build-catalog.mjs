// Compile le classeur source en module JavaScript embarqué dans l'application,
// pour que la table soit jouable hors-ligne sans dépôt de fichier.
//
//   node tools/build-catalog.mjs [chemin.xlsx]
//
// Le même analyseur sert ici et au moment d'un import `.xlsx` dans le
// navigateur : il ne peut donc pas y avoir de divergence entre les deux.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadSheetJs } from './sheetjs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

globalThis.XLSX = loadSheetJs(root);

const { catalogFromBuffer } = await import(resolve(root, 'js/data/catalog-io.js'));

const source = resolve(root, process.argv[2] || 'Morentia_cartes.xlsx');
const bytes = readFileSync(source);
const catalog = catalogFromBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const header = `// Catalogue par défaut — généré depuis « ${source.split('/').pop()} ».
// Ne pas modifier à la main : relancer \`node tools/build-catalog.mjs\`.
// Un classeur importé dans l'application remplace ce contenu et est conservé
// dans le stockage local du navigateur.

export const DEFAULT_CATALOG = `;

writeFileSync(
  resolve(root, 'js/data/catalog-default.js'),
  header + JSON.stringify(catalog, null, 1) + ';\n',
);

const byFaction = {};
for (const c of catalog.cards) byFaction[c.faction] = (byFaction[c.faction] || 0) + 1;
console.log('cartes :', catalog.cards.length, byFaction);
console.log('lieux  :', catalog.places.length);
console.log('design :', Object.keys(catalog.design).length, 'paramètres');
console.log('règles :', catalog.rules.length, 'entrées');
