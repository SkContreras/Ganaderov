import {unseal} from "./local-crypto.mjs";
import {readProtected, readProtectedRecord} from "./protected-store.mjs";
import {enqueueUniversalBatch, entityKind, fingerprint, latestEntityOperation, readQueue} from "./universal-outbox.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxRecords = 10000, maxPhotoBytes = 10 * 1024 * 1024, maxBackupBytes = 64 * 1024 * 1024;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const animalKeys = new Set(["tag", "name", "sex", "breed", "color", "cross", "markings", "officialId", "birthDate", "birthEstimated", "estimatedAge", "entryDate", "originType", "originName", "motherId", "fatherId", "weaningDate", "status", "lot", "paddock", "pen", "locationSince", "responsible", "exitReason", "exitNotes", "generalNotes"]);
const eventTypes = new Set(["weight", "bath", "vaccine", "deworm", "injection", "medication", "review", "note", "other"]);
const collections = {animals: "animal", events: "event", photos: "photo", journeys: "journey", forecasts: "forecast", deletedAnimals: "deletion"};
const plain = value => value && typeof value === "object" && !Array.isArray(value);
const clone = value => structuredClone(value);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, clone(value[key])]));
const same = (a, b) => fingerprint(a) === fingerprint(b);
const validId = id => typeof id === "string" && id.length > 0 && id.length <= 200;
const validDate = date => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
const crop = photo => ({cropX: photo.cropX ?? 50, cropY: photo.cropY ?? 50, cropZoom: photo.cropZoom ?? 1});
const defaultAnimalFields = animal => pick(animal, [...animalKeys]);
const defaultActive = animal => (animal?.status ?? "Activo") === "Activo";
const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const keyFor = (kind, id) => kind + ":" + id;

async function digest(value) {
  const bytes = value instanceof Blob ? await value.arrayBuffer() : new TextEncoder().encode(typeof value === "string" ? value : fingerprint(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function assertRecoveryClaim({scope, projectUrl, claimedBy, managerAllowed = false}, source) {
  if (!uuid.test(scope?.userId ?? "") || !uuid.test(scope?.ownerId ?? "") || !uuid.test(scope?.deviceId ?? "") ||
      claimedBy !== scope.userId || !projectUrl || !scope.database) throw Error("Confirma la cuenta y el rancho antes de revisar datos anteriores.");
  const expected = `ganadero-local-account-${encodeURIComponent(projectUrl)}-${scope.userId}-ranch-${scope.ownerId}`;
  if (scope.database.name !== expected) throw Error("El almacenamiento no corresponde a esta cuenta y proyecto.");
  if (source.kind === "conflict") {
    if (!managerAllowed && scope.userId !== scope.ownerId) throw Error("Se requiere un administrador para revisar el conflicto.");
    if (source.ownerId !== scope.ownerId) throw Error("El conflicto pertenece a otro rancho.");
  } else if (scope.userId !== scope.ownerId) {
    throw Error("Sólo el propietario puede reclamar una copia antigua sin atribución de cuenta.");
  }
  if (source.ownerId && source.ownerId !== scope.ownerId) throw Error("La copia pertenece a otro rancho.");
  if (source.projectUrl && source.projectUrl !== projectUrl) throw Error("La copia pertenece a otro proyecto.");
}

function check(options, source) {
  options.verify?.();
  assertRecoveryClaim(options, source);
}

// Opening a missing source is aborted, never upgraded or created. Even old
// plaintext records are read without generating a key or migrating the source.
async function openExisting(name) {
  if (indexedDB.databases && !(await indexedDB.databases()).some(info => info.name === name)) return null;
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name);
    let missing = false;
    open.onupgradeneeded = () => { missing = true; open.transaction.abort(); };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => missing ? resolve(null) : reject(open.error);
    open.onblocked = () => reject(Error("Cierra las pestañas antiguas antes de revisar esta copia."));
  });
}

async function readonlyRecord(database, store, id) {
  const row = await request(database.transaction(store, "readonly").objectStore(store).get(id));
  if (!row?.encryptedRecord) return row;
  if (!database.objectStoreNames.contains("syncMeta")) throw Error("Falta la clave de la copia protegida.");
  const savedKey = await request(database.transaction("syncMeta", "readonly").objectStore("syncMeta").get("local-key:records:" + database.name));
  if (!savedKey?.key) throw Error("Falta la clave de la copia protegida.");
  const value = await unseal(savedKey.key, JSON.stringify([database.name, store, id]), row.encryptedRecord);
  if (value.id !== row.id || ["animalId", "date", "targetDate", "updatedAt"].some(key => value[key] !== row[key])) throw Error("Registro protegido inválido.");
  if (value.__photo) {
    value.blob = new Blob([Uint8Array.from(value.__photo.bytes)], {type: value.__photo.mime});
    delete value.__photo;
  }
  return value;
}

async function readonlyKeys(database, store) {
  if (!database.objectStoreNames.contains(store)) return [];
  const tx = database.transaction(store, "readonly"), objectStore = tx.objectStore(store);
  const count = await request(objectStore.count());
  if (count > maxRecords) throw Error("Esta copia supera 10 000 registros por colección; divídela antes de revisarla.");
  return request(database.transaction(store, "readonly").objectStore(store).getAllKeys());
}

export function legacyDatabaseSource(ownerId) {
  if (!uuid.test(ownerId)) throw Error("Rancho inválido.");
  const databaseName = "ganadero-local-ranch-" + ownerId;
  return Object.freeze({kind: "database", id: databaseName, label: "Datos del almacenamiento anterior", ownerId, databaseName});
}

