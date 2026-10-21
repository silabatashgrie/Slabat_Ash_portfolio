document.addEventListener("DOMContentLoaded",async()=>{
 const login=qs("adminLogin"),app=qs("adminApp");
 try{const me=await fetch("/api/me",{credentials:"same-origin"}).then(r=>r.json());if(me.authenticated){login.style.display="none";app.style.display="block";const csrf=await fetch("/api/csrf",{credentials:"same-origin"}).then(r=>r.json());window.__csrfToken=csrf.token;await initAdmin();}else{login.style.display="flex";app.style.display="none";}}catch(e){login.style.display="flex";app.style.display="none";}
 qs("loginForm").addEventListener("submit",async e=>{e.preventDefault();try{const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({username:qs("adminUser").value,password:qs("adminPass").value})});const j=await r.json();if(!r.ok)throw new Error(j.error);location.reload();}catch(err){qs("loginError").textContent=err.message;}});
 qs("logoutBtn").onclick=async()=>{await fetch("/api/logout",{method:"POST",headers:{"X-CSRF-Token":window.__csrfToken||""},credentials:"same-origin"});location.reload();};
});
function qs(id){return document.getElementById(id);}
async function initAdmin(){bindTabs();const data=await loadServerData();bindProfile(data);bindSkills(data);bindProjects(data);bindPortfolio(data);bindServices(data);bindBlog(data);bindDataTools();bindPasswordChange();await renderMessages();updateStats(data);}
function bindTabs(){
 const settingsToggle=qs("settingsMenuToggle");
 const settingsSubmenu=qs("settingsSubmenu");

 if(settingsToggle&&settingsSubmenu){
  settingsToggle.onclick=()=>{
   const opening=settingsSubmenu.hidden;
   settingsSubmenu.hidden=!opening;
   settingsToggle.setAttribute("aria-expanded",String(opening));
  };
 }

 document.querySelectorAll(".admin-nav button[data-section]").forEach(b=>{
  b.onclick=()=>{
   const target=qs(b.dataset.section);
   if(!target)return;

   document.querySelectorAll(".admin-nav button").forEach(x=>x.classList.remove("active"));
   document.querySelectorAll(".admin-section").forEach(x=>x.classList.remove("active"));

   b.classList.add("active");
   target.classList.add("active");

   if(settingsSubmenu && settingsToggle && settingsSubmenu.contains(b)){
    settingsSubmenu.hidden=false;
    settingsToggle.setAttribute("aria-expanded","true");
   }
  };
 });
}
function updateStats(d){qs("statProjects").textContent=d.projects?.length||0;qs("statPortfolio").textContent=d.portfolio?.length||0;qs("statServices").textContent=d.services?.length||0;qs("statPosts").textContent=d.posts?.length||0;}
async function persist(d){const r=await saveServerData(d);if(r?.localOnly)alert("Server unavailable. A local browser copy was saved.");updateStats(d);}
function bindProfile(d){
 const f=qs("profileForm");
 const photoFile=qs("profilePhotoFile");
 const photoPreview=qs("profilePhotoPreview");
 const photoStatus=qs("profilePhotoStatus");
 const uploadPhotoBtn=qs("uploadProfilePhotoBtn");

 ["name","title","tagline","bio","email","phone","location","availability","linkedin","github","telegram","whatsapp","x","facebook","youtube"].forEach(k=>{
  const e=f.querySelector(`[name="${k}"]`);
  if(e)e.value=d.profile?.[k]||"";
 });

 const showPhoto=url=>{
  if(!photoPreview)return;
  if(typeof url==="string" && url.startsWith("/uploads/")){
   photoPreview.src=url;
   photoPreview.hidden=false;
  }else{
   photoPreview.removeAttribute("src");
   photoPreview.hidden=true;
  }
 };
 showPhoto(d.profile?.image||"");

 if(photoFile)photoFile.onchange=()=>{
  const file=photoFile.files?.[0];
  if(!file)return;
  if(!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type)){
   photoStatus.textContent="Choose a JPG, PNG, WEBP or GIF image.";
   photoFile.value="";
   return;
  }
  if(file.size>8*1024*1024){
   photoStatus.textContent="Image is larger than 8 MB. Choose a smaller image.";
   photoFile.value="";
   return;
  }
  const localUrl=URL.createObjectURL(file);
  photoPreview.src=localUrl;
  photoPreview.hidden=false;
  photoStatus.textContent="Preview ready. Select Upload & Save Profile Photo to publish it.";
 };

 if(uploadPhotoBtn)uploadPhotoBtn.onclick=async()=>{
  const file=photoFile?.files?.[0];
  if(!file){
   photoStatus.textContent="Choose a new image first.";
   return;
  }
  uploadPhotoBtn.disabled=true;
  photoStatus.textContent="Uploading image and saving profile...";
  try{
   const fd=new FormData();
   fd.append("file",file);
   const response=await fetch("/api/upload",{
    method:"POST",
    headers:{"X-CSRF-Token":window.__csrfToken||""},
    credentials:"same-origin",
    body:fd
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(result.error||"Image upload failed.");

   if(typeof result.url!=="string"||!result.url.startsWith("/uploads/")){
    throw new Error("The server returned an unexpected image URL.");
   }

   const current=await loadServerData();
   const next={...current,profile:{...(current.profile||{}),image:result.url}};
   const saved=await saveServerData(next);
   if(saved?.localOnly||saved?.ok===false){
    throw new Error("The image uploaded, but the profile save was not confirmed. Please retry saving.");
   }

   const fresh=await loadServerData();
   if(fresh.profile?.image!==result.url){
    throw new Error("The server did not confirm the saved profile photo.");
   }

   showPhoto(result.url);
   photoFile.value="";
   photoStatus.textContent="Profile photo uploaded and saved successfully.";
   window.dispatchEvent(new CustomEvent("portfolioDataChanged"));
  }catch(error){
   photoStatus.textContent=error.message||"Could not save the profile photo.";
  }finally{
   uploadPhotoBtn.disabled=false;
  }
 };

 f.onsubmit=async e=>{
  e.preventDefault();
  const next=getPortfolioData();
  next.profile={...(next.profile||{})};
  new FormData(f).forEach((value,key)=>next.profile[key]=value);
  try{
   const saved=await saveServerData(next);
   if(saved?.localOnly||saved?.ok===false)throw new Error("Server save failed. Profile changes were not confirmed.");
   const fresh=await loadServerData();
   if(!fresh.profile)throw new Error("Could not verify the saved profile.");
   alert("Profile saved successfully.");
  }catch(error){
   alert(error.message||"Profile save failed.");
  }
 };
}
function row(x){return `<div class="admin-row"><div><strong>${escapeHTML(x.name||x.title)}</strong><small>${escapeHTML(x.category||x.date||"")}</small></div><div><button class="btn small ghost" data-edit="${x.id}">Edit</button><button class="btn small danger" data-delete="${x.id}">Delete</button></div></div>`;}
function wireList(id,key,edit){const box=qs(id),d=getPortfolioData();box.innerHTML=(d[key]||[]).map(row).join("");box.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>edit(b.dataset.edit));box.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this item?"))return;const n=getPortfolioData();const item=n[key].find(v=>v.id===b.dataset.delete);if(!item)return;try{const r=await fetch(`/api/${key}/${encodeURIComponent(item.id)}`,{method:"DELETE",headers:{"X-CSRF-Token":window.__csrfToken||""},credentials:"same-origin"});if(!r.ok)throw new Error();n[key]=n[key].filter(v=>v.id!==item.id);savePortfolioData(n);wireList(id,key,edit);updateStats(n);}catch(e){alert("Delete failed.");}});}
function autoCategoryFor(type, parts) {
 const text = (parts || []).filter(Boolean).join(" ").toLowerCase();
 const rules = [
  [/\b(ai|artificial intelligence|machine learning|deep learning|nlp|computer vision)\b/i, "AI"],
  [/\b(html|css|javascript|typescript|react|frontend|front-end|website|web development|web app|web application|ui\/ux)\b/i, "Web Development"],
  [/\b(software|application|app|system|desktop|backend|back-end|api|database|equb)\b/i, "Software"],
  [/\b(math|mathematics|education|teaching|teacher|lesson|tutorial|learning|student|course)\b/i, "Education"],
  [/\b(python|java|programming|coding|algorithm|node\.js|nodejs|php|c\+\+|c#)\b/i, "Programming"],
  [/\b(design|graphic|logo|branding|illustration|visual|canva)\b/i, "\u{1F3A8}"],
  [/\b(video|editing|editor|reel|shorts|film|cinema|motion)\b/i, "\u{1F3AC}"],
  [/\b(writing|writer|blog|article|copywriting|script|translation)\b/i, "\u270D\uFE0F"],
 ];
 for (const [pattern, category] of rules) {
  if (pattern.test(text)) return category;
 }
 return type === "skill" ? "General Skill" :
        type === "blog" ? "General" : "Other";
}
function bindSkills(){const f=qs("skillForm");f.onsubmit=async e=>{e.preventDefault();const name=qs("skillName").value.trim();const item={id:qs("skillId").value||portfolioId("s"),name,category:autoCategoryFor("skill",[name]),level:Number(qs("skillLevel").value)||0};await upsert("skills",item);f.reset();qs("skillId").value="";wireList("skillList","skills",editSkill);};qs("cancelSkill").onclick=()=>{f.reset();qs("skillId").value=""};wireList("skillList","skills",editSkill);}
function editSkill(id){const x=getPortfolioData().skills.find(v=>v.id===id);if(x){qs("skillId").value=x.id;qs("skillName").value=x.name;qs("skillLevel").value=x.level;}}
function setProjectImagePreview(source){
 const img=qs("projectImagePreview");
 if(!img)return;
 if(!source){
  img.removeAttribute("src");
  img.hidden=true;
  return;
 }
 img.onerror=()=>{img.hidden=true;};
 img.onload=()=>{img.hidden=false;};
 img.src=source;
 img.hidden=false;
}
function bindProjects(){
 const f=qs("projectForm");
 const fileInput=qs("projectImageFile");
 const uploadBtn=qs("uploadProjectImageBtn");
 const status=qs("projectImageStatus");
 const imageUrl=qs("projectImage");

 if(imageUrl){
  imageUrl.addEventListener("input",()=>{
   if(!fileInput?.files?.length)setProjectImagePreview(imageUrl.value.trim());
  });
 }
 if(fileInput){
  fileInput.onchange=()=>{
   const file=fileInput.files?.[0];
   if(!file){
    setProjectImagePreview(imageUrl?.value.trim()||"");
    if(status)status.textContent="";
    return;
   }
   const allowed=["image/jpeg","image/png","image/webp","image/gif"];
   if(!allowed.includes(file.type)){
    fileInput.value="";
    if(status)status.textContent="Unsupported image type. Choose JPG, PNG, WEBP or GIF.";
    return;
   }
   if(file.size>8*1024*1024){
    fileInput.value="";
    if(status)status.textContent="Image exceeds the 8 MB limit.";
    return;
   }
   setProjectImagePreview(URL.createObjectURL(file));
   if(status)status.textContent="Preview ready. Upload the image to use it in this project.";
  };
 }
 if(uploadBtn){
  uploadBtn.onclick=async()=>{
   const file=fileInput?.files?.[0];
   if(!file){
    if(status)status.textContent="Choose an image file first.";
    return;
   }
   const allowed=["image/jpeg","image/png","image/webp","image/gif"];
   if(!allowed.includes(file.type)||file.size>8*1024*1024){
    if(status)status.textContent="Choose a supported image no larger than 8 MB.";
    return;
   }
   const fd=new FormData();
   fd.append("file",file);
   uploadBtn.disabled=true;
   if(status)status.textContent="Uploading image...";
   try{
    const response=await fetch("/api/upload",{
     method:"POST",
     headers:{"X-CSRF-Token":window.__csrfToken||""},
     body:fd,
     credentials:"same-origin"
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||`Upload failed (${response.status}).`);
    if(typeof result.url!=="string"||!result.url.startsWith("/uploads/")){
     throw new Error("The server returned an unexpected image URL.");
    }
    imageUrl.value=result.url;
    setProjectImagePreview(result.url);
    if(status)status.textContent="Upload successful. Save the project to keep this image attached.";
    fileInput.value="";
   }catch(error){
    if(status)status.textContent=error.message||"Image upload failed.";
   }finally{
    uploadBtn.disabled=false;
   }
  };
 }
 f.onsubmit=async e=>{
  e.preventDefault();
  const title=qs("projectTitle").value.trim();
  const description=qs("projectDescription").value.trim();
  const tech=qs("projectTech").value.split(",").map(x=>x.trim()).filter(Boolean);
  const item={
   id:qs("projectId").value||portfolioId("p"),
   title,
   category:qs("projectCategory").value,
   description,
   tech,
   demo:qs("projectDemo").value||"#",
   github:qs("projectGithub").value||"#",
   featured:qs("projectFeatured").checked,
   image:qs("projectImage")?.value.trim()||""
  };
  await upsert("projects",item);
  f.reset();
  qs("projectId").value="";
  setProjectImagePreview("");
  if(status)status.textContent="";
  wireList("projectList","projects",editProject);
 };
 qs("cancelProject").onclick=()=>{
  f.reset();
  qs("projectId").value="";
  setProjectImagePreview("");
  if(status)status.textContent="";
 };
 wireList("projectList","projects",editProject);
}
function editProject(id){
 const x=getPortfolioData().projects.find(v=>v.id===id);
 if(x){
  [["projectId","id"],["projectTitle","title"],["projectCategory","category"],["projectDescription","description"],["projectDemo","demo"],["projectGithub","github"]].forEach(([field,key])=>{
   if(qs(field))qs(field).value=x[key]||"";
  });
  qs("projectTech").value=(x.tech||[]).join(", ");
  qs("projectFeatured").checked=!!x.featured;
  if(qs("projectImage"))qs("projectImage").value=x.image||"";
  if(qs("projectImageFile"))qs("projectImageFile").value="";
  setProjectImagePreview(x.image||"");
  if(qs("projectImageStatus"))qs("projectImageStatus").textContent="";
 }
}/* PORTFOLIO_IMAGE_UPLOAD_V1 */
function setPortfolioImagePreview(source) {
  const img = qs("portfolioImagePreview");
  if (!img) return;

  if (!source) {
    img.removeAttribute("src");
    img.hidden = true;
    return;
  }

  img.onerror = () => { img.hidden = true; };
  img.onload = () => { img.hidden = false; };
  img.src = source;
  img.hidden = false;
}

function bindPortfolio() {
  const f = qs("portfolioForm");
  const fileInput = qs("portfolioImageFile");
  const uploadBtn = qs("uploadPortfolioImageBtn");
  const status = qs("portfolioImageStatus");
  const imageUrl = qs("portfolioImage");
  const category = qs("portfolioCategory");

  if (imageUrl) {
    imageUrl.addEventListener("input", () => {
      if (!fileInput?.files?.length) {
        setPortfolioImagePreview(imageUrl.value.trim());
      }
    });
  }

  if (fileInput) {
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];

      if (!file) {
        setPortfolioImagePreview(imageUrl?.value.trim() || "");
        if (status) status.textContent = "";
        return;
      }

      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(file.type)) {
        fileInput.value = "";
        if (status) status.textContent =
          "Unsupported image type. Choose JPG, PNG, WEBP or GIF.";
        return;
      }

      if (file.size > 8 * 1024 * 1024) {
        fileInput.value = "";
        if (status) status.textContent = "Image exceeds the 8 MB limit.";
        return;
      }

      setPortfolioImagePreview(URL.createObjectURL(file));
      if (status) status.textContent =
        "Preview ready. Upload the image before saving to use it on your portfolio.";
    };
  }

  if (uploadBtn) {
    uploadBtn.onclick = async () => {
      const file = fileInput?.files?.[0];

      if (!file) {
        if (status) status.textContent = "Choose an image file first.";
        return;
      }

      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(file.type) || file.size > 8 * 1024 * 1024) {
        if (status) status.textContent =
          "Choose a supported image no larger than 8 MB.";
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      uploadBtn.disabled = true;
      if (status) status.textContent = "Uploading image...";

      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          headers: { "X-CSRF-Token": window.__csrfToken || "" },
          body: fd,
          credentials: "same-origin"
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "Upload failed (" + response.status + ").");
        }
        if (typeof result.url !== "string" ||
            !result.url.startsWith("/uploads/")) {
          throw new Error("The server returned an unexpected image URL.");
        }

        imageUrl.value = result.url;
        setPortfolioImagePreview(result.url);
        fileInput.value = "";
        if (status) status.textContent =
          "Upload successful. Save the item to attach this image.";
      } catch (error) {
        if (status) status.textContent =
          error.message || "Image upload failed.";
      } finally {
        uploadBtn.disabled = false;
      }
    };
  }

  f.onsubmit = async e => {
    e.preventDefault();

    const title = qs("portfolioTitle").value.trim();
    const description = qs("portfolioDescription").value.trim();
    const link = qs("portfolioLink").value.trim() || "#";
    const item = {
      id: qs("portfolioId").value || portfolioId("pf"),
      title,
      category: category.value,
      description,
      link,
      image: imageUrl?.value.trim() || ""
    };

    try {
      await upsert("portfolio", item);
      f.reset();
      qs("portfolioId").value = "";
      setPortfolioImagePreview("");
      if (status) status.textContent = "";
      wireList("portfolioList", "portfolio", editPortfolio);
    } catch (error) {
      if (status) status.textContent =
        error.message || "Unable to save this portfolio item.";
    }
  };

  qs("cancelPortfolio").onclick = () => {
    f.reset();
    qs("portfolioId").value = "";
    setPortfolioImagePreview("");
    if (status) status.textContent = "";
  };

  wireList("portfolioList", "portfolio", editPortfolio);
}

