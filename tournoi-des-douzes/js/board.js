// Dessin du plateau.
//
// Le plateau est mis en page dans un espace virtuel de largeur fixe (BW) et de
// hauteur calculée, puis mis à l'échelle d'un seul coup pour tenir dans la
// place disponible. Les proportions sont donc identiques du téléphone en
// paysage à l'écran de bureau, et il n'y a qu'une seule géométrie à raisonner.
//
// « Cercle déroulé » : la table est un cercle, mais on la lit à plat. Les
// joueurs sont rangés dans l'ordre [moi, mon voisin de gauche, … , mon voisin
// de droite], si bien que la rangée des champs de joute se lit de gauche à
// droite comme un tour de table : mon champ de gauche à l'extrême gauche, mon
// champ de droite à l'extrême droite.

import { CARDS, CARD_BACK, cardImg, fullName, label } from './cards.js';
import { el } from './util.js';

const BW = 1520;
const R = 0.3875;                    // largeur / hauteur d'une carte
const SEAT_HUES = ['#f0c14b', '#5aa8e6', '#57b87a', '#e0714d', '#b07bd8', '#d95f8e'];

export class Board {
  constructor(root, { onZoom }) {
    this.root = root;
    this.onZoom = onZoom;
    this.n = 0;
    this.mySeat = 0;
    this.slots = new Map();          // "seat:side" → élément
    this.plates = new Map();         // seat → {troph, dots, piles}
    this.scale = 1;
  }

  key(seat, side) { return `${seat}:${side}`; }
  slot(seat, side) { return this.slots.get(this.key(seat, side)); }

  /** Couleur d'un siège, stable pour une partie donnée. */
  hue(seat) {
    const d = (this.mySeat - seat + this.n) % this.n;
    return d === 0 ? SEAT_HUES[0] : SEAT_HUES[1 + ((d - 1) % (SEAT_HUES.length - 1))];
  }

  // ── Mise en page ──────────────────────────────────────────────────────────

  /**
   * Construit la géométrie pour n joueurs vus du siège `me`.
   * `order[d]` = siège affiché en position d : [moi, moi−1, …, moi+1].
   */
  layout(n, me) {
    const order = Array.from({ length: n }, (_, d) => (me - d + n * 2) % n);

    const wide = n <= 3;
    const inner = 12, margin = 34;

    // Hauteur d'abord : c'est presque toujours elle qui limite, ces cartes
    // étant deux fois et demie plus hautes que larges. La largeur restante
    // devient de la marge — préférable à des cartes minuscules.
    const aw = Math.round(Math.min((BW - 2 * margin - (n - 1) * 18) / n, (wide ? 356 : 324) * R));
    const ah = Math.round(aw / R);
    const jw = Math.round(Math.min(
      ((BW - 2 * margin - (n - 1) * 22) / n - inner) / 2, (wide ? 300 : 262) * R));
    const jh = Math.round(jw / R);

    const railH = 88, labelH = 24, bannerH = 26;
    let y = 0;
    const railY = y; y += railH + 12;
    const arenaLabelY = y; y += labelH + 8;
    const arenaY = y; y += ah + 20;
    const joustLabelY = y; y += labelH + 6;
    const bannerY = y; y += bannerH + 4;
    const joustY = y; y += jh + 6;
    const BH = y;

    // Ces cartes sont deux fois et demie plus hautes que larges : la hauteur
    // épuisée, il reste toujours de la largeur. On l'étale entre les éléments
    // plutôt que de laisser un pâté centré entre deux marges vides.
    const spread = (count, w, min, max) => {
      const gap = Math.max(min, Math.min(max, (BW - 2 * margin - count * w) / Math.max(count - 1, 1)));
      const x0 = (BW - (count * w + (count - 1) * gap)) / 2;
      return d => x0 + d * (w + gap);
    };
    const plateW = Math.min(238, (BW - 2 * margin - (n - 1) * 12) / n);
    const duelW = 2 * jw + inner;

    return {
      n, me, order, BW, BH, aw, ah, jw, jh, railH, labelH, bannerH, plateW, duelW, inner,
      railY, arenaLabelY, arenaY, joustLabelY, bannerY, joustY,
      plateX: spread(n, plateW, 12, 40),
      arenaX: spread(n, aw, 18, 64),
      duelX: spread(n, duelW, 22, 54),
    };
  }