export function backupRecoverySource(payload, name = "Copia JSON") {
  if (!plain(payload) || payload.format !== "ganadero-backup" || payload.version !== 1 ||
      !["animals", "events", "photos"].every(key => Array.isArray(payload[key]))) throw Error("El archivo no es una copia compatible de Ganadero.");
  const text = JSON.stringify(payload);
  if (new TextEncoder().encode(text).byteLength > maxBackupBytes) throw Error("La copia supera 64 MB; divídela antes de importarla.");
  // The caller cannot mutate the captured backup after the user has reviewed it.
  return Object.freeze({kind: "backup", id: "backup:" + name, label: name,
    ownerId: payload.ownerId ?? payload.scope?.ownerId, projectUrl: payload.projectUrl ?? payload.scope?.projectUrl,
    readPayload: () => JSON.parse(text)});
}

export function conflictRecoverySource(snapshot, backupId) {
  if (!snapshot?.id?.startsWith("conflict:") || !["animal", "journey", "config"].includes(snapshot.kind) || !validId(snapshot.entityId)) throw Error("Conflicto anterior inválido.");
  if (backupId !== undefined && !/^legacy-conflict:[a-f0-9]{64}$/.test(backupId)) throw Error("Respaldo de conflicto inválido.");
  return Object.freeze({kind: "conflict", id: snapshot.id, label: `Conflicto de ${snapshot.kind} · ${snapshot.entityId}${backupId ? " · Copia conservada" : ""}`,
    ownerId: snapshot.ownerId, conflictId: snapshot.id, ...(backupId ? {backupId} : {})});
}

function conflictVersion(snapshot) {
  return pick(snapshot, ["kind", "entityId", "base", "local", "remote", "version"]);
}

export async function conflictRecoveryBackupId(snapshot) {
  return "legacy-conflict:" + await digest(conflictVersion(snapshot));
}

async function conflictOriginal(database, snapshot, id) {
  if (database.objectStoreNames.contains("legacyRecovery")) {
    const saved = await readProtectedRecord(database, "legacyRecovery", await conflictRecoveryBackupId(snapshot) + ":photo:" + id);
    if (saved?.blob instanceof Blob && saved.ownerId === snapshot.ownerId) return saved.blob;
  }
  return (await readProtectedRecord(database, "photos", id))?.blob;
}

async function readConflictSnapshot(source, options) {
  let snapshot;
  if (source.backupId) {
    if (!options.scope.database.objectStoreNames.contains("legacyRecovery")) throw Error("La copia del conflicto no está disponible.");
    const backup = await readProtectedRecord(options.scope.database, "legacyRecovery", source.backupId);
    if (backup?.ownerId !== options.scope.ownerId || backup.userId !== options.scope.userId) throw Error("La copia del conflicto pertenece a otra cuenta.");
    snapshot = backup.source;
    if (!snapshot || await conflictRecoveryBackupId(snapshot) !== source.backupId) throw Error("Identidad de respaldo inválida.");
  } else snapshot = await readProtectedRecord(options.scope.database, "syncMeta", source.conflictId);
  check(options, source);
  if (!snapshot || snapshot.ownerId !== options.scope.ownerId || snapshot.id !== source.conflictId) throw Error("El conflicto ya cambió o no pertenece a este rancho.");
  return snapshot;
}

function dataUrlBlob(value, declaredMime) {
  if (typeof value !== "string" || value.length > Math.ceil(maxPhotoBytes * 4 / 3) + 128) throw Error("Original de fotografía inválido o mayor de 10 MB.");
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || declaredMime && declaredMime !== match[1]) throw Error("La fotografía debe contener un original JPEG, PNG o WebP en base64.");
  let binary;
  try { binary = atob(match[2]); } catch (_) { throw Error("Original de fotografía inválido."); }
  const bytes = Uint8Array.from(binary, letter => letter.charCodeAt(0));
  if (!bytes.length || bytes.length > maxPhotoBytes) throw Error("Original de fotografía inválido o mayor de 10 MB.");
  return new Blob([bytes], {type: match[1]});
}

function baseData(metadata) {
  const bases = new Map();
  for (const row of metadata) {
    if (typeof row.fingerprint !== "string") continue;
    let value;
    try { value = JSON.parse(row.fingerprint); } catch (_) { continue; }
    if (row.id.startsWith("animal:")) {
      if (value?.animal) bases.set(keyFor("animal", value.animal.id), value.animal);
      for (const [collection, kind] of Object.entries(collections)) for (const item of value?.[collection] ?? []) {
        if (plain(item) && validId(item.id)) bases.set(keyFor(kind, item.id), item);
      }
    } else if (row.id.startsWith("journey:") && plain(value)) bases.set(keyFor("journey", row.id.slice(8)), value);
  }
  return bases;
}

function conflictPayload(snapshot) {
  if (snapshot.kind === "config") return {animalSettings: snapshot.local};
  if (snapshot.kind === "journey") return {journeys: [snapshot.local], bases: new Map([[keyFor("journey", snapshot.entityId), snapshot.base]])};
  const local = snapshot.local ?? {}, base = snapshot.base ?? {}, bases = new Map();
  if (base.animal) bases.set(keyFor("animal", snapshot.entityId), base.animal);
  for (const name of ["events", "photos", "forecasts"]) for (const item of base[name] ?? []) bases.set(keyFor(collections[name], item.id), item);
  return {animals: local.animal ? [local.animal] : [], events: local.events ?? [], photos: local.photos ?? [], forecasts: local.forecasts ?? [],
    deletedAnimals: local.deletedAt ? [{id: snapshot.entityId, deletedAt: local.deletedAt}] : [], bases};
}

