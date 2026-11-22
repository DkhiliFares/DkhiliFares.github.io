const names={projects:'Projects',skills:'Skills',experience:'Experience',education:'Education',certifications:'Certifications',achievements:'Achievements',articles:'Articles'};
const defaults={
  projects:{id:'',title:'',repositoryName:'',repository:'',category:'embedded',kind:'project',status:'unverified',statusLabel:'Status unverified',visibility:'draft',featured:false,summary:'',technologies:[],caseStudy:false,fork:false,archived:false,evidence:[],notes:[],media:[],sections:[],feature:'',diagram:{nodes:[],edges:[]},objectives:[],components:[]},
  skills:{id:'',title:'',category:'embedded',evidenceType:'developing',projects:[],experience:[],evidenceNote:'',visibility:'draft'},
  experience:{id:'',title:'',company:'',period:'',year:'',summary:'',details:[],technologies:[],source:'',visibility:'draft'},
  education:{id:'',title:'',institution:'',period:'',visibility:'draft'},
  certifications:{id:'',title:'',issuer:'',date:'',type:'',evidence:'',verificationUrl:null,visibility:'draft'},
  achievements:{id:'',title:'',organization:'',date:'',description:'',source:'',visibility:'draft'},
  articles:{id:'',title:'',summary:'',visibility:'draft',sections:[]}
};
const choices={visibility:['draft','published','archived'],status:['planned','in-progress','completed','paused','unverified'],kind:['project','exercise','reference','profile','fork'],evidenceType:['project','internship','academic','training','cv','developing','documented']};
let collection='projects',source={},originalId=null,record=null;
const token=new URLSearchParams(location.search).get('token')||sessionStorage.getItem('studio-token')||'';
if(token){sessionStorage.setItem('studio-token',token);history.replaceState(null,'',location.pathname);}
const headers={'x-studio-token':token};
async function api(path,method='GET',payload){
  const response=await fetch(path,{method,headers:{...headers,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result;
}
const el=(tag,attrs={},text='')=>{const node=document.createElement(tag);for(const [key,value] of Object.entries(attrs)){if(key==='className')node.className=value;else node.setAttribute(key,value);}node.textContent=text;return node;};
function setStatus(message,error=false){const node=document.querySelector('#save-state');node.textContent=message;node.style.color=error?'#ffc0b8':'#a8e9c9';}
function nav(){
  const container=document.querySelector('#collections');container.replaceChildren();
  for(const [key,label] of Object.entries(names)){
    const button=el('button',{type:'button',className:key===collection?'active':''},`${label} · ${(source[key]||[]).length}`);
    button.addEventListener('click',()=>{collection=key;originalId=null;record=null;document.querySelector('#search').value='';update();});container.append(button);
  }
}
function records(){
  const container=document.querySelector('#records');container.replaceChildren();
  const q=document.querySelector('#search').value.toLowerCase().trim();
  const items=(source[collection]||[]).filter(item=>`${item.title} ${item.id}`.toLowerCase().includes(q));
  if(!items.length)container.append(el('p',{},'No matching records.'));
  for(const item of items){
    const button=el('button',{type:'button',className:originalId===item.id?'active':''});
    button.append(el('strong',{},item.title),el('small',{className:item.visibility==='draft'?'draft':''},`${item.id} · ${item.visibility||'published'}`));
    button.addEventListener('click',()=>{originalId=item.id;record=structuredClone(item);update();});container.append(button);
  }
}
function field(key,value){
  const wrapper=el('div',{className:'record-field'});
  const id=`field-${key}`;
  const label=el('label',{for:id},key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()));
  let input,kind='string';
  if(key==='visibility'||choices[key]||key==='category'){
    input=el('select',{id,'data-key':key});
    const options=key==='category'?(source.categories||[]).map(c=>c.id):choices[key];
    for(const option of options){const opt=el('option',{value:option},option);input.append(opt);}input.value=value||'draft';
  }else if(typeof value==='boolean'){
    input=el('input',{id,type:'checkbox','data-key':key});input.checked=value;kind='boolean';
  }else if(Array.isArray(value)||value&&typeof value==='object'){
    kind=Array.isArray(value)&&value.every(x=>typeof x==='string')?'lines':'json';
    input=el('textarea',{id,'data-key':key,'data-kind':kind,rows:kind==='json'?8:4});
    input.value=kind==='lines'?value.join('\n'):JSON.stringify(value,null,2);
    wrapper.append(label,input,el('p',{className:'hint'},kind==='lines'?'One item per line.':'Edit this structured JSON carefully.'));
    return wrapper;
  }else if(['summary','feature','evidenceNote','description','source','about','intro'].includes(key)||String(value??'').length>120){
    input=el('textarea',{id,'data-key':key,rows:4});input.value=value??'';
  }else{
    input=el('input',{id,'data-key':key,type:'text'});input.value=value??'';
  }
  input.dataset.kind=kind;
  wrapper.append(label,input);return wrapper;
}
function editor(){
  const form=document.querySelector('#record-form');const fields=document.querySelector('#fields');fields.replaceChildren();
  if(!record){form.hidden=true;document.querySelector('#record-title').textContent='Select a record.';return;}
  form.hidden=false;document.querySelector('#record-title').textContent=originalId?record.title||record.id:'New '+names[collection].slice(0,-1).toLowerCase();
  const keys=[...Object.keys(record)];if(!keys.includes('visibility'))keys.push('visibility');
  for(const key of keys)fields.append(field(key,key==='visibility'?(record.visibility||'published'):record[key]));
  setStatus('');
}
function update(){document.querySelector('#collection-title').textContent=names[collection];nav();records();editor();}
document.querySelector('#search').addEventListener('input',records);
document.querySelector('#new').addEventListener('click',()=>{originalId=null;record=structuredClone(defaults[collection]);update();document.querySelector('#field-id')?.focus();});
document.querySelector('#record-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;const next={...record};
  try{
    for(const input of form.querySelectorAll('[data-key]')){
      const key=input.dataset.key,kind=input.dataset.kind;
      if(kind==='boolean')next[key]=input.checked;
      else if(kind==='lines')next[key]=input.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      else if(kind==='json')next[key]=JSON.parse(input.value);
      else next[key]=input.value.trim()||((record[key]===null)?null:'');
    }
    setStatus('Saving…');await api('/api/save','POST',{collection,originalId,record:next});
    source=await api('/api/data');originalId=next.id;record=structuredClone(next);update();setStatus('Saved locally. Build the public preview to inspect it.');
  }catch(error){setStatus(error.message,true);}
});
document.querySelector('#build').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;setStatus('Building public preview…');
  try{const result=await api('/api/build','POST',{});setStatus(`Built ${result.pages} public pages. Open the preview to inspect.`);}catch(error){setStatus(error.message,true);}finally{button.disabled=false;}
});
try{source=await api('/api/data');update();}catch(error){document.querySelector('#record-title').textContent='Studio access failed';document.querySelector('.editor-help').textContent=error.message+' Launch Studio with npm run studio and use its private URL.';}
