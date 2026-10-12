
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const base = "http://127.0.0.1:3199";
const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "portfolio-test-")
);

function passwordHash(password, salt) {
  return [
    "scrypt",
    salt,
    crypto.scryptSync(password, salt, 64).toString("hex")
  ].join("$");
}

let child;

function req(method, requestPath, body, cookie, csrf) {
  return new Promise((resolve, reject) => {
    const url = new URL(base + requestPath);

    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          Origin: base,
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
              }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(csrf ? { "X-CSRF-Token": csrf } : {})
        }
      },
      response => {
        let responseBody = "";

        response.on("data", chunk => {
          responseBody += chunk;
        });

        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: responseBody
          });
        });
      }
    );

    request.on("error", reject);

    if (body) request.write(body);
    request.end();
  });
}

async function waitForServer() {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("server start timeout"));
    }, 5000);

    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });

    child.stdout.on("data", data => {
      if (String(data).includes("3199")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.stderr.on("data", data => {
      // Drain server error output to prevent the child process
      // from blocking if the error stream becomes full.
      void data;
    });

    child.once("exit", code => {
      clearTimeout(timeout);
      reject(
        new Error(`test server exited before startup (code ${code})`)
      );
    });
  });
}

(async () => {
  try {
    child = spawn(
      process.execPath,
      [path.join(__dirname, "server.js")],
      {
        cwd: __dirname,
        env: {
          ...process.env,
          NODE_ENV: "production",
          PORT: "3199",
          DATA_FILE: path.join(TEST_DIR, "db.json"),
          UPLOAD_DIR: path.join(TEST_DIR, "uploads"),
          ADMIN_USER: "admin",
          ADMIN_PASSWORD_HASH: passwordHash(
            "TestPass_123!",
            "test-salt-portfolio"
          )
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    await waitForServer();

    const pages = [
      "/",
      "/index.html",
      "/about.html",
      "/skills.html",
      "/projects.html",
      "/portfolio.html",
      "/services.html",
      "/resume.html",
      "/blog.html",
      "/contact.html",
      "/admin.html"
    ];

    for (const page of pages) {
      const response = await req("GET", page);

      if (response.status !== 200) {
        throw new Error(`${page} returned ${response.status}`);
      }
    }

    let response = await req("GET", "/api/health");

    if (response.status !== 200) {
      throw new Error("health failed");
    }

    response = await req("GET", "/api/data");

    if (response.status !== 200) {
      throw new Error("data failed");
    }

    const original = JSON.parse(response.body).profile;

    response = await req(
      "POST",
      "/api/login",
      JSON.stringify({
        username: "admin",
        password: "TestPass_123!"
      })
    );

    if (response.status !== 200) {
      throw new Error(
        `login failed: HTTP ${response.status}; response=${response.body}`
      );
    }

    const setCookie = (response.headers["set-cookie"] || [])[0] || "";
    const cookie = setCookie.split(";")[0];

    if (!cookie) {
      throw new Error("session cookie missing");
    }

    if (!/;\s*Secure(?:;|$)/i.test(setCookie)) {
      throw new Error("Secure cookie flag missing in production mode");
    }

    response = await req("GET", "/api/csrf", null, cookie);

    if (response.status !== 200) {
      throw new Error("csrf token failed");
    }

    const csrf = JSON.parse(response.body).token;
    const changed = {
      ...original,
      name: "V5 Integration Test"
    };

    response = await req(
      "PUT",
      "/api/profile",
      JSON.stringify(changed),
      cookie,
      csrf
    );

    if (response.status !== 200) {
      throw new Error("profile save failed");
    }

    response = await req("GET", "/api/data");

    const after = JSON.parse(response.body);

    if (after.profile.name !== "V5 Integration Test") {
      throw new Error("profile persistence failed");
    }

    response = await req(
      "PUT",
      "/api/profile",
      JSON.stringify(original),
      cookie,
      csrf
    );

    if (response.status !== 200) {
      throw new Error("profile restore failed");
    }

    response = await req(
      "POST",
      "/api/contact",
      JSON.stringify({
        name: "Test User",
        email: "test@example.com",
        subject: "Smoke test",
        message: "Integration test"
      })
    );

    if (response.status !== 201) {
      throw new Error("contact failed");
    }

    response = await req(
      "GET",
      "/api/messages",
      null,
      cookie,
      csrf
    );

    if (
      response.status !== 200 ||
      !JSON.parse(response.body).some(
        message => message.email === "test@example.com"
      )
    ) {
      throw new Error("message inbox failed");
    }

    console.log("ALL TESTS PASSED");
  } catch (error) {
    console.error("TEST FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill();
      await exited;
    }

    fs.rmSync(TEST_DIR, {
      recursive: true,
      force: true
    });
  }
})();