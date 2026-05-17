"use strict";

// =========================================================================
// Constants
// =========================================================================

const TOKEN_KEY = "leparvis_admin_token";
const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const EDITABLE_FIELDS = [
  "name", "type", "community", "description", "image_url",
  "address", "city", "postal_code", "country", "diocese",
  "latitude", "longitude",
  "website", "phone", "email",
];

// =========================================================================
// State
// =========================================================================

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  taxonomy: null,
  churches: [],
  selectedId: null,
  selectedChurch: null,   // full detail object
  pristine: null,         // snapshot of editable fields when loaded
  dirty: false,
  apiBase: "",
};

// =========================================================================
// DOM helpers
// =========================================================================

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

state.apiBase = (() => {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8000";
  return ""; // same-origin in production
})();
$("#api-base-display").textContent = state.apiBase || "(même origine)";

// =========================================================================
// API client
// =========================================================================

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(state.apiBase + path, { ...options, headers });
  if (!res.ok) {
    let detail;
    try { detail = await res.json(); } catch { detail = await res.text(); }
    const err = new Error(typeof detail === "string"
      ? `${res.status} ${detail}`
      : `${res.status} ${JSON.stringify(detail)}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// =========================================================================
// Toasts
// =========================================================================

function toast(message, kind = "info", ms = 3500) {
  const container = $("#toast-container");
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// =========================================================================
// Login flow
// =========================================================================

$("#btn-login").addEventListener("click", login);
$("#admin-token").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("#btn-logout").addEventListener("click", () => {
  if (state.dirty && !confirm("Quitter sans enregistrer ?")) return;
  state.token = "";
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
});

async function login() {
  const t = $("#admin-token").value.trim();
  if (!t) return;
  state.token = t;
  try {
    await api("/api/admin/login", { method: "POST" });
    localStorage.setItem(TOKEN_KEY, t);
    $("#login-error").classList.add("hidden");
    showApp();
  } catch (err) {
    $("#login-error").textContent = "Connexion refusée : " + err.message;
    $("#login-error").classList.remove("hidden");
    state.token = "";
  }
}

function showLogin() {
  $("#login-view").classList.remove("hidden");
  $("#app-view").classList.add("hidden");
}

async function showApp() {
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  await loadTaxonomy();
  await refreshChurchList();
}

async function loadTaxonomy() {
  state.taxonomy = await api("/api/meta/taxonomy");

  // Populate taxonomy-driven selects
  fillSelect("#field-type", state.taxonomy.church_types);
  fillSelect("#field-community", [{ value: "", label: "—" }, ...state.taxonomy.communities]);
  fillSelect("#new-church-type", state.taxonomy.church_types);
}

function fillSelect(sel, items) {
  const node = $(sel);
  node.innerHTML = "";
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it.value;
    opt.textContent = it.label;
    node.appendChild(opt);
  }
}

// =========================================================================
// Sidebar / search / list
// =========================================================================

const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

$("#admin-search").addEventListener("input", debounce(refreshChurchList, 250));

async function refreshChurchList() {
  const q = $("#admin-search").value.trim();
  const params = new URLSearchParams({ limit: "200" });
  if (q) params.set("q", q);
  state.churches = await api(`/api/churches?${params}`);
  renderChurchList();
  renderStats();
}

function renderChurchList() {
  const list = $("#church-list");
  list.innerHTML = "";
  if (!state.churches.length) {
    list.innerHTML = `<p class="empty" style="color:var(--ink-muted);padding:20px;text-align:center;font-size:13px">Aucun lieu trouvé.</p>`;
    return;
  }
  for (const ch of state.churches) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "church-row" + (ch.id === state.selectedId ? " active" : "");
    btn.dataset.id = ch.id;
    btn.innerHTML = `
      <span class="row-name"></span>
      <span class="row-meta">
        <span class="loc"></span>
        ${ch.source ? `<span class="pip">${ch.source.split("_")[0]}</span>` : ""}
      </span>
    `;
    btn.querySelector(".row-name").textContent = ch.name;
    btn.querySelector(".loc").textContent =
      [ch.postal_code, ch.city].filter(Boolean).join(" · ") || "—";
    btn.addEventListener("click", () => selectChurch(ch.id));
    list.appendChild(btn);
  }
}

function renderStats() {
  $("#sidebar-stats").textContent =
    `${state.churches.length} lieu${state.churches.length > 1 ? "x" : ""}`;
}

// =========================================================================
// Editor — load / render church
// =========================================================================

async function selectChurch(id) {
  if (state.dirty && !confirm("Quitter sans enregistrer ?")) return;
  state.selectedId = id;
  $$(".church-row").forEach((r) => r.classList.toggle("active", Number(r.dataset.id) === id));

  const detail = await api(`/api/admin/churches/${id}`);
  state.selectedChurch = detail;
  state.pristine = snapshotFields(detail);
  state.dirty = false;
  renderEditor();
  setActiveTab("identity");
  $("#editor-empty").classList.add("hidden");
  $("#editor-content").classList.remove("hidden");
  // Mobile: switch to editor view (sidebar hidden via CSS)
  $(".layout").classList.add("editor-open");
}

// Back-to-list handler for mobile
document.addEventListener("click", (e) => {
  if (e.target.id === "btn-back-to-list" || e.target.closest("#btn-back-to-list")) {
    if (state.dirty && !confirm("Quitter sans enregistrer ?")) return;
    $(".layout").classList.remove("editor-open");
  }
});

function snapshotFields(c) {
  const out = {};
  for (const f of EDITABLE_FIELDS) out[f] = c[f] ?? "";
  return out;
}

function renderEditor() {
  const c = state.selectedChurch;

  // Header
  $("#church-name-display").textContent = c.name;
  $("#church-address-display").textContent =
    [c.address, c.postal_code, c.city].filter(Boolean).join(", ") || "Adresse non renseignée";
  $("#church-type-badge").textContent = labelFor(state.taxonomy.church_types, c.type);
  $("#church-source-badge").textContent = c.source ? `via ${c.source.replace("_", " ")}` : "manuel";
  const cn = c.celebrations.length;
  $("#church-celebrations-count").textContent =
    `${cn} célébration${cn > 1 ? "s" : ""}`;
  $("#tab-celebrations-count").textContent = cn;

  // Fields
  for (const f of EDITABLE_FIELDS) {
    const input = $(`[data-field="${f}"]`);
    if (input) input.value = c[f] ?? "";
  }

  // Celebrations
  renderCelebrations();
  updateSaveBar();
}

function labelFor(items, value) {
  return items?.find((x) => x.value === value)?.label ?? value;
}

// =========================================================================
// Tabs
// =========================================================================

$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

function setActiveTab(name) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
}

// =========================================================================
// Dirty tracking + save bar
// =========================================================================

document.addEventListener("input", (e) => {
  if (e.target.matches("[data-field]")) {
    checkDirty();
  }
});

function checkDirty() {
  if (!state.pristine) return;
  let dirty = false;
  for (const f of EDITABLE_FIELDS) {
    const input = $(`[data-field="${f}"]`);
    if (!input) continue;
    const cur = input.value === "" ? "" : input.value;
    const orig = state.pristine[f] === null || state.pristine[f] === undefined ? "" : String(state.pristine[f]);
    if (String(cur) !== orig) { dirty = true; break; }
  }
  state.dirty = dirty;
  updateSaveBar();
}

function updateSaveBar() {
  $("#save-bar").classList.toggle("hidden", !state.dirty);
}

$("#btn-save").addEventListener("click", saveChurch);
$("#btn-discard").addEventListener("click", () => {
  if (!state.pristine) return;
  for (const f of EDITABLE_FIELDS) {
    const input = $(`[data-field="${f}"]`);
    if (input) input.value = state.pristine[f] ?? "";
  }
  state.dirty = false;
  updateSaveBar();
  toast("Modifications annulées", "info");
});

async function saveChurch() {
  const payload = {};
  for (const f of EDITABLE_FIELDS) {
    const input = $(`[data-field="${f}"]`);
    if (!input) continue;
    let v = input.value.trim();
    if (input.type === "number") v = v === "" ? null : Number(v);
    payload[f] = v === "" ? null : v;
  }
  try {
    const updated = await api(`/api/admin/churches/${state.selectedId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    state.selectedChurch = { ...state.selectedChurch, ...updated };
    state.pristine = snapshotFields(state.selectedChurch);
    state.dirty = false;
    renderEditor();
    await refreshChurchList();
    // restore active state on the saved row
    $$(".church-row").forEach((r) => r.classList.toggle("active", Number(r.dataset.id) === state.selectedId));
    toast("Lieu enregistré", "success");
  } catch (err) {
    toast("Erreur : " + err.message, "error", 6000);
  }
}

// =========================================================================
// Celebrations editor
// =========================================================================

function renderCelebrations() {
  const root = $("#celebrations-by-day");
  root.innerHTML = "";
  const c = state.selectedChurch;

  // Group celebrations by day
  const groups = new Map();
  for (let d = 0; d <= 6; d++) groups.set(d, []);
  groups.set(null, []); // "Quotidien / variable"

  for (const cel of c.celebrations) groups.get(cel.day_of_week ?? null).push(cel);

  // Render each day group (skip empty ones unless it's the only group)
  let renderedAny = false;
  const dayOrder = [0, 1, 2, 3, 4, 5, 6, null];
  for (const d of dayOrder) {
    const cels = groups.get(d).sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
    if (cels.length === 0) continue;
    renderedAny = true;
    root.appendChild(buildDayGroup(d, cels));
  }
  if (!renderedAny) {
    root.innerHTML = `
      <div class="empty-state" style="background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:32px">
        <div class="empty-emoji">🕐</div>
        <h2>Aucune célébration</h2>
        <p>Ajoute la première avec le bouton ci-dessus,<br />
           ou réimporte depuis le site web dans l'onglet <strong>Actions</strong>.</p>
      </div>`;
  }
}

function buildDayGroup(dayIdx, cels) {
  const group = document.createElement("div");
  group.className = "day-group";

  const header = document.createElement("div");
  header.className = "day-group-header";
  const dayName = dayIdx === null ? "Quotidien / variable" : DAY_LABELS[dayIdx];
  header.innerHTML = `<span>${dayName}</span><span class="day-count">${cels.length}</span>`;
  group.appendChild(header);

  for (const cel of cels) group.appendChild(buildCelebrationRow(cel));
  return group;
}

function buildCelebrationRow(cel) {
  const row = document.createElement("div");
  row.className = "celebration-row";
  row.dataset.id = cel.id;

  // Time
  const timeCol = document.createElement("div");
  timeCol.className = "cel-time";
  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.value = (cel.start_time || "").slice(0, 5);
  timeInput.dataset.bind = "start_time";
  timeCol.appendChild(timeInput);
  row.appendChild(timeCol);

  // Meta selects
  const meta = document.createElement("div");
  meta.className = "cel-meta";

  const daySel = document.createElement("select");
  daySel.dataset.bind = "day_of_week";
  daySel.innerHTML = `<option value="">Quotidien</option>` +
    DAY_LABELS.map((n, i) => `<option value="${i}">${n}</option>`).join("");
  daySel.value = cel.day_of_week == null ? "" : String(cel.day_of_week);
  meta.appendChild(daySel);

  const typeSel = document.createElement("select");
  typeSel.dataset.bind = "type";
  for (const it of state.taxonomy.celebration_types) {
    const opt = document.createElement("option");
    opt.value = it.value; opt.textContent = it.label;
    typeSel.appendChild(opt);
  }
  typeSel.value = cel.type;
  meta.appendChild(typeSel);

  const riteSel = document.createElement("select");
  riteSel.dataset.bind = "rite";
  riteSel.innerHTML = state.taxonomy.rites
    .map((r) => `<option value="${r.value}">${r.label}</option>`).join("");
  riteSel.value = cel.rite || "ordinary";
  meta.appendChild(riteSel);

  const langInput = document.createElement("input");
  langInput.type = "text";
  langInput.placeholder = "lang";
  langInput.maxLength = 3;
  langInput.className = "cel-lang";
  langInput.dataset.bind = "language";
  langInput.value = cel.language || "";
  meta.appendChild(langInput);

  row.appendChild(meta);

  // Actions
  const actions = document.createElement("div");
  actions.className = "cel-actions";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "save";
  saveBtn.title = "Enregistrer";
  saveBtn.textContent = "✓";
  saveBtn.addEventListener("click", () => saveCelebration(cel.id, row));
  actions.appendChild(saveBtn);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "delete";
  delBtn.title = "Supprimer";
  delBtn.textContent = "🗑";
  delBtn.addEventListener("click", () => deleteCelebration(cel.id));
  actions.appendChild(delBtn);

  row.appendChild(actions);
  return row;
}

async function saveCelebration(id, row) {
  const payload = {
    start_time: $("[data-bind='start_time']", row).value || null,
    day_of_week: $("[data-bind='day_of_week']", row).value === ""
      ? null : Number($("[data-bind='day_of_week']", row).value),
    type: $("[data-bind='type']", row).value,
    rite: $("[data-bind='rite']", row).value,
    language: $("[data-bind='language']", row).value.trim() || null,
  };
  try {
    await api(`/api/admin/celebrations/${id}`, {
      method: "PATCH", body: JSON.stringify(payload),
    });
    toast("Célébration enregistrée", "success");
    await reloadSelectedChurch();
  } catch (err) {
    toast("Erreur : " + err.message, "error");
  }
}

async function deleteCelebration(id) {
  if (!confirm("Supprimer cette célébration ?")) return;
  await api(`/api/admin/celebrations/${id}`, { method: "DELETE" });
  toast("Célébration supprimée", "success");
  await reloadSelectedChurch();
}

$("#btn-add-celebration").addEventListener("click", async () => {
  await api("/api/celebrations", {
    method: "POST",
    body: JSON.stringify({
      church_id: state.selectedId,
      type: "mass",
      rite: "ordinary",
      day_of_week: 6,
      start_time: "10:30",
      confidence: 1.0,
    }),
  });
  toast("Célébration ajoutée", "success");
  await reloadSelectedChurch();
});

async function reloadSelectedChurch() {
  if (!state.selectedId) return;
  const detail = await api(`/api/admin/churches/${state.selectedId}`);
  state.selectedChurch = detail;
  state.pristine = snapshotFields(detail);
  state.dirty = false;
  renderEditor();
}

// =========================================================================
// Actions tab — reimport / preview / merge / delete
// =========================================================================

$("#btn-reimport").addEventListener("click", () => reimport(false));

async function reimport(force) {
  const c = state.selectedChurch;
  if (!c.website) {
    toast("Renseigne d'abord un site web pour ce lieu.", "error");
    return;
  }
  const render = urlNeedsRendering(c.website);
  toast(render ? "Réimport (Chromium)…" : "Réimport en cours…", "info", 2500);
  try {
    const params = new URLSearchParams({
      force: force ? "true" : "false",
      render: render ? "true" : "false",
    });
    const report = await api(`/api/admin/churches/${state.selectedId}/reimport?${params}`, {
      method: "POST",
    });
    const stats = `${report.created_celebrations} créée(s), ${report.updated_celebrations} mise(s) à jour`;
    toast(`Réimport terminé · ${stats}`, "success");
    if (report.errors && report.errors.length) {
      toast("Erreurs : " + report.errors.join(" · "), "error", 8000);
    }
    await reloadSelectedChurch();
  } catch (err) {
    if (err.status === 451) {
      const ok = confirm(
        "Le site bloque les robots via robots.txt.\n\n" +
        "Forcer l'extraction en l'ignorant ? (Tu prends la responsabilité.)"
      );
      if (ok) return reimport(true);
      toast("Annulé — robots.txt respecté.", "info");
    } else {
      toast("Erreur : " + err.message, "error", 6000);
    }
  }
}

$("#btn-preview").addEventListener("click", async () => {
  const c = state.selectedChurch;
  if (!c.website) { toast("Aucun site web sur ce lieu.", "error"); return; }
  $("#preview-output").textContent = "Analyse en cours…";
  $("#preview-modal").classList.remove("hidden");
  try {
    const data = await fetch(state.apiBase + "/api/ingest/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: c.website, force: true }),
    }).then((r) => r.json());
    $("#preview-output").textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    $("#preview-output").textContent = "Erreur : " + err.message;
  }
});

