import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { NinjaRun, generateRoute, seededRandom, stopPosition, viewFor, toScreen, toWorld } from '../dist/games/ninja-trail/route.js';
import { ART_FILES, frameAt, containsArt } from '../dist/games/ninja-trail/art.js';
import { ArcadeGame } from '../dist/games/catalog.js';

const assets=new URL('../dist/games/ninja-trail/assets/',import.meta.url);
for(const file of Object.values(ART_FILES))assert((await stat(new URL(file,assets))).size>0);
const timing=JSON.parse(await readFile(new URL('animations/animation_timing.json',assets),'utf8'));
assert.deepEqual([timing.idle_ms.length,timing.run_ms.length,timing.jump_ms.length],[6,8,8]);
assert.equal(frameAt(timing.run_ms,.091),1);assert.equal(frameAt(timing.run_ms,.721),0);
assert.equal(frameAt(timing.idle_ms,.451),1);
const mask=new Uint8Array(6400);mask[40*80+40]=1;
assert(containsArt({wood:{mask}},'wood',.5,.5));assert(!containsArt({wood:{mask}},'wood',.01,.01));

for(let seed=0;seed<160;seed++) {
  const route=generateRoute(seed%20+1,seededRandom(seed));
  assert.equal(new Set(route.barriers.map(b=>b.type)).size,4,'all supplied barrier types appear in every level');
  assert(route.platforms.some(p=>p.height>0),'every route has a climb');
  for(let i=0;i<route.platforms.length;i++) {
    const p=route.platforms[i],previous=route.platforms[i-1];
    if(previous) {
      assert(p.start-previous.end>=32 && p.start-previous.end<=58);
      assert(Math.abs(p.height-previous.height)<=85,'all climbs fit the authored jump');
    }
    const barriers=route.barriers.filter(b=>b.platform===i);
    assert(barriers.length>=1 && barriers.length<=2);
    for(const barrier of barriers) {
      assert(stopPosition(barrier)>p.start+36,'land before stopping at the obstacle');
      assert(barrier.x+barrier.width/2<p.end-20,'obstacles stay on solid ground');
      assert.equal(barrier.y,p.height);
    }
  }
  for(let i=1;i<route.barriers.length;i++)assert(route.barriers[i].x>route.barriers[i-1].x);
}
assert.deepEqual(generateRoute(3,seededRandom(9)),generateRoute(3,seededRandom(9)));
assert.notDeepEqual(generateRoute(3,seededRandom(9)),generateRoute(3,seededRandom(10)));

const run=new NinjaRun({random:seededRandom(24)});run.start();
for(let i=0;i<180;i++)run.step(1/60);
const target=run.target;assert.equal(run.player.motion,'waiting');assert.equal(run.player.x,stopPosition(target));
const waiting=run.player.x;for(let i=0;i<600;i++)run.step(1/60);
assert.equal(run.player.x,waiting,'the ninja never walks through an intact barrier');
assert.equal(run.shoot(target.x,target.y+target.height/2,()=>false),'miss','transparent padding cannot destroy a gate');
const future=run.route.barriers[1];assert.equal(run.shoot(future.x,future.y+future.height/2),'miss','only the next gate can be opened');
assert.equal(run.shoot(target.x,target.y+target.height/2),'hit');
assert.equal(run.player.motion,'running','a successful shot immediately releases the stopped ninja');
assert.equal(run.shoot(target.x,target.y+target.height/2),'miss','a destroyed gate cannot be counted again');
run.step(1/60);assert(run.player.x>waiting);
let sawJump=false,steps=0;
while(run.level<30 && steps++<180000) {
  if(run.player.motion==='jumping')sawJump=true;
  if(run.player.motion==='waiting' && run.target) {
    const b=run.target;assert.equal(run.shoot(b.x,b.y+b.height/2),'hit');
  }
  run.step(.08);
}
assert(sawJump);assert.equal(run.level,30,'random stages remain traversable across thirty levels');assert.equal(run.cleared,29);
for(const [w,h] of [[1920,1080],[844,390],[390,844],[320,240]]) {
  const view=viewFor(w,h,run),b=run.target;
  for(const [x,y] of [[run.player.x,run.player.y],[b.x,b.y+b.height/2]]) {
    const p=toScreen(x,y,view),world=toWorld(p.x/w,p.y/h,view);
    assert(Math.abs(world.x-x)<1e-8 && Math.abs(world.y-y)<1e-8,'screen and laser hit coordinates survive resize');
  }
  const ahead=toScreen(run.player.x+100,run.player.y,view),player=toScreen(run.player.x,run.player.y,view);
  assert(ahead.x<player.x,'progression is from right to left');
}
run.start();assert.equal(run.level,1);assert.equal(run.cleared,0);assert.equal(run.elapsed,0);
const shared=new ArcadeGame({createGame:()=>({start:()=>run.start(),frame:dt=>run.step(dt),shoot(){},dispose(){}})}, {}, {onPause(){},restart(){},playSound(){}});
await shared.load();shared.start();shared.render(100);shared.render(180);
const frozen=JSON.stringify({player:run.player,time:run.elapsed,camera:run.cameraX});
shared.pause(true);shared.render(5000);assert.equal(JSON.stringify({player:run.player,time:run.elapsed,camera:run.cameraX}),frozen);
shared.pause(false);shared.render(6000);assert.equal(JSON.stringify({player:run.player,time:run.elapsed,camera:run.cameraX}),frozen);
shared.render(6016);assert(run.elapsed>.08);
console.log('PASS: supplied ninja art and timing; 160 reachable random layouts; stop/shoot/run/jump; transparent hits and ordered gates; 30 stages; right-to-left input mapping; shared pause and restart');
