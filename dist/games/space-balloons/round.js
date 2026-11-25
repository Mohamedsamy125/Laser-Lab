export const WAVE_BREAK_SECONDS = 3;

export function waveRules(number) {
  const wave = Math.max(1, Math.floor(number));
  const level = wave - 1;
  return {
    number: wave,
    total: 5 + level * 2,
    maxAlive: 2 + level,
    speed: .13 * (1 + level * .12),
    spawnInterval: Math.max(.55, 1.5 / (1 + level * .045)),
  };
}

export function wrapPosition(position, halfSize, extent) {
  const span = extent + halfSize * 2;
  return ((position + halfSize) % span + span) % span - halfSize;
}

export function animationFrame(animation, seconds, loop = true) {
  let time = Math.max(0, seconds * 1000);
  if (loop) time %= animation.duration;
  for (let index = 0; index < animation.frames.length; index++) {
    time -= animation.frames[index].duration;
    if (time < 0) return index;
  }
  return animation.frames.length - 1;
}

export function maskContains(mask, maskSize, x, y) {
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return false;
  const pixel = Math.floor(y * maskSize) * maskSize + Math.floor(x * maskSize);
  return !!(mask[pixel >> 3] & (1 << (pixel & 7)));
}

export class AlienRound {
  constructor({ random = Math.random, enemyTypes = ['cyclops', 'mocking'], hitDurations = {} } = {}) {
    this.random = random;
    this.enemyTypes = enemyTypes;
    this.hitDurations = hitDurations;
    this.state = 'ready';
    this.elapsed = 0;
    this.score = this.hits = this.shots = 0;
    this.aliens = [];
    this.effects = [];
    this.wave = 1;
    this.rules = waveRules(1);
    this.phase = 'wave';
    this.waveStartedAt = 0;
    this.spawned = this.waveDefeated = this.clearedWaves = 0;
    this.nextSpawnAt = .7;
    this.breakRemaining = 0;
    this.serial = 0;
    this.resize(1280, 720);
  }

  resize(width, height) {
    const previous = this.arena;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.arena = { x: 0, y: 0, width: this.width, height: this.height };
    this.spriteSize = Math.min(170, Math.min(this.width, this.height) * .25);
    if (previous) for (const entity of [...this.aliens, ...this.effects]) {
      entity.x = (entity.x - previous.x) / previous.width * this.arena.width + this.arena.x;
      entity.y = (entity.y - previous.y) / previous.height * this.arena.height + this.arena.y;
      entity.size = this.spriteSize * entity.scale;
    }
  }

  spawn() {
    const direction = Math.floor(this.random() * 4);
    const scale = .83 + this.random() * .29;
    const speed = .9 + this.random() * .2;
    const alien = {
      id: ++this.serial,
      type: this.enemyTypes[(this.spawned + this.wave - 1) % this.enemyTypes.length],
      x: this.arena.x + (.08 + this.random() * .84) * this.arena.width,
      y: this.arena.y + (.1 + this.random() * .8) * this.arena.height,
      scale, size: this.spriteSize * scale,
      vx: direction < 2 ? (direction === 0 ? 1 : -1) * speed : 0,
      vy: direction >= 2 ? (direction === 2 ? 1 : -1) * speed : 0,
      animationTime: this.random() * 4,
    };
    const padX = Math.min(alien.size * .48, this.arena.width * .24);
    const padY = Math.min(alien.size * .48, this.arena.height * .28);
    let best = null;
    for (let attempt = 0; attempt < 36; attempt++) {
      const x = this.arena.x + padX + this.random() * (this.arena.width - padX * 2);
      const y = this.arena.y + padY + this.random() * (this.arena.height - padY * 2);
      const clearance = this.aliens.reduce((nearest, other) => Math.min(nearest,
        Math.hypot(x - other.x, y - other.y) - (alien.size + other.size) * .43), Infinity);
      if (!best || clearance > best.clearance) best = { x, y, clearance };
      if (clearance >= 0) break;
    }
    alien.x = best.x; alien.y = best.y;
    return alien;
  }

  start() {
    this.state = 'playing';
    this.elapsed = 0;
    this.score = this.hits = this.shots = 0;
    this.effects = [];
    this.clearedWaves = 0;
    this.beginWave(1);
  }

  beginWave(number) {
    this.wave = number;
    this.rules = waveRules(number);
    this.phase = 'wave';
    this.waveStartedAt = this.elapsed;
    this.spawned = this.waveDefeated = 0;
    this.nextSpawnAt = this.elapsed + .7;
    this.breakRemaining = 0;
    this.aliens = [];
  }

  step(dt) {
    if (this.state !== 'playing' || !Number.isFinite(dt) || dt < 0) return false;
    const step = dt;
    this.elapsed += step;
    const speed = Math.min(this.width, this.height) * this.rules.speed;
    for (const alien of this.aliens) {
      alien.animationTime += step;
      alien.x = this.arena.x + wrapPosition(alien.x - this.arena.x + alien.vx * speed * step, alien.size / 2, this.arena.width);
      alien.y = this.arena.y + wrapPosition(alien.y - this.arena.y + alien.vy * speed * step, alien.size / 2, this.arena.height);
    }
    for (const effect of this.effects) effect.age += step;
    this.effects = this.effects.filter(effect => effect.age < effect.duration);
    if (this.phase === 'intermission') {
      this.breakRemaining = Math.max(0, this.breakRemaining - step);
      if (!this.breakRemaining) {
        this.beginWave(this.wave + 1);
        return 'wave-start';
      }
    } else if (this.spawned < this.rules.total && this.aliens.length < this.rules.maxAlive && this.elapsed >= this.nextSpawnAt) {
      // Never catch up a queue of missed spawns in a burst after a long frame.
      this.aliens.push(this.spawn());
      this.spawned++;
      this.nextSpawnAt = this.elapsed + this.rules.spawnInterval;
    }
    return false;
  }

  shoot(x, y, contains) {
    if (this.state !== 'playing' || this.phase !== 'wave' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > this.width || y < 0 || y > this.height) return 'ignored';
    this.shots++;
    if (x < this.arena.x || x > this.arena.x + this.arena.width || y < this.arena.y || y > this.arena.y + this.arena.height) return 'miss';
    for (let index = this.aliens.length - 1; index >= 0; index--) {
      const alien = this.aliens[index];
      const left = alien.x - alien.size / 2, top = alien.y - alien.size / 2;
      let u = (x - left) / alien.size;
      const v = (y - top) / alien.size;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      if (alien.vx < 0) u = Math.min(1 - Number.EPSILON, 1 - u);
      if (!contains(alien, u, v)) continue;
      this.aliens.splice(index, 1);
      this.effects.push({ ...alien, age: 0, duration: this.hitDurations[alien.type] ?? 1.77 });
      this.nextSpawnAt = Math.max(this.nextSpawnAt, this.elapsed + .55);
      this.hits++;
      this.score += 100;
      this.waveDefeated++;
      if (this.waveDefeated === this.rules.total) {
        this.clearedWaves++;
        this.phase = 'intermission';
        this.breakRemaining = WAVE_BREAK_SECONDS;
      }
      return 'hit';
    }
    return 'miss';
  }

  get waiting() { return this.rules.total - this.spawned; }
  get accuracy() { return this.shots ? Math.round(this.hits / this.shots * 100) : 0; }
}
