import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadContent,validateContent,root } from '../scripts/validate-content.mjs';
import { build } from '../scripts/build.mjs';
import { matchesProject } from '../src/scripts/filters.js';
const original=await loadContent();
test('content is valid, source-backed and covers all 26 audited repositories',async()=>{
 await validateContent(original);const audit=JSON.parse(await readFile(path.join(root,'docs/repository-inventory.json'),'utf8'));
 assert.equal(audit.actualPublicCount,26);for(const repo of audit.repositories){assert(original.projects.find(p=>p.repository===repo.url));assert(repo.audit.treeRead);assert(repo.audit.readmeRead||repo.audit.readmeAbsent);}
 assert.equal(original.experience.length,3);assert.equal(original.education[0].major,'Computer Engineering');
});
test('public content excludes private contact fields and editorial evidence',()=>{
 assert.equal(Object.hasOwn(original.profile,'email'),false);
 for(const certification of original.certifications){
  assert.equal(Object.hasOwn(certification,'evidence'),false);
 }
});
test('validation rejects unsafe publication and broken references',async()=>{
 const mutations=[d=>d.projects.push(structuredClone(d.projects[0])),d=>d.projects[0].status='finished',d=>d.projects[0].repository='javascript:alert(1)',d=>d.projects[0].category='missing',d=>d.projects[0].summary='',d=>d.skills[0].projects.push('cutiepi'),d=>d.projects[0].media.push({src:'missing.png',alt:'image',caption:'caption',source:'https://example.com'}),d=>{const p=d.projects.find(p=>p.id==='network-administration-project');p.status='completed';p.completionEvidence='Assumed from README';}];
 for(const mutate of mutations){const data=structuredClone(original);mutate(data);await assert.rejects(()=>validateContent(data));}
});
test('archive search matches all query terms and combines filters',()=>{
 const p={search:'stm32 driver c sim808 uart',category:'embedded',kind:'project'};
 assert(matchesProject(p,{q:'STM32 UART',category:'embedded'}));assert(!matchesProject(p,{q:'STM32 Java'}));assert(!matchesProject(p,{kind:'exercise'}));assert(matchesProject(p,{q:'  '}));
});
async function htmlFiles(dir){const found=[];for(const item of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())found.push(...await htmlFiles(p));else if(p.endsWith('.html'))found.push(p);}return found;}
test('build excludes draft/private material and resolves local links, anchors and assets under a project subpath',async()=>{
 const oldBase=process.env.BASE_PATH,oldSite=process.env.SITE_URL;process.env.BASE_PATH='/engineering-portfolio/';process.env.SITE_URL='https://example.github.io';
 try{
  const {outDir,routes}=await build({outDir:path.join(root,'.qa/subpath')});assert.equal(routes.length,18);
  const files=await htmlFiles(outDir);let checked=0;
  for(const file of files){const html=await readFile(file,'utf8');assert(!/testcorempro|cutiePI|400%|GigaDevice|competitor MCUs/i.test(html),file);assert(!/>\s*Magnet\s*</.test(html));if(original.profile.email)assert(!html.includes(original.profile.email),`Public email exposed in ${file}`);
   const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,`Duplicate IDs in ${file}`);
   for(const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)){const raw=m[1].replaceAll('&amp;','&');if(/^(https?:|mailto:|data:)/.test(raw))continue;const url=new URL(raw,'https://example.github.io/engineering-portfolio/'+path.relative(outDir,file).replaceAll('\\','/'));assert(url.pathname.startsWith('/engineering-portfolio/'),`Escaping base: ${raw} in ${file}`);let dest=path.join(outDir,decodeURIComponent(url.pathname.replace('/engineering-portfolio/','')));if((await stat(dest).catch(()=>null))?.isDirectory())dest=path.join(dest,'index.html');await assert.doesNotReject(()=>stat(dest),`Broken link ${raw} in ${file}`);if(url.hash){const target=await readFile(dest,'utf8');assert(target.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`),`Missing anchor ${raw}`);}checked++;}
  }
  assert(checked>400);const filesAtRoot=await readdir(outDir);assert(!filesAtRoot.includes('data'));assert(!filesAtRoot.includes('Fares Dkhili.pdf'));const sitemap=await readFile(path.join(outDir,'sitemap.xml'),'utf8');assert(sitemap.includes('/engineering-portfolio/projects/secureaccess/'));assert(!sitemap.includes('/owner/'));assert((await readFile(path.join(outDir,'owner/index.html'),'utf8')).includes('noindex,nofollow'));
 }finally{if(oldBase===undefined)delete process.env.BASE_PATH;else process.env.BASE_PATH=oldBase;if(oldSite===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=oldSite;}
});
test('a new published project and article generate pages with data changes only',async()=>{
 const data=structuredClone(original);const p=structuredClone(data.projects.find(p=>p.caseStudy));p.id='content-extension-check';p.title='Extension fixture';p.featured=false;data.projects.push(p);data.articles.push({id:'article-extension-check',title:'Article fixture',visibility:'published',summary:'Fixture only',sections:[{title:'Section',paragraphs:['Sample content.']}]});
 const result=await build({outDir:path.join(root,'.qa/extension'),data});assert(result.routes.includes('projects/content-extension-check/index.html'));assert(result.routes.includes('articles/article-extension-check/index.html'));
});
