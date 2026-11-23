import { FrameDetector, homography, projectPoint, orderCorners } from './tracking.js?v=7';
import { LaserSpotDetector } from './laser-spot.js?v=18';

const $ = id => document.getElementById(id);
const video = $('video'), display = $('cameraDisplay'), overlay = $('cameraOverlay');
const displayCtx = display.getContext('2d');
const overlayCtx = overlay.getContext('2d');
const processing = document.createElement('canvas');
const processingCtx = processing.getContext('2d', { willReadFrequently: true });
const gameOverlay = $('gameOverlay'), gameCtx = gameOverlay.getContext('2d');
const detector = new LaserSpotDetector();
let stream = null, demo = false, opening = false, cameraEpoch = 0;
let spot = null, matrix = null, corners = null, manualPoints = [], manual = false, calibrating = false;
let frameDetector = null, range = null, nextFrameScan = 0, scannedAt = -1;
let frameCounter = 0, fpsSince = performance.now(), fpsCount = 0, previousTime = 0;
let latched = false, lastSeen = 0, score = 0, toastTimer;
let previousWidth = 0, previousHeight = 0;
let lastVideoTime = -1, lastCameraFrame = 0;
const demoCanvas = document.createElement('canvas');
demoCanvas.width = 640; demoCanvas.height = 480;
const demoCtx = demoCanvas.getContext('2d');
const demoCorners = [{ x: .12, y: .16 }, { x: .88, y: .2 }, { x: .83, y: .85 }, { x: .08, y: .78 }];

