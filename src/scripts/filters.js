export function matchesProject(item, filters) {
  const terms=(filters.q||'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (!filters.category||item.category===filters.category)&&(!filters.kind||item.kind===filters.kind)&&terms.every(term=>item.search.includes(term));
}
export function initArchive() {
 const form=document.querySelector('.archive-controls'); if(!form)return;
 const rows=[...document.querySelectorAll('[data-archive-item]')];
 const count=document.querySelector('.result-count'),empty=document.querySelector('.empty-results');
 const params=new URLSearchParams(location.search);
 for(const key of ['q','category','kind']) {const control=form.elements.namedItem(key);if(params.has(key))control.value=params.get(key);}
 function filter(sync=true){
   const values=Object.fromEntries(new FormData(form));let visible=0;
   for(const row of rows){row.hidden=!matchesProject(row.dataset,values);if(!row.hidden)visible++;}
   count.textContent=`${visible} ${visible===1?'repository':'repositories'}${visible!==rows.length?` of ${rows.length}`:''}`;empty.hidden=visible!==0;
   if(sync){const url=new URL(location.href);url.search='';for(const [key,value] of Object.entries(values))if(value.trim())url.searchParams.set(key,value.trim());history.replaceState(null,'',url);}
 }
 form.addEventListener('input',()=>filter());form.addEventListener('change',()=>filter());
 form.addEventListener('submit',event=>{event.preventDefault();filter();});
 form.addEventListener('reset',()=>{queueMicrotask(()=>filter());});
 window.addEventListener('popstate',()=>{const values=new URLSearchParams(location.search);for(const key of ['q','category','kind'])form.elements.namedItem(key).value=values.get(key)||'';filter(false);});
 filter(false);
}
