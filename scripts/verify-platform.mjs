import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { listGames, findGame } from '../dist/games/catalog.js';
import { createGameFolder } from './new-game.mjs';
import { GUNSHOT_URL } from '../dist/shot-feedback.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
assert.equal(findGame('robot-outbreak').engine, 'robot-outbreak');
for (const game of listGames()) {
  await stat(join(dist, 'games', game.slug, 'game.js'));
  await stat(join(dist, 'games', game.slug, 'manifest.js'));
  if (game.cover) await stat(join(dist, game.cover));
}

// Use a project prefix so root-relative URLs fail exactly as they would on Pages.
const server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs')], {
  cwd: root, env: { ...process.env, PORT: '0', LASER_LAB_HOST: '127.0.0.1', LASER_LAB_BASE_PATH: '/Laser-Lab' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview server did not start')), 8000);
    let output = '';
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error('Preview server exited: ' + code)); });
    server.stdout.on('data', chunk => {
      output += chunk;
      const found = output.match(/http:\/\/127\.0\.0\.1:\d+\/Laser-Lab\//);
      if (found) { clearTimeout(timeout); resolve(found[0]); }
    });
  });
  assert.equal((await fetch(new URL('/', url))).status, 404, 'test server exposes only the Pages prefix');
  const paths = ['.', 'play.html?game=robot-outbreak', 'lab.html', 'debug.html', 'isolation.html', 'display.html', 'frame-worker.js', 'spot-worker.js', 'laser/index.js', 'laser/frame-worker.js', 'laser/spot-worker.js', 'library.js', 'games/catalog.js', 'game.js'];
  const gunshot = await fetch(new URL(GUNSHOT_URL.pathname.split('/dist/')[1], url));
  assert.equal(gunshot.status,200,'shared gunshot works under the Pages project path');
  assert(gunshot.headers.get('content-type').startsWith('audio/mpeg'));
  assert((await gunshot.arrayBuffer()).byteLength>0,'the supplied audio is not empty');
  for (const path of paths) {
    const response = await fetch(new URL(path, url));
    assert.equal(response.status, 200, path + ' must serve under the repository prefix');
    if (response.headers.get('content-type').startsWith('text/html')) {
      const html = await response.text();
      for (const [, link] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        if (/^(?:https?:|data:|#)/.test(link)) continue;
        const target = new URL(link, response.url);
        assert(target.pathname.startsWith('/Laser-Lab/'), 'local links must preserve the repository prefix');
        const asset = await fetch(target);
        assert.equal(asset.status, 200, path + ' has a broken asset/link: ' + link);
        await asset.arrayBuffer();
      }
    } else await response.arrayBuffer();
  }
  for (const game of listGames()) {
    if (game.cover) assert.equal((await fetch(new URL(game.cover, url))).status, 200);
    const inventory = JSON.parse(await readFile(join(dist, 'games', game.slug, 'assets.json'), 'utf8'));
    const files = new Set();
    const collect = value => {
      if (typeof value === 'string' && value.startsWith('assets/')) files.add(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(inventory);
    for (const file of files) {
      assert.equal((await fetch(new URL('games/' + game.slug + '/' + file, url), { method: 'HEAD' })).status, 200,
        game.slug + ' has a missing supplied/generated asset: ' + file);
    }
  }
  for (const path of ['characters/zombie-robot.glb', 'environments/calibration-lab.glb']) {
    const response = await fetch(new URL('games/robot-outbreak/assets/' + path, url));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'glTF');
  }
  const index = await readFile(join(dist, 'index.html'), 'utf8');
  assert(!/play\.js|three\.module|game\.js/.test(index), 'the library does not eagerly load the 3D game');
  console.log('PASS: library, game, diagnostics, assets and workers work under a GitHub Pages project prefix');
} finally {
  server.kill();
}

const tempBase = resolve(tmpdir());
const scratch = await mkdtemp(join(tempBase, 'laser-platform-tests-'));
try {
  const games = join(scratch, 'dist', 'games');
  await mkdir(games, { recursive: true });
  await writeFile(join(scratch, 'package.json'), '{"type":"module"}');
  await copyFile(join(dist, 'games', 'catalog.js'), join(games, 'catalog.js'));
  const currentCatalog = await readFile(join(games, 'catalog.js'), 'utf8');
  for (const [, slug] of currentCatalog.matchAll(/from '\.\/([a-z0-9-]+)\/manifest\.js'/g)) {
    await mkdir(join(games, slug));
    await copyFile(join(dist, 'games', slug, 'manifest.js'), join(games, slug, 'manifest.js'));
  }
  const draftSlug = 'scaffold-test-' + Date.now().toString(36);
  const created = await createGameFolder(scratch, draftSlug, 'لعبة الاختبار');
  for (const category of ['characters', 'animations', 'environments', 'textures', 'audio', 'images']) {
    assert((await stat(join(created, 'assets', category))).isDirectory());
  }
  const catalog = await readFile(join(games, 'catalog.js'), 'utf8');
  assert(catalog.includes("from './" + draftSlug + "/manifest.js'"));
  const imported = await import(pathToFileURL(join(games, 'catalog.js')).href);
  assert.equal(imported.findGame(draftSlug), null, 'unfinished games are hidden from the playable catalog');
  assert.equal(imported.listGames().length, listGames().length);
  await writeFile(join(created, 'assets', 'characters', 'supplied.glb'), 'existing player asset');
  await assert.rejects(createGameFolder(scratch, draftSlug), { code: 'EEXIST' });
  await assert.rejects(createGameFolder(scratch, '../outside'));
  assert.equal(await readFile(join(games, 'catalog.js'), 'utf8'), catalog, 'failed creation must not alter registration');
  assert.equal(await readFile(join(created, 'assets', 'characters', 'supplied.glb'), 'utf8'), 'existing player asset');
  console.log('PASS: new-game folders and registration; drafts stay hidden; duplicate games and traversal preserve supplied assets');
} finally {
  if (!resolve(scratch).startsWith(tempBase + sep)) throw new Error('Unsafe temporary test cleanup path');
  await rm(scratch, { recursive: true, force: true });
}
