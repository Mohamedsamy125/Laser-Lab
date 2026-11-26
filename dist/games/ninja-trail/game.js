import { NinjaRun, NINJA_SIZE, seededRandom, viewFor, toScreen, toWorld } from './route.js';
import { loadArt, frameAt, containsArt } from './art.js';

export function createGame({ mount, playSound = () => {} }) {
  const root = document.createElement('div');
  root.className = 'ninja-trail';
  root.innerHTML = '<canvas class="ninja-trail__canvas" aria-label="نينجا يجري من اليمين لليسار ويتوقف أمام الحاجز القابل للتدمير"></canvas>';
  mount.append(root);
  const canvas = root.querySelector('canvas');
  const context = canvas.getContext('2d', {alpha:false});
  const style = document.createElement('link'); style.rel='stylesheet';
  const styleReady = new Promise((resolve,reject) => {style.onload=resolve;style.onerror=()=>reject(new Error('تعذّر تحميل مظهر طريق النينجا.'));});
  style.href = new URL('./game.css',import.meta.url).href; document.head.append(style);
  const model = new NinjaRun();
  let art, width=1280, height=720, quality='high', disposed=false, flash=null;
  const view = () => viewFor(width,height,model);

  function resize() {
    if(disposed)return;
    const r=root.getBoundingClientRect();if(!r.width||!r.height)return;
    width=r.width;height=r.height;
    const ratio=Math.min(devicePixelRatio||1,quality==='performance'?1:quality==='balanced'?1.25:1.5);
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
    context.setTransform(ratio,0,0,ratio,0,0);draw();
  }
  const observer=new ResizeObserver(resize);observer.observe(root);

  function drawBackground(v) {
    const sky=context.createLinearGradient(0,0,0,height);
    sky.addColorStop(0,'#1d230f');sky.addColorStop(.65,'#4e5828');sky.addColorStop(1,'#69713b');
    context.fillStyle=sky;context.fillRect(0,0,width,height);
    const fogImage=art.fog.image;
    const fogScale=Math.max(width/fogImage.width,height/fogImage.height)*1.06;
    const fogWidth=fogImage.width*fogScale,fogHeight=fogImage.height*fogScale;
    const driftX=Math.sin(model.elapsed*.035)*width*.012;
    const driftY=Math.sin(model.elapsed*.025)*height*.006;
    context.drawImage(fogImage,(width-fogWidth)/2+driftX,(height-fogHeight)/2+driftY,fogWidth,fogHeight);
    for(let layer=0;layer<2;layer++) {
      const parallax=layer ? .23 : .09, spacing=layer ? 225 : 340;
      const seed=Math.floor(model.cameraX*parallax/spacing);
      context.globalAlpha=layer ? .82 : .34;
      for(let i=seed-4;i<seed+Math.ceil(width/v.scale/spacing)+5;i++) {
        const random=seededRandom((i+999)*737+layer*91+model.level*13);
        const key=['straight','leaning','stump'][Math.floor(random()*3)];
        const image=art[key].image;
        const h=(310+random()*230)*v.scale*(layer?1:.8),w=h*image.width/image.height;
        const x=v.anchor-(i*spacing+random()*70-model.cameraX*parallax)*v.scale;
        const y=height*(layer ? .95 : .80)+model.cameraY*v.scale*.09;
        context.save();context.translate(x,y);if(random()>.5)context.scale(-1,1);
        context.drawImage(image,-w/2,-h,w,h);context.restore();
      }
    }
    context.globalAlpha=1;
    const fog=context.createLinearGradient(0,height*.45,0,height);
    fog.addColorStop(0,'#72743b00');fog.addColorStop(1,'#71783a55');
    context.fillStyle=fog;context.fillRect(0,0,width,height);
  }
  function drawPlatforms(v) {
    for(const platform of model.route.platforms) {
      const left=toScreen(platform.end,platform.height,v),right=toScreen(platform.start,platform.height,v);
      if(right.x<0||left.x>width)continue;
      const w=right.x-left.x;
      context.fillStyle='#11150c';context.fillRect(left.x,left.y,w,Math.max(0,height-left.y)+30);
      const image=art[platform.terrain].image;
      const surface={flat:75,low:65,medium:96,high:80}[platform.terrain];
      const h=w*image.height/image.width;
      context.globalAlpha=.82;
      context.drawImage(image,left.x,left.y-surface/image.height*h,w,h);
      context.globalAlpha=1;context.strokeStyle='#646b4259';context.lineWidth=1;
      context.beginPath();context.moveTo(left.x+2,left.y+1);context.lineTo(right.x-2,left.y+1);context.stroke();
    }
  }
  function drawBarriers(v) {
    const target=model.target;
    for(const barrier of model.route.barriers) {
      if(barrier.destroyed)continue;
      const p=toScreen(barrier.x,barrier.y,v),w=barrier.width*v.scale,h=barrier.height*v.scale;
      if(p.x+w/2<0||p.x-w/2>width)continue;
      context.drawImage(art[barrier.type].image,p.x-w/2,p.y-h,w,h);
      if(barrier===target) {
        const margin=6, corner=Math.min(12,w*.18);
        context.strokeStyle='#838b58';context.lineWidth=1.4;
        context.beginPath();
        for(const [x,y,dx,dy] of [[p.x-w/2-margin,p.y-h-margin,1,1],[p.x+w/2+margin,p.y-h-margin,-1,1],[p.x-w/2-margin,p.y+margin,1,-1],[p.x+w/2+margin,p.y+margin,-1,-1]]) {
          context.moveTo(x+dx*corner,y);context.lineTo(x,y);context.lineTo(x,y+dy*corner);
        }
        context.stroke();
      }
    }
  }
  function drawPlayer(v) {
    const player=model.player;
    const name=player.motion==='jumping'?'jump':player.motion==='waiting'?'idle':'run';
    const durations=art.timing[name+'_ms'];
    const frame=name==='jump'?Math.min(7,Math.floor((model.jump?.t||0)*8)):frameAt(durations,player.animationTime);
    const columns=name==='idle'?3:4;
    const p=toScreen(player.x,player.y,v),size=NINJA_SIZE*v.scale;
    context.save();context.translate(p.x,p.y);context.scale(-1,1);
    context.drawImage(art[name].image,(frame%columns)*512,Math.floor(frame/columns)*512,512,512,
      -size/2,-size*art.timing.baseline_y/512,size,size);
    context.restore();
  }
  function drawEffects(v) {
    for(const effect of model.effects) {
      const image=art[effect.type].image,random=seededRandom(effect.seed);
      const p=toScreen(effect.x,effect.y,v),w=effect.width*v.scale,h=effect.height*v.scale,t=effect.age;
      context.globalAlpha=Math.max(0,1-t/.85);
      for(let i=0;i<12;i++) {
        const vx=(random()-.5)*220,vy=-(80+random()*150),spin=(random()-.5)*6;
        const x=p.x-w/2+(i%4+.5)*w/4+vx*t*v.scale;
        const y=p.y-h+(Math.floor(i/4)+.5)*h/3+(vy*t+250*t*t)*v.scale;
        context.save();context.translate(x,y);context.rotate(spin*t);
        context.drawImage(image,i%4*image.width/4,Math.floor(i/4)*image.height/3,image.width/4,image.height/3,-w/8,-h/6,w/4,h/3);
        context.restore();
      }
    }
    context.globalAlpha=1;
  }
  function draw() {
    if(!art){context.fillStyle='#293214';context.fillRect(0,0,width,height);return;}
    const v=view();drawBackground(v);drawPlatforms(v);drawBarriers(v);drawEffects(v);drawPlayer(v);
    if(flash&&model.elapsed-flash.at<.14) {
      const p=toScreen(flash.x,flash.y,v);
      context.strokeStyle='#879160';context.lineWidth=1.4;context.beginPath();context.arc(p.x,p.y,9,0,Math.PI*2);context.stroke();
    }
    const fade=model.breakRemaining>0 ? 1-model.breakRemaining/1.1 : model.state==='playing' ? model.introRemaining/.6 : 0;
    if(fade>0) {
      context.fillStyle='#293214';context.globalAlpha=fade;
      context.fillRect(0,0,width,height);context.globalAlpha=1;
    }
  }
  return {
    async load() { [art]=await Promise.all([loadArt(),styleReady]);resize(); },
    start() { model.start();flash=null;playSound('start');draw(); },
    frame(dt) { const event=model.step(dt);if(event==='level-clear')playSound('clear');if(event==='level-start')playSound('start');draw(); },
    shoot({x,y}) {
      if(!art||x<0||x>1||y<0||y>1)return;
      const point=toWorld(x,y,view());
      const result=model.shoot(point.x,point.y,(type,u,v)=>containsArt(art,type,u,v));
      if(result==='ignored')return;
      if(result==='hit') {flash={...point,at:model.elapsed};playSound('hit');}else playSound('miss');
      draw();
    },
    setQuality(value) {quality=value;resize();},
    dispose() {disposed=true;observer.disconnect();style.remove();root.remove();},
  };
}
