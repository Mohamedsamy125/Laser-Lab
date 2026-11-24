import { ArcadeGame, findGame, listGames } from './games/catalog.js';
import { LaserCamera } from './laser/index.js';
import { BASE_PALETTE, PALETTE_COLORS, PALETTE_PRESETS, normalizePalette, palettePreset } from './scene-palette.js?v=24';
const $=id=>document.getElementById(id);let game=null,tracker=null,current=null,aim=null,marker=null,toastTimer,damageTimer,shotTimer,drawerWasPaused=false,calibrationWasMenu=false,failed=false,audio=null;
const requestedSlug = new URLSearchParams(location.search).get('game') || 'robot-outbreak';
const currentGame = findGame(requestedSlug);
const selectedGame = currentGame?.engine === 'arcade' ? currentGame : null;
const gameMount = $('gameMount');
const aimCanvas=$('aim'),ctx=aimCanvas.getContext('2d');
let visionPerf={},renderFrames=0,renderSince=performance.now(),renderFps=0,nextPerf=0,aimWasVisible=false,aimRect=aimCanvas.getBoundingClientRect();
new ResizeObserver(()=>{aimRect=aimCanvas.getBoundingClientRect();}).observe(aimCanvas.parentElement);
document.body.classList.add('menu-open');
const calibrationScreen=document.createElement('div');calibrationScreen.className='calibration-screen';calibrationScreen.hidden=true;
calibrationScreen.innerHTML='<h2>التقاط الإطار الأزرق</h2><p>وجّه الكاميرا للتلفزيون وخلّي الأربع أركان ظاهرين.</p><div id="calibrationMonitor"><canvas id="calibrationPreview" hidden></canvas><span id="captureLabel">بانتظار الصور</span></div><p id="captureStatus" role="status">جاري بدء قراءة الكاميرا…</p><div class="capture-actions"><button id="restartCapture" class="secondary">إعادة تشغيل الكاميرا</button><button id="cancelCapture" class="secondary">الرجوع للإعدادات</button></div>';$('playfield').append(calibrationScreen);
function setCaptureView(active){
  if(active){$('captureStatus').textContent='بانتظار صور الكاميرا…';$('captureLabel').textContent='بانتظار الصور';$('calibrationPreview').hidden=true;}
  tracker?.resumeVideo();
}

function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function settings(){return {total:Math.max(1,Math.min(60,Math.round(+$('waveTotal').value||10))),cap:Math.max(1,Math.min(10,Math.round(+$('activeCap').value||5))),difficulty:$('difficulty').value};}
function remember(){try{localStorage.setItem('laser-lab-v2',JSON.stringify({...settings(),color:$('colorMode').value,sensitivity:$('sensitivity').value,resolution:$('resolution').value,detectionVersion:18,sound:$('sound').checked,quality:$('renderQuality').value,qualityVersion:2,sceneLook:$('sceneLook').value,lightingVersion:20,scenePalette}));}catch{}}
let saved=null;
try{saved=JSON.parse(localStorage.getItem('laser-lab-v2')||'null');if(saved){$('waveTotal').value=saved.total||10;$('activeCap').value=saved.cap||5;$('difficulty').value=saved.difficulty||'normal';const savedColor=$('colorMode');if((saved.detectionVersion===18||['fast-red','green'].includes(saved.color))&&Array.from(savedColor.options).some(option=>option.value===saved.color))savedColor.value=saved.color;$('sensitivity').value=saved.sensitivity??50;$('sensitivityValue').textContent=$('sensitivity').value+'%';$('resolution').value=saved.resolution||640;$('sound').checked=saved.sound!==false;$('renderQuality').value=saved.qualityVersion===2&&['high','balanced','performance'].includes(saved.quality)?saved.quality:'high';}}catch{}
const sceneLook=$('sceneLook'),sceneLookToggle=$('sceneLookToggle');
const paletteSelect = $('palettePreset'), paletteBrightness = $('paletteBrightness');
let scenePalette = normalizePalette(saved?.scenePalette);
function applyPalette(next, fromControl = false) {
  scenePalette = normalizePalette(next);
  paletteSelect.value = palettePreset(scenePalette);
  paletteBrightness.value = scenePalette.brightness;
  $('paletteBrightnessValue').textContent = scenePalette.brightness + '%';
  for (const key of PALETTE_COLORS) {
    $('palette-' + key).value = scenePalette[key];
    $('palette-value-' + key).textContent = scenePalette[key].toUpperCase();
  }
  if (fromControl && (sceneLook.value === 'gray' || sceneLook.value === 'dim')) {
    sceneLook.value = 'color';
    applySceneLook();
  }
  game?.setPalette?.(scenePalette);
}
paletteSelect.onchange = () => {
  const preset = PALETTE_PRESETS[paletteSelect.value];
  if (preset) applyPalette(preset, true);
  remember();
};
for (const key of PALETTE_COLORS) {
  const color = $('palette-' + key);
  color.oninput = () => applyPalette({...scenePalette, [key]:color.value}, true);
  color.onchange = remember;
}
paletteBrightness.oninput = () => applyPalette({...scenePalette, brightness:Number(paletteBrightness.value)}, true);
paletteBrightness.onchange = remember;
$('resetPalette').onclick = () => { applyPalette(BASE_PALETTE, true); remember(); };
applyPalette(scenePalette);

