import assert from 'node:assert/strict';
import { ArcadeGame, findGame, listGames } from '../dist/games/catalog.js';

const mount = {};
const paused = [];
const shots = [];
const steps = [];
let starts = 0;
let loaded = false;
let disposed = false;
let finishRound;

const game = new ArcadeGame({
  createGame(context) {
    assert.equal(context.mount, mount);
    assert.equal(typeof context.restart, 'function');
    assert.equal(typeof context.playSound, 'function');
    assert.equal(typeof context.finish, 'function');
    finishRound = context.finish;
    return {
      async load() { loaded = true; },
      start() { starts++; },
      frame(dt) { steps.push(dt); },
      shoot(uv) { shots.push(uv); },
      dispose() { disposed = true; },
    };
  },
}, mount, {
  restart() {},
  playSound() {},
  onPause(value) { paused.push(value); },
});

assert.equal(game.state, 'loading');
await game.load();
assert.equal(game.state, 'ready');
assert.ok(loaded);
game.shoot({ x: 0, y: 0 });
game.render(50);
assert.deepEqual(shots, []);
assert.deepEqual(steps, []);

game.start();
game.render(100);
game.render(116);
game.shoot({ x: 0, y: 0 });
game.shoot({ x: 1, y: 1 });
game.shoot({ x: 1.001, y: 0 });
game.shoot({ x: NaN, y: 0 });
assert.deepEqual(shots, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
assert.equal(game.shots, 2);
assert.deepEqual(steps, [0, 0.016]);

game.pause(true);
game.render(200);
game.shoot({ x: 0.5, y: 0.5 });
assert.equal(game.shots, 2);
assert.equal(steps.length, 2);
game.pause(false);
game.render(300);
assert.deepEqual(paused, [true, false]);
assert.equal(steps.at(-1), 0);

game.start();
assert.equal(starts, 2);
assert.equal(game.shots, 0);
game.setQuality('high');

finishRound();
assert.equal(game.state, 'finished');
const finishedShots = game.shots, finishedSteps = steps.length;
game.pause(true);game.shoot({x:.5,y:.5});game.render(1000);
assert.equal(game.paused, false, 'finished games do not open the shared pause panel');
assert.equal(game.shots, finishedShots, 'finished games reject laser and pointer shots');
assert.equal(steps.length, finishedSteps, 'finished games stop updating');
game.start();assert.equal(game.state, 'playing', 'restart reopens the shared lifecycle');
game.dispose();
assert.ok(disposed);
assert.equal(findGame('../vendor'), null);
for (const entry of listGames()) assert.deepEqual(findGame(entry.slug), entry);

console.log('PASS: game lifecycle, normalized input, pause timing, restart, and registered slugs');
