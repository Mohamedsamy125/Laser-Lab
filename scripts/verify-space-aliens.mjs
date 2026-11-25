import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { AlienRound, animationFrame, maskContains, wrapPosition, waveRules, WAVE_BREAK_SECONDS } from '../dist/games/space-balloons/round.js';
import { ArcadeGame } from '../dist/games/catalog.js';
import { shadeSpritePixels } from '../dist/games/space-balloons/sprite-palette.js';

// White eyes, teeth and hit flashes must leave room for a bright real laser;
// the alpha used by hit masks must survive the gameplay color treatment.
const palette = new Uint8ClampedArray([
  255,255,255,255, 230,240,220,128, 240,50,70,255,
  40,64,80,255, 250,250,250,0,
]);
const original = palette.slice();
shadeSpritePixels(palette);
for (let i=0;i<palette.length;i+=4) {
  assert.equal(palette[i+3],original[i+3],'hit silhouettes keep their original alpha');
  if(palette[i+3])assert(Math.max(...palette.slice(i,i+3))<=136,'gameplay highlights stay below the palette ceiling');
}
assert.deepEqual([...palette.slice(12,16)],[40,64,80,255],'dark shading stays intact');
assert(palette[0]<palette[2],'white highlights become muted slate/teal');

const base = new URL('../dist/games/space-balloons/assets/animations/', import.meta.url);
const sprites = JSON.parse(await readFile(new URL('sprites.json', base), 'utf8'));
assert.deepEqual(sprites.enemies.map(enemy => enemy.id), ['cyclops', 'mocking']);
for (const enemy of sprites.enemies) {
  assert.equal(enemy.idle.frames.length, 80);assert.equal(enemy.idle.duration, 4000);
  assert.equal(enemy.hit.frames.length, 18);assert.equal(enemy.hit.duration, 1770);
  for (const sequence of [enemy.idle, enemy.hit]) {
    await stat(new URL(sequence.image, base));
    assert.equal(sequence.duration, sequence.frames.reduce((sum, frame) => sum + frame.duration, 0));
  }
  const mask = Uint8Array.from(atob(enemy.idle.frames[0].mask), value => value.charCodeAt(0));
  assert(!maskContains(mask, enemy.maskSize, .01, .01), enemy.id + ' rejects transparent padding');
  assert(maskContains(mask, enemy.maskSize, .5, .5), enemy.id + ' body is hittable');
  assert(!maskContains(mask, enemy.maskSize, 1, .5));
}
assert.equal(sprites.planet.frames.length, 128);
assert.equal(sprites.planet.duration, 12800);
assert.equal(sprites.planet.playbackRate, .45, 'the supplied planet animation plays quietly below its original speed');
await stat(new URL(sprites.planet.image, base));
assert.notEqual(animationFrame(sprites.planet, 3 * sprites.planet.playbackRate), 0);
assert.equal(animationFrame(sprites.enemies[0].idle, .049), 0);
assert.equal(animationFrame(sprites.enemies[0].idle, .05), 1);
assert.equal(animationFrame(sprites.enemies[0].idle, 4.05), 1);
assert.equal(animationFrame(sprites.enemies[0].hit, 10, false), 17);
assert.equal(wrapPosition(111, 10, 100), -9);
assert.equal(wrapPosition(-11, 10, 100), 109);
assert.equal(wrapPosition(50 + 120 * 5, 10, 100), 50);

assert.equal(waveRules(1).total, 5);assert.equal(waveRules(1).maxAlive, 2);
assert(waveRules(1).speed < .15, 'the first wave moves slowly');
for (let wave = 1; wave < 100; wave++) {
  const a = waveRules(wave), b = waveRules(wave + 1);
  assert(b.total > a.total && b.maxAlive > a.maxAlive && b.speed > a.speed, 'all three difficulty parameters increase every wave');
}
let seed = 73;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
const round = new AlienRound({ random });
round.resize(1280, 720);
assert.equal(round.shoot(100, 100, () => true), 'ignored');
round.start();assert.equal(round.aliens.length, 0, 'a wave never dumps all targets onto the screen');
round.step(.69);assert.equal(round.aliens.length, 0);
round.step(.02);assert.equal(round.aliens.length, 1);
round.step(round.rules.spawnInterval - .01);assert.equal(round.aliens.length, 1);
round.step(.02);assert.equal(round.aliens.length, 2);
assert.equal(new Set(round.aliens.map(alien => alien.type)).size, 2, 'both enemy species appear in the first wave');
round.step(80);assert.equal(round.aliens.length, 2);assert.equal(round.spawned, 2);assert.equal(round.wave, 1);
assert.equal(round.waiting, 3, 'concurrency blocks the queue until a slot opens');
assert.equal(round.state, 'playing', 'there is no 60-second ending');
const directions = new Set(Array.from({ length: 200 }, () => round.spawn()).map(a => a.vx ? a.vx > 0 ? 'right' : 'left' : a.vy > 0 ? 'down' : 'up'));
assert.deepEqual(directions, new Set(['left', 'right', 'up', 'down']));

