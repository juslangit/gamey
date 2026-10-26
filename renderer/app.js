/* global CodeMirror, renderMarkdown */
const api = window.gamey;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Every IPC call returns { ok, value } or { ok: false, error }.
async function call(fn, ...args) {
  const res = await fn(...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

const state = {
  project: null,
  previewUrl: null,
  mode: '2d',
  history: [],
  live: null,
  busy: false,
  running: true,
  picking: false,
  picked: null,
  objects: new Map(),
  errors: [],
  selected: null,
  ideas: [],
};

const freezeBox = $('#freeze');
try {
  freezeBox.checked = localStorage.getItem('freeze') !== '0';
} catch {}

/* ---------- Games ---------- */

async function loadProjects(select) {
  const { projects, last } = await call(api.projects.list);
  const sel = $('#project-select');
  sel.innerHTML = '';
  for (const p of projects) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = `${p.name}  ·  ${p.mode.toUpperCase()}`;
    sel.appendChild(o);
  }
  if (!projects.length) {
    $('#welcome').hidden = false;
    $('#workspace').hidden = true;
    $$('.top-actions button, #project-folder').forEach((b) => (b.disabled = true));
    sel.hidden = true;
    return;
  }
  sel.hidden = false;
  $('#welcome').hidden = true;
  $('#workspace').hidden = false;
  $$('.top-actions button, #project-folder').forEach((b) => (b.disabled = false));
  const name = select || (projects.some((p) => p.name === last) ? last : projects[0].name);
  sel.value = name;
  await openProject(name);
}

async function openProject(name) {
  if (state.busy) await call(api.chat.stop).catch(() => {});
  const info = await call(api.projects.open, name);
  state.project = info.name;
  state.previewUrl = info.url;
  state.mode = info.mode;
  state.errors = [];
  state.picked = null;
  state.selected = null;
  $('#project-select').value = info.name;
  $('#scene-mode').textContent = info.mode.toUpperCase();
  renderObjects(info.objects);
  clearFeed();
  paintErrors();
  showLiveLink(info.publish);
  loadPreview();
  state.ideas = await call(api.projects.ideas, info.mode);
  state.history = await call(api.chat.loadHistory);
  renderMessages();
  renderFiles(info.files);
  refreshHistory();
  document.title = `${info.name} · Gamey`;
}

$('#project-select').addEventListener('change', (e) => openProject(e.target.value).catch((err) => alert(err.message)));
$('#project-folder').addEventListener('click', () => api.shell.openFolder());

/* ---------- New game ---------- */

const newDialog = $('#new-dialog');
let chosenIdea = null;

async function paintIdeas() {
  const mode = $('input[name="mode"]:checked').value;
  const ideas = await call(api.projects.ideas, mode);
  const box = $('#ideas');
  box.innerHTML = '';
  chosenIdea = ideas[0];
  ideas.forEach((idea, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'idea' + (i === 0 ? ' sel' : '');
    b.innerHTML = '<b></b><small></small>';
    b.querySelector('b').textContent = idea.name;
    b.querySelector('small').textContent = idea.blurb;
    b.addEventListener('click', () => {
      chosenIdea = idea;
      box.querySelectorAll('.idea').forEach((x) => x.classList.toggle('sel', x === b));
    });
    box.appendChild(b);
  });
}

function openNewDialog() {
  $('#new-name').value = '';
  $('#new-error').hidden = true;
  paintIdeas();
  newDialog.showModal();
  $('#new-name').focus();
}

$$('input[name="mode"]').forEach((r) => r.addEventListener('change', paintIdeas));
$('#project-new').addEventListener('click', openNewDialog);
$('#welcome-new').addEventListener('click', openNewDialog);
$('#new-cancel').addEventListener('click', () => newDialog.close());
$('#new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#new-name').value.trim();
  const mode = $('input[name="mode"]:checked').value;
  const btn = $('#new-create');
  btn.disabled = true;
  try {
    const created = await call(api.projects.create, name, mode);
    newDialog.close();
    await loadProjects(created);
    if (chosenIdea?.prompt) sendMessage(chosenIdea.prompt);
    else $('#prompt').focus();
  } catch (err) {
    $('#new-error').textContent = err.message;
    $('#new-error').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Tabs ---------- */

$$('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $('#pane-chat').hidden = t.dataset.tab !== 'chat';
    $('#pane-code').hidden = t.dataset.tab !== 'code';
    if (t.dataset.tab === 'code') {
      editor().refresh();
      if (!openFile && $('#file-select').value) loadFile($('#file-select').value);
    }
  })
);

