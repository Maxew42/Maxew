// Entrées unifiées : clavier+souris (pointer lock), tactile, manette.
// Directions d'attaque/parade façon Mount & Blade :
//  - souris : le geste (mouvement récent) donne la direction au moment du clic ;
//    clic droit maintenu = parade, la direction suit les gestes.
//  - tactile : balayage sur la moitié droite = attaque dans la direction du geste ;
//    bouton PARADE maintenu = parade assistée (direction automatique).
//  - manette : stick droit incliné au moment de RT/R1 = direction ; LT/L1 = parade assistée.
import { clamp, DIR } from './util.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.touchMode = false;
    this.padConnected = false;

    // caméra
    this._lookDX = 0; this._lookDY = 0;

    // geste souris (fenêtre glissante ~130 ms)
    this._trail = [];
    this._lastDir = DIR.UP;

    // fronts montants
    this._atkEdge = false; this._atkDir = null;
    this._jumpEdge = false; this._dashEdge = false; this._forceEdge = false; this._pauseEdge = false;

    // parade
    this._mouseBlock = false;
    this._touchBlock = false;
    this._padBlock = false;
    this.blockDir = null; // null = assistée

    this.pointerLocked = false;
    this.wantLock = false; // le jeu actif demande le pointer lock

    this._prevPadButtons = [];

    // ——— clavier ———
    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this._jumpEdge = true; e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._dashEdge = true;
      if (e.code === 'KeyE' || e.code === 'KeyF') this._forceEdge = true;
      if (e.code === 'Escape') this._pauseEdge = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this._mouseBlock = false; });

    // ——— souris ———
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) this._mouseBlock = false;
    });
    canvas.addEventListener('click', () => {
      if (this.wantLock && !this.pointerLocked && !this.touchMode) {
        canvas.requestPointerLock({ unadjustedMovement: true }).catch?.(() => {});
      }
    });
    addEventListener('mousemove', e => {
      if (!this.pointerLocked) return;
      this._lookDX += e.movementX * .0026;
      this._lookDY += e.movementY * .0026;
      this._trail.push({ t: performance.now(), dx: e.movementX, dy: e.movementY });
    });
    addEventListener('mousedown', e => {
      if (!this.pointerLocked) return;
      if (e.button === 0) { this._atkEdge = true; this._atkDir = this._gestureDir(); }
      if (e.button === 2) { this._mouseBlock = true; this.blockDir = this._gestureDir(); }
    });
    addEventListener('mouseup', e => { if (e.button === 2) this._mouseBlock = false; });
    addEventListener('contextmenu', e => e.preventDefault());

    // ——— manette ———
    addEventListener('gamepadconnected', () => { this.padConnected = true; document.body.classList.add('pad'); });
    addEventListener('gamepaddisconnected', () => {
      this.padConnected = [...navigator.getGamepads()].some(g => g && g.connected);
      if (!this.padConnected) document.body.classList.remove('pad');
    });
  }

  // direction dominante du mouvement souris récent (180 ms)
  _gestureDir() {
    const now = performance.now();
    while (this._trail.length && now - this._trail[0].t > 180) this._trail.shift();
    let dx = 0, dy = 0;
    for (const s of this._trail) { dx += s.dx; dy += s.dy; }
    if (Math.hypot(dx, dy) > 4) {
      this._lastDir = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? DIR.RIGHT : DIR.LEFT)
        : (dy > 0 ? DIR.DOWN : DIR.UP);
    }
    return this._lastDir;
  }

  // ——— tactile ———
  bindTouch() {
    const stickZone = document.getElementById('t-stick-zone');
    const swipeZone = document.getElementById('t-swipe-zone');
    const stickBase = document.getElementById('t-stick-base');
    const stickNub = document.getElementById('t-stick-nub');

    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    const R = 58;

    stickZone.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.touchMode = true; document.body.classList.add('touch');
      if (this.stick.active) return;
      this.stick.active = true; this.stick.id = e.pointerId;
      this.stick.ox = e.clientX; this.stick.oy = e.clientY;
      this.stick.x = 0; this.stick.y = 0;
      stickBase.style.display = 'block';
      stickBase.style.left = (e.clientX - 60) + 'px';
      stickBase.style.top = (e.clientY - 60) + 'px';
      stickNub.style.transform = 'translate(0px,0px)';
      stickZone.setPointerCapture(e.pointerId);
    });
    stickZone.addEventListener('pointermove', e => {
      if (!this.stick.active || e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.stick.x = dx / R; this.stick.y = dy / R;
      stickNub.style.transform = `translate(${dx}px,${dy}px)`;
    });
    const stickEnd = e => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.active = false; this.stick.x = 0; this.stick.y = 0;
      stickBase.style.display = 'none';
    };
    stickZone.addEventListener('pointerup', stickEnd);
    stickZone.addEventListener('pointercancel', stickEnd);

    // moitié droite : glisser = caméra, balayage rapide = attaque
    this.swipes = new Map(); // pointerId → {x0,y0,t0,x,y, moved}
    swipeZone.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.touchMode = true; document.body.classList.add('touch');
      this.swipes.set(e.pointerId, { x0: e.clientX, y0: e.clientY, t0: performance.now(), x: e.clientX, y: e.clientY });
      swipeZone.setPointerCapture(e.pointerId);
    });
    swipeZone.addEventListener('pointermove', e => {
      const s = this.swipes.get(e.pointerId);
      if (!s) return;
      this._lookDX += (e.clientX - s.x) * .006;
      this._lookDY += (e.clientY - s.y) * .006;
      s.x = e.clientX; s.y = e.clientY;
    });
    const swipeEnd = e => {
      const s = this.swipes.get(e.pointerId);
      if (!s) return;
      this.swipes.delete(e.pointerId);
      const dt = performance.now() - s.t0;
      const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
      const d = Math.hypot(dx, dy);
      // balayage : rapide et assez long → attaque directionnelle
      if (dt < 320 && d > 34) {
        this._atkEdge = true;
        this._atkDir = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? DIR.RIGHT : DIR.LEFT)
          : (dy > 0 ? DIR.DOWN : DIR.UP);
        this._lastDir = this._atkDir;
        // annule le mouvement caméra du balayage (sinon la vue « saute »)
        this._lookDX -= dx * .006; this._lookDY -= dy * .006;
      }
    };
    swipeZone.addEventListener('pointerup', swipeEnd);
    swipeZone.addEventListener('pointercancel', swipeEnd);

    // boutons
    const bind = (id, down, up) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        this.touchMode = true; document.body.classList.add('touch');
        el.classList.add('on'); down();
      });
      const off = e => { e.preventDefault(); el.classList.remove('on'); up && up(); };
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    bind('t-jump', () => { this._jumpEdge = true; });
    bind('t-dash', () => { this._dashEdge = true; });
    bind('t-force', () => { this._forceEdge = true; });
    bind('t-block', () => { this._touchBlock = true; }, () => { this._touchBlock = false; });
  }

  _pad() {
    if (!this.padConnected) return null;
    for (const g of navigator.getGamepads()) if (g && g.connected) return g;
    return null;
  }

  // navigation des menus à la manette (front montant du bouton A)
  padPressedA() {
    const g = this._pad();
    if (!g) return false;
    const now = g.buttons[0] && g.buttons[0].pressed;
    const was = this._prevA;
    this._prevA = now;
    return now && !was;
  }

  // lu à chaque frame par le jeu
  read(dt) {
    const k = this.keys;
    let mx = 0, my = 0;

    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;

    if (this.stick && this.stick.active) {
      mx += this.stick.x;
      my -= this.stick.y;
    }

    let padBlock = false;
    const g = this._pad();
    if (g) {
      const dz = v => Math.abs(v) > .16 ? v : 0;
      mx += dz(g.axes[0] || 0);
      my -= dz(g.axes[1] || 0);
      const rx = dz(g.axes[2] || 0), ry = dz(g.axes[3] || 0);
      this._lookDX += rx * 2.7 * dt;
      this._lookDY += ry * 2.2 * dt;

      const b = i => g.buttons[i] && g.buttons[i].pressed;
      const pressed = i => b(i) && !this._prevPadButtons[i];
      if (pressed(0)) this._jumpEdge = true;                 // A
      if (pressed(1) || pressed(10)) this._dashEdge = true;  // B / L3
      if (pressed(2) || pressed(3)) this._forceEdge = true;  // X / Y
      if (pressed(9)) this._pauseEdge = true;                // Start
      if (pressed(7) || pressed(5)) {                        // RT / R1 : attaque
        this._atkEdge = true;
        if (Math.hypot(rx, ry) > .35) {
          this._atkDir = Math.abs(rx) > Math.abs(ry)
            ? (rx > 0 ? DIR.RIGHT : DIR.LEFT)
            : (ry > 0 ? DIR.DOWN : DIR.UP);
          this._lastDir = this._atkDir;
        } else {
          this._atkDir = null; // choisie par le jeu (selon le déplacement)
        }
      }
      padBlock = b(6) || b(4);                               // LT / L1 : parade
      this._prevPadButtons = g.buttons.map(x => x.pressed);
    }
    this._padBlock = padBlock;

    // parade : souris = direction manuelle (suit le geste) ; tactile/manette = assistée (null)
    let block = false, blockDir = null;
    if (this._mouseBlock) {
      block = true;
      blockDir = this._gestureDir();
    } else if (this._touchBlock || this._padBlock) {
      block = true;
      blockDir = null;
    }

    const out = {
      mx: clamp(mx, -1, 1), my: clamp(my, -1, 1),
      lookDX: this._lookDX, lookDY: this._lookDY,
      jump: this._jumpEdge, dash: this._dashEdge, force: this._forceEdge, pause: this._pauseEdge,
      attack: this._atkEdge, attackDir: this._atkDir,
      block, blockDir,
    };
    this._lookDX = 0; this._lookDY = 0;
    this._atkEdge = false; this._jumpEdge = false; this._dashEdge = false;
    this._forceEdge = false; this._pauseEdge = false;
    return out;
  }

  clearEdges() {
    this._atkEdge = this._jumpEdge = this._dashEdge = this._forceEdge = this._pauseEdge = false;
    this._lookDX = 0; this._lookDY = 0;
  }

  rumble(ms = 120, mag = .7) {
    if (navigator.vibrate) navigator.vibrate(ms);
    const g = this._pad();
    if (g && g.vibrationActuator && g.vibrationActuator.playEffect) {
      g.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: mag, weakMagnitude: mag * .6 }).catch(() => {});
    }
  }
}
