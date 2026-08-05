// Main du joueur, tenue en éventail par-dessus le plateau.
//
// Le problème que cela règle : une rangée de cartes en pied d'écran vole au
// plateau la moitié de sa hauteur, et les cartes y sont malgré tout trop petites
// pour être lues. Ici la main flotte au-dessus de la table. Repliée, elle n'en
// montre que la tranche haute — le nom, l'influence et les prix, c'est-à-dire ce
// qui sert à choisir. Déployée, elle passe devant le plateau le temps qu'on porte
// une carte, puis se replie d'elle-même.
//
// Une seule carte est « au point » à la fois : celle qu'on survole à la souris,
// celle qu'on amène du doigt en balayant. Elle se redresse, monte et grandit ;
// ses voisines s'écartent. C'est le geste d'une main de cartes réelle, et cela
// donne à une seule carte la place d'être vraiment lisible.
//
// La position de chaque carte est écrite en `transform` par `layout()`. Rien
// dans la feuille de style ne doit la contredire : `.hand-fan .card:hover` est
// donc neutralisé côté CSS.

/** Distance, en fraction de largeur de carte, dont s'écartent les voisines. */
const SPREAD = 0.1;
/** Recouvrement maximal et minimal entre deux cartes voisines. */
const STEP_MAX = 0.54;
const STEP_MIN = 0.15;
/** Ouverture totale de l'éventail, en degrés. */
const FAN_DEG = 15;
/** Un frôlement du bord ne doit pas replier la main aussitôt. */
const CLOSE_DELAY = 110;

export class HandFan {
  constructor({ dock, fan, rails = [] }) {
    this.dock = dock;
    this.fan = fan;
    this.rails = rails;      // blocs flottants que l'éventail ne doit pas passer
    this.ids = [];
    this.focusId = null;
    this.step = 0;
    this.touching = false;     // dernier geste au doigt : la carte au point reste
    this.swipe = null;
    this.closeTimer = 0;
    this._install();
  }

  // ------------------------------------------------------------- contenu

  /**
   * Relève les cartes présentes après un rendu. La carte au point est suivie par
   * son identité ; si elle a quitté la main, c'est son rang qui est repris — on
   * reste sur place au lieu de sauter au bord de l'éventail.
   */
  setCards(ids) {
    const rank = this.focusId ? this.ids.indexOf(this.focusId) : -1;
    this.ids = ids;
    if (this.focusId && !ids.includes(this.focusId)) {
      this.focusId = ids.length && rank >= 0
        ? ids[Math.min(rank, ids.length - 1)]
        : null;
    }
    this.layout();
  }

  focusIndex() { return this.focusId ? this.ids.indexOf(this.focusId) : -1; }

  setFocus(id) {
    if (this.focusId === id) return;
    this.focusId = id;
    this.layout();
  }

  moveFocus(delta) {
    if (!this.ids.length) return;
    const from = this.focusIndex();
    const next = from < 0 ? 0 : from + delta;
    this.setFocus(this.ids[Math.max(0, Math.min(this.ids.length - 1, next))]);
  }

  // -------------------------------------------------------------- états

  open() {
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    if (this.dock.classList.contains('open')) return;
    this.dock.classList.add('open');
    this.layout();
  }

  close({ keepFocus = false } = {}) {
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.dock.classList.remove('open');
    if (!keepFocus) this.focusId = null;
    this.layout();
  }

  /** Une carte vient d'être décollée : la main s'écarte, le plateau se dégage. */
  carrying(on) {
    this.dock.classList.toggle('carrying', on);
    if (on) this.close({ keepFocus: true });
  }

  // ------------------------------------------------------------- gestes

  _install() {
    // Souris : le survol suffit à déployer et à mettre une carte au point. Pas
    // pendant qu'une carte est en l'air : le pointeur qui quitte l'éventail le
    // survole une dernière fois, et la main se rouvrirait sous la carte portée.
    this.fan.addEventListener('pointerover', ev => {
      if (ev.pointerType !== 'mouse' || document.body.dataset.dragging === '1') return;
      this.touching = false;
      this.open();
      const card = ev.target.closest?.('.card[data-inst]');
      if (card) this.setFocus(card.dataset.inst);
    });
    this.fan.addEventListener('pointerleave', ev => {
      if (ev.pointerType !== 'mouse' || document.body.dataset.dragging === '1') return;
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => this.close(), CLOSE_DELAY);
    });

