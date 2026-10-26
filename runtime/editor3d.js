// The Editor tab's free camera for 3D games, controlled like a game engine's scene view:
// drag orbits, right-drag looks around, Shift/middle-drag pans, scroll or pinch zooms,
// WASD/QE flies (Shift for faster), F frames the selection, a click selects.
import * as THREE from 'three';

const KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ']);

export class EditorCam3D {
  constructor(engine) {
    this.engine = engine;
    this.on = false;
    this.keys = new Set();
    this.pivot = new THREE.Vector3();
    this.drag = null;
    this.speed = 12;
    this.grid = null;
    this.tween = null;
    const el = engine.renderer.domElement;
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
      if (k === 'f' && this.engine.sel) this.focus(this.engine.sel.obj);
      if (k === 'g' && this.grid) this.grid.visible = !this.grid.visible;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get camera() {
    return this.engine.camera;
  }

  enable() {
    if (this.on) return;
    this.on = true;
    const cam = this.camera;
    // Start from wherever the game's camera was, looking at the same spot.
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const ground = this.groundHit(cam.position, dir);
    this.pivot.copy(ground || cam.position.clone().add(dir.multiplyScalar(15)));
    this.speed = this.flySpeed();
    if (!this.grid) {
      this.grid = new THREE.GridHelper(400, 200, 0x8b7bff, 0x5a6070);
      this.grid.material.transparent = true;
      this.grid.material.opacity = 0.18;
      this.grid.material.depthWrite = false;
      this.grid.userData.fx = true;
      this.grid.renderOrder = -1;
    }
    this.engine.scene.add(this.grid);
    this.engine.renderer.domElement.style.cursor = 'grab';
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    this.keys.clear();
    this.drag = null;
    this.tween = null;
    if (this.grid) this.engine.scene.remove(this.grid);
    this.engine.renderer.domElement.style.cursor = '';
  }

  // Where a ray hits the ground: terrain if there is some, otherwise y = 0.
  groundHit(from, dir) {
    const ray = new THREE.Raycaster(from, dir.clone().normalize(), 0, 2000);
    const solids = [...this.engine.terrains].map((o) => o.terrain.mesh);
    const hit = solids.length && ray.intersectObjects(solids, false)[0];
    if (hit) return hit.point;
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) && p.distanceTo(from) < 1500 ? p : null;
  }

  /* ---------- Mouse ---------- */

  down(e) {
    if (!this.on || this.engine.game.picking) return;
    const mode = e.button === 2 || (e.button === 0 && e.altKey) ? 'look' : e.button === 1 || (e.button === 0 && e.shiftKey) ? 'pan' : 'orbit';
    this.drag = { mode, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button };
    this.tween = null;
    if (mode === 'orbit') {
      // Orbit around what is under the pointer when there is something, so you turn around the thing you grabbed.
      const hit = this.pointAt(e.clientX, e.clientY);
      if (hit && hit.distanceTo(this.camera.position) < this.camera.position.distanceTo(this.pivot) * 3) this.pivot.copy(hit);
    }
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
    this.engine.renderer.domElement.style.cursor = 'grabbing';
    if (d.mode === 'orbit') this.orbit(-dx * 0.005, -dy * 0.005);
    else if (d.mode === 'look') this.look(-dx * 0.003, -dy * 0.003);
    else this.pan(dx, dy);
  }

