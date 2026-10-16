// Games live in ~/Documents/Gamey/<name>, one folder per game. Each holds its own
// copy of the Gamey runtime, so the folder is a complete game that runs anywhere.
const fs = require('fs');
const path = require('path');
const { format } = require('./scene');

const SKIP_DIRS = new Set(['node_modules', 'runtime']);
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md', '.gltf']);
const MAX_FILES = 500;
const RUNTIME_SRC = path.join(__dirname, '..', 'runtime');

class Projects {
  constructor(documentsDir) {
    this.root = path.join(documentsDir, 'Gamey');
    fs.mkdirSync(this.root, { recursive: true });
  }

  list() {
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && fs.existsSync(path.join(this.root, d.name, 'scene.json')))
      .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(this.root, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((p) => ({ name: p.name, mode: this.mode(p.name) }));
  }

  mode(name) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir(name), 'scene.json'), 'utf8')).settings?.mode === '3d' ? '3d' : '2d';
    } catch {
      return '2d';
    }
  }

  dir(name) {
    const dir = path.join(this.root, name);
    if (path.dirname(dir) !== this.root) throw new Error('Bad game name.');
    return dir;
  }

  create(rawName, mode) {
    const name = String(rawName).trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/^\.+|\.+$/g, '').slice(0, 60);
    if (!name) throw new Error('Please give the game a name.');
    const dir = this.dir(name);
    if (fs.existsSync(dir)) throw new Error(`A game called "${name}" already exists.`);
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), indexHtml(name));
    fs.writeFileSync(path.join(dir, 'scene.json'), format(starterScene(mode)));
    this.syncRuntime(name);
    return name;
  }

  // Bring the game's runtime/ folder up to date with this version of Gamey.
  syncRuntime(name) {
    const dest = path.join(this.dir(name), 'runtime');
    copyDir(RUNTIME_SRC, dest);
    const index = path.join(this.dir(name), 'index.html');
    if (!fs.existsSync(index)) fs.writeFileSync(index, indexHtml(name));
  }

  files(name) {
    const base = this.dir(name);
    const out = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= MAX_FILES) return;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push(path.relative(base, full).split(path.sep).join('/'));
      }
    };
    walk(base);
    return out.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }

  resolveFile(name, rel) {
    const base = this.dir(name);
    const full = path.normalize(path.join(base, rel));
    if (!full.startsWith(base + path.sep)) throw new Error('That file is outside the game folder.');
    return full;
  }

  readFile(name, rel) {
    const full = this.resolveFile(name, rel);
    if (!TEXT_EXT.has(path.extname(full).toLowerCase())) return { binary: true };
    return { text: fs.readFileSync(full, 'utf8') };
  }

  writeFile(name, rel, text) {
    fs.writeFileSync(this.resolveFile(name, rel), text, 'utf8');
  }
}

// Read and write file by file: fs.cpSync cannot read from inside the packaged app.asar.
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else {
      const data = fs.readFileSync(s);
      let same = false;
      try {
        same = fs.readFileSync(d).equals(data);
      } catch {}
      if (!same) fs.writeFileSync(d, data);
    }
  }
}

// scene.json first, then scripts, then everything else.
function sortKey(rel) {
  if (rel === 'scene.json') return '0';
  if (rel.startsWith('scripts/')) return '1' + rel;
  if (rel === 'index.html') return '3';
  return (rel.includes('/') ? '4' : '2') + rel.toLowerCase();
}

function starterScene(mode) {
  if (mode === '3d') {
    return {
      settings: { mode: '3d', background: ['#7cc4ff', '#eef4ff'], gravity: 25, camera: { x: 0, y: 9, z: 16, lookAt: { x: 0, y: 0, z: 0 } } },
      objects: [],
    };
  }
  return { settings: { mode: '2d', width: 960, height: 540, background: '#1b2030', gravity: 0 }, objects: [] };
}

function indexHtml(title) {
  const safe = String(title).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>${safe}</title>
  <script type="importmap">{ "imports": { "three": "./runtime/three.module.min.js", "three/addons/": "./runtime/jsm/" } }</script>
  <link rel="stylesheet" href="runtime/gamey.css">
</head>
<body>
  <div id="game"></div>
  <script type="module" src="runtime/gamey.js"></script>
</body>
</html>
`;
}

module.exports = { Projects };
