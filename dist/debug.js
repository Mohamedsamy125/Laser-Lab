import {VisionChannel} from './vision-channel.js?v=7';
import {FrameDetector} from './tracking.js?v=7';
import {rgbHSV} from './debug-spot.js?v=11';
import {LaserSpotDetector} from './laser-spot.js?v=18';
import {DebugState} from './debug-state.js?v=8';
import {DebugCameraSource,isGreenCameraFrame} from './debug-source.js?v=10';
const $=id=>document.getElementById(id),video=$('video'),source=new DebugCameraSource(video),state=new DebugState(),frameColor=new FrameDetector(null),detector=new LaserSpotDetector();
const cameraDisplay=$('cameraDisplay'),cameraContext=cameraDisplay.getContext('2d');
let greenPreview=false;
const pixels=document.createElement('canvas'),pc=pixels.getContext('2d',{willReadFrequently:true}),small=document.createElement('canvas'),sc=small.getContext('2d',{willReadFrequently:true}),demoView=$('demoView'),dc=demoView.getContext('2d'),overlay=$('overlay'),oc=overlay.getContext('2d'),map=$('screenMap'),mc=map.getContext('2d');
let epoch=0,demo=false,busy=false,spotWorker=null,frameWorker=null,pickedLaser=null,picking='',manualPoints=[],nextScan=0,nextFull=0,lastTick=0,lastResult=0,spotMs=0,frameMs=0,resultAge=0,cameraCount=0,laserCount=0,lastStats=performance.now(),cameraFps=0,laserFps=0,lastUI=0,lastDraw=0,frameFailed=false;
const active=()=>demo||!!source.stream;
function error(text=''){$('error').hidden=!text;$('error').textContent=text;}
function describeError(e){return ({NotAllowedError:'إذن الكاميرا مرفوض. اسمح بالكاميرا من إعدادات الموقع ثم جرّب تاني.',NotFoundError:'مفيش كاميرا متاحة هنا. افتح الرابط من الموبايل، أو استخدم المحاكاة لفحص الواجهة.',NotReadableError:'الكاميرا مشغولة. اقفل أي تطبيق بيستخدمها ثم جرّب تاني.'})[e.name]||e.message;}
function updateControls(){
  $('start').textContent=source.opening?'إلغاء طلب الكاميرا':source.stream?'إيقاف الكاميرا':'تشغيل الكاميرا';
  $('demo').textContent=demo?'إنهاء المحاكاة':'محاكاة بدون كاميرا';$('empty').hidden=active();video.hidden=demo;demoView.hidden=!demo;
  if(demo||!source.stream||$('previewMode').value==='video')cameraDisplay.hidden=true;
  for(const id of ['pickLaser','pickFrame','manual'])$(id).disabled=!active();
  $('pickHint').hidden=!picking;
  $('pickHint').textContent=picking==='laser'?'المس هالة الليزر الملونة في صورة الكاميرا':picking==='frame'?'المس الخط الأزرق أو السماوي في صورة الكاميرا':'المس الركن الداخلي '+['فوق شمال','فوق يمين','تحت يمين','تحت شمال'][manualPoints.length];
  $('pickedColors').textContent=(pickedLaser?'ليزر '+pickedLaser.hex:'لون الليزر تلقائي')+' · '+(frameColor.seed?'إطار '+frameColor.seed.hex:'لون الإطار تلقائي');
}
function receivePoint(r){
  const now=performance.now();if(r.epoch!==epoch||!active()||greenPreview)return;resultAge=now-r.capturedAt;spotMs=r.ms;laserCount++;
  if(resultAge>500){$('liveBadge').textContent='التحليل متأخر · النتيجة القديمة متجاهلة';return;}
  lastResult=now;state.point(r.spot,now);draw(now);updatePointUI(now);
}
function initFrame(){
  if(!$('findFrame').checked||frameWorker)return;if(typeof Worker!=='function'){frameFailed=true;return;}
  try{
    frameFailed=false;frameWorker=new VisionChannel(new URL('./frame-worker.js?v=7',import.meta.url),{type:'classic',timeout:5000,onresult:r=>{
      const now=performance.now();if(r.epoch!==epoch||!active())return;frameMs=r.ms;if(now-r.capturedAt>1500)return;
      state.frame(r.found,r.capturedAt);if(!r.found)nextFull=0;draw(now);
    },onerror:()=>{frameWorker=null;frameFailed=true;error('تعذّر البحث التلقائي عن الإطار. كشف الليزر مستمر، وتقدر تحدد الأركان يدويًا.');}});
    frameWorker.ready.catch(()=>{});
  }catch{frameWorker=null;frameFailed=true;}
}
function initWorkers(){
  if(typeof Worker==='function'&&!spotWorker)try{
    spotWorker=new VisionChannel(new URL('./debug-worker.js?v=18',import.meta.url),{onresult:receivePoint,onerror:()=>{spotWorker=null;}});spotWorker.ready.catch(()=>{});
  }catch{spotWorker=null;}
  initFrame();
}
function stop(){epoch++;source.stop();cameraDisplay.hidden=true;greenPreview=false;demo=false;state.reset();picking='';manualPoints=[];lastResult=0;cameraCount=0;laserCount=0;cameraFps=0;laserFps=0;updateControls();}
async function listCameras(){try{const current=source.stream?.getVideoTracks()[0]?.getSettings?.().deviceId||$('cameraSelect').value,devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');$('cameraSelect').replaceChildren(new Option('تلقائي · الخلفية',''));devices.forEach((d,i)=>$('cameraSelect').add(new Option(d.label||'كاميرا '+(i+1),d.deviceId)));$('cameraSelect').value=devices.some(d=>d.deviceId===current)?current:'';}catch{}}
async function startCamera(){
  stop();error();initWorkers();const promise=source.start($('cameraSelect').value,$('captureProfile').value);updateControls();
  try{if(await promise)await listCameras();}catch(e){error(describeError(e));}finally{updateControls();}
}
source.onended=()=>{stop();error('الكاميرا اتفصلت. اضغط تشغيل الكاميرا لإعادة تشغيلها.');};
$('start').onclick=()=>source.stream||source.opening?stop():startCamera();
$('cameraSelect').onchange=()=>{if(source.stream||source.opening)startCamera();};
$('captureProfile').onchange=()=>{if(source.stream||source.opening)startCamera();};
$('restartCamera').onclick=startCamera;
$('previewMode').onchange=()=>{
  source.preferTrack=$('previewMode').value==='track';source.retryAt=0;cameraDisplay.hidden=true;error();updateControls();
};
$('demo').onclick=()=>{const next=!demo;stop();demo=next;error();if(demo)initWorkers();updateControls();};
$('findFrame').onchange=()=>{if($('findFrame').checked){nextScan=0;if(active())initFrame();}else{frameWorker?.close();frameWorker=null;}};
$('sensitivity').oninput=()=>{$('sensitivityValue').textContent=$('sensitivity').value+'%';};
for(const id of ['colorMode','algorithm','resolution'])$(id).onchange=()=>{epoch++;state.spot=null;state.uv=null;state.latched=false;};
$('clearMarks').onclick=()=>{state.history=[];state.shots=0;};
function beginPick(kind){picking=picking===kind?'':kind;updateControls();if(picking)$('stage').scrollIntoView({behavior:'smooth',block:'center'});}
$('pickLaser').onclick=()=>beginPick('laser');
$('pickFrame').onclick=()=>beginPick('frame');
$('manual').onclick=()=>{manualPoints=[];beginPick('manual');};
$('resetColors').onclick=()=>{epoch++;pickedLaser=null;frameColor.resetColor();nextFull=0;nextScan=0;updateControls();};
$('full').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{error('تكبير المتصفح غير مدعوم هنا؛ ممكن تستخدم الوضع الأفقي.');}};
function fit(){const box=$('stage').getBoundingClientRect(),w=pixels.width||640,h=pixels.height||360,s=Math.min(box.width/w,box.height/h);return {box,x:(box.width-w*s)/2,y:(box.height-h*s)/2,w:w*s,h:h*s};}
overlay.onpointerdown=e=>{
  if(!picking||!active())return;const f=fit(),x=(e.clientX-f.box.left-f.x)/f.w,y=(e.clientY-f.box.top-f.y)/f.h;if(x<0||x>1||y<0||y>1)return;
  if(picking==='manual'){
    manualPoints.push({x,y});if(manualPoints.length===4){if(state.manualFrame(manualPoints,performance.now())){picking='';manualPoints=[];}else{manualPoints=[];error('الأركان مش صالحة. حدّد الأركان الأربعة حول الشاشة بالترتيب.');}}updateControls();return;
  }
  const w=pixels.width,h=pixels.height,data=pc.getImageData(0,0,w,h).data,px=Math.floor(x*w),py=Math.floor(y*h);let best=null,score=-1;
  for(let dy=-10;dy<=10;dy++)for(let dx=-10;dx<=10;dx++){const xx=px+dx,yy=py+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const i=(yy*w+xx)*4,sample=rgbHSV(data[i],data[i+1],data[i+2]);if(sample.s<45||sample.v<55)continue;const value=sample.s*sample.v*sample.v/(1+.1*(dx*dx+dy*dy));if(value>score){score=value;best={sample,r:data[i],g:data[i+1],b:data[i+2]};}}
  if(!best){error('المس الجزء الملون، بعيد عن قلب الليزر الأبيض أو الخلفية.');return;}
  if(picking==='laser'){pickedLaser=best.sample;$('algorithm').value='color';}else{frameColor.setColor(best.r,best.g,best.b);nextFull=0;nextScan=0;}
  epoch++;picking='';error();updateControls();
};
function renderDemo(now){
  const c=dc,w=640,h=360;c.fillStyle='#26333a';c.fillRect(0,0,w,h);const corners=[{x:.10,y:.12},{x:.90,y:.17},{x:.86,y:.88},{x:.07,y:.82}].map(p=>({x:p.x+Math.sin(now/2500)*.01,y:p.y}));
  c.beginPath();corners.forEach((p,i)=>i?c.lineTo(p.x*w,p.y*h):c.moveTo(p.x*w,p.y*h));c.closePath();c.fillStyle='#091820';c.fill();c.strokeStyle='#006aff';c.lineWidth=12;c.stroke();
  if(now%1500<920){const x=320+Math.sin(now/1500)*140,y=180+Math.cos(now/1600)*65,green=['auto','green'].includes($('colorMode').value),g=c.createRadialGradient(x,y,0,x,y,12);g.addColorStop(0,'#f4fff6');g.addColorStop(.2,'#f4fff6');g.addColorStop(.45,green?'#32ff58':'#ff3260');g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-12,y-12,24,24);}
  return {source:demoView,width:w,height:h,close(){}};
}
async function tick(now){
  if(!active()||busy||document.hidden||now-lastTick<30)return;busy=true;lastTick=now;const currentEpoch=epoch;let frame;
  try{
    frame=demo?renderDemo(now):await source.read(now);if(!frame||currentEpoch!==epoch)return;now=performance.now();cameraCount++;
    const w=Math.min(+$('resolution').value,frame.width),h=Math.round(w*frame.height/frame.width);
    if(pixels.width!==w||pixels.height!==h){pixels.width=w;pixels.height=h;state.reset();}pc.drawImage(frame.source,0,0,w,h);
    if(!demo&&$('previewMode').value!=='video'){
      if(cameraDisplay.width!==frame.width||cameraDisplay.height!==frame.height){cameraDisplay.width=frame.width;cameraDisplay.height=frame.height;}
      cameraContext.drawImage(frame.source,0,0);cameraDisplay.hidden=false;
    }
    const cameraImage=pc.getImageData(0,0,w,h);
    greenPreview=!demo&&isGreenCameraFrame(cameraImage.data);
    if(greenPreview){state.spot=null;state.uv=null;state.latched=false;lastResult=0;return;}
    if($('findFrame').checked&&frameWorker?.active&&!frameWorker.busy&&now>=nextScan&&picking!=='manual'){
      nextScan=now+250;const fw=Math.min(384,w),fh=Math.round(h*fw/w);if(small.width!==fw||small.height!==fh){small.width=fw;small.height=fh;}sc.drawImage(pixels,0,0,fw,fh);const image=sc.getImageData(0,0,fw,fh),full=!state.corners||now>=nextFull;if(full)nextFull=now+5000;
      frameWorker.send({epoch,generation:epoch,capturedAt:now,width:fw,height:fh,buffer:image.data.buffer,seed:frameColor.seed,fast:!full},[image.data.buffer]);
    }
    if(!spotWorker?.busy){
      const image=cameraImage,options={epoch,capturedAt:now,width:w,height:h,buffer:image.data.buffer,mode:$('colorMode').value,sensitivity:+$('sensitivity').value/100,seed:pickedLaser,algorithm:$('algorithm').value,corners:$('roi').checked&&state.fresh(now)?state.corners:null};
      if(spotWorker?.active)spotWorker.send(options,[image.data.buffer]);
      else{
        const start=performance.now();
        detector.mode=options.mode;
        detector.sensitivity=options.sensitivity;
        const spot=detector.detect(image.data,w,h,options.corners,options);
        receivePoint({...options,spot,ms:performance.now()-start});
      }
    }
  }catch(e){error('خطأ أثناء قراءة الكاميرا: '+e.message);}finally{frame?.close();busy=false;}
}
function cross(ctx,x,y,size){ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.moveTo(x-size-7,y);ctx.lineTo(x+size+7,y);ctx.moveTo(x,y-size-7);ctx.lineTo(x,y+size+7);ctx.stroke();}
function pointVisible(now){return !!state.spot&&now-lastResult<Math.max(350,Math.min(1500,1800/Math.max(1,laserFps)));}
function updatePointUI(now){
  const visible=pointVisible(now);
  $('liveBadge').textContent=greenPreview?'صورة الكاميرا خضراء · جرّب إعداد الالتقاط المتوافق':visible?((state.uv?'ليزر داخل الشاشة':'ليزر ظاهر في الكاميرا')+(state.spot.bloom?' · قلب مضيء':'')):active()?'جاري البحث عن الليزر':'بانتظار الكاميرا';
  $('rawPoint').textContent=visible?'CAM X '+state.spot.x.toFixed(3)+' · Y '+state.spot.y.toFixed(3):'CAM X — · Y —';
  $('screenPoint').textContent=visible&&state.uv&&state.fresh(now)?'SCREEN X '+(state.uv.x*100).toFixed(1)+'% · Y '+(state.uv.y*100).toFixed(1)+'%':'SCREEN X — · Y —';
}
function draw(now){
  lastDraw=now;const f=fit(),ratio=Math.min(devicePixelRatio||1,1.5),ow=Math.round(f.box.width*ratio),oh=Math.round(f.box.height*ratio);if(overlay.width!==ow||overlay.height!==oh){overlay.width=ow;overlay.height=oh;}oc.setTransform(ratio,0,0,ratio,0,0);oc.clearRect(0,0,f.box.width,f.box.height);
  const xy=p=>({x:f.x+p.x*f.w,y:f.y+p.y*f.h}),fresh=state.fresh(now),corners=state.corners||state.candidate;
  if(corners){oc.strokeStyle=fresh?'#71ff9a':'#ffe494';oc.lineWidth=2;oc.beginPath();corners.forEach((p,i)=>{const q=xy(p);i?oc.lineTo(q.x,q.y):oc.moveTo(q.x,q.y);});oc.closePath();oc.stroke();corners.forEach((p,i)=>{const q=xy(p);oc.fillStyle=oc.strokeStyle;oc.fillRect(q.x-3,q.y-3,6,6);oc.font='14px sans-serif';oc.fillText(String(i+1),q.x+7,q.y-7);});}
  for(const hit of state.history){const q=xy(hit);oc.strokeStyle='#f1d55bb0';oc.lineWidth=1;oc.strokeRect(q.x-4,q.y-4,8,8);}
  manualPoints.forEach((p,i)=>{const q=xy(p);oc.fillStyle='#fff';oc.fillRect(q.x-4,q.y-4,8,8);oc.font='16px sans-serif';oc.fillText(String(i+1),q.x+8,q.y);});
  if(pointVisible(now)){const q=xy(state.spot);oc.strokeStyle='#fff';oc.lineWidth=2;cross(oc,q.x,q.y,12);}
  mc.fillStyle='#06131b';mc.fillRect(0,0,640,360);mc.strokeStyle='#345361';mc.lineWidth=1;for(let x=0;x<=640;x+=80){mc.beginPath();mc.moveTo(x,0);mc.lineTo(x,360);mc.stroke();}for(let y=0;y<=360;y+=60){mc.beginPath();mc.moveTo(0,y);mc.lineTo(640,y);mc.stroke();}mc.strokeStyle='#006aff';mc.lineWidth=10;mc.strokeRect(5,5,630,350);
  for(const hit of state.history)if(hit.uv){mc.fillStyle='#f1d55ba0';mc.fillRect(hit.uv.x*640-4,hit.uv.y*360-4,8,8);}
  if(state.uv&&fresh&&pointVisible(now)){mc.strokeStyle='#80ffab';mc.lineWidth=3;cross(mc,state.uv.x*640,state.uv.y*360,12);}
}
function updateUI(now){
  if(now-lastUI<160)return;lastUI=now;
  if(now-lastStats>=1000){const elapsed=now-lastStats;cameraFps=Math.round(cameraCount*1000/elapsed);laserFps=Math.round(laserCount*1000/elapsed);cameraCount=0;laserCount=0;lastStats=now;}
  updatePointUI(now);
  $('cameraFps').textContent=cameraFps+' FPS';$('laserFps').textContent=laserFps+' FPS';$('analysisMs').textContent=Math.round(spotMs)+' ms';$('shotCount').textContent=state.shots;
  $('sourceStatus').textContent=source.opening?'اسمح بالكاميرا في المتصفح…':demo?'محاكاة بدون كاميرا':source.stream?'كاميرا مباشرة · '+(source.stream.getVideoTracks()[0]?.label||'الكاميرا')+' · '+video.videoWidth+' × '+video.videoHeight:'الكاميرا متوقفة';
  $('previewHint').textContent=greenPreview?'الكاميرا بترجع لون أخضر سادة بدون صورة. جرّب إعداد الالتقاط «متوافق». لو المشكلة مستمرة، قارن الصورة بتطبيق الكاميرا في Windows.':source.preferTrack&&source.stream&&(!source.capture||source.retryAt>now)?'القراءة البديلة غير متاحة حاليًا؛ نستخدم الفيديو. جرّب كاميرا أخرى أو إعادة تشغيل الكاميرا.':'لو الصورة خضراء، جرّب إعداد الالتقاط المتوافق أو القراءة البديلة واختار كاميرا الجهاز بدل كاميرا افتراضية.';
  $('frameStatus').textContent=!$('findFrame').checked?'تتبّع الإطار متوقف':state.fresh(now)?state.manual?'أركان يدوية':'إطار متتبّع مباشرة':state.corners?'الإطار مفقود · البحث مستمر':'بحث عن الإطار';
  $('frameInfo').textContent='فحص '+state.checks+' · تحديث '+state.updates+' · '+(state.fresh(now)?'الإسقاط جاهز':'كشف الليزر مستمر بدون الإطار');
  $('timing').textContent='FRAME '+Math.round(frameMs)+' ms · RESULT '+Math.round(resultAge)+' ms';
  $('engine').textContent=!active()?'التحليل متوقف':(spotWorker?.active?'تحليل الليزر بالخلفية':'تحليل ليزر متوافق')+' · '+(frameWorker?.active?'OpenCV جاهز':$('findFrame').checked?(frameFailed?'تحديد الأركان اليدوي متاح':'تحميل كاشف الإطار…'):'ليزر فقط');
}
function loop(now){requestAnimationFrame(loop);if(document.hidden)return;tick(now);if(now-lastDraw>100)draw(now);updateUI(now);}
window.addEventListener('pagehide',()=>{stop();spotWorker?.close();frameWorker?.close();spotWorker=null;frameWorker=null;});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)video.play().catch(()=>{});});
updateControls();listCameras();requestAnimationFrame(loop);