$("#btn-delete").addEventListener("click", async () => {
  const c = state.selectedChurch;
  if (!confirm(`⚠ Supprimer définitivement « ${c.name} » et toutes ses célébrations ?\n\nCette action est irréversible.`)) return;
  try {
    await api(`/api/admin/churches/${state.selectedId}`, { method: "DELETE" });
    toast("Lieu supprimé", "success");
    state.selectedId = null;
    state.selectedChurch = null;
    state.pristine = null;
    state.dirty = false;
    $("#editor-content").classList.add("hidden");
    $("#editor-empty").classList.remove("hidden");
    await refreshChurchList();
  } catch (err) {
    toast("Erreur : " + err.message, "error");
  }
});

// =========================================================================
// Merge modal
// =========================================================================

$("#btn-merge").addEventListener("click", openMergeModal);

function openMergeModal() {
  const c = state.selectedChurch;
  $("#merge-source-name").textContent = c.name;
  $("#merge-search").value = "";
  $("#merge-results").innerHTML = "";
  $("#merge-modal").classList.remove("hidden");
  setTimeout(() => $("#merge-search").focus(), 60);
}

$("#merge-search").addEventListener("input", debounce(async () => {
  const q = $("#merge-search").value.trim();
  if (q.length < 2) { $("#merge-results").innerHTML = ""; return; }
  const results = await api(`/api/churches?q=${encodeURIComponent(q)}&limit=20`);
  const out = $("#merge-results");
  out.innerHTML = "";
  for (const ch of results) {
    if (ch.id === state.selectedId) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "merge-result-row";
    btn.innerHTML = `
      <span class="row-name"></span>
      <span class="row-meta"></span>
    `;
    btn.querySelector(".row-name").textContent = ch.name;
    btn.querySelector(".row-meta").textContent =
      [ch.postal_code, ch.city, labelFor(state.taxonomy.church_types, ch.type)]
        .filter(Boolean).join(" · ");
    btn.addEventListener("click", () => doMerge(ch));
    out.appendChild(btn);
  }
}, 250));

