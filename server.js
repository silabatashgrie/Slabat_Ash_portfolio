/*
  Computer Science Personal Portfolio - Full Stack Server
  Node.js built-ins only. No external npm dependencies required.
*/
const http=require("http");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const url=require("url");

const ROOT=__dirname;
const DATA_FILE=path.resolve(process.env.DATA_FILE||path.join(ROOT,"data","db.json"));
const UPLOAD_DIR=path.resolve(process.env.UPLOAD_DIR||path.join(ROOT,"uploads"));
const PORT=Number(process.env.PORT||3000);
const COOKIE_SECURE=process.env.NODE_ENV==="production"||process.env.COOKIE_SECURE==="true";
const SESSION_TTL=1000*60*60*8;
const ADMIN_USER=process.env.ADMIN_USER;
const ADMIN_PASSWORD_HASH=process.env.ADMIN_PASSWORD_HASH;
const sessions=new Map();
const rateLimits=new Map();

if(!ADMIN_USER||!ADMIN_PASSWORD_HASH){
  console.error("Startup refused: set ADMIN_USER and ADMIN_PASSWORD_HASH.");
  process.exit(1);
}
if(!fs.existsSync(path.dirname(DATA_FILE)))fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});
if(!fs.existsSync(UPLOAD_DIR))fs.mkdirSync(UPLOAD_DIR,{recursive:true});
if(!fs.existsSync(DATA_FILE)){const example=path.join(path.dirname(DATA_FILE),"db.example.json");if(fs.existsSync(example))fs.copyFileSync(example,DATA_FILE);else fs.writeFileSync(DATA_FILE,JSON.stringify({profile:{},skills:[],projects:[],portfolio:[],services:[],posts:[],messages:[]},null,2));}

