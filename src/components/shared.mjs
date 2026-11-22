export const escapeHTML = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const tags = list => `<ul class="tags" aria-label="Technologies">${list.map(t=>`<li>${escapeHTML(t)}</li>`).join('')}</ul>`;
export const evidenceLabel = {project:'Project use',internship:'Internship',academic:'Academic practice',training:'Training',cv:'CV-listed',developing:'Developing',documented:'Documented exposure'};
export const published = list => list.filter(x=>x.visibility==='published');
export const prefixFor = depth => depth?'../'.repeat(depth):'./';
export function external(url,label,cls='text-link') {return `<a class="${cls}" href="${escapeHTML(url)}">${escapeHTML(label)}</a>`;}