async function doMerge(target) {
  const source = state.selectedChurch;
  if (!confirm(
    `Fusionner :\n  • ${source.name}\n  → ${target.name}\n\n` +
    `« ${source.name} » sera SUPPRIMÉ et ses célébrations déplacées.`
  )) return;
  try {
    const report = await api(
      `/api/admin/churches/${source.id}/merge-into/${target.id}`,
      { method: "POST" },
    );
    closeAllModals();
    toast(`✓ Fusion terminée — ${report.moved_celebrations} déplacée(s), ${report.deleted_duplicate_celebrations} doublon(s) supprimé(s)`, "success", 5000);
    state.selectedId = target.id;
    await refreshChurchList();
    await selectChurch(target.id);
  } catch (err) {
    toast("Erreur : " + err.message, "error", 6000);
  }
}

// =========================================================================
// New church modal
// =========================================================================

$("#btn-new-church").addEventListener("click", () => {
  $("#new-church-name").value = "";
  $("#new-church-city").value = "";
  $("#new-church-modal").classList.remove("hidden");
  setTimeout(() => $("#new-church-name").focus(), 60);
});

$("#btn-create-church").addEventListener("click", async () => {
  const name = $("#new-church-name").value.trim();
  if (!name) { toast("Le nom est requis.", "error"); return; }
  try {
    const created = await api("/api/churches", {
      method: "POST",
      body: JSON.stringify({
        name,
        type: $("#new-church-type").value,
        city: $("#new-church-city").value.trim() || null,
      }),
    });
    closeAllModals();
    toast("Lieu créé", "success");
    await refreshChurchList();
    await selectChurch(created.id);
  } catch (err) {
    toast("Erreur : " + err.message, "error");
  }
});

