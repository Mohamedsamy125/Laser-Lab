import { AlienRound, animationFrame, maskContains, waveRules } from './round.js';

const assets = {
  sky: new URL('./assets/images/backgrounds/Silent Jade Space Gradient.png', import.meta.url).href,
  sprites: new URL('./assets/animations/sprites.json', import.meta.url),
};
const BEST_KEY = 'laser-lab:space-aliens:best:v1';
const loadImage = url => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('تعذّر تحميل صورة اللعبة: ' + url));
  image.src = url;
});

export function createGame({ mount, playSound = () => {} }) {
  const root = document.createElement('div');
  root.className = 'space-aliens space-aliens--ready';
  root.innerHTML = `
    <canvas class="space-aliens__canvas" aria-label="فضائيون متحركون أمام الكوكب الأخضر"></canvas>
    <div class="space-aliens__mission" data-no-shot><span dir="ltr">JADE ORBIT</span><small>صوّب. أصب. كرّر.</small></div>
    <div class="space-aliens__hud" data-no-shot aria-label="إحصائيات الجولة">
      <div><span>النقاط <small data-stat="best">أفضل: 0</small></span><strong data-stat="score" dir="ltr">0000</strong></div>
      <div class="space-aliens__wave"><span>الموجة <small dir="ltr">UNLIMITED</small></span><strong data-stat="wave" dir="ltr">01</strong><i><b data-wave-bar></b></i><small data-stat="progress">0 / 5</small></div>
      <div><span>الدقة <small data-stat="hits">0 إصابة</small></span><strong data-stat="accuracy" dir="ltr">0%</strong></div>
    </div>
    <div class="space-aliens__spawn-status" data-stat="spawnStatus" data-no-shot></div>
    <section class="space-aliens__wave-banner" hidden aria-live="polite"><span data-wave-title></span><strong data-wave-detail></strong><small data-wave-rules></small></section>`;
  mount.append(root);
  const canvas = root.querySelector('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const fields = Object.fromEntries([...root.querySelectorAll('[data-stat]')].map(element => [element.dataset.stat, element]));
  const waveBar = root.querySelector('[data-wave-bar]');
  const waveBanner = root.querySelector('.space-aliens__wave-banner');
  const waveTitle = root.querySelector('[data-wave-title]');
  const waveDetail = root.querySelector('[data-wave-detail]');
  const waveDescription = root.querySelector('[data-wave-rules]');
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const model = new AlienRound();
  let animation, sky, planetSheet;
  const characters = new Map();
  const planetLayer = document.createElement('canvas');
  const planetContext = planetLayer.getContext('2d');
  let width = 1280, height = 720, ratio = 1, quality = 'high', disposed = false;
  let feedback = null;
  let best = 0;
  try { best = Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0); } catch {}
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  const styleReady = new Promise((resolve, reject) => {
    stylesheet.onload = resolve;
    stylesheet.onerror = () => reject(new Error('تعذّر تحميل مظهر اللعبة.'));
  });
  stylesheet.href = new URL('./game.css', import.meta.url).href;
  document.head.append(stylesheet);
  const stars = Array.from({ length: 100 }, (_, i) => ({
    x: ((i * 127.13 + 17) % 997) / 997,
    y: ((i * i * 21.17 + 73) % 991) / 991,
    size: i % 7 === 0 ? 1.5 : .7,
    alpha: .15 + (i % 5) * .065,
  }));

  function updateStats() {
    const values = {
      score: String(model.score).padStart(4, '0'),
      wave: String(model.wave).padStart(2, '0'),
      progress: model.waveDefeated + ' / ' + model.rules.total,
      spawnStatus: 'في الساحة: ' + model.aliens.length + ' من ' + model.rules.maxAlive + ' · في الانتظار: ' + model.waiting,
      best: 'أفضل: ' + best,
      accuracy: model.accuracy + '%', hits: model.hits + ' إصابة',
    };
    for (const key of Object.keys(values)) if (fields[key].textContent !== values[key]) fields[key].textContent = values[key];
    waveBar.style.transform = 'scaleX(' + model.waveDefeated / model.rules.total + ')';
    const between = model.phase === 'intermission';
    waveBanner.hidden = model.state !== 'playing' || (!between && model.elapsed - model.waveStartedAt > 2.2);
    text(waveTitle, between ? 'تم تأمين الموجة ' + model.wave : 'الموجة ' + model.wave);
    text(waveDetail, between ? 'الموجة التالية خلال ' + Math.ceil(model.breakRemaining) : 'استعد للتصويب');
    const rules = between ? waveRules(model.wave + 1) : model.rules;
    text(waveDescription, rules.total + ' أعداء · ' + rules.maxAlive + ' معًا · سرعة ×' + (rules.speed / .13).toFixed(2));
  }

  function resize() {
    if (disposed) return;
    const box = root.getBoundingClientRect();
    if (!box.width || !box.height) return;
    width = box.width; height = box.height;
    ratio = Math.min(globalThis.devicePixelRatio || 1, quality === 'performance' ? 1 : quality === 'balanced' ? 1.25 : 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.direction = 'ltr';
    model.resize(width, height);
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(root);

  function drawSprite(entity, character, sequence, sheet, time, loop) {
    const frame = animationFrame(sequence, time, loop);
    const size = character.frameSize;
    context.save();
    context.translate(entity.x, entity.y);
    if (entity.vx < 0) context.scale(-1, 1);
    context.drawImage(sheet, frame % character.columns * size, Math.floor(frame / character.columns) * size,
      size, size, -entity.size / 2, -entity.size / 2, entity.size, entity.size);
    context.restore();
  }

  function draw() {
    context.fillStyle = '#081728';
    context.fillRect(0, 0, width, height);
    if (!sky || !planetSheet || !animation) return;
    const scale = Math.max(width / sky.width, height / sky.height);
    context.globalAlpha = .75;
    context.drawImage(sky, (width - sky.width * scale) / 2, (height - sky.height * scale) / 2, sky.width * scale, sky.height * scale);
    context.globalAlpha = 1;
    context.fillStyle = '#0a18385e';
    context.fillRect(0, 0, width, height);
    const diameter = Math.min(height * .76, width * .64);
    const planet = animation.planet;
    const planetTime = model.elapsed * planet.playbackRate;
    const planetFrame = animationFrame(planet, planetTime);
    const fraction = Math.max(0, Math.min(1, (planetTime * 1000 % planet.duration - planet.frames[planetFrame].at) / planet.frames[planetFrame].duration));
    planetContext.clearRect(0, 0, planet.frameSize, planet.frameSize);
    for (const [frame, alpha] of [[planetFrame, 1], [(planetFrame + 1) % planet.frames.length, fraction]]) {
      planetContext.globalAlpha = alpha;
      planetContext.drawImage(planetSheet, frame % planet.columns * planet.frameSize, Math.floor(frame / planet.columns) * planet.frameSize,
        planet.frameSize, planet.frameSize, 0, 0, planet.frameSize, planet.frameSize);
    }
    context.globalAlpha = .62;
    context.drawImage(planetLayer, width * .72 - diameter / 2, height * .46 - diameter / 2, diameter, diameter);
    context.globalAlpha = 1;
    for (const star of stars) {
      context.globalAlpha = star.alpha;
      context.fillStyle = '#89b6c6';
      context.fillRect(star.x * width, star.y * height, star.size, star.size);
    }
    context.globalAlpha = 1;
    context.strokeStyle = '#557d8624';
    context.lineWidth = 1;
    context.beginPath();
    context.ellipse(width * .72, height * .46, diameter * .62, diameter * .23, -.28, 0, Math.PI * 2);
    context.stroke();
    context.save();
    context.beginPath();
    context.rect(model.arena.x, model.arena.y, model.arena.width, model.arena.height);
    context.clip();
    if (model.state === 'ready') {
      for (let i = 0; i < 2; i++) {
        const character = [...characters.values()][i % characters.size];
        drawSprite({ x: width * (.42 + i * .27), y: height * (.56 - i * .09), size: model.spriteSize, vx: 1 }, character, character.idle, character.idleSheet, i * .8, true);
      }
    } else {
      for (const alien of model.aliens) {
        const character = characters.get(alien.type);
        drawSprite(alien, character, character.idle, character.idleSheet, alien.animationTime, true);
      }
      for (const effect of model.effects) {
        const character = characters.get(effect.type);
        drawSprite(effect, character, character.hit, character.hitSheet, effect.age, false);
        if (effect.age < .65) {
          context.globalAlpha = 1 - effect.age / .65;
          context.fillStyle = '#9abdb1';
          context.font = '600 19px system-ui';
          context.textAlign = 'center';
          context.fillText('+100', effect.x, effect.y - effect.size * .25 - effect.age * 40);
          context.globalAlpha = 1;
        }
      }
    }
    if (feedback && model.elapsed - feedback.at < .16) {
      context.strokeStyle = feedback.hit ? '#91b9aa' : '#658394';
      context.lineWidth = 1.5;
      const { x, y } = feedback;
      context.beginPath();
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        context.moveTo(x + a * 5, y + b * 5);
        context.lineTo(x + a * 11, y + b * 11);
      }
      context.stroke();
    }
    context.restore();
  }

  return {
    async load() {
      const response = await fetch(assets.sprites);
      if (!response.ok) throw new Error('تعذّر تحميل فريمات الفضائي.');
      animation = await response.json();
      await Promise.all(animation.enemies.map(async character => {
        for (const sequence of [character.idle, character.hit]) for (const frame of sequence.frames) {
          frame.mask = Uint8Array.from(atob(frame.mask), char => char.charCodeAt(0));
        }
        [character.idleSheet, character.hitSheet] = await Promise.all([
          loadImage(new URL(character.idle.image, assets.sprites).href),
          loadImage(new URL(character.hit.image, assets.sprites).href),
        ]);
        characters.set(character.id, character);
        model.hitDurations[character.id] = character.hit.duration / 1000;
      }));
      model.enemyTypes = animation.enemies.map(character => character.id);
      let at = 0;
      for (const frame of animation.planet.frames) { frame.at = at; at += frame.duration; }
      planetLayer.width = planetLayer.height = animation.planet.frameSize;
      [sky, planetSheet] = await Promise.all([loadImage(assets.sky), loadImage(new URL(animation.planet.image, assets.sprites).href)]);
      await styleReady;
      resize();
      updateStats();
    },
    start() {
      root.classList.remove('space-aliens--ready');
      feedback = null;
      resize();
      model.start();
      updateStats();
      draw();
    },
    frame(dt) {
      if (disposed) return;
      if (model.step(dt) === 'wave-start') playSound('start');
      updateStats();
      draw();
    },
    shoot({ x, y }) {
      const px = x * width, py = y * height;
      const kind = model.shoot(px, py, (alien, u, v) => {
        const character = characters.get(alien.type);
        const frame = animationFrame(character.idle, alien.animationTime);
        return maskContains(character.idle.frames[frame].mask, character.maskSize, u, v);
      });
      if (kind === 'ignored') return;
      feedback = { x: px, y: py, at: model.elapsed, hit: kind === 'hit' };
      playSound(kind);
      if (kind === 'hit' && model.phase === 'intermission') playSound('clear');
      if (model.score > best) {
        best = model.score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch {}
      }
      updateStats();
      draw();
    },
    setQuality(value) { quality = value; resize(); },
    dispose() { disposed = true; observer.disconnect(); stylesheet.remove(); root.remove(); },
  };
}
