// Final Frontier — persistence (localStorage).

const KEY = 'final-frontier-save-v1';

const DEFAULTS = {
  v: 1,
  company: null,
  xp: 0,
  milestones: [],     // earned milestone ids
  bestAlt: 0,
  bestSpeed: 0,
  flights: 0,
  rocket: null,       // current design: array of part ids (top->bottom)
  rocketName: '',
  showAll: false,
  seenTiers: [0],
};

let state = null;

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    state = { ...DEFAULTS };
  }
  return state;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export function update(patch) {
  Object.assign(load(), patch);
  save();
  return state;
}

export function resetAll() {
  state = { ...DEFAULTS };
  save();
  return state;
}
