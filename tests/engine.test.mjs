import test from 'node:test';
import assert from 'node:assert/strict';
import { startField } from '../src/scripts/magnetic-engine.js';
function fixture({reduced=false,coarse=false,context=true}={}){
 const eventTarget=()=>{const events={};return{addEventListener(type,fn){(events[type]??=[]).push(fn);},removeEventListener(){},emit(type,event={}){for(const fn of events[type]||[])fn(event);}};};
 const reduce=Object.assign(eventTarget(),{matches:reduced}),touch=Object.assign(eventTarget(),{matches:coarse});
 const button=Object.assign(eventTarget(),{setAttribute(){},hidden:false}),svg={style:{}};
 const host=Object.assign(eventTarget(),{querySelector:s=>s==='.motion-toggle'?button:svg});const ctx={clearRect(){},setTransform(){},beginPath(){},arc(){},fill(){}};
 const canvas={parentElement:host,getContext:()=>context?ctx:null,getBoundingClientRect:()=>({width:600,height:500,left:0,top:0})};
 const doc=Object.assign(eventTarget(),{hidden:false});let next=1;const pending=new Map();
 const win={matchMedia:q=>q.includes('reduced')?reduce:touch,devicePixelRatio:3};
 const engine=startField(canvas,{win,doc,observe:false,raf:fn=>{const id=next++;pending.set(id,fn);return id;},cancel:id=>pending.delete(id)});
 return{engine,reduce,touch,doc,button,host,canvas,pending};
}
test('animation honors hidden document, reduced motion, resize and manual pause',()=>{
 const f=fixture();assert(f.engine.running);assert(f.engine.particleCount<=48);assert.equal(f.canvas.width,900);
 f.doc.hidden=true;f.doc.emit('visibilitychange');assert.equal(f.pending.size,0);assert(!f.engine.running);
 f.doc.hidden=false;f.doc.emit('visibilitychange');assert.equal(f.pending.size,1);
 f.reduce.matches=true;f.reduce.emit('change');assert.equal(f.pending.size,0);const draws=f.engine.draws;f.engine.resize();assert(f.engine.draws>draws);
 f.reduce.matches=false;f.reduce.emit('change');assert.equal(f.pending.size,1);f.button.emit('click');assert.equal(f.pending.size,0);f.button.emit('click');assert.equal(f.pending.size,1);f.engine.destroy();assert.equal(f.pending.size,0);
});
test('touch devices have fewer particles and no pointer influence; Canvas failure is harmless',()=>{
 const touch=fixture({coarse:true});touch.host.emit('pointermove',{clientX:80,clientY:80});assert(!touch.engine.pointerActive);assert.equal(touch.engine.particleCount,18);touch.engine.destroy();
 const reduced=fixture({reduced:true});assert(!reduced.engine.running);assert.equal(reduced.pending.size,0);assert.equal(fixture({context:false}).engine,null);
});
