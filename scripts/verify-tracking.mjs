import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath}from'node:url';
import {FrameDetector,SpotDetector,homography,projectPoint} from '../dist/tracking.js';
import {LaserSpotDetector} from '../dist/laser-spot.js';
const require=createRequire(import.meta.url),temp=fs.mkdtempSync(path.join(os.tmpdir(),'laser-cv-test-'));
const moduleFile=path.join(temp,'opencv.cjs');fs.copyFileSync(fileURLToPath(new URL('../dist/vendor/opencv.js',import.meta.url)),moduleFile);
let cv=require(moduleFile);if(!cv.Mat)await new Promise(resolve=>cv.then(m=>{cv=m;resolve();}));
const width=640,height=480,outer=[{x:.10,y:.12},{x:.89,y:.18},{x:.86,y:.88},{x:.07,y:.79}];
const center=outer.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});
let inset=.035;
let inner=outer.map(p=>({x:p.x*(1-inset)+center.x*inset,y:p.y*(1-inset)+center.y*inset}));
const within=(x,y,quad)=>{let sign=0;for(let i=0;i<4;i++){const a=quad[i],b=quad[(i+1)%4],c=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);if(sign&&Math.sign(c)!==sign)return false;sign=Math.sign(c);}return true;};
function image(color='red',options={}){
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,a=within(x/width,y/height,outer),b=within(x/width,y/height,inner);let c=a&&!b?(options.border||[0,106,255]):b?(options.inside||[17,29,36]):(options.outside||[41,48,52]);if(options.gap&&x>=320&&x<322&&y<130)c=options.outside||[41,48,52];if(options.missingBottom&&y>360)c=[41,48,52];
  const r=Math.hypot(x-300,y-240);if(r<2)c=[255,255,255];else if(r<7)c=color==='green'?[35,255,65]:[255,40,100];
  data.set([...c,255],i);
 }return {width,height,data};
}
const frame=new FrameDetector(cv);
for(const color of ['red','green']){
 const input=image(color),corners=frame.detect(input);assert(corners,'blue frame must be found against a blue-gray camera scene');
 assert(corners.every((p,i)=>Math.hypot(p.x-inner[i].x,p.y-inner[i].y)<.02));
 const matrix=homography(corners),spotDetector=new SpotDetector();spotDetector.mode=color;
 const spot=spotDetector.detect(input.data,width,height);assert(spot,'laser '+color);assert(Math.abs(spot.x-300/width)<.01);assert(Math.abs(spot.y-240/height)<.01);
 const uv=projectPoint(matrix,spot);assert(uv&&uv.x>0&&uv.x<1&&uv.y>0&&uv.y<1);
 console.log('PASS:',color,'laser + perspective frame ->',uv);
}
// Regression from the user's TV: cyan frame and blue interior merge under
// the former broad blue mask, leaving no hole for contour detection.
for(const [name,options]of[
 ['cyan on blue TV',{border:[0,255,255],inside:[15,65,220],outside:[140,135,100]}],
 ['blue on blue TV',{border:[0,106,255],inside:[15,65,220],outside:[140,135,100]}],
 ['dim cyan',{border:[15,125,135],inside:[10,25,70]}],
 ['washed-out blue',{border:[130,170,210],inside:[70,90,110]}],
 ['small ring gaps',{border:[0,240,255],inside:[15,65,220],gap:true}]
]){
 const detected=new FrameDetector(cv).detect(image('red',options));assert(detected,name+' must be found');assert(detected.every((p,i)=>Math.hypot(p.x-inner[i].x,p.y-inner[i].y)<.025),name+' must map the inner edge');console.log('PASS:',name);
}
assert.equal(new FrameDetector(cv).detect(image('red',{border:[0,106,255],inside:[0,106,255]})),null,'a solid blue region must not calibrate');
assert.equal(new FrameDetector(cv).detect(image('red',{missingBottom:true})),null,'a missing side must not invent a rectangle');
const picked=new FrameDetector(cv);assert.equal(picked.setColor(240,240,240),false);assert(picked.setColor(0,255,255));assert.equal(picked.seed.hex,'#00FFFF');assert(picked.detect(image('red',{border:[0,255,255],inside:[15,65,220]})));picked.resetColor();assert.equal(picked.seed,null);
// Runtime tracking uses the last successful color pass most of the time.
assert(frame.detect(image(),{fast:true}));

