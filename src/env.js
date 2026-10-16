// Finding Claude Code and butler on this Mac, and running commands.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const HOME = os.homedir();

// Apps started from the Dock get a bare PATH, so look in the usual places too.
const EXTRA_PATHS = [
  path.join(HOME, '.local', 'bin'),
  path.join(HOME, '.claude', 'local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
];

function pathDirs() {
  const current = (process.env.PATH || '').split(':').filter(Boolean);
  return [...new Set([...EXTRA_PATHS, ...current])];
}

function which(name) {
  for (const dir of pathDirs()) {
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {}
  }
  return null;
}

const findClaude = () => which('claude');
const findButler = () => which('butler');

function childEnv() {
  const env = { ...process.env, PATH: pathDirs().join(':') };
  // Never inherit nesting markers if Gamey itself was started from a Claude Code session.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

// Run a command. onLine gets each output line as it arrives.
function run(cmd, args, { cwd, onLine, input } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: childEnv() });
    } catch (err) {
      resolve({ code: -1, stdout, stderr: String(err) });
      return;
    }
    const feed = (chunk, isErr) => {
      const text = chunk.toString();
      if (isErr) stderr += text;
      else stdout += text;
      if (onLine) text.split(/\r?\n/).filter((l) => l.trim()).forEach((l) => onLine(l));
    };
    child.stdout.on('data', (c) => feed(c, false));
    child.stderr.on('data', (c) => feed(c, true));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input != null) child.stdin.end(input);
  });
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    child.kill('SIGTERM');
  } catch {}
  setTimeout(() => {
    try {
      if (child.exitCode == null) child.kill('SIGKILL');
    } catch {}
  }, 1500);
}

module.exports = { HOME, findClaude, findButler, childEnv, run, killTree };
