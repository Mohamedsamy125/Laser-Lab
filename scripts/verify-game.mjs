import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('../dist',import.meta.url));
const THREE=await import('../dist/vendor/three.module.js');
const {GLTFLoader}=await import('../dist/vendor/addons/loaders/GLTFLoader.js');
const {ZombieGame,STATIONS}=await import('../dist/game.js');
const {batchStaticScene}=await import('../dist/scene-batching.js');
const mirroredRoot=new THREE.Group(),triangle=new THREE.BufferGeometry();triangle.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));triangle.computeVertexNormals();const mirrored=new THREE.Mesh(triangle,new THREE.MeshBasicMaterial());mirrored.scale.x=-1;mirroredRoot.add(mirrored);mirroredRoot.updateMatrixWorld(true);const mirrorRay=new THREE.Raycaster(new THREE.Vector3(-.2,.2,1),new THREE.Vector3(0,0,-1));assert(mirrorRay.intersectObject(mirrored).length);const mirrorBatch=batchStaticScene(mirroredRoot);mirrorBatch.batches.updateMatrixWorld(true);assert(mirrorRay.intersectObject(mirrorBatch.batches,true).length,'mirrored static geometry must retain its front face after batching');
const {WaveQueue,FloorNavigation}=await import('../dist/waves.js');
globalThis.self=globalThis;
function noTextures(file){
 const b=fs.readFileSync(file),n=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+n).toString());
 for(const m of j.materials||[]){for(const k of Object.keys(m))if(k.endsWith('Texture'))delete m[k];for(const k of Object.keys(m.pbrMetallicRoughness||{}))if(k.endsWith('Texture'))delete m.pbrMetallicRoughness[k];}
 delete j.textures;delete j.images;
 const raw=Buffer.from(JSON.stringify(j)),pad=(4-raw.length%4)%4,jb=Buffer.concat([raw,Buffer.alloc(pad,32)]),tail=b.subarray(20+n),out=Buffer.alloc(20+jb.length+tail.length);
 out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(jb.length,12);out.writeUInt32LE(0x4e4f534a,16);jb.copy(out,20);tail.copy(out,20+jb.length);return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);
}
GLTFLoader.prototype.loadAsync=async function(path){return await this.parseAsync(noTextures(new URL(path,new URL('../dist/',import.meta.url))),'');};
const q=new WaveQueue(10,5);for(let i=0;i<5;i++)assert(q.spawn(i));assert(!q.spawn(9));assert.equal(q.pending,5);assert(q.defeat(2));assert(!q.defeat(2));assert(q.spawn(6));assert.equal(q.live.size,5);assert.equal(q.pending,4);
const g=Object.create(ZombieGame.prototype);Object.assign(g,{callbacks:{change:()=>{},error:m=>{throw Error(m);}},scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(65,16/9,.075,100),renderer:{capabilities:{getMaxAnisotropy:()=>1}},enemies:[],debris:[],effects:[],obstacles:[],floors:[],solids:[],markers:{},serial:0,raycaster:new THREE.Raycaster()});g.placeCamera(0);await g.load();
assert.equal(g.lightingMode,'lab');
assert.equal(g.lights.fixtures.length,14);
assert.equal(g.lights.ceiling.castShadow,false);
assert(g.lights.ambient.intensity>0 && g.lights.ceiling.intensity>0);
for(const light of [g.lights.hemisphere,g.lights.key,g.lights.fill,g.lights.ambient,g.lights.ceiling]){
  assert(light.color.r<light.color.g && light.color.r<light.color.b,'room lights stay outside the red/pink detector range');
}
const firstFixture=g.lights.ceiling.position.clone();
g.placeCamera(3);
assert(!firstFixture.equals(g.lights.ceiling.position),'ceiling light follows the visible rooms');
g.setLighting('previous');
assert.equal(g.lights.ambient.intensity,0);
assert.equal(g.lights.ceiling.intensity,0);
assert.equal(g.renderer.toneMappingExposure,1.05);
g.setLighting('color');
g.placeCamera(0);
assert(firstFixture.equals(g.lights.ceiling.position));
console.log('PASS: cool room lighting uses 14 fixture locations and switches back to the previous lighting');
const triangles=geometry=>(geometry.index?geometry.index.count:geometry.attributes.position.count)/3;assert.equal(g.solids.reduce((n,m)=>n+triangles(m.geometry),0),g.staticRendering.batches.children.reduce((n,m)=>n+triangles(m.geometry),0),'batching must preserve every static triangle');
assert(g.staticRendering.after<g.staticRendering.before*.5,'spatial batches should substantially reduce static draw submissions');console.log('STATIC DRAW BATCHES',g.staticRendering.before,'->',g.staticRendering.after);
const resize=Object.create(ZombieGame.prototype);
let size={width:1920,height:1080},ratio;
resize.canvas={getBoundingClientRect:()=>size};
resize.renderer={setPixelRatio:value=>{ratio=value;},setSize(){}};
resize.camera=new THREE.PerspectiveCamera();
resize.setQuality('high');assert.equal(ratio,1,'1080p display renders at its full native width');
globalThis.devicePixelRatio=2;
size={width:1280,height:720};
resize.resize();assert.equal(ratio,2,'high quality can reach 1440p on high-density screens');
resize.setQuality('balanced');assert.equal(ratio,1);
resize.setQuality('performance');assert.equal(ratio,.85);
delete globalThis.devicePixelRatio;
const d=g.diagnostics();console.log('REAL ASSET NAVIGATION',JSON.stringify(d));assert.deepEqual(d.clips.sort(),['Attack','Idle','Running']);assert(d.floors>5);
for(const s of d.stations){assert(s.path>0,'spawn has no path: '+s.name);assert(s.transition>0,'camera has no path: '+s.name);}
g.start({total:10,cap:5,difficulty:'easy'});g.update(3.1);g.update(.1);assert.equal(g.wave.live.size,5);assert.equal(g.wave.pending,5);assert.equal(g.enemies.length,5);

