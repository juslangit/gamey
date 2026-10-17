// What makes a 3D Gamey world look finished: terrain, scattered models (a forest of
// real trees in one call), grass and wind, water, skies that also light the scene,
// and the picture finish (bloom, ambient occlusion, colour grading).
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { cssColor } from './core.js';

const D2R = Math.PI / 180;

/* ---------- Random numbers and noise (seeded, so a world is the same every run) ---------- */

export function rng(seed = 1) {
  let a = (typeof seed === 'string' ? [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) : seed) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2(seed) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const l1 = grad(perm[a], x, y) + u * (grad(perm[b], x - 1, y) - grad(perm[a], x, y));
    const l2 = grad(perm[a + 1], x, y - 1) + u * (grad(perm[b + 1], x - 1, y - 1) - grad(perm[a + 1], x, y - 1));
    return (l1 + v * (l2 - l1)) * 0.7;
  };
}

/* ---------- Terrain ---------- */

// Height of a terrain object at world x, z (before the object's own y).
function makeHeight(def) {
  const n = noise2(def.seed ?? 7);
  const w = def.w ?? 200, d = def.d ?? def.w ?? 200;
  const amp = def.height ?? 8;
  const scale = def.hillSize ?? 40;
  const shape = def.shape || 'hills';
  const flats = Array.isArray(def.flats) ? def.flats : [];
  const path = def.path ? { pts: def.path, width: def.pathWidth ?? 3 } : null;
  const cx = def.x || 0, cz = def.z || 0;
  return (wx, wz) => {
    const x = wx - cx, z = wz - cz;
    let f = 0, a = 1, fr = 1 / scale, tot = 0;
    for (let o = 0; o < 5; o++) {
      f += n(x * fr + o * 17.3, z * fr - o * 9.1) * a;
      tot += a;
      a *= 0.5;
      fr *= 2.03;
    }
    f /= tot; // about -0.5..0.5
    const r = Math.hypot(x / (w / 2), z / (d / 2)); // 0 centre .. 1 edge
    let h;
    if (shape === 'flat') h = f * amp * 0.15;
    else if (shape === 'island') h = amp * (0.75 - r * r * 1.1 + f * 1.1);
    else if (shape === 'mountain') h = amp * (Math.exp(-r * r * 4) + f * 0.35);
    else if (shape === 'valley') h = amp * (Math.min(1, r * 1.4) ** 2 * 0.9 + f * 0.5);
    else h = amp * (f + 0.5) * 1.2;
    for (const c of flats) {
      const dd = Math.hypot(wx - c.x, wz - c.z), rr = c.r ?? 5;
      if (dd < rr * 1.8) {
        const k = dd < rr ? 1 : 1 - (dd - rr) / (rr * 0.8);
        h += ((c.y ?? 0) - (def.y || 0) - h) * k * k * (3 - 2 * k);
      }
    }
    if (path) {
      const dd = distToPath(wx, wz, path.pts);
      if (dd < path.width * 1.5) h -= (1 - dd / (path.width * 1.5)) * 0.25;
    }
    return h;
  };
}

function distToPath(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pt(pts[i]), [bx, bz] = pt(pts[i + 1]);
    const dx = bx - ax, dz = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * k, z - az - dz * k));
  }
  return best;
}
const pt = (p) => (Array.isArray(p) ? p : [p.x, p.z]);

const PALETTES = {
  meadow: { low: '#c9b98a', grass: ['#5f8f3a', '#4d7d30', '#6f9c45'], rock: '#7d776e', peak: '#f2f4f7', path: '#a88b5e' },
  forest: { low: '#9c8c62', grass: ['#3f6b2c', '#355e27', '#4b7834'], rock: '#6f6a62', peak: '#eef2f6', path: '#8a6e48' },
  autumn: { low: '#b59b6a', grass: ['#8c7a33', '#a0682a', '#6f7b30'], rock: '#7a7068', peak: '#f2f2f2', path: '#9a7a50' },
  desert: { low: '#e2c48f', grass: ['#d9b77e', '#cfa86c', '#e6c995'], rock: '#b98a5c', peak: '#c97b4f', path: '#c79c66' },
  snow: { low: '#d9e2ea', grass: ['#eef3f8', '#e3eaf1', '#f7f9fc'], rock: '#7b8086', peak: '#ffffff', path: '#bcc5cf' },
  alien: { low: '#3b2a5e', grass: ['#5a3d8a', '#6b4aa0', '#4a3478'], rock: '#2c2440', peak: '#9ef7e0', path: '#7a5cc0' },
};

