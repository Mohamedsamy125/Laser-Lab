import {IsolationSpotDetector,ScreenSpotDetector} from '../dist/isolation-spot.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ColorSpotDetector,rgbHSV} from '../dist/debug-spot.js';
import {LaserSpotDetector} from '../dist/laser-spot.js';
import {DebugState} from '../dist/debug-state.js';
import {DebugCameraSource,isGreenCameraFrame} from '../dist/debug-source.js';
function image(color,radius=3,whiteCore=false){
 const w=160,h=100,data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=Math.hypot(x-80,y-50);let c=d<=radius?color:[25,32,38];if(whiteCore&&d<radius*.45)c=[245,245,245];data.set([...c,255],(y*w+x)*4);}return {data,w,h};
}
const greenPlaceholder=new Uint8ClampedArray(160*100*4);
for(let i=0;i<greenPlaceholder.length;i+=4)greenPlaceholder.set([0,128,0,255],i);
assert(isGreenCameraFrame(greenPlaceholder),'recognize the blank green camera feed');
assert(!isGreenCameraFrame(image([0,128,0],40).data),'a scene with green objects is still a real image');
assert(!isGreenCameraFrame(new Uint8ClampedArray(16)),'a black image is not the green placeholder');
for(const color of [[180,35,65],[35,180,60]])for(const radius of [1,3,5]){
 const i=image(color,radius),spot=new ColorSpotDetector().detect(i.data,i.w,i.h);assert(spot);assert(Math.abs(spot.x-.5)<.015&&Math.abs(spot.y-.5)<.015);
}
const ring=image([30,220,60],5,true),detector=new ColorSpotDetector();assert(detector.detect(ring.data,ring.w,ring.h),'colored halo with white core');
const uniform=image([35,180,60],40);assert.equal(detector.detect(uniform.data,uniform.w,uniform.h),null,'large green region');
const glare=image([240,240,240],3);assert.equal(detector.detect(glare.data,glare.w,glare.h),null,'white glare');
const cyan=image([30,170,230],3);assert.equal(detector.detect(cyan.data,cyan.w,cyan.h),null);assert(detector.detect(cyan.data,cyan.w,cyan.h,{seed:rgbHSV(30,170,230)}),'eyedropper accepts a sampled hue');
assert.equal(detector.detect(ring.data,ring.w,ring.h,{corners:[{x:0,y:0},{x:.2,y:0},{x:.2,y:.2},{x:0,y:.2}]}),null,'optional ROI excludes outside laser');
console.log('PASS: dim red/green spots at three sizes; white core halo; sampled hue; glare/large region rejection; optional ROI');
function offAxisBloom(color,radius=4){
  const {data,w,h}=image([245,245,245],0);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const tone=Math.hypot(x-80,y-50)<=radius?[246,246,246]:
      Math.hypot(x-80-radius,y-50)<=4?color:[25,32,38];
    data.set([...tone,255],(y*w+x)*4);
  }
  return {data,w,h};
}
const hybrid=new LaserSpotDetector();
for(const color of [[236,208,210],[208,235,212],[229,250,230]]){
  const offset=offAxisBloom(color);
  const hit=hybrid.detect(offset.data,offset.w,offset.h);
  assert(hit?.bloom,'hybrid finds a white center with a faint one-sided halo');
  assert(Math.hypot(hit.x*offset.w-80.5,hit.y*offset.h-50.5)<1,'point is mapped from the white center');
  const reflection=offAxisBloom(color,16);
  assert.equal(hybrid.detect(reflection.data,reflection.w,reflection.h),null,'reject broad white glare with a faint colored edge');
}
assert.equal(hybrid.detect(glare.data,glare.w,glare.h),null,'reject a white reflection with no matching halo');
console.log('PASS: hybrid finds red/green one-sided bloom and rejects white reflections');
const state=new DebugState();state.point({x:.5,y:.5},100);assert.equal(state.shots,1);assert.equal(state.uv,null,'raw laser appears without calibration');state.point({x:.5,y:.5},130);assert.equal(state.shots,1);
const corners=[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];for(let n=0;n<3;n++)state.frame(corners,200+n*250);assert(state.matrix);state.point({x:.5,y:.5},710);assert(Math.abs(state.uv.x-.5)<1e-6&&Math.abs(state.uv.y-.5)<1e-6);
state.point(null,711);assert.equal(state.latched,false,'a brief disappearance releases the trigger');state.point({x:.5,y:.5},712);assert.equal(state.shots,2);state.point({x:.6,y:.5},713);assert.equal(state.shots,2,'moving a held beam never repeats a shot');
state.frame(corners.map(p=>({x:p.x+.015,y:p.y})),900);assert(state.corners[0].x>.1,'continuous frame updates');assert.equal(state.fresh(2500),false);state.point({x:.5,y:.5},2500);assert(state.spot);assert.equal(state.uv,null,'missing frame never hides raw laser');assert(state.manualFrame(corners,2600));assert(state.fresh(20000));
console.log('PASS: raw laser without frame; live mapping and motion; one count per beam; loss and manual corners');
globalThis.isSecureContext=true;let stops=0;const track={stop(){stops++;},onended:null},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
let request;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async c=>{request=c;return stream;}}}});
const video={readyState:2,videoWidth:1280,videoHeight:720,currentTime:1,play:async()=>{}},source=new DebugCameraSource(video);
assert(await source.start());assert.equal(request.video.facingMode.ideal,'environment');assert.equal(request.audio,false);assert.equal(video.srcObject,stream);assert.equal((await source.read(1000)).source,video);assert.equal(await source.read(1100),null);
let closed=0;source.capture={grabFrame:async()=>({width:1280,height:720,close(){closed++;}})};const fallback=await source.read(1500);assert.equal(source.mode,'track');fallback.close();assert.equal(closed,1);
source.preferTrack=true;video.currentTime=2;
const preferred=await source.read(1600);assert.notEqual(preferred.source,video,'alternate capture bypasses a playing video element');preferred.close();assert.equal(closed,2);
source.capture={grabFrame:async()=>{throw new Error('unsupported');}};
assert.equal((await source.read(1700)).source,video,'failed alternate capture still provides live video');
video.currentTime=3;assert.equal((await source.read(1800)).source,video,'live video continues during capture backoff');
let releaseFrame;source.retryAt=0;source.capture={grabFrame:()=>new Promise(resolve=>releaseFrame=resolve)};
const staleRead=source.read(1900);source.stop();releaseFrame({close(){closed++;}});assert.equal(await staleRead,null);assert.equal(closed,3,'a frame arriving after stop is released');assert.equal(stops,1);assert.equal(source.retryAt,0,'restart clears capture backoff');source.preferTrack=false;
navigator.mediaDevices.getUserMedia=async()=>{const e=new Error('denied');e.name='NotAllowedError';throw e;};await assert.rejects(source.start(),{name:'NotAllowedError'});assert.equal(source.stream,null);
let grant;navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>grant=resolve);const pending=source.start();assert(source.opening);source.stop();grant(stream);assert.equal(await pending,false);assert.equal(stops,2,'cancelled permission releases a late camera stream');
console.log('PASS: rear camera video; alternate capture with live video fallback; stale frame release; permission cancellation');
navigator.mediaDevices.getUserMedia=async c=>{request=c;return stream;};
assert(await source.start('selected-camera','native'));
assert.deepEqual(request.video,{deviceId:{exact:'selected-camera'}},'native capture leaves resolution and frame rate to the device');source.stop();
assert(await source.start('selected-camera','compatible'));
assert.equal(request.video.width.ideal,640);assert.equal(request.video.height.ideal,480);assert(!('frameRate' in request.video),'compatible capture avoids a forced frame rate');source.stop();
const fallbackRequests=[];
navigator.mediaDevices.getUserMedia=async c=>{fallbackRequests.push(c);if(fallbackRequests.length===1){const e=new Error('format');e.name='OverconstrainedError';throw e;}return stream;};
assert(await source.start('selected-camera','compatible'));
assert.deepEqual(fallbackRequests[1].video,{deviceId:{exact:'selected-camera'}},'constraint fallback must keep the selected camera');source.stop();
console.log('PASS: native and 640x480 capture profiles; image constraint fallback keeps the selected device');
const html=fs.readFileSync(new URL('../dist/debug.html',import.meta.url),'utf8'),js=fs.readFileSync(new URL('../dist/debug.js',import.meta.url),'utf8');assert(!/three\.module|game\.js|\.glb/.test(html+js),'camera-only route must not load the 3D game');
console.log('PASS: standalone diagnostic route has no 3D game imports');

