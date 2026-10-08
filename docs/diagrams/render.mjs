// Render the diagram SVGs to PNG at 2x with the Source Sans 3 font embedded.
// node docs/diagrams/render.mjs <path-to-node_modules-with-playwright-core-and-fontsource>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const nm = process.argv[2] ?? join(here, '../../node_modules');
const require = createRequire(join(nm, 'x.js'));
const { chromium } = require('playwright-core');
const fontDir = join(nm, '@fontsource/source-sans-3/files');
const face = (w) =>
  `@font-face{font-family:'Source Sans 3';font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(join(fontDir, `source-sans-3-latin-${w}-normal.woff2`)).toString('base64')}) format('woff2');}`;
const css = [400, 600, 700].map(face).join('') + 'html,body{margin:0}';

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
for (const name of ['architecture']) {
  const svg = readFileSync(join(here, `${name}.svg`), 'utf8');
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(join(here, `${name}.png`), await page.screenshot({ clip: { x: 0, y: 0, width: 1920, height: 1080 } }));
  console.log(`wrote ${name}.png`);
}
await browser.close();