export function buildTerrain(def) {
  const w = def.w ?? 200, d = def.d ?? def.w ?? 200;
  const seg = Math.max(16, Math.min(400, def.detail ?? Math.round(Math.max(w, d) * 0.9)));
  const geo = new THREE.PlaneGeometry(w, d, seg, Math.round((seg * d) / w));
  geo.rotateX(-Math.PI / 2);
  const height = makeHeight(def);
  const pos = geo.attributes.position;
  const cx = def.x || 0, cz = def.z || 0;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i) + cx, pos.getZ(i) + cz));
  geo.computeVertexNormals();
  const textured = !!def.asset;
  if (!textured) {
    const pal = { ...(PALETTES[def.palette] || PALETTES.meadow), ...(def.colors || {}) };
    const grass = (Array.isArray(pal.grass) ? pal.grass : [pal.grass]).map((c) => new THREE.Color(cssColor(c)));
    const n = noise2((def.seed ?? 7) + 99);
    const amp = def.height ?? 8;
    const water = def.water;
    const c = new THREE.Color(), tmp = new THREE.Color();
    const col = [];
    const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx, y = pos.getY(i), z = pos.getZ(i) + cz;
      const slope = 1 - nrm.getY(i);
      const m = n(x * 0.06, z * 0.06) + 0.5;
      c.copy(grass[0]).lerp(grass[1 % grass.length], Math.max(0, Math.min(1, m)));
      tmp.copy(grass[2 % grass.length]);
      c.lerp(tmp, Math.max(0, n(x * 0.21 + 40, z * 0.21) * 0.8));
      if (water !== undefined && water !== false && y < (water === true ? 0 : water) + 0.6) c.set(cssColor(pal.low));
      if (def.path && distToPath(x, z, def.path) < (def.pathWidth ?? 3)) c.set(cssColor(pal.path));
      if (slope > 0.28) c.lerp(tmp.set(cssColor(pal.rock)), Math.min(1, (slope - 0.28) * 4));
      if (def.snow !== false && amp > 14 && y > amp * 0.78 + n(x * 0.1, z * 0.1) * 3) c.set(cssColor(pal.peak));
      const shade = 0.92 + n(x * 0.5, z * 0.5) * 0.16;
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  const mat = new THREE.MeshStandardMaterial({
    color: textured ? cssColor(def.color, '#ffffff') : '#ffffff',
    vertexColors: !textured,
    roughness: def.roughness ?? 0.95,
    metalness: 0,
    flatShading: def.flat === true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = def.shadow !== false && (def.height ?? 8) > 3;
  const group = new THREE.Group();
  group.add(mesh);
  if (def.water !== undefined && def.water !== false) {
    const lvl = def.water === true ? 0 : def.water;
    const wm = waterMesh({ w: w * 1.6, d: d * 1.6, color: def.waterColor });
    wm.position.y = lvl;
    group.add(wm);
  }
  return { group, mesh, height };
}

/* ---------- Water ---------- */

export function waterMesh(def) {
  const geo = new THREE.PlaneGeometry(def.w ?? 100, def.d ?? def.w ?? 100, 96, 96).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: cssColor(def.color, '#3d7fa6'),
    roughness: 0.08,
    metalness: 0.15,
    transparent: true,
    opacity: def.opacity ?? 0.82,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float wv = sin(position.x * 0.35 + uTime * 1.3) * 0.06 + sin(position.z * 0.27 + uTime * 0.9) * 0.06 + sin((position.x + position.z) * 0.9 + uTime * 2.1) * 0.02;
      transformed.y += wv;`
    ).replace(
      '#include <beginnormal_vertex>',
      `vec3 objectNormal = normalize(vec3(-cos(position.x * 0.35 + uTime * 1.3) * 0.021, 1.0, -cos(position.z * 0.27 + uTime * 0.9) * 0.016));
      #ifdef USE_TANGENT
      vec3 objectTangent = vec3( tangent.xyz );
      #endif`
    );
  };
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.userData.water = true;
  return m;
}

