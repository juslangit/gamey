// Gamey's built-in asset library: free (CC0) art Claude can search and drop into a
// game, so games are built from real models and sprites instead of plain shapes.
// Packs are downloaded once into ~/Documents/Gamey/.library; Poly Haven's realistic
// models, textures and skies are listed from its API and downloaded when used.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const UA = { 'User-Agent': 'Gamey/1.0 (+https://github.com/juslangit)' };

// look: packs with the same look can be mixed in one game; different looks should not be.
const kenney3d = (id, tags) => ({ id, source: 'kenney', mode: '3d', kind: 'model', style: 'stylized', look: 'kenney', tags });
const kenney2d = (id, tags, look = 'kenney-2d') => ({ id, source: 'kenney', mode: '2d', kind: 'sprite', style: 'stylized', look, tags });
const kaykit = (repo, tags) => ({ id: repo.toLowerCase().replace(/-1\.0$/, ''), repo: `KayKit-Game-Assets/${repo}`, source: 'kaykit', mode: '3d', kind: 'model', style: 'stylized', look: 'kaykit', tags });

const PACKS = [
  kenney3d('nature-kit', 'nature forest tree trees woods plant rock stone grass flower mushroom log stump cliff river water path camp tent'),
  kenney3d('platformer-kit', 'platformer platform block coin jump spring flag level'),
  kenney3d('fantasy-town-kit', 'town village medieval house roof wall fence market stall cart fantasy'),
  kenney3d('castle-kit', 'castle medieval tower wall gate siege flag'),
  kenney3d('survival-kit', 'survival camp tools crate barrel campfire tent'),
  kenney3d('pirate-kit', 'pirate ship sea island treasure chest cannon palm beach boat'),
  kenney3d('graveyard-kit', 'graveyard halloween spooky grave tombstone crypt fence pumpkin'),
  kenney3d('space-kit', 'space sci-fi rocket planet alien base astronaut satellite'),
  kenney3d('car-kit', 'car vehicle truck taxi police racing road'),
  kenney3d('racing-kit', 'racing race track road car kart'),
  kenney3d('train-kit', 'train railway track station locomotive'),
  kenney3d('watercraft-kit', 'boat ship water sea'),
  kenney3d('city-kit-suburban', 'city suburban house street town'),
  kenney3d('city-kit-commercial', 'city building skyscraper shop office street'),
  kenney3d('food-kit', 'food fruit vegetable kitchen meal'),
  kenney3d('furniture-kit', 'furniture room interior house chair table bed'),
  kenney3d('holiday-kit', 'holiday christmas winter snow present'),
  kenney3d('tower-defense-kit', 'tower defense turret enemy path tile'),
  kenney3d('mini-dungeon', 'dungeon wall floor torch chest'),
  kenney3d('mini-characters', 'character person people player npc animated'),
  kenney3d('blocky-characters', 'character person people player npc blocky'),
  kenney3d('cube-pets', 'pet animal cute cube dog cat'),
  kaykit('KayKit-Character-Pack-Adventures-1.0', 'character hero knight mage rogue barbarian adventurer weapon sword shield animated'),
  kaykit('KayKit-Character-Pack-Skeletons-1.0', 'skeleton enemy undead warrior mage animated'),
  kaykit('KayKit-Dungeon-Remastered-1.0', 'dungeon wall floor door chest torch barrel stairs pillar'),
  kaykit('KayKit-Medieval-Hexagon-Pack-1.0', 'hexagon hex tile medieval building strategy terrain tree mountain water'),
  kaykit('KayKit-City-Builder-Bits-1.0', 'city building road car tree'),
  kaykit('KayKit-Halloween-Bits-1.0', 'halloween spooky graveyard pumpkin'),
  kaykit('KayKit-Furniture-Bits-1.0', 'furniture interior room'),
  kaykit('KayKit-Restaurant-Bits-1.0', 'restaurant kitchen food cooking'),
  kaykit('KayKit-Space-Base-Bits-1.0', 'space base sci-fi module'),
  kaykit('KayKit-Prototype-Bits-1.0', 'prototype block ramp target'),
  kenney2d('new-platformer-pack', 'platformer tile character enemy background'),
  kenney2d('pixel-platformer', 'pixel platformer tile character', 'kenney-pixel'),
  kenney2d('platformer-art-deluxe', 'platformer tile character enemy item'),
  kenney2d('abstract-platformer', 'platformer abstract tile'),
  kenney2d('jumper-pack', 'jumper platform character enemy'),
  kenney2d('platformer-characters', 'character player animated'),
  kenney2d('toon-characters', 'character player zombie robot pose animated'),
  kenney2d('space-shooter-remastered', 'space shooter ship laser meteor enemy'),
  kenney2d('background-elements-remastered', 'background cloud tree hill mountain sky'),
  kenney2d('foliage-pack', 'tree bush foliage plant forest'),
  kenney2d('animal-pack-remastered', 'animal cute'),
  kenney2d('fish-pack', 'fish underwater sea ocean'),
  kenney2d('racing-pack', 'racing car top-down road'),
  kenney2d('top-down-shooter', 'top-down shooter character tile weapon'),
  kenney2d('tiny-town', 'pixel town rpg tile', 'kenney-pixel'),
  kenney2d('tiny-dungeon', 'pixel dungeon rpg tile', 'kenney-pixel'),
  kenney2d('medieval-rts', 'medieval rts strategy unit building'),
  kenney2d('ui-pack', 'ui button panel icon'),
  kenney2d('particle-pack', 'particle effect fire smoke spark magic'),
  kenney2d('sports-pack', 'sports ball'),
  kenney2d('shooting-gallery', 'shooting gallery target duck'),
  kenney2d('alien-ufo-pack', 'alien ufo space'),
];

