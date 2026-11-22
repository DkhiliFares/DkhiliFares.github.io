import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreview } from '../scripts/serve.mjs';
import { build } from '../scripts/build.mjs';
import { root } from '../scripts/validate-content.mjs';
import { readFile,readdir,stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
test('actual HTTP delivery works at a repository subpath with correct asset MIME types and a 404',async()=>{
 const output=path.join(root,'.qa/http');await build({outDir:output});const server=createPreview({directory:output,mount:'/portfolio/'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const [route,type] of [['index.html','text/html'],['projects/index.html','text/html'],['projects/gprs-driver/index.html','text/html'],['assets/app.js','text/javascript'],['assets/styles.css','text/css'],['fonts/inter.woff2','font/woff2'],['cv/fares-dkhili.pdf','application/pdf']]){const res=await fetch(`${base}/portfolio/${route}`);assert.equal(res.status,200,route);assert(res.headers.get('content-type').startsWith(type));await res.arrayBuffer();}const missing=await fetch(base+'/portfolio/missing');assert.equal(missing.status,404);assert((await missing.text()).includes('This path ends here.'));assert.equal((await fetch(base+'/index.html')).status,404);}finally{await new Promise(resolve=>server.close(resolve));}
});
test('asset budgets remain modest and text/focus colors meet contrast targets',async()=>{
 const output=path.join(root,'.qa/performance');await build({outDir:output});
 const html=await readFile(path.join(output,'index.html'));const css=await readFile(path.join(output,'assets/styles.css'));let jsBytes=0;for(const f of await readdir(path.join(output,'assets')))if(f.endsWith('.js'))jsBytes+=gzipSync(await readFile(path.join(output,'assets',f))).length;
 assert(html.length<100000);assert(gzipSync(css).length<14000);assert(jsBytes<14000);let fonts=0;for(const f of await readdir(path.join(output,'fonts')))if(f.endsWith('.woff2'))fonts+=(await stat(path.join(output,'fonts',f))).size;assert(fonts<600000);
 const luminance=hex=>{const channels=hex.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
 const contrast=(a,b)=>{const l=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(l[0]+.05)/(l[1]+.05);};
 for(const bg of ['0b111b','111c2a','132334'])for(const fg of ['f1f5fa','a7b6c9','40bceb','a696ff'])assert(contrast(fg,bg)>=4.5,`${fg} on ${bg}`);assert(contrast('080c13','40bceb')>=4.5);
 console.log(`Budget: home ${html.length} B raw; CSS ${gzipSync(css).length} B gzip; all JS ${jsBytes} B gzip; fonts ${fonts} B raw.`);
});
