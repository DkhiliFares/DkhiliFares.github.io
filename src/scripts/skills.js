export function initSkills(){
 const panels=[...document.querySelectorAll('[data-skill-panel]')];if(!panels.length)return;
 const categories=[...document.querySelectorAll('[data-skill-category]')];
 const reduced=matchMedia('(prefers-reduced-motion:reduce)');
 function select(id,scroll=false){
   if(!panels.some(p=>p.dataset.skillPanel===id))return;
   for(const panel of panels)panel.hidden=panel.dataset.skillPanel!==id;
   for(const link of categories){if(link.dataset.skillCategory===id)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current');}
   for(const path of document.querySelectorAll('[data-connection]'))path.classList.toggle('active',path.dataset.connection===id);
   for(const project of document.querySelectorAll('[data-project]'))project.classList.toggle('is-related',project.dataset.category===id);
   if(scroll)document.querySelector('#skills').scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'});
 }
 function fromHash(){const id=location.hash.replace('#skills-','');if(location.hash.startsWith('#skills-'))select(id);}
 select(panels[0].dataset.skillPanel);fromHash();
 for(const link of [...categories,...document.querySelectorAll('[data-domain-link]')])link.addEventListener('click',event=>{event.preventDefault();const id=link.dataset.skillCategory||link.dataset.domainLink;select(id,!!link.dataset.domainLink);history.pushState(null,'',`#skills-${id}`);});
 window.addEventListener('hashchange',fromHash);window.addEventListener('popstate',fromHash);
 for(const detail of document.querySelectorAll('.skill-detail'))detail.addEventListener('toggle',()=>{
   if(!detail.open)return;
   const related=[...detail.querySelectorAll('[data-evidence-project]')].map(a=>a.dataset.evidenceProject);
   for(const project of document.querySelectorAll('[data-project]'))project.classList.toggle('is-related',related.includes(project.dataset.project));
   const experience=[...detail.querySelectorAll('[data-evidence-experience]')].map(a=>a.dataset.evidenceExperience);
   for(const entry of document.querySelectorAll('.journey-entry'))entry.classList.toggle('is-related',experience.includes(entry.id));
 });
}
