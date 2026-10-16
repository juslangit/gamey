// Gamey runtime core. It owns the game's objects, the behaviour scripts, input,
// timers, the HUD and (in Gamey's preview) the live link that makes things appear,
// move and disappear while Claude builds. The engine (engine2d.js on Phaser,
// engine3d.js on Three.js) draws the objects and moves their physics bodies.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_NAMES = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  Space: 'space', Enter: 'enter', NumpadEnter: 'enter', Escape: 'escape', Tab: 'tab',
  ShiftLeft: 'shift', ShiftRight: 'shift', ControlLeft: 'ctrl', ControlRight: 'ctrl',
  AltLeft: 'alt', AltRight: 'alt', Backspace: 'backspace',
};
export function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return String(code).toLowerCase();
}
const ALIASES = { arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down', ' ': 'space', spacebar: 'space', return: 'enter', esc: 'escape' };
const norm = (k) => {
  const s = String(k).toLowerCase();
  return ALIASES[s] || s;
};

let colorCtx = null;
// Any CSS colour ('red', '#f80', 'rgb(...)', 0xff8800) as '#rrggbb'.
export function cssColor(c, fallback = '#ffffff') {
  if (c == null || c === '') return fallback;
  if (typeof c === 'number') return '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
  colorCtx ||= document.createElement('canvas').getContext('2d');
  colorCtx.fillStyle = '#010203';
  colorCtx.fillStyle = String(c);
  const v = colorCtx.fillStyle;
  if (v === '#010203' && String(c).toLowerCase() !== '#010203') return fallback;
  if (v.startsWith('#')) return v;
  const m = v.match(/[\d.]+/g);
  if (!m) return fallback;
  return '#' + m.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('');
}
export const cssInt = (c, fallback) => parseInt(cssColor(c, fallback).slice(1), 16);

// "behaviors" may be written as an array, a single name, or as "behavior"/"script".
export function behaviorsOf(def) {
  const b = def.behaviors ?? def.behavior ?? def.script ?? [];
  return (Array.isArray(b) ? b : [b]).filter((n) => typeof n === 'string' && n);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const changed = (prev, def, keys) => keys.some((k) => !same(prev[k], def[k]));

export class BaseObj {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.id = def.id;
    this.props = { ...(def.props || {}) };
    this.data = {};
    this.alive = true;
    this.started = false;
    this.createdWith = new Set();
  }
  get tags() { return this.def.tags || []; }
  get type() { return this.def.type; }
  get physics() { return this.def.physics || 'none'; }
  is(tag) { return this.tags.includes(tag); }
  destroy() { this.game.removeObj(this.id, false); }
  distanceTo(o) {
    return Math.hypot(o.x - this.x, o.y - this.y, (o.z || 0) - (this.z || 0));
  }
}

/* ---------- HUD, messages and the live-preview overlays ---------- */

class Overlay {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'gamey-ui';
    this.el.innerHTML = `<div class="gamey-hud"></div><div class="gamey-hud right"></div>
      <div class="gamey-msg" hidden></div>
      <div class="gamey-end" hidden><div class="gamey-end-card"><h2></h2><p>Press R or tap to play again</p></div></div>
      <div class="gamey-badge" hidden></div><div class="gamey-toasts"></div>`;
    root.appendChild(this.el);
    this.hudEl = this.el.querySelector('.gamey-hud');
    this.hudRight = this.el.querySelector('.gamey-hud.right');
    this.msgEl = this.el.querySelector('.gamey-msg');
    this.endEl = this.el.querySelector('.gamey-end');
    this.badgeEl = this.el.querySelector('.gamey-badge');
    this.toastsEl = this.el.querySelector('.gamey-toasts');
    this.lines = new Map();
    this.endEl.addEventListener('pointerdown', () => game.playAgain());
  }
  hud(key, text, corner) {
    let line = this.lines.get(key);
    if (text == null || text === false) {
      if (line) line.remove();
      this.lines.delete(key);
      return;
    }
    if (!line) {
      line = document.createElement('div');
      this.lines.set(key, line);
    }
    const parent = corner === 'right' ? this.hudRight : this.hudEl;
    if (line.parentNode !== parent) parent.appendChild(line);
    line.textContent = String(text);
  }
  message(text, seconds = 2) {
    clearTimeout(this.msgTimer);
    this.msgEl.textContent = String(text);
    this.msgEl.hidden = false;
    this.msgEl.classList.remove('show');
    void this.msgEl.offsetWidth;
    this.msgEl.classList.add('show');
    if (seconds > 0) this.msgTimer = setTimeout(() => (this.msgEl.hidden = true), seconds * 1000);
  }
  end(text, won) {
    this.endEl.querySelector('h2').textContent = text;
    this.endEl.classList.toggle('won', !!won);
    this.endEl.hidden = false;
  }
  badge(text) {
    this.badgeEl.textContent = text || '';
    this.badgeEl.hidden = !text;
  }
  toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = `gamey-toast ${kind}`;
    t.textContent = text;
    this.toastsEl.appendChild(t);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => t.classList.add('out'), kind === 'error' ? 7000 : 2200);
    setTimeout(() => t.remove(), kind === 'error' ? 7600 : 2800);
  }
  clear() {
    for (const line of this.lines.values()) line.remove();
    this.lines.clear();
    this.msgEl.hidden = true;
    this.endEl.hidden = true;
  }
}

