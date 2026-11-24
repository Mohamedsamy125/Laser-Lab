import {CoreHaloDetector} from './core-halo.js';
import {SpotDetector} from './tracking.js';
import {ColorSpotDetector,insideQuad} from './debug-spot.js';

function findRedPixel(data,width,height,corners,sensitivity){
  if(width*height*4!==data.length||width<1||height<1)return null;
  const minRed=115-70*sensitivity,minDifference=26-22*sensitivity;
  let bestScore=0,bestX=0,bestY=0;
  for(let y=0,index=0;y<height;y++){
    for(let x=0;x<width;x++,index+=4){
      const red=data[index];
      if(red<minRed)continue;
      const difference=red-Math.max(data[index+1],data[index+2]);
      const score=red+2*difference;
      if(difference<minDifference||score<=bestScore)continue;
      if(corners&&!insideQuad((x+.5)/width,(y+.5)/height,corners))continue;
      bestScore=score;bestX=x;bestY=y;
    }
  }
  return bestScore?{x:(bestX+.5)/width,y:(bestY+.5)/height,score:bestScore,color:'red'}:null;
}

export class LaserSpotDetector {
  constructor(){
    this.coreHalo=new CoreHaloDetector();
    this.halo=new SpotDetector();
    this.color=new ColorSpotDetector();
    this.mode='auto';
    this.sensitivity=.5;
  }

  detect(data,width,height,corners=null,{algorithm='hybrid',seed=null}={}){
    if(this.mode==='fast-red')return findRedPixel(data,width,height,corners,this.sensitivity);
    const options={mode:this.mode==='red-halo'?'red':this.mode,sensitivity:this.sensitivity,corners,seed};
    if(algorithm==='color')return this.color.detect(data,width,height,options);
    if(this.mode==='red-halo')return this.coreHalo.detect(data,width,height,corners,this.sensitivity);

    this.halo.mode=this.mode;
    this.halo.sensitivity=this.sensitivity;
    const spot=this.halo.detect(data,width,height,corners);
    if(spot||algorithm==='halo')return spot;
    return this.color.detect(data,width,height,{...options,fallback:true});
  }
}
