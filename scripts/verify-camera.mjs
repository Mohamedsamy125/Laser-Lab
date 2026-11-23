import assert from 'node:assert/strict';
import {LaserCamera} from '../dist/camera.js';
const elements=new Map();
function element(id=''){
 const e={id,dataset:{},hidden:false,textContent:'',value:'',disabled:false,readyState:0,videoWidth:0,videoHeight:0,srcObject:null,classList:{add(){},remove(){},toggle(){}},getContext(){return {};},replaceChildren(){},add(){},setAttribute(){}};
 e.play=async()=>{e.readyState=2;e.videoWidth=1280;e.videoHeight=720;};return e;
}
globalThis.document={hidden:false,getElementById:id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},createElement:()=>element()};
globalThis.window={isSecureContext:true,addEventListener(){}};
globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
let request,stopped=0;
const track={stop(){stopped++;},getSettings:()=>({deviceId:'rear'}),onended:null};
const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
const media={enumerateDevices:async()=>[],getUserMedia:async c=>{request=c;return stream;}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:media}});
let statuses=[];const camera=new LaserCamera({status:s=>statuses.push(s)});camera.loadCV=async()=>{};
assert.equal(await camera.start(),true);assert.equal(request.video.facingMode.ideal,'environment');assert.equal(request.audio,false);assert(camera.ready);assert.equal(camera.video.srcObject,stream);assert(camera.video.muted&&camera.video.playsInline);assert(statuses.at(-1).active);assert.equal(document.getElementById('cameraEmpty').hidden,true);
// Closing the preview is presentation only: capture keeps running for the TV.
camera.preview=false;assert.equal(camera.stream,stream);assert.equal(stopped,0);
camera.stop();assert.equal(stopped,1);assert.equal(camera.ready,false);assert.equal(camera.video.srcObject,null);
// A denied permission remains visible after the final UI refresh.
media.getUserMedia=async()=>{const e=new Error('denied');e.name='NotAllowedError';throw e;};
assert.equal(await camera.start(),false);assert.equal(camera.stream,null);assert.equal(camera.opening,false);assert.match(camera.error,/إذن الكاميرا مرفوض/);assert.equal(document.getElementById('cameraError').hidden,false);assert.match(document.getElementById('cameraError').textContent,/اسمح بالكاميرا/);
// A blocked video play promise must never report a live camera.
media.getUserMedia=async()=>stream;camera.video.play=async()=>{const e=new Error('autoplay blocked');e.name='NotAllowedError';throw e;};assert.equal(await camera.start(),false);assert.equal(camera.ready,false);assert.equal(camera.stream,null);
camera.video.play=async()=>{camera.video.readyState=2;camera.video.videoWidth=1280;camera.video.videoHeight=720;};
// The user can cancel an outstanding browser prompt; late streams are released.
let grant;media.getUserMedia=()=>new Promise(r=>grant=r);const pending=camera.start();assert(camera.opening);assert.equal(document.getElementById('startCamera').disabled,false);document.getElementById('startCamera').onclick();assert.equal(camera.opening,false);const before=stopped;grant(stream);await pending;assert.equal(stopped,before+1);assert.equal(camera.stream,null);
// Check retry and both explicit camera and automatic fallback selections.
document.getElementById('cameraSelect').value='';let attempts=0;media.getUserMedia=async c=>{attempts++;request=c;if(attempts===1){const e=new Error();e.name='OverconstrainedError';throw e;}return stream;};
assert.equal(await camera.start(),true);assert.equal(attempts,2);assert.equal(request.video,true);assert.equal(camera.error,'');camera.stop();
window.isSecureContext=false;assert.equal(await camera.start(),false);assert.match(camera.error,/HTTPS/);assert.equal(camera.stream,null);
console.log('PASS: rear camera request; real-frame readiness; preview hiding keeps capture; persistent permission errors; cancel releases late streams; constraint fallback; HTTPS feedback.');