/* ---------- Chat ---------- */

const messagesEl = $('#messages');

function messageEl(item) {
  const el = document.createElement('div');
  el.className = `msg ${item.role}${item.scene ? ' scene' : ''}`;
  if (item.role === 'assistant') {
    el.innerHTML = renderMarkdown(item.text) || '<span class="typing"><i></i><i></i><i></i></span>';
    return el;
  }
  if (item.images?.length || item.pointed) {
    const refs = document.createElement('div');
    refs.className = 'msg-refs';
    if (item.pointed) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `➤ ${item.pointed}`;
      refs.appendChild(chip);
    }
    for (const src of item.images || []) {
      const img = document.createElement('img');
      img.src = state.previewUrl + src;
      img.alt = src;
      refs.appendChild(img);
    }
    el.appendChild(refs);
  }
  if (item.text) {
    const t = document.createElement('div');
    t.textContent = item.text;
    el.appendChild(t);
  }
  return el;
}

function renderMessages() {
  messagesEl.innerHTML = '';
  if (!state.history.length) {
    const box = document.createElement('div');
    box.className = 'empty';
    box.innerHTML = `<h3>What game should we make?</h3><p>Describe it in your own words, or start from one of these. You'll see every piece land on the stage as Claude builds it.</p><div class="idea-list"></div>`;
    const list = box.querySelector('.idea-list');
    for (const idea of state.ideas.filter((i) => i.prompt)) {
      const b = document.createElement('button');
      b.innerHTML = '<b></b><small></small>';
      b.querySelector('b').textContent = idea.name;
      b.querySelector('small').textContent = idea.blurb;
      b.addEventListener('click', () => {
        $('#prompt').value = idea.prompt;
        $('#prompt').focus();
      });
      list.appendChild(b);
    }
    messagesEl.appendChild(box);
    return;
  }
  for (const item of state.history) messagesEl.appendChild(messageEl(item));
  scrollChat();
}

function scrollChat() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function push(item) {
  if (!state.history.length) messagesEl.innerHTML = '';
  state.history.push(item);
  messagesEl.appendChild(messageEl(item));
  scrollChat();
}

let paintQueued = false;
function paintLive() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    const el = messagesEl.lastElementChild;
    if (state.live && el && el.classList.contains('assistant')) {
      el.innerHTML = renderMarkdown(state.live.text) || '<span class="typing"><i></i><i></i><i></i></span>';
      scrollChat();
    }
  });
}

function saveHistory() {
  api.chat.saveHistory(state.history.filter((m) => m.role !== 'assistant' || m.text.trim()));
}

function setStatus(text) {
  $('#chat-status').textContent = text;
  $('#building-text').textContent = text || 'Claude is building';
}

function setBusy(busy) {
  const was = state.busy;
  state.busy = busy;
  $('#send').hidden = busy;
  $('#stop').hidden = !busy;
  $('#chat-status').classList.toggle('working', busy);
  $('#building').hidden = !busy;
  $('#screen-wrap').classList.toggle('is-building', busy);
  setStatus(busy ? 'Claude is working...' : '');
  paintUndo();
  if (busy && !was) {
    state.errors = [];
    paintErrors();
    if (freezeBox.checked) setRunning(false, 'Paused while Claude builds');
  }
  if (!busy && was) {
    // The build is done: play it from the start.
    restartGame();
    setRunning(true);
  }
}

function endLive() {
  if (state.live && !state.live.text.trim()) {
    state.history = state.history.filter((m) => m !== state.live);
    const el = messagesEl.lastElementChild;
    if (el && el.classList.contains('assistant')) el.remove();
  }
  state.live = null;
}

function startLive() {
  if (state.live) return;
  state.live = { role: 'assistant', text: '' };
  push(state.live);
}

