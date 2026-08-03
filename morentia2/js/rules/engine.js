// Moteur de règles.
//
// Le moteur ne fait que deux choses : émettre des événements (seule façon de
// modifier l'état) et suspendre quand un joueur doit choisir. Les effets de
// cartes sont des générateurs : ils peuvent donc poser une question au milieu
// de leur résolution sans que le moteur ait à connaître leur contenu.
//
//   engine.run()            avance jusqu'au prochain choix ou à l'arrêt
//   engine.pending          question en attente, ou null
//   engine.submit(answer)   répond et reprend
//   engine.act(player, a)   action de Journée
//   engine.drain()          événements produits depuis le dernier appel

import { ZONE, PHASE, POT, UNTIL, REASON } from './constants.js';
import { applyEvent } from './events.js';
import {
  makeRng, shuffled, faceOf, placeRecord, cardsOnSlot, isSilenced,
  computeController, specFor, readCtx,
} from './state.js';
import { placeEffectsOf } from './registry.js';
 '../data/schema.js';
import { setupGame, performAction, legalActions, refillMarket } from './flow.js';

let instCounter = 0;

export class Engine {
  constructor({ catalog, state, onChoiceNeeded = null }) {
    this.catalog = catalog;
    this.state = state;
    this.rng = makeRng(state.seed);
    this.stack = [];          // pile de générateurs en cours
    this.pending = null;      // question en attente
    this.buffer = [];         // événements non encore consommés par l'affichage
    this.history = [];        // flux complet, pour rejouer ou synchroniser
    this.onChoiceNeeded = onChoiceNeeded;
    this.awaitingAction = false;
  }

  // ------------------------------------------------------------- événements

  emit(event) {
    applyEvent(this.state, event);
    this.buffer.push(event);
    this.history.push(event);
    return event;
  }

