// HUD DOM : barres de vie/force, indicateur directionnel (attaque/parade),
// objectif, scores, toasts, vignette de dégâts, écran de résultats.
const $ = id => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), hp: $('hud-hp'), force: $('hud-force'),
      obj: $('hud-obj'), scores: $('hud-scores'), count: $('hud-count'),
      msg: $('hud-msg'), cross: $('hud-cross'), dmg: $('dmgfx'),
      results: $('screen-results'), rtable: $('results-table'), rtitle: $('results-title'),
      quit: $('btn-quit'), dirs: [$('dir-up'), $('dir-right'), $('dir-down'), $('dir-left')],
      dirbox: $('hud-dir'), lockHint: $('lock-hint'), controls: $('hud-controls'),
    };
    this._toastTimer = null;
  }

  show() { this.el.hud.classList.remove('hidden'); this.el.quit.style.display = 'block'; document.body.classList.add('playing'); }
  hide() {
    this.el.hud.classList.add('hidden'); this.el.quit.style.display = 'none';
    document.body.classList.remove('playing');
    this.countdown('');
    this.setDir('idle', null);
  }

  setHp(frac) {
    this.el.hp.style.width = Math.max(0, frac * 100) + '%';
    this.el.hp.classList.toggle('low', frac < .3);
  }
  setForce(frac, enough) {
    this.el.force.style.width = Math.max(0, frac * 100) + '%';
    this.el.force.classList.toggle('ready', enough);
  }

  // indicateur directionnel : kind = 'idle' | 'attack' | 'block' | 'assist'
  setDir(kind, dir) {
    this.el.dirbox.className = kind;
    this.el.dirs.forEach((d, i) => d.classList.toggle('on', dir === i || (kind === 'assist' && dir === null)));
  }

  setObjective(t) { this.el.obj.textContent = t; }

  setScores(rows) {
    // rows : [{name, val, me, dead}]
    this.el.scores.innerHTML = '';
    for (const r of rows) {
      const d = document.createElement('div');
      d.className = 'score' + (r.me ? ' me' : '') + (r.dead ? ' dead' : '');
      d.innerHTML = `<span class="sn"></span><span class="sv"></span>`;
      d.querySelector('.sn').textContent = r.name;
      d.querySelector('.sv').textContent = r.val;
      this.el.scores.appendChild(d);
    }
  }

  countdown(text) {
    this.el.count.textContent = text;
    this.el.count.classList.toggle('hidden', !text);
  }

  toast(text, dur = 2800) {
    this.el.msg.textContent = text;
    this.el.msg.style.opacity = 1;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.el.msg.style.opacity = 0; }, dur);
  }

  damageFlash(strong = false) {
    const d = this.el.dmg;
    d.style.transition = 'none';
    d.style.opacity = strong ? .85 : .5;
    requestAnimationFrame(() => {
      d.style.transition = 'opacity .5s';
      d.style.opacity = 0;
    });
  }

  lockHint(show) { this.el.lockHint.classList.toggle('hidden', !show); }

  // rappel des commandes non évidentes en bas d'écran (HTML de confiance, généré par le jeu)
  setControls(html) {
    if (this._controlsHtml === html) return;
    this._controlsHtml = html;
    this.el.controls.innerHTML = html;
    this.el.controls.style.display = html ? '' : 'none';
  }

  showResults(title, rows) {
    this.el.rtitle.textContent = title;
    const tb = this.el.rtable;
    tb.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      const rk = document.createElement('td'); rk.className = 'rk'; rk.textContent = r.rank;
      const nm = document.createElement('td'); nm.textContent = r.name + (r.me ? ' (toi)' : '');
      const v = document.createElement('td'); v.className = 'tm'; v.textContent = r.detail;
      tr.append(rk, nm, v);
      tb.appendChild(tr);
    }
    this.el.results.classList.remove('hidden');
  }
  hideResults() { this.el.results.classList.add('hidden'); }
}
