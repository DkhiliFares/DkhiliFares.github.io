import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const collections = ['profile','projects','skills','experience','education','certifications','achievements','articles','categories'];
export async function loadContent() {
  return Object.fromEntries(await Promise.all(collections.map(async name => [name, JSON.parse(await readFile(path.join(root,'data',`${name}.json`),'utf8'))])));
}
export async function validateContent(data) {
  const errors = [];
  const fail = message => errors.push(message);
  const url = (value, label, nullable = false) => {
    if (nullable && value == null) return;
    try { const parsed = new URL(value); if (!['https:','http:'].includes(parsed.protocol)) throw Error(); }
    catch { fail(`${label}: expected an HTTP(S) URL`); }
  };
  for (const name of collections.filter(x=>x!=='profile')) {
    if (!Array.isArray(data[name])) { fail(`${name}: expected an array`); continue; }
    const seen = new Set();
    for (const item of data[name]) {
      if (item.visibility && !['draft','published','archived'].includes(item.visibility)) fail(`${name}/${item.id}: invalid visibility`);
      if (!item.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) fail(`${name}: invalid ID ${item.id}`);
      if (seen.has(item.id)) fail(`${name}: duplicate ID ${item.id}`);
      seen.add(item.id);
      if (!item.title?.trim()) fail(`${name}/${item.id}: missing title`);
    }
  }
  if (!data.profile?.name || !data.profile?.title) fail('profile: name and title required');
  if (data.profile?.email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.profile.email)) fail('profile: invalid email');
  url(data.profile?.github,'profile.github'); url(data.profile?.linkedin,'profile.linkedin');
  const categories = new Set(data.categories.map(x=>x.id));
  const projects = new Map(data.projects.map(x=>[x.id,x]));
  const experience = new Set(data.experience.map(x=>x.id));
  for (const p of data.projects) {
    if (!['planned','in-progress','completed','paused','unverified'].includes(p.status)) fail(`${p.id}: invalid status`);
    if (!['draft','published','archived'].includes(p.visibility)) fail(`${p.id}: invalid visibility`);
    if (!['project','exercise','reference','profile','fork'].includes(p.kind)) fail(`${p.id}: invalid kind`);
    if (!categories.has(p.category)) fail(`${p.id}: invalid category`);
    if (!p.summary?.trim()) fail(`${p.id}: missing summary`);
    if (p.visibility==='published') {
      url(p.repository,`${p.id}.repository`);
      if (!p.evidence?.length) fail(`${p.id}: published entry needs evidence`);
    }
    for (const e of p.evidence||[]) url(e,`${p.id}.evidence`);
    if (p.status==='completed' && !p.completionEvidence?.trim()) fail(`${p.id}: completion requires explicit evidence`);
    if (['cutiepi','network-administration-project'].includes(p.id) && p.status==='completed' && !p.ownerConfirmedComplete) fail(`${p.id}: completion requires owner confirmation`);
    if (p.caseStudy && p.visibility==='published' && (!p.sections?.length || !p.diagram?.nodes?.length || !p.objectives?.length)) fail(`${p.id}: incomplete case study`);
    const sectionIds = new Set();
    for (const s of p.sections||[]) {
      if (!s.id || sectionIds.has(s.id) || !s.title || !s.paragraphs?.length) fail(`${p.id}: invalid/duplicate section`);
      sectionIds.add(s.id);
    }
    for (const m of p.media||[]) {
      if (!m.alt || !m.caption) fail(`${p.id}: media needs alt text and provenance caption`);
      if (!['conceptual','repository'].includes(m.origin)) fail(`${p.id}: media origin must be explicit`);
      if (!['cover','evidence'].includes(m.role)) fail(`${p.id}: media role must be explicit`);
      if (!Number.isInteger(m.width)||m.width<1||!Number.isInteger(m.height)||m.height<1) fail(`${p.id}: media dimensions required`);
      if (!m.src || path.isAbsolute(m.src) || m.src.split(/[\\/]/).includes('..')) { fail(`${p.id}: invalid image path`); continue; }
      try { await access(path.join(root,'public',m.src)); } catch { fail(`${p.id}: missing image ${m.src}`); }
      if (m.origin==='repository') url(m.source,`${p.id}.media.source`);
      else if (m.source!==null || !/conceptual/i.test(m.caption)) fail(`${p.id}: conceptual media must be labeled and have no external source`);
    }
    if ((p.media||[]).filter(m=>m.role==='cover').length>1) fail(`${p.id}: only one cover image allowed`);
  }
  for (const s of data.skills) {
    if (!categories.has(s.category)) fail(`${s.id}: invalid category`);
    if (!['project','internship','academic','training','cv','developing','documented'].includes(s.evidenceType)) fail(`${s.id}: invalid evidence type`);
    if (s.evidenceNote !== undefined && (typeof s.evidenceNote !== 'string' || s.evidenceNote.length > 2000)) fail(`${s.id}: invalid evidence note`);
    for (const id of s.projects||[]) if (!projects.has(id) || projects.get(id).visibility!=='published') fail(`${s.id}: invalid or unpublished project ${id}`);
    for (const id of s.experience||[]) if (!experience.has(id)) fail(`${s.id}: invalid experience ${id}`);
  }
  for (const c of data.certifications) url(c.verificationUrl,`${c.id}.verificationUrl`,true);
  for (const a of data.articles) {
    if (!['draft','published','archived'].includes(a.visibility)) fail(`${a.id}: invalid article visibility`);
    if (a.visibility==='published' && (!a.summary || !a.sections?.length)) fail(`${a.id}: incomplete article`);
  }
  if (errors.length) throw new Error(`Content validation failed:\n${errors.map(x=>`- ${x}`).join('\n')}`);
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await validateContent(await loadContent()); console.log('Content validation passed.');
}
