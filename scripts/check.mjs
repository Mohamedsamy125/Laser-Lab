import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
async function sources(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    if (entry.isDirectory() && entry.name !== 'vendor') files.push(...await sources(file));
    else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) files.push(file);
  }
  return files;
}
const files = [...await sources(join(root, 'dist')), ...await sources(join(root, 'scripts'))];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr || result.error?.message);
    process.exit(1);
  }
}
console.log('PASS: syntax checked ' + files.length + ' platform and game modules');
