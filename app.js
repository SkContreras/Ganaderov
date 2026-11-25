(() => {
  "use strict";

  const DB_NAME = "ganadero-local";
  const DB_VERSION = 5;
  const ANIMAL_MODULES = [
    { id: "identification", label: "Identificación básica", description: "Datos esenciales para reconocer al animal.", locked: true },
    { id: "dates", label: "Fechas y procedencia", description: "Nacimiento, ingreso, origen, progenitores y destete." },
    { id: "location", label: "Ubicación y estado", description: "Ubicación actual, responsable y situación del animal." },
    { id: "tracking", label: "Documentación y seguimiento", description: "Observaciones y datos automáticos de auditoría." }
  ];
  const ANIMAL_LISTS = [
    { id: "breed", label: "Razas" },
    { id: "lot", label: "Lotes" },
    { id: "paddock", label: "Potreros" },
    { id: "pen", label: "Corrales" },
    { id: "status", label: "Estados" }
  ];
  const DEFAULT_STATUS_OPTIONS = [
    { value: "Activo", label: "Activo", enabled: true, active: true },
    { value: "Vendido", label: "Vendido", enabled: true, active: false },
    { value: "Fallecido", label: "Muerto", enabled: true, active: false },
    { value: "Desaparecido", label: "Extraviado", enabled: true, active: false },
    { value: "Otro", label: "Otro", enabled: true, active: false },
    { value: "Baja", label: "Baja (legado)", enabled: true, active: false },
    { value: "Otros", label: "Otro (legado)", enabled: true, active: false }
  ];
  const ANIMAL_FIELD_CATALOG = [
    { id: "tag", label: "Número de arete", description: "Identificador impreso del animal.", type: "text", module: "identification", form: true, detail: true, table: true, requiredAllowed: true, core: true },
    { id: "name", label: "Nombre", description: "Nombre o apodo del animal.", type: "text", module: "identification", form: true, detail: true, table: true, requiredAllowed: true, core: true },
    { id: "sex", label: "Sexo", description: "Sexo registrado; también se usa en los indicadores.", type: "select", module: "identification", form: true, detail: true, table: true, requiredAllowed: true, core: true },
    { id: "breed", label: "Raza", description: "Raza del animal.", type: "list", list: "breed", module: "identification", form: true, detail: true, table: true, requiredAllowed: true, core: true, introduced: 3 },
    { id: "color", label: "Color", description: "Color o descripción del pelaje.", type: "text", module: "identification", form: true, detail: true, table: true, requiredAllowed: true },
    { id: "cross", label: "Cruza", description: "Cruza o composición racial.", type: "text", module: "identification", form: true, detail: true, introduced: 4 },
    { id: "markings", label: "Señas particulares", description: "Marcas y rasgos para reconocer al animal.", type: "textarea", module: "identification", form: true, detail: true, introduced: 4 },
    { id: "officialId", label: "Identificador oficial", description: "Identificador oficial distinto del arete.", type: "text", module: "identification", form: true, detail: true, introduced: 4 },
    { id: "internalId", label: "ID interno", description: "Identificador automático, único e inmutable.", type: "automatic", module: "identification", form: false, detail: true, introduced: 4, locked: true },
    { id: "birthDate", label: "Fecha de nacimiento", description: "Fecha confirmada; se mantiene vacía si se desconoce.", type: "date", module: "dates", form: true, detail: true, requiredAllowed: true },
    { id: "birthEstimated", label: "Nacimiento estimado", description: "Indica si la fecha de nacimiento es aproximada.", type: "boolean", module: "dates", form: true, detail: true, introduced: 4 },
    { id: "estimatedAge", label: "Edad calculada", description: "Se deriva automáticamente de la fecha de nacimiento o de la edad estimada registrada.", type: "derived", module: "dates", form: true, detail: true, requiredAllowed: true },
    { id: "entryDate", label: "Fecha de ingreso al rancho", description: "Fecha en que el animal ingresó al rancho.", type: "date", module: "dates", form: true, detail: true, introduced: 4 },
    { id: "originType", label: "Procedencia", description: "Forma de incorporación al rancho.", type: "select", options: ["Nacimiento propio", "Compra", "Donación", "Otro"], module: "dates", form: true, detail: true, introduced: 4 },
    { id: "originName", label: "Rancho o vendedor de origen", description: "Rancho, vendedor o persona de procedencia.", type: "text", module: "dates", form: true, detail: true, introduced: 4 },
    { id: "motherId", label: "Madre", description: "Referencia a otro animal del mismo rancho.", type: "animal", module: "dates", form: true, detail: true, introduced: 4 },
    { id: "fatherId", label: "Padre o semental", description: "Referencia a otro animal del mismo rancho.", type: "animal", module: "dates", form: true, detail: true, introduced: 4 },
    { id: "weaningDate", label: "Fecha de destete", description: "Fecha de destete; el peso se registra en el historial.", type: "date", module: "dates", form: true, detail: true, introduced: 4 },
    { id: "status", label: "Estado", description: "Estado operativo usado por el inventario y las jornadas.", type: "list", list: "status", module: "location", form: true, detail: true, table: true, requiredAllowed: true, locked: true },
    { id: "lot", label: "Lote actual", description: "Lote actual del animal.", type: "list", list: "lot", module: "location", form: true, detail: true, table: true, introduced: 4 },
    { id: "paddock", label: "Potrero actual", description: "Potrero actual del animal.", type: "list", list: "paddock", module: "location", form: true, detail: true, table: true, introduced: 4 },
    { id: "pen", label: "Corral actual", description: "Corral actual del animal.", type: "list", list: "pen", module: "location", form: true, detail: true, table: true, introduced: 4 },
    { id: "locationSince", label: "Fecha de entrada a la ubicación", description: "Fecha de ingreso a su ubicación actual.", type: "date", module: "location", form: true, detail: true, introduced: 4 },
    { id: "responsible", label: "Responsable", description: "Persona responsable actual en el rancho.", type: "text", module: "location", form: true, detail: true, introduced: 4 },
    { id: "exitReason", label: "Motivo de baja", description: "Motivo cuando el animal ya no está activo.", type: "select", options: ["Venta", "Muerte", "Extravío", "Otro"], module: "location", form: true, detail: true, requiredAllowed: true, introduced: 4 },
    { id: "exitNotes", label: "Observaciones de baja", description: "Detalle del motivo de baja.", type: "textarea", module: "location", form: true, detail: true, introduced: 4 },
    { id: "generalNotes", label: "Observaciones generales", description: "Notas generales sobre el animal.", type: "textarea", module: "tracking", form: true, detail: true, introduced: 4 },
    { id: "createdAt", label: "Fecha de creación", description: "Fecha automática de creación del registro.", type: "automatic", module: "tracking", form: false, detail: true, introduced: 4, locked: true },
    { id: "createdBy", label: "Usuario creador", description: "Cuenta que creó la ficha.", type: "automatic", module: "tracking", form: false, detail: true, introduced: 4, locked: true },
    { id: "updatedAt", label: "Última modificación", description: "Fecha y hora automática de modificación.", type: "automatic", module: "tracking", form: false, detail: true, introduced: 4, locked: true },
    { id: "updatedBy", label: "Usuario que modificó", description: "Cuenta que modificó la ficha por última vez.", type: "automatic", module: "tracking", form: false, detail: true, introduced: 4, locked: true }
  ];
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
  const ICON_SYMBOLS = {
    inventory: "inventory",
    plus: "add",
    search: "search",
    chevron: "chevron-right",
    close: "close",
    check: "status-active",
    warning: "status-pending",
    trash: "delete",
    edit: "edit",
    star: "favorite",
    external: "export",
    photo: "photo",
    archive: "archive",
    clock: "reminder",
    active: "status-active",
    sold: "tag",
    dead: "status-error",
    other: "status-inactive",
    male: "male",
    female: "female",
    tag: "tag"
  };
  const INACTIVE_ANIMAL_STATUSES = new Set(["Vendido", "Fallecido", "Baja", "Otro", "Otros", "Desaparecido"]);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const isActiveAnimal = animal => {
    const option = state.fieldConfig?.lists?.status?.find(item => item.value === animal.status);
    return option ? option.active !== false : !INACTIVE_ANIMAL_STATUSES.has(animal.status);
  };
  function icon(name, className = "ui-icon") {
    const symbol = ICON_SYMBOLS[name];
    return symbol ? `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-${symbol}"></use></svg>` : "";
  }
  function statusIconName(status) {
    if (status === "Vendido") return "sold";
    if (status === "Fallecido") return "dead";
    if (INACTIVE_ANIMAL_STATUSES.has(status) ||
        state.fieldConfig?.lists?.status?.find(option => option.value === status)?.active === false) return "other";
    return "active";
  }
  function statusMarkup(status, className = "status-pill") {
    const label = state.fieldConfig?.lists?.status?.find(option => option.value === status)?.label || status;
    return `<span class="${className} ${statusClass(status)}">${icon(statusIconName(status))}${escapeHtml(label)}</span>`;
  }
  function journeyStatusMarkup(journey) {
    const iconName = journey.status === "completed" ? "check" : journey.status === "incomplete" ? "warning" : "clock";
    return `<span class="journey-status ${journey.status}">${icon(iconName)}${escapeHtml(journeyStatus(journey))}</span>`;
  }
  const hasRanchAccess = () => !currentUser || state.legacyAccount || ["owner", "admin", "worker"].includes(state.ranchRole);
  const state = { animals: [], events: [], photos: [], journeys: [], forecasts: [], photoUrls: new Map(), fieldConfig: null, fieldConfigRecord: null, fieldSettingsDirty: false, mainView: "inventory", sort: "tag", direction: 1, archiveView: false, currentAnimalId: null, detailView: "summary", detailShowEmpty: false, currentJourneyId: null, journeyFilter: "all", journeySearch: "", journeyWeightTargetId: null, journeyWeightWarning: null, journeyUpdating: new Set(), animalFormSnapshot: "", animalFormStep: 0, animalFormMode: "create", animalFormWeightWarning: null, recordFormWeightWarning: null, quickCaptureSeed: null, pendingUndo: null, undoTimer: null, toastAction: null, scannerStream: null, scannerFrame: null, calculatorProjection: null, calculatorMeasuredGain: null, ranchContext: null, ranchReady: false, legacyAccount: false, ranchOwnerId: null, ranchRole: null, accountIdentities: [], toastTimer: null, syncTimer: null, syncing: false, syncRequested: false };
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
        if (!database.objectStoreNames.contains("ranchSettings")) database.createObjectStore("ranchSettings", { keyPath: "id" });
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
    const stores = ["animals", "events", "photos", "syncMeta", "deletedAnimals", "journeys", "growthForecasts", "ranchSettings"];
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
    $("#ranch-button").innerHTML = `${icon("users")} ${context?.status === "active" ? "Rancho y usuarios" : "Configurar rancho"}`;
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
      host.innerHTML = `<p class="account-help">La cuenta aún usa el aislamiento anterior por cuenta. Para habilitar perfiles y solicitudes de acceso, actualiza Supabase al esquema actual de <strong>supabase-schema.sql</strong>. Antes de aplicarlo en un proyecto existente, valida el cambio de permisos en una copia de pruebas.</p>`;
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

  async function renderAccountIdentities() {
    const host = $("#linked-identities");
    host.innerHTML = "<li><span>Consultando métodos vinculados…</span></li>";
    const { data, error } = await cloud.auth.getUserIdentities();
    if (error) {
      state.accountIdentities = [];
      host.innerHTML = "<li><span>No se pudieron consultar los métodos vinculados.</span></li>";
      showToast(`No se pudieron consultar los métodos vinculados: ${authErrorMessage(error)}`);
      return;
    }
    state.accountIdentities = data.identities || [];
    const identities = state.accountIdentities.filter(identity => identity.provider !== "email");
    host.innerHTML = identities.length
      ? identities.map(identity => `<li><span><strong>${escapeHtml(identity.provider)}</strong></span><button class="button button-outline button-small" type="button" data-unlink-identity="${escapeHtml(identity.identity_id)}">Desvincular</button></li>`).join("")
      : "<li><span>No hay proveedores externos vinculados.</span></li>";
  }

  function showAccountView(view, message = "", success = false) {
    const views = {
      login: ["Iniciar sesión", "Usa tu correo y contraseña. Tus datos locales permanecen en este dispositivo aunque no haya conexión."],
      register: ["Crear cuenta", "Registra una cuenta de acceso. Esto no concede permisos sobre los datos de un rancho."],
      "magic-link": ["Iniciar sesión con enlace", "Te enviaremos un enlace de acceso de un solo uso a tu correo."],
      "resend-confirmation": ["Confirmar correo", "Solicita un nuevo enlace para confirmar tu dirección de correo."],
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
    $("#magic-link-form").hidden = view !== "magic-link";
    $("#resend-confirmation-form").hidden = view !== "resend-confirmation";
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

  function signupConfirmationUrl() {
    if (location.protocol !== "http:" && location.protocol !== "https:") return undefined;
    return new URL("./confirmar-correo.html", location.href).href;
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

  function defaultAnimalFieldConfig() {
    const fields = {};
    ANIMAL_FIELD_CATALOG.forEach(field => {
      fields[field.id] = {
        enabled: true,
        form: Boolean(field.form),
        formLevel: ["tag", "name", "sex", "breed"].includes(field.id) ? "basic" : "advanced",
        detailVisibility: ["tag", "name", "sex", "breed", "status"].includes(field.id) ? "summary" : "full",
        table: field.type !== "automatic" && field.table !== false,
        required: ["tag", "sex"].includes(field.id),
        label: field.label
      };
    });
    return {
      schemaVersion: 4,
      modules: { identification: true, dates: true, location: true, tracking: true },
      fields,
      lists: {
        breed: [], lot: [], paddock: [], pen: [],
        status: DEFAULT_STATUS_OPTIONS.map(option => ({ ...option }))
      },
      layout: {}
    };
  }

  function normalizeAnimalFieldConfig(value) {
    const defaults = defaultAnimalFieldConfig();
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    if (value.schemaVersion !== undefined && ![1, 2, 3, 4].includes(value.schemaVersion)) return defaults;
    const schemaVersion = [1, 2, 3, 4].includes(value.schemaVersion) ? value.schemaVersion : 1;
    const configVersion = Number.isInteger(value.configVersion) ? value.configVersion : schemaVersion;
    const legacy = configVersion < 4;
    const providedModules = value.modules && typeof value.modules === "object" && !Array.isArray(value.modules)
      ? value.modules
      : null;
    const modules = Object.fromEntries(ANIMAL_MODULES.map(module => [
      module.id,
      providedModules && typeof providedModules[module.id] === "boolean"
        ? providedModules[module.id]
        : defaults.modules[module.id]
    ]));
    ANIMAL_MODULES.forEach(module => {
      if (module.locked) modules[module.id] = true;
      else if (legacy && !Object.hasOwn(providedModules || {}, module.id)) modules[module.id] = false;
    });
    const lists = { ...defaults.lists };
    ANIMAL_LISTS.forEach(list => {
      const provided = value.lists?.[list.id];
      if (Array.isArray(provided)) {
        const unique = new Set();
        lists[list.id] = provided.filter(option =>
          option && typeof option.value === "string" && option.value.trim() &&
          typeof option.label === "string" && option.label.trim() &&
          typeof option.enabled === "boolean" && !unique.has(option.value) && unique.add(option.value)
        ).map(option => ({
          value: option.value.trim().slice(0, 80),
          label: option.label.trim().slice(0, 80),
          enabled: option.enabled,
          ...(list.id === "status" ? {
            active: typeof option.active === "boolean"
              ? option.active
              : DEFAULT_STATUS_OPTIONS.find(defaultOption => defaultOption.value === option.value)?.active ?? true
          } : {})
        }));
      } else if (legacy && list.id !== "status") {
        lists[list.id] = [];
      }
    });
    if (!lists.status.length) lists.status = DEFAULT_STATUS_OPTIONS.map(option => ({ ...option }));
    const layout = value.layout && typeof value.layout === "object" && !Array.isArray(value.layout)
      ? { ...value.layout }
      : defaults.layout;
    ANIMAL_FIELD_CATALOG.forEach(field => {
      const provided = value.fields?.[field.id];
      const normalized = defaults.fields[field.id];
      const introducedAfterConfig = Number.isInteger(field.introduced) && field.introduced > configVersion;
      if (provided && typeof provided === "object") {
        normalized.enabled = field.locked ? true : provided.enabled !== false;
        normalized.form = field.form && provided.form !== false;
        const detailVisibility = provided.detailVisibility;
        normalized.detailVisibility = !field.detail
          ? "hidden"
          : ["hidden", "full", "summary"].includes(detailVisibility)
            ? detailVisibility
            : provided.detail === false
              ? "hidden"
              : provided.detail === true
                ? "summary"
                : defaults.fields[field.id].detailVisibility;
        normalized.table = field.type !== "automatic" && provided.table !== false;
        normalized.required = Boolean(normalized.enabled && field.form && field.type !== "automatic" && provided.required);
        normalized.formLevel = provided.formLevel === "basic" ? "basic" : "advanced";
        normalized.label = typeof provided.label === "string" && provided.label.trim()
          ? provided.label.trim().slice(0, 80)
          : field.label;
      } else if (introducedAfterConfig) {
        normalized.enabled = false;
      }
      if (introducedAfterConfig && !provided) normalized.form = false;
      if (normalized.required) normalized.form = true;
    });
    return { ...defaults, schemaVersion: 4, modules, fields: defaults.fields, lists, layout };
  }

  function ranchAnimalFieldConfigPayload(config) {
    return {
      ...config,
      schemaVersion: 1,
      configVersion: 4,
      fields: Object.fromEntries(Object.entries(config.fields).map(([id, field]) => [
        id,
        {
          ...field,
          detail: field.detailVisibility !== "hidden"
        }
      ]))
    };
  }

  function isValidAnimalFieldConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (value.schemaVersion !== undefined && ![1, 2, 3, 4].includes(value.schemaVersion)) return false;
    if (value.fields !== undefined && (!value.fields || typeof value.fields !== "object" || Array.isArray(value.fields))) return false;
    if (value.modules !== undefined && (!value.modules || typeof value.modules !== "object" || Array.isArray(value.modules))) return false;
    if (value.layout !== undefined && (!value.layout || typeof value.layout !== "object" || Array.isArray(value.layout))) return false;
    if (value.lists !== undefined && (!value.lists || typeof value.lists !== "object" || Array.isArray(value.lists) ||
        Object.values(value.lists).some(list => !Array.isArray(list) || list.some(option =>
          !option || typeof option.value !== "string" || typeof option.label !== "string" ||
          typeof option.enabled !== "boolean" || (option.active !== undefined && typeof option.active !== "boolean"))))) return false;
    if (value.fields === undefined) return true;
    return Object.values(value.fields).every(field =>
      field && typeof field === "object" && !Array.isArray(field) &&
      (field.detailVisibility === undefined || ["hidden", "full", "summary"].includes(field.detailVisibility)) &&
      (field.detail === undefined || typeof field.detail === "boolean") &&
      (field.formLevel === undefined || ["basic", "advanced"].includes(field.formLevel))
    );
  }

  function animalFieldConfig(fieldId) {
    const field = ANIMAL_FIELD_CATALOG.find(item => item.id === fieldId);
    return state.fieldConfig?.fields?.[fieldId] || defaultAnimalFieldConfig().fields[fieldId] || {
      enabled: false, form: false, detailVisibility: "hidden", table: false, required: false, label: field?.label || fieldId
    };
  }

  function animalFieldActive(fieldId) {
    const field = ANIMAL_FIELD_CATALOG.find(item => item.id === fieldId);
    const config = animalFieldConfig(fieldId);
    return config.enabled && (!field?.module || state.fieldConfig?.modules?.[field.module] !== false);
  }

  function applyAnimalFieldVisibility(root = document) {
    root.querySelectorAll("[data-config-field]").forEach(element => {
      const config = animalFieldConfig(element.dataset.configField);
      const surface = element.dataset.configSurface;
      element.hidden = !animalFieldActive(element.dataset.configField) || (surface === "detail"
        ? config.detailVisibility === "hidden"
        : surface ? !config[surface] : false);
    });
    root.querySelectorAll("[data-config-label]").forEach(element => {
      const config = animalFieldConfig(element.dataset.configLabel);
      element.textContent = config.label;
    });
    const form = root.matches?.("#animal-form") ? root : root.querySelector?.("#animal-form");
    if (form) {
      form.querySelectorAll("[data-config-required-label]").forEach(indicator => {
        const config = animalFieldConfig(indicator.dataset.configRequiredLabel);
        indicator.textContent = config.required ? "Obligatorio" : "Opcional";
      });
      form.querySelectorAll("[data-animal-field]").forEach(input => {
        const config = animalFieldConfig(input.dataset.animalField);
        const applies = input.dataset.animalField !== "exitReason" || !isActiveAnimal({ status: $("#animal-status")?.value || "Activo" });
        input.required = !["estimatedAge", "exitReason"].includes(input.dataset.animalField) &&
          applies && animalFieldActive(input.dataset.animalField) && config.form && config.required;
      });
    }
  }

  function applyDetailPresentation() {
    const root = $("#detail-content");
    if (!root) return;
    root.querySelectorAll("[data-detail-field]").forEach(element => {
      const field = animalFieldConfig(element.dataset.detailField);
      const level = field.detailVisibility;
      const allowedForView = state.detailView === "summary"
        ? level === "summary"
        : level === "summary" || level === "full";
      const hasValue = element.dataset.detailHasValue !== "false";
      element.hidden = !animalFieldActive(element.dataset.detailField) || !allowedForView ||
        (state.detailView === "full" && !state.detailShowEmpty && !hasValue);
    });
    root.querySelectorAll("[data-detail-view]").forEach(element => {
      const view = element.dataset.detailView;
      const hasValue = element.dataset.detailHasValue !== "false";
      const visibleInView = view === "both" || view === state.detailView;
      element.hidden = !visibleInView ||
        (state.detailView === "full" && !state.detailShowEmpty && !hasValue);
    });
    const extendedSection = $("#animal-extended-detail-section", root);
    if (extendedSection) {
      const hasVisibleFacts = $$(".detail-fact:not([hidden])", extendedSection).length > 0;
      extendedSection.hidden = !hasVisibleFacts;
    }
    const heading = $("#detail-info-heading", root);
    if (heading) heading.hidden = !$$(".detail-fact:not([hidden])", root).length;
    if (heading) $("h3", heading).textContent = state.detailView === "summary" ? "Ficha resumida" : "Información general";
    const toggle = $('[data-toggle-detail-view]', root);
    if (toggle) toggle.textContent = state.detailView === "summary" ? "Ficha completa" : "Ficha resumida";
    const emptyToggle = $('[data-show-detail-empty]', root);
    if (emptyToggle) {
      emptyToggle.checked = state.detailShowEmpty;
      emptyToggle.closest("label").hidden = state.detailView !== "full";
    }
  }

  let settingsSaving = false;
  let settingsPreset = "";
  function personalCaptureKey() { return `ganadero:capture:${currentUser?.id || "local"}:${state.ranchOwnerId || "local"}`; }
  function capturePreferences() {
    let personal = {}; try { personal = JSON.parse(localStorage.getItem(personalCaptureKey()) || "{}") || {}; } catch {} 
    const shared = state.fieldConfig?.layout?.capture || {};
    const raw = {...shared,...personal,defaults:{...shared.defaults,...personal.defaults}};
    return { reuse: raw.reuse !== false, nextTag: raw.nextTag !== false, today: raw.today !== false, draft: raw.draft !== false, large: raw.large === true, defaults: raw.defaults || {} };
  }
  function settingsControl(id, property) {
    return $(`[data-field-setting="${property}"][data-field-id="${id}"]`, $("#animal-field-settings"));
  }
  function settingsFieldDraft(field) {
    const enabled = field.locked || !!settingsControl(field.id,"enabled")?.checked;
    const module = !!$(`[data-module-setting="${field.module}"]`)?.checked;
    const required = !!settingsControl(field.id,"required")?.checked;
    return { enabled: enabled && module, required, form: !!settingsControl(field.id,"form")?.checked || required, basic: settingsControl(field.id,"formLevel")?.value === "basic", label: $(`[data-field-label="${field.id}"]`)?.value || field.label };
  }
  function updateSettingsWorkspace() {
    const query = $("#settings-field-search").value.trim().toLocaleLowerCase("es-MX").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const filter = $("#settings-field-filter").value;
    const groupFilter = $("#settings-module-filter").value;
    let shown = 0;
    const preview = [];
    ANIMAL_FIELD_CATALOG.forEach(field => {
      const d = settingsFieldDraft(field);
      const row = $(`[data-field-label="${field.id}"]`)?.closest("tr");
      if (!row) return;
      const matches = (field.label+" "+field.description+" "+d.label).toLocaleLowerCase("es-MX").normalize("NFD").replace(/[\u0300-\u036f]/g,"").includes(query);
      const visible = matches && (groupFilter === "all" || field.module === groupFilter) && (filter === "all" || filter === "active" && d.enabled || filter === "required" && d.required || filter === "basic" && d.enabled && d.form && d.basic || filter === "hidden" && !d.enabled);
      row.hidden = !visible;
      if (visible) shown++;
      if (field.form && d.enabled && d.form) preview.push({...d,field});
    });
    $("#settings-field-count").textContent = shown + " de " + ANIMAL_FIELD_CATALOG.length + " campos";
    $("#settings-preview-count").textContent = preview.length + " campos";
    const target = $("#settings-capture-preview");
    const advancedOpen = target.querySelector("details")?.open || false;
    target.replaceChildren();
    for (const basic of [true,false]) {
      const group = document.createElement(basic ? "section" : "details");
      const title = document.createElement(basic ? "h3" : "summary"); title.textContent = (basic ? "Formulario básico" : "Datos adicionales") + " · " + preview.filter(item=>item.basic===basic).length; group.append(title);
      for (const d of preview.filter(item => item.basic === basic)) {
        const item = document.createElement("label"); item.className = "settings-preview-field";
        const caption = document.createElement("span"); caption.textContent = d.label + (d.required ? " *" : ""); item.append(caption);
        const temp = document.createElement("template"); temp.innerHTML = animalFormControl(d.field,null,{label:d.label,required:d.required});
        temp.content.querySelectorAll("[id],[name],[data-animal-field],[data-chip-select],[data-chip-option],[data-chip-create],[data-chip-value]").forEach(el=>{for(const attr of [...el.attributes])if(attr.name==="id"||attr.name==="name"||attr.name.startsWith("data-"))el.removeAttribute(attr.name);});
        temp.content.querySelectorAll("input,select,textarea,button").forEach(el=>{el.disabled=true;el.removeAttribute("required");});
        item.append(temp.content); group.append(item);
      }
      if (group.children.length === 1) { const empty = document.createElement("p"); empty.textContent = "Sin campos"; group.append(empty); }
      if (!basic) group.open = advancedOpen;
      target.append(group);
    }
    $("#settings-dirty-status").textContent = state.fieldSettingsDirty ? "Cambios sin guardar" : "Configuración guardada";
    $("#save-animal-settings").hidden = !canManageRanch();
  }
  function renderCapturePreferences() {
    settingsPreset = state.fieldConfig?.layout?.preset || "";
    document.querySelectorAll("[data-settings-preset]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.settingsPreset===settingsPreset)));
    $("#settings-preset-feedback").textContent=settingsPreset ? "Plantilla guardada: "+($(`[data-settings-preset="${settingsPreset}"] strong`)?.textContent || "Personalizada") : "Configuración personalizada. Elige una plantilla para modificarla.";
    const prefs = capturePreferences();
    Array.from(document.querySelectorAll("[data-capture-pref]")).forEach(el => { el.checked = !!prefs[el.dataset.capturePref]; el.disabled = !hasRanchAccess(); });
    Array.from(document.querySelectorAll("[data-capture-default]")).forEach(el => {
      const key = el.dataset.captureDefault;
      if (el.tagName === "SELECT") {
        el.replaceChildren(new Option("Sin valor", ""));
        (state.fieldConfig.lists[key] || []).filter(x=>x.enabled).forEach(x=>el.add(new Option(x.label,x.value)));
      }
      el.value = String(prefs.defaults[key] || "");
      el.disabled = !hasRanchAccess();
    });
    Array.from(document.querySelectorAll("[data-settings-preset], [data-settings-batch]")).forEach(el=>el.disabled=!canManageRanch());
    updateSettingsWorkspace();
  }
  function readCapturePreferences() {
    return { ...Object.fromEntries(Array.from(document.querySelectorAll("[data-capture-pref]")).map(el=>[el.dataset.capturePref,el.checked])),
      defaults: Object.fromEntries(Array.from(document.querySelectorAll("[data-capture-default]")).map(el=>[el.dataset.captureDefault,el.value.trim()])) };
  }
  function markSettingsWorkspaceDirty() {
    state.fieldSettingsDirty = true;
    $("#save-animal-settings").textContent = "Guardar cambios pendientes";
    updateSettingsWorkspace();
  }
  function applySettingsShortcut(preset, batch) {
    if (!canManageRanch() || settingsSaving) return;
    const groups = {quick:["tag","name","sex","breed","color","status"],identification:["tag","name","sex","breed","color"],location:["tag","sex","status","lot","paddock","pen","responsible"],dates:["tag","sex","birthDate","entryDate","originType","originName"]};
    for (const field of ANIMAL_FIELD_CATALOG) {
      const enabled = settingsControl(field.id,"enabled"), form = settingsControl(field.id,"form"), level = settingsControl(field.id,"formLevel"), required = settingsControl(field.id,"required");
      const row = enabled?.closest("tr");
      if (batch && row?.hidden) continue;
      if (batch === "enable" && enabled && !enabled.disabled) { enabled.checked = true; const mod = $(`[data-module-setting="${field.module}"]`); if (mod && !mod.disabled) mod.checked = true; }
      if (!field.form || !level || level.disabled) continue;
      if (preset) {
        const selected = preset === "complete" ? true : groups[preset]?.includes(field.id);
        if (selected) { if (enabled && !enabled.disabled) enabled.checked = true; if (form && !form.disabled) form.checked = true; const mod = $(`[data-module-setting="${field.module}"]`); if (mod && !mod.disabled) mod.checked = true; }
        level.value = selected || required?.checked ? "basic" : "advanced";
      } else if (batch === "basic" && enabled?.checked && form?.checked) level.value = "basic";
      else if (batch === "advanced" && !required?.checked) level.value = "advanced";
    }
    settingsPreset = preset || "";
    markSettingsWorkspaceDirty();
    const feedback = $("#settings-preset-feedback");
    if (preset) {
      const selected = $(`[data-settings-preset="${preset}"]`);
      document.querySelectorAll("[data-settings-preset]").forEach(button=>button.setAttribute("aria-pressed",String(button===selected)));
      const count = ANIMAL_FIELD_CATALOG.filter(field=>{const d=settingsFieldDraft(field);return field.form && d.enabled && d.form && d.basic;}).length;
      feedback.textContent = selected.querySelector("strong").textContent + " aplicada al borrador · " + count + " campos básicos. Guarda para confirmar.";
      feedback.classList.remove("feedback-pop"); void feedback.offsetWidth; feedback.classList.add("feedback-pop");
    } else {
      showToast("Cambios aplicados a los campos visibles. Guarda la configuración.");
      document.querySelectorAll("[data-settings-preset]").forEach(button=>button.setAttribute("aria-pressed","false"));
      feedback.textContent="Configuración personalizada. Guarda para confirmar.";
    }
  }
  function registerSettingsWorkspace() {
    $("#settings-field-search").addEventListener("input",updateSettingsWorkspace);
    $("#settings-field-filter").addEventListener("change",updateSettingsWorkspace);
    $("#settings-module-filter").addEventListener("change",updateSettingsWorkspace);
    $("#settings-view").addEventListener("click",event=>{
      const tab=event.target.closest("[data-settings-tab]");
      if(tab){const id=tab.dataset.settingsTab;document.querySelectorAll("[data-settings-tab]").forEach(b=>b.setAttribute("aria-pressed",String(b===tab)));document.querySelectorAll("[data-settings-panel]").forEach(panel=>{panel.hidden=panel.dataset.settingsPanel!==id;});return;}
      const button=event.target.closest("[data-settings-preset],[data-settings-batch]");
      if(button) applySettingsShortcut(button.dataset.settingsPreset,button.dataset.settingsBatch);
    });
    $("#settings-view").addEventListener("change",event=>{
      if(event.target.matches("[data-capture-pref],[data-capture-default]") && hasRanchAccess()) { try { localStorage.setItem(personalCaptureKey(),JSON.stringify(readCapturePreferences())); showToast("Preferencias personales guardadas en este dispositivo."); } catch(error) { showToast("No se pudieron guardar las preferencias: "+error.message); renderCapturePreferences(); } }
      else if(event.target.matches("[data-field-setting],[data-field-label],[data-module-setting],[data-list-label],[data-list-enabled],[data-list-active]")) { if(event.target.matches("[data-field-setting],[data-module-setting]")) {settingsPreset="";document.querySelectorAll("[data-settings-preset]").forEach(b=>b.setAttribute("aria-pressed","false"));$("#settings-preset-feedback").textContent="Configuración personalizada."; } queueMicrotask(updateSettingsWorkspace); }
    });
    $("#settings-view").addEventListener("input",event=>{if(event.target.matches("[data-field-label]") && canManageRanch()) markSettingsWorkspaceDirty();});
  }

  function renderAnimalSettings() {
    const config = normalizeAnimalFieldConfig(state.fieldConfig);
    state.fieldConfig = config;
    const canEdit = canManageRanch();
    $("#animal-settings-access").hidden = canEdit;
    $("#animal-settings-access").textContent = currentUser
      ? "Solo el propietario o administrador puede modificar la configuración. Puedes consultar los valores actuales."
      : "Esta configuración se guarda en este dispositivo. Inicia sesión y selecciona un rancho para compartirla con sus otros dispositivos.";
    $("#save-animal-settings").hidden = !canEdit;
    $("#save-animal-settings").textContent = state.fieldSettingsDirty
      ? "Guardar cambios pendientes"
      : "Guardar configuración";
    $("#reset-animal-settings").disabled = !canEdit;
    const summaryCount = Object.values(config.fields)
      .filter(field => field.enabled && field.detailVisibility === "summary").length;
    $("#animal-summary-limit-warning").hidden = summaryCount <= 10;
    $("#animal-summary-limit-warning").textContent =
      `Hay ${summaryCount} campos en la ficha resumida. Se recomienda mostrar 10 o menos para facilitar la lectura en el corral.`;
    $("#animal-module-settings").innerHTML = ANIMAL_MODULES.map(module => `
      <label class="settings-module">
        <input type="checkbox" data-module-setting="${module.id}" ${config.modules[module.id] ? "checked" : ""}
          ${module.locked || !canEdit ? "disabled" : ""}>
        <span><strong>${escapeHtml(module.label)}</strong><small>${escapeHtml(module.description)}</small></span>
      </label>`).join("");
    $("#animal-list-settings").innerHTML = ANIMAL_LISTS.map(list => {
      const options = config.lists[list.id] || [];
      const rows = options.map(option => {
        const inUse = state.animals.some(animal => animal[list.id === "status" ? "status" : list.id] === option.value);
        return animalListOptionMarkup(list.id, option, inUse, canEdit);
      }).join("");
      return `<section class="settings-list">
        <h3>${escapeHtml(list.label)}</h3>
        ${rows || '<p class="muted">Todavía no hay opciones configuradas.</p>'}
        <button class="button button-outline button-small" type="button" data-add-animal-option="${list.id}" ${canEdit ? "" : "disabled"}>Añadir opción</button>
      </section>`;
    }).join("");
    $("#animal-field-settings").innerHTML = ANIMAL_FIELD_CATALOG.map(field => {
      const setting = config.fields[field.id];
      const checkbox = (property, label, disabled = false) =>
        `<input type="checkbox" data-field-setting="${property}" data-field-id="${field.id}" aria-label="${label} · ${escapeHtml(setting.label)}" ${setting[property] ? "checked" : ""} ${disabled || field.locked || !canEdit ? "disabled" : ""}>`;
      return `<tr>
        <td class="settings-field-name"><label for="field-label-${field.id}">${escapeHtml(field.label)}</label><small>${escapeHtml(field.description)}</small>
          <input id="field-label-${field.id}" class="settings-field-label" type="text" maxlength="80" value="${escapeHtml(setting.label)}" data-field-label="${field.id}" aria-label="Nombre visible para ${escapeHtml(field.label)}" ${canEdit ? "" : "disabled"}>
          ${field.locked ? '<small class="settings-locked-note">Campo automático u operativo; no se desactiva.</small>' : ""}
        </td>
        <td data-mobile-label="Activado">${checkbox("enabled", `Activar ${field.label}`, Boolean(field.locked))}</td>
        <td data-mobile-label="Formulario">${field.form ? `<label class="settings-field-form">${checkbox("form", `Mostrar ${field.label} en el formulario`)}<select data-field-setting="formLevel" data-field-id="${field.id}" aria-label="Nivel del formulario para ${escapeHtml(setting.label)}" ${canEdit && !field.locked ? "" : "disabled"}>
          <option value="basic" ${setting.formLevel === "basic" ? "selected" : ""}>Básico</option>
          <option value="advanced" ${setting.formLevel !== "basic" ? "selected" : ""}>Datos adicionales</option>
        </select></label>` : '<span class="settings-not-applicable">—</span>'}</td>
        <td data-mobile-label="Ficha">${field.detail ? `<select data-field-setting="detailVisibility" data-field-id="${field.id}" aria-label="Visibilidad de ${escapeHtml(setting.label)} en la ficha" ${canEdit ? "" : "disabled"}>
          <option value="hidden" ${setting.detailVisibility === "hidden" ? "selected" : ""}>Oculto</option>
          <option value="full" ${setting.detailVisibility === "full" ? "selected" : ""}>Solo ficha completa</option>
          <option value="summary" ${setting.detailVisibility === "summary" ? "selected" : ""}>Resumida y completa</option>
        </select>` : '<span class="settings-not-applicable">—</span>'}</td>
        <td data-mobile-label="Tabla">${field.type !== "automatic" ? checkbox("table", `Mostrar ${field.label} en la tabla`) : '<span class="settings-not-applicable">—</span>'}</td>
        <td data-mobile-label="Obligatorio">${field.form && field.type !== "automatic" ? checkbox("required", `Hacer ${field.label} obligatorio`) : '<span class="settings-not-applicable">—</span>'}</td>
      </tr>`;
    }).join("");
    renderCapturePreferences();
  }

  function animalListOptionMarkup(listId, option, inUse = false, canEdit = canManageRanch()) {
    return `<div class="settings-list-option">
      <input type="text" maxlength="80" value="${escapeHtml(option.label)}" data-list-label="${listId}" data-list-value="${escapeHtml(option.value)}"
        aria-label="Etiqueta para ${escapeHtml(option.value)}" ${canEdit ? "" : "disabled"}>
      <label><input type="checkbox" data-list-enabled="${listId}" data-list-value="${escapeHtml(option.value)}"
        ${option.enabled ? "checked" : ""} ${!canEdit || inUse ? "disabled" : ""}> Activa</label>
      ${listId === "status" ? `<label><input type="checkbox" data-list-active="${listId}" data-list-value="${escapeHtml(option.value)}"
        ${option.active !== false ? "checked" : ""} ${canEdit && !DEFAULT_STATUS_OPTIONS.some(defaultOption => defaultOption.value === option.value) ? "" : "disabled"}> Cuenta en inventario</label>` : ""}
      ${inUse ? '<small>En uso; no se puede desactivar.</small>' : ""}
    </div>`;
  }

  async function saveAnimalFieldSettingsFromForm() {
    if (!canManageRanch()) return;
    const fields = {};
    ANIMAL_FIELD_CATALOG.forEach(field => {
      const prior = animalFieldConfig(field.id);
      const readBoolean = property =>
        $("#animal-field-settings").querySelector(`[data-field-setting="${property}"][data-field-id="${field.id}"]`)?.checked ?? prior[property];
      fields[field.id] = {
        ...prior,
        enabled: field.locked ? true : readBoolean("enabled"),
        form: readBoolean("form"),
        formLevel: $("#animal-field-settings").querySelector(
          `[data-field-setting="formLevel"][data-field-id="${field.id}"]`
        )?.value ?? prior.formLevel,
        detailVisibility: $("#animal-field-settings").querySelector(
          `[data-field-setting="detailVisibility"][data-field-id="${field.id}"]`
        )?.value ?? prior.detailVisibility,
        table: readBoolean("table"),
        required: Boolean(field.form && field.type !== "automatic" && readBoolean("required")),
        label: $("#animal-field-settings").querySelector(`[data-field-label="${field.id}"]`).value.trim() || field.label
      };
    });
    const modules = { ...state.fieldConfig.modules };
    ANIMAL_MODULES.forEach(module => {
      modules[module.id] = module.locked || Boolean($(`[data-module-setting="${module.id}"]`)?.checked);
    });
    const lists = { ...state.fieldConfig.lists };
    ANIMAL_LISTS.forEach(list => {
      lists[list.id] = $$(`[data-list-label="${list.id}"]`, $("#animal-list-settings")).map(input => {
        const checkbox = $(`[data-list-enabled="${list.id}"][data-list-value="${CSS.escape(input.dataset.listValue)}"]`);
        const prior = (state.fieldConfig.lists[list.id] || []).find(option => option.value === input.dataset.listValue);
        return {
          value: input.dataset.listValue,
          label: input.value.trim() || prior?.label || input.dataset.listValue,
          enabled: checkbox?.checked ?? prior?.enabled ?? true,
          ...(list.id === "status" ? {
            active: $(`[data-list-active="${list.id}"][data-list-value="${CSS.escape(input.dataset.listValue)}"]`)?.checked ?? prior?.active ?? true
          } : {})
        };
      });
    });
    const config = { ...state.fieldConfig, schemaVersion: 4, modules, fields, lists, layout: { ...state.fieldConfig.layout, preset: settingsPreset } };
    await persistAnimalFieldConfig(config, "Configuración de campos guardada.");
  }

  async function persistAnimalFieldConfig(config, successMessage) {
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede cambiar esta configuración.");
      return;
    }
    if ($("#animal-dialog").open) {
      showToast("Cierra el formulario del animal antes de cambiar su configuración.");
      return;
    }
    const previous = await getOne("ranchSettings", "animal-fields");
    const record = {
      id: "animal-fields",
      ownerId: state.ranchOwnerId,
      config: normalizeAnimalFieldConfig(config),
      revision: (previous?.revision || 0) + 1,
      baseRevision: previous?.baseRevision || 0,
      dirty: true,
      updatedAt: new Date().toISOString()
    };
    await put("ranchSettings", record);
    state.fieldConfigRecord = record;
    state.fieldConfig = record.config;
    renderAnimalSettings();
    applyAnimalFieldVisibility();
    renderDashboard();
    if ($("#detail-dialog").open && state.currentAnimalId) openDetail(state.currentAnimalId, true);
    if (state.mainView === "calculator") renderCalculatorAnimalOptions();
    scheduleSync();
    state.fieldSettingsDirty = false;
    updateSettingsWorkspace();
    $("#save-animal-settings").textContent = "Guardar configuración";
    showToast(successMessage);
  }

  async function withSettingsSave(action) {
    if(settingsSaving || !canManageRanch()) return;
    settingsSaving=true;
    const root=$("#settings-view");
    const controls=[...root.querySelectorAll("button,input,select,textarea")];
    const previous=new Map(controls.map(el=>[el,el.disabled]));
    controls.forEach(el=>el.disabled=true);
    root.setAttribute("aria-busy","true");
    $("#save-animal-settings").textContent="Guardando…";
    try { await action(); } catch(error) { showToast("No se pudo guardar: "+error.message); }
    finally { settingsSaving=false; root.removeAttribute("aria-busy"); controls.forEach(el=>{if(el.isConnected)el.disabled=previous.get(el);}); $("#save-animal-settings").textContent=state.fieldSettingsDirty?"Guardar cambios pendientes":"Guardar configuración"; }
  }
  async function saveAnimalFieldSettings() { await withSettingsSave(saveAnimalFieldSettingsFromForm); }

  async function resetAnimalFieldSettings() {
    if (!canManageRanch()) return;
    if (!confirm("¿Restaurar la configuración predeterminada? Esto no elimina los datos de los animales ni sus registros.")) return;
    try {
      await withSettingsSave(()=>persistAnimalFieldConfig(defaultAnimalFieldConfig(), "Se restauró la configuración predeterminada."));
    } catch (error) {
      showToast(`No se pudo restaurar la configuración: ${error.message}`);
    }
  }

  function nextModifiedAt(previous) {
    const previousTime = Date.parse(previous || "");
    return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
  }

  async function touchAnimal(animalId) {
    const animal = await getOne("animals", animalId);
    if (animal && !isRanchWorker()) await put("animals", {
      ...animal, updatedAt: nextModifiedAt(animal.updatedAt), updatedBy: journeyActor().label
    });
    scheduleSync();
  }

  async function refresh() {
    const [animals, events, photos, journeys, forecasts, fieldConfigRecord] = await Promise.all([
      getAll("animals"), getAll("events"), getAll("photos"), getAll("journeys"), getAll("growthForecasts"),
      getOne("ranchSettings", "animal-fields")
    ]);
    state.animals = animals;
    const assignedIds = await ensureAnimalInternalIds(animals);
    if (assignedIds) scheduleSync();
    state.events = events;
    state.photos = photos;
    state.journeys = journeys;
    state.forecasts = forecasts;
    state.fieldConfigRecord = fieldConfigRecord || null;
    state.fieldConfig = normalizeAnimalFieldConfig(fieldConfigRecord?.config);
    if (fieldConfigRecord?.config && fieldConfigRecord.config.schemaVersion !== 4) {
      state.fieldConfigRecord = { ...fieldConfigRecord, config: state.fieldConfig };
      await put("ranchSettings", state.fieldConfigRecord);
    }
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

  async function ensureAnimalInternalIds(animals, persist = true) {
    const ordered = animals.slice().sort((a, b) => a.id.localeCompare(b.id));
    const used = new Set();
    let maximum = 0;
    ordered.forEach(animal => {
      const match = typeof animal.internalId === "string" && animal.internalId.match(/^ANM-(\d{5,})$/);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    });
    const changedAnimals = [];
    ordered.forEach(animal => {
      let changed = false;
      if (animal.birthEstimated === undefined && typeof animal.birthDateEstimated === "boolean") {
        animal.birthEstimated = animal.birthDateEstimated;
        changed = true;
      }
      if (Object.hasOwn(animal, "birthDateEstimated")) {
        delete animal.birthDateEstimated;
        changed = true;
      }
      const valid = typeof animal.internalId === "string" && /^ANM-\d{5,}$/.test(animal.internalId);
      if (valid && !used.has(animal.internalId)) {
        used.add(animal.internalId);
        if (changed) changedAnimals.push(animal);
        return;
      }
      let candidate;
      do {
        maximum += 1;
        candidate = `ANM-${String(maximum).padStart(5, "0")}`;
      } while (used.has(candidate));
      animal.internalId = candidate;
      used.add(candidate);
      changed = true;
      if (changed) changedAnimals.push(animal);
    });
    if (changedAnimals.length && persist) {
      await transaction(["animals"], "readwrite", tx => {
        changedAnimals.forEach(animal => tx.objectStore("animals").put(animal));
      });
    }
    return changedAnimals.length > 0;
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

  function photoFingerprint(photo) {
    const fingerprint = {
      id: photo.id, animalId: photo.animalId, name: photo.name, mime: photo.mime,
      primary: Boolean(photo.primary), createdAt: photo.createdAt
    };
    const crop = photoCrop(photo);
    if (crop.x !== 50 || crop.y !== 50) {
      fingerprint.cropX = crop.x;
      fingerprint.cropY = crop.y;
    }
    return fingerprint;
  }

  function bundleFingerprint(bundle) {
    const deletedAt = bundle.deletedAt ? new Date(bundle.deletedAt).toISOString() : null;
    const photos = bundle.photos.map(photoFingerprint).sort((a, b) => a.id.localeCompare(b.id));
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
          primary: Boolean(photo.primary), createdAt: photo.createdAt,
          cropX: photoCrop(photo).x, cropY: photoCrop(photo).y, storagePath
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

  async function syncAnimalFieldConfig() {
    const local = await getOne("ranchSettings", "animal-fields");
    const { data: remote, error: fetchError } = await cloud.from("ranch_animal_configs")
      .select("owner_id, config, revision, updated_at")
      .eq("owner_id", state.ranchOwnerId)
      .maybeSingle();
    if (fetchError) {
      if (fetchError.code === "PGRST205" || fetchError.code === "42P01" ||
          /ranch_animal_configs|schema cache|does not exist/i.test(fetchError.message || "")) {
        if (local?.dirty) {
          showToast("La configuración se guardó en este dispositivo. Para sincronizarla, actualiza Supabase al esquema actual de supabase-schema.sql.");
        }
        return "Configuración de campos solo local · falta la migración de Supabase";
      }
      throw fetchError;
    }
    if (!local) {
      if (remote) {
        if (state.fieldSettingsDirty && !confirm(
          "La configuración del rancho está disponible, pero hay cambios locales sin guardar.\n\n" +
          "Aceptar: descartar los cambios sin guardar y cargar la configuración del rancho.\n" +
          "Cancelar: conservar estos cambios en pantalla; el resto de los datos sí se sincronizará."
        )) return "Configuración en la nube pendiente de cargar · se conservaron cambios locales sin guardar";
        state.fieldSettingsDirty = false;
        const downloaded = {
          id: "animal-fields",
          ownerId: state.ranchOwnerId,
          config: normalizeAnimalFieldConfig(remote.config),
          revision: remote.revision,
          baseRevision: remote.revision,
          dirty: false,
          updatedAt: remote.updated_at
        };
        await put("ranchSettings", downloaded);
        state.fieldConfigRecord = downloaded;
        state.fieldConfig = downloaded.config;
        renderAnimalSettings();
      }
      return "";
    }

    const remoteRevision = remote?.revision || 0;
    if (local.dirty) {
      if (!canManageRanch()) {
        state.fieldSettingsDirty = false;
        const downloaded = {
          ...local,
          config: normalizeAnimalFieldConfig(remote?.config),
          revision: remoteRevision,
          baseRevision: remoteRevision,
          dirty: false,
          updatedAt: remote?.updated_at || new Date().toISOString()
        };
        await put("ranchSettings", downloaded);
        state.fieldConfigRecord = downloaded;
        state.fieldConfig = downloaded.config;
        renderAnimalSettings();
        return "Se descartó una configuración local sin autorización; se mantuvieron los demás datos sincronizados";
      }
      let config = normalizeAnimalFieldConfig(local.config);
      if (remoteRevision !== local.baseRevision) {
        const keepLocal = confirm(
          "La configuración de campos cambió en otro dispositivo.\n\n" +
          "Aceptar: conservar la configuración de este dispositivo.\n" +
          "Cancelar: cargar la configuración del rancho."
        );
        if (!keepLocal) {
          if (!remote) throw new Error("La configuración local tiene una revisión anterior y no existe una versión en la nube para restaurar.");
          if (state.fieldSettingsDirty && !confirm(
            "Hay cambios adicionales de configuración sin guardar.\n\n" +
            "Aceptar: descartarlos y cargar la configuración del rancho.\n" +
            "Cancelar: conservarlos en pantalla; el resto de los datos sí se sincronizará."
          )) return "Configuración en la nube pendiente de cargar · se conservaron cambios locales sin guardar";
          state.fieldSettingsDirty = false;
          const downloaded = {
            ...local, config: normalizeAnimalFieldConfig(remote.config), revision: remote.revision,
            baseRevision: remote.revision, dirty: false, updatedAt: remote.updated_at
          };
          await put("ranchSettings", downloaded);
          state.fieldConfigRecord = downloaded;
          state.fieldConfig = downloaded.config;
          renderAnimalSettings();
          return "Configuración actualizada desde el rancho";
        }
      }
      const { data, error } = await cloud.rpc("save_ranch_animal_config", {
        p_owner_id: state.ranchOwnerId,
        p_expected_revision: remoteRevision,
        p_config: ranchAnimalFieldConfigPayload(config)
      });
      if (error) throw error;
      const saved = {
        ...local, config, revision: data.revision, baseRevision: data.revision,
        dirty: false, updatedAt: data.updated_at
      };
      await put("ranchSettings", saved);
      state.fieldConfigRecord = saved;
      state.fieldConfig = config;
      return "";
    }

    if (remote && remote.revision !== local.baseRevision) {
      if (state.fieldSettingsDirty && !confirm(
        "La configuración del rancho cambió en otro dispositivo y hay cambios locales sin guardar.\n\n" +
        "Aceptar: descartar los cambios sin guardar y cargar la configuración del rancho.\n" +
        "Cancelar: conservarlos en pantalla; el resto de los datos sí se sincronizará."
      )) return "Configuración en la nube pendiente de cargar · se conservaron cambios locales sin guardar";
      state.fieldSettingsDirty = false;
      const downloaded = {
        ...local, config: normalizeAnimalFieldConfig(remote.config), revision: remote.revision,
        baseRevision: remote.revision, dirty: false, updatedAt: remote.updated_at
      };
      await put("ranchSettings", downloaded);
      state.fieldConfigRecord = downloaded;
      state.fieldConfig = downloaded.config;
      renderAnimalSettings();
      return "Configuración actualizada desde el rancho";
    }
    if (!remote && local.baseRevision > 0) {
      throw new Error("No se encontró en Supabase la configuración que este dispositivo había sincronizado.");
    }
    return "";
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
      const fieldConfigStatus = await syncAnimalFieldConfig();
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
        if (state.animals.some(animal => animal.id === state.currentAnimalId)) openDetail(state.currentAnimalId, true);
        else $("#detail-dialog").close();
      }
      if ($("#journey-dialog").open && state.currentJourneyId) renderJourneyDetail();
      setSyncStatus(pendingChanges
        ? `${pendingChanges} cambio(s) pendiente(s) · vuelve a sincronizar`
        : fieldConfigStatus || (conflicts ? `Sincronizado · ${conflicts} conflicto(s) resuelto(s)` : "Sincronizado"));
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
  function isEstimatedBirthDate(animal) {
    return animal?.birthEstimated === true || animal?.birthDateEstimated === true;
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
  function photoCrop(photo) {
    const coordinate = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 50;
    return { x: coordinate(photo?.cropX), y: coordinate(photo?.cropY) };
  }
  function updatePhotoCropControls() {
    const image = $(".detail-hero img");
    const frame = $(".detail-hero");
    const panel = $(".detail-crop-panel");
    if (!image || !frame || !panel || !image.naturalWidth || !image.naturalHeight) return;
    const horizontal = panel.querySelector('[data-photo-crop="x"]');
    const vertical = panel.querySelector('[data-photo-crop="y"]');
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const frameRatio = frame.clientWidth / frame.clientHeight;
    horizontal.disabled = imageRatio <= frameRatio + 0.01;
    vertical.disabled = imageRatio >= frameRatio - 0.01;
    const help = panel.querySelector(".detail-crop-help");
    help.textContent = horizontal.disabled && vertical.disabled
      ? "La foto se muestra completa; no necesita recorte."
      : horizontal.disabled
        ? "Esta foto se recorta arriba y abajo. Ajusta la posición vertical."
        : vertical.disabled
          ? "Esta foto se recorta a los lados. Ajusta la posición horizontal."
          : "Ajusta la posición de la foto en el marco.";
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
        !Number.isInteger(days) || days < 0 || days > 3650 || !Number.isFinite(baselineDay) || !Number.isFinite(weight + gainKgPerDay * days)) return null;
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
    analysisLoadDefaults();
    analysisRefreshLots();
    const selected = select.value;
    const availableAnimals = state.animals.filter(isActiveAnimal);
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
      analysisAutoAnimal(null,null,null);
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
    analysisAutoAnimal(animal,latest,basis);
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



  function analysisStorageKey(){return "ganadero:analysis:"+ (currentUser?.id||"local")+":"+ (state.ranchOwnerId||"local");}
  function analysisSaved(){try{const x=JSON.parse(localStorage.getItem(analysisStorageKey())||"{}");return x&&typeof x==="object"?x:{};}catch{return {};}}
  function analysisWrite(data){try{localStorage.setItem(analysisStorageKey(),JSON.stringify(data));return true;}catch(error){showToast("No se pudo guardar en este dispositivo: "+error.message);return false;}}
  let analysisScope="";
  const quoteFields=["current-category","price-date","current-min","current-average","current-max","next-category","next-threshold","next-min","next-average","next-max"];
  function analysisQuotes(){const q=analysisSaved().quotes;return Array.isArray(q)?q.filter(x=>x&&typeof x.id==="string"&&x.fields):[];}
  function analysisRefreshQuotes(){
    const select=$("#analysis-quote-select"),prior=select.value;
    select.replaceChildren(new Option("Seleccionar cotización",""));
    analysisQuotes().forEach(q=>select.add(new Option(q.fields["current-category"]+" · "+q.fields["price-date"]+" · "+q.fields["current-average"]+" MXN/kg",q.id)));
    if([...select.options].some(o=>o.value===prior))select.value=prior;
  }
  function analysisSaveQuote(){
    const fields=Object.fromEntries(quoteFields.map(k=>[k,$("#calculator-"+k).value.trim()]));
    const avg=calculatorNumber("#calculator-current-average"),min=calculatorNumber("#calculator-current-min"),max=calculatorNumber("#calculator-current-max");
    const next=calculatorNumber("#calculator-next-average"),nmin=calculatorNumber("#calculator-next-min"),nmax=calculatorNumber("#calculator-next-max"),threshold=calculatorNumber("#calculator-next-threshold");
    if(!fields["current-category"]||!fields["price-date"]||fields["price-date"]>today()||avg===null||avg<=0||min!==null&&(min<0||min>avg)||max!==null&&max<avg||next!==null&&next<0||threshold!==null&&threshold<0||nmin!==null&&(nmin<0||next!==null&&nmin>next)||nmax!==null&&(nmax<0||next!==null&&nmax<next)){showToast("Revisa categoría, fecha y precios antes de guardar.");return;}
    const saved=analysisSaved(),quotes=analysisQuotes(),id=newId();
    if(analysisWrite({...saved,quotes:[{id,fields},...quotes.filter(q=>!(q.fields["current-category"]===fields["current-category"]&&q.fields["price-date"]===fields["price-date"]))].slice(0,100)})){analysisRefreshQuotes();$("#analysis-quote-select").value=id;analysisText("#analysis-quote-note","Cotización guardada localmente. Verifica su vigencia antes de reutilizarla.");}
  }
  function analysisApplyQuote(){
    const q=analysisQuotes().find(x=>x.id===$("#analysis-quote-select").value);
    if(!q){showToast("Selecciona una cotización guardada.");return;}
    quoteFields.forEach(k=>$("#calculator-"+k).value=q.fields[k]||"");
    $("#calculator-future-price").value="";
    analysisText("#analysis-quote-note","Cotización local del "+formatDate(q.fields["price-date"])+". Confirma que corresponde al animal y al mercado.");
    updateCalculator();
  }
  function analysisRefreshLots(){
    const el=$("#analysis-lot-select"),prior=el.value;
    const lots=[...new Set(state.animals.filter(isActiveAnimal).map(a=>a.lot).filter(Boolean))];
    el.replaceChildren(new Option("Captura manual",""));
    lots.forEach(lot=>el.add(new Option((state.fieldConfig?.lists?.lot||[]).find(x=>x.value===lot)?.label||lot,lot)));
    if(lots.includes(prior))el.value=prior;else if(prior){$("#analysis-lot-count").value="";analysisText("#analysis-lot-note","El lote anterior ya no está disponible.");}
    if(el.value)analysisCountLot();
  }
  function analysisCountLot(){
    const lot=$("#analysis-lot-select").value;
    if(lot){const count=state.animals.filter(a=>isActiveAnimal(a)&&a.lot===lot).length;$("#analysis-lot-count").value=String(count);analysisText("#analysis-lot-note",count+" animales activos del inventario; se aplica un escenario homogéneo.");}
    else analysisText("#analysis-lot-note","Cantidad manual.");
    updateAnalysisTools();
  }
  function analysisLoadDefaults(){
    const key=analysisStorageKey();
    if(key===analysisScope)return;
    analysisScope=key;
    const prefs=analysisSaved().defaults||{};
    $("#calculator-cost").value=prefs.cost??"0";
    $("#analysis-feed-ration").value=prefs.ration??"";
    $("#analysis-feed-price").value=prefs.price??"";
    $("#analysis-target").value=prefs.target??"";
    quoteFields.forEach(k=>$("#calculator-"+k).value=k==="price-date"?today():"");
    $("#calculator-future-price").value="";
    $("#analysis-quote-select").value="";
    analysisText("#analysis-quote-note","Selecciona una cotización guardada o captura una nueva.");
    analysisRefreshQuotes();
    analysisRefreshLots();
  }
  function analysisAutoAnimal(animal,latest,basis){
    $("#analysis-target-base").value=$("#calculator-weight").value;
    $("#analysis-target-gain").value=$("#calculator-gain").value;
    const target=animal?growthTargetValues(animal):null;
    $("#analysis-target").value=target?.hasTarget?String(target.targetMin):(analysisSaved().defaults?.target??"");
    analysisText("#analysis-target-source",target?.hasTarget?"Objetivo mínimo del expediente; rango "+target.targetMin+"–"+target.targetMax+" kg.": "Objetivo manual o preferencia personal.");
    analysisText("#analysis-auto-note",animal?(latest?"Peso y fecha del historial. ":"Sin pesajes guardados. ")+(basis?"GMD calculada. ":"GMD manual necesaria. ")+(target?.hasTarget?"Objetivo del expediente recuperado.":""):"Captura manual; no hay animal seleccionado.");
    if(animal?.lot){const el=$("#analysis-lot-select");if([...el.options].some(o=>o.value===animal.lot)){el.value=animal.lot;analysisCountLot();}}
    updateAnalysisTools();
  }

  let analysisSale = null;
  function analysisText(id,value){ $(id).textContent=value; }
  function resetAnalysis(weight,gain,days,baselineDate,animalId){
    analysisSale=null;
    const animal=state.animals.find(a=>a.id===animalId);
    analysisText("#analysis-animal-name",animal ? [animal.tag,animal.name].filter(Boolean).join(" · ") || "Animal seleccionado" : "Captura manual");
    analysisText("#analysis-animal-meta",animal ? [animal.sex,animal.breed ? (state.fieldConfig?.lists?.breed||[]).find(x=>x.value===animal.breed)?.label : "",animal.status].filter(Boolean).join(" · ") : "Introduce los datos base de tu escenario.");
    analysisText("#analysis-base-weight",weight!==null?formatProjectedWeight(weight):"—");
    analysisText("#analysis-base-gain",gain!==null?gain.toFixed(3)+" kg/día":"—");
    analysisText("#analysis-base-date",baselineDate?formatDate(baselineDate):"—");
    $("#analysis-days-slider").max=String(Math.max(180,Math.min(3650,days??0)));
    $("#analysis-days-slider").value=String(Math.max(0,Math.min(3650,days??0)));
    $$("[data-analysis-days]").forEach(b=>b.setAttribute("aria-pressed",String(Number(b.dataset.analysisDays)===days)));
    $("#analysis-decision").dataset.tone="neutral";
    analysisText("#analysis-decision-title","Completa los datos");
    analysisText("#analysis-decision-detail","Introduce peso, crecimiento, precio y costos.");
    ["#analysis-expenses","#analysis-net-sale","#analysis-break-price","#analysis-break-cost"].forEach(id=>analysisText(id,"—"));
    analysisText("#analysis-periods","Completa la simulación para comparar los plazos.");
    analysisText("#analysis-lot-result","Completa primero la simulación de venta.");
  }
  function renderAnalysisSale({weight,gain,days,dailyCost,currentAverage,nextThreshold,nextAverage,futurePrice,projectedWeight,currentValue,futureValue,netDifference}){
    const expenses=dailyCost*days;
    analysisSale={currentValue,futureValue,expenses,netDifference};
    const tone=netDifference>0.005?"positive":netDifference<-.005?"negative":"neutral";
    $("#analysis-decision").dataset.tone=tone;
    analysisText("#analysis-decision-title",tone==="positive"?"Esperar mejora el resultado":tone==="negative"?"Vender en la fecha base resulta mejor":"Sin diferencia económica");
    analysisText("#analysis-decision-detail","Comparación estimada a "+days+" días bajo los supuestos capturados.");
    analysisText("#analysis-expenses",formatCurrency(expenses));
    analysisText("#analysis-net-sale",formatCurrency(futureValue-expenses));
    analysisText("#analysis-break-price",projectedWeight>0?formatCurrency((currentValue+expenses)/projectedWeight)+"/kg":"—");
    analysisText("#analysis-break-cost",days>0?formatCurrency((futureValue-currentValue)/days)+"/día":"—");
    const periods=[...new Set([0,7,15,30,45,60,90,days])].sort((a,b)=>a-b).map(d=>{
      const w=weight+gain*d;
      const p=d===0?currentAverage:futurePrice??(nextThreshold!==null&&nextAverage!==null&&w>=nextThreshold?nextAverage:currentAverage);
      const gross=w*p, cost=d*dailyCost, net=d===0?0:gross-cost-currentValue;
      return {d,w,gross,cost,net,valid:w>=0&&[w,gross,cost,net].every(Number.isFinite)};
    }).filter(x=>x.valid);
    const best=periods.reduce((a,b)=>b.net>a.net?b:a,periods[0]);
    const scale=Math.max(1,...periods.map(x=>Math.abs(x.net)));
    $("#analysis-periods").innerHTML='<p class="analysis-best">Mejor resultado entre los plazos evaluados: <strong>'+ (best.d===0?"fecha base":best.d+" días")+'</strong> · '+formatCurrency(best.net)+'</p><div class="analysis-period-list">'+periods.map(x=>'<div class="analysis-period"><strong>'+(x.d===0?"Base":x.d+" días")+'</strong><span>'+formatProjectedWeight(x.w)+'</span><div class="analysis-bar"><i style="width:'+Math.abs(x.net)/scale*100+'%" data-tone="'+(x.net<0?"negative":"positive")+'"></i></div><b data-tone="'+(x.net<0?"negative":"positive")+'">'+formatCurrency(x.net)+'</b></div>').join("")+'</div><small>Importes: diferencia respecto a vender en la fecha base, después del costo diario indicado. No es una garantía de precio ni crecimiento.</small>';
    updateAnalysisTools();
  }
  function updateAnalysisTools(){
    const n=id=>calculatorNumber(id);
    const base=n("#analysis-target-base"),g=n("#analysis-target-gain"),target=n("#analysis-target");
    analysisText("#analysis-target-result",base===null||g===null||target===null||base<0||target<0?"Completa los tres datos válidos.":base>=target?"El peso base ya alcanza el objetivo.":g<=0?"Con esta GMD no se alcanza un objetivo superior.":Math.ceil((target-base)/g)+" días estimados desde el peso base.");
    const count=n("#analysis-feed-count"),ration=n("#analysis-feed-ration"),price=n("#analysis-feed-price"),days=n("#analysis-feed-days");
    const feedValid=Number.isInteger(count)&&count>0&&ration!==null&&ration>=0&&price!==null&&price>=0&&Number.isInteger(days)&&days>=0&&Number.isFinite(count*ration*price*days);
    analysisText("#analysis-feed-result",feedValid?formatCurrency(ration*price)+" por animal/día · "+formatCurrency(count*ration*price*days)+" total · "+(count*ration*days).toFixed(1)+" kg de alimento":"Completa los datos válidos.");
    $("#analysis-use-feed").disabled=!feedValid;
    const lot=n("#analysis-lot-count");
    analysisText("#analysis-lot-result",analysisSale&&Number.isInteger(lot)&&lot>0&&Number.isFinite(lot*analysisSale.netDifference)?"Venta base "+formatCurrency(lot*analysisSale.currentValue)+" · venta futura menos costos "+formatCurrency(lot*(analysisSale.futureValue-analysisSale.expenses))+" · diferencia "+formatCurrency(lot*analysisSale.netDifference):"Completa la simulación y el número de animales.");
  }
  function showAnalysisTab(id){
    $$("[data-analysis-tab]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.analysisTab===id)));
    $$("[data-analysis-panel]").forEach(p=>p.hidden=p.dataset.analysisPanel!==id);
    updateAnalysisTools();
  }
  function registerAnalysis(){
    const root=$("#calculator-view");
    $("#analysis-auto-restore").addEventListener("click",()=>{if($("#calculator-animal").value)loadCalculatorAnimal();else showToast("Selecciona un animal primero.");});
    $("#analysis-quote-save").addEventListener("click",analysisSaveQuote);
    $("#analysis-quote-apply").addEventListener("click",analysisApplyQuote);
    $("#analysis-quote-delete").addEventListener("click",()=>{const id=$("#analysis-quote-select").value;if(!id)return;if(analysisWrite({...analysisSaved(),quotes:analysisQuotes().filter(q=>q.id!==id)})){analysisRefreshQuotes();analysisText("#analysis-quote-note","Cotización eliminada del dispositivo.");}});
    $("#analysis-lot-select").addEventListener("change",analysisCountLot);
    $("#analysis-lot-count").addEventListener("input",()=>{$("#analysis-lot-select").value="";analysisText("#analysis-lot-note","Cantidad manual.");});
    $("#analysis-save-defaults").addEventListener("click",()=>{const ration=calculatorNumber("#analysis-feed-ration"),price=calculatorNumber("#analysis-feed-price"),cost=calculatorNumber("#calculator-cost"),target=calculatorNumber("#analysis-target");if([ration,price,cost,target].some(x=>x!==null&&x<0)){showToast("Revisa los valores.");return;}if(analysisWrite({...analysisSaved(),defaults:{ration,price,cost:ration!==null&&price!==null?Number((ration*price).toFixed(2)):cost,target}})){showToast("Preferencias guardadas en este dispositivo.");}});
    root.addEventListener("click",e=>{
      const tab=e.target.closest("[data-analysis-tab]"),day=e.target.closest("[data-analysis-days]");
      if(tab)showAnalysisTab(tab.dataset.analysisTab);
      if(day){$("#calculator-days").value=day.dataset.analysisDays;updateCalculator();}
    });
    $("#analysis-days-slider").addEventListener("input",()=>{$("#calculator-days").value=$("#analysis-days-slider").value;updateCalculator();});
    root.addEventListener("input",e=>{if(e.target.closest(".analysis-tool"))updateAnalysisTools();});
    $("#analysis-copy-weight").addEventListener("click",()=>{$("#analysis-target-base").value=$("#calculator-weight").value;$("#analysis-target-gain").value=$("#calculator-gain").value;updateAnalysisTools();});
    $("#analysis-use-feed").addEventListener("click",()=>{if($("#analysis-use-feed").disabled)return;$("#calculator-cost").value=(calculatorNumber("#analysis-feed-ration")*calculatorNumber("#analysis-feed-price")).toFixed(2);showAnalysisTab("sale");updateCalculator();});
    updateAnalysisTools();
  }

  function updateCalculator() {
    const weight = calculatorNumber("#calculator-weight");
    const gain = calculatorNumber("#calculator-gain");
    const days = calculatorNumber("#calculator-days");
    const dailyCost = calculatorNumber("#calculator-cost");
    const baselineDate = $("#calculator-baseline-date").value;
    const selectedAnimalId = $("#calculator-animal").value;
    state.calculatorProjection = null;
    resetAnalysis(weight,gain,days,baselineDate,selectedAnimalId);
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
    if (weight <= 0 || days === null || !Number.isInteger(days) || days < 0 || days > 3650 || dailyCost === null || dailyCost < 0 ||
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
    if (selectedAnimalId && state.calculatorProjection && projectedWeight >= 0) {
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
    const salePrice = days === 0 ? currentAverage : futurePrice !== null ? futurePrice : usesNextRange ? nextAverage : currentAverage;
    const futureValue = projectedWeight * salePrice;
    const netDifference = futureValue - currentValue - dailyCost * days;
    if (![currentValue,futureValue,netDifference,dailyCost*days].every(Number.isFinite)) { setCalculatorMessage("Los importes exceden el rango de cálculo. Revisa los valores.",true); return; }
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
    renderAnalysisSale({weight,gain,days,dailyCost,currentAverage,nextThreshold,nextAverage,futurePrice,projectedWeight,currentValue,futureValue,netDifference});
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
    if (!projection || projection.predictedWeight < 0 || !animalId || projection.animalId !== animalId ||
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
        <button class="button button-outline button-small growth-first-weighing" type="button" data-add-record="weight">${icon("plus")} Registrar primer peso</button>
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
    const activeAnimals = state.animals.filter(isActiveAnimal);
    const activeIds = new Set(activeAnimals.map(animal => animal.id));
    $("#stat-total").textContent = String(activeAnimals.length);
    $("#stat-females").textContent = String(activeAnimals.filter(animal => animal.sex === "Hembra").length);
    $("#stat-males").textContent = String(activeAnimals.filter(animal => animal.sex === "Macho").length);
    const weighed = new Set(state.events.filter(event => event.type === "weight" && activeIds.has(event.animalId)).map(event => event.animalId));
    $("#stat-weighed").textContent = String(weighed.size);

    const query = $("#search-input").value.trim().toLocaleLowerCase("es-MX");
    const archivedAnimals = state.animals.filter(animal => !isActiveAnimal(animal));
    const displayedAnimals = state.archiveView ? archivedAnimals : activeAnimals;
    const filtered = displayedAnimals.filter(animal => {
      const configuredValues = ANIMAL_FIELD_CATALOG
        .filter(field => animalFieldActive(field.id))
        .map(field => animalFieldDisplayValue(field, animal));
      const searchable = configuredValues.filter(Boolean).join(" ").toLocaleLowerCase("es-MX");
      return !query || searchable.includes(query);
    }).sort((a, b) => {
      const first = sortValue(a, state.sort);
      const second = sortValue(b, state.sort);
      return String(first).localeCompare(String(second), "es-MX", { numeric: true }) * state.direction;
    });
    const baseTableFields = new Set(["tag", "name", "sex", "color", "status", "estimatedAge"]);
    const extraTableFields = ANIMAL_FIELD_CATALOG.filter(field =>
      field.type !== "automatic" && !baseTableFields.has(field.id) &&
      animalFieldActive(field.id) && animalFieldConfig(field.id).table
    );
    $("#animal-extra-headers").textContent = extraTableFields.length ? "Otros datos" : "";
    $("#animal-extra-headers").hidden = extraTableFields.length === 0;

    $("#inventory-heading-title").textContent = state.archiveView ? "Archivo de animales" : "Inventario activo";
    $("#inventory-count").textContent = state.archiveView
      ? `${filtered.length} de ${archivedAnimals.length} ${archivedAnimals.length === 1 ? "animal archivado" : "animales archivados"}`
      : `${filtered.length} ${filtered.length === 1 ? "animal" : "animales"}`;
    $("#archive-toggle").innerHTML = state.archiveView
      ? `${icon("inventory")} Ver inventario activo (${activeAnimals.length})`
      : `${icon("archive")} Ver archivo (${archivedAnimals.length})`;
    $("#archive-toggle").setAttribute("aria-pressed", String(state.archiveView));
    const rows = $("#animal-rows");
    rows.innerHTML = filtered.map(animal => {
      const weight = eventFor(animal.id, "weight");
      const primaryPhoto = state.photos.find(photo => photo.animalId === animal.id && photo.primary) || state.photos.find(photo => photo.animalId === animal.id);
      const avatar = primaryPhoto
        ? `<img src="${photoUrl(primaryPhoto)}" alt="">`
        : escapeHtml(initials(animal));
      const extraValues = extraTableFields.map(field => {
        const value = animalFieldDisplayValue(field, animal);
        return value ? `<span><strong>${escapeHtml(animalFieldConfig(field.id).label)}:</strong> ${escapeHtml(value)}</span>` : "";
      }).filter(Boolean).join(" · ");
      return `<tr>
        <td><div class="animal-cell"><div class="animal-avatar">${avatar}</div><div>
          <button class="animal-link" data-config-field="name" data-config-surface="table" data-open-animal="${escapeHtml(animal.id)}" type="button">${escapeHtml(animal.name || "Sin nombre")}</button>
          <span class="animal-sub" data-config-field="tag" data-config-surface="table">${escapeHtml(animalFieldConfig("tag").label)} ${display(animal.tag)}</span>
        </div></div></td>
        <td data-config-field="sex" data-config-surface="table">${display(animal.sex)}</td>
        <td data-config-field="color" data-config-surface="table">${display(animal.color)}</td>
        <td ${extraTableFields.length ? "" : "hidden"}><div class="table-extra-values">${extraValues || "—"}</div></td>
        <td>${weight ? `${escapeHtml(weight.weight)} kg` : "No registrado"}</td>
        <td>${weight ? formatDate(weight.date) : "No registrado"}</td>
        <td data-config-field="status" data-config-surface="table">${statusMarkup(animal.status)}</td>
        <td><button class="row-menu" data-open-animal="${escapeHtml(animal.id)}" type="button" aria-label="Abrir ficha">${icon("chevron")}</button></td>
      </tr>`;
    }).join("");

    const noResults = filtered.length === 0;
    $("#empty-state").hidden = !noResults;
    $("table").hidden = noResults;
    const isEmptyInventory = activeAnimals.length === 0 && !query;
    const isEmptyArchive = archivedAnimals.length === 0 && !query;
    $("#empty-title").textContent = state.archiveView
      ? isEmptyArchive ? "El archivo está vacío" : "No encontramos animales"
      : isEmptyInventory ? "Tu registro comienza aquí" : "No encontramos animales";
    $("#empty-copy").textContent = state.archiveView
      ? isEmptyArchive ? "Los animales vendidos, fallecidos, dados de baja, desaparecidos u otros se conservarán aquí para consultar su expediente y reactivarlos si hace falta." : "Prueba con otro arete, nombre o estado."
      : isEmptyInventory
        ? state.animals.length
          ? "No hay animales activos. Los animales archivados se conservan en el archivo, desde donde puedes consultar sus datos y reactivarlos."
          : "Añade tu primer animal para empezar a organizar su información."
        : "Prueba con otra búsqueda.";
    $("#empty-add-button").hidden = state.archiveView || !isEmptyInventory || !canManageRanch();
    applyAnimalFieldVisibility($("#inventory-view"));
  }

  function journeyName(journey) {
    return journey.name || JOURNEY_TYPES[journey.type] || "Jornada";
  }

  function journeyCounts(journey) {
    const roster = journey.status === "in_progress"
      ? journey.roster.filter(animal => isActiveAnimal(state.animals.find(current => current.id === animal.id) || animal))
      : journey.roster;
    const attended = roster.filter(animal => animal.attended).length;
    return { attended, expected: roster.length, pending: roster.length - attended };
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
        <span class="journey-progress-pending">${counts.pending} pendientes · Continuar ${icon("chevron")}</span>
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
        <td>${journeyStatusMarkup(journey)}</td>
        <td><button class="button button-outline button-small" type="button" data-open-journey="${escapeHtml(journey.id)}">${journey.status === "incomplete" ? "Abrir y continuar" : "Ver jornada"}</button></td>
      </tr>`;
    }).join("");
    $("#journey-history-empty").hidden = history.length > 0;
  }

  function setMainView(view) {
    if(settingsSaving) return;
    if(state.mainView==="settings" && view==="settings") return;
    if (state.mainView === "settings" && view !== "settings" && state.fieldSettingsDirty &&
        !confirm("Hay cambios de configuración sin guardar. ¿Descartarlos?")) return;
    if (state.mainView === "settings" && view !== "settings") {
      state.fieldSettingsDirty = false;
      renderAnimalSettings();
    }
    const journeys = view === "journeys";
    const calculator = view === "calculator";
    const settings = view === "settings";
    state.mainView = settings ? "settings" : calculator ? "calculator" : journeys ? "journeys" : "inventory";
    $("#inventory-view").hidden = !["inventory"].includes(view);
    $("#journeys-view").hidden = !journeys;
    $("#calculator-view").hidden = !calculator;
    $("#settings-view").hidden = !settings;
    $("#inventory-nav").classList.toggle("active", !journeys && !calculator && !settings);
    $("#journeys-nav").classList.toggle("active", journeys);
    $("#calculator-nav").classList.toggle("active", calculator);
    $("#settings-nav").classList.toggle("active", settings);
    $("#inventory-nav").setAttribute("aria-current", !journeys && !calculator && !settings ? "page" : "false");
    $("#journeys-nav").setAttribute("aria-current", journeys ? "page" : "false");
    $("#calculator-nav").setAttribute("aria-current", calculator ? "page" : "false");
    $("#settings-nav").setAttribute("aria-current", settings ? "page" : "false");
    $("#breadcrumb-current").textContent = settings ? "Configuración" : calculator ? "Análisis ganadero" : journeys ? "Jornadas" : "Ganado";
    renderJourneys();
    if (settings) renderAnimalSettings();
    if (calculator) renderCalculatorAnimalOptions();
  }

  function openJourneyCreateForm() {
    if (!hasRanchAccess()) {
      showToast("Crea un rancho o espera a que aprueben tu solicitud para registrar jornadas.");
      return;
    }
    const activeAnimals = state.animals.filter(isActiveAnimal);
    if (!activeAnimals.length) {
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
    const activeAnimals = state.animals.filter(isActiveAnimal);
    if (!activeAnimals.length) {
      showToast("No hay animales activos para incluir en una jornada.");
      return;
    }
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
      roster: activeAnimals.map(animal => ({
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
      if (!finished && !isActiveAnimal(state.animals.find(current => current.id === animal.id) || animal)) return false;
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
      !rosterIds.has(animal.id) && isActiveAnimal(animal));
    const addAnimalsControl = !finished && animalsToAdd.length
      ? `<details class="journey-add-animals">
          <summary>${icon("plus")} Agregar animales a esta jornada (${animalsToAdd.length} disponibles)</summary>
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
          <button class="icon-button" type="button" data-close="journey-dialog" aria-label="Cerrar">${icon("close")}</button>
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
        ${finished ? `<div class="journey-finish-message ${counts.pending ? "warning" : "success"}">${counts.pending ? `${icon("warning")} ${counts.pending} ${counts.pending === 1 ? "animal pendiente" : "animales pendientes"}. No recibirán el registro de esta jornada.` : `${icon("check")} Jornada completada. El historial de los animales atendidos fue actualizado.`}</div>` : ""}
        <div class="journey-roster-tools">
          <label class="search-box">${icon("search", "ui-icon search-icon")}<input id="journey-search" type="search" placeholder="Buscar arete o nombre..." value="${escapeHtml(state.journeySearch)}" autocomplete="off"></label>
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
                <span class="journey-check" aria-hidden="true">${animal.attended ? icon("check") : ""}</span>
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
                    <label>Peso (kg)<input id="journey-weight-input" type="number" min="0" step="0.1" value="${animal.attended ? escapeHtml(animal.weight) : ""}" inputmode="decimal" aria-label="Peso en kilogramos"><small id="journey-weight-feedback" class="field-help" aria-live="polite"></small></label>
                    <button class="button button-primary button-small" type="button" data-save-journey-weight="${escapeHtml(animal.id)}">Guardar</button>
                    <button class="button button-outline button-small" type="button" data-cancel-journey-weight>Cancelar</button>
                  </div>` : ""}
            </div>`).join("") : '<p class="journey-empty">No hay animales en este filtro.</p>'}
        </div>
        ${!finished && counts.pending ? `<p class="journey-pending-alert">${icon("warning")} Faltan ${counts.pending} ${counts.pending === 1 ? "animal" : "animales"} por atender. Se muestran en el filtro «Pendientes».</p>` : ""}
        ${finished && counts.pending ? `<section class="journey-pending-summary"><h3>Animales pendientes (${counts.pending})</h3><p>${journey.roster.filter(animal => !animal.attended).map(animal => `${animal.tag || "Sin arete"} · ${animal.name || "Sin nombre"}`).map(escapeHtml).join("  |  ")}</p></section>` : ""}
        <div class="journey-modal-actions">
          ${journeyStatusMarkup(journey)}
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
    updateJourneyWeightFeedback();
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
        isActiveAnimal(animal))
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
    if (state.journeyWeightWarning &&
        !confirm(`${state.journeyWeightWarning}\n\n¿Guardar de todas formas?`)) return;
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
                updatedAt: nextModifiedAt(animalRequest.result.updatedAt),
                updatedBy: journeyActor().label
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
    if (counts.pending && !confirm(`Todavía hay ${counts.pending} ${counts.pending === 1 ? "animal pendiente" : "animales pendientes"}.\n\n¿Está seguro de que desea finalizar la jornada? Solo se registrarán los animales atendidos.`)) return;
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
              if (animal) animalsStore.put({
                ...animal, updatedAt: nextModifiedAt(animal.updatedAt), updatedBy: journeyActor().label
              });
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
    return ({ Vendido: "sold", Fallecido: "dead", Baja: "other", Otro: "other", Otros: "other", Desaparecido: "other" })[status] ||
      (state.fieldConfig?.lists?.status?.find(option => option.value === status)?.active === false ? "other" : "");
  }
  function showToast(message, action = null) {
    const toast = $("#toast");
    toast.replaceChildren(document.createTextNode(message));
    state.toastAction = action;
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toast-action";
      button.dataset.toastAction = "undo";
      button.textContent = action.label;
      toast.append(button);
    }
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      state.toastAction = null;
    }, action ? 6000 : 2800);
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

  function validateAnimalBackupRecords(animals) {
    if (animals.some(animal => !animal || typeof animal !== "object" ||
        typeof animal.id !== "string" || !animal.id.trim())) {
      throw new Error("La copia contiene una ficha de animal sin identificador válido.");
    }
    const animalIds = new Set(animals.map(animal => animal.id));
    if (animalIds.size !== animals.length) throw new Error("La copia contiene identificadores de animal duplicados.");
    const internalIds = animals.map(animal => animal.internalId).filter(Boolean);
    if (internalIds.some(value => typeof value !== "string" || !/^ANM-\d{5,}$/.test(value)) ||
        new Set(internalIds).size !== internalIds.length) {
      throw new Error("La copia contiene IDs internos inválidos o duplicados.");
    }
    animals.forEach(animal => {
      ANIMAL_FIELD_CATALOG.forEach(field => {
        const value = animal[field.id];
        if (value === undefined || value === null || value === "") return;
        if (field.type === "date" && !isDateOnly(value)) {
          throw new Error(`La fecha «${field.label}» de un animal no es válida.`);
        }
        if (field.type === "boolean" && typeof value !== "boolean") {
          throw new Error(`El campo «${field.label}» debe ser sí/no.`);
        }
        if (["text", "textarea", "select", "list"].includes(field.type) &&
            (typeof value !== "string" || value.length > (field.type === "textarea" ? 2000 : 200))) {
          throw new Error(`El campo «${field.label}» de un animal no es válido.`);
        }
        if (field.type === "animal" &&
            (typeof value !== "string" || value === animal.id || !animalIds.has(value))) {
          throw new Error(`La referencia «${field.label}» debe apuntar a otro animal incluido en la copia.`);
        }
        if (field.type === "derived" &&
            (!value || typeof value !== "object" ||
              (!Number.isInteger(value.monthsAtRecord) && !Number.isFinite(value.daysAtRecord)) ||
              !isDateOnly(value.recordedAt))) {
          throw new Error("La edad aproximada de un animal no tiene un formato válido.");
        }
      });
    });
  }

  function newId() { return crypto.randomUUID(); }

  function listOptions(listId, currentValue = "") {
    const configured = state.fieldConfig?.lists?.[listId] || [];
    const options = configured.filter(option => option.enabled || option.value === currentValue);
    if (currentValue && !options.some(option => option.value === currentValue)) {
      options.push({ value: currentValue, label: currentValue, enabled: true });
    }
    return options;
  }

  function recentListValues(fieldId, currentValue = "", limit = 6) {
    const seen = new Set();
    const values = [];
    state.animals
      .filter(animal => typeof animal[fieldId] === "string" && animal[fieldId].trim())
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .forEach(animal => {
        const value = animal[fieldId].trim();
        if (seen.has(value)) return;
        seen.add(value);
        values.push(value);
      });
    if (currentValue && !seen.has(currentValue)) values.unshift(currentValue);
    return values.slice(0, limit);
  }

  function animalFormControl(field, animal, previewConfig = null) {
    const config = previewConfig || animalFieldConfig(field.id);
    const currentValue = animal?.[field.id] ?? "";
    const required = config.required ? "required" : "";
    const base = `data-animal-field="${field.id}" name="${field.id}"`;
    const selected = currentValue || "";
    if (field.type === "automatic") return "";
    if (field.type === "derived") {
      const parts = estimatedAgeInputParts(animal?.estimatedAge);
      return `<div class="animal-age-inputs"><label>${escapeHtml(config.label)} · años<input id="animal-age-years" data-animal-field="${field.id}" type="number" min="0" step="1" value="${parts.years}" placeholder="Años" ${required}></label>
        <label>Meses<input id="animal-age-months" data-animal-field="${field.id}" type="number" min="0" max="11" step="1" value="${parts.months}" placeholder="0–11" ${required}></label></div>`;
    }
    if (field.id === "tag") return `<div class="tag-capture"><input id="animal-tag" ${base} maxlength="80" value="${escapeHtml(selected)}" placeholder="Ej. 00125" ${required} autocomplete="off"><button class="button button-outline button-small" type="button" id="animal-tag-scan">Escanear</button></div>`;
    if (field.id === "name") return `<input id="animal-name" ${base} maxlength="100" value="${escapeHtml(selected)}" placeholder="Ej. Luna" ${required}>`;

    if (field.id === "sex") {
      const options = ["Hembra", "Macho"];
      return `<div class="chip-select" data-chip-select="sex"><select id="animal-sex" class="chip-select-native" ${base} ${required}>
        <option value="">No registrado</option>${options.map(value => `<option value="${value}" ${selected === value ? "selected" : ""}>${value}</option>`).join("")}
      </select>
      <div class="chip-options" role="group" aria-label="Sexo">${options.map(value =>
        `<button class="chip-option ${selected === value ? "selected" : ""}" type="button" data-chip-option="sex" data-chip-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("")}
      </div></div>`;
    }

    if (field.id === "status" || field.type === "list" || field.type === "select") {
      const options = field.list ? listOptions(field.list, selected) : (field.options || []).map(value => ({ value, label: value }));
      const selectId = field.id === "status" ? "animal-status" : `animal-field-${field.id}`;
      const withPlaceholder = field.id === "status"
        ? options
        : [{ value: "", label: "Sin registrar" }, ...options];
      const selectedValue = field.id === "status"
        ? (selected || options[0]?.value || "")
        : selected;
      const normalized = withPlaceholder.map(option => ({
        value: String(option.value ?? ""),
        label: option.label ?? option.value ?? "Sin registrar"
      }));

      if (["status", "breed", "lot", "paddock"].includes(field.id)) {
        const preferredValues = field.id === "status"
          ? normalized.filter(option => option.value).map(option => option.value)
          : recentListValues(field.id, selectedValue);
        const preferredOptions = preferredValues
          .map(value => normalized.find(option => option.value === value) || { value, label: value })
          .filter((option, index, array) => option.value && array.findIndex(item => item.value === option.value) === index)
          .slice(0, 6);
        const fallbackOptions = normalized.filter(option => option.value &&
          !preferredOptions.some(preferred => preferred.value === option.value)).slice(0, 3);
        const chips = [...preferredOptions, ...fallbackOptions]
          .filter((option, index, array) => array.findIndex(item => item.value === option.value) === index);
        return `<div class="chip-select" data-chip-select="${field.id}">
          <select id="${selectId}" class="chip-select-native" ${base} ${required}>${normalized.map(option =>
            `<option value="${escapeHtml(option.value)}" ${selectedValue === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>
          <div class="chip-options" role="group" aria-label="${escapeHtml(config.label)}">${chips.map(option =>
            `<button class="chip-option ${selectedValue === option.value ? "selected" : ""}" type="button" data-chip-option="${field.id}" data-chip-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`).join("")}
            ${["breed", "lot", "paddock"].includes(field.id)
    ? `<button class="chip-option add" type="button" data-chip-create="${field.id}">+ Nueva</button>`
    : ""}
          </div>
        </div>`;
      }

      return `<select id="${selectId}" ${base} ${required}>${normalized.map(option =>
        `<option value="${escapeHtml(option.value)}" ${selectedValue === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`
      ).join("")}</select>`;
    }

    if (field.type === "animal") {
      const candidates = state.animals.filter(item => item.id !== animal?.id);
      return `<select id="animal-field-${field.id}" ${base} ${required}><option value="">Sin registrar</option>${candidates.map(item =>
        `<option value="${escapeHtml(item.id)}" ${selected === item.id ? "selected" : ""}>${escapeHtml(item.name || item.tag || item.internalId || "Animal")}${item.tag ? ` · ${escapeHtml(item.tag)}` : ""}</option>`
      ).join("")}</select>`;
    }
    if (field.type === "boolean") {
      return `<select id="animal-field-${field.id}" ${base} ${required}><option value="">Sin registrar</option><option value="true" ${selected === true || selected === "true" ? "selected" : ""}>Sí</option><option value="false" ${selected === false || selected === "false" ? "selected" : ""}>No</option></select>`;
    }
    if (field.type === "textarea") {
      const placeholder = ["generalNotes", "exitNotes"].includes(field.id)
        ? "Usa el dictado del teclado para hablar"
        : "";
      return `<textarea id="animal-field-${field.id}" ${base} rows="3" maxlength="2000" placeholder="${placeholder}" ${required}>${escapeHtml(selected)}</textarea>`;
    }
    if (field.type === "date") {
      return `<input id="${field.id === "birthDate" ? "animal-birth" : `animal-field-${field.id}`}" ${base} type="date" inputmode="numeric" value="${escapeHtml(selected)}" ${required}>`;
    }
    return `<input id="${field.id === "color" ? "animal-color" : `animal-field-${field.id}`}" ${base} type="text" maxlength="200" value="${escapeHtml(selected)}" ${required}>`;
  }

  function renderAnimalFormFields(animal) {
    const formFields = ANIMAL_FIELD_CATALOG.filter(field => field.form && field.type !== "automatic" &&
      animalFieldActive(field.id) && animalFieldConfig(field.id).form);
    const makeLabel = field => `<label data-config-field="${field.id}" data-config-surface="form">
      <span data-config-label="${field.id}">${escapeHtml(animalFieldConfig(field.id).label)}</span>
      ${field.requiredAllowed ? `<span class="optional" data-config-required-label="${field.id}">${animalFieldConfig(field.id).required ? "Obligatorio" : "Opcional"}</span>` : ""}
      ${animalFormControl(field, animal)}
      <small class="field-error" hidden></small>
    </label>`;
    const basic = formFields.filter(field => animalFieldConfig(field.id).formLevel === "basic")
      .map(makeLabel).join("");
    const advanced = formFields.filter(field => animalFieldConfig(field.id).formLevel !== "basic")
      .map(makeLabel).join("");
    $("#animal-basic-fields").innerHTML = basic;
    $("#animal-advanced-fields").innerHTML = advanced;
    $("#animal-advanced-details").hidden = !advanced;
    applyAnimalFieldVisibility($("#animal-form"));
    updateConditionalAnimalFields();
  }

  function setAnimalFieldVisibility(fieldId, visible) {
    const form = $("#animal-form");
    const wrapper = $(`[data-config-field="${fieldId}"][data-config-surface="form"]`, form);
    if (!wrapper) return;
    const config = animalFieldConfig(fieldId);
    const allowed = visible && animalFieldActive(fieldId) && config.form;
    wrapper.hidden = !allowed;
    $$(`[data-animal-field="${fieldId}"]`, wrapper).forEach(control => {
      control.required = allowed && config.required;
    });
  }

  function updateConditionalAnimalFields() {
    const form = $("#animal-form");
    const statusValue = $("#animal-status")?.value || "Activo";
    const inactive = !isActiveAnimal({ status: statusValue });
    const originType = $('[data-animal-field="originType"]', form)?.value || "";
    const birthInput = $("#animal-birth");
    const hasBirthDate = Boolean(birthInput?.value);

    ["exitReason", "exitNotes"].forEach(fieldId => {
      setAnimalFieldVisibility(fieldId, inactive);
      if (fieldId === "exitReason") {
        const input = $(`[data-animal-field="${fieldId}"]`, form);
        if (input) {
          const config = animalFieldConfig(fieldId);
          input.required = inactive && animalFieldActive(fieldId) && config.form && config.required;
        }
      }
    });

    ["lot", "paddock", "pen", "locationSince", "responsible"].forEach(fieldId => {
      setAnimalFieldVisibility(fieldId, !inactive);
    });

    setAnimalFieldVisibility("originName", originType === "Compra" || !originType);
    setAnimalFieldVisibility("entryDate", originType === "Compra" || !originType);
    setAnimalFieldVisibility("motherId", originType === "Nacimiento propio" || !originType);
    setAnimalFieldVisibility("fatherId", originType === "Nacimiento propio" || !originType);

    const estimatedAgeWrapper = $(`[data-config-field="estimatedAge"][data-config-surface="form"]`, form);
    if (estimatedAgeWrapper) {
      estimatedAgeWrapper.hidden = hasBirthDate || !animalFieldActive("estimatedAge") ||
        !animalFieldConfig("estimatedAge").form;
    }

    const birthWrapper = $(`[data-config-field="birthDate"][data-config-surface="form"]`, form);
    if (birthWrapper) {
      let hint = $("#animal-birth-age-live", birthWrapper);
      if (!hint) {
        hint = document.createElement("small");
        hint.id = "animal-birth-age-live";
        hint.className = "field-help";
        hint.setAttribute("aria-live", "polite");
        birthWrapper.appendChild(hint);
      }
      if (hasBirthDate) {
        hint.textContent = `Edad calculada hoy: ${calculateAge(birthInput.value)}.`;
        hint.classList.remove("warning");
      } else {
        hint.textContent = "Si no conoces la fecha exacta, usa años y meses en edad aproximada.";
        hint.classList.add("warning");
      }
    }
  }

  function animalFieldDisplayValue(field, animal) {
    const value = animal[field.id];
    if (value === null || value === undefined || value === "") return "";
    if (field.id === "estimatedAge") {
      if (animal.birthDate) return `${calculateAge(animal.birthDate)}${isEstimatedBirthDate(animal) ? " (aproximada)" : ""}`;
      return formatEstimatedAge(value);
    }
    if (field.type === "boolean") return value ? "Sí" : "No";
    if (field.type === "date") return isDateOnly(value) ? formatDate(value) : "";
    if (field.type === "list" || field.type === "select") {
      return (state.fieldConfig?.lists?.[field.list] || []).find(option => option.value === value)?.label || value;
    }
    if (field.type === "animal") {
      const parent = state.animals.find(item => item.id === value);
      return parent ? `${parent.name || parent.tag || parent.internalId}${parent.tag ? ` · ${parent.tag}` : ""}` : "";
    }
    if (field.id === "createdAt" || field.id === "updatedAt") return formatTimestamp(value);
    return String(value);
  }

  function renderAnimalExtendedDetail(animal) {
    const excluded = new Set(["tag", "name", "sex", "color", "birthDate", "estimatedAge", "status", "updatedAt"]);
    return ANIMAL_FIELD_CATALOG.filter(field => !excluded.has(field.id) && field.detail)
      .map(field => {
        const value = animalFieldDisplayValue(field, animal);
        return `<div class="detail-fact" data-detail-field="${field.id}" data-detail-has-value="${Boolean(value)}">
          <span data-config-label="${field.id}">${escapeHtml(animalFieldConfig(field.id).label)}</span>
          <strong>${value ? escapeHtml(value) : "Sin registrar"}</strong>
        </div>`;
      }).join("");
  }

  function animalFormDraftKey() {
    return `ganadero:animal-draft:${state.ranchOwnerId || "local"}`;
  }

  function isAnimalFormMobile() {
    return window.matchMedia("(max-width: 780px)").matches;
  }

  function nextTagValue(tag) {
    if (!tag) return "";
    const match = String(tag).match(/(\d+)(?!.*\d)/);
    if (!match) return String(tag);
    const digits = match[1];
    let carry = 1;
    const incremented = [...digits].reverse().map(digit => {
      const value = Number(digit) + carry;
      carry = value > 9 ? 1 : 0;
      return String(value % 10);
    }).reverse().join("");
    const number = `${carry ? "1" : ""}${incremented}`.padStart(digits.length, "0");
    return String(tag).slice(0, match.index) + number + String(tag).slice(match.index + match[1].length);
  }

  function quickCaptureSeedFromAnimal(animal) {
    if (!animal) return null;
    const prefs = capturePreferences();
    let tag = prefs.nextTag ? nextTagValue(animal.tag || "") : "";
    for (let i=0; tag && state.animals.some(a=>String(a.tag).toLowerCase()===tag.toLowerCase()) && i<1000; i++) { const next=nextTagValue(tag); if(next===tag){tag="";break;} tag=next; }
    if(state.animals.some(a=>String(a.tag).toLowerCase()===tag.toLowerCase())) tag="";
    return { ...(prefs.reuse ? {breed:animal.breed || "",lot:animal.lot || "",paddock:animal.paddock || ""} : {}), ...(tag ? {tag} : {}), ...(prefs.today ? {entryDate:today()} : {}) };
  }

  function restoreAnimalFormErrors() {
    const summary = $("#animal-form-error-summary");
    summary.hidden = true;
    summary.textContent = "";
    $$(".field-error", $("#animal-form")).forEach(error => {
      error.hidden = true;
      error.textContent = "";
    });
    $$("#animal-form label.is-invalid").forEach(label => label.classList.remove("is-invalid"));
  }

  function saveAnimalDraft() {
    if (!capturePreferences().draft || state.animalFormMode !== "create" || !$("#animal-dialog")?.open) return;
    const form = $("#animal-form");
    const payload = {
      controls: {},
      updatedAt: new Date().toISOString()
    };
    [...form.elements]
      .filter(control => control.id && !["button", "submit", "file", "hidden"].includes(control.type))
      .forEach(control => {
        payload.controls[control.id] = control.value;
      });
    try {
      localStorage.setItem(animalFormDraftKey(), JSON.stringify(payload));
    } catch (error) {
      setAnimalFormError(`No se pudo guardar el borrador: ${error.message}`);
    }
  }

  function applyFormValuesById(values = {}, keepExisting = false) {
    Object.entries(values).forEach(([id, value]) => {
      const control = $(`#${id}`);
      if (!control || ["button", "submit", "file", "hidden"].includes(control.type)) return;
      if (keepExisting && control.value) return;
      control.value = value;
    });
  }

  function loadAnimalDraft() {
    if (!capturePreferences().draft || state.animalFormMode !== "create") return false;
    try {
      const payload = JSON.parse(localStorage.getItem(animalFormDraftKey()) || "null");
      if (!payload?.controls || typeof payload.controls !== "object") return false;
      applyFormValuesById(payload.controls, false);
      return true;
    } catch (error) {
      setAnimalFormError(`No se pudo recuperar el borrador: ${error.message}`);
      return false;
    }
  }

  function clearAnimalDraft() {
    try {
      localStorage.removeItem(animalFormDraftKey());
    } catch (error) {
      showToast(`No se pudo limpiar el borrador guardado: ${error.message}`);
    }
  }

  function resetAnimalStepBaseVisibility() {
    ["identification", "additional", "records"].forEach(stepId => {
      const element = $(`[data-animal-step="${stepId}"]`, $("#animal-form"));
      if (element) element.dataset.baseHidden = element.hidden ? "1" : "0";
    });
  }

  function animalStepSequence() {
    return [
      { id: "identification", label: "Identificación", element: $("[data-animal-step=\"identification\"]", $("#animal-form")) },
      { id: "additional", label: "Datos adicionales", element: $("[data-animal-step=\"additional\"]", $("#animal-form")) },
      { id: "records", label: "Registros iniciales", element: $("[data-animal-step=\"records\"]", $("#animal-form")) }
    ].filter(step => step.element && step.element.dataset.baseHidden !== "1");
  }

  function updateAnimalFormStepper() {
    const stepper = $("#animal-form-stepper");
    const actions = $("#animal-step-actions");
    const steps = animalStepSequence();
    if (!steps.length) {
      stepper.hidden = true;
      actions.hidden = true;
      return;
    }
    const mobile = isAnimalFormMobile();
    if (!mobile) {
      steps.forEach(step => {
        step.element.hidden = step.element.dataset.baseHidden === "1";
        if (step.element.matches("details")) {
          step.element.open = false;
          step.element.querySelector("summary").textContent = "Mostrar datos adicionales";
        }
      });
      stepper.hidden = true;
      actions.hidden = true;
      return;
    }
    state.animalFormStep = Math.max(0, Math.min(state.animalFormStep, steps.length - 1));
    steps.forEach((step, index) => {
      step.element.hidden = index !== state.animalFormStep;
      if (step.element.matches("details")) {
        step.element.open = index === state.animalFormStep;
        step.element.querySelector("summary").textContent = index === state.animalFormStep
          ? "Datos adicionales"
          : "Mostrar datos adicionales";
      }
    });
    stepper.hidden = false;
    actions.hidden = false;
    $("#animal-form-stepper-fill").style.width = `${((state.animalFormStep + 1) / steps.length) * 100}%`;
    $("#animal-form-stepper-label").textContent = `Paso ${state.animalFormStep + 1} de ${steps.length} · ${steps[state.animalFormStep].label}`;
    $("#animal-step-prev").disabled = state.animalFormStep === 0;
    $("#animal-step-next").textContent = state.animalFormStep === steps.length - 1 ? "Guardar" : "Siguiente";
  }

  function setAnimalFormStep(nextStep) {
    state.animalFormStep = nextStep;
    updateAnimalFormStepper();
  }

  function focusAnimalFormStep() {
    const steps = animalStepSequence();
    const current = steps[state.animalFormStep];
    setTimeout(() => current?.element.querySelector(
      'input:not([type="hidden"]), select, textarea, button'
    )?.focus(), 0);
  }

  function revealAnimalControl(control) {
    const section = control.closest("[data-animal-step]");
    const steps = animalStepSequence();
    const stepIndex = steps.findIndex(step => step.element === section);
    if (stepIndex >= 0 && isAnimalFormMobile()) setAnimalFormStep(stepIndex);
    if (section?.matches("details")) section.open = true;
    const visibleControl = control.closest(".chip-select")?.querySelector(".chip-option") || control;
    visibleControl.focus();
  }

  function setAnimalFormError(message, control = null) {
    const summary = $("#animal-form-error-summary");
    summary.textContent = message;
    summary.hidden = !message;
    if (control) {
      setFieldError(control, message);
      revealAnimalControl(control);
    }
  }

  function validateAnimalControls(controls) {
    const form = $("#animal-form");
    $$(".field-error", form).forEach(error => {
      error.hidden = true;
      error.textContent = "";
    });
    $$("#animal-form label.is-invalid").forEach(label => label.classList.remove("is-invalid"));
    const invalidControl = controls.find(control => control.willValidate && !control.checkValidity());
    if (!invalidControl) {
      $("#animal-form-error-summary").hidden = true;
      return true;
    }
    setAnimalFormError(validationMessageFor(invalidControl), invalidControl);
    return false;
  }

  function validateAnimalTag(input) {
    if (!input) return true;
    const tag = input.value.trim();
    const animalId = $("#animal-id").value;
    const duplicate = tag && state.animals.some(animal =>
      animal.id !== animalId && animal.tag?.toLocaleLowerCase() === tag.toLocaleLowerCase());
    if (duplicate) {
      setAnimalFormError("Ya existe un animal con este número de arete.", input);
      return false;
    }
    clearFieldError(input);
    if (!$("#animal-form").querySelector(".field-error:not([hidden])")) {
      $("#animal-form-error-summary").hidden = true;
      $("#animal-form-error-summary").textContent = "";
    }
    return true;
  }

  function clearAnimalFormError(control) {
    clearFieldError(control);
    if (!$("#animal-form").querySelector(".field-error:not([hidden])")) {
      $("#animal-form-error-summary").hidden = true;
      $("#animal-form-error-summary").textContent = "";
    }
  }

  function focusAnimalTag() {
    setTimeout(() => {
      const tag = $("#animal-tag");
      if (tag) tag.focus();
    }, 0);
  }

  async function startTagScanner() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      showToast("El escaneo requiere abrir Ganadero en una conexión segura y permitir el acceso a la cámara.");
      return;
    }
    if (typeof window.BarcodeDetector !== "function") {
      showToast("Este navegador no admite el escaneo de códigos. Captura el arete manualmente.");
      return;
    }
    if (typeof window.BarcodeDetector.getSupportedFormats !== "function") {
      showToast("Este navegador no informa los formatos de código disponibles. Captura el arete manualmente.");
      return;
    }
    let supported;
    try {
      supported = await window.BarcodeDetector.getSupportedFormats();
    } catch (error) {
      showToast(`No se pudo preparar el escáner: ${error.message}`);
      return;
    }
    const formats = ["code_128", "code_39", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code", "data_matrix", "pdf417", "aztec"]
      .filter(format => supported.includes(format));
    if (!formats.length) {
      showToast("Este navegador no reconoce formatos de código compatibles. Captura el arete manualmente.");
      return;
    }
    const dialog = $("#tag-scanner-dialog");
    const video = $("#tag-scanner-video");
    const status = $("#tag-scanner-status");
    dialog.showModal();
    status.textContent = "Solicitando acceso a la cámara…";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } }
      });
      if (!dialog.open) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      state.scannerStream = stream;
      video.srcObject = state.scannerStream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats });
      status.textContent = "Centra el código del arete dentro de la imagen.";
      const scan = async () => {
        if (!state.scannerStream || !dialog.open) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            const codes = await detector.detect(video);
            const value = codes.find(code => code.rawValue?.trim())?.rawValue?.trim();
            if (value) {
              const tag = $("#animal-tag");
              tag.value = value;
              tag.dispatchEvent(new Event("input", { bubbles: true }));
              dialog.close();
              focusAnimalTag();
              showToast("Arete escaneado.");
              return;
            }
          } catch (error) {
            stopTagScanner();
            if (dialog.open) dialog.close();
            showToast(`No se pudo leer el código: ${error.message}`);
            return;
          }
        }
        state.scannerFrame = requestAnimationFrame(scan);
      };
      state.scannerFrame = requestAnimationFrame(scan);
    } catch (error) {
      stopTagScanner();
      if (dialog.open) dialog.close();
      showToast(`No se pudo iniciar la cámara: ${error.message}`);
    }
  }

  function stopTagScanner() {
    if (state.scannerFrame !== null) cancelAnimationFrame(state.scannerFrame);
    state.scannerFrame = null;
    state.scannerStream?.getTracks().forEach(track => track.stop());
    state.scannerStream = null;
    const video = $("#tag-scanner-video");
    if (video) video.srcObject = null;
  }

  function openAnimalForm(animal = null, options = {}) {
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede crear o editar fichas de animales.");
      return;
    }
    const form = $("#animal-form");
    const isEdit = Boolean(animal);
    const prefill = options.prefill || null;
    form.reset();
    renderAnimalFormFields(animal);
    restoreAnimalFormErrors();
    $("#animal-undo-feedback").hidden = true;
    $("#animal-id").value = animal?.id || "";
    $("#animal-dialog-title").textContent = isEdit ? "Editar animal" : "Añadir animal";
    $("#animal-save").textContent = isEdit ? "Guardar cambios" : "Guardar animal";
    $("#animal-save-and-add").hidden = isEdit;
    $("#initial-records").hidden = isEdit;
    state.animalFormMode = isEdit ? "edit" : "create";
    state.animalFormStep = 0;
    state.animalFormWeightWarning = null;
    state.quickCaptureSeed = prefill || null;
    $("#animal-undo-last").hidden = !state.pendingUndo;

    const capture = capturePreferences();
    form.classList.toggle("capture-large", capture.large);
    if (!isEdit) {
      const defaults = {...capture.defaults};
      if(capture.today) defaults.entryDate = today();
      if(defaults.prefix && !prefill?.tag) {
        const tagControl = $('[data-animal-field="tag"]',form);
        if (tagControl) tagControl.placeholder = defaults.prefix + "001";
        if (capture.nextTag) {
          const prefix = String(defaults.prefix);
          const used = new Set(state.animals.map(a=>String(a.tag).toLowerCase()));
          for (let n=1;n<=10000;n++) { const candidate=prefix+String(n).padStart(3,"0"); if(!used.has(candidate.toLowerCase())) { defaults.tag=candidate; break; } }
        }
      }
      delete defaults.prefix;
      Object.entries(defaults).forEach(([id,value])=>{const control=$(`[data-animal-field="${id}"]`,form); if(control && value && (control.tagName!=="SELECT" || [...control.options].some(o=>o.value===value && !o.disabled))) control.value=value;});
    }
    if (prefill && !isEdit) {
      Object.entries(prefill).forEach(([fieldId, value]) => {
        const input = $(`[data-animal-field="${fieldId}"]`, form);
        if (input && (input.tagName !== "SELECT" || [...input.options].some(o=>o.value===value && !o.disabled))) input.value = value;
      });
    }

    if (!isEdit && !prefill) {
      const restored = loadAnimalDraft();
      if (restored) showToast("Se recuperó el borrador del formulario.");
    }

    applyAnimalFieldVisibility(form);
    updateConditionalAnimalFields();
    attachDateShortcuts(form);
    refreshChipSelections();
    renderInitialPhotosPreview();
    resetAnimalStepBaseVisibility();
    updateAnimalFormStepper();
    state.animalFormSnapshot = animalFormValues();
    $("#animal-dialog").showModal();
    focusAnimalTag();
    updateInitialWeightFeedback();
  }

  function animalFormValues() {
    return JSON.stringify([...$("#animal-form").elements]
      .filter(control => !["button", "submit"].includes(control.type))
      .map(control => control.type === "file" ? [...control.files].map(file => `${file.name}:${file.size}`) : control.value));
  }

  function requestClose(dialogId) {
    const hasAnimalChanges = dialogId === "animal-dialog" && animalFormValues() !== state.animalFormSnapshot;
    if (hasAnimalChanges && !confirm("Hay cambios sin guardar. ¿Salir sin guardarlos?")) return;
    if (hasAnimalChanges) saveAnimalDraft();
    $("#" + dialogId).close();
  }

  function validationMessageFor(control) {
    if (control.validity.valueMissing) return "Este campo es obligatorio.";
    if (control.validity.badInput || control.validity.typeMismatch) return "El formato capturado no es válido.";
    if (control.validity.rangeOverflow || control.validity.rangeUnderflow) return "El valor está fuera del rango permitido.";
    if (control.validity.stepMismatch) return "Revisa el valor capturado.";
    return control.validationMessage || "Revisa este campo.";
  }

  function setFieldError(control, message) {
    const label = control.closest("label") || control.closest("[data-config-field]");
    if (!label) return;
    label.classList.add("is-invalid");
    let error = $(".field-error", label);
    if (!error) {
      error = document.createElement("small");
      error.className = "field-error";
      label.appendChild(error);
    }
    error.hidden = false;
    error.textContent = message;
  }

  function clearFieldError(control) {
    const label = control.closest("label") || control.closest("[data-config-field]");
    if (!label) return;
    label.classList.remove("is-invalid");
    const error = $(".field-error", label);
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
  }

  function refreshChipSelections(fieldId = null) {
    const scope = $("#animal-form");
    const wrappers = fieldId
      ? $$(`[data-chip-select="${fieldId}"]`, scope)
      : $$("[data-chip-select]", scope);
    wrappers.forEach(wrapper => {
      const key = wrapper.dataset.chipSelect;
      const select = $(`[data-animal-field="${key}"]`, wrapper) || $(`[data-animal-field="${key}"]`, scope);
      if (!select) return;
      $$(`[data-chip-option="${key}"]`, wrapper).forEach(button => {
        const selected = button.dataset.chipValue === select.value;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    });
  }

  function setChipFieldValue(fieldId, value) {
    const form = $("#animal-form");
    const select = $(`[data-animal-field="${fieldId}"]`, form);
    if (!select) return;
    if (![...select.options].some(option => option.value === value)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("input", { bubbles: true }));
    refreshChipSelections(fieldId);
  }

  async function createAnimalListOption(fieldId) {
    const list = ANIMAL_LISTS.find(item => item.id === fieldId);
    if (!list || !["breed", "lot", "paddock"].includes(fieldId)) return;
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede añadir opciones a estas listas.");
      return;
    }
    const label = prompt(`Nombre de la nueva opción para ${list.label.toLocaleLowerCase("es-MX")}:`)?.trim();
    if (!label) return;
    const currentOptions = state.fieldConfig?.lists?.[fieldId] || [];
    const duplicate = currentOptions.find(option =>
      option.label.toLocaleLowerCase("es-MX") === label.toLocaleLowerCase("es-MX"));
    if (duplicate) {
      setChipFieldValue(fieldId, duplicate.value);
      return;
    }
    const option = { value: `${fieldId}-${newId()}`, label, enabled: true };
    const config = normalizeAnimalFieldConfig({
      ...state.fieldConfig,
      lists: { ...state.fieldConfig.lists, [fieldId]: [...currentOptions, option] }
    });
    try {
      const previous = await getOne("ranchSettings", "animal-fields");
      const record = {
        id: "animal-fields",
        ownerId: state.ranchOwnerId,
        config,
        revision: (previous?.revision || 0) + 1,
        baseRevision: previous?.baseRevision || 0,
        dirty: true,
        updatedAt: new Date().toISOString()
      };
      await put("ranchSettings", record);
      state.fieldConfigRecord = record;
      state.fieldConfig = config;
      const select = $(`[data-animal-field="${fieldId}"]`, $("#animal-form"));
      const nativeOption = document.createElement("option");
      nativeOption.value = option.value;
      nativeOption.textContent = option.label;
      select.append(nativeOption);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip-option";
      button.dataset.chipOption = fieldId;
      button.dataset.chipValue = option.value;
      button.textContent = option.label;
      const createButton = $(`[data-chip-create="${fieldId}"]`, $("#animal-form"));
      createButton.before(button);
      setChipFieldValue(fieldId, option.value);
      saveAnimalDraft();
      scheduleSync();
    } catch (error) {
      showToast(`No se pudo añadir la opción: ${error.message}`);
    }
  }

  function attachDateShortcuts(root = document) {
    $$('input[type="date"]', root).forEach(input => {
      if (!input.id || input.dataset.shortcutsReady === "1") return;
      const label = input.closest("label");
      if (!label) return;
      const row = document.createElement("div");
      row.className = "date-shortcuts";
      row.innerHTML = `<button type="button" data-date-shortcut="today" data-date-target="${input.id}">Hoy</button>
        <button type="button" data-date-shortcut="yesterday" data-date-target="${input.id}">Ayer</button>`;
      label.appendChild(row);
      input.dataset.shortcutsReady = "1";
    });
  }

  function monthsBetween(dateValue, compare = today()) {
    if (!isDateOnly(dateValue) || !isDateOnly(compare)) return null;
    const left = new Date(`${dateValue}T12:00:00`);
    const right = new Date(`${compare}T12:00:00`);
    if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime()) || left > right) return null;
    let months = (right.getFullYear() - left.getFullYear()) * 12 + right.getMonth() - left.getMonth();
    if (right.getDate() < left.getDate()) months -= 1;
    return Math.max(0, months);
  }

  function ageMonthsFromAnimalForm() {
    const birthDate = $("#animal-birth")?.value;
    const fromBirth = birthDate ? monthsBetween(birthDate) : null;
    if (fromBirth !== null) return fromBirth;
    const yearsValue = $("#animal-age-years")?.value.trim() || "";
    const monthsValue = $("#animal-age-months")?.value.trim() || "";
    if (!yearsValue && !monthsValue) return null;
    const years = yearsValue ? Number(yearsValue) : 0;
    const months = monthsValue ? Number(monthsValue) : 0;
    if (!Number.isFinite(years) || !Number.isFinite(months) || years < 0 || months < 0) return null;
    return Math.round(years * 12 + months);
  }

  function estimateWeightRangeForAge(ageMonths) {
    if (!Number.isFinite(ageMonths)) return null;
    const sample = state.animals
      .map(animal => {
        const months = animal.birthDate
          ? monthsBetween(animal.birthDate)
          : estimatedAgeMonths(animal.estimatedAge);
        const latest = eventFor(animal.id, "weight");
        const weight = Number(latest?.weight);
        if (!Number.isFinite(months) || !Number.isFinite(weight) || weight < 0) return null;
        return { months, weight };
      })
      .filter(Boolean)
      .filter(item => Math.abs(item.months - ageMonths) <= 3)
      .map(item => item.weight)
      .sort((a, b) => a - b);
    if (sample.length < 4) return null;
    const q1 = sample[Math.floor((sample.length - 1) * 0.25)];
    const q3 = sample[Math.floor((sample.length - 1) * 0.75)];
    return {
      min: Math.max(0, Number((q1 - 20).toFixed(1))),
      max: Number((q3 + 20).toFixed(1)),
      count: sample.length
    };
  }

  function updateInitialWeightFeedback() {
    const feedback = $("#initial-weight-feedback");
    const weightInput = $("#initial-weight");
    if (!feedback || !weightInput || state.animalFormMode !== "create") return;
    const weight = Number(weightInput.value);
    feedback.textContent = "";
    feedback.classList.remove("warning", "success");
    state.animalFormWeightWarning = null;
    if (!Number.isFinite(weight) || weight <= 0) return;
    const ageMonths = ageMonthsFromAnimalForm();
    const estimatedRange = Number.isFinite(ageMonths) ? estimateWeightRangeForAge(ageMonths) : null;
    if (!estimatedRange) {
      feedback.textContent = "Captura válida. No hay suficiente historial comparable para estimar un rango.";
      return;
    }
    if (weight < estimatedRange.min || weight > estimatedRange.max) {
      const ageLabel = ageMonths === 1 ? "1 mes" : `${ageMonths} meses`;
      const rangeLabel = `${estimatedRange.min}–${estimatedRange.max} kg`;
      const message = `${weight.toFixed(1)} kg para ~${ageLabel}. Rango reciente esperado: ${rangeLabel}.`;
      feedback.textContent = `${message} ¿Seguro que deseas guardarlo?`;
      feedback.classList.add("warning");
      state.animalFormWeightWarning = { message };
      return;
    }
    feedback.textContent = `Dentro del rango reciente (${estimatedRange.min}–${estimatedRange.max} kg).`;
    feedback.classList.add("success");
  }

  function updateRecordWeightFeedback() {
    const feedback = $("#record-weight-feedback");
    if (!feedback) return;
    const form = $("#record-form");
    const weight = Number($('[name="weight"]', form)?.value);
    const date = $('[name="date"]', form)?.value;
    const animalId = $("#record-animal-id").value;
    const animal = state.animals.find(item => item.id === animalId);
    const parts = [];
    feedback.classList.remove("warning", "success");
    state.recordFormWeightWarning = null;
    if (!Number.isFinite(weight) || weight <= 0) {
      feedback.textContent = "";
      return;
    }

    const history = weightHistory(animalId);
    const previous = history[history.length - 1];
    if (previous) {
      const difference = weight - previous.weight;
      const arrow = difference > 0 ? "↑" : difference < 0 ? "↓" : "→";
      parts.push(`${arrow} ${Math.abs(difference).toFixed(1)} kg frente a la pesada anterior (${previous.weight.toFixed(1)} kg, ${formatDate(previous.date)}).`);
      const elapsedDays = date && isDateOnly(date)
        ? (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86400000
        : 0;
      if (elapsedDays > 0) {
        parts.push(`GMD: ${(difference / elapsedDays).toFixed(2)} kg/día.`);
      } else if (elapsedDays < 0) {
        parts.push("La fecha es anterior a la última pesada; no se calcula GMD.");
      } else {
        parts.push("Usa una fecha posterior para calcular la GMD.");
      }
    } else {
      parts.push("Primera pesada registrada; la GMD aparecerá con la siguiente.");
    }

    const ageMonths = animal?.birthDate
      ? monthsBetween(animal.birthDate)
      : estimatedAgeMonths(animal?.estimatedAge);
    const estimatedRange = Number.isFinite(ageMonths) ? estimateWeightRangeForAge(ageMonths) : null;
    if (estimatedRange && (weight < estimatedRange.min || weight > estimatedRange.max)) {
      const ageLabel = ageMonths === 1 ? "1 mes" : `${ageMonths} meses`;
      const warning = `${weight.toFixed(1)} kg para ~${ageLabel}; el rango reciente comparable es ${estimatedRange.min}–${estimatedRange.max} kg.`;
      parts.push(`${warning} ¿Seguro?`);
      feedback.classList.add("warning");
      state.recordFormWeightWarning = warning;
    } else {
      feedback.classList.add("success");
    }
    feedback.textContent = parts.join(" ");
  }

  function updateJourneyWeightFeedback() {
    const feedback = $("#journey-weight-feedback");
    const input = $("#journey-weight-input");
    const journey = state.journeys.find(item => item.id === state.currentJourneyId);
    if (!feedback || !input || !journey) return;
    const weight = Number(input.value);
    const rosterAnimal = journey.roster.find(item => item.id === state.journeyWeightTargetId);
    const animal = state.animals.find(item => item.id === state.journeyWeightTargetId);
    const parts = [];
    feedback.classList.remove("warning", "success");
    state.journeyWeightWarning = null;
    if (!Number.isFinite(weight) || weight <= 0) {
      feedback.textContent = "";
      return;
    }

    const previousPoints = weightHistory(state.journeyWeightTargetId)
      .filter(point => point.date < journey.date);
    const previous = previousPoints[previousPoints.length - 1];
    if (previous) {
      const difference = weight - previous.weight;
      const arrow = difference > 0 ? "↑" : difference < 0 ? "↓" : "→";
      parts.push(`${arrow} ${Math.abs(difference).toFixed(1)} kg frente a la pesada anterior (${previous.weight.toFixed(1)} kg).`);
      const elapsedDays = (Date.parse(`${journey.date}T00:00:00Z`) -
        Date.parse(`${previous.date}T00:00:00Z`)) / 86400000;
      if (elapsedDays > 0) parts.push(`GMD: ${(difference / elapsedDays).toFixed(2)} kg/día.`);
    } else {
      parts.push(rosterAnimal?.attended ? "No hay una pesada anterior para comparar." : "Primera pesada registrada.");
    }

    const ageMonths = animal?.birthDate
      ? monthsBetween(animal.birthDate)
      : estimatedAgeMonths(animal?.estimatedAge);
    const estimatedRange = Number.isFinite(ageMonths) ? estimateWeightRangeForAge(ageMonths) : null;
    if (estimatedRange && (weight < estimatedRange.min || weight > estimatedRange.max)) {
      const warning = `${weight.toFixed(1)} kg para ~${ageMonths} meses; el rango reciente comparable es ${estimatedRange.min}–${estimatedRange.max} kg.`;
      parts.push(`${warning} ¿Seguro?`);
      feedback.classList.add("warning");
      state.journeyWeightWarning = warning;
    } else {
      feedback.classList.add("success");
    }
    feedback.textContent = parts.join(" ");
  }

  function renderInitialPhotosPreview() {
    const input = $("#initial-photos");
    const preview = $("#initial-photos-preview");
    if (!input || !preview) return;
    $$("img[data-object-url]", preview).forEach(image => URL.revokeObjectURL(image.dataset.objectUrl));
    const files = [...input.files];
    if (!files.length) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }
    preview.hidden = false;
    preview.innerHTML = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      return `<div class="photo-preview-item"><img src="${url}" data-object-url="${url}" alt="Vista previa ${escapeHtml(file.name)}"><button type="button" data-remove-initial-photo="${index}" aria-label="Quitar fotografía">×</button></div>`;
    }).join("");
  }

  function removeInitialPhoto(index) {
    const input = $("#initial-photos");
    if (!input || !Number.isInteger(index)) return;
    if (typeof DataTransfer === "undefined") {
      showToast("Este navegador no permite quitar una fotografía seleccionada hasta limpiar el campo completo.");
      return;
    }
    const files = [...input.files];
    const transfer = new DataTransfer();
    files.forEach((file, fileIndex) => {
      if (fileIndex !== index) transfer.items.add(file);
    });
    input.files = transfer.files;
    renderInitialPhotosPreview();
    saveAnimalDraft();
  }

  async function undoAnimalCreate(payload) {
    if (!payload?.animalId) return;
    await transaction(["animals", "events", "photos", "growthForecasts", "deletedAnimals"], "readwrite", tx => {
      tx.objectStore("animals").delete(payload.animalId);
      tx.objectStore("deletedAnimals").put({ id: payload.animalId, deletedAt: new Date().toISOString() });
      (payload.eventIds || []).forEach(id => tx.objectStore("events").delete(id));
      (payload.photoIds || []).forEach(id => tx.objectStore("photos").delete(id));
      const forecastStore = tx.objectStore("growthForecasts");
      const cursorRequest = forecastStore.index("animalId").openCursor(IDBKeyRange.only(payload.animalId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    });
    await refresh();
    scheduleSync();
  }

  async function undoMostRecentAnimalCreate(payload = state.pendingUndo) {
    if (!payload) return;
    await undoAnimalCreate(payload);
    state.toastAction = null;
    clearTimeout(state.toastTimer);
    $("#toast").classList.remove("show");
    if (state.pendingUndo?.animalId === payload.animalId) {
      state.pendingUndo = null;
      clearTimeout(state.undoTimer);
      state.undoTimer = null;
      $("#animal-undo-last").hidden = true;
    }
    showToast("Alta deshecha.");
    if ($("#animal-dialog").open) {
      $("#animal-undo-feedback").textContent = "Alta deshecha.";
      $("#animal-undo-feedback").hidden = false;
    }
  }

  function offerAnimalCreateUndo(payload, message) {
    state.pendingUndo = payload;
    $("#animal-undo-last").hidden = false;
    if ($("#animal-dialog").open) {
      $("#animal-undo-feedback").textContent = "Alta guardada. Puedes deshacer durante unos segundos.";
      $("#animal-undo-feedback").hidden = false;
    }
    clearTimeout(state.undoTimer);
    state.undoTimer = setTimeout(() => {
      state.pendingUndo = null;
      $("#animal-undo-last").hidden = true;
      $("#animal-undo-feedback").hidden = true;
      state.undoTimer = null;
    }, 6000);
    showToast(message, {
      label: "Deshacer",
      onClick: () => undoMostRecentAnimalCreate(payload)
    });
  }

  function makeEvent(animalId, type, date, fields = {}) {
    const performedAt = new Date().toISOString();
    return { id: newId(), animalId, type, date, createdAt: performedAt, performedAt, performedBy: journeyActor(), ...fields };
  }

  function nextInternalAnimalId() {
    const used = new Set(state.animals.map(animal => animal.internalId).filter(Boolean));
    let maximum = state.animals.reduce((value, animal) => {
      const match = typeof animal.internalId === "string" && animal.internalId.match(/^ANM-(\d{5,})$/);
      return match ? Math.max(value, Number(match[1])) : value;
    }, 0);
    let candidate;
    do {
      maximum += 1;
      candidate = `ANM-${String(maximum).padStart(5, "0")}`;
    } while (used.has(candidate));
    return candidate;
  }

  function animalFormFieldValue(field) {
    if (field.type === "derived") {
      const yearsControl = $("#animal-age-years");
      const monthsControl = $("#animal-age-months");
      if (!yearsControl || !monthsControl) return null;
      const yearsInput = yearsControl.value.trim();
      const monthsInput = monthsControl.value.trim();
      if (!yearsInput && !monthsInput) return null;
      const years = yearsInput ? Number(yearsInput) : 0;
      const months = monthsInput ? Number(monthsInput) : 0;
      if (!Number.isInteger(years) || years < 0 || !Number.isInteger(months) || months < 0 || months > 11) {
        throw new Error("La edad aproximada requiere años enteros y meses entre 0 y 11.");
      }
      return { monthsAtRecord: years * 12 + months, recordedAt: today() };
    }
    const input = $(`[data-animal-field="${field.id}"]`, $("#animal-form"));
    if (!input) return "";
    if (field.type === "boolean") return input.value === "" ? "" : input.value === "true";
    return input.value.trim();
  }

  async function saveAnimal(event) {
    event.preventDefault();
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede crear o editar fichas de animales.");
      return;
    }
    if (!validateAnimalControls([...$("#animal-form").elements])) return;
    const id = $("#animal-id").value || newId();
    const existing = state.animals.find(animal => animal.id === id);
    const tagInput = $("#animal-tag");
    const tag = tagInput?.value.trim() || "";
    if (!validateAnimalTag(tagInput)) return;
    const saveAndAdd = event.submitter?.dataset.submitMode === "save-and-add" && !existing;
    const birthDateField = ANIMAL_FIELD_CATALOG.find(field => field.id === "birthDate");
    const ageField = ANIMAL_FIELD_CATALOG.find(field => field.id === "estimatedAge");
    const birthDate = animalFormFieldValue(birthDateField);
    const birthDateEditable = animalFieldActive("birthDate") && animalFieldConfig("birthDate").form;
    let estimatedAge = null;
    try {
      estimatedAge = animalFormFieldValue(ageField);
    } catch (error) {
      setAnimalFormError(error.message, $("#animal-age-months"));
      return;
    }
    const todayDay = Date.parse(`${today()}T00:00:00Z`);
    const birthDay = birthDate ? Date.parse(`${birthDate}T00:00:00Z`) : NaN;
    if (birthDateEditable && birthDate && (!Number.isFinite(birthDay) || birthDay > todayDay)) {
      setAnimalFormError("La fecha de nacimiento no puede estar en el futuro.", $("#animal-birth"));
      return;
    }
    const ageEditable = animalFieldActive("estimatedAge") && animalFieldConfig("estimatedAge").form;
    if (birthDateEditable && ageEditable && birthDate && estimatedAge) {
      setAnimalFormError("Indica la fecha de nacimiento confirmada o una edad aproximada, no ambas.", $("#animal-birth"));
      return;
    }
    if (ageEditable && animalFieldConfig("estimatedAge").required && !birthDate && !estimatedAge) {
      setAnimalFormError("Indica la edad aproximada de este animal.", $("#animal-age-years"));
      return;
    }
    const selectedStatus = animalFieldActive("status") && animalFieldConfig("status").form
      ? animalFormFieldValue(ANIMAL_FIELD_CATALOG.find(field => field.id === "status"))
      : existing?.status || "Activo";
    const exitReasonConfig = animalFieldConfig("exitReason");
    if (!isActiveAnimal({ status: selectedStatus }) && animalFieldActive("exitReason") &&
        exitReasonConfig.form && exitReasonConfig.required && !animalFormFieldValue(ANIMAL_FIELD_CATALOG.find(field => field.id === "exitReason"))) {
      setAnimalFormError("Indica el motivo de baja para este animal.", $('[data-animal-field="exitReason"]', $("#animal-form")));
      return;
    }
    const originTypeForSave = animalFormFieldValue(ANIMAL_FIELD_CATALOG.find(field => field.id === "originType"));
    const values = {};
    for (const field of ANIMAL_FIELD_CATALOG) {
      if (field.type === "automatic" || !animalFieldActive(field.id) || !animalFieldConfig(field.id).form) continue;
      if (["exitReason", "exitNotes"].includes(field.id) && isActiveAnimal({ status: selectedStatus })) continue;
      if (["lot", "paddock", "pen", "locationSince", "responsible"].includes(field.id) &&
          !isActiveAnimal({ status: selectedStatus })) continue;
      if (["originName", "entryDate"].includes(field.id) &&
          !["", "Compra"].includes(originTypeForSave)) continue;
      if (["motherId", "fatherId"].includes(field.id) &&
          !["", "Nacimiento propio"].includes(originTypeForSave)) continue;
      const currentValue = animalFormFieldValue(field);
      values[field.id] = existing && field.id === "internalId" ? existing.internalId : currentValue;
    }
    for (const fieldId of ["motherId", "fatherId"]) {
      const parentId = values[fieldId];
      if (!parentId) continue;
      if (parentId === id || !state.animals.some(animal => animal.id === parentId)) {
        setAnimalFormError(
          `La referencia de ${animalFieldConfig(fieldId).label.toLocaleLowerCase("es-MX")} debe ser otro animal del mismo rancho.`,
          $(`[data-animal-field="${fieldId}"]`, $("#animal-form"))
        );
        return;
      }
    }
    const actor = journeyActor().label;
    const animal = {
      ...(existing || {}),
      ...values,
      id,
      internalId: existing?.internalId || nextInternalAnimalId(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      createdBy: existing?.createdBy || actor,
      updatedAt: nextModifiedAt(existing?.updatedAt),
      updatedBy: actor
    };
    if (animal.birthEstimated === undefined && typeof animal.birthDateEstimated === "boolean") {
      animal.birthEstimated = animal.birthDateEstimated;
    }
    delete animal.birthDateEstimated;
    if (birthDateEditable && ageEditable && !estimatedAge) delete animal.estimatedAge;
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
        setAnimalFormError("Solo se pueden añadir archivos de imagen.", $("#initial-photos"));
        return;
      }
      if (bathDate) events.push(makeEvent(id, "bath", bathDate));
      if (weight || weightDate) {
        if (!weight || !weightDate) {
          const missingControl = weight ? $("#initial-weight-date") : $("#initial-weight");
          setAnimalFormError("Para guardar un pesaje, indica tanto el peso como la fecha.", missingControl);
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
          primary: index === 0, cropX: 50, cropY: 50, createdAt: new Date().toISOString()
        });
      });
      if (state.animalFormWeightWarning &&
          !confirm(`${state.animalFormWeightWarning.message}\n\n¿Guardar de todas formas?`)) return;
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
      if (existing) {
        openDetail(id, true);
        showToast("Cambios guardados.");
      } else {
        clearAnimalDraft();
        const undoPayload = {
          animalId: id,
          eventIds: events.map(record => record.id),
          photoIds: photos.map(photo => photo.id)
        };
        if (saveAndAdd) {
          state.quickCaptureSeed = quickCaptureSeedFromAnimal(animal);
          openAnimalForm(null, { prefill: state.quickCaptureSeed });
          offerAnimalCreateUndo(undoPayload, "Animal añadido. Captura el siguiente.");
        } else {
          offerAnimalCreateUndo(undoPayload, "Animal añadido al inventario.");
        }
      }
    } catch (error) {
      showToast(`No se pudo guardar: ${error.message}`);
    }
  }

  function eventSummary(event) {
    if (!event) return "No registrado";
    if (event.type === "weight") return `${escapeHtml(event.weight)} kg`;
    return event.label ? escapeHtml(event.label) : "Registro guardado";
  }

  function openDetail(animalId, preserveView = false) {
    const animal = state.animals.find(item => item.id === animalId);
    if (!animal) return;
    if (!preserveView) {
      state.detailView = "summary";
      state.detailShowEmpty = false;
    }
    state.currentAnimalId = animalId;
    const latestWeight = eventFor(animalId, "weight");
    const latestBath = eventFor(animalId, "bath");
    const latestVaccine = eventFor(animalId, "vaccine");
    const latestDeworm = eventFor(animalId, "deworm");
    const growthPoints = weightHistory(animalId);
    const animalAge = animal.birthDate
      ? `${calculateAge(animal.birthDate)}${isEstimatedBirthDate(animal) ? " (aproximada)" : ""}`
      : formatEstimatedAge(animal.estimatedAge);
    const animalEvents = state.events.filter(record => record.animalId === animalId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const latestHealthRecord = animalEvents.find(record =>
      ["vaccine", "deworm", "injection", "medication", "review"].includes(record.type));
    const photos = state.photos.filter(photo => photo.animalId === animalId);
    const heroPhoto = photos.find(photo => photo.primary) || photos[0];
    const heroCrop = photoCrop(heroPhoto);
    const heroImage = heroPhoto
      ? `<img src="${photoUrl(heroPhoto)}" alt="Fotografía principal de ${escapeHtml(animal.name || animal.tag || "animal")}" data-view-photo="${escapeHtml(heroPhoto.id)}" style="object-position: ${heroCrop.x}% ${heroCrop.y}%;">`
      : `<div class="detail-hero-placeholder">${icon("inventory")}</div>`;
    const sexIcon = animal.sex === "Hembra" ? icon("female") : animal.sex === "Macho" ? icon("male") : "";
    const manager = canManageRanch();
    const worker = isRanchWorker();
    const gallery = photos.map(photo => `<div class="photo-tile">
      <img src="${photoUrl(photo)}" alt="Fotografía de ${escapeHtml(animal.name || animal.tag || "animal")}" data-view-photo="${escapeHtml(photo.id)}">
      ${manager ? `<button class="photo-star ${photo.primary ? "primary" : ""}" data-primary-photo="${escapeHtml(photo.id)}" type="button" aria-label="${photo.primary ? "Fotografía principal seleccionada" : `Elegir fotografía de ${escapeHtml(animal.name || animal.tag || "este animal")} como principal`}" aria-pressed="${photo.primary}" title="${photo.primary ? "Fotografía principal seleccionada" : "Elegir como fotografía principal"}">${icon("star")}</button>
      <button class="photo-remove" data-delete-photo="${escapeHtml(photo.id)}" type="button" aria-label="Eliminar fotografía de ${escapeHtml(animal.name || animal.tag || "este animal")}">${icon("trash")}</button>` : ""}
    </div>`).join("");
    const recordButtons = manager
      ? `<button class="button button-outline" type="button" data-add-record="weight">${icon("plus")} Pesaje</button>
          <button class="button button-outline" type="button" data-add-record="vaccine">${icon("plus")} Vacuna</button>
          <button class="button button-outline" type="button" data-add-record="deworm">${icon("plus")} Desparasitación</button>
          <button class="button button-outline" type="button" data-add-record="bath">${icon("plus")} Baño</button>`
      : worker
        ? `<button class="button button-outline" type="button" data-add-record="weight">${icon("plus")} Pesaje</button>
          <button class="button button-outline" type="button" data-add-record="vaccine">${icon("plus")} Vacuna</button>
          <button class="button button-outline" type="button" data-add-record="deworm">${icon("plus")} Desparasitación</button>
          <button class="button button-outline" type="button" data-add-record="bath">${icon("plus")} Baño</button>`
        : "";

    $("#detail-content").innerHTML = `
      <div class="detail-header">
        <div class="detail-top"><div><div class="eyebrow">FICHA DEL ANIMAL</div></div>
          <button class="icon-button" type="button" data-close="detail-dialog" aria-label="Cerrar">${icon("close")}</button>
        </div>
        <div class="detail-hero">${heroImage}<span class="detail-hero-status" data-detail-field="status" data-detail-has-value="true">${statusMarkup(animal.status, "status-display")}</span></div>
        ${heroPhoto && manager ? `<details class="detail-crop" data-detail-view="full" data-detail-has-value="true">
          <summary aria-label="Ajustar encuadre de la foto" title="Ajustar encuadre">${icon("edit")} Ajustar encuadre</summary>
          <div class="detail-crop-panel">
            <label>Horizontal <input type="range" min="0" max="100" value="${heroCrop.x}" data-photo-crop="x" data-photo-id="${escapeHtml(heroPhoto.id)}" aria-label="Posición horizontal de la foto"></label>
            <label>Vertical <input type="range" min="0" max="100" value="${heroCrop.y}" data-photo-crop="y" data-photo-id="${escapeHtml(heroPhoto.id)}" aria-label="Posición vertical de la foto"></label>
            <p class="detail-crop-help" aria-live="polite">Ajusta la posición de la foto en el marco.</p>
            <button class="detail-crop-reset" type="button" data-reset-photo-crop="${escapeHtml(heroPhoto.id)}">Centrar encuadre</button>
          </div>
        </details>` : ""}
        <div class="detail-identity">
          <span class="detail-tag-icon">${icon("tag")}</span>
          <div data-config-field="name" data-config-surface="detail" data-detail-field="name" data-detail-has-value="${Boolean(animal.name)}"><h2>${escapeHtml(animal.name || "Animal sin nombre")}</h2></div>
          <p class="detail-identity-tag" data-config-field="tag" data-config-surface="detail" data-detail-field="tag" data-detail-has-value="${Boolean(animal.tag)}"><span data-config-label="tag">${escapeHtml(animalFieldConfig("tag").label)}</span> ${display(animal.tag)}</p>
          <span class="detail-identity-sex" data-config-field="sex" data-config-surface="detail" data-detail-field="sex" data-detail-has-value="${Boolean(animal.sex)}">${sexIcon}${escapeHtml(animal.sex || "Sexo sin registrar")}</span>
        </div>
        <div class="detail-actions">
          ${manager ? `<button class="button button-outline" type="button" data-edit-animal="${escapeHtml(animal.id)}">${icon("edit")} Editar animal</button>` : ""}
          <button class="button button-outline" type="button" data-toggle-detail-view>Ficha completa</button>
          <label class="detail-empty-toggle" hidden><input type="checkbox" data-show-detail-empty> Mostrar campos vacíos</label>
          <div class="detail-record-actions" data-detail-view="full" data-detail-has-value="true">${recordButtons}</div>
        </div>
      </div>
      <div class="detail-body">
        <div id="detail-info-heading" class="detail-section-head detail-info-heading"><h3>${state.detailView === "summary" ? "Ficha resumida" : "Información general"}</h3></div>
        <div class="detail-basic">
          <div class="detail-fact" data-detail-field="color" data-detail-has-value="${Boolean(animal.color)}"><span data-config-label="color">Color</span><strong>${animal.color ? escapeHtml(animal.color) : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-view="full"><span>Última modificación</span><strong>${escapeHtml(formatTimestamp(animal.updatedAt))}</strong></div>
          <div class="detail-fact" data-detail-field="birthDate" data-detail-has-value="${Boolean(animal.birthDate)}"><span data-config-label="birthDate">${escapeHtml(animalFieldConfig("birthDate").label)}</span><strong>${animal.birthDate ? formatDate(animal.birthDate) : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-field="estimatedAge" data-detail-has-value="${Boolean(animalAge && animalAge !== "No registrado")}"><span data-config-label="estimatedAge">${escapeHtml(animalFieldConfig("estimatedAge").label)}</span><strong>${animalAge === "No registrado" ? "Sin registrar" : escapeHtml(animalAge)}</strong></div>
          <div class="detail-fact" data-detail-view="full" data-detail-has-value="${Boolean(latestBath)}"><span>Último baño</span><strong>${latestBath ? formatDate(latestBath.date) : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-view="both" data-detail-has-value="${Boolean(latestWeight)}"><span>Último pesaje</span><strong>${latestWeight ? formatDate(latestWeight.date) : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-view="both" data-detail-has-value="${Boolean(latestWeight)}"><span>Peso actual</span><strong>${latestWeight ? `${escapeHtml(latestWeight.weight)} kg` : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-view="summary" data-detail-has-value="${Boolean(latestHealthRecord)}"><span>Último registro sanitario</span><strong>${latestHealthRecord ? `${escapeHtml(EVENT_TYPES[latestHealthRecord.type] || "Registro")} · ${formatDate(latestHealthRecord.date)}` : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-view="full" data-detail-has-value="${Boolean(latestVaccine)}"><span>Última vacuna</span><strong>${latestVaccine ? formatDate(latestVaccine.date) : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-view="full" data-detail-has-value="${Boolean(latestVaccine)}"><span>Vacuna</span><strong>${latestVaccine ? eventSummary(latestVaccine) : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-view="full" data-detail-has-value="${Boolean(latestDeworm)}"><span>Última desparasitación</span><strong>${latestDeworm ? formatDate(latestDeworm.date) : "Sin registrar"}</strong></div>
          <div class="detail-fact" data-detail-view="full" data-detail-has-value="${Boolean(latestDeworm)}"><span>Producto</span><strong>${latestDeworm ? eventSummary(latestDeworm) : "Sin registrar"}</strong></div>
        </div>
        <section class="detail-section" data-detail-view="both" id="animal-extended-detail-section">
          <div class="detail-section-head"><h3>Datos adicionales</h3></div>
          <div class="detail-basic">${renderAnimalExtendedDetail(animal)}</div>
        </section>
        <div data-detail-view="full" data-detail-has-value="${growthPoints.length > 0}">${renderGrowthChart(animal, growthPoints)}</div>
        <section class="detail-section" data-detail-view="full" data-detail-has-value="${animalEvents.some(record => record.type !== "note")}">
          <div class="detail-section-head"><h3>Historial sanitario y de manejo</h3>${manager || worker ? `<button class="add-link" type="button" data-add-record="bath">${icon("plus")} Añadir registro</button>` : ""}</div>
          <div class="history-list">${renderHistory(animalEvents.filter(record => record.type !== "note"), manager)}</div>
        </section>
        <section class="detail-section" data-detail-view="full" data-detail-has-value="${animalEvents.some(record => record.type === "note")}">
          <div class="detail-section-head"><h3>Comentarios y observaciones</h3>${manager ? `<button class="add-link" type="button" data-add-record="note">${icon("plus")} Añadir observación</button>` : ""}</div>
          <div class="history-list">${renderHistory(animalEvents.filter(record => record.type === "note"), manager)}</div>
        </section>
        <section class="detail-section" data-detail-view="full" data-detail-has-value="${photos.length > 0}">
          <div class="detail-section-head"><h3>Galería de fotografías <span class="muted">(${photos.length})</span></h3></div>
          <div class="gallery">${gallery}${manager ? `<label class="photo-add" title="Añadir fotografías" aria-label="Añadir fotografías">${icon("photo")}<input id="photo-input" type="file" accept="image/*" multiple hidden></label>` : ""}</div>
        </section>
        <div class="detail-section animal-management" data-detail-view="full" data-detail-has-value="true">
          ${manager && !isActiveAnimal(animal) ? `<button class="button button-outline button-small" type="button" data-reactivate-animal="${escapeHtml(animal.id)}">${icon("active")} Reactivar animal</button>` : ""}
          ${manager && animal.status !== "Baja" ? `<button class="add-link" type="button" data-deactivate-animal="${escapeHtml(animal.id)}">Dar de baja</button>` : ""}
            ${manager ? `<button class="danger-link" type="button" data-delete-animal="${escapeHtml(animal.id)}">${icon("trash")} Eliminar definitivamente a ${escapeHtml(animal.name || animal.tag || "este animal")}</button>` : ""}
        </div>
      </div>`;
    applyAnimalFieldVisibility($("#detail-content"));
    applyDetailPresentation();
    if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
    const detailPhotoImage = $(".detail-hero img");
    if (detailPhotoImage?.complete) updatePhotoCropControls();
    else detailPhotoImage?.addEventListener("load", updatePhotoCropControls, { once: true });
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
      const recordName = record.type === "weight" ? "pesaje" : EVENT_TYPES[record.type] || "registro";
      return `<div class="history-item"><div class="history-date">${formatDate(record.date)}</div><div class="history-description">${value}${record.type === "weight" && record.notes ? ` · ${escapeHtml(record.notes)}` : ""}${journeyLink}${performedBy}${correctedBy}</div>${allowDelete ? `<button class="history-delete" data-delete-event="${escapeHtml(record.id)}" type="button" aria-label="Eliminar ${escapeHtml(recordName)} del historial" title="Eliminar ${escapeHtml(recordName)} del historial">${icon("trash")}</button>` : ""}</div>`;
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
      fields.innerHTML = `<label>Fecha<input id="record-date" name="date" type="date" value="${today()}" required></label><label>Peso (kg)<div class="weight-capture"><input name="weight" type="number" min="0" step="0.1" placeholder="Ej. 420" inputmode="decimal" required><div class="weight-capture-controls" role="group" aria-label="Ajustar peso"><button type="button" data-adjust-weight="record-weight" data-weight-delta="-1">−1</button><button type="button" data-adjust-weight="record-weight" data-weight-delta="1">+1</button><button type="button" data-adjust-weight="record-weight" data-weight-delta="5">+5</button></div></div><small id="record-weight-feedback" class="field-help" aria-live="polite"></small></label><label class="full-width">Observaciones<textarea name="notes" rows="2" maxlength="1000" placeholder="Opcional · Usa el dictado del teclado para hablar"></textarea></label>`;
    } else if (type === "note") {
      fields.innerHTML = `<label>Fecha<input id="record-date" name="date" type="date" value="${today()}" required></label><label class="full-width">Observación<textarea name="notes" rows="4" maxlength="2000" placeholder="Escribe o dicta una observación..." required></textarea></label>`;
    } else {
      const label = type === "vaccine" ? "Vacuna" : type === "deworm" ? "Producto utilizado" : "Tipo / producto";
      fields.innerHTML = `<label>Fecha<input id="record-date" name="date" type="date" value="${today()}" required></label>${type === "bath" ? "" : `<label>${label}<input name="label" maxlength="120" placeholder="Opcional"></label>`}<label class="full-width">Observaciones<textarea name="notes" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label>`;
    }
    attachDateShortcuts(fields);
    $("#record-dialog").showModal();
    updateRecordWeightFeedback();
  }

  async function saveRecord(event) {
    event.preventDefault();
    const invalidControl = [...event.currentTarget.elements].find(control =>
      control.willValidate && !control.checkValidity());
    if (invalidControl) {
      setFieldError(invalidControl, validationMessageFor(invalidControl));
      invalidControl.focus();
      return;
    }
    const formData = new FormData(event.currentTarget);
    const type = $("#record-type").value;
    if (!hasRanchAccess() || (isRanchWorker() && !["weight", "bath", "vaccine", "deworm", "injection", "medication", "review"].includes(type))) {
      showToast("Tu perfil no tiene permiso para registrar este tipo de información.");
      return;
    }
    const date = String(formData.get("date") || "");
    const fields = {};
    if (type === "weight") fields.weight = Number(formData.get("weight"));
    if (type === "weight" && state.recordFormWeightWarning &&
        !confirm(`${state.recordFormWeightWarning}\n\n¿Guardar de todas formas?`)) return;
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
      openDetail(state.currentAnimalId, true);
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
    const updated = { ...animal, updatedAt: nextModifiedAt(animal.updatedAt), updatedBy: journeyActor().label };
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
      openDetail(animal.id, true);
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
          primary: existing.length === 0 && index === 0, cropX: 50, cropY: 50, createdAt: new Date().toISOString()
        }));
      });
      await touchAnimal(animalId);
      await refresh();
      openDetail(animalId, true);
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
      openDetail(photo.animalId, true);
    } catch (error) {
      showToast(`No se pudo actualizar la fotografía principal: ${error.message}`);
    }
  }

  async function savePhotoCrop(photoId, x, y) {
    if (!canManageRanch()) return;
    const photo = state.photos.find(item => item.id === photoId);
    if (!photo) return;
    try {
      await put("photos", { ...photo, cropX: x, cropY: y });
      await touchAnimal(photo.animalId);
      await refresh();
      openDetail(photo.animalId, true);
      const controls = $$(".detail-crop");
      controls.forEach(control => { control.open = true; });
    } catch (error) {
      showToast(`No se pudo guardar el encuadre: ${error.message}`);
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
      openDetail(photo.animalId, true);
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
      openDetail(state.currentAnimalId, true);
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
      await put("animals", { ...animal, status: "Baja", updatedAt: nextModifiedAt(animal.updatedAt), updatedBy: journeyActor().label });
      scheduleSync();
      $("#detail-dialog").close();
      await refresh();
      showToast("Animal dado de baja; su historial se conservó.");
    } catch (error) {
      showToast(`No se pudo actualizar el animal: ${error.message}`);
    }
  }

  async function reactivateAnimal(animalId) {
    if (!canManageRanch()) {
      showToast("Solo el propietario o administrador puede reactivar animales.");
      return;
    }
    const animal = state.animals.find(item => item.id === animalId);
    if (!animal || isActiveAnimal(animal)) return;
    if (!confirm(`¿Reactivar a ${animal.name || animal.tag || "este animal"}? Volverá al inventario activo y podrá incluirse en jornadas nuevas.`)) return;
    try {
      await put("animals", { ...animal, status: "Activo", updatedAt: nextModifiedAt(animal.updatedAt), updatedBy: journeyActor().label });
      scheduleSync();
      $("#detail-dialog").close();
      state.archiveView = false;
      $("#search-input").value = "";
      await refresh();
      showToast("Animal reactivado y devuelto al inventario activo.");
    } catch (error) {
      showToast(`No se pudo reactivar el animal: ${error.message}`);
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
        await put("animals", { ...animal, status: "Baja", updatedAt: nextModifiedAt(animal.updatedAt), updatedBy: journeyActor().label });
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
        forecasts: state.forecasts, animalSettings: state.fieldConfig,
        photos: [], deletedAnimals: await getAll("deletedAnimals")
      };
      payload.photos = await Promise.all(state.photos.map(async photo => ({
        id: photo.id, animalId: photo.animalId, name: photo.name, mime: photo.mime,
        primary: photo.primary, cropX: photoCrop(photo).x, cropY: photoCrop(photo).y,
        createdAt: photo.createdAt, data: await blobToDataUrl(photo.blob)
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
      if (payload.animalSettings !== undefined && !isValidAnimalFieldConfig(payload.animalSettings)) {
        throw new Error("La copia contiene una configuración de campos inválida.");
      }
      if (!confirm("Importar esta copia reemplazará todos los datos guardados actualmente en este dispositivo. ¿Continuar?")) return;
      if (payload.animalSettings && !canManageRanch()) {
        throw new Error("Solo el propietario o administrador puede restaurar la configuración del rancho.");
      }
      const previousAnimals = await getAll("animals");
      const animals = payload.animals.map(animal => ({ ...animal, updatedAt: nextModifiedAt(animal.updatedAt) }));
      validateAnimalBackupRecords(animals);
      await ensureAnimalInternalIds(animals, false);
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
        return {
          id: item.id, animalId: item.animalId, name: item.name, mime: item.mime,
          primary: Boolean(item.primary), cropX: photoCrop(item).x, cropY: photoCrop(item).y,
          createdAt: item.createdAt, blob
        };
      }));
      const restoredConfig = payload.animalSettings
        ? normalizeAnimalFieldConfig(payload.animalSettings)
        : null;
      if (events.some(record => !animalIds.has(record.animalId))) throw new Error("La copia contiene registros asociados a animales inexistentes.");
      const deletionMap = new Map(backedUpDeletions.map(item => [item.id, item]));
      previousAnimals.filter(animal => !animalIds.has(animal.id)).forEach(animal => {
        deletionMap.set(animal.id, { id: animal.id, deletedAt: nextModifiedAt(animal.updatedAt) });
      });
      for (const url of state.photoUrls.values()) URL.revokeObjectURL(url);
      state.photoUrls.clear();
      const existingSettings = await getOne("ranchSettings", "animal-fields");
      await transaction(["animals", "events", "photos", "growthForecasts", "deletedAnimals", "journeys", "ranchSettings"], "readwrite", tx => {
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
        if (restoredConfig) tx.objectStore("ranchSettings").put({
          id: "animal-fields",
          ownerId: state.ranchOwnerId,
          config: restoredConfig,
          revision: (existingSettings?.revision || 0) + 1,
          baseRevision: existingSettings?.baseRevision || 0,
          dirty: true,
          updatedAt: new Date().toISOString()
        });
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
    registerAnalysis();
    registerSettingsWorkspace();
    $("#add-animal-button").addEventListener("click", () => openAnimalForm());
    $("#empty-add-button").addEventListener("click", () => openAnimalForm());
    $("#animal-form").addEventListener("submit", saveAnimal);
    $("#animal-form").addEventListener("input", event => {
      const input = event.target;
      clearAnimalFormError(input);
      if (input.id === "animal-birth" || input.id === "animal-status" ||
          input.dataset.animalField === "originType") updateConditionalAnimalFields();
      if (["initial-weight", "animal-birth", "animal-age-years", "animal-age-months"].includes(input.id)) {
        updateInitialWeightFeedback();
      }
      saveAnimalDraft();
    });
    $("#animal-form").addEventListener("change", event => {
      const input = event.target;
      if (input.id === "animal-status" || input.dataset.animalField === "originType" || input.id === "animal-birth") {
        updateConditionalAnimalFields();
      }
      if (input.matches("[data-animal-field]")) refreshChipSelections(input.dataset.animalField);
      if (input.id === "initial-photos") renderInitialPhotosPreview();
      if (["initial-weight", "animal-birth", "animal-age-years", "animal-age-months"].includes(input.id)) {
        updateInitialWeightFeedback();
      }
      saveAnimalDraft();
    });
    $("#animal-form").addEventListener("focusout", event => {
      if (event.target.id === "animal-tag") validateAnimalTag(event.target);
    });
    $("#animal-form").addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.target.tagName !== "INPUT" ||
          ["button", "submit", "file", "hidden"].includes(event.target.type)) return;
      event.preventDefault();
      const steps = animalStepSequence();
      const current = steps[state.animalFormStep];
      if (!current) return;
      const validationControls = [...current.element.querySelectorAll("input, select, textarea")]
        .filter(control => !control.disabled && control.type !== "hidden" && control.offsetParent !== null);
      if (!validateAnimalControls(validationControls)) return;
      const keyboardControls = [...current.element.querySelectorAll("input, select, textarea, button.chip-option")]
        .filter(control => !control.disabled && control.type !== "hidden" && control.offsetParent !== null &&
          !control.matches(".chip-select-native"));
      const controlIndex = keyboardControls.indexOf(event.target);
      if (controlIndex >= 0 && keyboardControls[controlIndex + 1]) {
        keyboardControls[controlIndex + 1].focus();
      } else if (state.animalFormStep < steps.length - 1) {
        setAnimalFormStep(state.animalFormStep + 1);
        focusAnimalFormStep();
      } else {
        $("#animal-form").requestSubmit($("#animal-save"));
      }
    });
    $("#record-form").addEventListener("input", event => {
      clearFieldError(event.target);
      updateRecordWeightFeedback();
    });
    $("#record-form").addEventListener("change", event => {
      clearFieldError(event.target);
      updateRecordWeightFeedback();
    });
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
    $("#settings-nav").addEventListener("click", () => setMainView("settings"));
    $("#save-animal-settings").addEventListener("click", saveAnimalFieldSettings);
    $("#reset-animal-settings").addEventListener("click", resetAnimalFieldSettings);
    $("#calculator-form").addEventListener("submit", event => event.preventDefault());
    $("#calculator-gain").addEventListener("input", () => { state.calculatorMeasuredGain = null; });
    $("#calculator-form").addEventListener("input", updateCalculator);
    $("#calculator-animal").addEventListener("change", loadCalculatorAnimal);
    $("#calculator-save-forecast").addEventListener("click", saveCalculatorForecast);
    $("#new-journey-button").addEventListener("click", openJourneyCreateForm);
    $("#archive-toggle").addEventListener("click", () => {
      state.archiveView = !state.archiveView;
      $("#search-input").value = "";
      renderDashboard();
    });
    $("#search-input").addEventListener("input", renderDashboard);
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
    $("#account-manage-button").addEventListener("click", () => {
      if (!currentUser) return;
      $("#account-current-email").textContent = currentUser.email || "Sin correo";
      $("#change-email").value = "";
      $("#change-password").value = "";
      $("#change-password-confirm").value = "";
      $("#change-email-nonce").value = "";
      $("#change-password-nonce").value = "";
      $("#change-email-nonce-label").hidden = true;
      $("#change-password-nonce-label").hidden = true;
      $("#change-email-nonce").required = false;
      $("#change-password-nonce").required = false;
      $("#change-email-submit").textContent = "Enviar código de verificación";
      $("#change-password-submit").textContent = "Enviar código de verificación";
      $("#change-email-form").dataset.reauthSent = "false";
      $("#change-password-form").dataset.reauthSent = "false";
      $("#account-management-dialog").showModal();
      renderAccountIdentities().catch(error => showToast(`No se pudieron consultar los métodos vinculados: ${authErrorMessage(error)}`));
    });
    $("#ranch-button").addEventListener("click", () => {
      renderRanchDialog();
      $("#ranch-dialog").showModal();
    });
    $$("[data-google-login], [data-facebook-login]").forEach(button => button.addEventListener("click", async () => {
      const provider = button.hasAttribute("data-facebook-login") ? "facebook" : "google";
      const view = button.closest("form")?.id === "sign-up-form" ? "register" : "login";
      const redirectTo = authRedirectUrl();
      if (!cloud || !redirectTo || !navigator.onLine) {
        showAccountView(view, "Necesitas una conexión a Internet y una configuración válida de Supabase para continuar.");
        return;
      }
      const buttons = $$("[data-google-login], [data-facebook-login]");
      buttons.forEach(item => { item.disabled = true; });
      try {
        const { error } = await cloud.auth.signInWithOAuth({
          provider,
          options: provider === "google" ? { redirectTo, queryParams: { prompt: "select_account" } } : { redirectTo, scopes: "email,public_profile" }
        });
        if (error) throw error;
      } catch (error) {
        showAccountView(view, authErrorMessage(error));
      } finally {
        buttons.forEach(item => { item.disabled = false; });
      }
    }));
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
    $("#magic-link-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (!cloud) {
        showAccountView("magic-link", "La conexión con Supabase aún no está configurada. Consulta el README para activarla.");
        return;
      }
      try {
        const { error } = await cloud.auth.signInWithOtp({
          email: $("#magic-link-email").value.trim(),
          options: { shouldCreateUser: false, emailRedirectTo: authRedirectUrl() }
        });
        if (error) {
          showAccountView("magic-link", authErrorMessage(error));
        } else {
          showAccountView("message", "Si existe una cuenta con ese correo, recibirás un enlace para iniciar sesión.", true);
        }
      } catch (error) {
        showAccountView("magic-link", authErrorMessage(error));
      }
    });
    $("#resend-confirmation-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (!cloud) {
        showAccountView("resend-confirmation", "La conexión con Supabase aún no está configurada. Consulta el README para activarla.");
        return;
      }
      try {
        const { error } = await cloud.auth.resend({
          type: "signup",
          email: $("#confirmation-email").value.trim(),
          options: { emailRedirectTo: signupConfirmationUrl() }
        });
        if (error) {
          showAccountView("resend-confirmation", authErrorMessage(error));
        } else {
          showAccountView("message", "Si la cuenta necesita confirmación, recibirás un nuevo enlace por correo.", true);
        }
      } catch (error) {
        showAccountView("resend-confirmation", authErrorMessage(error));
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
          options: { emailRedirectTo: signupConfirmationUrl() }
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
    $("#change-email-form").addEventListener("submit", async event => {
      event.preventDefault();
      if (!cloud || !currentUser) {
        showToast("Inicia sesión para cambiar el correo de tu cuenta.");
        return;
      }
      try {
        const form = $("#change-email-form");
        if (form.dataset.reauthSent !== "true") {
          const { error } = await cloud.auth.reauthenticate();
          if (error) {
            showToast(`No se pudo enviar el código de verificación: ${authErrorMessage(error)}`);
          } else {
            form.dataset.reauthSent = "true";
            $("#change-email-nonce-label").hidden = false;
            $("#change-email-nonce").required = true;
            $("#change-email-submit").textContent = "Confirmar y cambiar correo";
            showToast("Código enviado al correo actual. Escríbelo para confirmar el cambio.");
          }
          return;
        }
        const { error } = await cloud.auth.updateUser(
          { email: $("#change-email").value.trim(), nonce: $("#change-email-nonce").value.trim() },
          { emailRedirectTo: authRedirectUrl() }
        );
        if (error) {
          showToast(`No se pudo solicitar el cambio de correo: ${authErrorMessage(error)}`);
        } else {
          $("#change-email").value = "";
          $("#change-email-nonce").value = "";
          $("#change-email-nonce-label").hidden = true;
          $("#change-email-nonce").required = false;
          form.dataset.reauthSent = "false";
          $("#change-email-submit").textContent = "Enviar código de verificación";
          showToast("Cambio solicitado. Sigue el enlace de confirmación que Supabase envíe a tu correo.");
        }
      } catch (error) {
        showToast(`No se pudo solicitar el cambio de correo: ${authErrorMessage(error)}`);
      }
    });
    $("#change-password-form").addEventListener("submit", async event => {
      event.preventDefault();
      const password = $("#change-password").value;
      if (password !== $("#change-password-confirm").value) {
        showToast("Las contraseñas no coinciden.");
        return;
      }
      if (!cloud || !currentUser) {
        showToast("Inicia sesión para cambiar la contraseña de tu cuenta.");
        return;
      }
      try {
        const form = $("#change-password-form");
        if (form.dataset.reauthSent !== "true") {
          const { error } = await cloud.auth.reauthenticate();
          if (error) {
            showToast(`No se pudo enviar el código de verificación: ${authErrorMessage(error)}`);
          } else {
            form.dataset.reauthSent = "true";
            $("#change-password-nonce-label").hidden = false;
            $("#change-password-nonce").required = true;
            $("#change-password-submit").textContent = "Confirmar y cambiar contraseña";
            showToast("Código enviado al correo de la cuenta. Escríbelo para confirmar el cambio.");
          }
          return;
        }
        const { error } = await cloud.auth.updateUser({
          password,
          nonce: $("#change-password-nonce").value.trim()
        });
        if (error) {
          showToast(`No se pudo cambiar la contraseña: ${authErrorMessage(error)}`);
        } else {
          $("#change-password").value = "";
          $("#change-password-confirm").value = "";
          $("#change-password-nonce").value = "";
          $("#change-password-nonce-label").hidden = true;
          $("#change-password-nonce").required = false;
          form.dataset.reauthSent = "false";
          $("#change-password-submit").textContent = "Enviar código de verificación";
          showToast("La contraseña se cambió correctamente.");
        }
      } catch (error) {
        showToast(`No se pudo cambiar la contraseña: ${authErrorMessage(error)}`);
      }
    });
    $("#link-provider-button").addEventListener("click", async () => {
      if (!cloud || !currentUser) {
        showToast("Inicia sesión para vincular un método de acceso.");
        return;
      }
      try {
        const { error } = await cloud.auth.linkIdentity({
          provider: $("#link-provider").value,
          options: { redirectTo: authRedirectUrl() }
        });
        if (error) showToast(`No se pudo iniciar la vinculación: ${authErrorMessage(error)}`);
      } catch (error) {
        showToast(`No se pudo iniciar la vinculación: ${authErrorMessage(error)}`);
      }
    });
    $("#sign-out-button").addEventListener("click", async () => {
      const { error } = await cloud.auth.signOut();
      if (error) showToast(`No se pudo cerrar la sesión: ${error.message}`);
    });
    window.addEventListener("resize", () => {
      updatePhotoCropControls();
      if ($("#animal-dialog").open) updateAnimalFormStepper();
    });
    $("#restore-button").addEventListener("click", () => $("#restore-input").click());
    $("#restore-input").addEventListener("change", event => restore(event.target.files[0]));
    document.addEventListener("click", event => {
      const target = event.target.closest("button, img, label");
      if (!target) return;
      if (target.dataset.close) { requestClose(target.dataset.close); return; }
      if (target.dataset.toastAction === "undo" && state.toastAction) {
        const action = state.toastAction;
        state.toastAction = null;
        clearTimeout(state.toastTimer);
        $("#toast").classList.remove("show");
        Promise.resolve(action.onClick()).catch(error =>
          showToast(`No se pudo deshacer el alta: ${error.message}`)
        );
        return;
      }
      if (target.id === "animal-undo-last" && state.pendingUndo) {
        undoMostRecentAnimalCreate().catch(error =>
          showToast(`No se pudo deshacer el alta: ${error.message}`)
        );
        return;
      }
      if (target.id === "animal-tag-scan") { startTagScanner(); return; }
      if (target.dataset.chipOption) {
        setChipFieldValue(target.dataset.chipOption, target.dataset.chipValue);
        return;
      }
      if (target.dataset.chipCreate) {
        createAnimalListOption(target.dataset.chipCreate);
        return;
      }
      if (target.dataset.adjustWeight) {
        const input = target.dataset.adjustWeight === "record-weight"
          ? $('[name="weight"]', $("#record-form"))
          : $(`#${target.dataset.adjustWeight}`);
        if (input) {
          const current = Number(input.value) || 0;
          const delta = Number(target.dataset.weightDelta);
          input.value = Math.max(0, current + delta).toFixed(1);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      if (target.dataset.removeInitialPhoto !== undefined) {
        removeInitialPhoto(Number(target.dataset.removeInitialPhoto));
        return;
      }
      if (target.dataset.dateShortcut) {
        const input = $(`#${target.dataset.dateTarget}`);
        if (input) {
          const selectedDate = new Date(`${today()}T12:00:00`);
          if (target.dataset.dateShortcut === "yesterday") selectedDate.setDate(selectedDate.getDate() - 1);
          input.value = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      if (target.id === "animal-step-next") {
        const steps = animalStepSequence();
        const current = steps[state.animalFormStep];
        if (!current) return;
        const controls = [...current.element.querySelectorAll("input, select, textarea")]
          .filter(control => !control.disabled && control.type !== "hidden" && control.offsetParent !== null);
        if (!validateAnimalControls(controls)) return;
        if (state.animalFormStep < steps.length - 1) {
          setAnimalFormStep(state.animalFormStep + 1);
          focusAnimalFormStep();
        }
        else $("#animal-form").requestSubmit($("#animal-save"));
        return;
      }
      if (target.id === "animal-step-prev") {
        setAnimalFormStep(Math.max(0, state.animalFormStep - 1));
        focusAnimalFormStep();
        return;
      }
      if (target.dataset.accountView) {
        const view = target.dataset.accountView;
        if (view === "magic-link") $("#magic-link-email").value = $("#account-email").value.trim();
        if (view === "resend-confirmation") $("#confirmation-email").value = $("#account-email").value.trim();
        if (view === "recovery") $("#recovery-email").value = $("#account-email").value.trim();
        showAccountView(view);
        return;
      }
      if (target.dataset.unlinkIdentity) {
        const identity = state.accountIdentities.find(item => item.identity_id === target.dataset.unlinkIdentity);
        if (!identity) {
          showToast("No se encontró el método de acceso que intentas desvincular. Actualiza la lista e inténtalo de nuevo.");
          return;
        }
        (async () => {
          try {
            const { error } = await cloud.auth.unlinkIdentity(identity);
            if (error) {
              showToast(`No se pudo desvincular el método de acceso: ${authErrorMessage(error)}`);
            } else {
              await renderAccountIdentities();
              showToast("Método de acceso desvinculado.");
            }
          } catch (error) {
            showToast(`No se pudo desvincular el método de acceso: ${authErrorMessage(error)}`);
          }
        })();
        return;
      }
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
      if (target.dataset.addAnimalOption) {
        const listId = target.dataset.addAnimalOption;
        const list = ANIMAL_LISTS.find(item => item.id === listId);
        const label = prompt(`Nombre de la nueva opción para ${list?.label || "la lista"}:`)?.trim();
        if (!label) return;
        const listContainer = target.closest(".settings-list");
        const value = `option-${newId()}`;
        listContainer.insertAdjacentHTML("beforeend", animalListOptionMarkup(listId, { value, label, enabled: true, active: true }));
        state.fieldSettingsDirty = true;
        $("#save-animal-settings").textContent = "Guardar cambios pendientes";
        return;
      }
      if (target.dataset.openJourney) { openJourney(target.dataset.openJourney); return; }
      if (target.hasAttribute("data-toggle-detail-view")) {
        state.detailView = state.detailView === "summary" ? "full" : "summary";
        applyDetailPresentation();
        return;
      }
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
      if (target.dataset.resetPhotoCrop) {
        const cropControls = $$(".detail-crop-panel input[data-photo-crop]");
        cropControls.forEach(input => { input.value = "50"; });
        const photoId = target.dataset.resetPhotoCrop;
        savePhotoCrop(photoId, 50, 50);
        return;
      }
      if (target.dataset.viewPhoto) {
        const photo = state.photos.find(item => item.id === target.dataset.viewPhoto);
        if (photo) { $("#photo-large").src = photoUrl(photo); $("#photo-dialog").showModal(); }
        return;
      }
      if (target.dataset.deleteEvent) { deleteEvent(target.dataset.deleteEvent); return; }
      if (target.dataset.reactivateAnimal) { reactivateAnimal(target.dataset.reactivateAnimal); return; }
      if (target.dataset.deactivateAnimal) { deactivateAnimal(target.dataset.deactivateAnimal); return; }
      if (target.dataset.deleteAnimal) { deleteAnimal(target.dataset.deleteAnimal); }
    });
    document.addEventListener("input", event => {
      const input = event.target;
      if (input.id === "journey-weight-input") {
        updateJourneyWeightFeedback();
        return;
      }
      if (!input.dataset.photoCrop) return;
      const panel = input.closest(".detail-crop-panel");
      const x = Number(panel.querySelector('[data-photo-crop="x"]').value);
      const y = Number(panel.querySelector('[data-photo-crop="y"]').value);
      const image = $(".detail-hero img");
      if (image) image.style.objectPosition = `${x}% ${y}%`;
    });
    document.addEventListener("change", event => {
      if (event.target.matches("[data-show-detail-empty]")) {
        state.detailShowEmpty = event.target.checked;
        applyDetailPresentation();
        return;
      }
      if (event.target.matches("[data-field-setting], [data-field-label], [data-module-setting], [data-list-label], [data-list-enabled]")) {
        state.fieldSettingsDirty = true;
        $("#save-animal-settings").textContent = "Guardar cambios pendientes";
        if (event.target.matches("[data-field-setting]")) {
          const summaryCount = $$('#animal-field-settings [data-field-setting="detailVisibility"]')
            .filter(select => select.value === "summary" &&
              $("#animal-field-settings").querySelector(`[data-field-setting="enabled"][data-field-id="${select.dataset.fieldId}"]`)?.checked).length;
          $("#animal-summary-limit-warning").hidden = summaryCount <= 10;
          $("#animal-summary-limit-warning").textContent =
            `Hay ${summaryCount} campos en la ficha resumida. Se recomienda mostrar 10 o menos para facilitar la lectura en el corral.`;
        }
        return;
      }
      if (event.target.matches("[data-list-active]")) {
        state.fieldSettingsDirty = true;
        $("#save-animal-settings").textContent = "Guardar cambios pendientes";
        return;
      }
      if (event.target.id === "animal-status") {
        updateConditionalAnimalFields();
        return;
      }
      if (event.target.id === "photo-input") addPhotos(event.target.files);
      if (event.target.dataset.photoCrop) {
        const panel = event.target.closest(".detail-crop-panel");
        savePhotoCrop(
          event.target.dataset.photoId,
          Number(panel.querySelector('[data-photo-crop="x"]').value),
          Number(panel.querySelector('[data-photo-crop="y"]').value)
        );
      }
      if (event.target.id === "animal-tag") event.target.setCustomValidity("");
    });
    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("#search-input").focus();
      }
    });
    [$("#animal-dialog"), $("#detail-dialog"), $("#record-dialog"), $("#photo-dialog"), $("#journey-create-dialog"), $("#journey-dialog"), $("#tag-scanner-dialog")].forEach(dialog => {
      dialog.addEventListener("click", event => {
        if (event.target === dialog) requestClose(dialog.id);
      });
    });
    $("#tag-scanner-dialog").addEventListener("close", stopTagScanner);
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
      attachDateShortcuts(document);
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
          $("#account-manage-button").hidden = !currentUser;
          $("#sign-out-button").hidden = !currentUser;
          if (!currentUser) {
            state.accountIdentities = [];
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
        $("#account-manage-button").hidden = !currentUser;
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
        if (document.visibilityState === "hidden") saveAnimalDraft();
        if (document.visibilityState === "visible") syncData();
      });
    } catch (error) {
      document.body.innerHTML = `<main style="max-width:600px;margin:80px auto;padding:24px;font:16px sans-serif"><h1>No se pudo abrir Ganadero</h1><p>${escapeHtml(error.message)}</p></main>`;
    }
  }

  initialize();
})();
