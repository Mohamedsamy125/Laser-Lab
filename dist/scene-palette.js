// Reference colors are representative pixels of the existing textures.
export const BASE_PALETTE = Object.freeze({
  wall:'#273b55', floor:'#2a5959', trim:'#2d4455', robot:'#5e6c3c',
  light:'#6fb8c0', brightness:100,
});

export const PALETTE_PRESETS = {
  original:BASE_PALETTE,
  petrol:{
    wall:'#285459', floor:'#2d3a42', trim:'#3c5267', robot:'#5a7562',
    light:'#528789', brightness:108,
  },
  lightPetrol:{
    wall:'#4c7d7e', floor:'#43595f', trim:'#516e7a', robot:'#78947e',
    light:'#82a9a9', brightness:112,
  },
  lightSlate:{
    wall:'#566f88', floor:'#48565e', trim:'#597383', robot:'#809687',
    light:'#90bac6', brightness:110,
  },
};

export const PALETTE_COLORS = ['wall', 'floor', 'trim', 'robot', 'light'];

export function normalizePalette(value) {
  const palette = {...BASE_PALETTE};
  for (const key of PALETTE_COLORS) {
    const color = value?.[key];
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) palette[key] = color.toLowerCase();
  }
  if (Number.isFinite(value?.brightness)) palette.brightness = Math.max(65, Math.min(150, Math.round(value.brightness)));
  return palette;
}

export function palettePreset(palette) {
  return Object.keys(PALETTE_PRESETS).find(name =>
    PALETTE_COLORS.every(key => PALETTE_PRESETS[name][key] === palette[key]) &&
    PALETTE_PRESETS[name].brightness === palette.brightness) || 'custom';
}