function readDB(){try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}catch(e){return {};}}
function writeDB(db){fs.writeFileSync(DATA_FILE,JSON.stringify(db,null,2));}
function json(res,status,data,extra={}){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra});res.end(JSON.stringify(data));}
function html(res,status,body,contentType="text/html; charset=utf-8"){res.writeHead(status,{"Content-Type":contentType});res.end(body);}
function parseCookies(req){const out={};const raw=req.headers.cookie||"";raw.split(";").forEach(x=>{const i=x.indexOf("=");if(i>0)out[x.slice(0,i).trim()]=decodeURIComponent(x.slice(i+1).trim());});return out;}
function sameOrigin(req){
  const origin=req.headers.origin;
  if(origin)return origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`;
  const referer=req.headers.referer;
  if(referer){try{const u=new URL(referer);return u.host===req.headers.host; }catch(e){return false;}}
  return false;
}
function isAuth(req){const sid=parseCookies(req).sid;const s=sid&&sessions.get(sid);if(!s||s.expires<Date.now()){if(sid)sessions.delete(sid);return false;}return true;}
function requireAuth(req,res){const sid=parseCookies(req).sid;const session=sid&&sessions.get(sid);if(!isAuth(req)){json(res,401,{error:"Unauthorized"});return false;}if(!sameOrigin(req)){json(res,403,{error:"Cross-origin request blocked"});return false;}if(!session||req.headers["x-csrf-token"]!==session.csrf){json(res,403,{error:"Invalid CSRF token"});return false;}return true;}
function hashPassword(password,salt){return crypto.scryptSync(password,salt,64).toString("hex");}
function verifyPassword(password,encoded){
  const parts=String(encoded||"").split("$");if(parts.length!==3||parts[0]!=="scrypt")return false;
  try{const actual=Buffer.from(hashPassword(password,parts[1]),"hex");const expected=Buffer.from(parts[2],"hex");return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}catch(e){return false;}
}
function rateLimit(req,key,max,windowMs){
  const now=Date.now();const ip=req.socket.remoteAddress||"unknown";const id=`${key}:${ip}`;
  const hits=rateLimits.get(id)||[];const fresh=hits.filter(t=>now-t<windowMs);fresh.push(now);rateLimits.set(id,fresh);
  return fresh.length<=max;
}
function safeName(name){return path.basename(name).replace(/[^a-zA-Z0-9._-]/g,"_");}
function extFor(type,name){const m={"image/jpeg":".jpg","image/png":".png","image/webp":".webp","image/gif":".gif"};return m[type]||path.extname(name).toLowerCase()||".bin";}
function serveStatic(req,res){
  let pathname=decodeURIComponent(url.parse(req.url).pathname);
  if(pathname==="/")pathname="/index.html";
  if(pathname.includes("..")||pathname==="/db.json"||pathname.startsWith("/data/"))return html(res,404,"Not found");
  const file=path.join(ROOT,pathname);
  if(!file.startsWith(ROOT+path.sep)&&file!==ROOT)return html(res,403,"Forbidden");
  fs.stat(file,(err,st)=>{
    if(err||!st.isFile())return html(res,404,"Not found");
    const ext=path.extname(file).toLowerCase();
    const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".svg":"image/svg+xml"};
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":ext===".html"?"no-cache":"public, max-age=86400","X-Content-Type-Options":"nosniff","X-Frame-Options":"SAMEORIGIN","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"});
    fs.createReadStream(file).pipe(res);
  });
}
function body(req,limit=2*1024*1024){
  return new Promise((resolve,reject)=>{let chunks=[],size=0,done=false;
    req.on("data",c=>{size+=c.length;if(size>limit&&!done){done=true;reject(new Error("Payload too large"));req.destroy();}else if(!done)chunks.push(c);});
    req.on("end",()=>{if(!done)resolve(Buffer.concat(chunks));});req.on("error",e=>{if(!done)reject(e);});
  });
}
function jsonBody(req){return body(req).then(b=>JSON.parse(b.toString("utf8")||"{}"));}
function id(prefix){return prefix+Date.now().toString(36)+crypto.randomBytes(4).toString("hex");}
function validCollection(k){return["skills","projects","portfolio","services","posts"].includes(k);}

async function api(req,res){
  const parsed=url.parse(req.url,true),pathname=parsed.pathname;
  if(pathname==="/api/health"&&req.method==="GET")return json(res,200,{ok:true,service:"portfolio-server"});
  if(pathname==="/api/csrf"&&req.method==="GET"){
    if(!isAuth(req))return json(res,401,{error:"Unauthorized"});
    const sid=parseCookies(req).sid,s=sessions.get(sid);return json(res,200,{token:s.csrf});
  }
  if(pathname==="/api/login"&&req.method==="POST"){
    if(!sameOrigin(req))return json(res,403,{error:"Cross-origin request blocked"});
    if(!rateLimit(req,"login",5,15*60*1000))return json(res,429,{error:"Too many login attempts. Try again later."});
    try{
      const data=await jsonBody(req);
      if(data.username!==ADMIN_USER||!verifyPassword(String(data.password||""),ADMIN_PASSWORD_HASH))return json(res,401,{error:"Invalid credentials"});
      const sid=crypto.randomBytes(32).toString("hex"),csrf=crypto.randomBytes(32).toString("hex");
      sessions.set(sid,{expires:Date.now()+SESSION_TTL,csrf});
      res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":`sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL/1000}${COOKIE_SECURE?"; Secure":""}`,"Cache-Control":"no-store"});return res.end(JSON.stringify({ok:true}));
    }catch(e){return json(res,400,{error:"Invalid request"});}
  }
  if(pathname==="/api/logout"&&req.method==="POST"){
    if(!requireAuth(req,res))return;
    const sid=parseCookies(req).sid;if(sid)sessions.delete(sid);
    res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":`sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${COOKIE_SECURE?"; Secure":""}`,"Cache-Control":"no-store"});return res.end(JSON.stringify({ok:true}));
  }
  if(pathname==="/api/me"&&req.method==="GET")return json(res,200,{authenticated:isAuth(req)});

  const mutating=req.method==="POST"||req.method==="PUT"||req.method==="DELETE";
  if(mutating&&pathname!=="/api/login"&&!sameOrigin(req))return json(res,403,{error:"Cross-origin request blocked"});
  const db=readDB();

  if(pathname==="/api/data"&&req.method==="GET"){const publicData={...db};delete publicData.messages;return json(res,200,publicData);}
  if(pathname==="/api/data"&&req.method==="PUT"){
    if(!requireAuth(req,res))return;
    try{const incoming=await jsonBody(req);const allowed=["profile","skills","projects","portfolio","services","posts"];allowed.forEach(k=>{if(incoming[k]!==undefined)db[k]=incoming[k];});writeDB(db);return json(res,200,{ok:true,data:db});}
    catch(e){return json(res,400,{error:e.message});}
  }

  const m=pathname.match(/^\/api\/(skills|projects|portfolio|services|posts)(?:\/([^/]+))?$/);
  if(m){
    if(!requireAuth(req,res))return;
    const key=m[1],itemId=m[2];db[key]=Array.isArray(db[key])?db[key]:[];
    if(req.method==="GET")return json(res,200,db[key]);
    if(req.method==="POST"){try{const item=await jsonBody(req);item.id=item.id||id(key.slice(0,2));db[key].push(item);writeDB(db);return json(res,201,item);}catch(e){return json(res,400,{error:e.message});}}
    if(itemId&&(req.method==="PUT"||req.method==="DELETE")){const i=db[key].findIndex(x=>x.id===itemId);if(i<0)return json(res,404,{error:"Not found"});if(req.method==="DELETE"){db[key].splice(i,1);writeDB(db);return json(res,200,{ok:true});}try{const item=await jsonBody(req);item.id=itemId;db[key][i]=item;writeDB(db);return json(res,200,item);}catch(e){return json(res,400,{error:e.message});}}
  }

  if(pathname==="/api/profile"&&req.method==="PUT"){
    if(!requireAuth(req,res))return;
    try{db.profile=await jsonBody(req);writeDB(db);return json(res,200,db.profile);}catch(e){return json(res,400,{error:e.message});}
  }

  if(pathname==="/api/contact"&&req.method==="POST"){
    if(!rateLimit(req,"contact",10,15*60*1000))return json(res,429,{error:"Too many messages. Please try again later."});
    try{
      const b=await jsonBody(req);if(!b.name||!b.email||!b.message)return json(res,400,{error:"Name, email and message are required"});
      db.messages=db.messages||[];db.messages.push({id:id("msg"),name:String(b.name).slice(0,120),email:String(b.email).slice(0,200),subject:String(b.subject||"").slice(0,200),message:String(b.message).slice(0,5000),createdAt:new Date().toISOString(),status:"new"});writeDB(db);return json(res,201,{ok:true,message:"Message received"});
    }catch(e){return json(res,400,{error:e.message});}
  }

  if(pathname==="/api/messages"&&req.method==="GET"){if(!requireAuth(req,res))return;return json(res,200,db.messages||[]);}
  if(pathname==="/api/upload"&&req.method==="POST"){
    if(!requireAuth(req,res))return;
    const ct=req.headers["content-type"]||"",match=ct.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);if(!match)return json(res,400,{error:"Use multipart/form-data"});
    try{
      const b=await body(req,8*1024*1024),boundary=Buffer.from("--"+(match[1]||match[2])),parts=[];let start=0;
      while((start=b.indexOf(boundary,start))!==-1){const next=b.indexOf(boundary,start+boundary.length);if(next===-1)break;const part=b.slice(start+boundary.length+2,next-2);start=next;const sep=part.indexOf(Buffer.from("\r\n\r\n"));if(sep<0)continue;const head=part.slice(0,sep).toString("utf8"),data=part.slice(sep+4),disp=head.match(/Content-Disposition:.*name="([^"]+)".*filename="([^"]*)"/i),type=(head.match(/Content-Type:\s*([^\r\n]+)/i)||[])[1]||"";if(disp&&disp[2])parts.push({name:disp[1],filename:disp[2],type,data});}
      const p=parts[0];if(!p)return json(res,400,{error:"No file"});
      const signatures=[["image/jpeg",Buffer.from([0xff,0xd8,0xff])],["image/png",Buffer.from([0x89,0x50,0x4e,0x47])],["image/gif",Buffer.from("GIF8")]];
      const allowed=["image/jpeg","image/png","image/webp","image/gif"];if(!allowed.includes(p.type))return json(res,415,{error:"Only JPG, PNG, WEBP and GIF are allowed"});
      const signatureOK=p.type==="image/webp"?(p.data.length>=12&&p.data.subarray(0,4).toString("ascii")==="RIFF"&&p.data.subarray(8,12).toString("ascii")==="WEBP"):signatures.some(([t,s])=>t===p.type&&p.data.subarray(0,s.length).equals(s));if(!signatureOK)return json(res,415,{error:"Invalid image file"});
      const filename=crypto.randomBytes(12).toString("hex")+extFor(p.type,safeName(p.filename));fs.writeFileSync(path.join(UPLOAD_DIR,filename),p.data);return json(res,201,{ok:true,url:"/uploads/"+filename,filename});
    }catch(e){return json(res,400,{error:e.message});}
  }
  return json(res,404,{error:"API route not found"});
}
const server=http.createServer((req,res)=>{if(req.url.startsWith("/api/"))return api(req,res).catch(e=>json(res,500,{error:"Server error"}));serveStatic(req,res);});
server.listen(PORT,()=>console.log(`Portfolio server running at http://localhost:${PORT}`));