/* ---------- The script API: the `g` every script receives ---------- */

function makeApi(game) {
  const key = (k) => game.keys.has(norm(k)) || game.forced.has(norm(k));
  const g = {
    get time() { return game.time; },
    get dt() { return game.dt; },
    get state() { return game.state; },
    set state(v) { game.state = v; },
    get width() { return game.engine.width; },
    get height() { return game.engine.height; },
    get settings() { return game.scene.settings; },
    find: (id) => game.objs.get(id) || null,
    all: (tag) => [...game.objs.values()].filter((o) => o.alive && (!tag || o.is(tag))),
    spawn: (def) => game.spawn(def),
    destroy: (o) => { if (o) game.removeObj(typeof o === 'string' ? o : o.id, false); },
    key,
    pressed: (k) => game.pressedNow.has(norm(k)),
    input: {
      get left() { return key('left') || key('a'); },
      get right() { return key('right') || key('d'); },
      get up() { return key('up') || key('w'); },
      get down() { return key('down') || key('s'); },
      get jump() { return key('space') || key('up') || key('w'); },
      get jumpPressed() { return g.pressed('space') || g.pressed('up') || g.pressed('w'); },
      get action() { return key('space') || key('enter') || key('x'); },
      get actionPressed() { return g.pressed('space') || g.pressed('enter') || g.pressed('x') || game.pointer.pressed; },
    },
    get pointer() { return game.pointer; },
    hud: (k, text, corner) => game.ui.hud(k, text, corner),
    message: (text, seconds) => game.ui.message(text, seconds),
    gameOver: (text = 'Game over') => game.end(text, false),
    win: (text = 'You win!') => game.end(text, true),
    restart: () => game.restart(),
    after: (seconds, fn) => game.timer(seconds, fn, false),
    every: (seconds, fn) => game.timer(seconds, fn, true),
    random: (a = 0, b = 1) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    sound: (path, opts) => game.sound(path, opts),
    sfx: (name, volume) => game.sfx(name, volume),
    beep: (freq, seconds, wave, volume) => game.beep(freq, seconds, wave, volume),
    get camera() { return game.engine.cameraApi; },
  };
  return g;
}

/* ---------- The game ---------- */

const STAGGER = { add: 150, update: 90, remove: 80 };

