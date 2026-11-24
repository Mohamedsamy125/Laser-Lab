export function isGreenCameraFrame(data){
  // A near-uniform green placeholder is different from a scene containing green objects.
  if(data.length<4||data[0]>8||data[2]>8||data[1]<64||data[1]>240)return false;
  const count=Math.min(64,data.length/4);
  for(let n=0;n<count;n++){
    const i=Math.floor(n*(data.length/4-1)/Math.max(1,count-1))*4;
    if(Math.abs(data[i]-data[0])>2||Math.abs(data[i+1]-data[1])>2||Math.abs(data[i+2]-data[2])>2)return false;
  }
  return true;
}
export class DebugCameraSource {
  constructor(video){this.video=video;this.epoch=0;this.stream=null;this.opening=false;this.lastTime=-1;this.lastVideoAt=0;this.mode='video';this.preferTrack=false;}
  stop(){this.epoch++;this.opening=false;this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;this.capture=null;this.video.srcObject=null;this.lastTime=-1;this.lastVideoAt=0;this.retryAt=0;this.mode='video';}
  async start(deviceId='',profile='hd'){
    this.stop();const epoch=this.epoch;this.opening=true;
    if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia){this.opening=false;throw new Error('افتح الرابط مباشرة باستخدام HTTPS في متصفح الموبايل.');}
    try{
      const video=profile==='native'?{}:profile==='compatible'?{width:{ideal:640},height:{ideal:480}}:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}};
      if(deviceId)video.deviceId={exact:deviceId};else video.facingMode={ideal:'environment'};
      let stream;try{stream=await navigator.mediaDevices.getUserMedia({video,audio:false});}catch(e){
        if(e.name!=='OverconstrainedError')throw e;
        // Relax image settings while preserving the camera the player selected.
        stream=await navigator.mediaDevices.getUserMedia({video:deviceId?{deviceId:{exact:deviceId}}:true,audio:false});
      }
      if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return false;}
      this.stream=stream;this.video.srcObject=stream;this.video.muted=true;this.video.playsInline=true;await this.video.play();
      if(epoch!==this.epoch)return false;
      await new Promise((resolve,reject)=>{const started=performance.now();const poll=setInterval(()=>{if(epoch!==this.epoch){clearInterval(poll);resolve();}else if(this.video.readyState>=2&&this.video.videoWidth){clearInterval(poll);resolve();}else if(performance.now()-started>8000){clearInterval(poll);reject(new Error('الكاميرا اتفتحت لكن الفيديو ما بدأش. جرّب تشغيلها تاني.'));}},60);});
      if(epoch!==this.epoch)return false;
      if(typeof ImageCapture==='function'){try{this.capture=new ImageCapture(stream.getVideoTracks()[0]);}catch{}}
      stream.getVideoTracks()[0].onended=()=>{this.stop();this.onended?.();};return true;
    }catch(error){if(epoch!==this.epoch)return false;this.stop();throw error;}finally{if(epoch===this.epoch)this.opening=false;}
  }
  async read(now){
    if(!this.stream)return null;
    const epoch=this.epoch;
    if(this.preferTrack&&this.capture&&now>=(this.retryAt||0)){
      const frame=await this.readTrack(now);if(frame||epoch!==this.epoch)return frame;
    }
    const v=this.video;
    if(v.readyState>=2&&v.videoWidth&&v.currentTime!==this.lastTime){this.lastTime=v.currentTime;this.lastVideoAt=now;this.mode='video';return {source:v,width:v.videoWidth,height:v.videoHeight,close(){}};}
    if(this.lastVideoAt&&now-this.lastVideoAt<400||!this.capture||now<(this.retryAt||0))return null;
    if(this.preferTrack)return null;
    return this.readTrack(now);
  }
  async readTrack(now){
    const capture=this.capture,epoch=this.epoch;
    let timer,expired=false;
    try{
      const bitmap=await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{expired=true;reject(new Error('Camera bitmap timeout'));},450);
        capture.grabFrame().then(bitmap=>{if(expired)bitmap.close?.();else resolve(bitmap);},reject);
      });
      if(epoch!==this.epoch){bitmap.close?.();return null;}
      this.mode='track';return {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close?.()};
    }catch{if(epoch===this.epoch)this.retryAt=now+750;return null;}finally{clearTimeout(timer);}
  }
}
