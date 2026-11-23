import {homography,projectPoint,orderCorners} from './tracking.js?v=7';
export class DebugState {
  constructor(){this.reset();}
  reset(){this.corners=null;this.matrix=null;this.candidate=null;this.stable=0;this.lastFrame=0;this.checks=0;this.updates=0;this.spot=null;this.uv=null;this.shots=0;this.latched=false;this.blanks=0;this.lastSpot=0;this.history=[];this.manual=false;}
  frame(found,now){
    this.checks++;
    if(!found){this.candidate=null;this.stable=0;return false;}
    const near=(a,b,n)=>a&&b&&a.every((p,i)=>Math.hypot(p.x-b[i].x,p.y-b[i].y)<n);
    this.stable=near(found,this.candidate,.025)?this.stable+1:1;this.candidate=found;
    const smooth=near(found,this.corners,.04);if(!smooth&&this.stable<3)return false;
    const points=smooth?found.map((p,i)=>({x:p.x*.65+this.corners[i].x*.35,y:p.y*.65+this.corners[i].y*.35})):found;
    const matrix=homography(points);if(!matrix)return false;this.corners=points;this.matrix=matrix;this.lastFrame=now;this.manual=false;this.updates++;return true;
  }
  manualFrame(points,now){const corners=orderCorners(points),matrix=homography(corners);if(!matrix)return false;this.corners=corners;this.matrix=matrix;this.lastFrame=now;this.manual=true;return true;}
  fresh(now){return !!this.matrix&&(this.manual||now-this.lastFrame<1500);}
  point(spot,now){
    this.spot=spot;this.uv=null;
    if(spot){
      this.blanks=0;this.lastSpot=now;
      if(this.fresh(now)){const uv=projectPoint(this.matrix,spot);if(uv&&uv.x>=0&&uv.x<=1&&uv.y>=0&&uv.y<=1)this.uv=uv;}
      if(!this.latched){this.shots++;this.latched=true;this.history.push({x:spot.x,y:spot.y,uv:this.uv,time:now});this.history=this.history.slice(-20);}
    }else if(++this.blanks>=2&&now-this.lastSpot>=60)this.latched=false;
  }
}
