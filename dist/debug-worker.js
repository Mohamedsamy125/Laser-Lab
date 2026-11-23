import {LaserSpotDetector} from './laser-spot.js?v=18';
const detector=new LaserSpotDetector();
self.onmessage=({data:d})=>{
  const start=performance.now();
  try{
    const pixels=new Uint8ClampedArray(d.buffer);
    detector.mode=d.mode;
    detector.sensitivity=d.sensitivity;
    const spot=detector.detect(pixels,d.width,d.height,d.corners,d);
    self.postMessage({type:'spot',id:d.id,epoch:d.epoch,capturedAt:d.capturedAt,spot,ms:performance.now()-start});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};self.postMessage({type:'ready'});