function hitLast(model, contains = () => true) {
  const target = model.aliens.at(-1);
  target.x = model.arena.x + model.arena.width / 2;
  target.y = model.arena.y + model.arena.height / 2;
  return model.shoot(target.x, target.y, contains);
}
assert.equal(hitLast(round, () => false), 'miss');
const removed = round.aliens.at(-1);
assert.equal(hitLast(round), 'hit');assert(!round.aliens.includes(removed));
assert.equal(round.score, 100);assert.equal(round.hits, 1);assert.equal(round.shots, 2);assert.equal(round.accuracy, 50);
assert.equal(round.effects[0].type, removed.type);
assert.equal(round.effects[0].age, 0);
round.step(.54);assert.equal(round.aliens.length, 1, 'a hit does not cause an immediate replacement');
round.step(.02);assert.equal(round.aliens.length, 2);
round.step(1.8);assert.equal(round.effects.length, 0);

const alien = round.aliens[0];
alien.x = round.arena.x + round.arena.width + alien.size / 2 - 1;alien.vx = 1;alien.vy = 0;
round.step(.02);assert(alien.x < round.arena.x);
alien.y = round.arena.y - alien.size / 2 + 1;alien.vy = -1;alien.vx = 0;
round.step(.02);assert(alien.y > round.arena.y + round.arena.height);
const elapsed = round.elapsed;
round.resize(844, 390);assert.equal(round.elapsed, elapsed);assert.equal(alien.size, round.spriteSize * alien.scale);

let guard = 0;
while (round.phase === 'wave' && guard++ < 50) {
  if (round.aliens.length) hitLast(round);
  else round.step(2);
}
assert.equal(round.phase, 'intermission');assert.equal(round.waveDefeated, 5);assert.equal(round.spawned, 5);
assert.equal(round.hits, 5);assert.equal(round.score, 500);assert.equal(round.clearedWaves, 1);
assert.equal(round.shoot(200, 200, () => true), 'ignored', 'intermission shots do not change accuracy');
round.step(WAVE_BREAK_SECONDS - .1);assert.equal(round.wave, 1);
assert.equal(round.step(.11), 'wave-start');assert.equal(round.wave, 2);
assert.equal(round.rules.total, 7);assert.equal(round.rules.maxAlive, 3);assert.equal(round.score, 500);
assert.equal(round.aliens.length, 0, 'the next wave also staggers its first spawn');
for (let i = 0; i < 10; i++) round.step(2);
assert.equal(round.aliens.length, 3);assert.equal(round.spawned, 3);assert.equal(round.waiting, 4);

// Complete many waves without replacing the round or resetting accumulated score.
guard = 0;
while (round.wave < 50 && guard++ < 15000) {
  if (round.phase === 'intermission') round.step(WAVE_BREAK_SECONDS + .01);
  else if (round.aliens.length) hitLast(round);
  else round.step(2);
  assert(round.aliens.length <= round.rules.maxAlive);
  assert(round.spawned <= round.rules.total);
}
assert.equal(round.wave, 50);assert.equal(round.clearedWaves, 49);assert.equal(round.state, 'playing');
assert.equal(round.score, round.hits * 100);
round.start();assert.equal(round.wave, 1);assert.equal(round.score, 0);assert.equal(round.shots, 0);assert.equal(round.elapsed, 0);
round.step(.71);
const clipped = round.aliens.at(-1);clipped.y = round.arena.y - 5;
assert.equal(round.shoot(clipped.x, clipped.y, () => true), 'ignored','outside the screen is not a playable point');

// No HUD bands may cut off playable targets before the real screen edge.
for (const [width,height] of [[1920,1080],[844,390],[390,844],[320,240]]) {
  const edge = new AlienRound({random});edge.resize(width,height);edge.start();
  assert.deepEqual(edge.arena,{x:0,y:0,width,height});
  for (const [x,y] of [[1,height/2],[width-1,height/2],[width/2,1],[width/2,height-1]]) {
    edge.aliens=[{...edge.spawn(),x,y}];
    assert.equal(edge.shoot(x,y,()=>true),'hit','targets remain hittable along all four actual edges');
  }
  const actor={...edge.spawn(),x:width*.3,y:height*.7};edge.aliens=[actor];
  edge.resize(height,width);
  assert(Math.abs(actor.x/height-.3)<1e-9 && Math.abs(actor.y/width-.7)<1e-9,'rotation preserves relative target positions');
  assert(actor.size<Math.min(width,height),'targets fit compact viewports');
}

const shared = new ArcadeGame({ createGame: () => ({ start: () => round.start(), frame: dt => round.step(dt), shoot() {}, dispose() {} }) }, {}, { onPause() {}, restart() {}, playSound() {} });
await shared.load();shared.start();shared.render(100);shared.render(180);
const frozen = { elapsed: round.elapsed, spawned: round.spawned };
shared.pause(true);shared.render(5000);
assert.equal(round.elapsed, frozen.elapsed);assert.equal(round.spawned, frozen.spawned);
shared.pause(false);shared.render(6000);assert.equal(round.elapsed, frozen.elapsed);
shared.render(6016);assert(round.elapsed > frozen.elapsed);
console.log('PASS: two supplied species and quiet planet animation; staggered five-enemy opening; increasing speed/total/concurrency; finite wave budgets, intermissions, 50 endless waves, wrap, hit timing, restart and shared pause');
