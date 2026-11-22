import { escapeHTML as e } from './shared.mjs';
export function fieldSVG() {
  const curves=Array.from({length:17},(_,i)=>{const r=38+i*11; return `<path d="M 255 270 C ${255-r*1.2} ${270-r*1.45}, ${445+r*1.2} ${270-r*1.45}, 445 270 C ${445+r*1.2} ${270+r*1.45}, ${255-r*1.2} ${270+r*1.45}, 255 270"/>`;}).join('');
  return `<svg class="field-svg" viewBox="0 0 700 540" aria-hidden="true"><defs><linearGradient id="flux" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#40bceb"/><stop offset=".6" stop-color="#397fe8"/><stop offset="1" stop-color="#8c78f5"/></linearGradient></defs><g class="flux-lines">${curves}</g><g class="orbit-lines"><ellipse cx="350" cy="270" rx="233" ry="165" transform="rotate(-32 350 270)"/><circle cx="350" cy="270" r="194" stroke-dasharray="2 12"/><path d="M65 270H635M350 55V485"/></g><g class="pole"><circle cx="255" cy="270" r="8"/><circle cx="445" cy="270" r="8"/></g><path class="pole-cross" d="M247 270h16m-8-8v16m182-8h16"/></svg>`;
}
export function architecture(p, compact=false) {
  if (!p.diagram) return '';
  const nodes=p.diagram.nodes;
  const id=`diagram-${p.id}${compact?'-compact':''}`;
  const positions=[[70,85],[345,85],[70,255],[345,255]];
  const edges=p.diagram.edges||[[0,1],[1,2],[2,3]];
  const edgePaths=edges.map(([from,to])=>{const a=positions[from],b=positions[to];return a[1]===b[1]?`M${a[0]+185} ${a[1]+36}H${b[0]}`:`M${a[0]+92} ${a[1]+72}C${a[0]+92} 210 ${b[0]+92} 190 ${b[0]+92} ${b[1]}`;}).map(d=>`<path d="${d}"/>`).join('');
  return `<figure class="architecture ${compact?'compact':''}" data-domain="${e(p.category)}"><div class="diagram-top"><span class="mono">${e(p.category.replace('-',' + '))}</span><span class="mono">${e(p.diagram.title||"System architecture")}</span></div><svg viewBox="0 0 620 400" role="img" aria-labelledby="${id}"><title id="${id}">${e(p.title)}: ${e(nodes.map(n=>n.label).join(' to '))}</title><g class="diagram-guides"><path d="M0 200H620M310 0V400"/><circle cx="310" cy="200" r="138"/><circle cx="310" cy="200" r="176" stroke-dasharray="3 10"/></g><g class="diagram-path">${edgePaths}</g>${nodes.slice(0,4).map((n,i)=>`<g class="diagram-node" transform="translate(${positions[i][0]} ${positions[i][1]})"><rect width="185" height="72" rx="4"/><circle cx="0" cy="36" r="4"/><circle cx="185" cy="36" r="4"/><text x="17" y="29" class="diagram-label">${e(n.label)}</text><text x="17" y="50" class="diagram-detail">${e(n.detail)}</text></g>`).join('')}<circle class="diagram-center" cx="310" cy="200" r="6"/></svg><ol class="diagram-mobile">${nodes.map(n=>`<li><strong>${e(n.label)}</strong><span>${e(n.detail)}</span></li>`).join('')}</ol>${compact?'':`<figcaption>${e(p.diagram.caption)}</figcaption>`}</figure>`;
}
