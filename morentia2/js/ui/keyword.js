// Règle au survol, en vue détaillée.
//
// Les mots-clés sont marqués au rendu de la carte (`js/ui/card.js`) ; ici on
// n'écoute que la vue agrandie, où il y a la place de lire une règle. Sur le
// plateau, les mots restent simplement plus épais.

import { glossaryEntry } from '../rules/glossary.js';

const MARGIN = 10;
const GAP = 12;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/** Rend focalisables les mots-clés d'une vue détaillée fraîchement rendue. */
export function markFocusable(host) {
  for (const kw of host.querySelectorAll('.kw')) kw.tabIndex = 0;
}

/**
 * Branche l'aide contextuelle sur un conteneur de vue détaillée.
 * À appeler une seule fois : l'écoute est déléguée, les cartes peuvent être
 * remplacées librement ensuite.
 */
export function attachKeywordHelp(host, getCatalog) {
  let bubble = null;
  let current = null;

  const hide = () => {
    current = null;
    if (bubble) { bubble.remove(); bubble = null; }
  };

  const show = target => {
    if (current === target) return;
    const entry = glossaryEntry(getCatalog(), target.dataset.term);
    hide();
    if (!entry) return;
    current = target;

    bubble = document.createElement('div');
    bubble.className = 'kw-help';
    const title = document.createElement('strong');
    title.textContent = entry.label;
    bubble.append(title, document.createTextNode(entry.body));
    // Cliquer dans la bulle ne doit pas refermer la vue détaillée.
    bubble.addEventListener('click', ev => ev.stopPropagation());
    document.body.append(bubble);
    place(bubble, target);
  };

  // À la souris, le survol suffit. Au doigt, `pointerover` se déclenche aussi
  // juste avant le clic : le limiter à la souris laisse le clic seul maître du
  // basculement, sinon un appui ouvrirait puis refermerait la bulle.
  host.addEventListener('pointerover', ev => {
    if (ev.pointerType !== 'mouse') return;
    const kw = ev.target.closest?.('.kw');
    if (kw) show(kw);
    else hide();
  });
  host.addEventListener('pointerleave', ev => {
    if (ev.pointerType === 'mouse') hide();
  });
  host.addEventListener('focusin', ev => {
    const kw = ev.target.closest?.('.kw');
    if (kw) show(kw);
  });
  // Le toucher ne doit pas traverser jusqu'au fond, qui referme la vue.
  host.addEventListener('click', ev => {
    const kw = ev.target.closest?.('.kw');
    if (!kw) return;
    ev.stopPropagation();
    if (current === kw) hide();
    else show(kw);
  });

  return hide;
}

/**
 * Place la bulle en dehors de la carte : elle ne doit jamais masquer le texte
 * qu'elle explique. Les positions sont essayées dans l'ordre — à droite, à
 * gauche, dessous, dessus — et la première qui tient à l'écran gagne. Sur un
 * téléphone, où la carte occupe tout, on se rabat sur la moitié d'écran opposée
 * au mot : la bulle recouvre la carte, mais pas le mot.
 */
function place(bubble, target) {
  const word = target.getBoundingClientRect();
  const card = target.closest('.card');
  const box = card ? card.getBoundingClientRect() : word;
  const b = bubble.getBoundingClientRect();
  const maxLeft = window.innerWidth - b.width - MARGIN;
  const maxTop = window.innerHeight - b.height - MARGIN;
  const midX = clamp(box.left + box.width / 2 - b.width / 2, MARGIN, maxLeft);

  const spots = [
    { left: box.right + GAP, top: clamp(word.top - 6, MARGIN, maxTop) },
    { left: box.left - b.width - GAP, top: clamp(word.top - 6, MARGIN, maxTop) },
    { left: midX, top: box.bottom + GAP },
    { left: midX, top: box.top - b.height - GAP },
  ];
  const fit = spots.find(s =>
    s.left >= MARGIN && s.left <= maxLeft && s.top >= MARGIN && s.top <= maxTop);

  const spot = fit || {
    left: midX,
    top: word.top > window.innerHeight / 2 ? MARGIN : maxTop,
  };
  bubble.style.left = `${Math.round(spot.left)}px`;
  bubble.style.top = `${Math.round(spot.top)}px`;
}
