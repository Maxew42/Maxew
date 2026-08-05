// Rendu du plateau et animation des déplacements.
//
// Le plateau est reconstruit à chaque image, mais les cartes conservent leur
// identité : avant reconstruction on relève leur position, après on les fait
// glisser de l'ancienne à la nouvelle. Un déplacement décidé par le moteur se
// voit donc bouger, sans code d'animation par type d'événement.

import { renderCard, renderCardBack, renderPlace } from './card.js';
import { HandFan } from './hand.js';
import { faceOf, influenceOf, placeRecord } from '../rules/state.js';
import { PHASE_LABELS, PHASE } from '../rules/constants.js';
import { KIND, factionColor } from '../data/schema.js';

const SEAT_COLORS = ['--kalassir', '--aqaba', '--algarie', '--gold', '--ok'];

/**
 * Côté du lieu occupé par chaque camp, selon le nombre de joueurs. Le joueur
 * local est toujours en bas ; ses adversaires se répartissent autour comme
 * autour d'une table, plutôt que de s'entasser d'un seul côté.
 */
const RING_ORDER = {
  2: ['bottom', 'top'],
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
};
const RING_FALLBACK = ['bottom', 'left', 'top', 'right'];

/** Couleur de siège d'un joueur : sa faction, avec repli pour 4 joueurs et plus. */
export function seatColor(state, index) {
  const faction = state.players[index]?.faction;
  if (faction === 'kalassir') return 'var(--kalassir)';
  if (faction === 'aqaba') return 'var(--aqaba)';
  if (faction === 'algarie') return 'var(--algarie)';
  return `var(${SEAT_COLORS[index % SEAT_COLORS.length]})`;
}

export class BoardView {
  constructor(root, { catalog, onDrop, onZoom }) {
    this.catalog = catalog;
    this.onDrop = onDrop;
    this.onZoom = onZoom || (() => {});
    this.nodes = {
      board: root.querySelector('#board'),
      // Le plateau se déplace dans l'aire qui lui reste — le marché et la main
      // en sont exclus, c'est donc elle, et non la fenêtre, qui sert au cadrage.
      area: root.querySelector('#board-area'),
      opponents: root.querySelector('#opponent-domains'),
      places: root.querySelector('#places'),
      placesTag: root.querySelector('#places-tag'),
      market: root.querySelector('#market'),
      marketTag: root.querySelector('#market-tag'),
      mine: root.querySelector('#my-domain'),
      hand: root.querySelector('#hand'),
      dock: root.querySelector('#hand-dock'),
      piles: root.querySelector('#hand-piles'),
      handStats: root.querySelector('#hand-stats'),
      hudPlayers: root.querySelector('#hud-players'),
      phaseChip: root.querySelector('#phase-chip'),
      hud: root.querySelector('.hud'),
    };
    this.hand = new HandFan({
      dock: this.nodes.dock,
      fan: this.nodes.hand,
      rails: [this.nodes.piles, root.querySelector('.rail-side')].filter(Boolean),
    });
    this.scale = 1;
    this.offset = { x: 0, y: 0 };
    this.targets = null;      // instances désignables pendant un choix
    this.chosen = new Set();
    this.playable = null;     // instances que le joueur peut porter
    // Tant que le joueur n'a pas cadré lui-même, le plateau se réajuste seul :
    // une carte de plus sur un lieu ne doit pas pousser le marché hors écran.
    this.autoFit = true;
    this._installPanZoom();
    this._watchSize();
  }

  /** Redessine tout le plateau à partir de l'état, en animant les mouvements. */
  render(state, seat) {
    this.state = state;
    this.seat = seat;
    const before = this._snapshotPositions();

    this._renderHud(state, seat);
    this._renderDomains(state, seat);
    this._renderPlaces(state, seat);
    this._renderMarket(state, seat);
    this._renderHand(state, seat);

    this._animateFrom(before);
  }

  // ------------------------------------------------------------- FLIP

  _snapshotPositions() {
    const map = new Map();
    for (const node of document.querySelectorAll('[data-inst]')) {
      map.set(node.dataset.inst, node.getBoundingClientRect());
    }
    return map;
  }