  /**
   * Les deux places d'un duel affiché en position p.
   * Le duel p oppose order[p] à order[p+1] ; la carte de gauche appartient à
   * order[p], celle de droite à order[p+1].
   */
  duelSides(L, p) {
    const a = L.order[p], b = L.order[(p + 1) % L.n];
    return [{ seat: a, side: 'left' }, { seat: b, side: 'right' }];
  }

  // ── Construction du DOM ───────────────────────────────────────────────────

  build(view) {
    const n = view.seats.length;
    this.n = n;
    this.mySeat = view.mySeat;
    this.names = view.seats.map(s => s.name);
    this.L = this.layout(n, view.mySeat);
    const L = this.L;

    this.root.textContent = '';
    this.root.style.width = L.BW + 'px';
    this.root.style.height = L.BH + 'px';
    this.slots.clear();
    this.plates.clear();

    // Plaques des joueurs
    L.order.forEach((seat, d) => {
      const p = el('div', 'plate' + (seat === view.mySeat ? ' me' : ''));
      p.style.cssText = `left:${L.plateX(d)}px;top:${L.railY}px;width:${L.plateW}px;height:${L.railH}px;--seat:${this.hue(seat)}`;
      const info = el('div', 'plate-info');
      const top = el('div', 'plate-top');
      const dot = el('span', 'ready-dot');
      const name = el('div', 'plate-name', view.seats[seat].name);
      top.append(dot, name);
      const troph = el('div', 'plate-troph', '0 🏆');
      info.append(top, troph);

      const piles = el('div', 'plate-piles');
      const pw = 26, ph = Math.round(pw / R);
      const deckCol = el('div', 'pile-col');
      const deck = el('div', 'pile');
      deck.style.cssText = `width:${pw}px;height:${ph}px`;
      deck.title = 'Pioche';
      deck.append(imgTag(CARD_BACK, 'Pioche'), el('span', 'pile-count', '0'));
      deckCol.append(deck, el('span', 'pile-tag', 'Pioche'));

      const discCol = el('div', 'pile-col');
      const disc = el('div', 'pile empty');
      disc.style.cssText = `width:${pw}px;height:${ph}px`;
      disc.title = 'Défausse';
      discCol.append(disc, el('span', 'pile-tag', 'Défausse'));
      piles.append(deckCol, discCol);

      p.append(info, piles);
      this.root.append(p);
      this.plates.set(seat, { root: p, dot, troph, deck, deckCount: deck.lastChild, disc });
    });

    // Arène : un dais discret derrière la rangée, pour l'ancrer au centre.
    const daisX = L.arenaX(0) - 26, daisW = L.arenaX(n - 1) + L.aw + 26 - daisX;
    const dais = el('div', 'dais');
    dais.style.cssText = `left:${daisX}px;top:${L.arenaY - 16}px;width:${daisW}px;height:${L.ah + 32}px`;
    this.root.append(dais);
    this.root.append(zoneLabel("L'Arène", L.arenaLabelY, L));
    L.order.forEach((seat, d) => {
      const tag = seat === view.mySeat ? 'Arène' : '';
      this.root.append(this.mkSlot(seat, 'arena', L.arenaX(d), L.arenaY, L.aw, L.ah, tag));
    });

    // Champs de joute
    this.root.append(zoneLabel('Champs de joute', L.joustLabelY, L));
    for (let p = 0; p < L.n; p++) {
      const [A, B] = this.duelSides(L, p);
      const x = L.duelX(p);
      const mine = A.seat === view.mySeat || B.seat === view.mySeat;
      const banner = el('div', 'duel-banner' + (mine ? ' mine' : ''));
      banner.style.cssText = `left:${x}px;top:${L.bannerY}px;width:${L.duelW}px;height:${L.bannerH}px`;
      banner.append(
        el('span', null, view.seats[A.seat].name),
        el('span', 'vs', '⚔'),
        el('span', null, view.seats[B.seat].name),
      );
      this.root.append(banner);

      const tagA = A.seat === view.mySeat ? 'Gauche' : '';
      const tagB = B.seat === view.mySeat ? 'Droite' : '';
      this.root.append(this.mkSlot(A.seat, A.side, x, L.joustY, L.jw, L.jh, tagA));
      this.root.append(this.mkSlot(B.seat, B.side, x + L.jw + L.inner, L.joustY, L.jw, L.jh, tagB));
    }

    this.fit();
  }