/* ---------- Wind ---------- */

// One shared clock for every swaying material, and where the follow camera looks
// (FOCUS_ON is 0 when it follows nothing), so things in front of the player can dissolve.
export const TIME = { value: 0 };
export const FOCUS = { value: new THREE.Vector3() };
export const FOCUS_ON = { value: 0 };

// Make a scattered material sway (the higher a vertex sits in its model, the more it
// moves) and dissolve when the camera comes close, so trees never fill the screen.
export function addWind(material, strength, top, nearFade = 3) {
  if (!strength && !nearFade) return material;
  const m = material.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME;
    sh.uniforms.uWind = { value: strength || 0 };
    sh.uniforms.uTop = { value: Math.max(0.1, top) };
    sh.uniforms.uNear = { value: nearFade || 0 };
    sh.uniforms.uFocus = FOCUS;
    sh.uniforms.uFocusOn = FOCUS_ON;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uTop;\nvarying vec3 vWorldP;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float hk = clamp(position.y / uTop, 0.0, 1.0);
      hk = hk * hk;
      vec2 seedp = vec2(0.0);
      #ifdef USE_INSTANCING
      seedp = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
      #endif
      float ph = uTime * 1.6 + seedp.x * 0.21 + seedp.y * 0.17;
      transformed.x += (sin(ph) * 0.6 + sin(ph * 2.3) * 0.25) * uWind * hk * 0.12 * uTop;
      transformed.z += (cos(ph * 0.8) * 0.4) * uWind * hk * 0.08 * uTop;`
    ).replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 wp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
      #endif
      vWorldP = (modelMatrix * wp).xyz;`
    );
    sh.fragmentShader = 'uniform float uNear;\nuniform vec3 uFocus;\nuniform float uFocusOn;\nvarying vec3 vWorldP;\n' + sh.fragmentShader.replace(
      'void main() {',
      `void main() {
      if (uNear > 0.0) {
        float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
        vec3 v = vWorldP - cameraPosition;
        float k = clamp((length(v) - uNear * 0.5) / (uNear * 0.5), 0.0, 1.0);
        if (uFocusOn > 0.5) {
          vec3 toF = uFocus - cameraPosition;
          float fl = length(toF);
          vec3 dir = toF / max(fl, 0.001);
          float along = dot(v, dir);
          float side = length(v - dir * along);
          if (along > 0.0 && along < fl - 0.6) k = min(k, clamp((side - 1.3) / 1.2, 0.0, 1.0));
        }
        if (k < dither) discard;
      }`
    );
  };
  m.customProgramCacheKey = () => `scatter${strength}|${nearFade}`;
  return m;
}

/* ---------- Recolouring model parts ---------- */

// recolor: {"leafs": "#4f8a3c"} gives every material whose name contains "leafs" that colour.
export function recolor(material, map) {
  if (!map || !material?.name) return material;
  const name = material.name.toLowerCase();
  const key = Object.keys(map).find((k) => name.includes(k.toLowerCase()));
  if (!key) return material;
  const m = material.clone();
  m.color?.set(cssColor(map[key]));
  return m;
}

/* ---------- Scatter: many copies of models, drawn as instances ---------- */

// Turn a loaded glTF scene into parts (geometry + material + matrix relative to its feet).
export function modelParts(scene) {
  const root = scene.clone(true);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const base = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const parts = [];
  let skinned = false;
  root.traverse((n) => {
    if (n.isSkinnedMesh) skinned = true;
    if (!n.isMesh) return;
    parts.push({ geometry: n.geometry, material: n.material, matrix: base.clone().multiply(n.matrixWorld) });
  });
  const size = box.getSize(new THREE.Vector3());
  return { parts, size, skinned };
}