async function entriesFromPayload(payload, source, photoReader, verify) {
  const entries = [], seen = new Set(), bases = payload.bases ?? baseData(payload.syncMeta ?? []);
  for (const [collection, kind] of Object.entries(collections)) {
    const rows = payload[collection] ?? [];
    if (!Array.isArray(rows) || rows.length > maxRecords) throw Error("Colección inválida o demasiado grande en la copia.");
    for (const raw of rows) {
      verify();
      if (!plain(raw) || !validId(raw.id)) throw Error("La copia contiene un registro sin identificador válido.");
      const key = keyFor(kind, raw.id);
      if (seen.has(key)) throw Error("La copia repite el identificador " + raw.id + ".");
      seen.add(key);
      const local = clone(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "blob" && key !== "data")));
      let photoHash = null, originalBytes = 0, originalError = "";
      if (kind === "photo") {
        try {
          const blob = await photoReader(raw.id, raw);
          if (blob) {
            if (!(blob instanceof Blob) || !imageTypes.has(blob.type) || blob.size < 1 || blob.size > maxPhotoBytes || local.mime && local.mime !== blob.type) throw Error("Original inválido o mayor de 10 MB.");
            photoHash = await digest(blob); originalBytes = blob.size; local.mime = blob.type;
          } else originalError = "Falta el original de esta fotografía.";
        } catch (error) { originalError = error.message; }
      }
      const base = bases.get(key);
      const entry = {key, kind, id: raw.id, local, base, photoHash, originalBytes, originalError, sourceId: source.id};
      entry.fingerprint = await digest({kind, local, base, photoHash, originalBytes, originalError});
      entries.push(entry);
    }
  }
  if (payload.animalSettings !== undefined && payload.animalSettings !== null) {
    if (!plain(payload.animalSettings)) throw Error("La copia contiene una configuración inválida.");
    const local = clone(payload.animalSettings), id = source.ownerId;
    entries.unshift({key: keyFor("config", id), kind: "config", id, local, sourceId: source.id,
      fingerprint: await digest({kind: "config", id, local})});
  }
  return entries;
}

export async function scanRecoverySource(source, options) {
  check(options, source);
  let payload, snapshot, photoReader;
  if (source.kind === "backup") {
    payload = source.readPayload();
    source = {...source, ownerId: options.scope.ownerId};
    photoReader = async (id, raw) => dataUrlBlob(raw.data, raw.mime);
  } else if (source.kind === "conflict") {
    snapshot = await readConflictSnapshot(source, options);
    payload = conflictPayload(snapshot);
    photoReader = async id => conflictOriginal(options.scope.database, snapshot, id);
  } else if (source.kind === "database") {
    if (source.databaseName !== "ganadero-local-ranch-" + options.scope.ownerId) throw Error("Origen anterior inválido.");
    const database = await openExisting(source.databaseName);
    check(options, source);
    if (!database) return {source, entries: [], sourceFingerprint: "missing"};
    try {
      payload = {};
      const storeNames = {animals: "animals", events: "events", photos: "photos", journeys: "journeys", forecasts: "growthForecasts", deletedAnimals: "deletedAnimals", syncMeta: "syncMeta"};
      for (const [collection, store] of Object.entries(storeNames)) {
        payload[collection] = [];
        for (const id of await readonlyKeys(database, store)) {
          if (store === "syncMeta" && (String(id).startsWith("local-key:") || String(id).startsWith('["incremental-v1",'))) continue;
          const row = await readonlyRecord(database, store, id);
          check(options, source);
          if (row) {
            if (store === "photos") { const metadata = {...row}; delete metadata.blob; payload[collection].push(metadata); }
            else payload[collection].push(row);
          }
        }
      }
      if (database.objectStoreNames.contains("ranchSettings")) {
        const config = await readonlyRecord(database, "ranchSettings", "animal-fields");
        if (config?.config) payload.animalSettings = config.config;
      }
      photoReader = async id => (await readonlyRecord(database, "photos", id))?.blob;
      const entries = await entriesFromPayload(payload, source, photoReader, () => check(options, source));
      check(options, source);
      return {source, entries, sourceFingerprint: await digest(entries.map(entry => [entry.key, entry.fingerprint]))};
    } finally { database.close(); }
  } else throw Error("Origen de recuperación desconocido.");
  const entries = await entriesFromPayload(payload, source, photoReader, () => check(options, source));
  check(options, source);
  return {source, entries, snapshot, sourceFingerprint: await digest({entries: entries.map(entry => [entry.key, entry.fingerprint]), snapshot: snapshot && conflictVersion(snapshot)})};
}

function remoteValue(remote) {
  if (!plain(remote) || !Number.isSafeInteger(remote.revision) || remote.revision < 0 ||
      remote.data !== null && !plain(remote.data)) throw Error("El servidor no devolvió una revisión válida.");
  return {revision: remote.revision, data: clone(remote.data), parentId: remote.parentId ?? null};
}

function safeFields(value, fields) {
  const selected = fields(value);
  if (!plain(selected) || Object.keys(selected).some(key => !animalKeys.has(key))) throw Error("Campos de animal inválidos.");
  for (const [key, val] of Object.entries(selected)) {
    if (key === "birthEstimated" ? typeof val !== "boolean" : key === "estimatedAge" ? val !== null && !["object", "number"].includes(typeof val) : val !== null && (typeof val !== "string" || val.length > 4000)) throw Error("Valor inválido para " + key + ".");
    if (["birthDate", "entryDate", "weaningDate", "locationSince"].includes(key) && val && !validDate(val)) throw Error("Fecha inválida para " + key + ".");
  }
  return selected;
}

