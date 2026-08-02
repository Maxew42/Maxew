// Interface de jeu : plateau, main, glisser-déposer, et mise en scène de la
// résolution d'une manche. Ne parle qu'à une « session » (locale ou réseau) et
// ne connaît aucune règle : tout arrive dans le compte rendu de manche.
//
// La résolution est rejouable pas à pas. Plutôt que d'animer en avançant, on
// sait reconstruire l'état du plateau à n'importe quelle étape à partir du
// placement initial : reculer revient donc à rejouer les k premiers
// évènements. C'est ce qui permet de revenir en arrière pour comprendre — ou
// vérifier — ce qu'un effet a fait.

import { Board } from './board.js';
import { DragDrop } from './dnd.js';
import { cardImg, fullName } from './cards.js';
import { el, sleep } from './util.js';

const SLOTS = ['left', 'arena', 'right'];
const R = 0.3875;

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
    this.built = false;
    this.rp = null;         // état de relecture

    this.dnd = new DragDrop({
      enabled: () => !this.busy && !!this.view?.editable,
      targets: () => SLOTS.map(s => this.board.slot(this.view.mySeat, s)).filter(Boolean),
      onSelect: () => {},
      onDrop: (payload, target) => this.handleDrop(payload, target),
    });

    dom.ready.addEventListener('click', () => this.session?.confirm());
    dom.auto.addEventListener('click', () => this.session?.random());
    dom.quit.addEventListener('click', () => this.onQuit());
    dom.prev.addEventListener('click', () => this.jog(-1));
    dom.next.addEventListener('click', () => this.jog(1));
    dom.playPause.addEventListener('click', () => this.togglePlay());
    dom.skip.addEventListener('click', () => this.skipOrContinue());

    // Une seule source de vérité pour l'échelle : la taille réelle du
    // conteneur, qui bouge au redimensionnement comme au repli de la main.
    new ResizeObserver(() => {
      this.board.fit();
      // Le repli de la main change la forme du cadre : la table doit être
      // retracée pour l'épouser, sinon elle flotte entre deux bandes vides.
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => { if (this.board.aspectDrifted()) this.relayout(); });
    }).observe(dom.boardWrap);
    addEventListener('resize', () => this.relayout());
    addEventListener('orientationchange', () => setTimeout(() => this.relayout(), 250));
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
    if (this.rp) this.rp.abort = true;
    this.session = null;
  }

  /** Le rapport largeur/hauteur a changé : la table doit être redessinée. */
  relayout() {
    this.layoutHand();
    if (this.view && this.built) {
      this.board.build(this.view);
      if (this.rp) this.renderStep(this.rp.i);
      else { this.board.renderView(this.view); this.decorateMine(); }
    }
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
    this.dom.ready.disabled = !(v.editable && v.filled);
    this.dom.auto.disabled = !v.editable;
    this.dom.screen.classList.toggle('placing', !!v.editable);
    if (this.busy) return;
    const waiting = v.seats.filter((s, i) => i !== v.mySeat && !s.ready).length;
    if (!v.editable) {
      this.dom.hint.textContent = waiting
        ? `En attente de ${waiting} joueur${waiting > 1 ? 's' : ''}…`
        : 'Résolution…';
    } else if (v.filled) {
      this.dom.hint.textContent = 'Vos trois cartes sont en place — validez avec « Prêt ».';
    } else {
      this.dom.hint.textContent = 'Glissez vos trois cartes sur les emplacements dorés.';
    }
  }

  /** Bouton de retrait sur mes cartes posées, et rend celles-ci déplaçables. */
  decorateMine() {
    const v = this.view;
    for (const side of SLOTS) {
      const card = this.board.slot(v.mySeat, side)?.querySelector('.card');
      if (!card) continue;
      if (v.editable) {
        DragDrop.tag(card, { from: 'slot', side });
        card.classList.add('grabbable');
        const x = el('button', 'unplace', '✕');
        x.title = 'Reprendre en main';
        x.setAttribute('aria-label', 'Reprendre la carte en main');
        x.addEventListener('pointerdown', e => e.stopPropagation());
        x.addEventListener('click', e => { e.stopPropagation(); this.session.take(side); });
        card.append(x);
      } else {
        delete card.dataset.drag;
        card.classList.remove('grabbable');
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
    for (const c of cards) {
      const node = el('div', 'hand-card');
      node.append(imgTag(cardImg(c.n), fullName(c.n)));
      const z = el('button', 'zoom', '⌕');
      z.title = 'Voir la carte en grand';
      z.setAttribute('aria-label', 'Voir la carte en grand');
      z.addEventListener('pointerdown', e => e.stopPropagation());
      z.addEventListener('click', e => { e.stopPropagation(); this.onZoom(c.n); });
      node.append(z);
      DragDrop.tag(node, { from: 'hand', iid: c.iid });
      host.append(node);
    }
    this.layoutHand();
  }

  /**
   * En bas sur grand écran, à droite sur téléphone en paysage. Dans les deux
   * cas les cartes sont posées côte à côte, en entier : sur ces cartes très
   * hautes, un empilement vertical ne laissait voir qu'une lichette de chacune.
   */
  layoutHand() {
    const side = innerHeight < 560;
    this.dom.screen.classList.toggle('hand-right', side);
    this.dom.screen.classList.toggle('hand-bottom', !side);
    this.dom.auto.textContent = side ? 'Hasard' : 'Au hasard';

    const wrap = this.dom.handWrap;
    const nodes = [...this.dom.hand.querySelectorAll('.hand-card')];
    const count = nodes.length;

    // Pendant la résolution, la main est vide. En bas, on efface le bandeau et
    // le récit passe sous le plateau. À droite, la colonne reste et accueille
    // le récit : sur un écran de 390 px de haut, prendre 60 px au plateau
    // coûterait un cinquième de la taille des cartes.
    if (this.busy) {
      if (side) {
        wrap.style.cssText = 'width:190px';
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
    this.board.reserve = 0;

    if (side) {
      // Colonne de droite : trois cartes en rangée, entières.
      const sideH = 46;
      const availH = Math.max(wrap.clientHeight - 16 - sideH - 8, 90);
      const maxW = Math.round(Math.min(Math.max(innerWidth * 0.3, 180), 340));
      let cw = count ? Math.floor((maxW - 16 - (count - 1) * 6) / count) : 0;
      cw = Math.min(cw, Math.round(availH * R));
      const w = count ? cw * count + (count - 1) * 6 + 16 : 150;
      wrap.style.cssText = `width:${w}px`;
      for (const n of nodes) { n.style.width = cw + 'px'; n.style.height = Math.round(cw / R) + 'px'; }
    } else {
      const h = count
        ? Math.round(Math.min(Math.max(innerHeight * 0.25, 150), 250))
        : 66;
      wrap.style.cssText = `height:${h}px`;
      const ch = h - 22;
      for (const n of nodes) { n.style.height = ch + 'px'; n.style.width = Math.round(ch * R) + 'px'; }
    }
  }

  // ── Relecture de la manche ────────────────────────────────────────────────

  async playResolve(payload) {
    this.busy = true;
    this.dnd.reset();
    this.dom.screen.classList.add('resolving');
    this.dom.ready.disabled = this.dom.auto.disabled = true;
    this.dom.narr.classList.add('on');
    this.renderHand();
    this.layoutHand();
    this.dom.hint.textContent = `Manche ${payload.round} — combat !`;

    const rp = this.rp = {
      payload, i: -1, playing: true, done: false, touched: false,
      abort: false, nudge: false, continued: false,
    };
    const mine = payload.trophies[this.session.mySeat] ?? 0;
    const gain = mine === 0 ? 'vous ne remportez aucun trophée'
      : `vous remportez ${mine} trophée${mine > 1 ? 's' : ''}`;
    this.summary = `<b>Manche ${payload.round}</b> — ${gain}.`
      + (payload.gameOver ? " C'était la dernière." : '');

    // Toutes les cartes face cachée, puis on retourne.
    const n = payload.placements.length;
    for (let s = 0; s < n; s++) for (const side of SLOTS) this.board.setCard(s, side, { back: true });
    this.setControls();
    this.narrate('Les combattants prennent place…');
    await this.wait(420);
    if (rp.abort) return;
    for (let s = 0; s < n; s++) {
      for (const side of SLOTS) {
        this.board.setCard(s, side, { n: payload.placements[s][side].n }, { anim: 'flip' });
      }
    }
    rp.i = -1;
    this.renderStep(-1);

    // Lecture, pas à pas ou en continu.
    const evs = payload.events;
    while (!rp.abort && rp.i < evs.length - 1) {
      if (!rp.playing) { await sleep(70); continue; }
      const interrupted = await this.wait(BEAT[evs[rp.i + 1]?.k] ?? 1100);
      if (rp.abort) return;
      if (!interrupted && rp.playing) this.step(1);
    }
    if (rp.abort) return;

    // Bilan. Les commandes pas-à-pas restent actives : on peut remonter le
    // fil avant de passer à la suite.
    rp.done = true;
    payload.totals.forEach((t, i) => this.board.bumpTrophies(i, t));
    this.narrate(this.summary);
    this.setControls();
    // Enchaînement automatique au bout de trois secondes et demie — mais si le
    // joueur a touché aux commandes pas à pas, c'est qu'il inspecte la manche :
    // on attend alors son clic, aussi longtemps qu'il faut.
    for (let t = 0; !rp.continued && !rp.abort; t += 80) {
      await sleep(80);
      if (rp.touched) t = -80;
      else if (t >= 3500) break;
    }
    if (rp.abort) return;
    while (!rp.continued && !rp.abort) await sleep(80);
    if (rp.abort) return;

    this.dom.narr.classList.remove('on');
    this.dom.screen.classList.remove('resolving');
    this.rp = null;
    this.busy = false;
    this.board.reserve = 0;
    this.board.fit();
    if (payload.gameOver) { this.onEnd(payload); return; }
    this.session.advance();
  }

  /** Reconstruit le plateau tel qu'il est après l'évènement `i` (−1 = révélation). */
  renderStep(i) {
    const p = this.rp.payload;
    const n = p.placements.length;
    for (let s = 0; s < n; s++) {
      for (const side of SLOTS) this.board.setCard(s, side, { n: p.placements[s][side].n });
    }
    this.board.clearMarks('focus', 'won', 'lost', 'tied');

    const totals = p.totals.map((t, k) => t - p.trophies[k]);
    for (let k = 0; k <= i; k++) {
      const e = p.events[k];
      if (e.swap) this.board.swapCards(e.swap[0], e.swap[1]);
      if (e.forces) for (const f of e.forces) this.board.setForce(f.seat, f.side, f.force);
      if (e.k === 'joust') {
        if (e.winner === null) for (const q of e.focus) { this.board.mark(q, 'tied'); this.board.stamp(q, 'tied'); }
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
      if (e.k === 'trophy' && e.amount > 0) totals[e.seat] += e.amount;
    }
    totals.forEach((t, k) => this.board.bumpTrophies(k, t));

    const cur = i >= 0 ? p.events[i] : null;
    if (cur?.focus) for (const q of cur.focus) this.board.mark(q, 'focus');
    this.narrate(cur ? cur.text : 'Les cartes sont révélées.');
    this.setControls();
  }

  step(dir) {
    const rp = this.rp;
    if (!rp) return;
    const last = rp.payload.events.length - 1;
    const to = Math.max(-1, Math.min(last, rp.i + dir));
    if (to === rp.i) return;
    rp.i = to;
    this.renderStep(to);
    const e = dir > 0 && to >= 0 ? rp.payload.events[to] : null;
    if (e?.k === 'trophy' && e.amount > 0) {
      this.board.flyTrophy({ seat: e.seat, side: e.side }, e.seat, e.amount);
    }
  }

  /** Bouton « précédent » / « suivant » : passe en pas à pas. */
  jog(dir) {
    if (!this.rp) return;
    this.rp.touched = true;
    this.rp.playing = false;
    this.rp.nudge = true;
    this.step(dir);
    this.setControls();
  }

  togglePlay() {
    if (!this.rp) return;
    this.rp.touched = true;
    this.rp.playing = !this.rp.playing;
    this.rp.nudge = true;
    if (this.rp.playing && this.rp.done) {
      // Relire depuis le début.
      this.rp.i = -1;
      this.rp.done = false;
      this.renderStep(-1);
      this.resume();
    }
    this.setControls();
  }

  /** Relance la boucle de lecture après un retour en arrière. */
  async resume() {
    const rp = this.rp;
    const evs = rp.payload.events;
    while (!rp.abort && rp.i < evs.length - 1) {
      if (!rp.playing) { await sleep(70); continue; }
      const interrupted = await this.wait(BEAT[evs[rp.i + 1]?.k] ?? 1100);
      if (rp.abort || rp !== this.rp) return;
      if (!interrupted && rp.playing) this.step(1);
    }
    if (!rp.abort && rp === this.rp) {
      rp.done = true;
      this.narrate(this.summary);
      this.setControls();
    }
  }

  /** « Passer » saute à la fin ; une fois à la fin, enchaîne la manche. */
  skipOrContinue() {
    const rp = this.rp;
    if (!rp) return;
    if (!rp.done) {
      rp.playing = false;
      rp.nudge = true;
      rp.i = rp.payload.events.length - 1;
      this.renderStep(rp.i);
      rp.done = true;
      this.narrate(this.summary || '');
      this.setControls();
      return;
    }
    rp.continued = true;
  }

  setControls() {
    const rp = this.rp;
    if (!rp) return;
    const last = rp.payload.events.length - 1;
    this.dom.prev.disabled = rp.i <= -1;
    this.dom.next.disabled = rp.i >= last;
    this.dom.playPause.textContent = rp.playing ? '❚❚' : '▶';
    this.dom.playPause.title = rp.playing ? 'Mettre en pause' : (rp.done ? 'Revoir la manche' : 'Reprendre');
    this.dom.pos.textContent = `${rp.i + 1}/${last + 1}`;
    this.dom.skip.textContent = rp.done
      ? (rp.payload.gameOver ? 'Voir le classement' : 'Manche suivante')
      : 'Passer ⏭';
  }

  narrate(html) { this.dom.narrText.innerHTML = html; }

  /** Attend, en revenant plus tôt si le joueur touche aux commandes. */
  async wait(ms) {
    const rp = this.rp;
    for (let t = 0; t < ms; t += 60) {
      await sleep(60);
      if (!rp || rp.abort) return true;
      if (rp.nudge) { rp.nudge = false; return true; }
    }
    return false;
  }
}

const imgTag = (src, alt) => {
  const i = document.createElement('img');
  i.src = src; i.alt = alt; i.draggable = false; i.decoding = 'async';
  return i;
};
