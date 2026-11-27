import test from "node:test";
import assert from "node:assert/strict";
import {cachedPhotoRevision, photoSnapshot, projectPhotoOperations, blocksPhotoChanges} from "../sync/photo-outbox.mjs";

const scope = {userId:"member-a", ownerId:"ranch-a"};
const original = new Blob([new Uint8Array([0, 255, 18, 42])], {type:"image/jpeg"});
const photos = [
  {id:"one", animalId:"cow-a", name:"original.jpg", mime:"image/jpeg", primary:true, blob:original},
  {id:"two", animalId:"cow-a", name:"second.jpg", mime:"image/jpeg", primary:false, blob:original},
  {id:"three", animalId:"cow-b", primary:true, blob:original}
];
const pending = (action, changes = {}, overrides = {}) => ({...scope, id:"operation-a", state:"pending",
  operation:{action, entityId:"one", changes:{animalId:"cow-a", ...changes}}, ...overrides});

test("offline revisions belong to the exact confirmed photo, member and ranch", () => {
  const cache = {...scope, revision:7, fingerprint:photoSnapshot(photos[0])};
  assert.equal(cachedPhotoRevision(cache, {...photos[0], cropX:50, cropY:50, cropZoom:1}, scope), 7);
  for (const edit of [{primary:false}, {cropX:25}, {cropZoom:2}, {animalId:"cow-b"}, {id:"two"}]) {
    assert.equal(cachedPhotoRevision(cache, {...photos[0], ...edit}, scope), null);
  }
  assert.equal(cachedPhotoRevision(cache, photos[0], {...scope, userId:"member-b"}), null);
  assert.equal(cachedPhotoRevision(cache, photos[0], {...scope, ownerId:"ranch-b"}), null);
  assert.equal(cachedPhotoRevision({...cache, revision:0}, photos[0], scope), null);
});

test("pending crop survives projection without changing canonical metadata or original bytes", async () => {
  const entry = pending("photo.crop", {cropX:17, cropY:81, cropZoom:2.2});
  const result = projectPhotoOperations(photos, [entry], scope);
  assert.equal(result[0].cropX, 17);
  assert.equal(result[0].cropY, 81);
  assert.equal(result[0].cropZoom, 2.2);
  assert.equal(photos[0].cropX, undefined);
  assert.strictEqual(result[0].blob, original);
  assert.deepEqual([...new Uint8Array(await result[0].blob.arrayBuffer())], [0,255,18,42]);
});

test("a receipt keeps the overlay until a subsequent confirmed snapshot is reconciled", () => {
  const entry = pending("photo.crop", {cropX:17, cropY:81, cropZoom:2.2}, {state:"confirmed"});
  assert.equal(blocksPhotoChanges(entry), true);
  assert.equal(projectPhotoOperations(photos, [entry], scope)[0].cropX, 17);
  entry.photoSettled = true;
  assert.equal(blocksPhotoChanges(entry), false);
  assert.equal(projectPhotoOperations(photos, [entry], scope)[0].cropX, undefined);
});

test("conflicts retain the user's operation and show canonical metadata until explicit archive", () => {
  for (const state of ["conflict", "rejected"]) {
    const entry = pending("photo.crop", {cropX:17, cropY:81, cropZoom:2.2}, {state});
    assert.equal(blocksPhotoChanges(entry), true);
    assert.equal(projectPhotoOperations(photos, [entry], scope)[0].cropX, undefined);
    assert.equal(entry.operation.changes.cropX, 17);
    assert.equal(blocksPhotoChanges({...entry, state:"archived"}), false);
  }
});

test("primary selection changes only the intended animal and never mutates source rows", () => {
  const entry = pending("photo.primary", {previousPrimaryId:"one"});
  entry.operation.entityId = "two";
  const result = projectPhotoOperations(photos, [entry], scope);
  assert.deepEqual(result.map(p => p.primary), [false,true,true]);
  assert.deepEqual(photos.map(p => p.primary), [true,false,true]);
});

test("pending deletion hides the photo, preserves its original and selects the remaining principal", () => {
  const result = projectPhotoOperations(photos, [pending("photo.delete")], scope);
  assert.deepEqual(result.map(p => p.id), ["two", "three"]);
  assert.equal(result[0].primary, true);
  assert.equal(photos.length, 3);
  assert.strictEqual(photos[0].blob, original);
});

test("foreign-account operations and deleted targets cannot leak or resurrect photos", () => {
  const foreign = pending("photo.crop", {cropX:0, cropY:0, cropZoom:3}, {ownerId:"ranch-b"});
  assert.equal(projectPhotoOperations(photos, [foreign], scope)[0].cropX, undefined);
  assert.equal(projectPhotoOperations(photos.slice(1), [pending("photo.crop", {cropX:0,cropY:0,cropZoom:3})], scope).length, 2);
});