// =========================================================================
// Top-level view navigation (Lieux / Imports / future)
// =========================================================================

function switchView(name) {
  $$(".admin-nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach((v) =>
    v.classList.toggle("hidden", v.id !== `view-${name}`));
  if (name === "imports") loadImports();
  if (name === "scheduler") openSchedulerView();
  else stopSchedulerAutoRefresh();
}

$$(".admin-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// =========================================================================
// Imports view — new-import forms + history
// =========================================================================

// Toggle the "Nouvel import" panel visibility.
$("#btn-show-new-import").addEventListener("click", () => {
  $("#new-import-section").classList.remove("hidden");
  $("#new-import-section").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#btn-hide-new-import").addEventListener("click", () => {
  $("#new-import-section").classList.add("hidden");
});

// Geolocate helper
$("#btn-import-geoloc").addEventListener("click", () => {
  if (!navigator.geolocation) {
    toast("Géolocalisation indisponible.", "error");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $("#import-lat").value = pos.coords.latitude.toFixed(5);
      $("#import-lon").value = pos.coords.longitude.toFixed(5);
      toast("Position détectée", "success", 1800);
    },
    (err) => toast("Géolocalisation refusée: " + err.message, "error"),
  );
});

function setImportReport(text, hint = "") {
  $("#import-output").textContent = text;
  if (hint) $("#import-report-hint").textContent = hint;
}

