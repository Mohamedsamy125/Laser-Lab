export const BARRIER_TYPES = ['wood', 'crates', 'stone', 'logs'];
export const NINJA_SIZE = 144;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const dimensions = { wood: [90,106], crates: [108,95], stone: [120,83], logs: [126,73] };

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 4294967296);
}

// Build the reachable route first, then place obstacles on its safe landings.
export function generateRoute(level, random = Math.random) {
  const number = Math.max(1, Math.floor(level));
  const platforms = [], barriers = [];
  const types = BARRIER_TYPES.slice();
  for (let i=types.length-1;i>0;i--) {
    const j=Math.floor(random()*(i+1));[types[i],types[j]]=[types[j],types[i]];
  }
  const count = Math.min(11, 6 + Math.floor((number - 1) / 2));
  let start = 0, height = 0;
  const rises = [-65, -40, 0, 40, 65, 85];
  for (let index = 0; index < count; index++) {
    if (index) height = clamp(height + rises[Math.floor(random() * rises.length)], 0, 255);
    if (index === 1) height = 40 + Math.floor(random() * 3) * 20;
    const pair = number > 1 && index > 0 && random() < Math.min(.55, number * .08);
    const width = 350 + random() * 95 + (pair ? 220 : 0);
    const platform = { index, start, end: start + width, height,
      terrain: height > 150 ? 'high' : height > 60 ? 'medium' : index ? 'low' : 'flat' };
    platforms.push(platform);
    for (let gate = 0; gate < (pair ? 2 : 1); gate++) {
      const type = types[barriers.length % types.length];
      const size = .9 + random() * .14;
      const [w,h] = dimensions[type];
      const x = gate ? platform.end - 108 : start + 184 + random() * 32;
      barriers.push({ id: barriers.length, platform: index, type, x, y: height,
        width: w * size, height: h * size, destroyed: false });
    }
    start = platform.end + 32 + random() * 26;
  }
  return { number, platforms, barriers, end: platforms.at(-1).end - 35 };
}

export function currentBarrier(route) { return route.barriers.find(barrier => !barrier.destroyed) || null; }
export function stopPosition(barrier) { return barrier.x - barrier.width / 2 - 36; }

export class NinjaRun {
  constructor({ random = Math.random } = {}) {
    this.random = random; this.state = 'ready'; this.level = 1; this.elapsed = 0;
    this.cleared = 0; this.effects = []; this.beginLevel(1);
  }
  beginLevel(number) {
    this.level = number;
    this.route = generateRoute(number, this.random);
    this.player = { x: 46, y: 0, platform: 0, motion: 'running', animationTime: 0 };
    this.cameraX = this.player.x; this.cameraY = 0;
    this.jump = null; this.breakRemaining = 0; this.introRemaining = .6; this.effects = [];
  }
  start() {
    this.state = 'playing'; this.elapsed = 0; this.cleared = 0; this.beginLevel(1);
  }
  get target() { return currentBarrier(this.route); }
  get speed() { return 164 + Math.min(this.level - 1, 12) * 5; }
  step(dt) {
    if (this.state !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;
    this.introRemaining = Math.max(0, this.introRemaining - dt);
    this.effects = this.effects.filter(effect => (effect.age += dt) < .85);
    if (this.breakRemaining > 0) {
      this.breakRemaining = Math.max(0, this.breakRemaining - dt);
      if (!this.breakRemaining) { this.beginLevel(this.level + 1); return 'level-start'; }
      return;
    }
    const player = this.player;
    player.animationTime += dt;
    const platform = this.route.platforms[player.platform];
    const next = this.route.platforms[player.platform + 1];
    const target = this.target;
    const stop = target ? stopPosition(target) : this.route.end;
    if (this.jump) {
      this.jump.t = Math.min(1, this.jump.t + dt / this.jump.duration);
      const { fromX, toX, fromY, toY, t } = this.jump;
      player.x = fromX + (toX - fromX) * t;
      player.y = fromY + (toY - fromY) * t + Math.sin(Math.PI * t) * (85 + Math.max(0,toY-fromY)*.25);
      player.motion = 'jumping';
      if (t === 1) { player.platform++; this.jump = null; player.motion = 'running'; player.animationTime = 0; }
    } else if (player.x >= stop - .01) {
      player.x = stop; player.y = platform.height; player.motion = 'waiting';
      if (!target) { this.breakRemaining = 1.1; this.cleared++; return 'level-clear'; }
    } else {
      const takeoff = next ? platform.end - 24 : this.route.end;
      player.x = Math.min(player.x + this.speed * dt, stop, takeoff);
      player.y = platform.height; player.motion = 'running';
      if (next && player.x >= takeoff && stop > takeoff) {
        const toX = next.start + 36;
        this.jump = { fromX: player.x, toX, fromY: platform.height, toY: next.height, t: 0,
          duration: Math.max(.52, (toX - player.x) / this.speed) };
        player.motion = 'jumping'; player.animationTime = 0;
      }
    }
    const follow = 1 - Math.exp(-7 * dt);
    this.cameraX += (player.x - this.cameraX) * follow;
    const ground = this.jump ? this.jump.fromY + (this.jump.toY-this.jump.fromY) * this.jump.t : this.route.platforms[player.platform].height;
    this.cameraY += (ground - this.cameraY) * follow;
  }
  shoot(x,y,contains = () => true) {
    if (this.state !== 'playing' || this.breakRemaining || !Number.isFinite(x) || !Number.isFinite(y)) return 'ignored';
    const target = this.target;
    if (!target) return 'miss';
    const u = (target.x + target.width / 2 - x) / target.width;
    const v = (target.y + target.height - y) / target.height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1 || !contains(target.type,u,v)) return 'miss';
    target.destroyed = true;
    this.effects.push({ ...target, age: 0, seed: Math.floor(this.random()*10000) });
    if (this.player.motion === 'waiting') { this.player.motion = 'running'; this.player.animationTime = 0; }
    return 'hit';
  }
}

export function viewFor(width,height,model) {
  const scale = Math.min(height / 520, width / 450);
  return { width,height,scale, anchor: width * .76, baseline: height * .76,
    cameraX: model.cameraX, cameraY: model.cameraY };
}
export function toScreen(x,y,view) {
  return { x: view.anchor - (x-view.cameraX) * view.scale,
    y: view.baseline - (y-view.cameraY) * view.scale };
}
export function toWorld(u,v,view) {
  return { x: view.cameraX + (view.anchor-u*view.width) / view.scale,
    y: view.cameraY + (view.baseline-v*view.height) / view.scale };
}
