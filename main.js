const { app, BrowserWindow, ipcMain, shell, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const publish = require('./src/publish');
const { ClaudeSession } = require('./src/claude');
const { PreviewServer } = require('./src/server');
const { Projects } = require('./src/projects');
const { History } = require('./src/history');
const { Scene, format } = require('./src/scene');
const { IDEAS } = require('./src/templates');
const log = require('./src/log');

let win = null;
let projects = null;
let server = null;
let current = null; // { name, dir, scene, session, history, watcher, turn, notes, errors }
let previewRect = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const configFile = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}
function saveConfig(patch) {
  fs.writeFileSync(configFile(), JSON.stringify({ ...loadConfig(), ...patch }, null, 2));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1040,
    minHeight: 640,
    title: 'Gamey',
    backgroundColor: '#0f1117',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') log.warn('Page:', e.message);
  });
  win.webContents.on('render-process-gone', (_e, d) => log.error('Page crashed:', d.reason));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ---------- Games ---------- */

function closeProject() {
  if (!current) return;
  current.session.stop();
  current.session.removeAllListeners();
  if (current.watcher) current.watcher.close();
  current = null;
}

// How Claude Code starts Gamey's MCP server: Gamey's own Electron binary running
// as plain Node. In the packaged app the script is unpacked from app.asar.
function mcpServerConfig() {
  const script = path.join(__dirname, 'src', 'mcp-server.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return {
    command: process.execPath,
    args: [script],
    env: { ELECTRON_RUN_AS_NODE: '1', GAMEY_PORT: String(server.port), GAMEY_KEY: server.key },
  };
}

function gameFacts(p) {
  const s = p.scene.current.settings;
  const files = projects.files(p.name);
  const scripts = files.filter((f) => f.startsWith('scripts/'));
  const assets = files.filter((f) => f.startsWith('assets/'));
  const lines = [
    `- Name: ${p.name}`,
    `- Mode: ${s.mode === '3d' ? '3D (Three.js)' : `2D (Phaser), ${s.width || 960}x${s.height || 540}`}`,
    `- Objects in the scene: ${p.scene.current.objects.length}`,
    `- Scripts: ${scripts.length ? scripts.join(', ') : 'none yet'}`,
    `- Assets: ${assets.length ? assets.slice(0, 40).join(', ') + (assets.length > 40 ? ` (+${assets.length - 40} more)` : '') : 'none yet'}`,
  ];
  const pub = loadPublishInfo(p);
  if (pub) lines.push(`- Published on itch.io at ${pub.url}`);
  return lines.join('\n');
}

function openProject(name) {
  closeProject();
  const dir = projects.dir(name);
  if (!fs.existsSync(dir)) throw new Error(`The game "${name}" no longer exists.`);
  projects.syncRuntime(name);
  const p = { name, dir, scene: new Scene(dir), history: new History(dir), watcher: null, turn: null, notes: [], errors: [] };
  p.session = new ClaudeSession(dir, { mcp: mcpServerConfig(), gameFacts: () => gameFacts(p) });
  p.session.on('event', (ev) => {
    if (ev.type === 'error') log.error('Claude:', ev.message);
    send('chat:event', ev);
    if (ev.type === 'busy' && ev.busy) p.errors = [];
    if (ev.type === 'busy' && !ev.busy) finishTurn(p);
  });
  p.session.on('usage', (usage) => {
    saveConfig({ usage });
    send('usage', usage);
  });
  watch(p);
  current = p;
  server.setRoot(dir);
  saveConfig({ lastProject: name });
  return {
    name,
    url: server.url,
    mode: p.scene.current.settings.mode === '3d' ? '3d' : '2d',
    files: projects.files(name),
    objects: p.scene.current.objects,
    publish: loadPublishInfo(p),
  };
}