// Words a search should treat as the same thing.
const SYNONYMS = {
  forest: ['tree', 'pine', 'woods'], woods: ['tree'], tree: ['pine', 'oak', 'birch', 'palm'],
  rock: ['stone', 'boulder', 'cliff'], stone: ['rock'], house: ['building', 'home', 'cottage'],
  building: ['house'], hero: ['character', 'player', 'knight'], player: ['character'],
  person: ['character'], enemy: ['skeleton', 'monster', 'zombie'], monster: ['enemy'],
  coin: ['gold'], gem: ['crystal', 'jewel'], crystal: ['gem'], bush: ['shrub', 'plant'],
  flower: ['plant'], grass: ['plant'], water: ['river', 'lake', 'sea'], sky: ['hdri', 'skybox'],
  ground: ['floor', 'terrain', 'grass', 'dirt'], floor: ['ground', 'tile'], car: ['vehicle'],
  boat: ['ship'], ship: ['boat', 'spaceship'], spaceship: ['ship'], castle: ['tower'],
};

const SKIP_2D = /(^|\/)(double|retina|spritesheets?|tilesheets?|tilemap|vector|svg|preview|sample|@2x)(\/|$|[ ._-])/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;

class Library {
  constructor(root) {
    this.root = root;
    this.packsDir = path.join(root, 'packs');
    this.catalogFile = path.join(root, 'catalog.json');
    this.items = [];
    this.byId = new Map();
    this.building = null;
    this.load();
  }

  load() {
    try {
      const c = JSON.parse(fs.readFileSync(this.catalogFile, 'utf8'));
      this.items = c.items || [];
      this.polyhavenAt = c.polyhavenAt || 0;
    } catch {
      this.items = [];
    }
    this.byId = new Map(this.items.map((i) => [i.id, i]));
  }

