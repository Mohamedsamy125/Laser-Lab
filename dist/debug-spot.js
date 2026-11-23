export function rgbHSV(r,g,b){
  const v=Math.max(r,g,b),d=v-Math.min(r,g,b);
  return {h:d?hue(r,g,b,v,d):0,s:v?d/v*255:0,v,hex:'#'+[r,g,b].map(n=>Math.round(n).toString(16).padStart(2,'0')).join('').toUpperCase()};
}
function hue(r,g,b,max,spread){
  if(max===r)return ((g-b)/spread+(g<b?6:0))*30;
  return max===g?((b-r)/spread+2)*30:((r-g)/spread+4)*30;
}
export function insideQuad(x,y,corners){
  if(!corners)return true;let sign=0;
  for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4],c=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);if(Math.abs(c)<1e-9)continue;if(sign&&Math.sign(c)!==sign)return false;sign=Math.sign(c);}return true;
}
function isWhiteCore(data,index,minFloor,maxChroma){
  const i=index*4,r=data[i],g=data[i+1],b=data[i+2];
  const floor=Math.min(r,g,b),peak=Math.max(r,g,b);
  return floor>=minFloor&&peak>=230&&peak-floor<=maxChroma;
}

// Follow a compact clipped core from the colored pixels themselves. Its
// center can be several pixels away from the centroid of a one-sided halo.
function findWhiteCore(data,w,h,halo,area,peak,peakChroma){
  const minFloor=Math.max(216,peak-peakChroma+8);
  const maxChroma=Math.min(36,peakChroma*.8);
  const maxArea=Math.max(72,Math.round(w*h*.001));
  const seen=new Set(),core=[];
  for(let i=0;i<area;i++){
    const p=halo[i],x=p%w,y=Math.floor(p/w);
    for(let yy=Math.max(0,y-2);yy<=Math.min(h-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(w-1,x+2);xx++){
      const seed=yy*w+xx;
      if(seen.has(seed)||!isWhiteCore(data,seed,minFloor,maxChroma))continue;
      seen.add(seed);
      core.length=0;
      core.push(seed);
      let sx=0,sy=0,minX=w,maxX=0,minY=h,maxY=0,head=0;
      while(head<core.length&&core.length<=maxArea){
        const q=core[head++],cx=q%w,cy=Math.floor(q/w);
        sx+=cx+.5;sy+=cy+.5;
        minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);
        minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
        for(let y2=Math.max(0,cy-1);y2<=Math.min(h-1,cy+1);y2++)for(let x2=Math.max(0,cx-1);x2<=Math.min(w-1,cx+1);x2++){
          const next=y2*w+x2;
          if(seen.has(next)||!isWhiteCore(data,next,minFloor,maxChroma))continue;
          seen.add(next);core.push(next);
        }
      }
      // A large clipped patch is typically a reflection or screen content.
      if(core.length>maxArea)return null;
      const spanX=maxX-minX+1,spanY=maxY-minY+1;
      if(core.length>=2&&Math.max(spanX,spanY)<=3*Math.min(spanX,spanY)){
        return {x:sx/core.length,y:sy/core.length};
      }
    }
  }
  return null;
}

