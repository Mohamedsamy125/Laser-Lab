// Keeps the target test usable when the browser cannot create a WebGL context.
export class CanvasTargetRange {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.targets = [[.18,.23],[.82,.23],[.5,.5],[.18,.77],[.82,.77]].map(([x,y])=>({x,y,until:0}));
    this.resizeObserver = new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(canvas); this.resize();
  }
  resize() {
    const ratio = Math.min(devicePixelRatio || 1,2);
    const rect=this.canvas.getBoundingClientRect();
    this.canvas.width=Math.max(1,Math.round(rect.width*ratio));
    this.canvas.height=Math.max(1,Math.round(rect.height*ratio));
  }
  shoot(uv,now) {
    const target=this.targets.find(t=>Math.hypot((uv.x-t.x)*10,(uv.y-t.y)*6.25)<.39);
    if(!target)return false;
    target.until=now+350;return true;
  }
  render(now) {
    const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;
    ctx.fillStyle='#111f26';ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#23373e';ctx.lineWidth=1;
    for(let x=0;x<=w;x+=w/16){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=0;y<=h;y+=h/10){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    for(const target of this.targets){
      const x=target.x*w,y=target.y*h,scale=now<target.until?1.12:1;
      for(const [r,color] of [[.49,'#3b5456'],[.39,now<target.until?'#739d94':'#557772']]){
        ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r*w/10*scale,0,Math.PI*2);ctx.fill();
      }
      ctx.strokeStyle='#314b4b';ctx.lineWidth=Math.max(1,w/500);
      for(const r of [.13,.28]){ctx.beginPath();ctx.arc(x,y,r*w/10*scale,0,Math.PI*2);ctx.stroke();}
    }
  }
}
