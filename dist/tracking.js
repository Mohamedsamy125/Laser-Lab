export class SpotDetector {
  constructor() { this.red = null; this.green = null; this.mode = 'auto'; this.sensitivity = 0.5; }
  detect(data, width, height, corners = null) {
    if (width * height * 4 !== data.length || width < 8 || height < 8) return null;
    this.data = data;
    this.width = width;
    this.height = height;
    this.corners = corners;
    const count=width*height;
    if(this.cachedWidth!==width||this.cachedHeight!==height){this.cachedWidth=width;this.cachedHeight=height;this.redLevels=new Uint8Array(count);this.greenLevels=new Uint8Array(count);this.redHalo=new Uint8Array(count);this.greenHalo=new Uint8Array(count);this.redIntegral=new Uint32Array((width+1)*(height+1));this.greenIntegral=new Uint32Array((width+1)*(height+1));}
    const s=this.sensitivity,min=115-50*s,difference=55-30*s,blueDifference=36-18*s;
    for(let p=0,i=0;p<count;p++,i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];this.redLevels[p]=(2*r+g+b+2)>>2;this.greenLevels[p]=(2*g+r+b+2)>>2;
      this.redHalo[p]=r>=min&&r-g>=difference&&r-b>=blueDifference?1:0;
      this.greenHalo[p]=g>=min&&g-r>=difference&&g-b>=blueDifference?1:0;
    }
    const stride=width+1;
    for(let y=0;y<height;y++){
      let red=0,green=0;for(let x=0,p=y*width;x<width;x++,p++){
        red+=this.redHalo[p];green+=this.greenHalo[p];const i=(y+1)*stride+x+1;
        this.redIntegral[i]=this.redIntegral[i-stride]+red;this.greenIntegral[i]=this.greenIntegral[i-stride]+green;
      }
    }
    const red = this.mode !== 'green' ? this.find(false) : null;
    const green = this.mode !== 'red' ? this.find(true) : null;
    if (!red) return green;
    if (!green) return red;
    return red.score >= green.score ? red : green;
  }
  inside(x, y) {
    if (!this.corners) return true;
    let winding = 0;
    for (let i = 0; i < 4; i++) {
      const a = this.corners[i], b = this.corners[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (Math.abs(cross) < 1e-9) continue;
      if (winding && Math.sign(cross) !== winding) return false;
      winding = Math.sign(cross);
    }
    return true;
  }
  channel(index, green) {
    const d = this.data, i = index * 4;
    return green ? [d[i + 1], d[i], d[i + 2]] : [d[i], d[i + 1], d[i + 2]];
  }
  brightness(index, green) {
    return (green?this.greenLevels:this.redLevels)[index];
  }
  halo(index, green) {
    return (green?this.greenHalo:this.redHalo)[index];
  }
  contrast4(core,a,b,c,d,min) {
    const difference=core-(a+b+c+d)*.25;
    return difference>=min&&core-Math.max(a,b,c,d)>=min*.6?difference:-1;
  }
  haloContrast(x,y,core,radius,green) {
    const outer=radius*2,w=this.width;
    if(x<outer||x+outer>=w||y<outer||y+outer>=this.height)return -1;
    const i=y*w+x,a=i-radius,b=i+radius,c=i-radius*w,d=i+radius*w;
    if(Number(this.halo(a,green))+Number(this.halo(b,green))+Number(this.halo(c,green))+Number(this.halo(d,green))<3)return -1;
    if(core*4-this.brightness(a,green)-this.brightness(b,green)-this.brightness(c,green)-this.brightness(d,green)<100-100*this.sensitivity)return -1;
    return this.contrast4(core,this.brightness(i-outer,green),this.brightness(i+outer,green),this.brightness(i-outer*w,green),this.brightness(i+outer*w,green),38-24*this.sensitivity);
  }
  nearbyHalo(x,y,green){
    const integral=green?this.greenIntegral:this.redIntegral,stride=this.width+1;
    const left=Math.max(0,x-11),right=Math.min(this.width,x+12),top=Math.max(0,y-11)*stride,bottom=Math.min(this.height,y+12)*stride;
    return integral[bottom+right]-integral[bottom+left]-integral[top+right]+integral[top+left];
  }
  rowBounds(y) {
    if(!this.corners)return [2,this.width-3];
    const v=(y+.5)/this.height;let lo=Infinity,hi=-Infinity;
    for(let i=0;i<4;i++){
      const a=this.corners[i],b=this.corners[(i+1)%4];
      if((a.y<=v&&b.y>v)||(b.y<=v&&a.y>v)){
        const x=a.x+(v-a.y)*(b.x-a.x)/(b.y-a.y);lo=Math.min(lo,x);hi=Math.max(hi,x);
      }
    }
    return [Math.max(2,Math.ceil(lo*this.width-.5)),Math.min(this.width-3,Math.floor(hi*this.width-.5))];
  }
  find(green) {
    const w = this.width, h = this.height, d = this.data;
    const s = this.sensitivity, minChannel = 205 - 95 * s, minCore = 230 - 85 * s;
    let bestScore = 0, bestX = 0, bestY = 0;
    for (let y = 2; y < h - 2; y++) {
      const [left,right]=this.rowBounds(y);
      for (let x=left,index=y*w+left;x<=right;x++,index++) {
        const i = index * 4;
        const r = d[i + (green ? 1 : 0)], g = d[i + (green ? 0 : 1)], b = d[i + 2];
        if (r < minChannel || r < g || r < b) continue;
        const core = (2 * r + g + b + 2) >> 2;
        if(core+26<=bestScore||core<this.brightness(index-2,green)||core<this.brightness(index+2,green)||core<this.brightness(index-w*2,green)||core<this.brightness(index+w*2,green))continue;
        let contrast = -1;
        if (core >= minCore && this.nearbyHalo(x,y,green)) {
          for (const radius of [1, 2, 3, 6, 11]) contrast = Math.max(contrast, this.haloContrast(x, y, core, radius, green));
        }
        // A distant/dim laser may have a colored core with no white center.
        // Require a compact local peak at several scales instead of a fixed halo.
        if (contrast < 0 && r >= minChannel && r - g >= 65 - 40 * s && r - b >= 40 - 22 * s) {
          for (const radius of [2, 4, 8, 14]) {
            if (x < radius || x + radius >= w || y < radius || y + radius >= h) continue;
            contrast=Math.max(contrast,this.contrast4(core,this.brightness(index-radius,green),this.brightness(index+radius,green),this.brightness(index-radius*w,green),this.brightness(index+radius*w,green),62-40*s));
          }
        }
        const score = core + contrast * 0.1;
        if (contrast < 0 || score <= bestScore) continue;
        bestScore = score; bestX = x; bestY = y;
      }
    }
    if (!bestScore) return null;
    const threshold = this.brightness(bestY * w + bestX, green) - 24;
    // Flood only the connected bright core. A broad saturated plateau has many
    // equal maxima; a fixed window around its first pixel biases the aim.
    const radius=24,side=radius*2+1,visited=new Uint8Array(side*side),queue=[{x:bestX,y:bestY}];
    let total=0,sx=0,sy=0,count=0;
    for(let head=0;head<queue.length;head++){
      const {x,y}=queue[head];if(x<0||y<0||x>=w||y>=h||Math.abs(x-bestX)>radius||Math.abs(y-bestY)>radius)continue;
      const local=(y-bestY+radius)*side+x-bestX+radius;if(visited[local])continue;visited[local]=1;
      const index=y*w+x,[r,g,b]=this.channel(index,green),weight=this.brightness(index,green)-threshold;
      if(weight<=0||r<g||r<b||!this.inside((x+.5)/w,(y+.5)/h))continue;
      if(++count>1200||Math.abs(x-bestX)===radius||Math.abs(y-bestY)===radius)return null;
      total+=weight;sx+=x*weight;sy+=y*weight;
      queue.push({x:x-1,y},{x:x+1,y},{x,y:y-1},{x,y:y+1});
    }
    if(!total)return null;
    return { x: (sx / total + 0.5) / w, y: (sy / total + 0.5) / h, score: bestScore, color: green ? 'green' : 'red' };
  }
}