function eventFields(local) {
  if (!validId(local.animalId) || !eventTypes.has(local.type) || !validDate(local.date)) throw Error("Actividad anterior inválida.");
  const value = {animalId: local.animalId, type: local.type, date: local.date};
  if (local.type === "weight") {
    if (!Number.isFinite(local.weight) || local.weight < 0 || local.weight > 100000) throw Error("Peso anterior inválido.");
    value.weight = local.weight;
  }
  for (const [key, raw, limit] of [["product", local.label ?? local.product ?? "", 120], ["notes", local.notes ?? "", 2000]]) {
    if (typeof raw !== "string" || raw.length > limit) throw Error("Actividad anterior inválida.");
    value[key] = raw;
  }
  if (local.type === "note" && !value.notes.trim()) throw Error("La nota anterior no contiene texto.");
  return value;
}

// Plans contain only protocol-supported, explicit changes. Missing objects in
// a backup never become deletions; fields generated by the server are excluded.
export function planRecoveryEntry(entry, remoteInput, options = {}) {
  const remote = remoteValue(remoteInput), local = entry.local, current = remote.data;
  const fields = options.animalFields ?? defaultAnimalFields, active = options.isActiveAnimal ?? defaultActive;
  const result = {entry, remote, choices: [], notices: [], blocked: ""};
  const choice = (key, label, value, server, actions, base) => {
    if (!same(value, server)) result.choices.push({key, label, local: clone(value), remote: clone(server), base: clone(base),
      concurrent: base !== undefined && !same(value, base) && !same(server, base), actions});
  };
  const action = (name, changes) => ({action: name, id: entry.id, changes});
  try {
    if (entry.kind === "deletion") throw Error("Esta copia registra un borrado definitivo. Consérvala y archiva la ficha desde el inventario; no se convertirá en un borrado automático.");
    if (!current && remote.revision > 0 && entry.kind !== "config") throw Error("El servidor conserva la eliminación de este registro. No se recreará automáticamente.");
    if (!current && entry.kind !== "config" && !uuid.test(entry.id)) throw Error("Este identificador antiguo no permite un alta segura. Conserva la copia y crea el registro desde su formulario.");
    if (entry.kind === "animal") {
      const localFields = safeFields(local, fields);
      if (!current) {
        if (!String(localFields.tag ?? "").trim()) throw Error("El animal anterior no tiene un arete válido.");
        choice("create", "Crear animal", localFields, null, [action("animal.create", {fields: localFields})]);
      } else {
        const currentFields = safeFields(current, fields), base = entry.base ? safeFields(entry.base, fields) : {};
        for (const [key, value] of Object.entries(localFields)) {
          if (key === "status" && active(local) !== active(current)) {
            choice(key, active(local) ? "Reactivar animal" : "Archivar animal", value, currentFields[key], [action(active(local) ? "animal.restore" : "animal.archive",
              {status: value, ...(!active(local) ? {exitReason: local.exitReason ?? "", exitNotes: local.exitNotes ?? ""} : {})})], base[key]);
          } else if (!["exitReason", "exitNotes"].includes(key) || active(local) === active(current)) {
            choice(key, key, value, currentFields[key], [action("animal.update", {fields: {[key]: value}})], base[key]);
          }
        }
      }
      const target = {minimum: local.targetWeightMin ?? null, maximum: local.targetWeightMax ?? null};
      if (Object.hasOwn(local, "targetWeightMin") || Object.hasOwn(local, "targetWeightMax")) {
        if ([target.minimum, target.maximum].some(x => x !== null && (!Number.isFinite(x) || x < 0 || x > 100000)) ||
            (target.minimum === null) !== (target.maximum === null) || target.minimum > target.maximum) throw Error("Meta de peso anterior inválida.");
        choice("target", "Meta de peso", target, {minimum: current?.targetWeightMin ?? null, maximum: current?.targetWeightMax ?? null}, [action("animal.target.update", target)]);
      }
    } else if (entry.kind === "event") {
      if (local.journeyId || current?.journeyId) throw Error("Esta actividad pertenece a una jornada. Recupera la jornada para conservar su relación con la asistencia.");
      const desired = eventFields(local);
      if (!current) choice("create", "Crear actividad", desired, null, [action("event.create", desired)]);
      else {
        if (remote.parentId !== local.animalId || current.type !== local.type) throw Error("La actividad del servidor tiene otro animal o tipo.");
        const prior = eventFields({...current, animalId: local.animalId});
        for (const key of ["date", "weight", "product", "notes"]) if (Object.hasOwn(desired, key)) {
          choice(key, key, desired[key], prior[key], [action("event.update", {animalId: local.animalId, [key]: desired[key]})], entry.base?.[key === "product" ? "label" : key]);
        }
        if (result.choices.length) result.requiresReason = true;
      }
    } else if (entry.kind === "photo") {
      if (!validId(local.animalId)) throw Error("La fotografía no tiene un animal válido.");
      const desired = crop(local);
      if (!Number.isFinite(desired.cropX) || desired.cropX < 0 || desired.cropX > 100 || !Number.isFinite(desired.cropY) || desired.cropY < 0 || desired.cropY > 100 ||
          !Number.isFinite(desired.cropZoom) || desired.cropZoom < 1 || desired.cropZoom > 3) throw Error("Encuadre anterior inválido.");
      if (!current) {
        if (!entry.photoHash || entry.originalError) throw Error(entry.originalError || "Falta el original de la fotografía.");
        if (!imageTypes.has(local.mime) || typeof local.name !== "string" || local.name.length > 120) throw Error("Metadatos de fotografía inválidos.");
        const actions = [action("photo.create", {animalId: local.animalId, mime: local.mime, name: local.name, primary: Boolean(local.primary)})];
        if (!same(desired, crop({}))) actions.push(action("photo.crop", {animalId: local.animalId, ...desired}));
        choice("create", "Crear fotografía con su original y encuadre", {...local, originalSha256: entry.photoHash}, null, actions);
      } else {
        if (remote.parentId !== local.animalId || current.animalId && current.animalId !== local.animalId ||
            current.storagePath !== `${options.scope?.ownerId}/${local.animalId}/${entry.id}`) throw Error("La fotografía remota no tiene una ruta canónica del mismo animal.");
        choice("crop", "Encuadre", desired, crop(current), [action("photo.crop", {animalId: local.animalId, ...desired})], entry.base && crop(entry.base));
        if (local.primary && !current.primary) {
          if (!Array.isArray(options.photoFamily)) result.notices.push("Revisa la fotografía principal desde la galería: falta la comparación del álbum actual.");
          else {
            const primaries = options.photoFamily.filter(photo => photo.primary === true);
            if (primaries.length > 1 || !options.photoFamily.some(photo => photo.id === entry.id)) throw Error("El álbum remoto requiere revisión.");
            const previousPrimaryId = primaries[0]?.id ?? null;
            choice("primary", "Usar como fotografía principal", entry.id, previousPrimaryId,
              [action("photo.primary", {animalId: local.animalId, previousPrimaryId})]);
          }
        }
        if (current.name !== local.name || current.mime !== local.mime) result.notices.push("El nombre, el formato y los bytes del original remoto no se reemplazan; se conservan en la copia anterior.");
      }
    } else if (entry.kind === "config") {
      const value = options.configPayload ? options.configPayload(local) : local;
      if (!plain(value) || !Object.keys(value).length) throw Error("Configuración anterior inválida.");
      choice("config", "Configuración de campos y listas", value, current, [action("config.update", {config: clone(value)})]);
    } else if (entry.kind === "forecast") {
      if (current) {
        if (!same(pick(local, ["animalId", "baselineWeight", "baselineDate", "gainKgPerDay", "days"]), pick(current, ["animalId", "baselineWeight", "baselineDate", "gainKgPerDay", "days"]))) throw Error("Una estimación confirmada no se reemplaza. Conserva la copia y crea una nueva desde su formulario.");
      } else {
        const value = pick(local, ["animalId", "baselineWeight", "baselineDate", "gainKgPerDay", "days"]);
        if (!validId(value.animalId) || !validDate(value.baselineDate) || !Number.isFinite(value.baselineWeight) || value.baselineWeight < 0 || value.baselineWeight > 100000 ||
            !Number.isFinite(value.gainKgPerDay) || value.gainKgPerDay < -100 || value.gainKgPerDay > 100 || !Number.isInteger(value.days) || value.days < 1 || value.days > 3650) throw Error("Estimación anterior inválida.");
        if (local.status === "evaluated") result.notices.push("Se recuperará la estimación de partida. Los resultados de evaluación quedan en el respaldo para su revisión.");
        choice("create", "Crear estimación de crecimiento", value, null, [action("forecast.create", value)]);
      }
    } else if (entry.kind === "journey") {
      const actions = journeyActions(entry, remote);
      if (actions.length) choice("journey", "Recuperar asistencia y estado de la jornada", local, current, actions, entry.base);
    } else throw Error("Tipo de registro anterior desconocido.");
  } catch (error) { result.blocked = error.message; result.choices = []; }
  return result;
}

