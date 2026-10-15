(() => {
  "use strict";

  const DB_NAME = "ganadero-local";
  const DB_VERSION = 4;
  const EVENT_TYPES = {
    bath: "Baño",
    weight: "Pesaje",
    vaccine: "Vacuna",
    deworm: "Desparasitación",
    note: "Observación",
    injection: "Inyección",
    medication: "Medicamento",
    review: "Revisión veterinaria",
    other: "Otra actividad"
  };
  const JOURNEY_TYPES = {
    bath: "Baño",
    vaccine: "Vacunación",
    deworm: "Desparasitación",
    injection: "Inyección",
    medication: "Aplicación de medicamento",
    weight: "Pesaje",
    review: "Revisión veterinaria",
    other: "Otra"
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const hasRanchAccess = () => !currentUser || state.legacyAccount || ["owner", "admin", "worker"].includes(state.ranchRole);
  const state = { animals: [], events: [], photos: [], journeys: [], forecasts: [], photoUrls: new Map(), sort: "tag", direction: 1, currentAnimalId: null, currentJourneyId: null, journeyFilter: "all", journeySearch: "", journeyWeightTargetId: null, journeyUpdating: new Set(), animalFormSnapshot: "", calculatorProjection: null, calculatorMeasuredGain: null, ranchContext: null, ranchReady: false, legacyAccount: false, ranchOwnerId: null, ranchRole: null, toastTimer: null, syncTimer: null, syncing: false, syncRequested: false };
  let db;
  let cloud;
  let currentUser;
  const canManageRanch = () => !currentUser || state.legacyAccount || ["owner", "admin"].includes(state.ranchRole);
  const isRanchWorker = () => Boolean(currentUser && !state.legacyAccount && state.ranchRole === "worker");

  function openDatabase(name = DB_NAME) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, DB_VERSION);
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
        if (!database.objectStoreNames.contains("journeys")) {
          const store = database.createObjectStore("journeys", { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!database.objectStoreNames.contains("growthForecasts")) {
          const store = database.createObjectStore("growthForecasts", { keyPath: "id" });
          store.createIndex("animalId", "animalId", { unique: false });
          store.createIndex("targetDate", "targetDate", { unique: false });
        }
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

  function readDatabaseStore(database, storeName) {
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function switchRanchDatabase(ownerId) {
    const scopedName = `${DB_NAME}-ranch-${ownerId}`;
    if (db.name === scopedName) return false;
    const previous = db;
    const target = await openDatabase(scopedName);
    const stores = ["animals", "events", "photos", "syncMeta", "deletedAnimals", "journeys", "growthForecasts"];
    const targetRows = await Promise.all(stores.map(store => readDatabaseStore(target, store)));
    const targetEmpty = targetRows.every(rows => rows.length === 0);
    const scopeMarker = targetRows[stores.indexOf("syncMeta")].find(item => item.id === "local-ranch-scope");
    if (!scopeMarker && targetEmpty) {
      let sourceRows = null;
      if (previous.name === DB_NAME) {
        sourceRows = await Promise.all(stores.map(store => readDatabaseStore(previous, store)));
      }
      const tx = target.transaction(stores, "readwrite");
      if (sourceRows) {
        stores.forEach((store, index) => sourceRows[index].forEach(item => tx.objectStore(store).put(item)));
      }
      tx.objectStore("syncMeta").put({ id: "local-ranch-scope", ownerId });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("No se pudo aislar el almacenamiento de este rancho."));
        tx.onabort = () => reject(tx.error || new Error("Se canceló el aislamiento del almacenamiento local."));
      });
      if (sourceRows) {
        const sourceTx = previous.transaction(stores, "readwrite");
        stores.forEach(store => sourceTx.objectStore(store).clear());
        await new Promise((resolve, reject) => {
          sourceTx.oncomplete = resolve;
          sourceTx.onerror = () => reject(sourceTx.error || new Error("No se pudo separar el almacenamiento anterior."));
          sourceTx.onabort = () => reject(sourceTx.error || new Error("Se canceló la separación del almacenamiento anterior."));
        });
      }
    } else if (!scopeMarker) {
      await new Promise((resolve, reject) => {
        const tx = target.transaction("syncMeta", "readwrite");
        tx.objectStore("syncMeta").put({ id: "local-ranch-scope", ownerId });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("No se pudo registrar el ámbito del almacenamiento local."));
        tx.onabort = () => reject(tx.error || new Error("Se canceló el registro del ámbito local."));
      });
    }
    db = target;
    if (previous !== target) previous.close();
    await refresh();
    return true;
  }

  async function switchGuestDatabase() {
    if (db.name === DB_NAME) return;
    const previous = db;
    db = await openDatabase(DB_NAME);
    previous.close();
    await refresh();
  }

  function setSyncStatus(message) {
    $("#sync-label").textContent = message.toLocaleUpperCase("es-MX");
    $("#account-label").textContent = currentUser
      ? `${state.ranchContext?.display_name || currentUser.email}${state.ranchContext?.ranch_name ? ` · ${state.ranchContext.ranch_name}` : ""}`
      : "Sin sesión";
    $("#sync-button").disabled = !cloud || !currentUser || !navigator.onLine || state.syncing;
  }

  function setRanchContext(context) {
    state.ranchContext = context;
    state.ranchOwnerId = context?.status === "active" ? context.owner_id : null;
    state.ranchRole = context?.status === "active" ? context.role : null;
    state.ranchReady = true;
    $("#ranch-button").hidden = !currentUser;
    $("#ranch-button").textContent = context?.status === "active" ? "Rancho y usuarios" : "Configurar rancho";
    $("#account-label").textContent = currentUser
      ? `${context?.display_name || currentUser.email} · ${context?.ranch_name || "Sin rancho"}`
      : "Sin sesión";
    if (currentUser && context?.status === "active") {
      localStorage.setItem(`ganadero-ranch-context:${currentUser.id}`, JSON.stringify(context));
    } else if (currentUser) {
      localStorage.removeItem(`ganadero-ranch-context:${currentUser.id}`);
    }
  }

  async function loadRanchContext() {
    state.ranchReady = false;
    if (!currentUser) {
      state.legacyAccount = false;
      state.ranchOwnerId = null;
      state.ranchRole = null;
      setRanchContext(null);
      return;
    }

    if (!navigator.onLine) {
      const cached = localStorage.getItem(`ganadero-ranch-context:${currentUser.id}`);
      if (cached) {
        const context = JSON.parse(cached);
        if (context.status === "active" && context.owner_id) {
          state.legacyAccount = false;
          setRanchContext(context);
          await switchRanchDatabase(context.owner_id);
          return;
        }
      }
      state.ranchReady = false;
      return;
    }

    const { data, error } = await cloud.rpc("get_my_ranch_context");
    if (error) {
      if (!navigator.onLine) return loadRanchContext();
      if (error.code === "PGRST202" || /get_my_ranch_context|schema cache|could not find the function/i.test(error.message || "")) {
        state.legacyAccount = true;
        setRanchContext({
          status: "legacy",
          owner_id: currentUser.id,
          display_name: currentUser.email || "Propietario",
          ranch_name: "Cuenta personal"
        });
        return;
      }
      state.ranchReady = false;
      setSyncStatus(`No se pudieron comprobar los permisos: ${error.message}`);
      throw error;
    }

    state.legacyAccount = false;
    const context = data || { status: "unassigned" };
    setRanchContext(context);
    if (context.status === "active" && context.owner_id) {
      await switchRanchDatabase(context.owner_id);
    } else {
      if (db.name !== DB_NAME) await switchGuestDatabase();
      state.animals = [];
      state.events = [];
      state.photos = [];
      state.journeys = [];
      state.forecasts = [];
      renderDashboard();
      renderJourneys();
      renderCalculatorAnimalOptions();
    }
  }

  function renderRanchDialog() {
    const context = state.ranchContext;
    const host = $("#ranch-content");
    if (!context) {
      host.innerHTML = '<p class="account-help">Inicia sesión para consultar o administrar el rancho.</p>';
      return;
    }
    if (state.legacyAccount) {
      host.innerHTML = `<p class="account-help">La cuenta aún usa el aislamiento anterior por cuenta. Para habilitar perfiles y solicitudes de acceso, primero aplica en Supabase el archivo <strong>supabase-ranch-access-migration.sql</strong>. La migración es aditiva; no la ejecutes en producción hasta probarla en una copia o proyecto de pruebas.</p>`;
      return;
    }
    if (context.status === "unassigned") {
      host.innerHTML = `
        <p class="account-help">Tu cuenta todavía no pertenece a un rancho. Crea el rancho del que serás propietario o solicita acceso con el código que te comparta su propietario. Una cuenta solo puede pertenecer a un rancho activo.</p>
        <form id="create-ranch-form" class="ranch-form">
          <h3>Crear el primer usuario y rancho</h3>
          <label>Nombre del rancho<input name="ranchName" maxlength="120" required></label>
          <label>Tu nombre<input name="displayName" maxlength="120" required></label>
          <button class="button button-primary" type="submit">Crear rancho como propietario</button>
        </form>
        <form id="request-ranch-form" class="ranch-form">
          <h3>Solicitar acceso a un rancho</h3>
          <label>Código compartido por el propietario<input name="joinCode" minlength="6" maxlength="40" autocomplete="off" required></label>
          <label>Tu nombre<input name="displayName" maxlength="120" required></label>
          <button class="button button-outline" type="submit">Enviar solicitud</button>
        </form>`;
      return;
    }
    if (context.status === "pending") {
      host.innerHTML = `<div class="ranch-callout"><strong>Solicitud pendiente</strong><p>El propietario todavía debe aprobar tu acceso. No se sincronizarán datos del rancho mientras tanto.</p></div>
        <button class="button button-outline button-small" type="button" data-refresh-ranch>Actualizar estado</button>`;
      return;
    }

    const isAdmin = ["owner", "admin"].includes(context.role);
    const requests = (context.requests || []).map(request => `
      <li><span><strong>${escapeHtml(request.display_name)}</strong><small>Solicitado ${escapeHtml(formatTimestamp(request.requested_at))}</small></span>
        <span class="ranch-request-actions"><button class="button button-primary button-small" type="button" data-review-request="${escapeHtml(request.id)}" data-approve="true">Aprobar</button>
        <button class="button button-outline button-small" type="button" data-review-request="${escapeHtml(request.id)}" data-approve="false">Rechazar</button></span></li>`).join("");
    const members = (context.members || []).map(member => `
      <li><span><strong>${escapeHtml(member.display_name)}</strong><small>${escapeHtml(member.role === "owner" ? "Propietario" : member.role === "admin" ? "Administrador" : "Trabajador")}</small></span>
        ${isAdmin && member.role === "worker" ? `<button class="button button-outline button-small" type="button" data-revoke-member="${escapeHtml(member.user_id)}">Retirar acceso</button>` : ""}</li>`).join("");
    host.innerHTML = `
      <div class="ranch-summary"><span>Rancho</span><strong>${escapeHtml(context.ranch_name)}</strong><span>Tu perfil</span><strong>${escapeHtml(context.display_name)} · ${escapeHtml(context.role === "owner" ? "Propietario" : context.role === "admin" ? "Administrador" : "Trabajador")}</strong></div>
      ${isAdmin ? `<section class="ranch-section"><h3>Código para solicitar acceso</h3><p>Comparte este código con la persona. El código solo permite enviar una solicitud; tú debes aprobarla.</p><div class="ranch-code"><code>${escapeHtml(context.join_code || "")}</code><button class="button button-outline button-small" type="button" data-copy-ranch-code>Copiar</button></div></section>
        <button class="button button-outline button-small" type="button" data-refresh-ranch>Actualizar solicitudes</button>
        <section class="ranch-section"><h3>Solicitudes pendientes (${(context.requests || []).length})</h3><ul class="ranch-list">${requests || "<li>No hay solicitudes pendientes.</li>"}</ul></section>
        <section class="ranch-section"><h3>Personas autorizadas</h3><ul class="ranch-list">${members || "<li>No hay perfiles activos.</li>"}</ul></section>` :
        '<p class="account-help">Como trabajador puedes registrar pesajes, tratamientos y jornadas. No puedes editar fichas, fotografías, usuarios ni permisos.</p>'}`;
  }

  async function refreshRanchContext(showDialog = false) {
    try {
      await loadRanchContext();
      if (showDialog) {
        renderRanchDialog();
        if (!$("#ranch-dialog").open) $("#ranch-dialog").showModal();
      }
      return true;
    } catch (error) {
      showToast(`No se pudieron cargar los permisos del rancho: ${error.message}`);
      return false;
    }
  }

  async function submitRanchForm(event, rpcName, parameters, successMessage) {
    event.preventDefault();
    if (!cloud || !currentUser) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await cloud.rpc(rpcName, parameters);
      if (error) throw error;
      await loadRanchContext();
      renderRanchDialog();
      scheduleSync();
      showToast(successMessage);
    } catch (error) {
      showToast(`No se pudo completar la solicitud: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  async function reviewRanchRequest(requestId, approve) {
    try {
      const { error } = await cloud.rpc("review_ranch_access_request", {
        p_request_id: requestId,
        p_approve: approve
      });
      if (error) throw error;
      await loadRanchContext();
      renderRanchDialog();
      if (approve) await syncData();
      showToast(approve ? "Solicitud aprobada; el trabajador ya puede sincronizar." : "Solicitud rechazada.");
    } catch (error) {
      showToast(`No se pudo revisar la solicitud: ${error.message}`);
    }
  }

  async function revokeRanchWorker(userId) {
    try {
      const { error } = await cloud.rpc("revoke_ranch_worker", { p_user_id: userId });
      if (error) throw error;
      await loadRanchContext();
      renderRanchDialog();
      showToast("Se retiró el acceso del trabajador.");
    } catch (error) {
      showToast(`No se pudo retirar el acceso: ${error.message}`);
    }
  }

  function showAccountView(view, message = "", success = false) {
    const views = {
      login: ["Iniciar sesión", "Usa tu correo y contraseña. Tus datos locales permanecen en este dispositivo aunque no haya conexión."],
      register: ["Crear cuenta", "Registra una cuenta de acceso. Esto no concede permisos sobre los datos de un rancho."],
      recovery: ["Recuperar contraseña", "Te enviaremos un enlace para definir una contraseña nueva."],
      "reset-password": ["Crear nueva contraseña", "Elige una contraseña nueva de al menos 8 caracteres."],
      message: [success ? "Revisa tu correo" : "Información", ""]
    };
    const [title, help] = views[view] || views.login;
    $("#account-title").textContent = title;
    $("#account-help").textContent = help;
    $("#account-help").hidden = !help;
    $("#sign-in-form").hidden = view !== "login";
    $("#sign-up-form").hidden = view !== "register";
    $("#recovery-form").hidden = view !== "recovery";
    $("#reset-password-form").hidden = view !== "reset-password";
    $("#account-message-view").hidden = view !== "message";
    const errorBox = $("#account-error");
    errorBox.textContent = message;
    errorBox.hidden = !message;
    errorBox.classList.toggle("account-success", success);
  }

  function authErrorMessage(error) {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || error || "");
    const normalized = message.toLowerCase();
    if (code === "invalid_credentials" || normalized.includes("invalid login credentials")) {
      return "El correo o la contraseña no son correctos.";
    }
    if (code === "email_not_confirmed" || normalized.includes("email not confirmed")) {
      return "Confirma tu correo electrónico desde el enlace que te enviamos antes de iniciar sesión.";
    }
    if (code === "weak_password" || normalized.includes("password should be")) {
      return "La contraseña no cumple los requisitos de seguridad configurados.";
    }
    if (code === "user_already_exists" || normalized.includes("already registered")) {
      return "Ya existe una cuenta con ese correo. Intenta iniciar sesión o recuperar la contraseña.";
    }
    if (normalized.includes("fetch") || normalized.includes("network")) {
      return "No pudimos conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.";
    }
    return message || "No se pudo completar la solicitud. Inténtalo de nuevo.";
  }

  function authRedirectUrl() {
    if (location.protocol !== "http:" && location.protocol !== "https:") return undefined;
    return new URL(location.pathname, location.origin).href;
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
    if (animal && !isRanchWorker()) await put("animals", { ...animal, updatedAt: nextModifiedAt(animal.updatedAt) });
    scheduleSync();
  }

  async function refresh() {
    [state.animals, state.events, state.photos, state.journeys, state.forecasts] = await Promise.all([
      getAll("animals"), getAll("events"), getAll("photos"), getAll("journeys"), getAll("growthForecasts")
    ]);
    const photoIds = new Set(state.photos.map(photo => photo.id));
    for (const [id, url] of state.photoUrls) {
      if (!photoIds.has(id)) {
        URL.revokeObjectURL(url);
        state.photoUrls.delete(id);
      }
    }
    renderDashboard();
    renderJourneys();
    renderCalculatorAnimalOptions();
  }

  function buildLocalBundles(animals, events, photos, forecasts, deletions) {
    const bundles = new Map();
    animals.forEach(animal => bundles.set(animal.id, { animal, events: [], photos: [], forecasts: [], deletedAt: null }));
    events.forEach(record => bundles.get(record.animalId)?.events.push(record));
    photos.forEach(photo => bundles.get(photo.animalId)?.photos.push(photo));
    forecasts.forEach(forecast => bundles.get(forecast.animalId)?.forecasts.push(forecast));
    deletions.forEach(deletion => bundles.set(deletion.id, { animal: null, events: [], photos: [], forecasts: [], deletedAt: deletion.deletedAt }));
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
    const forecasts = (bundle.forecasts || []).slice().sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify(stableValue({
      deletedAt,
      animal: bundle.animal,
      events,
      forecasts,
      photos
    }));
  }

  function remoteFingerprint(record) {
    if (record.deleted_at) return bundleFingerprint({ animal: null, events: [], photos: [], forecasts: [], deletedAt: record.deleted_at });
    const payload = record.payload || {};
    return bundleFingerprint({
      animal: payload.animal,
      events: payload.events || [],
      forecasts: payload.forecasts || [],
      photos: payload.photos || [],
      deletedAt: null
    });
  }

  async function getLocalBundle(animalId) {
    const [animal, events, photos, forecasts, deletion] = await Promise.all([
      getOne("animals", animalId),
      getAllByIndex("events", "animalId", animalId),
      getAllByIndex("photos", "animalId", animalId),
      getAllByIndex("growthForecasts", "animalId", animalId),
      getOne("deletedAnimals", animalId)
    ]);
    if (deletion) return { animal: null, events: [], photos: [], forecasts: [], deletedAt: deletion.deletedAt };
    if (!animal) return null;
    return { animal, events, photos, forecasts, deletedAt: null };
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

  async function syncJourneys(localJourneys) {
    const { data: remoteRows, error } = await cloud.from("journey_sync_records")
      .select("journey_id, updated_at, payload");
    if (error) throw error;
    const remote = new Map((remoteRows || []).map(record => [record.journey_id, record]));
    const local = new Map(localJourneys.map(journey => [journey.id, journey]));
    const journeyIds = new Set([...local.keys(), ...remote.keys()]);

    for (const journeyId of journeyIds) {
      const localJourney = local.get(journeyId);
      const remoteRecord = remote.get(journeyId);
      const metadata = await getOne("syncMeta", `journey:${journeyId}`);
      const localFingerprint = localJourney ? JSON.stringify(stableValue(localJourney)) : null;
      const remoteFingerprintValue = remoteRecord ? JSON.stringify(stableValue(remoteRecord.payload)) : null;
      if (localJourney && remoteRecord && localFingerprint === remoteFingerprintValue) {
        await put("syncMeta", {
          id: `journey:${journeyId}`, fingerprint: localFingerprint, remoteVersion: remoteRecord.updated_at
        });
        continue;
      }
      const localChanged = Boolean(localJourney && (!metadata || localFingerprint !== metadata.fingerprint));
      const remoteChanged = Boolean(remoteRecord && (!metadata || remoteRecord.updated_at !== metadata.remoteVersion));
      let useLocal = Boolean(localJourney && (!remoteRecord || localChanged));
      if (localJourney && remoteRecord && localChanged && remoteChanged) {
        useLocal = confirm(
          `La jornada «${journeyName(localJourney)}» también cambió en otro dispositivo.\n\n` +
          "Aceptar: conservar la versión de este dispositivo.\nCancelar: conservar la versión de la nube."
        );
      } else if (!localJourney && remoteRecord) {
        useLocal = false;
      } else if (!localJourney || !remoteRecord) {
        useLocal = Boolean(localJourney);
      } else if (!localChanged && remoteChanged) {
        useLocal = false;
      }

      if (useLocal && localJourney) {
        const { data, error: saveError } = await cloud.from("journey_sync_records").upsert({
          owner_id: state.ranchOwnerId,
          journey_id: journeyId,
          payload: localJourney
        }, { onConflict: "owner_id,journey_id" }).select("updated_at").single();
        if (saveError) throw saveError;
        await put("syncMeta", {
          id: `journey:${journeyId}`, fingerprint: localFingerprint, remoteVersion: data.updated_at
        });
      } else if (remoteRecord) {
        const latestLocal = await getOne("journeys", journeyId);
        const latestFingerprint = latestLocal ? JSON.stringify(stableValue(latestLocal)) : null;
        if (latestFingerprint !== localFingerprint) continue;
        await put("journeys", remoteRecord.payload);
        await put("syncMeta", {
          id: `journey:${journeyId}`, fingerprint: remoteFingerprintValue, remoteVersion: remoteRecord.updated_at
        });
      }
    }
  }

  async function applyRemoteRecord(record, expectedLocalFingerprint) {
    const deletedAt = record.deleted_at;
    let downloaded = null;
    if (!deletedAt) {
      const { animal, events, photos } = record.payload || {};
      const forecasts = record.payload?.forecasts || [];
      if (!animal || animal.id !== record.animal_id || !Array.isArray(events) || !Array.isArray(photos) || !Array.isArray(forecasts)) {
        throw new Error(`Los datos sincronizados del animal ${record.animal_id} no son válidos.`);
      }
      const storedPhotos = await Promise.all(photos.map(async photo => {
        const { data, error } = await cloud.storage.from("animal-photos").download(photo.storagePath);
        if (error) throw error;
        return { ...photo, blob: data };
      }));
      downloaded = { animal, events, photos: storedPhotos, forecasts };
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
    await transaction(["animals", "events", "photos", "growthForecasts", "deletedAnimals"], "readwrite", tx => {
      const animalStore = tx.objectStore("animals");
      const eventStore = tx.objectStore("events");
      const photoStore = tx.objectStore("photos");
      const forecastStore = tx.objectStore("growthForecasts");
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
      deleteChildren(forecastStore);
      animalStore.delete(record.animal_id);
      if (deletedAt) {
        tx.objectStore("deletedAnimals").put({ id: record.animal_id, deletedAt });
      } else {
        tx.objectStore("deletedAnimals").delete(record.animal_id);
        animalStore.put(downloaded.animal);
        downloaded.events.forEach(item => eventStore.put(item));
        downloaded.photos.forEach(item => photoStore.put(item));
        downloaded.forecasts.forEach(item => forecastStore.put(item));
      }
    });
    return true;
  }

  async function removeUnusedRemotePhotos(animalId, retainedPaths) {
    const bucket = cloud.storage.from("animal-photos");
    const prefix = `${state.ranchOwnerId}/${animalId}`;
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
        const storagePath = `${state.ranchOwnerId}/${animalId}/${photo.id}`;
        if (!isRanchWorker()) {
          const { error } = await cloud.storage.from("animal-photos").upload(storagePath, photo.blob, {
            contentType: photo.mime,
            upsert: true
          });
          if (error) throw error;
        }
        retainedPaths.add(storagePath);
        return {
          id: photo.id, animalId: photo.animalId, name: photo.name, mime: photo.mime,
          primary: Boolean(photo.primary), createdAt: photo.createdAt, storagePath
        };
      }));
      payload = {
        animal: bundle.animal,
        events: bundle.events,
        forecasts: bundle.forecasts || [],
        photos
      };
    }
    const saveQuery = isRanchWorker()
      ? deletedAt
        ? Promise.reject(new Error("Los trabajadores no pueden eliminar fichas de animales."))
        : cloud.from("animal_sync_records")
          .update({ payload })
          .eq("owner_id", state.ranchOwnerId)
          .eq("animal_id", animalId)
          .select("modified_at")
          .single()
      : cloud.from("animal_sync_records").upsert({
          owner_id: state.ranchOwnerId,
          animal_id: animalId,
          deleted_at: deletedAt,
          payload
        }, { onConflict: "owner_id,animal_id" }).select("modified_at").single();
    const { data, error } = await saveQuery;
    if (error) throw error;
    if (!isRanchWorker()) await removeUnusedRemotePhotos(animalId, retainedPaths);
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
    if (!state.ranchReady) {
      setSyncStatus("Comprobando acceso al rancho…");
      return;
    }
    if (!state.ranchOwnerId) {
      setSyncStatus(state.ranchContext?.status === "pending"
        ? "Solicitud de acceso pendiente"
        : "Crea un rancho o solicita acceso para sincronizar");
      return;
    }
    if (!navigator.onLine) {
      setSyncStatus("Sin conexión · cambios guardados aquí");
      return;
    }
    try {
      await loadRanchContext();
    } catch (error) {
      setSyncStatus(`No se pudo comprobar el acceso: ${error.message}`);
      return;
    }
    if (state.syncing) {
      state.syncRequested = true;
      return;
    }
    state.syncing = true;
    setSyncStatus("Sincronizando…");
    try {
      const [animals, events, photos, forecasts, deletions, journeys] = await Promise.all([
        getAll("animals"), getAll("events"), getAll("photos"), getAll("growthForecasts"), getAll("deletedAnimals"), getAll("journeys")
      ]);
      const local = buildLocalBundles(animals, events, photos, forecasts, deletions);
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
      await syncJourneys(journeys);
      await refresh();
      if ($("#detail-dialog").open && state.currentAnimalId) {
        if (state.animals.some(animal => animal.id === state.currentAnimalId)) openDetail(state.currentAnimalId);
        else $("#detail-dialog").close();
      }
      if ($("#journey-dialog").open && state.currentJourneyId) renderJourneyDetail();
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
  function estimatedAgeMonths(ageEstimate, asOf = today()) {
    if (!ageEstimate || (!Number.isInteger(ageEstimate.monthsAtRecord) && !Number.isFinite(ageEstimate.daysAtRecord))) return null;
    const recordedDay = Date.parse(`${ageEstimate.recordedAt}T00:00:00Z`) / 86400000;
    const currentDay = Date.parse(`${asOf}T00:00:00Z`) / 86400000;
    if (!Number.isFinite(recordedDay) || !Number.isFinite(currentDay)) return null;
    const elapsedDays = Math.max(0, currentDay - recordedDay);
    const recordedMonths = Number.isInteger(ageEstimate.monthsAtRecord)
      ? ageEstimate.monthsAtRecord
      : Math.floor((ageEstimate.daysAtRecord + 1e-9) / 30.436875);
    return recordedMonths + Math.floor((elapsedDays + 1e-9) / 30.436875);
  }
  function formatEstimatedAge(ageEstimate) {
    const months = estimatedAgeMonths(ageEstimate);
    if (months === null) return "No registrado";
    if (months === 0) return "0 meses (aproximada)";
    const years = Math.floor(months / 12);
    const remaining = months % 12;
    const label = [years ? `${years} ${years === 1 ? "año" : "años"}` : "", remaining ? `${remaining} ${remaining === 1 ? "mes" : "meses"}` : ""]
      .filter(Boolean).join(", ");
    return `${label} (aproximada)`;
  }
  function estimatedAgeInputParts(ageEstimate) {
    const totalMonths = estimatedAgeMonths(ageEstimate);
    if (totalMonths === null) return { years: "", months: "" };
    return { years: String(Math.floor(totalMonths / 12)), months: String(totalMonths % 12) };
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

  function weightHistory(animalId) {
    const weightsByDate = new Map();
    state.events.filter(record => record.animalId === animalId && record.type === "weight")
      .forEach(record => {
        const weight = Number(record.weight);
        const day = Date.parse(`${record.date}T00:00:00Z`) / 86400000;
        if (!Number.isFinite(weight) || weight < 0 || !Number.isFinite(day)) return;
        const records = weightsByDate.get(record.date) || { weights: [], eventIds: [] };
        records.weights.push(weight);
        records.eventIds.push(record.id);
        weightsByDate.set(record.date, records);
      });
    return [...weightsByDate.entries()]
      .map(([date, records]) => ({
        date,
        day: Date.parse(`${date}T00:00:00Z`) / 86400000,
        weight: records.weights.reduce((sum, weight) => sum + weight, 0) / records.weights.length,
        count: records.weights.length,
        eventIds: records.eventIds
      }))
      .sort((a, b) => a.day - b.day);
  }

  function recentGrowthBasis(points, windowDays = 30) {
    if (points.length < 2) return null;
    const latest = points[points.length - 1];
    const recent = points.filter(point => point.day >= latest.day - windowDays && point.day <= latest.day);
    if (recent.length < 2) return null;
    const first = recent[0];
    const elapsedDays = latest.day - first.day;
    if (elapsedDays <= 0) return null;
    const segmentGains = recent.slice(1).map((point, index) => {
      const previous = recent[index];
      return (point.weight - previous.weight) / (point.day - previous.day);
    });
    const hasGainAndLoss = segmentGains.some(value => value > 0) && segmentGains.some(value => value < 0);
    return {
      first,
      latest,
      points: recent,
      elapsedDays,
      gainKgPerDay: (latest.weight - first.weight) / elapsedDays,
      hasGainAndLoss,
      segmentGains
    };
  }

  function projectWeight(weight, gainKgPerDay, days, baselineDate) {
    const baselineDay = Date.parse(`${baselineDate}T00:00:00Z`) / 86400000;
    if (!Number.isFinite(weight) || !Number.isFinite(gainKgPerDay) ||
        !Number.isFinite(days) || days < 0 || !Number.isFinite(baselineDay)) return null;
    const targetDay = baselineDay + days;
    return {
      baselineDate,
      days,
      gainKgPerDay,
      predictedWeight: weight + gainKgPerDay * days,
      targetDate: new Date(targetDay * 86400000).toISOString().slice(0, 10)
    };
  }

  function evaluateForecast(forecast, actualDate, actualWeight) {
    if (forecast.status !== "pending" || actualDate < forecast.targetDate) return null;
    const errorKg = actualWeight - forecast.predictedWeight;
    return {
      ...forecast,
      status: "evaluated",
      actualDate,
      actualWeight,
      errorKg,
      absoluteErrorKg: Math.abs(errorKg),
      absoluteErrorPercent: forecast.predictedWeight === 0 ? null : Math.abs(errorKg) / Math.abs(forecast.predictedWeight) * 100,
      evaluatedAt: new Date().toISOString()
    };
  }

  function pendingForecastUpdates(forecasts, animalId, weightEvents) {
    const actualWeights = weightEvents
      .filter(record => record.animalId === animalId && record.type === "weight" &&
        Number.isFinite(Number(record.weight)) && Number(record.weight) >= 0)
      .sort((a, b) => a.date.localeCompare(b.date) ||
        String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    return forecasts.filter(forecast => forecast.animalId === animalId && forecast.status === "pending")
      .map(forecast => {
        const actual = actualWeights.find(record =>
          record.date >= forecast.targetDate && record.createdAt >= forecast.createdAt);
        return actual ? evaluateForecast(forecast, actual.date, Number(actual.weight)) : null;
      })
      .filter(Boolean);
  }

  function renderCalculatorAnimalOptions() {
    const select = $("#calculator-animal");
    if (!select) return;
    const selected = select.value;
    const availableAnimals = state.animals.filter(animal => !["Vendido", "Fallecido", "Baja"].includes(animal.status));
    select.innerHTML = `<option value="">Sin seleccionar · captura manual</option>${availableAnimals.map(animal => {
      const label = [animal.tag ? `Arete ${animal.tag}` : "", animal.name || "Sin nombre"].filter(Boolean).join(" · ");
      return `<option value="${escapeHtml(animal.id)}">${escapeHtml(label)}</option>`;
    }).join("")}`;
    if (availableAnimals.some(animal => animal.id === selected)) {
      select.value = selected;
    } else {
      select.value = "";
      if (selected) {
        $("#calculator-weight").value = "";
        $("#calculator-gain").value = "";
        $("#calculator-weight-note").textContent = "El animal seleccionado ya no está disponible. Selecciona otro o captura los datos manualmente.";
      }
    }
    updateCalculator();
  }

  function loadCalculatorAnimal() {
    const animal = state.animals.find(item => item.id === $("#calculator-animal").value);
    if (!animal) {
      state.calculatorMeasuredGain = null;
      $("#calculator-weight").value = "";
      $("#calculator-baseline-date").value = today();
      $("#calculator-gain").value = "";
      $("#calculator-weight-note").textContent = "Captura un peso, fecha base y GMD manual para evaluar un escenario. Una GMD manual es un supuesto, no una medición del crecimiento.";
      updateCalculator();
      return;
    }
    const points = weightHistory(animal.id);
    const latest = points[points.length - 1];
    const basis = recentGrowthBasis(points);
    const daysSinceLatest = latest
      ? Math.floor(Date.parse(`${today()}T00:00:00Z`) / 86400000 - latest.day)
      : null;
    const staleNotice = daysSinceLatest >= 30
      ? ` Aviso: esta pesada tiene ${daysSinceLatest} días; la GMD puede no representar el ritmo actual.`
      : "";
    state.calculatorMeasuredGain = basis ? { animalId: animal.id, value: Number(basis.gainKgPerDay.toFixed(3)), basis } : null;
    $("#calculator-weight").value = latest ? latest.weight.toFixed(1) : "";
    $("#calculator-baseline-date").value = latest?.date || today();
    $("#calculator-gain").value = basis ? basis.gainKgPerDay.toFixed(3) : "";
    if (!latest) {
      $("#calculator-weight-note").textContent = "Este animal no tiene pesajes. Registra uno en su ficha; una GMD manual será un supuesto, no una medición del crecimiento.";
    } else if (!basis) {
      $("#calculator-weight-note").textContent = `Última pesada: ${formatDate(latest.date)}. No hay dos fechas distintas en los últimos 30 días de pesajes para calcular una GMD reciente.${staleNotice}`;
    } else {
      $("#calculator-weight-note").textContent = `Última pesada: ${formatDate(latest.date)}. GMD calculada con ${basis.points.length} fechas en los últimos 30 días de pesajes, del ${formatDate(basis.first.date)} al ${formatDate(basis.latest.date)} (${basis.elapsedDays} días reales); puedes modificarla.${staleNotice}`;
    }
    updateCalculator();
  }

  function calculatorNumber(id) {
    const value = $(id).value.trim();
    if (!value) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("es-MX", {
      style: "currency", currency: "MXN", maximumFractionDigits: 2
    }).format(value);
  }

  function formatProjectedWeight(value) {
    return `${new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value)} kg`;
  }

  function setCalculatorMessage(message, isWarning = false) {
    const element = $("#calculator-result-message");
    element.textContent = message;
    element.classList.toggle("is-warning", isWarning);
  }

  function renderCalculatorChart(weight, gain, days, baselineDate) {
    const chart = $("#calculator-chart");
    const animalId = $("#calculator-animal").value;
    const actualPoints = animalId ? weightHistory(animalId) : [];
    const validBaseline = Number.isFinite(weight) && weight >= 0 &&
      typeof baselineDate === "string" && Number.isFinite(Date.parse(`${baselineDate}T00:00:00Z`));
    const validProjection = validBaseline && Number.isFinite(gain) &&
      Number.isFinite(days) && days >= 0;
    const projection = validProjection ? projectWeight(weight, gain, days, baselineDate) : null;
    const baselineDay = validBaseline ? Date.parse(`${baselineDate}T00:00:00Z`) / 86400000 : null;
    const latestActual = actualPoints[actualPoints.length - 1];
    const baselineMatchesLatest = latestActual && latestActual.date === baselineDate &&
      Math.abs(latestActual.weight - weight) < 0.0001;
    const baselinePoint = validBaseline && !baselineMatchesLatest
      ? { date: baselineDate, day: baselineDay, weight, kind: "baseline" }
      : null;
    const projectedPoint = projection
      ? { date: projection.targetDate, day: baselineDay + days, weight: projection.predictedWeight, kind: "projection" }
      : null;
    const points = [
      ...actualPoints.map(point => ({ ...point, kind: "actual" })),
      ...(baselinePoint ? [baselinePoint] : []),
      ...(projectedPoint ? [projectedPoint] : [])
    ].sort((a, b) => a.day - b.day || ({ actual: 0, baseline: 1, projection: 2 }[a.kind] - { actual: 0, baseline: 1, projection: 2 }[b.kind]));
    if (!points.length) {
      chart.setAttribute("aria-label", "Sin datos disponibles para graficar.");
      chart.innerHTML = '<p class="calculator-chart-empty">Selecciona un animal con pesajes o captura un peso y una fecha base para ver la gráfica.</p>';
      return;
    }

    const width = 640;
    const height = 230;
    const margin = { top: 18, right: 20, bottom: 38, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    let xMin = Math.min(...points.map(point => point.day));
    let xMax = Math.max(...points.map(point => point.day));
    if (xMin === xMax) {
      xMin -= 7;
      xMax += 7;
    }
    let yMin = Math.min(...points.map(point => point.weight));
    let yMax = Math.max(...points.map(point => point.weight));
    const yPadding = Math.max((yMax - yMin) * 0.18, Math.max(Math.abs(yMin), Math.abs(yMax), 1) * 0.06, 1);
    yMin -= yPadding;
    yMax += yPadding;
    if (yMin === yMax) yMax += 1;
    const x = day => margin.left + (day - xMin) / (xMax - xMin) * plotWidth;
    const y = value => margin.top + (yMax - value) / (yMax - yMin) * plotHeight;
    const ticks = [0, 1, 2, 3].map(index => {
      const value = yMax - (yMax - yMin) * index / 3;
      const position = y(value);
      return `<line x1="${margin.left}" y1="${position}" x2="${width - margin.right}" y2="${position}" class="calculator-chart-grid"></line><text x="${margin.left - 8}" y="${position + 4}" text-anchor="end" class="calculator-chart-axis">${value.toFixed(1)}</text>`;
    }).join("");
    const actual = points.filter(point => point.kind === "actual");
    const actualLine = actual.length > 1
      ? `<polyline points="${actual.map(point => `${x(point.day)},${y(point.weight)}`).join(" ")}" class="calculator-chart-actual"></polyline>`
      : "";
    const futureLine = projectedPoint
      ? `<line x1="${x(baselineDay)}" y1="${y(weight)}" x2="${x(projectedPoint.day)}" y2="${y(projectedPoint.weight)}" class="calculator-chart-projection"></line>`
      : "";
    const actualDots = actual.map(point => {
      const isLatest = latestActual && point.date === latestActual.date;
      return `<circle cx="${x(point.day)}" cy="${y(point.weight)}" r="${isLatest ? 5 : 4}" class="calculator-chart-point${isLatest ? " calculator-chart-point-current" : ""}"><title>${isLatest ? "Último peso real · " : ""}${escapeHtml(formatDate(point.date))}: ${formatProjectedWeight(point.weight)}${point.count > 1 ? ` · promedio de ${point.count} pesajes` : ""}</title></circle>`;
    }).join("");
    const markers = [
      baselinePoint
        ? `<circle cx="${x(baselinePoint.day)}" cy="${y(baselinePoint.weight)}" r="5" class="calculator-chart-baseline"><title>Peso base: ${escapeHtml(formatDate(baselineDate))} · ${formatProjectedWeight(weight)}</title></circle>`
        : "",
      projectedPoint
        ? `<circle cx="${x(projectedPoint.day)}" cy="${y(projectedPoint.weight)}" r="5" class="calculator-chart-projected"><title>Estimación: ${escapeHtml(formatDate(projectedPoint.date))} · ${formatProjectedWeight(projectedPoint.weight)}</title></circle>`
        : ""
    ].join("");
    const startDate = new Date(xMin * 86400000).toISOString().slice(0, 10);
    const endDate = new Date(xMax * 86400000).toISOString().slice(0, 10);
    const labels = [
      { day: xMin, text: formatDate(startDate), anchor: "start" },
      ...(baselineDay !== null && baselineDay > xMin && baselineDay < xMax
        ? [{ day: baselineDay, text: formatDate(baselineDate), anchor: "middle" }] : []),
      ...(projectedPoint && projectedPoint.day > xMin && projectedPoint.day < xMax
        ? [{ day: projectedPoint.day, text: formatDate(projectedPoint.date), anchor: "middle" }] : []),
      ...(xMax > xMin ? [{ day: xMax, text: formatDate(endDate), anchor: "end" }] : [])
    ].filter((item, index, all) => all.findIndex(candidate => candidate.day === item.day) === index)
      .map(item => `<text x="${x(item.day)}" y="${height - 12}" text-anchor="${item.anchor}" class="calculator-chart-axis">${escapeHtml(item.text)}</text>`).join("");
    const labelsLegend = [
      actual.length ? '<span><i class="calculator-legend-actual"></i>Pesos reales</span>' : "",
      baselinePoint ? '<span><i class="calculator-legend-baseline"></i>Peso base</span>' : "",
      projectedPoint ? '<span><i class="calculator-legend-projection"></i>Estimación</span>' : ""
    ].filter(Boolean).join("");
    const actualSummary = actual.length
      ? `${actual.length} fecha${actual.length === 1 ? "" : "s"} de pesaje real`
      : "Sin historial de pesajes guardado";
    const baselineSummary = validBaseline
      ? `Base ${formatDate(baselineDate)} · ${formatProjectedWeight(weight)}`
      : "Ingresa un peso y fecha base para graficar la estimación";
    const projectedSummary = projectedPoint
      ? `Estimado ${formatDate(projectedPoint.date)} · ${formatProjectedWeight(projectedPoint.weight)}`
      : "Ingresa una GMD y plazo válidos para proyectar";
    chart.setAttribute("aria-label", `Historial: ${actualSummary}. ${baselineSummary}. ${projectedSummary}.`);
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.getAttribute("aria-label"))}">
        <defs>
          <linearGradient id="calculator-actual-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#75a477" stop-opacity=".2"></stop>
            <stop offset="100%" stop-color="#75a477" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${ticks}${actualLine}${futureLine}${actualDots}${markers}${labels}
      </svg>
      <div class="calculator-chart-legend">${labelsLegend}</div>
      <div class="calculator-chart-summary"><span>${escapeHtml(actualSummary)}</span><span>${escapeHtml(baselineSummary)}</span><span>${escapeHtml(projectedSummary)}</span></div>`;
  }

  function updateCalculator() {
    const weight = calculatorNumber("#calculator-weight");
    const gain = calculatorNumber("#calculator-gain");
    const days = calculatorNumber("#calculator-days");
    const dailyCost = calculatorNumber("#calculator-cost");
    const baselineDate = $("#calculator-baseline-date").value;
    const selectedAnimalId = $("#calculator-animal").value;
    state.calculatorProjection = null;
    renderCalculatorChart(weight, gain, days, baselineDate);
    $("#calculator-save-forecast").disabled = true;
    $("#calculator-save-forecast").hidden = !canManageRanch();
    $("#calculator-forecast-save-note").textContent = "Selecciona un animal para guardar la estimación en su expediente y compararla con una pesada posterior.";
    const currentAverage = calculatorNumber("#calculator-current-average");
    const currentMin = calculatorNumber("#calculator-current-min");
    const currentMax = calculatorNumber("#calculator-current-max");
    const nextThreshold = calculatorNumber("#calculator-next-threshold");
    const nextAverage = calculatorNumber("#calculator-next-average");
    const futurePrice = calculatorNumber("#calculator-future-price");
    const nextMin = calculatorNumber("#calculator-next-min");
    const nextMax = calculatorNumber("#calculator-next-max");
    const resetResults = () => {
      $("#calculator-projected-weight").textContent = "—";
      $("#calculator-projection-detail").textContent = "Ingresa peso, GMD y días.";
      $("#calculator-current-value").textContent = "—";
      $("#calculator-current-range").textContent = "Captura una cotización para valorar.";
      $("#calculator-future-value").textContent = "—";
      $("#calculator-future-detail").textContent = "Depende del peso y precio del escenario.";
      $("#calculator-net-difference").textContent = "—";
      $("#calculator-category-note").textContent = "";
    };
    resetResults();

    if (weight === null) {
      setCalculatorMessage("Selecciona un animal o captura manualmente su peso actual.");
      return;
    }
    if (weight < 0 || days === null || days < 0 || dailyCost === null || dailyCost < 0 ||
        !baselineDate || !Number.isFinite(Date.parse(`${baselineDate}T00:00:00Z`))) {
      setCalculatorMessage("Ingresa un peso, fecha base, número de días y costo diario válidos.", true);
      return;
    }
    const projection = gain === null ? null : projectWeight(weight, gain, days, baselineDate);
    const projectedWeight = projection?.predictedWeight ?? null;
    renderCalculatorChart(weight, gain, days, baselineDate);
    if (projection) {
      $("#calculator-projected-weight").textContent = formatProjectedWeight(projectedWeight);
      $("#calculator-projection-detail").textContent = `${weight.toFixed(1)} kg + (${gain.toFixed(3)} kg/día × ${days.toFixed(0)} días)`;
      const measuredBasis = state.calculatorMeasuredGain?.animalId === selectedAnimalId &&
        state.calculatorMeasuredGain.value === gain ? state.calculatorMeasuredGain.basis : null;
      state.calculatorProjection = {
        animalId: selectedAnimalId || null,
        baselineWeight: weight,
        baselineDate,
        gainKgPerDay: gain,
        days,
        predictedWeight: projectedWeight,
        targetDate: projection.targetDate,
        source: measuredBasis ? "recent-measured-gmd" : "manual-gmd",
        gainStartDate: measuredBasis?.first.date || null,
        gainEndDate: measuredBasis?.latest.date || null,
        gainElapsedDays: measuredBasis?.elapsedDays || null,
        sourceWeightEventIds: measuredBasis ? measuredBasis.points.flatMap(point => point.eventIds) : []
      };
      $("#calculator-projection-detail").textContent += ` · fecha objetivo ${formatDate(projection.targetDate)}`;
    } else {
      $("#calculator-projection-detail").textContent = "No hay GMD reciente; sin ingresar una GMD manual no se proyecta el crecimiento.";
    }
    if (selectedAnimalId && state.calculatorProjection) {
      $("#calculator-save-forecast").disabled = false;
      $("#calculator-save-forecast").hidden = !canManageRanch();
      $("#calculator-forecast-save-note").textContent = state.calculatorProjection.source === "manual-gmd"
        ? "Esta estimación usa una GMD manual. Quedará identificada como supuesto y no como crecimiento medido."
        : "La estimación guardará sus pesadas de origen y su fecha objetivo para compararla con una pesada real posterior.";
    } else {
      $("#calculator-forecast-save-note").textContent = "Selecciona un animal para guardar la estimación en su expediente y compararla con una pesada posterior.";
    }
    if (projectedWeight !== null && projectedWeight < 0) {
      setCalculatorMessage("La GMD negativa se refleja sin corregirla. El peso proyectado queda por debajo de cero y no se calcula valor de mercado; revisa el intervalo, el plazo y las pesadas.", true);
      return;
    }

    if (currentAverage === null || currentAverage < 0) {
      setCalculatorMessage("Captura el precio promedio de hoy para calcular el valor de venta.");
      return;
    }
    if ((currentMin !== null && currentMin < 0) || (currentMax !== null && currentMax < 0) ||
        (currentMin !== null && currentAverage < currentMin) ||
        (currentMax !== null && currentAverage > currentMax)) {
      setCalculatorMessage("La cotización promedio debe quedar entre el mínimo y el máximo capturados.", true);
      return;
    }
    const currentValue = weight * currentAverage;
    $("#calculator-current-value").textContent = formatCurrency(currentValue);
    const currentRange = currentMin !== null && currentMax !== null
      ? `${formatCurrency(weight * currentMin)} – ${formatCurrency(weight * currentMax)}`
      : currentMin !== null ? `Desde ${formatCurrency(weight * currentMin)} · precio mínimo`
        : currentMax !== null ? `Hasta ${formatCurrency(weight * currentMax)} · precio máximo`
          : "Valor bruto con precio promedio";
    $("#calculator-current-range").textContent = currentRange;

    if (projectedWeight === null) {
      setCalculatorMessage("Captura una GMD reciente o manual para comparar la venta después de esperar.");
      return;
    }
    if ((nextMin !== null && nextMin < 0) || (nextMax !== null && nextMax < 0) ||
        (nextAverage !== null && nextAverage < 0) ||
        (nextThreshold !== null && nextThreshold < 0) ||
        (futurePrice !== null && futurePrice < 0) ||
        (nextMin !== null && nextAverage !== null && nextAverage < nextMin) ||
        (nextMax !== null && nextAverage !== null && nextAverage > nextMax)) {
      setCalculatorMessage("Revisa la cotización del siguiente rango: el promedio debe quedar entre el mínimo y el máximo.", true);
      return;
    }
    const usesNextRange = nextThreshold !== null && nextAverage !== null && projectedWeight >= nextThreshold;
    const salePrice = futurePrice !== null ? futurePrice : usesNextRange ? nextAverage : currentAverage;
    const futureValue = projectedWeight * salePrice;
    const netDifference = futureValue - currentValue - dailyCost * days;
    const futureMinPrice = futurePrice !== null ? null : usesNextRange ? nextMin : currentMin;
    const futureMaxPrice = futurePrice !== null ? null : usesNextRange ? nextMax : currentMax;
    $("#calculator-future-value").textContent = formatCurrency(futureValue);
    const futureRange = futureMinPrice !== null && futureMaxPrice !== null
      ? ` · rango ${formatCurrency(projectedWeight * futureMinPrice)}–${formatCurrency(projectedWeight * futureMaxPrice)}`
      : futureMinPrice !== null ? ` · desde ${formatCurrency(projectedWeight * futureMinPrice)}`
        : futureMaxPrice !== null ? ` · hasta ${formatCurrency(projectedWeight * futureMaxPrice)}`
          : "";
    $("#calculator-future-detail").textContent = `${formatProjectedWeight(projectedWeight)} × ${formatCurrency(salePrice)}/kg${futureRange}${usesNextRange && futurePrice === null ? ` · ${$("#calculator-next-category").value.trim() || "siguiente rango"}` : futurePrice !== null ? " · precio futuro supuesto por ti" : " · promedio actual como supuesto"}`;
    $("#calculator-net-difference").textContent = `${netDifference > 0 ? "+" : ""}${formatCurrency(netDifference)}`;
    $("#calculator-net-difference").classList.toggle("is-negative", netDifference < 0);
    $("#calculator-net-difference").classList.toggle("is-positive", netDifference >= 0);
    const quoteDate = $("#calculator-price-date").value;
    let categoryNote = quoteDate ? `Cotización con fecha ${formatDate(quoteDate)}.` : "Sin fecha de cotización; ingrésala para identificar la vigencia del dato.";
    if (quoteDate) {
      const quoteDay = Date.parse(`${quoteDate}T00:00:00Z`) / 86400000;
      const quoteAge = Math.floor(Date.parse(`${today()}T00:00:00Z`) / 86400000 - quoteDay);
      if (quoteAge > 30) categoryNote += ` Tiene ${quoteAge} días; conviene actualizarla.`;
      if (quoteAge < 0) categoryNote += " La fecha de cotización está en el futuro; verifica el dato.";
    }
    if (usesNextRange && futurePrice === null) {
      categoryNote += ` El peso proyectado alcanza el siguiente rango${$("#calculator-next-category").value.trim() ? ` (${$("#calculator-next-category").value.trim()})` : ""}.`;
    } else if (futurePrice === null && nextThreshold !== null && projectedWeight >= nextThreshold && nextAverage === null) {
      categoryNote += " El peso proyectado alcanza el siguiente rango, pero falta capturar su precio; se usa el promedio actual.";
    }
    $("#calculator-category-note").textContent = categoryNote;
    setCalculatorMessage(gain < 0
      ? "La proyección refleja una GMD negativa (pérdida de peso); no se fuerza una ganancia positiva."
      : "Comparación calculada con los datos ingresados. Puedes modificar la GMD, los costos y el precio supuesto.");
  }

  async function saveCalculatorForecast() {
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede guardar estimaciones.");
      return;
    }
    const projection = state.calculatorProjection;
    const animalId = $("#calculator-animal").value;
    if (!projection || !animalId || projection.animalId !== animalId ||
        !state.animals.some(animal => animal.id === animalId)) {
      showToast("Selecciona un animal y calcula una proyección válida antes de guardarla.");
      return;
    }
    const forecast = {
      id: newId(),
      animalId,
      status: "pending",
      method: "linear-gmd",
      ...projection,
      createdAt: new Date().toISOString()
    };
    try {
      await put("growthForecasts", forecast);
      await touchAnimal(animalId);
      await refresh();
      $("#calculator-save-forecast").disabled = true;
      $("#calculator-forecast-save-note").textContent = `Estimación guardada. Se comparará con la primera pesada registrada en o después del ${formatDate(forecast.targetDate)}.`;
      showToast("Estimación guardada en el expediente del animal.");
    } catch (error) {
      showToast(`No se pudo guardar la estimación: ${error.message}`);
    }
  }

  function growthTargetValues(animal) {
    const minValue = animal.targetWeightMin;
    const maxValue = animal.targetWeightMax;
    const targetMin = minValue === "" || minValue == null ? NaN : Number(minValue);
    const targetMax = maxValue === "" || maxValue == null ? NaN : Number(maxValue);
    return {
      targetMin,
      targetMax,
      hasTarget: Number.isFinite(targetMin) && targetMin >= 0 &&
        Number.isFinite(targetMax) && targetMax >= targetMin
    };
  }

  function renderGrowthTargetForm(animal) {
    if (!canManageRanch()) return "";
    const { targetMin, targetMax, hasTarget } = growthTargetValues(animal);
    return `<form id="growth-target-form" class="growth-target-form">
      <label>Peso objetivo mínimo (kg)<input name="targetMin" type="number" min="0" step="0.1" value="${hasTarget ? targetMin : ""}" placeholder="Ej. 160"></label>
      <label>Peso objetivo máximo (kg)<input name="targetMax" type="number" min="0" step="0.1" value="${hasTarget ? targetMax : ""}" placeholder="Ej. 200"></label>
      <button class="button button-outline button-small" type="submit">Guardar rango</button>
      <span class="growth-target-help">Deja ambos campos vacíos para quitar el objetivo.</span>
    </form>`;
  }

  function renderGrowthForecastHistory(animalId) {
    const forecasts = state.forecasts.filter(forecast => forecast.animalId === animalId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
    if (!forecasts.length) return "";
    const rows = forecasts.map(forecast => {
      const source = forecast.source === "recent-measured-gmd"
        ? `GMD medida · ${forecast.gainElapsedDays} días entre pesajes`
        : "GMD manual · supuesto";
      const result = forecast.status === "evaluated"
        ? `Real: ${formatProjectedWeight(forecast.actualWeight)} el ${formatDate(forecast.actualDate)} · error ${forecast.errorKg > 0 ? "+" : ""}${forecast.errorKg.toFixed(2)} kg (absoluto ${forecast.absoluteErrorKg.toFixed(2)} kg)${forecast.absoluteErrorPercent === null ? "" : ` · ${forecast.absoluteErrorPercent.toFixed(1)}%`}`
        : `Pendiente de pesada en o después del ${formatDate(forecast.targetDate)}`;
      return `<div class="growth-forecast-item">
        <div><strong>${formatProjectedWeight(forecast.predictedWeight)} · ${formatDate(forecast.targetDate)}</strong><span>${escapeHtml(source)} · base ${formatDate(forecast.baselineDate)} · ${forecast.days} días</span></div>
        <p class="${forecast.status === "evaluated" ? "evaluated" : ""}">${escapeHtml(result)}</p>
      </div>`;
    }).join("");
    return `<div class="growth-forecast-history"><strong>Estimaciones guardadas</strong>${rows}</div>`;
  }

  function renderGrowthChart(animal, points) {
    if (!points.length) {
      return `<section class="detail-section growth-section">
        <div class="detail-section-head"><h3>Crecimiento y peso objetivo</h3></div>
        <p class="growth-empty">Registra el primer peso para ver el crecimiento de este animal.</p>
        <button class="button button-outline button-small growth-first-weighing" type="button" data-add-record="weight">＋ Registrar primer peso</button>
        ${renderGrowthTargetForm(animal)}
      </section>`;
    }
    const latest = points[points.length - 1];
    const { targetMin, targetMax, hasTarget } = growthTargetValues(animal);
    const basis = recentGrowthBasis(points);
    const todayDay = Date.parse(`${today()}T00:00:00Z`) / 86400000;
    const daysSinceWeighing = Math.floor(todayDay - latest.day);
    const staleMessage = daysSinceWeighing >= 30
      ? `<p class="growth-warning">Conviene volver a pesar este animal. La última pesada fue hace ${daysSinceWeighing} días.</p>` : "";
    const projectionDays = basis ? 90 : 0;
    const projectedDay = latest.day + projectionDays;
    const projectedWeight = basis ? latest.weight + basis.gainKgPerDay * projectionDays : null;
    let summary;
    if (!basis) {
      summary = points.length < 2
        ? "Una sola fecha no permite calcular crecimiento. Registra otra pesada para comparar."
        : "No hay dos fechas distintas dentro de los 30 días más recientes de pesajes; no se genera una proyección automática.";
    } else {
      const dailyChange = `${basis.gainKgPerDay >= 0 ? "+" : ""}${basis.gainKgPerDay.toFixed(2)} kg/día`;
      summary = `GMD reciente: ${dailyChange}, entre ${formatDate(basis.first.date)} y ${formatDate(basis.latest.date)} (${basis.elapsedDays} días reales; ${basis.points.length} fechas en la ventana reciente).`;
      if (basis.hasGainAndLoss) summary += " Los intervalos recientes alternan ganancia y pérdida; la GMD resume el periodo, pero el ritmo es variable.";
      if (hasTarget) {
        if (latest.weight >= targetMin && latest.weight <= targetMax) {
          summary += " El peso más reciente está dentro del rango objetivo.";
        } else {
          const targetDays = latest.weight < targetMin && basis.gainKgPerDay > 0
            ? (targetMin - latest.weight) / basis.gainKgPerDay
            : latest.weight > targetMax && basis.gainKgPerDay < 0
              ? (targetMax - latest.weight) / basis.gainKgPerDay
              : NaN;
          if (Number.isFinite(targetDays) && targetDays >= 0) {
            summary += ` Llegada estimada al rango: ${Math.ceil(targetDays)} días, si se mantiene esta tendencia.`;
          }
        }
      }
    }

    const chartWidth = 640;
    const chartHeight = 260;
    const margin = { top: 18, right: 18, bottom: 38, left: 52 };
    const plotWidth = chartWidth - margin.left - margin.right;
    const plotHeight = chartHeight - margin.top - margin.bottom;
    let xMin = points[0].day;
    let xMax = latest.day + (projectionDays || 30);
    if (xMin === xMax) xMin -= 15;
    const chartValues = points.map(point => point.weight);
    if (basis) chartValues.push(projectedWeight);
    if (hasTarget) chartValues.push(targetMin, targetMax);
    const rawMin = Math.min(...chartValues);
    const rawMax = Math.max(...chartValues);
    const yPadding = Math.max((rawMax - rawMin) * 0.12, 2);
    const yMin = rawMin - yPadding;
    const yMax = rawMax + yPadding || 1;
    const x = day => margin.left + ((day - xMin) / (xMax - xMin)) * plotWidth;
    const y = weight => margin.top + ((yMax - weight) / (yMax - yMin)) * plotHeight;
    const grid = [0, 1, 2, 3].map(index => {
      const value = yMin + ((yMax - yMin) * index / 3);
      const position = y(value);
      return `<line x1="${margin.left}" y1="${position}" x2="${chartWidth - margin.right}" y2="${position}" class="growth-grid-line"></line><text x="${margin.left - 8}" y="${position + 4}" text-anchor="end" class="growth-axis-label">${value.toFixed(0)}</text>`;
    }).join("");
    const target = hasTarget
      ? `<rect x="${margin.left}" y="${y(targetMax)}" width="${plotWidth}" height="${Math.max(2, y(targetMin) - y(targetMax))}" class="growth-target-band"></rect><line x1="${margin.left}" y1="${y(targetMin)}" x2="${chartWidth - margin.right}" y2="${y(targetMin)}" class="growth-target-edge"></line><line x1="${margin.left}" y1="${y(targetMax)}" x2="${chartWidth - margin.right}" y2="${y(targetMax)}" class="growth-target-edge"></line>` : "";
    const actualLine = points.length > 1
      ? `<polyline points="${points.map(point => `${x(point.day)},${y(point.weight)}`).join(" ")}" class="growth-actual-line"></polyline>` : "";
    const projectionLine = basis
      ? `<line x1="${x(latest.day)}" y1="${y(latest.weight)}" x2="${x(projectedDay)}" y2="${y(projectedWeight)}" class="growth-projection-line"></line>` : "";
    const dots = points.map(point =>
      `<circle cx="${x(point.day)}" cy="${y(point.weight)}" r="4.5" class="growth-point"><title>${formatDate(point.date)} · ${point.weight.toFixed(1)} kg</title></circle>`
    ).join("");
    const dateLabels = [
      { day: xMin, label: formatDate(new Date(xMin * 86400000).toISOString().slice(0, 10)) },
      { day: latest.day, label: formatDate(latest.date) },
      { day: xMax, label: formatDate(new Date(xMax * 86400000).toISOString().slice(0, 10)) }
    ].map((item, index) =>
      `<text x="${x(item.day)}" y="${chartHeight - 10}" text-anchor="${index === 0 ? "start" : index === 2 ? "end" : "middle"}" class="growth-axis-label">${escapeHtml(item.label)}</text>`
    ).join("");
    const trendMetrics = basis && basis.points.length >= 3
      ? `<span>GMD medida <strong>${basis.gainKgPerDay.toFixed(2)} kg/día</strong></span><span>Ventana reciente <strong>${basis.elapsedDays} días · ${basis.points.length} fechas</strong></span>`
      : basis
        ? `<span>GMD reciente <strong>${basis.gainKgPerDay.toFixed(2)} kg/día</strong></span><span>Ventana reciente <strong>${basis.elapsedDays} días · ${basis.points.length} fechas</strong></span>`
        : `<span>Pesajes en la ventana reciente <strong>${points.length}</strong></span>`;
    const disclaimer = basis
      ? "Proyección matemática lineal a 90 días desde la última pesada, no garantía de crecimiento. El cálculo usa solo la GMD observada en la ventana reciente; no considera alimentación, genética, salud ni manejo."
      : "";

    return `<section class="detail-section growth-section">
      <div class="detail-section-head"><h3>Crecimiento y peso objetivo</h3></div>
      <div class="growth-summary"><strong>${latest.weight.toFixed(1)} kg</strong><span>Última pesada: ${formatDate(latest.date)}</span></div>
      ${staleMessage}
      <svg class="growth-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Gráfica de pesajes reales y tendencia estimada para ${escapeHtml(animal.name || animal.tag || "el animal")}">
        ${target}${grid}${actualLine}${projectionLine}${dots}${dateLabels}
      </svg>
      <div class="growth-legend"><span><i class="growth-legend-real"></i> Peso real</span>${basis ? '<span><i class="growth-legend-projection"></i> Proyección GMD a 90 días</span>' : ""}${hasTarget ? '<span><i class="growth-legend-target"></i> Rango objetivo</span>' : ""}</div>
      <div class="growth-metrics">${trendMetrics}</div>
      <p class="growth-reliability">${escapeHtml(summary)}</p>
      ${disclaimer ? `<p class="growth-disclaimer">${escapeHtml(disclaimer)}</p>` : ""}
      ${renderGrowthForecastHistory(animal.id)}
      ${renderGrowthTargetForm(animal)}
    </section>`;
  }

  function renderDashboard() {
    $("#add-animal-button").hidden = !canManageRanch();
    $("#empty-add-button").hidden = !canManageRanch();
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
    $("#empty-add-button").hidden = !isEmptyInventory || !canManageRanch();
  }

  function journeyName(journey) {
    return journey.name || JOURNEY_TYPES[journey.type] || "Jornada";
  }

  function journeyCounts(journey) {
    const attended = journey.roster.filter(animal => animal.attended).length;
    return { attended, expected: journey.roster.length, pending: journey.roster.length - attended };
  }

  function journeyStatus(journey) {
    if (journey.status === "in_progress") return "En progreso";
    return journey.status === "completed" ? "Completada" : "Incompleta";
  }

  function renderJourneys() {
    const inProgress = state.journeys.filter(journey => journey.status === "in_progress")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    $("#active-journeys-section").hidden = inProgress.length === 0;
    $("#active-journeys").innerHTML = inProgress.map(journey => {
      const counts = journeyCounts(journey);
      const percent = counts.expected ? Math.round(counts.attended / counts.expected * 100) : 0;
      return `<button class="journey-progress-card" type="button" data-open-journey="${escapeHtml(journey.id)}">
        <span class="journey-progress-main"><strong>${escapeHtml(journeyName(journey))}</strong><span>${formatDate(journey.date)} · ${counts.expected} animales esperados</span></span>
        <span class="journey-progress-count">${counts.attended}/${counts.expected}<small>atendidos</small></span>
        <span class="journey-progress-track"><span style="width:${percent}%"></span></span>
        <span class="journey-progress-pending">${counts.pending} pendientes · Continuar ›</span>
      </button>`;
    }).join("");

    const history = state.journeys.slice().sort((a, b) =>
      (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
    $("#journey-history-rows").innerHTML = history.map(journey => {
      const counts = journeyCounts(journey);
      return `<tr>
        <td>${formatDate(journey.date)}</td>
        <td><strong>${escapeHtml(journeyName(journey))}</strong>${journey.product ? `<small>${escapeHtml(journey.product)}</small>` : ""}</td>
        <td>${counts.attended}/${counts.expected}</td>
        <td><span class="journey-status ${journey.status}">${escapeHtml(journeyStatus(journey))}</span></td>
        <td><button class="button button-outline button-small" type="button" data-open-journey="${escapeHtml(journey.id)}">${journey.status === "incomplete" ? "Abrir y continuar" : "Ver jornada"}</button></td>
      </tr>`;
    }).join("");
    $("#journey-history-empty").hidden = history.length > 0;
  }

  function setMainView(view) {
    const journeys = view === "journeys";
    const calculator = view === "calculator";
    $("#inventory-view").hidden = journeys || calculator;
    $("#journeys-view").hidden = !journeys;
    $("#calculator-view").hidden = !calculator;
    $("#inventory-nav").classList.toggle("active", !journeys && !calculator);
    $("#journeys-nav").classList.toggle("active", journeys);
    $("#calculator-nav").classList.toggle("active", calculator);
    $("#inventory-nav").setAttribute("aria-current", !journeys && !calculator ? "page" : "false");
    $("#journeys-nav").setAttribute("aria-current", journeys ? "page" : "false");
    $("#calculator-nav").setAttribute("aria-current", calculator ? "page" : "false");
    $("#breadcrumb-current").textContent = calculator ? "Calculadora" : journeys ? "Jornadas" : "Ganado";
    renderJourneys();
    if (calculator) renderCalculatorAnimalOptions();
  }

  function openJourneyCreateForm() {
    if (!hasRanchAccess()) {
      showToast("Crea un rancho o espera a que aprueben tu solicitud para registrar jornadas.");
      return;
    }
    if (!state.animals.length) {
      $("#journey-no-animals").hidden = false;
      $("#start-journey-button").disabled = true;
    } else {
      $("#journey-no-animals").hidden = true;
      $("#start-journey-button").disabled = false;
    }
    $("#journey-form").reset();
    $("#journey-date").value = today();
    $("#journey-type").querySelector('option[value="other"]').hidden = isRanchWorker();
    updateJourneyFormFields();
    $("#journey-create-dialog").showModal();
  }

  function updateJourneyFormFields() {
    const type = $("#journey-type").value;
    $("#journey-name-field").hidden = type !== "other";
    $("#journey-product-field").hidden = !["vaccine", "deworm", "injection", "medication", "other"].includes(type);
    $("#journey-dose-field").hidden = !["injection", "medication", "other"].includes(type);
  }

  async function createJourney(event) {
    event.preventDefault();
    if (!hasRanchAccess()) {
      showToast("Crea un rancho o espera a que aprueben tu solicitud para registrar jornadas.");
      return;
    }
    if (!state.animals.length) return;
    const type = $("#journey-type").value;
    if (isRanchWorker() && type === "other") {
      showToast("El perfil de trabajador no puede registrar actividades personalizadas.");
      return;
    }
    const journey = {
      id: newId(),
      type,
      name: type === "other" ? $("#journey-name").value.trim() : "",
      date: $("#journey-date").value,
      product: $("#journey-product").value.trim(),
      dose: $("#journey-dose").value.trim(),
      notes: $("#journey-notes").value.trim(),
      roster: state.animals.map(animal => ({
        id: animal.id, tag: animal.tag || "", name: animal.name || "", sex: animal.sex || "",
        color: animal.color || "", status: animal.status || "", attended: false
      })),
      status: "in_progress",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };
    if (!journey.date || (type === "other" && !journey.name)) return;
    try {
      await put("journeys", journey);
      $("#journey-create-dialog").close();
      await refresh();
      setMainView("journeys");
      openJourney(journey.id);
      scheduleSync();
    } catch (error) {
      showToast(`No se pudo iniciar la jornada: ${error.message}`);
    }
  }

  function openJourney(journeyId) {
    const journey = state.journeys.find(item => item.id === journeyId);
    if (!journey) return;
    state.currentJourneyId = journeyId;
    state.journeyFilter = "all";
    state.journeySearch = "";
    state.journeyWeightTargetId = null;
    renderJourneyDetail();
    if (!$("#journey-dialog").open) $("#journey-dialog").showModal();
  }

  function journeyActor() {
    return currentUser
      ? {
          authUserId: currentUser.id,
          email: currentUser.email || "",
          label: state.ranchContext?.display_name || currentUser.email || "Usuario autenticado"
        }
      : { authUserId: null, email: "", label: "Usuario local (sin sesión)" };
  }

  function renderJourneyDetail() {
    const journey = state.journeys.find(item => item.id === state.currentJourneyId);
    if (!journey) return;
    const counts = journeyCounts(journey);
    const percent = counts.expected ? Math.round(counts.attended / counts.expected * 100) : 0;
    const finished = journey.status !== "in_progress";
    const query = state.journeySearch.trim().toLocaleLowerCase("es-MX");
    const roster = journey.roster.filter(animal => {
      if (state.journeyFilter === "attended" && !animal.attended) return false;
      if (state.journeyFilter === "pending" && animal.attended) return false;
      const search = [animal.tag, animal.name, animal.sex, animal.color].filter(Boolean).join(" ").toLocaleLowerCase("es-MX");
      return !query || search.includes(query);
    });
    const details = [
      journey.product && `Producto: ${journey.product}`,
      journey.dose && `Dosis: ${journey.dose}`,
      journey.notes && `Observaciones: ${journey.notes}`
    ].filter(Boolean);
    const rosterIds = new Set(journey.roster.map(animal => animal.id));
    const animalsToAdd = state.animals.filter(animal =>
      !rosterIds.has(animal.id) && !["Vendido", "Fallecido", "Baja"].includes(animal.status));
    const addAnimalsControl = !finished && animalsToAdd.length
      ? `<details class="journey-add-animals">
          <summary>＋ Agregar animales a esta jornada (${animalsToAdd.length} disponibles)</summary>
          <div class="journey-add-list">${animalsToAdd.map(animal => `<label>
            <input type="checkbox" name="journey-animal-to-add" value="${escapeHtml(animal.id)}">
            <span><strong>${escapeHtml(animal.tag || "Sin arete")}</strong><small>${escapeHtml(animal.name || "Sin nombre")}</small></span>
          </label>`).join("")}</div>
          <button class="button button-outline button-small" type="button" data-add-journey-animals="${escapeHtml(journey.id)}">Agregar seleccionados</button>
        </details>`
      : "";

    $("#journey-content").innerHTML = `
      <div class="journey-detail-header">
        <div class="journey-detail-top">
          <div><div class="eyebrow">JORNADA DE MANEJO</div><h2>${escapeHtml(journeyName(journey))}</h2><p>${formatDate(journey.date)} · ${counts.expected} animales esperados</p></div>
          <button class="icon-button" type="button" data-close="journey-dialog" aria-label="Cerrar">×</button>
        </div>
        <div class="journey-summary">
          <div><strong>${counts.attended} de ${counts.expected}</strong><span>animales atendidos</span></div>
          <div><strong>${counts.pending}</strong><span>pendientes</span></div>
          <div><strong>${percent}%</strong><span>${finished ? journeyStatus(journey) : "del progreso"}</span></div>
        </div>
        <div class="journey-progress-track journey-progress-large"><span style="width:${percent}%"></span></div>
        ${journey.completedAt ? `<p class="journey-meta">Finalizada ${formatTimestamp(journey.completedAt)} · ${escapeHtml(journey.completedBy?.label || "Usuario anterior")}</p>` : ""}
        ${details.length ? `<p class="journey-meta">${details.map(escapeHtml).join(" · ")}</p>` : ""}
      </div>
      <div class="journey-detail-body">
        ${finished ? `<div class="journey-finish-message ${counts.pending ? "warning" : "success"}">${counts.pending ? `⚠ ${counts.pending} ${counts.pending === 1 ? "animal pendiente" : "animales pendientes"}. No recibirán el registro de esta jornada.` : "✓ Jornada completada. El historial de los animales atendidos fue actualizado."}</div>` : ""}
        <div class="journey-roster-tools">
          <label class="search-box"><span aria-hidden="true">⌕</span><input id="journey-search" type="search" placeholder="Buscar arete o nombre..." value="${escapeHtml(state.journeySearch)}" autocomplete="off"></label>
          <div class="journey-filter" role="group" aria-label="Filtrar animales">
            <button type="button" data-journey-filter="all" class="${state.journeyFilter === "all" ? "selected" : ""}">Todos</button>
            <button type="button" data-journey-filter="attended" class="${state.journeyFilter === "attended" ? "selected" : ""}">Atendidos</button>
            <button id="journey-filter-pending" type="button" data-journey-filter="pending" class="${state.journeyFilter === "pending" ? "selected" : ""}">Pendientes${counts.pending ? ` (${counts.pending})` : ""}</button>
          </div>
        </div>
        ${addAnimalsControl}
        <div class="journey-roster" aria-label="Animales de la jornada">
          ${roster.length ? roster.map(animal => `
            <div class="journey-animal-row">
              <button class="journey-animal ${animal.attended ? "attended" : "pending"}" type="button"
                data-toggle-attendance="${escapeHtml(animal.id)}" ${finished || animal.attended ? "disabled" : ""}
                aria-pressed="${animal.attended}" aria-label="${animal.attended ? "Atendido" : "Pendiente"}: arete ${escapeHtml(animal.tag || "sin arete")}, ${escapeHtml(animal.name || "sin nombre")}">
                <span class="journey-check" aria-hidden="true">${animal.attended ? "✓" : ""}</span>
                <span class="journey-animal-id">${escapeHtml(animal.tag || "Sin arete")}</span>
                <span class="journey-animal-name">${escapeHtml(animal.name || "Sin nombre")}</span>
                <span class="journey-animal-description">${escapeHtml([animal.sex, animal.color].filter(Boolean).join(" · ") || "Datos sin registrar")}</span>
                <span class="journey-animal-state">${animal.attended ? "Atendido" : "Pendiente"}</span>
                ${animal.attendedAt ? `<span class="journey-animal-audit">Atendido ${formatTimestamp(animal.attendedAt)} · ${escapeHtml(animal.attendedBy?.label || "Usuario anterior")}</span>` : ""}
              </button>
              ${journey.type === "weight" && animal.attended && !finished
                ? `<button class="journey-weight-edit" type="button" data-edit-journey-weight="${escapeHtml(animal.id)}">Corregir peso · ${escapeHtml(animal.weight)} kg</button>`
                : journey.type === "weight" && animal.attended
                  ? `<span class="journey-weight-readonly">${escapeHtml(animal.weight)} kg</span>` : ""}
              ${journey.type === "weight" && !finished && state.journeyWeightTargetId === animal.id
                ? `<div class="journey-weight-editor">
                    <label>Peso (kg)<input id="journey-weight-input" type="number" min="0" step="0.1" value="${animal.attended ? escapeHtml(animal.weight) : ""}" inputmode="decimal" aria-label="Peso en kilogramos"></label>
                    <button class="button button-primary button-small" type="button" data-save-journey-weight="${escapeHtml(animal.id)}">Guardar</button>
                    <button class="button button-outline button-small" type="button" data-cancel-journey-weight>Cancelar</button>
                  </div>` : ""}
            </div>`).join("") : '<p class="journey-empty">No hay animales en este filtro.</p>'}
        </div>
        ${!finished && counts.pending ? `<p class="journey-pending-alert">⚠ Faltan ${counts.pending} ${counts.pending === 1 ? "animal" : "animales"} por atender. Se muestran en el filtro «Pendientes».</p>` : ""}
        ${finished && counts.pending ? `<section class="journey-pending-summary"><h3>Animales pendientes (${counts.pending})</h3><p>${journey.roster.filter(animal => !animal.attended).map(animal => `${animal.tag || "Sin arete"} · ${animal.name || "Sin nombre"}`).map(escapeHtml).join("  |  ")}</p></section>` : ""}
        <div class="journey-modal-actions">
          <span class="journey-status ${journey.status}">${escapeHtml(journeyStatus(journey))}</span>
          ${journey.status === "incomplete" ? `<button class="button button-outline" type="button" data-reopen-journey="${escapeHtml(journey.id)}">Reanudar jornada</button>` : ""}
          ${!finished ? '<button class="button button-primary journey-finish-button" type="button" data-finish-journey>Finalizar jornada</button>' : ""}
        </div>
      </div>`;
    const search = $("#journey-search");
    search.addEventListener("input", () => {
      const selectionStart = search.selectionStart;
      state.journeySearch = search.value;
      renderJourneyDetail();
      const nextSearch = $("#journey-search");
      nextSearch.focus();
      nextSearch.setSelectionRange(selectionStart, selectionStart);
    });
  }

  async function toggleJourneyAnimal(animalId) {
    const journey = state.journeys.find(item => item.id === state.currentJourneyId);
    if (!hasRanchAccess() || !journey || journey.status !== "in_progress" || state.journeyUpdating.has(animalId)) return;
    if (isRanchWorker() && journey.type === "other") {
      showToast("El perfil de trabajador no puede registrar actividades personalizadas.");
      return;
    }
    const selectedAnimal = journey.roster.find(animal => animal.id === animalId);
    if (!selectedAnimal || selectedAnimal.attended) return;
    if (journey.type === "weight") {
      state.journeyWeightTargetId = animalId;
      renderJourneyDetail();
      $("#journey-weight-input").focus();
      return;
    }
    state.journeyUpdating.add(animalId);
    try {
      const attendedAt = new Date().toISOString();
      const roster = journey.roster.map(animal => animal.id === animalId
        ? {
            ...animal,
            attended: true,
            attendedAt,
            attendedBy: journeyActor()
          }
        : animal);
      await put("journeys", { ...journey, roster, updatedAt: new Date().toISOString() });
      await refresh();
      renderJourneyDetail();
      scheduleSync();
    } catch (error) {
      showToast(`No se pudo actualizar la jornada: ${error.message}`);
    } finally {
      state.journeyUpdating.delete(animalId);
    }
  }

  async function addJourneyAnimals(journeyId) {
    const journey = state.journeys.find(item => item.id === journeyId);
    if (!hasRanchAccess() || !journey || journey.status !== "in_progress") return;
    const selectedIds = [...$$('input[name="journey-animal-to-add"]:checked')].map(input => input.value);
    if (!selectedIds.length) {
      showToast("Selecciona al menos un animal para agregar.");
      return;
    }
    const rosterIds = new Set(journey.roster.map(animal => animal.id));
    const newRosterAnimals = state.animals
      .filter(animal => selectedIds.includes(animal.id) && !rosterIds.has(animal.id) &&
        !["Vendido", "Fallecido", "Baja"].includes(animal.status))
      .map(animal => ({
        id: animal.id, tag: animal.tag || "", name: animal.name || "", sex: animal.sex || "",
        color: animal.color || "", status: animal.status || "", attended: false
      }));
    if (!newRosterAnimals.length) {
      showToast("Los animales seleccionados ya están en la jornada o no están disponibles.");
      return;
    }
    try {
      await put("journeys", {
        ...journey,
        roster: journey.roster.concat(newRosterAnimals),
        updatedAt: new Date().toISOString()
      });
      await refresh();
      renderJourneyDetail();
      scheduleSync();
      showToast(`${newRosterAnimals.length} ${newRosterAnimals.length === 1 ? "animal agregado" : "animales agregados"} a la jornada.`);
    } catch (error) {
      showToast(`No se pudieron agregar animales: ${error.message}`);
    }
  }

  async function reopenJourney(journeyId) {
    const journey = state.journeys.find(item => item.id === journeyId);
    if (!hasRanchAccess() || !journey || journey.status !== "incomplete" || !journeyCounts(journey).pending) return;
    if (isRanchWorker() && journey.type === "other") {
      showToast("El perfil de trabajador no puede reabrir actividades personalizadas.");
      return;
    }
    try {
      await put("journeys", {
        ...journey,
        status: "in_progress",
        completedAt: null,
        updatedAt: new Date().toISOString()
      });
      await refresh();
      renderJourneyDetail();
      scheduleSync();
      showToast("Jornada reanudada. Los animales ya atendidos permanecen registrados.");
    } catch (error) {
      showToast(`No se pudo reanudar la jornada: ${error.message}`);
    }
  }

  function editJourneyWeight(animalId) {
    const journey = state.journeys.find(item => item.id === state.currentJourneyId);
    const rosterAnimal = journey?.roster.find(item => item.id === animalId);
    if (!journey || journey.status !== "in_progress" || journey.type !== "weight" ||
        !rosterAnimal?.attended || state.journeyUpdating.has(animalId)) return;
    state.journeyWeightTargetId = animalId;
    renderJourneyDetail();
    $("#journey-weight-input").focus();
  }

  async function saveJourneyWeight(animalId) {
    const journey = state.journeys.find(item => item.id === state.currentJourneyId);
    const rosterAnimal = journey?.roster.find(item => item.id === animalId);
    if (!journey || journey.status !== "in_progress" || journey.type !== "weight" ||
        !rosterAnimal || state.journeyWeightTargetId !== animalId || state.journeyUpdating.has(animalId)) return;
    const rawWeight = $("#journey-weight-input").value.trim();
    const weight = Number(rawWeight);
    if (!rawWeight || !Number.isFinite(weight) || weight < 0) {
      showToast("Escribe un peso válido mayor o igual a 0 kg.");
      return;
    }
    const updatedAt = new Date().toISOString();
    const actor = journeyActor();
    const roster = journey.roster.map(item => item.id === animalId
      ? {
          ...item,
          attended: true,
          weight,
          ...(item.attended
            ? { weightUpdatedAt: updatedAt, weightUpdatedBy: actor }
            : { attendedAt: updatedAt, attendedBy: actor, weightUpdatedAt: updatedAt, weightUpdatedBy: actor })
        }
      : item);
    state.journeyUpdating.add(animalId);
    try {
      await transaction(["journeys", "events", "animals"], "readwrite", tx => {
        tx.objectStore("journeys").put({ ...journey, roster, updatedAt });
        const eventStore = tx.objectStore("events");
        const eventId = `journey:${journey.id}:${animalId}`;
        const eventRequest = eventStore.get(eventId);
        eventRequest.onsuccess = () => {
          if (eventRequest.result) {
            eventStore.put({
              ...eventRequest.result,
              weight,
              weightUpdatedAt: updatedAt,
              weightUpdatedBy: actor
            });
          }
        };
        if (!isRanchWorker()) {
          const animalStore = tx.objectStore("animals");
          const animalRequest = animalStore.get(animalId);
          animalRequest.onsuccess = () => {
            if (animalRequest.result) {
              animalStore.put({
                ...animalRequest.result,
                updatedAt: nextModifiedAt(animalRequest.result.updatedAt)
              });
            }
          };
        }
      });
      state.journeyWeightTargetId = null;
      await refresh();
      renderJourneyDetail();
      scheduleSync();
      showToast(rosterAnimal.attended ? "Peso corregido en la jornada." : "Peso registrado y animal marcado como atendido.");
    } catch (error) {
      showToast(`No se pudo corregir el peso: ${error.message}`);
    } finally {
      state.journeyUpdating.delete(animalId);
    }
  }

  async function finishJourney() {
    const journey = state.journeys.find(item => item.id === state.currentJourneyId);
    if (!hasRanchAccess() || !journey || journey.status !== "in_progress") return;
    if (isRanchWorker() && journey.type === "other") {
      showToast("El perfil de trabajador no puede finalizar actividades personalizadas.");
      return;
    }
    const counts = journeyCounts(journey);
    if (counts.pending && !confirm(`⚠ Todavía hay ${counts.pending} ${counts.pending === 1 ? "animal pendiente" : "animales pendientes"}.\n\n¿Está seguro de que desea finalizar la jornada? Solo se registrarán los animales atendidos.`)) return;
    const completedAt = new Date().toISOString();
    const finishedJourney = {
      ...journey,
      status: counts.pending ? "incomplete" : "completed",
      completedAt,
      completedBy: journeyActor(),
      updatedAt: completedAt
    };
    try {
      await transaction(["journeys", "events", "animals", "growthForecasts"], "readwrite", tx => {
        tx.objectStore("journeys").put(finishedJourney);
        const animalsStore = tx.objectStore("animals");
        const eventsStore = tx.objectStore("events");
        const forecastsStore = tx.objectStore("growthForecasts");
        journey.roster.filter(animal => animal.attended).forEach(rosterAnimal => {
          if (!isRanchWorker()) {
            const animalRequest = animalsStore.get(rosterAnimal.id);
            animalRequest.onsuccess = () => {
              const animal = animalRequest.result;
              if (animal) animalsStore.put({ ...animal, updatedAt: nextModifiedAt(animal.updatedAt) });
            };
          }
          const eventType = journey.type;
          const fields = {
            journeyId: journey.id,
            label: journey.type === "other" ? journey.name : journey.product,
            product: journey.type === "other" ? journey.product : "",
            dose: journey.dose,
            notes: journey.notes,
            createdAt: rosterAnimal.attendedAt || completedAt,
            performedAt: rosterAnimal.attendedAt || completedAt,
            performedBy: rosterAnimal.attendedBy || journeyActor()
          };
          if (journey.type === "weight") {
            fields.weight = rosterAnimal.weight;
            if (rosterAnimal.weightUpdatedAt) fields.weightUpdatedAt = rosterAnimal.weightUpdatedAt;
            if (rosterAnimal.weightUpdatedBy) fields.weightUpdatedBy = rosterAnimal.weightUpdatedBy;
          }
          const eventRecord = {
            id: `journey:${journey.id}:${rosterAnimal.id}`,
            animalId: rosterAnimal.id,
            type: eventType,
            date: journey.date,
            ...fields
          };
          eventsStore.put(eventRecord);
          if (!isRanchWorker() && eventType === "weight" && Number.isFinite(Number(rosterAnimal.weight))) {
            pendingForecastUpdates(state.forecasts, rosterAnimal.id, state.events.concat(eventRecord))
              .forEach(forecast => forecastsStore.put(forecast));
          }
        });
      });
      await refresh();
      const selectedAnimalId = $("#calculator-animal").value;
      if (journey.type === "weight" && journey.roster.some(animal => animal.attended && animal.id === selectedAnimalId)) {
        loadCalculatorAnimal();
      }
      if (counts.pending) {
        state.journeyFilter = "pending";
      } else {
        state.journeyFilter = "all";
      }
      renderJourneyDetail();
      scheduleSync();
      showToast(counts.pending ? `Jornada finalizada. ${counts.attended} animales actualizados; ${counts.pending} pendientes.` : `Jornada completada. ${counts.attended} animales actualizados.`);
    } catch (error) {
      showToast(`No se pudo finalizar la jornada: ${error.message}`);
    }
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
  function isDateOnly(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function newId() { return crypto.randomUUID(); }

  function openAnimalForm(animal = null) {
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede crear o editar fichas de animales.");
      return;
    }
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
    const estimatedAgeParts = estimatedAgeInputParts(animal?.estimatedAge);
    $("#animal-age-years").value = estimatedAgeParts.years;
    $("#animal-age-months").value = estimatedAgeParts.months;
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
    const performedAt = new Date().toISOString();
    return { id: newId(), animalId, type, date, createdAt: performedAt, performedAt, performedBy: journeyActor(), ...fields };
  }

  async function saveAnimal(event) {
    event.preventDefault();
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede crear o editar fichas de animales.");
      return;
    }
    const id = $("#animal-id").value || newId();
    const existing = state.animals.find(animal => animal.id === id);
    const tag = $("#animal-tag").value.trim();
    if (tag && state.animals.some(animal => animal.id !== id && animal.tag?.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      $("#animal-tag").setCustomValidity("Ya existe un animal con este número de arete.");
      $("#animal-tag").reportValidity();
      $("#animal-tag").setCustomValidity("");
      return;
    }
    const birthDate = $("#animal-birth").value;
    const yearsInput = $("#animal-age-years").value.trim();
    const monthsInput = $("#animal-age-months").value.trim();
    const ageYears = yearsInput ? Number(yearsInput) : 0;
    const ageMonths = monthsInput ? Number(monthsInput) : 0;
    const todayDay = Date.parse(`${today()}T00:00:00Z`);
    const birthDay = birthDate ? Date.parse(`${birthDate}T00:00:00Z`) : NaN;
    if (birthDate && (!Number.isFinite(birthDay) || birthDay > todayDay)) {
      showToast("La fecha de nacimiento confirmada no puede estar en el futuro.");
      return;
    }
    if (birthDate && (yearsInput || monthsInput)) {
      showToast("Indica la fecha de nacimiento confirmada o una edad aproximada, no ambas.");
      return;
    }
    if ((yearsInput || monthsInput) &&
        (!Number.isInteger(ageYears) || ageYears < 0 || !Number.isInteger(ageMonths) || ageMonths < 0 || ageMonths > 11)) {
      showToast("La edad aproximada requiere años enteros y meses entre 0 y 11.");
      return;
    }
    const estimatedAge = yearsInput || monthsInput
      ? { monthsAtRecord: ageYears * 12 + ageMonths, recordedAt: today() }
      : null;
    const animal = {
      ...(existing || {}),
      id, tag, name: $("#animal-name").value.trim(), sex: $("#animal-sex").value,
      color: $("#animal-color").value.trim(), birthDate, ...(estimatedAge ? { estimatedAge } : {}),
      status: $("#animal-status").value, createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: nextModifiedAt(existing?.updatedAt)
    };
    if (!estimatedAge) delete animal.estimatedAge;
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
    const growthPoints = weightHistory(animalId);
    const animalAge = animal.birthDate ? calculateAge(animal.birthDate) : formatEstimatedAge(animal.estimatedAge);
    const animalEvents = state.events.filter(record => record.animalId === animalId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const photos = state.photos.filter(photo => photo.animalId === animalId);
    const manager = canManageRanch();
    const worker = isRanchWorker();
    const gallery = photos.map(photo => `<div class="photo-tile">
      <img src="${photoUrl(photo)}" alt="Fotografía de ${escapeHtml(animal.name || animal.tag || "animal")}" data-view-photo="${escapeHtml(photo.id)}">
      ${manager ? `<button class="photo-star ${photo.primary ? "primary" : ""}" data-primary-photo="${escapeHtml(photo.id)}" type="button" aria-label="${photo.primary ? "Fotografía principal" : "Elegir como fotografía principal"}">★</button>
      <button class="photo-remove" data-delete-photo="${escapeHtml(photo.id)}" type="button" aria-label="Eliminar fotografía">×</button>` : ""}
    </div>`).join("");
    const recordButtons = manager
      ? `<button class="button button-outline" type="button" data-add-record="weight">＋ Pesaje</button>
          <button class="button button-outline" type="button" data-add-record="vaccine">＋ Vacuna</button>
          <button class="button button-outline" type="button" data-add-record="deworm">＋ Desparasitación</button>
          <button class="button button-outline" type="button" data-add-record="bath">＋ Baño</button>`
      : worker
        ? `<button class="button button-outline" type="button" data-add-record="weight">＋ Pesaje</button>
          <button class="button button-outline" type="button" data-add-record="vaccine">＋ Vacuna</button>
          <button class="button button-outline" type="button" data-add-record="deworm">＋ Desparasitación</button>
          <button class="button button-outline" type="button" data-add-record="bath">＋ Baño</button>`
        : "";

    $("#detail-content").innerHTML = `
      <div class="detail-header">
        <div class="detail-top"><div><div class="eyebrow">EXPEDIENTE INDIVIDUAL</div><h2>${escapeHtml(animal.name || "Animal sin nombre")}</h2><p>Arete ${display(animal.tag)} · ${escapeHtml(animal.sex || "Sexo no registrado")}</p></div>
          <button class="icon-button" type="button" data-close="detail-dialog" aria-label="Cerrar">×</button>
        </div>
        <div class="detail-actions">
          ${manager ? `<button class="button button-outline" type="button" data-edit-animal="${escapeHtml(animal.id)}">✎ Actualizar información</button>` : ""}
          ${recordButtons}
        </div>
      </div>
      <div class="detail-body">
        <div class="detail-basic">
          <div class="detail-fact"><span>Sexo</span><strong>${display(animal.sex)}</strong></div>
          <div class="detail-fact"><span>Color</span><strong>${display(animal.color)}</strong></div>
          <div class="detail-fact"><span>Última modificación</span><strong>${escapeHtml(formatTimestamp(animal.updatedAt))}</strong></div>
          <div class="detail-fact"><span>Fecha de nacimiento confirmada</span><strong>${formatDate(animal.birthDate)}</strong></div>
          <div class="detail-fact"><span>Edad${animal.estimatedAge && !animal.birthDate ? " aproximada" : ""}</span><strong>${escapeHtml(animalAge)}</strong></div>
          <div class="detail-fact"><span>Estado</span><strong>${escapeHtml(animal.status)}</strong></div>
          <div class="detail-fact"><span>Último baño</span><strong>${latestBath ? formatDate(latestBath.date) : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Última pesada</span><strong>${latestWeight ? formatDate(latestWeight.date) : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Peso actual</span><strong>${latestWeight ? `${escapeHtml(latestWeight.weight)} kg` : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Última vacuna</span><strong>${latestVaccine ? formatDate(latestVaccine.date) : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Vacuna</span><strong>${eventSummary(latestVaccine)}</strong></div>
          <div class="detail-fact"><span>Última desparasitación</span><strong>${latestDeworm ? formatDate(latestDeworm.date) : "No registrado"}</strong></div>
          <div class="detail-fact"><span>Producto</span><strong>${eventSummary(latestDeworm)}</strong></div>
        </div>
        ${renderGrowthChart(animal, growthPoints)}
        <section class="detail-section">
          <div class="detail-section-head"><h3>Historial sanitario y de manejo</h3>${manager || worker ? '<button class="add-link" type="button" data-add-record="bath">＋ Añadir registro</button>' : ""}</div>
          <div class="history-list">${renderHistory(animalEvents.filter(record => record.type !== "note"), manager)}</div>
        </section>
        <section class="detail-section">
          <div class="detail-section-head"><h3>Comentarios y observaciones</h3>${manager ? '<button class="add-link" type="button" data-add-record="note">＋ Añadir observación</button>' : ""}</div>
          <div class="history-list">${renderHistory(animalEvents.filter(record => record.type === "note"), manager)}</div>
        </section>
        <section class="detail-section">
          <div class="detail-section-head"><h3>Galería de fotografías <span class="muted">(${photos.length})</span></h3></div>
          <div class="gallery">${gallery}${manager ? '<label class="photo-add" title="Añadir fotografías" aria-label="Añadir fotografías">＋<input id="photo-input" type="file" accept="image/*" multiple hidden></label>' : ""}</div>
        </section>
        <div class="detail-section animal-management">
          ${manager && animal.status !== "Baja" ? `<button class="add-link" type="button" data-deactivate-animal="${escapeHtml(animal.id)}">Dar de baja</button>` : ""}
          ${manager ? `<button class="danger-link" type="button" data-delete-animal="${escapeHtml(animal.id)}">Eliminar definitivamente</button>` : ""}
        </div>
      </div>`;
    if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
  }

  function renderHistory(records, allowDelete = canManageRanch()) {
    if (!records.length) return '<p class="history-empty">Todavía no hay registros.</p>';
    return records.map(record => {
      const value = record.type === "weight" ? `<strong>${escapeHtml(record.weight)} kg</strong>`
        : record.type === "note" ? escapeHtml(record.notes)
          : `<strong>${escapeHtml(EVENT_TYPES[record.type] || "Registro")}</strong>${record.label ? ` · ${escapeHtml(record.label)}` : ""}${record.product ? ` · Producto: ${escapeHtml(record.product)}` : ""}${record.dose ? ` · Dosis: ${escapeHtml(record.dose)}` : ""}${record.notes ? ` · ${escapeHtml(record.notes)}` : ""}`;
      const journeyLink = record.journeyId && state.journeys.some(journey => journey.id === record.journeyId)
        ? `<button class="history-journey-link" data-open-journey="${escapeHtml(record.journeyId)}" type="button">Ver jornada</button>` : "";
      const performedBy = record.performedBy?.label
        ? `<small class="history-audit">Atendido por ${escapeHtml(record.performedBy.label)} · ${escapeHtml(formatTimestamp(record.performedAt || record.createdAt))}</small>` : "";
      const correctedBy = record.weightUpdatedBy?.label
        ? `<small class="history-audit">Peso corregido por ${escapeHtml(record.weightUpdatedBy.label)} · ${escapeHtml(formatTimestamp(record.weightUpdatedAt))}</small>` : "";
      return `<div class="history-item"><div class="history-date">${formatDate(record.date)}</div><div class="history-description">${value}${record.type === "weight" && record.notes ? ` · ${escapeHtml(record.notes)}` : ""}${journeyLink}${performedBy}${correctedBy}</div>${allowDelete ? `<button class="history-delete" data-delete-event="${escapeHtml(record.id)}" type="button" aria-label="Eliminar registro">×</button>` : ""}</div>`;
    }).join("");
  }

  function openRecordForm(type) {
    const title = EVENT_TYPES[type];
    if (!title || !state.currentAnimalId) return;
    if (!hasRanchAccess() || (isRanchWorker() && !["weight", "bath", "vaccine", "deworm", "injection", "medication", "review"].includes(type))) {
      showToast("Tu perfil no tiene permiso para registrar este tipo de información.");
      return;
    }
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
    if (!hasRanchAccess() || (isRanchWorker() && !["weight", "bath", "vaccine", "deworm", "injection", "medication", "review"].includes(type))) {
      showToast("Tu perfil no tiene permiso para registrar este tipo de información.");
      return;
    }
    const date = String(formData.get("date") || "");
    const fields = {};
    if (type === "weight") fields.weight = Number(formData.get("weight"));
    if (formData.has("label")) fields.label = String(formData.get("label")).trim();
    if (formData.has("notes")) fields.notes = String(formData.get("notes")).trim();
    try {
      const animalId = $("#record-animal-id").value;
      const record = makeEvent(animalId, type, date, fields);
      const forecastUpdates = type === "weight" && !isRanchWorker()
        ? pendingForecastUpdates(await getAllByIndex("growthForecasts", "animalId", animalId), animalId, state.events.concat(record))
        : [];
      await transaction(["events", "growthForecasts"], "readwrite", tx => {
        tx.objectStore("events").put(record);
        forecastUpdates.forEach(forecast => tx.objectStore("growthForecasts").put(forecast));
      });
      await touchAnimal(animalId);
      $("#record-dialog").close();
      await refresh();
      if (type === "weight" && $("#calculator-animal").value === animalId) loadCalculatorAnimal();
      openDetail(state.currentAnimalId);
      showToast("Registro guardado en el historial.");
    } catch (error) {
      showToast(`No se pudo guardar: ${error.message}`);
    }
  }

  async function saveGrowthTarget(event) {
    event.preventDefault();
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede cambiar el peso objetivo.");
      return;
    }
    const animal = state.animals.find(item => item.id === state.currentAnimalId);
    if (!animal) return;
    const formData = new FormData(event.target);
    const minValue = String(formData.get("targetMin") || "").trim();
    const maxValue = String(formData.get("targetMax") || "").trim();
    if (Boolean(minValue) !== Boolean(maxValue)) {
      showToast("Ingresa ambos límites del rango o deja los dos vacíos.");
      return;
    }
    const targetMin = Number(minValue);
    const targetMax = Number(maxValue);
    if (minValue && (!Number.isFinite(targetMin) || !Number.isFinite(targetMax) ||
        targetMin < 0 || targetMax < targetMin)) {
      showToast("Revisa el rango: el mínimo debe ser igual o menor que el máximo.");
      return;
    }
    const updated = { ...animal, updatedAt: nextModifiedAt(animal.updatedAt) };
    if (minValue) {
      updated.targetWeightMin = targetMin;
      updated.targetWeightMax = targetMax;
    } else {
      delete updated.targetWeightMin;
      delete updated.targetWeightMax;
    }
    try {
      await put("animals", updated);
      scheduleSync();
      await refresh();
      openDetail(animal.id);
      showToast(minValue ? "Rango de peso objetivo guardado." : "Rango de peso objetivo eliminado.");
    } catch (error) {
      showToast(`No se pudo guardar el objetivo: ${error.message}`);
    }
  }

  async function addPhotos(files) {
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede modificar fotografías.");
      return;
    }
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
    if (!canManageRanch()) return;
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
    if (!canManageRanch()) return;
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
    if (!canManageRanch()) return;
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
    if (!canManageRanch()) return;
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
    if (!canManageRanch()) return;
    const animal = state.animals.find(item => item.id === animalId);
    if (!animal) return;
    const hasEvents = state.events.some(record => record.animalId === animalId);
    const hasJourneyHistory = state.journeys.some(journey =>
      journey.roster.some(rosterAnimal => rosterAnimal.id === animalId));
    if (hasEvents || hasJourneyHistory) {
      const shouldDeactivate = confirm(
        `${animal.name || animal.tag || "Este animal"} tiene registros o participa en una jornada. ` +
        "Para proteger su historial no se puede eliminar definitivamente. ¿Deseas darlo de baja y conservar sus datos?"
      );
      if (!shouldDeactivate) return;
      try {
        await put("animals", { ...animal, status: "Baja", updatedAt: nextModifiedAt(animal.updatedAt) });
        scheduleSync();
        $("#detail-dialog").close();
        await refresh();
        showToast("Animal dado de baja; se conservaron su historial y jornadas.");
      } catch (error) {
        showToast(`No se pudo dar de baja el animal: ${error.message}`);
      }
      return;
    }
    if (!confirm(`¿Eliminar definitivamente a ${animal.name || animal.tag || "este animal"} y sus fotografías? Esta acción no se puede deshacer.`)) return;
    try {
      const deletedAt = nextModifiedAt(animal.updatedAt);
      await transaction(["animals", "events", "photos", "growthForecasts", "deletedAnimals"], "readwrite", tx => {
        tx.objectStore("animals").delete(animalId);
        tx.objectStore("deletedAnimals").put({ id: animalId, deletedAt });
        for (const name of ["events", "photos", "growthForecasts"]) {
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
      const payload = {
        format: "ganadero-backup", version: 1, exportedAt: new Date().toISOString(),
        animals: state.animals, events: state.events, journeys: state.journeys,
        forecasts: state.forecasts, photos: [], deletedAnimals: await getAll("deletedAnimals")
      };
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
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      const journeys = payload.journeys === undefined ? state.journeys : payload.journeys;
      if (!Array.isArray(journeys) || journeys.some(journey =>
        !journey || typeof journey.id !== "string" || !Array.isArray(journey.roster) ||
        !["in_progress", "completed", "incomplete"].includes(journey.status)
      )) throw new Error("La copia contiene una jornada con formato inválido.");
      const animalIds = new Set(animals.map(animal => animal.id));
      const events = payload.events;
      const forecasts = payload.forecasts === undefined ? [] : payload.forecasts;
      const backedUpDeletions = payload.deletedAnimals === undefined ? [] : payload.deletedAnimals;
      if (!Array.isArray(backedUpDeletions) || backedUpDeletions.some(deletion =>
        !deletion || typeof deletion.id !== "string" || !deletion.id ||
        !Number.isFinite(Date.parse(deletion.deletedAt)) || animalIds.has(deletion.id)
      )) throw new Error("La copia contiene un registro de eliminación con formato inválido.");
      if (!Array.isArray(forecasts) || forecasts.some(forecast =>
        !forecast || typeof forecast.id !== "string" || !animalIds.has(forecast.animalId) ||
        !["pending", "evaluated"].includes(forecast.status) ||
        !isDateOnly(forecast.targetDate) || !isDateOnly(forecast.baselineDate) ||
        !Number.isFinite(forecast.baselineWeight) || !Number.isFinite(forecast.gainKgPerDay) ||
        !Number.isFinite(forecast.days) || !Number.isFinite(forecast.predictedWeight) ||
        !Array.isArray(forecast.sourceWeightEventIds) ||
        !["recent-measured-gmd", "manual-gmd"].includes(forecast.source) ||
        (forecast.status === "evaluated" && (!isDateOnly(forecast.actualDate) ||
          !Number.isFinite(forecast.actualWeight) || !Number.isFinite(forecast.errorKg) ||
          !Number.isFinite(forecast.absoluteErrorKg) ||
          (forecast.absoluteErrorPercent !== null && !Number.isFinite(forecast.absoluteErrorPercent))))
      )) throw new Error("La copia contiene una estimación de crecimiento con formato inválido.");
      const photos = await Promise.all(payload.photos.map(async item => {
        if (!item || typeof item.id !== "string" || !animalIds.has(item.animalId) ||
            typeof item.data !== "string" || !item.data.startsWith("data:")) {
          throw new Error("La copia contiene una fotografía o asociación inválida.");
        }
        const response = await fetch(item.data);
        const blob = await response.blob();
        return { id: item.id, animalId: item.animalId, name: item.name, mime: item.mime, primary: Boolean(item.primary), createdAt: item.createdAt, blob };
      }));
      if (events.some(record => !animalIds.has(record.animalId))) throw new Error("La copia contiene registros asociados a animales inexistentes.");
      const deletionMap = new Map(backedUpDeletions.map(item => [item.id, item]));
      previousAnimals.filter(animal => !animalIds.has(animal.id)).forEach(animal => {
        deletionMap.set(animal.id, { id: animal.id, deletedAt: nextModifiedAt(animal.updatedAt) });
      });
      for (const url of state.photoUrls.values()) URL.revokeObjectURL(url);
      state.photoUrls.clear();
      await transaction(["animals", "events", "photos", "growthForecasts", "deletedAnimals", "journeys"], "readwrite", tx => {
        for (const name of ["animals", "events", "photos", "growthForecasts", "deletedAnimals"]) tx.objectStore(name).clear();
        tx.objectStore("journeys").clear();
        const deletions = tx.objectStore("deletedAnimals");
        deletionMap.forEach(item => deletions.put(item));
        animals.forEach(item => tx.objectStore("animals").put(item));
        animals.forEach(item => deletions.delete(item.id));
        events.forEach(item => tx.objectStore("events").put(item));
        forecasts.forEach(item => tx.objectStore("growthForecasts").put(item));
        photos.forEach(item => tx.objectStore("photos").put(item));
        journeys.forEach(item => tx.objectStore("journeys").put(item));
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
    document.addEventListener("submit", event => {
      if (event.target.id === "growth-target-form") saveGrowthTarget(event);
      if (event.target.id === "create-ranch-form") {
        const fields = new FormData(event.target);
        submitRanchForm(event, "create_my_ranch", {
          p_ranch_name: String(fields.get("ranchName") || "").trim(),
          p_display_name: String(fields.get("displayName") || "").trim()
        }, "Rancho creado. Ya puedes compartir el código para recibir solicitudes.");
      }
      if (event.target.id === "request-ranch-form") {
        const fields = new FormData(event.target);
        submitRanchForm(event, "request_ranch_access", {
          p_join_code: String(fields.get("joinCode") || "").trim(),
          p_display_name: String(fields.get("displayName") || "").trim()
        }, "Solicitud enviada. El propietario debe aprobarla.");
      }
    });
    $("#journey-form").addEventListener("submit", createJourney);
    $("#journey-type").addEventListener("change", updateJourneyFormFields);
    $("#inventory-nav").addEventListener("click", () => setMainView("inventory"));
    $("#journeys-nav").addEventListener("click", () => setMainView("journeys"));
    $("#calculator-nav").addEventListener("click", () => setMainView("calculator"));
    $("#calculator-form").addEventListener("submit", event => event.preventDefault());
    $("#calculator-form").addEventListener("input", updateCalculator);
    $("#calculator-gain").addEventListener("input", () => { state.calculatorMeasuredGain = null; });
    $("#calculator-animal").addEventListener("change", loadCalculatorAnimal);
    $("#calculator-save-forecast").addEventListener("click", saveCalculatorForecast);
    $("#new-journey-button").addEventListener("click", openJourneyCreateForm);
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
      showAccountView("login");
      if (!cloud) showAccountView("login", "La conexión con Supabase aún no está configurada. Consulta el README para activarla.");
      $("#account-dialog").showModal();
    });
    $("#ranch-button").addEventListener("click", () => {
      renderRanchDialog();
      $("#ranch-dialog").showModal();
    });
    $("#sign-in-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (!cloud) {
        showAccountView("login", "La conexión con Supabase aún no está configurada. Consulta el README para activarla.");
        return;
      }
      try {
        const { error } = await cloud.auth.signInWithPassword({
          email: $("#account-email").value.trim(),
          password: $("#account-password").value
        });
        if (error) {
          showAccountView("login", authErrorMessage(error));
          return;
        }
        $("#account-password").value = "";
        $("#account-dialog").close();
      } catch (error) {
        showAccountView("login", authErrorMessage(error));
      }
    });
    $("#sign-up-form").addEventListener("submit", async event => {
      event.preventDefault();
      const password = $("#signup-password").value;
      if (password !== $("#signup-password-confirm").value) {
        showAccountView("register", "Las contraseñas no coinciden.");
        return;
      }
      if (!cloud) {
        showAccountView("register", "La conexión con Supabase aún no está configurada. Consulta el README para activarla.");
        return;
      }
      try {
        const { data, error } = await cloud.auth.signUp({
          email: $("#signup-email").value.trim(),
          password,
          options: { emailRedirectTo: authRedirectUrl() }
        });
        if (error) {
          showAccountView("register", authErrorMessage(error));
        } else if (data.session) {
          $("#account-email").value = $("#signup-email").value.trim();
          $("#signup-password").value = "";
          $("#signup-password-confirm").value = "";
          $("#account-dialog").close();
        } else {
          $("#signup-password").value = "";
          $("#signup-password-confirm").value = "";
          showAccountView(
            "message",
            "Tu cuenta se creó correctamente. Revisa tu correo y confirma la dirección antes de iniciar sesión.",
            true
          );
        }
      } catch (error) {
        showAccountView("register", authErrorMessage(error));
      }
    });
    $("#recovery-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (!cloud) {
        showAccountView("recovery", "La conexión con Supabase aún no está configurada. Consulta el README para activarla.");
        return;
      }
      try {
        const { error } = await cloud.auth.resetPasswordForEmail(
          $("#recovery-email").value.trim(),
          { redirectTo: authRedirectUrl() }
        );
        if (error) {
          showAccountView("recovery", authErrorMessage(error));
        } else {
          showAccountView("message", "Si existe una cuenta con ese correo, recibirás un enlace para cambiar la contraseña.", true);
        }
      } catch (error) {
        showAccountView("recovery", authErrorMessage(error));
      }
    });
    $("#reset-password-form").addEventListener("submit", async event => {
      event.preventDefault();
      const password = $("#reset-password").value;
      if (password !== $("#reset-password-confirm").value) {
        showAccountView("reset-password", "Las contraseñas no coinciden.");
        return;
      }
      if (!cloud) {
        showAccountView("reset-password", "La conexión con Supabase aún no está configurada. Consulta el README para activarla.");
        return;
      }
      try {
        const { error } = await cloud.auth.updateUser({ password });
        if (error) {
          showAccountView("reset-password", authErrorMessage(error));
        } else {
          $("#reset-password").value = "";
          $("#reset-password-confirm").value = "";
          $("#account-dialog").close();
          showToast("La contraseña se actualizó correctamente.");
        }
      } catch (error) {
        showAccountView("reset-password", authErrorMessage(error));
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
      if (target.dataset.accountView) { showAccountView(target.dataset.accountView); return; }
      if (target.dataset.reviewRequest) {
        reviewRanchRequest(target.dataset.reviewRequest, target.dataset.approve === "true");
        return;
      }
      if (target.dataset.revokeMember) { revokeRanchWorker(target.dataset.revokeMember); return; }
      if (target.dataset.refreshRanch) { refreshRanchContext(true); return; }
      if (target.dataset.copyRanchCode !== undefined) {
        (async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Este navegador no permite copiar al portapapeles; selecciona el código manualmente.");
            await navigator.clipboard.writeText(state.ranchContext?.join_code || "");
            showToast("Código copiado.");
          } catch (error) {
            showToast(`No se pudo copiar el código: ${error.message}`);
          }
        })();
        return;
      }
      if (target.dataset.openJourney) { openJourney(target.dataset.openJourney); return; }
      if (target.dataset.toggleAttendance) { toggleJourneyAnimal(target.dataset.toggleAttendance); return; }
      if (target.dataset.addJourneyAnimals) { addJourneyAnimals(target.dataset.addJourneyAnimals); return; }
      if (target.dataset.reopenJourney) { reopenJourney(target.dataset.reopenJourney); return; }
      if (target.dataset.editJourneyWeight) { editJourneyWeight(target.dataset.editJourneyWeight); return; }
      if (target.dataset.saveJourneyWeight) { saveJourneyWeight(target.dataset.saveJourneyWeight); return; }
      if (target.dataset.cancelJourneyWeight !== undefined) {
        state.journeyWeightTargetId = null;
        renderJourneyDetail();
        return;
      }
      if (target.dataset.journeyFilter) {
        state.journeyFilter = target.dataset.journeyFilter;
        renderJourneyDetail();
        return;
      }
      if (target.dataset.finishJourney !== undefined) { finishJourney(); return; }
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
    [$("#animal-dialog"), $("#detail-dialog"), $("#record-dialog"), $("#photo-dialog"), $("#journey-create-dialog"), $("#journey-dialog")].forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target === dialog) requestClose(dialog.id);
      });
    });
    [$("#account-dialog"), $("#ranch-dialog")].forEach(dialog => dialog.addEventListener("click", event => {
      if (event.target === event.currentTarget) dialog.close();
    }));
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
      $("#calculator-price-date").value = today();
      if ("serviceWorker" in navigator && location.protocol !== "file:") {
        navigator.serviceWorker.register("./service-worker.js").catch(error => {
          console.error("No se pudo habilitar el modo sin conexión.", error);
        });
      }
      const config = window.GANADERO_CONFIG;
      if (window.supabase?.createClient && config?.supabaseUrl && config?.supabaseAnonKey) {
        cloud = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        cloud.auth.onAuthStateChange((event, session) => {
          if (event === "INITIAL_SESSION") return;
          currentUser = session?.user || null;
          $("#account-button").hidden = Boolean(currentUser);
          $("#sign-out-button").hidden = !currentUser;
          if (!currentUser) {
            state.ranchContext = null;
            state.ranchOwnerId = null;
            state.ranchRole = null;
            state.ranchReady = true;
            state.legacyAccount = false;
            $("#ranch-button").hidden = true;
            state.animals = [];
            state.events = [];
            state.photos = [];
            state.journeys = [];
            state.forecasts = [];
            renderDashboard();
            renderJourneys();
            renderCalculatorAnimalOptions();
            setTimeout(() => switchGuestDatabase().catch(error =>
              showToast(`No se pudo separar el almacenamiento de la sesión: ${error.message}`)
            ), 0);
          }
          setSyncStatus(currentUser ? "Comprobando acceso al rancho…" : "Inicia sesión para sincronizar");
          if (event === "PASSWORD_RECOVERY") {
            showAccountView("reset-password");
            if (!$("#account-dialog").open) $("#account-dialog").showModal();
          }
          if (currentUser) setTimeout(async () => {
            if (await refreshRanchContext()) {
              if (["unassigned", "pending"].includes(state.ranchContext?.status)) {
                renderRanchDialog();
                if (!$("#ranch-dialog").open) $("#ranch-dialog").showModal();
              }
              await syncData();
            }
          }, 0);
        });
        const { data, error } = await cloud.auth.getSession();
        if (error) throw error;
        currentUser = data.session?.user || null;
        $("#account-button").hidden = Boolean(currentUser);
        $("#sign-out-button").hidden = !currentUser;
        if (currentUser) {
          await refreshRanchContext();
          if (["unassigned", "pending"].includes(state.ranchContext?.status)) {
            renderRanchDialog();
            if (!$("#ranch-dialog").open) $("#ranch-dialog").showModal();
          }
        } else {
          state.ranchReady = true;
          state.ranchOwnerId = null;
          state.ranchRole = null;
          $("#ranch-button").hidden = true;
        }
        setSyncStatus(currentUser ? "Sesión lista" : "Inicia sesión para sincronizar");
        if (currentUser && navigator.onLine) await syncData();
      } else {
        setSyncStatus("Solo en este dispositivo · configura Supabase");
        $("#sync-button").disabled = true;
      }
      await refresh();
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
