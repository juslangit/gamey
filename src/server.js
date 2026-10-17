// A small local web server for the preview. It serves the open game's folder, sends
// the live build steps to the preview over server-sent events, and takes the game's
// error reports and the tool calls from Gamey's MCP server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

class PreviewServer {
  constructor() {
    this.root = null;
    this.clients = new Set();
    // The key keeps other programs on this Mac from calling Gamey's tools.
    this.key = crypto.randomBytes(16).toString('hex');
    this.onTool = null;
    this.onLog = null;
    // Folders served under /__gamey/<name>/ (the asset library, Gamey's runtime) and
    // pages Gamey makes on the fly (/__gamey/page/<id>), for its own hidden windows.
    this.mounts = {};
    this.pages = new Map();
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  get url() {
    return `http://127.0.0.1:${this.port}/`;
  }

  setRoot(dir) {
    this.root = dir;
  }

  broadcast(ops) {
    if (!ops || (Array.isArray(ops) && !ops.length)) return;
    const data = `data: ${JSON.stringify(ops)}\n\n`;
    for (const res of this.clients) res.write(data);
  }

  handle(req, res) {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);

    if (urlPath === '/__gamey/live') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (urlPath === '/__gamey/log' && req.method === 'POST') {
      return readBody(req, (body) => {
        try {
          const { level, text } = JSON.parse(body);
          this.onLog?.({ level: level === 'warn' ? 'warn' : 'error', text: String(text).slice(0, 2000) });
        } catch {}
        res.writeHead(204);
        res.end();
      });
    }
    if (urlPath === '/__gamey/tool' && req.method === 'POST') return this.tool(req, res);
    const page = urlPath.match(/^\/__gamey\/page\/([\w-]+)$/);
    if (page) {
      const html = this.pages.get(page[1]);
      if (!html) return this.notFound(res, 'Not found.');
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    const mount = urlPath.match(/^\/__gamey\/([\w-]+)\/(.+)$/);
    if (mount && this.mounts[mount[1]]) return this.sendFile(req, res, this.mounts[mount[1]], '/' + mount[2]);

    if (!this.root) return this.notFound(res, 'No game is open.');
    return this.sendFile(req, res, this.root, urlPath);
  }

  sendFile(req, res, root, urlPath) {
    let file = path.normalize(path.join(root, urlPath));
    if (file !== root && !file.startsWith(root + path.sep)) return this.notFound(res, 'Not found.');
    if (path.relative(root, file).split(path.sep).some((part) => part.startsWith('.'))) return this.notFound(res, 'Not found.');

    fs.stat(file, (err, stat) => {
      if (!err && stat.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err2, data) => {
        if (err2) return this.notFound(res, `${urlPath} was not found.`);
        const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : data);
      });
    });
  }

  tool(req, res) {
    if (req.headers['x-gamey-key'] !== this.key || !this.onTool) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    readBody(req, async (body) => {
      let result;
      try {
        const { name, args } = JSON.parse(body);
        result = await this.onTool(name, args || {});
      } catch (err) {
        result = { content: [{ type: 'text', text: String(err.message || err) }], isError: true };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  }

  notFound(res, message) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(message);
  }
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 5e6) req.destroy();
  });
  req.on('end', () => cb(body));
}

module.exports = { PreviewServer };
