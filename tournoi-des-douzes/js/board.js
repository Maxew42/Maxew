// Dessin du plateau : une vraie table, vue de dessus.
//
// Le plateau est mis en page dans un espace virtuel puis mis à l'échelle d'un
// seul coup pour tenir dans la place disponible. Les proportions sont donc
// identiques du téléphone en paysage à l'écran de bureau, et il n'y a qu'une
// seule géométrie à raisonner.
//
// Disposition : vous êtes assis en bas. Les autres joueurs occupent le tour de
// la table dans l'ordre réel des sièges — votre voisin de gauche à votre
// gauche, celui de droite à votre droite. Entre deux voisins se trouve le
// champ de joute qu'ils partagent, et l'arène occupe le milieu de la table.
// On lit ainsi l'adjacence sans explication : le champ de joute posé entre
// deux joueurs est littéralement entre eux.

import { CARDS, CARD_BACK, cardImg, fullName, label } from './cards.js';
import { el } from './util.js';

const BH = 900;                      // hauteur virtuelle, fixe
const R = 0.3875;                    // largeur / hauteur d'une carte
const SEAT_HUES = ['#f0c14b', '#5aa8e6', '#57b87a', '#e0714d', '#b07bd8', '#d95f8e'];

// Hauteur des cartes selon le nombre de joueurs : à deux la table est vide,
// à six il faut resserrer.
// Hauteurs visées ; la boucle de mise en page les réduit d'elle-même si la
// géométrie ne les accepte pas (écran très large, très étroit, joueurs impairs).
const CARD_H = {
  2: { arena: 470, joust: 440 },
  3: { arena: 400, joust: 350 },
  4: { arena: 340, joust: 300 },
  5: { arena: 310, joust: 274 },
  6: { arena: 286, joust: 252 },
};

const PLATE_W = 262, PLATE_H = 86, BANNER_H = 30, INNER = 12;

export class Board {
  constructor(root, { onZoom }) {
    this.root = root;
    this.onZoom = onZoom;
    this.n = 0;
    this.mySeat = 0;
    this.slots = new Map();          // "siège:place" → élément
    this.plates = new Map();         // siège → éléments de la plaque
    this.scale = 1;
    this.reserve = 0;
  }

  key(seat, side) { return `${seat}:${side}`; }
  slot(seat, side) { return this.slots.get(this.key(seat, side)); }

  /** Couleur d'un siège : l'or pour vous, une teinte distincte pour les autres. */
  hue(seat) {
    const d = (seat - this.mySeat + this.n) % this.n;
    return d === 0 ? SEAT_HUES[0] : SEAT_HUES[1 + ((d - 1) % (SEAT_HUES.length - 1))];
  }

  // ── Géométrie ─────────────────────────────────────────────────────────────

  /**
   * @param {number} n joueurs, @param {number} me siège du joueur
   * @param {number} aspect largeur/hauteur de la zone disponible
   */
  layout(n, me, aspect) {
    // Les cartes sont très hautes : selon le nombre de joueurs, un champ de
    // joute peut ne pas trouver de place sans mordre sur l'arène. On réduit
    // alors les cartes d'un cran et on recommence.
    for (let attempt = 0; attempt < 16; attempt++) {
      const L = this.tryLayout(n, me, aspect, 0.95 ** attempt);
      if (L) return L;
    }
    return this.tryLayout(n, me, aspect, 0.95 ** 16, true);
  }