function applySceneLook(){
  $('world').dataset.sceneLook=sceneLook.value;
  game?.setLighting?.(sceneLook.value);
  const label='مظهر المشهد · '+sceneLook.selectedOptions[0].textContent;
  sceneLookToggle.setAttribute('aria-label',label);
  sceneLookToggle.title=label;
}
if(saved?.lightingVersion===20&&Array.from(sceneLook.options).some(option=>option.value===saved.sceneLook))sceneLook.value=saved.sceneLook;
applySceneLook();
sceneLook.onchange=()=>{applySceneLook();remember();};
sceneLookToggle.onclick=()=>{
  sceneLook.selectedIndex=(sceneLook.selectedIndex+1)%sceneLook.options.length;
  applySceneLook();remember();
  toast(sceneLook.selectedOptions[0].textContent);
};
function unlockAudio(){try{if(!audio){const C=window.AudioContext||window.webkitAudioContext;if(C)audio=new C();}audio?.resume();}catch{}}
function sound(name){
  if(!$('sound').checked||!audio||audio.state!=='running')return;
  const tones={start:[330,.08],wave:[520,.16],hit:[730,.05],kill:[1020,.1],miss:[155,.035],reload:[220,.08],damage:[85,.12],clear:[880,.22],lost:[65,.4]};const [f,d]=tones[name]||[300,.05];
  const osc=audio.createOscillator(),gain=audio.createGain();osc.type=name==='damage'?'triangle':'sine';osc.frequency.setValueAtTime(f,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(Math.max(45,f*.55),audio.currentTime+d);gain.gain.setValueAtTime(.07,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+d);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+d+.01);
}
function update(s){
  current=s;const text=(id,value)=>{$(id).textContent=value;};
  text('wave',String(s.wave).padStart(2,'0'));text('location',s.location);text('health',s.health);$('healthFill').style.width=s.health+'%';text('alive',s.alive);text('pending',s.pending);text('defeated',s.defeated);text('total',s.total||settings().total);text('score',String(s.score).padStart(4,'0'));text('ammo',String(s.ammo).padStart(2,'0'));text('reloadLabel',s.reloading?'جاري التعبئة…':'إعادة التعبئة · R');
  $('pausePanel').hidden=!s.paused||!$('drawer').hidden||!calibrationScreen.hidden;
  const banner=['countdown','cleared','transition'].includes(s.state)&&!s.paused;
  $('waveBanner').hidden=!banner;
  if(banner){
    text('bannerLabel',s.state==='countdown'?'استعد للموجة '+s.wave:s.state==='cleared'?'تم تأمين المنطقة':'انتقال تلقائي');
    text('bannerNumber',s.state==='countdown'?s.countdown:s.state==='cleared'?'CLEAR':'→');text('bannerSub',s.state==='countdown'?s.total+' روبوت · أقصى عدد '+settings().cap:s.state==='cleared'?'استعادة جزء من الصحة والذخيرة':'الكاميرا بتنتقل للموقع التالي');
  }
  if(s.state==='won'||s.state==='lost'){
    $('resultPanel').hidden=false;text('resultEyebrow',s.state==='won'?'CONTAINMENT RESTORED':'SYSTEM OFFLINE');text('resultTitle',s.state==='won'?'تم تأمين المعمل.':'خرجت الروبوتات عن السيطرة');text('resultScore',s.score);text('resultKills',s.kills);text('resultAccuracy',(s.shots?Math.round(s.hits/s.shots*100):0)+'%');
  }
}
function start(){if(!game||failed||game.state==='loading')return;remember();unlockAudio();$('menu').hidden=true;$('resultPanel').hidden=true;$('pausePanel').hidden=true;document.body.classList.remove('menu-open');game.start(settings());}
function openSettings(){
  if(!$('drawer').hidden)return;drawerWasPaused=game?.paused||false;$('drawer').hidden=false;$('drawer').querySelector('.drawer-body').scrollTop=0;tracker.preview=true;tracker.loadCV();
  if(game&&!['ready','won','lost','finished','error','loading'].includes(game.state))game.pause(true);$('pausePanel').hidden=true;
}
function openCameraSettings(){
  openSettings();unlockAudio();
  if(!tracker.stream&&!tracker.demo&&!tracker.opening)tracker.start();
}
function closeSettings(){
  remember();$('drawer').hidden=true;tracker.preview=false;
  if(game&&!drawerWasPaused&&!tracker.calibrating&&!tracker.captureAt&&!tracker.manual)game.pause(false);
}
function togglePause(){if(!game||['ready','won','lost','finished','error','loading'].includes(game.state))return;game.pause(!game.paused);}
function showError(error){
  failed=true;console.error(error);if(/WebGL|context/i.test(error.message)&&!current){$('setupMenu').disabled=true;$('loadStatus').textContent='شغّل اللعبة على متصفح بيدعم WebGL. إعداد الكاميرا ومختبر التتبّع متاحين.';$('loadProgress').style.width='100%';return;}$('menu').hidden=true;$('errorPanel').hidden=false;$('waveBanner').hidden=true;
  $('errorMessage').textContent=/WebGL|context/i.test(error.message)?'فعّل تسريع الرسوميات، أو جرّب Chrome / Safari على جهاز بيدعم WebGL. اختبار الكاميرا متاح من الزر تحت.':'تعذّر تحميل أو تشغيل المرحلة. أعد تحميل الصفحة. '+error.message;
  $('errorPanel').querySelector('h2').textContent=/WebGL|context/i.test(error.message)?'المشهد محتاج WebGL':'تعذّر تشغيل المرحلة';
}
function onShot(result){
  if(result.kind==='ignored')return;marker={uv:result.uv,kind:result.kind,until:performance.now()+350};
  $('shotLabel').textContent=result.kind==='headshot'?'إصابة الرأس +':result.killed?'تم تدمير الروبوت':result.kind==='hit'?'إصابة':result.kind==='blocked'?'حاجز':'';
  clearTimeout(shotTimer);shotTimer=setTimeout(()=>$('shotLabel').textContent='',600);
}
tracker=new LaserCamera({toast,performance:p=>{visionPerf=p;},shot:uv=>game?.shoot(uv),aim:uv=>aim=uv,status:s=>{
  $('cameraPreview').classList.toggle('on',s.active&&!s.demo);$('cameraPreview').classList.toggle('opening',s.opening);$('cameraPreview').setAttribute('aria-label',s.opening?'جاري فتح الكاميرا':s.active?'الكاميرا شغالة — فتح المعاينة':'الكاميرا متوقفة — فتح المعاينة');
  $('inputStatus').textContent=s.active?(s.tracking==='lost'?'الإطار مفقود · جاري استعادته':s.calibrated?(s.demo?'محاكاة · تتبّع مستمر':'ليزر · تتبّع مستمر'):'الكاميرا شغالة · جاري البحث عن الإطار'):'ماوس / لمس';
},progress:p=>{
  $('captureStatus').textContent=p.frames?'وصلت '+p.frames+' صورة · '+p.width+' × '+p.height+' · '+(p.waiting?'تجهيز المعايرة':p.corners?'تأكيد الأركان '+Math.min(3,p.corners)+' / 3':'بحث مستمر عن الإطار')+' · فحص '+p.checks:'بانتظار صور من الكاميرا…';
  $('captureLabel').textContent=p.frames?(p.source==='demo'?'معاينة المحاكاة':'معاينة مباشرة'):'بانتظار الصور';
},calibrating:(active,success)=>{
  if(active){
    calibrationWasMenu=!$('menu').hidden;closeSettings();if(game&&!['ready','lost','won','finished'].includes(game.state))game.pause(true);
    calibrationScreen.hidden=false;document.body.classList.add('calibration-mode');setCaptureView(true);$('pausePanel').hidden=true;
  }else{
    calibrationScreen.hidden=true;document.body.classList.remove('calibration-mode');setCaptureView(false);
    if(success){closeSettings();if(calibrationWasMenu)start();else if(game)game.pause(false);}
    else openSettings();
  }
},manualPreview:()=>{calibrationScreen.hidden=true;setCaptureView(false);openSettings();}});
$('restartCapture').onclick=async()=>{tracker.calibrating=false;tracker.captureAt=0;calibrationScreen.hidden=true;document.body.classList.remove('calibration-mode');setCaptureView(false);openSettings();await tracker.start();};
$('cancelCapture').onclick=()=>{tracker.calibrating=false;tracker.captureAt=0;calibrationScreen.hidden=true;document.body.classList.remove('calibration-mode');setCaptureView(false);openSettings();};
$('renderQuality').onchange=()=>{game?.setQuality($('renderQuality').value);remember();};
$('start').onclick=openCameraSettings;$('restart').onclick=start;$('restartPause').onclick=start;$('settings').onclick=openSettings;$('cameraPreview').onclick=openCameraSettings;$('errorSetup').onclick=openCameraSettings;$('setupMenu').onclick=start;$('resultSetup').onclick=openSettings;$('closeSettings').onclick=closeSettings;$('pause').onclick=togglePause;$('resume').onclick=()=>game?.pause(false);$('reload').onclick=()=>game?.reload();
$('fullscreen').onclick=async()=>{
  unlockAudio();const root=document.documentElement;
  try{if(document.fullscreenElement||document.webkitFullscreenElement){await(document.exitFullscreen?.()||document.webkitExitFullscreen?.());return;}const request=root.requestFullscreen||root.webkitRequestFullscreen;if(request){await request.call(root);return;}}catch{/* Fall back to filling the browser viewport. */}
  document.body.classList.toggle('fullscreen-layout');toast('تم تكبير العرض داخل المتصفح؛ إخفاء شريط المتصفح حسب دعم الجهاز.');
};
function pointerShot(event) {
  if (event.target.closest('button, a, input, select, textarea, [data-no-shot]')) return;
  if(!game||!$('drawer').hidden||!calibrationScreen.hidden)return;
  unlockAudio();const r=aimCanvas.getBoundingClientRect();game.shoot({x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height});
}
aimCanvas.onpointerdown=pointerShot;
gameMount.onpointerdown=pointerShot;
document.addEventListener('keydown',e=>{
  if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName))return;
  if(!selectedGame&&e.key.toLowerCase()==='r')game?.reload();if(e.key==='Escape'){if(!$('drawer').hidden)closeSettings();else togglePause();}
  if(e.key===' '){e.preventDefault();togglePause();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&game&&['playing','countdown','transition','cleared'].includes(game.state))game.pause(true);});
