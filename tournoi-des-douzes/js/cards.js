// Les douze combattants. `n` est la force de base *et* l'identité de la carte :
// chaque joueur possède un paquet de 1 à 12.
//
// Les textes d'effet sont recopiés mot pour mot depuis les cartes (assets/),
// qui font foi. Deux écarts avec la feuille de règles imprimée sont signalés
// dans js/rules.js.

export const CARDS = {
  1: {
    n: 1, name: 'David', epithet: "L'Halfelin", img: 'david',
    accent: '#d84734', ink: '#2a0d0a',
    timing: 'apres',
    effect: 'Si David remporte son combat (arène ou joute), gagnez 3 trophées au lieu de 1.',
  },
  2: {
    n: 2, name: 'Le Père Pair', epithet: '', img: 'le-pere-pair',
    accent: '#4d8fc9', ink: '#0d2237',
    timing: 'pendant',
    effect: 'Le Père Pair bat automatiquement tous les combattants dont la force de base est paire (il fait nul contre un autre Père Pair).',
  },
  3: {
    n: 3, name: 'Laurent', epithet: "Le Maître d'Armes", img: 'laurent',
    accent: '#7fb6e8', ink: '#11283d',
    timing: 'avant2',
    effect: 'Tous vos combattants gagnent +4 pour leur combat.',
  },
  4: {
    n: 4, name: 'Henriette', epithet: 'Trompe-La-Mort', img: 'henriette',
    accent: '#2f9e44', ink: '#0b2a12',
    timing: 'arene',
    effect: "Si Henriette est dans l'arène, la carte avec la plus faible valeur remporte le combat d'arène.",
  },
  5: {
    n: 5, name: 'Rosalie', epithet: 'La Danseuse', img: 'rosalie',
    accent: '#e2c33f', ink: '#3a2f06',
    timing: 'avant1',
    effect: "Avant tout autre effet, intervertissez le combattant de votre adversaire avec celui qu'il a placé dans l'arène.",
  },
  6: {
    n: 6, name: 'Gontran', epithet: 'Le Nécromant', img: 'gontran',
    accent: '#4e7a33', ink: '#12250a',
    timing: 'avant2',
    effect: 'La force de Gontran devient celle de la première carte de votre défausse.',
  },
  7: {
    n: 7, name: 'Morgane', epithet: 'La Sorcière', img: 'morgane',
    accent: '#25a03e', ink: '#0a2411',
    timing: 'avant2',
    effect: "La force du combattant adverse devient celle de la première carte de sa défausse. S'il n'a pas de défausse, rien ne se passe.",
  },
  8: {
    n: 8, name: 'Aliénor', epithet: 'La Volage', img: 'alienor',
    accent: '#b8479f', ink: '#33093a',
    timing: 'dernier',
    effect: 'Après le combat, échangez cette carte avec celle de votre opposant.',
  },
  9: {
    n: 9, name: 'Tracassin', epithet: 'Le Galopin', img: 'tracassin',
    accent: '#dcc44a', ink: '#3a3006',
    timing: 'apres',
    effect: 'Tracassin rapporte un trophée en cas de défaite et non en cas de victoire (arène ou joute).',
  },
  10: {
    n: 10, name: 'Jeanne', epithet: 'La Preuse', img: 'jeanne',
    accent: '#5aa8e6', ink: '#0d2438',
    timing: 'avant2',
    effect: "Si l'opposant de Jeanne a une force de base supérieure ou égale à 10, elle gagne +3, sinon elle gagne -3.",
  },
  11: {
    n: 11, name: 'Quasi-Maximus', epithet: 'Le Gladiateur', img: 'quasi-maximus',
    accent: '#e8571f', ink: '#3a1105',
    timing: 'apres',
    effect: "Quasi-Maximus ne gagne pas de trophée si vous ne remportez pas le combat d'arène.",
  },
  12: {
    n: 12, name: 'Goliath', epithet: 'Le Géant', img: 'goliath',
    accent: '#cf2b22', ink: '#330806',
    timing: 'pendant',
    effect: 'Goliath perd contre David.',
  },
};

export const CARD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const CARD_BACK = 'cards/background.webp';

export const cardImg = n => `cards/${CARDS[n].img}.webp`;

/** « Rosalie (5) » — étiquette courte pour les journaux de combat. */
export const label = n => `${CARDS[n].name} (${n})`;

/** Nom complet sur deux lignes pour les grandes vignettes. */
export const fullName = n =>
  CARDS[n].epithet ? `${CARDS[n].name} ${CARDS[n].epithet}` : CARDS[n].name;

// Ordre de résolution annoncé par la règle, réutilisé par l'écran d'aide.
export const TIMINGS = [
  { key: 'avant1', label: 'Avant le combat, en premier', cards: [5] },
  { key: 'avant2', label: 'Avant le combat, ensuite', cards: [6, 7, 10, 3] },
  { key: 'pendant', label: 'Pendant le combat', cards: [12, 2] },
  { key: 'apres', label: 'Après le combat', cards: [1, 11, 9] },
  { key: 'dernier', label: 'Après le combat, en dernier', cards: [8] },
  { key: 'arene', label: "Effet d'arène", cards: [4] },
];
