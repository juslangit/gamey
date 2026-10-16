// Publishing a game to itch.io with butler. The itch.io page itself is made once
// on the website (butler cannot create pages); after that every push updates it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findButler, run } = require('./env');

const slugify = (name) =>
  String(name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 50) || 'my-game';

// Copy the game without Gamey's own .gamey folder (chat, history) into a clean folder.
function stage(gameDir) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'gamey-publish-'));
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const s = path.join(from, e.name);
      const d = path.join(to, e.name);
      if (e.isDirectory()) walk(s, d);
      else fs.copyFileSync(s, d);
    }
  };
  walk(gameDir, dest);
  return dest;
}

async function status() {
  const butler = findButler();
  if (!butler) return { butler: null };
  const r = await run(butler, ['--version']);
  return { butler, version: (r.stdout + r.stderr).trim().split('\n')[0] };
}

async function push({ gameDir, user, slug, channel = 'html5', version, onLine }) {
  const butler = findButler();
  if (!butler) throw new Error('butler is not installed. Get it from https://itch.io/docs/butler/ and run "butler login" once.');
  if (!/^[\w-]+$/.test(user)) throw new Error('Type your itch.io user name.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('The page name can only use lowercase letters, numbers and dashes.');
  const dir = stage(gameDir);
  try {
    const target = `${user}/${slug}:${channel}`;
    onLine?.(`Uploading to ${target}...`);
    const args = ['push', dir, target, '--if-changed'];
    if (version) args.push('--userversion', String(version));
    const r = await run(butler, args, { onLine });
    if (r.code !== 0) {
      const text = (r.stderr || r.stdout).trim();
      if (/not found|invalid game|could not find|404/i.test(text)) {
        throw new Error(`itch.io has no page called ${user}/${slug} yet. Create it first at https://itch.io/game/new (Kind of project: HTML), then publish again.`);
      }
      if (/login|credentials|api key/i.test(text)) throw new Error('butler is not logged in. Run "butler login" in Terminal once.');
      throw new Error(text.split('\n').slice(-4).join('\n') || `butler stopped with code ${r.code}.`);
    }
    return { url: `https://${user}.itch.io/${slug}`, target };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { slugify, status, push };
