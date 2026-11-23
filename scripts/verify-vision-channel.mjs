import assert from 'node:assert/strict';
import {VisionChannel} from '../dist/vision-channel.js';
class FakeWorker {
  constructor(){this.messages=[];}
  postMessage(data,transfers){this.messages.push(structuredClone(data,{transfer:transfers}));}
  terminate(){this.terminated=true;}
  emit(data){this.onmessage({data});}
}
globalThis.Worker=FakeWorker;
let results=[],errors=[];
const channel=new VisionChannel('test',{onresult:r=>results.push(r),onerror:e=>errors.push(e)});
channel.worker.emit({type:'ready'});await channel.ready;
const buffer=new ArrayBuffer(32);
assert(channel.send({epoch:4,buffer},[buffer]));assert.equal(buffer.byteLength,0,'input pixels must transfer rather than clone');
assert.equal(channel.send({epoch:4}),false,'busy worker must reject another frame, not queue it');assert.equal(channel.worker.messages.length,1);
channel.worker.emit({type:'spot',id:99});assert(channel.busy,'unrelated replies must not unlock the in-flight job');
channel.worker.emit({type:'spot',id:1});assert.equal(results.length,1);assert.equal(channel.busy,false);
assert(channel.send({epoch:5}));assert.equal(channel.worker.messages.length,2);channel.close();assert(channel.worker.terminated);
const timeout=new VisionChannel('timeout',{timeout:5,onerror:e=>errors.push(e)});timeout.worker.emit({type:'ready'});await timeout.ready;timeout.send({});await new Promise(resolve=>setTimeout(resolve,15));assert(timeout.closed);assert(timeout.worker.terminated);assert.match(errors.at(-1).message,/timeout/);
const startup=new VisionChannel('startup',{onerror:()=>{}});const rejected=assert.rejects(startup.ready,/broken/);startup.worker.emit({type:'error',message:'broken'});await rejected;
console.log('PASS: transferable camera pixels; one in-flight job with no backlog; reply correlation; worker failure and timeout cleanup.');
