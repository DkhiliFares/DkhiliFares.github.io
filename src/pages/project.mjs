import { escapeHTML as e, tags } from '../components/shared.mjs';
import { architecture } from '../components/graphics.mjs';
import { mediaFigure, coverImage } from '../components/media.mjs';
export function project(data,p) {
 const cat=data.categories.find(c=>c.id===p.category);
 const cover=coverImage(p);
 const evidenceMedia=(p.media||[]).filter(m=>m!==cover);
 const contents=[['overview','Overview'],['architecture','Architecture'],...p.sections.map(s=>[s.id,s.title]),...(evidenceMedia.length?[['project-media','Project media']]:[]),['evidence','Source material']];
 return `<header class="page-intro wrap case-intro">
  <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="../../index.html">Home</a><span>/</span><a href="../index.html">Projects</a><span>/</span><span>${e(p.title)}</span></nav>
  <div class="case-meta"><span class="eyebrow">${e(cat.title)}</span><span class="status-badge">${e(p.statusLabel)}</span></div>
  <h1>${e(p.title)}</h1><p class="lead">${e(p.summary)}</p>${tags(p.technologies)}
  <div class="actions"><a class="button primary" href="${e(p.repository)}">Explore the repository</a><a class="text-link" href="#architecture">Follow the architecture</a></div>
  ${cover?`<div class="case-cover">${mediaFigure(cover,'../../',{cover:true})}</div>`:''}
 </header>
 <div class="case-layout wrap"><aside class="case-contents"><p class="eyebrow">In this study</p><nav aria-label="Case study sections">${contents.map(([id,title])=>`<a href="#${id}">${e(title)}</a>`).join('')}</nav><p class="evidence-note">Source reviewed<br>21 November 2026</p></aside>
 <div class="case-body">
  <section id="overview"><p class="eyebrow">Overview</p><h2>Objectives & components</h2><div class="two-columns"><div><h3>Objectives</h3><ul>${p.objectives.map(x=>`<li>${e(x)}</li>`).join('')}</ul></div><div><h3>Hardware & software</h3><ul>${p.components.map(x=>`<li>${e(x)}</li>`).join('')}</ul></div></div></section>
  <section id="architecture"><h2>System architecture</h2>${architecture(p)}</section>
  ${p.sections.map(s=>`<section id="${e(s.id)}"><h2>${e(s.title)}</h2>${s.paragraphs.map(x=>`<p>${e(x)}</p>`).join('')}</section>`).join('')}
  ${evidenceMedia.length?`<section id="project-media"><p class="eyebrow">Repository visuals</p><h2>Inside the project.</h2><p>These images are taken from the public repository. They show documented design or interface material, not independent test results.</p><div class="project-gallery">${evidenceMedia.map(m=>mediaFigure(m,'../../')).join('')}</div></section>`:''}
  <section id="evidence" class="source-material"><p class="eyebrow">Traceable evidence</p><h2>Explore the source material.</h2><p>This study describes the repository and documentation available at review time. Hardware execution, performance and deployment were not independently retested.</p><ul>${p.evidence.slice(0,7).map((url,i)=>`<li><a href="${e(url)}">${e(i===0?p.repositoryName:url.split('/').slice(7).join('/')||'Repository documentation')}</a></li>`).join('')}</ul></section>
  <div class="case-end"><a class="button secondary" href="../index.html">Return to the archive</a><a class="text-link" href="../../index.html#skills-${p.category}">Explore related skills</a></div>
 </div></div>`;
}