export class Game {
  constructor(root, { live = false, paused = false } = {}) {
    this.root = root;
    this.live = live;
    this.objs = new Map();
    this.mods = new Map();
    this.missing = new Set();
    this.state = {};
    this.time = 0;
    this.dt = 0;
    this.running = !paused;
    this.begun = false;
    this.over = false;
    this.keys = new Set();
    this.pressedNow = new Set();
    this.forced = new Set();
    this.pointer = { x: 0, y: 0, down: false, pressed: false, screenX: 0, screenY: 0, dx: 0, dy: 0 };
    this.timers = [];
    this.contactsNow = new Map();
    this.contactsPrev = new Set();
    this.queue = [];
    this.draining = false;
    this.reported = new Set();
    this.errors = [];
    this.spawnN = 0;
    this.picking = false;
    this.ui = new Overlay(root, this);
    this.api = makeApi(this);
    this.bindInput();
    window.addEventListener('error', (e) => {
      if (String(e.filename).includes('probe=')) return; // syntaxLine() reports these itself
      this.report(e.error || new Error(e.message), '');
    });
    window.addEventListener('unhandledrejection', (e) => this.report(e.reason || new Error('Promise rejected'), ''));
  }

  async boot() {
    this.scene = await this.fetchScene();
    const mode = this.scene.settings.mode === '3d' ? '3d' : '2d';
    const { Engine } = await import(mode === '3d' ? './engine3d.js' : './engine2d.js');
    this.engine = new Engine(this);
    await this.engine.init(this.scene.settings, this.root);
    this.engine.extendApi?.(this.api);
    await this.build();
    if (this.live) this.connect();
    if (this.running) this.begin();
    this.paintBadge();
    this.post({ gamey: 'ready', mode, count: this.objs.size });
  }

  async fetchScene() {
    try {
      const res = await fetch(`scene.json?t=${Date.now()}`, { cache: 'no-store' });
      const scene = await res.json();
      scene.settings = scene.settings || {};
      scene.objects = Array.isArray(scene.objects) ? scene.objects.filter((o) => o && o.id) : [];
      return scene;
    } catch (err) {
      this.report(new Error(`scene.json could not be read: ${err.message}`), '');
      return this.scene || { settings: {}, objects: [] };
    }
  }

  async build() {
    const defs = this.scene.objects;
    await Promise.all(defs.map((d) => Promise.resolve(this.engine.prepare(d)).catch(() => {})));
    await this.loadMods(defs);
    for (const def of defs) this.addObj(def, false);
  }

  async loadMods(defs, fresh = false) {
    const names = new Set(['game']);
    for (const d of defs) behaviorsOf(d).forEach((n) => names.add(n));
    await Promise.all([...names].filter((n) => fresh || (!this.mods.has(n) && !this.missing.has(n))).map((n) => this.loadMod(n)));
  }