function editPortfolio(id) {
  const x = getPortfolioData().portfolio.find(v => v.id === id);
  if (!x) return;

  qs("portfolioId").value = x.id;
  qs("portfolioTitle").value = x.title || "";
  qs("portfolioDescription").value = x.description || "";
  qs("portfolioLink").value = x.link === "#" ? "" : (x.link || "");

  const imageUrl = qs("portfolioImage");
  if (imageUrl) imageUrl.value = x.image || "";

  const category = qs("portfolioCategory");
  const existingCategory = x.category || "Other";

  // Preserve older categories that are not in the current dropdown.
  if (![...category.options].some(option => option.value === existingCategory)) {
    category.add(new Option(existingCategory, existingCategory));
  }
  category.value = existingCategory;

  const fileInput = qs("portfolioImageFile");
  if (fileInput) fileInput.value = "";
  const status = qs("portfolioImageStatus");
  if (status) status.textContent = "";
  setPortfolioImagePreview(x.image || "");
}

function serviceIconFor(title, description) {
 const rules = [
  [/\b(video|editing|editor|reel|shorts|film|cinema|motion)\b/i, "\u{1F3AC}"],
  [/\b(design|graphic|logo|branding|brand|illustration|visual)\b/i, "\u{1F3A8}"],
  [/\b(translation|translator|language|localization|localisation)\b/i, "\u{1F310}"],
  [/\b(writing|writer|copywriting|copywriter|content writing|script)\b/i, "\u270D\uFE0F"],
  [/\b(marketing|seo|social media|advertising|campaign|promotion)\b/i, "\u{1F4E3}"],
  [/\b(analytics|data analysis|dashboard|reporting|statistics)\b/i, "\u{1F4CA}"],
  [/\b(security|cybersecurity|privacy|protection)\b/i, "\u{1F512}"],
  [/\b(mobile|android|ios|app development|application)\b/i, "\u{1F4F1}"],
  [/\b(web|website|development|developer|programming|software|coding|computer|api|database)\b/i, "\u{1F4BB}"],
 ];
 const titleText = String(title || "");
 for (const [pattern, icon] of rules) {
  if (pattern.test(titleText)) return icon;
 }
 const combinedText = titleText + " " + String(description || "");
 for (const [pattern, icon] of rules) {
  if (pattern.test(combinedText)) return icon;
 }
 return "\u2728";
}

