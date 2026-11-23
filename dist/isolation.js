import {DebugCameraSource} from './debug-source.js?v=8';
import {VisionChannel} from './vision-channel.js?v=7';
import {IsolationSpotDetector,ScreenSpotDetector} from './isolation-spot.js?v=3';

const $=id=>document.getElementById(id);
const video=$('video'),source=new DebugCameraSource(video);
const demoView=$('demoView'),demoContext=demoView.getContext('2d');
const overlay=$('overlay'),overlayContext=overlay.getContext('2d');
const raster=document.createElement('canvas'),rasterContext=raster.getContext('2d',{willReadFrequently:true});
const screenMode=new URLSearchParams(location.search).get('mode')==='repo';
const detector=screenMode?new ScreenSpotDetector():new IsolationSpotDetector();
if(screenMode){
  document.title='Laser Lab · تجربة ريبو الجديد';
  $('trackingTitle').textContent='تجربة ريبو الجديد';
  $('trackingDescription').textContent='تتبّع مباشر لنقطة الليزر على شاشة ساطعة.';
  $('repoMode').hidden=true;
  $('standardMode').hidden=false;
  $('glareNote').hidden=false;
}
let exposure=null;
let worker=null,demo=false,demoStart=0,pending=false,epoch=0;
let lastRead=0,lastResult=0,spot=null;
let statsStart=performance.now(),statsCount=0;
const active=()=>demo||!!source.stream;

function setStatus(text){
  if($('status').textContent!==text)$('status').textContent=text;
}
function showError(text=''){
  $('error').textContent=text;
  $('error').hidden=!text;
}
function updateControls(){
  $('start').textContent=source.opening?'إلغاء طلب الكاميرا':source.stream?'إيقاف الكاميرا':'تشغيل الكاميرا';
  $('demo').textContent=demo?'إنهاء المحاكاة':'محاكاة بدون كاميرا';
  $('sourceStatus').textContent=demo?'محاكاة':source.stream?'كاميرا مباشرة':source.opening?'بانتظار إذن الكاميرا':'الكاميرا متوقفة';
  video.hidden=demo;
  demoView.hidden=!demo;
  $('empty').hidden=active();
}
function resetPreview(){
  epoch++;lastResult=0;spot=null;
  statsStart=performance.now();statsCount=0;
  for(const id of ['fps','analysisTime','coordinates'])$(id).textContent='—';
  draw();
}
function stop(){
  exposure=null;$('exposureToggle').hidden=true;
  source.stop();demo=false;resetPreview();updateControls();
  setStatus('شغّل الكاميرا أو المحاكاة أولًا.');
}
function configureExposure(){
  if(!screenMode)return;
  const track=source.stream?.getVideoTracks()[0];
  const range=track?.getCapabilities?.().exposureCompensation;
  const original=track?.getSettings?.().exposureCompensation;
  if(!range||!Number.isFinite(original)||!Number.isFinite(range.min)||range.min>=original)return;
  const step=range.step>0?range.step:.1;
  const target=Math.max(range.min,original-1.5);
  const lower=range.min+Math.floor((target-range.min)/step+1e-6)*step;
  if(lower>=original)return;
  exposure={track,original,lower,lowered:false};
  $('exposureToggle').textContent='خفض تعريض الكاميرا';
  $('exposureToggle').hidden=false;
  $('exposureToggle').disabled=false;
}
$('exposureToggle').onclick=async()=>{
  const option=exposure,button=$('exposureToggle');
  if(!option)return;
  const wanted=option.lowered?option.original:option.lower;
  button.disabled=true;
  try{
    const {track}=option;
    await track.applyConstraints({...track.getConstraints(),exposureCompensation:{exact:wanted}});
    if(exposure!==option)return;
    const actual=track.getSettings().exposureCompensation;
    if(!Number.isFinite(actual)||Math.abs(actual-wanted)>.15)throw new Error('Exposure setting not applied');
    option.lowered=!option.lowered;
    button.textContent=option.lowered?'استعادة تعريض الكاميرا':'خفض تعريض الكاميرا';
    resetPreview();showError();
  }catch{
    if(exposure===option)showError('المتصفح ما قدرش يغيّر التعريض. جرّب تقلّل سطوع الشاشة.');
  }finally{
    if(exposure===option)button.disabled=false;
  }
};
function launchWorker(){
  if(worker||typeof Worker!=='function')return;
  try{
    worker=new VisionChannel(new URL('./isolation-worker.js?v=3',import.meta.url),{
      onresult:receive,onerror:()=>{worker=null;}
    });
    worker.ready.catch(()=>{});
  }catch{worker=null;}
}
function receive(result){
  const now=performance.now();
  if(result.epoch!==epoch||!active()||now-result.capturedAt>500)return;
  lastResult=now;
  $('analysisTime').textContent=result.ms.toFixed(1);
  statsCount++;
  if(now-statsStart>=1000){
    $('fps').textContent=String(Math.round(statsCount*1000/(now-statsStart)));
    statsStart=now;statsCount=0;
  }
  const previous=spot;
  spot=result.spot;
  if(spot){
    $('coordinates').textContent=Math.floor(spot.x*raster.width)+', '+Math.floor(spot.y*raster.height);
    setStatus('تتبّع نقطة الليزر');
  }else{
    if(previous)$('coordinates').textContent='—';
    setStatus('جاري البحث عن نقطة الليزر');
  }
  if(spot||previous)draw(now);
}

