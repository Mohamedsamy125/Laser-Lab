import assert from 'node:assert/strict';
import {LaserCamera} from '../dist/camera.js';
import {shootWithFeedback} from '../dist/shot-feedback.js';
const elements=new Map();
function element(id=''){
 const context={drawImage(){},save(){},restore(){},clearRect(){},translate(){},scale(){},beginPath(){},rect(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},getImageData:(x,y,w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)})};
 return {id,dataset:{},hidden:false,textContent:'',value:id==='resolution'?'640':id==='sensitivity'?'50':id==='colorMode'?'red':'',disabled:false,width:640,height:360,readyState:2,currentTime:0,videoWidth:1280,videoHeight:720,srcObject:null,classList:{add(){},remove(){},toggle(){}},getContext:()=>context,replaceChildren(){},add(){},setAttribute(){},play:async()=>{}};
}
globalThis.document={hidden:false,getElementById:id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},createElement:()=>element()};
globalThis.window={isSecureContext:true,addEventListener(){}};globalThis.Option=class{};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{enumerateDevices:async()=>[]}}});
let events=[],progress=[];const camera=new LaserCamera({calibrating:(...e)=>events.push(e),progress:p=>progress.push(p)});camera.loadCV=async()=>{};
const track={stop(){},getSettings:()=>({deviceId:'rear'})};camera.stream={getTracks:()=>[track],getVideoTracks:()=>[track]};camera.ready=true;
let closed=0,grabbed=0;camera.imageCapture={grabFrame:async()=>{grabbed++;return {width:1280,height:720,close(){closed++;}};}};
camera.lastVideo=0;
// ImageCapture must supply fresh input even when HTMLVideoElement.currentTime is frozen.
const bitmap=await camera.readFrame(performance.now());assert(bitmap);assert.equal(camera.captureMode,'track');assert.equal(grabbed,1);assert.equal(bitmap.width,1280);bitmap.close();assert.equal(closed,1);
// If the API is unsupported/broken, use a genuinely advancing video frame.
camera.imageCapture={grabFrame:async()=>{throw Error('unsupported');}};camera.video.currentTime=1;
const fallback=await camera.readFrame(performance.now());assert(fallback);assert.equal(camera.captureMode,'video');assert.equal(fallback.source,camera.video);
assert.equal(await camera.readFrame(performance.now()),null);
// Late results from a timed-out capture release their bitmap.
let late;camera.imageCapture={grabFrame:()=>new Promise(resolve=>late=resolve)};
await assert.rejects(camera.grabFrame(5),/timeout/);late({close(){closed++;}});await new Promise(setImmediate);assert.equal(closed,2);
// A stopped camera must end calibration without another decoded video frame.
camera.calibrating=true;camera.scanStartedAt=100;camera.lastCameraFrame=100;camera.framesAtScanStart=0;camera.receivedFrames=0;camera.scanDeadline=22000;camera.scanningAfter=1500;
camera.watchCapture(4000);assert.equal(camera.calibrating,false);assert.equal(camera.ready,false);assert.match(camera.error,/وقف أثناء المعايرة/);assert.deepEqual(events.at(-1),[false,false]);
// A live camera keeps scanning past the former 20-second deadline.
camera.ready=true;camera.calibrating=true;camera.scanStartedAt=100;camera.lastCameraFrame=22000;camera.receivedFrames=20;camera.scanDeadline=21000;
camera.watchCapture(22001);assert.equal(camera.calibrating,true);assert(progress.at(-1).frames===20);
// End-to-end controller: three matching frames lock the perspective mapping,
// even though the video's currentTime never advances while the panel is hidden.
events=[];camera.error='';camera.lastVideoAt=0;camera.imageCapture={grabFrame:async()=>({width:1280,height:720,close(){closed++;}})};camera.retryGrabAt=0;
const points=[{x:.10,y:.10},{x:.90,y:.15},{x:.85,y:.90},{x:.08,y:.84}];camera.frameDetector={detect:()=>points};camera.detector.detect=()=>null;
await camera.beginAuto();camera.scanningAfter=0;camera.nextFrameScan=0;camera.drawPreview=()=>{};
for(let i=0;i<3;i++){camera.lastTick=0;camera.nextFrameScan=0;await camera.tick(performance.now()+100);}
assert(camera.matrix);assert.equal(camera.calibrating,false);assert.deepEqual(events.at(-1),[false,true]);assert.equal(camera.receivedFrames,23);assert.equal(camera.busy,false);

