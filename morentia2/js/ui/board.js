// Rendu du plateau et animation des déplacements.
//
// Le plateau est reconstruit à chaque image, mais les cartes conservent leur
// identité : avant reconstruction on relève leur position, après on les fait
// glisser de l'ancienne à la nouvelle. Un déplacement décidé par le moteur se
// voit donc bouger, sans code d'animation par type d'événement.

import { renderCard, renderPlace } from './card.js';
import { faceOf, influenceOf, placeRecord } from '../rules/state.js';
import { PHASE_LABELS, PHASE } from '../rules/constants.js';
import { KIND } from '../data/schema.js';

const SEAT_COLORS = ['--kalassir', '--aqaba', '--algarie', '--gold', '--ok'];

/** Couleur de siège d'un joueur : sa faction, avec repli pour 4 joueurs et plus. */
export function seatColor(state, index) {
  const faction = state.players[index]?.faction;
  if (faction === 'kalassir') return 'var(--kalassir)';
  if (faction === 'aqaba') return 'var(--aqaba)';
  if (faction === 'algarie') return 'var(--algarie)';
  return `var(${SEAT_COLORS[index % SEAT_COLORS.length]})`;
}

export class BoardView {
  constructor(root, { catalog, onDrop, onCardTap }) {
    this.catalog = catalog;
    this.onDrop = onDrop;
    this.onCardTap = onCardTap;
    this.nodes = {
      board: root.querySelector('#board'),
      wrap: root.querySelector('#board-wrap'),
      opponents: root.querySelector('#opponent-domains'),
      places: root.querySelector('#places'),
      placesTag: root.querySelector('#places-tag'),
      market: root.querySelector('#market'),
      marketTag: root.querySelector('#market-tag'),
      mine: root.querySelector('#my-domain'),
      hand: root.querySelector('#hand'),
      hudPlayers: root.querySelector('#hud-players'),
      phaseChip: root.querySelector('#phase-chip'),
    };
    this.scale = 1;
    this.offset = { x: 0, y: 0 };
    this.targets = null;      // instances désignables pendant un choix
    this.chosen = new Set();
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
      node.animate(
        [{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 20 },
          { transform: 'none', zIndex: 20 }],
        { duration: 320, easing: 'cubic-bezier(.22,.7,.3,1)' },
      );
    }
  }

  // ------------------------------------------------------------- bandeau

  _renderHud(state, seat) {
    const chip = this.nodes.phaseChip;
    chip.innerHTML = '';
    chip.append(document.createTextNode('Jour '));
    const b = document.createElement('b');
    b.textContent = String(Math.max(1, state.day));
    chip.append(b, document.createTextNode(` · ${PHASE_LABELS[state.phase] || ''}`));
    if (state.phase === PHASE.DAY) {
      chip.append(document.createTextNode(` · ${state.players[state.activePlayer]?.name ?? ''}`));
    }

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

    const head = document.createElement('div');
    head.className = 'domain-head';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = player.name;
    head.append(who);
    for (const [label, value] of [
      ['Or', `${player.active}<b>${player.reserve ? ` +${player.reserve}` : ''}</b>`],
      ['PV', `<b>${player.vp}</b>`],
      ['Deck', `<b>${player.deck.length}</b>`],
      ['Défausse', `<b>${player.discard.length}</b>`],
    ]) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${label} ${value}`;
      head.append(chip);
    }
    if (player.flags.order) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = player.flags.order;
      head.append(chip);
    }
    wrap.append(head);

    const strip = document.createElement('div');
    strip.className = 'card-strip';
    strip.dataset.drop = 'domain';
    strip.dataset.player = String(player.index);
    strip.dataset.empty = 'Domaine vide';
    if (!player.domain.length) strip.classList.add('empty');
    for (const id of player.domain) strip.append(this._cardNode(state, id, { mini: true }));
    wrap.append(strip);
    return wrap;
  }

  // --------------------------------------------------------------- lieux

  _renderPlaces(state, seat) {
    const host = this.nodes.places;
    host.innerHTML = '';
    let live = 0;
    for (const slot of state.slots) {
      host.append(this._placeColumn(state, slot, seat));
      if (slot.placeId && !slot.expired) live++;
    }
    this.nodes.placesTag.textContent =
      `${live} actifs · ${state.expiredCount}/${state.endTarget} expirés · réserve ${state.placeDeck.length}`;
  }

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

    const rec = placeRecord(this.catalog, slot);
    if (rec) {
      const card = renderPlace(this.catalog, rec, { duration: slot.duration });
      card.classList.add('mini');
      card.dataset.slot = String(slot.index);
      col.append(card);
    } else {
      const empty = document.createElement('div');
      empty.className = 'deck-stack';
      empty.textContent = 'Emplacement clos';
      col.append(empty);
    }

    const meta = document.createElement('div');
    meta.className = 'place-meta';
    const totals = state.players
      .map(p => {
        const v = slot.cards
          .map(id => state.cards[id])
          .filter(c => c && c.controller === p.index && !c.attachedTo)
          .reduce((n, c) => n + influenceOf(state, this.catalog, c, 'control'), 0);
        return v > 0 ? `<span style="color:${seatColor(state, p.index)}">${v}</span>` : null;
      })
      .filter(Boolean);
    meta.innerHTML = holder !== null && holder !== undefined
      ? `Contrôlé par <b>${state.players[holder].name}</b><br>${totals.join(' · ')}`
      : (totals.length ? `Personne ne contrôle<br>${totals.join(' · ')}` : 'Aucune présence');
    col.append(meta);

    // Cartes présentes, regroupées par joueur pour lire le rapport de force.
    const side = document.createElement('div');
    side.className = 'place-side';
    for (const p of state.players) {
      const mine = slot.cards
        .map(id => state.cards[id])
        .filter(c => c && c.controller === p.index && !c.attachedTo);
      if (!mine.length) continue;
      const row = document.createElement('div');
      row.className = 'side-row';
      row.style.setProperty('--seat', seatColor(state, p.index));
      const dot = document.createElement('span');
      dot.className = 'seat-dot';
      row.append(dot);
      for (const inst of mine) row.append(this._cardNode(state, inst.id, { mini: true }));
      side.append(row);
    }
    if (side.children.length) col.append(side);
    return col;
  }

  // -------------------------------------------------------------- marché

  _renderMarket(state, seat) {
    const host = this.nodes.market;
    host.innerHTML = '';
    const deck = document.createElement('div');
    deck.className = 'deck-stack';
    deck.innerHTML = `<b>${state.market.deck.length}</b><span>deck de marché</span>`;
    host.append(deck);
    for (const id of state.market.visible) host.append(this._cardNode(state, id, {}));
    this.nodes.marketTag.textContent = state.market.boughtToday
      ? 'un achat a eu lieu ce Jour'
      : 'aucun achat ce Jour — rotation à la fin du Jour';
  }

  // ---------------------------------------------------------------- main

  _renderHand(state, seat) {
    const host = this.nodes.hand;
    host.innerHTML = '';
    if (seat === null || seat === undefined) return;
    for (const id of state.players[seat].hand) host.append(this._cardNode(state, id, {}));
    if (!state.players[seat].hand.length) {
      const empty = document.createElement('div');
      empty.className = 'deck-stack';
      empty.textContent = 'Main vide';
      host.append(empty);
    }
  }

  // --------------------------------------------------------------- carte

  _cardNode(state, instId, { mini = false } = {}) {
    const inst = state.cards[instId];
    if (!inst) return document.createComment('carte absente');
    const face = faceOf(this.catalog, inst);
    if (!face) return document.createComment('face inconnue');

    const live = influenceOf(state, this.catalog, inst);
    const node = renderCard(this.catalog, face, { influence: hasInfluence(face) ? live : undefined });
    node.dataset.inst = instId;
    if (mini) node.classList.add('mini');
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
    node.addEventListener('click', ev => {
      if (this.onCardTap) this.onCardTap(instId, ev);
    });
    return node;
  }

  /** Met en évidence les cartes désignables pendant un choix. */
  setTargets(ids, chosen = []) {
    this.targets = ids ? new Set(ids) : null;
    this.chosen = new Set(chosen);
  }

  // --------------------------------------------------------- zoom / pan

  _installPanZoom() {
    const wrap = this.nodes.wrap;
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
    observer.observe(this.nodes.wrap);
  }

  zoomAt(clientX, clientY, factor) {
    const rect = this.nodes.wrap.getBoundingClientRect();
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
    const rect = this.nodes.wrap.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  /** Cadre le plateau entier dans la fenêtre. */
  fit({ keepAuto = false } = {}) {
    if (!keepAuto) this.autoFit = true;
    const wrap = this.nodes.wrap.getBoundingClientRect();
    const board = this.nodes.board;
    const prev = board.style.transform;
    board.style.transform = 'none';
    const size = { w: board.scrollWidth, h: board.scrollHeight };
    board.style.transform = prev;
    if (!size.w || !size.h) return;
    // Une marge de 6 px évite qu'un arrondi rogne le bord du plateau.
    this.scale = Math.max(0.25, Math.min(1.5,
      Math.min((wrap.width - 6) / size.w, (wrap.height - 6) / size.h)));
    this.offset.x = Math.max(0, (wrap.width - size.w * this.scale) / 2);
    this.offset.y = Math.max(0, (wrap.height - size.h * this.scale) / 2);
    this._apply();
  }
}

/** Une carte affiche-t-elle une influence ? */
function hasInfluence(face) {
  return face.kind === KIND.UNIT || face.kind === KIND.BASE
    || typeof face.influence === 'number' || face.influence === '*';
}
