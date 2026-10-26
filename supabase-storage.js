"use strict";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);

function getConfig() {
  const rawUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "portfolio-uploads";

  if (!rawUrl || !secretKey) {
    throw new Error("Supabase Storage configuration is missing.");
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

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Supabase URL configuration is invalid.");
  }

  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(bucket)) {
    throw new Error("Supabase Storage bucket name is invalid.");
  }

  return {
    baseUrl: parsed.origin,
    secretKey,
    bucket
  };
}

async function uploadImage(filename, data, contentType) {
  if (
    typeof filename !== "string" ||
    !/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/i.test(filename)
  ) {
    throw new Error("Invalid upload filename.");
  }

  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error("Invalid image data.");
  }

  if (!ALLOWED_TYPES.has(contentType)) {
    throw new Error("Unsupported image type.");
  }

  const { baseUrl, secretKey, bucket } = getConfig();
  const objectPath = `${encodeURIComponent(bucket)}/${encodeURIComponent(filename)}`;

  let response;

  try {
    response = await fetch(
      `${baseUrl}/storage/v1/object/${objectPath}`,
      {
        method: "POST",
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": contentType,
          "x-upsert": "false"
        },
        body: data,
        signal: AbortSignal.timeout(15000)
      }
    );
  } catch {
    throw new Error("Supabase Storage upload request failed.");
  }

  if (!response.ok) {
    // Do not expose response bodies or credentials in application errors.
    throw new Error(`Supabase Storage upload failed (HTTP ${response.status}).`);
  }

  return {
    filename,
    url: `${baseUrl}/storage/v1/object/public/${objectPath}`
  };
}

async function deleteImageByUrl(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl) return false;

  const { baseUrl, secretKey, bucket } = getConfig();

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return false;
  }

  if (
    parsed.origin !== baseUrl ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    return false;
  }

  const prefix = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`;

  if (!parsed.pathname.startsWith(prefix)) return false;

  const encodedFilename = parsed.pathname.slice(prefix.length);

  if (!encodedFilename || encodedFilename.includes("/")) return false;

  let filename;
  try {
    filename = decodeURIComponent(encodedFilename);
  } catch {
    return false;
  }

  if (!/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/i.test(filename)) {
    return false;
  }

  let response;

  try {
    response = await fetch(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(filename)}`,
      {
        method: "DELETE",
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`
        },
        signal: AbortSignal.timeout(15000)
      }
    );
  } catch {
    throw new Error("Supabase Storage delete request failed.");
  }

  if (response.status === 404) return true;

  if (!response.ok) {
    throw new Error(`Supabase Storage delete failed (HTTP ${response.status}).`);
  }

  return true;
}
module.exports = Object.freeze({
  uploadImage,
  deleteImageByUrl
});