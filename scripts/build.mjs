import { mkdir, writeFile, copyFile, cp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root,loadContent,validateContent } from './validate-content.mjs';
import { layout } from '../src/components/layout.mjs';
import { home } from '../src/pages/home.mjs';
import { archive } from '../src/pages/archive.mjs';
import { project } from '../src/pages/project.mjs';
import { escapeHTML as e,published } from '../src/components/shared.mjs';
import { cvPDF } from './cv-pdf.mjs';
import { contactConfig } from './contact-config.mjs';
import { owner } from '../src/pages/owner.mjs';
export async function build({outDir=path.join(root,'dist'),data=null}={}){
 const source=data||await loadContent();await validateContent(source);
 const content={...source};
 for(const name of ['skills','experience','education','certifications','achievements','categories'])content[name]=source[name].filter(item=>!item.visibility||item.visibility==='published');
 const contact=contactConfig();
 const ownerUrl=process.env.SUPABASE_URL?.trim()||'';
 const ownerKey=process.env.SUPABASE_PUBLISHABLE_KEY?.trim()||'';
 if (Boolean(ownerUrl)!==Boolean(ownerKey)) throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured together');
 if (ownerUrl && !/^https:\/\/[^/]+\.supabase\.co\/?$/.test(ownerUrl)) throw new Error('SUPABASE_URL must be a Supabase HTTPS project URL');
 const resolved=path.resolve(outDir);if(resolved===root||!resolved.startsWith(root+path.sep))throw new Error('Build output must be inside the workspace and cannot be its root');
 await rm(resolved,{recursive:true,force:true});await mkdir(resolved,{recursive:true});
 await cp(path.join(root,'public'),resolved,{recursive:true});await mkdir(path.join(resolved,'assets'),{recursive:true});
 await cp(path.join(root,'src/scripts'),path.join(resolved,'assets'),{recursive:true});
 const manageDir=path.join(resolved,'manage');
 try {
  await cp(path.join(root,'owner-dashboard/build'),manageDir,{recursive:true});
  const dashboardIndex=path.join(manageDir,'index.html');
  let dashboard=await readFile(dashboardIndex,'utf8');
  dashboard=dashboard.replaceAll('__SUPABASE_URL__',ownerUrl).replaceAll('__SUPABASE_PUBLISHABLE_KEY__',ownerKey);
  await writeFile(dashboardIndex,dashboard);
 } catch {
  await mkdir(manageDir,{recursive:true});
  await writeFile(path.join(manageDir,'index.html'),`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Owner workspace setup pending</title></head><body><main style="max-width:720px;margin:20vh auto;padding:32px;font-family:system-ui"><p>Portfolio owner workspace</p><h1>Dashboard build pending.</h1><p>The public portfolio remains available. Run <code>npm run dashboard:build</code> after installing dashboard dependencies.</p></main></body></html>`);
 }
 for(const name of ['styles.css','tokens.css','enhancements.css'])await copyFile(path.join(root,'src/styles',name),path.join(resolved,'assets',name));
 const routes=[];
 async function page(route,opts){const dest=path.join(resolved,route);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,layout(content,{...opts,canonicalPath:route.replace(/index\.html$/,'')}));routes.push(route);}
 await page('index.html',{title:'Computer Engineer',body:home(content,{contact}),contactReady:Boolean(contact.ready&&contact.siteKey)});
 await page('projects/index.html',{title:'Project archive',body:archive(content),depth:1,page:'archive'});
 for(const p of published(content.projects).filter(p=>p.caseStudy))await page(`projects/${p.id}/index.html`,{title:p.title,description:p.summary,body:project(content,p),depth:2,page:'project'});
 const articles=published(content.articles);
 await page('articles/index.html',{title:'Technical notes',page:'articles',depth:1,body:`<section class="page-intro wrap"><p class="eyebrow">Technical notes</p><h1>Notes from<br><em>the workbench.</em></h1></section><section class="wrap empty-notes">${articles.length?articles.map(a=>`<article><h2><a href="./${a.id}/index.html">${e(a.title)}</a></h2><p>${e(a.summary)}</p></article>`).join(''):'<p>No standalone articles have been published yet. The project studies document the current engineering work and its source material.</p><a class="button secondary" href="../projects/index.html">Explore the project studies</a>'}</section>`});
 for(const a of articles)await page(`articles/${a.id}/index.html`,{title:a.title,description:a.summary,depth:2,page:'article',body:`<article class="wrap cv-page"><p class="eyebrow">Technical note</p><h1>${e(a.title)}</h1><p class="lead">${e(a.summary)}</p>${a.sections.map(s=>`<section><h2>${e(s.title)}</h2>${s.paragraphs.map(t=>`<p>${e(t)}</p>`).join('')}</section>`).join('')}</article>`});
 await page('owner/index.html',{title:'Private inbox',depth:1,page:'owner',body:owner()});
 const p=content.profile;
 await page('cv/index.html',{title:'Professional CV',depth:1,page:'cv',body:`<article class="wrap cv-page"><h1>${e(p.name)}</h1><p class="cv-role">${e(p.title)}</p><p>${e(p.location)} · Contact through the portfolio or LinkedIn</p><p>${e(p.intro)}</p><div class="actions"><a class="button primary" href="./fares-dkhili.pdf" download>Download PDF</a><button type="button" class="button secondary enhancement" data-print-cv>Print this CV</button></div><h2>Experience</h2>${content.experience.map(x=>`<article><h3>${e(x.company)} · ${e(x.title)}</h3><p>${e(x.period)}</p><ul>${x.details.map(t=>`<li>${e(t)}</li>`).join('')}</ul></article>`).join('')}<h2>Education</h2>${content.education.map(x=>`<article><h3>${e(x.title)}</h3><p>${e(x.institution)} · ${e(x.period)}</p>${x.major?`<p>Department: ${x.department} · Specialization: ${x.specialization}<br>Major: ${x.major}</p>`:''}</article>`).join('')}<h2>Selected engineering work</h2>${published(content.projects).filter(x=>x.featured).map(x=>`<article><h3>${e(x.title)} · ${e(x.statusLabel)}</h3><p>${e(x.summary)}</p></article>`).join('')}<h2>Credentials & achievement</h2>${content.certifications.map(x=>`<p>${e(x.title)} · ${e(x.issuer)}${x.date?' · '+e(x.date):''}</p>`).join('')}<p>3rd place, CTF 101 · Securinets FST · April 2025</p><h2>Languages</h2><p>${p.languages.map(x=>`${x.name}: ${x.level}`).join(' · ')}</p><p><a href="${p.github}">${p.github}</a><br><a href="${p.linkedin}">${p.linkedin}</a></p></article>`});
 await writeFile(path.join(resolved,'cv/fares-dkhili.pdf'),cvPDF(content));
 await page('404.html',{title:'Page not found',page:'404',body:`<section class="wrap error-page"><p class="eyebrow">Connection not found</p><h1>This path ends here.</h1><p>The page may have moved. Return to the portfolio or explore the project archive.</p><div class="actions"><a class="button primary" href="${process.env.BASE_PATH||'/'}index.html">Return home</a><a class="text-link" href="${process.env.BASE_PATH||'/'}projects/index.html">Project archive</a></div></section>`});
 await writeFile(path.join(resolved,'.nojekyll'),'');
 const site=process.env.SITE_URL?.replace(/\/$/,'');const base=(process.env.BASE_PATH||'/').replace(/\/$/,'');
 if(site){const urls=routes.filter(x=>!['404.html','owner/index.html'].includes(x)).map(r=>`${site}${base}/${r.replace(/index\.html$/,'')}`);await writeFile(path.join(resolved,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url=>`<url><loc>${e(url)}</loc></url>`).join('')}</urlset>`);await writeFile(path.join(resolved,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: ${base}/owner/\nDisallow: ${base}/manage/\nSitemap: ${site}${base}/sitemap.xml\n`);}else await writeFile(path.join(resolved,'robots.txt'),'User-agent: *\nAllow: /\nDisallow: /owner/\nDisallow: /manage/\n');
 console.log(`Built ${routes.length} pages; ${published(content.projects).length} archive entries; ${content.skills.length} evidenced skills.`);return{routes,outDir:resolved};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build();
