import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, loadContent, validateContent } from './validate-content.mjs';
import { build } from './build.mjs';

const studioDir=path.join(root,'studio');
const token=randomBytes(32).toString('hex');
const editable=new Set(['projects','skills','experience','education','certifications','achievements','articles']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.pdf':'application/pdf'};
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const send=(res,status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'Content-Type':type});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
const authorized=req=>{
  const received=req.headers['x-studio-token'];
  if(typeof received!=='string'||received.length!==token.length)return false;
  return timingSafeEqual(Buffer.from(received),Buffer.from(token));
};
async function body(req){let result='';for await(const chunk of req){result+=chunk;if(result.length>2000000)throw Error('Request is too large');}return JSON.parse(result);}
async function asset(res,file){const data=await readFile(file);send(res,200,data,mime[path.extname(file)]||'application/octet-stream');}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname))return await asset(res,path.join(studioDir,url.pathname==='/'?'index.html':url.pathname.slice(1)));
    if(req.method==='GET'&&url.pathname.startsWith('/preview/')){
      const relative=decodeURIComponent(url.pathname.slice('/preview/'.length))||'index.html';
      const target=path.resolve(root,'dist',relative);
      const dist=path.resolve(root,'dist');
      if(target!==dist&&!target.startsWith(dist+path.sep))return send(res,403,{error:'Forbidden'});
      const file=(await stat(target).catch(()=>null))?.isDirectory()?path.join(target,'index.html'):target;
      return await asset(res,file);
    }
    if(!authorized(req))return send(res,401,{error:'Owner session required'});
    if(req.method==='GET'&&url.pathname==='/api/data')return send(res,200,await loadContent());
    if(req.method==='POST'&&url.pathname==='/api/save'){
      const input=await body(req);
      if(!editable.has(input.collection)||!input.record||typeof input.record!=='object'||Array.isArray(input.record))return send(res,400,{error:'Invalid collection or record'});
      const data=await loadContent();
      const current=data[input.collection];
      const index=input.originalId?current.findIndex(item=>item.id===input.originalId):-1;
      if(input.originalId&&index<0)return send(res,404,{error:'Original record not found'});
      if(current.some((item,i)=>i!==index&&item.id===input.record.id))return send(res,409,{error:'ID already exists'});
      const record={...input.record};
      if(index<0&&!record.visibility)record.visibility='draft';
      if(index<0)current.push(record);else current[index]=record;
      await validateContent(data);
      const target=path.join(root,'data',`${input.collection}.json`);
      const temporary=`${target}.tmp-${process.pid}`;
      await writeFile(temporary,JSON.stringify(current,null,2)+'\n','utf8');
      await rename(temporary,target);
      return send(res,200,{ok:true,id:record.id,visibility:record.visibility||'published'});
    }
    if(req.method==='POST'&&url.pathname==='/api/build'){
      const result=await build();return send(res,200,{ok:true,pages:result.routes.length,preview:'/preview/index.html'});
    }
    send(res,404,{error:'Not found'});
  }catch(error){send(res,400,{error:error.message||'Request failed'});}
});
server.listen(0,'127.0.0.1',()=>{
  const {port}=server.address();
  console.log(`Portfolio Studio: http://127.0.0.1:${port}/?token=${token}`);
  console.log('Local-only editor. The token is required for writes and is not included in the public build.');
});
