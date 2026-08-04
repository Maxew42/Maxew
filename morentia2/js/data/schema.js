// Schéma du catalogue : normalisation des lignes du classeur vers les objets
// manipulés par le moteur, et retour.
//
// Le classeur est la source de vérité de l'auteur du jeu. Ce module est le seul
// endroit qui connaît les noms de colonnes français ; tout le reste du code
// travaille sur les champs normalisés définis ici.

/** Feuilles de cartes → faction. L'ordre fixe celui du catalogue. */
export const CARD_SHEETS = {
  'Kalassir': 'kalassir',
  'Aqaba': 'aqaba',
  'Algarie': 'algarie',
  'Marché': 'market',
  'Cartes spéciales': 'special',
};

export const PLACE_SHEET = 'Lieux';
export const DESIGN_SHEET = 'Design';
export const RULES_SHEET = 'À lire';

/** Colonnes des feuilles de cartes : entête du classeur → champ normalisé. */
export const CARD_COLUMNS = {
  'ID': 'id',
  'Nom': 'name',
  'Statut': 'status',
  'Type': 'type',
  'Sous-type': 'subtype',
  'Influence': 'influence',
  'Coût domaine': 'costDomain',
  'Coût lieu': 'costLocation',
  'Coût unique': 'costUnique',
  'Quantité deck': 'deckQty',
  'Texte final': 'text',
  'Rôle': 'role',
  'Complexité': 'complexity',
  'Risque test': 'risk',
  'Ajustement principal': 'adjustment',
  'Inclure test 1': 'include',
  'Illustration': 'art',
  'Couleur': 'color',
  'Cadre': 'frame',
  'Texte clair': 'lightText',
};

/** Colonnes de la feuille Lieux. */
export const PLACE_COLUMNS = {
  'ID': 'id',
  'Nom': 'name',
  'Type': 'type',
  'Sous-type': 'subtype',
  'Survivants': 'survivors',
  'Durée': 'duration',
  'PV': 'vp',
  'Seuil': 'threshold',
  'Quantité': 'qty',
  'Effet': 'effect',
  'Contrôle': 'control',
  'Victoire': 'victory',
  'Copies deck lieux': 'deckCopies',
  'Inclure test 1': 'include',
  'Rôle': 'role',
  'Illustration': 'art',
  'Couleur': 'color',
  'Cadre': 'frame',
  'Texte clair': 'lightText',
};

/** Champs numériques : convertis en nombre, ou laissés en 'X' / '*' littéraux. */
const NUMERIC_CARD_FIELDS = ['influence', 'costDomain', 'costLocation', 'costUnique', 'deckQty'];
const NUMERIC_PLACE_FIELDS = ['survivors', 'duration', 'qty', 'deckCopies'];

/**
 * Familles mécaniques. Le libellé « Type » du classeur reste affiché tel quel
 * sur la carte ; `kind` est ce que le moteur teste.
 */
export const KIND = {
  BASE: 'base',
  UNIT: 'unit',
  PERMANENT: 'permanent',
  EPHEMERAL: 'ephemeral',
  UNIT_ATTACHMENT: 'unitAttachment',
  PLACE_ATTACHMENT: 'placeAttachment',
};

/** Déduit la famille mécanique depuis le libellé « Type » du classeur. */
export function kindOf(type = '') {
  const t = String(type).toLowerCase();
  if (t.includes('attachement d’unité') || t.includes("attachement d'unité")) return KIND.UNIT_ATTACHMENT;
  if (t.includes('attachement de lieu')) return KIND.PLACE_ATTACHMENT;
  if (t.includes('éphémère') || t.includes('ephemere')) return KIND.EPHEMERAL;
  if (t.includes('base')) return KIND.BASE;
  if (t.includes('permanent') || t.includes('trophée')) return KIND.PERMANENT;
  if (t.includes('unité') || t.includes('unite')) return KIND.UNIT;
  return KIND.UNIT;
}

/** Une carte occupe-t-elle un emplacement de lieu par elle-même ? */
export function occupiesPlace(kind) {
  return kind === KIND.UNIT || kind === KIND.PLACE_ATTACHMENT;
}

/** Une carte peut-elle vivre dans le domaine d'un joueur ? */
export function livesInDomain(kind) {
  return kind === KIND.UNIT || kind === KIND.PERMANENT;
}

function txt(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r\n/g, '\n').trim();
}

function num(v) {
  const s = txt(v);
  if (s === '') return null;
  if (s === 'X' || s === 'x') return 'X';
  if (s === '*') return '*';
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : s;
}

function bool(v) {
  const s = txt(v).toLowerCase();
  if (s === 'oui' || s === 'yes' || s === 'true' || s === '1') return true;
  if (s === 'non' || s === 'no' || s === 'false' || s === '0') return false;
  return s === '' ? true : s; // « Optionnel » et autres libellés sont conservés
}

