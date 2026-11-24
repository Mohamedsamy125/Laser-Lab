import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function createGameFolder(root, slug, title = slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '')) {
    throw new Error('Use a lowercase slug such as pulse-targets.');
  }
  const games = join(root, 'dist', 'games');
  const catalogFile = join(games, 'catalog.js');
  const catalog = await readFile(catalogFile, 'utf8');
  const importMarker = '// GAME_IMPORTS — added by npm run game:new';
  const entryMarker = '// GAME_ENTRIES — added by npm run game:new';
  if (!catalog.includes(importMarker) || !catalog.includes(entryMarker)) {
    throw new Error('The game catalog registration markers are missing.');
  }
  const variable = 'game_' + slug.replaceAll('-', '_');
  const updated = catalog
    .replace(importMarker, `import ${variable} from './${slug}/manifest.js';\n${importMarker}`)
    .replace(entryMarker, `${variable},\n  ${entryMarker}`);
  const folder = join(games, slug);
  // Fails for an existing game; never overwrite its code or supplied assets.
  await mkdir(folder);
  for (const category of ['characters', 'animations', 'environments', 'textures', 'audio', 'images']) {
    const assets = join(folder, 'assets', category);
    await mkdir(assets, { recursive: true });
    await writeFile(join(assets, '.gitkeep'), '');
  }
  const manifest = {
    slug, title, description: 'وصف اللعبة الجديدة', engine: 'arcade',
    status: 'draft', genre: 'أركيد', cover: '',
  };
  await writeFile(join(folder, 'manifest.js'), 'export default ' + JSON.stringify(manifest, null, 2) + ';\n');
  await writeFile(join(folder, 'assets.json'), JSON.stringify({
    characters: [], animations: [], environments: [], textures: [], audio: [], images: [],
  }, null, 2) + '\n');
  await writeFile(join(folder, 'game.js'), `export function createGame({ mount, restart, playSound, finish }) {
  // Resolve every asset relative to this module:
  // const model = new URL('./assets/characters/player.glb', import.meta.url);
  return {
    async load() {},
    start() {},
    frame(dt) {},
    shoot({ x, y }) {},
    setQuality(quality) {},
    dispose() { mount.replaceChildren(); },
  };
}
`);
  await writeFile(join(folder, 'README.md'), `# ${title}

اللعبة قيد التجهيز. ضع أصولها داخل فولدرها حسب النوع:

- assets/characters: الشخصيات والموديلات.
- assets/animations: الحركات المنفصلة؛ الحركات المدمجة في GLB تظل مع ملف الشخصية.
- assets/environments: البيئة والخريطة.
- assets/textures: الخامات والصور المستخدمة في المشهد.
- assets/audio: الموسيقى والمؤثرات الصوتية.
- assets/images: غلاف اللعبة والصور التعريفية.

سجّل أسماء الملفات ودورها في assets.json، وأضف مصادرها وتراخيصها هنا. مجرد إضافة ملف لا تشغّله تلقائيًا؛ نربطه بمنطق اللعبة بعد استلامه.

manifest.js فيه الاسم والوصف والغلاف. اترك status: 'draft' أثناء تجهيز اللعبة، وغيّرها إلى 'ready' بعد اكتمالها لتظهر في القائمة.

game.js يطبق عقد createGame الموضح في LASER_LAB_HANDOFF.md. الكاميرا والإطار والتصويب والإيقاف مسؤولية المنصة.
`);
  await writeFile(catalogFile, updated);
  return folder;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const folder = await createGameFolder(fileURLToPath(new URL('../', import.meta.url)), process.argv[2], process.argv[3]);
    console.log('Created draft game: ' + folder);
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'A game with this slug already exists; no files were changed.' : error.message);
    process.exitCode = 1;
  }
}
