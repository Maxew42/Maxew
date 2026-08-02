// Interface de jeu : plateau, main, glisser-déposer, et mise en scène de la
// résolution d'une manche. Ne parle qu'à une « session » (locale ou réseau) et
// ne connaît aucune règle : tout arrive dans le compte rendu de manche.

import { Board } from './board.js';
import { DragDrop } from './dnd.js';
import { cardImg, fullName, CARDS } from './cards.js';
import { el, sleep } from './util.js';

const SLOTS = ['left', 'arena', 'right'];
const R = 0.3875;
/** Hauteur relative du centre de l'écusson du numéro sur une carte. */
const SHIELD = 0.165;

// Temps de lecture par type d'évènement (ms).
const BEAT = {
  reveal: 800, rosalie: 1900, force: 1350, joust: 1500,
  arena: 1900, trophy: 950, alienor: 1700,
};

export class Play {
  constructor(dom, { onQuit, onEnd, onZoom, toast }) {
    this.dom = dom;
    this.onQuit = onQuit;
    this.onEnd = onEnd;
    this.toast = toast;
    this.board = new Board(dom.board, { onZoom });
    this.onZoom = onZoom;
    this.view = null;
    this.busy = false;      // une résolution est en cours
    this.skip = false;
    this.built = false;

    this.dnd = new DragDrop({
      enabled: () => !this.busy && !!this.view?.editable,
      targets: () => SLOTS.map(s => this.board.slot(this.view.mySeat, s)).filter(Boolean),
      onSelect: () => {},
      onDrop: (payload, target) => this.handleDrop(payload, target),
    });

    dom.ready.addEventListener('click', () => this.session?.confirm());
    dom.auto.addEventListener('click', () => this.session?.random());
    dom.skip.addEventListener('click', () => this.onSkip());
    dom.quit.addEventListener('click', () => this.onQuit());

    // Une seule source de vérité pour l'échelle du plateau : la taille réelle
    // du conteneur, qui bouge au redimensionnement comme au replis de la main.
    new ResizeObserver(() => this.board.fit()).observe(dom.boardWrap);
    addEventListener('resize', () => this.layoutHand());
    addEventListener('orientationchange', () => setTimeout(() => this.layoutHand(), 250));
  }

  attach(session) {
    this.session = session;
    this.built = false;
    this.busy = false;
    session.onView = v => this.render(v);
    session.onResolve = p => this.playResolve(p);
    session.onNotice = (t, fatal) => {
      this.toast(t);
      if (fatal) setTimeout(() => this.onQuit(true), 2600);
    };
    session.start();
  }

