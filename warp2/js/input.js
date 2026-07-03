// Unified input: keyboard, touch (virtual joystick + buttons) and gamepad.
// poll() merges all sources into a ship input struct each frame.

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { joyActive: false, joyAngle: 0, joyMag: 0, fire: false, missile: false, boost: false, mine: false, flare: false };
    this.enabled = false;

    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  get isTouchDevice() {
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  // Build the touch UI inside a container (only shown on touch devices).
  buildTouchUI(root) {
    if (!this.isTouchDevice || root.querySelector('.touch-ui')) return;
    const ui = document.createElement('div');
    ui.className = 'touch-ui';
    ui.innerHTML = `
      <div class="joy-zone"><div class="joy-base"><div class="joy-knob"></div></div></div>
      <div class="btn-zone">
        <button class="tbtn tbtn-fire" data-b="fire">FIRE</button>
        <button class="tbtn tbtn-msl" data-b="missile">MSL</button>
        <button class="tbtn tbtn-mine" data-b="mine">MINE</button>
        <button class="tbtn tbtn-boost" data-b="boost">BOOST</button>
        <button class="tbtn tbtn-flare" data-b="flare">FLARE</button>
      </div>`;
    root.appendChild(ui);

    const zone = ui.querySelector('.joy-zone');
    const base = ui.querySelector('.joy-base');
    const knob = ui.querySelector('.joy-knob');
    const R = 52;
    let joyId = null, cx = 0, cy = 0;

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    zone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyId = t.identifier;
      const rect = zone.getBoundingClientRect();
      cx = t.clientX; cy = t.clientY;
      base.style.left = (cx - rect.left - R) + 'px';
      base.style.top = (cy - rect.top - R) + 'px';
      base.classList.add('on');
      this.touch.joyActive = true;
      this.touch.joyMag = 0;
      setKnob(0, 0);
    }, { passive: false });
    zone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const d = Math.hypot(dx, dy);
        const m = Math.min(d, R);
        if (d > 0.01) { dx = dx / d * m; dy = dy / d * m; }
        setKnob(dx, dy);
        this.touch.joyAngle = Math.atan2(dy, dx);
        this.touch.joyMag = m / R;
      }
    }, { passive: false });
    const joyEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        joyId = null;
        this.touch.joyActive = false;
        this.touch.joyMag = 0;
        base.classList.remove('on');
        setKnob(0, 0);
      }
    };
    zone.addEventListener('touchend', joyEnd);
    zone.addEventListener('touchcancel', joyEnd);

    for (const btn of ui.querySelectorAll('.tbtn')) {
      const key = btn.dataset.b;
      const on = e => { e.preventDefault(); this.touch[key] = true; btn.classList.add('on'); };
      const off = e => { e.preventDefault(); this.touch[key] = false; btn.classList.remove('on'); };
      btn.addEventListener('touchstart', on, { passive: false });
      btn.addEventListener('touchend', off);
      btn.addEventListener('touchcancel', off);
    }
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const dead = 0.22;
      const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0;
      const mag = Math.hypot(lx, ly);
      // Face buttons, PlayStation layout: ✕ guns, □ missiles, ○ mines, △ flares.
      return {
        stickAngle: mag > dead ? Math.atan2(ly, lx) : null,
        stickMag: mag > dead ? Math.min(1, (mag - dead) / (1 - dead)) : 0,
        fire: gp.buttons[0]?.pressed || gp.buttons[7]?.pressed || false,    // ✕ (cross) or RT
        missile: gp.buttons[2]?.pressed || false,                           // □ (square)
        mine: gp.buttons[1]?.pressed || false,                              // ○ (circle)
        flare: gp.buttons[3]?.pressed || false,                             // △ (triangle)
        boost: gp.buttons[6]?.pressed || gp.buttons[5]?.pressed || false,   // LT or RB
      };
    }
    return null;
  }

  // Merge everything into a ship input struct.
  poll() {
    const k = this.keys;
    const out = { thrust: 0, turn: 0, targetAngle: null, fire: false, missile: false, boost: false, mine: false, flare: false };

    // Keyboard (tank controls). One key per weapon group.
    if (k.has('KeyW') || k.has('ArrowUp')) out.thrust = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) out.thrust = -0.001; // treated as brake below
    if (k.has('KeyA') || k.has('ArrowLeft')) out.turn -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) out.turn += 1;
    out.fire = k.has('Space');                       // guns + beams
    out.missile = k.has('KeyE');                     // missiles + rockets
    out.mine = k.has('KeyX');                        // mines
    out.flare = k.has('KeyF');                       // flares
    out.boost = k.has('ShiftLeft') || k.has('ShiftRight');

    // Touch joystick: point-to-steer.
    if (this.touch.joyActive && this.touch.joyMag > 0.1) {
      out.targetAngle = this.touch.joyAngle;
      out.thrust = this.touch.joyMag;
      out.turn = 0;
    }
    out.fire = out.fire || this.touch.fire;
    out.missile = out.missile || this.touch.missile;
    out.boost = out.boost || this.touch.boost;
    out.mine = out.mine || this.touch.mine;
    out.flare = out.flare || this.touch.flare;

    // Gamepad: point-to-steer, overrides if active.
    const gp = this.pollGamepad();
    if (gp) {
      if (gp.stickAngle != null) {
        out.targetAngle = gp.stickAngle;
        out.thrust = gp.stickMag;
        out.turn = 0;
      }
      out.fire = out.fire || gp.fire;
      out.missile = out.missile || gp.missile;
      out.boost = out.boost || gp.boost;
      out.mine = out.mine || gp.mine;
      out.flare = out.flare || gp.flare;
    }

    if (out.thrust < 0) out.thrust = 0; // brake handled via damping; no reverse thrust
    return out;
  }
}