function drawAim(now){
  const activeAim = aim && game?.state === 'playing' && !game.paused;
  const visible=!!(activeAim||marker&&now<marker.until);if(!visible&&!aimWasVisible)return;aimWasVisible=visible;
  const r=aimRect,ratio=1,w=Math.round(r.width*ratio),h=Math.round(r.height*ratio);
  if(aimCanvas.width!==w||aimCanvas.height!==h){aimCanvas.width=w;aimCanvas.height=h;}ctx.clearRect(0,0,w,h);
  if(activeAim){
    const x=aim.x*w,y=aim.y*h;ctx.strokeStyle='#558f8e';ctx.lineWidth=1.5*ratio;ctx.beginPath();ctx.arc(x,y,8*ratio,0,Math.PI*2);ctx.moveTo(x-14*ratio,y);ctx.lineTo(x-5*ratio,y);ctx.moveTo(x+5*ratio,y);ctx.lineTo(x+14*ratio,y);ctx.moveTo(x,y-14*ratio);ctx.lineTo(x,y-5*ratio);ctx.moveTo(x,y+5*ratio);ctx.lineTo(x,y+14*ratio);ctx.stroke();
  }
  if(marker&&now<marker.until){const x=marker.uv.x*w,y=marker.uv.y*h,a=5*ratio,b=12*ratio;ctx.strokeStyle=['hit','headshot'].includes(marker.kind)?'#5b928e':'#768b78';ctx.lineWidth=2*ratio;ctx.beginPath();for(const [dx,dy]of[[-1,-1],[1,-1],[1,1],[-1,1]]){ctx.moveTo(x+dx*a,y+dy*a);ctx.lineTo(x+dx*b,y+dy*b);}ctx.stroke();}
}
function configureGameMenu() {
  const links = $('gameLinks');
  const alternatives = listGames();
  for (const entry of alternatives) {
    if (entry.slug === currentGame?.slug) continue;
    const link = document.createElement('a');
    link.href = './play.html?game=' + encodeURIComponent(entry.slug);
    link.className = 'lab-link';
    link.textContent = entry.title;
    links.append(link);
  }
  links.hidden = !links.childElementCount;
  if (!selectedGame) return;
  document.body.classList.add('arcade-game');
  document.title = 'Laser Lab · ' + selectedGame.title;
  $('gameWordmark').textContent = selectedGame.title;
  $('menuTitle').textContent = selectedGame.title;
  $('menuTitle').dir = 'auto';
  $('menuDescription').textContent = selectedGame.description;
  $('pauseDescription').textContent = 'الجولة هتكمل من مكان ما وقفت.';
  $('loadStatus').textContent = 'تحميل اللعبة…';
}