  tryLayout(n, me, aspect, shrink, force = false) {
    const BW = Math.round(Math.max(1460, Math.min(2160, BH * (aspect || 1.95))));
    const cx = BW / 2, cy = BH / 2;

    // order[d] = siège affiché à l'angle d : [moi, mon voisin de gauche, …].
    const order = Array.from({ length: n }, (_, d) => (me - d + n * 4) % n);
    // Angles écran (y vers le bas) : 90° = en bas. On tourne dans le sens des
    // angles croissants, ce qui place le voisin de gauche… à gauche.
    const seatDeg = d => 90 + (d * 360) / n;
    const fieldDeg = p => 90 + ((p + 0.5) * 360) / n;

    const h = CARD_H[n] || CARD_H[6];
    const ah = Math.round(h.arena * shrink), aw = Math.round(ah * R);
    const jh = Math.round(h.joust * shrink), jw = Math.round(jh * R);
    const duelW = 2 * jw + INNER;
    const fieldH = jh + BANNER_H + 4;

    // Anneau des plaques : au bord du plateau, un cran plus haut que large.
    const SRx = BW / 2 - PLATE_W / 2 - 8;
    const SRy = BH / 2 - PLATE_H / 2 - 8;
    const at = (deg, rx, ry) => {
      const t = (deg * Math.PI) / 180;
      return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
    };

    const seats = order.map((seat, d) => {
      const c = at(seatDeg(d), SRx, SRy);
      // Arrondi : sans lui, deux sièges diamétralement opposés diffèrent d'un
      // milliardième de pixel et le tri de l'arène devient imprévisible.
      const px = Math.round(c.x), py = Math.round(c.y);
      return { seat, d, deg: seatDeg(d), x: px - PLATE_W / 2, y: py - PLATE_H / 2, cx: px, cy: py };
    });

    // L'arène : une rangée au centre, rangée comme le tour de table (de gauche
    // à droite, le joueur du bas d'abord à égalité) pour que le milieu se lise
    // dans le même sens que le pourtour.
    const arenaSeats = seats.slice().sort((p, q) => p.cx - q.cx || q.cy - p.cy).map(s => s.seat);
    const gapA = n <= 3 ? 20 : 12;
    const arenaW = n * aw + (n - 1) * gapA;

    // À nombre impair de joueurs, un champ de joute tombe pile en haut de la
    // table, face à votre siège. On descend l'arène de quoi le laisser passer.
    const topField = n % 2 === 1 ? fieldH + 24 + ah / 2 : 0;
    const shiftY = Math.max(0, Math.min(topField - cy, (BH - ah) / 2 - 60));
    const arena = { x: cx - arenaW / 2, y: cy + shiftY - ah / 2, w: arenaW, h: ah };

    // Les champs de joute : sur un anneau intermédiaire, repoussés vers
    // l'extérieur tant qu'ils mordent sur l'arène ou sur une plaque.
    const plateRects = seats.map(s => ({ x: s.x, y: s.y, w: PLATE_W, h: PLATE_H }));
    if (!force && plateRects.some(r => hits(r, arena, 8))) return null;
    const FRx = SRx * 0.66, FRy = SRy * 0.78;
    const fields = [];
    for (let p = 0; p < n; p++) {
      const deg = fieldDeg(p);
      let box = null;
      for (let k = 1; k < 2.4; k += 0.03) {
        const c = at(deg, FRx * k, FRy * k);
        const b = {
          x: clamp(c.x - duelW / 2, 8, BW - duelW - 8),
          y: clamp(c.y - fieldH / 2, 8, BH - fieldH - 8),
          w: duelW, h: fieldH,
        };
        if (hits(b, arena, 16)) continue;
        if (plateRects.some(r => hits(b, r, 4))) continue;
        box = b;
        break;
      }
      if (!box) { if (!force) return null; box = { x: 8, y: 8, w: duelW, h: fieldH }; }
      fields.push(box);
    }
    // Deux champs de joute ne doivent pas non plus se recouvrir.
    for (let i = 0; i < fields.length && !force; i++) {
      for (let j = i + 1; j < fields.length; j++) if (hits(fields[i], fields[j], 4)) return null;
    }

    return {
      n, me, order, arenaSeats, BW, BH, cx, cy, aw, ah, jw, jh, duelW,
      seats, fields, arena, gapA, aspect: BW / BH,
      arenaX: d => arena.x + d * (aw + gapA),
      table: { rx: SRx * 0.94, ry: SRy * 0.97 },
    };
  }

  /**
   * Le conteneur a-t-il assez changé de forme pour valoir un nouveau tracé ?
   * L'ellipse est calculée pour un rapport donné ; laisser dériver reviendrait
   * à laisser deux grandes bandes vides sur les côtés.
   */
  aspectDrifted() {
    if (!this.L) return true;
    const box = this.root.parentElement;
    const h = box.clientHeight - (this.reserve || 0);
    if (box.clientWidth <= 0 || h <= 0) return false;
    const want = box.clientWidth / h;
    const have = this.L.aspect;
    // Hors bornes, le rapport est bridé : inutile de retracer.
    const clamped = Math.max(1460 / BH, Math.min(2160 / BH, want));
    return Math.abs(clamped - have) / have > 0.05;
  }

  /**
   * Les deux places d'un champ de joute affiché en position p : la carte de
   * gauche appartient au joueur affiché en p, celle de droite au suivant.
   */
  duelSides(L, p) {
    return [
      { seat: L.order[p], side: 'left' },
      { seat: L.order[(p + 1) % L.n], side: 'right' },
    ];
  }

