// Version history for a game: a copy of the files is taken before each Claude
// turn, so any change can be undone. Copies live in <game>/.gamey/history/<id>/.
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', 'runtime']);
const MAX_VERSIONS = 30;

class History {
  constructor(siteDir) {
    this.siteDir = siteDir;
    this.root = path.join(siteDir, '.gamey', 'history');
    this.indexFile = path.join(this.root, 'index.json');
  }

  list() {
    try {
      return JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      return [];
    }
  }

  saveList(list) {
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.indexFile, JSON.stringify(list, null, 1));
  }

  // The game's files as { relPath: fullPath }, skipping dot folders.
  files(dir) {
    const out = {};
    const walk = (d) => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else out[path.relative(dir, full)] = full;
      }
    };
    walk(dir);
    return out;
  }

  // A cheap fingerprint of the files (names, sizes and change times).
  fingerprint() {
    return Object.entries(this.files(this.siteDir))
      .map(([rel, full]) => {
        const st = fs.statSync(full);
        return `${rel}:${st.size}:${st.mtimeMs}`;
      })
      .sort()
      .join('|');
  }

  // Copy the current files into a new version and return it. kind is 'change'
  // (taken before Claude changed something) or 'restore' (taken before going back).
  snapshot(label, kind = 'change') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let id = stamp;
    for (let i = 2; fs.existsSync(path.join(this.root, id)); i++) id = `${stamp}-${i}`;
    const dest = path.join(this.root, id);
    for (const [rel, full] of Object.entries(this.files(this.siteDir))) {
      fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      fs.copyFileSync(full, path.join(dest, rel));
    }
    const version = { id, time: Date.now(), label: String(label || '').slice(0, 120), kind };
    const list = [version, ...this.list()];
    for (const old of list.splice(MAX_VERSIONS)) this.removeDir(old.id);
    this.saveList(list);
    return version;
  }

  drop(id) {
    this.removeDir(id);
    this.saveList(this.list().filter((v) => v.id !== id));
  }

  removeDir(id) {
    fs.rmSync(path.join(this.root, id), { recursive: true, force: true });
  }

  // Undo: go back to the newest 'change' version and remove it from the list, so
  // pressing Undo again steps further back. The undone state is kept as a
  // 'restore' version, so an undo can itself be undone from the history list.
  undo() {
    const version = this.list().find((v) => v.kind !== 'restore');
    if (!version) throw new Error('There is nothing to undo.');
    this.restore(version.id, `Undone change: ${version.label}`);
    this.drop(version.id);
    return version;
  }

  // Put the game back exactly as it was in version `id`. The current files are
  // saved as a new version first, so a restore can itself be undone.
  restore(id, safetyLabel = 'Before going back to an earlier version') {
    const version = this.list().find((v) => v.id === id);
    if (!version) throw new Error('That version no longer exists.');
    const src = path.join(this.root, id);
    const wanted = this.files(src);
    this.snapshot(safetyLabel, 'restore');

    for (const [rel, full] of Object.entries(this.files(this.siteDir))) {
      if (!wanted[rel]) fs.rmSync(full, { force: true });
    }
    for (const [rel, full] of Object.entries(wanted)) {
      const target = path.join(this.siteDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(full, target);
    }
    this.removeEmptyDirs(this.siteDir);
    return version;
  }

  removeEmptyDirs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      this.removeEmptyDirs(full);
      if (!fs.readdirSync(full).length) fs.rmdirSync(full);
    }
  }
}

module.exports = { History };