api.chat.onEvent((ev) => {
  switch (ev.type) {
    case 'busy':
      setBusy(ev.busy);
      break;
    case 'thinking':
      setStatus('Claude is thinking...');
      break;
    case 'text-start':
      if (state.live && state.live.text.trim()) state.live = null;
      startLive();
      break;
    case 'text-delta':
      startLive();
      state.live.text += ev.text;
      paintLive();
      break;
    case 'tool':
      endLive();
      push({ role: 'tool', text: ev.label, scene: ev.name.startsWith('mcp__gamey__scene') });
      setStatus(ev.label + '...');
      startLive();
      break;
    case 'error':
      endLive();
      push({ role: 'error', text: ev.message });
      break;
    case 'stopped':
      endLive();
      push({ role: 'tool', text: 'Stopped' });
      saveHistory();
      break;
    case 'done':
      state.live = null;
      state.history = state.history.filter((m) => m.role !== 'assistant' || m.text.trim());
      renderMessages();
      saveHistory();
      break;
  }
});

async function sendPrompt() {
  const text = $('#prompt').value.trim();
  const images = attached.slice();
  const picked = state.picked;
  if ((!text && !images.length && !picked) || state.busy) return;
  setBusy(true);
  try {
    const sent = await call(api.chat.send, {
      text,
      images: images.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
      picked,
    });
    $('#prompt').value = '';
    attached.length = 0;
    state.picked = null;
    renderAttachments();
    selectObject(null);
    push({ role: 'user', text, images: sent.images, pointed: picked ? picked.id : null });
    state.live = { role: 'assistant', text: '' };
    push(state.live);
    saveHistory();
  } catch (err) {
    push({ role: 'error', text: err.message });
    setBusy(false);
  }
}

function sendMessage(text) {
  $('#prompt').value = text;
  sendPrompt();
}

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  sendPrompt();
});
$('#prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendPrompt();
  }
});
$('#stop').addEventListener('click', () => call(api.chat.stop).catch(() => {}));
$('#chat-new').addEventListener('click', async () => {
  if (state.history.length && !confirm('Start a new conversation? Claude forgets this chat, but the game stays as it is.')) return;
  await call(api.chat.reset);
  state.history = [];
  renderMessages();
});

/* ---------- Attachments ---------- */

const attached = [];

function renderAttachments() {
  const box = $('#attachments');
  box.innerHTML = '';
  if (state.picked) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `➤ ${state.picked.id}`;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Remove');
    x.addEventListener('click', () => {
      state.picked = null;
      selectObject(null);
      renderAttachments();
    });
    chip.appendChild(x);
    box.appendChild(chip);
  }
  attached.forEach((img, i) => {
    const d = document.createElement('div');
    d.className = 'attachment';
    d.innerHTML = '<img alt=""><button type="button" aria-label="Remove">✕</button>';
    d.querySelector('img').src = `data:${img.mediaType};base64,${img.data}`;
    d.querySelector('button').addEventListener('click', () => {
      attached.splice(i, 1);
      renderAttachments();
    });
    box.appendChild(d);
  });
  box.hidden = !attached.length && !state.picked;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name || 'image.png', mediaType: file.type, data: String(r.result).split(',')[1] });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function addImageFiles(files) {
  for (const f of files) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) continue;
    if (f.size > 8 * 1024 * 1024) {
      push({ role: 'error', text: `${f.name} is bigger than 8 MB.` });
      continue;
    }
    attached.push(await readImage(f));
  }
  renderAttachments();
}

$('#attach').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  addImageFiles(Array.from(e.target.files));
  e.target.value = '';
});
$('#prompt').addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData.files || []);
  if (files.length) {
    e.preventDefault();
    addImageFiles(files);
  }
});
$('#pane-chat').addEventListener('dragover', (e) => e.preventDefault());
$('#pane-chat').addEventListener('drop', (e) => {
  e.preventDefault();
  addImageFiles(Array.from(e.dataTransfer.files || []));
});

/* ---------- Preview ---------- */

const frame = $('#preview');

function post(msg) {
  frame.contentWindow?.postMessage(msg, '*');
}

/* ---------- Editor and Game tabs ---------- */

// Editor: the world frozen at its start with a free camera. Game: play it.
const EDITOR_HELP = {
  '3d': [['Drag', 'orbit'], ['Right-drag', 'look'], ['Shift-drag', 'pan'], ['Scroll / pinch', 'zoom'], ['WASD · Q E', 'fly'], ['Shift', 'faster'], ['Click', 'select'], ['F / double-click', 'frame'], ['G', 'grid']],
  '2d': [['Drag', 'pan'], ['Scroll / pinch', 'zoom'], ['Shift-scroll', 'pan'], ['WASD', 'move'], ['Click', 'select'], ['F / double-click', 'frame']],
};

