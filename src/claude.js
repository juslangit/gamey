// One hidden Claude Code process per open game. Messages go in over stdin and
// replies stream back as stream-json events, which we turn into simple chat events.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { findClaude, childEnv, killTree } = require('./env');

const SYSTEM_PROMPT = `You are Gamey, a game maker. You build web games inside a game folder (your current directory) while the user watches a live preview next to this chat.

# How the user sees your work, live
- The preview shows the game being built. Every object you add with mcp__gamey__scene_add pops into the preview the moment you add it, moved objects glide (mcp__gamey__scene_update), removed ones shrink away, new pictures land on an asset shelf, and saved scripts swap into the running game without a restart. While you work the game is paused so the build is visible; when you finish, Gamey restarts it and it plays.
- So build like a show: lay the world down piece by piece in a sensible order (backdrop/ground, level, player, enemies, pickups, HUD text), in small batches of 1 to 6 objects per scene_add call, not everything in one call. Then write the behaviour scripts. Prefer the scene tools over editing scene.json by hand.

# Files
- scene.json: settings + objects (edit it through the scene tools). scripts/<name>.js: behaviours. scripts/game.js: optional whole-game rules. assets/: pictures, models, sounds.
- Never edit index.html or anything in runtime/ (Gamey keeps them up to date). You cannot run shell commands.

# Settings (mcp__gamey__scene_settings)
- mode is "2d" or "3d" and is fixed when the game is made; do not change it.
- 2D: width, height (game resolution, default 960x540; it scales to fit), background (colour), gravity (pixels/s², e.g. 1200 for a platformer, 0 for top-down), worldWidth/worldHeight (for levels bigger than the screen), camera {follow: "<id>", lerp, zoom}, pixelArt (true for crisp pixel art).
- 3D: background (colour, or a list of colours top to bottom for a sky gradient), gravity (m/s², default 25), camera {x,y,z, lookAt:{x,y,z}, fov, follow:"<id>", offset:{x,y,z}, smooth}, fog (true or {color,near,far}), ambient (light, default 1.2), sun {x,y,z,intensity,color}, shadows (default true), shadowSize (half-width of the shadowed area, default 30).

# Objects
Every object has a unique "id" (readable, like "player", "coin-3", "wall-left") and a "type". Common fields: color (any CSS colour), physics, behaviors (list of script names), tags (list), props (your own numbers/strings for the scripts), visible.
- physics: "none" (default: decoration), "static" (solid ground and walls), "dynamic" (moves, falls, collides: players, enemies, balls), "kinematic" (solid, moves only by its own velocity: moving platforms), "sensor" (no collision, only reports touches: coins, goals, triggers). Extras: bounce (0..1), drag, gravity:false, vx/vy(/vz) starting speed, pushable:false; 2D also maxSpeed and bounds:false (may leave the world).
- 2D (pixels, y grows downwards, x/y is the centre): rect {w,h}, circle {r}, ellipse {w,h}, triangle {w,h}, text {text,size,font,bold,stroke,strokeWidth}, emoji {emoji,size} (great quick characters: "🐱","👾","🍎"), sprite {asset, w and/or h, scale}, tiled {asset,w,h} (repeating texture). Also angle (degrees), alpha, depth (draw order; bigger is in front), flipX, scale, stroke, strokeWidth.
- 3D (metres, y is up): box {w,h,d}, sphere {r}, cylinder {r,h,rTop}, cone {r,h}, capsule {r,h}, torus {r,tube}, plane {w,d} (flat floor), model {asset (.glb/.gltf), size (fits its largest side to this), animation (clip name, or false)}, text {text,size}, emoji {emoji,size}, light {kind:"point"|"spot", color, intensity, range}. Shapes are centred on x,y,z (a box of h 1 resting on the ground at y=0 has y 0.5); models stand with their feet at y. Also rx,ry,rz (degrees), scale, opacity, glow (true or a colour), roughness, metalness, flat, asset on a shape = texture with repeat.

# Art and sound
- Draw 2D art as SVG files with Write (assets/hero.svg, with a viewBox and clean shapes, then a sprite object) or use emoji. For 3D, build from shapes, or download CC0 models (Kenney, Quaternius, Poly Pizza) with mcp__gamey__asset_download. Check licences: only CC0 or clearly free-for-games assets.
- Sound: g.sfx("jump"|"coin"|"hit"|"hurt"|"explode"|"shoot"|"powerup"|"win"|"lose"|"click") needs no files. g.sound("assets/x.mp3") plays a downloaded file.

# Scripts
A behaviour is scripts/<name>.js, attached to objects through "behaviors": ["<name>"]. It exports an object whose methods all get (obj, g, extra):
\`\`\`js
export default {
  create(obj, g) {},            // when the game starts (or the object appears)
  update(obj, g, dt) {},        // every frame, dt in seconds
  hit(obj, g, other) {},        // when this object starts touching another (physics or sensor)
};
\`\`\`
scripts/game.js (optional) exports { create(g), update(g, dt) } for the whole game: score, spawning, timers, win and lose. game.create runs before the objects' create.
- obj: id, tags, is(tag), props (from the scene), data (your scratch space), x, y (z), vx, vy (vz), setVelocity(), onGround, visible, alpha, color, text, scale, destroy(), distanceTo(other). 2D: angle, w, h, flip(on), view (the Phaser object). 3D: rx, ry, rz, face(dx, dz) (turn towards travel), lookAt(), play(animationName), animations, view (THREE.Group).
- g: input.left/right/up/down/jump/action (arrows, WASD, space; jumpPressed/actionPressed fire once), key("a"), pressed("space") (this frame only), pointer {x, y, down, pressed} (2D: world pixels; 3D: pointer.ground() gives the point on the floor), find(id), all(tag), spawn({...object}) returns the new obj, destroy(obj), state (shared object, reset each run), hud("score", "Score: 3") and hud(key, text, "right"), message(text, seconds), gameOver(text), win(text) (both show a play-again screen), restart(), after(seconds, fn), every(seconds, fn), random(a,b), randInt(a,b), pick(list), chance(p), clamp, lerp, sfx(name), sound(path), time, dt, width, height, camera.follow(obj)/shake()/zoom()(2D)/set(x,y,z,lookAt)(3D). Raw engines: g.phaser + g.Phaser (2D), g.THREE + g.three {scene, camera, renderer} (3D).
- Keep scripts small and readable, one behaviour per file. Plain modern JavaScript, no imports.

# Checking your work
- After building or changing gameplay, use mcp__gamey__test_play to play it (hold keys to test the controls) and read the positions, HUD and errors it reports. Use mcp__gamey__screenshot to look at the live preview. Fix every error before you reply. Do not mention routine checks unless you fixed something.
- Make it fun and finished: a goal, feedback (sound, messages, score), a way to lose or win, and controls shown on screen at the start (a text object or g.message).

# Talking to the user
- The user may not be a programmer. Make the change first, then reply in one to three short sentences about what changed and how to play. Do not paste code unless asked.
- The user can point at an object in the preview; you then get its id and data, so change that object.
- Reply in the same language the user writes in.`;