function journeyActions(entry, remote) {
  const local = entry.local, current = remote.data, actions = [];
  const action = (name, changes) => actions.push({action: name, id: entry.id, changes});
  if (!eventTypes.has(local.type) || local.type === "note" || !validDate(local.date) || !Array.isArray(local.roster) || !local.roster.length || local.roster.length > 1000 ||
      new Set(local.roster.map(animal => animal.id)).size !== local.roster.length || local.roster.some(animal => !validId(animal.id)) ||
      !["in_progress", "incomplete", "completed"].includes(local.status)) throw Error("Jornada anterior inválida.");
  const header = {type: local.type, date: local.date, ...Object.fromEntries(["name", "product", "dose", "notes"].map(key => [key, local[key] ?? ""]))};
  if (["name", "product", "dose"].some(key => typeof header[key] !== "string" || header[key].length > 120) || typeof header.notes !== "string" || header.notes.length > 2000 || local.type === "other" && !header.name.trim()) throw Error("Jornada anterior inválida.");
  if (current && (!Array.isArray(current.roster) || !same(header, {type: current.type, date: current.date, ...Object.fromEntries(["name", "product", "dose", "notes"].map(key => [key, current[key] ?? ""]))}))) throw Error("La cabecera de la jornada cambió. Su reemplazo no es una operación válida; conserva la copia para revisión.");
  const before = new Map((current?.roster ?? []).map(animal => [animal.id, animal]));
  if (current && local.roster.some(animal => before.get(animal.id)?.attended && (!animal.attended || local.type === "weight" && animal.weight !== before.get(animal.id).weight))) throw Error("La jornada contiene una corrección o retirada de asistencia. Revísala desde su jornada para preservar la relación con el historial.");
  const additions = local.roster.filter(animal => !before.has(animal.id));
  const attend = local.roster.filter(animal => animal.attended && !before.get(animal.id)?.attended);
  if (current?.status === "completed" && (additions.length || attend.length || local.status !== "completed")) throw Error("La jornada confirmada está completa; no admite esta transición anterior.");
  if (!current) action("journey.create", {...header, animalIds: local.roster.map(animal => animal.id)});
  else if (current.status === "incomplete" && (local.status === "in_progress" || additions.length || attend.length)) action("journey.resume", {});
  if (current && additions.length) action("journey.add_animals", {animalIds: additions.map(animal => animal.id)});
  for (const animal of attend) {
    if (local.type === "weight" && (!Number.isFinite(animal.weight) || animal.weight < 0 || animal.weight > 100000)) throw Error("La asistencia contiene un peso inválido.");
    action("journey.attend", {animalId: animal.id, ...(local.type === "weight" ? {weight: animal.weight} : {})});
  }
  const inProgress = !current || current.status === "in_progress" || actions.some(item => item.action === "journey.resume");
  if (inProgress && local.status !== "in_progress") {
    if (local.status === "completed" && local.roster.some(animal => !animal.attended)) throw Error("La jornada anterior figura completa pero tiene animales pendientes.");
    action("journey.finish", {allowIncomplete: local.status === "incomplete"});
  }
  return actions;
}

