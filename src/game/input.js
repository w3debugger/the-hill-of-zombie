// Captures keyboard + mouse + touch input for the local player.
// Produces InputState messages each frame for the world (or the network).

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { sx: window.innerWidth / 2 + 80, sy: window.innerHeight / 2, down: false };
    this.fireEdge = false;
    this.reloadEdge = false;
    this.dodgeEdge = false;
    this.weaponEdge = null;
    this.buyId = null;
    this.readyEdge = false;
    this.escEdge = false;
    this.tabHeld = false;

    // ----- Touch state -----
    // Joystick: vector from -1..1 (set by .touch-stick area on the left)
    // Fire: held flag (set by .touch-fire button on the right)
    this.touch = {
      active: false,           // true when any touch UI is engaged this session
      joyX: 0, joyY: 0,        // -1..1 vector from joystick
      joyId: null,             // pointer id owning the joystick
      joyOriginX: 0, joyOriginY: 0,
      joyKnobX: 0, joyKnobY: 0,
      fireDown: false,
      fireId: null,
      fireEdge: false,
    };

    this.onKeyDown = (e) => {
      if (['Tab','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
      if (this.keys.has(e.code)) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.reloadEdge = true;
      if (e.code === 'Space') this.dodgeEdge = true;
      if (e.code === 'Digit1') this.weaponEdge = 'pistol';
      if (e.code === 'Digit2') this.weaponEdge = 'shotgun';
      if (e.code === 'Digit3') this.weaponEdge = 'smg';
      if (e.code === 'Digit4') this.weaponEdge = 'rifle';
      if (e.code === 'Escape') this.escEdge = true;
      if (e.code === 'Tab') this.tabHeld = true;
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.tabHeld = false;
    };
    this.onMouseMove = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.sx = e.clientX - r.left;
      this.mouse.sy = e.clientY - r.top;
    };
    this.onMouseDown = (e) => {
      if (e.button !== 0) return;
      this.mouse.down = true;
      this.fireEdge = true;
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) this.mouse.down = false;
    };
    this.onContext = e => e.preventDefault();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', this.onContext);

    // Prevent the page from scrolling/pinch-zooming while touching the canvas
    this.onCanvasTouch = (e) => { e.preventDefault(); };
    canvas.addEventListener('touchstart', this.onCanvasTouch, { passive: false });
    canvas.addEventListener('touchmove', this.onCanvasTouch, { passive: false });
  }
  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.canvas.removeEventListener('touchstart', this.onCanvasTouch);
    this.canvas.removeEventListener('touchmove', this.onCanvasTouch);
  }

  // ---- Touch UI hooks (called from HUD / TouchControls) ----
  // Joystick: caller passes normalized vector (-1..1). null clears it.
  setJoystick(jx, jy) {
    if (jx === null || jy === null) {
      this.touch.joyX = 0;
      this.touch.joyY = 0;
    } else {
      const m = Math.hypot(jx, jy);
      if (m > 1) { jx /= m; jy /= m; }
      this.touch.joyX = jx;
      this.touch.joyY = jy;
      this.touch.active = true;
    }
  }
  setTouchFire(down) {
    if (down && !this.touch.fireDown) {
      this.fireEdge = true;
      this.touch.fireEdge = true;
    }
    this.touch.fireDown = !!down;
    if (down) this.touch.active = true;
  }

  // Build an input snapshot with current state. Pulses are consumed.
  snapshot(aimAngle) {
    let mx = 0, my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    const m = Math.hypot(mx, my);
    if (m > 0) { mx /= m; my /= m; }
    // Touch joystick takes over when keyboard isn't pressing
    if (m === 0 && (this.touch.joyX !== 0 || this.touch.joyY !== 0)) {
      mx = this.touch.joyX;
      my = this.touch.joyY;
    }
    const firing = this.mouse.down || this.touch.fireDown;
    const out = {
      mx, my, ang: aimAngle,
      fire: firing,
      fireEdge: this.fireEdge,
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      dodge: this.dodgeEdge,
      reload: this.reloadEdge,
      weapon: this.weaponEdge,
      buy: this.buyId,
      ready: this.readyEdge,
    };
    this.fireEdge = false;
    this.touch.fireEdge = false;
    this.reloadEdge = false;
    this.dodgeEdge = false;
    this.weaponEdge = null;
    this.buyId = null;
    this.readyEdge = false;
    return out;
  }
  consumeEsc() {
    const v = this.escEdge;
    this.escEdge = false;
    return v;
  }
}

// Detect once: coarse pointer (touch-primary) devices show on-screen controls
export const IS_TOUCH = (typeof window !== 'undefined') &&
  (('ontouchstart' in window) ||
   (navigator.maxTouchPoints > 0) ||
   window.matchMedia?.('(pointer: coarse)').matches);