// Every change in the game folder becomes a live step for the preview: scene.json
// is compared with what we had, scripts are swapped in, new pictures are reloaded.
function watch(p) {
  const timers = new Map();
  let filesTimer = null;
  try {
    p.watcher = fs.watch(p.dir, { recursive: true }, (_type, file) => {
      if (!file) return;
      const rel = file.split(path.sep).join('/');
      if (rel.split('/').some((part) => part.startsWith('.')) || rel.startsWith('node_modules/') || rel.startsWith('runtime/')) return;
      clearTimeout(timers.get(rel));
      timers.set(rel, setTimeout(() => {
        timers.delete(rel);
        if (current !== p) return;
        onFileChanged(p, rel);
      }, 120));
      clearTimeout(filesTimer);
      filesTimer = setTimeout(() => current === p && send('files:changed', { files: projects.files(p.name) }), 250);
    });
  } catch (err) {
    log.error('Watch failed:', err);
  }
}

function onFileChanged(p, rel) {
  const full = path.join(p.dir, rel);
  const exists = fs.existsSync(full);
  if (rel === 'scene.json') {
    const { ops, error } = p.scene.sync();
    if (error) send('game:log', { level: 'warn', text: error });
    pushOps(ops);
  } else if (/^scripts\/[\w-]+\.js$/.test(rel)) {
    pushOps([{ op: 'script', name: rel.slice(8, -3), removed: !exists }]);
  } else if (rel.startsWith('assets/')) {
    if (exists && fs.statSync(full).isFile()) pushOps([{ op: 'asset', path: rel }]);
    else if (!exists) send('scene:ops', [{ op: 'asset', path: rel, removed: true }]);
  } else if (rel === 'index.html') {
    pushOps([{ op: 'reload' }]);
  }
}

function pushOps(ops) {
  if (!ops || !ops.length) return;
  server.broadcast(ops.filter((o) => !o.removed || o.op !== 'script'));
  send('scene:ops', ops);
}

function requireProject() {
  if (!current) throw new Error('Open a game first.');
  return current;
}

/* ---------- Chat ---------- */

const chatFile = (p) => path.join(p.dir, '.gamey', 'chat.json');
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

// Attached images are saved in <game>/assets/references so Claude can also use them.
function saveReferences(dir, images) {
  const refDir = path.join(dir, 'assets', 'references');
  if (images.length) fs.mkdirSync(refDir, { recursive: true });
  return images.map((img) => {
    const ext = IMAGE_EXT[img.mediaType];
    if (!ext) throw new Error(`${img.name} is not a supported image (use PNG, JPG, GIF or WebP).`);
    const base = path.parse(img.name).name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
    let name = base + ext;
    for (let i = 2; fs.existsSync(path.join(refDir, name)); i++) name = `${base}-${i}${ext}`;
    fs.writeFileSync(path.join(refDir, name), Buffer.from(img.data, 'base64'));
    return `assets/references/${name}`;
  });
}

function sendChat(p, { text = '', images = [], picked = null }) {
  if (p.session.busy) throw new Error('Claude is still working on the last message.');
  const saved = saveReferences(p.dir, images);
  let message = text.trim() || (picked ? 'Change this object.' : 'Use these pictures for the game.');
  if (picked) {
    message += `\n\nThe user pointed at the object "${picked.id}" in the preview${picked.spawned ? ' (it was spawned by a script while playing, so it is not in scene.json; change the script that spawns it)' : ''}. Its data:\n${JSON.stringify(picked.def)}`;
  }
  if (saved.length) message += `\n\nPictures attached (also saved in the game folder as ${saved.join(', ')}).`;
  if (p.notes.length) {
    message = `(Note from Gamey: ${[...new Set(p.notes)].join(' ')})\n\n${message}`;
    p.notes = [];
  }
  const label = text.trim() || (picked ? `Change ${picked.id}` : 'Pictures');
  p.turn = { before: p.history.fingerprint(), version: p.history.snapshot(label) };
  try {
    p.session.send(message, images.map(({ mediaType, data }) => ({ mediaType, data })));
  } catch (err) {
    p.history.drop(p.turn.version.id);
    p.turn = null;
    throw err;
  }
  return { images: saved };
}

