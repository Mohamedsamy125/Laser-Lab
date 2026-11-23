import {insideQuad} from './debug-spot.js?v=11';

const MIN_HALO_BRIGHTNESS = 8;
const RED_ORANGE_DEGREES = 25;
const PINK_DEGREES = 70;

function isRedPink(r, g, b) {
  if (r <= g || Math.max(r, b) < MIN_HALO_BRIGHTNESS) return false;
  if (b > r) return 60 * (r - g) >= (120 - PINK_DEGREES) * (b - g);
  if (b >= g) return true;
  return 60 * (g - b) <= RED_ORANGE_DEGREES * (r - b);
}

function brightness(data, offset) {
  return (2 * data[offset] + data[offset + 1] + data[offset + 2]) * .25;
}

function sectorBit(x, y) {
  if (Math.abs(x) > 2 * Math.abs(y)) return 1 << (x > 0 ? 0 : 4);
  if (Math.abs(y) > 2 * Math.abs(x)) return 1 << (y > 0 ? 2 : 6);
  if (x > 0) return 1 << (y > 0 ? 1 : 7);
  return 1 << (y > 0 ? 3 : 5);
}

export class CoreHaloDetector {
  prepare(w, h) {
    if (this.w === w && this.h === h) return;
    this.w = w;
    this.h = h;
    this.integral = new Int32Array((w + 1) * (h + 1));
    this.prominence = new Float32Array(w * h);
    this.mask = new Uint8Array(w * h);
    this.candidates = new Int32Array(w * h);
    this.component = new Int32Array(w * h);
  }

  detect(data, w, h, corners = null, sensitivity = .5) {
    if (w < 1 || h < 1 || data.length !== w * h * 4) return null;
    this.prepare(w, h);
    const {integral, prominence, mask, candidates} = this;
    const stride = w + 1;
    let candidateCount = 0;
    mask.fill(0);
    for (let y = 0, p = 0, i = 0; y < h; y++) {
      let rowTotal = 0;
      const row = (y + 1) * stride;
      for (let x = 0; x < w; x++, p++, i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        rowTotal += 3 * r - 2 * g;
        integral[row + x + 1] = integral[row - stride + x + 1] + rowTotal;
        if (isRedPink(r, g, b)) candidates[candidateCount++] = p;
      }
    }
    // A sum table yields a local background estimate without a full blur
    // pass or a downsample that could erase a one-pixel laser dot.
    const scale = Math.min(w / 640, h / 480);
    const radius = Math.max(2, Math.round(24 * scale));
    const maxDiameter = Math.max(4, Math.round(64 * scale));
    const contrast = Math.max(.25, 2 - 2 * sensitivity);
    for (let n = 0; n < candidateCount; n++) {
      const p = candidates[n], x = p % w, y = Math.floor(p / w);
      const left = Math.max(0, x - radius), right = Math.min(w, x + radius + 1);
      const top = Math.max(0, y - radius), bottom = Math.min(h, y + radius + 1);
      const sum = integral[bottom * stride + right] - integral[top * stride + right]
        - integral[bottom * stride + left] + integral[top * stride + left];
      const local = 3 * data[p * 4] - 2 * data[p * 4 + 1] - sum / ((right - left) * (bottom - top));
      if (local > contrast && insideQuad((x + .5) / w, (y + .5) / h, corners)) {
        mask[p] = 1;
        prominence[p] = local;
      }
    }
    let best = null;
    for (let n = 0; n < candidateCount; n++) {
      const p = candidates[n];
      if (mask[p] !== 1) continue;
      const spot = this.measureComponent(data, p, maxDiameter, corners);
      if (spot && (!best || spot.score > best.score)) best = spot;
    }
    return best;
  }

  measureComponent(data, first, maxDiameter, corners) {
    const {w, h, component, mask, prominence} = this;
    component[0] = first;
    mask[first] = 2;
    let area = 1, sumX = 0, sumY = 0, sumWeight = 0, sumBrightness = 0, peak = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    for (let head = 0; head < area; head++) {
      const p = component[head], x = p % w, y = Math.floor(p / w);
      const weight = prominence[p];
      sumX += x * weight;
      sumY += y * weight;
      sumWeight += weight;
      sumBrightness += brightness(data, p * 4);
      peak = Math.max(peak, weight);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const neighbor = yy * w + xx;
          if (mask[neighbor] === 1) {
            mask[neighbor] = 2;
            component[area++] = neighbor;
          }
        }
      }
    }
    const width = maxX - minX + 1, height = maxY - minY + 1;
    const longer = Math.max(width, height), shorter = Math.min(width, height);
    if (longer > maxDiameter || longer > Math.max(3, shorter * 4)) return null;

    const x = sumX / sumWeight, y = sumY / sumWeight;
    const mean = sumBrightness / area;
    const core = this.findCore(data, area, x, y, mean, {minX, maxX, minY, maxY}, shorter, corners);
    const score = (core ? 500 : 0) + .5 * Math.min(peak, 255) + .05 * mean + 10 * area / (width * height);
    return {x: ((core?.x ?? x) + .5) / w, y: ((core?.y ?? y) + .5) / h, area, score, bloom: Boolean(core), color: 'red'};
  }

  findCore(data, area, x, y, mean, box, diameter, corners) {
    if (area < 3) return null;
    const {w, h, component} = this;
    const searchSq = Math.max(1, diameter * .45) ** 2;
    let bestBrightness = -1, bestDistance = Infinity;
    let coreX = 0, coreY = 0, coreExcess = 0;
    for (let yy = box.minY; yy <= box.maxY; yy++) {
      for (let xx = box.minX; xx <= box.maxX; xx++) {
        const distance = (xx - x) ** 2 + (yy - y) ** 2;
        if (distance > searchSq) continue;
        const i = (yy * w + xx) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], peak = Math.max(r, g, b);
        if (peak < 140 || peak - Math.min(r, g, b) > peak * .4) continue;
        const level = brightness(data, i);
        if (level < mean - 12 || level < bestBrightness || (level === bestBrightness && distance >= bestDistance)) continue;
        bestDistance = distance;
        bestBrightness = level;
        coreX = xx;
        coreY = yy;
        coreExcess = r - g;
      }
    }
    if (bestBrightness < 0 || !insideQuad((coreX + .5) / w, (coreY + .5) / h, corners)) return null;
    let sides = 0;
    for (let i = 0; i < area; i++) {
      const p = component[i];
      const dx = p % w - coreX, dy = Math.floor(p / w) - coreY;
      if ((dx || dy) && data[p * 4] - data[p * 4 + 1] > coreExcess) sides |= sectorBit(dx, dy);
    }
    let count = 0;
    for (let left = sides; left; left &= left - 1) count++;
    // Presence in both horizontal and vertical halves distinguishes the
    // colored edge of a spot from a single neighboring colored object.
    return count >= 3 && (sides & 0x0f) && (sides & 0xf0) && (sides & 0xc3) && (sides & 0x3c)
      ? {x: coreX, y: coreY} : null;
  }
}
