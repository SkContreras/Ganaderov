import {protectedTransaction, readProtected, readProtectedRecord} from "./protected-store.mjs";
import {deliverUniversal, readQueue, universalActions} from "./universal-outbox.mjs";

export const BACKGROUND_SYNC_TAG = "ganaderov-event-outbox-v1";
const REGISTRY = "ganaderov-background-v1";
const CONTROL = "background-control";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TTL = 6 * 60 * 60 * 1000;

export class BackgroundDeliveryStopped extends Error {
  constructor(code = "BACKGROUND_PAUSED") {
    super(code);
    this.code = code;
    this.stopDelivery = true;
  }
}

export function backgroundProject(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) ||
      !(url.protocol === "https:" || url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(url.hostname))) {
    throw new BackgroundDeliveryStopped("BACKGROUND_PROJECT_INVALID");
  }
  return url.origin;
}

function matchingDatabase(name, project, user, owner) {
  const prefix = "ganadero-local-account-", suffix = `-${user}-ranch-${owner}`;
  if (typeof name !== "string" || !name.startsWith(prefix) || !name.endsWith(suffix)) return false;
  try { return backgroundProject(decodeURIComponent(name.slice(prefix.length, -suffix.length))) === project; }
  catch { return false; }
}

export function isPublicBackgroundKey(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "anon";
  } catch { return false; }
}

export function validateBackgroundCapability(data, scope, now = Date.now()) {
  const issued = Date.parse(data?.issuedAt), expires = Date.parse(data?.expiresAt);
  if (data?.protocolVersion !== 1 || !uuid.test(data.capabilityId || "") ||
      !/^[0-9a-f]{64}$/i.test(data.capability || "") ||
      data.actorId !== scope.userId || data.ownerId !== scope.ownerId ||
      data.deviceId !== scope.deviceId || data.sessionId !== scope.sessionId ||
      ![scope.userId, scope.ownerId, scope.deviceId, scope.sessionId].every(value => uuid.test(value || "")) ||
      !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 30000 ||
      expires <= now || expires <= issued || expires - issued > MAX_TTL ||
      !Array.isArray(data.allowedActions) || !data.allowedActions.length ||
      data.allowedActions.some(action => !universalActions.has(action)) ||
      new Set(data.allowedActions).size !== data.allowedActions.length) {
    throw new BackgroundDeliveryStopped("BACKGROUND_CAPABILITY_INVALID");
  }
  // Copy a whitelist. In particular, auth access/refresh tokens from callers
  // must never become fields of the durable background record.
  return {
    protocolVersion: 1, capabilityId: data.capabilityId, capability: data.capability,
    actorId: data.actorId, ownerId: data.ownerId, deviceId: data.deviceId,
    sessionId: data.sessionId, issuedAt: data.issuedAt, expiresAt: data.expiresAt,
    allowedActions: [...data.allowedActions]
  };
}

function openRegistry() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REGISTRY, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("syncMeta", {keyPath: "id"});
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new BackgroundDeliveryStopped("BACKGROUND_STORE_BLOCKED"));
  });
}

function openExistingDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (!["syncMeta", "operationOutbox", "photoUploads"].every(store => database.objectStoreNames.contains(store))) {
        database.close();
        reject(new BackgroundDeliveryStopped("BACKGROUND_UPGRADE_REQUIRED"));
      } else resolve(database);
    };
    request.onerror = () => reject(new BackgroundDeliveryStopped("BACKGROUND_DATABASE_UNAVAILABLE"));
  });
}

async function registrySnapshot(database) {
  const rows = await readProtected(database, "syncMeta");
  const control = rows.find(row => row.id === CONTROL);
  return {control, grants: rows.filter(row => row.id.startsWith("grant:"))};
}

function grantId(capability) { return "grant:" + capability.capabilityId; }

async function rememberRevocation(database, grant) {
  await protectedTransaction(database, ["syncMeta"], "readwrite", tx => {
    tx.objectStore("syncMeta").put({...grant, state: "revokePending"});
  });
}