function setMode(mode, tell = true) {
  state.mode = mode === 'editor' ? 'editor' : 'game';
  const editing = state.mode === 'editor';
  $$('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === state.mode);
    b.setAttribute('aria-selected', String(b.dataset.mode === state.mode));
  });
  $('.stage').classList.toggle('editing', editing);
  $('#screen-wrap').classList.toggle('is-editing', editing);
  paintEditorHelp();
  try {
    localStorage.setItem('stageMode', state.mode);
  } catch {}
  if (!tell) return;
  post({ gamey: 'edit', on: editing });
  if (!editing) {
    state.running = true;
    paintPlay();
  }
  frame.focus();
}

function paintEditorHelp() {
  const el = $('#editor-help');
  el.hidden = state.mode !== 'editor';
  el.innerHTML = (EDITOR_HELP[state.gameMode] || EDITOR_HELP['3d']).map(([k, v]) => `<span><b>${k}</b> ${v}</span>`).join('');
}

$$('.seg-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
try {
  state.mode = localStorage.getItem('stageMode') === 'editor' ? 'editor' : 'game';
} catch {
  state.mode = 'game';
}
setMode(state.mode, false);

function loadPreview() {
  const paused = state.busy && freezeBox.checked;
  state.running = !paused;
  frame.src = `${state.previewUrl}?live=1${paused ? '&paused=1' : ''}&t=${Date.now()}`;
  paintPlay();
}

function setRunning(on, reason) {
  state.running = on;
  post({ gamey: 'run', running: on, reason: reason || (on ? '' : 'Paused') });
  paintPlay();
}

function paintPlay() {
  $('#play').classList.toggle('paused', !state.running);
  $('#play-label').textContent = state.running ? 'Pause' : 'Play';
  $('#play').setAttribute('aria-label', state.running ? 'Pause' : 'Play');
}

function restartGame() {
  state.errors = [];
  paintErrors();
  post({ gamey: 'restart' });
}

$('#play').addEventListener('click', () => {
  setRunning(!state.running);
  frame.focus();
});
$('#restart').addEventListener('click', () => {
  restartGame();
  if (!state.running) setRunning(true);
  frame.focus();
});
freezeBox.addEventListener('change', () => {
  try {
    localStorage.setItem('freeze', freezeBox.checked ? '1' : '0');
  } catch {}
  if (state.busy) setRunning(!freezeBox.checked, 'Paused while Claude builds');
});
$('#open-browser').addEventListener('click', () => api.shell.openInBrowser());
$('#toggle-scene').addEventListener('click', () => {
  $('.stage').classList.toggle('hide-scene');
  try {
    localStorage.setItem('hideScene', $('.stage').classList.contains('hide-scene') ? '1' : '0');
  } catch {}
  reportRect();
});
try {
  if (localStorage.getItem('hideScene') === '1') $('.stage').classList.add('hide-scene');
} catch {}

window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || !e.data || !e.data.gamey) return;
  const d = e.data;
  if (d.gamey === 'ready') {
    state.gameMode = d.mode === '3d' ? '3d' : '2d';
    paintEditorHelp();
    if (state.mode === 'editor') post({ gamey: 'edit', on: true });
    else if (state.busy && freezeBox.checked) setRunning(false, 'Paused while Claude builds');
    else post({ gamey: 'run', running: state.running });
    if (state.picking) post({ gamey: 'pick', on: true });
    if (state.selected) post({ gamey: 'select', id: state.selected });
  } else if (d.gamey === 'picked') {
    setPicking(false);
    state.picked = { id: d.id, def: d.def, spawned: d.spawned };
    selectObject(d.id, false);
    renderAttachments();
    $('.tab[data-tab="chat"]').click();
    $('#prompt').placeholder = `What should change about ${d.id}?`;
    $('#prompt').focus();
  } else if (d.gamey === 'selected') {
    selectObject(d.id || null, false);
    $(`#objects li[data-id="${CSS.escape(d.id || '')}"]`)?.scrollIntoView({ block: 'nearest' });
  } else if (d.gamey === 'pickCancel') {
    setPicking(false);
  }
});

