document.addEventListener("DOMContentLoaded", async () => {
  const currentPage = window.location.pathname.split("/").filter(Boolean).pop() || "index.html";

  document.querySelectorAll(".topbar .nav a[href]").forEach(link => {
    const targetPage = new URL(link.getAttribute("href"), window.location.href)
      .pathname.split("/").filter(Boolean).pop() || "index.html";
    const isActive = targetPage.toLowerCase() === currentPage.toLowerCase();

    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  const data = await loadServerData();
  renderPublicSite(data);
  window.addEventListener("portfolioDataChanged", () => renderPublicSite(getPortfolioData()));
});

function isAllowedImageUrl(value) {
  if (typeof value !== "string" || !value || value.startsWith("//")) return false;

  if (value.startsWith("/uploads/")) {
    return !value.includes("\\") &&
      !value.split("/").some(part => part === "..");
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.origin === "https://vdztdrujyghhtqibrrfn.supabase.co" &&
      url.pathname.startsWith("/storage/v1/object/public/portfolio-uploads/") &&
      !url.pathname.includes("\\") &&
      !url.pathname.split("/").some(part => part === "..") &&
      !url.search && !url.hash;
  } catch {
    return false;
  }
}
function renderPublicSite(data) {
  const profile = data.profile || {};
  const avatar = document.getElementById("profilePhotoDisplay");
  if (avatar) {
    const initials = String(profile.name || "AM")
      .trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map(part => part.charAt(0).toUpperCase()).join("") || "AM";
    const photoUrl = typeof profile.image === "string" &&
      isAllowedImageUrl(profile.image) ? profile.image : "";
    avatar.replaceChildren();
    if (photoUrl) {
      const img = document.createElement("img");
      img.src = photoUrl;
      img.alt = profile.name ? profile.name + " profile photo" : "Profile photo";
      img.loading = "eager";
      img.onerror = () => {
        avatar.replaceChildren(document.createTextNode(initials));
      };
      avatar.appendChild(img);
      avatar.setAttribute("aria-label", img.alt);
    } else {
      avatar.textContent = initials;
      avatar.setAttribute("aria-label", "Profile initials " + initials);
    }
  }
  document.querySelectorAll("[data-profile]").forEach(el => {
    const key = el.dataset.profile;
    if (profile[key] === undefined) return;

    const value = String(profile[key] ?? "");

    if (el.querySelector(".gradient")) {
      const gradient = el.querySelector(".gradient");
      const words = value.trim().split(/\s+/);

      if (words.length > 2) {
        const accent = words.splice(-4).join(" ");
        el.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) node.textContent = "";
        });
        el.insertBefore(document.createTextNode(words.join(" ") + " "), gradient);
        gradient.textContent = accent;
      } else {
        gradient.textContent = value;
      }
    } else {
      el.textContent = value;
    }
  });
  const socialBox = document.getElementById("contactSocialLinks");
  if (socialBox) {
    const entries = [
      ["telegram", "Telegram"],
      ["whatsapp", "WhatsApp"],
      ["x", "X"],
      ["linkedin", "LinkedIn"],
      ["facebook", "Facebook"],
      ["youtube", "YouTube"]
    ];

    const socialIcons = {
      telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#229ED9" d="M21.7 3.3 18.6 20c-.2 1.2-.9 1.5-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.3L6 13.5l-5-1.6c-1.1-.3-1.1-1.1.2-1.6L20.7 2c.9-.3 1.6.2 1 1.3Z"/></svg>',
      whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#25D366" stroke-width="1.8" d="M20.3 11.7a8.3 8.3 0 0 1-12.2 7.4L3 20.3l1.3-4.9a8.3 8.3 0 1 1 16-3.7Z"/><path fill="#25D366" d="M8.2 6.9c-.3-.7-.6-.7-.9-.7h-.7c-.2 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.1s1.3 3.6 1.5 3.9c.2.2 2.5 4 6.2 5.4 3.1 1.2 3.7 1 4.4.9.7-.1 2.2-.9 2.5-1.8.3-.9.3-1.6.2-1.8-.1-.2-.4-.3-.8-.5l-2.5-1.2c-.3-.1-.6-.2-.8.2-.2.4-1 1.2-1.2 1.5-.2.2-.4.3-.8.1-.4-.2-1.6-.6-3-1.9-1.1-1-1.8-2.2-2-2.6-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.6.1-.2 0-.5 0-.7Z" transform="translate(2 0) scale(.83)"/></svg>',
      x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 1.2h3.7l-8.1 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9Zm-1.3 19.5h2L6.5 3.2H4.3Z"/></svg>',
      linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0A66C2" d="M20.4 2H3.6C2.7 2 2 2.7 2 3.6v16.8c0 .9.7 1.6 1.6 1.6h16.8c.9 0 1.6-.7 1.6-1.6V3.6c0-.9-.7-1.6-1.6-1.6ZM8 18H5V9h3ZM6.5 7.8a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4ZM19 18h-3v-4.4c0-1.1 0-2.5-1.5-2.5s-1.7 1.2-1.7 2.4V18h-3V9h2.9v1.2h.1a3.2 3.2 0 0 1 2.8-1.5c3 0 3.5 2 3.5 4.5Z"/></svg>',
      facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0866FF" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.3c0-3 1.8-4.7 4.5-4.7 1.3 0 2.6.2 2.6.2v2.9h-1.5c-1.5 0-2 .9-2 1.9V12H17l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12Z"/></svg>',
      youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0033" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z"/><path fill="#fff" d="m9.6 15.6 6.3-3.6-6.3-3.6Z"/></svg>'
    };
    const safeSocialUrl = (key, raw) => {
      let value = String(raw || "").trim();
      if (!value || value === "#") return "";

      if (key === "whatsapp" && /^\+?[\d\s().-]+$/.test(value)) {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) return "";
        value = "https://wa.me/" + digits;
      }

      try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") return "";
        if (key === "telegram" && !/(^|\.)t\.me$|(^|\.)telegram\.me$/i.test(url.hostname)) return "";
        if (key === "whatsapp" && !/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/i.test(url.hostname)) return "";
        if (key === "x" && !/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(url.hostname)) return "";
        if (key === "linkedin" && !/(^|\.)linkedin\.com$/i.test(url.hostname)) return "";
        if (key === "facebook" && !/(^|\.)facebook\.com$|(^|\.)fb\.com$/i.test(url.hostname)) return "";
        if (key === "youtube" && !/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) return "";
        return url.href;
      } catch {
        return "";
      }
    };

    socialBox.replaceChildren();
    entries.forEach(([key, label]) => {
      const href = safeSocialUrl(key, profile[key]);
      if (!href) return;

      const link = document.createElement("a");
      link.className = "contact-social-link";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", label);
      link.title = label;
      link.innerHTML = socialIcons[key];

      socialBox.appendChild(link);
    });

    socialBox.parentElement.hidden = socialBox.children.length === 0;
  }

  document.title = profile.name ? profile.name + " | Computer Science Portfolio" : document.title;
  const meta = document.querySelector('meta[name="description"]');
  if (meta && profile.bio) meta.setAttribute("content", profile.bio);

  const featured = document.getElementById("featuredProjects");
  if (featured) featured.innerHTML = (data.projects || []).filter(x => x.featured).slice(0, 3).map(projectCard).join("");
  const projects = document.getElementById("projectsGrid");
  if (projects) {
    const items = data.projects || [];
    const filtersContainer = document.getElementById("projectFilters")
      || document.querySelector(".filters");

    if (filtersContainer) {
      const activeButton = filtersContainer.querySelector(".filter.active");
      const previousSelection = activeButton
        ? (activeButton.dataset.category || activeButton.textContent.trim())
        : "All";

      const categoryMap = new Map();
      items.forEach(project => {
        const category = String(project.category || "Other").trim() || "Other";
        const key = category.toLocaleLowerCase();
        if (!categoryMap.has(key)) categoryMap.set(key, category);
      });

      const selections = ["All", ...Array.from(categoryMap.values())
        .sort((a, b) => a.localeCompare(b))];

      filtersContainer.replaceChildren();
      selections.forEach(category => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "filter";
        button.textContent = category;
        button.dataset.category = category;
        button.setAttribute("aria-pressed", "false");
        filtersContainer.appendChild(button);
      });

      const selected = selections.find(category =>
        category.toLocaleLowerCase() === String(previousSelection).toLocaleLowerCase()
      ) || "All";

      const renderFilteredProjects = selectedCategory => {
        filtersContainer.querySelectorAll(".filter").forEach(button => {
          const active = (button.dataset.category || button.textContent.trim()) === selectedCategory;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });

        const matches = filterProjects(items, selectedCategory);
        projects.innerHTML = matches.map(projectCard).join("")
          || emptyState("No projects match this filter yet.");
      };

      filtersContainer.querySelectorAll(".filter").forEach(button => {
        button.addEventListener("click", () => {
          renderFilteredProjects(button.dataset.category || button.textContent.trim());
        });
      });

      renderFilteredProjects(selected);
    } else {
      projects.innerHTML = items.map(projectCard).join("")
        || emptyState("No projects added yet.");
    }
  }
  const portfolio = document.getElementById("portfolioGrid");
  if (portfolio) {
    const items = data.portfolio || [];
    const filtersContainer = document.getElementById("portfolioFilters");

    if (filtersContainer) {
      const oldActive = filtersContainer.querySelector(".filter.active");
      const previousSelection = oldActive
        ? (oldActive.dataset.category || oldActive.textContent.trim())
        : "All";

      const categoryMap = new Map();
      items.forEach(item => {
        const category = String(item.category || "Other").trim() || "Other";
        const key = category.toLocaleLowerCase();
        if (!categoryMap.has(key)) categoryMap.set(key, category);
      });

      const selections = ["All", ...Array.from(categoryMap.values())
        .sort((a, b) => a.localeCompare(b))];

      filtersContainer.replaceChildren();

      selections.forEach(category => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "filter";
        button.textContent = category;
        button.dataset.category = category;
        button.setAttribute("aria-pressed", "false");
        filtersContainer.appendChild(button);
      });

      const selected = selections.find(category =>
        category.toLocaleLowerCase() === String(previousSelection).toLocaleLowerCase()
      ) || "All";

      const renderFilteredPortfolio = selectedCategory => {
        filtersContainer.querySelectorAll(".filter").forEach(button => {
          const active = (button.dataset.category || button.textContent.trim()) === selectedCategory;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });

        const matches = filterProjects(items, selectedCategory);
        portfolio.innerHTML = matches.map(portfolioCard).join("")
          || emptyState("No portfolio items match this filter yet.");
      };

      filtersContainer.querySelectorAll(".filter").forEach(button => {
        button.addEventListener("click", () => {
          renderFilteredPortfolio(button.dataset.category || button.textContent.trim());
        });
      });

      renderFilteredPortfolio(selected);
    } else {
      portfolio.innerHTML = items.map(portfolioCard).join("")
        || emptyState("No portfolio items yet.");
    }
  }
  const services = document.getElementById("servicesGrid");
  if (services) {
  const serviceItems = (data.services || []).map(serviceCard).join("");
  services.innerHTML = serviceItems || `
    <div class="card service-empty-state">
      <div class="icon" aria-hidden="true">✦</div>
      <h2>Services Coming Soon</h2>
      <p>I'm preparing useful services to help bring your ideas to life.</p>
      <a class="btn primary" href="contact.html">Contact Me →</a>
    </div>`;
}
  const skills = document.getElementById("skillsGrid");
  if (skills) skills.innerHTML = (data.skills || []).map(skillCard).join("") || emptyState("No skills added yet.");
  const blog = document.getElementById("blogGrid");
  if (blog) {
  const posts = (data.posts || []).filter(p => p && p.title);
  blog.innerHTML = posts.map(blogCard).join("") || `
    <article class="card blog-empty-state">
      <span class="eyebrow">NEW ARTICLES ON THE WAY</span>
      <h2>Articles Coming Soon</h2>
      <p>I'm preparing practical technology insights, programming tips, and lessons from my projects.</p>
      <a class="btn primary" href="contact.html">Get in Touch →</a>
    </article>`;
}

  const stats = document.getElementById("projectCount");
  if (stats) stats.textContent = `${(data.projects || []).length}+`;
  const skillCount = document.getElementById("skillCount");
  if (skillCount) skillCount.textContent = `${(data.skills || []).length}+`;
}

