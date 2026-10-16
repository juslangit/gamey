// The 3D engine: Three.js with a small box physics. Units are metres, y is up.
// Shapes are centred on x/y/z; models stand with their feet at y.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BaseObj, cssColor, changed } from './core.js';

const D2R = Math.PI / 180;
const ACCENT = '#8b7bff';
const EPS = 1e-4;

class Obj3D extends BaseObj {
  get x() { return this.view.position.x; }
  set x(v) { this.view.position.x = v; }
  get y() { return this.view.position.y; }
  set y(v) { this.view.position.y = v; }
  get z() { return this.view.position.z; }
  set z(v) { this.view.position.z = v; }
  get vx() { return this.body.vx; }
  set vx(v) { this.body.vx = v; }
  get vy() { return this.body.vy; }
  set vy(v) { this.body.vy = v; }
  get vz() { return this.body.vz; }
  set vz(v) { this.body.vz = v; }
  setVelocity(vx, vy, vz) {
    this.body.vx = vx;
    this.body.vy = vy;
    this.body.vz = vz ?? this.body.vz;
  }
  get onGround() { return this.body.onGround; }
  get rx() { return this.view.rotation.x / D2R; }
  set rx(v) { this.view.rotation.x = v * D2R; }
  get ry() { return this.view.rotation.y / D2R; }
  set ry(v) { this.view.rotation.y = v * D2R; }
  get rz() { return this.view.rotation.z / D2R; }
  set rz(v) { this.view.rotation.z = v * D2R; }
  get scale() { return this.view.scale.x; }
  set scale(s) {
    this.view.scale.setScalar(s);
    this.game.engine.measure(this);
  }
  get visible() { return this.view.visible; }
  set visible(v) { this.view.visible = !!v; }
  get color() { return this.def.color; }
  set color(c) {
    this.view.traverse((n) => n.material?.color?.set?.(cssColor(c)));
  }
  // Turn to face a direction of travel on the ground (e.g. obj.face(obj.vx, obj.vz)).
  face(dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) > 1e-3) this.view.rotation.y = Math.atan2(dx, dz);
  }
  lookAt(x, y, z) {
    if (typeof x === 'object') this.view.lookAt(x.view ? x.view.position : x);
    else this.view.lookAt(x, y, z);
  }
  // Play one of a model's animations by name (crossfades from the current one).
  play(name, fade = 0.2) {
    if (!this.mixer || !this.clips) return;
    const clip = THREE.AnimationClip.findByName(this.clips, name) || this.clips.find((c) => c.name.toLowerCase().includes(String(name).toLowerCase()));
    if (!clip || this.action?.getClip() === clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset().play();
    if (this.action) this.action.crossFadeTo(next, fade, false);
    this.action = next;
  }
  get animations() { return (this.clips || []).map((c) => c.name); }
}

