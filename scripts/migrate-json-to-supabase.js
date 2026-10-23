"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "db.json");

const COLLECTIONS = [
  ["portfolio_profile", "profile"],
  ["portfolio_skills", "skills"],
  ["portfolio_projects", "projects"],
  ["portfolio_items", "portfolio"],
  ["portfolio_services", "services"],
  ["portfolio_posts", "posts"],
  ["portfolio_messages", "messages"]
];

function stop(message) {
  console.error("STOP: " + message);
  process.exitCode = 1;
}

function readLocalData() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const db = JSON.parse(raw);

  if (!db || typeof db !== "object" || Array.isArray(db)) {
    throw new Error("Local database must be a JSON object.");
  }

  const mapped = [];

  for (const [table, key] of COLLECTIONS) {
    let rows;

    if (key === "profile") {
      if (!db.profile || typeof db.profile !== "object" ||
          Array.isArray(db.profile)) {
        throw new Error("Profile must be a JSON object.");
      }
      rows = [{ id: "main", data: db.profile }];
    } else {
      if (!Array.isArray(db[key])) {
        throw new Error("Expected an array for " + key + ".");
      }
      rows = db[key].map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item) ||
            item.id === undefined || item.id === null ||
            String(item.id).trim() === "") {
          throw new Error("Invalid record ID in " + key + ".");
        }
        return { id: String(item.id), data: item };
      });
    }

    const ids = rows.map((row) => row.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Duplicate IDs found in " + key + ".");
    }

    for (const row of rows) {
      if (!row.data || typeof row.data !== "object" ||
          Array.isArray(row.data)) {
        throw new Error("Invalid record data in " + key + ".");
      }
    }

    mapped.push({ table, rows });
  }

  return mapped;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const baseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !secretKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SECRET_KEY is missing.");
  }

  const url = baseUrl.replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/i.test(url)) {
    throw new Error("SUPABASE_URL must be an HTTPS project URL.");
  }

  const headers = {
    apikey: secretKey,
    Authorization: "Bearer " + secretKey
  };

  const mapped = readLocalData();

  console.log("Mode: " + (execute ? "EXECUTE" : "DRY RUN"));
  console.log("Local database validated. Private message contents are hidden.");

  for (const { table, rows } of mapped) {
    const response = await fetch(
      url + "/rest/v1/" + table + "?select=id&limit=1",
      { headers }
    );

    if (!response.ok) {
      throw new Error("Preflight failed for " + table +
        " (HTTP " + response.status + "). No further writes attempted.");
    }

    const existing = await response.json();
    if (!Array.isArray(existing)) {
      throw new Error("Unexpected preflight response for " + table + ".");
    }

    if (existing.length > 0) {
      throw new Error(
        table + " is not empty. Refusing to overwrite or mix existing data."
      );
    }

    console.log(table + ": local records=" + rows.length +
      ", Supabase is empty");
  }

  if (!execute) {
    console.log("DRY RUN PASSED. No data was written.");
    console.log("Review the counts, then run with --execute to import.");
    return;
  }

  for (const { table, rows } of mapped) {
    if (rows.length === 0) continue;

    const response = await fetch(url + "/rest/v1/" + table, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(rows)
    });

    if (!response.ok) {
      throw new Error(
        "Insert failed for " + table + " (HTTP " + response.status +
        "). Import stopped; check table counts before retrying."
      );
    }

    console.log("Inserted " + rows.length + " records into " + table + ".");
  }

  for (const { table, rows } of mapped) {
    const response = await fetch(
      url + "/rest/v1/" + table + "?select=id",
      {
        headers: {
          ...headers,
          Prefer: "count=exact",
          Range: "0-0"
        }
      }
    );

    if (!response.ok) {
      throw new Error("Verification failed for " + table +
        " (HTTP " + response.status + ").");
    }

    const range = response.headers.get("content-range") || "";
    const match = range.match(/\/(\d+)$/);

    if (!match || Number(match[1]) !== rows.length) {
      throw new Error("Count verification failed for " + table +
        "; expected " + rows.length + ", received " +
        (match ? match[1] : "unknown") + ".");
    }

    console.log("Verified " + table + ": " + match[1] + " records.");
  }

  console.log("IMPORT AND COUNT VERIFICATION COMPLETED.");
}

main().catch((error) => {
  stop(error.message);
});
