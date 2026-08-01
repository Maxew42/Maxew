const CARD_HEADERS = ["ID", "Nom", "Statut", "Type", "Sous-type", "Influence", "Coût domaine", "Coût lieu", "Coût unique", "Quantité deck", "Texte final", "Rôle", "Complexité", "Risque test", "Ajustement principal", "Inclure test 1", "Illustration", "Couleur", "Cadre", "Texte clair"];
const LOCATION_HEADERS = ["ID", "Nom", "Type", "Sous-type", "Survivants", "Durée", "PV", "Seuil", "Quantité", "Effet", "Contrôle", "Victoire", "Copies deck lieux", "Inclure test 1", "Rôle", "Illustration", "Couleur", "Cadre", "Texte clair"];
const DESIGN_HEADERS = ["Paramètre", "Valeur", "Description"];

const fromHeader = {
  ID: "id", Nom: "name", Statut: "status", Type: "type", "Sous-type": "subtype",
  Influence: "influence", "Coût domaine": "domainCost", "Coût lieu": "locationCost",
  "Coût unique": "uniqueCost", "Quantité deck": "quantity", "Texte final": "text",
  Rôle: "role", Complexité: "complexity", "Risque test": "risk", "Ajustement principal": "adjustment",
  "Inclure test 1": "included", Survivants: "survivors", Durée: "duration", PV: "vp",
  Seuil: "threshold", Quantité: "quantity", Effet: "effect", Contrôle: "control", Victoire: "victory",
  "Copies deck lieux": "copies", Illustration: "illustration", Couleur: "accent", Cadre: "frame",
  "Texte clair": "lightText",
};

const toHeader = Object.fromEntries(Object.entries(fromHeader).map(([header, key]) => [key, header]));

function requireXlsx() {
  if (!globalThis.XLSX) throw new Error("Le module XLSX n’est pas chargé.");
  return globalThis.XLSX;
}

function rowsFromSheet(workbook, name) {
  const XLSX = requireXlsx();
  const sheet = workbook.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) : [];
}

function objectsFromRows(rows, faction) {
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter(row => row[0]).map(row => {
    const object = { faction };
    headers.forEach((header, index) => {
      const key = fromHeader[header];
      if (key) object[key] = row[index] ?? null;
    });
    if (typeof object.lightText === "string") object.lightText = /oui|true|1/i.test(object.lightText);
    if (!object.illustration) object.illustration = faction === "Kalassir" ? "assets/art/kalassir.jpg"
      : faction === "Aqaba" ? "assets/art/aqaba.jpg"
      : faction === "Algarie" ? "assets/art/algarie.jpg"
      : "assets/art/neutral.jpg";
    return object;
  });
}

function objectsToRows(objects, headers) {
  return [headers, ...objects.map(object => headers.map(header => object[fromHeader[header]] ?? null))];
}

function styledSheet(rows, widths = []) {
  const XLSX = requireXlsx();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = widths.map(width => ({ wch: width }));
  sheet["!autofilter"] = rows.length > 1 ? { ref: `A1:${XLSX.utils.encode_col(rows[0].length - 1)}${rows.length}` } : undefined;
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  return sheet;
}

