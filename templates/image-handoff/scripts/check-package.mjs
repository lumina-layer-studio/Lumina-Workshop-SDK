import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { validateIdentity } from './identity.mjs';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/check-package.mjs <package>');
const entries = unzipSync(await readFile(path));
for (const name of ['LICENSE', 'manifest.json', 'ui/index.html']) if (!entries[name]) throw new Error(`Missing ${name}`);
const manifest = JSON.parse(strFromU8(entries['manifest.json']));
validateIdentity(manifest);
const normalizeLineEndings = text => text.replace(/\r\n/g, '\n');
const license = normalizeLineEndings(strFromU8(entries.LICENSE));
const moduleLicense = normalizeLineEndings(await readFile(new URL('../LICENSE', import.meta.url), 'utf8'));
const sdkLicense = normalizeLineEndings(await readFile(new URL('../node_modules/@lumina/workshop-sdk/LICENSE', import.meta.url), 'utf8'));
if (!moduleLicense.trim() || !sdkLicense.trim() || !license.includes(moduleLicense) || !license.includes(sdkLicense)) throw new Error('Missing or incomplete license');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><iframe sandbox="allow-scripts"></iframe>');
  const ready = await page.evaluate(async html => {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Handshake timed out')), 10000);
      const frame = document.querySelector('iframe');
      window.addEventListener('message', event => {
        if (event.source === frame.contentWindow && event.data?.type === 'lumina.workshop.ready') {
          clearTimeout(timeout); resolve(event.data);
        }
      });
      frame.srcdoc = html;
    });
  }, strFromU8(entries['ui/index.html']));
  if (errors.length) throw new Error(`Module script error: ${errors.join('; ')}`);
  if (ready.moduleId !== manifest.id || ready.moduleVersion !== manifest.version) throw new Error(`Handshake identity mismatch: expected ${JSON.stringify({ moduleId: manifest.id, moduleVersion: manifest.version })}, reported ${JSON.stringify({ moduleId: ready.moduleId, moduleVersion: ready.moduleVersion })}`);
  await context.close();
  console.log(`Handshake and licenses verified: ${manifest.id}@${manifest.version}`);
} finally { await browser.close(); }
