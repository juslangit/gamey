// The 2D engine: Phaser 3 with Arcade physics. Positions are in pixels, x/y is the
// centre of an object, and y grows downwards.
import { BaseObj, cssColor, cssInt, changed } from './core.js';

const ACCENT = 0x8b7bff;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Phaser) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

const SHAPES = new Set(['rect', 'circle', 'ellipse', 'triangle']);

class Obj2D extends BaseObj {
  get x() { return this.view.x; }
  set x(v) { this.moveTo(v, this.view.y); }
  get y() { return this.view.y; }
  set y(v) { this.moveTo(this.view.x, v); }
  moveTo(x, y) {
    const b = this.view.body;
    if (b && !b.updateFromGameObject) b.reset(x, y);
    else {
      this.view.setPosition(x, y);
      b?.updateFromGameObject?.();
    }
  }
  get vx() { return this.view.body ? this.view.body.velocity.x : 0; }
  set vx(v) { this.view.body?.velocity && (this.view.body.velocity.x = v); }
  get vy() { return this.view.body ? this.view.body.velocity.y : 0; }
  set vy(v) { this.view.body?.velocity && (this.view.body.velocity.y = v); }
  setVelocity(vx, vy) { if (this.view.body?.velocity) this.view.body.velocity.set(vx, vy); }
  get onGround() {
    const b = this.view.body;
    return !!b && !!(b.blocked?.down || b.touching?.down);
  }
  get angle() { return this.view.angle; }
  set angle(v) { this.view.angle = v; }
  get alpha() { return this.view.alpha; }
  set alpha(v) { this.view.alpha = v; }
  get visible() { return this.view.visible; }
  set visible(v) { this.view.visible = !!v; }
  get scale() { return this.view.scaleX; }
  set scale(v) { this.view.setScale(v); this.view.body?.updateFromGameObject?.(); }
  get w() { return this.view.displayWidth; }
  get h() { return this.view.displayHeight; }
  get color() { return this.def.color; }
  set color(c) { this.game.engine.paint(this.view, { ...this.def, color: c }); }
  get text() { return this.view.text; }
  set text(t) { this.view.setText?.(String(t)); }
  flip(on = true) { this.view.setFlipX?.(on); }
}

export class Engine {
  constructor(game) {
    this.game = game;
    this.mode = '2d';
    this.ver = {};
    this.loading = {};
    this.texScale = {};
    this.physOn = null;
    this.sel = null;
  }

  get width() { return this.settings.width || 960; }
  get height() { return this.settings.height || 540; }

  async init(settings, root) {
    await loadScript('runtime/phaser.min.js');
    const P = window.Phaser;
    this.settings = settings;
    const self = this;
    await new Promise((resolve) => {
      this.phaser = new P.Game({
        type: P.AUTO,
        parent: root,
        width: settings.width || 960,
        height: settings.height || 540,
        backgroundColor: cssColor(settings.background, '#1b2030'),
        pixelArt: !!settings.pixelArt,
        banner: false,
        audio: { noAudio: true },
        input: { keyboard: false },
        scale: { mode: P.Scale.FIT, autoCenter: P.Scale.CENTER_BOTH },
        physics: { default: 'arcade', arcade: { gravity: { x: 0, y: settings.gravity ?? 0 }, debug: !!settings.debug } },
        scene: {
          create() {
            self.scene = this;
            resolve();
          },
          update(_t, delta) {
            self.frame(delta / 1000);
          },
        },
      });
    });
    // Collisions run inside Phaser's physics step, after bodies move and before the
    // scripts' update, so a script that sets a speed (a jump) is never undone.
    // The lists are kept up to date as objects come and go.
    this.dyn = [];
    this.solid = [];
    this.sens = [];
    this.movers = [];
    const phys = this.scene.physics;
    const hit = (a, b) => this.game.contact(a.__obj, b.__obj);
    phys.add.collider(this.dyn, this.solid, hit);
    phys.add.collider(this.dyn, undefined, hit);
    phys.add.overlap(this.movers, this.sens, hit);
    phys.add.overlap(this.sens, undefined, hit);
    this.applySettings(settings, {}, false);
    // Keep the HUD on top of the game picture, not over the letterbox bars.
    const fit = () => this.fitUi();
    this.phaser.scale.on('resize', fit);
    new ResizeObserver(fit).observe(root);
    requestAnimationFrame(fit);
  }

