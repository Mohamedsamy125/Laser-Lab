import {LaserSpotDetector} from './laser-spot.js?v=18';
const detector=new LaserSpotDetector();
self.onmessage=({data})=>{
  const started=performance.now();
  try{
    detector.mode=data.mode;detector.sensitivity=data.sensitivity;
    const spot=detector.detect(new Uint8ClampedArray(data.buffer),data.width,data.height,data.corners);
    self.postMessage({type:'spot',id:data.id,epoch:data.epoch,generation:data.generation,capturedAt:data.capturedAt,mode:data.mode,matrix:data.matrix,spot,ms:performance.now()-started});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
self.postMessage({type:'ready'});
