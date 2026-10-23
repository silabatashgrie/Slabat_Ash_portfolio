
/*
  Computer Science Personal Portfolio - Full Stack Server
  Node.js built-ins only. No external npm dependencies required.
*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

const ROOT = __dirname;
const STORAGE_BACKEND = process.env.DATA_FILE
  ? "json"
  : String(process.env.STORAGE_BACKEND || "json").toLowerCase();

if (!["json", "supabase"].includes(STORAGE_BACKEND)) {
  console.error("Startup refused: invalid STORAGE_BACKEND.");
  process.exit(1);
}

const supabaseStore = STORAGE_BACKEND === "supabase"
  ? require("./supabase-store")
  : null;

const DATA_FILE = path.resolve(
  process.env.DATA_FILE || path.join(ROOT, "data", "db.json")
);
const UPLOAD_DIR = path.resolve(
  process.env.UPLOAD_DIR || path.join(ROOT, "uploads")
);
const PORT = Number(process.env.PORT || 3000);
const COOKIE_SECURE =
  process.env.NODE_ENV === "production" ||
  process.env.COOKIE_SECURE === "true";
const SESSION_TTL = 1000 * 60 * 60 * 8;

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_CREDENTIALS_FILE = path.resolve(
  process.env.ADMIN_CREDENTIALS_FILE ||
    path.join(ROOT, "data", "admin-credentials.json")
);
let ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

if (fs.existsSync(ADMIN_CREDENTIALS_FILE)) {
  try {
    const savedCredentials = JSON.parse(
      fs.readFileSync(ADMIN_CREDENTIALS_FILE, "utf8")
    );

    if (
      savedCredentials &&
      typeof savedCredentials.passwordHash === "string" &&
      /^scrypt\$[^$]+\$[a-f0-9]{128}$/i.test(
        savedCredentials.passwordHash
      )
    ) {
      ADMIN_PASSWORD_HASH = savedCredentials.passwordHash;
    } else {
      throw new Error("Invalid saved administrator credentials format.");
    }
  } catch (error) {
    console.error(
      "Startup refused: administrator credentials file is invalid.",
      error.message
    );
    process.exit(1);
  }
}

const sessions = new Map();
const rateLimits = new Map();

const RATE_LIMIT_MAX_KEYS = 5000;
const RATE_LIMIT_CLEANUP_INTERVAL = 100;
let rateLimitCalls = 0;

if (
  !ADMIN_USER ||
  !ADMIN_PASSWORD_HASH
) {
  console.error(
    "Startup refused: set ADMIN_USER and ADMIN_PASSWORD_HASH."
  );
  process.exit(1);
}

if (
  !Number.isInteger(PORT) ||
  PORT < 1 ||
  PORT > 65535
) {
  console.error("Startup refused: invalid PORT.");
  process.exit(1);
}

if (STORAGE_BACKEND === "json" && !fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, {
    recursive: true
  });
}

if (STORAGE_BACKEND === "json" && !fs.existsSync(DATA_FILE)) {
  const example = path.join(
    path.dirname(DATA_FILE),
    "db.example.json"
  );

  if (fs.existsSync(example)) {
    fs.copyFileSync(example, DATA_FILE);
  } else {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          profile: {},
          skills: [],
          projects: [],
          portfolio: [],
          services: [],
          posts: [],
          messages: []
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

/*
  Database protection:
  - Do not silently replace unreadable data with an empty object.
  - Reject malformed JSON.
  - Write to a temporary file before replacing the database.
*/

function readDB() {
  let raw;

  try {
    raw = fs.readFileSync(DATA_FILE, "utf8");
  } catch (error) {
    throw new Error(
      `Database read failed: ${error.message}`
    );
  }

  let db;

  try {
    db = JSON.parse(raw);
  } catch {
    throw new Error(
      "Database contains invalid JSON; refusing to overwrite it."
    );
  }

  if (
    db === null ||
    typeof db !== "object" ||
    Array.isArray(db)
  ) {
    throw new Error(
      "Database must contain a valid JSON object."
    );
  }

  return db;
}

function writeDB(db) {
  if (
    db === null ||
    typeof db !== "object" ||
    Array.isArray(db)
  ) {
    throw new Error(
      "Refusing to write invalid database data."
    );
  }

  const serialized = JSON.stringify(db, null, 2);

  if (typeof serialized !== "string") {
    throw new Error("Database serialization failed.");
  }

  const tempFile =
    `${DATA_FILE}.${process.pid}.` +
    `${crypto.randomBytes(6).toString("hex")}.tmp`;

  try {
    fs.writeFileSync(tempFile, serialized, {
      encoding: "utf8",
      flag: "wx"
    });

    // The temporary file is in the same directory.
    // Test this replacement behavior on the target OS.
    fs.renameSync(tempFile, DATA_FILE);
  } catch (error) {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // The temporary file may not exist.
    }

    throw new Error(
      `Database write failed: ${error.message}`
    );
  }
}

