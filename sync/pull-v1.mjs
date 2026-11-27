import {applyChangePage} from "./incremental-v1.mjs";

const empty = ownerId => ({ownerId, epoch: null, cursor: 0, records: []});

// The adapter's commit compares the cursor read before the network call in the
// same transaction as the write. Another tab may have committed that page first.
export async function pullSnapshot(ownerId, {read, commit, fetchPage, verify}) {
  let previous = await read();
  let resets = 0;
  for (;;) {
    verify();
    const base = previous ?? empty(ownerId);
    const page = await fetchPage(base.cursor, base.epoch);
    verify();
    if (page?.status === "reset_required") {
      if (page.protocolVersion !== 1 || typeof page.epoch !== "string" || !previous || ++resets > 2) {
        throw Error("No se pudo restablecer la descarga del rancho.");
      }
      // Keep the last complete mirror until the first page of the new epoch is valid.
      const fresh = await fetchPage(0, null);
      verify();
      const next = applyChangePage(empty(ownerId), fresh, ownerId);
      previous = await commit(previous, next) ? next : await read();
      if (previous === next && !fresh.hasMore) return next;
      continue;
    }
    const next = applyChangePage(base, page, ownerId);
    if (await commit(previous, next)) {
      if (!page.hasMore) return next;
      previous = next;
    } else {
      previous = await read();
    }
  }
}

export async function pullFromIndexedDB(scope, cloud, verify) {
  const key = JSON.stringify(["incremental-v1",cloud.supabaseUrl,scope.userId,scope.ownerId]);
  const database = scope.database;
  return pullSnapshot(scope.ownerId,{
    verify,
    read: () => new Promise((resolve,reject) => {
      verify();
      const req = database.transaction("syncMeta").objectStore("syncMeta").get(key);
      req.onsuccess = () => resolve(req.result?.snapshot ?? null);
      req.onerror = () => reject(req.error);
    }),
    commit: (expected, next) => new Promise((resolve,reject) => {
      verify();
      const tx = database.transaction("syncMeta","readwrite");
      const store = tx.objectStore("syncMeta");
      const req = store.get(key);
      let written = false;
      req.onsuccess = () => {
        try {
          verify();
          const current = req.result?.snapshot;
          if (current?.epoch !== expected?.epoch || current?.cursor !== expected?.cursor) return;
          store.put({id:key,snapshot:next});
          written = true;
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve(written);
      tx.onabort = () => reject(tx.error ?? Error("Descarga cancelada"));
    }),
    fetchPage: async (after,epoch) => {
      const {data,error} = await cloud.rpc("sync_pull_changes",{p_owner:scope.ownerId,p_after:after,p_epoch:epoch,p_limit:50});
      if (error) throw error;
      return data;
    }
  });
}