function setPicking(on) {
  state.picking = on;
  $('#pick').classList.toggle('active', on);
  $('#pick-hint').hidden = !on;
  $('#screen-wrap').classList.toggle('is-picking', on);
  post({ gamey: 'pick', on });
}
$('#pick').addEventListener('click', () => setPicking(!state.picking));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.picking) setPicking(false);
});

// The main process captures the preview for Claude's screenshot tool, so it needs
// to know where the preview is in the window.
function reportRect() {
  const r = frame.getBoundingClientRect();
  api.preview.rect({ x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(reportRect).observe(frame);
window.addEventListener('resize', reportRect);

/* ---------- Objects list and build feed ---------- */

const TYPE_ICON = {
  rect: '▭', circle: '●', ellipse: '⬭', triangle: '▲', text: 'T', sprite: '🖼', tiled: '▦',
  box: '◼', sphere: '●', cylinder: '⬤', cone: '▲', capsule: '💊', torus: '◎', plane: '▱', model: '🧊', light: '💡',
};

function iconFor(o) {
  if (o.type === 'emoji') return o.emoji || '⭐';
  return TYPE_ICON[o.type] || '▭';
}

function objectLi(o) {
  const li = document.createElement('li');
  li.dataset.id = o.id;
  li.innerHTML = '<span class="ic"></span><span class="n"></span><span class="t"></span>';
  paintLi(li, o);
  li.addEventListener('click', () => selectObject(state.selected === o.id ? null : o.id));
  // In the Editor tab a double-click flies the camera to the object.
  li.addEventListener('dblclick', () => {
    selectObject(o.id);
    post({ gamey: 'focus', id: o.id });
  });
  return li;
}

function paintLi(li, o) {
  const ic = li.querySelector('.ic');
  ic.textContent = iconFor(o);
  ic.style.color = o.type !== 'emoji' && o.color ? o.color : '';
  li.querySelector('.n').textContent = o.id;
  li.querySelector('.t').textContent = o.physics && o.physics !== 'none' ? o.physics : o.type || '';
}

function renderObjects(list) {
  state.objects = new Map(list.map((o) => [o.id, o]));
  const ul = $('#objects');
  ul.innerHTML = '';
  for (const o of list) ul.appendChild(objectLi(o));
  paintCount();
}

function paintCount() {
  const n = state.objects.size;
  $('#obj-count').textContent = `${n} object${n === 1 ? '' : 's'}`;
  $('#empty-stage').hidden = n > 0 || state.busy;
}

function selectObject(id, tell = true) {
  state.selected = id;
  $$('#objects li').forEach((li) => li.classList.toggle('sel', li.dataset.id === id));
  if (tell) post({ gamey: 'select', id });
}

function clearFeed() {
  $('#feed-items').innerHTML = '<span class="feed-empty muted">Changes appear here as Claude makes them</span>';
}

function feed(kind, label, title, img) {
  const box = $('#feed-items');
  box.querySelector('.feed-empty')?.remove();
  const el = document.createElement('span');
  el.className = `feed-item ${kind}`;
  el.title = title || label;
  if (img) {
    const i = document.createElement('img');
    i.src = img;
    i.alt = '';
    el.appendChild(i);
  } else {
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = { add: '+', update: '↻', remove: '✕', script: '{ }', asset: '⬇', settings: '⚙' }[kind] || '•';
    el.appendChild(k);
  }
  el.appendChild(document.createTextNode(label));
  box.appendChild(el);
  while (box.children.length > 80) box.firstChild.remove();
  box.scrollTo({ left: box.scrollWidth, behavior: 'smooth' });
}

// Steps arrive in bursts; show them one by one, in time with the preview.
const feedQueue = [];
let feeding = false;
function queueFeed(fn) {
  feedQueue.push(fn);
  if (feeding) return;
  feeding = true;
  (function next() {
    const f = feedQueue.shift();
    if (!f) {
      feeding = false;
      return;
    }
    f();
    setTimeout(next, feedQueue.length > 24 ? 30 : 140);
  })();
}

api.scene.onOps((ops) => {
  for (const op of ops) {
    queueFeed(() => applyOp(op));
  }
});

function applyOp(op) {
  const ul = $('#objects');
  if (op.op === 'add' || op.op === 'update') {
    const o = op.obj;
    const exists = state.objects.has(o.id);
    state.objects.set(o.id, o);
    let li = ul.querySelector(`li[data-id="${CSS.escape(o.id)}"]`);
    if (!li) {
      li = objectLi(o);
      ul.appendChild(li);
      li.classList.add('fresh');
      li.scrollIntoView({ block: 'nearest' });
    } else {
      paintLi(li, o);
      li.classList.remove('changed');
      void li.offsetWidth;
      li.classList.add('changed');
    }
    feed(exists ? 'update' : 'add', o.id, `${exists ? 'Changed' : 'Added'} ${o.type || 'object'} "${o.id}"`);
  } else if (op.op === 'remove') {
    state.objects.delete(op.id);
    const li = ul.querySelector(`li[data-id="${CSS.escape(op.id)}"]`);
    if (li) {
      li.classList.add('gone');
      setTimeout(() => li.remove(), 450);
    }
    if (state.selected === op.id) selectObject(null);
    feed('remove', op.id, `Removed "${op.id}"`);
  } else if (op.op === 'script') {
    feed('script', `${op.name}.js`, op.removed ? `Deleted scripts/${op.name}.js` : `Saved scripts/${op.name}.js`);
  } else if (op.op === 'asset') {
    if (op.removed) return;
    const name = op.path.split('/').pop();
    const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(op.path);
    feed('asset', name, `New asset ${op.path}`, isImg ? `${state.previewUrl}${op.path}?v=${Date.now()}` : null);
  } else if (op.op === 'settings') {
    feed('settings', 'settings', 'Changed the scene settings');
    if (op.settings?.mode) state.mode = op.settings.mode === '3d' ? '3d' : '2d';
    $('#scene-mode').textContent = state.mode.toUpperCase();
  }
  paintCount();
}

/* ---------- Game errors ---------- */

api.game.onLog((entry) => {
  state.errors.push(entry);
  if (state.errors.length > 60) state.errors.shift();
  paintErrors();
});

function paintErrors() {
  const btn = $('#errors');
  const errs = state.errors.filter((e) => e.level === 'error').length;
  const warns = state.errors.length - errs;
  btn.hidden = !state.errors.length;
  btn.classList.toggle('warn', !errs);
  btn.textContent = errs ? `${errs} error${errs === 1 ? '' : 's'}` : `${warns} warning${warns === 1 ? '' : 's'}`;
  const ul = $('#error-list');
  ul.innerHTML = '';
  for (const e of state.errors) {
    const li = document.createElement('li');
    li.className = e.level;
    li.textContent = e.text;
    ul.appendChild(li);
  }
  if (!state.errors.length) $('#error-drawer').hidden = true;
}

$('#errors').addEventListener('click', () => ($('#error-drawer').hidden = !$('#error-drawer').hidden));
$('#close-errors').addEventListener('click', () => ($('#error-drawer').hidden = true));
$('#clear-errors').addEventListener('click', () => {
  state.errors = [];
  paintErrors();
});
$('#fix-errors').addEventListener('click', () => {
  if (state.busy) return;
  const list = state.errors.map((e) => `- ${e.text}`).join('\n');
  $('#error-drawer').hidden = true;
  sendMessage(`The game reported these problems. Please fix them:\n${list}`);
});

/* ---------- Code ---------- */

let cm = null;
let openFile = null;
let dirty = false;

function editor() {
  if (!cm) {
    cm = CodeMirror($('#editor'), { lineNumbers: true, tabSize: 2, indentUnit: 2, lineWrapping: false });
    cm.on('change', () => {
      if (!loadingFile) setDirty(true);
    });
    cm.setOption('extraKeys', { 'Cmd-S': () => saveFile() });
  }
  return cm;
}

function modeFor(file) {
  if (/\.json$/.test(file)) return { name: 'javascript', json: true };
  if (/\.m?js$/.test(file)) return 'javascript';
  if (/\.css$/.test(file)) return 'css';
  if (/\.(html|svg)$/.test(file)) return 'htmlmixed';
  return null;
}

function setDirty(d) {
  dirty = d;
  $('#code-save').disabled = !d;
  $('#code-state').textContent = d ? 'Not saved' : '';
}

function renderFiles(files) {
  const sel = $('#file-select');
  const keep = openFile;
  sel.innerHTML = '';
  for (const f of files) {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = f;
    sel.appendChild(o);
  }
  if (keep && files.includes(keep)) sel.value = keep;
  else {
    openFile = null;
    if (!$('#pane-code').hidden && files.length) loadFile(files[0]);
  }
}

let loadingFile = false;
async function loadFile(file) {
  if (dirty && openFile && !confirm(`Discard your changes to ${openFile}?`)) {
    $('#file-select').value = openFile;
    return;
  }
  openFile = file;
  $('#file-select').value = file;
  const res = await call(api.files.read, file);
  const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(file);
  $('#code-binary').hidden = !res.binary;
  $('#editor').hidden = !!res.binary;
  if (res.binary) {
    const prev = $('#binary-preview');
    prev.innerHTML = '';
    if (isImg) {
      const img = document.createElement('img');
      img.src = `${state.previewUrl}${file}?v=${Date.now()}`;
      img.alt = file;
      prev.appendChild(img);
    }
    setDirty(false);
    return;
  }
  loadingFile = true;
  const ed = editor();
  ed.setOption('mode', modeFor(file));
  ed.setValue(res.text);
  ed.clearHistory();
  loadingFile = false;
  setDirty(false);
  ed.refresh();
}

async function saveFile() {
  if (!openFile || !dirty) return;
  try {
    await call(api.files.write, openFile, editor().getValue());
    setDirty(false);
  } catch (err) {
    alert(err.message);
  }
}

$('#file-select').addEventListener('change', (e) => loadFile(e.target.value));
$('#code-save').addEventListener('click', saveFile);
api.files.onChanged(async ({ files }) => {
  renderFiles(files);
  // Claude changed the open file: show the new version unless the user is editing it.
  if (openFile && !dirty && !$('#pane-code').hidden && files.includes(openFile)) {
    const res = await call(api.files.read, openFile).catch(() => null);
    if (res && !res.binary && res.text !== editor().getValue()) {
      loadingFile = true;
      const pos = editor().getCursor();
      const scroll = editor().getScrollInfo();
      editor().setValue(res.text);
      editor().setCursor(pos);
      editor().scrollTo(scroll.left, scroll.top);
      loadingFile = false;
    }
  }
});

/* ---------- Undo and history ---------- */

let versions = [];

function paintUndo() {
  $('#undo').disabled = state.busy || !versions.some((v) => v.kind !== 'restore');
}

async function refreshHistory() {
  versions = await call(api.history.list).catch(() => []);
  paintUndo();
}
api.history.onChanged((list) => {
  versions = list;
  paintUndo();
});

function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

$('#undo').addEventListener('click', async () => {
  try {
    const v = await call(api.history.undo);
    push({ role: 'tool', text: `Undid: ${v.label}` });
    saveHistory();
  } catch (err) {
    alert(err.message);
  }
});

$('#history').addEventListener('click', async () => {
  await refreshHistory();
  const ul = $('#history-list');
  ul.innerHTML = '';
  if (!versions.length) ul.innerHTML = '<li class="muted">No earlier versions yet.</li>';
  for (const v of versions) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="lbl"></span><small></small><button class="btn small">Go back</button>';
    li.querySelector('.lbl').textContent = (v.kind === 'restore' ? '↩ ' : 'Before: ') + v.label;
    li.querySelector('small').textContent = timeAgo(v.time);
    li.querySelector('button').addEventListener('click', async () => {
      try {
        await call(api.history.restore, v.id);
        $('#history-dialog').close();
        push({ role: 'tool', text: `Went back to before "${v.label}"` });
        saveHistory();
      } catch (err) {
        alert(err.message);
      }
    });
    ul.appendChild(li);
  }
  $('#history-dialog').showModal();
});
$('#history-close').addEventListener('click', () => $('#history-dialog').close());

/* ---------- Publish ---------- */

const pubDialog = $('#publish-dialog');

function showLiveLink(site) {
  const el = $('#live-link');
  el.innerHTML = '';
  el.hidden = !site;
  if (!site) return;
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = site.url.replace(/^https:\/\//, '');
  a.addEventListener('click', (e) => {
    e.preventDefault();
    api.shell.openExternal(site.url);
  });
  el.appendChild(a);
}

function paintPubUrl() {
  const u = $('#pub-user').value.trim();
  const s = $('#pub-slug').value.trim();
  $('#pub-url').textContent = u && s ? `Goes to https://${u}.itch.io/${s}` : '';
}

$('#publish').addEventListener('click', async () => {
  const info = await call(api.publish.info);
  $('#pub-nobutler').hidden = info.butler;
  $('#pub-form').hidden = !info.butler;
  $('#pub-go').hidden = !info.butler;
  $('#pub-user').value = info.site?.user || info.user;
  $('#pub-slug').value = info.site?.slug || info.suggested;
  $('#pub-log').hidden = true;
  $('#pub-log').textContent = '';
  $('#pub-error').hidden = true;
  $('#pub-done').hidden = true;
  $('#pub-go').disabled = false;
  paintPubUrl();
  pubDialog.showModal();
});
$('#pub-user').addEventListener('input', paintPubUrl);
$('#pub-slug').addEventListener('input', paintPubUrl);
$('#pub-close').addEventListener('click', () => pubDialog.close());
$('#pub-go').addEventListener('click', async () => {
  $('#pub-go').disabled = true;
  $('#pub-error').hidden = true;
  $('#pub-done').hidden = true;
  $('#pub-log').hidden = false;
  $('#pub-log').textContent = '';
  try {
    const site = await call(api.publish.run, { user: $('#pub-user').value.trim(), slug: $('#pub-slug').value.trim() });
    $('#pub-done').textContent = `Published version ${site.version}. `;
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = 'Open the page';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      api.shell.openExternal(site.url);
    });
    $('#pub-done').appendChild(a);
    $('#pub-done').hidden = false;
    showLiveLink(site);
  } catch (err) {
    $('#pub-error').textContent = err.message;
    $('#pub-error').hidden = false;
  } finally {
    $('#pub-go').disabled = false;
  }
});
api.publish.onProgress((line) => {
  const log = $('#pub-log');
  log.textContent += line + '\n';
  log.scrollTop = log.scrollHeight;
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-ext]');
  if (!a) return;
  e.preventDefault();
  api.shell.openExternal(a.dataset.ext);
});