export async function importMorentiaWorkbook(file, currentCatalog, currentDesign) {
  const XLSX = requireXlsx();
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const hasCatalog = ["Kalassir", "Aqaba", "Algarie", "Marché", "Lieux"].some(name => workbook.SheetNames.includes(name));
  if (!hasCatalog) throw new Error("Classeur Morentia non reconnu : aucune feuille de cartes attendue.");
  const catalog = structuredClone(currentCatalog);
  for (const faction of ["Kalassir", "Aqaba", "Algarie"]) {
    const rows = rowsFromSheet(workbook, faction);
    if (rows.length > 1) catalog.factions[faction] = objectsFromRows(rows, faction);
  }
  const marketRows = rowsFromSheet(workbook, "Marché");
  if (marketRows.length > 1) catalog.market = objectsFromRows(marketRows, "Marché");
  const specialRows = rowsFromSheet(workbook, "Cartes spéciales");
  if (specialRows.length > 1) catalog.specials = objectsFromRows(specialRows, "Spéciale");
  const locationRows = rowsFromSheet(workbook, "Lieux");
  if (locationRows.length > 1) catalog.locations = objectsFromRows(locationRows, "Lieu");
  const ruleRows = rowsFromSheet(workbook, "À lire");
  if (ruleRows.length > 1) catalog.rules = ruleRows.slice(1).filter(row => row[0]).map(([title, text]) => ({ title, text }));
  const design = { ...currentDesign };
  for (const [key, value] of rowsFromSheet(workbook, "Design").slice(1)) if (key && value != null) design[key] = value;
  catalog.meta = { ...catalog.meta, source: file.name, importedAt: new Date().toISOString() };
  return { catalog, design };
}

export function exportMorentiaWorkbook(catalog, design, filename = "Morentia_cartes.xlsx") {
  const XLSX = requireXlsx();
  const workbook = XLSX.utils.book_new();
  const add = (name, rows, widths) => XLSX.utils.book_append_sheet(workbook, styledSheet(rows, widths), name);
  add("À lire", [["Règle / décision", "Version retenue pour le test numérique"], ...catalog.rules.map(rule => [rule.title, rule.text])], [28, 110]);
  for (const faction of ["Kalassir", "Aqaba", "Algarie"]) add(faction, objectsToRows(catalog.factions[faction], CARD_HEADERS), [14, 34, 17, 25, 18, 11, 13, 11, 11, 12, 85, 28, 13, 13, 50, 14, 48, 14, 15, 12]);
  add("Marché", objectsToRows(catalog.market, CARD_HEADERS), [14, 34, 20, 25, 18, 11, 13, 11, 11, 12, 85, 28, 13, 13, 50, 14, 48, 14, 15, 12]);
  add("Cartes spéciales", objectsToRows(catalog.specials, CARD_HEADERS), [14, 34, 20, 25, 18, 11, 13, 11, 11, 12, 85, 28, 13, 13, 50, 14, 48, 14, 15, 12]);
  add("Lieux", objectsToRows(catalog.locations, LOCATION_HEADERS), [14, 34, 22, 18, 11, 10, 14, 28, 10, 80, 60, 80, 16, 14, 28, 48, 14, 15, 12]);
  const descriptions = {
    fontFamily: "Police des cartes", cardRadius: "Arrondi du cadre en pixels", artOpacity: "Opacité de l’illustration (0–1)",
    kalassirColor: "Couleur de faction Kalassir", aqabaColor: "Couleur de faction Aqaba", algarieColor: "Couleur de faction Algarie",
    marketColor: "Couleur des cartes neutres", backgroundColor: "Couleur principale de l’interface",
  };
  add("Design", [DESIGN_HEADERS, ...Object.entries(design).map(([key, value]) => [key, value, descriptions[key] || "Configuration visuelle Morentia"])], [26, 38, 60]);
  XLSX.writeFile(workbook, filename, { compression: true });
}

export function blankCard(faction = "Marché") {
  return {
    id: `NEW-${Date.now().toString(36).toUpperCase()}`, name: "Nouvelle carte", status: faction === "Marché" ? "Marché" : "Deck",
    type: "Unité", subtype: null, influence: 1, domainCost: 2, locationCost: 3, uniqueCost: null,
    quantity: 1, text: "Décrivez l’effet de cette carte.", role: "À définir", complexity: "Faible", risk: "Faible",
    adjustment: "Créée dans le studio.", included: "Oui", faction,
    illustration: faction === "Kalassir" ? "assets/art/kalassir.jpg" : faction === "Aqaba" ? "assets/art/aqaba.jpg" : faction === "Algarie" ? "assets/art/algarie.jpg" : "assets/art/neutral.jpg",
    accent: null, frame: null, lightText: false,
  };
}

export { CARD_HEADERS, LOCATION_HEADERS };