  mkSlot(seat, side, x, y, w, h, tag) {
    const s = el('div', 'slot');
    s.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    s.dataset.seat = seat;
    s.dataset.side = side;
    if (seat === this.mySeat) s.dataset.mine = '1';
    if (tag) s.append(el('div', 'slot-tag', tag));
    this.slots.set(this.key(seat, side), s);
    return s;
  }

  /**
   * Recalcule l'échelle pour remplir le conteneur.
   * `reserve` = hauteur réservée en bas (le bandeau de récit y passe).
   */
  fit() {
    if (!this.L) return;
    const box = this.root.parentElement;
    const aw = box.clientWidth, ah = box.clientHeight - (this.reserve || 0);
    if (aw <= 0 || ah <= 0) return;
    const s = Math.min(aw / this.L.BW, ah / this.L.BH);
    this.scale = s;
    const ox = (aw - this.L.BW * s) / 2, oy = (ah - this.L.BH * s) / 2;
    this.root.style.transform = `translate(${ox}px, ${oy}px) scale(${s})`;
  }

  // ── Rendu d'un état ───────────────────────────────────────────────────────

  /** Affiche une vue de phase de placement. */
  renderView(view) {
    for (const [seat, pl] of this.plates) {
      const s = view.seats[seat];
      pl.troph.textContent = `${s.trophies} 🏆`;
      pl.dot.classList.toggle('on', s.ready);
      pl.deckCount.textContent = s.deckCount;
      pl.deck.style.visibility = s.deckCount ? '' : 'hidden';
      this.setDiscard(seat, s.discard[0]);
    }
    for (const [, s] of this.slots) {
      s.classList.remove('focus', 'won', 'lost', 'tied', 'drop', 'drop-hot');
    }
    // Mes cartes posées face visible ; celles des autres, dos apparent.
    for (const [key, s] of this.slots) {
      const [seat, side] = key.split(':');
      const i = +seat;
      if (i === view.mySeat) {
        const c = view.placed ? view.placed[side] : null;
        this.setCard(i, side, c ? { n: c.n } : null, { faceUp: true });
      } else {
        const posed = view.seats[i].ready;
        this.setCard(i, side, posed ? { back: true } : null, {});
      }
    }
  }

  setDiscard(seat, top) {
    const pl = this.plates.get(seat);
    if (!pl) return;
    if (top == null) {
      pl.disc.textContent = '';
      pl.disc.classList.add('empty');
      return;
    }
    pl.disc.classList.remove('empty');
    if (pl.disc.dataset.n === String(top)) return;
    pl.disc.dataset.n = String(top);
    pl.disc.textContent = '';
    pl.disc.append(imgTag(cardImg(top), label(top)));
  }

  /**
   * Pose (ou retire) la carte d'une place.
   * @param {{n?:number, back?:boolean}|null} card
   */
  setCard(seat, side, card, { faceUp = true, force = null, anim = '' } = {}) {
    const s = this.slot(seat, side);
    if (!s) return null;
    const old = s.querySelector('.card');
    if (old) old.remove();
    if (!card) return null;

    const c = el('div', 'card' + (anim ? ' ' + anim : ''));
    if (card.back) {
      c.append(imgTag(CARD_BACK, 'Carte face cachée'));
    } else {
      c.append(imgTag(cardImg(card.n), fullName(card.n)));
      c.append(this.forceChip(card.n, force == null ? card.n : force));
      if (seat !== this.mySeat) c.append(el('div', 'owner-chip', this.ownerName(seat)));
      c.dataset.n = String(card.n);
      c.addEventListener('click', e => { e.stopPropagation(); this.onZoom(card.n); });
    }
    s.append(c);
    return c;
  }

