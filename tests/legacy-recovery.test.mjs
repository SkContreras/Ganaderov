import test from "node:test";
import assert from "node:assert/strict";
import {assertRecoveryClaim, backupRecoverySource, conflictRecoveryBackupId, conflictRecoverySource,
  legacyDatabaseSource, planRecoveryEntry, selectedRecoveryActions} from "../sync/legacy-recovery.mjs";

const ownerId = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const animalId = "20000000-0000-4000-8000-000000000001";
const childId = "30000000-0000-4000-8000-000000000001";
const deviceId = "40000000-0000-4000-8000-000000000001";
const projectUrl = "http://127.0.0.1:54321";
const scope = userId => ({userId, ownerId, deviceId,
  database: {name: `ganadero-local-account-${encodeURIComponent(projectUrl)}-${userId}-ranch-${ownerId}`}});
const options = {scope: scope(ownerId), projectUrl, claimedBy: ownerId};
const entry = (kind, local, base) => ({kind, id: local.id, local, base, key: kind + ":" + local.id});
const remote = (data, revision = data ? 7 : 0, parentId = null) => ({data, revision, parentId});

test("unattributed source requires explicit owner claim and exact project/account database", () => {
  const source = legacyDatabaseSource(ownerId);
  assert.doesNotThrow(() => assertRecoveryClaim(options, source));
  assert.throws(() => assertRecoveryClaim({...options, claimedBy: null}, source), /Confirma/);
  assert.throws(() => assertRecoveryClaim({...options, claimedBy: otherId, scope: scope(otherId), managerAllowed: true}, source), /propietario/);
  assert.throws(() => assertRecoveryClaim({...options, projectUrl: "https://another.example"}, source), /almacenamiento/);
  assert.throws(() => assertRecoveryClaim(options, {...source, ownerId: otherId}), /otro rancho/);
  assert.throws(() => assertRecoveryClaim(options, {...source, projectUrl: "https://another.example"}), /otro proyecto/);
});

test("attributed current conflicts allow a verified manager but remain ranch bound", () => {
  const source = conflictRecoverySource({id: "conflict:animal:" + animalId, ownerId, kind: "animal", entityId: animalId});
  const manager = {...options, claimedBy: otherId, scope: scope(otherId), managerAllowed: true};
  assert.doesNotThrow(() => assertRecoveryClaim(manager, source));
  assert.throws(() => assertRecoveryClaim({...manager, managerAllowed: false}, source), /administrador/);
  assert.throws(() => assertRecoveryClaim(manager, {...source, ownerId: otherId}), /otro rancho/);
});

test("backup is captured immutably and rejects other formats", () => {
  const payload = {format: "ganadero-backup", version: 1, animals: [{id: animalId, name: "Original"}], events: [], photos: []};
  const source = backupRecoverySource(payload, "copy.json");
  payload.animals[0].name = "Changed after review";
  assert.equal(source.readPayload().animals[0].name, "Original");
  const returned = source.readPayload(); returned.animals.length = 0;
  assert.equal(source.readPayload().animals.length, 1);
  assert.throws(() => backupRecoverySource({...payload, version: 2}), /compatible/);
});

test("animal review ignores server metadata, exposes true concurrent fields and never invents absent fields", () => {
  const base = {id: animalId, name: "Base", tag: "A1", sex: "Hembra", status: "Activo"};
  const local = {...base, name: "Legacy", updatedAt: "old", internalId: "ANM-00001"};
  delete local.sex;
  const current = {...base, name: "Server", updatedAt: "new", internalId: "ANM-00999"};
  const review = planRecoveryEntry(entry("animal", local, base), remote(current));
  assert.deepEqual(review.choices.map(choice => choice.key), ["name"]);
  assert.equal(review.choices[0].concurrent, true);
  const actions = selectedRecoveryActions(review, ["name"]);
  assert.deepEqual(actions, [{action: "animal.update", id: animalId, changes: {fields: {name: "Legacy"}}}]);
  assert.equal(current.name, "Server");
  assert.equal(local.name, "Legacy");
});

test("lifecycle conversion orders restore before edits and archive after edits", () => {
  const active = {id: animalId, tag: "A1", name: "Server", status: "Activo"};
  const archived = {...active, name: "Legacy", status: "Vendido", exitReason: "Venta", exitNotes: "Legacy notes"};
  const archive = planRecoveryEntry(entry("animal", archived), remote(active));
  assert.deepEqual(selectedRecoveryActions(archive, ["name", "status"]).map(op => op.action), ["animal.update", "animal.archive"]);
  const restore = planRecoveryEntry(entry("animal", {...active, name: "New"}), remote(archived));
  assert.throws(() => selectedRecoveryActions(restore, ["name"]), /reactivación/);
  assert.deepEqual(selectedRecoveryActions(restore, ["name", "status"]).map(op => op.action), ["animal.restore", "animal.update"]);
});

test("creation requires a valid UUID, arete and no remote tombstone", () => {
  const local = {id: animalId, tag: "A1", status: "Activo", createdBy: {spoof: true}, internalId: "old"};
  const review = planRecoveryEntry(entry("animal", local), remote(null));
  assert.deepEqual(selectedRecoveryActions(review, ["create"])[0].changes.fields, {tag: "A1", status: "Activo"});
  assert.match(planRecoveryEntry(entry("animal", {...local, id: "legacy-id"}), remote(null)).blocked, /identificador/);
  assert.match(planRecoveryEntry(entry("animal", {...local, tag: ""}), remote(null)).blocked, /arete/);
  assert.match(planRecoveryEntry(entry("animal", local), remote(null, 9)).blocked, /eliminación/);
  assert.match(planRecoveryEntry(entry("deletion", {id: animalId, deletedAt: "2026-11-01"}), remote(local)).blocked, /borrado/);
});

