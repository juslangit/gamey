// Gamey's MCP server, started by Claude Code over stdio. It runs on Gamey's own
// Electron binary with ELECTRON_RUN_AS_NODE=1 and passes every tool call to Gamey
// over the local preview server, where the scene, the preview and the test runner live.
const readline = require('readline');

const PORT = process.env.GAMEY_PORT;
const KEY = process.env.GAMEY_KEY;

const obj = { type: 'object', additionalProperties: true };

const TOOLS = [
  {
    name: 'scene_get',
    description: 'Read the game scene: its settings and every object, one per line. Use it before changing objects you have not seen in this conversation.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'scene_add',
    description:
      'Add objects to the scene. Each one appears in the live preview the moment you call this, popping in one after another, so add them in a sensible building order (ground and backdrop first, then level pieces, then characters, then pickups and UI) and in small batches of 1 to 6 per call. An object with an id that already exists is replaced. See the object format in your instructions.',
    inputSchema: {
      type: 'object',
      properties: { objects: { type: 'array', items: obj, description: 'Objects, e.g. {"id":"player","type":"rect","x":120,"y":400,"w":40,"h":56,"color":"#ff7a59","physics":"dynamic","behaviors":["player"]}' } },
      required: ['objects'],
    },
  },
  {
    name: 'scene_update',
    description: 'Change objects in place. Give each object id plus only the fields to change; set a field to null to remove it. The preview animates the change (moves glide, colours blend).',
    inputSchema: {
      type: 'object',
      properties: { updates: { type: 'array', items: obj, description: 'e.g. [{"id":"coin-3","x":640,"color":"gold"}]' } },
      required: ['updates'],
    },
  },
  {
    name: 'scene_remove',
    description: 'Remove objects from the scene by id.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'scene_settings',
    description: 'Change the scene settings (background, gravity, camera, size, world size, lights, fog...). Only the fields you give change; null removes one.',
    inputSchema: { type: 'object', properties: { settings: obj }, required: ['settings'] },
  },
  {
    name: 'asset_download',
    description:
      'Download a file from the web into the game\'s assets/ folder: a picture (png, jpg, webp, gif, svg), a 3D model (glb, gltf) or a sound (mp3, ogg, wav). Only use files whose licence allows use in a game (CC0 is best: Kenney.nl, Poly Pizza, OpenGameArt CC0, Quaternius). It appears in the preview\'s asset shelf. Returns the path to use as "asset".',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Direct link to the file.' },
        name: { type: 'string', description: 'File name to save as, e.g. "hero.png" or "models/tree.glb". Defaults to the name in the link.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'screenshot',
    description: 'See the live preview exactly as the user sees it right now. Also returns any errors the game reported.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'test_play',
    description:
      'Play the game from the start in a hidden window (the user\'s preview is not touched) and report back: a screenshot at the end, every object\'s position and speed, the HUD, g.state, whether the game ended, and any errors. Hold keys to check controls, e.g. hold ["right"] for 2 seconds should move the player right; press ["space"] taps a key at the start.',
    inputSchema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'How long to play, 0.5 to 15. Default 2.' },
        hold: { type: 'array', items: { type: 'string' }, description: 'Keys held down the whole time: left, right, up, down, space, enter, a-z, 0-9.' },
        press: { type: 'array', items: { type: 'string' }, description: 'Keys tapped once at the start.' },
      },
    },
  },
  {
    name: 'game_errors',
    description: 'The errors and warnings the game has reported in the live preview since it last started.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const NAMES = new Set(TOOLS.map((t) => t.name));

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function callGamey(name, args) {
  const res = await fetch(`http://127.0.0.1:${PORT}/__gamey/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gamey-key': KEY },
    body: JSON.stringify({ name, args }),
  });
  if (!res.ok) throw new Error((await res.text()) || `Gamey did not answer (HTTP ${res.status}).`);
  return res.json();
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return;
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'gamey', version: '1.0.0' },
      });
    } else if (method === 'tools/list') {
      reply(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      if (!NAMES.has(params?.name)) return fail(id, -32602, `Unknown tool ${params?.name}`);
      try {
        reply(id, await callGamey(params.name, params.arguments || {}));
      } catch (err) {
        reply(id, { content: [{ type: 'text', text: String(err.message || err) }], isError: true });
      }
    } else if (method === 'ping') {
      reply(id, {});
    } else {
      fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    fail(id, -32603, String(err.message || err));
  }
});