function spotImage({color='red',radius=2,dim=false,white=false,distractor=false,flat=false}={}){
 const w=128,h=96,data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let c=[40,45,50];const r=Math.hypot(x-70,y-48);
  if(flat?x>=50&&x<=90&&y>=28&&y<=68:r<=radius)c=white?[240,240,240]:color==='green'?(dim?[45,175,65]:[35,240,65]):dim?[175,55,80]:[245,40,75];
  if(distractor&&Math.hypot(x-15,y-15)<2)c=[255,20,50];
  data.set([...c,255],(y*w+x)*4);
 }return {data,width:w,height:h};
}
const roi=[{x:.3,y:.2},{x:.9,y:.2},{x:.9,y:.8},{x:.3,y:.8}];
for(const color of ['red','green'])for(const radius of [1,2,5,10]){
 const input=spotImage({color,radius,dim:true,distractor:color==='red'}),detector=new SpotDetector();detector.mode=color;
 const spot=detector.detect(input.data,input.width,input.height,roi);assert(spot,`dim ${color} radius ${radius}`);assert(Math.abs(spot.x-70/128)<.02);assert(Math.abs(spot.y-48/96)<.02);
}
for(const input of [spotImage({white:true}),spotImage({flat:true})])assert.equal(new SpotDetector().detect(input.data,input.width,input.height),null,'white glare and a large flat color region must not act as a laser');
const weak=spotImage({dim:true});const sensitivity=new SpotDetector();sensitivity.mode='red';sensitivity.sensitivity=0;assert.equal(sensitivity.detect(weak.data,weak.width,weak.height),null);sensitivity.sensitivity=.8;assert(sensitivity.detect(weak.data,weak.width,weak.height));
console.log('PASS: dim red/green spots at four sizes; bright outside distractor rejected; sensitivity affects dim cores; white/flat-region rejection');
for(const whiteRadius of [1,3,6]){
 const input=spotImage(),w=input.width,h=input.height;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const r=Math.hypot(x-70,y-48);let color=[40,45,50];if(r<=whiteRadius)color=[245,245,245];else if(r<=whiteRadius+6)color=[255,40,75];input.data.set([...color,255],(y*w+x)*4);
 }
 const spot=new SpotDetector().detect(input.data,w,h);assert(spot,'white laser core radius '+whiteRadius);assert(Math.abs(spot.x-70/w)<.02&&Math.abs(spot.y-48/h)<.02);
}
console.log('PASS: small and broad white laser cores preserve colored-halo detection');

