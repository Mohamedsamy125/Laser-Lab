import {LaserSpotDetector} from './laser-spot.js?v=18';
import { FrameDetector, homography, projectPoint, orderCorners } from './tracking.js?v=7';
import { VisionChannel } from './vision-channel.js?v=7';
const $=id=>document.getElementById(id);
const FRAME_INTERVAL=250, FRAME_FALLBACK_INTERVAL=500;
const CAPTURE_RECOVERY_INTERVAL=750, CAPTURE_STALL_AGE=1500;
export class LaserCamera {
  constructor(callbacks={}) {
    this.callbacks=callbacks;this.video=$('video');this.display=$('cameraDisplay');this.overlay=$('cameraOverlay');
    this.ctx=this.display.getContext('2d');this.ox=this.overlay.getContext('2d');
    this.processing=document.createElement('canvas');this.pc=this.processing.getContext('2d',{willReadFrequently:true});
    this.frameCanvas=document.createElement('canvas');this.fc=this.frameCanvas.getContext('2d',{willReadFrequently:true});
    this.generation=0;this.frameMs=0;this.spotMs=0;this.captureMs=0;this.analysisAge=0;this.lastPreviewDraw=0;this.lastCaptureDraw=0;this.nextStats=0;this.lastDetectedAt=-Infinity;this.spotMapped=false;
    this.detector=new LaserSpotDetector();this.stream=null;this.ready=false;this.error='';this.epoch=0;this.demo=false;this.matrix=null;this.corners=null;
    this.nextFrameScan=0;this.nextFullScan=0;this.lastFrameFound=0;this.frameChecks=0;this.frameUpdates=0;this.trackingState='off';this.mappingSource=null;this.trackingStable=0;this.trackingCandidate=null;
    this.imageCapture=null;this.receivedFrames=0;this.captureMode='video';this.busy=false;this.preview=false;this.manual=false;this.pickingFrame=false;this.points=[];this.spot=null;this.lastTick=0;this.lastVideo=-1;this.lastSeen=0;this.latched=false;this.fpsCount=0;this.fpsTime=0;
    this.demoCanvas=document.createElement('canvas');this.demoCanvas.width=640;this.demoCanvas.height=480;this.demoCtx=this.demoCanvas.getContext('2d');
    this.demoCorners=[{x:.10,y:.12},{x:.89,y:.18},{x:.86,y:.88},{x:.07,y:.79}];this.demoBaseCorners=this.demoCorners.map(p=>({...p}));
    $('startCamera').onclick=()=>this.opening||this.stream&&this.ready?this.stop():this.start();
    $('cameraSelect').onchange=()=>{if(this.stream)this.start();};
    $('autoCalibrate').onclick=()=>this.beginAuto();$('pickFrameColor').onclick=()=>this.beginManual('color');$('resetFrameColor').onclick=()=>{this.frameDetector?.resetColor();this.updateUI();};$('manualCalibrate').onclick=()=>this.beginManual();
    $('resetCalibration').onclick=()=>{this.clear();this.callbacks.toast?.('اتلغت المعايرة.');};
    $('sensitivity').oninput=()=>{$('sensitivityValue').textContent=$('sensitivity').value+'%';};
    $('demoToggle').onclick=()=>this.toggleDemo();
    this.overlay.onpointerdown=e=>this.manualTap(e);
    window.addEventListener('pagehide',()=>this.stop());
    this.updateUI();this.list();
    this.watchTimer=setInterval(()=>this.watchCapture(performance.now()),250);this.watchTimer.unref?.();
  }
  async loadCV() {
    if(this.loadingCV)return this.loadingCV;
    this.loadingCV=(async()=>{
      if(typeof Worker==='function')try{
        this.spotWorker=new VisionChannel(new URL('./spot-worker.js?v=18',import.meta.url),{onresult:r=>this.receiveSpot(r),onerror:()=>{this.spotWorker=null;}});
        this.spotWorker.ready.catch(()=>{});
        const channel=new VisionChannel(new URL('./frame-worker.js?v=7',import.meta.url),{type:'classic',timeout:5000,onresult:r=>{
          if(r.epoch!==this.epoch||r.generation!==this.generation)return;
          this.frameMs=r.ms;
          if(performance.now()-r.capturedAt>1200){this.nextFullScan=0;return;}
          this.acceptFrame(r.found,r.capturedAt);this.updateTrackingStatus(performance.now());
        },onerror:()=>{this.frameWorker=null;this.loadCVMain();}});
        this.frameWorker=channel;
        try{await channel.ready;this.frameDetector=new FrameDetector(null);$('cvStatus').textContent='OpenCV بالخلفية';this.updateUI();return;}catch{/* Bounded main-thread fallback below. */}
      }catch{this.spotWorker?.close();this.frameWorker?.close();this.spotWorker=null;this.frameWorker=null;}
      await this.loadCVMain();
    })();return this.loadingCV;
  }
  async loadCVMain() {
    if(this.mainCVLoading)return this.mainCVLoading;
    this.mainCVLoading=(async()=>{
      try{
        await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./vendor/opencv.js';const timer=setTimeout(()=>reject(new Error('Timeout')),30000);s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=()=>{clearTimeout(timer);reject(new Error('OpenCV load'));};document.head.append(s);});
        let cv=window.cv;if(!cv)throw new Error('No OpenCV');
        if(!cv.Mat)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('OpenCV init')),20000);const ready=m=>{if(m)cv=m;clearTimeout(timer);resolve();};if(typeof cv.then==='function')cv.then(ready);else cv.onRuntimeInitialized=()=>ready();});
        this.frameDetector=new FrameDetector(cv);$('cvStatus').textContent='OpenCV جاهز';this.updateUI();
      }catch(error){$('cvStatus').textContent='التحديد اليدوي متاح';console.warn(error.message);}
    })();return this.mainCVLoading;
  }
  updateUI() {
    const active=Boolean(this.stream&&this.ready||this.demo);
    $('startCamera').textContent=this.opening?'إلغاء طلب الكاميرا':this.stream&&this.ready?'إيقاف الكاميرا':'تشغيل الكاميرا';$('startCamera').disabled=false;
    $('cameraEmpty').hidden=active;$('cameraEmpty').textContent=this.opening?'اسمح بالكاميرا في رسالة المتصفح…':'معاينة الكاميرا تظهر هنا';$('cameraError').hidden=!this.error;$('cameraError').textContent=this.error;$('autoCalibrate').disabled=!active||!this.frameDetector;$('manualCalibrate').disabled=!active;
    $('cameraStatus').textContent=this.opening?'جاري فتح الكاميرا…':this.demo?'محاكاة بدون كاميرا':active?'الكاميرا مباشرة · '+this.video.videoWidth+' × '+this.video.videoHeight:this.error?'تعذّر فتح الكاميرا':'الكاميرا متوقفة';
    $('pickFrameColor').disabled=!active||!this.frameDetector;$('frameColorStatus').textContent=this.frameDetector?.seed?'لون مختار '+this.frameDetector.seed.hex:'أزرق / سماوي تلقائي';
    $('demoToggle').textContent=this.demo?'إنهاء المحاكاة':'محاكاة الإطار والليزر';
    this.callbacks.status?.({active,opening:!!this.opening,error:this.error,demo:this.demo,calibrated:!!this.matrix,calibrating:!!this.calibrating,tracking:this.trackingState});
  }
  async list(selected='') {
    try{const all=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const value=selected||$('cameraSelect').value;
      $('cameraSelect').replaceChildren(new Option('تلقائي · الكاميرا الخلفية',''));all.forEach((d,i)=>$('cameraSelect').add(new Option(d.label||'كاميرا '+(i+1),d.deviceId)));$('cameraSelect').value=value;
    }catch{/* Permission is requested by start(). */}
  }
  stopTracks() {this.ready=false;this.imageCapture=null;this.lastCameraFrame=0;this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;this.video.srcObject=null;this.lastVideo=-1;this.lastVideoAt=0;this.retryGrabAt=0;this.lastResume=0;}
  stop(){this.epoch++;this.opening=false;this.error='';this.stopTracks();this.demo=false;this.clear();this.updateUI();}
  clear(){this.generation++;const interrupted=this.calibrating||this.manual||this.pickingFrame||this.captureAt;this.captureAt=0;this.matrix=null;this.corners=null;this.calibrating=false;this.manual=false;this.pickingFrame=false;this.frozen=null;this.points=[];this.spot=null;this.lastDetectedAt=-Infinity;this.spotMapped=false;this.latched=false;this.mappingSource=null;this.lastFrameFound=0;this.nextFrameScan=0;this.nextFullScan=0;this.frameChecks=0;this.frameUpdates=0;this.trackingStable=0;this.trackingCandidate=null;this.trackingState='off';$('manualHint').hidden=true;$('cameraSurface').classList.remove('manual-mode');$('calibrationBadge').textContent='المعايرة مطلوبة';if(this.frameDetector){this.frameDetector.profile=null;this.frameDetector.lastPass=null;}this.callbacks.aim?.(null);this.updateTrackingStatus(performance.now());this.updateUI();if(interrupted)this.callbacks.calibrating?.(false,false);}
  async start(){
    if(this.opening)return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){this.error='الكاميرا تحتاج رابط HTTPS مفتوح مباشرة في Chrome أو Safari. لو فاتح اللعبة داخل تطبيق، افتح الرابط في المتصفح.';this.updateUI();this.callbacks.toast?.(this.error);return false;}
    const epoch=++this.epoch;this.receivedFrames=0;this.error='';this.stopTracks();this.demo=false;this.clear();this.opening=true;this.updateUI();this.loadCV();
    try{
      const choice=$('cameraSelect').value;const v={width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}};
      if(choice)v.deviceId={exact:choice};else v.facingMode={ideal:'environment'};
      let stream;try{stream=await navigator.mediaDevices.getUserMedia({video:v,audio:false});}catch(e){if(e.name!=='OverconstrainedError'||choice)throw e;stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});}
      if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video.muted=true;this.video.defaultMuted=true;this.video.playsInline=true;this.video.srcObject=stream;
      await this.waitForVideo(epoch);if(epoch!==this.epoch)return false;this.ready=true;this.lastCameraFrame=performance.now();
      const track=stream.getVideoTracks()[0];
      if(typeof window.ImageCapture==='function'){try{this.imageCapture=new window.ImageCapture(track);}catch{this.imageCapture=null;}}
      track.onended=()=>{this.stop();this.callbacks.toast?.('الكاميرا اتفصلت. افتحها تاني من الإعدادات.');};
      await this.list(track.getSettings().deviceId);this.callbacks.toast?.('الكاميرا مفتوحة ومعاينتها مباشرة. وجّهها للتلفزيون واختار التقاط الإطار.');return true;
    }catch(e){if(epoch!==this.epoch)return;this.stopTracks();const messages={NotAllowedError:'إذن الكاميرا مرفوض. من علامة إعدادات الموقع بجوار الرابط اسمح بالكاميرا، ثم اضغط تشغيل الكاميرا. لو فاتح داخل تطبيق، افتح الرابط مباشرة في Chrome أو Safari.',SecurityError:'المتصفح منع الكاميرا. افتح رابط اللعبة مباشرة في Chrome أو Safari واسمح بالكاميرا.',NotFoundError:'مفيش كاميرا متاحة على الجهاز ده. افتح الرابط من الموبايل أو وصّل كاميرا للكمبيوتر.',NotReadableError:'الكاميرا مشغولة أو النظام منع الوصول لها. اقفل التطبيقات اللي بتستخدمها وراجع إذن الكاميرا للمتصفح.',OverconstrainedError:'الكاميرا المختارة غير متاحة. اختار تلقائي ثم شغّل الكاميرا.',CameraVideoTimeout:'إذن الكاميرا اتفتح لكن الفيديو ما بدأش. جرّب تشغيلها تاني أو اختار كاميرا مختلفة.'};this.error=messages[e.name]||'تعذّر فتح الكاميرا: '+e.message;this.callbacks.toast?.(this.error);return false;}
    finally{if(epoch===this.epoch){this.opening=false;this.updateUI();}}
  }
  waitForVideo(epoch){
    return new Promise((resolve,reject)=>{
      let settled=false,played=false,timer,poll;
      const done=error=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);error?reject(error):resolve();};
      const check=()=>{if(epoch!==this.epoch){done();return;}if(played&&this.video.readyState>=2&&this.video.videoWidth>0)done();};
      timer=setTimeout(()=>{const error=new Error('Camera frames did not start');error.name='CameraVideoTimeout';done(error);},10000);
      poll=setInterval(check,100);
      try{Promise.resolve(this.video.play()).then(()=>{played=true;check();},done);}catch(error){done(error);}
    });
  }
  toggleDemo(){const next=!this.demo;this.stop();this.demo=next;this.loadCV();this.updateUI();}
  async beginAuto(){
    if(!(this.stream||this.demo)||!this.frameDetector)return;
    this.generation++;
    this.manual=false;this.pickingFrame=false;this.frozen=null;this.captureAt=0;this.points=[];this.latched=true;this.calibrating=true;this.scanStartedAt=performance.now();this.framesAtScanStart=this.receivedFrames;this.lastCameraFrame=this.scanStartedAt;this.lastResume=0;this.error='';this.scanningAfter=this.scanStartedAt+1600;this.nextFrameScan=this.scanningAfter;this.nextFullScan=0;this.trackingStable=0;this.trackingCandidate=null;this.stable=0;this.candidate=null;
    $('manualHint').hidden=true;$('cameraSurface').classList.remove('manual-mode');$('calibrationBadge').textContent='جاري التقاط الأربع أركان…';this.callbacks.calibrating?.(true);this.updateUI();
  }
  beginManual(purpose='corners'){
    if(!(this.stream||this.demo))return;
    this.generation++;
    this.capturePurpose=purpose;this.pickingFrame=false;this.calibrating=false;this.manual=false;this.latched=true;this.scanStartedAt=performance.now();this.framesAtScanStart=this.receivedFrames;this.lastCameraFrame=this.scanStartedAt;this.lastResume=0;this.error='';this.captureAt=this.scanStartedAt+1800;this.callbacks.calibrating?.(true);
    this.callbacks.toast?.(purpose==='color'?'هنلتقط صورة كاملة، وبعدها المس الخط الملون للإطار في المعاينة.':'هنلتقط صورة للإطار كامل، وبعدها حدّد أركانه في المعاينة.');
  }
  save(points,label){
    const matrix=homography(points);if(!matrix){this.callbacks.toast?.('الأركان مش واضحة. حدّد الإطار من جديد.');return false;}
    this.matrix=matrix;this.corners=points;this.mappingSource=label==='يدوية'?'manual':'auto';this.lastFrameFound=performance.now();this.calibrating=false;this.manual=false;this.pickingFrame=false;this.frozen=null;this.captureAt=0;this.latched=true;this.lastSeen=performance.now();this.points=[];
    $('manualHint').hidden=true;$('cameraSurface').classList.remove('manual-mode');$('calibrationBadge').textContent='✓ معايرة '+label;this.callbacks.calibrating?.(false,true);this.callbacks.toast?.('المعايرة جاهزة. كل ظهور جديد لليزر يحسب طلقة.');this.updateUI();return true;
  }
  mappingUsable(now){return !!this.matrix&&(this.mappingSource==='manual'||now-this.lastFrameFound<=1200);}
  updateTrackingStatus(now){
    const active=!!(this.stream&&this.ready||this.demo),state=!active?'off':this.mappingSource==='manual'&&now-this.lastFrameFound>1200?'manual':this.matrix&&now-this.lastFrameFound<=1200?'tracking':this.matrix?'lost':'searching';
    const changed=state!==this.trackingState;this.trackingState=state;
    const labels={off:'تتبّع الإطار متوقف',searching:'بحث مستمر عن الإطار',tracking:'الإطار متتبّع مباشرة',lost:'الإطار مفقود · جاري البحث',manual:'أركان يدوية · البحث التلقائي مستمر'};
    $('frameTrackingStatus').textContent=labels[state];$('frameTrackingStatus').dataset.state=state;
    $('frameTrackingCount').textContent=this.frameChecks?'فحص '+this.frameChecks+' · تحديث '+this.frameUpdates:'يتم تحديث الأركان طوال التشغيل';
    if(state==='lost'){this.callbacks.aim?.(null);$('calibrationBadge').textContent='الإطار مفقود · التصويب متوقف مؤقتًا';}else if(state==='off')this.callbacks.aim?.(null);
    else if(state==='tracking')$('calibrationBadge').textContent='✓ الأركان بتتحدّث باستمرار';
    if(changed)this.updateUI();
  }
  laserBlocked(){
    return this.calibrating||this.manual||this.pickingFrame||this.captureAt;
  }
  frameScanDue(now){
    return this.frameDetector&&!this.manual&&!this.pickingFrame&&!this.captureAt&&
      now>=this.nextFrameScan&&!this.frameWorker?.busy&&(!this.calibrating||now>=this.scanningAfter);
  }
  scanFrame(image,now){
    if(!this.frameScanDue(now))return;
    this.nextFrameScan=now+(this.frameWorker?.active?FRAME_INTERVAL:FRAME_FALLBACK_INTERVAL);this.frameChecks++;
    const full=!this.corners||now>=this.nextFullScan;
    if(full)this.nextFullScan=now+5000;
    if(this.frameWorker?.active){
      this.frameWorker.send({epoch:this.epoch,generation:this.generation,capturedAt:now,width:image.width,height:image.height,buffer:image.data.buffer,fast:!full,seed:this.frameDetector.seed},[image.data.buffer]);return;
    }
    try{
      const started=performance.now(),found=this.frameDetector.detect(image,{fast:!full});this.frameMs=performance.now()-started;
      this.acceptFrame(found,now);
    }catch(error){this.nextFullScan=0;console.warn('Frame tracking:',error.message);}
  }
  acceptFrame(found,now){
      if(!found){this.trackingStable=0;this.trackingCandidate=null;this.stable=0;this.nextFullScan=0;return;}
      const close=(a,b,limit)=>a&&b&&a.every((p,i)=>Math.hypot(p.x-b[i].x,p.y-b[i].y)<limit);
      this.trackingStable=close(found,this.trackingCandidate,.025)?this.trackingStable+1:1;this.trackingCandidate=found;this.candidate=found;this.stable=this.trackingStable;
      const smooth=!!this.corners&&close(found,this.corners,.04);
      if((!smooth||this.calibrating)&&this.trackingStable<3)return;
      const points=smooth?found.map((p,i)=>({x:this.corners[i].x*.4+p.x*.6,y:this.corners[i].y*.4+p.y*.6})):found;
      const matrix=homography(points);if(!matrix)return;
      this.frameUpdates++;this.lastFrameFound=now;
      if(this.calibrating){this.save(points,'تلقائية');return;}
      // Updating the homography must not reset the shot latch: a held beam
      // remains one shot while the phone moves or the frame is refreshed.
      this.corners=points;this.matrix=matrix;this.mappingSource='auto';
  }
  manualTap(event){
    if(!this.manual&&!this.pickingFrame)return;const fit=this.fit();if(!fit)return;
    let x=(event.clientX-fit.box.left-fit.x)/fit.w,y=(event.clientY-fit.box.top-fit.y)/fit.h;if(x<0||x>1||y<0||y>1)return;if($('mirror').checked)x=1-x;
    if(this.pickingFrame){this.pickFrameAt(x,y);return;}
    this.points.push({x,y});if(this.points.length===4){if(!this.save(orderCorners(this.points),'يدوية'))this.points=[];}
    this.manualHint();this.drawPreview();
  }
  manualHint(){$('cameraSurface').classList.toggle('manual-mode',this.manual||this.pickingFrame);const names=['فوق شمال','فوق يمين','تحت يمين','تحت شمال'];$('manualHint').hidden=!(this.manual||this.pickingFrame);if(this.pickingFrame)$('manualHint').textContent='المس الخط الأزرق أو السماوي في لقطة الكاميرا';else if(this.manual)$('manualHint').textContent='لقطة ثابتة: المس الركن الداخلي '+names[this.points.length];}
  pickFrameAt(x,y){
    if(!this.frozen||!this.frameDetector)return;
    const w=this.frozen.width,h=this.frozen.height,data=this.frozen.getContext('2d').getImageData(0,0,w,h).data;
    const px=Math.floor(x*w),py=Math.floor(y*h);let best=null,score=-1;
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      const xx=px+dx,yy=py+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const i=(yy*w+xx)*4,r=data[i],g=data[i+1],b=data[i+2],max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max?(max-min)/max:0;
      if(sat<.18||max<50)continue;
      const value=sat*max*max/(1+.08*(dx*dx+dy*dy));if(value>score){score=value;best=[r,g,b];}
    }
    if(!best||!this.frameDetector.setColor(...best)){this.callbacks.toast?.('المس الجزء الملون من الإطار، بعيد عن الأبيض أو الخلفية.');return;}
    this.pickingFrame=false;this.frozen=null;this.manualHint();this.updateUI();
    this.callbacks.toast?.('اتحدد لون الإطار من الكاميرا. جاري التقاط الأركان.');this.beginAuto();
  }
  fit(){const box=$('cameraSurface').getBoundingClientRect(),w=this.processing.width,h=this.processing.height;if(!box.width||!w||!h)return null;const s=Math.min(box.width/w,box.height/h);return {box,x:(box.width-w*s)/2,y:(box.height-h*s)/2,w:w*s,h:h*s};}
  drawPreview(cameraFrame){
    if(!this.preview)return;const now=performance.now();if(now-this.lastPreviewDraw<100&&!this.frozen)return;this.lastPreviewDraw=now;const source=this.frozen||cameraFrame?.source||this.processing;
    const sw=this.frozen?.width||cameraFrame?.width||this.processing.width,sh=this.frozen?.height||cameraFrame?.height||this.processing.height;
    const w=Math.min(sw,1280),h=Math.round(sh*w/sw);if(!w||!h)return;
    if(this.display.width!==w||this.display.height!==h){this.display.width=w;this.display.height=h;}
    this.ctx.save();this.ctx.clearRect(0,0,w,h);if($('mirror').checked){this.ctx.translate(w,0);this.ctx.scale(-1,1);}this.ctx.drawImage(source,0,0,w,h);this.ctx.restore();
    const fit=this.fit();if(!fit)return;const ratio=Math.min(devicePixelRatio||1,2);const ow=Math.round(fit.box.width*ratio),oh=Math.round(fit.box.height*ratio);
    if(this.overlay.width!==ow||this.overlay.height!==oh){this.overlay.width=ow;this.overlay.height=oh;}
    const ctx=this.ox;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,fit.box.width,fit.box.height);
    const xy=p=>({x:fit.x+($('mirror').checked?1-p.x:p.x)*fit.w,y:fit.y+p.y*fit.h});
    const frame=this.corners||this.trackingCandidate;
    if(frame){ctx.strokeStyle=this.trackingState==='tracking'?'#7cff9a':'#ffe399';ctx.lineWidth=2;ctx.beginPath();frame.forEach((p,i)=>{const q=xy(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.stroke();frame.forEach((p,i)=>{const q=xy(p);ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(q.x-3,q.y-3,6,6);ctx.font='14px sans-serif';ctx.fillText(String(i+1),q.x+7,q.y-6);});}
    if(this.manual){ctx.fillStyle='#a28c65';this.points.forEach((p,i)=>{const q=xy(p);ctx.beginPath();ctx.arc(q.x,q.y,5,0,7);ctx.fill();ctx.font='12px sans-serif';ctx.fillText(i+1,q.x+7,q.y);});}
    if(this.spot&&!this.frozen){const q=xy(this.spot);ctx.strokeStyle='#71a09c';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(q.x,q.y,12,0,7);ctx.moveTo(q.x-18,q.y);ctx.lineTo(q.x+18,q.y);ctx.moveTo(q.x,q.y-18);ctx.lineTo(q.x,q.y+18);ctx.stroke();}
  }
  renderDemo(now){
    this.demoCorners=this.demoBaseCorners.map(p=>({x:p.x+Math.sin(now/1700)*.018,y:p.y+Math.cos(now/2300)*.012}));
    const c=this.demoCtx,w=640,h=480;c.fillStyle='#293034';c.fillRect(0,0,w,h);c.beginPath();this.demoCorners.forEach((p,i)=>i?c.lineTo(p.x*w,p.y*h):c.moveTo(p.x*w,p.y*h));c.closePath();c.fillStyle='#111d24';c.fill();c.lineWidth=13;c.strokeStyle='#006aff';c.stroke();
    if((now/1000)%1.8>1.15)return;
    const t=now/1000,x=320+Math.sin(t*.7)*135,y=245+Math.cos(t*.8)*70,green=$('colorMode').value==='green';
    const g=c.createRadialGradient(x,y,0,x,y,14);g.addColorStop(0,green?'#eefff0':'#fff0f7');g.addColorStop(.25,green?'#cfffdb':'#ffd6e7');g.addColorStop(.5,green?'#30fb48':'#ff3976');g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-14,y-14,28,28);
  }
  async readFrame(now){
    if(this.demo){this.renderDemo(now);this.captureMode='demo';return {source:this.demoCanvas,width:640,height:480,close(){}};}
    if(!this.stream)return null;
    // Fresh decoded video is cheaper than making a full-resolution bitmap for
    // every frame. Keep ImageCapture for devices whose hidden video stalls.
    if(this.video.readyState>=2&&this.video.videoWidth&&this.video.currentTime!==this.lastVideo){
      this.lastVideo=this.video.currentTime;this.lastVideoAt=now;this.captureMode='video';return {source:this.video,width:this.video.videoWidth,height:this.video.videoHeight,close(){}};
    }
    if(this.lastVideoAt&&now-this.lastVideoAt<180)return null;
    if(this.imageCapture&&now>=(this.retryGrabAt||0)){
      try{
        const bitmap=await this.grabFrame(220);this.captureMode='track';return {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close?.()};
      }catch{this.retryGrabAt=performance.now()+1500;}
    }
    if(this.video.readyState<2||!this.video.videoWidth)return null;
    if(this.video.currentTime===this.lastVideo)return null;
    this.lastVideo=this.video.currentTime;this.captureMode='video';return {source:this.video,width:this.video.videoWidth,height:this.video.videoHeight,close(){}};
  }
  grabFrame(timeout=1200){
    return new Promise((resolve,reject)=>{
      let expired=false;const timer=setTimeout(()=>{expired=true;reject(new Error('Camera capture timeout'));},timeout);
      Promise.resolve().then(()=>this.imageCapture.grabFrame()).then(bitmap=>{if(expired){bitmap.close?.();return;}clearTimeout(timer);resolve(bitmap);},error=>{if(expired)return;clearTimeout(timer);reject(error);});
    });
  }
  resumeVideo(){
    try{Promise.resolve(this.video.play()).catch(()=>{});}catch{}
  }
  failCapture(message,stalled=false){
    this.calibrating=false;this.captureAt=0;this.manual=false;this.pickingFrame=false;this.frozen=null;this.error=message;if(stalled)this.ready=false;
    $('calibrationBadge').textContent=stalled?'فيديو الكاميرا متوقف':'الإطار غير واضح';
    this.callbacks.calibrating?.(false,false);this.callbacks.toast?.(message);this.updateUI();
  }
  watchCapture(now){
    this.updateTrackingStatus(now);
    const waiting=this.calibrating||this.captureAt;
    const age=now-(this.lastCameraFrame||this.scanStartedAt||now);
    const stalled=!!this.stream&&!this.demo&&age>CAPTURE_STALL_AGE;
    if(stalled)this.callbacks.aim?.(null);
    this.reportPerformance(now,stalled);
    if(document.hidden)return;
    // A mobile browser can suspend its video after a visibility/fullscreen change.
    // Keep capture recovery running throughout play, even with the drawer closed.
    if(this.stream&&!this.demo&&age>CAPTURE_RECOVERY_INTERVAL&&now-(this.lastResume||0)>CAPTURE_RECOVERY_INTERVAL){
      this.lastResume=now;this.resumeVideo();
    }
    if(!waiting)return;
    const frames=this.receivedFrames-(this.framesAtScanStart||0);
    this.callbacks.progress?.({frames,width:this.processing.width||0,height:this.processing.height||0,source:this.captureMode,waiting:now<this.scanningAfter,corners:this.stable||0,checks:this.frameChecks});
    if(!this.demo&&age>3500){this.failCapture('فيديو الكاميرا وقف أثناء المعايرة. اضغط تشغيل الكاميرا لإعادة تشغيلها، وتأكد إن اللعبة مفتوحة قدامك على الموبايل.',true);return;}
    // A live camera keeps searching indefinitely. Only missing camera frames
    // end capture; a temporarily hidden/changed border is not a terminal error.
    if(this.captureAt&&now>this.captureAt+4500)this.failCapture('تعذّر أخذ لقطة من الكاميرا. أعد تشغيلها ثم جرّب المعايرة اليدوية.',true);
  }
  drawCapturePreview(){
    if(!(this.calibrating||this.captureAt))return;
    const now=performance.now();if(now-this.lastCaptureDraw<100)return;this.lastCaptureDraw=now;
    const canvas=$('calibrationPreview');if(!canvas)return;
    canvas.hidden=false;
    if(canvas.width!==this.processing.width||canvas.height!==this.processing.height){canvas.width=this.processing.width;canvas.height=this.processing.height;}
    const ctx=canvas.getContext('2d');ctx.drawImage(this.processing,0,0);
    const points=this.trackingCandidate||this.corners;if(points){ctx.strokeStyle='#7cff9a';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x*canvas.width,p.y*canvas.height):ctx.moveTo(p.x*canvas.width,p.y*canvas.height));ctx.closePath();ctx.stroke();}
  }
  reportPerformance(now,stalled){
    if(now<this.nextStats)return;this.nextStats=now+500;
    const elapsed=now-(this.fpsTime||now);if(elapsed>=900){this.cameraFps=Math.round(this.fpsCount*1000/elapsed);this.fpsTime=now;this.fpsCount=0;}else if(!this.fpsTime)this.fpsTime=now;
    $('fps').textContent=(this.cameraFps||0)+' FPS';
    this.callbacks.performance?.({cameraFps:this.cameraFps||0,spotMs:this.spotMs,frameMs:this.frameMs,captureMs:this.captureMs,age:this.analysisAge,background:!!(this.spotWorker?.active&&this.frameWorker?.active),
      tracking:this.trackingState,frameUpdates:this.frameUpdates,stalled,
      laser:now-this.lastDetectedAt<800?(this.spotMapped&&this.mappingUsable(now)?'mapped':'raw'):'searching'});
  }
  receiveSpot(result){
    const now=performance.now();
    if(result.epoch!==this.epoch||result.generation!==this.generation||this.laserBlocked()||(result.mode&&result.mode!==$('colorMode').value))return;
    this.spotMs=result.ms;this.analysisAge=now-result.capturedAt;
    // Never replay a delayed hit from an old camera picture after a pause.
    if(this.analysisAge>300){this.callbacks.aim?.(null);return;}
    this.spot=result.spot;
    const uv=this.spot&&this.mappingUsable(now)?projectPoint(result.matrix,this.spot):null,inside=uv&&uv.x>=0&&uv.x<=1&&uv.y>=0&&uv.y<=1;
    if(this.spot){this.lastDetectedAt=now;this.spotMapped=!!inside;this.missingSpotFrames=0;this.lastSeen=now;if(inside&&!this.latched){this.latched=true;this.callbacks.shot?.(uv);}}
    else{this.missingSpotFrames=(this.missingSpotFrames||0)+1;if(this.missingSpotFrames>=2&&now-this.lastSeen>=60)this.latched=false;}
    this.callbacks.aim?.(inside?uv:null);
    $('spotBadge').textContent=this.spot?(inside?(this.spot.bloom?'ليزر داخل الشاشة · قلب مضيء':'ليزر داخل الشاشة'):this.matrix?'الليزر ظاهر · استعادة الإطار':'الليزر ظاهر · جاري البحث عن الإطار'):this.matrix?'جاري البحث عن الليزر':'بحث عن الإطار والليزر';$('spotBadge').classList.toggle('found',!!this.spot);
  }
  async tick(now){
    if(document.hidden||this.busy||!(this.stream||this.demo)||now-this.lastTick<16)return;
    if(!this.preview&&!this.calibrating&&!this.captureAt&&!this.frameScanDue(now)&&
      (this.laserBlocked()||this.spotWorker?.busy))return;
    this.lastTick=now;
    const epoch=this.epoch;let frame;this.busy=true;
    try{
      frame=await this.readFrame(now);if(!frame||epoch!==this.epoch)return;
      now=performance.now();this.lastCameraFrame=now;this.receivedFrames++;this.fpsCount++;
      if(!this.ready&&this.stream){this.ready=true;this.error='';this.updateUI();}
      const {source,width:sw,height:sh}=frame;
      const w=Math.min(+$('resolution').value,sw),h=Math.round(w*sh/sw);
      if(this.processing.width!==w||this.processing.height!==h){
        const oldAspect=this.processing.width/this.processing.height;
        this.processing.width=w;this.processing.height=h;
        if(this.matrix&&Math.abs(oldAspect/(w/h)-1)>.015)this.clear();
      }
      if(!this.laserBlocked()&&!this.spotWorker?.busy){
        // Enqueue the latency-sensitive laser read first. The occasional
        // border scan can draw its own small image directly from the camera.
        this.pc.drawImage(source,0,0,w,h);
        const image=this.pc.getImageData(0,0,w,h),usable=this.mappingUsable(now);
        const payload={epoch:this.epoch,generation:this.generation,capturedAt:now,width:w,height:h,buffer:image.data.buffer,mode:$('colorMode').value,sensitivity:+$('sensitivity').value/100,corners:usable?this.corners:null,matrix:usable?this.matrix:null};
        this.captureMs=performance.now()-now;
        if(this.spotWorker?.active)this.spotWorker.send(payload,[image.data.buffer]);
        else{
          const started=performance.now();
          this.detector.mode=payload.mode;this.detector.sensitivity=payload.sensitivity;
          this.receiveSpot({...payload,spot:this.detector.detect(image.data,w,h,payload.corners),ms:performance.now()-started});
        }
      }else if(this.calibrating||this.captureAt){
        this.pc.drawImage(source,0,0,w,h);
        this.callbacks.aim?.(null);
        if(this.captureAt&&now>=this.captureAt){
          this.captureAt=0;this.frozen=document.createElement('canvas');this.frozen.width=w;this.frozen.height=h;this.frozen.getContext('2d').drawImage(this.processing,0,0);
          this.pickingFrame=this.capturePurpose==='color';this.manual=!this.pickingFrame;this.points=[];this.manualHint();this.callbacks.manualPreview?.();
        }
      }
      if(this.frameScanDue(now)){
        const fw=Math.min(320,sw),fh=Math.round(sh*fw/sw);
        if(this.frameCanvas.width!==fw||this.frameCanvas.height!==fh){this.frameCanvas.width=fw;this.frameCanvas.height=fh;}
        this.fc.drawImage(source,0,0,fw,fh);
        this.scanFrame(this.fc.getImageData(0,0,fw,fh),now);
      }
      this.drawCapturePreview();this.drawPreview(frame);
    }catch(error){console.error(error);if(this.calibrating||this.captureAt)this.failCapture('حصل خطأ أثناء قراءة صورة الكاميرا. أعد تشغيل الكاميرا وحاول تاني.');}
    finally{frame?.close();this.busy=false;}
  }
}