function json(res, status, data, extra = {}) {
  if (res.writableEnded || res.destroyed) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extra
  });

  res.end(JSON.stringify(data));
}

function html(
  res,
  status,
  body,
  contentType = "text/html; charset=utf-8"
) {
  if (res.writableEnded || res.destroyed) return;

  res.writeHead(status, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff"
  });

  res.end(body);
}

/*
  Safely parse cookies.
  Malformed percent-encoding must not crash a request.
*/

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";

  for (const item of raw.split(";")) {
    const i = item.indexOf("=");

    if (i <= 0) continue;

    const key = item.slice(0, i).trim();
    const value = item.slice(i + 1).trim();

    try {
      out[key] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values.
    }
  }

  return out;
}

function sameOrigin(req) {
  const host = req.headers.host;

  if (!host) return false;

  const origin = req.headers.origin;

  if (origin) {
    try {
      const parsed = new URL(origin);

      return (
        (parsed.protocol === "http:" ||
          parsed.protocol === "https:") &&
        parsed.host === host
      );
    } catch {
      return false;
    }
  }

  const referer = req.headers.referer;

  if (referer) {
    try {
      const parsed = new URL(referer);

      return (
        (parsed.protocol === "http:" ||
          parsed.protocol === "https:") &&
        parsed.host === host
      );
    } catch {
      return false;
    }
  }

  return false;
}

function isAuth(req) {
  const sid = parseCookies(req).sid;
  const session = sid && sessions.get(sid);

  if (!session || session.expires <= Date.now()) {
    if (sid) sessions.delete(sid);
    return false;
  }

  return true;
}

function requireAuth(req, res) {
  const sid = parseCookies(req).sid;
  const session = sid && sessions.get(sid);

  if (!isAuth(req)) {
    json(res, 401, {
      error: "Unauthorized"
    });
    return false;
  }

  if (!sameOrigin(req)) {
    json(res, 403, {
      error: "Cross-origin request blocked"
    });
    return false;
  }

  if (
    !session ||
    req.headers["x-csrf-token"] !== session.csrf
  ) {
    json(res, 403, {
      error: "Invalid CSRF token"
    });
    return false;
  }

  return true;
}

function hashPassword(password, salt) {
  return crypto
    .scryptSync(password, salt, 64)
    .toString("hex");
}

function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");

  if (
    parts.length !== 3 ||
    parts[0] !== "scrypt" ||
    !parts[1] ||
    !/^[a-f0-9]{128}$/i.test(parts[2])
  ) {
    return false;
  }

  try {
    const actual = Buffer.from(
      hashPassword(password, parts[1]),
      "hex"
    );

    const expected = Buffer.from(parts[2], "hex");

    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

/*
  Rate limiting:
  - Expire old request timestamps.
  - Periodically clean stale entries.
  - Limit the number of stored keys.

  This is an in-memory limit for a single server process.
*/

function rateLimit(req, key, max, windowMs) {
  const now = Date.now();
  const ip = req.socket.remoteAddress || "unknown";
  const id = `${key}:${ip}`;

  let record = rateLimits.get(id);

  if (!record) {
    record = {
      hits: [],
      lastSeen: now
    };
  }

  record.hits = record.hits.filter(
    timestamp => now - timestamp < windowMs
  );

  record.hits.push(now);
  record.lastSeen = now;

  rateLimits.set(id, record);

  rateLimitCalls += 1;

  if (
    rateLimitCalls % RATE_LIMIT_CLEANUP_INTERVAL === 0 ||
    rateLimits.size > RATE_LIMIT_MAX_KEYS
  ) {
    for (const [storedId, stored] of rateLimits) {
      stored.hits = stored.hits.filter(
        timestamp => now - timestamp < 15 * 60 * 1000
      );

      if (stored.hits.length === 0) {
        rateLimits.delete(storedId);
      }
    }

    // Bound memory use if many distinct IPs are seen.
    while (rateLimits.size > RATE_LIMIT_MAX_KEYS) {
      const oldestKey = rateLimits.keys().next().value;

      if (oldestKey === undefined) break;

      rateLimits.delete(oldestKey);
    }
  }

  return record.hits.length <= max;
}

function safeName(name) {
  return path
    .basename(name)
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extFor(type, name) {
  const extensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };

  return (
    extensions[type] ||
    path.extname(name).toLowerCase() ||
    ".bin"
  );
}

function serveStatic(req, res) {
  let pathname;

  try {
    pathname = decodeURIComponent(
      url.parse(req.url).pathname
    );
  } catch {
    return html(res, 400, "Bad request");
  }

  if (pathname === "/") {
    pathname = "/index.html";
  }

  if (
    pathname.includes("..") ||
    pathname === "/db.json" ||
    pathname.startsWith("/data/")
  ) {
    return html(res, 404, "Not found");
  }

  const file = path.resolve(ROOT, `.${pathname}`);

  if (
    !file.startsWith(ROOT + path.sep) ||
    file === ROOT
  ) {
    return html(res, 403, "Forbidden");
  }

  fs.stat(file, (error, stats) => {
    if (error || !stats.isFile()) {
      return html(res, 404, "Not found");
    }

    const ext = path.extname(file).toLowerCase();

    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml"
    };

    res.writeHead(200, {
      "Content-Type":
        types[ext] || "application/octet-stream",
      "Cache-Control":
        ext === ".html"
          ? "no-cache"
          : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy":
        "strict-origin-when-cross-origin",
      "Content-Security-Policy":
        "default-src 'self'; " +
        "img-src 'self' data:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'"
    });

    const stream = fs.createReadStream(file);

    stream.on("error", () => {
      if (!res.headersSent) {
        html(res, 500, "Internal server error");
      } else if (!res.destroyed) {
        res.destroy();
      }
    });

    stream.pipe(res);
  });
}

