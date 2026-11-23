const RADII=[2,4,7,11,15];

function surroundingContrast(levels,index,width,radius,peak,minContrast){
  const row=width*radius,diagonal=Math.max(1,Math.round(radius*.707));
  const diagonalRow=width*diagonal;
  const left=levels[index-radius],right=levels[index+radius];
  const top=levels[index-row],bottom=levels[index+row];
  const axisPeak=Math.max(left,right,top,bottom);
  if(peak-axisPeak<minContrast)return 0;
  const topLeft=levels[index-diagonalRow-diagonal],topRight=levels[index-diagonalRow+diagonal];
  const bottomLeft=levels[index+diagonalRow-diagonal],bottomRight=levels[index+diagonalRow+diagonal];
  const brightest=Math.max(axisPeak,topLeft,topRight,bottomLeft,bottomRight);
  const weakestDrop=peak-brightest;
  if(weakestDrop<minContrast)return 0;
  const average=(left+right+top+bottom+topLeft+topRight+bottomLeft+bottomRight)/8;
  return (peak-average)*.42+weakestDrop*.35-radius*2;
}

export class IsolationSpotDetector {
  detect(data,width,height,sensitivity=.5){
    const size=width*height;
    if(width<5||height<5||data.length!==size*4)return null;
    if(this.levels?.length!==size)this.levels=new Uint8Array(size);
    const levels=this.levels;
    // Boost strongly colored spots while preserving sensitivity to a clipped white core.
    for(let p=0,i=0;p<size;p++,i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      levels[p]=(4*Math.max(r,g,b)+Math.min(r,g,b))/5;
    }
    const minPeak=190-105*sensitivity,minContrast=58-41*sensitivity;
    let bestX=0,bestY=0,bestScore=0,bestRadius=0;
    for(let y=2;y<height-2;y++){
      for(let x=2,i=y*width+2;x<width-2;x++,i++){
        const peak=levels[i];
        if(peak<minPeak||peak*1.77<=bestScore)continue;
        if(peak<levels[i-1]||peak<levels[i+1]||peak<levels[i-width]||peak<levels[i+width])continue;
        // Large bright areas and long edges lack contrast on at least one side.
        const clearance=Math.min(x,y,width-x-1,height-y-1);
        for(const radius of RADII){
          if(radius>clearance)break;
          const contrast=surroundingContrast(levels,i,width,radius,peak,minContrast);
          if(contrast<=0)continue;
          const score=peak+contrast;
          if(score>bestScore){bestScore=score;bestX=x;bestY=y;bestRadius=radius;}
          break;
        }
      }
    }
    if(!bestRadius)return null;
    const window=Math.min(bestRadius-1,4);
    const threshold=levels[bestY*width+bestX]-20;
    let xSum=0,ySum=0,weightSum=0;
    for(let y=bestY-window;y<=bestY+window;y++){
      for(let x=bestX-window;x<=bestX+window;x++){
        const weight=Math.max(0,levels[y*width+x]-threshold);
        xSum+=(x+.5)*weight;ySum+=(y+.5)*weight;weightSum+=weight;
      }
    }
    return {x:xSum/weightSum/width,y:ySum/weightSum/height};
  }
}

const SCREEN_RINGS=[[3,5],[5,9],[8,13],[11,17]];
function ringPeak(levels,index,width,radius){
  const row=width*radius,d=Math.max(1,Math.round(radius*.707)),diagonal=width*d;
  return Math.max(levels[index-radius],levels[index+radius],levels[index-row],levels[index+row],
    levels[index-diagonal-d],levels[index-diagonal+d],levels[index+diagonal-d],levels[index+diagonal+d]);
}

// Subtract the light around each candidate and give new compact changes
// priority over existing reflections. Spatial contrast keeps a held spot valid.
export class ScreenSpotDetector {
  detect(data,width,height,sensitivity=.5,epoch=0){
    const size=width*height;
    if(width<11||height<11||data.length!==size*4)return null;
    if(this.width!==width||this.height!==height||this.epoch!==epoch){
      this.width=width;this.height=height;this.epoch=epoch;
      this.current=new Uint8Array(size);this.previous=new Uint8Array(size);
      this.hasPrevious=false;this.lastSpot=null;
    }
    const {current,previous,hasPrevious,lastSpot}=this;
    for(let i=0,p=0;p<size;p++,i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      current[p]=(4*Math.max(r,g,b)+Math.min(r,g,b))/5;
    }

    const minPeak=170-80*sensitivity,minDrop=15-12*sensitivity;
    let best=null,bestScore=-Infinity;
    for(let y=5;y<height-5;y++){
      for(let x=5,i=y*width+5;x<width-5;x++,i++){
        const peak=current[i];
        if(peak<minPeak)continue;
        if(peak<current[i-1]||peak<current[i+1]||peak<current[i-width]||peak<current[i+width])continue;
        const clearance=Math.min(x,y,width-x-1,height-y-1);
        for(const [near,far] of SCREEN_RINGS){
          if(far>clearance)break;
          const drop=peak-ringPeak(current,i,width,near);
          if(drop<minDrop)continue;
          const broadDrop=peak-ringPeak(current,i,width,far);
          if(drop+.5<broadDrop*.61)continue;
          const oldDrop=hasPrevious?Math.max(0,previous[i]-ringPeak(previous,i,width,near)):drop;
          const change=drop-oldDrop;
          const appeared=change>=6?42+Math.min(change,28):0;
          const nearby=lastSpot&&Math.abs(lastSpot.x*width-x)<7&&Math.abs(lastSpot.y*height-y)<7?30:0;
          const score=peak*.1+Math.min(drop,36)+appeared+nearby-near*.65;
          if(score>bestScore){bestScore=score;best={x,y,near,drop};}
          break;
        }
      }
    }

    let spot=null;
    if(best){
      const radius=Math.min(4,best.near),threshold=current[best.y*width+best.x]-Math.min(18,best.drop*.58);
      let weightSum=0,xSum=0,ySum=0;
      for(let y=best.y-radius;y<=best.y+radius;y++){
        for(let x=best.x-radius;x<=best.x+radius;x++){
          const weight=Math.max(0,current[y*width+x]-threshold);
          weightSum+=weight;xSum+=(x+.5)*weight;ySum+=(y+.5)*weight;
        }
      }
      spot={x:xSum/weightSum/width,y:ySum/weightSum/height};
    }
    this.previous=current;this.current=previous;this.hasPrevious=true;this.lastSpot=spot;
    return spot;
  }
}
