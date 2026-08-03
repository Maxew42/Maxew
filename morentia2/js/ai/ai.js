// Adversaire artificiel.
//
// L'IA ne connaît aucune carte en particulier : elle note les actions que le
// moteur déclare légales, et répond aux questions en lisant l'intention du
// libellé. C'est suffisant pour éprouver les règles et jouer seul ; ce n'est
// pas un joueur fort, et ça n'a pas à l'être.

import { faceOf, influenceOf, influenceOnSlot, domainInfluence, placeRecord } from '../rules/state.js';
import { KIND } from '../data/schema.js';

/** Mots qui trahissent une intention hostile dans une question. */
const HARMFUL = /détrui|détru|perd|retirez|retirer|affaibl|sacrifi|défauss|neutralis|capturer|captur/i;
/** Mots qui trahissent une intention favorable. */
const HELPFUL = /gagne|renforc|sauv|survit|reprenez|ajoutez|piochez|copier|prolonger/i;

export class Ai {
  constructor(catalog, { aggression = 1 } = {}) {
    this.catalog = catalog;
    this.aggression = aggression;
  }

  // ------------------------------------------------------------- actions

  /** Choisit une action de Journée parmi celles déclarées légales. */
  chooseAction(state, playerIndex, actions) {
    if (!actions.length) return { type: 'pass' };
    const scored = actions
      .filter(a => a.type !== 'pass')
      .map(a => ({ a, s: this._scoreAction(state, playerIndex, a) }))
      .filter(x => x.s > 0)
      .sort((x, y) => y.s - x.s);
    if (!scored.length) return { type: 'pass' };

    // Un peu de variété entre parties : on tire parmi les meilleures options.
    const top = scored.filter(x => x.s >= scored[0].s * 0.82).slice(0, 4);
    return top[Math.floor(rand(state) * top.length)].a;
  }

  _scoreAction(state, me, action) {
    const player = state.players[me];
    const cost = action.cost ?? 0;
    if (cost > player.active) return 0;
    // Garder un peu d'or plutôt que tout dépenser au premier tour du Jour.
    const strain = cost > 0 ? 1 - (cost / Math.max(1, player.active)) * 0.28 : 1;

    switch (action.type) {
      case 'play':
      case 'buy': {
        const inst = state.cards[action.inst];
        const face = faceOf(this.catalog, inst);
        if (!face) return 0;
        const power = typeof face.influence === 'number' ? face.influence : 2;
        let score = 4 + power * 1.6 - cost * 1.15;
        if (action.type === 'buy') score += 1.2;         // le marché élargit le deck

        if (action.dest === 'place' || action.dest === 'attachPlace') {
          score += this._slotAppetite(state, me, action.slot, power);
        }
        if (action.dest === 'domain') {
          // Le domaine sert la Guerre et prépare les déploiements.
          score += face.kind === KIND.PERMANENT ? 3.4 : 1.6;
          if (this._losingWar(state, me)) score += 2.2;
        }
        if (action.dest === 'attachUnit') {
          const host = state.cards[action.target];
          const friendly = (host?.controller ?? host?.owner) === me;
          // Un attachement bénéfique va sur ses propres unités, un malus chez l'adversaire.
          const harmful = HARMFUL.test(face.text || '');
          score += (friendly !== harmful) ? 3 : -4;
        }
        if (action.dest === 'resolve') score += 1.5;
        return Math.max(0, score * strain);
      }

      case 'deploy': {
        const inst = state.cards[action.inst];
        const power = influenceOf(state, this.catalog, inst);
        return Math.max(0, (5 + power * 1.5 + this._slotAppetite(state, me, action.slot, power) - cost) * strain);
      }

      case 'activate':
        return 3.5 * strain;

      case 'order':
        // Changer d'Ordre coûte une action : rarement rentable seul.
        return player.flags.order ? 0.8 : 1.4;

      default:
        return 0;
    }
  }

