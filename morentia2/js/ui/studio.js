// Studio de cartes : édition du catalogue actif et du design global.
//
// Toute modification porte sur l'objet catalogue en mémoire ; l'enregistrement
// le fige dans le stockage local, et l'export .xlsx / .zip le rend au format du
// classeur d'origine.

import { renderCard, renderPlace, applyDesign, colorFor } from './card.js';
import { DESIGN_LABELS, kindOf } from '../data/schema.js';
import { FACTION_LABELS } from '../data/catalog.js';

const $ = sel => document.querySelector(sel);

const CARD_FIELDS = [
  { key: 'name', label: 'Nom', wide: true },
  { key: 'type', label: 'Type' },
  { key: 'subtype', label: 'Sous-type' },
  { key: 'status', label: 'Statut' },
  { key: 'influence', label: 'Influence', numeric: true },
  { key: 'costDomain', label: 'Coût domaine', numeric: true },
  { key: 'costLocation', label: 'Coût lieu', numeric: true },
  { key: 'costUnique', label: 'Coût unique', numeric: true },
  { key: 'deckQty', label: 'Quantité deck', numeric: true },
  { key: 'text', label: 'Texte final', area: true, wide: true },
  { key: 'role', label: 'Rôle' },
  { key: 'art', label: 'Illustration (chemin)', wide: true },
  { key: 'color', label: 'Couleur du cadre', color: true },
];

const PLACE_FIELDS = [
  { key: 'name', label: 'Nom', wide: true },
  { key: 'type', label: 'Type' },
  { key: 'subtype', label: 'Sous-type' },
  { key: 'survivors', label: 'Survivants', numeric: true },
  { key: 'duration', label: 'Durée', numeric: true },
  { key: 'vp', label: 'PV (ex. 5 / 2 / 0)' },
  { key: 'threshold', label: 'Seuil' },
  { key: 'deckCopies', label: 'Copies deck lieux', numeric: true },
  { key: 'effect', label: 'Effet', area: true, wide: true },
  { key: 'control', label: 'Contrôle', area: true, wide: true },
  { key: 'victory', label: 'Victoire', area: true, wide: true },
  { key: 'art', label: 'Illustration (chemin)', wide: true },
  { key: 'color', label: 'Couleur du cadre', color: true },
];

let state = null;

/** Ouvre le studio sur le catalogue fourni. */
export function openStudio(catalog, { onSave, onClose }) {
  state = { catalog, selected: null, filter: '', mode: 'cards', onSave };
  $('#studio-back').onclick = () => onClose();
  $('#studio-save').onclick = () => { onSave(); flash('Catalogue enregistré.'); };
  $('#studio-design').onclick = () => { state.mode = state.mode === 'design' ? 'cards' : 'design'; refresh(); };
  $('#studio-search').oninput = ev => { state.filter = ev.target.value.toLowerCase(); renderList(); };
  $('#studio-toggle-list').onclick = () => $('#studio-body').classList.toggle('show-list');
  state.selected = catalog.cards[0]?.id || null;
  refresh();
}

function refresh() {
  renderList();
  if (state.mode === 'design') renderDesign();
  else renderEditor();
}

function entries() {
  const { catalog } = state;
  return [
    ...catalog.cards.map(c => ({ rec: c, kind: 'card' })),
    ...catalog.places.map(p => ({ rec: p, kind: 'place' })),
  ];
}