  _animateFrom(before) {
    for (const node of document.querySelectorAll('[data-inst]')) {
      const prev = before.get(node.dataset.inst);
      if (!prev) continue;
      const now = node.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      // L'écart est mesuré à l'écran, mais appliqué dans le repère de la carte :
      // sur le plateau, celui-ci est mis à l'échelle du zoom.
      const k = node.closest('.board') ? (this.scale || 1) : 1;
      // Le glissement passe par la propriété `translate`, non par `transform` :
      // les cartes de la main portent déjà une transformation (leur place dans
      // l'éventail), et les deux se composent au lieu de s'écraser.
      node.animate(
        [{ translate: `${dx / k}px ${dy / k}px`, zIndex: 20 },
          { translate: 'none', zIndex: 20 }],
        { duration: 320, easing: 'cubic-bezier(.22,.7,.3,1)' },
      );
    }
  }

  // ------------------------------------------------------------- bandeau

  _renderHud(state, seat) {
    const chip = this.nodes.phaseChip;
    chip.innerHTML = '';
    const line = document.createElement('span');
    line.append(document.createTextNode('Jour '));
    const b = document.createElement('b');
    b.textContent = String(Math.max(1, state.day));
    line.append(b, document.createTextNode(` · ${PHASE_LABELS[state.phase] || ''}`));
    if (state.phase === PHASE.DAY) {
      line.append(document.createTextNode(` · ${state.players[state.activePlayer]?.name ?? ''}`));
    }
    chip.append(line);

    const host = this.nodes.hudPlayers;
    host.innerHTML = '';
    for (const p of state.players) {
      const node = document.createElement('div');
      node.className = 'hud-player';
      node.style.setProperty('--seat', seatColor(state, p.index));
      if (state.phase === PHASE.DAY && state.activePlayer === p.index) node.classList.add('active');
      if (p.index === seat) node.classList.add('you');
      const order = p.flags.order ? ` · ${p.flags.order.split(' ').pop()}` : '';
      node.innerHTML = `<span class="nm"></span>
        <span class="st">◎ <b>${p.active}</b>+${p.reserve} · ✦ <b>${p.vp}</b> · ✋ ${p.hand.length}${p.asleep ? ' · 💤' : ''}</span>`;
      node.querySelector('.nm').textContent = p.name + order;
      host.append(node);
    }
  }

  // ------------------------------------------------------------- domaines

  _renderDomains(state, seat) {
    this.nodes.opponents.innerHTML = '';
    this.nodes.mine.innerHTML = '';
    for (const p of state.players) {
      const node = this._domain(state, p, seat);
      if (p.index === seat) this.nodes.mine.append(node);
      else this.nodes.opponents.append(node);
    }
  }

