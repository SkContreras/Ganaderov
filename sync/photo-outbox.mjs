import {protectedTransaction} from "./protected-store.mjs";

const actions = new Set(["photo.crop", "photo.primary", "photo.delete", "photo.create"]);
export const isPhotoOperation = entry => actions.has(entry?.operation?.action);
const inScope = (entry, scope) => entry.userId === scope.userId && entry.ownerId === scope.ownerId;
export const photoRevisionKey = id => `photo-revision:${id}`;
export const blocksPhotoChanges = entry => isPhotoOperation(entry) &&
  (entry.state === "confirmed" ? !entry.photoSettled : entry.state !== "archived");

// A revision describes confirmed metadata. Never derive it from a timestamp,
// another entity's feed cursor, or the pending local presentation.
export function photoSnapshot(photo) {
  if (!photo) return null;
  const coordinate = value => value == null || !Number.isFinite(Number(value)) ? 50 : Math.max(0, Math.min(100, Number(value)));
  return JSON.stringify({id: photo.id, animalId: photo.animalId, name: photo.name, mime: photo.mime,
    primary: Boolean(photo.primary), createdAt: photo.createdAt,
    cropX: coordinate(photo.cropX), cropY: coordinate(photo.cropY),
    cropZoom: Math.max(1, Math.min(3, Number(photo.cropZoom) || 1))});
}

export function cachedPhotoRevision(cache, photo, scope) {
  return cache && inScope(cache, scope) && Number.isSafeInteger(cache.revision) && cache.revision >= 1 &&
    cache.fingerprint === photoSnapshot(photo) ? cache.revision : null;
}

// Only the display gets an overlay. The canonical photos store remains suitable
// for bundle comparison/upload and keeps the original encrypted Blob intact.
export function projectPhotoOperations(photos, entries, scope) {
  let result = photos.map(photo => ({...photo}));
  for (const entry of entries) {
    if (!inScope(entry, scope) || !isPhotoOperation(entry) ||
        !["pending", "confirmed"].includes(entry.state) || entry.photoSettled) continue;
    const op = entry.operation, c = op.changes;
    const target = result.find(photo => photo.id === op.entityId && photo.animalId === c.animalId);
    if (!target) continue;
    if (op.action === "photo.crop") {
      Object.assign(target, {cropX: c.cropX, cropY: c.cropY, cropZoom: c.cropZoom});
    } else if (op.action === "photo.primary") {
      for (const photo of result) if (photo.animalId === c.animalId) photo.primary = photo.id === target.id;
    } else if (op.action === "photo.delete") {
      result = result.filter(photo => photo !== target);
      const remaining = result.filter(photo => photo.animalId === c.animalId);
      if (remaining.length && !remaining.some(photo => photo.primary)) remaining[0].primary = true;
    }
  }
  return result;
}

export async function rememberPhotoRevision(database, scope, photo, remote, verify) {
  const parentId = photo?.animalId ?? remote?.parentId;
  const remotePhoto = remote?.data && {...remote.data, animalId: remote.data.animalId ?? remote.parentId};
  if (!Number.isSafeInteger(remote?.revision) || remote.revision < 1 || remote.parentId !== parentId ||
      photoSnapshot(remotePhoto) !== photoSnapshot(photo)) return false;
  const id = photo?.id ?? remote.entityId;
  if (!id) return false;
  let remembered = false;
  await protectedTransaction(database, ["photos", "syncMeta", "operationOutbox"], "readwrite", tx => {
    const req = tx.objectStore("photos").get(id);
    req.onsuccess = () => {
      if (photoSnapshot(req.result) !== photoSnapshot(photo)) return;
      remembered = true;
      const meta = tx.objectStore("syncMeta");
      if (photo) meta.put({id: photoRevisionKey(id), userId: scope.userId, ownerId: scope.ownerId,
        revision: remote.revision, fingerprint: photoSnapshot(photo)});
      else meta.delete(photoRevisionKey(id));
      const outbox = tx.objectStore("operationOutbox"), rows = outbox.getAll();
      rows.onsuccess = () => {
        for (const entry of rows.result) {
          if (inScope(entry, scope) && isPhotoOperation(entry) && entry.state === "confirmed" && !entry.photoSettled &&
              entry.operation.entityId === id && entry.operation.changes.animalId === parentId &&
              Number.isSafeInteger(entry.receipt?.revision) && entry.receipt.revision <= remote.revision) {
            outbox.put({...entry, photoSettled: true});
          }
        }
      };
    };
  }, verify);
  return remembered;
}

export async function enqueuePhotoOperation(database, scope, operation, expectedPhoto, verify, validAnimal = () => true) {
  if (!actions.has(operation.action) || operation.action === "photo.create" || operation.ownerId !== scope.ownerId ||
      operation.entityId !== expectedPhoto.id || operation.changes.animalId !== expectedPhoto.animalId) throw Error("Fotografía inválida.");
  const c = operation.changes;
  if (operation.action === "photo.crop" && (![c.cropX, c.cropY, c.cropZoom].every(Number.isFinite) ||
      c.cropX < 0 || c.cropX > 100 || c.cropY < 0 || c.cropY > 100 || c.cropZoom < 1 || c.cropZoom > 3)) throw Error("Encuadre inválido.");
  // The guard, confirmed revision and enqueue share one encrypted, cross-tab
  // transaction. Two tabs cannot both capture an operation against this base.
  await protectedTransaction(database, ["animals", "photos", "syncMeta", "operationOutbox"], "readwrite", tx => {
    const animal = tx.objectStore("animals").get(c.animalId);
    animal.onsuccess = () => {
      if (!animal.result || !validAnimal(animal.result)) throw Error("El animal ya no está activo.");
      const photos = tx.objectStore("photos").getAll();
      photos.onsuccess = () => {
        const photo = photos.result.find(row => row.id === operation.entityId);
        if (!photo || photoSnapshot(photo) !== photoSnapshot(expectedPhoto)) throw Error("La fotografía cambió; actualiza la ficha.");
        if (operation.action === "photo.primary") {
          const primaries = photos.result.filter(row => row.animalId === c.animalId && row.primary);
          if (primaries.length > 1 || (primaries[0]?.id ?? null) !== c.previousPrimaryId) throw Error("La fotografía principal cambió; actualiza la ficha.");
        }
        const cache = tx.objectStore("syncMeta").get(photoRevisionKey(photo.id));
        cache.onsuccess = () => {
          const revision = cachedPhotoRevision(cache.result, photo, scope);
          if (revision === null || revision !== operation.baseRevision) throw Error("Sincroniza esta fotografía antes de editarla sin conexión.");
          const outbox = tx.objectStore("operationOutbox"), rows = outbox.getAll();
          rows.onsuccess = () => {
            if (rows.result.some(entry => inScope(entry, scope) && blocksPhotoChanges(entry) && entry.operation.changes.animalId === c.animalId)) {
              throw Error("Este animal tiene un cambio de fotografía pendiente. Sincronízalo o revisa su conflicto antes de otro cambio.");
            }
            outbox.add({id: operation.operationId, userId: scope.userId, ownerId: scope.ownerId, operation,
              state: "pending", attempts: 0, nextAt: 0, code: "", createdAt: operation.capturedAt});
          };
        };
      };
    };
  }, verify);
}
