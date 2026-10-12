const http=require("http");
const {spawn}=require("child_process");
const path=require("path");
const base="http://127.0.0.1:3199";
const crypto=require("crypto");
function passwordHash(password,salt){return ["scrypt",salt,crypto.scryptSync(password,salt,64).toString("hex")].join("$");}
let child;
function req(method,path,body,cookie,csrf){return new Promise((resolve,reject)=>{const u=new URL(base+path);const r=http.request({hostname:u.hostname,port:u.port,path:u.pathname+u.search,method,headers:{Origin:base,...(body?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}:{}),...(cookie?{"Cookie":cookie}:{}),...(csrf?{"X-CSRF-Token":csrf}:{})}},res=>{let b="";res.on("data",c=>b+=c);res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:b}));});r.on("error",reject);if(body)r.write(body);r.end();});}
(async()=>{try{
 child=spawn(process.execPath,[path.join(__dirname,"server.js")],{cwd:__dirname,env:{...process.env,NODE_ENV:"production",PORT:"3199",ADMIN_USER:"admin",ADMIN_PASSWORD_HASH:passwordHash("TestPass_123!","test-salt-portfolio")},stdio:["ignore","pipe","pipe"]});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("server start timeout")),5000);child.stdout.on("data",d=>{if(String(d).includes("3199")){clearTimeout(t);resolve();}});child.stderr.on("data",d=>{});});
 const pages=["/","/index.html","/about.html","/skills.html","/projects.html","/portfolio.html","/services.html","/resume.html","/blog.html","/contact.html","/admin.html"];
 for(const p of pages){const r=await req("GET",p);if(r.status!==200)throw new Error(`${p} returned ${r.status}`);}
 let r=await req("GET","/api/health");if(r.status!==200)throw new Error("health failed");
 r=await req("GET","/api/data");if(r.status!==200)throw new Error("data failed");
 const original=JSON.parse(r.body).profile;
 r=await req("POST","/api/login",JSON.stringify({username:"admin",password:"TestPass_123!"}));if(r.status!==200)throw new Error(`login failed: HTTP ${r.status}; response=${r.body}`);
 const setCookie=(r.headers["set-cookie"]||[])[0]||""; const cookie=setCookie.split(";")[0]; if(!cookie)throw new Error("session cookie missing"); if(!/;\s*Secure(?:;|$)/i.test(setCookie))throw new Error("Secure cookie flag missing in production mode");
 r=await req("GET","/api/csrf",null,cookie);if(r.status!==200)throw new Error("csrf token failed");const csrf=JSON.parse(r.body).token;
 const changed={...original,name:"V5 Integration Test"};
 r=await req("PUT","/api/profile",JSON.stringify(changed),cookie,csrf);if(r.status!==200)throw new Error("profile save failed");
 r=await req("GET","/api/data");const after=JSON.parse(r.body);if(after.profile.name!=="V5 Integration Test")throw new Error("profile persistence failed");
 await req("PUT","/api/profile",JSON.stringify(original),cookie,csrf);
 r=await req("POST","/api/contact",JSON.stringify({name:"Test User",email:"test@example.com",subject:"Smoke test",message:"Integration test"}));if(r.status!==201)throw new Error("contact failed");
 r=await req("GET","/api/messages",null,cookie,csrf);if(r.status!==200||!JSON.parse(r.body).some(x=>x.email==="test@example.com"))throw new Error("message inbox failed");
 console.log("ALL TESTS PASSED");
}catch(e){console.error("TEST FAILED:",e.message);process.exitCode=1;}finally{if(child)child.kill();}})();