$("#btn-import-osm").addEventListener("click", async () => {
  const lat = parseFloat($("#import-lat").value);
  const lon = parseFloat($("#import-lon").value);
  const radius = parseFloat($("#import-radius").value || "10");
  const limit = parseInt($("#import-limit").value || "100", 10);
  if (!isFinite(lat) || !isFinite(lon)) {
    toast("Renseigne lat/lon (ou utilise 📍).", "error");
    return;
  }
  setImportReport("Recherche OSM en cours…", "Appel à overpass-api.de");
  try {
    const report = await fetch(state.apiBase + "/api/ingest/osm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lon, radius_km: radius, limit }),
    }).then((r) => r.json());
    setImportReport(
      JSON.stringify(report, null, 2),
      `${report.created_churches} créé(s), ${report.updated_churches} mis à jour, ${(report.errors || []).length} erreur(s)`,
    );
    toast(`OSM : ${report.created_churches} créés, ${report.updated_churches} mis à jour`, "success", 4500);
    await refreshChurchList();
    if (!$("#view-imports").classList.contains("hidden")) loadImports();
  } catch (err) {
    setImportReport("Erreur: " + err.message, "Échec de l'import OSM");
    toast("Erreur : " + err.message, "error", 6000);
  }
});

// `render` is auto-on for known SPA hosts (messes.info), or when the
// 'Rendre le JS' checkbox is ticked.
const SPA_HOSTS = ["messes.info", "www.messes.info"];
function urlNeedsRendering(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SPA_HOSTS.some((d) => host === d || host.endsWith("." + d));
  } catch { return false; }
}
function shouldRender(url) {
  return urlNeedsRendering(url) || $("#import-url-render").checked;
}

async function importUrl(force) {
  const url = $("#import-url").value.trim();
  if (!url) { toast("Renseigne une URL.", "error"); return; }
  const render = shouldRender(url);
  setImportReport(
    render ? "Rendu Chromium en cours…" : "Extraction…",
    render ? "Lecture via navigateur headless (5-8 s)" : "Lecture + parsing du site",
  );
  try {
    const res = await fetch(state.apiBase + "/api/ingest/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, force: !!force, render }),
    });
    const body = await res.json();
    if (res.status === 451) {
      const ok = confirm(
        "Le site bloque les robots via robots.txt.\n\n" +
        "Forcer l'extraction en l'ignorant ? (Tu prends la responsabilité.)"
      );
      if (ok) return importUrl(true);
      setImportReport("Annulé — robots.txt respecté.", "Annulé");
      return;
    }
    if (!res.ok) {
      setImportReport(JSON.stringify(body, null, 2), `Erreur ${res.status}`);
      toast(`Erreur ${res.status}`, "error");
      return;
    }
    setImportReport(
      JSON.stringify(body, null, 2),
      `${body.created_celebrations} célébrations créées, ${body.updated_celebrations} mises à jour`,
    );
    toast(`URL : ${body.created_celebrations} célébrations créées`, "success");
    await refreshChurchList();
    if (!$("#view-imports").classList.contains("hidden")) loadImports();
  } catch (err) {
    setImportReport("Erreur: " + err.message, "Échec");
    toast("Erreur : " + err.message, "error", 6000);
  }
}
$("#btn-import-url").addEventListener("click", () => importUrl(false));

$("#btn-import-preview").addEventListener("click", async () => {
  const url = $("#import-url").value.trim();
  if (!url) { toast("Renseigne une URL.", "error"); return; }
  await previewUrlForImport(url);
});

// ----- messes.info shortcut --------------------------------------------

function buildMessesInfoUrl() {
  const loc = $("#import-mi-location").value.trim();
  if (!loc) {
    toast("Renseigne une ville ou un code postal.", "error");
    return null;
  }
  // messes.info uses /horaires/<slug> — encode for spaces / accents.
  const slug = encodeURIComponent(loc);
  return `https://messes.info/horaires/${slug}`;
}

$("#btn-import-mi").addEventListener("click", () => {
  const url = buildMessesInfoUrl();
  if (!url) return;
  $("#import-url").value = url;        // for visibility / re-diagnosis
  toast(`Cible : ${url}`, "info", 2500);
  importUrl(false);
});

$("#btn-import-mi-preview").addEventListener("click", async () => {
  const url = buildMessesInfoUrl();
  if (!url) return;
  $("#import-url").value = url;
  await previewUrlForImport(url);
});

async function previewUrlForImport(url) {
  const render = shouldRender(url);
  setImportReport(
    render ? "Rendu Chromium…" : "Diagnostic…",
    render ? "Lecture via navigateur headless" : "Lecture sans écriture en base",
  );
  try {
    const data = await fetch(state.apiBase + "/api/ingest/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, force: true, render }),
    }).then((r) => r.json());
    const found = (data.parsed_from_body || []).length;
    const jsonld = data.jsonld_events || 0;
    const mode = data.mode || (render ? "rendered" : "http");
    const hints = (data.hints || []).join(" · ");
    const summary = `${found} créneau(x) heuristiques · ${jsonld} JSON-LD · mode ${mode}`
      + (hints ? "\n💡 " + hints : "");
    setImportReport(JSON.stringify(data, null, 2), summary);
  } catch (err) {
    setImportReport("Erreur: " + err.message, "Échec");
  }
}

// Hide the new-import panel on Escape (when visible inside the Imports view).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const section = $("#new-import-section");
  if (section && !section.classList.contains("hidden")) {
    section.classList.add("hidden");
  }
});

// =========================================================================
// Modal helpers
// =========================================================================

document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-modal]") || e.target.matches(".modal-close")) {
    closeAllModals();
  }
  // Close when clicking the dimmed backdrop
  if (e.target.classList.contains("modal")) closeAllModals();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllModals();
});
function closeAllModals() {
  $$(".modal").forEach((m) => m.classList.add("hidden"));
}

// =========================================================================
// Imports view — history table, detail, delete, rerun, refresh-all
// =========================================================================

const DAY_FMT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit", month: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit",
});

const KIND_LABEL = {
  osm: "🗺 OSM",
  url: "🌐 URL",
  scheduled_refresh: "🔄 Rafraîchissement",
  reimport: "♻️ Réimport",
};

