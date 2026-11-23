import {IsolationSpotDetector,ScreenSpotDetector} from './isolation-spot.js?v=3';

const normalDetector=new IsolationSpotDetector(),screenDetector=new ScreenSpotDetector();
self.onmessage=({data:job})=>{
  try{
    const start=performance.now();
    const detector=job.screenMode?screenDetector:normalDetector;
    const spot=detector.detect(new Uint8ClampedArray(job.buffer),job.width,job.height,job.sensitivity,job.epoch);
    self.postMessage({spot,id:job.id,epoch:job.epoch,capturedAt:job.capturedAt,ms:performance.now()-start});
  }catch(error){
    self.postMessage({type:'error',message:error.message});
  }
};
self.postMessage({type:'ready'});