// Continue scanning with the panel hidden and update a moving display without
// calling save() again, closing UI, or rearming a held laser beam.
let found=points;camera.frameDetector.detect=()=>found;camera.latched=true;
const original=camera.corners.map(p=>({...p})),beforeChecks=camera.frameChecks,beforeUpdates=camera.frameUpdates,beforeEvents=events.length;
found=points.map(p=>({x:p.x+.015,y:p.y}));camera.nextFrameScan=0;camera.scanFrame({},performance.now()+300);
assert(camera.frameChecks>beforeChecks);assert(camera.frameUpdates>beforeUpdates);assert(camera.corners[0].x>original[0].x);assert.equal(camera.latched,true);assert.equal(events.length,beforeEvents);
// Loss marks the last mapping unusable, then the same stream reacquires it.
const lostAt=camera.lastFrameFound+1500;found=null;camera.nextFrameScan=0;camera.scanFrame({},lostAt);camera.updateTrackingStatus(lostAt);
assert.equal(camera.trackingState,'lost');assert.equal(camera.mappingUsable(lostAt),false);assert.match(elements.get('frameTrackingStatus').textContent,/مفقود/);
found=points.map(p=>({x:p.x-.04,y:p.y}));
for(let i=0;i<3;i++){camera.nextFrameScan=0;camera.scanFrame({},lostAt+300+i*300);}
camera.updateTrackingStatus(lostAt+900);assert.equal(camera.trackingState,'tracking');assert(camera.mappingUsable(lostAt+900));
// Candidate ROI is passed to the laser detector. The raw image is never blacked
// out, and a found point can trigger again only after a genuine blank gap.
let fillCount=0,shots=[],sounds=[];const game={state:'playing',paused:false,shoot:p=>shots.push(p)};
camera.pc.fill=()=>fillCount++;camera.callbacks.shot=p=>shootWithFeedback(game,p,name=>sounds.push(name));camera.latched=false;camera.nextFrameScan=Infinity;camera.lastFrameFound=performance.now();
camera.detector.detect=(data,w,h,roi)=>{assert.deepEqual(roi,camera.corners);return {x:.4,y:.4};};
for(let i=0;i<2;i++){camera.lastTick=0;await camera.tick(performance.now()+100);}
assert.equal(shots.length,1);assert.equal(fillCount,0);
camera.detector.detect=()=>null;camera.lastTick=0;await camera.tick(performance.now()+100);assert.equal(camera.latched,false,'one fresh blank image rearms even a brief interruption');
camera.detector.detect=()=>({x:.4,y:.4});camera.lastTick=0;await camera.tick(performance.now()+100);assert.equal(shots.length,2);
// A lost mapping blocks shots even if the red/green spot remains visible.
camera.lastFrameFound=performance.now()-1600;camera.lastTick=0;camera.latched=false;await camera.tick(performance.now()+100);assert.equal(shots.length,2);

