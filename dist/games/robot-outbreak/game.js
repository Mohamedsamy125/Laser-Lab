import * as THREE from '../../vendor/three.module.js';
import { GLTFLoader } from '../../vendor/addons/loaders/GLTFLoader.js';
import { clone } from '../../vendor/addons/utils/SkeletonUtils.js';
import { WaveQueue, FloorNavigation } from './waves.js';
import { ROBOT_SPACING, PLAYER_GAP, distanceSquared, makeFormation, findClearSpawn, stepAlongRoute } from './crowd.js';
import { RobotFall, CORPSE_LIFETIME } from './robot-fall.js';
import { batchStaticScene } from './scene-batching.js';
import { BASE_PALETTE, normalizePalette } from './scene-palette.js';

const V = (x,y,z) => new THREE.Vector3(x,y,z);
const LIGHTING = {
  lab: {
    sky:'#b5d2d6', ground:'#658b93', hemisphere:2.9,
    key:'#aed2d9', keyIntensity:2.55, fill:'#89b7c8', fillIntensity:1.6,
    ambient:.9, ceiling:34, exposure:1.1
  },
  previous: {
    sky:'#c1e9ef', ground:'#334954', hemisphere:2.55,
    key:'#c1e7e9', keyIntensity:2.25, fill:'#a1e6ff', fillIntensity:1.1,
    ambient:0, ceiling:0, exposure:1.05
  }
};

