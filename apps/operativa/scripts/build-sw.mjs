import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }))).flat();
}

const required = ['/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const assetDirectory = join(dist, 'assets');
const assetFiles = await files(assetDirectory);
const paths = [...required, ...assetFiles.map((path) => `/${relative(dist, path).split(sep).join('/')}`)].sort();
const hash = createHash('sha256');
for (const path of paths) hash.update(path).update(await readFile(join(dist, path.slice(1))));

const template = await readFile(new URL('./sw-template.js', import.meta.url), 'utf8');
await writeFile(join(dist, 'sw.js'), `const BUILD_HASH=${JSON.stringify(hash.digest('hex').slice(0, 16))};\nconst ASSET_PATHS=${JSON.stringify(['/', ...paths])};\n${template}`);