function inputSummary(run) {
  if (run.input_url) return run.input_url;
  if (run.input_latitude != null && run.input_longitude != null) {
    return `${run.input_latitude.toFixed(3)}, ${run.input_longitude.toFixed(3)} · ${run.input_radius_km ?? "?"} km`;
  }
  if (run.kind === "scheduled_refresh") return "Toutes les paroisses avec source_url";
  return "—";
}

async function loadImports() {
  const container = $("#imports-list");
  container.innerHTML = `<p class="hint">Chargement…</p>`;
  const params = new URLSearchParams({ limit: "100" });
  const kind = $("#imports-filter-kind")?.value;
  const status = $("#imports-filter-status")?.value;
  if (kind) params.set("kind", kind);
  if (status) params.set("status", status);
  try {
    const runs = await api(`/api/admin/imports?${params}`);
    $("#imports-history-count").textContent = runs.length || "";
    if (!runs.length) {
      container.innerHTML = `<p class="hint">Aucun import ne correspond aux filtres.</p>`;
      return;
    }
    container.innerHTML = "";
    for (const run of runs) container.appendChild(renderImportRow(run));
  } catch (err) {
    container.innerHTML = `<p class="hint">Erreur : ${err.message}</p>`;
  }
}

// Filter / reload bindings.
$("#imports-filter-kind")?.addEventListener("change", loadImports);
$("#imports-filter-status")?.addEventListener("change", loadImports);
$("#btn-reload-imports")?.addEventListener("click", loadImports);

function renderImportRow(run) {
  const row = document.createElement("div");
  row.className = "import-row";
  row.dataset.runId = run.id;

  const dot = document.createElement("span");
  dot.className = `status-dot ${run.status}`;
  dot.title = run.status;

  const meta = document.createElement("div");
  meta.className = "import-meta";
  const dateLabel = run.started_at ? DAY_FMT.format(new Date(run.started_at)) : "—";
  meta.innerHTML = `
    <div class="row1">${KIND_LABEL[run.kind] ?? run.kind} · ${inputSummary(run)}</div>
    <div class="row2">#${run.id} · ${dateLabel} · ${run.triggered_by}</div>`;

  const counts = document.createElement("div");
  counts.className = "import-counts";
  counts.innerHTML = `
    <span title="Paroisses créées"><strong>${run.churches_created}</strong>🆕</span>
    <span title="Paroisses mises à jour"><strong>${run.churches_updated}</strong>♻️</span>
    <span title="Horaires créés"><strong>${run.celebrations_created}</strong>🕐</span>
    ${run.errors_count ? `<span title="Erreurs" style="color:#b03030"><strong>${run.errors_count}</strong>!</span>` : ""}`;

  const actions = document.createElement("div");
  actions.className = "import-actions-inline";
  actions.innerHTML = `
    <button type="button" class="btn-icon" data-action="detail" title="Détail">👁</button>
    ${run.kind === "scheduled_refresh"
      ? ""
      : `<button type="button" class="btn-icon" data-action="rerun" title="Rejouer">↻</button>`}
    <button type="button" class="btn-icon danger" data-action="delete" title="Supprimer (cascade)">🗑</button>`;

  row.append(dot, meta, counts, actions);

  // Clicks: row body opens detail; action buttons swallow the bubble.
  actions.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    if (action === "detail") openImportDetail(run.id);
    else if (action === "rerun") rerunImport(run.id);
    else if (action === "delete") deleteImportRun(run.id, run);
  });
  row.addEventListener("click", () => openImportDetail(run.id));
  return row;
}

async function openImportDetail(runId) {
  $("#detail-run-id").textContent = `#${runId}`;
  $("#import-detail-body").innerHTML = `<p class="hint">Chargement…</p>`;
  $("#import-detail-modal").classList.remove("hidden");
  try {
    const run = await api(`/api/admin/imports/${runId}`);
    const body = $("#import-detail-body");
    const errMsg = run.error_message
      ? `<pre style="color:#b03030">${escapeHtml(run.error_message)}</pre>`
      : "";
    const outputJson = run.output ? `<pre>${escapeHtml(JSON.stringify(run.output, null, 2))}</pre>` : "";

    // Refresh-all runs have children (one per church). Fetch + render them.
    let childrenHtml = "";
    if (run.kind === "scheduled_refresh") {
      try {
        const children = await api(`/api/admin/imports/${runId}/children`);
        childrenHtml = renderChildRuns(children);
      } catch (err) {
        childrenHtml = `<p class="hint">Impossible de charger les enfants : ${err.message}</p>`;
      }
    }

    body.innerHTML = `
      <div class="kv">
        <div class="k">Type</div><div>${KIND_LABEL[run.kind] ?? run.kind}</div>
        <div class="k">Statut</div><div>${run.status}</div>
        <div class="k">Source</div><div>${escapeHtml(inputSummary(run))}</div>
        <div class="k">Démarré</div><div>${run.started_at ? new Date(run.started_at).toLocaleString("fr-FR") : "—"}</div>
        <div class="k">Terminé</div><div>${run.finished_at ? new Date(run.finished_at).toLocaleString("fr-FR") : "—"}</div>
        <div class="k">Déclenché par</div><div>${run.triggered_by}</div>
        <div class="k">Paroisses</div><div>+${run.churches_created} créées, ${run.churches_updated} mises à jour</div>
        <div class="k">Horaires</div><div>+${run.celebrations_created} créés, ${run.celebrations_updated} mis à jour</div>
        <div class="k">Erreurs</div><div>${run.errors_count}</div>
      </div>
      ${errMsg}
      ${childrenHtml}
      ${outputJson}`;
  } catch (err) {
    $("#import-detail-body").innerHTML = `<p class="hint">Erreur : ${err.message}</p>`;
  }
}

