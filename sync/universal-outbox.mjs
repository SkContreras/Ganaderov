import {protectedTransaction, readProtected, readProtectedRecord} from "./protected-store.mjs";

export const universalActions = new Set([
  "animal.create", "animal.update", "animal.archive", "animal.restore", "animal.target.update",
  "event.create", "event.update", "event.delete", "photo.create", "photo.delete",
  "photo.crop", "photo.primary", "journey.create", "journey.attend", "journey.finish",
  "journey.resume", "journey.add_animals", "config.update", "forecast.create", "forecast.delete"
]);
export const entityKind = action => action.split(".")[0];
export const inScope = (row, scope) => row?.userId === scope.userId && row?.ownerId === scope.ownerId;
export const stable = value => Array.isArray(value) ? value.map(stable) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const fingerprint = value => JSON.stringify(stable(value ?? null));
export const revisionKey = (kind, id) => "entity-revision:" + kind + ":" + id;
const canonicalStores = {animal: "animals", event: "events", journey: "journeys", forecast: "growthForecasts", config: "ranchSettings"};
const canonicalKey = (kind, id) => kind === "config" ? "animal-fields" : id;
const canonicalData = (kind, row) => kind === "config" ? row?.config ?? null : row ?? null;
export const unresolved = row => row.state !== "archived" &&
  (row.state !== "confirmed" || !(row.settled || row.photoSettled));