/* ---------- Usage meter ---------- */

api.usage.onChanged((u) => {
  const w = u?.fiveHour;
  const el = $('#usage');
  if (!w || w.utilization == null) return;
  el.hidden = false;
  el.textContent = `${Math.round(w.utilization * 100)}% of 5-hour limit`;
});

/* ---------- Asset library ---------- */

// Shown only while the library downloads (the first launch); it hides once ready.
function showLibrary(st) {
  const el = $('#library-status');
  if (!st) return;
  const busy = ['download', 'index', 'polyhaven', 'thumbs'].includes(st.step);
  el.hidden = !busy && st.step !== 'error';
  el.textContent = st.step === 'error' ? 'Asset library unavailable' : `Art library: ${st.text}`;
  el.title = st.text || '';
}
api.library.onStatus(showLibrary);
api.library.status().then((r) => r?.ok && showLibrary(r.value));

/* ---------- Keyboard ---------- */

window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.closest?.('.CodeMirror');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'e' || e.key === 'E') setMode('editor');
  else if (e.key === 'g' || e.key === 'G') setMode('game');
  else if (state.mode === 'editor') return;
  else if (e.key === 'p' || e.key === 'P') $('#play').click();
  else if (e.key === 'r' || e.key === 'R') $('#restart').click();
});

/* ---------- Resizable left panel ---------- */

(function splitter() {
  const left = $('#left');
  let saved = 0;
  try {
    saved = parseInt(localStorage.getItem('leftWidth'), 10);
  } catch {}
  if (saved) left.style.width = `${saved}px`;
  let dragging = false;
  $('#splitter').addEventListener('mousedown', (e) => {
    dragging = true;
    document.body.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    left.style.width = `${Math.max(330, Math.min(e.clientX, window.innerWidth - 520))}px`;
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('dragging');
    try {
      localStorage.setItem('leftWidth', parseInt(left.style.width, 10));
    } catch {}
    if (cm) cm.refresh();
    reportRect();
  });
})();

/* ---------- Start ---------- */

loadProjects().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<p class="error" style="padding:20px">${String(err.message).replace(/</g, '&lt;')}</p>`);
});
