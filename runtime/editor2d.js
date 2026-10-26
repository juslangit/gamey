// The Editor tab's free camera for 2D games: drag pans, scroll or pinch zooms towards
// the pointer (Shift+scroll pans), WASD/arrows move (Shift for faster), F frames the selection, a click selects.
const KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']);

export class EditorCam2D {
  constructor(engine) {
    this.engine = engine;
    this.on = false;
    this.keys = new Set();
    this.drag = null;
    const el = engine.phaser.canvas;
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => this.on && e.preventDefault());
    el.addEventListener('dblclick', (e) => {
      if (!this.on || this.engine.game.picking) return;
      const obj = this.engine.pick(e.clientX, e.clientY);
      if (obj) this.focus(obj);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.on) return;
      const k = e.key.toLowerCase();
      if (KEYS.has(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
      if (k === 'f' && this.engine.sel) this.focus(this.engine.sel.obj || this.engine.game.objs.get(this.engine.sel.id));
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get cam() {
    return this.engine.scene.cameras.main;
  }

  enable() {
    if (this.on) return;
    this.on = true;
    const cam = this.cam;
    cam.stopFollow();
    // Let the camera leave the level so its edges can be seen.
    cam.removeBounds();
    this.engine.phaser.canvas.style.cursor = 'grab';
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    this.keys.clear();
    this.drag = null;
    this.engine.phaser.canvas.style.cursor = '';
  }

  // Screen pixels to game pixels (the canvas is scaled to fit the stage).
  ratio() {
    const r = this.engine.phaser.canvas.getBoundingClientRect();
    return this.engine.phaser.scale.width / (r.width || 1);
  }

  down(e) {
    if (!this.on || this.engine.game.picking) return;
    this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button };
    e.preventDefault();
  }

  move(e) {
    const d = this.drag;
    if (!d || !this.on) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    this.engine.phaser.canvas.style.cursor = 'grabbing';
    const k = this.ratio() / this.cam.zoom;
    this.cam.scrollX -= dx * k;
    this.cam.scrollY -= dy * k;
  }

  up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.engine.phaser.canvas.style.cursor = this.on ? 'grab' : '';
    if (!d.moved && d.button === 0 && this.on) {
      const obj = this.engine.pick(e.clientX, e.clientY);
      this.engine.select(obj ? obj.id : null);
      this.engine.game.post({ gamey: 'selected', id: obj ? obj.id : null });
    }
  }

  wheel(e) {
    if (!this.on) return;
    e.preventDefault();
    const cam = this.cam;
    // Shift+scroll or a sideways swipe pans; any other scroll, or a pinch, zooms at the pointer.
    if (!e.ctrlKey && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      const k = this.ratio() / cam.zoom;
      cam.scrollX += (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      if (!e.shiftKey) cam.scrollY += e.deltaY * k;
      return;
    }
    const r = this.engine.phaser.canvas.getBoundingClientRect();
    const gx = (e.clientX - r.left) * this.ratio();
    const gy = (e.clientY - r.top) * this.ratio();
    const before = cam.getWorldPoint(gx, gy);
    const factor = Math.exp(-(e.ctrlKey ? e.deltaY * 3 : e.deltaY) * 0.0015);
    cam.setZoom(Math.min(8, Math.max(0.1, cam.zoom * factor)));
    cam.preRender();
    const after = cam.getWorldPoint(gx, gy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  focus(obj) {
    if (!obj?.view) return;
    this.cam.pan(obj.view.x, obj.view.y, 350, 'Cubic.easeOut');
  }

  update(dt) {
    if (!this.on) return;
    const k = this.keys;
    const x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const y = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (!x && !y) return;
    const speed = (k.has('shift') ? 1500 : 600) * dt / this.cam.zoom;
    this.cam.scrollX += x * speed;
    this.cam.scrollY += y * speed;
  }
}