function bindServices() {
 const f = qs("serviceForm");
 f.onsubmit = async e => {
  e.preventDefault();
  const title = qs("serviceTitle").value.trim();
  const description = qs("serviceDescription").value.trim();
  const editingId = qs("serviceId").value;
  const normalizedTitle = title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  const duplicate = (getPortfolioData().services || []).some(service =>
   service.id !== editingId &&
   String(service.title || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim() === normalizedTitle
  );
  if (duplicate) {
   alert("A service with this title already exists. Please edit the existing service instead.");
   return;
  }
  const item = {
   id: editingId || portfolioId("sv"),
   title,
   icon: serviceIconFor(title, description),
   description
  };
  await upsert("services", item);
  f.reset();
  qs("serviceId").value = "";
  wireList("serviceList", "services", editService);
 };
 qs("cancelService").onclick = () => {
  f.reset();
  qs("serviceId").value = "";
 };
 wireList("serviceList", "services", editService);
}
function editService(id) {
 const x = getPortfolioData().services.find(v => v.id === id);
 if (!x) return;
 qs("serviceId").value = x.id;
 qs("serviceTitle").value = x.title || "";
 qs("serviceDescription").value = x.description || "";
}
function bindBlog(){const f=qs("blogForm");f.onsubmit=async e=>{e.preventDefault();const title=qs("blogTitle").value.trim();const excerpt=qs("blogExcerpt").value.trim();const content=qs("blogContent").value.trim();const item={id:qs("blogId").value||portfolioId("b"),title,date:qs("blogDate").value,category:autoCategoryFor("blog",[title,excerpt,content]),excerpt,content};await upsert("posts",item);f.reset();qs("blogId").value="";wireList("blogList","posts",editBlog);};qs("cancelBlog").onclick=()=>{f.reset();qs("blogId").value=""};wireList("blogList","posts",editBlog);}
function editBlog(id){const x=getPortfolioData().posts.find(v=>v.id===id);if(x){qs("blogId").value=x.id;qs("blogTitle").value=x.title;qs("blogDate").value=x.date;qs("blogExcerpt").value=x.excerpt;qs("blogContent").value=x.content;}}
async function upsert(key,item){
 try{
  const exists=(getPortfolioData()[key]||[]).some(x=>x.id===item.id);
  const r=await fetch(`/api/${key}${exists?"/"+encodeURIComponent(item.id):""}`,{method:exists?"PUT":"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":window.__csrfToken||""},credentials:"same-origin",body:JSON.stringify(item)});
  const result=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(result.error||`Save failed (${r.status})`);
  const fresh=await loadServerData();
  updateStats(fresh);
 }catch(e){alert(e.message||"Save failed.");throw e;}
}
function bindDataTools() {
  const allowed = ["profile", "skills", "projects", "portfolio", "services", "posts"];
  const collections = ["skills", "projects", "portfolio", "services", "posts"];
  const maxImageBytes = 8 * 1024 * 1024;
  const maxJsonBytes = 1024 * 1024;
  const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  async function fetchServerPortfolio() {
    const response = await fetch("/api/data", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("Could not retrieve portfolio data from the server.");
    }

    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("The server returned an invalid portfolio response.");
    }
    return data;
  }

  function validateImportData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("JSON root must be an object.");
    }

    const keys = Object.keys(data);
    if (!keys.length) {
      throw new Error("The JSON file contains no portfolio data.");
    }

    const unsupported = keys.filter(key => !allowed.includes(key));
    if (unsupported.length) {
      throw new Error("Unsupported fields: " + unsupported.join(", "));
    }

    if (
      data.profile !== undefined &&
      (!data.profile || typeof data.profile !== "object" || Array.isArray(data.profile))
    ) {
      throw new Error("profile must be an object.");
    }

    for (const key of collections) {
      if (data[key] === undefined) continue;
      if (!Array.isArray(data[key])) {
        throw new Error(key + " must be an array.");
      }

      for (let i = 0; i < data[key].length; i++) {
        const item = data[key][i];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error(key + " item " + (i + 1) + " must be an object.");
        }
        if (
          item.id !== undefined &&
          (typeof item.id !== "string" || !item.id.trim())
        ) {
          throw new Error(key + " item " + (i + 1) + " has an invalid id.");
        }
      }
    }
  }

  async function verifySavedFields(expected) {
    const actual = await fetchServerPortfolio();

    for (const key of Object.keys(expected)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
        throw new Error(
          "Server verification failed for '" + key +
          "'. Please reload and check the saved data before trying again."
        );
      }
    }
    return actual;
  }

  const uploadButton = qs("uploadBtn");
  const imageInput = qs("imageUpload");
  const uploadResult = qs("uploadResult");

  if (imageInput) {
    imageInput.onchange = () => {
      const file = imageInput.files && imageInput.files[0];
      if (!file) return;

      if (!imageTypes.includes(file.type)) {
        imageInput.value = "";
        uploadResult.textContent = "Choose a JPG, PNG, WEBP or GIF image.";
        return;
      }
      if (file.size > maxImageBytes) {
        imageInput.value = "";
        uploadResult.textContent = "Image must be no larger than 8 MB.";
        return;
      }
      uploadResult.textContent = "Selected: " + file.name;
    };
  }

  if (uploadButton) {
    uploadButton.onclick = async () => {
      const file = imageInput && imageInput.files && imageInput.files[0];
      if (!file) {
        alert("Choose an image first.");
        return;
      }
      if (!imageTypes.includes(file.type)) {
        alert("Choose a JPG, PNG, WEBP or GIF image.");
        return;
      }
      if (file.size > maxImageBytes) {
        alert("Image must be no larger than 8 MB.");
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      uploadButton.disabled = true;
      uploadResult.textContent = "Uploading...";

      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          headers: { "X-CSRF-Token": window.__csrfToken || "" },
          credentials: "same-origin",
          body: formData
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "Image upload failed.");
        }
        if (typeof result.url !== "string" || !result.url.startsWith("/uploads/")) {
          throw new Error("Upload response did not contain a valid image URL.");
        }
        uploadResult.textContent = "Uploaded: " + result.url;
      } catch (error) {
        uploadResult.textContent = error.message || "Image upload failed.";
      } finally {
        uploadButton.disabled = false;
      }
    };
  }

  const resetButton = qs("resetData");
  if (resetButton) {
    resetButton.onclick = async () => {
      if (!confirm(
        "Reset server portfolio content to starter demo data? " +
        "This replaces the current saved portfolio content."
      )) return;

      resetButton.disabled = true;
      try {
        const defaults = cloneDefaults();
        const result = await saveServerData(defaults);

        if (!result || result.ok !== true || result.localOnly) {
          throw new Error("Server reset was not confirmed. Please try again.");
        }

        await verifySavedFields(defaults);
        alert("Server data reset and verified successfully.");
        location.reload();
      } catch (error) {
        alert(error.message || "Reset failed. Please check the server data.");
      } finally {
        resetButton.disabled = false;
      }
    };
  }

  const exportButton = qs("exportData");
  if (exportButton) {
    exportButton.onclick = async () => {
      exportButton.disabled = true;
      try {
        const data = await fetchServerPortfolio();

        for (const key of allowed) {
          if (!Object.prototype.hasOwnProperty.call(data, key)) {
            throw new Error("Server data is missing the '" + key + "' field.");
          }
        }

        const blob = new Blob(
          [JSON.stringify(data, null, 2)],
          { type: "application/json" }
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "portfolio-data.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        alert(error.message || "Export failed.");
      } finally {
        exportButton.disabled = false;
      }
    };
  }

  const importInput = qs("importData");
  if (importInput) {
    importInput.onchange = async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      try {
        if (!file.name.toLowerCase().endsWith(".json")) {
          throw new Error("Choose a .json backup file.");
        }
        if (file.size > maxJsonBytes) {
          throw new Error("JSON backup must be no larger than 1 MB.");
        }

        const text = await file.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("The selected file is not valid JSON.");
        }

        validateImportData(data);

        if (!confirm(
          "Import this backup into the server? " +
          "Only the fields included in the file will be replaced."
        )) return;

        const result = await saveServerData(data);
        if (!result || result.ok !== true || result.localOnly) {
          throw new Error("Import was not confirmed as saved by the server.");
        }

        await verifySavedFields(data);
        alert("Portfolio data imported and verified successfully.");
        location.reload();
      } catch (error) {
        alert(error.message || "Import failed.");
      } finally {
        importInput.value = "";
      }
    };
  }
}
let selectedMessageEmail = null;
let cachedContactMessages = [];