  up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.engine.renderer.domElement.style.cursor = this.on ? 'grab' : '';
    // A click without a drag selects what is under the pointer.
    if (!d.moved && d.button === 0 && this.on) {
      const obj = this.engine.pick(e.clientX, e.clientY);
      this.engine.select(obj ? obj.id : null);
      this.engine.game.post({ gamey: 'selected', id: obj ? obj.id : null });
    }
  }

  wheel(e) {
    if (!this.on) return;
    e.preventDefault();
    if (e.shiftKey && !e.ctrlKey) return this.pan(-e.deltaX, -e.deltaY);
    // Pinch on a trackpad arrives as ctrl+wheel; both zoom towards the pointer.
    const amount = e.ctrlKey ? e.deltaY * 3 : e.deltaY;
    this.zoomAt(e.clientX, e.clientY, amount);
  }

  pointAt(x, y) {
    const el = this.engine.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - el.left) / el.width) * 2 - 1, -((y - el.top) / el.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.engine.scene.children, true).filter((h) => !h.object.userData.fx && h.object.visible && !h.object.isSprite);
    return hits[0]?.point || this.groundHit(ray.ray.origin, ray.ray.direction);
  }

  /* ---------- Moves ---------- */

  orbit(yaw, pitch) {
    const cam = this.camera;
    const off = cam.position.clone().sub(this.pivot);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += yaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi + pitch, 0.05, Math.PI - 0.05);
    off.setFromSpherical(sph);
    cam.position.copy(this.pivot).add(off);
    this.aboveGround();
    cam.lookAt(this.pivot);
  }

  look(yaw, pitch) {
    const cam = this.camera;
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    e.y += yaw;
    e.x = THREE.MathUtils.clamp(e.x + pitch, -1.55, 1.55);
    e.z = 0;
    cam.quaternion.setFromEuler(e);
    const dist = Math.max(2, cam.position.distanceTo(this.pivot));
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    this.pivot.copy(cam.position).add(dir.multiplyScalar(dist));
  }

  pan(dx, dy) {
    const cam = this.camera;
    const dist = Math.max(1, cam.position.distanceTo(this.pivot));
    const h = this.engine.renderer.domElement.clientHeight || 600;
    const k = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    const move = right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k));
    cam.position.add(move);
    this.pivot.add(move);
    this.aboveGround();
  }

  zoomAt(x, y, amount) {
    const cam = this.camera;
    const target = this.pointAt(x, y) || this.pivot;
    const dist = cam.position.distanceTo(target);
    const step = THREE.MathUtils.clamp(amount * 0.0015, -0.5, 0.5);
    if (step < 0 && dist < 0.5) return;
    const move = target.clone().sub(cam.position).multiplyScalar(-step);
    cam.position.add(move);
    // Keep the pivot the same distance ahead so orbiting still feels right.
    if (cam.position.distanceTo(this.pivot) < 1) this.pivot.add(move);
    this.speed = this.flySpeed();
    this.aboveGround();
  }

  // Flying speed follows how far away you are looking, within walking-to-drone limits.
  flySpeed() {
    return Math.max(4, Math.min(40, this.camera.position.distanceTo(this.pivot) * 0.8));
  }

  // Never sink into the terrain.
  aboveGround() {
    const p = this.camera.position;
    const h = this.engine.heightAt(p.x, p.z);
    if (h !== null && p.y < h + 0.5) p.y = h + 0.5;
  }

  // Glide to frame an object.
  focus(obj) {
    const box = new THREE.Box3();
    obj.view.traverse((n) => {
      if ((n.isMesh || n.isSprite) && !n.userData.fx) box.expandByObject(n);
    });
    if (box.isEmpty()) box.setFromCenterAndSize(obj.view.position, new THREE.Vector3(1, 1, 1));
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.min(box.getSize(new THREE.Vector3()).length(), 120);
    const cam = this.camera;
    const dir = cam.position.clone().sub(this.pivot).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0.5, 1).normalize();
    const to = center.clone().add(dir.multiplyScalar(Math.max(3, size * 1.4)));
    this.tween = { t: 0, from: cam.position.clone(), to, pFrom: this.pivot.clone(), pTo: center };
  }

  /* ---------- Every frame ---------- */

  update(dt) {
    if (!this.on) return;
    const cam = this.camera;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.45);
      const k = 1 - Math.pow(1 - tw.t, 3);
      cam.position.lerpVectors(tw.from, tw.to, k);
      this.pivot.lerpVectors(tw.pFrom, tw.pTo, k);
      cam.lookAt(this.pivot);
      if (tw.t >= 1) this.tween = null;
      return;
    }
    const k = this.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const u = (k.has('e') || k.has(' ') ? 1 : 0) - (k.has('q') ? 1 : 0);
    if (!f && !r && !u) return;
    const speed = this.speed * (k.has('shift') ? 3 : 1) * dt;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const move = fwd.multiplyScalar(f * speed).add(right.multiplyScalar(r * speed)).add(new THREE.Vector3(0, u * speed, 0));
    cam.position.add(move);
    this.pivot.add(move);
    this.aboveGround();
    this.speed = this.flySpeed();
  }
}