export const STATIONS = [
  { name:'قاعة المعايرة', camera:[18,1.72,5.9], look:[19,1.15,-7], spawn:'Spawn_W1' },
  { name:'غرفة الماكينات', camera:[40,1.72,-.3], look:[39,1.15,-13], spawn:'Spawn_W2' },
  { name:'المعمل الرئيسي', camera:[65.1,1.72,6.6], look:[63,1.15,-6], spawn:'Spawn_W3' },
  { name:'المدخل الخلفي', camera:[63,1.72,-4.5], look:[67,1.15,10], spawn:'Spawn_W4' },
  { name:'قاعة الاحتواء', camera:[88,1.72,8.6], look:[89,1.15,-6], spawn:'Spawn_W5' }
];
export class ZombieGame {
  constructor(canvas, callbacks={}) {
    this.canvas=canvas;this.callbacks=callbacks;this.state='loading';this.paused=false;
    this.time=0;this.last=0;this.serial=0;this.enemies=[];this.debris=[];this.stats={};this.effects=[];
    this.quality='high';
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#122c36');
    this.scene.fog=new THREE.FogExp2('#173c47',.012);
    this.camera=new THREE.PerspectiveCamera(65,16/9,.075,100);
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.setClearColor('#142f38');
    this.raycaster=new THREE.Raycaster();this.obstacles=[];this.solids=[];this.floors=[];this.markers={};
    this.placeCamera(0);this.resize();new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);
  }
  sliceObstacle(mesh,height) {
    const geometry=mesh.geometry,positions=geometry.attributes.position,index=geometry.index;
    const count=index?index.count:positions.count;
    for(let i=0;i<count;i+=3){
      const triangle=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(positions,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld));
      const points=[];
      for(let k=0;k<3;k++){const a=triangle[k],b=triangle[(k+1)%3];if((a.y<=height&&b.y>height)||(b.y<=height&&a.y>height))points.push(a.clone().lerp(b,(height-a.y)/(b.y-a.y)));}
      if(points.length===2)this.obstacles.push({name:mesh.name,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))});
    }
  }
  resize() {
    const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return;
    const pixelRatio=globalThis.devicePixelRatio||1;
    const high=this.quality==='high';
    const cap=high?2:this.quality==='balanced'?1:.85;
    const maxSize=high?2560:this.quality==='balanced'?1400:1100;
    const budget=high?Math.sqrt((2560*1440)/(r.width*r.height)):Infinity;
    this.renderer.setPixelRatio(Math.min(pixelRatio,cap,maxSize/r.width,maxSize/r.height,budget));
    this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();
  }
  async load() {
    const loader=new GLTFLoader();let loaded=0;
    const read=async(path)=>{const data=await loader.loadAsync(new URL(path,import.meta.url).href);loaded++;this.callbacks.loading?.(loaded/2);return data;};
    const [lab,robot]=await Promise.all([read('./assets/environments/calibration-lab.glb'),read('./assets/characters/zombie-robot.glb')]);
    this.lab=lab.scene;this.robot=robot.scene;this.clips=robot.animations;
    // The FBX clips include travelling hips. Keep the pose's vertical motion and
    // remove horizontal root travel; the navigation system owns world movement.
    const hips=this.robot.getObjectByName('mixamorigHips')||this.robot.getObjectByName('mixamorig:Hips');
    // Track components are in the parent (Blender Z-up armature) coordinate space.
    // The exported Armature rotates local Z into world Y; local X/Y are horizontal.
    for(const clip of this.clips)for(const track of clip.tracks){
      if(/Hips\.position$/.test(track.name))for(let i=0;i<track.values.length;i+=3){track.values[i]=hips?.position.x||0;track.values[i+1]=hips?.position.y||0;}
    }
    this.scene.add(this.lab);this.lab.updateMatrixWorld(true);
    this.configureLighting();
    this.lab.traverse(o=>{if(/Door_.*_Leaf/.test(o.name))o.visible=false;});
    const box=new THREE.Box3(),size=new THREE.Vector3();
    this.lab.traverse(o=>{
      if(o.name.startsWith('Spawn_'))this.markers[o.name]=o.getWorldPosition(new THREE.Vector3());
      if(!o.isMesh)return;
      for(let p=o;p;p=p.parent)if(!p.visible)return;
      o.castShadow=false;o.receiveShadow=false;
      if(/Door_.*_Leaf/.test(o.name)){o.visible=false;return;}
      this.solids.push(o);
      box.setFromObject(o);box.getSize(size);
      const rect={name:o.name,minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z};
      if(/_Floor$/.test(o.name)){this.floors.push(rect);return;}
      if(box.min.y<.9&&box.max.y>.55&&!/CornerTrims|Chevrons|Ceiling|LightFixtures|Catwalk|Pipes/.test(o.name)&&Math.min(size.x,size.z)<5&&size.x>.03&&size.z>.03){
        if(/Door|Header/.test(o.name)) this.sliceObstacle(o,.65);
        else this.obstacles.push(rect);
      }
      const materials=Array.isArray(o.material)?o.material:[o.material];
      for(const m of materials){if(m.map)m.map.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());}
    });
    this.navigation=new FloorNavigation(this.floors,this.obstacles);
    this.staticRendering=batchStaticScene(this.lab);this.scene.add(this.staticRendering.batches);this.scene.matrixAutoUpdate=false;
    // A shadow contact disc is cheaper on mobile than multiple dynamic shadow maps.
    this.shadowGeometry=new THREE.CircleGeometry(.36,20);
    this.shadowMaterial=new THREE.MeshBasicMaterial({color:'#061a22',transparent:true,opacity:.45,depthWrite:false});
    this.particleGeometry=new THREE.BoxGeometry(.055,.055,.055);
    this.particleMaterial=new THREE.MeshBasicMaterial({color:'#62b8bc'});
    this.robotScale=2.15;
    this.setPalette(this.palette);
    this.state='ready';this.snapshot();return this;
  }
  configureLighting() {
    const hemisphere=new THREE.HemisphereLight(), key=new THREE.DirectionalLight(), fill=new THREE.DirectionalLight();
    const ambient=new THREE.AmbientLight('#648992');
    const ceiling=new THREE.PointLight('#6fb8c0',0,18,2);
    key.position.set(10,16,12);
    fill.position.set(-10,8,-8);
    this.scene.add(hemisphere,key,fill,ambient,ceiling);
    const fixtures=[];
    const bounds=new THREE.Box3();
    this.lab.traverse(object=>{
      if(!object.isMesh||!object.name.endsWith('_LightFixtures'))return;
      const center=bounds.setFromObject(object).getCenter(new THREE.Vector3());
      center.y-=.6;
      fixtures.push(center);
    });
    this.lights={hemisphere,key,fill,ambient,ceiling,fixtures};
    this.setLighting(this.lightingMode);
  }
  setLighting(mode) {
    this.lightingMode=mode==='previous'?'previous':'lab';
    const preset=LIGHTING[this.lightingMode];
    this.renderer.toneMappingExposure=preset.exposure*(this.palette?.brightness ?? 100)/100;
    if(!this.lights)return;
    const {hemisphere,key,fill,ambient,ceiling,fixtures}=this.lights;
    hemisphere.color.set(preset.sky);
    hemisphere.groundColor.set(preset.ground);
    hemisphere.intensity=preset.hemisphere;
    key.color.set(preset.key);
    key.intensity=preset.keyIntensity;
    fill.color.set(preset.fill);
    fill.intensity=preset.fillIntensity;
    ambient.intensity=preset.ambient;
    ceiling.intensity=fixtures.length?preset.ceiling:0;
    ambient.color.set('#648992');
    ceiling.color.set(BASE_PALETTE.light);
    const lightColor = this.palette?.light ?? BASE_PALETTE.light;
    if (lightColor !== BASE_PALETTE.light) {
      const tint = new THREE.Color(lightColor);
      hemisphere.color.lerp(tint,.35);
      key.color.lerp(tint,.55);
      fill.color.lerp(tint,.55);
      ambient.color.lerp(tint,.45);
      ceiling.color.copy(tint);
    }
    this.updateCeilingLight(1);
  }
  setPalette(value) {
    this.palette = normalizePalette(value);
    this.setLighting(this.lightingMode);
    if (!this.staticRendering?.batches) return;
    const labels = {M_Lab_Wall:'wall', M_Lab_Floor:'floor', M_Lab_Trim:'trim'};
    const gains = {};
    for (const key of ['wall', 'floor', 'trim', 'robot']) {
      const reference = new THREE.Color(BASE_PALETTE[key]), selected = new THREE.Color(this.palette[key]);
      // The map still supplies its own surface detail. Ratios above one let a
      // selected color lift the original albedo rather than only darken it.
      gains[key] = new THREE.Color(selected.r/reference.r, selected.g/reference.g, selected.b/reference.b);
    }
    for (const batch of this.staticRendering.batches.children) {
      const gain = gains[labels[batch.material.name]];
      if (gain) batch.material.color.copy(gain);
    }
    this.robot.traverse(object => {
      if (object.isMesh) object.material.color.copy(gains.robot);
    });
    for (const enemy of this.enemies) {
      for (const material of enemy.materials) material.color.copy(gains.robot);
    }
  }
  updateCeilingLight(weight) {
    if(!this.lights?.ceiling.intensity)return;
    const {ceiling,fixtures}=this.lights;
    const {x,z}=this.camera.position;
    const dx=this.look.x-x, dz=this.look.z-z;
    const ahead=2.5/Math.max(1,Math.hypot(dx,dz));
    const targetX=x+dx*ahead, targetZ=z+dz*ahead;
    // Reuse one shadowless light across rooms. Crossfading its position
    // during transitions keeps the scene from jumping between fixtures.
    let nearest=fixtures[0], bestDistance=Infinity;
    for(const fixture of fixtures){
      const distance=(fixture.x-targetX)**2+(fixture.z-targetZ)**2;
      if(distance<bestDistance){nearest=fixture;bestDistance=distance;}
    }
    ceiling.position.lerp(nearest,weight);
  }
  placeCamera(index) {
    const s=STATIONS[index];this.camera.position.fromArray(s.camera);this.look=V(...s.look);this.camera.lookAt(this.look);
    this.updateCeilingLight(1);
  }
  start(settings={}) {
    this.clearActors();this.settings={total:Math.max(1,Math.min(60,Math.round(settings.total||10))),cap:Math.max(1,Math.min(10,Math.round(settings.cap||5))),difficulty:settings.difficulty||'normal'};
    this.health=100;this.score=0;this.kills=0;this.shots=0;this.hits=0;this.ammo=12;this.reloading=0;this.station=0;
    this.paused=false;this.time=0;this.placeCamera(0);this.beginWave(0);this.callbacks.event?.('start');
  }
  beginWave(index) {
    this.station=index;this.placeCamera(index);this.wave=new WaveQueue(this.settings.total+index*2,this.settings.cap);
    this.spawnMarker=this.markers[STATIONS[index].spawn];
    this.formation=makeFormation(this.navigation,this.camera.position,this.look,this.spawnMarker,this.wave.cap);
    this.state='countdown';this.countdown=3;this.fillAt=0;this.snapshot();
  }
  pause(value) {this.paused=Boolean(value);this.last=0;this.snapshot();}
  clearActors() {
    for(const e of this.enemies){this.scene.remove(e.root,e.shadow);e.mixer.stopAllAction();for(const m of e.materials)m.dispose();}
    for(const p of this.debris)this.scene.remove(p.mesh);
    this.enemies=[];this.debris=[];this.effects=[];
  }
  routeEnemy(from, slot, avoid = null) {
    const player = this.camera.position;
    const buffers = this.formation.filter(other => other !== slot &&
      distanceSquared(other.point, from) >= ROBOT_SPACING ** 2).map(other => other.point);
    if (avoid) {
      for (const other of this.enemies) {
        if (other !== avoid && other.deadAt === null) buffers.push(other.root.position);
      }
    }
    return this.navigation.path(from, slot.point, point => distanceSquared(point, player) < PLAYER_GAP ** 2 ||
      buffers.some(body => distanceSquared(point, body) < ROBOT_SPACING ** 2));
  }
  promoteWaitingEnemies() {
    const living = this.enemies.filter(enemy => enemy.deadAt === null);
    for (const slot of this.formation) {
      if (!slot.attack || living.some(enemy => enemy.slot === slot)) continue;
      const waiting = living.filter(enemy => !enemy.slot.attack)
        .sort((a, b) => distanceSquared(a.root.position, slot.point) - distanceSquared(b.root.position, slot.point));
      for (const enemy of waiting) {
        const path = this.routeEnemy(enemy.root.position, slot);
        if (!path.length) continue;
        Object.assign(enemy, {slot, path, pathIndex:0, attackAt:0});
        break;
      }
    }
  }
  makeEnemy() {
    const slot = this.formation.find(place => !this.enemies.some(enemy => enemy.deadAt === null && enemy.slot === place));
    if (!slot) return false;
    const origin = findClearSpawn(this.navigation, this.spawnMarker, this.enemies);
    if (!origin) return false;
    const path = this.routeEnemy(origin, slot);
    if (!path.length) return false;
    const id = ++this.serial;
    if (!this.wave.spawn(id)) return false;

    const model=clone(this.robot),root=new THREE.Group();model.scale.setScalar(this.robotScale);root.add(model);
    const materials=[];model.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.material=o.material.clone();o.material.roughness=.7;materials.push(o.material);}});
    root.position.set(origin.x,.015,origin.z);this.scene.add(root);
    const shadow=new THREE.Mesh(this.shadowGeometry,this.shadowMaterial);shadow.rotation.x=-Math.PI/2;shadow.position.copy(root.position);shadow.position.y=.025;this.scene.add(shadow);
    const mixer=new THREE.AnimationMixer(model),actions={};
    for(const clip of this.clips)actions[clip.name]=mixer.clipAction(clip);
    const e={id,root,model,shadow,mixer,actions,materials,slot,path,pathIndex:0,hp:2,speed:1.12+this.station*.09,action:'',attackAt:0,flash:0,deadAt:null,repathAt:0};
    this.setAction(e,'Running');e.mixer.update(Math.random()*.6);this.enemies.push(e);
    return true;
  }
  updateLivingEnemy(enemy, dt) {
    if (enemy.pathIndex < enemy.path.length) {
      const oldWaypoint = enemy.pathIndex;
      const heading = stepAlongRoute(this.navigation, this.enemies, enemy, this.camera.position, dt);
      if (enemy.pathIndex !== oldWaypoint) enemy.repathAt = this.time + .6;
      if (heading !== null) {
        enemy.root.rotation.y += Math.atan2(Math.sin(heading - enemy.root.rotation.y), Math.cos(heading - enemy.root.rotation.y)) * Math.min(1, dt * 9);
        this.setAction(enemy, 'Running');
      }
      if (enemy.pathIndex < enemy.path.length && this.time >= enemy.repathAt) {
        enemy.repathAt = this.time + .65 + .04 * (enemy.id % 5);
        const route = this.routeEnemy(enemy.root.position, enemy.slot, enemy);
        if (route.length > 1) {
          enemy.path = route;
          enemy.pathIndex = 1;
        }
        if (heading === null) this.setAction(enemy, 'Idle');
      }
    } else {
      const player = this.camera.position, at = enemy.root.position;
      enemy.root.rotation.y = Math.atan2(player.x - at.x, player.z - at.z);
      this.setAction(enemy, enemy.slot.attack ? 'Attack' : 'Idle');
      if (enemy.slot.attack) this.updateAttack(enemy);
    }
    enemy.shadow.position.x = enemy.root.position.x;
    enemy.shadow.position.z = enemy.root.position.z;
  }
  updateAttack(enemy) {
    if (!enemy.attackAt) enemy.attackAt = this.time + .8;
    if (this.time < enemy.attackAt) return;
    const easy=this.settings.difficulty==='easy';
    this.health=Math.max(0,this.health-(easy?4:8));enemy.attackAt=this.time+(easy?2.5:1.8);
    this.callbacks.damage?.();this.callbacks.event?.('damage');this.snapshot();
    if (!this.health) {this.state='lost';this.callbacks.event?.('lost');this.snapshot();}
  }
  updateCorpse(enemy, dt) {
    const elapsed = this.time - enemy.deadAt;
    if (elapsed >= CORPSE_LIFETIME) return false;
    enemy.fall?.update(dt);
    if (enemy.fall?.hips) {
      const {x,z} = enemy.fall.hips.position;
      enemy.shadow.position.x = x;
      enemy.shadow.position.z = z;
    }
    const opacity = Math.min(1, (CORPSE_LIFETIME - elapsed) / .36);
    if (opacity < 1) {
      for (const material of enemy.materials) {
        if (!material.transparent) {
          material.transparent = true;
          material.depthWrite = false;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
      }
      enemy.shadow.scale.setScalar(opacity);
    }
    return true;
  }
  setAction(e,name) {
    if(e.action===name)return;const previous=e.actions[e.action],next=e.actions[name]||e.actions.Idle;
    previous?.fadeOut(.2);next?.reset().fadeIn(.2).play();e.action=name;
  }
  reload() {
    if(this.state!=='playing'||this.paused||this.reloading||this.ammo===12)return;
    this.reloading=1.4;this.callbacks.event?.('reload');this.snapshot();
  }
  shoot(uv) {
    if(this.state!=='playing'||this.paused||this.reloading||uv.x<0||uv.x>1||uv.y<0||uv.y>1)return {kind:'ignored'};
    if(!this.ammo){this.reload();return {kind:'ignored'};}
    this.ammo--;this.shots++;this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(uv.x*2-1,1-uv.y*2),this.camera);
    let hitEnemy=null,hit=null;
    for(const e of this.enemies){
      if(e.deadAt!==null)continue;
      e.model.traverse(o=>{if(o.isSkinnedMesh)o.computeBoundingSphere();});
      const intersections=this.raycaster.intersectObject(e.model,true);
      if(intersections.length&&(!hit||intersections[0].distance<hit.distance)){hit=intersections[0];hitEnemy=e;}
    }
    const wall=this.raycaster.intersectObjects(this.solids,false)[0];
    let result={kind:'miss',uv};
    if(hit&&(!wall||hit.distance<wall.distance+.025)){
      this.hits++;const head=hit.point.y-hitEnemy.root.position.y>1.40;
      hitEnemy.hp-=head?2:1;hitEnemy.flash=.16;this.score+=head?50:25;this.burst(hit.point,9);
      let killed=false;
      if(hitEnemy.hp<=0){
        killed=true;hitEnemy.deadAt=this.time;this.wave.defeat(hitEnemy.id);this.kills++;this.score+=head?150:100;
        const impulse=this.raycaster.ray.direction.clone().setY(0).normalize().multiplyScalar(head?2.0:1.65);
        hitEnemy.fall=new RobotFall(hitEnemy.model,impulse,hitEnemy.root.position.y-.015,this.navigation);
        for(const material of hitEnemy.materials)material.emissive.set(0);
        this.burst(hit.point,15);this.fillAt=this.time+.45;
      }
      result={kind:head?'headshot':'hit',killed,uv};
      this.callbacks.event?.(killed?'kill':'hit');
    } else {
      if(wall){this.burst(wall.point,5);result.kind='blocked';}
      this.callbacks.event?.('miss');
    }
    this.effects.push({...result,until:this.time+.35});
    if(!this.ammo)this.reload();
    this.callbacks.shot?.(result);this.snapshot();return result;
  }
  burst(point,count) {
    for(let i=0;i<count;i++){
      const mesh=new THREE.Mesh(this.particleGeometry,this.particleMaterial);mesh.position.copy(point);this.scene.add(mesh);
      this.debris.push({mesh,velocity:V((Math.random()-.5)*2,Math.random()*2,(Math.random()-.5)*2),life:.3+Math.random()*.25});
    }
  }
  transition() {
    this.state='transition';this.travelIndex=0;this.travelPath=this.navigation.path(this.camera.position,V(...STATIONS[this.station+1].camera));
    if(!this.travelPath.length){this.state='error';this.callbacks.error?.('تعذّر حساب مسار الانتقال.');return;}
    this.travelTarget=V(...STATIONS[this.station+1].look);this.snapshot();
  }
  update(dt) {
    if(this.paused||['loading','ready','error','won','lost'].includes(this.state))return;
    this.time+=dt;
    if(this.reloading>0){this.reloading-=dt;if(this.reloading<=0){this.reloading=0;this.ammo=12;this.snapshot();}}
    if(this.state==='countdown'){
      const before=Math.ceil(this.countdown);this.countdown-=dt;if(before!==Math.ceil(this.countdown))this.snapshot();
      if(this.countdown<=0){this.state='playing';this.callbacks.event?.('wave');this.snapshot();}
    }
    if(this.state==='playing'){
      if(this.time>=this.fillAt&&this.enemies.filter(enemy=>enemy.deadAt===null&&enemy.slot.attack).length<3){
        this.promoteWaitingEnemies();
      }
      if(this.time>=this.fillAt&&this.wave.slots>0){
        const count=this.wave.slots;
        let spawned=0;
        while(spawned<count&&this.makeEnemy())spawned++;
        if(spawned<count)this.fillAt=this.time+.15;
        if(spawned)this.snapshot();
      }
      if(this.wave.complete){
        this.state='cleared';this.clearTimer=3.5;this.health=Math.min(100,this.health+15);this.ammo=12;this.reloading=0;
        this.callbacks.event?.('clear');this.snapshot();
      }
    }
    if(this.state==='cleared'){
      this.clearTimer-=dt;
      if(this.clearTimer<=0){if(this.station>=STATIONS.length-1){this.state='won';this.snapshot();}else this.transition();}
    }
    if(this.state==='transition'){
      const target=this.travelPath[this.travelIndex];
      if(target){
        const direction=V(target.x,this.camera.position.y,target.z).sub(this.camera.position),distance=direction.length();
        if(distance<.08)this.travelIndex++;
        else{direction.normalize();this.camera.position.addScaledVector(direction,Math.min(distance,dt*3.7));
          const ahead=target===this.travelPath.at(-1)?this.travelTarget:this.camera.position.clone().addScaledVector(direction,4);
          this.look.lerp(ahead,Math.min(1,dt*2));this.camera.lookAt(this.look);
          this.updateCeilingLight(1-Math.exp(-dt*3));}
      }else this.beginWave(this.station+1);
    }
    for(let i=this.enemies.length-1;i>=0;i--){
      const e=this.enemies[i];
      if(e.deadAt!==null){
        if(!this.updateCorpse(e,dt)){
          this.scene.remove(e.root,e.shadow);e.mixer.stopAllAction();for(const m of e.materials)m.dispose();this.enemies.splice(i,1);
        }
        continue;
      }
      e.mixer.update(dt);
      if(e.flash>0){e.flash-=dt;for(const m of e.materials)m.emissive.set(e.flash>0?'#63d6ed':'#000000');}
      if(this.state==='playing')this.updateLivingEnemy(e,dt);
    }
    for(let i=this.debris.length-1;i>=0;i--){const p=this.debris[i];p.life-=dt;p.velocity.y-=dt*4;p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.rotation.x+=dt*4;p.mesh.scale.setScalar(Math.min(1,p.life*4));if(p.life<=0){this.scene.remove(p.mesh);this.debris.splice(i,1);}}
    this.effects=this.effects.filter(e=>e.until>this.time);
  }
  render(now) {
    const dt=this.last?Math.min((now-this.last)/1000,.08):0;this.last=now;this.update(dt);this.renderer.render(this.scene,this.camera);
  }
  setQuality(value){
    this.quality=['high','balanced','performance'].includes(value)?value:'high';
    this.resize();
  }
  snapshot() {
    this.callbacks.change?.({state:this.state,paused:this.paused,station:this.station||0,location:STATIONS[this.station||0].name,wave:(this.station||0)+1,waves:STATIONS.length,total:this.wave?.total||0,alive:this.wave?.live.size||0,pending:this.wave?.pending||0,defeated:this.wave?.defeated||0,health:this.health??100,score:this.score||0,kills:this.kills||0,shots:this.shots||0,hits:this.hits||0,ammo:this.ammo??12,reloading:this.reloading>0,countdown:Math.max(1,Math.ceil(this.countdown||0))});
  }
  diagnostics() {
    return {state:this.state,clips:this.clips?.map(c=>c.name),floors:this.floors.length,obstacles:this.obstacles.length,stations:STATIONS.map(s=>({name:s.name,path:this.navigation?.path(this.markers[s.spawn],V(...s.camera)).length,transition:this.navigation?.path(V(...s.camera),V(...STATIONS[Math.min(STATIONS.indexOf(s)+1,4)].camera)).length}))};
  }
}
