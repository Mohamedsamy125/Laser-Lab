// All games and input sources use the same firing feedback.
export function shootWithFeedback(game, uv, playSound) {
  if (!game || game.state !== 'playing' || game.paused) return false;
  if (!(uv?.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1)) return false;
  const result = game.shoot(uv);
  if (result === false || result?.kind === 'ignored') return false;
  playSound('shot');
  return true;
}

// A short noise crack and a low mechanical thump, without an external asset.
export function playGunshot(audio) {
  const at = audio.currentTime;
  const duration = .16;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  const noise = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const crack = audio.createGain();
  noise.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(6500, at);
  filter.frequency.exponentialRampToValueAtTime(700, at + duration);
  crack.gain.setValueAtTime(.24, at);
  crack.gain.exponentialRampToValueAtTime(.001, at + duration);
  noise.connect(filter);
  filter.connect(crack);
  crack.connect(audio.destination);

  const body = audio.createOscillator();
  const thump = audio.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(170, at);
  body.frequency.exponentialRampToValueAtTime(48, at + .1);
  thump.gain.setValueAtTime(.19, at);
  thump.gain.exponentialRampToValueAtTime(.001, at + .12);
  body.connect(thump);
  thump.connect(audio.destination);
  noise.onended = () => { noise.disconnect(); filter.disconnect(); crack.disconnect(); };
  body.onended = () => { body.disconnect(); thump.disconnect(); };
  noise.start(at);
  noise.stop(at + duration);
  body.start(at);
  body.stop(at + .13);
}