function renderList() {
  const host = $('#studio-items');
  host.innerHTML = '';
  const filter = state.filter;
  for (const { rec, kind } of entries()) {
    const hay = `${rec.id} ${rec.name} ${rec.type} ${rec.text || rec.effect || ''}`.toLowerCase();
    if (filter && !hay.includes(filter)) continue;
    const item = document.createElement('div');
    item.className = 'studio-item' + (rec.id === state.selected ? ' on' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = colorFor(state.catalog, rec);
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = rec.name || '(sans nom)';
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = rec.id;
    item.append(dot, nm, id);
    item.onclick = () => {
      state.selected = rec.id;
      state.mode = 'cards';
      $('#studio-body').classList.remove('show-list');
      refresh();
    };
    host.append(item);
  }
}

function selectedEntry() {
  return entries().find(e => e.rec.id === state.selected) || entries()[0];
}

function renderEditor() {
  const entry = selectedEntry();
  const form = $('#studio-form');
  const preview = $('#studio-preview');
  form.innerHTML = '';
  preview.innerHTML = '';
  if (!entry) return;

  const fields = entry.kind === 'card' ? CARD_FIELDS : PLACE_FIELDS;
  for (const field of fields) {
    form.append(inputFor(entry.rec, field, () => {
      // Le type détermine la mécanique : on la recalcule à chaque frappe.
      if (entry.kind === 'card') {
        entry.rec.kind = kindOf(entry.rec.type);
        entry.rec.singleCost = entry.rec.costUnique !== null && entry.rec.costUnique !== '';
      }
      renderEditor();
      renderList();
    }));
  }

  // Remplacement de l'illustration par un fichier local.
  const drop = document.createElement('div');
  drop.className = 'field wide';
  const label = document.createElement('label');
  label.textContent = 'Remplacer l’illustration';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const path = entry.rec.art || `assets/art/${entry.rec.id.toLowerCase()}.png`;
      entry.rec.art = path;
      state.catalog.art[path] = reader.result;
      renderEditor();
    };
    reader.readAsDataURL(f);
  };
  drop.append(label, file);
  form.append(drop);

  const node = entry.kind === 'card'
    ? renderCard(state.catalog, entry.rec)
    : renderPlace(state.catalog, entry.rec);
  preview.append(node);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = `${entry.rec.id} · ${FACTION_LABELS[entry.rec.faction] || 'Lieu'}`;
  preview.append(hint);
}

function inputFor(rec, field, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'field' + (field.wide ? ' wide' : '');
  const label = document.createElement('label');
  label.textContent = field.label;
  let input;
  if (field.area) {
    input = document.createElement('textarea');
  } else {
    input = document.createElement('input');
    if (field.color) input.type = 'text';
  }
  input.value = rec[field.key] === null || rec[field.key] === undefined ? '' : String(rec[field.key]);
  input.oninput = () => {
    const raw = input.value;
    if (field.numeric) {
      if (raw.trim() === '') rec[field.key] = null;
      else if (raw === 'X' || raw === '*') rec[field.key] = raw;
      else rec[field.key] = Number(raw);
    } else {
      rec[field.key] = raw;
    }
    onChange();
  };
  wrap.append(label, input);
  return wrap;
}

function renderDesign() {
  const form = $('#studio-form');
  const preview = $('#studio-preview');
  form.innerHTML = '';
  preview.innerHTML = '';
  const design = state.catalog.design;

  for (const [key, value] of Object.entries(design)) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = DESIGN_LABELS[key] || key;
    const input = document.createElement('input');
    input.value = String(value);
    if (/color/i.test(key) && /^#/.test(String(value))) input.type = 'color';
    input.oninput = () => {
      const raw = input.value;
      design[key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      applyDesign(design);
      renderDesign();
    };
    wrap.append(label, input);
    form.append(wrap);
  }

  // Aperçu : une carte de chaque faction pour juger les couleurs d'un coup d'œil.
  for (const faction of ['kalassir', 'aqaba', 'algarie', 'market']) {
    const sample = state.catalog.cards.find(c => c.faction === faction && c.kind === 'unit')
      || state.catalog.cards.find(c => c.faction === faction);
    if (sample) preview.append(renderCard(state.catalog, sample));
  }
}

function flash(text) {
  const node = $('#toast');
  node.textContent = text;
  node.classList.add('on');
  setTimeout(() => node.classList.remove('on'), 1800);
}