function finishTurn(p) {
  const turn = p.turn;
  p.turn = null;
  if (!turn) return;
  if (p.history.fingerprint() === turn.before) p.history.drop(turn.version.id);
  send('history:changed', p.history.list());
}

const RESTORED_NOTE = 'Since your last message the user went back to an earlier version of the game, so the files may differ from what you remember. Re-read them before editing.';
const EDITED_NOTE = 'The user edited some files by hand in the Code tab since your last message. Re-read files before editing them.';

/* ---------- Claude's tools ---------- */

const text = (t, isError) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

async function onTool(name, args) {
  const p = requireProject();
  const scene = p.scene;
  switch (name) {
    case 'scene_get':
      return text(format(scene.current));
    case 'scene_add':
    case 'scene_update':
    case 'scene_remove':
    case 'scene_settings': {
      // Pick up hand edits to scene.json first so they are not lost.
      pushOps(scene.sync().ops);
      const r =
        name === 'scene_add' ? scene.add(args.objects)
        : name === 'scene_update' ? scene.update(args.updates)
        : name === 'scene_remove' ? scene.remove(args.ids)
        : scene.settings(args.settings);
      pushOps(r.ops);
      if (name === 'scene_settings' && args.settings && 'mode' in args.settings) {
        p.notes.push('The game mode changed, so the preview reloaded.');
      }
      return text(JSON.stringify({ ...r.result, objectsInScene: scene.current.objects.length }));
    }
    case 'asset_download':
      return text(await downloadAsset(p, args));
    case 'screenshot': {
      const img = await capturePreview();
      const errs = p.errors.slice(-10).map((e) => `${e.level}: ${e.text}`);
      return {
        content: [
          { type: 'image', data: img.toString('base64'), mimeType: 'image/jpeg' },
          { type: 'text', text: errs.length ? `Errors reported by the game:\n${errs.join('\n')}` : 'No errors reported.' },
        ],
      };
    }
    case 'test_play':
      return testPlay(args);
    case 'game_errors': {
      const errs = p.errors.slice(-30).map((e) => `${e.level}: ${e.text}`);
      return text(errs.length ? errs.join('\n') : 'No errors or warnings.');
    }
    default:
      return text(`Unknown tool ${name}`, true);
  }
}

const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.glb', '.gltf', '.bin', '.mp3', '.ogg', '.wav', '.m4a']);

