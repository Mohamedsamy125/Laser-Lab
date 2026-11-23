// Add the slug used by the folder name and the title and description shown by Laser Lab.
const games = new Map([
  // ['pulse-targets', { title: 'Pulse Targets', description: 'تحدّي سرعة التصويب' }],
]);

export function findGame(slug) {
  const entry = games.get(slug);
  return entry ? { ...entry, slug } : null;
}

export function listGames() {
  return Array.from(games.keys(), findGame);
}

export class ArcadeGame {
  constructor(module, mount, callbacks) {
    this.state = 'loading';
    this.paused = false;
    this.lastFrame = null;
    this.onPause = callbacks.onPause;
    this.game = module.createGame({ mount, restart: callbacks.restart, playSound: callbacks.playSound });
  }

  async load() {
    await this.game.load?.();
    this.state = 'ready';
  }

  start() {
    this.state = 'playing';
    this.shots = 0;
    this.paused = false;
    this.lastFrame = null;
    this.game.start();
  }

  pause(value) {
    this.paused = Boolean(value);
    this.lastFrame = null;
    this.onPause(this.paused);
  }

  shoot(uv) {
    if (this.state !== 'playing' || this.paused) return;
    if (!(uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1)) return;
    this.shots++;
    this.game.shoot(uv);
  }

  render(now) {
    if (this.state !== 'playing' || this.paused) return;
    const dt = this.lastFrame === null ? 0 : Math.min((now - this.lastFrame) / 1000, 0.08);
    this.lastFrame = now;
    this.game.frame(dt);
  }

  setQuality(quality) {
    this.game.setQuality?.(quality);
  }

  dispose() {
    this.game.dispose();
  }
}