  // ── Construction du DOM ───────────────────────────────────────────────────

  build(view) {
    const n = view.seats.length;
    this.n = n;
    this.mySeat = view.mySeat;
    this.names = view.seats.map(s => s.name);
    const box = this.root.parentElement;
    const aspect = box.clientHeight > 0
      ? box.clientWidth / Math.max(box.clientHeight - this.reserve, 1) : 1.95;
    this.L = this.layout(n, view.mySeat, aspect);
    const L = this.L;

    this.root.textContent = '';
    this.root.style.width = L.BW + 'px';
    this.root.style.height = L.BH + 'px';
    this.slots.clear();
    this.plates.clear();

    // La table elle-même.
    const table = el('div', 'table-top');
    table.style.cssText =
      `left:${L.cx - L.table.rx}px;top:${L.cy - L.table.ry}px;`
      + `width:${2 * L.table.rx}px;height:${2 * L.table.ry}px`;
    this.root.append(table);

    // Le dais de l'arène.
    const dais = el('div', 'dais');
    dais.style.cssText =
      `left:${L.arena.x - 30}px;top:${L.arena.y - 40}px;`
      + `width:${L.arena.w + 60}px;height:${L.arena.h + 74}px`;
    dais.append(el('div', 'dais-label', "L'Arène"));
    this.root.append(dais);

    // Plaques des joueurs, tout autour.
    for (const s of L.seats) {
      const mine = s.seat === view.mySeat;
      const p = el('div', 'plate' + (mine ? ' me' : ''));
      p.style.cssText = `left:${s.x}px;top:${s.y}px;width:${PLATE_W}px;height:${PLATE_H}px;--seat:${this.hue(s.seat)}`;

      const info = el('div', 'plate-info');
      const top = el('div', 'plate-top');
      const dot = el('span', 'ready-dot');
      // Pas de « (vous) » : la plaque dorée et le liseré le disent déjà, et le
      // suffixe ne ferait que tronquer le nom.
      top.append(dot, el('div', 'plate-name', view.seats[s.seat].name));
      const troph = el('div', 'plate-troph', '0 🏆');
      info.append(top, troph);

      const piles = el('div', 'plate-piles');
      const pw = 28, ph = Math.round(pw / R);
      const deck = el('div', 'pile');
      deck.style.cssText = `width:${pw}px;height:${ph}px`;
      deck.title = 'Pioche';
      deck.append(imgTag(CARD_BACK, 'Pioche'), el('span', 'pile-count', '0'));
      const disc = el('div', 'pile empty');
      disc.style.cssText = `width:${pw}px;height:${ph}px`;
      disc.title = 'Défausse';
      piles.append(pileCol(deck, 'Pioche'), pileCol(disc, 'Défausse'));

      p.append(info, piles);
      this.root.append(p);
      this.plates.set(s.seat, { root: p, dot, troph, deck, deckCount: deck.lastChild, disc });
    }

    // L'arène.
    L.arenaSeats.forEach((seat, d) => {
      const mine = seat === view.mySeat;
      this.root.append(this.mkSlot(seat, 'arena', L.arenaX(d), L.arena.y, L.aw, L.ah, mine ? 'Arène' : ''));
    });

    // Les champs de joute, chacun entre les deux joueurs qui le partagent.
    for (let p = 0; p < L.n; p++) {
      const [A, B] = this.duelSides(L, p);
      const box = L.fields[p];
      const mine = A.seat === view.mySeat || B.seat === view.mySeat;
      const banner = el('div', 'duel-banner' + (mine ? ' mine' : ''));
      banner.style.cssText = `left:${box.x}px;top:${box.y}px;width:${L.duelW}px;height:${BANNER_H}px`;
      banner.append(
        el('span', null, this.names[A.seat]),
        el('span', 'vs', '⚔'),
        el('span', null, this.names[B.seat]),
      );
      this.root.append(banner);

      const cardY = box.y + BANNER_H + 4;
      this.root.append(this.mkSlot(A.seat, A.side, box.x, cardY, L.jw, L.jh,
        A.seat === view.mySeat ? 'Gauche' : ''));
      this.root.append(this.mkSlot(B.seat, B.side, box.x + L.jw + INNER, cardY, L.jw, L.jh,
        B.seat === view.mySeat ? 'Droite' : ''));
    }

    // Les plaques repartent des valeurs de la vue : un retracé en pleine
    // résolution ne doit pas remettre les pioches et les défausses à zéro.
    this.renderPlates(view);
    this.fit();
  }

