// Glisser-déposer des cartes.
//
// Une seule implémentation au pointeur couvre la souris et le tactile. Les
// cibles licites viennent du moteur (`legalActions`) : l'interface n'a aucune
// règle en propre, elle ne fait que montrer ce qui est permis.
//
// Le fantôme suit le doigt à l'image près. Trois règles s'imposent pour cela :
//   - il ne porte aucune transition (une carte en a une, et un clone qui la
//     garde poursuit le pointeur en s'amortissant au lieu de le suivre) ;
//   - on n'écrit sa position qu'une fois par image, jamais par événement ;
//   - on ne mesure aucun élément pendant le glissement, sous peine d'imposer
//     un recalcul de mise en page à chaque image.

const DRAG_THRESHOLD = 5;

export class DragLayer {
  constructor({ onDrop, getActions, isEnabled, onCarry }) {
    this.onDrop = onDrop;
    this.getActions = getActions;
    this.isEnabled = isEnabled;
    this.onCarry = onCarry || (() => {});
    this.active = null;
    this.frame = 0;
    document.addEventListener('pointerdown', this._down.bind(this), true);
    document.addEventListener('pointermove', this._move.bind(this), true);
    document.addEventListener('pointerup', this._up.bind(this), true);
    document.addEventListener('pointercancel', this._cancel.bind(this), true);
  }

  _down(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (!this.isEnabled()) return;
    const card = ev.target.closest?.('.card[data-inst]');
    if (!card) return;
    const actions = this.getActions(card.dataset.inst);
    if (!actions.length) return;
    this.active = {
      inst: card.dataset.inst, card, actions,
      start: { x: ev.clientX, y: ev.clientY },
      // Dans la main, le doigt qui va de côté change de carte au lieu d'en sortir
      // une : le glissement n'est retenu que si le geste part vers le haut.
      fanned: !!card.closest('.hand-fan'),
      touch: ev.pointerType === 'touch',
      moved: false, ghost: null, pointerId: ev.pointerId,
    };
  }