function toast(text) {
  $('notification').textContent = text; $('notification').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('notification').hidden = true, 4500);
}
function message(text) { $('cameraMessage').textContent = text; }
function updateSource() {
  $('sourceBadge').textContent = demo ? 'محاكاة · فيديو تجريبي' : stream ? 'كاميرا مباشرة' : 'الكاميرا متوقفة';
  $('sourceBadge').classList.toggle('demo', demo);
  $('cameraLight').classList.toggle('on', Boolean(stream || demo));
  $('startCamera').textContent = opening ? 'جاري الفتح…' : stream ? 'إيقاف' : 'تشغيل';
  $('startCamera').disabled = opening;
  $('startHero').disabled = opening;
  $('startHero').textContent = opening ? 'جاري فتح الكاميرا…' : 'تشغيل الكاميرا ↗';
  $('cameraPlaceholder').hidden = Boolean(stream || demo);
  $('cameraSurface').classList.toggle('is-off', !(stream || demo));
  $('manualCalibrate').disabled = !(stream || demo);
  $('autoCalibrate').disabled = !(stream || demo) || !frameDetector;
  $('demoToggle').textContent = demo ? 'إنهاء المحاكاة' : 'تشغيل المحاكاة';
}
function clearCalibration() {
  matrix = null; corners = null; manualPoints = []; manual = false; calibrating = false;
  $('manualHint').hidden = true; $('manualCalibrate').textContent = 'تحديد الأركان يدويًا';
  $('calibrationBadge').textContent = 'المعايرة مطلوبة'; $('autoCalibrate').textContent = 'التقاط الفريم تلقائيًا';
  if (frameDetector) frameDetector.profile = null;
}
function stopStream() {
  if (stream) stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
  stream = null; video.srcObject = null; lastVideoTime = -1;
}
function resetDetection() {
  spot = null; latched = false; lastSeen = 0; clearCalibration();
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  $('spotBadge').textContent = 'بانتظار الكاميرا'; $('spotBadge').classList.remove('found');
  $('coordinate').textContent = 'X —   Y —'; $('videoSize').textContent = '— × —'; $('fps').textContent = '— FPS';
}
async function listCameras(selected = '') {
  try {
    const current = selected || $('cameraSelect').value;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    $('cameraSelect').replaceChildren(new Option('تلقائي · الخلفية على الموبايل', ''));
    devices.forEach((device, i) => $('cameraSelect').add(new Option(device.label || 'كاميرا ' + (i + 1), device.deviceId)));
    if (devices.some(d => d.deviceId === current)) $('cameraSelect').value = current;
  } catch { /* Opening the camera will show a useful error if permission is missing. */ }
}
async function startCamera() {
  if (opening) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    toast('افتح رابط HTTPS في Chrome أو Safari للوصول للكاميرا.'); return;
  }
  const epoch = ++cameraEpoch;
  opening = true; demo = false; stopStream(); resetDetection(); updateSource();
  const requestedDevice = $('cameraSelect').value;
  try {
    let media;
    const constraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
    if (requestedDevice) constraints.deviceId = { exact: requestedDevice };
    else constraints.facingMode = { ideal: 'environment' };
    try { media = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false }); }
    catch (error) {
      if (error.name !== 'OverconstrainedError' || requestedDevice) throw error;
      media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    if (epoch !== cameraEpoch) { media.getTracks().forEach(t => t.stop()); return; }
    stream = media; video.srcObject = media;
    await video.play();
    if (epoch !== cameraEpoch) return;
    const track = media.getVideoTracks()[0];
    track.onended = () => {
      stopStream(); resetDetection(); updateSource(); message('الكاميرا اتفصلت. اضغط تشغيل لإعادة الاتصال.');
    };
    await listCameras(track.getSettings().deviceId);
    lastCameraFrame = performance.now();
    message('النقطة بتتبع باستمرار. ثبّت الكاميرا على سطح التصويب.');
  } catch (error) {
    if (epoch !== cameraEpoch) return;
    stopStream();
    const errors = {
      NotAllowedError: 'اسمح باستخدام الكاميرا من إعدادات الموقع، وافتح الرابط مباشرة في المتصفح.',
      NotFoundError: 'مفيش كاميرا متاحة. وصّل ويب كام أو افتح الرابط من الموبايل.',
      NotReadableError: 'الكاميرا مشغولة أو غير متاحة. اقفل التطبيقات اللي بتستخدمها وجرّب تاني.',
      OverconstrainedError: 'الكاميرا المختارة غير متاحة. اختار تلقائي وجرّب تاني.'
    };
    message(errors[error.name] || 'تعذّر تشغيل الكاميرا. ' + error.message);
    toast(errors[error.name] || 'تعذّر تشغيل الكاميرا.');
  } finally {
    if (epoch === cameraEpoch) { opening = false; updateSource(); }
  }
}
function toggleCamera() {
  if (stream) {
    cameraEpoch++; stopStream(); resetDetection(); updateSource(); message('الكاميرا متوقفة.');
  } else startCamera();
}
function toggleDemo() {
  cameraEpoch++; opening = false; stopStream(); demo = !demo; resetDetection(); updateSource();
  message(demo ? 'محاكاة لفريم أزرق ونقطة متحركة. اضغط التقاط الفريم لاختبار المعايرة.' : 'الفيديو يتحلل على جهازك.');
}
function renderDemo(now) {
  const ctx = demoCtx, w = 640, h = 480;
  ctx.fillStyle = '#27353a'; ctx.fillRect(0, 0, w, h);
  ctx.beginPath(); demoCorners.forEach((p, i) => i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)); ctx.closePath();
  ctx.fillStyle = '#172b32'; ctx.fill(); ctx.strokeStyle = '#006aff'; ctx.lineWidth = 13; ctx.stroke();
  const phase = now / 1000, lit = phase % 3.2 < 2.5;
  if (!lit) return;
  // Map an animated game coordinate back into the synthetic camera view.
  const targets = [[.18,.23],[.82,.23],[.5,.5],[.18,.77],[.82,.77]];
  const target = targets[Math.floor(phase / 3.2) % targets.length];
  const cameraPoint = inverseProject(demoCorners, { x: target[0] + Math.sin(phase) * .01, y: target[1] + Math.cos(phase) * .01 });
  const x = cameraPoint.x * w, y = cameraPoint.y * h;
  const green = $('colorMode').value === 'green';
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 16);
  glow.addColorStop(0, green ? '#eaffef' : '#ffe4f6'); glow.addColorStop(.20, green ? '#dbffde' : '#ffd5f0');
  glow.addColorStop(.38, green ? '#35fa53' : '#ff3b7d'); glow.addColorStop(.65, green ? '#268b38' : '#982845');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow; ctx.fillRect(x - 16, y - 16, 32, 32);
}
function inverseProject(points, uv) {
  // Bilinear interpolation is sufficient for this visual demo. The real mapping uses homography.
  const top = { x: points[0].x * (1 - uv.x) + points[1].x * uv.x, y: points[0].y * (1 - uv.x) + points[1].y * uv.x };
  const bottom = { x: points[3].x * (1 - uv.x) + points[2].x * uv.x, y: points[3].y * (1 - uv.x) + points[2].y * uv.x };
  return { x: top.x * (1 - uv.y) + bottom.x * uv.y, y: top.y * (1 - uv.y) + bottom.y * uv.y };
}
function saveCalibration(points, type) {
  const next = homography(points);
  if (!next) { toast('الأركان لازم تكوّن إطار واضح بدون تقاطع. جرّب تحديدها تاني.'); return false; }
  matrix = next; corners = points; manual = false; calibrating = false;
  $('manualHint').hidden = true; $('manualCalibrate').textContent = 'تحديد الأركان يدويًا';
  $('calibrationBadge').textContent = '✓ معايرة ' + type; $('autoCalibrate').textContent = 'إعادة التقاط الفريم';
  message('اتحفظت المعايرة. كل ظهور جديد للنقطة جوّه الفريم يحسب ضربة.');
  return true;
}
function calibrateAutomatically() {
  if (!(stream || demo) || !frameDetector) return;
  calibrating = !calibrating; manual = false; manualPoints = [];
  $('manualHint').hidden = true; $('manualCalibrate').textContent = 'تحديد الأركان يدويًا';
  if (calibrating) {
    $('showFrame').checked = true; $('projection').classList.remove('frame-hidden');
    $('autoCalibrate').textContent = 'إيقاف البحث'; $('calibrationBadge').textContent = 'جاري البحث عن الأربع أركان…';
    message('وجّه الكاميرا بحيث تشوف الفريم الأزرق كامل، وسيب هوامش حواليه.');
    nextFrameScan = 0; scannedAt = performance.now();
  } else $('autoCalibrate').textContent = matrix ? 'إعادة التقاط الفريم' : 'التقاط الفريم تلقائيًا';
}
function beginManual() {
  if (!(stream || demo)) return;
  manual = !manual; calibrating = false; manualPoints = [];
  $('autoCalibrate').textContent = matrix ? 'إعادة التقاط الفريم' : 'التقاط الفريم تلقائيًا';
  $('manualCalibrate').textContent = manual ? 'إلغاء تحديد الأركان' : 'تحديد الأركان يدويًا';
  updateManualHint();
}
function updateManualHint() {
  $('manualHint').hidden = !manual;
  const names = ['فوق شمال', 'فوق يمين', 'تحت يمين', 'تحت شمال'];
  if (manual) $('manualHint').textContent = 'المس الركن الداخلي ' + names[manualPoints.length] + ' في معاينة الكاميرا';
}
function containBox() {
  const box = $('cameraSurface').getBoundingClientRect(), w = processing.width, h = processing.height;
  if (!w || !h) return null;
  const scale = Math.min(box.width / w, box.height / h);
  return { x: (box.width - w * scale) / 2, y: (box.height - h * scale) / 2, width: w * scale, height: h * scale, box };
}
overlay.addEventListener('pointerdown', event => {
  if (!manual) return;
  const fit = containBox(); if (!fit) return;
  let x = (event.clientX - fit.box.left - fit.x) / fit.width;
  const y = (event.clientY - fit.box.top - fit.y) / fit.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  if ($('mirror').checked) x = 1 - x;
  manualPoints.push({ x, y });
  if (manualPoints.length === 4) {
    if (!saveCalibration(orderCorners(manualPoints.slice()), 'يدوية')) manualPoints = [];
  }
  updateManualHint();
});
function drawOverlay() {
  const fit = containBox(); if (!fit) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.round(fit.box.width * dpr), height = Math.round(fit.box.height * dpr);
  if (overlay.width !== width || overlay.height !== height) { overlay.width = width; overlay.height = height; }
  const ctx = overlayCtx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, fit.box.width, fit.box.height);
  const xy = point => ({ x: fit.x + ($('mirror').checked ? 1 - point.x : point.x) * fit.width, y: fit.y + point.y * fit.height });
  if (corners) {
    ctx.strokeStyle = '#55a8ac'; ctx.lineWidth = 2; ctx.beginPath();
    corners.forEach((p, i) => { const q = xy(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.closePath(); ctx.stroke();
    corners.forEach((p, i) => { const q = xy(p); ctx.fillStyle = '#55a8ac'; ctx.fillRect(q.x - 4, q.y - 4, 8, 8); ctx.fillStyle = '#78999a'; ctx.font = '12px Inter, sans-serif'; ctx.fillText(String(i + 1), q.x + 7, q.y - 6); });
  }
  if (manual) manualPoints.forEach((p, i) => { const q = xy(p); ctx.fillStyle = '#7d9a76'; ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.font = '14px Inter'; ctx.fillText(String(i + 1), q.x + 10, q.y); });
  if (spot) {
    const q = xy(spot); ctx.strokeStyle = '#6a9d94'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(q.x, q.y, 17, 0, Math.PI * 2); ctx.moveTo(q.x - 24, q.y); ctx.lineTo(q.x - 8, q.y); ctx.moveTo(q.x + 8, q.y); ctx.lineTo(q.x + 24, q.y); ctx.moveTo(q.x, q.y - 24); ctx.lineTo(q.x, q.y - 8); ctx.moveTo(q.x, q.y + 8); ctx.lineTo(q.x, q.y + 24); ctx.stroke();
  }
}
function drawGameOverlay(mapped) {
  const rect = $('projection').getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
  const width = Math.round($('projection').clientWidth * ratio), height = Math.round($('projection').clientHeight * ratio);
  if (gameOverlay.width !== width || gameOverlay.height !== height) { gameOverlay.width = width; gameOverlay.height = height; }
  gameCtx.clearRect(0, 0, width, height);
  if (!mapped || mapped.x < 0 || mapped.x > 1 || mapped.y < 0 || mapped.y > 1) return;
  const x = mapped.x * width, y = mapped.y * height;
  gameCtx.strokeStyle = '#6a9d94'; gameCtx.lineWidth = 2 * ratio;
  gameCtx.beginPath(); gameCtx.moveTo(x - 12 * ratio, y); gameCtx.lineTo(x + 12 * ratio, y); gameCtx.moveTo(x, y - 12 * ratio); gameCtx.lineTo(x, y + 12 * ratio); gameCtx.stroke();
}
async function fullscreen(target, isRange = false) {
  const request = target.requestFullscreen || target.webkitRequestFullscreen;
  if (request) {
    try {
      if (document.fullscreenElement === target || document.webkitFullscreenElement === target) {
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.()); return;
      }
      await request.call(target);
      if (isRange) $('exitRange').hidden = false;
      return;
    } catch { /* Use a layout-only expansion when the browser blocks the API. */ }
  }
  if (isRange) {
    target.classList.toggle('expanded'); $('exitRange').hidden = !target.classList.contains('expanded');
    toast('المتصفح ده بيدعم تكبير العرض داخل الصفحة.');
  } else {
    document.body.classList.toggle('immersive');
    toast('تم تبديل عرض الصفحة. ملء الشاشة الكامل حسب دعم المتصفح.');
  }
}
function closeRange() {
  $('projectionShell').classList.remove('expanded'); $('exitRange').hidden = true;
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
}
function resetScore() { score = 0; $('score').textContent = '00'; }
function loop(now) {
  requestAnimationFrame(loop);
  range?.render(now);
  if (now - previousTime < 33 || document.hidden) return;
  previousTime = now;
  const ready = demo || (stream && video.readyState >= 2 && video.videoWidth);
  if (!ready) return;
  if (!demo && video.currentTime === lastVideoTime) {
    if (now - lastCameraFrame > 3000) {
      spot = null; drawOverlay(); drawGameOverlay(null);
      $('spotBadge').textContent = 'الفيديو متوقف'; $('spotBadge').classList.remove('found');
    }
    return;
  }
  lastCameraFrame = now; lastVideoTime = video.currentTime;
  if (demo) renderDemo(now);
  const source = demo ? demoCanvas : video;
  const sw = demo ? 640 : video.videoWidth, sh = demo ? 480 : video.videoHeight;
  const width = Math.min(Number($('resolution').value), sw), height = Math.round(width * sh / sw);
  if (width !== previousWidth || height !== previousHeight) {
    processing.width = display.width = width; processing.height = display.height = height;
    previousWidth = width; previousHeight = height; clearCalibration();
  }
  processingCtx.drawImage(source, 0, 0, width, height);
  const image = processingCtx.getImageData(0, 0, width, height);
  displayCtx.save();
  displayCtx.clearRect(0, 0, width, height);
  if ($('mirror').checked) { displayCtx.translate(width, 0); displayCtx.scale(-1, 1); }
  displayCtx.drawImage(processing, 0, 0); displayCtx.restore();
  detector.mode = $('colorMode').value; detector.sensitivity = Number($('sensitivity').value) / 100;
  spot = detector.detect(image.data, width, height, corners);
  frameCounter++; fpsCount++;
  if (now - fpsSince > 800) { $('fps').textContent = Math.round(fpsCount * 1000 / (now - fpsSince)) + ' FPS'; fpsCount = 0; fpsSince = now; }
  $('videoSize').textContent = width + ' × ' + height;
  $('spotBadge').classList.toggle('found', Boolean(spot));
  $('spotBadge').textContent = spot ? (spot.bloom ? 'نقطة ليزر · قلب مضيء وهالة' : 'نقطة ليزر') : 'جاري البحث عن نقطة';
  $('coordinate').textContent = spot ? 'X ' + (spot.x * 100).toFixed(1) + '%   Y ' + (spot.y * 100).toFixed(1) + '%' : 'X —   Y —';
  if (calibrating && now >= nextFrameScan && frameDetector) {
    nextFrameScan = now + 400;
    try {
      const found = frameDetector.detect(image);
      if (found) { saveCalibration(found, 'تلقائية'); toast('تم التقاط الفريم ومعايرة مساحة العرض.'); }
      else if (now - scannedAt > 15000) { calibrating = false; $('autoCalibrate').textContent = 'إعادة التقاط الفريم'; $('calibrationBadge').textContent = matrix ? 'المعايرة السابقة محفوظة' : 'الفريم غير واضح'; toast('جرّب تحديد الأركان يدويًا، أو زوّد وضوح الفريم الأزرق.'); }
    } catch (error) { calibrating = false; $('autoCalibrate').textContent = 'إعادة التقاط الفريم'; toast('تعذّر تحليل الفريم. استخدم المعايرة اليدوية.'); console.error(error); }
  }
  const mapped = spot ? projectPoint(matrix, spot) : null;
  const inside = mapped && mapped.x >= 0 && mapped.x <= 1 && mapped.y >= 0 && mapped.y <= 1;
  if (spot) {
    lastSeen = now;
    if (!latched) {
      latched = true;
      if (inside && range?.shoot(mapped, now)) { score++; $('score').textContent = String(score).padStart(2, '0'); }
    }
  } else if (now - lastSeen >= 150) latched = false;
  drawOverlay(); drawGameOverlay(inside ? mapped : null);
}

async function loadOpenCV() {
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = './vendor/opencv.js';
      const timeout = setTimeout(() => reject(new Error('OpenCV timeout')), 25000);
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('OpenCV load failed')); };
      document.head.append(script);
    });
    let cv = window.cv;
    if (!cv) throw new Error('OpenCV module missing');
    if (!cv.Mat) await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('OpenCV init timeout')), 20000);
      const ready = module => { if (module) cv = module; clearTimeout(timeout); resolve(); };
      // Older OpenCV builds return a self-referencing thenable. Resolve without
      // passing that module into Promise resolution to avoid an infinite loop.
      if (typeof cv.then === 'function') cv.then(ready);
      else cv.onRuntimeInitialized = () => ready();
    });
    frameDetector = new FrameDetector(cv); $('cvStatus').textContent = 'OpenCV جاهز · معايرة تلقائية أو يدوية'; updateSource();
  } catch (error) { $('cvStatus').textContent = 'المعايرة اليدوية متاحة'; console.warn(error.message); }
}
$('startHero').addEventListener('click', startCamera);
$('startCamera').addEventListener('click', toggleCamera);
$('cameraSelect').addEventListener('change', () => { if (stream) startCamera(); });
$('demoHero').addEventListener('click', toggleDemo); $('demoToggle').addEventListener('click', toggleDemo);
$('sensitivity').addEventListener('input', () => $('sensitivityValue').textContent = $('sensitivity').value + '%');
$('autoCalibrate').addEventListener('click', calibrateAutomatically);
$('manualCalibrate').addEventListener('click', beginManual);
$('resetCalibration').addEventListener('click', () => { clearCalibration(); toast('اتلغت المعايرة.'); });
$('resetScore').addEventListener('click', resetScore);
$('showFrame').addEventListener('change', () => $('projection').classList.toggle('frame-hidden', !$('showFrame').checked));
$('fullscreen').addEventListener('click', () => fullscreen(document.documentElement));
$('rangeFullscreen').addEventListener('click', () => fullscreen($('projectionShell'), true));
$('exitRange').addEventListener('click', closeRange);
document.addEventListener('fullscreenchange', () => {
  $('exitRange').hidden = document.fullscreenElement !== $('projectionShell') && !$('projectionShell').classList.contains('expanded');
});
window.addEventListener('pagehide', () => { cameraEpoch++; stopStream(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeRange(); });
if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => listCameras());
import('./range.js?v=22').then(({ TargetRange }) => { range = new TargetRange($('game')); }).catch(async () => {
  const { CanvasTargetRange } = await import('./range-fallback.js?v=22');
  range = new CanvasTargetRange($('game'));
  $('rangeHint').textContent = 'وضع توافق الرسم · كل ظهور جديد يُحسب ضربة';
});
loadOpenCV(); listCameras(); updateSource(); requestAnimationFrame(loop);
