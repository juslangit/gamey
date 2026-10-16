// A small log of what went wrong, kept in Gamey's data folder so a feedback
// report can include it. It holds error messages only, never tokens or chat text.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;
let file = null;

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'gamey.log');
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.old');
  } catch {}
}

function write(level, ...parts) {
  const text = parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  const line = `${new Date().toISOString()} ${level} ${text}\n`;
  if (!file) return;
  try { fs.appendFileSync(file, line); } catch {}
}

// The last part of the log (old file first), at most `max` characters.
function tail(max = 150000) {
  let text = '';
  for (const f of [file + '.old', file]) {
    try { text += fs.readFileSync(f, 'utf8'); } catch {}
  }
  return text.length > max ? text.slice(-max) : text;
}

module.exports = {
  init,
  tail,
  info: (...p) => write('INFO', ...p),
  warn: (...p) => write('WARN', ...p),
  error: (...p) => write('ERROR', ...p),
};
