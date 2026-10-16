// The game's scene.json: its settings and every object in it. Gamey keeps the last
// version it saw, so any change (from Claude's scene tools, from Claude editing the
// file, from an undo) can be turned into a list of steps the preview plays one by one.
const fs = require('fs');
const path = require('path');

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Objects one per line keeps the file easy to read and easy for Claude to edit.
function format(scene) {
  const lines = (scene.objects || []).map((o) => '    ' + JSON.stringify(o));
  return `{\n  "settings": ${JSON.stringify(scene.settings || {}, null, 2).replace(/\n/g, '\n  ')},\n  "objects": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

function parse(text) {
  const scene = JSON.parse(text);
  if (!scene || typeof scene !== 'object') throw new Error('scene.json must hold an object.');
  return {
    settings: scene.settings && typeof scene.settings === 'object' ? scene.settings : {},
    objects: Array.isArray(scene.objects) ? scene.objects.filter((o) => o && typeof o === 'object' && o.id != null).map((o) => ({ ...o, id: String(o.id) })) : [],
  };
}

// The steps that turn scene a into scene b.
function diff(a, b) {
  const ops = [];
  if (!same(a.settings, b.settings)) ops.push({ op: 'settings', settings: b.settings });
  const before = new Map(a.objects.map((o) => [o.id, o]));
  const after = new Set(b.objects.map((o) => o.id));
  for (const o of a.objects) if (!after.has(o.id)) ops.push({ op: 'remove', id: o.id });
  for (const o of b.objects) {
    const old = before.get(o.id);
    if (!old) ops.push({ op: 'add', obj: o });
    else if (!same(old, o)) ops.push({ op: 'update', obj: o });
  }
  return ops;
}

class Scene {
  constructor(dir) {
    this.file = path.join(dir, 'scene.json');
    this.current = this.read() || { settings: {}, objects: [] };
  }

  read() {
    try {
      return parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  // The file changed on disk: return the steps from what we had to what is there now.
  // A file that does not parse (half written, or a typo) is ignored until it does.
  sync() {
    const next = this.read();
    if (!next) return { ops: [], error: this.parseError() };
    const ops = diff(this.current, next);
    this.current = next;
    return { ops };
  }

  parseError() {
    try {
      parse(fs.readFileSync(this.file, 'utf8'));
      return null;
    } catch (err) {
      return `scene.json is not valid JSON: ${err.message}`;
    }
  }

  save(next) {
    const ops = diff(this.current, next);
    this.current = next;
    fs.writeFileSync(this.file, format(next));
    return ops;
  }

  get(id) {
    return this.current.objects.find((o) => o.id === id) || null;
  }

  // Claude's scene tools. Each returns { ops, result }.
  add(objects) {
    if (!Array.isArray(objects) || !objects.length) throw new Error('Give a list of objects to add.');
    const next = clone(this.current);
    const ids = new Set(next.objects.map((o) => o.id));
    const added = [];
    const replaced = [];
    for (const raw of objects) {
      if (!raw || typeof raw !== 'object') continue;
      const o = { ...raw };
      if (o.id == null || o.id === '') {
        const base = String(o.type || 'object');
        let n = 1;
        while (ids.has(`${base}-${n}`)) n++;
        o.id = `${base}-${n}`;
      }
      o.id = String(o.id);
      const i = next.objects.findIndex((x) => x.id === o.id);
      if (i >= 0) {
        next.objects[i] = o;
        replaced.push(o.id);
      } else {
        next.objects.push(o);
        added.push(o.id);
      }
      ids.add(o.id);
    }
    return { ops: this.save(next), result: { added, replaced } };
  }

  update(updates) {
    if (!Array.isArray(updates) || !updates.length) throw new Error('Give a list of updates, each with an id.');
    const next = clone(this.current);
    const done = [];
    const missing = [];
    for (const u of updates) {
      const i = next.objects.findIndex((o) => o.id === String(u?.id));
      if (i < 0) {
        missing.push(u?.id);
        continue;
      }
      const o = { ...next.objects[i] };
      for (const [k, v] of Object.entries(u)) {
        if (k === 'id') continue;
        if (v === null) delete o[k];
        else o[k] = v;
      }
      if (u.newId) {
        o.id = String(u.newId);
        delete o.newId;
      }
      next.objects[i] = o;
      done.push(o.id);
    }
    return { ops: this.save(next), result: { updated: done, notFound: missing } };
  }

  remove(ids) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('Give a list of ids to remove.');
    const want = new Set(ids.map(String));
    const next = clone(this.current);
    const removed = next.objects.filter((o) => want.has(o.id)).map((o) => o.id);
    next.objects = next.objects.filter((o) => !want.has(o.id));
    return { ops: this.save(next), result: { removed, notFound: [...want].filter((id) => !removed.includes(id)) } };
  }

  settings(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('Give the settings to change.');
    const next = clone(this.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next.settings[k];
      else next.settings[k] = v;
    }
    return { ops: this.save(next), result: { settings: next.settings } };
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

module.exports = { Scene, format, parse, diff };
