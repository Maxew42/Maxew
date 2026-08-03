// Banc d'essai du moteur : joue des parties complètes en répondant au hasard,
// et rapporte les erreurs, les blocages et quelques statistiques d'équilibre.
//
//   node tools/harness.mjs [parties] [joueurs]
//
// À relancer après toute modification des règles ou du classeur.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadSheetJs } from './sheetjs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
globalThis.XLSX = loadSheetJs(root);

// Le dépôt de catalogue s'appuie sur localStorage : un substitut suffit ici.
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};

const { getCatalog, FACTIONS } = await import(resolve(root, 'js/data/catalog.js'));
const { createState } = await import(resolve(root, 'js/rules/state.js'));
const { Engine } = await import(resolve(root, 'js/rules/engine.js'));
const { PHASE_LABELS } = await import(resolve(root, 'js/rules/constants.js'));
const { CARD_EFFECTS, PLACE_EFFECTS } = await import(resolve(root, 'js/rules/effects/index.js'));

// Compte les déclenchements réels de chaque effet : un crochet jamais appelé
// signale une carte injouable ou une condition trop stricte.
const fired = new Map();
for (const [map, tag] of [[CARD_EFFECTS, 'carte'], [PLACE_EFFECTS, 'lieu']]) {
  for (const [id, spec] of map) {
    for (const key of Object.keys(spec)) {
      const fn = spec[key];
      if (typeof fn !== 'function') continue;
      spec[key] = function (...args) {
        fired.set(id, (fired.get(id) || 0) + 1);
        return fn.apply(this, args);
      };
    }
    if (!fired.has(id)) fired.set(id, 0);
  }
}

const games = Number(process.argv[2] || 20);
const playerCount = Number(process.argv[3] || 3);
const catalog = getCatalog();

let failures = 0;
const stats = { days: [], vp: [], errors: new Map(), actions: [], stuck: 0, unresolved: new Map() };

for (let g = 0; g < games; g++) {
  const rand = mulberry(g * 7919 + 13);
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`, name: `Joueur ${i + 1}`, faction: FACTIONS[i % FACTIONS.length], kind: 'ai',
  }));
  const state = createState({ catalog, players, seed: g * 2654435761 % 0xffffffff || 1 });
  const engine = new Engine({ catalog, state });

  const seen = [];
  engine.emitOriginal = engine.emit.bind(engine);
  engine.emit = e => {
    if (e.t === 'note' && e.kind === 'error') {
      stats.errors.set(e.text, (stats.errors.get(e.text) || 0) + 1);
    }
    seen.push(e);
    return engine.emitOriginal(e);
  };

  let steps = 0;
  let actions = 0;
  try {
    let res = engine.start();
    while (res.status !== 'over' && steps++ < 40000) {
      if (res.status === 'choice') {
        res = engine.submit(randomAnswer(engine.pending, rand));
      } else if (res.status === 'action') {
        const legal = engine.legal(res.player);
        const pick = chooseAction(legal, rand);
        actions++;
        res = engine.act(res.player, pick);
      } else {
        break;   // ni choix ni action : la pile est vide, la partie est bloquée
      }
    }
    if (res.status !== 'over') {
      stats.stuck++;
      console.log(`  partie ${g} bloquée : ${res.status} · phase ${PHASE_LABELS[state.phase]} · Jour ${state.day} · ${steps} pas`);
    } else {
      stats.days.push(state.day);
      stats.vp.push(state.players.map(p => p.vp));
      stats.actions.push(actions / Math.max(1, state.day));
    }
  } catch (err) {
    failures++;
    console.log(`  partie ${g} interrompue : ${err.message}`);
    console.log(err.stack.split('\n').slice(1, 4).join('\n'));
  }
}

function chooseAction(legal, rand) {
  if (!legal.length) return { type: 'pass' };
  // Une IA aléatoire qui se couche trop vite ne teste rien : on pondère.
  const doing = legal.filter(a => a.type !== 'pass');
  if (doing.length && rand() < 0.82) return doing[Math.floor(rand() * doing.length)];
  return { type: 'pass' };
}

function randomAnswer(req, rand) {
  const opts = req.options || [];
  if (!opts.length) return req.optional ? null : null;
  if (req.max === 1) {
    if (req.optional && rand() < 0.3) return null;
    return opts[Math.floor(rand() * opts.length)].value;
  }
  const n = Math.min(req.max, Math.floor(rand() * (opts.length + 1)));
  return shuffle(opts.slice(), rand).slice(0, n).map(o => o.value);
}

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

console.log('\n=== Banc d’essai Morentia ===');
console.log(`parties        : ${games} à ${playerCount} joueurs`);
console.log(`terminées      : ${stats.days.length}`);
console.log(`bloquées       : ${stats.stuck}`);
console.log(`exceptions     : ${failures}`);
console.log(`Jours (moy.)   : ${avg(stats.days).toFixed(1)}`);
console.log(`actions/Jour   : ${avg(stats.actions).toFixed(1)}`);
if (stats.vp.length) {
  const all = stats.vp.flat();
  console.log(`PV (moy./max)  : ${avg(all).toFixed(1)} / ${Math.max(...all)}`);
}
const silent = [...fired].filter(([, n]) => n === 0).map(([id]) => id);
console.log(`effets actifs  : ${[...fired].filter(([, n]) => n > 0).length}/${fired.size}`);
if (silent.length) console.log(`jamais déclenchés : ${silent.join(', ')}`);

if (stats.errors.size) {
  console.log('\nEffets en erreur :');
  for (const [msg, n] of [...stats.errors].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(4)} × ${msg}`);
  }
}
process.exit(failures || stats.stuck ? 1 : 0);