const easeBackOut = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Engine {
  constructor(game) {
    this.game = game;
    this.mode = '3d';
    this.tweens = [];
    this.labels = [];
    this.models = new Map();
    this.textures = new Map();
    this.ver = {};
    this.sel = null;
    this.shake = null;
    this.gltf = new GLTFLoader();
    this.texLoader = new THREE.TextureLoader();
    this.ray = new THREE.Raycaster();
  }

  get width() { return this.renderer.domElement.clientWidth; }
  get height() { return this.renderer.domElement.clientHeight; }

  async init(settings, root) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.domElement.className = 'gamey-canvas';
    root.appendChild(r.domElement);
    this.root = root;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
    this.hemi = new THREE.HemisphereLight('#dceeff', '#4a5468', 1.2);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.mixers = new Set();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(root);
    this.applySettings(settings, {}, false);
    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this.frame(Math.min(this.clock.getDelta(), 0.05)));
    root.addEventListener('pointermove', (e) => {
      const rect = r.domElement.getBoundingClientRect();
      this.game.pointer.nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.game.pointer.ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    });
  }

  extendApi(g) {
    g.THREE = THREE;
    g.three = { scene: this.scene, camera: this.camera, renderer: this.renderer };
    // Where the pointer meets the flat ground at height y (for click-to-move and aiming).
    g.pointer.ground = (y = 0) => {
      this.ray.setFromCamera(new THREE.Vector2(g.pointer.nx || 0, g.pointer.ny || 0), this.camera);
      const p = new THREE.Vector3();
      return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? { x: p.x, y: p.y, z: p.z } : null;
    };
  }

  resize() {
    const w = this.root.clientWidth || 800;
    const h = this.root.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get cameraApi() {
    const self = this;
    return {
      follow(obj, offset) {
        self.follow = obj || null;
        if (offset) self.followOffset = new THREE.Vector3(offset.x ?? 0, offset.y ?? 6, offset.z ?? 10);
      },
      stop() { self.follow = null; },
      set(x, y, z, look) {
        self.follow = null;
        self.camera.position.set(x, y, z);
        if (look) self.camera.lookAt(look.x ?? 0, look.y ?? 0, look.z ?? 0);
        self.camBase = self.camera.position.clone();
      },
      shake(strength = 0.3, seconds = 0.3) { self.shake = { strength, left: seconds }; },
      raw: self.camera,
    };
  }

  applySettings(s, old = {}) {
    this.settings = s;
    this.gravity = s.gravity ?? 25;
    const bg = s.background ?? ['#7cc4ff', '#eef4ff'];
    if (Array.isArray(bg)) {
      const c = document.createElement('canvas');
      c.width = 2;
      c.height = 256;
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      bg.forEach((col, i) => grad.addColorStop(bg.length > 1 ? i / (bg.length - 1) : 0, cssColor(col)));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 2, 256);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = tex;
    } else {
      this.scene.background = new THREE.Color(cssColor(bg));
    }
    const fogColor = Array.isArray(bg) ? bg[bg.length - 1] : bg;
    if (s.fog) {
      const f = s.fog === true ? {} : s.fog;
      this.scene.fog = new THREE.Fog(cssColor(f.color ?? fogColor), f.near ?? 20, f.far ?? 90);
    } else this.scene.fog = null;
    this.hemi.intensity = s.ambient ?? 1.2;
    const sun = s.sun || {};
    this.sunOffset = new THREE.Vector3(sun.x ?? 10, sun.y ?? 18, sun.z ?? 8);
    this.sun.intensity = sun.intensity ?? 2.4;
    this.sun.color.set(cssColor(sun.color, '#fff4e0'));
    this.sun.castShadow = s.shadows !== false;
    const area = s.shadowSize ?? 30;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -area;
    sc.right = sc.top = area;
    sc.near = 0.5;
    sc.far = 200;
    sc.updateProjectionMatrix();
    this.placeSun(new THREE.Vector3());
    const cam = s.camera || {};
    this.camera.fov = cam.fov ?? 60;
    this.camera.updateProjectionMatrix();
    this.followOffset = new THREE.Vector3(cam.offset?.x ?? 0, cam.offset?.y ?? 6, cam.offset?.z ?? 10);
    this.follow = cam.follow ? this.game.objs.get(cam.follow) || null : null;
    if (!this.follow || !old.camera) {
      this.camera.position.set(cam.x ?? 0, cam.y ?? 8, cam.z ?? 14);
      const l = cam.lookAt || { x: 0, y: 0, z: 0 };
      this.camera.lookAt(l.x ?? 0, l.y ?? 0, l.z ?? 0);
      this.camBase = this.camera.position.clone();
    }
  }

  placeSun(center) {
    this.sun.position.copy(center).add(this.sunOffset);
    this.sun.target.position.copy(center);
  }

  frame(dt) {
    const g = this.game;
    g.tick(dt);
    if (g.active) this.step(dt);
    g.flushContacts();
    for (const m of this.mixers) m.update(dt);
    this.runTweens(dt);
    this.updateCamera(dt);
    this.updateLabels();
    if (this.sel) {
      if (!this.sel.obj.alive) this.select(null);
      else this.sel.helper.update();
    }
    this.renderer.render(this.scene, this.camera);
    g.endFrame();
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (this.follow && !this.follow.alive) this.follow = this.game.objs.get(this.follow.id) || null;
    if (this.follow) {
      const t = this.follow.view.position;
      const want = t.clone().add(this.followOffset);
      const smooth = this.settings.camera?.smooth ?? 0.1;
      cam.position.lerp(want, 1 - Math.pow(1 - smooth, dt * 60));
      cam.lookAt(t.x, t.y + 1, t.z);
      this.placeSun(t);
      this.camBase = cam.position.clone();
    }
    if (this.shake) {
      this.shake.left -= dt;
      const s = this.shake.left > 0 ? this.shake.strength : 0;
      cam.position.copy(this.camBase).add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      if (this.shake.left <= 0) this.shake = null;
    }
  }

  /* ---------- Physics: boxes that do not rotate ---------- */

  measure(obj) {
    const v = obj.view;
    const rot = v.rotation.clone();
    const spinning = obj.physics === 'dynamic';
    if (spinning) v.rotation.set(0, 0, 0);
    v.updateMatrixWorld(true);
    const box = new THREE.Box3();
    v.traverse((n) => {
      if ((n.isMesh || n.isSprite) && !n.userData.fx) box.expandByObject(n, false);
    });
    if (spinning) v.rotation.copy(rot);
    v.updateMatrixWorld(true);
    if (box.isEmpty()) box.setFromCenterAndSize(v.position, new THREE.Vector3(0.5, 0.5, 0.5));
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const off = box.getCenter(new THREE.Vector3()).sub(v.position);
    if (spinning) half.x = half.z = Math.max(half.x, half.z);
    if (obj.physics === 'static' && half.y < 0.25) {
      off.y -= 0.25 - half.y;
      half.y = 0.25;
    }
    obj.half = half;
    obj.off = off;
  }

  lo(o, axis) { return o.view.position[axis] + o.off[axis] - o.half[axis]; }
  hi(o, axis) { return o.view.position[axis] + o.off[axis] + o.half[axis]; }

  overlaps(a, b) {
    for (const ax of ['x', 'y', 'z']) {
      if (this.lo(a, ax) >= this.hi(b, ax) - EPS || this.hi(a, ax) <= this.lo(b, ax) + EPS) return false;
    }
    return true;
  }

  step(dt) {
    const objs = [...this.game.objs.values()].filter((o) => o.alive && o.half);
    const solids = [];
    const sensors = [];
    const dyn = [];
    for (const o of objs) {
      const k = o.physics;
      if (k === 'dynamic') dyn.push(o);
      else if (k === 'static' || k === 'kinematic') solids.push(o);
      else if (k === 'sensor') sensors.push(o);
      if (k !== 'dynamic' && k !== 'static') {
        const b = o.body;
        if (b.vx || b.vy || b.vz) {
          o.view.position.x += b.vx * dt;
          o.view.position.y += b.vy * dt;
          o.view.position.z += b.vz * dt;
        }
      }
    }
    for (const o of dyn) {
      const b = o.body;
      const p = o.view.position;
      if (o.def.gravity !== false) b.vy -= this.gravity * dt;
      b.vy = Math.max(b.vy, -60);
      if (o.def.drag) {
        const k = Math.max(0, 1 - o.def.drag * dt);
        b.vx *= k;
        b.vz *= k;
      }
      b.onGround = false;
      p.x += b.vx * dt;
      this.resolve(o, 'x', solids, dt);
      p.y += b.vy * dt;
      this.resolve(o, 'y', solids, dt);
      p.z += b.vz * dt;
      this.resolve(o, 'z', solids, dt);
    }
    for (let i = 0; i < dyn.length; i++) {
      for (let j = i + 1; j < dyn.length; j++) {
        const a = dyn[i];
        const c = dyn[j];
        if (!this.overlaps(a, c)) continue;
        this.game.contact(a, c);
        let best = null;
        for (const ax of ['x', 'z', 'y']) {
          const pen = Math.min(this.hi(a, ax) - this.lo(c, ax), this.hi(c, ax) - this.lo(a, ax));
          if (!best || pen < best.pen) best = { ax, pen, sign: a.view.position[ax] < c.view.position[ax] ? -1 : 1 };
        }
        const ma = a.def.pushable === false ? 0 : 1;
        const mc = c.def.pushable === false ? 0 : 1;
        const total = ma + mc || 1;
        a.view.position[best.ax] += (best.sign * best.pen * ma) / total;
        c.view.position[best.ax] -= (best.sign * best.pen * mc) / total;
      }
    }
    for (const s of sensors) {
      for (const o of dyn) if (this.overlaps(s, o)) this.game.contact(s, o);
      for (const o of solids) if (o.physics === 'kinematic' && this.overlaps(s, o)) this.game.contact(s, o);
    }
  }

  resolve(o, ax, solids, dt) {
    const b = o.body;
    const vKey = `v${ax}`;
    for (const s of solids) {
      if (!this.overlaps(o, s)) continue;
      const v = b[vKey] - (s.body[vKey] || 0);
      const down = this.hi(o, ax) - this.lo(s, ax);
      const up = this.hi(s, ax) - this.lo(o, ax);
      const push = v > 0 ? -down : v < 0 ? up : down < up ? -down : up;
      o.view.position[ax] += push;
      if (ax === 'y' && push > 0) {
        b.onGround = true;
        if (s.physics === 'kinematic') {
          o.view.position.x += (s.body.vx || 0) * dt;
          o.view.position.z += (s.body.vz || 0) * dt;
        }
      }
      const bounce = o.def.bounce ?? 0;
      b[vKey] = Math.abs(v) > 2 && bounce ? -b[vKey] * bounce : s.body[vKey] || 0;
      this.game.contact(o, s);
    }
  }

  /* ---------- Assets ---------- */

  url(path) {
    return this.ver[path] ? `${path}?v=${this.ver[path]}` : path;
  }

  loadModel(path) {
    const key = this.url(path);
    if (!this.models.has(key)) {
      this.models.set(key, new Promise((resolve, reject) => this.gltf.load(key, resolve, undefined, reject)));
    }
    return this.models.get(key);
  }

  loadTexture(path) {
    const key = this.url(path);
    if (!this.textures.has(key)) {
      this.textures.set(
        key,
        new Promise((resolve) =>
          this.texLoader.load(
            key,
            (t) => {
              t.colorSpace = THREE.SRGBColorSpace;
              t.wrapS = t.wrapT = THREE.RepeatWrapping;
              resolve(t);
            },
            undefined,
            () => {
              this.game.report(new Error(`Could not load the picture ${path}`), '');
              resolve(null);
            }
          )
        )
      );
    }
    return this.textures.get(key);
  }

  prepare(def) {
    if (!def.asset) return;
    if (def.type === 'model') {
      return this.loadModel(def.asset).catch((e) => this.game.report(new Error(`Could not load the model ${def.asset}: ${e.message || e}`), ''));
    }
    return this.loadTexture(def.asset);
  }

  async reloadAsset(path) {
    this.ver[path] = (this.ver[path] || 0) + 1;
    const users = [...this.game.objs.values()].filter((o) => o.def.asset === path);
    if (!users.length) return;
    await this.prepare(users[0].def);
    for (const o of users) {
      if (!o.alive) continue;
      this.build(o, o.def);
      this.pulse(o);
    }
  }

  /* ---------- Objects ---------- */

  create(def) {
    const view = new THREE.Group();
    view.userData.gid = def.id;
    const obj = new Obj3D(this.game, def);
    obj.view = view;
    obj.body = { vx: def.vx || 0, vy: def.vy || 0, vz: def.vz || 0, onGround: false };
    this.place(view, def);
    this.build(obj, def);
    this.scene.add(view);
    if (this.settings.camera?.follow === def.id) this.follow = obj;
    return obj;
  }

  place(view, def) {
    view.position.set(def.x || 0, def.y || 0, def.z || 0);
    view.rotation.set((def.rx || 0) * D2R, (def.ry || 0) * D2R, (def.rz || 0) * D2R);
    const s = def.scale ?? 1;
    if (typeof s === 'object') view.scale.set(s.x ?? 1, s.y ?? 1, s.z ?? 1);
    else view.scale.setScalar(s);
    view.visible = def.visible !== false;
  }

  material(def) {
    const m = new THREE.MeshStandardMaterial({
      color: cssColor(def.color, '#d8d8d8'),
      roughness: def.roughness ?? 0.8,
      metalness: def.metalness ?? 0,
      flatShading: !!def.flat,
      wireframe: !!def.wireframe,
      transparent: (def.opacity ?? 1) < 1,
      opacity: def.opacity ?? 1,
    });
    if (def.glow) {
      m.emissive.set(cssColor(def.glow === true ? def.color : def.glow));
      m.emissiveIntensity = def.glowStrength ?? 1;
    }
    if (def.asset && def.type !== 'model') {
      this.loadTexture(def.asset).then((t) => {
        if (!t) return;
        const tex = t.clone();
        tex.needsUpdate = true;
        const rep = def.repeat ?? 1;
        tex.repeat.set(Array.isArray(rep) ? rep[0] : rep, Array.isArray(rep) ? rep[1] : rep);
        m.map = tex;
        m.color.set(cssColor(def.color, '#ffffff'));
        m.needsUpdate = true;
      });
    }
    return m;
  }

  geometry(def) {
    const r = def.r ?? 0.5;
    switch (def.type) {
      case 'sphere': return new THREE.SphereGeometry(r, 32, 20);
      case 'cylinder': return new THREE.CylinderGeometry(def.rTop ?? r, r, def.h ?? 1, 32);
      case 'cone': return new THREE.ConeGeometry(r, def.h ?? 1, 32);
      case 'capsule': {
        const cr = def.r ?? 0.4;
        return new THREE.CapsuleGeometry(cr, Math.max(0.01, (def.h ?? 1.6) - cr * 2), 8, 16);
      }
      case 'torus': return new THREE.TorusGeometry(def.r ?? 0.6, def.tube ?? 0.2, 16, 48);
      case 'plane': return new THREE.PlaneGeometry(def.w ?? 10, def.d ?? 10).rotateX(-Math.PI / 2);
      case 'box': return new THREE.BoxGeometry(def.w ?? 1, def.h ?? 1, def.d ?? 1);
      default: return null;
    }
  }

  // (Re)build what an object looks like inside its group.
  build(obj, def) {
    const view = obj.view;
    for (const c of [...view.children]) {
      if (c.userData.fx) continue;
      view.remove(c);
      dispose(c);
    }
    if (obj.mixer) this.mixers.delete(obj.mixer);
    obj.mixer = obj.clips = obj.action = null;
    const geo = this.geometry(def);
    if (geo) {
      const mesh = new THREE.Mesh(geo, this.material(def));
      mesh.castShadow = def.shadow !== false && def.type !== 'plane';
      mesh.receiveShadow = true;
      view.add(mesh);
    } else if (def.type === 'model') {
      if (def.asset) this.attachModel(obj, def);
    } else if (def.type === 'text' || def.type === 'emoji') {
      view.add(textSprite(def));
    } else if (def.type === 'light') {
      const color = cssColor(def.color, '#ffffff');
      const light = def.kind === 'spot'
        ? new THREE.SpotLight(color, def.intensity ?? 40, def.range ?? 20, (def.angle ?? 35) * D2R, 0.4)
        : new THREE.PointLight(color, def.intensity ?? 20, def.range ?? 12);
      view.add(light);
    } else {
      this.game.warn(`Object "${def.id}" has an unknown type "${def.type}" for a 3D game, so it is drawn as a box.`);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material(def));
      mesh.castShadow = mesh.receiveShadow = true;
      view.add(mesh);
    }
    this.measure(obj);
  }

  attachModel(obj, def) {
    this.loadModel(def.asset)
      .then((gltf) => {
        if (!obj.alive || obj.def.asset !== def.asset || obj.model?.userData.src === this.url(def.asset)) return;
        if (obj.model) obj.view.remove(obj.model);
        const m = cloneSkinned(gltf.scene);
        m.userData.src = this.url(def.asset);
        m.traverse((n) => {
          if (n.isMesh) {
            n.castShadow = def.shadow !== false;
            n.receiveShadow = true;
            if (def.color && n.material) {
              n.material = n.material.clone();
              n.material.color?.set(cssColor(def.color));
            }
          }
        });
        if (def.size) {
          const s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
          m.scale.setScalar(def.size / Math.max(s.x, s.y, s.z, 1e-6));
        }
        const box = new THREE.Box3().setFromObject(m);
        const c = box.getCenter(new THREE.Vector3());
        m.position.x -= c.x;
        m.position.z -= c.z;
        m.position.y -= box.min.y;
        obj.view.add(m);
        obj.model = m;
        if (gltf.animations?.length && def.animation !== false) {
          obj.mixer = new THREE.AnimationMixer(m);
          obj.clips = gltf.animations;
          this.mixers.add(obj.mixer);
          obj.play(typeof def.animation === 'string' ? def.animation : gltf.animations[0].name);
        }
        this.measure(obj);
      })
      .catch(() => {});
  }

  canMorph(obj, def) {
    const prev = obj.def;
    return prev.type === def.type && prev.asset === def.asset && (prev.physics || 'none') === (def.physics || 'none');
  }

  morph(obj, prev, def, animate) {
    const v = obj.view;
    const looks = ['w', 'h', 'd', 'r', 'rTop', 'tube', 'text', 'emoji', 'size', 'opacity', 'glow', 'glowStrength', 'roughness', 'metalness', 'flat', 'wireframe', 'repeat', 'kind', 'intensity', 'range', 'angle', 'shadow', 'animation', 'font'];
    if (changed(prev, def, looks)) {
      this.build(obj, def);
      if (animate) this.pulse(obj);
    }
    if (changed(prev, def, ['visible'])) v.visible = def.visible !== false;
    if (changed(prev, def, ['vx', 'vy', 'vz'])) obj.setVelocity(def.vx || 0, def.vy || 0, def.vz || 0);
    const p0 = v.position.clone();
    const p1 = new THREE.Vector3(
      changed(prev, def, ['x']) ? def.x || 0 : p0.x,
      changed(prev, def, ['y']) ? def.y || 0 : p0.y,
      changed(prev, def, ['z']) ? def.z || 0 : p0.z
    );
    const r0 = v.rotation.clone();
    const r1 = new THREE.Euler(
      changed(prev, def, ['rx']) ? (def.rx || 0) * D2R : r0.x,
      changed(prev, def, ['ry']) ? (def.ry || 0) * D2R : r0.y,
      changed(prev, def, ['rz']) ? (def.rz || 0) * D2R : r0.z
    );
    const s0 = v.scale.clone();
    const s = def.scale ?? 1;
    const s1 = changed(prev, def, ['scale']) ? (typeof s === 'object' ? new THREE.Vector3(s.x ?? 1, s.y ?? 1, s.z ?? 1) : new THREE.Vector3(s, s, s)) : s0.clone();
    const recolor = changed(prev, def, ['color']);
    const c0 = new THREE.Color(cssColor(prev.color, '#d8d8d8'));
    const c1 = new THREE.Color(cssColor(def.color, '#d8d8d8'));
    const apply = (k) => {
      v.position.lerpVectors(p0, p1, k);
      v.rotation.set(r0.x + (r1.x - r0.x) * k, r0.y + (r1.y - r0.y) * k, r0.z + (r1.z - r0.z) * k);
      v.scale.lerpVectors(s0, s1, k);
      if (recolor) {
        const c = c0.clone().lerp(c1, k);
        v.traverse((n) => {
          if (n.isMesh && n.material?.color && !n.userData.fx) n.material.color.copy(c);
          if (n.isLight) n.color.copy(c);
        });
      }
    };
    if (!animate) {
      apply(1);
      return this.measure(obj);
    }
    this.tween(500, easeInOut, apply, () => this.measure(obj));
    this.boxFlash(obj);
  }

  remove(obj, animate) {
    const v = obj.view;
    if (this.follow === obj) this.follow = null;
    if (this.sel?.obj === obj) this.select(null);
    if (obj.mixer) this.mixers.delete(obj.mixer);
    const gone = () => {
      this.scene.remove(v);
      v.traverse((n) => {
        if (n !== obj.model && !isShared(n)) dispose(n);
      });
    };
    if (!animate) return gone();
    const s0 = v.scale.clone();
    this.tween(260, (t) => t * t, (k) => v.scale.copy(s0).multiplyScalar(Math.max(0.0001, 1 - k)), gone);
  }

  /* ---------- Live effects ---------- */

  tween(ms, ease, fn, done) {
    this.tweens.push({ t: 0, dur: ms / 1000, ease, fn, done });
  }

  runTweens(dt) {
    if (!this.tweens.length) return;
    for (const tw of this.tweens.slice()) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      try {
        tw.fn(tw.ease(k));
      } catch {}
      if (k >= 1) {
        tw.dead = true;
        tw.done?.();
      }
    }
    this.tweens = this.tweens.filter((t) => !t.dead);
  }

  popIn(obj) {
    const v = obj.view;
    const target = v.scale.clone();
    v.scale.setScalar(0.0001);
    this.tween(560, easeBackOut, (k) => v.scale.copy(target).multiplyScalar(Math.max(0.0001, k)));
    const half = obj.half || new THREE.Vector3(0.5, 0.5, 0.5);
    const off = obj.off || new THREE.Vector3();
    const base = v.position.clone().add(off);
    const radius = Math.min(Math.max(half.x, half.z) * 1.25 + 0.3, 40);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, depthWrite: false })
    );
    ring.userData.fx = true;
    ring.position.set(base.x, base.y - half.y + 0.03, base.z);
    ring.scale.setScalar(radius);
    this.scene.add(ring);
    this.tween(750, (t) => 1 - Math.pow(1 - t, 3), (k) => {
      ring.scale.setScalar(radius * (1 + 0.8 * k));
      ring.material.opacity = 0.95 * (1 - k);
    }, () => {
      this.scene.remove(ring);
      dispose(ring);
    });
    this.label(obj.id, new THREE.Vector3(base.x, base.y + half.y + 0.35, base.z));
  }

  pulse(obj) {
    const v = obj.view;
    const s0 = v.scale.clone();
    this.tween(380, easeBackOut, (k) => v.scale.copy(s0).multiplyScalar(0.8 + 0.2 * k));
    this.boxFlash(obj);
  }

  boxFlash(obj) {
    const helper = new THREE.BoxHelper(obj.view, ACCENT);
    helper.userData.fx = true;
    helper.material.transparent = true;
    this.scene.add(helper);
    this.tween(800, (t) => t, (k) => {
      helper.update();
      helper.material.opacity = 1 - k;
    }, () => {
      this.scene.remove(helper);
      dispose(helper);
    });
  }

  label(text, at) {
    const el = document.createElement('div');
    el.className = 'gamey-label';
    el.textContent = text;
    this.root.appendChild(el);
    const item = { el, at, born: performance.now() };
    this.labels.push(item);
    this.updateLabels();
  }

  updateLabels() {
    if (!this.labels.length) return;
    const now = performance.now();
    const w = this.width;
    const h = this.height;
    for (const l of this.labels) {
      const age = now - l.born;
      if (age > 1600) {
        l.el.remove();
        l.dead = true;
        continue;
      }
      const p = l.at.clone().project(this.camera);
      l.el.style.left = `${((p.x + 1) / 2) * w}px`;
      l.el.style.top = `${((1 - p.y) / 2) * h - Math.max(0, age - 1000) / 40}px`;
      l.el.style.opacity = p.z > 1 ? 0 : age > 1000 ? String(1 - (age - 1000) / 600) : '1';
    }
    this.labels = this.labels.filter((l) => !l.dead);
  }

  /* ---------- Picking (point & change) ---------- */

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.scene.children, true);
    for (const h of hits) {
      let n = h.object;
      if (n.userData.fx) continue;
      while (n && !n.userData.gid) n = n.parent;
      const obj = n && this.game.objs.get(n.userData.gid);
      if (obj && obj.alive) return obj;
    }
    return null;
  }

  select(id) {
    if (this.sel) {
      this.scene.remove(this.sel.helper);
      dispose(this.sel.helper);
    }
    this.sel = null;
    const obj = id && this.game.objs.get(id);
    if (!obj) return;
    const helper = new THREE.BoxHelper(obj.view, ACCENT);
    helper.userData.fx = true;
    this.scene.add(helper);
    this.sel = { obj, helper };
  }
}

function textSprite(def) {
  const isEmoji = def.type === 'emoji';
  const text = String(isEmoji ? def.emoji || '⭐' : def.text ?? '');
  const px = 128;
  const font = isEmoji
    ? `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
    : `${def.bold === false ? '' : 'bold '}${px}px ${def.font || 'system-ui, -apple-system, sans-serif'}`;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.max(8, Math.ceil(ctx.measureText(text).width) + 24);
  c.width = w;
  c.height = px * 1.3;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!isEmoji && def.stroke) {
    ctx.lineWidth = def.strokeWidth ?? 12;
    ctx.strokeStyle = cssColor(def.stroke, '#000');
    ctx.strokeText(text, w / 2, c.height / 2);
  }
  ctx.fillStyle = cssColor(def.color, '#ffffff');
  ctx.fillText(text, w / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  const size = def.size ?? (isEmoji ? 1 : 0.6);
  sprite.scale.set((size * c.width) / c.height, size, 1);
  return sprite;
}

function isShared(n) {
  return !!n.userData?.sharedFromModel;
}

function dispose(n) {
  n.traverse?.((c) => {
    c.geometry?.dispose?.();
    const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
    for (const m of mats) {
      m.map?.dispose?.();
      m.dispose?.();
    }
  });
}