    // Doigt : on déploie au contact, puis on balaie latéralement d'une carte à
    // l'autre. Le geste vertical, lui, appartient au tirage de carte (js/ui/dnd.js).
    this.fan.addEventListener('pointerdown', ev => {
      if (ev.pointerType === 'mouse' || document.body.dataset.dragging === '1') return;
      this.touching = true;
      this.open();
      const card = ev.target.closest?.('.card[data-inst]');
      if (card) this.setFocus(card.dataset.inst);
      this.swipe = { x: ev.clientX, y: ev.clientY, from: this.focusIndex(), id: ev.pointerId };
    });
    this.fan.addEventListener('pointermove', ev => {
      const s = this.swipe;
      if (!s || ev.pointerId !== s.id) return;
      const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
      if (Math.abs(dy) > Math.abs(dx)) return;
      const stride = Math.max(26, this.step);
      const next = Math.max(0, Math.min(this.ids.length - 1,
        (s.from < 0 ? 0 : s.from) + Math.round(dx / stride)));
      this.setFocus(this.ids[next]);
    });
    const endSwipe = () => { this.swipe = null; };
    this.fan.addEventListener('pointerup', endSwipe);
    this.fan.addEventListener('pointercancel', endSwipe);

    // Toucher ailleurs replie la main : sur mobile, rien ne signale la sortie.
    document.addEventListener('pointerdown', ev => {
      if (!this.touching) return;
      if (ev.target.closest?.('.hand-dock')) return;
      this.close({ keepFocus: true });
    }, true);

    // Au clavier, l'éventail se parcourt aux flèches — même service que le
    // balayage, pour qui joue à la souris.
    document.addEventListener('keydown', ev => {
      if (!this.dock.classList.contains('open')) return;
      if (ev.target.closest?.('input, textarea, select')) return;
      if (ev.key === 'ArrowLeft') this.moveFocus(-1);
      else if (ev.key === 'ArrowRight') this.moveFocus(1);
      else return;
      ev.preventDefault();
    });
  }

  // ----------------------------------------------------------- géométrie

  /**
   * Largeur qu'un éventail centré peut prendre sans passer sous les piles ni sous
   * les commandes. Mesurée, et non devinée : ces deux blocs changent de taille
   * avec l'écran, et sur téléphone ils ne sont pas du même côté qu'ailleurs.
   */
  _room() {
    const dock = this.dock.getBoundingClientRect();
    const middle = (dock.left + dock.right) / 2;
    let half = dock.width / 2;
    for (const rail of this.rails) {
      const r = rail.getBoundingClientRect();
      if (!r.width) continue;
      half = Math.min(half, r.right < middle ? middle - r.right - 10 : r.left - middle - 10);
    }
    return Math.max(0, half * 2);
  }

  /**
   * Place chaque carte de l'éventail. Le conteneur est dimensionné à l'éventail
   * lui-même : c'est lui, et lui seul, qui prend le pointeur, si bien qu'on peut
   * continuer à faire glisser le plateau de part et d'autre.
   */
  layout() {
    const cards = [...this.fan.children].filter(node => node.classList.contains('card'));
    const n = cards.length;
    if (!n) {
      this.fan.style.width = '';
      this.fan.style.height = '';
      this.fan.style.paddingTop = '';
      this.dock.style.setProperty('--fan-lift', '0px');
      return;
    }
    const w = cards[0].offsetWidth || 132;
    const h = cards[0].offsetHeight || Math.round(w * 1.4);
    const room = Math.max(w + 40, this._room());
    const step = n > 1
      ? Math.min(w * STEP_MAX, Math.max(w * STEP_MIN, (room - w) / (n - 1)))
      : 0;
    this.step = step;

    // Réserve laissée au-dessus de l'éventail pour la carte au point. Elle fait
    // partie de la surface sensible, et le dock la décompte de sa tranche visible
    // (`--fan-lift` dans la feuille de style).
    const lift = Math.round(h * 0.2);
    this.fan.style.width = `${Math.round(w + step * (n - 1))}px`;
    this.fan.style.height = `${h + lift}px`;
    this.fan.style.paddingTop = `${lift}px`;
    this.dock.style.setProperty('--fan-lift', `${lift}px`);

    const focus = this.focusIndex();
    const mid = (n - 1) / 2;
    const perDeg = mid > 0 ? Math.min(3.4, FAN_DEG / (n - 1)) : 0;
    const arc = Math.min(15, 3 + n * 1.7);
    for (let i = 0; i < n; i++) {
      const card = cards[i];
      const off = i - mid;
      const focused = i === focus;
      // L'éventail bombe vers le haut : la carte du milieu domine, comme un jeu
      // tenu à la main. Aucune carte ne descend sous le bord du dock.
      const bow = mid > 0 ? -arc * (1 - (off / mid) ** 2) : 0;
      let x = i * step;
      if (focus >= 0 && !focused) x += (i < focus ? -1 : 1) * w * SPREAD;
      const y = focused ? -lift : bow;
      const rot = focused ? 0 : off * perDeg;
      card.style.transform =
        `translate(${Math.round(x)}px, ${Math.round(y)}px) rotate(${rot.toFixed(2)}deg)`
        + (focused ? ' scale(1.06)' : '');
      card.style.zIndex = String(focused ? 40 : 10 + i);
      card.classList.toggle('focused', focused);
    }
  }
}
