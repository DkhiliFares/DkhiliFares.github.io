import { escapeHTML as e } from './shared.mjs';

export function mediaFigure(media, prefix, {cover=false}={}) {
  const type=media.origin==='conceptual'?'Conceptual illustration':'Repository media';
  return `<figure class="project-media ${cover?'project-media-cover':''}"><img src="${prefix}${e(media.src)}" alt="${e(media.alt)}" width="${media.width}" height="${media.height}" loading="${cover?'eager':'lazy'}" decoding="async"><figcaption><span class="media-origin">${type}</span><span>${e(media.caption)}${media.source?` <a href="${e(media.source)}">View original</a>`:''}</span></figcaption></figure>`;
}

export function coverImage(project) { return project.media?.find(item=>item.role==='cover'); }
