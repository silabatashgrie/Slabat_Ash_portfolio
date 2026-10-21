const PORTFOLIO_STORE_KEY="csPortfolioDataV3";
const LOCAL_FALLBACK_KEY="csPortfolioDataV2";
const DEFAULT_PORTFOLIO_DATA={
 profile:{image:"",name:"Alex Morgan",title:"Computer Science Professional",tagline:"Building digital solutions through code, creativity & technology.",bio:"Computer Science professional focused on web development, automation, digital products and practical technology solutions.",email:"hello@example.com",phone:"+000 000 0000",location:"Your City, Country",availability:"Available for freelance projects",linkedin:"",github:"#",telegram:"",whatsapp:"",x:"",facebook:"",youtube:""},
 skills:[{id:"s1",name:"HTML / CSS",category:"Web Development",level:90},{id:"s2",name:"JavaScript",category:"Web Development",level:82},{id:"s3",name:"Python",category:"Programming",level:76}],
 projects:[{id:"p1",title:"Equb Manager",category:"Web Application",description:"A practical savings-group management platform with member and contribution workflows.",tech:["HTML","CSS","JavaScript"],demo:"#",github:"#",featured:true,image:""}],
 portfolio:[],services:[],posts:[]
};
function cloneDefaults(){return JSON.parse(JSON.stringify(DEFAULT_PORTFOLIO_DATA));}
function getPortfolioData(){try{return JSON.parse(localStorage.getItem(PORTFOLIO_STORE_KEY)||localStorage.getItem(LOCAL_FALLBACK_KEY))||cloneDefaults();}catch(e){return cloneDefaults();}}
function savePortfolioData(data){localStorage.setItem(PORTFOLIO_STORE_KEY,JSON.stringify(data));window.dispatchEvent(new CustomEvent("portfolioDataChanged"));}
function resetPortfolioData(){const d=cloneDefaults();savePortfolioData(d);return d;}
function portfolioId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function escapeHTML(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

async function loadServerData(){
  try{
    const r=await fetch("/api/data",{credentials:"same-origin"});
    if(!r.ok)throw new Error("API unavailable");
    const d=await r.json();savePortfolioData(d);return d;
  }catch(e){return getPortfolioData();}
}
async function saveServerData(data){
  try{
    const r=await fetch("/api/data",{method:"PUT",headers:{"Content-Type":"application/json","X-CSRF-Token":window.__csrfToken||""},credentials:"same-origin",body:JSON.stringify(data)});
    if(!r.ok)throw new Error("Server save failed");
    const result=await r.json();
    if(result?.data)savePortfolioData(result.data);
    else savePortfolioData(data);
    return result;
  }catch(e){return {ok:false,localOnly:true};}
}