  detach() {
    if (this.session) {
      this.session.onView = this.session.onResolve = this.session.onNotice = () => {};
    }
    this.session = null;
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  render(view) {
    this.view = view;
    if (!this.built) { this.board.build(view); this.built = true; }
    if (!this.busy) {
      this.board.renderView(view);
      this.decorateMine();
    }
    this.dom.round.textContent = String(view.round);
    this.renderHand();
    this.updateHud();
  }

  updateHud() {
    const v = this.view;
    const others = v.seats.filter((s, i) => i !== v.mySeat && !s.ready).length;
    this.dom.ready.disabled = !(v.editable && v.filled);
    this.dom.auto.disabled = !v.editable;
    if (this.busy) return;
    if (!v.editable) {
      this.dom.hint.textContent = others
        ? `En attente de ${others} joueur${others > 1 ? 's' : ''}…`
        : 'Résolution…';
    } else if (v.filled) {
      this.dom.hint.textContent = 'Trois cartes en place — validez avec « Prêt ».';
    } else {
      this.dom.hint.textContent = 'Glissez vos cartes sur Gauche, Arène et Droite.';
    }
  }

  /** Bouton de retrait sur mes cartes posées, et rend celles-ci déplaçables. */
  decorateMine() {
    const v = this.view;
    for (const side of SLOTS) {
      const slot = this.board.slot(v.mySeat, side);
      const card = slot?.querySelector('.card');
      if (!card) continue;
      if (v.editable) {
        DragDrop.tag(card, { from: 'slot', side });
        card.style.cursor = 'grab';
        card.style.touchAction = 'none';
        const x = el('button', 'unplace', '✕');
        x.title = 'Reprendre en main';
        x.addEventListener('pointerdown', e => e.stopPropagation());
        x.addEventListener('click', e => { e.stopPropagation(); this.session.take(side); });
        card.append(x);
      } else {
        delete card.dataset.drag;
      }
    }
  }

  handleDrop(payload, target) {
    if (target.seat !== this.view.mySeat) return;
    if (payload.from === 'hand') this.session.put(target.side, payload.iid);
    else if (payload.side !== target.side) this.session.move(payload.side, target.side);
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  renderHand() {
    const host = this.dom.hand;
    host.textContent = '';
    const cards = this.view?.hand || [];
    if (!cards.length) {
      host.append(el('div', 'hand-empty', this.busy ? '' : 'Main vide'));
      this.layoutHand();
      return;
    }
    for (const c of cards) {
      const node = el('div', 'hand-card');
      node.append(imgTag(cardImg(c.n), fullName(c.n)));
      const z = el('button', 'zoom', '⌕');
      z.title = 'Agrandir';
      z.addEventListener('click', e => { e.stopPropagation(); this.onZoom(c.n); });
      node.append(z);
      DragDrop.tag(node, { from: 'hand', iid: c.iid });
      host.append(node);
    }
    this.layoutHand();
  }

  /**
   * Deux dispositions selon la place : en bas, les cartes entières côte à côte ;
   * à droite (téléphone en paysage), des bandeaux montrant le haut des cartes —
   * numéro et nom — ce qui reste lisible sur une hauteur d'écran ridicule.
   */
  layoutHand() {
    const side = innerHeight < 560;
    this.dom.screen.classList.toggle('hand-right', side);
    this.dom.screen.classList.toggle('hand-bottom', !side);
    this.dom.auto.textContent = side ? 'Hasard' : 'Au hasard';

    const wrap = this.dom.handWrap;
    const nodes = [...this.dom.hand.querySelectorAll('.hand-card')];

    // Pendant la résolution, la main est vide. En bas, on efface le bandeau et
    // le récit passe en surimpression sous le plateau. À droite, la colonne
    // reste et accueille le récit : sur un écran de 390 px de haut, prendre
    // 60 px au plateau coûterait un cinquième de la taille des cartes.
    if (this.busy) {
      if (side) {
        wrap.style.cssText = 'width:172px';
        wrap.append(this.dom.narr);
        this.board.reserve = 0;
      } else {
        wrap.style.cssText = 'height:0;padding:0';
        this.dom.boardWrap.append(this.dom.narr);
        this.board.reserve = this.dom.narr.offsetHeight + 6;
      }
      this.board.fit();
      return;
    }
    this.dom.boardWrap.append(this.dom.narr);
    // Trois cartes posées mais pas encore validées : on réduit sans supprimer,
    // pour garder les boutons sous la main.
    const empty = nodes.length === 0;

    if (side) {
      const w = empty ? 152 : Math.round(Math.min(Math.max(innerWidth * 0.17, 116), 184));
      wrap.style.cssText = `width:${w}px`;
      if (empty) return;
      // Hauteur disponible = colonne moins la rangée de boutons. Les cartes
      // sont rognées sur leur haut : à cette taille c'est le grand numéro qui
      // porte l'information, le reste se lit d'un appui sur la loupe.
      const cw = w - 16;
      const sideH = this.dom.handWrap.querySelector('.hand-side')?.offsetHeight || 42;
      const avail = Math.max(wrap.clientHeight - 16 - sideH - 8, 90);
      const full = Math.round(cw / R);
      const ch = Math.max(40, Math.min(Math.floor((avail - (nodes.length - 1) * 8) / nodes.length), full));
      // Cadrage : on centre la fenêtre visible sur l'écusson du numéro, qui
      // occupe environ le sixième supérieur de la carte.
      const f = ch / full;
      const p = Math.max(0, Math.min(1, (SHIELD - f / 2) / Math.max(1 - f, 1e-3)));
      for (const n of nodes) {
        n.style.width = cw + 'px';
        n.style.height = ch + 'px';
        n.querySelector('img').style.objectPosition = `50% ${(p * 100).toFixed(1)}%`;
      }
    } else {
      const h = empty ? 66 : Math.round(Math.min(Math.max(innerHeight * 0.25, 146), 244));
      wrap.style.cssText = `height:${h}px`;
      if (empty) return;
      const ch = h - 22;
      for (const n of nodes) { n.style.height = ch + 'px'; n.style.width = Math.round(ch * R) + 'px'; }
    }
  }

  // ── Mise en scène de la résolution ────────────────────────────────────────

  async playResolve(payload) {
    this.busy = true;
    this.skip = false;
    this.dnd.reset();
    this.dom.ready.disabled = this.dom.auto.disabled = true;
    this.dom.narr.classList.add('on');
    this.renderHand();               // main vide → layoutHand place le récit
    this.layoutHand();
    this.dom.skip.textContent = 'Passer ⏭';
    this.dom.hint.textContent = `Manche ${payload.round} — combat !`;

    const n = payload.placements.length;
    const running = payload.totals.map((t, i) => t - payload.trophies[i]);

    // 1. Tout le monde a posé : on montre les dos, puis on retourne.
    for (let s = 0; s < n; s++) {
      for (const side of SLOTS) this.board.setCard(s, side, { back: true });
    }
    this.narrate('Les combattants prennent place…');
    await this.beat(420);
    for (let s = 0; s < n; s++) {
      for (const side of SLOTS) {
        const c = payload.placements[s][side];
        this.board.setCard(s, side, { n: c.n }, { anim: 'flip' });
      }
    }

    // 2. Le récit, évènement par évènement.
    for (const e of payload.events) {
      this.board.clearMarks('focus');
      if (e.swap) this.board.swapCards(e.swap[0], e.swap[1]);
      if (e.forces) for (const f of e.forces) this.board.setForce(f.seat, f.side, f.force);
      if (e.focus) for (const p of e.focus) this.board.mark(p, 'focus');

      if (e.k === 'joust') {
        if (e.winner === null) for (const p of e.focus) { this.board.mark(p, 'tied'); this.board.stamp(p, 'tied'); }
        else {
          this.board.mark(e.win, 'won'); this.board.stamp(e.win, 'won');
          this.board.mark(e.lose, 'lost'); this.board.stamp(e.lose, 'lost');
        }
      }
      if (e.k === 'arena') {
        for (let s = 0; s < n; s++) {
          const won = e.winners.includes(s);
          this.board.mark({ seat: s, side: 'arena' }, won ? 'won' : 'lost');
          this.board.stamp({ seat: s, side: 'arena' }, won ? 'won' : 'lost');
        }
      }
      if (e.k === 'trophy' && e.amount > 0) {
        running[e.seat] += e.amount;
        this.board.flyTrophy({ seat: e.seat, side: e.side }, e.seat, e.amount);
        setTimeout(() => this.board.bumpTrophies(e.seat, running[e.seat]), 480);
      }

      this.narrate(e.text);
      await this.beat(BEAT[e.k] ?? 1100);
    }

    // 3. Bilan de la manche, puis on enchaîne.
    this.board.clearMarks('focus');
    payload.totals.forEach((t, i) => this.board.bumpTrophies(i, t));
    const mine = payload.trophies[this.session.mySeat] ?? 0;
    const last = payload.gameOver;
    this.narrate(
      `<b>Manche ${payload.round}</b> — vous remportez ${mine} trophée${mine > 1 ? 's' : ''}. `
      + (last ? 'C\'était la dernière.' : ''), true);
    this.dom.skip.textContent = last ? 'Voir le classement' : 'Manche suivante';
    this.skip = false;
    await this.beat(last ? 4000 : 2600);

    this.dom.narr.classList.remove('on');
    this.board.reserve = 0;
    this.board.fit();
    this.busy = false;
    if (last) { this.onEnd(payload); return; }
    this.session.advance();
  }

  narrate(html, keep = false) {
    this.dom.narrText.innerHTML = html;
    if (!keep) this.dom.narrText.scrollTop = 0;
  }

  /** Attend, sauf si le joueur a demandé à passer. */
  async beat(ms) {
    if (this.skip) return;
    const step = 60;
    for (let t = 0; t < ms; t += step) {
      if (this.skip) return;
      await sleep(step);
    }
  }

  onSkip() { this.skip = true; }
}

const imgTag = (src, alt) => {
  const i = document.createElement('img');
  i.src = src; i.alt = alt; i.draggable = false; i.decoding = 'async';
  return i;
};

export { CARDS };
