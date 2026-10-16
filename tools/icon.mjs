// Render build/icon.html to build/icon.png (1024x1024) with Chrome.
import { chromium } from '/Users/luqman/.local/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
import { fileURLToPath } from 'url';
const dir = fileURLToPath(new URL('../build/', import.meta.url));
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
await p.goto('file://' + dir + 'icon.html');
await p.screenshot({ path: dir + 'icon.png', omitBackground: true });
await b.close();
