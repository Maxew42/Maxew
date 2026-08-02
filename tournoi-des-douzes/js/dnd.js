// Glisser-déposer maison, en Pointer Events : la même implémentation sert la
// souris et le tactile, et elle traverse sans peine le `transform: scale()` du
// plateau (on teste les rectangles réels des cibles avec elementsFromPoint).
//
// Deux façons de jouer, toujours disponibles en parallèle :
//   • glisser une carte de la main vers une place (ou entre deux places) ;
//   • toucher une carte pour la sélectionner, puis toucher la place visée.

const DRAG_THRESHOLD = 6;   // px avant de considérer que c'est un glissé

export class DragDrop {
  /**
   * @param {{onDrop:(payload, target)=>void, onSelect:(payload|null)=>void,
   *          targets:()=>Element[], enabled:()=>boolean}} hooks
   */
  constructor(hooks) {
    this.h = hooks;
    this.selected = null;
    this.drag = null;
    this.ghost = null;
    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    document.addEventListener('pointerdown', this._down, { passive: false });
    document.addEventListener('pointermove', this._move, { passive: false });
    document.addEventListener('pointerup', this._up);
    document.addEventListener('pointercancel', this._up);
  }

  /** Rend une carte déplaçable. `payload` décrit ce qu'on transporte. */
  static tag(node, payload) {
    node.dataset.drag = JSON.stringify(payload);
    return node;
  }

  _payloadUnder(target) {
    const node = target.closest?.('[data-drag]');
    return node ? { node, payload: JSON.parse(node.dataset.drag) } : null;
  }

  _down(e) {
    if (!this.h.enabled() || e.button > 0) return;
    const hit = this._payloadUnder(e.target);
    if (!hit) {
      // Un clic sur une place valide la sélection en cours.
      const t = this._targetUnder(e.clientX, e.clientY);
      if (this.selected && t) {
        e.preventDefault();
        this._commit(this.selected.payload, t);
        this._deselect();
      }
      return;
    }
    if (e.target.closest('.zoom')) return;   // la loupe n'est pas une poignée
    e.preventDefault();
    this.pending = { ...hit, x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  _move(e) {
    if (this.pending && !this.drag) {
      if (Math.hypot(e.clientX - this.pending.x, e.clientY - this.pending.y) < DRAG_THRESHOLD) return;
      this._begin(e);
    }
    if (!this.drag) return;
    e.preventDefault();
    this._place(e.clientX, e.clientY);
    const t = this._targetUnder(e.clientX, e.clientY);
    for (const el of this.h.targets()) el.classList.toggle('drop-hot', el === t);
  }

  _up(e) {
    if (this.drag) {
      const t = this._targetUnder(e.clientX, e.clientY);
      this._end();
      if (t) this._commit(this.drag.payload, t);
      this.drag = null;
      this.pending = null;
      return;
    }
    if (this.pending) {
      // Simple appui : bascule la sélection.
      const p = this.pending;
      this.pending = null;
      if (this.selected && this.selected.node === p.node) this._deselect();
      else this._select(p);
    }
  }

  _begin(e) {
    this.drag = this.pending;
    this.pending = null;
    this._deselect();
    const r = this.drag.node.getBoundingClientRect();
    const img = this.drag.node.querySelector('img');
    this.ghost = document.createElement('div');
    this.ghost.id = 'drag-ghost';
    this.ghost.style.width = r.width + 'px';
    this.ghost.style.height = r.height + 'px';
    if (img) {
      const clone = img.cloneNode();
      clone.style.objectPosition = getComputedStyle(img).objectPosition;
      this.ghost.append(clone);
    }
    document.body.append(this.ghost);
    this.grab = { dx: this.drag.x - r.left, dy: this.drag.y - r.top };
    this.drag.node.classList.add('dragging');
    this._place(e.clientX, e.clientY);
    for (const el of this.h.targets()) el.classList.add('drop');
  }

  _place(x, y) {
    if (!this.ghost) return;
    this.ghost.style.left = x - this.grab.dx + 'px';
    this.ghost.style.top = y - this.grab.dy + 'px';
  }

  _end() {
    this.ghost?.remove();
    this.ghost = null;
    this.drag.node.classList.remove('dragging');
    for (const el of this.h.targets()) el.classList.remove('drop', 'drop-hot');
  }

  /** La cible de dépôt sous un point, en tenant compte du fantôme. */
  _targetUnder(x, y) {
    const wanted = new Set(this.h.targets());
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.id === 'drag-ghost') continue;
      const t = el.closest?.('.slot');
      if (t && wanted.has(t)) return t;
    }
    return null;
  }

  _select(p) {
    // Une seule carte sélectionnée à la fois : sans cela, taper successivement
    // deux cartes les laissait toutes deux en surbrillance.
    this._deselect();
    this.selected = p;
    p.node.classList.add('sel');
    for (const el of this.h.targets()) el.classList.add('drop');
    this.h.onSelect(p.payload);
  }

  _deselect() {
    // Balayage complet : le rendu de la main recrée les nœuds, une référence
    // gardée peut donc être périmée alors que la classe traîne encore.
    for (const n of document.querySelectorAll('.hand-card.sel, .card.sel')) n.classList.remove('sel');
    this.selected = null;
    for (const el of this.h.targets()) el.classList.remove('drop', 'drop-hot');
    this.h.onSelect(null);
  }

  _commit(payload, target) {
    this.h.onDrop(payload, { seat: +target.dataset.seat, side: target.dataset.side });
  }

  /** À appeler après un rendu : plus rien n'est sélectionné. */
  reset() { this._deselect(); }
}