const isolated=new IsolationSpotDetector(), isoWidth=160, isoHeight=100;
function isolationImage({shift=0,spot=null,center=[94,46],large=false}={}){
  const pixels=new Uint8ClampedArray(isoWidth*isoHeight*4);
  for(let y=0;y<isoHeight;y++)for(let x=0;x<isoWidth;x++){
    const background=x<75?[150,36,50]:x<110?[29,63,152]:[30,38,45];
    const lit=spot&&Math.hypot(x-center[0],y-center[1])<=2;
    const color=lit?spot:large&&x>35&&x<95&&y>20&&y<65?[235,215,205]:
      background.map(v=>v+shift);
    pixels.set([...color,255],(y*isoWidth+x)*4);
  }
  return pixels;
}
const readIsolation=image=>isolated.detect(isolationImage(image),isoWidth,isoHeight);
for(const color of [[250,250,250],[252,77,80],[82,250,157]]){
  for(let frame=0;frame<20;frame++){
    const center=[21+frame*6,40+(frame%4)*3];
    const result=readIsolation({spot:color,center,shift:frame%2?27:0});
    assert(result,'the first and every subsequent image must return the visible point');
    assert(Math.hypot(result.x*isoWidth-center[0]-.5,result.y*isoHeight-center[1]-.5)<2.4,'the circle must follow the spot');
  }
  for(let frame=0;frame<20;frame++)assert(readIsolation({spot:color}),'a stationary beam must stay detected');
}
assert.equal(readIsolation(),null,'the detection disappears when the projected spot does');
assert.equal(readIsolation({shift:35,large:true}),null,'reject broad highlights and edges even after the scene changes');
console.log('PASS: no reference capture, persistent tracking on held and moving points, immediate removal, and large highlight rejection');

