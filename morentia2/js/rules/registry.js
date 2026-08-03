// Registre des effets de cartes et de lieux.
//
// Les définitions vivent dans `js/rules/effects/` et n'importent rien du
// moteur : elles reçoivent tout ce dont elles ont besoin via `ctx`. Ajouter,
// corriger ou retirer une carte se fait donc dans un seul fichier, sans
// toucher au moteur ni à l'interface.
//
// Crochets disponibles (tous optionnels) :
//
//   printed(ctx)                  remplace l'influence imprimée
//   aura(ctx, target)             modifie l'influence d'une autre carte
//   finalize(ctx, target, value)  dernier mot sur une valeur d'influence
//   costFor(ctx, cand)            modifie le coût d'une carte jouée/déployée
//   forbids(ctx, cand)            interdit une action (retourne un motif)
//   onPlay*(ctx)                  la carte est jouée depuis la main/le marché
//   onEnterPlace*(ctx)            la carte rejoint un lieu
//   onEnterDomain*(ctx)           la carte rejoint le domaine de son contrôleur
//   onDestroyed*(ctx)             la carte est détruite
//   onDawn* / onDusk* / onNight*  effets de phase
//   onWar*(ctx, outcome)          après la Guerre
//   onEvent*(ctx, event)          réaction à un événement quelconque
//   onPlaceExpire*(ctx, slot)     le lieu où se trouve la carte expire
//   actions(ctx)                  capacités « Action — » activables
//   replaceDestroy*(ctx, victim)  remplace une destruction (retourne true)
//
// Les crochets marqués * sont des générateurs : ils peuvent suspendre pour
// demander un choix au joueur (`yield ctx.choose(...)`).

/** cardId → définition d'effet. */
export const CARD_EFFECTS = new Map();

/** placeId → définition d'effet de lieu. */
export const PLACE_EFFECTS = new Map();

/** Déclare les effets d'une carte. */
export function defineCard(id, spec) {
  if (CARD_EFFECTS.has(id)) throw new Error(`Effet déjà défini pour ${id}`);
  CARD_EFFECTS.set(id, spec);
  return spec;
}

/** Déclare les effets d'un lieu. */
export function definePlace(id, spec) {
  if (PLACE_EFFECTS.has(id)) throw new Error(`Effet de lieu déjà défini pour ${id}`);
  PLACE_EFFECTS.set(id, spec);
  return spec;
}

/** Effets d'une carte, ou objet vide si la carte n'a pas d'effet automatisé. */
export function effectsOf(cardId) {
  return CARD_EFFECTS.get(cardId) || EMPTY;
}

export function placeEffectsOf(placeId) {
  return PLACE_EFFECTS.get(placeId) || EMPTY;
}

const EMPTY = Object.freeze({});

/**
 * Cartes dont le texte n'est pas entièrement automatisé. Le moteur les signale
 * pour que le joueur applique l'effet à la main via le panneau Arbitre.
 */
export function isAutomated(cardId) {
  const spec = CARD_EFFECTS.get(cardId);
  return !!spec && spec.manual !== true;
}
