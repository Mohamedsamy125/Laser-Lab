// Classic worker: the vendored OpenCV build supports importScripts directly.
const workerBase = self.__laserWorkerBase || new URL('./', self.location.href).href;
(async()=>{
  try{
    const {FrameDetector}=await import(new URL('./tracking.js',workerBase).href);
    importScripts(new URL('../vendor/opencv.js',workerBase).href);let cv=self.cv;
    if(!cv.Mat)await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('OpenCV startup timeout')),25000);
      const ready=m=>{if(m)cv=m;clearTimeout(timer);resolve();};
      if(typeof cv.then==='function')cv.then(ready);else cv.onRuntimeInitialized=()=>ready();
    });
    const detector=new FrameDetector(cv);let revision=-1,hex=null;
    self.onmessage=({data})=>{
      const started=performance.now();
      try{
        if(revision!==data.generation||hex!==(data.seed?.hex||null)){
          detector.resetColor();detector.seed=data.seed;revision=data.generation;hex=data.seed?.hex||null;
        }
        const found=detector.detect({data:new Uint8ClampedArray(data.buffer),width:data.width,height:data.height},{fast:data.fast});
        self.postMessage({type:'frame',id:data.id,epoch:data.epoch,generation:data.generation,capturedAt:data.capturedAt,full:!data.fast,found,ms:performance.now()-started});
      }catch(error){self.postMessage({type:'error',message:error.message});}
    };
    self.postMessage({type:'ready'});
  }catch(error){self.postMessage({type:'error',message:error.message});}
})();