const screen=new ScreenSpotDetector(), oldTracker=new IsolationSpotDetector();
function brightScreen({beam=null,reflection=false,glare=0,width=160,height=100}={}){
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const inside=x>=12&&x<width-12&&y>=8&&y<height-8;
    const halo=Math.max(0,1-Math.hypot(x-width*.55,y-height*.48)/95);
    const level=inside?224+Math.round((17+glare)*halo):45;
    const isReflection=reflection&&Math.hypot(x-37,y-44)<3;
    const isBeam=beam&&Math.hypot(x-beam[0],y-beam[1])<=3;
    const rgb=isBeam?[255,254,253]:isReflection?[255,255,255]:[level,level,level];
    pixels.set([...rgb,255],(y*width+x)*4);
  }
  return pixels;
}
const screenCenter=[96,57];
const litScreen=brightScreen({beam:screenCenter});
assert.equal(oldTracker.detect(litScreen,160,100),null,'the old detector misses a white spot on the bright screen');
function assertScreenSpot(image,center,epoch=1){
  const point=screen.detect(image,160,100,.5,epoch);
  assert(point,'the faint white core must remain visible against the glare');
  assert(Math.hypot(point.x*160-center[0]-.5,point.y*100-center[1]-.5)<2.5,'the circle must mark the beam center');
}
assertScreenSpot(litScreen,screenCenter);
for(let frame=0;frame<8;frame++){
  const center=[96+frame,57];
  assertScreenSpot(brightScreen({beam:center,glare:6}),center);
}
assert.equal(screen.detect(brightScreen({glare:6}),160,100,.5,1),null,'broad glare alone must not appear as a beam');
screen.detect(brightScreen({reflection:true}),160,100,.5,2);
for(let frame=0;frame<10;frame++)assertScreenSpot(brightScreen({beam:screenCenter,reflection:true}),screenCenter,2);
assert.equal(screen.detect(new Uint8ClampedArray(160*100*4).fill(255),160,100,.5,2),null,'a uniformly clipped camera frame has no localized signal');
console.log('PASS: before/after washed-out-screen regression, continuous tracking, reflection rejection, and full clipping');