const {BASE_PALETTE, PALETTE_PRESETS, normalizePalette, palettePreset}=await import('../dist/scene-palette.js');
const originalLight=g.lights.ceiling.color.clone();
const wallBatch=g.staticRendering.batches.children.find(batch=>batch.material.name==='M_Lab_Wall');
const floorBatch=g.staticRendering.batches.children.find(batch=>batch.material.name==='M_Lab_Floor');
const trimBatch=g.staticRendering.batches.children.find(batch=>batch.material.name==='M_Lab_Trim');
const originalWallMap=wallBatch.material.map;
const activeRobot=g.enemies[0].materials[0];
g.setPalette(PALETTE_PRESETS.lightPetrol);
assert(wallBatch.material.color.g>1 && floorBatch.material.color.b>1 && trimBatch.material.color.g>1);
assert(activeRobot.color.b>1);
assert(g.lights.ceiling.color.equals(new THREE.Color(PALETTE_PRESETS.lightPetrol.light)));
assert(g.renderer.toneMappingExposure>1.1);
assert.equal(wallBatch.material.map,originalWallMap);
const robotMesh=g.robot.getObjectByProperty('isMesh',true);
assert(robotMesh.material.color.equals(activeRobot.color),'new and existing enemies use the same palette');
g.setPalette(BASE_PALETTE);
for(const material of [wallBatch.material,floorBatch.material,trimBatch.material,activeRobot,robotMesh.material])
  assert(material.color.equals(new THREE.Color(1,1,1)));
assert(g.lights.ceiling.color.equals(originalLight));
assert.equal(palettePreset(g.palette),'original');
assert.equal(palettePreset(normalizePalette({...BASE_PALETTE,brightness:149})),'custom');
assert.equal(normalizePalette({wall:'wrong',brightness:160}).brightness,150);
assert.equal(normalizePalette({wall:'wrong'}).wall,BASE_PALETTE.wall);
console.log('PASS: live palette changes separate materials, current and future robots, light tint and exposure; original settings restore exactly');

const shotEnemy=g.enemies[0];shotEnemy.root.position.set(17,0,2);shotEnemy.root.rotation.y=0;shotEnemy.mixer.setTime(.1);g.scene.updateMatrixWorld(true);g.camera.updateMatrixWorld();
const bounds=new THREE.Box3().setFromObject(shotEnemy.model,true);console.log('ANIMATED ROBOT BOUNDS',bounds.min.toArray(),bounds.max.toArray());
const torso=new THREE.Vector3((bounds.min.x+bounds.max.x)/2,bounds.min.y+(bounds.max.y-bounds.min.y)*.57,(bounds.min.z+bounds.max.z)/2).project(g.camera);
const result=g.shoot({x:(torso.x+1)/2,y:(1-torso.y)/2});console.log('REAL SKINNED HIT',result);assert(['hit','headshot'].includes(result.kind),'projected torso must hit real skinned mesh');

