// Vocabulaire du moteur. Volontairement séparé des libellés d'interface : les
// règles évoluent en modifiant `js/rules/`, l'affichage suit sans changement.

/** Zones où peut se trouver une carte. */
export const ZONE = {
  DECK: 'deck',
  HAND: 'hand',
  DOMAIN: 'domain',
  PLACE: 'place',
  DISCARD: 'discard',
  MARKET: 'market',            // face visible du marché
  MARKET_DECK: 'marketDeck',
  BASE: 'base',                // carte Base d'un joueur
  PLACE_SLOT: 'placeSlot',     // carte-lieu occupant un emplacement
  LIMBO: 'limbo',              // hors partie (jetons détruits, versos inactifs)
};

/** Phases d'un Jour, dans l'ordre. */
export const PHASE = {
  SETUP: 'setup',
  DAWN: 'dawn',
  DAY: 'day',
  DUSK: 'dusk',
  WAR: 'war',
  NIGHT: 'night',
  END_OF_DAY: 'endOfDay',
  GAME_OVER: 'gameOver',
};

export const PHASE_ORDER = [PHASE.DAWN, PHASE.DAY, PHASE.DUSK, PHASE.WAR, PHASE.NIGHT, PHASE.END_OF_DAY];

export const PHASE_LABELS = {
  [PHASE.SETUP]: 'Mise en place',
  [PHASE.DAWN]: 'Aube',
  [PHASE.DAY]: 'Journée',
  [PHASE.DUSK]: 'Crépuscule',
  [PHASE.WAR]: 'Guerre',
  [PHASE.NIGHT]: 'Nuit',
  [PHASE.END_OF_DAY]: 'Fin du Jour',
  [PHASE.GAME_OVER]: 'Fin de partie',
};

/** Les deux réserves d'or. L'or de réserve devient actif à l'Aube suivante. */
export const POT = { ACTIVE: 'active', RESERVE: 'reserve' };

/** Durées d'un modificateur d'influence. */
export const UNTIL = {
  PERMANENT: null,
  DAWN: 'dawn',        // jusqu'à la prochaine Aube
  PLACE_EXPIRY: 'placeExpiry',
};

/**
 * Réglages de partie. Valeurs par défaut issues de « Mise en place conseillée »
 * de la feuille « À lire » du classeur ; toutes ajustables avant la partie.
 */
export const DEFAULT_CONFIG = {
  startingHand: 4,
  startingGold: 3,
  mulligans: 1,
  marketExtra: 1,        // marché = joueurs + marketExtra
  placesExtra: 1,        // lieux actifs = joueurs + placesExtra
  endExpiredBase: 2,     // fin après 2 × joueurs + endExpiredBase lieux expirés
  endExpiredPerPlayer: 2,
  dayLimit: 0,           // 0 = pas de limite de Jours
  firstDeployFree: true, // premier déploiement du Jour gratuit, puis 1 or
  deployCost: 1,
  domainInfluenceWar: true,
  includeOptional: false,
};

/** Raisons de déplacement, utilisées par les effets déclenchés et l'animation. */
export const REASON = {
  PLAY: 'play',
  BUY: 'buy',
  DEPLOY: 'deploy',
  MOVE: 'move',
  DRAW: 'draw',
  DESTROY: 'destroy',
  DISCARD: 'discard',
  SURVIVE: 'survive',
  RETURN: 'return',
  CREATE: 'create',
  SETUP: 'setup',
  EXPIRE: 'expire',
  CAPTURE: 'capture',
};

/** Une destruction déclenche les effets « lorsque détruite » ; pas une défausse. */
export function isDestruction(reason) {
  return reason === REASON.DESTROY;
}

/**
 * Les trois Ordres de Kalassir. Le classeur mentionne l'« Ordre actif » et le
 * « Conseil des Trois Ordres » sans en fixer le coût : la table numérique
 * retient un changement d'Ordre comme action coûtant 1 or, gratuit si un effet
 * le précise. Modifier ici suffit à changer la règle.
 */
export const ORDERS = ['Lames de Karina', 'Disciples de Karlov', 'Culte du Premier Sang'];

export const ORDER_CHANGE_COST = 1;
