// Deploy with verify_jwt=false. This endpoint has its own narrow, expiring
// capability authorization; publishable API keys are not user authentication.
// The service-role credential is read only from the server runtime environment.
const MAX_FILE = 10 * 1024 * 1024;
const MAX_REQUEST = 12 * 1024 * 1024;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
type Operation = {
  protocolVersion: number;
  operationId: string;
  action: string;
  entityId: string;
  ownerId: string;
  deviceId: string;
  changes: { animalId: string; mime: string };
};
type Failure = { code?: string; message?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function conflict(operation: Operation, code: string) {
  return json({
    protocolVersion: 1,
    operationId: operation.operationId,
    status: "conflict",
    revision: null,
    serverReceivedAt: new Date().toISOString(),
    code,
  });
}
function validMagic(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") {
    const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    return text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  }
  return false;
}
async function boundedBody(request: Request | Response, limit = MAX_REQUEST) {
  const announced = request.headers.get("content-length");
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > limit)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
function hashHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

export async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return json({ code: "MULTIPART_REQUIRED" }, 415);
  }
  const apiUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiUrl || !serviceKey) return json({ code: "BACKGROUND_GATEWAY_UNAVAILABLE" }, 503);
  try {
    const body = await boundedBody(request);
    if (!body) return json({ code: "UPLOAD_TOO_LARGE" }, 413);
    const form = await new Request(request.url, {
      method: "POST", headers: request.headers, body,
    }).formData();
    const keys = Array.from(form.keys());
    if (keys.length !== 3 || !["capability", "operation", "file"].every(key => keys.includes(key))) {
      return json({ code: "INVALID_MULTIPART" }, 400);
    }
    const token = form.get("capability");
    const source = form.get("operation");
    const file = form.get("file");
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return json({ code: "PT401", message: "BACKGROUND_INVALID" }, 401);
    if (typeof source !== "string" || source.length > 524288 || !(file instanceof File)) {
      return json({ code: "INVALID_UPLOAD" }, 400);
    }
    let operation: Operation;
    try {
      operation = JSON.parse(source);
    } catch {
      return json({ code: "INVALID_OPERATION" }, 400);
    }
    if (!operation || operation.action !== "photo.create" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operation.operationId) ||
        !operation.changes || operation.changes.mime !== file.type ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size < 1 || file.size > MAX_FILE) return json({ code: "INVALID_UPLOAD" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validMagic(bytes, file.type)) return json({ code: "INVALID_IMAGE_BYTES" }, 400);
    const sha256 = hashHex(await crypto.subtle.digest("SHA-256", bytes));
    const authHeaders = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
    const rpc = async (name: string, payload: unknown) => {
      const response = await fetch(apiUrl + "/rest/v1/rpc/" + name, {
        method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20000), redirect: "error",
      });
      const result = await response.json();
      return { response, result };
    };
    const authorized = await rpc("sync_authorize_background_upload", {
      p_capability: token, p_operation: operation, p_size: bytes.length, p_sha256: sha256,
    });
    if (!authorized.response.ok) {
      const error = authorized.result as Failure;
      if (authorized.response.status === 409 && error.message === "BACKGROUND_UPLOAD_CONFLICT") {
        return conflict(operation, "BACKGROUND_UPLOAD_CONFLICT");
      }
      if (authorized.response.status === 409 && error.message === "BACKGROUND_OPERATION_ID_REUSED") {
        return conflict(operation, "OPERATION_ID_REUSED");
      }
      if (authorized.response.status === 409 && error.message === "BACKGROUND_ANIMAL_NOT_AVAILABLE") {
        return conflict(operation, "ANIMAL_NOT_AVAILABLE");
      }
      return json({ code: error.code || "BACKGROUND_AUTHORIZATION_FAILED", message: error.message || "Authorization failed" }, authorized.response.status);
    }
    const expectedPath = operation.ownerId + "/" + operation.changes.animalId + "/" + operation.entityId;
    const verified = authorized.result;
    if (verified.bucket !== "animal-photos" || verified.path !== expectedPath ||
        verified.mime !== file.type || verified.bytes !== bytes.length || verified.sha256 !== sha256) {
      return json({ code: "BACKGROUND_AUTHORIZATION_FAILED" }, 502);
    }
    // The path only comes from the SQL authorization result. No caller-selected
    // bucket, URL, download target, redirect, upsert or physical deletion exists.
    const objectUrl = apiUrl + "/storage/v1/object/animal-photos/" + verified.path.split("/").map(encodeURIComponent).join("/");
    const upload = await fetch(objectUrl, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": file.type, "x-upsert": "false" },
      body: bytes, signal: AbortSignal.timeout(20000), redirect: "error",
    });
    if (!upload.ok) {
      const failure = await upload.json().catch(() => ({}));
      const duplicate = upload.status === 409 ||
        failure.error === "Duplicate" || failure.code === "Duplicate" ||
        /already exists|duplicate/i.test(String(failure.message || ""));
      if (!duplicate) return json({ code: "STORAGE_UNAVAILABLE" }, 502);
      const existing = await fetch(objectUrl, {
        headers: authHeaders, signal: AbortSignal.timeout(20000), redirect: "error",
      });
      if (!existing.ok) return json({ code: "STORAGE_UNAVAILABLE" }, 502);
      const original = await boundedBody(existing, bytes.length);
      if (!original || original.length !== bytes.length ||
          hashHex(await crypto.subtle.digest("SHA-256", original)) !== sha256 ||
          existing.headers.get("content-type")?.split(";")[0] !== file.type) {
        return conflict(operation, "PHOTO_BYTES_CONFLICT");
      }
    }
    // Authorization is rechecked after the asynchronous upload. Revocation or
    // session expiry can leave an unlinked original, never an unauthorized row.
    const applied = await rpc("sync_apply_background_operation", {
      p_capability: token, p_operation: operation,
    });
    if (!applied.response.ok) {
      const error = applied.result as Failure;
      return json({ code: error.code || "BACKGROUND_DELIVERY_FAILED", message: error.message || "Delivery failed" }, applied.response.status);
    }
    return json(applied.result);
  } catch {
    // Do not log the request, capability, Auth secrets, image or SQL response.
    return json({ code: "BACKGROUND_GATEWAY_UNAVAILABLE" }, 503);
  }
}

Deno.serve(handle);