  async loadMod(name) {
    if (!/^[\w-]+$/.test(name)) {
      this.warn(`"${name}" is not a valid script name (use letters, numbers, - and _).`);
      return;
    }
    const url = new URL(`../scripts/${name}.js`, import.meta.url);
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
    if (!head || !head.ok) {
      this.mods.delete(name);
      if (name !== 'game') this.missing.add(name);
      return;
    }
    this.missing.delete(name);
    url.searchParams.set('v', `${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
    try {
      const m = await import(url.href);
      this.mods.set(name, m.default ?? m);
    } catch (err) {
      err.where = await syntaxLine(url.href);
      this.report(err, `scripts/${name}.js`);
    }
  }

  addObj(def, animate) {
    let obj;
    try {
      obj = this.engine.create(def);
    } catch (err) {
      this.report(err, `scene.json object "${def.id}"`);
      return null;
    }
    this.objs.set(def.id, obj);
    if (animate) this.engine.popIn(obj);
    if (this.begun) this.startObj(obj);
    return obj;
  }

  spawn(def = {}) {
    def = { ...def };
    let id = def.id || def.type || 'obj';
    if (!def.id || this.objs.has(id)) {
      const base = id;
      do id = `${base}-${++this.spawnN}`; while (this.objs.has(id));
    }
    def.id = id;
    const obj = this.addObj(def, false);
    if (!obj) return null;
    obj.spawned = true;
    const unloaded = behaviorsOf(def).filter((n) => !this.mods.has(n) && !this.missing.has(n));
    if (unloaded.length) {
      Promise.all(unloaded.map((n) => this.loadMod(n))).then(() => {
        if (obj.alive && obj.started) unloaded.forEach((n) => this.callOne(obj, n, 'create'));
      });
    }
    return obj;
  }

  removeObj(id, animate) {
    const obj = this.objs.get(id);
    if (!obj) return;
    obj.alive = false;
    this.objs.delete(id);
    this.engine.remove(obj, animate);
  }

  callOne(obj, name, method, arg) {
    const m = this.mods.get(name);
    const fn = m && m[method];
    if (method === 'create') obj.createdWith.add(name);
    if (typeof fn !== 'function') return;
    try {
      fn.call(m, obj, this.api, arg);
    } catch (err) {
      this.report(err, `scripts/${name}.js (${method})`);
    }
  }

  call(obj, method, arg) {
    for (const name of behaviorsOf(obj.def)) {
      if (!obj.alive && method !== 'hit') return;
      this.callOne(obj, name, method, arg);
    }
  }

  callGame(method, arg) {
    const m = this.mods.get('game');
    const fn = m && m[method];
    if (typeof fn !== 'function') return;
    try {
      fn.call(m, this.api, arg);
    } catch (err) {
      this.report(err, `scripts/game.js (${method})`);
    }
  }

  startObj(obj) {
    if (obj.started) return;
    obj.started = true;
    this.call(obj, 'create');
  }

  begin() {
    if (this.begun) return;
    this.begun = true;
    for (const n of this.missing) this.warn(`An object uses the script "${n}", but scripts/${n}.js does not exist.`);
    this.callGame('create');
    for (const obj of [...this.objs.values()]) if (obj.alive) this.startObj(obj);
  }

  tick(dt) {
    this.dt = dt;
    if (this.running && this.begun && !this.over) {
      this.time += dt;
      this.runTimers(dt);
      for (const obj of [...this.objs.values()]) if (obj.alive && obj.started) this.call(obj, 'update', dt);
      this.callGame('update', dt);
    }
  }

  get active() {
    return this.running && this.begun && !this.over;
  }

  endFrame() {
    this.pressedNow.clear();
    this.pointer.pressed = false;
    this.pointer.dx = this.pointer.dy = 0;
  }

  contact(a, b) {
    if (!a || !b || a === b) return;
    const k = a.id < b.id ? `${a.id}\u0000${b.id}` : `${b.id}\u0000${a.id}`;
    this.contactsNow.set(k, [a, b]);
  }

  flushContacts() {
    const next = new Set();
    for (const [k, [a, b]] of this.contactsNow) {
      next.add(k);
      if (this.contactsPrev.has(k) || !this.active) continue;
      this.call(a, 'hit', b);
      this.call(b, 'hit', a);
    }
    this.contactsPrev = next;
    this.contactsNow.clear();
  }

  timer(seconds, fn, repeat) {
    const t = { left: seconds, every: repeat ? seconds : 0, fn, cancel: () => (t.dead = true) };
    this.timers.push(t);
    return t;
  }

  runTimers(dt) {
    for (const t of this.timers.slice()) {
      if (t.dead) continue;
      t.left -= dt;
      if (t.left > 0) continue;
      try {
        t.fn(this.api);
      } catch (err) {
        this.report(err, 'timer');
      }
      if (t.every > 0) t.left += t.every;
      else t.dead = true;
    }
    this.timers = this.timers.filter((t) => !t.dead);
  }

  end(text, won) {
    if (this.over) return;
    this.over = true;
    this.ui.end(text, won);
  }

  playAgain() {
    if (this.over) this.restart();
  }

  setRunning(on, reason) {
    this.running = on;
    this.pauseReason = reason || '';
    if (on && !this.begun) this.begin();
    this.paintBadge();
  }

  paintBadge() {
    if (!this.live) return;
    this.ui.badge(this.running ? '' : this.pauseReason || 'Paused');
  }

  async restart() {
    this.queue.length = 0;
    this.ui.clear();
    this.timers = [];
    this.state = {};
    this.over = false;
    this.begun = false;
    this.time = 0;
    this.contactsPrev = new Set();
    this.contactsNow.clear();
    this.reported.clear();
    for (const obj of [...this.objs.values()]) {
      obj.alive = false;
      this.engine.remove(obj, false);
    }
    this.objs.clear();
    const scene = await this.fetchScene();
    if ((scene.settings.mode === '3d') !== (this.scene.settings.mode === '3d')) return location.reload();
    const old = this.scene.settings;
    this.scene = scene;
    await this.engine.applySettings(scene.settings, old, false);
    this.mods.clear();
    this.missing.clear();
    await this.build();
    if (this.running) this.begin();
    this.post({ gamey: 'restarted', count: this.objs.size });
  }

  /* ---------- Live link to Gamey (preview only) ---------- */

  connect() {
    const es = new EventSource('/__gamey/live');
    es.onmessage = (e) => {
      let ops;
      try { ops = JSON.parse(e.data); } catch { return; }
      this.enqueue(Array.isArray(ops) ? ops : [ops]);
    };
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent || !e.data || !e.data.gamey) return;
      const d = e.data;
      if (d.gamey === 'run') this.setRunning(!!d.running, d.reason);
      else if (d.gamey === 'restart') this.enqueue([{ op: 'restart' }]);
      else if (d.gamey === 'pick') this.setPicking(!!d.on);
      else if (d.gamey === 'select') this.engine.select(d.id || null);
    });
    this.root.addEventListener('pointerdown', (e) => {
      window.focus();
      if (!this.picking) return;
      e.preventDefault();
      e.stopPropagation();
      const obj = this.engine.pick(e.clientX, e.clientY);
      if (!obj) return;
      this.engine.select(obj.id);
      this.post({ gamey: 'picked', id: obj.id, def: obj.def, spawned: !!obj.spawned });
    }, true);
    window.addEventListener('keydown', (e) => {
      if (this.picking && e.key === 'Escape') this.post({ gamey: 'pickCancel' });
    });
  }

  setPicking(on) {
    this.picking = on;
    this.root.classList.toggle('gamey-picking', on);
    if (!on) this.engine.select(null);
  }

  post(msg) {
    if (this.live && window.parent !== window) window.parent.postMessage(msg, '*');
  }

  enqueue(ops) {
    this.queue.push(...ops);
    if (!this.draining) this.drain();
  }

  async drain() {
    this.draining = true;
    try {
      while (this.queue.length) {
        const op = this.queue.shift();
        try {
          await this.apply(op);
        } catch (err) {
          console.error('[gamey] live op failed', op, err);
        }
        const gap = STAGGER[op.op];
        if (gap) await sleep(this.queue.length > 24 ? gap / 4 : gap);
      }
    } finally {
      this.draining = false;
    }
  }

  async apply(op) {
    switch (op.op) {
      case 'add':
      case 'update':
        return this.upsert(op.obj);
      case 'remove':
        this.scene.objects = this.scene.objects.filter((o) => o.id !== op.id);
        return this.removeObj(op.id, true);
      case 'settings': {
        const old = this.scene.settings;
        this.scene.settings = op.settings || {};
        if ((old.mode === '3d') !== (this.scene.settings.mode === '3d')) return location.reload();
        return this.engine.applySettings(this.scene.settings, old, true);
      }
      case 'script':
        return this.reloadMod(op.name);
      case 'asset':
        return this.engine.reloadAsset?.(op.path);
      case 'restart':
        return this.restart();
      case 'reload':
        return location.reload();
    }
  }

  async upsert(def) {
    if (!def || !def.id) return;
    const i = this.scene.objects.findIndex((o) => o.id === def.id);
    if (i >= 0) this.scene.objects[i] = def;
    else this.scene.objects.push(def);
    await Promise.resolve(this.engine.prepare(def)).catch(() => {});
    const need = behaviorsOf(def).filter((n) => !this.mods.has(n));
    await Promise.all(need.map((n) => this.loadMod(n)));
    const old = this.objs.get(def.id);
    if (!old) {
      this.addObj(def, true);
      return;
    }
    if (this.engine.canMorph(old, def)) {
      const prev = old.def;
      old.def = def;
      Object.assign(old.props, def.props || {});
      this.engine.morph(old, prev, def, true);
      if (this.begun) for (const n of behaviorsOf(def)) if (!old.createdWith.has(n)) this.callOne(old, n, 'create');
      return;
    }
    old.alive = false;
    this.objs.delete(def.id);
    this.engine.remove(old, true);
    this.addObj(def, true);
  }

  async reloadMod(name) {
    await this.loadMod(name);
    if (!this.mods.has(name)) return;
    for (const [k] of [...this.reported].entries()) if (String(k).includes(`scripts/${name}.js`)) this.reported.delete(k);
    if (this.live) this.ui.toast(`scripts/${name}.js updated`);
    if (!this.begun) return;
    if (name === 'game') return;
    for (const obj of this.objs.values()) {
      if (obj.started && behaviorsOf(obj.def).includes(name) && !obj.createdWith.has(name)) this.callOne(obj, name, 'create');
    }
  }

  /* ---------- Errors ---------- */

  report(err, where = '') {
    if (!err) return;
    const loc = err.where ? `${where}${err.where}` : stackLoc(err) || where;
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
    const text = `${loc ? loc + ': ' : ''}${name}${err.message || String(err)}`;
    this.log('error', text);
    console.error('[gamey]', text, err);
  }

  warn(text) {
    this.log('warn', text);
  }

  log(level, text) {
    if (this.reported.has(text)) return;
    this.reported.add(text);
    this.errors.push({ level, text, time: Date.now() });
    if (this.errors.length > 50) this.errors.shift();
    if (!this.live) return;
    fetch('/__gamey/log', { method: 'POST', body: JSON.stringify({ level, text }) }).catch(() => {});
    this.ui.toast(text, level === 'error' ? 'error' : 'warn');
  }

  /* ---------- Input ---------- */

  bindInput() {
    window.addEventListener('keydown', (e) => {
      const k = keyName(e.code);
      if (!this.keys.has(k)) this.pressedNow.add(k);
      this.keys.add(k);
      if (['space', 'up', 'down', 'left', 'right', 'tab'].includes(k)) e.preventDefault();
      if (this.over && (k === 'r' || k === 'enter')) this.playAgain();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(keyName(e.code)));
    window.addEventListener('blur', () => this.keys.clear());
    const p = this.pointer;
    this.root.addEventListener('pointerdown', (e) => {
      p.down = true;
      p.pressed = true;
    });
    window.addEventListener('pointerup', () => (p.down = false));
    this.root.addEventListener('pointermove', (e) => {
      p.screenX = e.clientX;
      p.screenY = e.clientY;
      p.dx += e.movementX || 0;
      p.dy += e.movementY || 0;
    });
  }

  /* ---------- Sound ---------- */

  sound(path, { volume = 1, loop = false } = {}) {
    if (!path) return null;
    const src = path.includes('/') ? path : `assets/${path}`;
    this.sounds ||= new Map();
    let base = this.sounds.get(src);
    if (!base) {
      base = new Audio(src);
      this.sounds.set(src, base);
    }
    const a = loop ? base : base.cloneNode();
    a.volume = Math.max(0, Math.min(1, volume));
    a.loop = loop;
    a.play().catch(() => {});
    return a;
  }

  audio() {
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ac = new AC();
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    return this.ac;
  }

  beep(freq = 440, seconds = 0.12, wave = 'square', volume = 0.15, toFreq) {
    const ac = this.audio();
    if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const gn = ac.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), t + seconds);
    gn.gain.setValueAtTime(volume, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    o.connect(gn).connect(ac.destination);
    o.start(t);
    o.stop(t + seconds + 0.02);
  }

  noise(seconds = 0.3, volume = 0.25) {
    const ac = this.audio();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    const gn = ac.createGain();
    gn.gain.value = volume;
    src.buffer = buf;
    src.connect(gn).connect(ac.destination);
    src.start();
  }

  // Ready-made sound effects, so a game has sound before it has sound files.
  sfx(name, volume = 1) {
    const v = 0.15 * volume;
    switch (name) {
      case 'jump': return this.beep(300, 0.18, 'square', v, 720);
      case 'coin': this.beep(988, 0.08, 'square', v); return setTimeout(() => this.beep(1319, 0.22, 'square', v), 70);
      case 'hit': return this.beep(220, 0.2, 'sawtooth', v, 70);
      case 'hurt': return this.beep(400, 0.3, 'sawtooth', v, 90);
      case 'explode': return this.noise(0.5, 0.35 * volume);
      case 'shoot':
      case 'laser': return this.beep(1200, 0.15, 'square', v * 0.8, 200);
      case 'powerup': return [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.1, 'square', v), i * 70));
      case 'win': return [523, 659, 784, 1047, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.14, 'triangle', v * 1.4), i * 110));
      case 'lose': return [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.beep(f, 0.22, 'triangle', v * 1.4), i * 160));
      case 'click': return this.beep(1800, 0.03, 'square', v * 0.6);
      default: return this.beep(660, 0.1, 'square', v);
    }
  }

  /* ---------- For Gamey's test runs ---------- */

  snapshot() {
    const objs = [...this.objs.values()].slice(0, 80).map((o) => {
      const r = { id: o.id, x: round(o.x), y: round(o.y) };
      if (this.engine.mode === '3d') r.z = round(o.z);
      if (o.physics !== 'none') {
        r.vx = round(o.vx);
        r.vy = round(o.vy);
        if (this.engine.mode === '3d') r.vz = round(o.vz);
        r.onGround = o.onGround;
      }
      if (o.visible === false) r.visible = false;
      return r;
    });
    const hud = [...this.ui.lines.values()].map((l) => l.textContent);
    return {
      time: round(this.time),
      objects: objs,
      objectCount: this.objs.size,
      state: safeJson(this.state),
      hud,
      over: this.over ? this.ui.endEl.querySelector('h2').textContent : null,
    };
  }
}

const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);

function safeJson(v) {
  try {
    return JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && x.view ? `[object ${x.id}]` : x)));
  } catch {
    return '[unreadable]';
  }
}

function stackLoc(err) {
  const m = String(err?.stack || '').match(/scripts\/([\w-]+)\.js(?:\?[^:\s)]*)?:(\d+):(\d+)/);
  return m ? `scripts/${m[1]}.js line ${m[2]}` : '';
}

// A failed dynamic import says what is wrong but not where. Loading the same file
// through a <script type=module> reports the line through the window error event.
function syntaxLine(url) {
  return new Promise((resolve) => {
    const probe = url + '&probe=' + Math.random().toString(36).slice(2);
    const base = probe.split('?')[0];
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      window.removeEventListener('error', onErr, true);
      s.remove();
      resolve(v);
    };
    const onErr = (e) => {
      if (e.filename && e.filename.split('?')[0] === base) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(` line ${e.lineno}`);
      }
    };
    window.addEventListener('error', onErr, true);
    const s = document.createElement('script');
    s.type = 'module';
    s.textContent = `import ${JSON.stringify(probe)};`;
    document.head.appendChild(s);
    setTimeout(() => finish(''), 1500);
  });
}
