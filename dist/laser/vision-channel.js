// One job per worker, never a queue of old camera images.
export class VisionChannel {
  constructor(url,{type='module',timeout=1500,onresult=()=>{},onerror=()=>{}}={}) {
    this.worker=new Worker(url,{type});this.busy=false;this.closed=false;this.serial=0;this.onresult=onresult;this.onerror=onerror;this.timeout=timeout;
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    this.readyTimer=setTimeout(()=>this.fail(new Error('Vision worker startup timeout')),30000);
    this.worker.onmessage=({data})=>{
      if(this.closed)return;
      if(data.type==='ready'){clearTimeout(this.readyTimer);this.active=true;this.resolveReady();return;}
      if(data.type==='error'){this.fail(new Error(data.message));return;}
      if(data.id!==this.pendingId)return;
      clearTimeout(this.jobTimer);this.busy=false;this.onresult(data);
    };
    this.worker.onerror=event=>this.fail(new Error(event.message||'Vision worker failed'));
  }
  send(payload,transfers=[]){
    if(this.closed||!this.active||this.busy)return false;
    const id=++this.serial;this.pendingId=id;this.busy=true;
    try{this.worker.postMessage({...payload,id},transfers);this.jobTimer=setTimeout(()=>this.fail(new Error('Vision worker analysis timeout')),this.timeout);return true;}
    catch(error){this.fail(error);return false;}
  }
  fail(error){if(this.closed)return;this.close();this.rejectReady(error);this.onerror(error);}
  close(){this.closed=true;this.busy=false;this.active=false;clearTimeout(this.readyTimer);clearTimeout(this.jobTimer);this.worker.terminate();}
}