async function initializeArcade() {
  const module = await import('./games/' + selectedGame.slug + '/game.js');
  game = new ArcadeGame(module, gameMount, {
    restart: start,
    playSound: sound,
    onPause: paused => {
      $('pausePanel').hidden = !paused || !$('drawer').hidden || !calibrationScreen.hidden;
    },
  });
  await game.load();
  gameMount.hidden = false;
  game.setQuality($('renderQuality').value);
  $('loadProgress').style.width='100%';
  $('loadStatus').textContent='جاهز · اختار الكاميرا أو الماوس / اللمس';
  $('setupMenu').disabled=false;
}

window.addEventListener('pagehide', event => {
  if (selectedGame && !event.persisted) game?.dispose();
});
configureGameMenu();

async function initialize(){
  try{
    if (!currentGame) throw new Error('اللعبة غير موجودة في القائمة. ارجع لقائمة الألعاب واختار لعبة متاحة.');
    if (selectedGame) {
      await initializeArcade();
      return;
    }
    const {ZombieGame}=await import('./game.js?v=24');
    game=new ZombieGame($('world'),{loading:f=>{$('loadProgress').style.width=Math.round(f*90)+'%';$('loadStatus').textContent=f<1?'تحميل المرحلة والروبوت…':'تجهيز الحركة ومسارات المرحلة…';},change:update,event:sound,shot:onShot,error:m=>showError(new Error(m)),damage:()=>{$('damage').classList.add('flash');clearTimeout(damageTimer);damageTimer=setTimeout(()=>$('damage').classList.remove('flash'),120);}});
    game.setLighting(sceneLook.value);game.setPalette(scenePalette);await game.load();game.setQuality($('renderQuality').value);$('loadProgress').style.width='100%';$('loadStatus').textContent='جاهز · افتح الكاميرا للعب بالليزر، أو اختار تجربة الماوس';$('setupMenu').disabled=false;
    console.info('Laser Lab ready',game.diagnostics());
  }catch(e){showError(e);}
}
function loop(now){
  requestAnimationFrame(loop);if(document.hidden)return;
  if(game&&!failed&&calibrationScreen.hidden){try{game.render(now);renderFrames++;}catch(e){showError(e);}}
  tracker.tick(now);drawAim(now);
  if(now>=nextPerf){
    nextPerf=now+500;
    if(now-renderSince>=1000){renderFps=Math.round(renderFrames*1000/(now-renderSince));renderFrames=0;renderSince=now;}
    const v=visionPerf,frameText=failed?'—':String(renderFps),cam=v.cameraFps||0;
    $('perfReadout').textContent='GAME '+frameText+' FPS · CAM '+cam+' FPS'+(cam?' · '+Math.round(v.spotMs||0)+' ms':'');
    const trackingHud=$('trackingHud');
    trackingHud.hidden=!v.tracking||v.tracking==='off';
    if(!trackingHud.hidden){
      const frame=v.tracking==='tracking'?'إطار مباشر '+v.frameUpdates:v.tracking==='manual'?'إطار يدوي':'بحث عن الإطار';
      const laser=v.laser==='mapped'?'ليزر داخل الإطار':v.laser==='raw'?'ليزر ظاهر · الإحداثيات غير جاهزة':'بحث عن الليزر';
      trackingHud.textContent=v.stalled?'فيديو الكاميرا متوقف · جاري الاستعادة':frame+' · '+laser+' · طلقات '+(current?.shots??game?.shots??0);
    }
    $('performanceReadout').textContent='اللعبة '+frameText+' FPS · الكاميرا '+cam+' FPS\nليزر '+Math.round(v.spotMs||0)+'ms · إطار '+Math.round(v.frameMs||0)+'ms · عمر النتيجة '+Math.round(v.age||0)+'ms';
    $('analysisMode').textContent=v.background?'التحليل بالخلفية · أحدث صورة فقط':'تحليل متوافق · أحدث صورة فقط';
  }
}
initialize();requestAnimationFrame(loop);
