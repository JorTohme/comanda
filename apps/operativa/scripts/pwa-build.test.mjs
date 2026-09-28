import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = new URL(`${directory.pathname.endsWith('/') ? '' : '/'}${entry.name}`, directory);
    return entry.isDirectory() ? listFiles(path) : path;
  }))).flat();
}

function pngDimensions(buffer) {
  assert.equal(buffer.toString('hex', 0, 8), '89504e470d0a1a0a');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test('built worker caches the static shell and never authenticated API requests', async () => {
  const sw = await readFile(new URL('sw.js', dist), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', dist), 'utf8'));
  assert.match(sw, /comanda-shell-/);
  assert.match(sw, /request\.headers\.has\('authorization'\)/);
  assert.equal(manifest.name, 'Comanda Operativa');
  assert.equal(manifest.short_name, 'Comanda');
  assert.equal(manifest.start_url, '/');
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']);
  assert.deepEqual(pngDimensions(await readFile(new URL('icon-192.png', dist))), [192, 192]);
  assert.deepEqual(pngDimensions(await readFile(new URL('icon-512.png', dist))), [512, 512]);

  const allowed = new Set(JSON.parse(sw.match(/const ASSET_PATHS=(.*);\n/)[1]));
  const assets = await listFiles(new URL('assets/', dist));
  const builtCode = assets.filter((path) => /\.(?:js|css)$/.test(path.pathname));
  for (const path of builtCode) assert.ok(allowed.has(`/${path.pathname.slice(dist.pathname.length)}`), `${path.pathname} missing from precache`);
  assert.ok(![...allowed].some((path) => /(?:^|\/)api(?:\/|$)/i.test(path)), 'API paths must not be precached');
});
