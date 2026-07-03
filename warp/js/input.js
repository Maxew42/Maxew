import { clamp } from './util.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = {
      left: false,
      right: false,
      thrust: false,
      brake: false,
      primary: false,
      secondary: false,
      boost: false,
      utility: false,
    };
    this.touchMode = false;
    this.padConnected = false;
    this._pauseEdge = false;
    this._prevPadButtons = [];

    addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat && (e.code === 'Escape' || e.code === 'Enter')) this._pauseEdge = true;
      this.keys.add(e.code);
    }, { passive: false });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', () => {
      this.padConnected = true;
      document.body.classList.add('pad');
    });
    addEventListener('gamepaddisconnected', () => {
      this.padConnected = [...navigator.getGamepads()].some(g => g && g.connected);
      document.body.classList.toggle('pad', this.padConnected);
    });
  }

  bindTouch() {
    const bind = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = e => {
        e.preventDefault();
        this.touch[prop] = true;
        this.touchMode = true;
        el.classList.add('on');
        document.body.classList.add('touch');
      };
      const off = e => {
        e.preventDefault();
        this.touch[prop] = false;
        el.classList.remove('on');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    bind('t-left', 'left');
    bind('t-right', 'right');
    bind('t-thrust', 'thrust');
    bind('t-brake', 'brake');
    bind('t-primary', 'primary');
    bind('t-secondary', 'secondary');
    bind('t-boost', 'boost');
    bind('t-utility', 'utility');
  }

  read() {
    const k = this.keys;
    let turn = 0;
    let thrust = 0;
    let brake = 0;
    let primary = false;
    let secondary = false;
    let boost = false;
    let utility = false;

    if (k.has('ArrowLeft') || k.has('KeyA')) turn -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) turn += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) thrust = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) brake = 1;
    if (k.has('KeyJ') || k.has('ControlLeft') || k.has('ControlRight')) primary = true;
    if (k.has('KeyK') || k.has('ShiftLeft') || k.has('ShiftRight')) secondary = true;
    if (k.has('Space')) boost = true;
    if (k.has('KeyL') || k.has('KeyF')) utility = true;

    const t = this.touch;
    if (this.touchMode) {
      if (t.left) turn -= 1;
      if (t.right) turn += 1;
      if (t.thrust) thrust = 1;
      if (t.brake) brake = 1;
      primary = primary || t.primary;
      secondary = secondary || t.secondary;
      boost = boost || t.boost;
      utility = utility || t.utility;
    }

    const pad = this._pad();
    if (pad) {
      const b = i => pad.buttons[i] && pad.buttons[i].pressed;
      const v = i => (pad.buttons[i] && pad.buttons[i].value) || 0;
      const axis = pad.axes[0] || 0;
      if (Math.abs(axis) > 0.15) turn += axis;
      if (b(14)) turn -= 1;
      if (b(15)) turn += 1;
      thrust = Math.max(thrust, v(7), b(0) ? 1 : 0);
      brake = Math.max(brake, v(6), b(1) ? 1 : 0);
      primary = primary || b(2) || b(5);
      secondary = secondary || b(3) || b(4);
      boost = boost || b(0) && v(7) > 0.1 || b(10);
      utility = utility || b(1) && v(6) > 0.1 || b(11);
      const pressed = i => b(i) && !this._prevPadButtons[i];
      if (pressed(9)) this._pauseEdge = true;
      this._prevPadButtons = pad.buttons.map(btn => btn.pressed);
    }

    const pause = this._pauseEdge;
    this._pauseEdge = false;
    return {
      turn: clamp(turn, -1, 1),
      thrust: clamp(thrust, 0, 1),
      brake: clamp(brake, 0, 1),
      primary,
      secondary,
      boost,
      utility,
      pause,
    };
  }

  clear() {
    this._pauseEdge = false;
  }

  rumble(ms = 120, mag = 0.65) {
    if (navigator.vibrate) navigator.vibrate(ms);
    const pad = this._pad();
    if (pad && pad.vibrationActuator && pad.vibrationActuator.playEffect) {
      pad.vibrationActuator.playEffect('dual-rumble', {
        duration: ms,
        strongMagnitude: mag,
        weakMagnitude: mag * 0.6,
      }).catch(() => {});
    }
  }

  _pad() {
    if (!this.padConnected) return null;
    for (const gamepad of navigator.getGamepads()) {
      if (gamepad && gamepad.connected) return gamepad;
    }
    return null;
  }
}
