// Read-only instrumentation appended to an in-memory copy of app.js.
// initialize(), the Supabase client and every mutation remain unchanged.
Object.defineProperty(window, '__ganaderovIntegration', {
  configurable: false,
  writable: false,
  value: Object.freeze({
    async snapshot(animalId) {
      const database = db;
      if (!database) return {ready: false};
      const names = ['animals', 'photos', 'operationOutbox', 'syncMeta', 'growthForecasts', 'journeys', 'events'];
      const values = await Promise.all(names.map(name => readDatabaseStore(database, name)));
      if (db !== database) return {ready: false};
      const [animals, photos, entries, meta, forecasts, journeys, events] = values;
      const photo = item => ({
        id: item.id, animalId: item.animalId, primary: Boolean(item.primary),
        ...photoCrop(item), cropX: photoCrop(item).x, cropY: photoCrop(item).y,
        cropZoom: photoCrop(item).zoom, storagePath: item.storagePath,
        mime: item.mime, byteLength: item.blob?.size ?? 0
      });
      const scoped = entries.filter(entry => entry.userId === currentUser?.id && entry.ownerId === state.ranchOwnerId);
      return {
        ready: Boolean(currentUser && state.ranchReady),
        userId: currentUser?.id ?? null, ownerId: state.ranchOwnerId,
        role: state.ranchRole, scope: database.name, online: navigator.onLine,
        ranchContextOffline: Boolean(state.ranchContextOffline),
        syncing: state.syncing, serviceWorker: Boolean(navigator.serviceWorker.controller),
        animal: animals.find(item => item.id === animalId) ? {id: animalId} : null,
        canonicalPhotos: photos.filter(item => item.animalId === animalId).map(photo),
        displayPhotos: state.photos.filter(item => item.animalId === animalId).map(photo),
        outbox: scoped.map(entry => ({
          id: entry.id, state: entry.state, action: entry.operation?.action,
          entityType: entry.operation?.entityType, entityId: entry.operation?.entityId,
          baseRevision: entry.operation?.baseRevision, changes: entry.operation?.changes,
          photoSettled: entry.photoSettled,
          receipt: entry.receipt ? {
            operationId: entry.receipt.operationId, status: entry.receipt.status,
            revision: entry.receipt.revision, code: entry.receipt.code
          } : null
        })),
        revisions: meta.filter(item => /^(photo|journey)-revision:/.test(item.id)).map(item => ({id: item.id, revision: item.revision})),
        forecasts: forecasts.filter(item => item.animalId === animalId),
        journeys: journeys.map(item => ({
          id: item.id, status: item.status, type: item.type, notes: item.notes,
          roster: item.roster.map(animal => ({id: animal.id, attended: Boolean(animal.attended)}))
        })),
        events: events.filter(item => item.animalId === animalId).map(item => ({
          id: item.id, type: item.type, journeyId: item.journeyId, date: item.date
        }))
      };
    },
    async originals(animalId) {
      const database = db;
      const photos = (await readDatabaseStore(database, 'photos')).filter(item => item.animalId === animalId);
      const originals = [];
      for (const photo of photos) {
        const bytes = await photo.blob.arrayBuffer();
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        originals.push({id: photo.id, bytes: bytes.byteLength,
          sha256: [...digest].map(value => value.toString(16).padStart(2, '0')).join('')});
      }
      const raw = await new Promise((resolve, reject) => {
        const request = database.transaction('photos', 'readonly').objectStore('photos').getAll();
        request.onsuccess = () => resolve(request.result.filter(row => photos.some(photo => photo.id === row.id)).map(row => ({
          id: row.id, encrypted: Boolean(row.encryptedRecord),
          plaintextBlob: Object.hasOwn(row, 'blob'), plaintextCrop: Object.hasOwn(row, 'cropX')
        })));
        request.onerror = () => reject(request.error);
      });
      return {originals, raw};
    }
  })
});
