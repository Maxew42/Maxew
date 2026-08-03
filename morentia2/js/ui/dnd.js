// Glisser-déposer des cartes.
//
// Une seule implémentation au pointeur couvre la souris et le tactile. Les
// cibles licites viennent du moteur (`legalActions`) : l'interface n'a aucune
// règle en propre, elle ne fait que montrer ce qui est permis.

const DRAG_THRESHOLD = 5;

export class DragLayer {
  constructor({ onDrop, getActions, isEnabled }) {
    this.onDrop = onDrop;
    this.getActions = getActions;
    this.isEnabled = isEnabled;
    this.active = null;
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
      moved: false, ghost: null, pointerId: ev.pointerId,
    };
  }

  _move(ev) {
    const a = this.active;
    if (!a || ev.pointerId !== a.pointerId) return;
    const dx = ev.clientX - a.start.x, dy = ev.clientY - a.start.y;
    if (!a.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

    if (!a.moved) {
      a.moved = true;
      document.body.dataset.dragging = '1';
      a.card.classList.add('dragging');
      const rect = a.card.getBoundingClientRect();
      const ghost = a.card.cloneNode(true);
      ghost.classList.remove('dragging');
      ghost.style.cssText = `position:fixed;left:0;top:0;width:${rect.width}px;height:${rect.height}px;
        pointer-events:none;z-index:60;opacity:.94;transform-origin:center;box-shadow:0 20px 44px rgba(0,0,0,.7)`;
      document.body.append(ghost);
      a.ghost = ghost;
      a.grab = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      this._highlight(a.actions, true);
    }

    a.ghost.style.transform =
      `translate(${ev.clientX - a.grab.x}px, ${ev.clientY - a.grab.y}px) rotate(2deg) scale(1.04)`;
    this._hover(ev);
    ev.preventDefault();
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
    a.ghost?.remove();
    a.card.classList.remove('dragging');
    delete document.body.dataset.dragging;
    this._highlight(a.actions, false);
    document.querySelectorAll('.drop-ok').forEach(n => n.classList.remove('drop-ok'));
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

  _hover(ev) {
    document.querySelectorAll('.hovered').forEach(n => n.classList.remove('hovered'));
    const node = this._nodeAt(ev.clientX, ev.clientY);
    if (node) node.classList.add('hovered');
  }

  _nodeAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.classList?.contains('drop-ok')) return el;
      const zone = el.closest?.('[data-drop].drop-ok');
      if (zone) return zone;
    }
    return null;
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