async function downloadAsset(p, { url, name }) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error('That is not a valid link.');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https links can be downloaded.');
  let rel = String(name || decodeURIComponent(u.pathname.split('/').pop() || 'file')).replace(/^\/+|^assets\//g, '');
  rel = rel.split('/').map((part) => part.replace(/[^\w.-]+/g, '-')).filter((part) => part && !part.startsWith('.')).join('/');
  const ext = path.extname(rel).toLowerCase();
  if (!ASSET_EXT.has(ext)) throw new Error(`Gamey can download pictures (png, jpg, webp, gif, svg), models (glb, gltf, bin) and sounds (mp3, ogg, wav, m4a), not "${ext || 'this'}". Give a name with the right extension if the link has none.`);
  const res = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Gamey/1.0' } });
  if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}).`);
  const type = res.headers.get('content-type') || '';
  if (/text\/html/i.test(type)) throw new Error('That link is a web page, not a file. Find the direct link to the file itself.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error('That file is bigger than 25 MB; find a smaller one.');
  const full = path.join(p.dir, 'assets', rel);
  if (!full.startsWith(path.join(p.dir, 'assets') + path.sep)) throw new Error('Bad file name.');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  let info = '';
  if (/\.(png|jpe?g|webp|gif)$/.test(ext)) {
    const size = nativeImage.createFromBuffer(buf).getSize();
    if (size.width) info = ` It is ${size.width}x${size.height} pixels.`;
  }
  return `Saved as assets/${rel} (${Math.round(buf.length / 1024)} KB).${info} Use "asset": "assets/${rel}".`;
}

// What the user sees in the preview right now.
async function capturePreview() {
  if (!win || win.isDestroyed() || !previewRect) throw new Error('The preview is not showing.');
  if (win.isMinimized()) throw new Error('The Gamey window is minimised, so the preview cannot be seen. Use test_play instead.');
  const r = {
    x: Math.max(0, Math.floor(previewRect.x)),
    y: Math.max(0, Math.floor(previewRect.y)),
    width: Math.max(1, Math.floor(previewRect.width)),
    height: Math.max(1, Math.floor(previewRect.height)),
  };
  let img = await win.webContents.capturePage(r);
  if (img.getSize().width > 1200) img = img.resize({ width: 1200 });
  return img.toJPEG(85);
}

// Play the game from the start in a hidden window and report what happened.
async function testPlay({ seconds = 2, hold = [], press = [] }) {
  const p = requireProject();
  seconds = Math.max(0.5, Math.min(15, Number(seconds) || 2));
  const s = p.scene.current.settings;
  const is3d = s.mode === '3d';
  const width = is3d ? 1024 : Math.min(1280, s.width || 960);
  const height = is3d ? 640 : Math.round((width * (s.height || 540)) / (s.width || 960));
  const w = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    w.webContents.setAudioMuted(true);
    w.webContents.setFrameRate(60);
    await Promise.race([w.loadURL(server.url).catch(() => {}), sleep(10000)]);
    const js = (code) => w.webContents.executeJavaScript(code, true);
    const start = Date.now();
    while (!(await js('!!(window.__gamey && window.__gamey.ready)').catch(() => false))) {
      if (Date.now() - start > 15000) throw new Error('The game did not start within 15 seconds.');
      await sleep(100);
    }
    await sleep(250);
    const keys = (list) => JSON.stringify((Array.isArray(list) ? list : [list]).filter(Boolean).map(String));
    await js(`__gamey.hold(${keys(hold)}); __gamey.tap(${keys(press)}); 1`);
    await sleep(seconds * 1000);
    const report = JSON.parse(await js('JSON.stringify({ snap: __gamey.snapshot(), errors: __gamey.errors() })'));
    let img = await w.webContents.capturePage();
    if (img.getSize().width > 1024) img = img.resize({ width: 1024 });
    const lines = [
      `Played ${seconds}s${hold.length ? `, holding ${hold.join('+')}` : ''}${press.length ? `, tapping ${press.join('+')}` : ''}.`,
      report.errors.length ? `ERRORS:\n${report.errors.join('\n')}` : 'No errors.',
      report.snap.over ? `The game ended: "${report.snap.over}".` : 'The game is still running.',
      `HUD: ${report.snap.hud.length ? report.snap.hud.join(' | ') : '(empty)'}`,
      `g.state: ${JSON.stringify(report.snap.state)}`,
      `Objects (${report.snap.objectCount}):`,
      ...report.snap.objects.map((o) => JSON.stringify(o)),
    ];
    return {
      content: [
        { type: 'image', data: img.toJPEG(80).toString('base64'), mimeType: 'image/jpeg' },
        { type: 'text', text: lines.join('\n') },
      ],
    };
  } finally {
    w.destroy();
  }
}

/* ---------- Publishing (itch.io) ---------- */

const publishFile = (p) => path.join(p.dir, '.gamey', 'publish.json');
function loadPublishInfo(p) {
  try { return JSON.parse(fs.readFileSync(publishFile(p), 'utf8')); } catch { return null; }
}

async function runPublish(p, { user, slug }) {
  if (p.session.busy) throw new Error('Wait until Claude has finished, then publish.');
  const before = loadPublishInfo(p);
  const version = (before?.version || 0) + 1;
  const r = await publish.push({ gameDir: p.dir, user, slug, version, onLine: (l) => send('publish:progress', l) });
  const info = { user, slug, url: r.url, version, publishedAt: Date.now() };
  fs.mkdirSync(path.dirname(publishFile(p)), { recursive: true });
  fs.writeFileSync(publishFile(p), JSON.stringify(info, null, 2));
  saveConfig({ itchUser: user });
  return info;
}

/* ---------- IPC ---------- */

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      log.warn(`${channel}:`, err.message || String(err));
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), root: projects.root }));
  handle('projects:list', () => ({ projects: projects.list(), last: loadConfig().lastProject || null }));
  handle('projects:create', (name, mode) => projects.create(name, mode === '3d' ? '3d' : '2d'));
  handle('projects:open', (name) => openProject(name));
  handle('ideas', (mode) => IDEAS[mode === '3d' ? '3d' : '2d']);

  handle('files:list', () => projects.files(requireProject().name));
  handle('files:read', (rel) => projects.readFile(requireProject().name, rel));
  handle('files:write', (rel, body) => {
    const p = requireProject();
    projects.writeFile(p.name, rel, body);
    p.notes.push(EDITED_NOTE);
  });

  handle('scene:objects', () => requireProject().scene.current.objects);

  handle('chat:send', (payload) => sendChat(requireProject(), payload));
  handle('chat:stop', () => requireProject().session.stop());
  handle('chat:new', () => {
    const p = requireProject();
    p.session.reset();
    try { fs.unlinkSync(chatFile(p)); } catch {}
  });
  handle('chat:loadHistory', () => {
    try { return JSON.parse(fs.readFileSync(chatFile(requireProject()), 'utf8')); } catch { return []; }
  });
  handle('chat:saveHistory', (items) => {
    const file = chatFile(requireProject());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(items.slice(-300)));
  });

  const afterRestore = async (p) => {
    p.notes.push(RESTORED_NOTE);
    send('history:changed', p.history.list());
    await sleep(400);
    pushOps(p.scene.sync().ops);
    server.broadcast([{ op: 'restart' }]);
  };
  handle('history:list', () => requireProject().history.list());
  handle('history:undo', async () => {
    const p = requireProject();
    if (p.session.busy) throw new Error('Wait until Claude has finished, or press Stop first.');
    const v = p.history.undo();
    await afterRestore(p);
    return v;
  });
  handle('history:restore', async (id) => {
    const p = requireProject();
    if (p.session.busy) throw new Error('Wait until Claude has finished, or press Stop first.');
    const v = p.history.restore(id);
    await afterRestore(p);
    return v;
  });

  handle('preview:rect', (rect) => {
    previewRect = rect;
  });

  handle('publish:info', async () => {
    const p = requireProject();
    const st = await publish.status();
    return { butler: !!st.butler, site: loadPublishInfo(p), user: loadConfig().itchUser || 'juslangit', suggested: publish.slugify(p.name) };
  });
  handle('publish:run', (opts) => runPublish(requireProject(), opts || {}));

  handle('shell:openExternal', (url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  handle('shell:openFolder', () => shell.openPath(current ? current.dir : projects.root));
  handle('shell:openInBrowser', () => shell.openExternal(server.url));
}

process.on('uncaughtException', (err) => log.error('Uncaught:', err));
process.on('unhandledRejection', (err) => log.error('Unhandled promise:', err));

app.setName('Gamey');
app.whenReady().then(async () => {
  log.init(path.join(app.getPath('userData'), 'logs'));
  log.info(`Gamey ${app.getVersion()} started on ${os.type()} ${os.release()}`);
  // GAMEY_HOME lets tests keep their games out of the real Documents folder.
  projects = new Projects(process.env.GAMEY_HOME || app.getPath('documents'));
  server = new PreviewServer();
  server.onTool = onTool;
  server.onLog = (entry) => {
    if (!current) return;
    current.errors.push({ ...entry, time: Date.now() });
    if (current.errors.length > 100) current.errors.shift();
    send('game:log', entry);
  };
  await server.start();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  closeProject();
  app.quit();
});
