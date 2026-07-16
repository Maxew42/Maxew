// Unified input: keyboard+mouse, touch (twin virtual sticks + buttons), gamepad.
// poll() merges everything into one stickman input struct per frame.
// Mouse aiming needs the camera, so poll() takes a screen->aim resolver.

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();      // keys pressed this frame (edges)
    this.mouse = { x: 0, y: 0, down: false, downP: false };
    this.touch = {
      moveActive: false, moveX: 0, moveY: 0,
      aimActive: false, aimAngle: 0, aimMag: 0,
      jump: false, swap: false, throw: false, pick: false,
    };
    this.touchPrev = {};
    this.gpPrev = {};
    this.enabled = false;
    this.hasGamepad = false;
    this.activeSource = this.isTouchDevice ? 'touch' : 'key';

    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (!this.isTouchDevice) this.activeSource = 'key';
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    addEventListener('mousedown', e => {
      if (!this.enabled || e.button !== 0) return;
      if (e.target.closest('button, .touch-ui')) return;
      this.mouse.down = true; this.mouse.downP = true;
      this.activeSource = 'key';
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
    addEventListener('gamepadconnected', () => { this.hasGamepad = true; this.activeSource = 'gamepad'; });
    addEventListener('gamepaddisconnected', () => {
      this.hasGamepad = !!(navigator.getGamepads && [...navigator.getGamepads()].some(g => g && g.connected));
      if (!this.hasGamepad && this.activeSource === 'gamepad') this.activeSource = this.isTouchDevice ? 'touch' : 'key';
    });
  }

  get isTouchDevice() { return matchMedia('(pointer: coarse)').matches; }

  buildTouchUI(root) {
    if (!this.isTouchDevice || root.querySelector('.touch-ui')) return;
    const ui = document.createElement('div');
    ui.className = 'touch-ui';
    ui.innerHTML = `
      <div class="stick-zone stick-left"><div class="stick-base"><div class="stick-knob"></div></div></div>
      <div class="stick-zone stick-right"><div class="stick-base"><div class="stick-knob"></div></div></div>
      <div class="tbtns">
        <button class="tbtn tbtn-pick" data-b="pick">PRENDRE</button>
        <button class="tbtn tbtn-swap" data-b="swap">↔</button>
        <button class="tbtn tbtn-throw" data-b="throw">LANCER</button>
        <button class="tbtn tbtn-jump" data-b="jump">SAUT</button>
      </div>`;
    root.appendChild(ui);

    const R = 52;
    const bindStick = (zone, onMove, onEnd) => {
      const base = zone.querySelector('.stick-base');
      const knob = zone.querySelector('.stick-knob');
      let id = null, cx = 0, cy = 0;
      zone.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        id = t.identifier;
        const rect = zone.getBoundingClientRect();
        cx = t.clientX; cy = t.clientY;
        base.style.left = (cx - rect.left - R) + 'px';
        base.style.top = (cy - rect.top - R) + 'px';
        base.classList.add('on');
        knob.style.transform = 'translate(0,0)';
        onMove(0, 0);
        this.activeSource = 'touch';
      }, { passive: false });
      zone.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (t.identifier !== id) continue;
          let dx = t.clientX - cx, dy = t.clientY - cy;
          const d = Math.hypot(dx, dy), m = Math.min(d, R);
          if (d > 0.01) { dx = dx / d * m; dy = dy / d * m; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          onMove(dx / R, dy / R);
        }
      }, { passive: false });
      const end = e => {
        for (const t of e.changedTouches) {
          if (t.identifier !== id) continue;
          id = null;
          base.classList.remove('on');
          knob.style.transform = 'translate(0,0)';
          onEnd();
        }
      };
      zone.addEventListener('touchend', end);
      zone.addEventListener('touchcancel', end);
    };

    bindStick(ui.querySelector('.stick-left'),
      (x, y) => { this.touch.moveActive = true; this.touch.moveX = x; this.touch.moveY = y; },
      () => { this.touch.moveActive = false; this.touch.moveX = 0; this.touch.moveY = 0; });
    bindStick(ui.querySelector('.stick-right'),
      (x, y) => {
        this.touch.aimActive = true;
        this.touch.aimMag = Math.hypot(x, y);
        if (this.touch.aimMag > 0.15) this.touch.aimAngle = Math.atan2(y, x);
      },
      () => { this.touch.aimActive = false; this.touch.aimMag = 0; });

    for (const btn of ui.querySelectorAll('.tbtn')) {
      const key = btn.dataset.b;
      const on = e => { e.preventDefault(); this.touch[key] = true; btn.classList.add('on'); this.activeSource = 'touch'; };
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
      const dead = 0.24;
      const ax = i => Math.abs(gp.axes[i] || 0) > dead ? gp.axes[i] : 0;
      const btn = i => gp.buttons[i]?.pressed || false;
      const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
      let rt = gp.buttons[7]?.value ?? (btn(7) ? 1 : 0);
      if (btn(7) && rt < 0.5) rt = 1;
      const out = {
        mx: lx, downStick: ly > 0.55,
        aim: (Math.hypot(rx, ry) > dead) ? Math.atan2(ry, rx) : null,
        fire: rt > 0.35 || btn(5),      // RT / RB
        jump: btn(0),                   // ✕ / A
        throw: btn(1),                  // ○ / B
        pick: btn(2),                   // □ / X
        swap: btn(3),                   // △ / Y
      };
      if (out.mx || out.aim != null || out.fire || out.jump || out.throw || out.pick || out.swap) {
        this.hasGamepad = true;
        this.activeSource = 'gamepad';
      }
      return out;
    }
    return null;
  }

  // resolveMouseAim(mouse) -> aim angle from the player through the cursor.
  poll(resolveMouseAim) {
    const k = this.keys, kp = this.pressed;
    const out = {
      mx: 0, jump: false, jumpP: false, dropP: false,
      aim: null, fire: false, fireP: false,
      swapP: false, throwP: false, pickP: false, score: false,
    };

    // Keyboard + mouse.
    if (k.has('KeyA') || k.has('ArrowLeft')) out.mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) out.mx += 1;
    out.jump = k.has('KeyW') || k.has('ArrowUp') || k.has('Space');
    out.jumpP = kp.has('KeyW') || kp.has('ArrowUp') || kp.has('Space');
    out.dropP = kp.has('KeyS') || kp.has('ArrowDown');
    out.fire = this.mouse.down;
    out.fireP = this.mouse.downP;
    out.swapP = kp.has('KeyQ');
    out.throwP = kp.has('KeyG');
    out.pickP = kp.has('KeyE');
    out.score = k.has('Tab');
    if (this.activeSource === 'key' && resolveMouseAim) out.aim = resolveMouseAim(this.mouse);

    // Touch.
    const t = this.touch, tp = this.touchPrev;
    if (t.moveActive) {
      out.mx = Math.abs(t.moveX) > 0.22 ? t.moveX : 0;
      if (t.moveY > 0.72 && !(tp.down)) out.dropP = true;
      tp.down = t.moveY > 0.72;
    } else tp.down = false;
    if (t.jump) { out.jump = true; if (!tp.jump) out.jumpP = true; }
    if (t.swap && !tp.swap) out.swapP = true;
    if (t.throw && !tp.throw) out.throwP = true;
    if (t.pick && !tp.pick) out.pickP = true;
    tp.jump = t.jump; tp.swap = t.swap; tp.throw = t.throw; tp.pick = t.pick;
    if (t.aimActive && t.aimMag > 0.15) {
      out.aim = t.aimAngle;
      const firing = t.aimMag > 0.62;
      if (firing) { out.fire = true; if (!tp.fire) out.fireP = true; }
      tp.fire = firing;
    } else tp.fire = false;

    // Gamepad.
    const gp = this.pollGamepad();
    if (gp) {
      const prev = this.gpPrev;
      if (gp.mx) out.mx = gp.mx;
      if (gp.aim != null) out.aim = gp.aim;
      if (gp.fire) { out.fire = true; if (!prev.fire) out.fireP = true; }
      if (gp.jump) { out.jump = true; if (!prev.jump) out.jumpP = true; }
      if (gp.downStick && !prev.downStick) out.dropP = true;
      if (gp.swap && !prev.swap) out.swapP = true;
      if (gp.throw && !prev.throw) out.throwP = true;
      if (gp.pick && !prev.pick) out.pickP = true;
      this.gpPrev = gp;
    } else this.gpPrev = {};

    this.pressed.clear();
    this.mouse.downP = false;
    return out;
  }
}
