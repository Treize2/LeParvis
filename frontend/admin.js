"use strict";

const el = (s, ctx = document) => ctx.querySelector(s);
const els = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

const TOKEN_KEY = "leparvis_admin_token";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  taxonomy: null,
  churches: [],
  selectedId: null,
};

(function initApiBase() {
  const input = el("#api-base");
  if (!input.value) {
    const host = window.location.hostname;
    input.value = host === "localhost" || host === "127.0.0.1" ? "http://localhost:8000" : "";
  }
})();

const apiBase = () => el("#api-base").value.replace(/\/$/, "");

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(apiBase() + path, { ...options, headers });
  if (!res.ok) {
    let detail;
    try { detail = await res.json(); } catch { detail = await res.text(); }
    const err = new Error(`${res.status} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------- Login --------------------------------------------------------

el("#btn-login").addEventListener("click", login);
el("#admin-token").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
el("#btn-logout").addEventListener("click", () => {
  state.token = "";
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
});

async function login() {
  const t = el("#admin-token").value.trim();
  if (!t) return;
  state.token = t;
  try {
    await api("/api/admin/login", { method: "POST" });
    localStorage.setItem(TOKEN_KEY, t);
    el("#login-error").classList.add("hidden");
    showApp();
  } catch (err) {
    el("#login-error").textContent = "Échec : " + err.message;
    el("#login-error").classList.remove("hidden");
  }
}

function showLogin() {
  el("#login-view").classList.remove("hidden");
  el("#app-view").classList.add("hidden");
  el("#btn-logout").classList.add("hidden");
}

async function showApp() {
  el("#login-view").classList.add("hidden");
  el("#app-view").classList.remove("hidden");
  el("#btn-logout").classList.remove("hidden");
  await loadTaxonomy();
  await refreshChurchList();
}

async function loadTaxonomy() {
  if (state.taxonomy) return;
  state.taxonomy = await api("/api/meta/taxonomy");
}

// ---------- Churches list -----------------------------------------------

el("#admin-search").addEventListener("input", debounce(refreshChurchList, 250));

async function refreshChurchList() {
  const q = el("#admin-search").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("limit", "200");
  state.churches = await api(`/api/churches?${params}`);
  renderChurchList();
}

function renderChurchList() {
  const container = el("#church-list");
  container.innerHTML = "";
  const tpl = el("#church-row");
  for (const ch of state.churches) {
    const node = tpl.content.cloneNode(true);
    const btn = node.querySelector(".church-row");
    btn.querySelector(".row-name").textContent = ch.name;
    btn.querySelector(".row-meta").textContent = [ch.postal_code, ch.city, ch.type]
      .filter(Boolean).join(" · ");
    btn.dataset.id = ch.id;
    if (ch.id === state.selectedId) btn.classList.add("active");
    btn.addEventListener("click", () => selectChurch(ch.id));
    container.appendChild(node);
  }
  if (!state.churches.length) {
    container.innerHTML = "<p style='color:var(--ink-soft);font-size:13px'>Aucun lieu.</p>";
  }
}

// ---------- Church editor -----------------------------------------------

async function selectChurch(id) {
  state.selectedId = id;
  els(".church-row").forEach((r) => r.classList.toggle("active", Number(r.dataset.id) === id));
  const detail = await api(`/api/admin/churches/${id}`);
  renderChurchEditor(detail);
}

function renderChurchEditor(c) {
  const root = el("#church-editor");
  root.innerHTML = "";

  const h = document.createElement("h2");
  h.textContent = c.name;
  root.appendChild(h);

  const fields = [
    ["name", "Nom", "text", true],
    ["type", "Type", "select-church-type"],
    ["community", "Communauté", "select-community"],
    ["address", "Adresse", "text", true],
    ["city", "Ville"],
    ["postal_code", "Code postal"],
    ["country", "Pays (2 lettres)"],
    ["latitude", "Latitude", "number"],
    ["longitude", "Longitude", "number"],
    ["diocese", "Diocèse"],
    ["website", "Site web", "url", true],
    ["phone", "Téléphone"],
    ["email", "Email"],
    ["description", "Description", "textarea", true],
    ["image_url", "Image URL", "url", true],
  ];

  const grid = document.createElement("div");
  grid.className = "field-grid";
  const inputs = {};

  for (const [key, label, kind = "text", full = false] of fields) {
    const lbl = document.createElement("label");
    if (full) lbl.classList.add("full");
    const span = document.createElement("span");
    span.textContent = label;
    lbl.appendChild(span);

    let input;
    if (kind === "textarea") {
      input = document.createElement("textarea");
    } else if (kind === "select-church-type") {
      input = buildSelect(state.taxonomy.church_types);
    } else if (kind === "select-community") {
      input = buildSelect([{ value: "", label: "—" }, ...state.taxonomy.communities]);
    } else {
      input = document.createElement("input");
      input.type = kind;
    }
    input.value = c[key] ?? "";
    input.dataset.field = key;
    inputs[key] = input;
    lbl.appendChild(input);
    grid.appendChild(lbl);
  }
  root.appendChild(grid);

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.textContent = "💾 Enregistrer le lieu";
  saveBtn.addEventListener("click", async () => {
    const payload = {};
    for (const [key, input] of Object.entries(inputs)) {
      let v = input.value.trim();
      if (input.type === "number") v = v === "" ? null : Number(v);
      payload[key] = v === "" ? null : v;
    }
    await api(`/api/admin/churches/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await refreshChurchList();
    await selectChurch(c.id);
    flashOutput("✓ Lieu mis à jour");
  });
  root.appendChild(saveBtn);

  // Celebrations
  const h3 = document.createElement("h3");
  h3.textContent = "Célébrations";
  root.appendChild(h3);

  const ul = document.createElement("ul");
  ul.className = "celebrations-list";
  const sortedCels = [...c.celebrations].sort((a, b) => {
    const da = a.day_of_week ?? -1, db = b.day_of_week ?? -1;
    if (da !== db) return da - db;
    return (a.start_time || "").localeCompare(b.start_time || "");
  });
  for (const cel of sortedCels) ul.appendChild(buildCelebrationRow(cel, c.id));
  root.appendChild(ul);

  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Ajouter une célébration";
  addBtn.addEventListener("click", async () => {
    await api("/api/celebrations", {
      method: "POST",
      body: JSON.stringify({
        church_id: c.id, type: "mass", rite: "ordinary",
        day_of_week: 6, start_time: "10:30", confidence: 1.0,
      }),
    });
    await selectChurch(c.id);
  });
  root.appendChild(addBtn);

  // Action buttons
  const actions = document.createElement("div");
  actions.className = "actions-row";

  const reimportBtn = document.createElement("button");
  reimportBtn.className = "gold";
  reimportBtn.textContent = "🔄 Réimporter les horaires depuis le site";
  reimportBtn.disabled = !c.website;
  reimportBtn.addEventListener("click", () => reimportCelebrations(c.id, false));
  actions.appendChild(reimportBtn);

  const previewBtn = document.createElement("button");
  previewBtn.textContent = "🔍 Diagnostiquer (preview)";
  previewBtn.disabled = !c.website;
  previewBtn.addEventListener("click", () => previewUrl(c.website));
  actions.appendChild(previewBtn);

  const mergeBtn = document.createElement("button");
  mergeBtn.textContent = "🔗 Fusionner avec…";
  mergeBtn.addEventListener("click", () => openMergeModal(c));
  actions.appendChild(mergeBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "danger";
  deleteBtn.textContent = "🗑 Supprimer ce lieu";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Supprimer définitivement « ${c.name} » ?`)) return;
    await api(`/api/admin/churches/${c.id}`, { method: "DELETE" });
    state.selectedId = null;
    el("#church-editor").innerHTML = "<p class='placeholder'>Lieu supprimé.</p>";
    await refreshChurchList();
  });
  actions.appendChild(deleteBtn);

  root.appendChild(actions);

  const out = document.createElement("pre");
  out.id = "action-output";
  out.className = "action-output";
  root.appendChild(out);
}

function buildSelect(items) {
  const sel = document.createElement("select");
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it.value;
    opt.textContent = it.label;
    sel.appendChild(opt);
  }
  return sel;
}

function buildCelebrationRow(cel, churchId) {
  const tpl = el("#celebration-row");
  const node = tpl.content.cloneNode(true);
  const li = node.querySelector(".cel-row");
  const day = li.querySelector(".cel-day");
  day.value = cel.day_of_week == null ? "" : String(cel.day_of_week);
  li.querySelector(".cel-time").value = (cel.start_time || "").slice(0, 5);
  const typeSel = li.querySelector(".cel-type");
  for (const it of state.taxonomy.celebration_types) {
    const opt = document.createElement("option");
    opt.value = it.value; opt.textContent = it.label;
    typeSel.appendChild(opt);
  }
  typeSel.value = cel.type;
  li.querySelector(".cel-rite").value = cel.rite || "ordinary";
  li.querySelector(".cel-lang").value = cel.language || "";

  li.querySelector(".cel-save").addEventListener("click", async () => {
    const payload = {
      day_of_week: day.value === "" ? null : Number(day.value),
      start_time: li.querySelector(".cel-time").value || null,
      type: typeSel.value,
      rite: li.querySelector(".cel-rite").value,
      language: li.querySelector(".cel-lang").value.trim() || null,
    };
    await api(`/api/admin/celebrations/${cel.id}`, {
      method: "PATCH", body: JSON.stringify(payload),
    });
    flashOutput("✓ Célébration enregistrée");
  });

  li.querySelector(".cel-delete").addEventListener("click", async () => {
    if (!confirm("Supprimer cette célébration ?")) return;
    await api(`/api/admin/celebrations/${cel.id}`, { method: "DELETE" });
    await selectChurch(churchId);
  });

  return node;
}

// ---------- Reimport / preview ------------------------------------------

async function reimportCelebrations(id, force) {
  flashOutput("Réimport en cours…");
  try {
    const params = new URLSearchParams({ force: force ? "true" : "false" });
    const report = await api(`/api/admin/churches/${id}/reimport?${params}`, {
      method: "POST",
    });
    flashOutput(JSON.stringify(report, null, 2));
    await selectChurch(id);
  } catch (err) {
    if (err.status === 451) {
      const ok = confirm(
        "Le site bloque les robots via robots.txt.\n" +
        "Réessayer en ignorant robots.txt ? (Tu prends la responsabilité.)"
      );
      if (ok) return reimportCelebrations(id, true);
      flashOutput("Annulé — robots.txt respecté.");
    } else {
      flashOutput("Erreur: " + err.message);
    }
  }
}

async function previewUrl(url) {
  flashOutput("Analyse…");
  try {
    const data = await fetch(apiBase() + "/api/ingest/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, force: true }),
    }).then((r) => r.json());
    flashOutput(JSON.stringify(data, null, 2));
  } catch (err) {
    flashOutput("Erreur: " + err.message);
  }
}

function flashOutput(text) {
  const out = el("#action-output");
  if (out) out.textContent = text;
}

// ---------- Merge modal --------------------------------------------------

let mergeSource = null;

function openMergeModal(source) {
  mergeSource = source;
  el("#merge-source-name").textContent = source.name;
  el("#merge-search").value = "";
  el("#merge-results").innerHTML = "";
  el("#merge-modal").classList.remove("hidden");
}

el("#btn-merge-cancel").addEventListener("click", () => {
  el("#merge-modal").classList.add("hidden");
  mergeSource = null;
});

el("#merge-search").addEventListener("input", debounce(async () => {
  const q = el("#merge-search").value.trim();
  if (q.length < 2 || !mergeSource) return;
  const churches = await api(`/api/churches?q=${encodeURIComponent(q)}&limit=20`);
  const out = el("#merge-results");
  out.innerHTML = "";
  for (const ch of churches) {
    if (ch.id === mergeSource.id) continue;
    const btn = document.createElement("button");
    btn.className = "church-row";
    btn.innerHTML = `<span class="row-name">${ch.name}</span>` +
      `<span class="row-meta">${[ch.postal_code, ch.city, ch.type].filter(Boolean).join(" · ")}</span>`;
    btn.addEventListener("click", () => doMerge(mergeSource, ch));
    out.appendChild(btn);
  }
}, 250));

async function doMerge(source, target) {
  if (!confirm(
    `Fusionner :\n  « ${source.name} »\n→ « ${target.name} »\n\n` +
    `« ${source.name} » sera SUPPRIMÉ et ses célébrations déplacées.`
  )) return;
  const report = await api(
    `/api/admin/churches/${source.id}/merge-into/${target.id}`,
    { method: "POST" },
  );
  el("#merge-modal").classList.add("hidden");
  state.selectedId = target.id;
  await refreshChurchList();
  await selectChurch(target.id);
  flashOutput("✓ Fusion terminée\n" + JSON.stringify(report, null, 2));
}

// ---------- Utils --------------------------------------------------------

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Boot ---------------------------------------------------------

if (state.token) {
  // Optimistic — try to use the saved token; fall back to login on 401.
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
