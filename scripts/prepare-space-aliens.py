"""Decode the supplied GIFs into timed sprite atlases; keep source art untouched."""
import base64
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / 'dist/games/space-balloons'
SOURCE = GAME / 'assets/images'
OUTPUT = GAME / 'assets/animations'
FRAME_SIZE = 256
MASK_SIZE = 64
COLUMNS = 8


def prepare(filename, output_name, masks=True, poster=None):
    source = Image.open(SOURCE / filename)
    rows = (source.n_frames + COLUMNS - 1) // COLUMNS
    sheet = Image.new('RGBA', (COLUMNS * FRAME_SIZE, rows * FRAME_SIZE))
    frames = []
    for index in range(source.n_frames):
        source.seek(index)
        frame = source.convert('RGBA').resize((FRAME_SIZE, FRAME_SIZE), Image.Resampling.LANCZOS)
        sheet.paste(frame, ((index % COLUMNS) * FRAME_SIZE, (index // COLUMNS) * FRAME_SIZE))
        entry = {'duration': source.info.get('duration', 50)}
        if masks:
            alpha = frame.getchannel('A').resize((MASK_SIZE, MASK_SIZE), Image.Resampling.NEAREST)
            mask = bytearray(MASK_SIZE * MASK_SIZE // 8)
            for pixel, opacity in enumerate(alpha.getdata()):
                if opacity >= 40:
                    mask[pixel // 8] |= 1 << (pixel % 8)
            entry['mask'] = base64.b64encode(mask).decode()
        frames.append(entry)
        if index == 0 and poster:
            frame.save(OUTPUT / poster, optimize=True)
    sheet.save(OUTPUT / output_name, optimize=True)
    return {'image': output_name, 'frames': frames, 'duration': sum(frame['duration'] for frame in frames)}


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    enemies = []
    for name, folder, idle, hit in [
        ('cyclops', 'monster1', 'Cyclops_Alien_Idle.gif', 'Cyclops_Alien_Hit_Pop.gif'),
        ('mocking', 'monster2', 'Mocking_Alien_Idle_Laugh.gif', 'Mocking_Alien_Hit_Pop.gif'),
    ]:
        data = {
            'frameSize': FRAME_SIZE, 'maskSize': MASK_SIZE, 'columns': COLUMNS,
            'id': name,
            'idle': prepare(f'balloons/{folder}/{idle}', f'{name}-idle.png', poster=f'{name}-poster.png'),
            'hit': prepare(f'balloons/{folder}/{hit}', f'{name}-hit.png'),
        }
        (OUTPUT / f'{name}.json').write_text(json.dumps(data, separators=(',', ':')) + '\n', encoding='utf-8')
        enemies.append(data)
    planet = prepare('planets/Jade_Planet_Rotate.gif', 'jade-planet.png', masks=False)
    planet.update({'frameSize': FRAME_SIZE, 'columns': COLUMNS, 'playbackRate': .45})
    catalog = {'enemies': enemies, 'planet': planet}
    (OUTPUT / 'sprites.json').write_text(json.dumps(catalog, separators=(',', ':')) + '\n', encoding='utf-8')
    print('Prepared two enemy species with original frame timing, and', len(planet['frames']), 'planet frames')
