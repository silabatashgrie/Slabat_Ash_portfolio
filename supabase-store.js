"use strict";

const TABLES = Object.freeze({
  profile: "portfolio_profile",
  skills: "portfolio_skills",
  projects: "portfolio_projects",
  portfolio: "portfolio_items",
  services: "portfolio_services",
  posts: "portfolio_posts",
  messages: "portfolio_messages"
});

const ORDERED_COLLECTIONS = new Set([
  "skills",
  "projects",
  "portfolio",
  "services",
  "posts"
]);

function getConfig() {
  const rawUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!rawUrl || !secretKey) {
    throw new Error("Supabase configuration is missing.");
  }

  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Supabase URL configuration is invalid.");
  }

  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    throw new Error("Supabase URL must use HTTPS.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Supabase URL must not contain credentials.");
  }

  return {
    baseUrl: parsed.origin,
    secretKey
  };
}

function getTable(collection) {
  const table = TABLES[collection];

  if (!table) {
    throw new Error("Unsupported Supabase collection.");
  }

  return table;
}

async function requestPath(path, options = {}) {
  const { baseUrl, secretKey } = getConfig();

  const headers = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    Accept: "application/json"
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";

    if (options.returnRepresentation !== false) {
      headers.Prefer = "return=representation";
    }
  }

  let response;

  try {
    response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new Error("Supabase request failed.");
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase request failed with status ${response.status}.`
    );
  }

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error("Supabase returned an invalid response.");
  }
}

function idQuery(id, collection) {
  if (
    typeof id !== "string" ||
    !id.trim() ||
    id.length > 200
  ) {
    throw new Error("A valid record ID is required.");
  }

  const select = ORDERED_COLLECTIONS.has(collection)
    ? "id,data,position"
    : "id,data";

  return `?id=eq.${encodeURIComponent(id)}&select=${select}`;
}

async function list(collection) {
  getTable(collection);

  const select = ORDERED_COLLECTIONS.has(collection)
    ? "id,data,position"
    : "id,data";

  const order = ORDERED_COLLECTIONS.has(collection)
    ? "&order=position.asc,id.asc"
    : "";

  return requestPath(
    `${getTable(collection)}?select=${select}${order}`
  );
}

async function get(collection, id) {
  const rows = await requestPath(
    `${getTable(collection)}${idQuery(id, collection)}&limit=1`
  );

  return rows && rows.length ? rows[0] : null;
}

async function insert(collection, record) {
  getTable(collection);

  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    typeof record.id !== "string" ||
    !record.id.trim() ||
    !Object.prototype.hasOwnProperty.call(record, "data")
  ) {
    throw new Error("A valid record with id and data is required.");
  }

  const body = {
    id: record.id,
    data: record.data
  };

  if (ORDERED_COLLECTIONS.has(collection)) {
    if (
      !Number.isInteger(record.position) ||
      record.position < 1
    ) {
      throw new Error("A valid collection position is required.");
    }

    body.position = record.position;
  }

  const select = ORDERED_COLLECTIONS.has(collection)
    ? "id,data,position"
    : "id,data";

  const rows = await requestPath(
    `${getTable(collection)}?select=${select}`,
    {
      method: "POST",
      body
    }
  );

  return rows && rows.length ? rows[0] : null;
}

async function update(collection, id, data) {
  getTable(collection);

  if (data === undefined) {
    throw new Error("Record data is required.");
  }

  const rows = await requestPath(
    `${getTable(collection)}${idQuery(id, collection)}`,
    {
      method: "PATCH",
      body: { data }
    }
  );

  return rows && rows.length ? rows[0] : null;
}

async function remove(collection, id) {
  const rows = await requestPath(
    `${getTable(collection)}${idQuery(id, collection)}`,
    {
      method: "DELETE"
    }
  );

  return rows && rows.length ? rows[0] : null;
}

async function applyData(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("A valid data payload is required.");
  }

  const allowed = new Set([
    "profile",
    "skills",
    "projects",
    "portfolio",
    "services",
    "posts"
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw new Error("Unsupported data payload field.");
    }
  }

  return requestPath("rpc/portfolio_apply_data", {
    method: "POST",
    body: { p_payload: payload },
    returnRepresentation: false
  });
}

module.exports = Object.freeze({
  TABLES,
  list,
  get,
  insert,
  update,
  remove,
  applyData
});