function renderChildRuns(children) {
  if (!children.length) {
    return `<div class="child-runs"><h4>Enfants</h4><p class="hint">Aucun enfant.</p></div>`;
  }
  const rows = children.map((c) => {
    const status = `<span class="status-dot ${c.status}"></span>`;
    const counts = `+${c.celebrations_created}🕐 ${c.errors_count ? `· ${c.errors_count}!` : ""}`;
    const err = c.error_message
      ? `<div class="error">${escapeHtml(c.error_message)}</div>`
      : "";
    return `
      <div class="child-row">
        <div>${status}</div>
        <div class="url" title="${escapeHtml(c.input_url || "")}">${escapeHtml(c.input_url || "—")}</div>
        <div class="counts">${counts}</div>
        ${err}
      </div>`;
  }).join("");
  const failed = children.filter((c) => c.status === "error").length;
  const ok = children.filter((c) => c.status === "success").length;
  return `
    <div class="child-runs">
      <h4>Enfants (${children.length} · ${ok} OK · ${failed} échecs)</h4>
      ${rows}
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-detail]")) {
    $("#import-detail-modal").classList.add("hidden");
  }
});

async function deleteImportRun(runId, run) {
  const label = `${KIND_LABEL[run.kind] ?? run.kind} · ${inputSummary(run)}`;
  const msg = `Supprimer cet import ?\n\n${label}\n\nCela supprimera aussi toutes les paroisses (${run.churches_created}) et horaires créés par ce run.`;
  if (!confirm(msg)) return;
  try {
    const res = await api(`/api/admin/imports/${runId}`, { method: "DELETE" });
    toast(`Supprimé : ${res.deleted_churches} paroisses, ${res.deleted_celebrations} horaires`, "success");
    loadImports();
    // Sidebar church list is now stale.
    refreshChurchList?.();
  } catch (err) {
    toast("Suppression échouée : " + err.message, "error");
  }
}

async function rerunImport(runId) {
  if (!confirm("Rejouer cet import ?")) return;
  toast("Lancement…", "info", 1800);
  try {
    await api(`/api/admin/imports/${runId}/rerun`, { method: "POST" });
    toast("Import relancé", "success");
    loadImports();
  } catch (err) {
    toast("Échec : " + err.message, "error");
  }
}

$("#btn-refresh-now").addEventListener("click", async () => {
  if (!confirm("Lancer un rafraîchissement de toutes les paroisses ?\nCela peut prendre plusieurs minutes.")) return;
  const btn = $("#btn-refresh-now");
  btn.disabled = true;
  btn.textContent = "⏳ Rafraîchissement…";
  try {
    const res = await api("/api/admin/imports/refresh-now", { method: "POST" });
    toast(`Refresh terminé : ${res.succeeded} ok, ${res.failed} échecs (sur ${res.churches_refreshed})`,
          res.failed ? "info" : "success", 5000);
    loadImports();
  } catch (err) {
    toast("Refresh échoué : " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Rafraîchir maintenant";
  }
});

// =========================================================================
// Scheduler view — status, controls, recent cycles, logs
// =========================================================================

let _schedAutoRefreshTimer = null;
let _schedStatus = null;

function openSchedulerView() {
  loadSchedulerStatus();
  loadScheduledRuns();
  loadSchedulerLogs();
  if ($("#sched-logs-auto")?.checked) startSchedulerAutoRefresh();
}

function stopSchedulerAutoRefresh() {
  if (_schedAutoRefreshTimer) {
    clearInterval(_schedAutoRefreshTimer);
    _schedAutoRefreshTimer = null;
  }
}
function startSchedulerAutoRefresh() {
  stopSchedulerAutoRefresh();
  _schedAutoRefreshTimer = setInterval(() => {
    if ($("#view-scheduler").classList.contains("hidden")) {
      stopSchedulerAutoRefresh();
      return;
    }
    loadSchedulerLogs();
    loadSchedulerStatus();
  }, 5000);
}

function formatTimeUntil(iso) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "imminent";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `dans ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `dans ${h} h`;
  const d = Math.floor(h / 24);
  return `dans ${d} j`;
}

async function loadSchedulerStatus() {
  try {
    const s = await api("/api/admin/scheduler");
    _schedStatus = s;
    renderSchedulerStatus(s);
  } catch (err) {
    $("#sched-status-label").textContent = "Erreur : " + err.message;
    $("#sched-status-dot").className = "status-dot error";
  }
}

function renderSchedulerStatus(s) {
  const dot = $("#sched-status-dot");
  const label = $("#sched-status-label");
  const detail = $("#sched-status-detail");
  const toggle = $("#btn-sched-toggle");

  if (!s.enabled) {
    dot.className = "status-dot error";
    label.textContent = "Désactivé";
    detail.textContent = "LEPARVIS_REFRESH_INTERVAL_DAYS est à 0 sur le serveur.";
    $("#sched-disabled-warning").classList.remove("hidden");
    toggle.disabled = true;
    $("#btn-sched-interval").disabled = true;
  } else if (!s.running) {
    dot.className = "status-dot error";
    label.textContent = "Arrêté";
    detail.textContent = "Le planificateur n'est pas démarré.";
    toggle.disabled = true;
  } else if (s.paused) {
    dot.className = "status-dot partial";
    label.textContent = "En pause";
    detail.textContent = "Aucun cycle ne sera lancé tant qu'on n'a pas repris.";
    toggle.textContent = "▶ Reprendre";
    toggle.disabled = false;
  } else {
    dot.className = "status-dot success";
    label.textContent = "Actif";
    detail.textContent = `Cycle automatique chaque ${s.interval_days} j.`;
    toggle.textContent = "⏸ Mettre en pause";
    toggle.disabled = false;
  }

  $("#sched-next-run").textContent = s.next_run_at
    ? `${new Date(s.next_run_at).toLocaleString("fr-FR")} (${formatTimeUntil(s.next_run_at)})`
    : "—";
  $("#sched-interval").textContent = `${s.interval_days} j`;
}