  /**
   * Intérêt d'engager `power` influence sur un emplacement : on vise les lieux
   * qu'on peut prendre, ceux qui rapportent, et ceux qui expirent bientôt.
   */
  _slotAppetite(state, me, slotIndex, power) {
    const slot = state.slots[slotIndex];
    if (!slot || slot.expired || !slot.placeId) return -10;
    const rec = placeRecord(this.catalog, slot);
    const mine = influenceOnSlot(state, this.catalog, slotIndex, me);
    const best = Math.max(0, ...state.players
      .filter(p => p.index !== me)
      .map(p => influenceOnSlot(state, this.catalog, slotIndex, p.index)));

    let score = 0;
    const after = mine + power;
    if (after > best && mine <= best) score += 5.5 * this.aggression;   // prise de contrôle
    else if (after > best) score += 2;
    else if (after >= best) score += 1;
    else score += Math.max(0, 2 - (best - after) * 0.5);

    // Un lieu qui expire bientôt paie ses PV vite ; trop tôt, la carte meurt.
    if (typeof slot.duration === 'number') {
      if (slot.duration === 1) score += (rec?.vpTable?.[0] ?? 4) * 0.55;
      else if (slot.duration >= 4) score -= 0.6;
      // Attention au quota de Survivants : engager sur un lieu sans survivant coûte cher.
      const quota = typeof rec?.survivors === 'number' ? rec.survivors : 1;
      if (quota === 0 && slot.duration <= 2) score -= 2.4;
    }
    return score;
  }

  _losingWar(state, me) {
    const mine = domainInfluence(state, this.catalog, me);
    return state.players.some(p => p.index !== me && domainInfluence(state, this.catalog, p.index) > mine);
  }

  // -------------------------------------------------------------- choix

  /**
   * Répond à une question du moteur. L'intention est lue dans le libellé :
   * les textes de `js/rules/effects/` sont écrits pour ça.
   */
  answer(state, req) {
    const options = req.options || [];
    if (!options.length) return req.max === 1 ? null : [];
    const me = req.player;
    const harmful = HARMFUL.test(req.prompt || '');
    const helpful = !harmful && HELPFUL.test(req.prompt || '');

    if (req.kind === 'confirm') {
      // Accepter ce qui aide, refuser ce qui coûte sans promesse claire.
      return helpful || !harmful;
    }
    if (req.kind === 'number') {
      const values = options.map(o => Number(o.value)).filter(Number.isFinite);
      const player = state.players[me];
      // Investir sans se vider les poches.
      const budget = Math.max(0, Math.floor(player.active * 0.6));
      const pick = values.filter(v => v <= budget).sort((a, b) => b - a)[0];
      return pick ?? Math.min(...values);
    }
    if (req.kind === 'mode' || req.kind === 'slot') {
      if (req.kind === 'slot') {
        const scored = options
          .map(o => ({ o, s: this._slotAppetite(state, me, Number(o.value), 2) }))
          .sort((a, b) => b.s - a.s);
        return scored[0].o.value;
      }
      return options[0].value;
    }

    // Choix de cartes : on juge chaque candidate selon l'intention.
    const scored = options.map(o => {
      const inst = state.cards[o.inst ?? o.value];
      if (!inst) return { o, s: 0 };
      const ally = (inst.controller ?? inst.owner) === me;
      const power = influenceOf(state, this.catalog, inst);
      let s;
      if (harmful) s = ally ? -6 + (4 - Math.min(4, power)) : 4 + power;
      else if (helpful) s = ally ? 4 + power * 0.6 : -6;
      else s = ally ? 2 + power * 0.4 : 1;
      return { o, s };
    }).sort((a, b) => b.s - a.s);

    if (req.max === 1) {
      if (req.optional && scored[0].s <= 0) return null;
      return scored[0].o.value;
    }
    const wanted = scored.filter(x => x.s > 0).slice(0, req.max).map(x => x.o.value);
    if (wanted.length >= (req.min || 0)) return wanted;
    return scored.slice(0, req.min || 0).map(x => x.o.value);
  }
}

/** Aléa reproductible tiré de l'état : deux tables font le même choix. */
function rand(state) {
  const n = Math.sin((state.day + 1) * 12.9898 + state.activePlayer * 78.233
    + Object.keys(state.cards).length * 3.17) * 43758.5453;
  return n - Math.floor(n);
}