function body(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    req.on("data", chunk => {
      if (done) return;

      size += chunk.length;

      if (size > limit) {
        done = true;
        const error = new Error("Payload too large");
        error.statusCode = 413;
        reject(error);
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });

    req.on("error", error => {
      if (!done) {
        done = true;
        reject(error);
      }
    });

    req.on("aborted", () => {
      if (!done) {
        done = true;
        reject(new Error("Request aborted"));
      }
    });
  });
}

function jsonBody(req) {
  return body(req).then(buffer => {
    try {
      return JSON.parse(buffer.toString("utf8") || "{}");
    } catch {
      const error = new Error("Invalid JSON body"); error.statusCode = 400; throw error;
    }
  });
}

function handleApiError(res, error) {
  const status =
    error && (error.statusCode === 400 || error.statusCode === 413)
      ? error.statusCode
      : 500;

  if (status === 500) {
    console.error(
      "API operation failed:",
      error && error.message ? error.message : "Unknown error"
    );
  }

  const message =
    status === 400 ? "Invalid request" :
    status === 413 ? "Payload too large" :
    "Server error";

  return json(res, status, { error: message });
}
function id(prefix) {
  return (
    prefix +
    Date.now().toString(36) +
    crypto.randomBytes(4).toString("hex")
  );
}

function validCollection(key) {
  return [
    "skills",
    "projects",
    "portfolio",
    "services",
    "posts"
  ].includes(key);
}