// Choose where each copy goes. Returns [{model, x, y, z, ry, s}].
export function scatterPlaces(def, models, heightAt, others = []) {
  const r = rng(def.seed ?? def.id ?? 1);
  const count = Math.max(0, Math.min(def.max ?? 20000, def.count ?? 100));
  const cx = def.x || 0, cz = def.z || 0;
  const area = def.area || {};
  const radius = def.r ?? area.r;
  const w = area.w ?? def.w ?? 60, d = area.d ?? def.d ?? area.w ?? def.w ?? 60;
  const spacing = def.spacing ?? 0;
  const avoid = (def.avoid || []).map((a) => ({ x: a.x ?? 0, z: a.z ?? 0, r: a.r ?? 3 }));
  const path = def.avoidPath ? { pts: def.avoidPath, w: def.avoidPathWidth ?? 3 } : null;
  const grid = new Map();
  const cell = Math.max(spacing, 0.5);
  const near = (x, z) => {
    if (!spacing) return false;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const q of grid.get(`${gx + i},${gz + j}`) || []) if (Math.hypot(q[0] - x, q[1] - z) < spacing) return true;
    }
    return false;
  };
  const put = (x, z) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([x, z]);
  };
  const slopeMax = def.slopeMax ?? 35;
  const out = [];
  const weights = models.map((_, i) => (Array.isArray(def.weights) ? def.weights[i] ?? 1 : 1));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const pickModel = () => {
    let t = r() * wsum;
    for (let i = 0; i < weights.length; i++) if ((t -= weights[i]) <= 0) return i;
    return 0;
  };
  // Clumps make forests look natural: copies gather around a few centres.
  const clumps = def.clumps ? Array.from({ length: def.clumps }, () => [cx + (r() - 0.5) * w, cz + (r() - 0.5) * d]) : null;
  for (let tries = 0; out.length < count && tries < count * 30; tries++) {
    let x, z;
    if (clumps && r() < 0.8) {
      const c = clumps[Math.floor(r() * clumps.length)];
      const a = r() * Math.PI * 2, dd = Math.sqrt(r()) * (def.clumpSize ?? Math.min(w, d) * 0.15);
      x = c[0] + Math.cos(a) * dd;
      z = c[1] + Math.sin(a) * dd;
    } else if (radius) {
      const a = r() * Math.PI * 2, dd = Math.sqrt(r()) * radius;
      x = cx + Math.cos(a) * dd;
      z = cz + Math.sin(a) * dd;
    } else {
      x = cx + (r() - 0.5) * w;
      z = cz + (r() - 0.5) * d;
    }
    if (radius ? Math.hypot(x - cx, z - cz) > radius : Math.abs(x - cx) > w / 2 || Math.abs(z - cz) > d / 2) continue;
    if (def.inner && Math.hypot(x - cx, z - cz) < def.inner) continue;
    if (avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r)) continue;
    if (others.some((o) => Math.hypot(x - o.x, z - o.z) < o.r)) continue;
    if (path && distToPath(x, z, path.pts) < path.w) continue;
    const y = heightAt ? heightAt(x, z) : def.y || 0;
    if (y === null) continue;
    if (def.minY !== undefined && y < def.minY) continue;
    if (def.maxY !== undefined && y > def.maxY) continue;
    if (heightAt && slopeMax < 90) {
      const sx = heightAt(x + 0.5, z) - heightAt(x - 0.5, z), sz = heightAt(x, z + 0.5) - heightAt(x, z - 0.5);
      if (Math.atan(Math.hypot(sx, sz)) / D2R > slopeMax) continue;
    }
    if (near(x, z)) continue;
    put(x, z);
    const s = Array.isArray(def.scale) ? def.scale[0] + r() * (def.scale[1] - def.scale[0]) : def.scale ?? 1;
    out.push({ model: pickModel(), x, y: y - (def.sink ?? 0.05), z, ry: def.rotate === false ? (def.ry || 0) * D2R : r() * Math.PI * 2, s, tilt: (r() - 0.5) * (def.tilt ?? 0) * D2R });
  }
  return out;
}

