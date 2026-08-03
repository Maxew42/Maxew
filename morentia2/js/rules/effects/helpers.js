// Outils partagés par les définitions d'effets.
//
// Les effets n'importent que ce fichier et les constantes : ils ne connaissent
// ni l'état ni le moteur, tout passe par `ctx`.

import { POT, UNTIL, REASON } from '../constants.js';
import { KIND } from '../../data/schema.js';

export { POT, UNTIL, REASON, KIND };

/** Bonus conditionnel qu'une carte s'applique à elle-même. */
export function selfAura(fn) {
  return (ctx, target) => (target.id === ctx.inst.id ? (fn(ctx) || 0) : 0);
}

/** La carte porteuse est-elle sur un lieu ? */
export function onPlace(ctx) {
  return ctx.inst.zone === 'place' && ctx.inst.slot !== null;
}

/** Cartes présentes sur le lieu de la carte porteuse, hors attachements. */
export function here(ctx, { includeSelf = true } = {}) {
  if (!onPlace(ctx)) return [];
  return ctx.cardsOn(ctx.inst.slot).filter(c => includeSelf || c.id !== ctx.inst.id);
}

export function allies(ctx, list) {
  return list.filter(c => (c.controller ?? c.owner) === ctx.player);
}

export function enemies(ctx, list) {
  return list.filter(c => (c.controller ?? c.owner) !== ctx.player && c.controller !== null);
}

/** Toutes les cartes alliées en jeu — domaine et lieux. */
export function alliedInPlay(ctx, player = ctx.player) {
  return ctx.allInPlay().filter(c => (c.controller ?? c.owner) === player && c.zone !== 'base');
}

/** Toutes les cartes alliées présentes sur un lieu. */
export function alliedOnPlaces(ctx, player = ctx.player) {
  return alliedInPlay(ctx, player).filter(c => c.zone === 'place' && !c.attachedTo);
}

/** Un Géant est-il présent sur cet emplacement ? */
export function giantOn(ctx, slot) {
  return ctx.cardsOn(slot).some(c => (ctx.face_(c)?.subtype || '').includes('Géant'));
}

/** Demande un choix facultatif de carte et renvoie l'instance, ou null. */
export function* askCard(ctx, prompt, candidates, opts = {}) {
  const list = candidates.filter(Boolean);
  if (!list.length) return null;
  const answer = yield ctx.pickCard(opts.player ?? ctx.player, prompt, list, opts);
  const id = Array.isArray(answer) ? answer[0] : answer;
  return id ? ctx.state.cards[id] : null;
}

/** Variante multiple : renvoie un tableau d'instances. */
export function* askCards(ctx, prompt, candidates, max, opts = {}) {
  const list = candidates.filter(Boolean);
  if (!list.length) return [];
  const answer = yield ctx.pickCard(opts.player ?? ctx.player, prompt, list,
    { ...opts, max: Math.min(max, list.length), optional: true });
  const ids = Array.isArray(answer) ? answer : (answer ? [answer] : []);
  return ids.map(id => ctx.state.cards[id]).filter(Boolean);
}

/** Question fermée. */
export function* askYes(ctx, prompt, player = ctx.player) {
  return (yield ctx.confirm(player, prompt)) === true;
}

/** Regarde la première carte de son deck : la laisser dessus ou la glisser dessous. */
export function* peekOwnDeck(ctx, player = ctx.player) {
  const [top] = ctx.deckTop(player, 1);
  if (!top) return;
  const face = ctx.face_(top);
  const keep = yield ctx.pickMode(player,
    `Première carte de votre deck : ${face?.name || '—'}.`,
    [{ value: 'top', label: 'Laisser au-dessus' }, { value: 'bottom', label: 'Placer dessous' }]);
  if (keep === 'bottom') ctx.deckToBottom(top);
}

/** Même chose sur le deck de marché. */
export function* peekMarketDeck(ctx, player = ctx.player) {
  const top = ctx.marketTop();
  if (!top) return;
  const face = ctx.face_(top);
  const keep = yield ctx.pickMode(player,
    `Première carte du deck de marché : ${face?.name || '—'}.`,
    [{ value: 'top', label: 'Laisser au-dessus' }, { value: 'bottom', label: 'Placer dessous' }]);
  if (keep === 'bottom') ctx.marketDeckToBottom(top);
}

/** Pioche puis défausse — motif récurrent de filtrage. */
export function* drawThenDiscard(ctx, player = ctx.player) {
  yield* ctx.draw(player, 1);
  const hand = ctx.handOf(player);
  if (!hand.length) return;
  const card = yield* askCard(ctx, 'Défaussez une carte de votre main.', hand, { player });
  if (card) yield* ctx.discard(card);
}

/** Une carte visible du marché part sous le deck et est remplacée. */
export function* recycleMarket(ctx, player = ctx.player) {
  const visible = ctx.marketVisible();
  if (!visible.length) return;
  const card = yield* askCard(ctx,
    'Placez une carte visible du marché sous le deck de marché.', visible,
    { player, optional: true });
  if (card) yield* ctx.marketToBottom(card);
}

/** Emplacements adjacents à celui de la carte porteuse. */
export function neighbours(ctx, slot = ctx.inst?.slot) {
  return slot === null || slot === undefined ? [] : ctx.adjacent(slot);
}

/** Déplace une carte vers un emplacement adjacent, au choix du joueur. */
export function* moveToNeighbour(ctx, inst, prompt = 'Choisissez le lieu d’arrivée.') {
  const options = neighbours(ctx, inst.slot);
  if (!options.length) return null;
  const answer = yield ctx.pickSlot(ctx.player, prompt, options, { optional: true });
  if (answer === null || answer === undefined) return null;
  yield* ctx.moveToSlot(inst, answer, REASON.MOVE);
  return answer;
}

/** Bornes usuelles des coûts variables X. */
export function cappedX(ctx, max) {
  return Math.max(0, Math.min(max, ctx.state.players[ctx.player].active));
}
