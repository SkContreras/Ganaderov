(() => {
  "use strict";

  const DB_NAME = "ganadero-local";
  const DB_VERSION = 2;
  const EVENT_TYPES = {
    bath: "Baño",
    weight: "Pesaje",
    vaccine: "Vacuna",
    deworm: "Desparasitación",
    note: "Observación"
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { animals: [], events: [], photos: [], photoUrls: new Map(), sort: "tag", direction: 1, currentAnimalId: null, animalFormSnapshot: "", toastTimer: null, syncTimer: null, syncing: false, syncRequested: false };
  let db;
  let cloud;
  let currentUser;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("animals")) database.createObjectStore("animals", { keyPath: "id" });
        if (!database.objectStoreNames.contains("events")) {
          const store = database.createObjectStore("events", { keyPath: "id" });
          store.createIndex("animalId", "animalId", { unique: false });
          store.createIndex("date", "date", { unique: false });
        }
        if (!database.objectStoreNames.contains("photos")) {
          const store = database.createObjectStore("photos", { keyPath: "id" });
          store.createIndex("animalId", "animalId", { unique: false });
        }
        if (!database.objectStoreNames.contains("syncMeta")) database.createObjectStore("syncMeta", { keyPath: "id" });
        if (!database.objectStoreNames.contains("deletedAnimals")) database.createObjectStore("deletedAnimals", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No fue posible abrir el almacenamiento local."));
      request.onblocked = () => reject(new Error("Cierra otras pestañas de Ganadero para actualizar el almacenamiento."));
    });
  }

  function transaction(storeNames, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      let result;
      try {
        result = operation(tx);
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("No se pudo guardar la información."));
      tx.onabort = () => reject(tx.error || new Error("La operación fue cancelada."));
    });
  }

  const getAll = store => new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const getOne = (store, key) => new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const getAllByIndex = (store, index, key) => new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).index(index).getAll(IDBKeyRange.only(key));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const put = (store, value) => transaction([store], "readwrite", tx => tx.objectStore(store).put(value));
  const remove = (store, key) => transaction([store], "readwrite", tx => tx.objectStore(store).delete(key));

  function setSyncStatus(message) {
    $("#sync-label").textContent = message.toLocaleUpperCase("es-MX");
    $("#account-label").textContent = currentUser ? currentUser.email : "Sin sesión";
    $("#sync-button").disabled = !cloud || !currentUser || !navigator.onLine || state.syncing;
  }

  function scheduleSync() {
    setSyncStatus(navigator.onLine ? "Cambios guardados · pendientes de sincronizar" : "Sin conexión · cambios guardados aquí");
    if (state.syncing) {
      state.syncRequested = true;
      return;
    }
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => syncData(), 900);
  }

  function nextModifiedAt(previous) {
    const previousTime = Date.parse(previous || "");
    return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
  }

  async function touchAnimal(animalId) {
    const animal = await getOne("animals", animalId);
    if (animal) await put("animals", { ...animal, updatedAt: nextModifiedAt(animal.updatedAt) });
    scheduleSync();
  }

  async function refresh() {
    [state.animals, state.events, state.photos] = await Promise.all([getAll("animals"), getAll("events"), getAll("photos")]);
    const photoIds = new Set(state.photos.map(photo => photo.id));
    for (const [id, url] of state.photoUrls) {
      if (!photoIds.has(id)) {
        URL.revokeObjectURL(url);
        state.photoUrls.delete(id);
      }
    }
    renderDashboard();
  }

  function buildLocalBundles(animals, events, photos, deletions) {
    const bundles = new Map();
    animals.forEach(animal => bundles.set(animal.id, { animal, events: [], photos: [], deletedAt: null }));
    events.forEach(record => bundles.get(record.animalId)?.events.push(record));
    photos.forEach(photo => bundles.get(photo.animalId)?.photos.push(photo));
    deletions.forEach(deletion => bundles.set(deletion.id, { animal: null, events: [], photos: [], deletedAt: deletion.deletedAt }));
    return bundles;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
    }
    return value;
  }

  function bundleFingerprint(bundle) {
    const deletedAt = bundle.deletedAt ? new Date(bundle.deletedAt).toISOString() : null;
    const photos = bundle.photos.map(photo => ({
      id: photo.id, animalId: photo.animalId, name: photo.name, mime: photo.mime,
      primary: Boolean(photo.primary), createdAt: photo.createdAt
    })).sort((a, b) => a.id.localeCompare(b.id));
    const events = bundle.events.slice().sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify(stableValue({
      deletedAt,
      animal: bundle.animal,
      events,
      photos
    }));
  }

  function remoteFingerprint(record) {
    if (record.deleted_at) return bundleFingerprint({ animal: null, events: [], photos: [], deletedAt: record.deleted_at });
    const payload = record.payload || {};
    return bundleFingerprint({
      animal: payload.animal,
      events: payload.events || [],
      photos: payload.photos || [],
      deletedAt: null
    });
  }

  async function getLocalBundle(animalId) {
    const [animal, events, photos, deletion] = await Promise.all([
      getOne("animals", animalId),
      getAllByIndex("events", "animalId", animalId),
      getAllByIndex("photos", "animalId", animalId),
      getOne("deletedAnimals", animalId)
    ]);
    if (deletion) return { animal: null, events: [], photos: [], deletedAt: deletion.deletedAt };
    if (!animal) return null;
    return { animal, events, photos, deletedAt: null };
  }

  function remoteVersion(record) {
    return record.deleted_at || record.payload?.animal?.updatedAt || null;
  }

  async function saveSyncMeta(animalId, localVersion, remoteVersionValue, fingerprint) {
    await put("syncMeta", {
      id: `animal:${animalId}`,
      localVersion,
      remoteVersion: remoteVersionValue,
      fingerprint
    });
  }

  async function applyRemoteRecord(record, expectedLocalFingerprint) {
    const deletedAt = record.deleted_at;
    let downloaded = null;
    if (!deletedAt) {
      const { animal, events, photos } = record.payload || {};
      if (!animal || animal.id !== record.animal_id || !Array.isArray(events) || !Array.isArray(photos)) {
        throw new Error(`Los datos sincronizados del animal ${record.animal_id} no son válidos.`);
      }
      const storedPhotos = await Promise.all(photos.map(async photo => {
        const { data, error } = await cloud.storage.from("animal-photos").download(photo.storagePath);
        if (error) throw error;
        return { ...photo, blob: data };
      }));
      downloaded = { animal, events, photos: storedPhotos };
    }
    const currentBundle = await getLocalBundle(record.animal_id);
    const currentFingerprint = currentBundle ? bundleFingerprint(currentBundle) : null;
    if (currentFingerprint !== expectedLocalFingerprint) return false;
    const oldPhotos = state.photos.filter(photo => photo.animalId === record.animal_id);
    oldPhotos.forEach(photo => {
      const url = state.photoUrls.get(photo.id);
      if (url) URL.revokeObjectURL(url);
      state.photoUrls.delete(photo.id);
    });
    await transaction(["animals", "events", "photos", "deletedAnimals"], "readwrite", tx => {
      const animalStore = tx.objectStore("animals");
      const eventStore = tx.objectStore("events");
      const photoStore = tx.objectStore("photos");
      const deleteChildren = store => {
        const request = store.index("animalId").openCursor(IDBKeyRange.only(record.animal_id));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      };
      deleteChildren(eventStore);
      deleteChildren(photoStore);
      animalStore.delete(record.animal_id);
      if (deletedAt) {
        tx.objectStore("deletedAnimals").put({ id: record.animal_id, deletedAt });
      } else {
        tx.objectStore("deletedAnimals").delete(record.animal_id);
        animalStore.put(downloaded.animal);
        downloaded.events.forEach(item => eventStore.put(item));
        downloaded.photos.forEach(item => photoStore.put(item));
      }
    });
    return true;
  }

  async function removeUnusedRemotePhotos(animalId, retainedPaths) {
    const bucket = cloud.storage.from("animal-photos");
    const prefix = `${currentUser.id}/${animalId}`;
    const removePaths = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(prefix, { limit: 100, offset });
      if (error) throw error;
      const files = data || [];
      files.forEach(file => {
        const path = `${prefix}/${file.name}`;
        if (!retainedPaths.has(path)) removePaths.push(path);
      });
      if (files.length < 100) break;
    }
    if (removePaths.length) {
      const { error } = await bucket.remove(removePaths);
      if (error) throw error;
    }
  }

  async function writeRemoteRecord(animalId, bundle) {
    const deletedAt = bundle.deletedAt || null;
    const retainedPaths = new Set();
    let payload = null;
    if (!deletedAt) {
      const photos = await Promise.all(bundle.photos.map(async photo => {
        const storagePath = `${currentUser.id}/${animalId}/${photo.id}`;
        const { error } = await cloud.storage.from("animal-photos").upload(storagePath, photo.blob, {
          contentType: photo.mime,
          upsert: true
        });
        if (error) throw error;
        retainedPaths.add(storagePath);
        return {
          id: photo.id, animalId: photo.animalId, name: photo.name, mime: photo.mime,
          primary: Boolean(photo.primary), createdAt: photo.createdAt, storagePath
        };
      }));
      payload = {
        animal: bundle.animal,
        events: bundle.events,
        photos
      };
    }
    const { data, error } = await cloud.from("animal_sync_records").upsert({
      owner_id: currentUser.id,
      animal_id: animalId,
      deleted_at: deletedAt,
      payload
    }, { onConflict: "owner_id,animal_id" }).select("modified_at").single();
    if (error) throw error;
    await removeUnusedRemotePhotos(animalId, retainedPaths);
    return data.modified_at;
  }

  async function syncData() {
    if (!cloud) {
      setSyncStatus("Solo en este dispositivo · configura Supabase");
      return;
    }
    if (!currentUser) {
      setSyncStatus("Inicia sesión para sincronizar");
      return;
    }
    if (!navigator.onLine) {
      setSyncStatus("Sin conexión · cambios guardados aquí");
      return;
    }
    if (state.syncing) {
      state.syncRequested = true;
      return;
    }
    state.syncing = true;
    setSyncStatus("Sincronizando…");
    try {
      const [animals, events, photos, deletions] = await Promise.all([
        getAll("animals"), getAll("events"), getAll("photos"), getAll("deletedAnimals")
      ]);
      const local = buildLocalBundles(animals, events, photos, deletions);
      const { data: remoteRecords, error } = await cloud.from("animal_sync_records")
        .select("animal_id, modified_at, deleted_at, payload");
      if (error) throw error;
      const remote = new Map((remoteRecords || []).map(record => [record.animal_id, record]));
      const animalIds = new Set([...local.keys(), ...remote.keys()]);
      let conflicts = 0;
      let pendingChanges = 0;

      for (const animalId of animalIds) {
        const localBundle = local.get(animalId);
        const remoteRecord = remote.get(animalId);
        if (!localBundle && !remoteRecord) continue;
        const localVersion = localBundle ? (localBundle.deletedAt || localBundle.animal?.updatedAt) : null;
        const cloudVersion = remoteRecord ? remoteVersion(remoteRecord) : null;
        const metadata = await getOne("syncMeta", `animal:${animalId}`);
        const localFingerprint = localBundle ? bundleFingerprint(localBundle) : null;
        const cloudFingerprint = remoteRecord ? remoteFingerprint(remoteRecord) : null;
        const matchingContent = localBundle && remoteRecord && localFingerprint === cloudFingerprint;
        if (matchingContent) {
          await saveSyncMeta(animalId, localVersion, remoteRecord.modified_at, localFingerprint);
          continue;
        }
        const localChanged = Boolean(localBundle && (!metadata || localFingerprint !== metadata.fingerprint));
        const remoteChanged = Boolean(remoteRecord && (!metadata || remoteRecord.modified_at !== metadata.remoteVersion));

        if (localBundle && remoteRecord && localChanged && remoteChanged) {
          const label = localBundle.animal?.name || localBundle.animal?.tag || animalId;
          const keepLocal = confirm(
            `${localBundle.animal ? `El animal ${label}` : `La ficha del animal ${animalId} eliminada en este dispositivo`} también cambió en otro dispositivo.\n\n` +
            "Aceptar: conservar los cambios de este dispositivo y reemplazar la versión en la nube.\n" +
            "Cancelar: conservar la versión de la nube y reemplazar los cambios de este dispositivo."
          );
          if (keepLocal) {
            const version = await writeRemoteRecord(animalId, localBundle);
            await saveSyncMeta(animalId, localVersion, version, localFingerprint);
          } else {
            const applied = await applyRemoteRecord(remoteRecord, localFingerprint);
            if (applied) await saveSyncMeta(animalId, cloudVersion, remoteRecord.modified_at, cloudFingerprint);
            else pendingChanges++;
          }
          conflicts++;
        } else if (localBundle && (!remoteRecord || localChanged)) {
          const version = await writeRemoteRecord(animalId, localBundle);
          await saveSyncMeta(animalId, localVersion, version, localFingerprint);
        } else if (remoteRecord && (!localBundle || remoteChanged)) {
          const applied = await applyRemoteRecord(remoteRecord, localFingerprint);
          if (applied) await saveSyncMeta(animalId, cloudVersion, remoteRecord.modified_at, cloudFingerprint);
          else pendingChanges++;
        }
      }
      await refresh();
      if ($("#detail-dialog").open && state.currentAnimalId) {
        if (state.animals.some(animal => animal.id === state.currentAnimalId)) openDetail(state.currentAnimalId);
        else $("#detail-dialog").close();
      }
      setSyncStatus(pendingChanges
        ? `${pendingChanges} cambio(s) pendiente(s) · vuelve a sincronizar`
        : conflicts ? `Sincronizado · ${conflicts} conflicto(s) resuelto(s)` : "Sincronizado");
    } catch (error) {
      setSyncStatus("Error de sincronización");
      showToast(`No se pudo sincronizar: ${error.message}`);
    } finally {
      state.syncing = false;
      $("#sync-button").disabled = !cloud || !currentUser || !navigator.onLine;
      if (state.syncRequested) {
        state.syncRequested = false;
        setTimeout(() => syncData(), 0);
      }
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  function display(value) { return value ? escapeHtml(value) : "No registrado"; }
  function formatDate(value) {
    if (!value) return "No registrado";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? "No registrado" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }
  function formatTimestamp(value) {
    if (!value) return "No registrado";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "No registrado" : new Intl.DateTimeFormat("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }
  function calculateAge(value) {
    if (!value) return "No registrado";
    const birth = new Date(`${value}T12:00:00`);
    if (Number.isNaN(birth.getTime()) || birth > new Date()) return "No registrado";
    const today = new Date();
    let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth();
    if (today.getDate() < birth.getDate()) months -= 1;
    const years = Math.floor(months / 12);
    const remaining = months % 12;
    if (years === 0 && remaining === 0) return "Menos de un mes";
    return [years ? `${years} ${years === 1 ? "año" : "años"}` : "", remaining ? `${remaining} ${remaining === 1 ? "mes" : "meses"}` : ""].filter(Boolean).join(", ");
  }
  function eventFor(animalId, type) {
    return state.events.filter(event => event.animalId === animalId && event.type === type)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  }
  function initials(animal) {
    const label = animal.name || animal.tag || "?";
    return label.slice(0, 2).toUpperCase();
  }
  function photoUrl(photo) {
    if (!photo?.blob) return "";
    if (!state.photoUrls.has(photo.id)) state.photoUrls.set(photo.id, URL.createObjectURL(photo.blob));
    return state.photoUrls.get(photo.id);
  }

  function renderDashboard() {
    $("#stat-total").textContent = String(state.animals.length);
    $("#stat-females").textContent = String(state.animals.filter(animal => animal.sex === "Hembra").length);
    $("#stat-males").textContent = String(state.animals.filter(animal => animal.sex === "Macho").length);
    const weighed = new Set(state.events.filter(event => event.type === "weight").map(event => event.animalId));
    $("#stat-weighed").textContent = String(weighed.size);

    const query = $("#search-input").value.trim().toLocaleLowerCase("es-MX");
    const status = $("#status-filter").value;
    const filtered = state.animals.filter(animal => {
      if (status && animal.status !== status) return false;
      const searchable = [animal.tag, animal.name, animal.color, animal.sex, animal.status, animal.birthDate]
        .filter(Boolean).join(" ").toLocaleLowerCase("es-MX");
      return !query || searchable.includes(query);
    }).sort((a, b) => {
      const first = sortValue(a, state.sort);
      const second = sortValue(b, state.sort);
      return String(first).localeCompare(String(second), "es-MX", { numeric: true }) * state.direction;
    });

    $("#inventory-count").textContent = `${filtered.length} ${filtered.length === 1 ? "animal" : "animales"}`;
    const rows = $("#animal-rows");
    rows.innerHTML = filtered.map(animal => {
      const weight = eventFor(animal.id, "weight");
      const primaryPhoto = state.photos.find(photo => photo.animalId === animal.id && photo.primary) || state.photos.find(photo => photo.animalId === animal.id);
      const avatar = primaryPhoto
        ? `<img src="${photoUrl(primaryPhoto)}" alt="">`
        : escapeHtml(initials(animal));
      return `<tr>
        <td><div class="animal-cell"><div class="animal-avatar">${avatar}</div><div><button class="animal-link" data-open-animal="${escapeHtml(animal.id)}" type="button">${escapeHtml(animal.name || "Sin nombre")}</button><span class="animal-sub">Arete ${display(animal.tag)}</span></div></div></td>
        <td>${display(animal.sex)}</td><td>${display(animal.color)}</td>
        <td>${weight ? `${escapeHtml(weight.weight)} kg` : "No registrado"}</td>
        <td>${weight ? formatDate(weight.date) : "No registrado"}</td>
        <td><span class="status-pill ${statusClass(animal.status)}">${escapeHtml(animal.status)}</span></td>
        <td><button class="row-menu" data-open-animal="${escapeHtml(animal.id)}" type="button" aria-label="Abrir ficha">›</button></td>
      </tr>`;
    }).join("");

    const noResults = filtered.length === 0;
    $("#empty-state").hidden = !noResults;
    $("table").hidden = noResults;
    const isEmptyInventory = state.animals.length === 0 && !query && !status;
    $("#empty-title").textContent = isEmptyInventory ? "Tu registro comienza aquí" : "No encontramos animales";
    $("#empty-copy").textContent = isEmptyInventory
      ? "Añade tu primer animal para empezar a organizar su información."
      : "Prueba con otra búsqueda o cambia el filtro seleccionado.";
    $("#empty-add-button").hidden = !isEmptyInventory;
  }

  function sortValue(animal, key) {
    if (key === "weight") return Number(eventFor(animal.id, "weight")?.weight || -1);
    if (key === "weighDate") return eventFor(animal.id, "weight")?.date || "";
    return animal[key] || "";
  }
  function statusClass(status) {
    return ({ Vendido: "sold", Fallecido: "dead", Baja: "other", Otro: "other" })[status] || "";
  }
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }
  function today() {
    const date = new Date();
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function newId() { return crypto.randomUUID(); }

  function openAnimalForm(animal = null) {
    const form = $("#animal-form");
    form.reset();
    $("#animal-id").value = animal?.id || "";
    $("#animal-dialog-title").textContent = animal ? "Editar animal" : "Añadir animal";
    form.querySelector('[type="submit"]').textContent = animal ? "Guardar cambios" : "Guardar animal";
    $("#animal-tag").value = animal?.tag || "";
    $("#animal-name").value = animal?.name || "";
    $("#animal-sex").value = animal?.sex || "";
    $("#animal-color").value = animal?.color || "";
    $("#animal-birth").value = animal?.birthDate || "";
    $("#animal-status").value = animal?.status || "Activo";
    $("#initial-records").hidden = Boolean(animal);
    state.animalFormSnapshot = animalFormValues();
    $("#animal-dialog").showModal();
  }

  function animalFormValues() {
    return JSON.stringify([...$("#animal-form").elements]
      .filter(control => !["button", "submit"].includes(control.type))
      .map(control => control.type === "file" ? [...control.files].map(file => `${file.name}:${file.size}`) : control.value));
  }

  function requestClose(dialogId) {
    if (dialogId === "animal-dialog" && animalFormValues() !== state.animalFormSnapshot &&
        !confirm("Hay cambios sin guardar. ¿Salir sin guardarlos?")) return;
    $("#" + dialogId).close();
  }

  function makeEvent(animalId, type, date, fields = {}) {
    return { id: newId(), animalId, type, date, createdAt: new Date().toISOString(), ...fields };
  }

  async function saveAnimal(event) {
    event.preventDefault();
    const id = $("#animal-id").value || newId();
    const existing = state.animals.find(animal => animal.id === id);
    const tag = $("#animal-tag").value.trim();
    if (tag && state.animals.some(animal => animal.id !== id && animal.tag?.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      $("#animal-tag").setCustomValidity("Ya existe un animal con este número de arete.");
      $("#animal-tag").reportValidity();
      $("#animal-tag").setCustomValidity("");
      return;
    }
    const animal = {
      id, tag, name: $("#animal-name").value.trim(), sex: $("#animal-sex").value,
      color: $("#animal-color").value.trim(), birthDate: $("#animal-birth").value,
      status: $("#animal-status").value, createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: nextModifiedAt(existing?.updatedAt)
    };
    const events = [];
    const photos = [];
    if (!existing) {
      const bathDate = $("#initial-bath-date").value;
      const weightDate = $("#initial-weight-date").value;
      const weight = $("#initial-weight").value;
      const vaccineDate = $("#initial-vaccine-date").value;
      const vaccine = $("#initial-vaccine").value.trim();
      const dewormDate = $("#initial-deworm-date").value;
      const dewormer = $("#initial-dewormer").value.trim();
      const note = $("#initial-observation").value.trim();
      const selectedPhotos = [...$("#initial-photos").files];
      if (selectedPhotos.some(file => !file.type.startsWith("image/"))) {
        showToast("Solo se pueden añadir archivos de imagen.");
        return;
      }
      if (bathDate) events.push(makeEvent(id, "bath", bathDate));
      if (weight || weightDate) {
        if (!weight || !weightDate) {
          showToast("Para guardar un pesaje, indica tanto el peso como la fecha.");
          return;
        }
        events.push(makeEvent(id, "weight", weightDate, { weight: Number(weight) }));
      }
      if (vaccine || vaccineDate) events.push(makeEvent(id, "vaccine", vaccineDate || today(), { label: vaccine }));
      if (dewormer || dewormDate) events.push(makeEvent(id, "deworm", dewormDate || today(), { label: dewormer }));
      if (note) events.push(makeEvent(id, "note", today(), { notes: note }));
      selectedPhotos.forEach((file, index) => {
        photos.push({
          id: newId(), animalId: id, name: file.name, mime: file.type, blob: file,
          primary: index === 0, createdAt: new Date().toISOString()
        });
      });
    }
    try {
      await transaction(["animals", "events", "photos"], "readwrite", tx => {
        tx.objectStore("animals").put(animal);
        events.forEach(record => tx.objectStore("events").put(record));
        photos.forEach(photo => tx.objectStore("photos").put(photo));
      });
      $("#animal-dialog").close();
      await refresh();
      scheduleSync();
      if (existing) showToast("Cambios guardados.");
      else showToast("Animal añadido al inventario.");
    } catch (error) {
      showToast(`No se pudo guardar: ${error.message}`);
    }
  }

  function eventSummary(event) {
    if (!event) return "No registrado";
    if (event.type === "weight") return `${escapeHtml(event.weight)} kg`;
    return event.label ? escapeHtml(event.label) : "Registro guardado";
  }

  function openDetail(animalId) {
    const animal = state.animals.find(item => item.id === animalId);
    if (!animal) return;
    state.currentAnimalId = animalId;
    const latestWeight = eventFor(animalId, "weight");
    const latestBath = eventFor(animalId, "bath");
    const latestVaccine = eventFor(animalId, "vaccine");
    const latestDeworm = eventFor(animalId, "deworm");
    const animalEvents = state.events.filter(record => record.animalId === animalId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const photos = state.photos.filter(photo => photo.animalId === animalId);
    const gallery = photos.map(photo => `<div class="photo-tile">
      <img src="${photoUrl(photo)}" alt="Fotografía de ${escapeHtml(animal.name || animal.tag || "animal")}" data-view-photo="${escapeHtml(photo.id)}">
      <button class="photo-star ${photo.primary ? "primary" : ""}" data-primary-photo="${escapeHtml(photo.id)}" type="button" aria-label="${photo.primary ? "Fotografía principal" : "Elegir como fotografía principal"}">★</button>
      <button class="photo-remove" data-delete-photo="${escapeHtml(photo.id)}" type="button" aria-label="Eliminar fotografía">×</button>
    </div>`).join("");

    $("#detail-content").innerHTML = `
      <div class="detail-header">
        <div class="detail-top"><div><div class="eyebrow">EXPEDIENTE INDIVIDUAL</div><h2>${escapeHtml(animal.name || "Animal sin nombre")}</h2><p>Arete ${display(animal.tag)} · ${escapeHtml(animal.sex || "Sexo no registrado")}</p></div>
          <button class="icon-button" type="button" data-close="detail-dialog" aria-label="Cerrar">×</button>
        </div>
        <div class="detail-actions">
          <button class="button button-outline" type="button" data-edit-animal="${escapeHtml(animal.id)}">✎ Actualizar información</button>
          <button class="button button-outline" type="button" data-add-record="weight">＋ Pesaje</button>
          <button class="button button-outline" type="button" data-add-record="vaccine">＋ Vacuna</button>
          <button class="button button-outline" type="button" data-add-record="deworm">＋ Desparasitación</button>
          <button class="button button-outline" type="button" data-add-record="bath">＋ Baño</button>
        </div>
      </div>
      <div class="detail-body">
        <div class="detail-basic">
          <div class="detail-fact"><span>Sexo</span><strong>${display(animal.sex)}</strong></div>
          <div class="detail-fact"><span>Color</span><strong>${display(animal.color)}</strong></div>
          <div class="detail-fact"><span>Última modificación</span><strong>${escapeHtml(formatTimestamp(animal.updatedAt))}</strong></div>
          <div class="detail-fact"><span>Fecha de nacimiento</span><strong>${formatDate(animal.birthDate)}</strong></div>
          <div class="detail-fact"><span>Edad</span><strong>${escapeHtml(calculateAge(animal.birthDate))}</strong></div>
          <div class="detail-fact"><span>Estado</span><strong>${escapeHtml(animal.status)}</strong></div>
          <div class="detail-fact"><span>Último baño</span><strong>${latestBath ? formatDate(latestBath.date) : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Última pesada</span><strong>${latestWeight ? formatDate(latestWeight.date) : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Peso actual</span><strong>${latestWeight ? `${escapeHtml(latestWeight.weight)} kg` : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Última vacuna</span><strong>${latestVaccine ? formatDate(latestVaccine.date) : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Vacuna</span><strong>${eventSummary(latestVaccine)}</strong></div>
          <div class="detail-fact"><span>Última desparasitación</span><strong>${latestDeworm ? formatDate(latestDeworm.date) : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Producto</span><strong>${eventSummary(latestDeworm)}</strong></div>
        </div>
        <section class="detail-section">
          <div class="detail-section-head"><h3>Historial de manejo</h3><button class="add-link" type="button" data-add-record="bath">＋ Añadir registro</button></div>
          <div class="history-list">${renderHistory(animalEvents.filter(record => record.type !== "note"))}</div>
        </section>
        <section class="detail-section">
          <div class="detail-section-head"><h3>Comentarios y observaciones</h3><button class="add-link" type="button" data-add-record="note">＋ Añadir observación</button></div>
          <div class="history-list">${renderHistory(animalEvents.filter(record => record.type === "note"))}</div>
        </section>
        <section class="detail-section">
          <div class="detail-section-head"><h3>Galería de fotografías <span class="muted">(${photos.length})</span></h3></div>
          <div class="gallery">${gallery}<label class="photo-add" title="Añadir fotografías" aria-label="Añadir fotografías">＋<input id="photo-input" type="file" accept="image/*" multiple hidden></label></div>
        </section>
        <div class="detail-section animal-management">
          ${animal.status === "Baja" ? "" : `<button class="add-link" type="button" data-deactivate-animal="${escapeHtml(animal.id)}">Dar de baja</button>`}
          <button class="danger-link" type="button" data-delete-animal="${escapeHtml(animal.id)}">Eliminar definitivamente</button>
        </div>
      </div>`;
    if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
  }

  function renderHistory(records) {
    if (!records.length) return '<p class="history-empty">Todavía no hay registros.</p>';
    return records.map(record => {
      const value = record.type === "weight" ? `<strong>${escapeHtml(record.weight)} kg</strong>`
        : record.type === "note" ? escapeHtml(record.notes)
          : `<strong>${escapeHtml(EVENT_TYPES[record.type])}</strong>${record.label ? ` · ${escapeHtml(record.label)}` : ""}${record.notes ? ` · ${escapeHtml(record.notes)}` : ""}`;
      return `<div class="history-item"><div class="history-date">${formatDate(record.date)}</div><div class="history-description">${value}</div><button class="history-delete" data-delete-event="${escapeHtml(record.id)}" type="button" aria-label="Eliminar registro">×</button></div>`;
    }).join("");
  }

  function openRecordForm(type) {
    const title = EVENT_TYPES[type];
    if (!title || !state.currentAnimalId) return;
    $("#record-form").reset();
    $("#record-animal-id").value = state.currentAnimalId;
    $("#record-type").value = type;
    $("#record-dialog-title").textContent = type === "note" ? "Añadir observación" : `Añadir ${title.toLocaleLowerCase("es-MX")}`;
    const fields = $("#record-fields");
    if (type === "weight") {
      fields.innerHTML = `<label>Fecha<input name="date" type="date" value="${today()}" required></label><label>Peso (kg)<input name="weight" type="number" min="0" step="0.1" placeholder="Ej. 420" required></label><label class="full-width">Observaciones<textarea name="notes" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label>`;
    } else if (type === "note") {
      fields.innerHTML = `<label>Fecha<input name="date" type="date" value="${today()}" required></label><label class="full-width">Observación<textarea name="notes" rows="4" maxlength="2000" placeholder="Escribe una observación..." required></textarea></label>`;
    } else {
      const label = type === "vaccine" ? "Vacuna" : type === "deworm" ? "Producto utilizado" : "Tipo / producto";
      fields.innerHTML = `<label>Fecha<input name="date" type="date" value="${today()}" required></label>${type === "bath" ? "" : `<label>${label}<input name="label" maxlength="120" placeholder="Opcional"></label>`}<label class="full-width">Observaciones<textarea name="notes" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label>`;
    }
    $("#record-dialog").showModal();
  }

  async function saveRecord(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const type = $("#record-type").value;
    const date = String(formData.get("date") || "");
    const fields = {};
    if (type === "weight") fields.weight = Number(formData.get("weight"));
    if (formData.has("label")) fields.label = String(formData.get("label")).trim();
    if (formData.has("notes")) fields.notes = String(formData.get("notes")).trim();
    try {
      await put("events", makeEvent($("#record-animal-id").value, type, date, fields));
      await touchAnimal($("#record-animal-id").value);
      $("#record-dialog").close();
      await refresh();
      openDetail(state.currentAnimalId);
      showToast("Registro guardado en el historial.");
    } catch (error) {
      showToast(`No se pudo guardar: ${error.message}`);
    }
  }

  async function addPhotos(files) {
    const animalId = state.currentAnimalId;
    const images = [...files];
    if (!images.length || images.some(file => !file.type.startsWith("image/"))) {
      showToast("Selecciona uno o más archivos de imagen.");
      return;
    }
    const existing = state.photos.filter(photo => photo.animalId === animalId);
    try {
      await transaction(["photos"], "readwrite", tx => {
        const store = tx.objectStore("photos");
        images.forEach((file, index) => store.put({
          id: newId(), animalId, name: file.name, mime: file.type, blob: file,
          primary: existing.length === 0 && index === 0, createdAt: new Date().toISOString()
        }));
      });
      await touchAnimal(animalId);
      await refresh();
      openDetail(animalId);
      showToast(`${images.length} ${images.length === 1 ? "fotografía añadida" : "fotografías añadidas"}.`);
    } catch (error) {
      showToast(`No se pudieron guardar las fotografías: ${error.message}`);
    }
  }

  async function choosePrimary(photoId) {
    const photo = state.photos.find(item => item.id === photoId);
    if (!photo) return;
    const related = state.photos.filter(item => item.animalId === photo.animalId);
    try {
      await transaction(["photos"], "readwrite", tx => {
        const store = tx.objectStore("photos");
        related.forEach(item => store.put({ ...item, primary: item.id === photoId }));
      });
      await touchAnimal(photo.animalId);
      await refresh();
      openDetail(photo.animalId);
    } catch (error) {
      showToast(`No se pudo actualizar la fotografía principal: ${error.message}`);
    }
  }

  async function deletePhoto(photoId) {
    const photo = state.photos.find(item => item.id === photoId);
    if (!photo || !confirm("¿Está seguro de que desea eliminar esta fotografía?")) return;
    try {
      await remove("photos", photoId);
      const remaining = state.photos.filter(item => item.animalId === photo.animalId && item.id !== photoId);
      if (photo.primary && remaining.length) await put("photos", { ...remaining[0], primary: true });
      await touchAnimal(photo.animalId);
      await refresh();
      openDetail(photo.animalId);
      showToast("Fotografía eliminada.");
    } catch (error) {
      showToast(`No se pudo eliminar la fotografía: ${error.message}`);
    }
  }

  async function deleteEvent(eventId) {
    const record = state.events.find(item => item.id === eventId);
    if (!record || !confirm("¿Eliminar este registro del historial?")) return;
    try {
      await remove("events", eventId);
      await touchAnimal(record.animalId);
      await refresh();
      openDetail(state.currentAnimalId);
      showToast("Registro eliminado.");
    } catch (error) {
      showToast(`No se pudo eliminar: ${error.message}`);
    }
  }

  async function deactivateAnimal(animalId) {
    const animal = state.animals.find(item => item.id === animalId);
    if (!animal) return;
    if (!confirm(`¿Deseas dar de baja a ${animal.name || animal.tag || "este animal"}? Su ficha y su historial se conservarán.`)) return;
    try {
      await put("animals", { ...animal, status: "Baja", updatedAt: nextModifiedAt(animal.updatedAt) });
      scheduleSync();
      $("#detail-dialog").close();
      await refresh();
      showToast("Animal dado de baja; su historial se conservó.");
    } catch (error) {
      showToast(`No se pudo actualizar el animal: ${error.message}`);
    }
  }

  async function deleteAnimal(animalId) {
    const animal = state.animals.find(item => item.id === animalId);
    if (!animal || !confirm(`¿Eliminar definitivamente a ${animal.name || animal.tag || "este animal"} y todo su historial y fotografías? Esta acción no se puede deshacer.`)) return;
    try {
      const deletedAt = nextModifiedAt(animal.updatedAt);
      await transaction(["animals", "events", "photos", "deletedAnimals"], "readwrite", tx => {
        tx.objectStore("animals").delete(animalId);
        tx.objectStore("deletedAnimals").put({ id: animalId, deletedAt });
        for (const name of ["events", "photos"]) {
          const store = tx.objectStore(name);
          const request = store.index("animalId").openCursor(IDBKeyRange.only(animalId));
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
        }
      });
      scheduleSync();
      $("#detail-dialog").close();
      await refresh();
      showToast("Animal y sus registros eliminados.");
    } catch (error) {
      showToast(`No se pudo eliminar el animal: ${error.message}`);
    }
  }

  async function backup() {
    try {
      const payload = { format: "ganadero-backup", version: 1, exportedAt: new Date().toISOString(), animals: state.animals, events: state.events, photos: [] };
      payload.photos = await Promise.all(state.photos.map(async photo => ({
        id: photo.id, animalId: photo.animalId, name: photo.name, mime: photo.mime,
        primary: photo.primary, createdAt: photo.createdAt, data: await blobToDataUrl(photo.blob)
      })));
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ganadero-copia-${today()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast("Copia de seguridad descargada.");
    } catch (error) {
      showToast(`No se pudo crear la copia: ${error.message}`);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (!blob) return reject(new Error("Una fotografía no contiene datos."));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("No fue posible leer una fotografía."));
      reader.readAsDataURL(blob);
    });
  }

  async function restore(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload.format !== "ganadero-backup" || payload.version !== 1 ||
          !Array.isArray(payload.animals) || !Array.isArray(payload.events) || !Array.isArray(payload.photos)) {
        throw new Error("El archivo no tiene un formato de copia de Ganadero compatible.");
      }
      if (!confirm("Importar esta copia reemplazará todos los datos guardados actualmente en este dispositivo. ¿Continuar?")) return;
      const previousAnimals = await getAll("animals");
      const animals = payload.animals.map(animal => ({ ...animal, updatedAt: nextModifiedAt(animal.updatedAt) }));
      const animalIds = new Set(animals.map(animal => animal.id));
      const events = payload.events;
      const photos = await Promise.all(payload.photos.map(async item => {
        if (!animalIds.has(item.animalId) || typeof item.data !== "string" || !item.data.startsWith("data:")) throw new Error("La copia contiene una fotografía o asociación inválida.");
        const response = await fetch(item.data);
        const blob = await response.blob();
        return { id: item.id, animalId: item.animalId, name: item.name, mime: item.mime, primary: Boolean(item.primary), createdAt: item.createdAt, blob };
      }));
      if (events.some(record => !animalIds.has(record.animalId))) throw new Error("La copia contiene registros asociados a animales inexistentes.");
      for (const url of state.photoUrls.values()) URL.revokeObjectURL(url);
      state.photoUrls.clear();
      await transaction(["animals", "events", "photos", "deletedAnimals"], "readwrite", tx => {
        for (const name of ["animals", "events", "photos"]) tx.objectStore(name).clear();
        const deletions = tx.objectStore("deletedAnimals");
        previousAnimals.filter(animal => !animalIds.has(animal.id)).forEach(animal => {
          deletions.put({ id: animal.id, deletedAt: nextModifiedAt(animal.updatedAt) });
        });
        animals.forEach(item => tx.objectStore("animals").put(item));
        animals.forEach(item => deletions.delete(item.id));
        events.forEach(item => tx.objectStore("events").put(item));
        photos.forEach(item => tx.objectStore("photos").put(item));
      });
      await refresh();
      scheduleSync();
      showToast("Copia importada correctamente.");
    } catch (error) {
      showToast(`No se pudo importar la copia: ${error.message}`);
    } finally {
      $("#restore-input").value = "";
    }
  }

  function registerEvents() {
    $("#add-animal-button").addEventListener("click", () => openAnimalForm());
    $("#empty-add-button").addEventListener("click", () => openAnimalForm());
    $("#animal-form").addEventListener("submit", saveAnimal);
    $("#record-form").addEventListener("submit", saveRecord);
    $("#search-input").addEventListener("input", renderDashboard);
    $("#status-filter").addEventListener("change", renderDashboard);
    $$(".sort-button").forEach(button => button.addEventListener("click", () => {
      const key = button.dataset.sort;
      state.direction = state.sort === key ? -state.direction : 1;
      state.sort = key;
      renderDashboard();
    }));
    $("#backup-button").addEventListener("click", backup);
    $("#sync-button").addEventListener("click", syncData);
    $("#account-button").addEventListener("click", () => {
      $("#account-error").hidden = Boolean(cloud);
      $("#account-error").textContent = cloud ? "" : "La conexión con Supabase aún no está configurada. Consulta el README para activarla.";
      $("#account-dialog").showModal();
    });
    $("#account-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (!cloud) return;
      const errorBox = $("#account-error");
      errorBox.hidden = true;
      const { error } = await cloud.auth.signInWithPassword({
        email: $("#account-email").value.trim(),
        password: $("#account-password").value
      });
      if (error) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      } else {
        $("#account-dialog").close();
      }
    });
    $("#create-account-button").addEventListener("click", async () => {
      if (!cloud) return;
      const errorBox = $("#account-error");
      errorBox.hidden = true;
      const { data, error } = await cloud.auth.signUp({
        email: $("#account-email").value.trim(),
        password: $("#account-password").value
      });
      if (error) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      } else if (data.session) {
        $("#account-dialog").close();
      } else {
        errorBox.textContent = "Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión en todos tus dispositivos.";
        errorBox.hidden = false;
      }
    });
    $("#sign-out-button").addEventListener("click", async () => {
      const { error } = await cloud.auth.signOut();
      if (error) showToast(`No se pudo cerrar la sesión: ${error.message}`);
    });
    $("#restore-button").addEventListener("click", () => $("#restore-input").click());
    $("#restore-input").addEventListener("change", event => restore(event.target.files[0]));
    document.addEventListener("click", event => {
      const target = event.target.closest("button, img, label");
      if (!target) return;
      if (target.dataset.close) { requestClose(target.dataset.close); return; }
      if (target.dataset.openAnimal) { openDetail(target.dataset.openAnimal); return; }
      if (target.dataset.editAnimal) {
        const animal = state.animals.find(item => item.id === target.dataset.editAnimal);
        if (animal) { $("#detail-dialog").close(); openAnimalForm(animal); }
        return;
      }
      if (target.dataset.addRecord) { openRecordForm(target.dataset.addRecord); return; }
      if (target.dataset.deletePhoto) { deletePhoto(target.dataset.deletePhoto); return; }
      if (target.dataset.primaryPhoto) { choosePrimary(target.dataset.primaryPhoto); return; }
      if (target.dataset.viewPhoto) {
        const photo = state.photos.find(item => item.id === target.dataset.viewPhoto);
        if (photo) { $("#photo-large").src = photoUrl(photo); $("#photo-dialog").showModal(); }
        return;
      }
      if (target.dataset.deleteEvent) { deleteEvent(target.dataset.deleteEvent); return; }
      if (target.dataset.deactivateAnimal) { deactivateAnimal(target.dataset.deactivateAnimal); return; }
      if (target.dataset.deleteAnimal) { deleteAnimal(target.dataset.deleteAnimal); }
    });
    document.addEventListener("change", event => {
      if (event.target.id === "photo-input") addPhotos(event.target.files);
      if (event.target.id === "animal-tag") event.target.setCustomValidity("");
    });
    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("#search-input").focus();
      }
    });
    [$("#animal-dialog"), $("#detail-dialog"), $("#record-dialog"), $("#photo-dialog")].forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target === dialog) requestClose(dialog.id);
      });
    });
    $("#account-dialog").addEventListener("click", event => {
      if (event.target === event.currentTarget) $("#account-dialog").close();
    });
    $("#animal-dialog").addEventListener("cancel", event => {
      event.preventDefault();
      requestClose("animal-dialog");
    });
  }

  async function initialize() {
    if (!("indexedDB" in window)) {
      document.body.innerHTML = '<main style="max-width:600px;margin:80px auto;padding:24px;font:16px sans-serif"><h1>No se puede iniciar Ganadero</h1><p>Este navegador no ofrece almacenamiento local compatible. Abre la aplicación con un navegador actualizado.</p></main>';
      return;
    }
    try {
      db = await openDatabase();
      registerEvents();
      await refresh();
      if ("serviceWorker" in navigator && location.protocol !== "file:") {
        navigator.serviceWorker.register("./service-worker.js").catch(error => {
          console.error("No se pudo habilitar el modo sin conexión.", error);
        });
      }
      const config = window.GANADERO_CONFIG;
      if (window.supabase?.createClient && config?.supabaseUrl && config?.supabaseAnonKey) {
        cloud = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        cloud.auth.onAuthStateChange((_event, session) => {
          currentUser = session?.user || null;
          $("#account-button").hidden = Boolean(currentUser);
          $("#sign-out-button").hidden = !currentUser;
          setSyncStatus(currentUser ? "Sesión lista" : "Inicia sesión para sincronizar");
          if (currentUser) setTimeout(() => syncData(), 0);
        });
        const { data, error } = await cloud.auth.getSession();
        if (error) throw error;
        currentUser = data.session?.user || null;
        $("#account-button").hidden = Boolean(currentUser);
        $("#sign-out-button").hidden = !currentUser;
        setSyncStatus(currentUser ? "Sesión lista" : "Inicia sesión para sincronizar");
        if (currentUser && navigator.onLine) await syncData();
      } else {
        setSyncStatus("Solo en este dispositivo · configura Supabase");
        $("#sync-button").disabled = true;
      }
      window.addEventListener("online", () => syncData());
      window.addEventListener("offline", () => setSyncStatus("Sin conexión · cambios guardados aquí"));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") syncData();
      });
    } catch (error) {
      document.body.innerHTML = `<main style="max-width:600px;margin:80px auto;padding:24px;font:16px sans-serif"><h1>No se pudo abrir Ganadero</h1><p>${escapeHtml(error.message)}</p></main>`;
    }
  }

  initialize();
})();