/// Called only by a verified foreground session. The supplied issue callback
/// invokes the authenticated RPC; its access token is never copied here.
export async function publishBackgroundCapability({database, projectUrl, publishableKey,
  userId, ownerId, deviceId, sessionId, issueCapability, verify = () => {}}) {
  verify();
  const project = backgroundProject(projectUrl);
  const scope = {userId, ownerId, deviceId, sessionId};
  if (!matchingDatabase(database?.name, project, userId, ownerId) ||
      !Object.values(scope).every(value => uuid.test(value || "")) ||
      !isPublicBackgroundKey(publishableKey)) {
    throw new BackgroundDeliveryStopped("BACKGROUND_SCOPE_INVALID");
  }
  const registry = await openRegistry();
  const generation = crypto.randomUUID();
  let reused = null;
  let grant = null;
  try {
    await protectedTransaction(registry, ["syncMeta"], "readwrite", tx => {
      const store = tx.objectStore("syncMeta"), request = store.getAll();
      request.onsuccess = () => {
        const rows = request.result, control = rows.find(row => row.id === CONTROL);
        const active = rows.find(row => row.id === control?.activeId && row.state === "active");
        if (active && active.databaseName === database.name && active.projectUrl === project &&
            active.userId === userId && active.ownerId === ownerId && active.deviceId === deviceId &&
            active.sessionId === sessionId && Date.parse(active.capability.expiresAt) > Date.now() + 300000) {
          validateBackgroundCapability(active.capability, scope);
          reused = active;
          return;
        }
        for (const row of rows) if (row.id.startsWith("grant:") && row.state === "active") {
          store.put({...row, state: "revokePending"});
        }
        // Reserve a generation before the network request. Logout can replace
        // it immediately; a late issuance can then only be queued for revoke.
        store.put({id: CONTROL, generation, activeId: null});
      };
    }, verify);
    if (reused) return {capabilityId: reused.capability.capabilityId, expiresAt: reused.capability.expiresAt};
    const capability = validateBackgroundCapability(await issueCapability(), scope);
    grant = {id: grantId(capability), generation, state: "active", databaseName: database.name,
      projectUrl: project, publishableKey, userId, ownerId, deviceId, sessionId, capability};
    let activated = false;
    await protectedTransaction(registry, ["syncMeta"], "readwrite", tx => {
      const store = tx.objectStore("syncMeta"), request = store.get(CONTROL);
      request.onsuccess = () => {
        if (request.result?.generation !== generation) {
          store.put({...grant, state: "revokePending"});
          return;
        }
        store.put(grant);
        store.put({id: CONTROL, generation, activeId: grant.id});
        activated = true;
      };
    }, verify);
    if (!activated) throw new BackgroundDeliveryStopped("BACKGROUND_SESSION_CHANGED");
    return {capabilityId: capability.capabilityId, expiresAt: capability.expiresAt};
  } catch (error) {
    if (grant) await rememberRevocation(registry, grant);
    throw error;
  } finally {
    registry.close();
  }
}

/// This local barrier completes before logout/session changes. Offline remote
/// revocations remain encrypted until the next worker wake or foreground retry.
export async function disableBackgroundDelivery() {
  const registry = await openRegistry();
  try {
    await protectedTransaction(registry, ["syncMeta"], "readwrite", tx => {
      const store = tx.objectStore("syncMeta"), request = store.getAll();
      request.onsuccess = () => {
        for (const grant of request.result) if (grant.id.startsWith("grant:") && grant.state === "active") {
          store.put({...grant, state: "revokePending"});
        }
        store.put({id: CONTROL, activeId: null, generation: crypto.randomUUID()});
      };
    });
  } finally { registry.close(); }
}

async function fetchJson(url, options, fetchImpl) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(url, {...options, signal: controller.signal,
      credentials: "omit", cache: "no-store", redirect: "error"});
    const value = await response.json().catch(() => null);
    if ([401, 403, 429].includes(response.status)) {
      throw new BackgroundDeliveryStopped(response.status === 429 ? "BACKGROUND_QUOTA_REACHED" : "BACKGROUND_AUTHORIZATION_REQUIRED");
    }
    if (!response.ok) throw Error("BACKGROUND_TRANSPORT_UNKNOWN");
    return value;
  } finally { clearTimeout(timer); }
}

export function capabilityTransport({grant, assertActive, onAuthorizationFailure = async () => {}, fetchImpl = globalThis.fetch}) {
  const project = backgroundProject(grant.projectUrl);
  if (!isPublicBackgroundKey(grant.publishableKey)) {
    throw new BackgroundDeliveryStopped("BACKGROUND_CLIENT_KEY_INVALID");
  }
  async function check(operation) {
    await assertActive();
    validateBackgroundCapability(grant.capability, grant);
    if (operation.ownerId !== grant.ownerId || operation.deviceId !== grant.deviceId ||
        !grant.capability.allowedActions.includes(operation.action)) {
      throw new BackgroundDeliveryStopped("BACKGROUND_OPERATION_SCOPE_INVALID");
    }
  }
  async function request(url, options) {
    try { return await fetchJson(url, options, fetchImpl); }
    catch (error) {
      if (["BACKGROUND_AUTHORIZATION_REQUIRED", "BACKGROUND_QUOTA_REACHED"].includes(error.code)) {
        await onAuthorizationFailure();
      }
      throw error;
    }
  }
  return {
    async sendOperation(operation) {
      await check(operation);
      const receipt = await request(project + "/rest/v1/rpc/sync_apply_background_operation", {
        method: "POST", headers: {apikey: grant.publishableKey, "Content-Type": "application/json"},
        body: JSON.stringify({p_capability: grant.capability.capability, p_operation: operation})
      });
      await assertActive();
      return receipt;
    },
    async uploadPhoto({operation, blob}) {
      await check(operation);
      if (operation.action !== "photo.create" || !(blob instanceof Blob) ||
          !["image/jpeg", "image/png", "image/webp"].includes(blob.type) ||
          blob.type !== operation.changes?.mime || blob.size < 1 || blob.size > 10 * 1024 * 1024) {
        throw new BackgroundDeliveryStopped("BACKGROUND_ORIGINAL_INVALID");
      }
      const body = new FormData();
      body.append("capability", grant.capability.capability);
      body.append("operation", JSON.stringify(operation));
      body.append("file", blob, "original");
      const receipt = await request(project + "/functions/v1/sync-background-photo", {
        method: "POST", headers: {apikey: grant.publishableKey}, body
      });
      await assertActive();
      return receipt;
    }
  };
}