  _move(ev) {
    const a = this.active;
    if (!a || ev.pointerId !== a.pointerId) return;
    const dx = ev.clientX - a.start.x, dy = ev.clientY - a.start.y;
    if (!a.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    if (!a.moved && a.fanned && a.touch && Math.abs(dx) > Math.abs(dy)) {
      this.active = null;      // balayage de la main : ce n'est pas un tirage
      return;
    }
    if (!a.moved) this._begin(a, ev);
    a.point = { x: ev.clientX, y: ev.clientY };
    this._schedule();
    if (ev.cancelable) ev.preventDefault();
  }

  /** Décolle la carte : fantôme, zones licites, et mesure unique du plateau. */
  _begin(a, ev) {
    a.moved = true;
    document.body.dataset.dragging = '1';
    a.card.classList.add('dragging');

    // Une carte de la main est inclinée dans l'éventail : son rectangle à l'écran
    // est celui de la carte penchée, plus grand qu'elle. Le fantôme reprend la
    // taille propre de la carte et vient se pendre sous le doigt.
    const rect = a.card.getBoundingClientRect();
    const w = a.fanned ? a.card.offsetWidth : rect.width;
    const h = a.fanned ? a.card.offsetHeight : rect.height;

    const ghost = a.card.cloneNode(true);
    ghost.classList.remove('dragging', 'focused');
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${w}px`;
    ghost.style.height = `${h}px`;
    // Le clone hérite de la place de la carte dans l'éventail : sans cela il
    // paraîtrait un instant penché dans le coin de l'écran.
    ghost.style.zIndex = '';
    a.grab = a.fanned
      ? { x: w / 2, y: h * 0.3 }
      : { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    ghost.style.transform = `translate3d(${ev.clientX - a.grab.x}px, ${
      ev.clientY - a.grab.y}px, 0) rotate(2deg) scale(1.04)`;
    document.body.append(ghost);
    a.ghost = ghost;

    this._highlight(a.actions, true);
    this.onCarry(true);
    // Le plateau ne bouge pas tant qu'une carte est en l'air : ses zones sont
    // donc mesurées une bonne fois, et le survol devient une comparaison de
    // nombres. La plus petite zone touchée l'emporte — c'est la plus précise.
    a.zones = [...document.querySelectorAll('.drop-ok')]
      .map(node => ({ node, r: node.getBoundingClientRect() }))
      .sort((x, y) => x.r.width * x.r.height - y.r.width * y.r.height);
  }

  /** Une seule écriture de position par image, quel que soit le débit du pointeur. */
  _schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const a = this.active;
      if (!a?.moved) return;
      a.ghost.style.transform = `translate3d(${a.point.x - a.grab.x}px, ${
        a.point.y - a.grab.y}px, 0) rotate(2deg) scale(1.04)`;
      this._hover(a);
    });
  }

  _up(ev) {
    const a = this.active;
    if (!a || ev.pointerId !== a.pointerId) return;
    if (a.moved) {
      const action = this._actionAt(ev.clientX, ev.clientY, a.actions);
      this._teardown();
      if (action) this.onDrop(action);
    } else {
      this.active = null;      // simple clic : traité ailleurs
    }
  }

  _cancel() { if (this.active?.moved) this._teardown(); else this.active = null; }

  _teardown() {
    const a = this.active;
    if (!a) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    a.ghost?.remove();
    a.card.classList.remove('dragging');
    delete document.body.dataset.dragging;
    this.onCarry(false);
    this._highlight(a.actions, false);
    document.querySelectorAll('.drop-ok').forEach(n => n.classList.remove('drop-ok'));
    document.querySelectorAll('.hovered').forEach(n => n.classList.remove('hovered'));
    this.active = null;
  }

  /** Marque les zones et les cartes qui acceptent la carte glissée. */
  _highlight(actions, on) {
    for (const action of actions) {
      for (const node of dropNodesFor(action)) node.classList.toggle('drop-ok', on);
      if (action.target) {
        document.querySelectorAll(`.card[data-inst="${action.target}"]`)
          .forEach(n => n.classList.toggle('targetable', on));
      }
    }
  }

  /** Souligne la zone survolée, à partir des rectangles mesurés au décollage. */
  _hover(a) {
    const { x, y } = a.point;
    const hit = a.zones.find(({ r }) =>
      x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    if (hit?.node === a.hovered) return;
    a.hovered?.classList.remove('hovered');
    hit?.node.classList.add('hovered');
    a.hovered = hit?.node ?? null;
  }

  /** Détermine l'action correspondant au point de lâcher. */
  _actionAt(x, y, actions) {
    const stack = document.elementsFromPoint(x, y);

    // Priorité à une carte visée (attachement d'unité).
    for (const el of stack) {
      const card = el.closest?.('.card[data-inst]');
      if (!card) continue;
      const hit = actions.find(a => a.target === card.dataset.inst);
      if (hit) return hit;
    }
    for (const el of stack) {
      const zone = el.closest?.('[data-drop]');
      if (!zone) continue;
      const hit = actions.find(a => matchesZone(a, zone));
      if (hit) return hit;
    }
    // Un Éphémère se résout où qu'on le lâche sur le plateau.
    return actions.find(a => a.dest === 'resolve') || null;
  }
}

function matchesZone(action, zone) {
  if (zone.dataset.drop === 'domain') {
    return action.dest === 'domain' && String(action.player ?? zone.dataset.player) === zone.dataset.player;
  }
  if (zone.dataset.drop === 'place') {
    const slot = Number(zone.dataset.slot);
    if (action.slot !== slot) return false;
    return action.type === 'deploy' || action.dest === 'place' || action.dest === 'attachPlace';
  }
  return false;
}

function dropNodesFor(action) {
  if (action.dest === 'domain') {
    return document.querySelectorAll(`[data-drop="domain"][data-player="${action.player ?? ''}"], .domain.you [data-drop="domain"]`);
  }
  if (action.slot !== undefined && action.slot !== null) {
    return document.querySelectorAll(`[data-drop="place"][data-slot="${action.slot}"]`);
  }
  if (action.dest === 'resolve') return document.querySelectorAll('[data-drop]');
  return [];
}
