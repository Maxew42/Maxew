// Entrées unifiées : clavier, tactile, manette.
// read() est appelé à chaque frame ; les pressions "objet"/"pause" sont des fronts montants.
import { clamp } from './util.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, drift: false, item: false, brake: false };
    this.touchMode = false;
    this._itemEdge = false;
    this._pauseEdge = false;
    this._prevPadButtons = [];
    this.padConnected = false;

    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'ControlLeft' || e.code === 'ControlRight') this._itemEdge = true;
      if (e.code === 'Escape') this._pauseEdge = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    addEventListener('gamepadconnected', () => { this.padConnected = true; document.body.classList.add('pad'); });
    addEventListener('gamepaddisconnected', () => {
      this.padConnected = [...navigator.getGamepads()].some(g => g && g.connected);
      if (!this.padConnected) document.body.classList.remove('pad');
    });
  }

  bindTouch() {
    const bind = (id, prop) => {
      const el = document.getElementById(id);
      const on = e => {
        e.preventDefault();
        this.touch[prop] = true;
        this.touchMode = true;
        if (prop === 'item') this._itemEdge = true;
        el.classList.add('on');
      };
      const off = e => { e.preventDefault(); this.touch[prop] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    bind('t-left', 'left'); bind('t-right', 'right');
    bind('t-drift', 'drift'); bind('t-item', 'item'); bind('t-brake', 'brake');
    // toucher la case objet du HUD déclenche aussi l'objet
    document.getElementById('hud-item').addEventListener('pointerdown', e => {
      e.preventDefault(); this._itemEdge = true;
    });
  }

  _pad() {
    if (!this.padConnected) return null;
    for (const g of navigator.getGamepads()) if (g && g.connected) return g;
    return null;
  }

  // état de la manette pour la navigation des menus (front montant du bouton A)
  padPressedA() {
    const g = this._pad();
    if (!g) return false;
    const now = g.buttons[0] && g.buttons[0].pressed;
    const was = this._prevA;
    this._prevA = now;
    return now && !was;
  }

  read() {
    const k = this.keys, t = this.touch;
    let steer = 0, throttle = 0, brake = 0, drift = false;

    // clavier
    if (k.has('ArrowLeft') || k.has('KeyA')) steer -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) throttle = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) brake = 1;
    if (k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight')) drift = true;

    // tactile (accélération auto : on freine avec le bouton FREIN)
    if (this.touchMode) {
      if (t.left) steer -= 1;
      if (t.right) steer += 1;
      if (t.drift) drift = true;
      if (t.brake) brake = 1; else throttle = Math.max(throttle, 1);
    }

    // manette
    const g = this._pad();
    if (g) {
      const ax = g.axes[0] || 0;
      if (Math.abs(ax) > .14) steer += ax;
      const b = i => g.buttons[i] && g.buttons[i].pressed;
      const v = i => (g.buttons[i] && g.buttons[i].value) || 0;
      if (b(14)) steer -= 1;
      if (b(15)) steer += 1;
      throttle = Math.max(throttle, v(7), b(0) ? 1 : 0);
      brake = Math.max(brake, v(6), b(1) ? 1 : 0);
      if (b(4) || b(5)) drift = true;
      // fronts montants objet / pause
      const pressed = i => b(i) && !this._prevPadButtons[i];
      if (pressed(2) || pressed(3)) this._itemEdge = true;
      if (pressed(9)) this._pauseEdge = true;
      this._prevPadButtons = g.buttons.map(x => x.pressed);
    }

    const item = this._itemEdge; this._itemEdge = false;
    const pause = this._pauseEdge; this._pauseEdge = false;
    return { steer: clamp(steer, -1, 1), throttle: clamp(throttle, 0, 1), brake: clamp(brake, 0, 1), drift, item, pause };
  }

  rumble(ms = 120, mag = .7) {
    if (navigator.vibrate) navigator.vibrate(ms);
    const g = this._pad();
    if (g && g.vibrationActuator && g.vibrationActuator.playEffect) {
      g.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: mag, weakMagnitude: mag * .6 }).catch(() => {});
    }
  }
}