  mkSlot(seat, side, x, y, w, h, tag) {
    const mine = seat === this.mySeat;
    const s = el('div', 'slot ' + (mine ? 'mine' : 'foreign'));
    s.style.cssText = `left:${Math.round(x)}px;top:${Math.round(y)}px;width:${w}px;height:${h}px;--seat:${this.hue(seat)}`;
    s.dataset.seat = seat;
    s.dataset.side = side;
    if (mine) s.dataset.mine = '1';
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

  /** Plaques seules : nom, trophées, pioche, défausse, témoin « prêt ». */
  renderPlates(view) {
    for (const [seat, pl] of this.plates) {
      const s = view.seats[seat];
      pl.troph.textContent = `${s.trophies} 🏆`;
      pl.dot.classList.toggle('on', s.ready);
      pl.deckCount.textContent = s.deckCount;
      pl.deck.style.visibility = s.deckCount ? '' : 'hidden';
      this.setDiscard(seat, s.discard[0]);
    }
  }

  renderView(view) {
    this.renderPlates(view);
    this.clearMarks('focus', 'won', 'lost', 'tied', 'drop', 'drop-hot');
    for (const [key] of this.slots) {
      const [seat, side] = key.split(':');
      const i = +seat;
      if (i === view.mySeat) {
        const c = view.placed ? view.placed[side] : null;
        this.setCard(i, side, c ? { n: c.n } : null);
      } else {
        this.setCard(i, side, view.seats[i].ready ? { back: true } : null);
      }
    }
  }

  setDiscard(seat, top) {
    const pl = this.plates.get(seat);
    if (!pl) return;
    if (top == null) {
      pl.disc.textContent = '';
      pl.disc.classList.add('empty');
      delete pl.disc.dataset.n;
      return;
    }
    pl.disc.classList.remove('empty');
    if (pl.disc.dataset.n === String(top)) return;
    pl.disc.dataset.n = String(top);
    pl.disc.textContent = '';
    pl.disc.append(imgTag(cardImg(top), label(top)));
  }

  /** Pose (ou retire) la carte d'une place. */
  setCard(seat, side, card, { force = null, anim = '' } = {}) {
    const s = this.slot(seat, side);
    if (!s) return null;
    s.querySelector('.card')?.remove();
    if (!card) return null;

    const c = el('div', 'card' + (anim ? ' ' + anim : ''));
    if (card.back) {
      c.append(imgTag(CARD_BACK, 'Carte face cachée'));
    } else {
      c.append(imgTag(cardImg(card.n), fullName(card.n)));
      c.append(this.forceChip(card.n, force == null ? card.n : force));
      if (seat !== this.mySeat) c.append(el('div', 'owner-chip', this.names[seat] || ''));
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

  setForce(seat, side, force) {
    const c = this.slot(seat, side)?.querySelector('.card');
    if (!c) return;
    const base = +c.dataset.n;
    c.querySelector('.force-chip')?.remove();
    c.append(this.forceChip(base, force));
  }

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
      if (seat !== this.mySeat) card.append(el('div', 'owner-chip', this.names[seat] || ''));
    }
  }

  mark(pos, cls) { this.slot(pos.seat, pos.side)?.classList.add(cls); }
  clearMarks(...cls) {
    for (const [, s] of this.slots) {
      s.classList.remove(...cls);
      if (cls.includes('won') || cls.includes('lost')) s.querySelector('.verdict')?.remove();
    }
  }

  /** Tampon VAINQUEUR / VAINCU / NUL sur une carte. */
  stamp(pos, kind) {
    const c = this.slot(pos.seat, pos.side)?.querySelector('.card');
    if (!c) return;
    c.querySelector('.verdict')?.remove();
    // Mots courts : à six joueurs les cartes n'ont pas la largeur pour plus.
    c.append(el('div', 'verdict ' + kind,
      kind === 'won' ? 'Gagné' : kind === 'lost' ? 'Perdu' : 'Nul'));
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

// ── Petits utilitaires ────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Deux rectangles se chevauchent-ils, marge comprise ? */
const hits = (a, b, m = 0) =>
  a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

const imgTag = (src, alt) => {
  const i = document.createElement('img');
  i.src = src; i.alt = alt || ''; i.draggable = false; i.decoding = 'async';
  return i;
};

function pileCol(pile, tag) {
  const c = el('div', 'pile-col');
  c.append(pile, el('span', 'pile-tag', tag));
  return c;
}

export { CARDS, SEAT_HUES };