  _domain(state, player, seat) {
    const wrap = document.createElement('div');
    wrap.className = 'domain' + (player.index === seat ? ' you' : '');
    wrap.style.setProperty('--seat', seatColor(state, player.index));
    // Le joueur dont c'est le tour voit tout son domaine cerné de sa couleur.
    if (state.phase === PHASE.DAY && state.activePlayer === player.index && !player.asleep) {
      wrap.classList.add('acting');
    }

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = player.index === seat ? 'Votre domaine' : player.name;
    wrap.append(who);

    const head = document.createElement('div');
    head.className = 'domain-head';
    // Le joueur local retrouve ses compteurs dans la barre de main : inutile de
    // les répéter sur son propre domaine.
    const chips = player.index === seat ? [] : [
      ['Or', `${player.active}<b>${player.reserve ? ` +${player.reserve}` : ''}</b>`],
      ['PV', `<b>${player.vp}</b>`],
      ['Main', `<b>${player.hand.length}</b>`],
      ['Deck', `<b>${player.deck.length}</b>`],
      ['Défausse', `<b>${player.discard.length}</b>`],
    ];
    for (const [label, value] of chips) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${label} ${value}`;
      head.append(chip);
    }
    if (player.flags.order && player.index !== seat) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = player.flags.order;
      head.append(chip);
    }
    if (head.children.length) wrap.append(head);

    const strip = document.createElement('div');
    strip.className = 'card-strip';
    strip.dataset.drop = 'domain';
    strip.dataset.player = String(player.index);
    strip.dataset.empty = 'Aucune carte jouée';
    if (!player.domain.length) strip.classList.add('empty');
    // La Base ne quitte jamais le domaine : c'est le pouvoir permanent de la
    // faction, elle est donc toujours visible au même endroit.
    for (const id of player.bases) {
      const node = this._cardNode(state, id, { mini: true });
      node.classList.add('base-card');
      strip.append(node);
    }
    for (const id of player.domain) strip.append(this._cardNode(state, id, { mini: true }));
    wrap.append(strip);
    return wrap;
  }

  // --------------------------------------------------------------- lieux

  _renderPlaces(state, seat) {
    const host = this.nodes.places;
    host.innerHTML = '';
    // On ne réserve une rangée haute ou basse que si au moins un lieu y pose des
    // cartes : les lieux restent alignés entre eux sans laisser de vide inutile.
    const sides = RING_ORDER[state.players.length] || RING_FALLBACK;
    const used = new Set();
    for (const slot of state.slots) {
      for (let k = 0; k < state.players.length; k++) {
        const index = (seat + k) % state.players.length;
        const where = sides[k] || RING_FALLBACK[k % RING_FALLBACK.length];
        if (where !== 'top' && where !== 'bottom') continue;
        if (slot.cards.some(id => state.cards[id]?.controller === index && !state.cards[id].attachedTo)) {
          used.add(where);
        }
      }
    }
    host.dataset.rows = `${used.has('top') ? 'T' : ''}${used.has('bottom') ? 'B' : ''}`;
    let live = 0;
    for (const slot of state.slots) {
      host.append(this._placeColumn(state, slot, seat));
      if (slot.placeId && !slot.expired) live++;
    }
    this.nodes.placesTag.textContent =
      `${live} actifs · ${state.expiredCount}/${state.endTarget} expirés · réserve ${state.placeDeck.length}`;
  }

  /**
   * Un lieu et les cartes qui l'entourent. Le joueur local occupe le côté bas,
   * ses adversaires le haut, la gauche puis la droite, dans l'ordre des sièges.
   */
  _placeColumn(state, slot, seat) {
    const col = document.createElement('div');
    col.className = 'place-col';
    col.dataset.drop = 'place';
    col.dataset.slot = String(slot.index);
    const holder = slot.controller;
    if (holder !== null && holder !== undefined) {
      col.classList.add('controlled');
      col.style.setProperty('--seat', seatColor(state, holder));
    }

    // Le lieu, ses camps du haut et du bas et sa ligne de contrôle forment une
    // colonne ; les camps latéraux sont des colonnes voisines. Ainsi une pile de
    // deux cartes sur un côté n'écarte plus le lieu de son propre camp.
    const ring = document.createElement('div');
    ring.className = 'ring';
    const mid = document.createElement('div');
    mid.className = 'ring-mid';

    const centre = document.createElement('div');
    centre.className = 'ring-center';
    const rec = placeRecord(this.catalog, slot);
    if (rec) {
      const card = renderPlace(this.catalog, rec, { duration: slot.duration });
      card.classList.add('zoomable');
      card.dataset.slot = String(slot.index);
      card.addEventListener('click', () => this.onZoom({ placeId: rec.id, slot: slot.index }));
      centre.append(card);
    } else {
      const empty = document.createElement('div');
      empty.className = 'deck-stack';
      empty.textContent = 'Emplacement clos';
      centre.append(empty);
    }

    // Attribution des côtés : le siège local en bas, les autres autour.
    const n = state.players.length;
    const sides = RING_ORDER[n] || RING_FALLBACK;
    const built = {};
    for (let k = 0; k < n; k++) {
      const index = (seat + k) % n;
      const where = sides[k] || RING_FALLBACK[k % RING_FALLBACK.length];
      const cards = slot.cards
        .map(id => state.cards[id])
        .filter(c => c && c.controller === index && !c.attachedTo);
      const side = document.createElement('div');
      side.className = `ring-${where} side ${where === 'left' || where === 'right' ? 'v' : 'h'}`;
      side.style.setProperty('--seat', seatColor(state, index));
      if (cards.length) {
        side.classList.add('filled');
        const total = cards.reduce(
          (sum, c) => sum + influenceOf(state, this.catalog, c, 'control'), 0);
        const label = document.createElement('span');
        label.className = 'side-name';
        // Une couronne devant le nom dit qui tient le lieu : la ligne « contrôlé
        // par » disait la même chose en deux lignes de plus par lieu. Le
        // contrôleur a toujours une carte présente (voir `computeController`),
        // la couronne a donc toujours un nom sur lequel se poser.
        if (index === holder) {
          label.append(crownIcon());
          label.title = 'Contrôle ce lieu';
        }
        label.append(document.createTextNode(`${state.players[index].name} · ${total}`));
        const strip = document.createElement('div');
        strip.className = 'side-cards';
        for (const inst of cards) strip.append(this._cardNode(state, inst.id, { onPlace: true }));
        side.append(label, strip);
      }
      built[where] = side;
    }
    for (const where of ['top', 'bottom', 'left', 'right']) {
      if (!built[where]) {
        const filler = document.createElement('div');
        filler.className = `ring-${where} side ${where === 'left' || where === 'right' ? 'v' : 'h'}`;
        built[where] = filler;
      }
    }

    mid.append(built.top, centre, built.bottom);
    ring.append(built.left, mid, built.right);
    col.append(ring);
    return col;
  }

  // -------------------------------------------------------------- marché

  /**
   * L'étalage, en deux colonnes de cartes debout dans l'allée de gauche. Deux
   * colonnes plutôt qu'une : une seule serait deux fois plus haute que l'écran,
   * et des cartes couchées d'un quart de tour ne se lisent pas.
   */
  _renderMarket(state, seat) {
    const host = this.nodes.market;
    host.innerHTML = '';
    // Le marché garde toujours le même nombre d'emplacements : sans cela, la
    // grille rétrécit puis regrandit à chaque achat et tout saute.
    const size = Math.max(state.market.visible.length,
      state.players.length + (state.config.marketExtra ?? 1));
    for (let i = 0; i < size; i++) {
      const id = state.market.visible[i];
      if (id) { host.append(this._cardNode(state, id, {})); continue; }
      const empty = document.createElement('div');
      empty.className = 'empty-slot';
      host.append(empty);
    }
    host.append(pileNode({
      label: 'deck de marché',
      count: state.market.deck.length,
      color: this.catalog.design.marketColor,
      title: 'Deck de marché — contenu non révélé',
      face: () => renderCardBack(this.catalog.design.marketColor),
    }));
    this.nodes.marketTag.textContent = state.market.boughtToday
      ? 'un achat a eu lieu ce Jour'
      : 'aucun achat ce Jour — rotation à la fin du Jour';
  }

  // ---------------------------------------------------------------- main

  _renderHand(state, seat) {
    const host = this.nodes.hand;
    host.innerHTML = '';
    if (seat === null || seat === undefined) { this.hand.setCards([]); return; }
    const me = state.players[seat];
    for (const id of me.hand) host.append(this._cardNode(state, id, { inHand: true }));
    if (!me.hand.length) {
      const empty = document.createElement('div');
      empty.className = 'deck-stack';
      empty.textContent = 'Main vide';
      host.append(empty);
    }
    // L'éventail est replacé avant que les glissements ne soient mesurés : une
    // carte piochée part donc de la pile et arrive à sa place dans la main.
    this.hand.setCards(me.hand.slice());

    // Deck et défausse, à gauche de la main. Le deck montre le dos de votre
    // paquet ; la défausse, étant publique, montre la carte qui la coiffe.
    const piles = this.nodes.piles;
    piles.innerHTML = '';
    const color = factionColor(this.catalog.design, me.faction);
    piles.append(pileNode({
      label: 'Deck', count: me.deck.length, color,
      title: 'Votre deck — contenu visible, ordre non révélé',
      face: () => renderCardBack(color),
      onClick: () => this.onZoom({ pile: 'deck', player: seat }),
    }));
    piles.append(pileNode({
      label: 'Défausse', count: me.discard.length, color,
      title: 'Votre défausse — cliquez pour la parcourir',
      face: () => this._topCardNode(state, me.discard),
      onClick: () => this.onZoom({ pile: 'discard', player: seat }),
    }));

    // Or et points de victoire, au-dessus du bouton « Se coucher ».
    this.nodes.handStats.innerHTML =
      `<span class="gold">◎ <b>${me.active}</b>${me.reserve ? ` +${me.reserve}` : ''}</span>`
      + `<span>✦ <b>${me.vp}</b></span>`;
  }

  /**
   * Carte qui coiffe une pile visible — la dernière arrivée. Elle porte son
   * `data-inst`, si bien qu'une carte défaussée depuis le plateau se voit
   * glisser jusque dans la pile ; l'aperçu est réduit, le texte n'y tiendrait pas.
   */
  _topCardNode(state, list) {
    const inst = state.cards[list[list.length - 1]];
    const face = inst && faceOf(this.catalog, inst);
    if (!face) return null;
    const node = renderCard(this.catalog, face);
    node.classList.add('mini');
    node.dataset.inst = inst.id;
    return node;
  }

  // --------------------------------------------------------------- carte

  _cardNode(state, instId, { mini = false, inHand = false, onPlace = false } = {}) {
    const inst = state.cards[instId];
    if (!inst) return document.createComment('carte absente');
    const face = faceOf(this.catalog, inst);
    if (!face) return document.createComment('face inconnue');

    const live = influenceOf(state, this.catalog, inst);
    const node = renderCard(this.catalog, face, { influence: hasInfluence(face) ? live : undefined });
    node.dataset.inst = instId;
    if (mini || onPlace) node.classList.add('mini');
    if (onPlace) node.classList.add('on-place');
    if (inst.exhausted) node.classList.add('exhausted');
    if (inst.controller !== null && inst.controller !== undefined) {
      const pip = document.createElement('span');
      pip.className = 'owner-pip';
      pip.style.setProperty('--seat', seatColor(state, inst.controller));
      node.append(pip);
    }
    if (inst.attachments?.length) {
      const badge = document.createElement('span');
      badge.className = 'attach-count';
      badge.textContent = `+${inst.attachments.length}`;
      badge.title = inst.attachments
        .map(id => faceOf(this.catalog, state.cards[id])?.name)
        .filter(Boolean).join(' · ');
      node.append(badge);
    }
    if (this.targets) {
      if (this.targets.has(instId)) node.classList.add('targetable');
      if (this.chosen.has(instId)) node.classList.add('chosen');
    }
    if (this.playable?.has(instId)) node.classList.add('playable');
    if (inHand) {
      // En main, le clic sert à jouer : la loupe ouvre la vue détaillée.
      const zoom = document.createElement('button');
      zoom.className = 'zoom-btn';
      zoom.type = 'button';
      zoom.textContent = '⌕';
      zoom.title = 'Agrandir la carte';
      zoom.addEventListener('pointerdown', ev => ev.stopPropagation());
      zoom.addEventListener('click', ev => { ev.stopPropagation(); this.onZoom({ inst: instId }); });
      node.append(zoom);
    } else {
      node.classList.add('zoomable');
      node.addEventListener('click', () => this.onZoom({ inst: instId }));
    }
    return node;
  }

  /** Met en évidence les cartes désignables pendant un choix. */
  setTargets(ids, chosen = []) {
    this.targets = ids ? new Set(ids) : null;
    this.chosen = new Set(chosen);
  }

  /** Marque les cartes que le joueur peut effectivement porter. */
  setPlayable(ids) { this.playable = ids ?? null; }

  // --------------------------------------------------------- zoom / pan

  _installPanZoom() {
    const wrap = this.nodes.area;
    let dragging = false, last = null, pinch = null;

    const apply = () => {
      this.nodes.board.style.transform =
        `translate(${this.offset.x}px, ${this.offset.y}px) scale(${this.scale})`;
    };
    this._apply = apply;

    wrap.addEventListener('pointerdown', ev => {
      // Le glisser de carte a la priorité : il pose cet attribut sur le corps.
      if (document.body.dataset.dragging === '1') return;
      if (ev.target.closest('.card') || ev.target.closest('.btn')) return;
      dragging = true;
      last = { x: ev.clientX, y: ev.clientY };
      wrap.setPointerCapture(ev.pointerId);
    });
    wrap.addEventListener('pointermove', ev => {
      if (!dragging) return;
      this.autoFit = false;
      this.offset.x += ev.clientX - last.x;
      this.offset.y += ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
      apply();
    });
    const stop = () => { dragging = false; };
    wrap.addEventListener('pointerup', stop);
    wrap.addEventListener('pointercancel', stop);

    wrap.addEventListener('wheel', ev => {
      ev.preventDefault();
      this.zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0016));
    }, { passive: false });

    // Pincement à deux doigts.
    const points = new Map();
    wrap.addEventListener('pointerdown', ev => points.set(ev.pointerId, ev));
    wrap.addEventListener('pointermove', ev => {
      if (!points.has(ev.pointerId)) return;
      points.set(ev.pointerId, ev);
      if (points.size !== 2) return;
      const [a, b] = [...points.values()];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      if (pinch) this.zoomAt(mid.x, mid.y, dist / pinch);
      pinch = dist;
      dragging = false;
    });
    const drop = ev => { points.delete(ev.pointerId); if (points.size < 2) pinch = null; };
    wrap.addEventListener('pointerup', drop);
    wrap.addEventListener('pointercancel', drop);
  }

  /** Recadre automatiquement dès que le contenu ou la fenêtre change de taille. */
  _watchSize() {
    if (typeof ResizeObserver === 'undefined') return;
    let pending = null;
    const observer = new ResizeObserver(() => {
      if (!this.autoFit) return;
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.fit({ keepAuto: true }));
    });
    observer.observe(this.nodes.board);
    observer.observe(this.nodes.area);

    // Sur écran large, le bandeau occupe le haut de l'allée : l'étalage doit
    // commencer sous lui. Sa hauteur dépend du nombre de joueurs, on la publie
    // donc plutôt que de la deviner — et on la mesure quand elle change, pas à
    // chaque image de l'animation.
    if (!this.nodes.hud) return;
    const hud = this.nodes.hud;
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--hud-h', `${hud.offsetHeight}px`);
    }).observe(hud);
  }

  zoomAt(clientX, clientY, factor) {
    const rect = this.nodes.area.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    this.autoFit = false;
    const next = Math.max(0.25, Math.min(2.4, this.scale * factor));
    const k = next / this.scale;
    this.offset.x = x - (x - this.offset.x) * k;
    this.offset.y = y - (y - this.offset.y) * k;
    this.scale = next;
    this._apply();
  }

  zoom(factor) {
    const rect = this.nodes.area.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  /** Cadre le plateau entier dans l'aire qui lui est laissée. */
  fit({ keepAuto = false } = {}) {
    if (!keepAuto) this.autoFit = true;
    const wrap = this.nodes.area.getBoundingClientRect();
    const board = this.nodes.board;
    const prev = board.style.transform;
    board.style.transform = 'none';
    const size = { w: board.scrollWidth, h: board.scrollHeight };
    board.style.transform = prev;
    if (!size.w || !size.h) return;
    // Une marge de 6 px évite qu'un arrondi rogne le bord du plateau.
    const next = Math.max(0.25, Math.min(1.5,
      Math.min((wrap.width - 6) / size.w, (wrap.height - 6) / size.h)));
    // Un écart infime ne justifie pas de redimensionner tout le plateau : sans
    // ce seuil, la moindre carte qui bouge fait « respirer » l'ensemble.
    if (keepAuto && Math.abs(next - this.scale) / this.scale < 0.02) return;
    this.scale = next;
    this.offset.x = Math.max(0, (wrap.width - size.w * this.scale) / 2);
    this.offset.y = Math.max(0, (wrap.height - size.h * this.scale) / 2);
    this._apply();
  }
}

/**
 * Un paquet posé sur la table : `face` fournit ce qu'on voit du dessus — un dos
 * pour une pioche, la dernière carte pour une défausse — et n'est appelé que si
 * la pile n'est pas vide. Sans `onClick`, la pile se regarde sans s'ouvrir.
 */
function pileNode({ label, count, color, title, face, onClick }) {
  const pile = document.createElement('div');
  pile.className = 'pile' + (count ? '' : ' empty') + (onClick ? '' : ' sealed');
  pile.style.setProperty('--pile', color);
  if (title) pile.title = title;
  if (onClick) pile.addEventListener('click', onClick);

  const top = document.createElement('div');
  top.className = 'pile-face';
  const inner = count ? face() : null;
  if (inner) top.append(inner);
  pile.append(top);

  const tag = document.createElement('div');
  tag.className = 'pile-count';
  const b = document.createElement('b');
  b.textContent = String(count);
  const span = document.createElement('span');
  span.textContent = label;
  tag.append(b, span);
  pile.append(tag);
  return pile;
}

/** Couronne du camp qui tient le lieu. Elle prend la couleur du siège. */
function crownIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'crown');
  svg.setAttribute('viewBox', '0 0 16 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M1.4 9.4V1.6l4 3.5L8 .8l2.6 4.3 4-3.5v7.8zM1.4 10.4h13.2v1.4H1.4z');
  svg.append(path);
  return svg;
}

/** Une carte affiche-t-elle une influence ? */
function hasInfluence(face) {
  return face.kind === KIND.UNIT || face.kind === KIND.BASE
    || typeof face.influence === 'number' || face.influence === '*';
}
