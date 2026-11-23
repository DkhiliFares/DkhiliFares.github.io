export function initNavigation(){
 const menu=document.querySelector('.navigation');const mobile=matchMedia('(max-width:1000px)');
 function resize(){menu.open=!mobile.matches;}
 resize();mobile.addEventListener('change',resize);
 menu.addEventListener('click',event=>{if(event.target.closest('a')&&mobile.matches)menu.open=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&mobile.matches&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
 document.addEventListener('click',event=>{if(mobile.matches&&menu.open&&!menu.contains(event.target))menu.open=false;});
 const links=[...document.querySelectorAll('.section-rail a')];
 if(links.length){
   const header=document.querySelector('.site-header');
   const sections=links.map(link=>document.querySelector(link.hash)).filter(Boolean);
   if(!sections.length)return;
   let scheduled=false;
   const updateActive=()=>{
     if(scheduled)return;
     scheduled=true;
     requestAnimationFrame(()=>{
       scheduled=false;
       const line=header.getBoundingClientRect().bottom+1;
       const active=sections.find(section=>{const rect=section.getBoundingClientRect();return rect.top<=line&&rect.bottom>line;})
         ||sections.filter(section=>section.getBoundingClientRect().top<line).pop()
         ||sections[0];
       for(const link of links){if(link.hash===`#${active.id}`)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
     });
   };
   window.addEventListener('scroll',updateActive,{passive:true});
   window.addEventListener('resize',updateActive,{passive:true});
   window.addEventListener('hashchange',updateActive);
   window.addEventListener('popstate',()=>{
     requestAnimationFrame(()=>{
       const target=sections.find(section=>`#${section.id}`===location.hash);
       if(target)target.scrollIntoView({behavior:'instant',block:'start'});
       updateActive();
     });
   });
   updateActive();
 }
}