export async function reviewRecoveryEntry(scan, entry, options) {
  check(options, scan.source);
  const kind = entry.kind === "deletion" ? "animal" : entry.kind;
  const remote = remoteValue(await options.readEntity(kind, entry.id));
  check(options, scan.source);
  let photoFamily;
  if (entry.kind === "photo" && remote.data && entry.local.primary && !remote.data.primary && options.readPhotos) {
    photoFamily = await options.readPhotos(entry.local.animalId);
    check(options, scan.source);
  }
  const review = planRecoveryEntry(entry, remote, {...options, photoFamily});
  return {...review, source: scan.source, sourceFingerprint: scan.sourceFingerprint, snapshot: scan.snapshot, photoFamily};
}

export function selectedRecoveryActions(review, selected, {reason = "", isActiveAnimal = defaultActive} = {}) {
  if (review.blocked) throw Error(review.blocked);
  if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(key => !review.choices.some(choice => choice.key === key))) throw Error("Selecciona los cambios que revisaste.");
  const chosen = review.choices.filter(choice => selected.includes(choice.key));
  let actions = chosen.flatMap(choice => clone(choice.actions));
  if (review.entry.kind === "animal") {
    const update = Object.assign({}, ...actions.filter(item => item.action === "animal.update").map(item => item.changes.fields));
    actions = actions.filter(item => item.action !== "animal.update");
    if (Object.keys(update).length) actions.push({action: "animal.update", id: review.entry.id, changes: {fields: update}});
    const rank = item => ({"animal.create": 0, "animal.restore": 0, "animal.update": 1, "animal.target.update": 2, "animal.archive": 3})[item.action];
    actions.sort((a, b) => rank(a) - rank(b));
    if (review.remote.data && !isActiveAnimal(review.remote.data) && !actions.some(item => item.action === "animal.restore") && actions.some(item => item.action !== "animal.archive")) throw Error("Selecciona también la reactivación antes de modificar un animal archivado.");
    if (!review.remote.data && !selected.includes("create")) throw Error("Selecciona primero el alta del animal.");
  } else if (review.entry.kind === "event" && review.remote.data) {
    if (!reason.trim() || reason.trim().length > 2000) throw Error("Indica el motivo de la corrección (máximo 2000 caracteres).");
    actions = [{action: "event.update", id: review.entry.id,
      changes: {...Object.assign({}, ...actions.map(item => item.changes)), reason: reason.trim()}}];
  }
  if (actions.length > 100) throw Error("Esta recuperación supera 100 operaciones. Divide la jornada antes de convertirla.");
  return actions;
}

async function originalFor(source, entry, options) {
  check(options, source);
  let blob;
  if (source.kind === "backup") {
    const photo = source.readPayload().photos.find(item => item.id === entry.id);
    blob = dataUrlBlob(photo?.data, photo?.mime);
  } else if (source.kind === "conflict") {
    const snapshot = await readConflictSnapshot(source, options);
    blob = await conflictOriginal(options.scope.database, snapshot, entry.id);
  }
  else {
    const database = await openExisting(source.databaseName);
    if (!database) throw Error("El almacenamiento anterior ya no está disponible.");
    try { blob = (await readonlyRecord(database, "photos", entry.id))?.blob; } finally { database.close(); }
  }
  check(options, source);
  if (!(blob instanceof Blob) || blob.size !== entry.originalBytes || await digest(blob) !== entry.photoHash) throw Error("El original cambió. Vuelve a revisar la fotografía.");
  return blob;
}