  /** Événements produits depuis le dernier appel. Consommés par l'animation. */
  drain() {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  nextInstId() {
    return `i${++instCounter}`;
  }

  // ------------------------------------------------------- boucle principale

  /** Empile une tâche (générateur) à exécuter en priorité. */
  push(gen) {
    this.stack.push(gen);
  }

  /**
   * Avance jusqu'à ce qu'un choix soit requis, qu'une action de joueur soit
   * attendue, ou que la partie s'arrête.
   */
  run() {
    if (this.pending) return this.status();
    while (this.stack.length) {
      const top = this.stack[this.stack.length - 1];
      let res;
      try {
        res = top.next(this._resume);
      } catch (err) {
        // Un effet qui échoue ne doit pas figer la table : on le journalise.
        console.error('Effet interrompu :', err);
        this.emit({ t: 'note', kind: 'error', text: `Effet interrompu : ${err.message}` });
        this.stack.pop();
        continue;
      }
      this._resume = undefined;
      if (res.done) { this.stack.pop(); continue; }

      const req = res.value;
      if (req && req.req === 'choice') {
        this.pending = req;
        if (this.onChoiceNeeded) this.onChoiceNeeded(req);
        return this.status();
      }
      if (req && req.req === 'awaitAction') {
        this.awaitingAction = true;
        return this.status();
      }
      // Un yield sans requête est un simple point de reprise.
    }
    return this.status();
  }

  status() {
    if (this.state.phase === PHASE.GAME_OVER) return { status: 'over' };
    if (this.pending) return { status: 'choice', pending: this.pending };
    if (this.awaitingAction) return { status: 'action', player: this.state.activePlayer };
    return { status: 'idle' };
  }

  /** Répond à la question en attente. */
  submit(answer) {
    if (!this.pending) return this.status();
    const req = this.pending;
    this.pending = null;
    this._resume = normalizeAnswer(req, answer);
    return this.run();
  }

  /** Démarre la partie : mise en place puis enchaînement des Jours. */
  start() {
    this.push(setupGame(this));
    return this.run();
  }

  /**
   * Joue l'action de Journée d'un joueur. L'action est empilée au-dessus de la
   * boucle de Journée, qui reprend la main une fois l'action résolue.
   */
  act(playerIndex, action) {
    if (!this.awaitingAction || this.state.activePlayer !== playerIndex) return this.status();
    this.awaitingAction = false;
    this.push(performAction(this, playerIndex, action));
    return this.run();
  }

  /** Actions légales du joueur, pour l'interface et l'IA. */
  legal(playerIndex) {
    return legalActions(this.state, this.catalog, playerIndex);
  }

  // ------------------------------------------------------------- contexte

  /**
   * Contexte transmis aux effets. `inst` est la carte porteuse (ou null pour
   * les effets de lieu), `slot` l'emplacement concerné.
   */
  ctx(inst = null, extra = {}) {
    const engine = this;
    const state = this.state;
    const catalog = this.catalog;
    const controller = inst ? (inst.controller ?? inst.owner) : (extra.player ?? null);

    const ctx = {
      // Le contexte de lecture est partagé avec les crochets synchrones : un
      // effet s'écrit de la même façon quel que soit l'endroit d'où il est
      // appelé.
      ...readCtx(state, catalog, { inst, slot: extra.slot ?? null, player: controller }),
      engine,
      ...extra,
      slot: inst?.slot ?? extra.slot ?? null,
      player: controller,

      // ---- lectures propres au moteur
      controllerOf: s => computeController(state, catalog, s),
      recordedController: s => state.slots[s]?.controller ?? null,
      opponents: p => state.players.filter(q => q.index !== p).map(q => q.index),
      isAlly: i => i && (i.controller ?? i.owner) === controller,
      order: p => state.players[p ?? controller]?.flags.order ?? null,
      isMonsterSlot: s2 => !!placeRecord(catalog, state.slots[s2])?.isMonster,
      subtypeOn: (s2, sub) => cardsOnSlot(state, s2)
        .some(c => (faceOf(catalog, c)?.subtype || '').includes(sub)),
      marketVisible: () => state.market.visible.map(id => state.cards[id]),
      marketTop: () => state.cards[state.market.deck[0]] || null,
      deckTop: (p, n = 1) => state.players[p].deck.slice(0, n).map(id => state.cards[id]),
      placedCount: (p, s2) => state.flags[`day:placed:${p}:${s2}`] || 0,
      slotFlag: (s2, key) => state.slots[s2]?.flags[key],
      setSlotFlag: (s2, key, value) => engine.emit({ t: 'flag', scope: `slot:${s2}`, key, value }),
      duration: (s2, delta) => engine.emit({ t: 'duration', slot: s2, delta }),
      setDuration: (s2, value) => engine.emit({ t: 'duration', slot: s2, value }),

      // ---- limites « une fois par Jour »
      once: key => engine.once(inst ? inst.id : `p${controller}`, key),
      oncePerPlayer: (p, key) => engine.once(p, key),
      flag: (key, value) => engine.setFlag(inst ? inst.id : 'game', key, value),
      getFlag: key => (inst ? inst.flags[key] : state.flags[key]),

      // ---- écritures (générateurs : peuvent déclencher d'autres effets)
      gain: (p, n, potKind = POT.RESERVE) => engine.gain(p, n, potKind),
      pay: (p, n) => engine.pay(p, n),
      draw: (p, n = 1) => engine.draw(p, n),
      addInfluence: (i, d, until = UNTIL.PERMANENT) => engine.addInfluence(i, d, until, inst?.id),
      destroy: i => engine.destroy(i),
      destroyByExpiry: i => engine.destroy(i, { byEffect: false }),
      discard: i => engine.discardCard(i),
      /** Retient une carte comme Survivante hors quota (Bastion, Écaille Violette). */
      grantFreeSurvivor: (s2, instId) => {
        const list = (state.slots[s2]?.flags.freeSurvivors || []).concat(instId);
        engine.emit({ t: 'flag', scope: `slot:${s2}`, key: 'freeSurvivors', value: list });
      },
      /** Renvoie une carte du marché sous son deck et complète aussitôt. */
      marketToBottom: i => engine.marketToBottom(i),
      deckToBottom: i => engine.emit({
        t: 'move', inst: i.id, to: { zone: ZONE.DECK, player: i.owner, top: 'bottom' }, reason: REASON.RETURN,
      }),
      marketDeckToBottom: i => engine.emit({
        t: 'move', inst: i.id, to: { zone: ZONE.MARKET_DECK, top: 'bottom' }, reason: REASON.RETURN,
      }),
      moveToSlot: (i, s, reason) => engine.moveToSlot(i, s, reason),
      toDomain: (i, opts) => engine.toDomain(i, opts),
      toHand: (i, p) => engine.toHand(i, p),
      exhaust: (i, v = true) => engine.emit({ t: 'exhaust', inst: i.id, value: v }),
      flip: (i, faceId) => engine.emit({ t: 'flip', inst: i.id, faceId }),
      attach: (i, target) => engine.attachTo(i, target),
      createToken: (cardId, owner) => engine.createToken(cardId, owner),
      vp: (p, n, reason) => engine.emit({ t: 'vp', player: p, delta: n, reason }),
      note: (text, kind = 'info') => engine.emit({ t: 'note', text, kind }),
      signal: (name, data) => engine.signal(name, data),

      // ---- choix
      choose: spec => ({ req: 'choice', ...spec }),
      pickCard: (p, prompt, cands, opts = {}) => ({
        req: 'choice', kind: 'card', player: p, prompt,
        options: cands.map(c => ({ value: c.id, inst: c.id, slot: c.slot })),
        min: opts.optional ? 0 : 1, max: opts.max ?? 1, optional: !!opts.optional,
      }),
      pickMode: (p, prompt, modes) => ({
        req: 'choice', kind: 'mode', player: p, prompt,
        options: modes.map(m => (typeof m === 'string' ? { value: m, label: m } : m)),
        min: 1, max: 1,
      }),
      pickSlot: (p, prompt, slotIndexes, opts = {}) => ({
        req: 'choice', kind: 'slot', player: p, prompt,
        options: slotIndexes.map(s => ({ value: s, slot: s })),
        min: opts.optional ? 0 : 1, max: 1, optional: !!opts.optional,
      }),
      pickNumber: (p, prompt, min, max) => ({
        req: 'choice', kind: 'number', player: p, prompt,
        options: range(min, max).map(n => ({ value: n, label: String(n) })),
        min: 1, max: 1,
      }),
      confirm: (p, prompt) => ({
        req: 'choice', kind: 'confirm', player: p, prompt,
        options: [{ value: true, label: 'Oui' }, { value: false, label: 'Non' }],
        min: 1, max: 1,
      }),
    };
    return ctx;
  }

  // ---------------------------------------------------- primitives de règles

  /** Marque une limite journalière. Retourne true si elle était disponible. */
  once(scope, key) {
    const bag = scope === 'game' ? this.state.flags
      : typeof scope === 'number' ? this.state.players[scope]?.flags
        : this.state.cards[scope]?.flags;
    if (!bag) return false;
    const k = `day:${key}`;
    if (bag[k]) return false;
    this.emit({ t: 'flag', scope, key: k, value: true });
    return true;
  }

  setFlag(scope, key, value) {
    this.emit({ t: 'flag', scope, key, value });
  }

  *gain(player, amount, potKind = POT.RESERVE) {
    if (amount <= 0) return 0;
    let n = amount;
    if (potKind === POT.RESERVE) {
      // Investisseur du Désert et consorts amplifient l'arrivée en réserve.
      n = yield* this.signalModify('reserveGain', { player, amount: n }, 'amount');
    }
    this.emit({ t: 'gold', player, delta: n, pot: potKind });
    yield* this.signal(potKind === POT.RESERVE ? 'goldToReserve' : 'goldToActive', { player, amount: n });
    return n;
  }

  *pay(player, amount) {
    const p = this.state.players[player];
    const n = Math.min(amount, p.active);
    if (n > 0) this.emit({ t: 'gold', player, delta: -n, pot: POT.ACTIVE });
    return n;
  }

  *draw(player, n = 1) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      const p = this.state.players[player];
      if (!p.deck.length) {
        if (!p.discard.length) break;
        // Deck épuisé : la défausse est remélangée pour former un nouveau deck.
        const order = shuffled(p.discard.slice(), this.rng);
        for (const id of order) {
          this.emit({ t: 'move', inst: id, to: { zone: ZONE.DECK, player }, reason: REASON.DRAW });
        }
        this.emit({ t: 'note', text: `${p.name} remélange sa défausse.`, kind: 'shuffle' });
      }
      const id = this.state.players[player].deck[0];
      if (!id) break;
      this.emit({ t: 'move', inst: id, to: { zone: ZONE.HAND, player }, reason: REASON.DRAW });
      drawn.push(this.state.cards[id]);
    }
    return drawn;
  }

  *addInfluence(inst, delta, until = UNTIL.PERMANENT, source = null) {
    if (!inst || !delta) return 0;
    let d = delta;
    // Le Berceau des Formes amplifie les variations d'influence sur son lieu.
    d = yield* this.signalModify('influenceDelta', { inst, delta: d, until }, 'delta');
    if (d < 0) {
      const guard = yield* this.signalModify('influenceLoss', { inst, delta: d }, 'delta');
      d = guard;
      if (d === 0) return 0;
    }
    if (!d) return 0;
    this.emit({ t: 'influence', inst: inst.id, delta: d, until, source });
    yield* this.signal('influenceChanged', { inst, delta: d, until });
    yield* this.syncControl();
    return d;
  }

  /**
   * Détruit une carte : défausse + déclenchements liés à la destruction.
   * `byEffect` distingue la destruction provoquée par une carte de celle qui
   * découle de l'expiration d'un lieu — plusieurs protections ne couvrent que
   * la première.
   */
  *destroy(inst, { byEffect = true } = {}) {
    if (!inst || inst.zone === ZONE.DISCARD || inst.zone === ZONE.LIMBO) return false;
    if (byEffect) {
      const shielded = yield* this.signalReplace('protectsFromDestroy', { inst });
      if (shielded) return false;
    }
    // Bouclier déposé sur la carte elle-même (Retraite Organisée) : il agit même
    // si la carte qui l'a posé a quitté le jeu.
    if (inst.flags['day:retreat']) {
      this.emit({ t: 'flag', scope: inst.id, key: 'day:retreat', value: null });
      yield* this.toDomain(inst, { exhausted: true });
      this.emit({ t: 'note', text: 'Retraite Organisée : la carte rejoint le domaine.', kind: 'save' });
      return false;
    }
    // Un effet peut remplacer la destruction (Cavalier des Rafales, Veilleuse).
    const replaced = yield* this.signalReplace('replaceDestroy', { inst, byEffect });
    if (replaced) return false;

    const slot = inst.slot;
    const owner = inst.owner ?? inst.player ?? inst.controller ?? 0;
    const controller = inst.controller ?? owner;
    const selfSpec = specFor(inst);
    yield* this.detachAll(inst);
    this.emit({
      t: 'move', inst: inst.id, to: { zone: ZONE.DISCARD, player: owner },
      reason: REASON.DESTROY,
    });
    // La carte détruite n'est plus en jeu : son propre déclenchement est appelé
    // explicitement, avec l'emplacement qu'elle occupait.
    if (typeof selfSpec.onSelfDestroyed === 'function') {
      yield* wrap(selfSpec.onSelfDestroyed(this.ctx(inst, { slot, player: controller }), { slot, controller }));
    }
    yield* this.signal('cardDestroyed', { inst, slot, controller });
    yield* this.signal('cardToDiscard', { inst, destroyed: true });
    yield* this.syncControl();
    return true;
  }

  /** Défausse simple : ne déclenche pas les effets de destruction. */
  *discardCard(inst) {
    if (!inst) return false;
    const owner = inst.owner ?? inst.player ?? inst.controller;
    if (owner === null || owner === undefined) {
      // Carte encore neutre (marché) : elle repart sous le deck de marché.
      this.emit({
        t: 'move', inst: inst.id, to: { zone: ZONE.MARKET_DECK, top: 'bottom' }, reason: REASON.DISCARD,
      });
      return true;
    }
    yield* this.detachAll(inst);
    this.emit({
      t: 'move', inst: inst.id, to: { zone: ZONE.DISCARD, player: owner },
      reason: REASON.DISCARD,
    });
    yield* this.signal('cardToDiscard', { inst, destroyed: false });
    return true;
  }

  /** Les attachements d'une carte qui quitte le jeu sont défaussés avec elle. */
  *detachAll(inst) {
    for (const id of (inst.attachments || []).slice()) {
      const att = this.state.cards[id];
      if (!att) continue;
      this.emit({ t: 'attach', inst: id, target: null });
      this.emit({ t: 'move', inst: id, to: { zone: ZONE.DISCARD, player: att.owner }, reason: REASON.DISCARD });
    }
  }

  *attachTo(inst, host) {
    this.emit({ t: 'attach', inst: inst.id, target: host ? host.id : null });
    if (host) yield* this.signal('attached', { inst, host });
  }

  /** Fait rejoindre un lieu à une carte, avec tous les déclenchements. */
  *moveToSlot(inst, slotIndex, reason = REASON.MOVE) {
    const from = inst.slot;
    const fromZone = inst.zone;
    // Le contrôle est lu avant l'arrivée : « rejoint un lieu contrôlé par un
    // adversaire » se juge sur l'état du lieu au moment où la carte y entre.
    const controlBefore = this.state.slots[slotIndex]?.controller ?? null;
    this.emit({
      t: 'move', inst: inst.id, to: { zone: ZONE.PLACE, slot: slotIndex },
      reason, controller: inst.controller ?? inst.owner,
    });
    for (const id of inst.attachments || []) {
      this.emit({ t: 'move', inst: id, to: { zone: ZONE.PLACE, slot: slotIndex }, reason });
    }
    // Les lieux qui limitent les poses par Jour ont besoin d'un compteur.
    if (reason === REASON.PLAY || reason === REASON.DEPLOY || reason === REASON.BUY) {
      const key = `day:placed:${inst.controller ?? inst.owner}:${slotIndex}`;
      this.emit({ t: 'flag', scope: 'game', key, value: (this.state.flags[key] || 0) + 1 });
    }
    if (fromZone === ZONE.PLACE && from !== slotIndex) {
      yield* this.signal('changedPlace', { inst, from, to: slotIndex });
    }
    yield* this.signal('enterPlace', { inst, slot: slotIndex, from: fromZone, reason, controlBefore });
    yield* this.syncControl();
  }

  *toDomain(inst, { exhausted = true, player = null, reason = REASON.RETURN } = {}) {
    const target = player ?? inst.controller ?? inst.owner;
    const fromZone = inst.zone;
    this.emit({
      t: 'move', inst: inst.id, to: { zone: ZONE.DOMAIN, player: target },
      reason, exhausted, controller: target,
    });
    // Une carte entrée dans le domaine ce Jour ne peut pas être déployée avant
    // le Jour suivant : on note le Jour d'arrivée.
    this.emit({ t: 'flag', scope: inst.id, key: 'arrivedDay', value: this.state.day });
    yield* this.signal('enterDomain', { inst, player: target, from: fromZone, reason });
  }

  *toHand(inst, player = null) {
    const target = player ?? inst.owner;
    this.emit({ t: 'move', inst: inst.id, to: { zone: ZONE.HAND, player: target }, reason: REASON.RETURN });
    yield* this.signal('enterHand', { inst, player: target });
  }

  /** Une carte visible du marché part sous le deck et est aussitôt remplacée. */
  *marketToBottom(inst) {
    this.emit({
      t: 'move', inst: inst.id, to: { zone: ZONE.MARKET_DECK, top: 'bottom' }, reason: REASON.DISCARD,
    });
    yield* refillMarket(this);
  }

  /** Résout un Éphémère joué gratuitement, puis le défausse. */
  *playEphemeralFree(inst, player) {
    const spec = specFor(inst);
    if (typeof spec.onPlay === 'function') {
      yield* wrap(spec.onPlay(this.ctx(inst, { player, action: { dest: 'resolve' } })));
    }
    yield* this.discardCard(inst);
  }

  createToken(cardId, owner) {
    const id = this.nextInstId();
    this.emit({ t: 'create', inst: id, cardId, owner, controller: owner, token: true });
    return this.state.cards[id];
  }

  /**
   * Recalcule le contrôle de chaque emplacement et déclenche les effets liés
   * aux prises et pertes de contrôle. Le contrôle est un état continu : il
   * change dès qu'une influence bouge, pas seulement au Crépuscule.
   */
  *syncControl() {
    if (this._syncing) return;          // les effets déclenchés rappellent ici
    this._syncing = true;
    try {
      for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (const slot of this.state.slots) {
          if (!slot.placeId || slot.expired) continue;
          const now = computeController(this.state, this.catalog, slot.index);
          if (now === slot.controller) continue;
          const from = slot.controller;
          this.emit({ t: 'control', slot: slot.index, player: now });
          this._syncing = false;
          yield* this.signal('controlChanged', { slot: slot.index, from, to: now });
          this._syncing = true;
          changed = true;
        }
        if (!changed) break;
      }
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Passe supplémentaire de Crépuscule sur un emplacement — Le Nocturne fait
   * se déclencher une fois de plus les effets de Crépuscule des cartes
   * présentes sur son lieu et du lieu lui-même, hors le sien.
   */
  *duskExtraPass(slotIndex, exceptInstId) {
    const slot = this.state.slots[slotIndex];
    if (!slot || slot.expired || slot.flags.timeless) return;
    for (const id of slot.cards.slice()) {
      if (id === exceptInstId) continue;
      const inst = this.state.cards[id];
      if (!inst || isSilenced(this.state, this.catalog, inst)) continue;
      const fn = specFor(inst).onDusk;
      if (typeof fn === 'function') yield* wrap(fn(this.ctx(inst)));
    }
    const fn = placeEffectsOf(slot.placeId).onDusk;
    if (typeof fn === 'function') yield* wrap(fn(this.ctx(null, { slot: slotIndex })));
  }

  // --------------------------------------------------------------- signaux

  /** Sources d'effets actives, dans l'ordre du premier joueur. */
  sources() {
    const out = [];
    const n = this.state.players.length;
    for (let k = 0; k < n; k++) {
      const p = this.state.players[(this.state.firstPlayer + k) % n];
      for (const id of p.bases) out.push(this.state.cards[id]);
      for (const id of p.domain) out.push(this.state.cards[id]);
    }
    for (const slot of this.state.slots) {
      for (const id of slot.cards) out.push(this.state.cards[id]);
    }
    return out.filter(i => i && !isSilenced(this.state, this.catalog, i));
  }

  /** Diffuse un signal à toutes les cartes et à tous les lieux en jeu. */
  *signal(name, data = {}) {
    const hook = `on${name[0].toUpperCase()}${name.slice(1)}`;
    for (const src of this.sources()) {
      const spec = specFor(src);
      const fn = spec[hook];
      if (typeof fn !== 'function') continue;
      if (!this.state.cards[src.id]) continue;  // détruite entre-temps
      yield* wrap(fn(this.ctx(src), data));
    }
    for (const slot of this.state.slots) {
      if (!slot.placeId || slot.expired) continue;
      const spec = placeEffectsOf(slot.placeId);
      const fn = spec[hook];
      if (typeof fn === 'function') yield* wrap(fn(this.ctx(null, { slot: slot.index }), data));
    }
  }

  /** Signal qui laisse les effets modifier une valeur numérique de `data`. */
  *signalModify(name, data, field) {
    const hook = `on${name[0].toUpperCase()}${name.slice(1)}`;
    let value = data[field];
    for (const src of this.sources()) {
      const fn = specFor(src)[hook];
      if (typeof fn !== 'function') continue;
      const r = yield* wrap(fn(this.ctx(src), { ...data, [field]: value }));
      if (typeof r === 'number') value = r;
    }
    for (const slot of this.state.slots) {
      if (!slot.placeId || slot.expired) continue;
      const fn = placeEffectsOf(slot.placeId)[hook];
      if (typeof fn !== 'function') continue;
      const r = yield* wrap(fn(this.ctx(null, { slot: slot.index }), { ...data, [field]: value }));
      if (typeof r === 'number') value = r;
    }
    return value;
  }

  /** Signal de remplacement : le premier effet qui répond `true` l'emporte. */
  *signalReplace(hook, data) {
    for (const src of this.sources()) {
      const fn = specFor(src)[hook];
      if (typeof fn !== 'function') continue;
      const r = yield* wrap(fn(this.ctx(src), data));
      if (r) return true;
    }
    for (const slot of this.state.slots) {
      if (!slot.placeId || slot.expired) continue;
      const fn = placeEffectsOf(slot.placeId)[hook];
      if (typeof fn !== 'function') continue;
      const r = yield* wrap(fn(this.ctx(null, { slot: slot.index }), data));
      if (r) return true;
    }
    return false;
  }

  /** Effets de phase, dans l'ordre du premier joueur. */
  *phaseHooks(hook) {
    for (const src of this.sources()) {
      const fn = specFor(src)[hook];
      if (typeof fn !== 'function') continue;
      if (!this.state.cards[src.id]) continue;
      yield* wrap(fn(this.ctx(src)));
    }
    for (const slot of this.state.slots) {
      if (!slot.placeId || slot.expired) continue;
      if (slot.flags.timeless) continue;    // Soleil Éternel
      const fn = placeEffectsOf(slot.placeId)[hook];
      if (typeof fn === 'function') yield* wrap(fn(this.ctx(null, { slot: slot.index })));
    }
  }
}

// ------------------------------------------------------------------ utilitaires

/** Autorise les effets écrits en fonction simple comme en générateur. */
function* wrap(result) {
  if (result && typeof result.next === 'function') return yield* result;
  return result;
}

function range(min, max) {
  const out = [];
  for (let i = min; i <= max; i++) out.push(i);
  return out;
}

function normalizeAnswer(req, answer) {
  if (req.max === 1) {
    if (Array.isArray(answer)) return answer[0] ?? null;
    return answer ?? null;
  }
  if (answer === null || answer === undefined) return [];
  return Array.isArray(answer) ? answer : [answer];
}

export { wrap };