function normalizeServiceTitle(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function readSupabasePublicData() {
  const [profiles, skills, projects, portfolio, services, posts] =
    await Promise.all([
      supabaseStore.list("profile"),
      supabaseStore.list("skills"),
      supabaseStore.list("projects"),
      supabaseStore.list("portfolio"),
      supabaseStore.list("services"),
      supabaseStore.list("posts")
    ]);

  return {
    profile: profiles.find(row => row.id === "main")?.data || {},
    skills: skills.map(row => row.data),
    projects: projects.map(row => row.data),
    portfolio: portfolio.map(row => row.data),
    services: services.map(row => row.data),
    posts: posts.map(row => row.data)
  };
}
async function api(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (
    pathname === "/api/health" &&
    req.method === "GET"
  ) {
    return json(res, 200, {
      ok: true,
      service: "portfolio-server"
    });
  }

  if (
    pathname === "/api/csrf" &&
    req.method === "GET"
  ) {
    if (!isAuth(req)) {
      return json(res, 401, {
        error: "Unauthorized"
      });
    }

    const sid = parseCookies(req).sid;
    const session = sessions.get(sid);

    return json(res, 200, {
      token: session.csrf
    });
  }

  if (
    pathname === "/api/login" &&
    req.method === "POST"
  ) {
    if (!sameOrigin(req)) {
      return json(res, 403, {
        error: "Cross-origin request blocked"
      });
    }

    if (!rateLimit(req, "login", 5, 15 * 60 * 1000)) {
      return json(res, 429, {
        error: "Too many login attempts. Try again later."
      });
    }

    try {
      const data = await jsonBody(req);

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
      ) {
        return json(res, 400, {
          error: "Invalid request"
        });
      }

      if (
        data.username !== ADMIN_USER ||
        !verifyPassword(
          String(data.password || ""),
          ADMIN_PASSWORD_HASH
        )
      ) {
        return json(res, 401, {
          error: "Invalid credentials"
        });
      }

      const sid = crypto.randomBytes(32).toString("hex");
      const csrf = crypto.randomBytes(32).toString("hex");

      sessions.set(sid, {
        expires: Date.now() + SESSION_TTL,
        csrf
      });

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie":
          `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; ` +
          `Max-Age=${SESSION_TTL / 1000}` +
          (COOKIE_SECURE ? "; Secure" : ""),
        "Cache-Control": "no-store"
      });


      return res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      console.error("Login route diagnostic:", error && error.stack ? error.stack : error);
      if (error && error.statusCode === 413) {
        return json(res, 413, {
          error: "Payload too large"
        });
      }

      return json(res, 400, {
        error: "Invalid request"
      });
    }
  }

  if (
    pathname === "/api/change-password" &&
    req.method === "POST"
  ) {
    if (!requireAuth(req, res)) return;

    if (!rateLimit(req, "change-password", 5, 15 * 60 * 1000)) {
      return json(res, 429, {
        error: "Too many password-change attempts. Try again later."
      });
    }

    let data;
    try {
      data = await jsonBody(req);
    } catch (error) {
      return json(res, error.statusCode === 413 ? 413 : 400, {
        error: error.statusCode === 413 ? "Payload too large" : "Invalid request"
      });
    }

    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.currentPassword !== "string" ||
      typeof data.newPassword !== "string" ||
      typeof data.confirmPassword !== "string"
    ) {
      return json(res, 400, {
        error: "Provide the current password, new password, and confirmation."
      });
    }

    if (!verifyPassword(data.currentPassword, ADMIN_PASSWORD_HASH)) {
      return json(res, 401, {
        error: "Current password is incorrect."
      });
    }

    if (data.newPassword.length < 12 || data.newPassword.length > 128) {
      return json(res, 400, {
        error: "The new password must be 12â€“128 characters long."
      });
    }

    const passwordMeetsStrength =
      /[A-Z]/.test(data.newPassword) &&
      /[a-z]/.test(data.newPassword) &&
      /[0-9]/.test(data.newPassword) &&
      /[^A-Za-z0-9\s]/.test(data.newPassword);

    if (!passwordMeetsStrength) {
      return json(res, 400, {
        error: "Use at least one uppercase letter, one lowercase letter, one number, and one special character."
      });
    }

    if (data.newPassword !== data.confirmPassword) {
      return json(res, 400, {
        error: "New password and confirmation do not match."
      });
    }

    if (data.newPassword === data.currentPassword) {
      return json(res, 400, {
        error: "Choose a password different from the current password."
      });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const newHash = `scrypt$${salt}$${hashPassword(data.newPassword, salt)}`;
    const tempFile = `${ADMIN_CREDENTIALS_FILE}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    const backupFile = `${ADMIN_CREDENTIALS_FILE}.${crypto.randomBytes(8).toString("hex")}.bak`;
    let movedOriginal = false;

    try {
      fs.mkdirSync(path.dirname(ADMIN_CREDENTIALS_FILE), { recursive: true });

      fs.writeFileSync(
        tempFile,
        JSON.stringify({
          passwordHash: newHash,
          updatedAt: new Date().toISOString()
        }, null, 2) + "\n",
        { encoding: "utf8", flag: "wx", mode: 0o600 }
      );

      if (fs.existsSync(ADMIN_CREDENTIALS_FILE)) {
        fs.renameSync(ADMIN_CREDENTIALS_FILE, backupFile);
        movedOriginal = true;
      }

      try {
        fs.renameSync(tempFile, ADMIN_CREDENTIALS_FILE);
      } catch (replaceError) {
        if (movedOriginal && fs.existsSync(backupFile)) {
          fs.renameSync(backupFile, ADMIN_CREDENTIALS_FILE);
          movedOriginal = false;
        }
        throw replaceError;
      }

      ADMIN_PASSWORD_HASH = newHash;
      sessions.clear();

      if (movedOriginal && fs.existsSync(backupFile)) {
        try {
          fs.unlinkSync(backupFile);
        } catch {}
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie":
          "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" +
          (COOKIE_SECURE ? "; Secure" : ""),
        "Cache-Control": "no-store"
      });

      return res.end(JSON.stringify({
        ok: true,
        message: "Password changed. Please sign in again."
      }));
    } catch (error) {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}

      console.error("Password change persistence failed:", error.message);

      return json(res, 500, {
        error: "Could not save the new password. No password change was confirmed."
      });
    }
  }
  if (
    pathname === "/api/logout" &&
    req.method === "POST"
  ) {
    if (!requireAuth(req, res)) return;

    const sid = parseCookies(req).sid;

    if (sid) sessions.delete(sid);

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie":
        "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" +
        (COOKIE_SECURE ? "; Secure" : ""),
      "Cache-Control": "no-store"
    });

    return res.end(JSON.stringify({ ok: true }));
  }

  if (
    pathname === "/api/me" &&
    req.method === "GET"
  ) {
    return json(res, 200, {
      authenticated: isAuth(req)
    });
  }

  const mutating = [
    "POST",
    "PUT",
    "DELETE",
    "PATCH"
  ].includes(req.method);

  if (
    mutating &&
    pathname !== "/api/login" &&
    !sameOrigin(req)
  ) {
    return json(res, 403, {
      error: "Cross-origin request blocked"
    });
  }

  let db = STORAGE_BACKEND === "json" ? readDB() : null;
  if (
    pathname === "/api/data" &&
    req.method === "GET"
  ) {
    if (STORAGE_BACKEND === "supabase") {
      return json(res, 200, await readSupabasePublicData());
    }

    const publicData = { ...db };
    delete publicData.messages;

    return json(res, 200, publicData);
  }

  if (
    pathname === "/api/data" &&
    req.method === "PUT"
  ) {
    if (!requireAuth(req, res)) return;

    try {
      const incoming = await jsonBody(req);
      db = STORAGE_BACKEND === "json" ? readDB() : null;
      if (
        !incoming ||
        typeof incoming !== "object" ||
        Array.isArray(incoming)
      ) {
        return json(res, 400, {
          error: "Invalid request body"
        });
      }

      const allowed = [
        "profile",
        "skills",
        "projects",
        "portfolio",
        "services",
        "posts"
      ];

      const unsupported = Object.keys(incoming).filter(
        key => !allowed.includes(key)
      );

      if (unsupported.length > 0) {
        return json(res, 400, {
          error: "Unsupported fields",
          fields: unsupported
        });
      }

      if (
        incoming.profile !== undefined &&
        (
          incoming.profile === null ||
          typeof incoming.profile !== "object" ||
          Array.isArray(incoming.profile)
        )
      ) {
        return json(res, 400, {
          error: "Profile must be an object"
        });
      }

      const collections = [
        "skills",
        "projects",
        "portfolio",
        "services",
        "posts"
      ];

      for (const key of collections) {
        if (incoming[key] !== undefined && !Array.isArray(incoming[key])) {
          return json(res, 400, {
            error: `${key} must be an array`
          });
        }
      }

      if (STORAGE_BACKEND === "supabase") {
        await supabaseStore.applyData(incoming);
        return json(res, 200, {
          ok: true,
          data: await readSupabasePublicData()
        });
      }

      for (const key of allowed) {
        if (incoming[key] !== undefined) {
          db[key] = incoming[key];
        }
      }

      writeDB(db);

      return json(res, 200, {
        ok: true,
        data: db
      });
    } catch (error) { return handleApiError(res, error); }
  }

  // SUPABASE_COLLECTION_CRUD_V1
  const match = pathname.match(
    /^\/api\/(skills|projects|portfolio|services|posts)(?:\/([^/]+))?$/
  );

  if (match) {
    if (!requireAuth(req, res)) return;

    const key = match[1];
    const itemId = match[2];

    if (!validCollection(key)) {
      return json(res, 404, {
        error: "API route not found"
      });
    }

    if (STORAGE_BACKEND === "supabase") {
      try {
        const rows = await supabaseStore.list(key);
        const items = rows.map(row => row.data);

        if (req.method === "GET" && !itemId) {
          return json(res, 200, items);
        }

        if (req.method === "POST" && !itemId) {
          const item = await jsonBody(req);

          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return json(res, 400, { error: "Invalid item" });
          }

          if (key === "projects") {
            const title = typeof item.title === "string" ? item.title.trim() : "";
            if (!title) return json(res, 400, { error: "Project title is required" });
            if (title.length > 100) {
              return json(res, 400, { error: "Project title must be 100 characters or fewer" });
            }
            item.title = title;
          }

          if (key === "services") {
            if (typeof item.title !== "string") {
              return json(res, 400, { error: "Service title is required" });
            }
            item.title = item.title.trim();
            const titleKey = normalizeServiceTitle(item.title);
            if (!titleKey) return json(res, 400, { error: "Service title is required" });
            if (items.some(existing => normalizeServiceTitle(existing.title) === titleKey)) {
              return json(res, 409, { error: "A service with this title already exists" });
            }
          }

          item.id = item.id || id(key.slice(0, 2));

          const record = {
            id: item.id,
            data: item
          };

          if (["skills", "projects", "portfolio", "services", "posts"].includes(key)) {
            record.position = rows.reduce(
              (max, row) => Math.max(max, Number(row.position) || 0),
              0
            ) + 1;
          }

          const created = await supabaseStore.insert(key, record);
          if (!created) {
            return json(res, 500, { error: "Could not create item" });
          }

          return json(res, 201, created.data);
        }

        if (itemId && req.method === "GET") {
          let decodedId;
          try {
            decodedId = decodeURIComponent(itemId);
          } catch {
            return json(res, 400, { error: "Invalid item ID" });
          }
          const record = await supabaseStore.get(key, decodedId);
          if (!record) return json(res, 404, { error: "Not found" });
          return json(res, 200, record.data);
        }

        if (itemId && (req.method === "PUT" || req.method === "DELETE")) {
          let decodedId;
          try {
            decodedId = decodeURIComponent(itemId);
          } catch {
            return json(res, 400, { error: "Invalid item ID" });
          }

          if (!decodedId || decodedId.length > 200) {
            return json(res, 400, { error: "Invalid item ID" });
          }

          const current = await supabaseStore.get(key, decodedId);
          if (!current) return json(res, 404, { error: "Not found" });

          if (req.method === "DELETE") {
            const deleted = await supabaseStore.remove(key, decodedId);
            if (!deleted) return json(res, 404, { error: "Not found" });
            return json(res, 200, { ok: true });
          }

          const item = await jsonBody(req);
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return json(res, 400, { error: "Invalid item" });
          }

          if (key === "projects") {
            const title = typeof item.title === "string" ? item.title.trim() : "";
            if (!title) return json(res, 400, { error: "Project title is required" });
            if (title.length > 100) {
              return json(res, 400, { error: "Project title must be 100 characters or fewer" });
            }
            item.title = title;
          }

          if (key === "services") {
            if (typeof item.title !== "string") {
              return json(res, 400, { error: "Service title is required" });
            }
            item.title = item.title.trim();
            const titleKey = normalizeServiceTitle(item.title);
            if (!titleKey) return json(res, 400, { error: "Service title is required" });
            if (items.some(existing =>
              existing.id !== decodedId &&
              normalizeServiceTitle(existing.title) === titleKey
            )) {
              return json(res, 409, { error: "A service with this title already exists" });
            }
          }

          item.id = decodedId;
          const updated = await supabaseStore.update(key, decodedId, item);
          if (!updated) return json(res, 404, { error: "Not found" });
          return json(res, 200, updated.data);
        }

        return json(res, 405, { error: "Method not allowed" });
      } catch (error) {
        return handleApiError(res, error);
      }
    }

    db[key] = Array.isArray(db[key]) ? db[key] : [];

    if (req.method === "GET" && !itemId) {
      return json(res, 200, db[key]);
    }

    if (req.method === "POST" && !itemId) {
      try {
        const item = await jsonBody(req);
        db = readDB();
        db[key] = Array.isArray(db[key]) ? db[key] : [];

        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return json(res, 400, { error: "Invalid item" });
        }

        if (key === "projects") {
          const title = typeof item.title === "string" ? item.title.trim() : "";
          if (!title) return json(res, 400, { error: "Project title is required" });
          if (title.length > 100) {
            return json(res, 400, { error: "Project title must be 100 characters or fewer" });
          }
          item.title = title;
        }

        if (key === "services") {
          if (typeof item.title !== "string") {
            return json(res, 400, { error: "Service title is required" });
          }
          item.title = item.title.trim();
          const titleKey = normalizeServiceTitle(item.title);
          if (!titleKey) return json(res, 400, { error: "Service title is required" });
          if (db.services.some(existing => normalizeServiceTitle(existing.title) === titleKey)) {
            return json(res, 409, { error: "A service with this title already exists" });
          }
        }

        item.id = item.id || id(key.slice(0, 2));
        db[key].push(item);
        writeDB(db);
        return json(res, 201, item);
      } catch (error) { return handleApiError(res, error); }
    }

    if (itemId && (req.method === "PUT" || req.method === "DELETE")) {
      let decodedId;
      try {
        decodedId = decodeURIComponent(itemId);
      } catch {
        return json(res, 400, { error: "Invalid item ID" });
      }

      if (!decodedId || decodedId.length > 200) {
        return json(res, 400, { error: "Invalid item ID" });
      }

      const index = db[key].findIndex(item => item.id === decodedId);
      if (index < 0) return json(res, 404, { error: "Not found" });

      if (req.method === "DELETE") {
        db[key].splice(index, 1);
        writeDB(db);
        return json(res, 200, { ok: true });
      }

      try {
        const item = await jsonBody(req);
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return json(res, 400, { error: "Invalid item" });
        }

        if (key === "projects") {
          const title = typeof item.title === "string" ? item.title.trim() : "";
          if (!title) return json(res, 400, { error: "Project title is required" });
          if (title.length > 100) {
            return json(res, 400, { error: "Project title must be 100 characters or fewer" });
          }
          item.title = title;
        }

        db = readDB();
        db[key] = Array.isArray(db[key]) ? db[key] : [];

        if (key === "services") {
          if (typeof item.title !== "string") {
            return json(res, 400, { error: "Service title is required" });
          }
          item.title = item.title.trim();
          const titleKey = normalizeServiceTitle(item.title);
          if (!titleKey) return json(res, 400, { error: "Service title is required" });
          if (db.services.some(existing =>
            existing.id !== decodedId &&
            normalizeServiceTitle(existing.title) === titleKey
          )) {
            return json(res, 409, { error: "A service with this title already exists" });
          }
        }

        const currentIndex = db[key].findIndex(existing => existing.id === decodedId);
        if (currentIndex < 0) return json(res, 404, { error: "Not found" });

        item.id = decodedId;
        db[key][currentIndex] = item;
        writeDB(db);
        return json(res, 200, item);
      } catch (error) { return handleApiError(res, error); }
    }

    if (itemId && req.method === "GET") {
      const decodedId = decodeURIComponent(itemId);
      const item = db[key].find(existing => existing.id === decodedId);
      return item ? json(res, 200, item) : json(res, 404, { error: "Not found" });
    }
  }

  if (
    pathname === "/api/profile" &&
    req.method === "PUT"
  ) {
    if (!requireAuth(req, res)) return;

    try {
      const profile = await jsonBody(req);

      if (
        !profile ||
        typeof profile !== "object" ||
        Array.isArray(profile)
      ) {
        return json(res, 400, {
          error: "Invalid profile"
        });
      }

      if (STORAGE_BACKEND === "supabase") {
        const existing = await supabaseStore.get("profile", "main");
        if (existing) {
          await supabaseStore.update("profile", "main", profile);
        } else {
          await supabaseStore.insert("profile", {
            id: "main",
            data: profile
          });
        }

        return json(res, 200, profile);
      }

      db = readDB();
      db.profile = profile;
      writeDB(db);

      return json(res, 200, db.profile);
    } catch (error) { return handleApiError(res, error); }
  }

  if (
    pathname === "/api/contact" &&
    req.method === "POST"
  ) {
    if (!rateLimit(req, "contact", 10, 15 * 60 * 1000)) {
      return json(res, 429, {
        error: "Too many messages. Please try again later."
      });
    }

    try {
      const data = await jsonBody(req);

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
      ) {
        return json(res, 400, {
          error: "Invalid request"
        });
      }

      if (
        !data.name ||
        !data.email ||
        !data.message
      ) {
        return json(res, 400, {
          error: "Name, email and message are required"
        });
      }

      const message = {
        id: id("msg"),
        name: String(data.name).slice(0, 120),
        email: String(data.email).slice(0, 200),
        subject: String(data.subject || "").slice(0, 200),
        message: String(data.message).slice(0, 5000),
        createdAt: new Date().toISOString(),
        status: "new"
      };

      if (STORAGE_BACKEND === "supabase") {
        await supabaseStore.insert("messages", {
          id: message.id,
          data: message
        });
      } else {
        db = readDB();
        db.messages = Array.isArray(db.messages) ? db.messages : [];
        db.messages.push(message);
        writeDB(db);
      }

      return json(res, 201, {
        ok: true,
        message: "Message received"
      });
    } catch (error) { return handleApiError(res, error); }
  }

  if (
    pathname === "/api/messages" &&
    req.method === "GET"
  ) {
    if (!requireAuth(req, res)) return;

    if (STORAGE_BACKEND === "supabase") {
      const rows = await supabaseStore.list("messages");
      return json(res, 200, rows.map(row => row.data).filter(Boolean));
    }

    return json(res, 200, db.messages || []);
  }

  const messageReadMatch = pathname.match(/^\/api\/messages\/([^/]+)\/read$/);

  if (messageReadMatch && req.method === "POST") {
    if (!requireAuth(req, res)) return;

    let messageId;
    try {
      messageId = decodeURIComponent(messageReadMatch[1]);
    } catch {
      return json(res, 400, { error: "Invalid message ID" });
    }

    if (!messageId || messageId.length > 200) {
      return json(res, 400, { error: "Invalid message ID" });
    }

    if (STORAGE_BACKEND === "supabase") {
      const row = await supabaseStore.get("messages", messageId);
      if (!row || !row.data || typeof row.data !== "object") {
        return json(res, 404, { error: "Message not found" });
      }

      const message = row.data;
      if (message.status === "new") {
        const updated = { ...message, status: "read" };
        await supabaseStore.update("messages", messageId, updated);
        message.status = "read";
      }

      return json(res, 200, {
        ok: true,
        id: message.id,
        status: message.status
      });
    }

    if (!Array.isArray(db.messages)) {
      return json(res, 404, { error: "Message not found" });
    }

    const message = db.messages.find(item => item.id === messageId);
    if (!message) {
      return json(res, 404, { error: "Message not found" });
    }

    if (message.status === "new") {
      message.status = "read";
      writeDB(db);
    }

    return json(res, 200, {
      ok: true,
      id: message.id,
      status: message.status
    });
  }

  if (
    pathname === "/api/upload" &&
    req.method === "POST"
  ) {
    if (!requireAuth(req, res)) return;

    const contentType = req.headers["content-type"] || "";

    const match = contentType.match(
      /^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i
    );

    if (!match) {
      return json(res, 400, {
        error: "Use multipart/form-data"
      });
    }

    try {
      const buffer = await body(req, 8 * 1024 * 1024);
      const boundary = Buffer.from(
        "--" + (match[1] || match[2])
      );
      const parts = [];

      let start = 0;

      while (
        (start = buffer.indexOf(boundary, start)) !== -1
      ) {
        const next = buffer.indexOf(
          boundary,
          start + boundary.length
        );

        if (next === -1) break;

        const part = buffer.slice(
          start + boundary.length + 2,
          next - 2
        );

        start = next;

        const separator = part.indexOf(
          Buffer.from("\r\n\r\n")
        );

        if (separator < 0) continue;

        const headers = part
          .slice(0, separator)
          .toString("utf8");

        const data = part.slice(separator + 4);

        const disposition = headers.match(
          /Content-Disposition:.*name="([^"]+)".*filename="([^"]*)"/i
        );

        const typeMatch = headers.match(
          /Content-Type:\s*([^\r\n]+)/i
        );

        const type = typeMatch
          ? typeMatch[1].trim().toLowerCase()
          : "";

        if (disposition && disposition[2]) {
          parts.push({
            name: disposition[1],
            filename: disposition[2],
            type,
            data
          });
        }
      }

      const file = parts[0];

      if (!file) {
        return json(res, 400, {
          error: "No file"
        });
      }

      const signatures = [
        ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff])],
        ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
        ["image/gif", Buffer.from("GIF8")]
      ];

      const allowed = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
      ];

      if (!allowed.includes(file.type)) {
        return json(res, 415, {
          error: "Only JPG, PNG, WEBP and GIF are allowed"
        });
      }

      const signatureOK =
        file.type === "image/webp"
          ? (
              file.data.length >= 12 &&
              file.data.subarray(0, 4).toString("ascii") === "RIFF" &&
              file.data.subarray(8, 12).toString("ascii") === "WEBP"
            )
          : signatures.some(([type, signature]) => (
              type === file.type &&
              file.data
                .subarray(0, signature.length)
                .equals(signature)
            ));

      if (!signatureOK) {
        return json(res, 415, {
          error: "Invalid image file"
        });
      }

      const filename =
        crypto.randomBytes(12).toString("hex") +
        extFor(file.type, safeName(file.filename));

      fs.writeFileSync(
        path.join(UPLOAD_DIR, filename),
        file.data,
        { flag: "wx" }
      );

      return json(res, 201, {
        ok: true,
        url: "/uploads/" + filename,
        filename
      });
    } catch (error) { return handleApiError(res, error); }
  }

  return json(res, 404, {
    error: "API route not found"
  });
}

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith("/api/")) {
    return api(req, res).catch(error => {
      // Keep internal error details out of the HTTP response.
      console.error("API request failed:", error.message);

      if (!res.headersSent && !res.destroyed) {
        json(res, 500, {
          error: "Server error"
        });
      } else if (!res.writableEnded && !res.destroyed) {
        res.destroy();
      }
    });
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(
    `Portfolio server running at http://localhost:${PORT}`
  );
});
