import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CATALOG } from "../js/catalog.js";
import { exportMorentiaWorkbook, importMorentiaWorkbook } from "../js/xlsx.js";

if (!globalThis.XLSX) vm.runInThisContext(fs.readFileSync(new URL("../vendor/xlsx.full.min.js", import.meta.url), "utf8"));

test("importe le classeur source dans le catalogue frontend", async () => {
  const bytes = fs.readFileSync(new URL("../Morentia_cartes_equilibrees_test_physique_v1.xlsx", import.meta.url));
  const file = { name: "source.xlsx", async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  const result = await importMorentiaWorkbook(file, CATALOG, { cardRadius: 15 });
  assert.equal(result.catalog.factions.Kalassir.length, 22);
  assert.equal(result.catalog.factions.Aqaba.length, 24);
  assert.equal(result.catalog.locations.length, 15);
  assert.equal(result.catalog.factions.Kalassir[2].name, "Inquisiteur du Sang Noir");
});

test("exporte les feuilles de jeu et les colonnes de design", () => {
  const originalWriteFile = globalThis.XLSX.writeFile;
  let captured;
  globalThis.XLSX.writeFile = (workbook, filename) => { captured = { workbook, filename }; };
  try {
    exportMorentiaWorkbook(CATALOG, { cardRadius: 15 }, "roundtrip.xlsx");
  } finally {
    globalThis.XLSX.writeFile = originalWriteFile;
  }
  assert.equal(captured.filename, "roundtrip.xlsx");
  assert.ok(captured.workbook.SheetNames.includes("Design"));
  assert.ok(captured.workbook.SheetNames.includes("Lieux"));
  assert.equal(captured.workbook.Sheets.Kalassir.Q1.v, "Illustration");
});