export function orderCorners(points) {
  if (points.length !== 4) return null;
  const center = points.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
  const ring = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  if (maxX - minX < 0.02 || maxY - minY < 0.02) return null;
  const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  let best, score = Infinity;
  for (let start = 0; start < 4; start++) {
    const ordered = ring.map((_, i) => ring[(start + i) % 4]);
    const cost = ordered.reduce((v, p, i) => v + ((p.x - minX) / (maxX - minX) - unit[i].x) ** 2 + ((p.y - minY) / (maxY - minY) - unit[i].y) ** 2, 0);
    if (cost < score) { score = cost; best = ordered; }
  }
  return best;
}

export function homography(corners) {
  if (!corners || corners.length !== 4) return null;
  let area = 0, winding = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    area += a.x * b.y - b.x * a.y;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-5 || (winding && Math.sign(cross) !== winding)) return null;
    winding = Math.sign(cross);
  }
  if (Math.abs(area) < 0.01) return null;
  const to = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const rows = [];
  corners.forEach(({ x, y }, i) => {
    const [u, v] = to[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    if (Math.abs(rows[pivot][col]) < 1e-9) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = rows[col][col];
    for (let j = col; j < 9; j++) rows[col][j] /= scale;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = rows[r][col];
      for (let j = col; j < 9; j++) rows[r][j] -= factor * rows[col][j];
    }
  }
  return rows.map(r => r[8]).concat(1);
}
export function projectPoint(matrix, point) {
  if (!matrix) return null;
  const { x, y } = point;
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  if (Math.abs(denominator) < 1e-8) return null;
  const u = (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator;
  const v = (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator;
  return Number.isFinite(u) && Number.isFinite(v) ? { x: u, y: v } : null;
}

export class FrameDetector {
  constructor(cv) { this.cv=cv;this.profile=null;this.seed=null;this.diagnostic=null;this.lastPass=null; }
  setColor(r,g,b) {
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    const saturation=max?delta/max*255:0;
    if(saturation<40||max<45)return false;
    let hue=0;if(delta){hue=max===r?((g-b)/delta+6)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;hue*=30;}
    this.seed={h:hue,s:saturation,v:max,hex:'#'+[r,g,b].map(n=>Math.round(n).toString(16).padStart(2,'0')).join('').toUpperCase()};
    this.profile=null;this.lastPass=null;return true;
  }
  resetColor(){this.seed=null;this.profile=null;this.lastPass=null;}
  passes(hsv){
    const passes=[];const add=(h,r,s,v)=>passes.push({h,r,s,v});
    if(this.seed)add(this.seed.h,9,Math.max(40,this.seed.s*.5),Math.max(25,this.seed.v*.45));
    if(this.profile)add(this.profile.h,9,this.profile.s,this.profile.v);
    // Keep cyan and blue SEPARATE: a broad hue band fills the blue TV interior
    // and removes the hole that identifies the calibration rectangle.
    add(90,10,80,90);add(108,12,80,90);add(90,12,55,215);add(108,12,55,235);
    const histogram=new Float64Array(180),data=hsv.data;
    for(let i=0;i<data.length;i+=3){const h=data[i],sat=data[i+1],v=data[i+2];if(h>=72&&h<=140&&sat>=65&&v>=115)histogram[h]+=v/255;}
    const smooth=Array.from(histogram,(v,h)=>v+(histogram[h-1]||0)+(histogram[h+1]||0));
    for(let peak=0;peak<3;peak++){
      let hue=72;for(let h=73;h<=140;h++)if(smooth[h]>smooth[hue])hue=h;
      if(smooth[hue]<8)break;
      add(hue,7,65,105);add(hue,11,55,155);
      const brightness=new Uint32Array(256);let count=0;
      for(let i=0;i<data.length;i+=3)if(Math.abs(data[i]-hue)<=11&&data[i+1]>=55&&data[i+2]>=30){brightness[data[i+2]]++;count++;}
      const quantile=q=>{let sum=0;for(let v=0;v<256;v++){sum+=brightness[v];if(sum>=count*q)return v;}return 255;};
      const middle=quantile(.5),bright=quantile(.98),cut=Math.max(30,Math.min(bright-3,middle+Math.max(10,(bright-middle)*.55)));
      add(hue,11,55,cut);
      for(let h=Math.max(0,hue-12);h<=Math.min(179,hue+12);h++)smooth[h]=0;
    }
    // Unity seed: #0066FF, ±40 degrees, S=.35, V=.22. Reacquire wider
    // only after trying separate bright bands, never learn from a flat region.
    add(108,20,89,56);add(90,13,55,45);add(112,11,55,45);add(108,30,43,25);
    return passes;
  }
  detect(image, {fast=false}={}) {
    const cv=this.cv,width=image.width,height=image.height,allocated=[];
    const own=m=>{allocated.push(m);return m;};
    try{
      const src=own(cv.matFromImageData(image)),rgb=own(new cv.Mat()),hsv=own(new cv.Mat());
      cv.cvtColor(src,rgb,cv.COLOR_RGBA2RGB);cv.cvtColor(rgb,hsv,cv.COLOR_RGB2HSV);
      const mask=own(new cv.Mat(height,width,cv.CV_8UC1)),closed=own(new cv.Mat());
      const kernel=own(cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(3,3)));
      const values=hsv.data,bits=mask.data;let best=null,bestArea=width*height*.025,bestOuter=0,bestMask=null,bestPass=null;
      const passes=fast&&this.lastPass?[this.lastPass]:this.passes(hsv);
      for(const pass of passes){
        for(let p=0,i=0;p<bits.length;p++,i+=3){let difference=Math.abs(values[i]-pass.h);difference=Math.min(difference,180-difference);bits[p]=difference<=pass.r&&values[i+1]>=pass.s&&values[i+2]>=pass.v?255:0;}
        cv.morphologyEx(mask,closed,cv.MORPH_CLOSE,kernel);
        const contours=new cv.MatVector(),hierarchy=new cv.Mat();
        try{
          cv.findContours(closed,contours,hierarchy,cv.RETR_CCOMP,cv.CHAIN_APPROX_SIMPLE);
          for(let i=0;i<contours.size();i++){
            const parent=hierarchy.data32S[i*4+3];if(parent<0)continue;
            const contour=contours.get(i),outer=contours.get(parent);
            try{
              const area=cv.contourArea(contour),outerArea=cv.contourArea(outer);
              if(area<=width*height*.025||outerArea<=bestOuter||area<outerArea*.35||area>=outerArea*.995)continue;
              const box=cv.boundingRect(outer);
              if(box.x<1||box.y<1||box.x+box.width>=width||box.y+box.height>=height)continue;
              const approximation=new cv.Mat();
              try{
                for(const epsilon of [.015,.025,.04]){
                  cv.approxPolyDP(contour,approximation,cv.arcLength(contour,true)*epsilon,true);
                  if(approximation.rows!==4||!cv.isContourConvex(approximation))continue;
                  const points=[];for(let j=0;j<8;j+=2)points.push({x:approximation.data32S[j]/width,y:approximation.data32S[j+1]/height});
                  const ordered=orderCorners(points);if(!homography(ordered))continue;
                  best=ordered;bestArea=area;bestOuter=outerArea;bestMask=new Uint8Array(bits);bestPass=pass;break;
                }
              }finally{approximation.delete();}
            }finally{contour.delete();outer.delete();}
          }
        }finally{contours.delete();hierarchy.delete();}
      }
      if(best){mask.data.set(bestMask);this.learn(hsv,mask,best,width,height);this.lastPass=bestPass;this.diagnostic={found:true,hue:bestPass.h,area:bestArea/(width*height)};return best;}
      this.diagnostic={found:false};return null;
    }finally{for(const item of allocated.reverse())item.delete();}
  }
  learn(hsv, mask, corners, width, height) {
    const center = corners.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    const hue = [], sat = [], value = [];
    for (let side = 0; side < 4; side++) {
      const a = corners[side], b = corners[(side + 1) % 4];
      const dx = (b.x - a.x) * width, dy = (b.y - a.y) * height, len = Math.hypot(dx, dy);
      let nx = dy / len, ny = -dx / len;
      if (nx * (center.x - a.x) * width + ny * (center.y - a.y) * height > 0) { nx = -nx; ny = -ny; }
      let count = 0;
      for (let i = 0; i < 12; i++) {
        const t = 0.15 + i / 11 * 0.7;
        for (let depth = 1; depth <= 8; depth++) {
          const x = Math.round((a.x + (b.x - a.x) * t) * width + nx * depth);
          const y = Math.round((a.y + (b.y - a.y) * t) * height + ny * depth);
          if (x < 0 || y < 0 || x >= width || y >= height) break;
          const index = y * width + x;
          if (!mask.data[index]) continue;
          hue.push(hsv.data[index * 3]); sat.push(hsv.data[index * 3 + 1]); value.push(hsv.data[index * 3 + 2]); count++; break;
        }
      }
      if (count < 6) return;
    }
    const quantile = (array, q) => array.sort((a, b) => a - b)[Math.floor((array.length - 1) * q)];
    const sample = { h: Math.max(74, Math.min(144, quantile(hue, 0.5))), s: Math.max(20, quantile(sat, 0.2) * 0.7), v: Math.max(18, quantile(value, 0.2) * 0.65) };
    this.profile = this.profile ? Object.fromEntries(Object.keys(sample).map(k => [k, this.profile[k] * 0.7 + sample[k] * 0.3])) : sample;
  }
}