export async function convertRecoveryReview(review, selected, options) {
  check(options, review.source);
  const actions = selectedRecoveryActions(review, selected, options);
  const scan = await scanRecoverySource(review.source, options), latest = scan.entries.find(entry => entry.key === review.entry.key);
  if (!latest || latest.fingerprint !== review.entry.fingerprint || scan.sourceFingerprint !== review.sourceFingerprint) throw Error("La copia anterior cambió. Vuelve a revisarla antes de convertir.");
  const fresh = await reviewRecoveryEntry(scan, latest, options);
  if (!same(fresh.remote, review.remote) || !same(fresh.photoFamily, review.photoFamily) || !same(fresh.choices, review.choices)) throw Error("El registro cambió en el servidor. Compara de nuevo antes de convertir.");
  check(options, review.source);
  const rows = await readQueue(options.scope.database, options.scope);
  const firstAction = actions[0];
  if (latestEntityOperation(rows, firstAction.action, firstAction.id)) throw Error("Este registro ya tiene una operación pendiente o un conflicto. Revísalo primero en Sincronización.");
  const conversionKey = "legacy-v1:" + await digest([options.projectUrl, options.scope.userId, options.scope.ownerId,
    review.source.id, review.entry.key, review.entry.fingerprint, selected.slice().sort()]);
  const items = [], stamp = new Date().toISOString();
  let sequence = Math.max(0, ...rows.map(row => row.sequence ?? 0));
  for (let index = 0; index < actions.length; index++) {
    const descriptor = actions[index], previous = latestEntityOperation(rows, descriptor.action, descriptor.id);
    if (previous && !["pending", "confirmed"].includes(previous.state)) throw Error("Una operación previa requiere revisión.");
    const create = descriptor.action.endsWith(".create"), dependencies = new Set();
    const parentIds = [descriptor.changes.animalId, ...(descriptor.changes.animalIds ?? []), descriptor.changes.fields?.motherId, descriptor.changes.fields?.fatherId].filter(Boolean);
    for (const parentId of parentIds) {
      const parent = latestEntityOperation(rows, "animal.update", parentId);
      if (parent) {
        if (!["pending", "confirmed"].includes(parent.state)) throw Error("El animal asociado tiene un conflicto pendiente.");
        dependencies.add(parent.id);
      } else {
        const parent = remoteValue(await options.readEntity("animal", parentId));
        check(options, review.source);
        if (!parent.data) throw Error("Recupera primero el animal asociado a este registro.");
      }
    }
    if (descriptor.action.startsWith("animal.") || descriptor.action === "journey.create") {
      const config = latestEntityOperation(rows, "config.update", options.scope.ownerId);
      if (config) {
        if (!["pending", "confirmed"].includes(config.state)) throw Error("La configuración tiene un conflicto pendiente.");
        dependencies.add(config.id);
      }
    }
    if (descriptor.action.startsWith("photo.")) {
      const previousPhoto = rows.filter(row => row.operation.action.startsWith("photo.") && row.operation.changes.animalId === descriptor.changes.animalId &&
        row.state !== "archived" && !(row.state === "confirmed" && (row.photoSettled || row.settled))).at(-1);
      if (previousPhoto) {
        if (!["pending", "confirmed"].includes(previousPhoto.state)) throw Error("El álbum tiene un conflicto pendiente.");
        dependencies.add(previousPhoto.id);
      }
    }
    const baseOperationId = !create ? previous?.id ?? null : null;
    if (baseOperationId) dependencies.add(baseOperationId);
    const operation = {protocolVersion: 1, operationId: crypto.randomUUID(), ownerId: options.scope.ownerId, deviceId: options.scope.deviceId,
      action: descriptor.action, entityId: descriptor.id, baseRevision: create || baseOperationId ? null : fresh.remote.revision, capturedAt: stamp, changes: descriptor.changes};
    const item = {operation, expectedLastId: previous?.id ?? null, baseOperationId, dependsOn: [...dependencies], recoveryKey: conversionKey + ":" + index};
    if (descriptor.action === "photo.create") item.blob = await originalFor(review.source, latest, options);
    items.push(item);
    rows.push({id: operation.operationId, operation, userId: options.scope.userId, ownerId: options.scope.ownerId,
      state: "pending", createdAt: stamp, sequence: ++sequence});
  }
  check(options, review.source);
  // A worker or another tab can deliver immediately after enqueue. Therefore
  // the current canonical conflict and every original must be preserved and
  // linked before any recovery operation becomes visible to that sender.
  if (review.source.kind === "conflict") {
    if (typeof options.prepareConflict !== "function") throw Error("Falta preparar el respaldo protegido del conflicto.");
    await options.prepareConflict(scan.snapshot);
    check(options, review.source);
  }
  const ids = await enqueueUniversalBatch(options.scope.database, options.scope, items, () => check(options, review.source));
  let reconciliationError = null;
  if (review.source.kind === "conflict" && options.reconcileConflict) {
    try { await options.reconcileConflict(scan.snapshot, ids); }
    catch (error) { reconciliationError = error.message; }
  }
  check(options, review.source);
  await options.onQueued?.(ids);
  return {operationIds: ids, reconciliationError};
}