// A clipped white core can have both diagonals and cardinal directions
// surrounded by a halo too pale for the old detector at default sensitivity.
function paleGlow(halo,background=[75,85,95],whiteCore=true){
 const width=320,height=180,x=145,y=37;
 const data=new Uint8ClampedArray(width*height*4);
 for(let py=0;py<height;py++)for(let px=0;px<width;px++){
  const r=Math.hypot(px-x,py-y);
  const rgb=whiteCore&&r<3?[250,250,250]:r<7?halo:background;
  data.set([...rgb,255],(py*width+px)*4);
 }
 return {data,width,height,x,y};
}
const redPixelDetector=new LaserSpotDetector();
redPixelDetector.mode='fast-red';
const pixelWidth=16,pixelHeight=12,pixelFrame=new Uint8ClampedArray(pixelWidth*pixelHeight*4);
const setPixel=(x,y,r,g,b)=>pixelFrame.set([r,g,b,255],4*(y*pixelWidth+x));
setPixel(0,0,255,255,255);
setPixel(1,0,0,255,0);
setPixel(2,0,14,35,250);
assert.equal(redPixelDetector.detect(pixelFrame,pixelWidth,pixelHeight),null,'fast red ignores white, blue and green');
setPixel(8,6,106,75,64);
setPixel(15,11,255,0,0);
const inside=[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
const pixel=redPixelDetector.detect(pixelFrame,pixelWidth,pixelHeight,inside);
assert.equal(pixel.x,8.5/pixelWidth,'one red pixel is enough inside the screen, even with brighter red outside');
assert.equal(pixel.y,6.5/pixelHeight);
redPixelDetector.sensitivity=0;
assert.equal(redPixelDetector.detect(pixelFrame,pixelWidth,pixelHeight,inside),null,'fast red honors the sensitivity control');
console.log('PASS: fast red mode picks a single in-frame pixel and rejects neutral/other colors');

const combined=new LaserSpotDetector(),prior=new SpotDetector();
for(const [color,halo] of [['green',[174,205,184]],['red',[211,177,184]]]){
 const input=paleGlow(halo);
 prior.mode=color;
 combined.mode=color;
 assert.equal(prior.detect(input.data,input.width,input.height),null,'former failure '+color);
 const spot=combined.detect(input.data,input.width,input.height);
 assert(spot,'combined detector must find the pale halo '+color);
 assert(Math.abs(spot.x*input.width-(input.x+.5))<1&&Math.abs(spot.y*input.height-(input.y+.5))<1);
 combined.mode=color==='red'?'green':'red';
 assert.equal(combined.detect(input.data,input.width,input.height),null,'color filter still applies');
}
combined.mode='auto';
for(const input of [paleGlow([210,210,210]),paleGlow([174,205,184],[75,85,95],false)]){
 assert.equal(combined.detect(input.data,input.width,input.height),null,'pale region without a colored halo and bright core');
}
const outside=paleGlow([174,205,184]);
assert.equal(combined.detect(outside.data,outside.width,outside.height,roi.map(p=>({...p,y:p.y+.25}))),null);
console.log('PASS: shared detector recovers pale red/green halos with clipped white cores; rejects uncolored glare and outside points');

// A thicker blue ring must still map its INNER corners, preserving hit coordinates.
inset=.10;inner=outer.map(p=>({x:p.x*(1-inset)+center.x*inset,y:p.y*(1-inset)+center.y*inset}));
const thick=frame.detect(image());assert(thick);assert(thick.every((p,i)=>Math.hypot(p.x-inner[i].x,p.y-inner[i].y)<.02));
console.log('PASS: thick frame inner corners remain the mapping boundary');
const transform=homography(inner);
for(let i=0;i<4;i++){const uv=projectPoint(transform,inner[i]),expected=[[0,0],[1,0],[1,1],[0,1]][i];assert(Math.abs(uv.x-expected[0])<1e-8);assert(Math.abs(uv.y-expected[1])<1e-8);}
assert.equal(homography([{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}]),null);
fs.rmSync(temp,{recursive:true,force:true});console.log('PASS: normalized screen mapping and invalid-frame rejection');

const coreHaloDetector = new LaserSpotDetector();
coreHaloDetector.mode = 'red-halo';
for (const [shade, background, hasCore] of [
  [[18, 2, 7], [7,14,15], false],
  [[125, 15, 44], [75, 85, 95], false],
  [[226, 62, 166], [75, 85, 95], false],
  [[211, 48, 237], [75, 85, 95], false],
  [[239, 231, 237], [75, 85, 95], false],
  [[248, 219, 238], [75, 85, 95], true],
  [[220, 23, 82], [75, 85, 95], true],
]) {
  const {data,width,height,x,y}=paleGlow(shade,background,hasCore);
  const point=coreHaloDetector.detect(data,width,height);
  assert(point,'core and halo detector sees shade '+shade);
  assert.equal(point.bloom,hasCore);
  assert(Math.hypot(point.x*width-x-.5,point.y*height-y-.5)<1);
}
for(const input of [paleGlow([210,210,210]),paleGlow([7,0,1],[2,4,6],false),paleGlow([21,105,133])]){
  assert.equal(coreHaloDetector.detect(input.data,input.width,input.height),null,'reject white-only glare, near-black noise and blue-green scene lights');
}
const coreHaloFrame=paleGlow([244,110,206]);
assert.equal(coreHaloDetector.detect(coreHaloFrame.data,coreHaloFrame.width,coreHaloFrame.height,[{x:.02,y:.05},{x:.25,y:.05},{x:.25,y:.90},{x:.02,y:.90}]),null,'reject a laser outside the calibrated frame');
const edgeFrame=new Uint8ClampedArray(640*480*4);
edgeFrame.set([186,54,111,255],(120*640)*4);
const edgePoint=coreHaloDetector.detect(edgeFrame,640,480);
assert.equal(edgePoint.x,.5/640,'retain single-pixel spots on the frame edge');
console.log('PASS: red/pink core and halo preserves dark, pale and single-pixel spots; verifies both axes around the core and rejects neutral glare');