function draw(now=performance.now()){
  const box=overlay.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
  const width=Math.round(box.width*ratio),height=Math.round(box.height*ratio);
  if(overlay.width!==width||overlay.height!==height){overlay.width=width;overlay.height=height;}
  overlayContext.clearRect(0,0,width,height);
  if(!spot||now-lastResult>220||!width||!height)return;
  const fit=Math.min(width/raster.width,height/raster.height);
  const shownWidth=raster.width*fit,shownHeight=raster.height*fit;
  const x=(width-shownWidth)/2+spot.x*shownWidth,y=(height-shownHeight)/2+spot.y*shownHeight;
  overlayContext.lineWidth=2*ratio;
  overlayContext.strokeStyle='#fff';
  overlayContext.beginPath();overlayContext.arc(x,y,12*ratio,0,Math.PI*2);overlayContext.stroke();
}
function renderDemo(now){
  const elapsed=now-demoStart;
  const pulse=elapsed%7000<4800;
  const brighter=Math.floor(elapsed/3500)%2===1;
  const shift=brighter?21:0,c=demoContext;
  if(screenMode){
    c.fillStyle='#28363c';c.fillRect(0,0,640,360);
    c.fillStyle=brighter?'#eae9ed':'#d9d8dd';c.fillRect(52,38,536,270);
    const glow=c.createRadialGradient(330,174,14,330,174,155);
    glow.addColorStop(0,brighter?'#f2f0f4':'#eeedf0');glow.addColorStop(1,'transparent');
    c.fillStyle=glow;c.fillRect(52,38,536,270);
  }else{
    c.fillStyle='rgb('+(23+shift)+','+(32+shift)+','+(45+shift)+')';
    c.fillRect(0,0,640,360);
    c.fillStyle=brighter?'#8b3745':'#762230';c.fillRect(64,65,190,80);
    c.fillStyle=brighter?'#7c97c0':'#6782ab';c.fillRect(370,210,200,100);
  }
  if(pulse){
    const x=320+Math.sin(now/1400)*80,y=160+Math.cos(now/1700)*55;
    c.fillStyle='#fff';c.beginPath();c.arc(x,y,4,0,Math.PI*2);c.fill();
  }
  return {source:demoView,width:640,height:360,close(){}};
}
async function tick(now){
  if(pending||!active()||worker?.busy||now-lastRead<25)return;
  lastRead=now;pending=true;
  const request=epoch;
  let frame;
  try{
    frame=demo?renderDemo(now):await source.read(now);
    if(!frame||request!==epoch)return;
    const width=Math.min(640,frame.width),height=Math.max(1,Math.round(width*frame.height/frame.width));
    if(raster.width!==width||raster.height!==height){raster.width=width;raster.height=height;}
    rasterContext.drawImage(frame.source,0,0,width,height);
    const data=rasterContext.getImageData(0,0,width,height).data;
    const job={epoch:request,capturedAt:performance.now(),width,height,screenMode,sensitivity:+$('sensitivity').value/100};
    if(worker?.active)worker.send({...job,buffer:data.buffer},[data.buffer]);
    else{
      const start=performance.now();
      const spot=detector.detect(data,width,height,job.sensitivity,job.epoch);
      receive({...job,spot,ms:performance.now()-start});
    }
  }catch{
    if(request===epoch){spot=null;draw();setStatus('تعذّر قراءة الصورة. جاري المحاولة.');}
  }finally{frame?.close();pending=false;}
}
function loop(now){
  requestAnimationFrame(loop);
  if(document.hidden)return;
  tick(now);
  if(spot&&now-lastResult>220){
    spot=null;$('coordinates').textContent='—';draw(now);
    if(active())setStatus('بانتظار صورة جديدة من الكاميرا');
  }
  if(lastResult&&now-lastResult>1800)$('fps').textContent='—';
}
$('start').onclick=async()=>{
  if(source.stream||source.opening){stop();return;}
  stop();showError();launchWorker();
  const opening=source.start();
  updateControls();
  try{
    if(await opening){configureExposure();setStatus('جاري البحث عن نقطة الليزر');}
  }catch(error){
    const message=error.name==='NotAllowedError'?'اسمح للمتصفح باستخدام الكاميرا وحاول تاني.':error.name==='NotFoundError'?'مفيش كاميرا متاحة. تقدر تستخدم المحاكاة.':error.message;
    showError(message);
  }finally{updateControls();}
};
$('demo').onclick=()=>{
  const next=!demo;stop();showError();demo=next;
  if(demo){demoStart=performance.now();launchWorker();setStatus('جاري البحث عن نقطة الليزر');}
  updateControls();
};
$('sensitivity').oninput=()=>{$('sensitivityValue').textContent=$('sensitivity').value+'%';};
source.onended=()=>{stop();showError('الكاميرا اتفصلت. شغّلها تاني للمتابعة.');};
window.addEventListener('pagehide',()=>{stop();worker?.close();worker=null;});
new ResizeObserver(()=>draw()).observe($('stage'));
updateControls();requestAnimationFrame(loop);