export const ordered = rows => rows.slice().sort((a, b) =>
  (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export async function readQueue(database, scope) {
  return ordered((await readProtected(database, "operationOutbox")).filter(row => inScope(row, scope)));
}

export function latestEntityOperation(rows, action, id) {
  return ordered(rows).filter(row => unresolved(row) && row.operation?.entityId === id &&
    entityKind(row.operation.action) === entityKind(action)).at(-1) ?? null;
}

export function cachedRevision(cache, scope, kind, id, expected) {
  return cache && inScope(cache, scope) && cache.id === revisionKey(kind, id) &&
    Number.isSafeInteger(cache.revision) && cache.revision >= 0 &&
    cache.fingerprint === fingerprint(expected) ? cache.revision : null;
}

// baseOperationId is local dependency metadata, never a server envelope field.
// A draft obtains its revision from the exact successful predecessor receipt.
// It is sealed durably before its first request, then never rewritten on retry.
export async function enqueueUniversalBatch(database, scope, items, verify = () => {}) {
  if (!items.length) return [];
  const attachmentIds = items.filter(item => item.blob).map(item => item.operation.operationId);
  const guardedStores = items.filter(item => Object.hasOwn(item, "expectedData"))
    .map(item => canonicalStores[entityKind(item.operation.action)]).filter(Boolean);
  const stores = [...new Set(["operationOutbox", "syncMeta", ...guardedStores, ...(attachmentIds.length ? ["photoUploads"] : [])])];
  const ids = [];
  await protectedTransaction(database, stores, "readwrite", tx => {
    const queue = tx.objectStore("operationOutbox");
    const guards = items.filter(item => Object.hasOwn(item, "expectedData"));
    const checks = [];
    for (const item of guards) {
      const kind = entityKind(item.operation.action), store = canonicalStores[kind];
      if (!store) throw Error("Entidad no disponible para comparación.");
      const read = tx.objectStore(store).get(canonicalKey(kind, item.operation.entityId));
      read.onsuccess = () => {
        if (fingerprint(canonicalData(kind, read.result)) !== fingerprint(item.expectedData)) {
          throw Error("La ficha cambió en otra pestaña. Actualiza antes de guardar.");
        }
      };
      checks.push(read);
    }
    const request = queue.getAll();
    request.onsuccess = () => {
      const rows = request.result.filter(row => inScope(row, scope));
      let sequence = Math.max(0, ...rows.map(row => row.sequence ?? 0));
      for (const item of items) {
        const operation = structuredClone(item.operation), id = operation.operationId;
        if (item.recoveryKey !== undefined) {
          if (typeof item.recoveryKey !== "string" || !item.recoveryKey || item.recoveryKey.length > 500) throw Error("Clave de recuperación inválida.");
          const meta = tx.objectStore("syncMeta"), markerId = "legacy-recovery:" + item.recoveryKey;
          const marker = meta.get(markerId);
          marker.onsuccess = () => {
            if (marker.result) throw Error("Esta captura ya se recuperó. Revisa su operación guardada.");
            meta.add({id:markerId,userId:scope.userId,ownerId:scope.ownerId,operationId:id,recoveredAt:operation.capturedAt});
          };
        }
        if (!universalActions.has(operation.action) || operation.ownerId !== scope.ownerId ||
            typeof id !== "string" || !id || !operation.entityId || !operation.deviceId ||
            !Number.isFinite(Date.parse(operation.capturedAt))) throw Error("Operación inválida.");
        const last = latestEntityOperation(rows, operation.action, operation.entityId);
        if (Object.hasOwn(item, "expectedLastId") && (last?.id ?? null) !== item.expectedLastId) {
          throw Error("Hay un cambio nuevo en otra pestaña. Revisa antes de guardar.");
        }
        if (last && !["pending", "confirmed"].includes(last.state)) {
          throw Error("Revisa el conflicto anterior de este registro antes de otro cambio.");
        }
        const dependencies = [...new Set(item.dependsOn || [])];
        let baseOperationId = item.baseOperationId ?? null;
        if (baseOperationId && !dependencies.includes(baseOperationId)) dependencies.push(baseOperationId);
        for (const dependencyId of dependencies) {
          const dependency = rows.find(row => row.id === dependencyId);
          if (!dependency || dependency.id === id || !["pending", "confirmed"].includes(dependency.state)) {
            throw Error("La operación previa no está disponible para esta cuenta y rancho.");
          }
        }
        if (baseOperationId) {
          const predecessor = rows.find(row => row.id === baseOperationId);
          if (predecessor.operation.entityId !== operation.entityId ||
              entityKind(predecessor.operation.action) !== entityKind(operation.action) ||
              operation.action.endsWith(".create")) throw Error("Dependencia de revisión inválida.");
          operation.baseRevision = null;
        }
        const sealed = !baseOperationId;
        if (sealed && (operation.action.endsWith(".create")
          ? operation.baseRevision !== null
          : !Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0)) {
          throw Error("Falta la revisión confirmada del registro.");
        }
        if (item.blob) {
          if (operation.action !== "photo.create" || !(item.blob instanceof Blob) ||
              !["image/jpeg", "image/png", "image/webp"].includes(item.blob.type) ||
              item.blob.size < 1 || item.blob.size > 10 * 1024 * 1024 ||
              operation.changes.mime !== item.blob.type) throw Error("Original de fotografía inválido.");
          tx.objectStore("photoUploads").add({id, userId: scope.userId, ownerId: scope.ownerId, blob: item.blob});
        }
        const row = {id, userId: scope.userId, ownerId: scope.ownerId, operation,
          state: "pending", sealed, wireFingerprint: sealed ? fingerprint(operation) : null,
          dependsOn: dependencies, baseOperationId, attachmentId: item.blob ? id : null,
          sequence: ++sequence, attempts: 0, nextAt: 0, code: "",
          createdAt: operation.capturedAt, settled: false};
        queue.add(row);
        rows.push(row);
        ids.push(id);
      }
    };
  }, verify, attachmentIds.length ? {photoUploads: attachmentIds} : {});
  return ids;
}

export async function prepareUniversal(database, scope, id, verify = () => {}) {
  let prepared;
  await protectedTransaction(database, ["operationOutbox"], "readwrite", tx => {
    const queue = tx.objectStore("operationOutbox"), request = queue.getAll();
    request.onsuccess = () => {
      const rows = request.result.filter(row => inScope(row, scope));
      const entry = rows.find(row => row.id === id);
      if (!entry || entry.state !== "pending") return;
      for (const dependencyId of entry.dependsOn || []) {
        const dependency = rows.find(row => row.id === dependencyId);
        if (!dependency || ["conflict", "rejected", "archived", "blocked"].includes(dependency.state)) {
          queue.put({...entry, state: "blocked", code: "DEPENDENCY_REQUIRES_REVIEW"});
          prepared = {blocked: true};
          return;
        }
        if (dependency.state !== "confirmed" || !["applied", "duplicate"].includes(dependency.receipt?.status)) {
          prepared = {waiting: true};
          return;
        }
      }
      let operation = entry.operation;
      if (entry.sealed === false) {
        const previous = rows.find(row => row.id === entry.baseOperationId);
        if (!previous || previous.operation.entityId !== operation.entityId ||
            entityKind(previous.operation.action) !== entityKind(operation.action) ||
            previous.receipt?.operationId !== previous.id ||
            !Number.isSafeInteger(previous.receipt?.revision) || previous.receipt.revision < 1) {
          queue.put({...entry, state: "blocked", code: "DEPENDENCY_RECEIPT_INVALID"});
          prepared = {blocked: true};
          return;
        }
        operation = {...operation, baseRevision: previous.receipt.revision};
        queue.put({...entry, operation, sealed: true, wireFingerprint: fingerprint(operation)});
      } else if (entry.wireFingerprint && entry.wireFingerprint !== fingerprint(operation)) {
        throw Error("El cuerpo persistido de la operación cambió.");
      } else if (!entry.wireFingerprint) {
        // Upgrade an existing immutable D2/D3/D4 row without changing its body.
        queue.put({...entry, sealed: true, wireFingerprint: fingerprint(operation)});
      }
      prepared = {...entry, operation, sealed: true};
    };
  }, verify);
  return prepared;
}

function validReceipt(receipt, id) {
  return receipt?.protocolVersion === 1 && receipt.operationId === id &&
    ["applied", "duplicate", "conflict", "rejected", "retryable"].includes(receipt.status) &&
    typeof receipt.serverReceivedAt === "string" && Number.isFinite(Date.parse(receipt.serverReceivedAt)) &&
    (!["applied", "duplicate"].includes(receipt.status) ||
      Number.isSafeInteger(receipt.revision) && receipt.revision >= 1);
}

async function updatePending(database, scope, id, patch, verify) {
  await protectedTransaction(database, ["operationOutbox"], "readwrite", tx => {
    const queue = tx.objectStore("operationOutbox"), request = queue.get(id);
    request.onsuccess = () => {
      const entry = request.result;
      if (entry && inScope(entry, scope) && entry.state === "pending") queue.put({...entry, ...patch});
    };
  }, verify);
}

// The caller holds the same ganaderov-outbox:<owner>:<user> Web Lock in a
// foreground page or a service worker. Transport callbacks never edit the queue.
export async function deliverUniversal({database, userId, ownerId, deviceId, verify = () => {},
  sendOperation, uploadPhoto, now = () => Date.now(), limit = 100, manual = false}) {
  const scope = {userId, ownerId};
  const result = {sent: 0, attempted: 0, pending: 0, blocked: 0, stopped: false};
  const rows = await readQueue(database, scope);
  for (const row of rows) {
    verify();
    if (result.attempted >= limit) break;
    if (row.state !== "pending" || !manual && row.nextAt > now()) continue;
    const entry = await prepareUniversal(database, scope, row.id, verify);
    if (!entry || entry.waiting) continue;
    if (entry.blocked) {result.blocked++; continue;}
    const operation = entry.operation;
    if (operation.ownerId !== ownerId || operation.operationId !== row.id ||
        !universalActions.has(operation.action)) throw Error("Ámbito de operación inválido.");
    // A capability is tied to the device. Imported work stays visible and is
    // delivered by an authenticated foreground session, never the wrong grant.
    if (deviceId && operation.deviceId !== deviceId) continue;
    result.attempted++;
    let receipt;
    try {
      if (operation.action === "photo.create") {
        const original = await readProtectedRecord(database, "photoUploads", entry.attachmentId || entry.id);
        verify();
        if (!original || !inScope(original, scope) || !(original.blob instanceof Blob)) {
          await updatePending(database, scope, entry.id,
            {state: "blocked", code: "ORIGINAL_REQUIRES_REVIEW"}, verify);
          result.blocked++;
          continue;
        }
        receipt = await uploadPhoto({operation, blob: original.blob});
        verify();
      }
      if (!receipt) receipt = await sendOperation(operation);
      verify();
      if (!validReceipt(receipt, entry.id)) throw Error("Respuesta de operación inválida.");
      if (["applied", "duplicate"].includes(receipt.status)) {
        await updatePending(database, scope, entry.id, {state: "confirmed", receipt, code: "OK",
          attempts: entry.attempts + 1, nextAt: 0, settled: false,
          ...(operation.action.startsWith("photo.") ? {photoSettled: false} : {})}, verify);
        result.sent++;
      } else if (["conflict", "rejected"].includes(receipt.status)) {
        await updatePending(database, scope, entry.id, {state: receipt.status, receipt,
          code: String(receipt.code || "REVIEW_REQUIRED").slice(0, 100), attempts: entry.attempts + 1}, verify);
      } else throw Error("Respuesta pendiente de reintento.");
    } catch (error) {
      verify();
      if (error?.stopDelivery) {result.stopped = true; break;}
      if (error?.requiresReview === true && error.code === "PHOTO_BYTES_CONFLICT") {
        await updatePending(database,scope,entry.id,{state:"blocked",code:error.code,attempts:entry.attempts+1},verify);
        result.blocked++;
        continue;
      }
      await updatePending(database, scope, entry.id, {attempts: entry.attempts + 1,
        nextAt: now() + Math.min(900000, 30000 * 2 ** Math.min(entry.attempts, 5)),
        code: "TRANSPORT_UNKNOWN"}, verify);
      // Independent operations may proceed, dependent drafts remain waiting.
    }
  }
  const remaining = await readQueue(database, scope);
  result.pending = remaining.filter(row => row.state === "pending").length;
  result.blocked = remaining.filter(row => row.state === "blocked").length;
  return result;
}

// A confirmed receipt is not a downloaded snapshot. Keep the display overlay
// until a subsequent read has proved the canonical revision is at least it.
export async function rememberEntities(database, scope, entities, expected, verify = () => {}) {
  const expectedMap = new Map(expected.map(item => [item.kind + ":" + item.id, item.data]));
  const accepted = entities.filter(entity => Number.isSafeInteger(entity.revision) && entity.revision >= 0 &&
    expectedMap.has(entity.kind + ":" + entity.id) &&
    fingerprint(expectedMap.get(entity.kind + ":" + entity.id)) === fingerprint(entity.data));
  if (!accepted.length) return;
  const stores = [...new Set(["syncMeta", "operationOutbox", ...accepted.map(entity => canonicalStores[entity.kind]).filter(Boolean)])];
  await protectedTransaction(database, stores, "readwrite", tx => {
    const meta = tx.objectStore("syncMeta"), queue = tx.objectStore("operationOutbox"), verified = [];
    for (const entity of accepted) {
      const store = canonicalStores[entity.kind];
      if (!store) continue;
      const read = tx.objectStore(store).get(canonicalKey(entity.kind, entity.id));
      read.onsuccess = () => {
        if (fingerprint(canonicalData(entity.kind, read.result)) !== fingerprint(entity.data)) return;
        verified.push(entity);
        meta.put({id: revisionKey(entity.kind, entity.id), userId: scope.userId, ownerId: scope.ownerId,
          revision: entity.revision, fingerprint: fingerprint(entity.data), data: entity.data, parentId: entity.parentId});
      };
    }
    const request = queue.getAll();
    request.onsuccess = () => {
      for (const entry of request.result) {
        if (!inScope(entry, scope) || entry.state !== "confirmed" || entry.settled) continue;
        const entity = verified.find(item => item.kind === entityKind(entry.operation.action) &&
          item.id === entry.operation.entityId && item.revision >= entry.receipt?.revision);
        if (entity) queue.put({...entry, settled: true});
      }
    };
  }, verify);
}

const pendingMarker = row => ({_pending: true, _operationId: row.id});
export function projectUniversal(snapshot, rows, scope) {
  const result = {
    animals: snapshot.animals.map(row => ({...row})),
    events: snapshot.events.map(row => ({...row})),
    journeys: snapshot.journeys.map(row => structuredClone(row)),
    forecasts: snapshot.forecasts.map(row => ({...row})),
    config: snapshot.config,
    photoCreates: [], pendingEvents: []
  };
  for (const entry of ordered(rows)) {
    if (!inScope(entry, scope) || !["pending", "confirmed"].includes(entry.state) || entry.settled) continue;
    const op = entry.operation, c = op.changes, mark = pendingMarker(entry), stamp = op.capturedAt;
    const animal = result.animals.find(row => row.id === op.entityId);
    if (op.action === "animal.create") {
      if (!animal) result.animals.push({id: op.entityId, internalId: "Por asignar", status: "Activo",
        createdAt: stamp, updatedAt: stamp, ...c.fields, ...mark});
    } else if (op.action === "animal.update" && animal) Object.assign(animal, c.fields, mark);
    else if (["animal.archive", "animal.restore"].includes(op.action) && animal) {
      Object.assign(animal, c, mark);
      if (op.action === "animal.restore") {delete animal.exitReason; delete animal.exitNotes;}
    } else if (op.action === "animal.target.update" && animal) {
      Object.assign(animal, {targetWeightMin: c.minimum, targetWeightMax: c.maximum}, mark);
    } else if (op.action === "event.create") {
      if (!result.events.some(row => row.id === op.entityId)) result.pendingEvents.push({
        id: op.entityId, animalId: c.animalId, type: c.type, date: c.date, weight: c.weight,
        label: c.product, notes: c.notes, createdAt: stamp, ...mark});
    } else if (op.action === "event.update") {
      const original = result.events.find(row => row.id === op.entityId);
      if (original) result.pendingEvents.push({...original, ...Object.fromEntries(
        Object.entries(c).filter(([key]) => !["animalId", "reason", "product"].includes(key))),
        ...(Object.hasOwn(c, "product") ? {label: c.product} : {}), ...mark, _replaces: original.id});
    } else if (op.action === "event.delete") {
      const original = result.events.find(row => row.id === op.entityId);
      if (original) result.pendingEvents.push({...original, ...mark, _deleted: true, _replaces: original.id});
    } else if (op.action === "config.update") result.config = c.config;
    else if (op.action === "photo.create" && !entry.photoSettled) result.photoCreates.push({
      id: op.entityId, animalId: c.animalId, name: c.name, mime: c.mime, primary: Boolean(c.primary),
      createdAt: stamp, cropX: 50, cropY: 50, cropZoom: 1, attachmentId: entry.attachmentId || entry.id, ...mark});
    else if (op.action === "forecast.delete") {
      result.forecasts = result.forecasts.filter(row => row.id !== op.entityId);
    } else if (op.action === "journey.create") {
      if (!result.journeys.some(row => row.id === op.entityId)) result.journeys.push({
        id: op.entityId, ...c, status: "in_progress", createdAt: stamp, updatedAt: stamp,
        roster: c.animalIds.map(id => ({...(result.animals.find(row => row.id === id) || {id}),
          attended: false})), ...mark});
    } else if (op.action.startsWith("journey.")) {
      const journey = result.journeys.find(row => row.id === op.entityId);
      if (!journey) continue;
      Object.assign(journey, mark);
      if (op.action === "journey.attend") {
        const target = journey.roster.find(row => row.id === c.animalId);
        if (target) Object.assign(target, {attended: true, _pending: true},
          Object.hasOwn(c, "weight") ? {weight: c.weight} : {});
      } else if (op.action === "journey.add_animals") {
        for (const id of c.animalIds) if (!journey.roster.some(row => row.id === id)) {
          journey.roster.push({...(result.animals.find(row => row.id === id) || {id}), attended: false});
        }
      } else if (op.action === "journey.finish") {
        journey.status = journey.roster.some(row => !row.attended) ? "incomplete" : "completed";
        journey.completedAt = stamp;
      } else if (op.action === "journey.resume") {journey.status = "in_progress"; journey.completedAt = null;}
    }
  }
  return result;
}