async function drainRevocations(registry, fetchImpl) {
  const {grants} = await registrySnapshot(registry);
  for (const grant of grants) {
    const expired = !Number.isFinite(Date.parse(grant.capability?.expiresAt)) ||
      Date.parse(grant.capability.expiresAt) <= Date.now();
    let remove = expired;
    if (!expired && grant.state === "revokePending") {
      try {
        await fetchJson(backgroundProject(grant.projectUrl) + "/rest/v1/rpc/sync_revoke_background_token", {
          method: "POST", headers: {apikey: grant.publishableKey, "Content-Type": "application/json"},
          body: JSON.stringify({p_capability: grant.capability.capability})
        }, fetchImpl);
        remove = true;
      } catch (error) {
        // An already invalid/revoked token no longer needs to be retained.
        if (error.code === "BACKGROUND_AUTHORIZATION_REQUIRED") remove = true;
      }
    }
    if (remove) await protectedTransaction(registry, ["syncMeta"], "readwrite", tx => {
      const store = tx.objectStore("syncMeta");
      store.delete(grant.id);
      const request = store.get(CONTROL);
      request.onsuccess = () => {
        if (request.result?.activeId === grant.id) {
          store.put({...request.result, activeId: null, generation: crypto.randomUUID()});
        }
      };
    });
  }
}

export async function revokeBackgroundCapabilities({fetchImpl = globalThis.fetch} = {}) {
  const registry = await openRegistry();
  try { await drainRevocations(registry, fetchImpl); } finally { registry.close(); }
}

/// Used by the service worker, with no open window and no Supabase Auth client.
export async function runBackgroundDelivery({fetchImpl = globalThis.fetch, limit = 8} = {}) {
  if (!globalThis.navigator?.locks?.request) return {status: "unsupported", pending: 0};
  const registry = await openRegistry();
  let database;
  try {
    await drainRevocations(registry, fetchImpl);
    const {control, grants} = await registrySnapshot(registry);
    const grant = grants.find(row => row.id === control?.activeId && row.state === "active");
    if (!grant) return {status: "disabled", pending: 0};
    validateBackgroundCapability(grant.capability, grant);
    if (!matchingDatabase(grant.databaseName, grant.projectUrl, grant.userId, grant.ownerId)) {
      throw new BackgroundDeliveryStopped("BACKGROUND_SCOPE_INVALID");
    }
    let stopped = false;
    const verify = () => {
      if (stopped || Date.parse(grant.capability.expiresAt) <= Date.now()) {
        throw new BackgroundDeliveryStopped("BACKGROUND_PAUSED");
      }
    };
    const assertActive = async () => {
      verify();
      const current = await readProtectedRecord(registry, "syncMeta", CONTROL);
      const currentGrant = await readProtectedRecord(registry, "syncMeta", grant.id);
      if (current?.generation !== grant.generation || current.activeId !== grant.id ||
          currentGrant?.state !== "active" || currentGrant.capability?.capability !== grant.capability.capability) {
        stopped = true;
        throw new BackgroundDeliveryStopped("BACKGROUND_SESSION_CHANGED");
      }
      verify();
    };
    await assertActive();
    database = await openExistingDatabase(grant.databaseName);
    const onAuthorizationFailure = () => protectedTransaction(registry, ["syncMeta"], "readwrite", tx => {
      const store = tx.objectStore("syncMeta"), request = store.get(CONTROL);
      request.onsuccess = () => {
        // A response from an old grant cannot invalidate a newer login.
        if (request.result?.generation === grant.generation && request.result.activeId === grant.id) {
          store.put({...request.result, activeId: null, generation: crypto.randomUUID()});
          store.put({...grant, state: "revokePending"});
        }
      };
    });
    const transport = capabilityTransport({grant, assertActive, onAuthorizationFailure, fetchImpl});
    return await navigator.locks.request(`ganaderov-outbox:${grant.ownerId}:${grant.userId}`,
      {ifAvailable: true}, async lock => {
        if (!lock) return {status: "busy", pending: 0};
        await assertActive();
        const result = await deliverUniversal({database, userId: grant.userId, ownerId: grant.ownerId,
          deviceId: grant.deviceId, verify, ...transport, limit: Math.max(1, Math.min(8, limit))});
        const eligible = (await readQueue(database, grant)).filter(row => row.state === "pending" &&
          row.operation.deviceId === grant.deviceId).length;
        return {...result, status: result.stopped ? "paused" : eligible ? "retry" : "drained", pending: eligible};
      });
  } catch (error) {
    if (error.stopDelivery) return {status: "paused", pending: 0};
    throw error;
  } finally {
    database?.close();
    registry.close();
  }
}