// Diagnostic color/compact-blob detector. It does not require a white laser
// core, calibration, a homography, or a valid game state to report a point.
export class ColorSpotDetector {
  detect(data,w,h,{mode='auto',sensitivity=.65,seed=null,corners=null,fallback=false}={}){
    const n=w*h;if(data.length!==n*4||w<8||h<8)return null;
    if(this.mask?.length!==n){this.mask=new Uint8Array(n);this.queue=new Int32Array(n);}const mask=this.mask,queue=this.queue;mask.fill(0);
    const minV=175-115*sensitivity,minS=110-70*sensitivity,tolerance=12+10*sensitivity;
    const paleS=30-20*sensitivity;
    const minChroma=fallback?paleS:minS;
    for(let p=0,i=0;p<n;p++,i+=4){
      const r=data[i],g=data[i+1],b=data[i+2],max=Math.max(r,g,b);
      if(max<minV)continue;
      const spread=max-Math.min(r,g,b);
      if(spread<5||spread*255<minChroma*max)continue;
      if(fallback&&spread*255<minS*max&&max<155)continue;
      const pixelHue=hue(r,g,b,max,spread);
      let matches;
      if(seed){const d=Math.abs(pixelHue-seed.h);matches=Math.min(d,180-d)<=tolerance;}
      else matches=mode!=='green'&&(pixelHue<16||pixelHue>162)||mode!=='red'&&pixelHue>32&&pixelHue<88;
      if(matches&&insideQuad((p%w+.5)/w,(Math.floor(p/w)+.5)/h,corners))mask[p]=1;
    }
    let best=null,candidates=0;const maxArea=fallback?Math.max(120,n*.002):Math.max(120,n*.006);
    for(let p=0;p<n;p++){
      if(mask[p]!==1)continue;let head=0,tail=1,area=0,sx=0,sy=0,total=0,minX=w,maxX=0,minY=h,maxY=0,peak=0,peakChroma=0,peakSaturation=0;queue[0]=p;mask[p]=2;
      while(head<tail){
        const q=queue[head++],x=q%w,y=Math.floor(q/w),i=q*4,v=Math.max(data[i],data[i+1],data[i+2]),weight=v*v;
        if(fallback){
          const chroma=v-Math.min(data[i],data[i+1],data[i+2]);
          peakChroma=Math.max(peakChroma,chroma);
          peakSaturation=Math.max(peakSaturation,chroma/v*255);
        }
        area++;sx+=(x+.5)*weight;sy+=(y+.5)*weight;total+=weight;peak=Math.max(peak,v);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const t=yy*w+xx;if(mask[t]===1){mask[t]=2;queue[tail++]=t;}}
      }
      if(area>maxArea||!total)continue;
      const spanX=maxX-minX+1,spanY=maxY-minY+1;
      if(fallback&&Math.max(spanX,spanY)>3*Math.min(spanX,spanY))continue;
      const cx=sx/total,cy=sy/total,rx=Math.max(4,spanX*.8),ry=Math.max(4,spanY*.8);
      let surroundings=0,surroundingChroma=0,count=0;
      for(let k=0;k<16;k++){
        const angle=k*Math.PI/8,x=Math.round(cx+Math.cos(angle)*rx),y=Math.round(cy+Math.sin(angle)*ry);
        if(x<0||y<0||x>=w||y>=h)continue;
        const i=(y*w+x)*4,max=Math.max(data[i],data[i+1],data[i+2]);
        surroundings+=max;
        if(fallback)surroundingChroma+=max-Math.min(data[i],data[i+1],data[i+2]);
        count++;
      }
      const middle=(Math.min(h-1,Math.floor(cy))*w+Math.min(w-1,Math.floor(cx)))*4;
      const core=Math.max(data[middle],data[middle+1],data[middle+2]);
      const contrast=count?Math.max(peak,core)-surroundings/count:0;
      const chromaContrast=count?peakChroma-surroundingChroma/count:0;
      let bloom=null;
      if(fallback){
        // A pale component needs a compact white core and local color contrast.
        // A weak colored dot needs a stronger luminance peak or chroma contrast.
        if(peakSaturation<minS){
          if(chromaContrast<9||area<3)continue;
          bloom=findWhiteCore(data,w,h,queue,area,peak,peakChroma);
          if(!bloom||!insideQuad(bloom.x/w,bloom.y/h,corners))continue;
        }else if(contrast<24-10*sensitivity&&chromaContrast<42-16*sensitivity)continue;
      }else if(contrast<18-12*sensitivity)continue;
      candidates++;
      const score=Math.max(peak,core,bloom?230:0)+Math.max(contrast,chromaContrast)*.6+Math.min(10,area*.1);
      if(!best||score>best.score)best={x:(bloom?.x??cx)/w,y:(bloom?.y??cy)/h,area,score,bloom:!!bloom,color:seed?'picked':mode,candidates};
    }
    if(best)best.candidates=candidates;return best;
  }
}
