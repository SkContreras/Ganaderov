/* Real IndexedDB/WebCrypto/Web Locks and review UI; synthetic server reads.
 * No user browser, real account, production API or external network is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const repo = path.resolve(__dirname, '../..');
const output = process.env.LEGACY_BROWSER_ARTIFACTS || path.join(os.tmpdir(), 'ganaderov-legacy-browser');
const results = [];
let browser, server;

(async () => {
  await fs.mkdir(output, {recursive: true});
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('<!doctype html><html lang="es"><meta charset="utf-8"><title>Legacy recovery regression</title><main id="review"></main></html>');
        return;
      }
      const file = path.resolve(repo, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(repo + path.sep) || !file.endsWith('.mjs')) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, {'Content-Type': 'text/javascript'}); res.end(await fs.readFile(file));
    } catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath: process.env.CHROMIUM_EXECUTABLE_PATH} : {}), args: ['--no-sandbox']});
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    const ownerId = '10000000-0000-4000-8000-000000000001', deviceId = '40000000-0000-4000-8000-000000000001';
    const animalId = '20000000-0000-4000-8000-000000000001', eventId = '30000000-0000-4000-8000-000000000001';
    const photoId = '50000000-0000-4000-8000-000000000001', projectUrl = 'http://127.0.0.1:54321';
    const legacy = await import('/sync/legacy-recovery.mjs'), protectedStore = await import('/sync/protected-store.mjs'), universal = await import('/sync/universal-outbox.mjs');
    const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    const open = name => new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 9);
      r.onupgradeneeded = () => {
        for (const store of ['animals', 'events', 'photos', 'syncMeta', 'operationOutbox', 'photoUploads', 'journeys', 'growthForecasts', 'ranchSettings', 'deletedAnimals', 'legacyRecovery']) {
          if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store, {keyPath: 'id'});
        }
      };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const database = await open(`ganadero-local-account-${encodeURIComponent(projectUrl)}-${ownerId}-ranch-${ownerId}`);
    const sourceDb = await open('ganadero-local-ranch-' + ownerId);
    const blob = new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,7,11,23,31])], {type: 'image/png'});
    const animal = {id: animalId, tag: 'A1', name: 'Legacy name', status: 'Activo'};
    const event = {id: eventId, animalId, type: 'weight', date: '2026-11-20', weight: 123};
    const photo = {id: photoId, animalId, name: 'original.png', mime: 'image/png', primary: false, cropX: 70, cropY: 20, cropZoom: 2, blob};
    const tx = sourceDb.transaction(['animals', 'events', 'photos', 'syncMeta'], 'readwrite'); const done = completed(tx);
    tx.objectStore('animals').put(animal); tx.objectStore('events').put(event); tx.objectStore('photos').put(photo);
    tx.objectStore('syncMeta').put({id: 'animal:' + animalId, fingerprint: JSON.stringify({animal: {...animal, name: 'Base name'}, events: [], photos: [], forecasts: []})});
    await done;
    await protectedStore.protectedTransaction(database, ['animals', 'events'], 'readwrite', t => {
      t.objectStore('animals').put({...animal, name: 'Server name'});
      t.objectStore('events').put({...event, weight: 100});
    });
    const cloud = new Map([
      ['animal:' + animalId, {revision: 7, data: {...animal, name: 'Server name'}, parentId: null}],
      ['event:' + eventId, {revision: 3, data: {...event, weight: 100}, parentId: animalId}],
      ['photo:' + photoId, {revision: 0, data: null, parentId: null}],
    ]);
    let valid = true, onQueued = 0;
    const options = {scope: {database, userId: ownerId, ownerId, deviceId}, projectUrl, claimedBy: ownerId,
      verify: () => { if (!valid) throw Error('Sesión cambió'); },
      readEntity: async (kind, id) => structuredClone(cloud.get(kind + ':' + id) || {revision: 0, data: null, parentId: null}),
      onQueued: async () => { onQueued++; }};
    const source = legacy.legacyDatabaseSource(ownerId);
    const rawStore = (db, store) => request(db.transaction(store, 'readonly').objectStore(store).getAll());
    const sourceSignature = async () => {
      const all = {};
      for (const store of ['animals', 'events', 'photos', 'syncMeta']) {
        all[store] = await rawStore(sourceDb, store);
        for (const row of all[store]) if (row.blob) row.blob = [...new Uint8Array(await row.blob.arrayBuffer())];
      }
      return JSON.stringify(all);
    };
    window.harness = {legacy, protectedStore, universal, database, sourceDb, options, source, cloud, rawStore, sourceSignature,
      originalSignature: await sourceSignature(), ownerId, animalId, eventId, photoId, blob,
      setValid: value => { valid = value; }, queuedCount: () => onQueued, completed, request};
  });

  async function run(name, fn) {
    const started = Date.now();
    try { const detail = await fn(); results.push({name, status: 'passed', milliseconds: Date.now() - started, detail}); process.stdout.write('PASS ' + name + '\n'); }
    catch (error) { results.push({name, status: 'failed', error: error.message}); throw error; }
  }

  await run('Owner claim precedes any source scan; plaintext source is never migrated or modified', async () => {
    const result = await page.evaluate(async () => {
      const h = harness;
      let rejected = false;
      try { await h.legacy.scanRecoverySource(h.source, {...h.options, claimedBy: null}); } catch (_) { rejected = true; }
      const scan = await h.legacy.scanRecoverySource(h.source, h.options);
      h.scan = scan;
      return {rejected, entries: scan.entries.length, unchanged: await h.sourceSignature() === h.originalSignature,
        keyCreated: (await h.rawStore(h.sourceDb, 'syncMeta')).some(row => row.id.startsWith('local-key:'))};
    });
    assert.deepEqual(result, {rejected: true, entries: 3, unchanged: true, keyCreated: false});
    return result;
  });

  await run('Reviewed revision becomes one encrypted operation; canonical data and original source remain intact', async () => {
    const result = await page.evaluate(async () => {
      const h = harness, entry = h.scan.entries.find(e => e.kind === 'animal');
      const review = await h.legacy.reviewRecoveryEntry(h.scan, entry, h.options);
      h.animalReview = review;
      const output = await h.legacy.convertRecoveryReview(review, ['name'], h.options);
      const queue = await h.universal.readQueue(h.database, h.options.scope), canonical = await h.protectedStore.readProtectedRecord(h.database, 'animals', h.animalId);
      const raw = await h.rawStore(h.database, 'operationOutbox'), markers = await h.rawStore(h.database, 'syncMeta');
      return {operations: output.operationIds.length, revision: queue[0].operation.baseRevision, name: queue[0].operation.changes.fields.name,
        canonicalName: canonical.name, unchanged: await h.sourceSignature() === h.originalSignature,
        encrypted: raw.every(row => row.encryptedRecord && !row.operation), secretInRaw: JSON.stringify(raw).includes('Legacy name'),
        markersEncrypted: markers.filter(row => row.id.startsWith('legacy-recovery:')).every(row => row.encryptedRecord)};
    });
    assert.deepEqual(result, {operations: 1, revision: 7, name: 'Legacy name', canonicalName: 'Server name', unchanged: true,
      encrypted: true, secretInRaw: false, markersEncrypted: true});
    return result;
  });

  await run('Durable marker rejects a repeated conversion after the earlier operation has settled', async () => {
    const result = await page.evaluate(async () => {
      const h = harness;
      await h.protectedStore.protectedTransaction(h.database, ['operationOutbox'], 'readwrite', tx => {
        const queue = tx.objectStore('operationOutbox'), read = queue.getAll();
        read.onsuccess = () => read.result.forEach(row => queue.put({...row, state: 'confirmed', settled: true}));
      });
      const name = h.database.name; h.database.close();
      h.database = await h.request(indexedDB.open(name)); h.options.scope.database = h.database;
      const before = (await h.universal.readQueue(h.database, h.options.scope)).length;
      let error = '';
      try { await h.legacy.convertRecoveryReview(h.animalReview, ['name'], h.options); } catch (e) { error = e.message; }
      const after = (await h.universal.readQueue(h.database, h.options.scope)).length;
      return {before, after, error};
    });
    assert.equal(result.before, 1); assert.equal(result.after, 1); assert.match(result.error, /recuper|convirti|convert|revisi/i);
    return result;
  });

  await run('Concurrent server edits and source edits stop conversion without creating operations', async () => {
    return page.evaluate(async () => {
      const h = harness, event = h.scan.entries.find(e => e.kind === 'event');
      const review = await h.legacy.reviewRecoveryEntry(h.scan, event, h.options);
      const before = (await h.universal.readQueue(h.database, h.options.scope)).length;
      h.cloud.get('event:' + h.eventId).revision++;
      let serverError = '', sourceError = '';
      try { await h.legacy.convertRecoveryReview(review, ['weight'], {...h.options, reason: 'Revisión'}); } catch (e) { serverError = e.message; }
      h.cloud.get('event:' + h.eventId).revision--;
      const tx = h.sourceDb.transaction('events', 'readwrite'), done = h.completed(tx);
      tx.objectStore('events').put({...event.local, weight: 999}); await done;
      try { await h.legacy.convertRecoveryReview(review, ['weight'], {...h.options, reason: 'Revisión'}); } catch (e) { sourceError = e.message; }
      const tx2 = h.sourceDb.transaction('events', 'readwrite'), done2 = h.completed(tx2); tx2.objectStore('events').put(event.local); await done2;
      const after = (await h.universal.readQueue(h.database, h.options.scope)).length;
      if (!serverError.includes('servidor') || !sourceError.includes('copia anterior cambió') || before !== after) throw Error('CAS guard failed');
      return {serverChangeRejected: true, sourceChangeRejected: true, noNewOperation: true};
    });
  });

  await run('Two simultaneous conversions commit only one immutable operation', async () => {
    const result = await page.evaluate(async () => {
      const h = harness, scan = await h.legacy.scanRecoverySource(h.source, h.options), event = scan.entries.find(e => e.kind === 'event');
      const review = await h.legacy.reviewRecoveryEntry(scan, event, h.options);
      const both = await Promise.allSettled([1, 2].map(() => h.legacy.convertRecoveryReview(review, ['weight'], {...h.options, reason: 'Revisión'})));
      const queue = await h.universal.readQueue(h.database, h.options.scope);
      return {success: both.filter(r => r.status === 'fulfilled').length, failure: both.filter(r => r.status === 'rejected').length,
        count: queue.filter(row => row.operation.entityId === h.eventId).length};
    });
    assert.deepEqual(result, {success: 1, failure: 1, count: 1});
    return result;
  });

  await run('Photo conversion preserves original bytes and chains crop from the create receipt', async () => {
    const result = await page.evaluate(async () => {
      const h = harness, scan = await h.legacy.scanRecoverySource(h.source, h.options), photo = scan.entries.find(e => e.kind === 'photo');
      const review = await h.legacy.reviewRecoveryEntry(scan, photo, h.options);
      const output = await h.legacy.convertRecoveryReview(review, ['create'], h.options);
      const queue = (await h.universal.readQueue(h.database, h.options.scope)).filter(row => row.operation.entityId === h.photoId);
      const attachment = await h.protectedStore.readProtectedRecord(h.database, 'photoUploads', output.operationIds[0]);
      const bytes = [...new Uint8Array(await attachment.blob.arrayBuffer())];
      const raw = await h.rawStore(h.database, 'photoUploads');
      return {actions: queue.map(row => row.operation.action), bytesMatch: JSON.stringify(bytes) === JSON.stringify([...new Uint8Array(await h.blob.arrayBuffer())]),
        unsealedCrop: queue[1].sealed === false, dependsOnCreate: queue[1].baseOperationId === queue[0].id,
        encryptedAttachment: raw.every(row => row.encryptedRecord && !row.blob), sourceUnchanged: await h.sourceSignature() === h.originalSignature};
    });
    assert.deepEqual(result, {actions: ['photo.create', 'photo.crop'], bytesMatch: true, unsealedCrop: true, dependsOnCreate: true, encryptedAttachment: true, sourceUnchanged: true});
    return result;
  });

  await run('Auth switch during revalidation aborts before queue mutation', async () => {
    return page.evaluate(async () => {
      const h = harness, payload = {format: 'ganadero-backup', version: 1, animals: [{id: '20000000-0000-4000-8000-000000000003', tag: 'C3', name: 'Private', status: 'Activo'}], events: [], photos: []};
      const source = h.legacy.backupRecoverySource(payload, 'private.json'), scan = await h.legacy.scanRecoverySource(source, h.options);
      const review = await h.legacy.reviewRecoveryEntry(scan, scan.entries[0], h.options), before = (await h.universal.readQueue(h.database, h.options.scope)).length;
      let error = '';
      try { await h.legacy.convertRecoveryReview(review, ['create'], {...h.options, readEntity: async (...args) => { const r = await h.options.readEntity(...args); h.setValid(false); return r; }}); }
      catch (e) { error = e.message; } finally { h.setValid(true); }
      const after = (await h.universal.readQueue(h.database, h.options.scope)).length;
      if (!error.includes('Sesión') || before !== after) throw Error('Session guard failed');
      return {sessionChangedRejected: true, noNewOperation: true};
    });
  });

  await run('JSON import only adds reviewed operations and establishes parent dependencies', async () => {
    const result = await page.evaluate(async () => {
      const h = harness, id = '20000000-0000-4000-8000-000000000002', eventId = '30000000-0000-4000-8000-000000000002';
      const payload = {format: 'ganadero-backup', version: 1, animals: [{id, tag: 'B2', name: 'New', status: 'Activo'}],
        events: [{id: eventId, animalId: id, type: 'note', date: '2026-11-20', notes: 'Recovered note'}], photos: []};
      const source = h.legacy.backupRecoverySource(payload, 'new.json'), scan = await h.legacy.scanRecoverySource(source, h.options);
      const animal = scan.entries.find(e => e.kind === 'animal'), event = scan.entries.find(e => e.kind === 'event');
      const a = await h.legacy.convertRecoveryReview(await h.legacy.reviewRecoveryEntry(scan, animal, h.options), ['create'], h.options);
      await h.legacy.convertRecoveryReview(await h.legacy.reviewRecoveryEntry(scan, event, h.options), ['create'], h.options);
      const row = (await h.universal.readQueue(h.database, h.options.scope)).find(row => row.operation.entityId === eventId);
      const canonical = await h.protectedStore.readProtected(h.database, 'animals');
      return {parentDependency: row.dependsOn.includes(a.operationIds[0]), canonicalCount: canonical.length, canonicalName: canonical[0].name,
        sourceUntouched: payload.animals[0].name === 'New' && payload.events.length === 1};
    });
    assert.deepEqual(result, {parentDependency: true, canonicalCount: 1, canonicalName: 'Server name', sourceUntouched: true});
    return result;
  });

  await run('A partially reconciled conflict keeps its original snapshot and encrypted photo backup available', async () => {
    const result = await page.evaluate(async () => {
      const h = harness, conflictAnimal = '20000000-0000-4000-8000-000000000004', conflictPhoto = '50000000-0000-4000-8000-000000000004';
      const photo = {id: conflictPhoto, animalId: conflictAnimal, name: 'kept.png', mime: 'image/png', blob: h.blob};
      const snapshot = {id: 'conflict:animal:' + conflictAnimal, ownerId: h.ownerId, kind: 'animal', entityId: conflictAnimal,
        base: null, remote: {animal: {id: conflictAnimal, tag: 'D4', name: 'Cloud', status: 'Activo'}}, version: 7,
        local: {animal: {id: conflictAnimal, tag: 'D4', name: 'Local', status: 'Activo'}, events: [], photos: [{id: photo.id, animalId: photo.animalId, name: photo.name, mime: photo.mime}], forecasts: []}};
      await h.protectedStore.protectedTransaction(h.database, ['syncMeta', 'photos'], 'readwrite', tx => { tx.objectStore('syncMeta').put(snapshot); tx.objectStore('photos').put(photo); });
      h.cloud.set('animal:' + conflictAnimal, {revision: 7, data: snapshot.remote.animal, parentId: null});
      const source = h.legacy.conflictRecoverySource(snapshot), before = await h.legacy.scanRecoverySource(source, h.options);
      const review = await h.legacy.reviewRecoveryEntry(before, before.entries.find(e => e.kind === 'animal'), h.options);
      const phases = [];
      const output = await h.legacy.convertRecoveryReview(review, ['name'], {...h.options, prepareConflict: async original => {
        if ((await h.universal.readQueue(h.database, h.options.scope)).some(row => row.operation.entityId === conflictAnimal)) throw Error('Queue visible before backup');
        phases.push('prepare');
        const backupId = await h.legacy.conflictRecoveryBackupId(original);
        await h.protectedStore.protectedTransaction(h.database, ['legacyRecovery', 'syncMeta'], 'readwrite', tx => {
          tx.objectStore('legacyRecovery').put({id: backupId, source: original, userId: h.ownerId, ownerId: h.ownerId});
          tx.objectStore('legacyRecovery').put({id: backupId + ':photo:' + photo.id, photo: {...photo, blob: undefined}, blob: photo.blob, userId: h.ownerId, ownerId: h.ownerId});
          tx.objectStore('syncMeta').put({...original, recoveryBackupId: backupId});
        });
      }, reconcileConflict: async (original, ids) => {
        phases.push('reconcile');
        const backupId = await h.legacy.conflictRecoveryBackupId(original);
        if (!await h.protectedStore.readProtectedRecord(h.database, 'legacyRecovery', backupId + ':photo:' + photo.id)) throw Error('Original missing before reconciliation');
        await h.protectedStore.protectedTransaction(h.database, ['photos', 'syncMeta'], 'readwrite', tx => {
          tx.objectStore('photos').delete(photo.id);
          tx.objectStore('syncMeta').put({...original, recoveryBackupId: backupId, resolvedBy: ids});
        });
      }});
      const after = await h.legacy.scanRecoverySource(source, h.options), originalPhoto = before.entries.find(e => e.kind === 'photo'), retainedPhoto = after.entries.find(e => e.kind === 'photo');
      const nextReview = await h.legacy.reviewRecoveryEntry(after, retainedPhoto, h.options);
      return {queued: output.operationIds.length, unchangedFingerprint: before.sourceFingerprint === after.sourceFingerprint,
        photoHashPreserved: originalPhoto.photoHash === retainedPhoto.photoHash, originalStillRecoverable: nextReview.choices.some(c => c.key === 'create'),
        backupsEncrypted: (await h.rawStore(h.database, 'legacyRecovery')).every(row => row.encryptedRecord), phases};
    });
    assert.deepEqual(result, {queued: 1, unchangedFingerprint: true, photoHashPreserved: true, originalStillRecoverable: true, backupsEncrypted: true, phases: ['prepare', 'reconcile']});
    return result;
  });

  await run('Failed conflict preservation leaves no operation visible to a worker', async () => {
    return page.evaluate(async () => {
      const h = harness, snapshot = {id: 'conflict:config:' + h.ownerId, ownerId: h.ownerId, kind: 'config', entityId: h.ownerId,
        base: null, local: {version: 1, fields: {name: {enabled: true}}}, remote: null, version: 0};
      await h.protectedStore.protectedTransaction(h.database, ['syncMeta'], 'readwrite', tx => tx.objectStore('syncMeta').put(snapshot));
      const scan = await h.legacy.scanRecoverySource(h.legacy.conflictRecoverySource(snapshot), h.options);
      const review = await h.legacy.reviewRecoveryEntry(scan, scan.entries[0], h.options), before = (await h.universal.readQueue(h.database, h.options.scope)).length;
      let error = '';
      try { await h.legacy.convertRecoveryReview(review, ['config'], {...h.options, prepareConflict: async () => { throw Error('Backup race'); }}); } catch (e) { error = e.message; }
      const after = (await h.universal.readQueue(h.database, h.options.scope)).length;
      if (error !== 'Backup race' || before !== after) throw Error('Operation was visible before preservation');
      return {preservationFailureRejected: true, queueUnchanged: true};
    });
  });

  await run('A saved conflict remains readable after a newer conflict reuses its current key', async () => {
    return page.evaluate(async () => {
      const h = harness, backups = await h.protectedStore.readProtected(h.database, 'legacyRecovery');
      const backup = backups.find(row => row.source?.kind === 'animal');
      const source = h.legacy.conflictRecoverySource(backup.source, backup.id);
      await h.protectedStore.protectedTransaction(h.database, ['syncMeta'], 'readwrite', tx => {
        tx.objectStore('syncMeta').put({...backup.source, local: {...backup.source.local, animal: {...backup.source.local.animal, name: 'A newer conflict'}}});
      });
      const scan = await h.legacy.scanRecoverySource(source, h.options);
      if (scan.entries.find(e => e.kind === 'animal').local.name !== 'Local' || !scan.entries.find(e => e.kind === 'photo').photoHash) throw Error('Saved conflict lost');
      return {olderSnapshotRetained: true, olderPhotoRetained: true};
    });
  });

  await run('Already encrypted legacy source is decoded without changing its rows or nonextractable key', async () => {
    return page.evaluate(async () => {
      const h = harness;
      await h.protectedStore.migrateProtected(h.sourceDb, ['animals', 'events', 'photos', 'syncMeta'], () => {});
      const before = await h.sourceSignature(), scan = await h.legacy.scanRecoverySource(h.source, h.options), after = await h.sourceSignature();
      const metadata = await h.rawStore(h.sourceDb, 'syncMeta'), key = metadata.find(row => row.id.startsWith('local-key:'))?.key;
      if (before !== after || key?.extractable !== false || scan.entries.find(e => e.kind === 'animal').local.name !== 'Legacy name' || !scan.entries.find(e => e.kind === 'photo').photoHash) throw Error('Encrypted source changed');
      return {encryptedSourceUnchanged: true, keyNonextractable: true, originalReadable: true};
    });
  });

  await run('Review UI requires ownership acknowledgement and explicit field selection', async () => {
    await page.evaluate(async () => {
      const h = harness, id = '20000000-0000-4000-8000-000000000009';
      const source = h.legacy.backupRecoverySource({format: 'ganadero-backup', version: 1, animals: [{id, tag: 'UI9', name: '<img src=x onerror=alert(1)>', status: 'Activo'}], events: [], photos: []}, 'ui.json');
      await h.legacy.mountLegacyRecovery(document.querySelector('#review'), {...h.options, source});
    });
    const compare = page.getByRole('button', {name: 'Comparar esta copia', exact: true});
    assert.equal(await compare.isDisabled(), true);
    await page.locator('[data-recovery-claim]').check(); await compare.click();
    await page.locator('[data-recovery-entry] summary').click();
    await page.getByRole('button', {name: 'Revisar con el servidor', exact: true}).click();
    const convert = page.getByRole('button', {name: 'Convertir selección a operaciones', exact: true});
    await convert.click(); await page.getByText('Selecciona los cambios que revisaste.', {exact: true}).waitFor();
    await page.locator('fieldset input[type=checkbox]').check(); await convert.click();
    await page.getByText('1 operación guardada. La copia original se conserva.', {exact: true}).waitFor();
    assert.equal(await page.locator('img').count(), 0);
    await page.screenshot({path: path.join(output, 'review.png'), fullPage: true});
    return {realReviewControls: true, unselectedConversionRejected: true, backupTextNotExecuted: true};
  });

  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({status: 'passed', scope: {realIndexedDB: true, realWebCrypto: true, realWebLocks: true, realReviewUI: true, syntheticServerReads: true}, results}, null, 2));
  await browser.close(); browser = null;
  await new Promise(resolve => server.close(resolve)); server = null;
})().catch(async error => {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({status: 'failed', error: error.stack, results}, null, 2)).catch(() => {});
  process.stderr.write(error.stack + '\n');
  await browser?.close().catch(() => {}); server?.close(); process.exitCode = 1;
});