  save() {
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.catalogFile, JSON.stringify({ version: 1, polyhavenAt: this.polyhavenAt || 0, items: this.items }));
  }

  get ready() {
    return this.items.length > 0;
  }

  summary() {
    const n = (f) => this.items.filter(f).length;
    return {
      models: n((i) => i.kind === 'model' && i.source !== 'polyhaven'),
      sprites: n((i) => i.kind === 'sprite'),
      realistic: n((i) => i.source === 'polyhaven'),
      packs: new Set(this.items.map((i) => i.pack)).size,
    };
  }

  /* ---------- Building the library ---------- */

  // Download missing packs, list every item, measure models (measure(items) is given by
  // the app, which renders thumbnails in a hidden window) and fetch Poly Haven's list.
  build({ progress = () => {}, measure = null } = {}) {
    if (!this.building) {
      this.building = this.buildNow(progress, measure).finally(() => {
        this.building = null;
      });
    }
    return this.building;
  }

  async buildNow(progress, measure) {
    fs.mkdirSync(this.packsDir, { recursive: true });
    const failed = [];
    for (let i = 0; i < PACKS.length; i++) {
      const pack = PACKS[i];
      if (fs.existsSync(path.join(this.packsDir, pack.id, '.done'))) continue;
      progress({ step: 'download', text: `Downloading ${packName(pack)} (${i + 1}/${PACKS.length})`, done: i, total: PACKS.length });
      try {
        await this.install(pack);
      } catch (err) {
        failed.push(`${pack.id}: ${err.message}`);
      }
    }
    progress({ step: 'index', text: 'Listing the library' });
    const old = this.byId;
    const items = [];
    for (const pack of PACKS) {
      const dir = path.join(this.packsDir, pack.id);
      if (!fs.existsSync(path.join(dir, '.done'))) continue;
      for (const item of indexPack(pack, dir, old)) {
        const prev = old.get(item.id);
        if (prev?.meta) item.meta = prev.meta;
        if (prev?.thumb) item.thumb = prev.thumb;
        if (!item.thumb && item.kind === 'model') {
          const rel = `${item.pack}/${item.file.replace(/\.(glb|gltf)$/i, '')}.png`;
          if (fs.existsSync(path.join(this.root, 'thumbs', rel))) item.thumb = rel;
        }
        items.push(item);
      }
    }
    if (Date.now() - (this.polyhavenAt || 0) > 7 * 864e5 || !this.items.some((i) => i.source === "polyhaven" && i.kind === "model" && "polycount" in i && !(i.polycount > 1e6))) {
      progress({ step: 'polyhaven', text: 'Listing Poly Haven' });
      try {
        items.push(...(await polyhavenItems()));
        this.polyhavenAt = Date.now();
      } catch (err) {
        failed.push(`polyhaven: ${err.message}`);
        items.push(...this.items.filter((i) => i.source === 'polyhaven'));
      }
    } else {
      items.push(...this.items.filter((i) => i.source === 'polyhaven'));
    }
    this.items = items;
    this.byId = new Map(items.map((i) => [i.id, i]));
    this.save();
    if (measure) {
      const todo = items.filter((i) => i.kind === 'model' && i.source !== 'polyhaven' && (!i.meta || !i.thumb));
      for (let k = 0; k < todo.length; k += 40) {
        progress({ step: 'thumbs', text: `Drawing thumbnails (${k}/${todo.length})`, done: k, total: todo.length });
        const batch = todo.slice(k, k + 40);
        const metas = await measure(batch).catch(() => []);
        batch.forEach((item, j) => {
          if (metas[j]) item.meta = metas[j];
        });
        this.save();
      }
    }
    progress({ step: 'done', text: 'Library ready', failed });
    return { failed, summary: this.summary() };
  }

  async install(pack) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gamey-pack-'));
    try {
      const archive = path.join(tmp, pack.source === 'kaykit' ? 'pack.tar.gz' : 'pack.zip');
      const url = pack.source === 'kaykit' ? `https://codeload.github.com/${pack.repo}/tar.gz/refs/heads/main` : await kenneyZip(pack.id);
      await download(url, archive);
      const out = path.join(tmp, 'x');
      fs.mkdirSync(out);
      await run('tar', ['-xf', archive, '-C', out]);
      const dest = path.join(this.packsDir, pack.id);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      const files = walk(out);
      let kept = 0;
      if (pack.mode === '3d') {
        // Keep the model folders whole (one format only), so the textures and buffers
        // the models point at stay beside them.
        const models = files.filter((f) => /\.(glb|gltf)$/i.test(f));
        const glb = models.filter((f) => /(^|\/)glb format\//i.test(f));
        const gltf = models.filter((f) => /(^|\/)gltf( format)?\//i.test(f));
        const chosen = glb.length ? glb : gltf.length ? gltf : models;
        if (!chosen.length) throw new Error('no glb or gltf models in the pack');
        const dirs = [...new Set(chosen.map((f) => path.posix.dirname(f)))];
        const common = dirs.reduce((a, d) => {
          const x = a.split('/'), y = d.split('/');
          let i = 0;
          while (i < x.length && x[i] === y[i]) i++;
          return x.slice(0, i).join('/');
        });
        const other = /(^|\/)(fbx|obj|blend|dae|fbx format|obj format|dae format|godot|unity)(\/|$)/i;
        for (const f of files) {
          if (common && !f.startsWith(common + '/')) continue;
          if (!/\.(glb|gltf|bin|png|jpe?g)$/i.test(f) || other.test(f)) continue;
          if (/\.(glb|gltf)$/i.test(f) && !chosen.includes(f)) continue;
          copy(path.join(out, f), path.join(dest, common ? f.slice(common.length + 1) : f));
          kept++;
        }
      } else {
        for (const f of files) {
          if (!IMAGE.test(f) || SKIP_2D.test(f) || !f.includes('/')) continue;
          copy(path.join(out, f), path.join(dest, f));
          kept++;
        }
      }
      if (!kept) throw new Error('nothing usable in the pack');
      fs.writeFileSync(path.join(dest, '.done'), new Date().toISOString());
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /* ---------- Searching ---------- */

  search({ query = '', mode, kind, style, pack, limit = 16 } = {}) {
    const words = tokens(query);
    const want = new Set(words);
    for (const w of words) for (const s of SYNONYMS[w] || []) want.add(s);
    const out = [];
    for (const item of this.items) {
      if (mode && item.mode !== mode && !(mode === '3d' && (item.kind === 'texture' || item.kind === 'hdri'))) continue;
      if (kind && item.kind !== kind) continue;
      if (style && item.style !== style) continue;
      if (pack && item.pack !== pack) continue;
      let score = 0;
      const name = item.words;
      for (const w of want) {
        const strong = words.includes(w) ? 1 : 0.5;
        if (name.includes(w)) score += 4 * strong;
        else if (name.some((n) => n.startsWith(w) || (w.length > 3 && n.includes(w)))) score += 2.5 * strong;
        else if (item.tags.includes(w)) score += 1.5 * strong;
        else if (item.packTags.includes(w)) score += 0.6 * strong;
      }
      if (!words.length) score = 1;
      if (score <= 0) continue;
      // Ties go to the shorter, plainer name ("tree_pine" before "tree_pine_dark_snow_fallen").
      score -= name.length * 0.01;
      out.push({ item, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, Math.max(1, Math.min(40, limit))).map((r) => r.item);
  }

  describe(item) {
    const bits = [`${item.id}`, item.kind, item.style, `look:${item.look}`];
    const m = item.meta;
    if (m?.size) bits.push(`size ${m.size.map((v) => +v.toFixed(2)).join('x')} m (w x h x d)`);
    if (item.size2d) bits.push(`${item.size2d[0]}x${item.size2d[1]} px`);
    if (m?.animations?.length) bits.push(`animations: ${m.animations.slice(0, 14).join(', ')}${m.animations.length > 14 ? '…' : ''}`);
    if (item.dims) bits.push(`real size ~${item.dims.map((v) => +v.toFixed(2)).join('x')} m (w x h x d)`);
    const tris = item.polycount || m?.tris;
    if (tris) bits.push(tris > 20000 ? `HEAVY ${Math.round(tris / 1000)}k triangles: place a few as models, never scatter` : `${tris} triangles`);
    return bits.join(' | ');
  }

  thumbUrl(item, base) {
    if (item.thumb?.startsWith('http')) return item.thumb;
    if (item.thumb) return `${base}__gamey/lib/thumbs/${item.thumb}`;
    if (item.kind === 'sprite') return `${base}__gamey/lib/packs/${item.pack}/${item.file}`;
    return null;
  }

  /* ---------- Using items in a game ---------- */

  // Copy (or for Poly Haven, download) items into <game>/assets/lib/ and say how to use them.
  async use(ids, gameDir, { resolution = '1k' } = {}) {
    const lines = [];
    for (const id of ids) {
      const item = this.byId.get(id);
      if (!item) {
        lines.push(`${id}: not in the library (search again and copy the id exactly).`);
        continue;
      }
      try {
        if (item.source === 'polyhaven') lines.push(await this.usePolyhaven(item, gameDir, resolution));
        else lines.push(this.useLocal(item, gameDir));
      } catch (err) {
        lines.push(`${id}: could not be added (${err.message}).`);
      }
    }
    return lines.join('\n');
  }

  useLocal(item, gameDir) {
    const src = path.join(this.packsDir, item.pack);
    const files = [item.file, ...(item.deps || [])];
    for (const f of files) {
      const to = path.join(gameDir, 'assets', 'lib', item.pack, f);
      if (!fs.existsSync(to)) copy(path.join(src, f), to);
    }
    const asset = `assets/lib/${item.pack}/${item.file}`;
    if (item.kind === 'model') {
      const s = item.meta?.size;
      const hint = s ? ` Natural size ${s.map((v) => +v.toFixed(2)).join(' x ')} m (w x h x d); "size" fits the largest side.` : '';
      const anim = item.meta?.animations?.length ? ` Animations: ${item.meta.animations.join(', ')}.` : '';
      const mats = item.materials?.length ? ` Materials (for "recolor"): ${item.materials.join(', ')}.` : '';
      return `${item.id} → {"type":"model","asset":"${asset}"}.${hint}${anim}${mats}`;
    }
    const px = item.size2d ? ` ${item.size2d[0]}x${item.size2d[1]} px.` : '';
    return `${item.id} → {"type":"sprite","asset":"${asset}"}.${px}`;
  }

  async usePolyhaven(item, gameDir, resolution) {
    const slug = item.id.split('/')[1];
    const res = await fetch(`https://api.polyhaven.com/files/${slug}`, { headers: UA });
    if (!res.ok) throw new Error(`Poly Haven answered HTTP ${res.status}`);
    const files = await res.json();
    const base = path.join(gameDir, 'assets', 'lib', 'polyhaven', slug);
    const rel = (f) => `assets/lib/polyhaven/${slug}/${f}`;
    const pickRes = (byRes) => byRes[resolution] || byRes['1k'] || byRes['2k'] || Object.values(byRes)[0];
    if (item.kind === 'hdri') {
      const f = pickRes(files.hdri)?.hdr;
      if (!f) throw new Error('no .hdr file');
      const name = path.basename(new URL(f.url).pathname);
      await download(f.url, path.join(base, name));
      return `${item.id} → scene setting "sky": "${rel(name)}" (lights the whole scene and shows as the sky).`;
    }
    if (item.kind === 'model') {
      const g = pickRes(files.gltf)?.gltf;
      if (!g) throw new Error('no glTF version');
      const main = path.basename(new URL(g.url).pathname);
      await download(g.url, path.join(base, main));
      for (const [p, f] of Object.entries(g.include || {})) await download(f.url, path.join(base, p));
      const dim = item.dims ? ` Real size about ${item.dims.map((v) => +v.toFixed(2)).join(' x ')} m; keep it (no "size") so it matches other Poly Haven models.` : '';
      return `${item.id} → {"type":"model","asset":"${rel(main)}"}.${dim}`;
    }
    // A texture set: colour, normal and roughness maps for a shape or terrain.
    const maps = { asset: 'Diffuse', normalMap: 'nor_gl', roughnessMap: 'Rough' };
    const out = {};
    for (const [key, name] of Object.entries(maps)) {
      const byRes = files[name];
      const f = byRes && (pickRes(byRes).jpg || pickRes(byRes).png);
      if (!f) continue;
      const file = path.basename(new URL(f.url).pathname);
      await download(f.url, path.join(base, file));
      out[key] = rel(file);
    }
    if (!out.asset) throw new Error('no colour map');
    return `${item.id} → texture fields ${JSON.stringify(out)} with "repeat" (e.g. 8) on a plane, box or terrain.`;
  }
}

/* ---------- Indexing ---------- */

function indexPack(pack, dir, old = new Map()) {
  const files = walk(dir);
  const items = [];
  const packTags = pack.tags.split(' ');
  if (pack.mode === '3d') {
    for (const f of files) {
      if (!/\.(glb|gltf)$/i.test(f)) continue;
      const base = f.replace(/(\.gltf)?\.(glb|gltf)$/i, '');
      const words = tokens(base);
      items.push({
        id: `${pack.id}/${base}`,
        pack: pack.id,
        source: pack.source,
        mode: '3d',
        kind: 'model',
        style: pack.style,
        look: pack.look,
        file: f,
        ...modelInfo(path.join(dir, f), dir),
        words,
        tags: [],
        packTags,
      });
    }
  } else {
    for (const f of files) {
      if (!IMAGE.test(f)) continue;
      const base = f.replace(IMAGE, '');
      const words = tokens(base.split('/').slice(-2).join(' '));
      const folder = tokens(path.dirname(f));
      let size2d = old.get(`${pack.id}/${base}`)?.size2d || null;
      if (!size2d) try {
        const { nativeImage } = require('electron');
        const s = nativeImage.createFromPath(path.join(dir, f)).getSize();
        if (s.width) size2d = [s.width, s.height];
      } catch {}
      items.push({
        id: `${pack.id}/${base}`,
        pack: pack.id,
        source: pack.source,
        mode: '2d',
        kind: 'sprite',
        style: pack.style,
        look: pack.look,
        file: f,
        words,
        tags: folder,
        packTags,
        size2d,
      });
    }
  }
  return items;
}

// Files a model needs beside itself (a .gltf's buffers and pictures, a .glb's outside
// pictures) and the names of its materials, which "recolor" can change.
function modelInfo(full, dir) {
  const json = gltfJson(full);
  if (!json) return { deps: [], materials: [] };
  const uris = [...(json.buffers || []), ...(json.images || [])].map((b) => b.uri).filter((u) => u && !u.startsWith('data:'));
  const deps = uris
    .map((u) => path.relative(dir, path.join(path.dirname(full), decodeURIComponent(u))).split(path.sep).join('/'))
    .filter((r) => !r.startsWith('..') && fs.existsSync(path.join(dir, r)));
  const materials = [...new Set((json.materials || []).map((m) => m.name).filter((n) => n && !/^_?default/i.test(n)))];
  return { deps, materials };
}

function gltfJson(full) {
  try {
    let json;
    if (/\.gltf$/i.test(full)) json = JSON.parse(fs.readFileSync(full, 'utf8'));
    else {
      const buf = fs.readFileSync(full);
      const len = buf.readUInt32LE(12);
      json = JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
    }
    return json;
  } catch {
    return null;
  }
}

async function polyhavenItems() {
  const items = [];
  const kinds = { models: 'model', textures: 'texture', hdris: 'hdri' };
  for (const [t, kind] of Object.entries(kinds)) {
    const res = await fetch(`https://api.polyhaven.com/assets?t=${t}`, { headers: UA });
    if (!res.ok) throw new Error(`Poly Haven answered HTTP ${res.status}`);
    const all = await res.json();
    for (const [slug, a] of Object.entries(all)) {
      // Film-quality scans (millions of triangles) would freeze a browser game.
      if (kind === 'model' && a.polycount > 1e6) continue;
      items.push({
        id: `polyhaven/${slug}`,
        pack: `polyhaven-${t}`,
        source: 'polyhaven',
        mode: '3d',
        kind,
        style: 'realistic',
        look: 'polyhaven',
        words: tokens(`${a.name} ${slug}`),
        tags: [...(a.tags || []), ...(a.categories || [])].flatMap((x) => tokens(x)),
        packTags: [t, 'realistic', 'photo', 'scan'],
        thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?width=256&height=256`,
        // Poly Haven gives width, depth, height in millimetres (Blender is z-up).
        dims: a.dimensions ? [a.dimensions[0], a.dimensions[2], a.dimensions[1]].map((v) => v / 1000) : null,
        polycount: a.polycount || null,
      });
    }
  }
  return items;
}

/* ---------- Small helpers ---------- */

function tokens(s) {
  return String(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !['format', 'gltf', 'glb', 'png', 'default', 'assets', 'addons', 'models'].includes(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

function packName(pack) {
  return pack.id.replace(/-/g, ' ');
}

async function kenneyZip(slug) {
  const res = await fetch(`https://kenney.nl/assets/${slug}`, { headers: UA });
  if (!res.ok) throw new Error(`kenney.nl answered HTTP ${res.status}`);
  const m = (await res.text()).match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"' ]+\.zip/);
  if (!m) throw new Error('no download link on the page');
  return m[0];
}

async function download(url, to) {
  if (fs.existsSync(to)) return;
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to + '.part', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(to + '.part', to);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1 << 24 }, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
  });
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

module.exports = { Library, PACKS, tokens };
