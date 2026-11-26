const root = new URL('./assets/', import.meta.url);
export const ART_FILES = {
  fog: 'environments/woodland-fog.png',
  idle: 'animations/Ninja_Idle_Sheet.png', run: 'animations/Ninja_Run_Sheet.png',
  jump: 'animations/Ninja_Jump_Sheet.png', flat: 'environments/ground_flat.png',
  low: 'environments/step_low.png', medium: 'environments/step_medium.png', high: 'environments/step_high.png',
  straight: 'environments/tree_straight.png', leaning: 'environments/tree_leaning.png', stump: 'environments/tree_stump.png',
  wood: 'textures/barrier_wood.png', crates: 'textures/barrier_crates.png',
  stone: 'textures/barrier_stone.png', logs: 'textures/barrier_logs.png',
};
export function frameAt(durations, seconds) {
  const total = durations.reduce((sum,duration) => sum + duration,0);
  let at = (seconds * 1000) % total;
  for (let i=0;i<durations.length;i++) { at -= durations[i]; if(at<0)return i; }
  return 0;
}
export async function loadArt() {
  const art = {};
  await Promise.all(Object.entries(ART_FILES).map(async ([name,path]) => {
    const image = await new Promise((resolve,reject) => {
      const item = new Image(); item.onload=()=>resolve(item);
      item.onerror=()=>reject(new Error('تعذّر تحميل أصل النينجا: '+path));
      item.src = new URL(path,root).href;
    });
    const sheet = document.createElement('canvas'); sheet.width=image.width; sheet.height=image.height;
    const context=sheet.getContext('2d'); context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,sheet.width,sheet.height);
    for(let i=0;i<pixels.data.length;i+=4) {
      const peak=Math.max(pixels.data[i],pixels.data[i+1],pixels.data[i+2]);
      if(peak<=136)continue;
      const scale=136/peak;
      for(let c=0;c<3;c++)pixels.data[i+c]=Math.round(pixels.data[i+c]*scale);
    }
    context.putImageData(pixels,0,0);
    let mask=null;
    if(['wood','crates','stone','logs'].includes(name)) {
      const small=document.createElement('canvas');small.width=small.height=80;
      const c=small.getContext('2d');c.drawImage(sheet,0,0,80,80);
      const rgba=c.getImageData(0,0,80,80).data;
      mask=Uint8Array.from({length:6400},(_,i)=>rgba[i*4+3]>=32?1:0);
    }
    art[name]={image:sheet,mask};
  }));
  const timing=await fetch(new URL('animations/animation_timing.json',root));
  if(!timing.ok)throw new Error('تعذّر تحميل توقيت حركة النينجا.');
  art.timing=await timing.json();
  return art;
}
export function containsArt(art,type,u,v) {
  if(u<0||u>=1||v<0||v>=1)return false;
  return !!art[type].mask[Math.floor(v*80)*80+Math.floor(u*80)];
}