function filterProjects(projects, selected) {
  const term = String(selected || "All").trim().toLocaleLowerCase();
  if (term === "all") return projects;

  return projects.filter(project => {
    const category = String(project.category || "Other").trim() || "Other";
    return category.toLocaleLowerCase() === term;
  });
}

function projectCard(p) {
  const title = escapeHTML(p.title || "Untitled project");
  const img = p.image
    ? `<img src="${escapeHTML(p.image)}" alt="${title}" loading="lazy">`
    : `<span>${escapeHTML(p.category || "PROJECT")}</span>`;

  return `<article class="card project-card">
    <h3 class="project-title">${title}</h3>
    <div class="project-img">${img}</div>
    <p>${escapeHTML(p.description || "")}</p>
    <div class="tags">${(p.tech || []).map(t => `<span>${escapeHTML(t)}</span>`).join("")}</div>
    <div class="actions">
      <a class="btn small" href="${escapeHTML(p.demo || "#")}" target="_blank" rel="noopener">Demo</a>
      <a class="btn small ghost" href="${escapeHTML(p.github || "#")}" target="_blank" rel="noopener">Code</a>
    </div>
  </article>`;
}
function portfolioCard(p) {
  const title = escapeHTML(p.title || "Untitled portfolio item");
  const category = String(p.category || "Other").trim() || "Other";
  const image = p.image
    ? `<img src="${escapeHTML(p.image)}" alt="${title}" loading="lazy">`
    : `<span>${escapeHTML(category)}</span>`;

  return `<article class="card project-card portfolio-card">
    <h3 class="project-title">${title}</h3>
    <div class="project-img">${image}</div>
    <p>${escapeHTML(p.description || "")}</p>
    <div class="tags"><span>${escapeHTML(category)}</span></div>
    <div class="actions">
      <a class="btn small" href="${escapeHTML(p.link || "#")}" target="_blank" rel="noopener">View project</a>
    </div>
  </article>`;
}
function serviceCard(s) {
 const icon = serviceIconFor(s.title, s.description, s.category);
 return `<article class="card service-card"><div class="icon" aria-hidden="true">${escapeHTML(icon)}</div><h3>${escapeHTML(s.title || "")}</h3><p>${escapeHTML(s.description || "")}</p><div class="actions"><a class="btn primary small" href="contact.html">Contact Me →</a></div></article>`;
}
function serviceIconFor(title, description, category) {
 const text = `${String(category || "")} ${String(title || "")} ${String(description || "")}`.toLowerCase();
 const rules = [
  [/\b(video|editing|editor|reel|shorts|film|cinema|motion)\b/, "\u{1F3AC}"],
  [/\b(design|graphic|graphics|logo|branding|brand|illustration|visual)\b/, "\u{1F3A8}"],
  [/\b(translation|translator|language|localization|localisation)\b/, "\u6587"],
  [/\b(writing|writer|copywriting|copywriter|content writing|script)\b/, "\u270D\uFE0F"],
  [/\b(marketing|seo|social media|advertising|campaign|promotion)\b/, "\u{1F4E3}"],
  [/\b(analytics|data analysis|dashboard|reporting|statistics|database|sql|mysql)\b/, "\u{1F4CA}"],
  [/\b(security|cybersecurity|privacy|protection)\b/, "\u{1F512}"],
  [/\b(mobile|android|ios|app development|application)\b/, "\u{1F4F1}"],
  [/\b(web|website|development|developer|programming|software|coding|computer|api)\b/, "\u{1F4BB}"]
 ];
 for (const [pattern, icon] of rules) {
  if (pattern.test(text)) return icon;
 }
 return "\u2726";
}
function skillIconFor(skill) {
 const name = String(skill && skill.name || "").toLowerCase();
 const rules = [
  [/\b(html|css|javascript|typescript|react|frontend|front-end|web)\b/, "\u{1F310}"],
  [/\b(python)\b/, "\u{1F40D}"],
  [/\b(java)\b/, "\u2615"],
  [/\b(sql|database|mysql|postgres|supabase)\b/, "\u{1F5C4}\uFE0F"],
  [/\b(node|node\.js|nodejs|api|backend|back-end)\b/, "\u{1F4BB}"],
  [/\b(git|github|version control)\b/, "\u{1F419}"],
  [/\b(c\+\+|c#|c sharp|programming|coding|algorithm)\b/, "\u{1F4BB}"],
  [/\b(security|cybersecurity|privacy)\b/, "\u{1F512}"],
  [/\b(ai|artificial intelligence|machine learning|ml|data science)\b/, "\u{1F9E0}"],
  [/\b(linux|windows|operating system|network)\b/, "\u{1F5A5}\uFE0F"]
 ];
 for (const [pattern, icon] of rules) {
  if (pattern.test(name)) return icon;
 }
 return "\u2726";
}
function skillCard(s) {
 const n = Math.min(100, Math.max(0, Number(s.level) || 0));
 const name = escapeHTML(s && s.name || "");
 const icon = skillIconFor(s);
 return `<article class="card skill-card">
   <div class="skill-card-top">
     <span class="skill-card-icon" aria-hidden="true">${icon}</span>
     <span class="skill-level">${n}%</span>
   </div>
   <h3 class="skill-card-name">${name}</h3>
   <div class="skill-progress" role="progressbar" aria-label="${name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n}">
     <span style="--skill-level:${n}%"></span>
   </div>
 </article>`;
}
function blogCard(p) {
 const content = String(p.content || "");
 const words = content.trim() ? content.trim().split(/\s+/).length : 0;
 const readingTime = Math.max(1, Math.ceil(words / 200));
 const category = p.category || "Technology";
 return `<article class="card blog-card">
   <div class="blog-card-meta"><span class="blog-category">${escapeHTML(category)}</span><time>${escapeHTML(p.date || "")}</time></div>
   <h3>${escapeHTML(p.title || "")}</h3>
   <p class="blog-excerpt">${escapeHTML(p.excerpt || "")}</p>
   <div class="blog-card-footer">
     <span class="blog-reading-time">${readingTime} min read</span>
     <details class="blog-preview"><summary>Read preview</summary><p>${escapeHTML(content)}</p></details>
   </div>
 </article>`;
}

function emptyState(message) { return `<div class="card"><p>${escapeHTML(message)}</p></div>`; }
