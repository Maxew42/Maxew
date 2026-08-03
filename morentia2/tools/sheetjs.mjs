// Charge la version navigateur de SheetJS depuis l'outillage Node.
//
// `lib/xlsx.full.min.js` est un fichier UMD, mais le paquet déclare
// `"type": "module"` : Node refuse de le charger avec require(). On l'exécute
// donc dans un contexte fournissant les globales attendues par le bundle.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

export function loadSheetJs(root) {
  const source = readFileSync(resolve(root, 'lib/xlsx.full.min.js'), 'utf8');
  const sandbox = {
    global: undefined, globalThis: undefined,
    module: { exports: {} }, exports: {},
    Buffer, TextDecoder, TextEncoder, console,
    Uint8Array, ArrayBuffer, DataView, Date, Math, JSON,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  // Le bundle UMD remplit `exports` en priorité ; le repli couvre les autres
  // branches de son détecteur d'environnement.
  for (const candidate of [sandbox.exports, sandbox.module.exports, sandbox.XLSX]) {
    if (candidate && typeof candidate.read === 'function') return candidate;
  }
  throw new Error('SheetJS n’a pas pu être chargé depuis lib/xlsx.full.min.js.');
}
