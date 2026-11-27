import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// This verifies the gateway's transport decisions. The separate HTTP integration
// suite uses real Auth, SQL and Storage; no mock result substitutes for that gate.
const apiUrl = "http://127.0.0.1:54321";
const serviceKey = "server-only-test-secret";
const token = "a".repeat(64);
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const operation = {
  protocolVersion: 1, operationId: "60000000-0000-4000-8000-000000000001",
  ownerId: "10000000-0000-4000-8000-000000000001",
  deviceId: "70000000-0000-4000-8000-000000000001",
  entityId: "30000000-0000-4000-8000-000000000001", action: "photo.create",
  baseRevision: null, capturedAt: "2026-11-27T00:00:00Z",
  changes: { animalId: "20000000-0000-4000-8000-000000000001", name: "original.png", mime: "image/png" },
};
const receipt = { protocolVersion: 1, operationId: operation.operationId,
  status: "applied", revision: 1, serverReceivedAt: "2026-11-27T00:00:01Z", code: "OK" };
const path = `${operation.ownerId}/${operation.changes.animalId}/${operation.entityId}`;
const previousDeno = globalThis.Deno;
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: apiUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey })[key] }, serve() {} };
const source = stripTypeScriptTypes(readFileSync(new URL("../supabase/functions/sync-background-photo/index.ts", import.meta.url), "utf8"));
const { handle } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
test.after(() => { globalThis.Deno = previousDeno; });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const request = (content = bytes) => {
  const form = new FormData();
  form.set("capability", token);
  form.set("operation", JSON.stringify(operation));
  form.set("file", new File([content], "original.png", { type: "image/png" }));
  return new Request(apiUrl + "/functions/v1/sync-background-photo", { method: "POST", body: form });
};
const authorize = payload => reply({ bucket: "animal-photos", path, mime: "image/png", bytes: payload.p_size, sha256: payload.p_sha256 });

async function withFetch(implementation, run) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("photo gateway validates image and request bounds before server authority", async () => {
  await withFetch(() => { throw new Error("No server request permitted"); }, async () => {
    let response = await handle(request(new TextEncoder().encode("not an image")));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_IMAGE_BYTES");
    const tooLarge = request();
    tooLarge.headers.set("content-length", String(13 * 1024 * 1024));
    response = await handle(tooLarge);
    assert.equal(response.status, 413);
  });
});

test("photo gateway stops after failed capability authorization", async () => {
  const calls = [];
  await withFetch(async (url) => {
    calls.push(url);
    return reply({ code: "PT401", message: "BACKGROUND_REVOKED" }, 401);
  }, async () => {
    const response = await handle(request());
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, "BACKGROUND_REVOKED");
  });
  assert.deepEqual(calls, [apiUrl + "/rest/v1/rpc/sync_authorize_background_upload"]);
});

test("photo gateway uploads exact bytes without upsert and reauthorizes before receipt", async () => {
  const calls = [];
  await withFetch(async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.apikey, serviceKey);
    assert.equal(options.headers.Authorization, "Bearer " + serviceKey);
    if (url.endsWith("sync_authorize_background_upload")) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.p_capability, token);
      assert.deepEqual(payload.p_operation, operation);
      assert.equal(payload.p_size, bytes.length);
      const expected = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
      assert.equal(payload.p_sha256, expected);
      return authorize(payload);
    }
    if (url.includes("/storage/")) {
      assert.equal(url, apiUrl + "/storage/v1/object/animal-photos/" + path);
      assert.equal(options.method, "POST");
      assert.equal(options.headers["x-upsert"], "false");
      assert.deepEqual(options.body, bytes);
      return reply({ Key: path });
    }
    assert.ok(url.endsWith("sync_apply_background_operation"));
    assert.deepEqual(JSON.parse(options.body), { p_capability: token, p_operation: operation });
    return reply(receipt);
  }, async () => {
    const response = await handle(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), receipt);
  });
  assert.equal(calls.length, 3);
});

test("photo gateway accepts identical duplicate originals and rejects different bytes", async () => {
  for (const same of [true, false]) {
    let applied = 0;
    await withFetch(async (url, options) => {
      if (url.endsWith("sync_authorize_background_upload")) return authorize(JSON.parse(options.body));
      if (url.includes("/storage/") && options.method === "POST") return reply({ error: "Duplicate" }, 409);
      if (url.includes("/storage/")) {
        assert.equal(url, apiUrl + "/storage/v1/object/animal-photos/" + path);
        return new Response(same ? bytes : new Uint8Array([...bytes, 4]), { headers: { "Content-Type": "image/png" } });
      }
      applied++;
      return reply({ ...receipt, status: "duplicate" });
    }, async () => {
      const response = await handle(request());
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.status, same ? "duplicate" : "conflict");
      if (!same) assert.equal(result.code, "PHOTO_BYTES_CONFLICT");
    });
    assert.equal(applied, same ? 1 : 0);
  }
});

test("photo gateway preserves revocation after upload as authorization pause", async () => {
  await withFetch(async (url, options) => {
    if (url.endsWith("sync_authorize_background_upload")) return authorize(JSON.parse(options.body));
    if (url.includes("/storage/")) return reply({ Key: path });
    return reply({ code: "PT401", message: "BACKGROUND_SESSION_ENDED" }, 401);
  }, async () => {
    const response = await handle(request());
    assert.equal(response.status, 401);
    const result = await response.json();
    assert.equal(result.message, "BACKGROUND_SESSION_ENDED");
    assert.equal(result.status, undefined);
  });
});

test("photo gateway returns a terminal immutable-request conflict from the server", async () => {
  await withFetch(async () => reply({ code: "PT409", message: "BACKGROUND_OPERATION_ID_REUSED" }, 409), async () => {
    const response = await handle(request());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, "conflict");
    assert.equal(result.code, "OPERATION_ID_REUSED");
    assert.equal(result.operationId, operation.operationId);
    assert.ok(Number.isFinite(Date.parse(result.serverReceivedAt)));
  });
});