function chatEscape(value) {
  return escapeHTML(String(value ?? ""));
}
function chatDate(value, includeTime = false) {
  if (!value) return "Date unavailable";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { month: "short", day: "numeric" }).format(d);
}
function chatInitial(name) {
  const value = String(name || "?").trim();
  return chatEscape(value ? value.charAt(0).toUpperCase() : "?");
}
function chatGroupMessages(items) {
  const groups = new Map();
  for (const message of items) {
    const email = String(message.email || "").trim().toLowerCase();
    const key = email || ("no-email:" + String(message.name || "Unknown").trim().toLowerCase());
    if (!groups.has(key)) groups.set(key, { key, name: message.name || "Unknown contact", email: message.email || "", messages: [] });
    groups.get(key).messages.push(message);
  }
  return [...groups.values()].map(group => {
    group.messages.sort((a,b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    group.latest = group.messages[group.messages.length - 1];
    return group;
  }).sort((a,b) => new Date(b.latest?.createdAt || 0) - new Date(a.latest?.createdAt || 0));
}
async function markChatConversationRead(groupKey) {
  const group = chatGroupMessages(cachedContactMessages)
    .find(item => item.key === groupKey);

  if (!group) return;

  const unreadMessages = group.messages.filter(message =>
    message.status === "new" && message.id
  );

  let debugRequests = 0;
  let debugRead = 0;
  let debugOtherStatus = 0;
  let debugErrors = 0;

  await Promise.all(unreadMessages.map(async message => {
    debugRequests += 1;
    try {
      const response = await fetch(
        "/api/messages/" + encodeURIComponent(message.id) + "/read",
        {
          method: "POST",
          headers: {
            "X-CSRF-Token": window.__csrfToken || ""
          },
          credentials: "same-origin"
        }
      );

      if (!response.ok) {
        throw new Error("Read-status request failed (" + response.status + ")");
      }

      const result = await response.json();
      console.log("[READ DEBUG] API response:", response.status, result);

      if (result.status === "read") {
        debugRead += 1;
        message.status = "read";
      } else {
        debugOtherStatus += 1;
      }
    } catch (error) {
      debugErrors += 1;
      console.error("Could not mark message as read:", error);
      alert("Mark as read failed: " + error.message);
    }
  }));

  console.log("[READ DEBUG] Summary:", {
    groupKey,
    groupMessages: group.messages.length,
    unreadBeforeRequest: unreadMessages.length,
    requests: debugRequests,
    markedRead: debugRead,
    otherStatus: debugOtherStatus,
    errors: debugErrors
  });
renderChatContacts();

  if (selectedMessageEmail === groupKey) {
    renderChatThread();
  }
}
function renderChatContacts() {
  const list = qs("messageContacts");
  const search = (qs("chatContactSearch")?.value || "").trim().toLowerCase();
  if (!list) return;
  const groups = chatGroupMessages(cachedContactMessages);
  const filtered = groups.filter(group =>
    [group.name, group.email, group.latest?.subject, group.latest?.message]
      .some(value => String(value || "").toLowerCase().includes(search))
  );
  const unread = cachedContactMessages.filter(message => message.status === "new").length;
  const count = qs("chatConversationCount");
  if (count) {
    count.textContent = unread > 99 ? "99+" : String(unread);
    count.setAttribute("aria-label", unread + " new messages");
    count.title = unread + " new messages";
  }

  const badge = qs("messagesNavBadge");
  if (badge) {
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = unread === 0;
    badge.setAttribute("aria-label", unread + " new messages");
  }
  if (!filtered.length) {
    list.innerHTML = '<div class="chat-contact-empty">' +
      (groups.length ? "No contacts match your search." : "No contact messages yet.") + '</div>';
    return;
  }
  list.innerHTML = filtered.map(group => {
    const latest = group.latest || {};
    const active = group.key === selectedMessageEmail;
    return `<button type="button" class="chat-contact${active ? " active" : ""}" data-chat-email="${chatEscape(group.key)}" aria-pressed="${active}">
      <span class="chat-avatar">${chatInitial(group.name)}</span>
      <span class="chat-contact-copy">
        <span class="chat-contact-top"><span class="chat-contact-name">${chatEscape(group.name)}</span><span class="chat-contact-date">${chatEscape(chatDate(latest.createdAt))}</span></span>
        <span class="chat-contact-preview">${chatEscape(latest.message || "")}</span>
        <span class="chat-contact-subject">${chatEscape(latest.subject || "No subject")} | ${group.messages.length} message${group.messages.length === 1 ? "" : "s"}</span>
      </span>
    </button>`;
  }).join("");
  list.querySelectorAll("[data-chat-email]").forEach(button => {
    button.addEventListener("click", async () => {
      selectedMessageEmail = button.dataset.chatEmail;
      renderChatContacts();
      renderChatThread();
      await markChatConversationRead(selectedMessageEmail);
    });
  });
}
function renderChatThread() {
  const header = qs("chatThreadHeader");
  const box = qs("messageList");
  if (!header || !box) return;
  const group = chatGroupMessages(cachedContactMessages).find(item => item.key === selectedMessageEmail);
  if (!group) {
    header.innerHTML = '<div class="chat-thread-avatar">?</div><div><h3>Select a conversation</h3><p>Choose a contact to view messages</p></div>';
    box.innerHTML = '<div class="chat-empty-state"><div class="chat-empty-icon">&#9993;</div><h3>Your inbox</h3><p>Select a contact to read their messages.</p></div>';
    return;
  }
  header.innerHTML = `<div class="chat-thread-avatar">${chatInitial(group.name)}</div>
    <div><h3>${chatEscape(group.name)}</h3><p>${chatEscape(group.email || "No email provided")}</p><p class="chat-thread-meta">${group.messages.length} message${group.messages.length === 1 ? "" : "s"} | Read-only conversation</p></div>`;
  let previousDay = "";
  box.innerHTML = group.messages.map(message => {
    const d = new Date(message.createdAt || "");
    const day = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
    const divider = day && day !== previousDay ? `<div class="chat-day-divider">${chatEscape(chatDate(message.createdAt, false))}</div>` : "";
    previousDay = day || previousDay;
    return `${divider}<article class="chat-message">
      ${message.subject ? `<div class="chat-message-subject">${chatEscape(message.subject)}</div>` : ""}
      <div class="chat-message-bubble">${chatEscape(message.message)}</div>
      <div class="chat-message-time">${chatEscape(chatDate(message.createdAt, true))}</div>
    </article>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}
async function renderMessages() {
  const box = qs("messageList");
  if (!box) return;
  box.innerHTML = '<div class="chat-empty-state"><p>Loading messages...</p></div>';
  try {
    const response = await fetch("/api/messages", {
      headers: { "X-CSRF-Token": window.__csrfToken || "" },
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error("Messages request failed (" + response.status + ")");
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error("Unexpected messages response");
    cachedContactMessages = items;
    const groups = chatGroupMessages(items);
    if (!groups.some(group => group.key === selectedMessageEmail)) {
      selectedMessageEmail = groups[0]?.key || null;
    }
    renderChatContacts();
    renderChatThread();
    const search = qs("chatContactSearch");
    if (search && !search.dataset.bound) {
      search.addEventListener("input", renderChatContacts);
      search.dataset.bound = "true";
    }
  } catch (error) {
    box.innerHTML = '<div class="chat-empty-state"><h3>Unable to load messages</h3><p>Please refresh the page and try again.</p></div>';
    const list = qs("messageContacts");
    if (list) list.innerHTML = '<div class="chat-contact-empty">Messages could not be loaded.</div>';
    console.error("Could not load admin messages:", error);
  }
}



function bindPasswordChange() {
  const form = qs("changePasswordForm");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";

  const status = qs("passwordChangeStatus");
  const button = qs("changePasswordBtn");

  const newPasswordInput = qs("newPassword");
  const strengthMeter = qs("passwordStrengthMeter");
  const strengthBar = qs("passwordStrengthBar");
  const strengthLabel = qs("passwordStrengthLabel");
  const requirementItems = document.querySelectorAll("[data-password-rule]");

  function updatePasswordStrength() {
    if (!newPasswordInput || !strengthMeter || !strengthBar || !strengthLabel) return;

    const password = newPasswordInput.value;
    const rules = {
      length: password.length >= 12 && password.length <= 128,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9\s]/.test(password)
    };

    let passed = 0;

    requirementItems.forEach((item) => {
      const rule = item.dataset.passwordRule;
      const met = Boolean(rules[rule]);
      const symbol = item.querySelector("span");

      item.classList.toggle("met", met);

      if (symbol) symbol.textContent = met ? "✓" : "○";
      if (met) passed += 1;
    });

    const percentage = Math.round((passed / 5) * 100);

    strengthBar.style.width = `${percentage}%`;
    strengthMeter.setAttribute("aria-valuenow", String(percentage));

    strengthMeter.classList.remove("is-weak", "is-medium", "is-strong");
    strengthLabel.classList.remove("is-weak", "is-medium", "is-strong");

    if (!password) {
      strengthLabel.textContent = "Not entered";
    } else if (passed <= 2) {
      strengthMeter.classList.add("is-weak");
      strengthLabel.classList.add("is-weak");
      strengthLabel.textContent = "Weak";
    } else if (passed < 5) {
      strengthMeter.classList.add("is-medium");
      strengthLabel.classList.add("is-medium");
      strengthLabel.textContent = "Almost there";
    } else {
      strengthMeter.classList.add("is-strong");
      strengthLabel.classList.add("is-strong");
      strengthLabel.textContent = "Strong";
    }
  }

  if (newPasswordInput && !newPasswordInput.dataset.strengthBound) {
    newPasswordInput.addEventListener("input", updatePasswordStrength);
    newPasswordInput.dataset.strengthBound = "true";
  }

  updatePasswordStrength();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    const currentPassword = qs("currentPassword").value;
    const newPassword = qs("newPassword").value;
    const confirmPassword = qs("confirmPassword").value;

    if (newPassword.length < 12 || newPassword.length > 128) {
      status.textContent = "New password must be between 12 and 128 characters.";
      return;
    }

    const passwordMeetsStrength =
      /[A-Z]/.test(newPassword) &&
      /[a-z]/.test(newPassword) &&
      /[0-9]/.test(newPassword) &&
      /[^A-Za-z0-9\s]/.test(newPassword);

    if (!passwordMeetsStrength) {
      status.textContent =
        "Include an uppercase letter, a lowercase letter, a number, and a special character.";
      qs("newPassword").focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      status.textContent = "The new passwords do not match.";
      qs("confirmPassword").focus();
      return;
    }

    if (newPassword === currentPassword) {
      status.textContent = "Choose a password different from your current password.";
      return;
    }

    button.disabled = true;
    status.textContent = "Updating password...";

    try {
      const response = await fetch("/api/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": window.__csrfToken || ""
        },
        credentials: "same-origin",
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Password change failed. Please try again.");
      }

      form.reset();
      status.textContent = "Password updated. Please sign in again.";
      alert("Password changed successfully. Please sign in with your new password.");
      location.reload();
    } catch (error) {
      status.textContent = error.message || "Password change failed.";
    } finally {
      button.disabled = false;
    }
  });
}