// Build instanced meshes for the placements. modelInfo: [{parts, size}] per model.
export function buildScatter(def, modelInfo, places) {
  const group = new THREE.Group();
  // height (metres, by the model's height) or size (by its largest side); each a number or [min, max].
  const range = (v) => (Array.isArray(v) ? [Number(v[0]) || 1, Number(v[1] ?? v[0]) || 1] : v ? [Number(v) || 1, Number(v) || 1] : null);
  const height = range(def.height) || range(def.size);
  const bySize = !range(def.height) && !!range(def.size);
  const fit = modelInfo.map((m) => (height ? 1 / Math.max(bySize ? Math.max(m.size.x, m.size.y, m.size.z) : m.size.y, 1e-4) : 1));
  const meshes = [];
  const r = rng((def.seed ?? 1) + 5);
  const chunk = def.chunk ?? 40;
  const ox = def.x || 0, oy = def.y || 0, oz = def.z || 0;
  modelInfo.forEach((info, mi) => {
    const mine = places.filter((p) => p.model === mi);
    if (!mine.length) return;
    // Every copy gets its size, turn and colour once; the copies are then split into
    // tiles so the camera and the sun only draw the tiles they can see.
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const mats = [];
    const tint = [];
    const vary = def.tint === false ? 0 : def.vary ?? 0.12;
    const c = new THREE.Color();
    for (const p of mine) {
      const h = height ? height[0] + r() * (height[1] - height[0]) : 1;
      const k = fit[mi] * h * p.s;
      e.set(p.tilt, p.ry, p.tilt * 0.7);
      q.setFromEuler(e);
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x - ox, p.y - oy, p.z - oz), q, new THREE.Vector3(k, k, k)));
      tint.push(vary ? c.setHSL(0, 0, 1 - vary / 2 + r() * vary).clone() : null);
      p.radius = Math.max(info.size.x, info.size.z) * k * (def.solidRadius ?? 0.18);
    }
    const tiles = new Map();
    mine.forEach((p, i) => {
      const key = `${Math.floor(p.x / chunk)},${Math.floor(p.z / chunk)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(i);
    });
    for (const part of info.parts) {
      const top = info.size.y;
      const list = (Array.isArray(part.material) ? part.material : [part.material]).map((m0) => {
        const mm = recolor(m0, def.recolor);
        const w = addWind(mm, def.wind ?? 0, top, def.nearFade ?? 5);
        if (def.color) {
          const x = w === m0 ? m0.clone() : w;
          x.color?.set(cssColor(def.color));
          return x;
        }
        return w;
      });
      const material = list.length === 1 ? list[0] : list;
      for (const idx of tiles.values()) {
        const im = new THREE.InstancedMesh(part.geometry, material, idx.length);
        im.castShadow = def.shadow !== false;
        im.receiveShadow = true;
        idx.forEach((i, j) => {
          im.setMatrixAt(j, m.copy(mats[i]).multiply(part.matrix));
          if (tint[i]) im.setColorAt(j, tint[i]);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.computeBoundingBox?.();
        meshes.push(im);
        group.add(im);
      }
    }
  });
  return { group, meshes };
}

/* ---------- Grass ---------- */

export function buildGrass(def, heightAt) {
  const blades = new THREE.BufferGeometry();
  const bh = def.bladeHeight ?? def.h ?? 0.5;
  // Three-segment tapered blade.
  const verts = [-0.05, 0, 0, 0.05, 0, 0, -0.035, bh * 0.45, 0, 0.035, bh * 0.45, 0, -0.015, bh * 0.8, 0, 0.015, bh * 0.8, 0, 0, bh, 0];
  const idx = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];
  const ys = [0, 0, 0.45, 0.45, 0.8, 0.8, 1];
  blades.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  blades.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(7).fill([0, 1, 0]).flat(), 3));
  blades.setAttribute('tip', new THREE.Float32BufferAttribute(ys, 1));
  blades.setIndex(idx);
  const area = def.area || {};
  const w = area.w ?? def.w ?? 40, d = area.d ?? def.d ?? area.w ?? def.w ?? 40;
  const radius = def.r ?? area.r;
  const surface = radius ? Math.PI * radius * radius : w * d;
  const count = Math.min(def.max ?? 80000, Math.round(surface * (def.density ?? 8)));
  const base = new THREE.Color(cssColor(def.color, '#4f7f2f'));
  const tip = new THREE.Color(cssColor(def.tipColor, '#a8c66a'));
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME;
    sh.uniforms.uBase = { value: base };
    sh.uniforms.uTip = { value: tip };
    sh.uniforms.uWind = { value: def.wind ?? 0.6 };
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nattribute float tip;\nvarying float vTip;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vTip = tip;
      vec2 sp = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
      float ph = uTime * 1.8 + sp.x * 0.35 + sp.y * 0.27;
      float bend = (sin(ph) * 0.7 + sin(ph * 2.7) * 0.3) * uWind * tip * tip;
      transformed.x += bend * 0.25;
      transformed.z += bend * 0.12;`
    );
    sh.fragmentShader = 'uniform vec3 uBase;\nuniform vec3 uTip;\nvarying float vTip;\n' + sh.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.rgb *= mix(uBase, uTip, vTip);`
    );
  };
  const r = rng(def.seed ?? 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const cx = def.x || 0, cz = def.z || 0;
  const avoid = def.avoid || [];
  const chunk = def.chunk ?? 20;
  const tiles = new Map();
  let n = 0;
  for (let t = 0; n < count && t < count * 3; t++) {
    let x, z;
    if (radius) {
      const a = r() * Math.PI * 2, dd = Math.sqrt(r()) * radius;
      x = cx + Math.cos(a) * dd;
      z = cz + Math.sin(a) * dd;
    } else {
      x = cx + (r() - 0.5) * w;
      z = cz + (r() - 0.5) * d;
    }
    if (avoid.some((a) => Math.hypot(x - a.x, z - a.z) < (a.r ?? 3))) continue;
    if (def.avoidPath && distToPath(x, z, def.avoidPath) < (def.avoidPathWidth ?? 2)) continue;
    const y = heightAt ? heightAt(x, z) : def.y || 0;
    if (def.minY !== undefined && y < def.minY) continue;
    if (def.maxY !== undefined && y > def.maxY) continue;
    const s = 0.6 + r() * 0.8;
    q.setFromAxisAngle(up, r() * Math.PI);
    m.compose(new THREE.Vector3(x - cx, y - (def.y || 0), z - cz), q, new THREE.Vector3(s, s * (0.7 + r() * 0.6), s));
    const key = `${Math.floor(x / chunk)},${Math.floor(z / chunk)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(m.clone());
    n++;
  }
  const group = new THREE.Group();
  const meshes = [];
  for (const list of tiles.values()) {
    const im = new THREE.InstancedMesh(blades, mat, list.length);
    im.receiveShadow = true;
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
    meshes.push(im);
  }
  return { group, meshes };
}

