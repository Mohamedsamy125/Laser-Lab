import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { LaserCamera, FrameDetector, LaserSpotDetector, VisionChannel } from '../dist/laser/index.js';
import { LaserCamera as LegacyCamera } from '../dist/camera.js';
import { FrameDetector as LegacyFrame } from '../dist/tracking.js';
import { LaserSpotDetector as LegacySpot } from '../dist/laser-spot.js';
import { VisionChannel as LegacyChannel } from '../dist/vision-channel.js';

assert.equal(LaserCamera, LegacyCamera);
assert.equal(FrameDetector, LegacyFrame);
assert.equal(LaserSpotDetector, LegacySpot);
assert.equal(VisionChannel, LegacyChannel);

// Exercise all existing module-worker entry points with the actual shared detector.
// A sampled cyan target verifies that diagnostic algorithm/seed options survive.
const width = 160, height = 100;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const color = Math.hypot(x - 80, y - 50) <= 3 ? [30, 170, 230] : [25, 32, 38];
  pixels.set([...color, 255], (y * width + x) * 4);
}
const { rgbHSV } = await import('../dist/laser/debug-spot.js');
for (const entry of ['laser/spot-worker.js', 'spot-worker.js', 'debug-worker.js']) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    globalThis.self = { postMessage: value => parentPort.postMessage(value) };
    parentPort.on('message', data => self.onmessage({ data }));
    import(workerData).catch(error => { throw error; });
  `, { eval: true, workerData: new URL('../dist/' + entry, import.meta.url).href });
  try {
    const [ready] = await once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    assert.equal(ready.type, 'ready');
    const result = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({ id: 7, epoch: 3, generation: 4, capturedAt: 100, width, height,
      buffer: pixels.buffer, mode: 'auto', sensitivity: .5, algorithm: 'color', seed: rgbHSV(30, 170, 230),
    });
    const [reply] = await result;
    assert.equal(reply.id, 7);
    assert.equal(reply.epoch, 3);
    assert.equal(reply.generation, 4);
    assert(reply.spot, entry + ' must honor the sampled-color options');
    assert(Math.hypot(reply.spot.x - .5, reply.spot.y - .5) < .02);
  } finally { await worker.terminate(); }
}

let scriptUrl;
globalThis.window = { cv: { Mat: class {} } };
globalThis.document = {
  createElement: () => ({}),
  head: { append(script) { scriptUrl = script.src; queueMicrotask(() => script.onload()); } },
  getElementById: () => ({}),
};
const camera = Object.create(LaserCamera.prototype);
camera.updateUI = () => {};
await camera.loadCVMain();
assert.equal(scriptUrl, new URL('../dist/vendor/opencv.js', import.meta.url).href,
  'the fallback loads OpenCV relative to the shared module, not the current page');
assert(camera.frameDetector instanceof FrameDetector);

async function inspectGames(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), folder);
    if (entry.isDirectory() && entry.name !== 'assets') await inspectGames(file);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const source = await readFile(file, 'utf8');
      assert(!/getUserMedia\s*\(|new\s+Worker\s*\(|from\s+['"][^'"]*\/laser\//.test(source),
        'game modules must receive shared shots instead of owning camera/detector code: ' + file);
    }
  }
}
await inspectGames(new URL('../dist/games/', import.meta.url));
console.log('PASS: one shared laser implementation; worker compatibility and diagnostic options; OpenCV fallback path; games own no laser capture');