test("event correction preserves entity type/parent, requires a reason and cannot split journey attendance", () => {
  const current = {id: childId, animalId, type: "weight", date: "2026-11-20", weight: 100, notes: ""};
  const local = {...current, weight: 120, notes: "Legacy note"};
  const review = planRecoveryEntry(entry("event", local), remote(current, 9, animalId));
  assert.throws(() => selectedRecoveryActions(review, ["weight"]), /motivo/);
  assert.deepEqual(selectedRecoveryActions(review, ["weight", "notes"], {reason: "Revisión de copia"})[0].changes,
    {animalId, weight: 120, notes: "Legacy note", reason: "Revisión de copia"});
  assert.match(planRecoveryEntry(entry("event", local), remote(current, 9, "another-animal")).blocked, /otro animal/);
  assert.match(planRecoveryEntry(entry("event", {...local, journeyId: "j"}), remote(null)).blocked, /jornada/);
  assert.match(planRecoveryEntry(entry("event", {...local, date: "2026-02-31"}), remote(null)).blocked, /inválida/);
});

test("photo crop and primary use real canonical path and explicit current primary", () => {
  const current = {id: childId, animalId, name: "a.png", mime: "image/png", storagePath: `${ownerId}/${animalId}/${childId}`, primary: false};
  const local = {...current, cropX: 70, cropY: 30, cropZoom: 2, primary: true};
  const review = planRecoveryEntry(entry("photo", local), remote(current, 4, animalId), {...options,
    photoFamily: [current, {id: "prior-photo", primary: true}]});
  assert.equal(review.blocked, "");
  assert.deepEqual(review.choices.map(choice => choice.key), ["crop", "primary"]);
  assert.deepEqual(selectedRecoveryActions(review, ["primary"])[0].changes, {animalId, previousPrimaryId: "prior-photo"});
  assert.match(planRecoveryEntry(entry("photo", local), remote({...current, storagePath: "another-owner/secret"}, 4, animalId), options).blocked, /canónica/);
  const noAlbum = planRecoveryEntry(entry("photo", local), remote(current, 4, animalId), options);
  assert.deepEqual(noAlbum.choices.map(choice => choice.key), ["crop"]);
  assert.equal(noAlbum.notices.length, 1);
});

test("photo creation includes crop only after its original and never replaces remote bytes", () => {
  const local = {id: childId, animalId, name: "a.png", mime: "image/png", primary: true, cropZoom: 2};
  const review = planRecoveryEntry({...entry("photo", local), photoHash: "abc", originalBytes: 8}, remote(null), options);
  assert.deepEqual(selectedRecoveryActions(review, ["create"]).map(op => op.action), ["photo.create", "photo.crop"]);
  assert.match(planRecoveryEntry({...entry("photo", local), originalError: "Falta el original"}, remote(null), options).blocked, /original/);
});

test("journey conversion creates attendance dependencies and closes only the reviewed lifecycle", () => {
  const local = {id: childId, type: "weight", date: "2026-11-20", status: "completed", roster: [{id: animalId, attended: true, weight: 123}]};
  const create = planRecoveryEntry(entry("journey", local), remote(null));
  assert.deepEqual(selectedRecoveryActions(create, ["journey"]).map(op => op.action), ["journey.create", "journey.attend", "journey.finish"]);
  const prior = {...local, status: "incomplete", roster: [{id: animalId, attended: false}]};
  const resume = planRecoveryEntry(entry("journey", local), remote(prior));
  assert.deepEqual(selectedRecoveryActions(resume, ["journey"]).map(op => op.action), ["journey.resume", "journey.attend", "journey.finish"]);
  const changeWeight = planRecoveryEntry(entry("journey", {...local, roster: [{id: animalId, attended: true, weight: 150}]}), remote(local));
  assert.match(changeWeight.blocked, /corrección/);
  assert.match(planRecoveryEntry(entry("journey", {...local, date: "2026-11-21"}), remote(local)).blocked, /cabecera/);
});

test("config conflicts are recoverable and backup identity ignores reconciliation bookkeeping", async () => {
  const snapshot = {id: "conflict:config:" + ownerId, kind: "config", entityId: ownerId, ownerId,
    base: null, local: {version: 1, fields: {name: {enabled: false}}}, remote: {version: 1}, version: 7};
  assert.equal(conflictRecoverySource(snapshot).kind, "conflict");
  const review = planRecoveryEntry(entry("config", {id: ownerId, ...snapshot.local}), remote(snapshot.remote), {
    configPayload: value => ({version: value.version, fields: value.fields})});
  assert.equal(selectedRecoveryActions(review, ["config"])[0].action, "config.update");
  assert.equal(await conflictRecoveryBackupId(snapshot), await conflictRecoveryBackupId({...snapshot, resolvedBy: ["operation"], reconciledAt: "now"}));
  assert.notEqual(await conflictRecoveryBackupId(snapshot), await conflictRecoveryBackupId({...snapshot, local: {version: 2}}));
});