/* ---------- Skies and lighting from the sky ---------- */

const SKY_PRESETS = {
  day: { elevation: 50, azimuth: 160, turbidity: 6, rayleigh: 1.2, exposure: 0.55 },
  morning: { elevation: 14, azimuth: 110, turbidity: 8, rayleigh: 2, exposure: 0.5 },
  sunset: { elevation: 3, azimuth: 250, turbidity: 10, rayleigh: 3, exposure: 0.5 },
  dusk: { elevation: -2, azimuth: 250, turbidity: 12, rayleigh: 3.5, exposure: 0.42 },
  overcast: { elevation: 35, azimuth: 160, turbidity: 20, rayleigh: 0.3, exposure: 0.45 },
};

export class Atmosphere {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.hdr = new RGBELoader();
    this.key = null;
  }

  // Returns the sun direction the sky implies (or null) so the sun light can match it.
  async apply(s, bgTexture) {
    const sky = s.sky;
    const key = JSON.stringify([sky, s.background, s.skyBlur]);
    if (key === this.key) return this.sunDir;
    this.key = key;
    this.sunDir = null;
    this.scene.backgroundBlurriness = s.skyBlur ?? 0;
    if (this.skyMesh) {
      this.scene.remove(this.skyMesh);
      this.skyMesh = null;
    }
    if (typeof sky === 'string' && /\.(hdr)$/i.test(sky)) {
      const tex = await new Promise((res) => this.hdr.load(sky, res, undefined, () => res(null)));
      if (tex && key === this.key) {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.background = tex;
        this.setEnv(this.pmrem.fromEquirectangular(tex).texture);
      }
      return null;
    }
    if (sky) {
      const p = { ...(SKY_PRESETS[typeof sky === 'string' ? sky : 'day'] || SKY_PRESETS.day), ...(typeof sky === 'object' ? sky : {}) };
      const mesh = new Sky();
      mesh.scale.setScalar(4000);
      const u = mesh.material.uniforms;
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.8;
      const dir = new THREE.Vector3().setFromSphericalCoords(1, (90 - p.elevation) * D2R, p.azimuth * D2R);
      u.sunPosition.value.copy(dir);
      // Light the scene from a copy of the sky.
      const envScene = new THREE.Scene();
      const copy = new Sky();
      copy.scale.setScalar(100);
      Object.assign(copy.material.uniforms.sunPosition.value, dir);
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) copy.material.uniforms[k].value = u[k].value;
      envScene.add(copy);
      this.setEnv(this.pmrem.fromScene(envScene, 0.04).texture);
      this.scene.background = null;
      this.scene.add(mesh);
      this.skyMesh = mesh;
      this.sunDir = dir;
      this.exposure = p.exposure;
      return dir;
    }
    // A plain colour or gradient background still lights the scene softly.
    const envScene = new THREE.Scene();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: bgTexture || null, color: bgTexture ? '#ffffff' : this.scene.background?.isColor ? this.scene.background : '#8899aa' }));
    envScene.add(ball);
    this.setEnv(this.pmrem.fromScene(envScene, 0.06).texture);
    ball.geometry.dispose();
    ball.material.dispose();
    return null;
  }

  setEnv(tex) {
    this.scene.environment?.dispose?.();
    this.scene.environment = tex;
  }
}

