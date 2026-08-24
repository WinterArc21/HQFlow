// Test fixture route for POST /api/upload.

import { saveAsset } from "../../../lib/persistence";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Handles `POST /api/upload`: validates the multipart file, then stores its metadata. */
export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return jsonResponse({ error: "A 'file' field is required." }, 400);
  }
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return jsonResponse({ error: `Unsupported content type '${file.type}'.` }, 415);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: "File exceeds the 10MB upload limit." }, 413);
  }

  const asset = await saveAsset({ fileName: file.name, contentType: file.type, sizeBytes: file.size });
  return jsonResponse({ asset }, 201);
}