$("#btn-sched-reload").addEventListener("click", () => {
  loadSchedulerStatus();
  loadScheduledRuns();
});

$("#btn-sched-toggle").addEventListener("click", async () => {
  if (!_schedStatus) return;
  const path = _schedStatus.paused ? "resume" : "pause";
  try {
    const s = await api(`/api/admin/scheduler/${path}`, { method: "POST" });
    _schedStatus = s;
    renderSchedulerStatus(s);
    toast(s.paused ? "Planificateur en pause" : "Planificateur repris", "success");
  } catch (err) {
    toast("Erreur : " + err.message, "error");
  }
});

$("#btn-sched-runnow").addEventListener("click", async () => {
  if (!confirm("Lancer un cycle de rafraîchissement maintenant ?\nCela peut prendre plusieurs minutes.")) return;
  const btn = $("#btn-sched-runnow");
  btn.disabled = true;
  btn.textContent = "⏳ En cours…";
  try {
    const res = await api("/api/admin/imports/refresh-now", { method: "POST" });
    toast(`Cycle terminé : ${res.succeeded} ok, ${res.failed} échecs (sur ${res.churches_refreshed})`,
          res.failed ? "info" : "success", 5000);
    loadScheduledRuns();
    loadSchedulerStatus();
  } catch (err) {
    toast("Échec : " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Lancer maintenant";
  }
});

// Interval modal
$("#btn-sched-interval").addEventListener("click", () => {
  if (_schedStatus) $("#sched-interval-input").value = _schedStatus.interval_days || 7;
  $("#sched-interval-modal").classList.remove("hidden");
});
document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-interval]")) {
    $("#sched-interval-modal").classList.add("hidden");
  }
});
$("#btn-sched-interval-save").addEventListener("click", async () => {
  const days = parseInt($("#sched-interval-input").value, 10);
  if (!Number.isFinite(days) || days < 1) {
    toast("Intervalle invalide", "error");
    return;
  }
  try {
    const s = await api("/api/admin/scheduler", {
      method: "PATCH",
      body: JSON.stringify({ interval_days: days }),
    });
    _schedStatus = s;
    renderSchedulerStatus(s);
    $("#sched-interval-modal").classList.add("hidden");
    toast(`Intervalle changé à ${days} j (volatile)`, "success");
  } catch (err) {
    toast("Échec : " + err.message, "error");
  }
});

// Recent cycles
async function loadScheduledRuns() {
  const container = $("#sched-runs-list");
  container.innerHTML = `<p class="hint">Chargement…</p>`;
  try {
    const runs = await api("/api/admin/imports?kind=scheduled_refresh&limit=30");
    $("#sched-runs-count").textContent = runs.length || "";
    if (!runs.length) {
      container.innerHTML = `<p class="hint">Aucun cycle exécuté pour l'instant.</p>`;
    } else {
      container.innerHTML = "";
      for (const run of runs) container.appendChild(renderImportRow(run));
    }
    // Use the most recent finished run as "Dernier cycle".
    const last = runs.find((r) => r.finished_at);
    $("#sched-last-run").textContent = last
      ? `${new Date(last.finished_at).toLocaleString("fr-FR")} · ${last.status}`
      : "—";
  } catch (err) {
    container.innerHTML = `<p class="hint">Erreur : ${err.message}</p>`;
  }
}
$("#btn-sched-runs-reload").addEventListener("click", loadScheduledRuns);

// Logs
async function loadSchedulerLogs() {
  const container = $("#sched-logs");
  const level = $("#sched-logs-level").value;
  const params = new URLSearchParams({ limit: "300" });
  if (level) params.set("level", level);
  try {
    const logs = await api(`/api/admin/scheduler/logs?${params}`);
    if (!logs.length) {
      container.innerHTML = `<p class="log-empty">Aucune ligne pour ce filtre.</p>`;
      return;
    }
    container.innerHTML = logs.map((l) => {
      const time = l.ts.slice(11) || l.ts;  // hh:mm:ss only
      return `<div class="log-line"><span class="ts">${escapeHtml(l.ts)}</span><span class="lvl-${l.level}">${l.level}</span><span class="msg">${escapeHtml(l.message)}</span></div>`;
    }).join("");
    // Scroll to bottom (tail).
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    container.innerHTML = `<p class="log-empty">Erreur : ${err.message}</p>`;
  }
}
$("#sched-logs-level").addEventListener("change", loadSchedulerLogs);
$("#btn-sched-logs-reload").addEventListener("click", loadSchedulerLogs);
$("#sched-logs-auto").addEventListener("change", (e) => {
  if (e.target.checked) startSchedulerAutoRefresh();
  else stopSchedulerAutoRefresh();
});

// =========================================================================
// Boot
// =========================================================================

if (state.token) {
  showApp().catch((err) => {
    if (err.status === 401) {
      state.token = "";
      localStorage.removeItem(TOKEN_KEY);
    }
    showLogin();
  });
} else {
  showLogin();
}
