import http from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './validate-content.mjs';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.json':'application/json','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.txt':'text/plain','.xml':'application/xml'};
export function createPreview({directory=path.join(root,'dist'),mount='/',qa=false}={}){
 const base=path.resolve(directory);
 return http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(qa&&url.pathname==='/__qa__/results'&&req.method==='POST'){
    let text='';for await(const chunk of req){text+=chunk;if(text.length>100000)throw new Error('Result too large');}
    const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(path.join(root,'.qa'),{recursive:true});await writeFile(path.join(root,'.qa/browser-results.json'),JSON.stringify(JSON.parse(text),null,2));res.writeHead(200);res.end('Saved');return;
   }
   if(qa&&url.pathname==='/__qa__/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(path.join(root,'tests/browser-checks.html')));return;}
   if(!url.pathname.startsWith(mount)){res.writeHead(404);res.end('Not found');return;}
   const relative=decodeURIComponent(url.pathname.slice(mount.length));let file=path.resolve(base,relative||'index.html');
   if(file!==base&&!file.startsWith(base+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
   if((await stat(file).catch(()=>null))?.isDirectory())file=path.join(file,'index.html');
   let status=200,payload;try{payload=await readFile(file);}catch{status=404;file=path.join(base,'404.html');payload=await readFile(file);}
   if(qa&&file.endsWith('.html')&&!url.searchParams.has('nojs'))payload=payload.toString().replace('<head>','<head><script>globalThis.__qaErrors=[];addEventListener("error",e=>__qaErrors.push(e.message));addEventListener("unhandledrejection",e=>__qaErrors.push(String(e.reason)));</script>');
   res.writeHead(status,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(url.searchParams.has('nojs')?{'Content-Security-Policy':"script-src \'none\'"}:{})});res.end(payload);
  }catch(err){res.writeHead(400);res.end('Bad request');}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4173),mount=process.env.PREVIEW_MOUNT||'/';
 createPreview({mount,qa:process.argv.includes('--qa')}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}${mount}`));
}