// Old worker replies must never fire a delayed shot after recalibration/restart.
const fresh={epoch:camera.epoch,generation:camera.generation,capturedAt:performance.now(),matrix:camera.matrix,spot:{x:.4,y:.4},ms:2};camera.lastFrameFound=performance.now();camera.latched=false;
camera.receiveSpot({...fresh,epoch:fresh.epoch-1});camera.receiveSpot({...fresh,generation:fresh.generation-1});camera.receiveSpot({...fresh,capturedAt:performance.now()-500});assert.equal(shots.length,2);
camera.receiveSpot(fresh);assert.equal(shots.length,3);
// Moving a held beam across many targets never fires or sounds again.
for(let i=0;i<120;i++)camera.receiveSpot({...fresh,capturedAt:performance.now(),spot:{x:.3+(i%20)*.02,y:.4}});
assert.equal(shots.length,3);assert.deepEqual(sounds,['shot','shot','shot']);
// A paused/stalled feed or an old blank reply is not evidence of release.
for(const result of [
  {...fresh,spot:null,capturedAt:performance.now()-500},
  {...fresh,spot:null,epoch:fresh.epoch-1},
  {...fresh,spot:null,generation:fresh.generation-1},
  {...fresh,spot:null,mode:'wrong-mode'},
])camera.receiveSpot(result);
const readFrame=camera.readFrame;camera.readFrame=async()=>null;camera.lastTick=0;await camera.tick(performance.now()+100);camera.readFrame=readFrame;
assert(camera.latched);
camera.receiveSpot({...fresh,capturedAt:performance.now()});assert.equal(shots.length,3);
// Loss of the border, or moving the still-visible beam outside it, cannot
// turn a held laser into automatic fire when it comes back inside.
camera.lastFrameFound=performance.now()-1600;camera.receiveSpot({...fresh,capturedAt:performance.now()});
camera.lastFrameFound=performance.now();camera.receiveSpot({...fresh,capturedAt:performance.now(),spot:{x:0,y:0}});
camera.receiveSpot({...fresh,capturedAt:performance.now()});assert.equal(shots.length,3);
// A genuine blank and reappearance fires once more, without a time delay.
camera.receiveSpot({...fresh,capturedAt:performance.now(),spot:null});assert.equal(camera.latched,false);
camera.receiveSpot({...fresh,capturedAt:performance.now()});camera.receiveSpot({...fresh,capturedAt:performance.now()});
assert.equal(shots.length,4);assert.equal(sounds.length,4);
// Paused and rejected game input never plays gunfire feedback.
game.paused=true;assert.equal(shootWithFeedback(game,{x:.5,y:.5},name=>sounds.push(name)),false);game.paused=false;
assert.equal(shootWithFeedback({...game,shoot:()=>({kind:'ignored'})},{x:.5,y:.5},name=>sounds.push(name)),false);
assert.equal(shootWithFeedback({...game,state:'finished'},{x:.5,y:.5},name=>sounds.push(name)),false);
assert.equal(shootWithFeedback(game,{x:NaN,y:.5},name=>sounds.push(name)),false);
assert.equal(shots.length,4);assert.equal(sounds.length,4);
// Prefer fresh decoded video, and fall back to ImageCapture after it stalls.
camera.lastVideo=-1;camera.lastVideoAt=0;const videoFrame=await camera.readFrame(performance.now());assert.equal(videoFrame.source,camera.video);assert.equal(await camera.readFrame(performance.now()),null);camera.lastVideoAt=performance.now()-250;const trackFrame=await camera.readFrame(performance.now());assert.equal(camera.captureMode,'track');trackFrame.close();
// A stalled live video must be restarted during the game, outside calibration.
let resumes=0;camera.video.play=async()=>{resumes++;};
camera.lastCameraFrame=100;camera.lastResume=0;camera.watchCapture(2000);camera.watchCapture(2250);
assert.equal(resumes,1,'capture watchdog resumes a stalled video and throttles retries');
assert.equal(camera.stream.getVideoTracks()[0],track,'recover without discarding the active stream');
camera.lastCameraFrame=2500;camera.watchCapture(2600);
assert.equal(resumes,1,'healthy video should not be restarted');

const lastMatrix=camera.matrix;
camera.readFrame=async()=>({source:camera.video,width:1280,height:720,close(){}});
elements.get('resolution').value='480';
camera.lastTick=0;await camera.tick(performance.now()+100);
assert.equal(camera.processing.width,480);
assert.equal(camera.matrix,lastMatrix,'resizing an unchanged camera crop preserves the mapping');
let payload;
camera.frameWorker={active:true,busy:false,send(job){payload=job;}};
camera.nextFrameScan=0;const scanAt=performance.now();
camera.scanFrame({width:320,height:180,data:new Uint8ClampedArray(320*180*4)},scanAt);
assert.equal(payload.width,320);
assert.equal(camera.nextFrameScan,scanAt+250,'live frame scan is capped at four checks per second');

// A border-only tick must not copy the concurrently busy full laser frame.
let fullDraws=0,frameDraws=0;
camera.pc.drawImage=()=>fullDraws++;
camera.fc.drawImage=()=>frameDraws++;
camera.spotWorker={busy:true};
camera.preview=false;camera.nextFrameScan=0;camera.lastTick=0;
await camera.tick(performance.now()+100);
assert.equal(fullDraws,0,'skip the full-resolution transfer when only the border worker is ready');
assert.equal(frameDraws,1);
camera.stop();clearInterval(camera.watchTimer);
console.log('PASS: frozen video capture via track; video fallback; timed-out bitmap cleanup; no-frame watchdog; indefinite live-camera search; three-frame homography lock; continuous motion/loss/reacquisition; raw ROI and one-shot laser input without currentTime advancement; in-game camera recovery, stable resolution changes, and capped background scanning.');
