import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateSync } from 'node:zlib';
import { unzipSync, zipSync, strToU8, strFromU8 } from '../templates/image-handoff/node_modules/fflate/esm/browser.js';
import { chromium } from '../templates/image-handoff/node_modules/playwright/index.mjs';

const template = fileURLToPath(new URL('../templates/image-handoff/', import.meta.url));

test('changing only manifest identity changes the package name and real ready message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workshop-copy-'));
  try {
    cpSync(template, dir, { recursive: true, filter: source => !['node_modules', 'dist'].includes(basename(source)) });
    symlinkSync(join(template, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath));
    manifest.id = 'example.changed-module'; manifest.version = '2.3.4';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: dir });
    const path = join(dir, 'dist', 'example.changed-module-2.3.4.lumina-workshop');
    assert.deepEqual(JSON.parse(strFromU8(unzipSync(readFileSync(path))['manifest.json'])), manifest);
    execFileSync(process.execPath, ['scripts/check-package.mjs', path], { cwd: dir });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('builds a five-member module and checks its actual handshake', () => {
  execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: template });
  const packageName = readdirSync(`${template}/dist`).find((name) => name.endsWith('.lumina-workshop'));
  assert.ok(packageName);
  const path = `${template}/dist/${packageName}`;
  const members = Object.keys(unzipSync(readFileSync(path))).sort();
  assert.deepEqual(members, ['LICENSE', 'README.md', 'assets/icon.png', 'manifest.json', 'ui/index.html']);
  execFileSync(process.execPath, ['scripts/check-package.mjs', path], { cwd: template, stdio: 'pipe' });
});

test('packaged PNG icon has valid chunk CRCs and decodable image data', () => {
  execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: template });
  const path = join(template, 'dist', 'example.image-handoff-1.0.0.lumina-workshop');
  const icon = Buffer.from(unzipSync(readFileSync(path))['assets/icon.png']);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const imageData = [];
  let end = false;
  for (let offset = 8; offset < icon.length;) {
    const length = icon.readUInt32BE(offset);
    const type = icon.toString('ascii', offset + 4, offset + 8);
    const dataEnd = offset + 8 + length;
    assert.ok(dataEnd + 4 <= icon.length, `truncated ${type} chunk`);
    assert.equal(crc32(icon.subarray(offset + 4, dataEnd)), icon.readUInt32BE(dataEnd), `invalid ${type} CRC`);
    if (type === 'IDAT') imageData.push(icon.subarray(offset + 8, dataEnd));
    if (type === 'IEND') end = true;
    offset = dataEnd + 4;
  }
  assert.ok(end && imageData.length > 0);
  assert.ok(inflateSync(Buffer.concat(imageData)).length > 0);
});