function element(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
const visibleValue = value => value === undefined ? "Sin dato" : typeof value === "string" ? value || "Vacío" : JSON.stringify(value, null, 2);

// User-facing entry point shared by the outbox and JSON backup import. The
// container belongs to the caller's dialog; this function never opens one.
export async function mountLegacyRecovery(container, options) {
  options.verify?.();
  if (options.scope?.userId !== options.scope?.ownerId && !options.managerAllowed) return null;
  const section = element("section"), heading = element("h3", options.source ? "Revisar copia antes de importar" : "Recuperar datos anteriores");
  section.dataset.legacyRecovery = "true";
  const help = element("p", "Compara con el servidor y selecciona qué recuperar. El original se conserva. Los datos ausentes en la copia no se eliminan del rancho.");
  const claimLabel = element("label"), claim = element("input"); claim.type = "checkbox"; claim.dataset.recoveryClaim = "true";
  claimLabel.append(claim, document.createTextNode(" Confirmo que esta copia corresponde a esta cuenta y este rancho, y tengo autorización para recuperarla."));
  const scanButton = element("button", options.source ? "Comparar esta copia" : "Buscar datos anteriores"); scanButton.type = "button"; scanButton.disabled = true; scanButton.className = "button button-outline";
  const status = element("p"), content = element("div"); status.setAttribute("role", "status");
  claim.onchange = () => { scanButton.disabled = !claim.checked; };
  section.append(heading, help, claimLabel, scanButton, status, content); container.append(section);
  const sessionOptions = () => ({...options, claimedBy: claim.checked ? options.scope.userId : null});
  let busy = false;
  scanButton.onclick = async () => {
    if (busy) return;
    busy = true; scanButton.disabled = true; content.replaceChildren(); status.textContent = "Leyendo la copia conservada…";
    try {
      const activeOptions = sessionOptions();
      let sources = options.source ? [options.source] : [];
      if (!options.source) {
        if (options.scope.userId === options.scope.ownerId) sources.push(legacyDatabaseSource(options.scope.ownerId));
        const snapshots = (await readProtected(options.scope.database, "syncMeta"))
          .filter(row => row.id.startsWith("conflict:") && row.ownerId === options.scope.ownerId && ["animal", "journey", "config"].includes(row.kind));
        options.verify?.();
        const versions = new Set();
        for (const snapshot of snapshots) {
          sources.push(conflictRecoverySource(snapshot)); versions.add(await conflictRecoveryBackupId(snapshot));
        }
        // Read only metadata keys here. Original blobs may be large and are
        // decrypted individually when their entry is inspected or converted.
        for (const id of await readonlyKeys(options.scope.database, "legacyRecovery")) {
          if (!/^legacy-conflict:[a-f0-9]{64}$/.test(id) || versions.has(id)) continue;
          const backup = await readProtectedRecord(options.scope.database, "legacyRecovery", id); options.verify?.();
          if (backup?.ownerId === options.scope.ownerId && backup.userId === options.scope.userId && backup.source) sources.push(conflictRecoverySource(backup.source, id));
        }
      }
      let total = 0;
      for (const source of sources) {
        const scan = await scanRecoverySource(source, activeOptions); total += scan.entries.length;
        if (!scan.entries.length) continue;
        content.append(element("h4", source.label));
        let rendered = 0;
        const more = element("button", "Mostrar más registros"); more.type = "button";
        const addPage = () => {
          const batch = scan.entries.slice(rendered, rendered + 100); rendered += batch.length;
          for (const entry of batch) {
            const details = element("details"), title = element("summary", `${entry.kind} · ${entry.local.tag || entry.local.name || entry.id}`);
            details.dataset.recoveryEntry = entry.key;
            const reviewButton = element("button", "Revisar con el servidor"); reviewButton.type = "button";
            const preview = element("div"); details.append(title, reviewButton, preview); content.insertBefore(details, more);
            reviewButton.onclick = async () => {
              reviewButton.disabled = true; preview.replaceChildren(element("p", "Comprobando la revisión actual…"));
              try {
                const review = await reviewRecoveryEntry(scan, entry, sessionOptions()); preview.replaceChildren();
                if (review.blocked) preview.append(element("p", review.blocked));
                for (const notice of review.notices) preview.append(element("p", notice));
                if (!review.blocked && !review.choices.length) preview.append(element("p", "No hay cambios editables distintos del servidor."));
                if (review.choices.length) {
                  const fields = element("fieldset"), legend = element("legend", "Selecciona los valores de la copia que quieres recuperar"); fields.append(legend);
                  const selectors = [];
                  for (const choice of review.choices) {
                    const label = element("label"), checkbox = element("input"), pre = element("pre"); checkbox.type = "checkbox"; checkbox.value = choice.key;
                    label.append(checkbox, document.createTextNode(" " + choice.label + (choice.concurrent ? " · ambos cambiaron desde la última sincronización" : "")));
                    pre.style.whiteSpace = "pre-wrap"; pre.style.overflowWrap = "anywhere";
                    pre.textContent = "Copia: " + visibleValue(choice.local) + "\nServidor: " + visibleValue(choice.remote) +
                      (choice.base !== undefined ? "\nÚltimo dato sincronizado: " + visibleValue(choice.base) : "") +
                      "\nOperaciones: " + choice.actions.map(action => action.action).join(" → ");
                    fields.append(label, pre); selectors.push(checkbox);
                  }
                  preview.append(fields);
                  let reason;
                  if (review.requiresReason) {
                    const label = element("label", "Motivo de la corrección"); reason = element("textarea"); reason.maxLength = 2000; label.append(reason); preview.append(label);
                  }
                  const convert = element("button", "Convertir selección a operaciones"), result = element("p"); convert.type = "button"; result.setAttribute("role", "status");
                  convert.onclick = async () => {
                    convert.disabled = true; result.textContent = "Revalidando la copia y el servidor…";
                    try {
                      const output = await convertRecoveryReview(review, selectors.filter(input => input.checked).map(input => input.value), {...sessionOptions(), reason: reason?.value ?? ""});
                      result.textContent = `${output.operationIds.length} ${output.operationIds.length === 1 ? "operación guardada" : "operaciones guardadas"}. La copia original se conserva.` +
                        (output.reconciliationError ? " Falta actualizar la ficha: " + output.reconciliationError : "");
                      status.textContent = "Se guardaron operaciones para los valores seleccionados. Puedes seguir revisando el resto de la copia.";
                      fields.disabled = true;
                      if (output.reconciliationError && options.reconcileConflict) {
                        const retry = element("button", "Reintentar actualización de ficha"); retry.type = "button";
                        retry.onclick = async () => {
                          retry.disabled = true;
                          try {
                            check(sessionOptions(), review.source);
                            await options.reconcileConflict(review.snapshot, output.operationIds);
                            check(sessionOptions(), review.source);
                            await options.onQueued?.(output.operationIds);
                            result.textContent = "Ficha actualizada. Las operaciones y el respaldo siguen conservados."; retry.remove();
                          } catch (error) { result.textContent = error.message; retry.disabled = false; }
                        };
                        preview.append(retry);
                      }
                    } catch (error) { result.textContent = error.message; convert.disabled = false; }
                  };
                  preview.append(convert, result);
                }
              } catch (error) { preview.replaceChildren(element("p", error.message)); }
              finally { reviewButton.disabled = false; }
            };
          }
          more.hidden = rendered >= scan.entries.length;
        };
        more.onclick = addPage; content.append(more); addPage();
      }
      status.textContent = total ? `${total} ${total === 1 ? "registro disponible" : "registros disponibles"} para revisión. Selecciona un registro para compararlo.` : "No hay datos anteriores sin revisar en este dispositivo.";
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; scanButton.disabled = !claim.checked; }
  };
  return section;
}