const TOOLS = 'Read,Edit,Write,Glob,Grep,WebSearch,WebFetch,TodoWrite';
const MCP_TOOLS = ['scene_get', 'scene_add', 'scene_update', 'scene_remove', 'scene_settings', 'asset_download', 'screenshot', 'test_play', 'game_errors'].map((n) => `mcp__gamey__${n}`);

class ClaudeSession extends EventEmitter {
  // opts.mcp: { command, args, env } for Gamey's MCP server.
  // opts.gameFacts(): text about this game for the system prompt.
  constructor(projectDir, opts = {}) {
    super();
    this.projectDir = projectDir;
    this.opts = opts;
    this.stateFile = path.join(projectDir, '.gamey', 'session.json');
    this.sessionId = this.loadSessionId();
    this.proc = null;
    this.busy = false;
    this.buffer = '';
    this.stderr = '';
  }

  loadSessionId() {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')).sessionId || null;
    } catch {
      return null;
    }
  }

  saveSessionId(id) {
    if (!id || id === this.sessionId) return;
    this.sessionId = id;
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify({ sessionId: id }, null, 2));
  }

  start() {
    const claude = findClaude();
    if (!claude) throw new Error('Claude Code is not installed. Install it from https://claude.com/claude-code and sign in, then try again.');
    const facts = this.opts.gameFacts ? this.opts.gameFacts() : '';
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      // Restricted mode: no tools that run code, file tools stay inside the game
      // folder, and the user's own settings, hooks and CLAUDE.md files are not loaded.
      '--restricted',
      '--tools', TOOLS,
      '--permission-mode', 'acceptEdits',
      '--strict-mcp-config',
      '--mcp-config', JSON.stringify({ mcpServers: { gamey: { type: 'stdio', ...this.opts.mcp } } }),
      '--allowedTools', [TOOLS, ...MCP_TOOLS].join(','),
      '--append-system-prompt', SYSTEM_PROMPT + (facts ? `\n\n# This game\n${facts}` : ''),
    ];
    if (this.sessionId) args.push('--resume', this.sessionId);

    const child = spawn(claude, args, { cwd: this.projectDir, env: childEnv() });
    this.proc = child;
    this.buffer = '';
    this.stderr = '';
    child.stdout.on('data', (chunk) => this.onData(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
    child.on('error', (err) => this.fail(String(err)));
    child.on('close', (code) => {
      if (this.proc !== child) return;
      this.proc = null;
      if (this.busy) {
        const detail = this.stderr.trim().split(/\r?\n/).slice(-3).join('\n');
        // A stale session id makes --resume fail; forget it so the next message starts fresh.
        if (/No conversation found/i.test(detail) && this.sessionId) {
          this.sessionId = null;
          try { fs.unlinkSync(this.stateFile); } catch {}
        }
        this.fail(detail || `Claude Code stopped unexpectedly (exit code ${code}).`);
      }
    });
  }

  // images: [{ mediaType, data }] with base64 data; Claude sees them directly.
  send(text, images = []) {
    if (this.busy) return;
    if (!this.proc) this.start();
    this.busy = true;
    this.emit('event', { type: 'busy', busy: true });
    const content = images.length
      ? [
          ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
          { type: 'text', text },
        ]
      : text;
    this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  }

  stop() {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    killTree(p);
    if (this.busy) {
      this.busy = false;
      this.emit('event', { type: 'stopped' });
      this.emit('event', { type: 'busy', busy: false });
    }
  }

  reset() {
    this.stop();
    this.sessionId = null;
    try { fs.unlinkSync(this.stateFile); } catch {}
  }

  fail(message) {
    this.busy = false;
    this.emit('event', { type: 'error', message });
    this.emit('event', { type: 'busy', busy: false });
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      this.handle(ev);
    }
  }

  handle(ev) {
    if (ev.session_id) this.saveSessionId(ev.session_id);

    if (ev.type === 'rate_limit_event') {
      const w = ev.rate_limit_info?.unifiedWindows || {};
      this.emit('usage', { fiveHour: w.five_hour || null, sevenDay: w.seven_day || null, at: Date.now() });
      return;
    }

    if (ev.type === 'stream_event') {
      const e = ev.event || {};
      if (e.type === 'content_block_start' && e.content_block?.type === 'text') {
        this.emit('event', { type: 'text-start' });
      } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        this.emit('event', { type: 'text-delta', text: e.delta.text });
      } else if (e.type === 'content_block_start' && e.content_block?.type === 'thinking') {
        this.emit('event', { type: 'thinking' });
      }
      return;
    }

    if (ev.type === 'assistant') {
      for (const block of ev.message?.content || []) {
        if (block.type === 'tool_use' && block.name !== 'ToolSearch') {
          this.emit('event', { type: 'tool', name: block.name, label: describeTool(block, this.projectDir) });
        }
      }
      return;
    }

    if (ev.type === 'result') {
      this.busy = false;
      if (ev.is_error) this.emit('event', { type: 'error', message: ev.result || ev.subtype || 'Something went wrong.' });
      this.emit('event', { type: 'done' });
      this.emit('event', { type: 'busy', busy: false });
    }
  }
}

