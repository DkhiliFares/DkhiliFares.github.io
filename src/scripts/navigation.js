export function initNavigation(){
 const menu=document.querySelector('.navigation');const mobile=matchMedia('(max-width:1000px)');
 function resize(){menu.open=!mobile.matches;}
 resize();mobile.addEventListener('change',resize);
 menu.addEventListener('click',event=>{if(event.target.closest('a')&&mobile.matches)menu.open=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&mobile.matches&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
 document.addEventListener('click',event=>{if(mobile.matches&&menu.open&&!menu.contains(event.target))menu.open=false;});
 const links=[...document.querySelectorAll('.section-rail a')];
 if(links.length&&'IntersectionObserver'in window){
   const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){for(const a of links){if(a.hash===`#${entry.target.id}`)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');}}},{rootMargin:'-15% 0px -65% 0px'});
   for(const link of links){const section=document.querySelector(link.hash);if(section)observer.observe(section);}
 }
}