/**
 * Transforme une ligne brute (objet entête→valeur) en carte normalisée.
 * Retourne null pour les lignes vides ou sans ID.
 */
export function normalizeCard(row, faction, sheetName) {
  const out = {};
  for (const [header, field] of Object.entries(CARD_COLUMNS)) {
    out[field] = txt(row[header]);
  }
  if (!out.id) return null;

  for (const f of NUMERIC_CARD_FIELDS) out[f] = num(out[f]);
  out.include = bool(out.include);
  out.lightText = out.lightText === '' ? null : bool(out.lightText);
  out.deckQty = typeof out.deckQty === 'number' ? out.deckQty : 0;
  out.faction = faction;
  out.sheet = sheetName;
  out.kind = kindOf(out.type);
  // Les cartes à coût unique (éphémères, attachements) paient le même prix
  // depuis la main quelle que soit la destination.
  out.singleCost = out.costUnique !== null && out.costUnique !== '';
  return out;
}

/** Transforme une ligne brute de la feuille Lieux en lieu normalisé. */
export function normalizePlace(row) {
  const out = {};
  for (const [header, field] of Object.entries(PLACE_COLUMNS)) {
    out[field] = txt(row[header]);
  }
  if (!out.id) return null;

  for (const f of NUMERIC_PLACE_FIELDS) out[f] = num(out[f]);
  out.include = bool(out.include);
  out.lightText = out.lightText === '' ? null : bool(out.lightText);
  // « 5 / 2 / 0 » → [5, 2, 0]. « Spécial » reste une chaîne : la récompense est
  // alors entièrement décrite par la colonne Victoire et gérée par un effet.
  out.vpTable = parseVpTable(out.vp);
  // « Aucune » = monstre : reste en jeu jusqu'à ce que son Seuil soit atteint.
  out.hasDuration = typeof out.duration === 'number';
  out.isMonster = /monstre/i.test(out.type);
  return out;
}

/** « 5 / 2 / 0 » → [5, 2, 0]. Retourne null si le barème n'est pas numérique. */
export function parseVpTable(vp) {
  const s = txt(vp);
  if (!s) return null;
  const parts = s.split('/').map(p => Number(p.trim()));
  if (parts.length && parts.every(Number.isFinite)) return parts;
  return null;
}

/** Valeurs de design par défaut, écrasées par la feuille Design du classeur. */
export const DEFAULT_DESIGN = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  // Police des seuls chiffres des pastilles. Georgia a des chiffres elzéviriens
  // (le 3, le 5, le 7 descendent sous la ligne de base, le 1 et le 2 sont de
  // hauteur d'x) : dans une pastille, aucun réglage ne les centre tous. Ce
  // repli sert des chiffres de hauteur capitale, alignés sur la ligne de base.
  numeralFont: "'Iowan Old Style', 'Times New Roman', Times, serif",
  cardRadius: 15,
  artOpacity: 0.72,
  kalassirColor: '#a54843',
  aqabaColor: '#c38b3e',
  algarieColor: '#598664',
  marketColor: '#6e6a85',
  backgroundColor: '#17130f',
  // Ajouts propres à la table numérique : modifiables depuis le Studio et
  // réexportés dans la feuille Design.
  cardInk: '#f2e9dc',
  cardPaper: '#1c1712',
  titleSize: 7.2,
  textSize: 5.4,
  frameWidth: 2,
};

/** Descriptions des paramètres de design, réécrites à l'export. */
export const DESIGN_LABELS = {
  fontFamily: 'Police des cartes',
  numeralFont: 'Police des chiffres (pastilles d’influence et de coût)',
  cardRadius: 'Arrondi du cadre en pixels',
  artOpacity: 'Opacité de l’illustration (0–1)',
  kalassirColor: 'Couleur de faction Kalassir',
  aqabaColor: 'Couleur de faction Aqaba',
  algarieColor: 'Couleur de faction Algarie',
  marketColor: 'Couleur des cartes neutres',
  backgroundColor: 'Couleur principale de l’interface',
  cardInk: 'Couleur du texte des cartes',
  cardPaper: 'Couleur du fond des cartes',
  titleSize: 'Taille du titre (% de la largeur de la carte)',
  textSize: 'Taille du texte de règles (% de la largeur de la carte)',
  frameWidth: 'Épaisseur du cadre en pixels',
};

const DESIGN_NUMERIC = new Set(['cardRadius', 'artOpacity', 'titleSize', 'textSize', 'frameWidth']);

/** Applique une valeur de la feuille Design en respectant son type. */
export function coerceDesign(key, value) {
  if (DESIGN_NUMERIC.has(key)) {
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : DEFAULT_DESIGN[key];
  }
  return txt(value) || DEFAULT_DESIGN[key];
}

/** Couleur de faction issue du design, avec repli sur les cartes neutres. */
export function factionColor(design, faction) {
  return design[`${faction}Color`] || design.marketColor;
}