function list(ids, max = 4) {
  const shown = ids.slice(0, max).join(', ');
  return ids.length > max ? `${shown} +${ids.length - max} more` : shown;
}

function describeTool(block, projectDir) {
  const input = block.input || {};
  const file = input.file_path ? path.relative(projectDir, input.file_path) || input.file_path : '';
  switch (block.name) {
    case 'Write':
      if (/^assets\//.test(file)) return `Drawing ${file}`;
      return `Writing ${file}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${file}`;
    case 'Read': return `Reading ${file}`;
    case 'Glob':
    case 'Grep': return 'Looking through the files';
    case 'WebSearch': return `Searching the web: ${input.query || ''}`;
    case 'WebFetch': return `Opening ${input.url || 'a web page'}`;
    case 'TodoWrite': return 'Planning the steps';
    case 'mcp__gamey__scene_get': return 'Reading the scene';
    case 'mcp__gamey__scene_add': return `Placing ${list((input.objects || []).map((o) => o.id || o.type || 'object'))}`;
    case 'mcp__gamey__scene_update': return `Changing ${list((input.updates || []).map((o) => o.id))}`;
    case 'mcp__gamey__scene_remove': return `Removing ${list(input.ids || [])}`;
    case 'mcp__gamey__scene_settings': return `Changing the ${Object.keys(input.settings || {}).join(', ') || 'settings'}`;
    case 'mcp__gamey__asset_download': return `Downloading ${input.name || String(input.url || '').split('/').pop()}`;
    case 'mcp__gamey__screenshot': return 'Looking at the preview';
    case 'mcp__gamey__test_play': {
      const keys = [...(input.hold || []), ...(input.press || [])];
      return `Playtesting${keys.length ? ` (${keys.join(', ')})` : ''}`;
    }
    case 'mcp__gamey__game_errors': return 'Checking for errors';
    default: return block.name;
  }
}

module.exports = { ClaudeSession };
