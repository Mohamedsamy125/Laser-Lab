// Compress highlights into muted slate/teal. Applied once on loading each
// atlas, so every animation frame (including the hit flash) uses this palette.
// Alpha is untouched: the original hit masks and silhouettes remain valid.
export function shadeSpritePixels(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (peak <= 96) continue;
    const amount = (peak - 96) / 159;
    const scale = (96 + amount * 40) / peak;
    pixels[i] = Math.round(pixels[i] * scale * (1 - amount * .2));
    pixels[i + 1] = Math.round(pixels[i + 1] * scale * (1 - amount * .02));
    pixels[i + 2] = Math.round(pixels[i + 2] * scale);
  }
  return pixels;
}

export function shadeSpriteSheet(image) {
  const sheet = document.createElement('canvas');
  sheet.width = image.naturalWidth || image.width;
  sheet.height = image.naturalHeight || image.height;
  const context = sheet.getContext('2d');
  context.drawImage(image, 0, 0);
  const frame = context.getImageData(0, 0, sheet.width, sheet.height);
  shadeSpritePixels(frame.data);
  context.putImageData(frame, 0, 0);
  return sheet;
}
