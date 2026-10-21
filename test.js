
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
      process.stderr.write(`[test server stderr] ${data}`);
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
          ADMIN_CREDENTIALS_FILE: path.join(TEST_DIR, "admin-credentials.json"),
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

    // /api/data must reject invalid shapes and unsupported fields
    // without changing the stored data.
    response = await req("GET", "/api/data");
    if (response.status !== 200) {
      throw new Error("baseline data fetch failed");
    }
    const dataBaseline = JSON.parse(response.body);

    const invalidDataBodies = [
      {
        label: "profile array",
        body: { profile: [] }
      },
      {
        label: "projects object",
        body: { projects: {} }
      },
      {
        label: "unsupported messages field",
        body: { messages: [] }
      }
    ];

    for (const item of invalidDataBodies) {
      response = await req(
        "PUT",
        "/api/data",
        JSON.stringify(item.body),
        cookie,
        csrf
      );

      if (response.status !== 400) {
        throw new Error(
          `${item.label} should return 400, got ${response.status}`
        );
      }

      response = await req("GET", "/api/data");
      if (response.status !== 200) {
        throw new Error(
          `data fetch after ${item.label} failed`
        );
      }

      const currentData = JSON.parse(response.body);
      if (JSON.stringify(currentData) !== JSON.stringify(dataBaseline)) {
        throw new Error(
          `data changed after rejected request: ${item.label}`
        );
      }
    }

    console.log("PASS: /api/data validation and data-preservation tests");
    // Project title validation: POST rejects blank and oversized titles.
    response = await req(
      "POST",
      "/api/projects",
      JSON.stringify({ title: "   ", description: "Validation test" }),
      cookie,
      csrf
    );

    if (response.status !== 400) {
      throw new Error(`blank project title should return 400, got ${response.status}`);
    }

    response = await req(
      "POST",
      "/api/projects",
      JSON.stringify({ title: "P".repeat(101), description: "Validation test" }),
      cookie,
      csrf
    );

    if (response.status !== 400) {
      throw new Error(`oversized project title should return 400, got ${response.status}`);
    }

    // A valid title is trimmed and can be saved.
    response = await req(
      "POST",
      "/api/projects",
      JSON.stringify({
        title: "  Equb Management System  ",
        description: "Project title validation test",
        tech: [],
        demo: "#",
        github: "#",
        featured: false,
        image: ""
      }),
      cookie,
      csrf
    );

    if (response.status !== 201) {
      throw new Error(`valid project creation failed: HTTP ${response.status}; ${response.body}`);
    }

    const savedProject = JSON.parse(response.body);

    if (savedProject.title !== "Equb Management System") {
      throw new Error("project title was not trimmed");
    }

    // PUT must enforce the same title rules.
    response = await req(
      "PUT",
      `/api/projects/${encodeURIComponent(savedProject.id)}`,
      JSON.stringify({ ...savedProject, title: "   " }),
      cookie,
      csrf
    );

    if (response.status !== 400) {
      throw new Error(`blank project title update should return 400, got ${response.status}`);
    }

    response = await req(
      "PUT",
      `/api/projects/${encodeURIComponent(savedProject.id)}`,
      JSON.stringify({ ...savedProject, title: "P".repeat(101) }),
      cookie,
      csrf
    );

    if (response.status !== 400) {
      throw new Error(`oversized project title update should return 400, got ${response.status}`);
    }
    // Service CRUD and validation tests.
    response = await req(
      "POST",
      "/api/services",
      JSON.stringify({
        title: "  Website Development  ",
        description: "Initial service test"
      }),
      cookie,
      csrf
    );

    if (response.status !== 201) {
      throw new Error(
        `service creation failed: HTTP ${response.status}; ${response.body}`
      );
    }

    const savedService = JSON.parse(response.body);

    if (savedService.title !== "Website Development") {
      throw new Error("service title was not trimmed");
    }

    if (!savedService.id) {
      throw new Error("created service has no ID");
    }

    // Blank service titles must be rejected.
    response = await req(
      "POST",
      "/api/services",
      JSON.stringify({
        title: "   ",
        description: "Invalid service"
      }),
      cookie,
      csrf
    );

    if (response.status !== 400) {
      throw new Error(
        `blank service title should return 400, got ${response.status}`
      );
    }

    // Duplicate titles must be rejected after normalization.
    response = await req(
      "POST",
      "/api/services",
      JSON.stringify({
        title: "  WEBSITE   DEVELOPMENT ",
        description: "Duplicate service test"
      }),
      cookie,
      csrf
    );

    if (response.status !== 409) {
      throw new Error(
        `duplicate service title should return 409, got ${response.status}`
      );
    }

    // Create a second service to test duplicate protection on update.
    response = await req(
      "POST",
      "/api/services",
      JSON.stringify({
        title: "Video Editing",
        description: "Second service test"
      }),
      cookie,
      csrf
    );

    if (response.status !== 201) {
      throw new Error(
        `second service creation failed: HTTP ${response.status}; ${response.body}`
      );
    }

    const secondService = JSON.parse(response.body);

    // Updating a service with its own title must be allowed.
    response = await req(
      "PUT",
      `/api/services/${encodeURIComponent(savedService.id)}`,
      JSON.stringify({
        ...savedService,
        description: "Updated service description"
      }),
      cookie,
      csrf
    );

    if (response.status !== 200) {
      throw new Error(
        `service update failed: HTTP ${response.status}; ${response.body}`
      );
    }

    const updatedService = JSON.parse(response.body);

    if (updatedService.description !== "Updated service description") {
      throw new Error("service description update was not saved");
    }

    // Updating to another service's title must be rejected.
    response = await req(
      "PUT",
      `/api/services/${encodeURIComponent(savedService.id)}`,
      JSON.stringify({
        ...updatedService,
        title: secondService.title
      }),
      cookie,
      csrf
    );

    if (response.status !== 409) {
      throw new Error(
        `duplicate service update should return 409, got ${response.status}`
      );
    }

    // Delete the test services.
    for (const service of [savedService, secondService]) {
      response = await req(
        "DELETE",
        `/api/services/${encodeURIComponent(service.id)}`,
        null,
        cookie,
        csrf
      );

      if (response.status !== 200) {
        throw new Error(
          `service deletion failed: HTTP ${response.status}; ${response.body}`
        );
      }
    }

    response = await req(
      "GET",
      "/api/services",
      null,
      cookie,
      csrf
    );

    if (
      response.status !== 200 ||
      JSON.parse(response.body).some(
        service =>
          service.id === savedService.id ||
          service.id === secondService.id
      )
    ) {
      throw new Error("deleted services are still present");
    }
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

    const concurrentContactResults = await Promise.all([
      req(
        "POST",
        "/api/contact",
        JSON.stringify({
          name: "Concurrent User A",
          email: "concurrent-a@example.com",
          subject: "Concurrent request test",
          message: "CONCURRENT_TEST_A"
        })
      ),
      req(
        "POST",
        "/api/contact",
        JSON.stringify({
          name: "Concurrent User B",
          email: "concurrent-b@example.com",
          subject: "Concurrent request test",
          message: "CONCURRENT_TEST_B"
        })
      )
    ]);

    if (concurrentContactResults.some(result => result.status !== 201)) {
      throw new Error(
        "concurrent contact requests failed: " +
        concurrentContactResults.map(result => result.status).join(", ")
      );
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

    const inboxMessages = JSON.parse(response.body);

    const concurrentMessageA = inboxMessages.some(
      message => message.email === "concurrent-a@example.com" &&
        message.message === "CONCURRENT_TEST_A"
    );
    const concurrentMessageB = inboxMessages.some(
      message => message.email === "concurrent-b@example.com" &&
        message.message === "CONCURRENT_TEST_B"
    );

    if (!concurrentMessageA || !concurrentMessageB) {
      throw new Error(
        "concurrent contact messages missing from inbox: " +
        `A=${concurrentMessageA}, B=${concurrentMessageB}`
      );
    }
    const testMessage = inboxMessages.find(
      message => message.email === "test@example.com"
    );

    if (!testMessage || !testMessage.id) {
      throw new Error("test message ID missing");
    }

    response = await req(
      "POST",
      "/api/messages/" + encodeURIComponent(testMessage.id) + "/read",
      null,
      cookie,
      csrf
    );

    const readResult = JSON.parse(response.body);
    if (response.status !== 200 || readResult.status !== "read") {
      throw new Error("message read API failed");
    }

    response = await req(
      "GET",
      "/api/messages",
      null,
      cookie,
      csrf
    );

    const persistedMessages = JSON.parse(response.body);
    const persistedMessage = persistedMessages.find(
      message => message.id === testMessage.id
    );
    if (response.status !== 200 || persistedMessage?.status !== "read") {
      throw new Error("message read persistence failed");
    }

    response = await req(
      "POST",
      "/api/messages/" + encodeURIComponent(testMessage.id) + "/read",
      null,
      cookie,
      "invalid-csrf-token"
    );
    if (response.status !== 403) {
      throw new Error("message read CSRF protection failed");
    }

    response = await req(
      "POST",
      "/api/messages/nonexistent-message-id/read",
      null,
      cookie,
      csrf
    );
    if (response.status !== 404) {
      throw new Error("missing message ID handling failed");
    }

    // PASSWORD_CHANGE_PERSISTENCE_TESTS
    const oldPassword = "TestPass_123!";
    const newPassword = "TestPass_456!Secure";

    // Wrong current password must be rejected.
    response = await req(
      "POST",
      "/api/change-password",
      JSON.stringify({
        currentPassword: "Wrong_Current_Password!",
        newPassword,
        confirmPassword: newPassword
      }),
      cookie,
      csrf
    );

    if (response.status !== 401) {
      throw new Error("wrong current password was not rejected");
    }

    // Confirmation mismatch must be rejected.
    response = await req(
      "POST",
      "/api/change-password",
      JSON.stringify({
        currentPassword: oldPassword,
        newPassword,
        confirmPassword: "Different_Confirmation!"
      }),
      cookie,
      csrf
    );

    if (response.status !== 400) {
      throw new Error("password confirmation mismatch was not rejected");
    }

    // Weak passwords must be rejected by the server.
    const weakPasswords = [
      "123456789012",
      "NoSpecial12345"
    ];

    for (const weakPassword of weakPasswords) {
      response = await req(
        "POST",
        "/api/change-password",
        JSON.stringify({
          currentPassword: oldPassword,
          newPassword: weakPassword,
          confirmPassword: weakPassword
        }),
        cookie,
        csrf
      );

      if (response.status !== 400) {
        throw new Error(
          `weak password was not rejected: ${JSON.stringify(weakPassword)}; HTTP ${response.status}`
        );
      }
    }

    // Create a second session to verify that all sessions are revoked.
    let secondLogin = await req(
      "POST",
      "/api/login",
      JSON.stringify({
        username: "admin",
        password: oldPassword
      })
    );

    if (secondLogin.status !== 200) {
      throw new Error("second session login failed");
    }

    const secondCookie =
      ((secondLogin.headers["set-cookie"] || [])[0] || "").split(";")[0];

    let secondCsrfResponse = await req(
      "GET",
      "/api/csrf",
      null,
      secondCookie
    );

    if (secondCsrfResponse.status !== 200) {
      throw new Error("second session CSRF setup failed");
    }

    const secondCsrf = JSON.parse(secondCsrfResponse.body).token;

    // Change the password using the original authenticated session.
    response = await req(
      "POST",
      "/api/change-password",
      JSON.stringify({
        currentPassword: oldPassword,
        newPassword,
        confirmPassword: newPassword
      }),
      cookie,
      csrf
    );

    if (response.status !== 200) {
      throw new Error(
        `password change failed: HTTP ${response.status}; ${response.body}`
      );
    }

    const changeResult = JSON.parse(response.body);

    if (changeResult.ok !== true) {
      throw new Error("password change did not report success");
    }

    // Both the original and second sessions must be invalid now.
    for (const oldSessionCookie of [cookie, secondCookie]) {
      const meResponse = await req(
        "GET",
        "/api/me",
        null,
        oldSessionCookie
      );

      if (
        meResponse.status !== 200 ||
        JSON.parse(meResponse.body).authenticated !== false
      ) {
        throw new Error("an old session remained authenticated after password change");
      }
    }

    // Credentials must be persisted as a hash, never plaintext.
    const credentialsPath = path.join(TEST_DIR, "admin-credentials.json");

    if (!fs.existsSync(credentialsPath)) {
      throw new Error("password credentials file was not persisted");
    }

    const savedCredentials = JSON.parse(
      fs.readFileSync(credentialsPath, "utf8")
    );

    if (
      typeof savedCredentials.passwordHash !== "string" ||
      !savedCredentials.passwordHash.startsWith("scrypt$") ||
      savedCredentials.passwordHash.includes(newPassword)
    ) {
      throw new Error("saved credentials are missing a valid password hash or contain plaintext");
    }

    // Stop the test server and restart it with the same isolated test folder.
    const previousChild = child;

    const previousExit = new Promise(resolve => {
      previousChild.once("exit", resolve);
    });

    previousChild.kill();
    await previousExit;

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
          ADMIN_CREDENTIALS_FILE: credentialsPath,
          ADMIN_USER: "admin",
          // The persisted credentials file must override this initial hash.
          ADMIN_PASSWORD_HASH: passwordHash(
            oldPassword,
            "test-salt-portfolio"
          )
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    await waitForServer();

    // Old password must fail after restart.
    response = await req(
      "POST",
      "/api/login",
      JSON.stringify({
        username: "admin",
        password: oldPassword
      })
    );

    if (response.status !== 401) {
      throw new Error("old password was accepted after server restart");
    }

    // New password must work after restart.
    response = await req(
      "POST",
      "/api/login",
      JSON.stringify({
        username: "admin",
        password: newPassword
      })
    );

    if (response.status !== 200) {
      throw new Error("new password did not survive server restart");
    }

    console.log("PASS: password change validation, session revocation, and restart persistence");
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