// Cover blocks torso hits even when an enemy is directly behind it.
const cover=g.lab.getObjectByName('Cover_02_High'),coverBox=new THREE.Box3().setFromObject(cover);const cx=(coverBox.min.x+coverBox.max.x)/2;g.camera.position.set(cx,1.72,coverBox.max.z+3);g.camera.lookAt(cx,1,coverBox.min.z-2);shotEnemy.root.position.set(cx,0,coverBox.min.z-2);g.scene.updateMatrixWorld(true);g.camera.updateMatrixWorld();
const hiddenTorso=new THREE.Vector3(cx,.9,coverBox.min.z-2).project(g.camera);const blocked=g.shoot({x:(hiddenTorso.x+1)/2,y:(1-hiddenTorso.y)/2});console.log('COVER SHOT',blocked);assert.equal(blocked.kind,'blocked');
// A deliberate miss still uses ammunition; empty magazines reload automatically.
for(let i=0;i<10;i++)g.shoot({x:.98,y:.02});assert.equal(g.ammo,0);assert(g.reloading>0);g.update(1.5);assert.equal(g.ammo,12);assert.equal(g.reloading,0);
g.placeCamera(0);
shotEnemy.root.position.set(17,0,2);shotEnemy.root.rotation.y=0;shotEnemy.mixer.setTime(.1);
g.scene.updateMatrixWorld(true);g.camera.updateMatrixWorld();
const finalShot=g.shoot({x:(torso.x+1)/2,y:(1-torso.y)/2});
assert.equal(finalShot.killed,true);
assert(shotEnemy.fall.hips && shotEnemy.fall.nodes.length>=20);
const standingY=shotEnemy.fall.hips.position.y;
const initialArm=shotEnemy.fall.nodes.find(j=>j.name==='LeftArm').bone.quaternion.clone();
for(let i=0;i<85;i++)g.update(1/60);
assert(shotEnemy.fall.hips.position.y < standingY*.7,'robot drops toward the floor');
assert(shotEnemy.fall.nodes.every(j=>j.position.y>=j.radius+shotEnemy.fall.floorY-1e-8));
assert(initialArm.angleTo(shotEnemy.fall.nodes.find(j=>j.name==='LeftArm').bone.quaternion)>.1,'the rig articulates as it falls');
assert.equal(shotEnemy.root.scale.x,1,'falling robot keeps its full size');
g.update(.8);assert(!g.enemies.includes(shotEnemy),'corpse is cleaned up after settling');
console.log('PASS: lethal shot drives the supplied rig to the floor before cleanup');

g.start({total:10,cap:5,difficulty:'easy'});g.update(3.1);
const e=g.enemies[0];const startPositions=g.enemies.map(enemy=>enemy.root.position.clone());
for(let i=0;i<30;i++)g.update(.05);
assert(g.enemies.some((enemy,index)=>enemy.root.position.distanceTo(startPositions[index])>.3));

g.pause(true);const held=e.root.position.clone();g.update(.5);assert.equal(e.root.position.distanceTo(held),0);g.pause(false);
// Trace a shot through real cover geometry and the supplied skinned character.
const kill=e=>{if(e.deadAt===null){g.wave.defeat(e.id);e.deadAt=g.time;}};
kill(e);g.update(.5);assert.equal(g.wave.live.size,5);assert.equal(g.wave.pending,4);
for(let wave=0;wave<5;wave++){
 assert.equal(g.station,wave);
 let budget=100;
 while(!g.wave.complete&&budget--){for(const enemy of g.enemies)kill(enemy);g.update(.5);g.update(.5);}
 assert(g.wave.complete);g.update(.2);assert.equal(g.state,'cleared');g.update(4);
 if(wave<4){let t=2000;while(g.state==='transition'&&t--)g.update(.05);assert(t>0);assert.equal(g.station,wave+1);g.update(3.1);g.update(.1);}
 else assert.equal(g.state,'won');
}
console.log('PASS: real GLBs and all 3 clips; 5 spawn routes and 4 camera transitions; cap/replacement; movement/pause; all 5 wave completion');

const {ROBOT_SPACING, PLAYER_GAP, distanceSquared}=await import('../dist/crowd.js');
for(let station=0;station<STATIONS.length;station++){
  g.start({total:10,cap:10,difficulty:'easy'});
  g.beginWave(station);
  g.update(3.1);
  let reached=0, attackers=0;
  for(let i=0;i<650;i++){
    g.health=100;
    g.update(.08);
    const living=g.enemies.filter(enemy=>enemy.deadAt===null);
    reached=living.filter(enemy=>enemy.pathIndex===enemy.path.length).length;
    attackers=living.filter(enemy=>enemy.action==='Attack').length;
    assert.equal(new Set(living.map(enemy=>enemy.slot)).size,living.length,'standing positions must be exclusive');
    for(let a=0;a<living.length;a++){
      const p=living[a].root.position;
      assert(distanceSquared(p,g.camera.position)>=PLAYER_GAP ** 2 - 1e-8);
      for(let b=a+1;b<living.length;b++)assert(distanceSquared(p,living[b].root.position)>=ROBOT_SPACING ** 2 - 1e-8);
    }
    if(reached===10)break;
  }
  console.log('FORMATION',station+1,'arrived',reached,'attackers',attackers);
  assert.equal(g.wave.live.size,10);
  assert.equal(reached,10,'every robot reaches a clear position in room '+(station+1));
  assert(attackers>0 && attackers<=3);
  const fallen=g.enemies.find(enemy=>enemy.action==='Attack');
  const vacated=fallen.slot;
  kill(fallen);
  g.update(.08);
  assert(g.enemies.some(enemy=>enemy.deadAt===null&&enemy.slot===vacated),
    'a waiting robot should advance when an attack position clears');
}
console.log('PASS: 10 robots stay separated at spawn, along the routes and in front of the player in all five rooms');