/* ---------- The picture finish ---------- */

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.05 },
    saturation: { value: 1.08 },
    warmth: { value: 0 },
    vignette: { value: 0.25 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation; uniform float warmth; uniform float vignette; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    vec3 col = (c.rgb - 0.5) * contrast + 0.5;
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, saturation);
    col += vec3(warmth * 0.06, warmth * 0.015, -warmth * 0.05);
    vec2 d = vUv - 0.5;
    col *= 1.0 - vignette * smoothstep(0.25, 0.85, length(d) * 1.35);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
  }`,
};

export class Finish {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.enabled = false;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.25, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.on = true;
  }

  apply(post) {
    this.on = post !== false;
    const p = post && typeof post === 'object' ? post : {};
    this.bloom.enabled = (p.bloom ?? 0.25) > 0;
    this.bloom.strength = p.bloom ?? 0.25;
    this.bloom.threshold = p.bloomThreshold ?? 0.85;
    this.bloom.radius = p.bloomRadius ?? 0.5;
    this.ao.enabled = !!p.ao;
    if (p.ao) this.ao.blendIntensity = typeof p.ao === 'number' ? p.ao : 1;
    const u = this.grade.uniforms;
    u.contrast.value = p.contrast ?? 1.05;
    u.saturation.value = p.saturation ?? 1.08;
    u.warmth.value = p.warmth ?? 0;
    u.vignette.value = p.vignette ?? 0.25;
    this.renderer.toneMappingExposure = p.exposure ?? 1;
  }

  setSize(w, h) {
    const r = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(r);
    this.composer.setSize(w, h);
    // Bloom is soft anyway, so it works at half size.
    this.bloom.setSize(Math.round((w * r) / 2), Math.round((h * r) / 2));
    this.ao.setSize?.(w * r, h * r);
  }

  render(dt) {
    if (this.on) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