  forceChip(base, force) {
    const chip = el('div', 'force-chip' + (force > base ? ' up' : force < base ? ' down' : ''));
    chip.textContent = String(force);
    if (force !== base) chip.append(el('s', null, String(base)));
    return chip;
  }

  /** Met à jour la pastille de force d'une place. */
  setForce(seat, side, force) {
    const c = this.slot(seat, side)?.querySelector('.card');
    if (!c) return;
    const base = +c.dataset.n;
    c.querySelector('.force-chip')?.remove();
    c.append(this.forceChip(base, force));
  }

  ownerName(seat) { return this.names ? this.names[seat] : ''; }

  /** Intervertit les cartes de deux places (Rosalie, Aliénor). */
  swapCards(p, q) {
    const a = this.slot(p.seat, p.side), b = this.slot(q.seat, q.side);
    if (!a || !b) return;
    const ca = a.querySelector('.card'), cb = b.querySelector('.card');
    if (ca) b.append(ca);
    if (cb) a.append(cb);
    for (const [slot, card] of [[a, cb], [b, ca]]) {
      if (!card) continue;
      const seat = +slot.dataset.seat;
      card.querySelector('.owner-chip')?.remove();
      if (seat !== this.mySeat) card.append(el('div', 'owner-chip', this.ownerName(seat)));
      card.classList.remove('flip'); void card.offsetWidth; card.classList.add('flip');
    }
  }

  mark(pos, cls) { this.slot(pos.seat, pos.side)?.classList.add(cls); }
  clearMarks(cls) { for (const [, s] of this.slots) s.classList.remove(cls); }

  /** Tampon VICTOIRE / DÉFAITE / NUL sur une carte. */
  stamp(pos, kind) {
    const c = this.slot(pos.seat, pos.side)?.querySelector('.card');
    if (!c) return;
    c.querySelector('.verdict')?.remove();
    const txt = kind === 'won' ? 'Vainqueur' : kind === 'lost' ? 'Vaincu' : 'Nul';
    c.append(Object.assign(el('div', 'verdict ' + kind, txt), {}));
  }

  /** Trophée qui s'envole d'une place vers la plaque du joueur. */
  flyTrophy(pos, seat, amount) {
    const from = this.slot(pos.seat, pos.side);
    const to = this.plates.get(seat)?.troph;
    if (!from || !to) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const f = el('div', 'fly-troph', `+${amount} 🏆`);
    f.style.left = a.left + a.width / 2 - 20 + 'px';
    f.style.top = a.top + a.height / 2 - 12 + 'px';
    document.body.append(f);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    f.animate(
      [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
       { transform: `translate(${dx * .5}px, ${dy * .5 - 26}px) scale(1.35)`, opacity: 1, offset: .55 },
       { transform: `translate(${dx}px, ${dy}px) scale(.7)`, opacity: 0 }],
      { duration: 720, easing: 'cubic-bezier(.3,.8,.3,1)' },
    ).onfinish = () => f.remove();
    to.classList.remove('bump'); void to.offsetWidth; to.classList.add('bump');
  }

  bumpTrophies(seat, total) {
    const pl = this.plates.get(seat);
    if (pl) pl.troph.textContent = `${total} 🏆`;
  }
}

const imgTag = (src, alt) => {
  const i = document.createElement('img');
  i.src = src; i.alt = alt || ''; i.draggable = false; i.decoding = 'async';
  return i;
};

function zoneLabel(text, y, L) {
  const d = el('div', 'zone-label', text);
  d.style.cssText = `left:0;top:${y}px;width:${L.BW}px;height:${L.labelH}px;line-height:${L.labelH}px`;
  return d;
}

export { CARDS, SEAT_HUES };
