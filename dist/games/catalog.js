import robotOutbreak from './robot-outbreak/manifest.js';
import game_space_balloons from './space-balloons/manifest.js';
// GAME_IMPORTS — added by npm run game:new

const entries = [
  robotOutbreak,
  game_space_balloons,
  // GAME_ENTRIES — added by npm run game:new
];
const games = new Map();
for (const entry of entries) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) || games.has(entry.slug)) {
    throw new Error('Invalid or duplicate game slug: ' + entry.slug);
  }
  games.set(entry.slug, entry);
}

export function findGame(slug) {
  const entry = games.get(slug);
  return entry && entry.status !== 'draft' ? { ...entry, slug } : null;
}

export function listGames() {
  return Array.from(games.keys(), findGame).filter(Boolean);
}

export class ArcadeGame {
  constructor(module, mount, callbacks) {
    this.state = 'loading';
    this.paused = false;
    this.lastFrame = null;
    this.onPause = callbacks.onPause;
    this.game = module.createGame({ mount, restart: callbacks.restart, playSound: callbacks.playSound,
      finish: () => {
        if (this.state !== 'playing') return;
        this.state = 'finished'; this.paused = false; this.lastFrame = null; this.onPause(false);
      },
    });
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
    if (this.state === 'finished') return;
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
