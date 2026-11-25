// All games and input sources use the same firing feedback.
export function shootWithFeedback(game, uv, playSound) {
  if (!game || game.state !== 'playing' || game.paused) return false;
  if (!(uv?.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1)) return false;
  const result = game.shoot(uv);
  if (result === false || result?.kind === 'ignored') return false;
  playSound('shot');
  return true;
}

export const GUNSHOT_URL = new URL('./Sounds/gunshot.mp3', import.meta.url);
let encodedGunshot;
const samples = new WeakMap();

// Fetch while the game loads, then decode once per AudioContext on user input.
export function preloadGunshot(audio) {
  encodedGunshot ??= fetch(GUNSHOT_URL).then(response => {
    if (!response.ok) throw new Error('Gunshot audio: HTTP ' + response.status);
    return response.arrayBuffer();
  }).catch(error => { console.warn('تعذّر تحميل صوت المسدس.', error); return null; });
  if (!audio) return encodedGunshot;
  let sample = samples.get(audio);
  if (!sample) {
    sample = { buffer: null };
    sample.ready = encodedGunshot.then(bytes => bytes ? audio.decodeAudioData(bytes.slice(0)) : null)
      .then(buffer => { sample.buffer = buffer; return buffer; })
      .catch(error => { console.warn('تعذّر قراءة صوت المسدس.', error); return null; });
    samples.set(audio, sample);
  }
  return sample.ready;
}

export async function playGunshot(audio) {
  const requestedAt = performance.now();
  const buffer = samples.get(audio)?.buffer || await preloadGunshot(audio);
  // Do not replay an old shot if initial loading stalls or audio is suspended.
  if (!buffer || audio.state !== 'running' || performance.now() - requestedAt > 300) return;
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  source.buffer = buffer;
  gain.gain.value = .55;
  source.connect(gain);
  gain.connect(audio.destination);
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start();
}