test('accepts complete licenses with CRLF line endings in the final package', () => {
  execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: template });
  const path = join(template, 'dist', 'example.image-handoff-1.0.0.lumina-workshop');
  const entries = unzipSync(readFileSync(path));
  entries.LICENSE = strToU8(strFromU8(entries.LICENSE).replace(/\r?\n/g, '\r\n'));
  const dir = mkdtempSync(join(tmpdir(), 'workshop-crlf-'));
  try {
    const converted = join(dir, 'crlf.lumina-workshop');
    writeFileSync(converted, zipSync(entries));
    execFileSync(process.execPath, ['scripts/check-package.mjs', converted], { cwd: template, stdio: 'pipe' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('real MessageChannel retries preserve PNG and project identity, then new selection gets a new ID', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'workshop-handoff-'));
  cpSync(template, dir, { recursive: true, filter: source => !['node_modules', 'dist'].includes(basename(source)) });
  symlinkSync(join(template, 'node_modules'), join(dir, 'node_modules'), 'dir');
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  manifest.id = 'example.changed-module'; manifest.version = '2.3.4';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: dir });
  const path = join(dir, 'dist', 'example.changed-module-2.3.4.lumina-workshop');
  const html = strFromU8(unzipSync(readFileSync(path))['ui/index.html']);
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
    await page.evaluate(html => {
      window.handoffs = []; let picks = 0;
      const frame = document.querySelector('iframe');
      window.addEventListener('message', event => {
        if (event.source !== frame.contentWindow || event.data?.type !== 'lumina.workshop.ready') return;
        const channel = new MessageChannel();
        channel.port1.onmessage = ({ data }) => {
          let result;
          if (data.method === 'ui.getState') result = { locale: 'en-US', theme: 'light', tokens: {} };
          if (data.method === 'image.pick') { picks++; result = picks === 2 ? null : { name: 'x.png', mimeType: 'image/png', bytes: new ArrayBuffer(0), raster: { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) } }; }
          if (data.method === 'handoff.image') {
            window.handoffs.push({ ...data.payload, pngBytes: Array.from(new Uint8Array(data.payload.pngBytes)) });
            result = { status: window.handoffs.length === 1 ? 'needs-confirmation' : 'completed' };
          }
          channel.port1.postMessage({ protocol: 'lumina-workshop-rpc', version: 1, kind: 'response', requestId: data.requestId, ok: true, result });
        };
        frame.contentWindow.postMessage({ type: 'lumina.workshop.connect', sessionId: 'test' }, '*', [channel.port2]);
      });
      frame.srcdoc = html;
    }, html);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: 'Choose image' }).click();
    await frame.getByRole('status').getByText('Image ready to send.').waitFor({ timeout: 3000 });
    await frame.getByRole('button', { name: 'Send to converter' }).click();
    await frame.getByRole('button', { name: 'Confirm replacement' }).click();
    await frame.getByRole('status').getByText('Completed.').waitFor();
    await frame.getByRole('button', { name: 'Choose image' }).click();
    await frame.getByRole('status').getByText('Selection cancelled; previous image retained.').waitFor();
    await frame.getByRole('button', { name: 'Send to converter' }).click();
    await frame.getByRole('status').getByText('Completed.').waitFor();
    await frame.getByRole('button', { name: 'Choose image' }).click();
    await frame.getByRole('button', { name: 'Send to converter' }).click();
    await frame.getByRole('status').getByText('Completed.').waitFor();
    const handoffs = await page.evaluate(() => window.handoffs);
    assert.equal(handoffs.length, 4);
    for (const handoff of handoffs) {
      assert.equal(handoff.moduleId, manifest.id); assert.equal(handoff.moduleVersion, manifest.version);
      assert.equal(handoff.recipeSource.moduleId, manifest.id); assert.equal(handoff.recipeSource.moduleVersion, manifest.version);
    }
    assert.equal(handoffs[0].projectId, handoffs[1].projectId);
    assert.equal(handoffs[1].projectId, handoffs[2].projectId);
    assert.notEqual(handoffs[2].projectId, handoffs[3].projectId);
    assert.deepEqual(handoffs[0].pngBytes, handoffs[1].pngBytes);
    assert.deepEqual(handoffs[0].pngBytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('rejects stale identity and incomplete licenses from the actual package', () => {
  execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: template, env: { ...process.env, TZ: 'UTC' } });
  const path = `${template}/dist/${readdirSync(`${template}/dist`).find(name => name.endsWith('.lumina-workshop'))}`;
  const original = readFileSync(path);
  execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: template, env: { ...process.env, TZ: 'Asia/Singapore' } });
  assert.deepEqual(readFileSync(path), original, 'build must be reproducible');
  const dir = mkdtempSync(join(tmpdir(), 'workshop-package-'));
  try {
    const cases = [
      [entries => { const manifest = JSON.parse(strFromU8(entries['manifest.json'])); manifest.version = '9.8.7'; entries['manifest.json'] = strToU8(JSON.stringify(manifest)); }, /identity mismatch: expected .*9\.8\.7.*reported .*1\.0\.0/],
      [entries => { const manifest = JSON.parse(strFromU8(entries['manifest.json'])); manifest.id = 'example.wrong'; entries['manifest.json'] = strToU8(JSON.stringify(manifest)); }, /identity mismatch: expected .*example\.wrong.*reported .*example\.image-handoff/],
      [entries => { entries.LICENSE = entries.LICENSE.slice(0, 100); }, /Missing or incomplete license/],
      [entries => { entries.LICENSE = entries.LICENSE.slice(0, -100); }, /Missing or incomplete license/],
      [entries => { const license = strFromU8(entries.LICENSE); entries.LICENSE = strToU8(license.slice(license.indexOf('--- @lumina/workshop-sdk license ---'))); }, /Missing or incomplete license/],
      [entries => { entries['ui/index.html'] = strToU8('<!doctype html><p>No handshake</p>'); }, /Handshake timed out/],
      [entries => { entries['ui/index.html'] = strToU8('<script>this is invalid javascript !!!</script>'); }, /Handshake timed out|Module script error/],
    ];
    for (const [index, [mutate, expected]] of cases.entries()) {
      const entries = unzipSync(original); mutate(entries);
      const bad = join(dir, `${index}.lumina-workshop`); writeFileSync(bad, zipSync(entries));
      assert.throws(() => execFileSync(process.execPath, ['scripts/check-package.mjs', bad], { cwd: template, stdio: 'pipe' }), error => {
        assert.match(error.stderr.toString(), expected, `invalid package ${index} failed for the wrong reason`);
        return true;
      }, `invalid package ${index} accepted`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