  fitUi() {
    const ui = this.game.ui?.el;
    const canvas = this.phaser?.canvas;
    if (!ui || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const box = this.game.root.getBoundingClientRect();
    Object.assign(ui.style, { left: `${r.left - box.left}px`, top: `${r.top - box.top}px`, width: `${r.width}px`, height: `${r.height}px`, right: 'auto', bottom: 'auto' });
  }

  track(obj) {
    const v = obj.view;
    const k = obj.physics;
    if (k === 'dynamic') this.dyn.push(v);
    if (k === 'static' || k === 'kinematic') this.solid.push(v);
    if (k === 'sensor') this.sens.push(v);
    if (k === 'dynamic' || k === 'kinematic') this.movers.push(v);
  }

  untrack(obj) {
    for (const list of [this.dyn, this.solid, this.sens, this.movers]) {
      const i = list.indexOf(obj.view);
      if (i >= 0) list.splice(i, 1);
    }
  }

  extendApi(g) {
    g.phaser = this.scene;
    g.Phaser = window.Phaser;
  }

  get cameraApi() {
    const cam = this.scene.cameras.main;
    return {
      follow: (obj, lerp = 0.12) => obj && cam.startFollow(obj.view, true, lerp, lerp),
      stop: () => cam.stopFollow(),
      shake: (seconds = 0.25, strength = 0.01) => cam.shake(seconds * 1000, strength),
      flash: (seconds = 0.2) => cam.flash(seconds * 1000),
      zoom: (z) => cam.setZoom(z),
      get x() { return cam.scrollX; },
      get y() { return cam.scrollY; },
      raw: cam,
    };
  }

  applySettings(s, old = {}) {
    this.settings = s;
    const S = this.scene;
    const w = s.width || 960;
    const h = s.height || 540;
    if (this.phaser.scale.width !== w || this.phaser.scale.height !== h) {
      this.phaser.scale.setGameSize(w, h);
      requestAnimationFrame(() => this.fitUi());
    }
    S.cameras.main.setBackgroundColor(cssColor(s.background, '#1b2030'));
    S.physics.world.gravity.y = s.gravity ?? 0;
    S.physics.world.gravity.x = 0;
    const ww = s.worldWidth || w;
    const wh = s.worldHeight || h;
    S.physics.world.setBounds(0, 0, ww, wh);
    S.cameras.main.setBounds(0, 0, ww, wh);
    if (old.camera?.follow && old.camera.follow !== s.camera?.follow) S.cameras.main.stopFollow();
    if (!s.camera?.follow) S.cameras.main.setScroll(s.camera?.x || 0, s.camera?.y || 0);
    if (s.camera?.zoom) S.cameras.main.setZoom(s.camera.zoom);
    this.followFromSettings();
  }

  followFromSettings() {
    const id = this.settings.camera?.follow;
    const obj = id && this.game.objs.get(id);
    if (obj) this.scene.cameras.main.startFollow(obj.view, true, this.settings.camera.lerp ?? 0.12, this.settings.camera.lerp ?? 0.12);
  }

  frame(dt) {
    const g = this.game;
    const p = this.scene.input.activePointer;
    g.pointer.x = p.worldX;
    g.pointer.y = p.worldY;
    const on = g.active;
    if (on !== this.physOn) {
      on ? this.scene.physics.resume() : this.scene.physics.pause();
      this.physOn = on;
    }
    g.tick(Math.min(dt, 0.05));
    g.flushContacts();
    this.paintSelection();
    g.endFrame();
  }

  /* ---------- Textures ---------- */

  keyFor(path) {
    return this.ver[path] ? `${path}#${this.ver[path]}` : path;
  }

  loadTex(path) {
    const S = this.scene;
    const key = this.keyFor(path);
    if (S.textures.exists(key)) return Promise.resolve(true);
    if (this.loading[key]) return this.loading[key];
    const isSvg = /\.svg$/i.test(path);
    this.loading[key] = new Promise((resolve) => {
      const url = `${path}${this.ver[path] ? `?v=${this.ver[path]}` : ''}`;
      const type = isSvg ? 'svg' : 'image';
      const done = (ok) => {
        S.load.off(`filecomplete-${type}-${key}`, onOk);
        S.load.off('loaderror', onErr);
        delete this.loading[key];
        resolve(ok);
      };
      const onOk = () => done(true);
      const onErr = (file) => {
        if (file.key !== key) return;
        this.game.report(new Error(`Could not load the picture ${path}`), '');
        done(false);
      };
      S.load.on(`filecomplete-${type}-${key}`, onOk);
      S.load.on('loaderror', onErr);
      if (isSvg) {
        this.texScale[key] = 2;
        S.load.svg(key, url, { scale: 2 });
      } else S.load.image(key, url);
      S.load.start();
    });
    return this.loading[key];
  }

  prepare(def) {
    if (def.asset && (def.type === 'sprite' || def.type === 'tiled')) return this.loadTex(def.asset);
  }

  async reloadAsset(path) {
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return;
    const users = [...this.game.objs.values()].filter((o) => o.def.asset === path);
    const oldKey = this.keyFor(path);
    this.ver[path] = (this.ver[path] || 0) + 1;
    if (!(await this.loadTex(path))) return;
    for (const o of users) {
      if (!o.alive) continue;
      o.view.setTexture(this.keyFor(path));
      this.size(o.view, o.def);
      o.view.body?.updateFromGameObject?.();
      if (this.game.live) this.flash(o.view);
    }
    if (this.scene.textures.exists(oldKey) && oldKey !== this.keyFor(path)) this.scene.textures.remove(oldKey);
  }

  /* ---------- Objects ---------- */

  create(def) {
    const S = this.scene;
    const x = def.x ?? this.width / 2;
    const y = def.y ?? this.height / 2;
    const w = def.w ?? 40;
    const h = def.h ?? 40;
    let v;
    switch (def.type) {
      case 'circle':
        v = S.add.circle(x, y, def.r ?? (def.w ? def.w / 2 : 20), 0xffffff);
        break;
      case 'ellipse':
        v = S.add.ellipse(x, y, w, h, 0xffffff);
        break;
      case 'triangle':
        v = S.add.triangle(x, y, 0, h, w / 2, 0, w, h, 0xffffff);
        break;
      case 'text':
        v = S.add.text(x, y, String(def.text ?? ''), {
          fontFamily: def.font || 'system-ui, -apple-system, sans-serif',
          fontSize: `${def.size || 28}px`,
          fontStyle: def.bold === false ? 'normal' : 'bold',
          align: 'center',
        }).setOrigin(0.5).setPadding(4);
        break;
      case 'emoji':
        v = S.add.text(x, y, String(def.emoji || '⭐'), {
          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
          fontSize: `${def.size || 48}px`,
        }).setOrigin(0.5).setPadding(6);
        break;
      case 'sprite':
        v = S.add.image(x, y, S.textures.exists(this.keyFor(def.asset)) ? this.keyFor(def.asset) : '__WHITE');
        if (!S.textures.exists(this.keyFor(def.asset)) && def.asset) {
          v.setVisible(false);
          this.loadTex(def.asset).then((ok) => {
            if (!ok || !v.scene) return;
            v.setTexture(this.keyFor(def.asset)).setVisible(def.visible !== false);
            this.size(v, def);
            v.body?.updateFromGameObject?.();
          });
        }
        break;
      case 'tiled':
        v = S.add.tileSprite(x, y, w, h, S.textures.exists(this.keyFor(def.asset)) ? this.keyFor(def.asset) : '__WHITE');
        break;
      default:
        if (def.type && def.type !== 'rect') this.game.warn(`Object "${def.id}" has an unknown type "${def.type}" for a 2D game, so it is drawn as a rectangle.`);
        v = S.add.rectangle(x, y, w, h, 0xffffff);
    }
    const obj = new Obj2D(this.game, def);
    obj.view = v;
    v.__obj = obj;
    this.paint(v, def);
    this.size(v, def);
    v.setAngle(def.angle || 0);
    v.setAlpha(def.alpha ?? 1);
    v.setDepth(def.depth ?? 0);
    if (def.visible === false) v.setVisible(false);
    if (def.flipX && v.setFlipX) v.setFlipX(true);
    if (def.flipY && v.setFlipY) v.setFlipY(true);
    this.addBody(obj, def);
    if (this.settings.camera?.follow === def.id) this.followFromSettings();
    return obj;
  }

  size(v, def) {
    if (def.type === 'sprite') {
      const k = this.texScale[v.texture?.key] || 1;
      const fw = v.frame?.realWidth || v.width;
      const fh = v.frame?.realHeight || v.height;
      if (def.w && def.h) v.setDisplaySize(def.w, def.h);
      else if (def.w) v.setScale(def.w / fw);
      else if (def.h) v.setScale(def.h / fh);
      else v.setScale((def.scale ?? 1) / k);
    } else if (def.type !== 'tiled') {
      v.setScale(def.scale ?? 1);
    }
  }

  paint(v, def) {
    if (def.type === 'text') {
      v.setColor(cssColor(def.color, '#ffffff'));
      if (def.stroke) v.setStroke(cssColor(def.stroke, '#000000'), def.strokeWidth ?? 4);
    } else if (def.type === 'emoji') {
      // emoji keep their own colours
    } else if (def.type === 'sprite' || def.type === 'tiled') {
      if (def.color) v.setTint(cssInt(def.color));
      else v.clearTint();
    } else if (SHAPES.has(def.type || 'rect')) {
      if (def.color === 'none') v.isFilled = false;
      else v.setFillStyle(cssInt(def.color, '#ffffff'), 1);
      if (def.stroke) v.setStrokeStyle(def.strokeWidth ?? 2, cssInt(def.stroke, '#000000'), 1);
      else v.isStroked = false;
    }
  }

  addBody(obj, def) {
    const kind = def.physics || 'none';
    if (kind === 'none') return;
    const v = obj.view;
    this.scene.physics.add.existing(v, kind === 'static');
    this.track(obj);
    const b = v.body;
    if (def.type === 'circle' && b.setCircle) b.setCircle(def.r ?? (def.w ? def.w / 2 : 20));
    if (kind === 'static') return;
    b.setAllowGravity(kind === 'dynamic' && def.gravity !== false);
    if (kind !== 'dynamic') b.setImmovable(true);
    if (kind === 'dynamic' && def.pushable === false) b.pushable = false;
    b.setBounce(def.bounce ?? 0, def.bounce ?? 0);
    if (def.drag) b.setDrag(def.drag, def.gravity === false || !this.settings.gravity ? def.drag : 0);
    if (def.maxSpeed) b.setMaxSpeed(def.maxSpeed);
    b.setCollideWorldBounds(kind === 'dynamic' && def.bounds !== false);
    if (def.vx || def.vy) b.setVelocity(def.vx || 0, def.vy || 0);
  }

  canMorph(obj, def) {
    const prev = obj.def;
    if ((prev.type || 'rect') !== (def.type || 'rect')) return false;
    if (changed(prev, def, ['asset', 'physics', 'font', 'bold', 'gravity', 'bounce', 'drag', 'bounds', 'maxSpeed', 'pushable', 'vx', 'vy'])) return false;
    const moving = ['dynamic', 'kinematic', 'sensor'].includes(def.physics);
    if (moving && changed(prev, def, ['w', 'h', 'r', 'scale', 'size'])) return false;
    return true;
  }

  morph(obj, prev, def, animate) {
    const v = obj.view;
    const S = this.scene;
    if (changed(prev, def, ['text']) && def.type === 'text') v.setText(String(def.text ?? ''));
    if (changed(prev, def, ['emoji']) && def.type === 'emoji') v.setText(String(def.emoji || '⭐'));
    if (changed(prev, def, ['size']) && (def.type === 'text' || def.type === 'emoji')) v.setFontSize(def.size || (def.type === 'emoji' ? 48 : 28));
    if (changed(prev, def, ['depth'])) v.setDepth(def.depth ?? 0);
    if (changed(prev, def, ['visible'])) v.setVisible(def.visible !== false);
    if (changed(prev, def, ['flipX']) && v.setFlipX) v.setFlipX(!!def.flipX);
    if (changed(prev, def, ['flipY']) && v.setFlipY) v.setFlipY(!!def.flipY);
    if (changed(prev, def, ['stroke', 'strokeWidth'])) this.paint(v, def);

    const from = { x: v.x, y: v.y, angle: v.angle, alpha: v.alpha };
    const to = {
      x: changed(prev, def, ['x']) ? def.x ?? this.width / 2 : v.x,
      y: changed(prev, def, ['y']) ? def.y ?? this.height / 2 : v.y,
      angle: changed(prev, def, ['angle']) ? def.angle || 0 : v.angle,
      alpha: changed(prev, def, ['alpha']) ? def.alpha ?? 1 : v.alpha,
    };
    const resize = changed(prev, def, ['w', 'h', 'r', 'scale']);
    const sizeFrom = { w: v.width, h: v.height, r: v.radius, sx: v.scaleX, sy: v.scaleY };
    const recolor = changed(prev, def, ['color']) && def.type !== 'emoji';
    const c0 = this.colorNow(v, prev);
    const c1 = cssInt(def.color, '#ffffff');
    const after = () => {
      if (resize) this.setSize(v, def, 1, sizeFrom);
      if (recolor) this.paint(v, def);
      v.body?.updateFromGameObject?.();
    };
    if (!animate) {
      v.setPosition(to.x, to.y).setAngle(to.angle).setAlpha(to.alpha);
      return after();
    }
    const body = v.body;
    S.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 480,
      ease: 'Cubic.easeInOut',
      onUpdate: (tw) => {
        if (!v.scene) return;
        const k = tw.getValue();
        const x = from.x + (to.x - from.x) * k;
        const y = from.y + (to.y - from.y) * k;
        if (body && !body.updateFromGameObject && body.reset) body.reset(x, y);
        else v.setPosition(x, y);
        v.setAngle(from.angle + (to.angle - from.angle) * k);
        v.setAlpha(from.alpha + (to.alpha - from.alpha) * k);
        if (resize) this.setSize(v, def, k, sizeFrom);
        if (recolor && c0 != null) this.tint(v, def, lerpColor(c0, c1, k));
        body?.updateFromGameObject?.();
      },
      onComplete: () => v.scene && after(),
    });
    this.flash(v);
  }

  setSize(v, def, k, from) {
    const L = (a, b) => a + (b - a) * k;
    switch (def.type || 'rect') {
      case 'rect':
      case 'ellipse':
      case 'tiled':
        v.setSize(L(from.w, def.w ?? 40), L(from.h, def.h ?? 40));
        if (v.setDisplaySize && def.type !== 'tiled') v.setScale(L(from.sx, def.scale ?? 1));
        break;
      case 'circle':
        v.setRadius(L(from.r, def.r ?? (def.w ? def.w / 2 : 20)));
        v.setScale(L(from.sx, def.scale ?? 1));
        break;
      case 'triangle': {
        const w = def.w ?? 40;
        const h = def.h ?? 40;
        v.setTo(0, h, w / 2, 0, w, h);
        v.setScale(L(from.sx, def.scale ?? 1));
        break;
      }
      case 'sprite':
        if (k >= 1) this.size(v, def);
        break;
      default:
        v.setScale(L(from.sx, def.scale ?? 1));
    }
  }

  colorNow(v, def) {
    if (def.type === 'text') return cssInt(def.color, '#ffffff');
    if (def.type === 'sprite' || def.type === 'tiled') return def.color ? cssInt(def.color) : 0xffffff;
    return v.fillColor ?? null;
  }

  tint(v, def, c) {
    if (def.type === 'text') v.setColor('#' + c.toString(16).padStart(6, '0'));
    else if (def.type === 'sprite' || def.type === 'tiled') v.setTint(c);
    else if (v.setFillStyle) v.setFillStyle(c, 1);
  }

  /* ---------- Live effects ---------- */

  popIn(obj) {
    const v = obj.view;
    const S = this.scene;
    const sx = v.scaleX;
    const sy = v.scaleY;
    const alpha = v.alpha;
    const size = Math.max(v.displayWidth || 40, v.displayHeight || 40);
    v.setScale(sx * 0.001, sy * 0.001).setAlpha(0);
    S.tweens.add({ targets: v, scaleX: sx, scaleY: sy, alpha, duration: 520, ease: 'Back.easeOut' });
    const ring = S.add.circle(v.x, v.y, Math.min(size / 2 + 8, 400)).setStrokeStyle(3, ACCENT, 1).setDepth(1e6);
    S.tweens.add({ targets: ring, scale: 1.7, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    const label = S.add
      .text(v.x, v.y - Math.min(size, 600) / 2 - 8, obj.id, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        color: '#ffffff',
        backgroundColor: '#6d5dfc',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setDepth(1e6 + 1);
    S.tweens.add({ targets: label, alpha: 0, y: label.y - 12, delay: 1000, duration: 450, onComplete: () => label.destroy() });
  }

  flash(v) {
    const S = this.scene;
    const b = v.getBounds();
    const box = S.add.rectangle(b.centerX, b.centerY, b.width + 10, b.height + 10).setStrokeStyle(2, ACCENT, 1).setDepth(1e6);
    S.tweens.add({ targets: box, alpha: 0, duration: 700, delay: 250, onComplete: () => box.destroy() });
  }

  remove(obj, animate) {
    const v = obj.view;
    this.untrack(obj);
    if (v.body) v.body.enable = false;
    if (this.sel?.obj === obj) this.select(null);
    if (animate && v.scene) {
      this.scene.tweens.add({ targets: v, scaleX: 0, scaleY: 0, alpha: 0, duration: 260, ease: 'Back.easeIn', onComplete: () => v.destroy() });
    } else {
      v.setVisible(false);
      this.scene.time.delayedCall(0, () => v.destroy());
    }
  }

  /* ---------- Picking (point & change) ---------- */

  pick(clientX, clientY) {
    const canvas = this.phaser.canvas;
    const r = canvas.getBoundingClientRect();
    const gx = ((clientX - r.left) * this.phaser.scale.width) / r.width;
    const gy = ((clientY - r.top) * this.phaser.scale.height) / r.height;
    const p = this.scene.cameras.main.getWorldPoint(gx, gy);
    const objs = [...this.game.objs.values()].filter((o) => o.alive && o.view.visible).sort((a, b) => b.view.depth - a.view.depth);
    const hits = objs.filter((o) => o.view.getBounds().contains(p.x, p.y));
    // The smallest object under the pointer, so a player in front of a background wins.
    hits.sort((a, b) => b.view.depth - a.view.depth || area(a.view) - area(b.view));
    return hits[0] || null;
  }

  select(id) {
    if (this.sel) this.sel.box.destroy();
    this.sel = null;
    const obj = id && this.game.objs.get(id);
    if (!obj) return;
    const box = this.scene.add.rectangle(0, 0, 10, 10).setStrokeStyle(2, ACCENT, 1).setDepth(1e6);
    this.sel = { obj, box };
    this.paintSelection();
  }

  paintSelection() {
    if (!this.sel) return;
    if (!this.sel.obj.alive) return this.select(null);
    const b = this.sel.obj.view.getBounds();
    this.sel.box.setPosition(b.centerX, b.centerY).setSize(b.width + 8, b.height + 8);
  }
}

const area = (v) => v.displayWidth * v.displayHeight;

function lerpColor(a, b, k) {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
