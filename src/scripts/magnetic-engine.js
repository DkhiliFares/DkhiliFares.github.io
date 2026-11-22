export function startField(canvas, { win=window, doc=document, raf=fn=>win.requestAnimationFrame(fn), cancel=id=>win.cancelAnimationFrame(id), observe=true }={}) {
 let ctx;try{ctx=canvas.getContext('2d');}catch{return null;}if(!ctx)return null;
 const host=canvas.parentElement,button=host.querySelector('.motion-toggle'),svg=host.querySelector('.flux-lines');
 const reduced=win.matchMedia('(prefers-reduced-motion:reduce)'),coarse=win.matchMedia('(hover:none), (pointer:coarse)');
 let width=1,height=1,particles=[],frame=0,visible=true,paused=false,last=0,phase=0,pointer=null,draws=0;
 const canAnimate=()=>!reduced.matches&&!doc.hidden&&visible&&!paused;
 function updateButton(){if(!button)return;button.hidden=reduced.matches;button.setAttribute('aria-pressed',String(paused));button.textContent=paused?'Resume field motion':'Pause field motion';}
 function particlePosition(p){const angle=p.angle+phase*p.speed;return{x:width*(.5+Math.cos(angle)*p.radius),y:height*(.49+Math.sin(angle)*p.radius*.76)};}
 function render(){
   ctx.clearRect(0,0,width,height);draws++;
   for(const p of particles){let {x,y}=particlePosition(p);if(pointer&&!coarse.matches&&!reduced.matches){const dx=pointer.x-x,dy=pointer.y-y,d=Math.hypot(dx,dy);if(d<110&&d>0){const n=(1-d/110)*10;x+=dx/d*n;y+=dy/d*n;}}
     ctx.beginPath();ctx.arc(x,y,p.size,0,Math.PI*2);ctx.fillStyle=p.color;ctx.fill();
   }
   if(svg){const dx=pointer&&!coarse.matches?(pointer.x-width/2)/width*4:0;const dy=pointer&&!coarse.matches?(pointer.y-height/2)/height*3:0;svg.style.transform=`translate(${Math.sin(phase*.3)*2+dx}px,${Math.cos(phase*.2)*2+dy}px)`;}
 }
 function stop(){if(frame)cancel(frame);frame=0;last=0;}
 function tick(time){frame=0;if(!canAnimate())return;if(!last||time-last>=32){const dt=last?Math.min(time-last,65):32;last=time;phase+=dt*.00014;render();}frame=raf(tick);}
 function sync(){stop();updateButton();if(!canAnimate()){pointer=null;if(svg)svg.style.transform='none';render();return;}frame=raf(tick);}
 function resize(){const box=canvas.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);const dpr=Math.min(win.devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);const count=coarse.matches?18:Math.min(48,Math.max(24,Math.round(width/14)));particles=Array.from({length:count},(_,i)=>({angle:i*2.399963,radius:.12+(i%13)*.026,speed:.13+(i%5)*.023,size:i%7===0?1.8:1,color:i%6===0?'#a696ff':'#40bceb'}));render();}
 const onMove=event=>{if(coarse.matches||reduced.matches||paused)return;const box=canvas.getBoundingClientRect();pointer={x:event.clientX-box.left,y:event.clientY-box.top};};
 const onLeave=()=>{pointer=null;};const onPause=()=>{paused=!paused;sync();};const onCoarse=()=>{pointer=null;resize();sync();};
 host.addEventListener('pointermove',onMove,{passive:true});host.addEventListener('pointerleave',onLeave);button?.addEventListener('click',onPause);
 doc.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);coarse.addEventListener('change',onCoarse);
 let resizeObserver,intersection;
 if(observe&&win.ResizeObserver){resizeObserver=new win.ResizeObserver(()=>{resize();sync();});resizeObserver.observe(host);}
 if(observe&&win.IntersectionObserver){intersection=new win.IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();});intersection.observe(host);}
 resize();sync();
 return {get running(){return !!frame;},get particleCount(){return particles.length;},get draws(){return draws;},get pointerActive(){return pointer!==null;},resize,destroy(){stop();resizeObserver?.disconnect();intersection?.disconnect();doc.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);coarse.removeEventListener('change',onCoarse);host.removeEventListener('pointermove',onMove);host.removeEventListener('pointerleave',onLeave);button?.removeEventListener('click',onPause);}};
}
