"use strict";

// ---------- State ---------------------------------------------------------

const state = {
  filters: {
    type: new Set(),
    celebration_type: new Set(),
    community: new Set(),
    rite: new Set(),
  },
  taxonomy: null,
  results: { total: 0, items: [] },
  map: null,
  markersLayer: null,
};

const el = (sel, ctx = document) => ctx.querySelector(sel);
const els = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

// Default the API base to localhost in dev and same-origin in prod (where
// Caddy reverse-proxies /api/* to the FastAPI container).
(function initApiBase() {
  const input = document.getElementById("api-base");
  if (!input.value) {
    const host = window.location.hostname;
    input.value = host === "localhost" || host === "127.0.0.1" ? "http://localhost:8000" : "";
  }
})();
const apiBase = () => el("#api-base").value.replace(/\/$/, "");

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// ---------- API helpers ---------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(apiBase() + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------- Filter chips --------------------------------------------------

function renderChips(containerId, items, key) {
  const container = el(containerId);
  container.innerHTML = "";
  for (const item of items) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = item.label;
    chip.dataset.value = item.value;
    chip.addEventListener("click", () => {
      const set = state.filters[key];
      if (set.has(item.value)) {
        set.delete(item.value);
        chip.classList.remove("active");
      } else {
        set.add(item.value);
        chip.classList.add("active");
      }
      if (typeof updateActiveFiltersCount === "function") {
        updateActiveFiltersCount();
      }
    });
    container.appendChild(chip);
  }
}

async function loadTaxonomy() {
  try {
    state.taxonomy = await api("/api/meta/taxonomy");
    renderChips("#f-church-types", state.taxonomy.church_types, "type");
    renderChips("#f-celebration-types", state.taxonomy.celebration_types, "celebration_type");
    renderChips("#f-communities", state.taxonomy.communities, "community");
    renderChips("#f-rites", state.taxonomy.rites, "rite");
  } catch (err) {
    console.error("Failed to load taxonomy", err);
    el("#results-title").textContent = "API injoignable — vérifie l'URL en haut à droite.";
  }
}

// ---------- Search --------------------------------------------------------

function buildQuery() {
  const params = new URLSearchParams();
  const q = el("#f-query").value.trim();
  if (q) params.set("q", q);
  const city = el("#f-city").value.trim();
  if (city) params.set("city", city);
  const postal = el("#f-postal").value.trim();
  if (postal) params.set("postal_code", postal);
  for (const [key, set] of Object.entries(state.filters)) {
    for (const v of set) params.append(key, v);
  }
  const day = el("#f-day").value;
  if (day !== "") params.set("day_of_week", day);
  const after = el("#f-after").value;
  if (after) params.set("after", after);
  const before = el("#f-before").value;
  if (before) params.set("before", before);
  const lat = el("#f-lat").value;
  const lon = el("#f-lon").value;
  const radius = el("#f-radius").value;
  if (lat && lon && radius) {
    params.set("latitude", lat);
    params.set("longitude", lon);
    params.set("radius_km", radius);
  }
  return params;
}

async function runSearch() {
  showState("loading");
  try {
    const params = buildQuery();
    const data = await api("/api/search?" + params.toString());
    state.results = data;
    renderResults();
  } catch (err) {
    showState("error", err.message);
  }
}

// ---------- UI states ----------------------------------------------------

function showState(kind, message = "") {
  // Hide content, show the right state card.
  el("#list-view").classList.add("hidden");
  el("#map-view").classList.add("hidden");
  for (const s of ["loading", "empty", "error"]) {
    el(`#${s}-state`).classList.toggle("hidden", s !== kind);
  }
  if (kind === "error") el("#error-message").textContent = message;
}

function hideStates() {
  for (const s of ["loading", "empty", "error"]) {
    el(`#${s}-state`).classList.add("hidden");
  }
}

// ---------- Results rendering --------------------------------------------

function celebrationLabel(value) {
  const item = (state.taxonomy?.celebration_types || []).find((x) => x.value === value);
  return item ? item.label : value;
}

function churchTypeLabel(value) {
  const item = (state.taxonomy?.church_types || []).find((x) => x.value === value);
  return item ? item.label : value;
}

function communityLabel(value) {
  const item = (state.taxonomy?.communities || []).find((x) => x.value === value);
  return item ? item.label : value;
}

function formatTime(t) {
  if (!t) return "";
  return t.slice(0, 5).replace(":", "h");
}

function renderResults() {
  el("#results-count").textContent = state.results.total;
  hideStates();
  if (!state.results.items.length) {
    showState("empty");
    return;
  }
  // Show whichever view is active in the toggle.
  const activeView = el(".view-toggle button.active")?.dataset.view || "list";
  el("#list-view").classList.toggle("hidden", activeView !== "list");
  el("#map-view").classList.toggle("hidden", activeView !== "map");
  renderList();
  renderMap();
  if (activeView === "map") setTimeout(() => state.map?.invalidateSize(), 80);
}

function renderList() {
  const list = el("#list-view");
  list.innerHTML = "";
  const tpl = el("#church-card");
  for (const item of state.results.items) {
    const node = tpl.content.cloneNode(true);
    const c = item.church;
    node.querySelector(".name").textContent = c.name;
    node.querySelector(".badge").textContent = churchTypeLabel(c.type);
    node.querySelector(".meta").textContent =
      [c.address, c.postal_code, c.city].filter(Boolean).join(" · ") +
      (c.community ? ` — ${communityLabel(c.community)}` : "");

    const cels = node.querySelector(".celebrations");
    const sorted = [...item.matched_celebrations].sort((a, b) => {
      const da = a.day_of_week ?? -1;
      const db = b.day_of_week ?? -1;
      if (da !== db) return da - db;
      return (a.start_time || "").localeCompare(b.start_time || "");
    });
    if (!sorted.length) {
      const li = document.createElement("li");
      li.textContent = "Pas de célébration enregistrée.";
      cels.appendChild(li);
    }
    for (const cel of sorted) {
      const li = document.createElement("li");
      const time = document.createElement("span");
      time.className = "time";
      const day = cel.day_of_week == null ? "Quotidien" : DAY_LABELS[cel.day_of_week];
      time.textContent = `${day} ${formatTime(cel.start_time)}`;
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = " · " + celebrationLabel(cel.type);
      li.appendChild(time);
      li.appendChild(label);
      const extra = [];
      if (cel.rite && cel.rite !== "ordinary") extra.push(cel.rite);
      if (cel.language) extra.push(cel.language.toUpperCase());
      if (extra.length) {
        const ex = document.createElement("span");
        ex.className = "extra";
        ex.textContent = `(${extra.join(", ")})`;
        li.appendChild(ex);
      }
      cels.appendChild(li);
    }

    const link = node.querySelector(".website");
    if (c.website) {
      link.href = c.website;
      link.textContent = "Site web ↗";
    } else {
      link.remove();
    }
    if (item.distance_km != null) {
      node.querySelector(".distance").textContent = `${item.distance_km} km`;
    }

    // Make the whole card a link to the detail page, except for the
    // explicit website link which keeps its native external behavior.
    const card = node.querySelector(".card");
    card.dataset.churchId = c.id;
    card.style.cursor = "pointer";
    card.tabIndex = 0;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".website")) return;
      window.location.href = `church.html?id=${c.id}`;
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.location.href = `church.html?id=${c.id}`;
      }
    });

    list.appendChild(node);
  }
}

function renderMap() {
  const container = el("#map-view");
  if (!state.map) {
    state.map = L.map(container).setView([46.6, 2.5], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 18,
    }).addTo(state.map);
    state.markersLayer = L.layerGroup().addTo(state.map);
  }
  state.markersLayer.clearLayers();
  const points = [];
  for (const item of state.results.items) {
    const c = item.church;
    if (c.latitude == null || c.longitude == null) continue;
    const marker = L.marker([c.latitude, c.longitude]);
    const cels = item.matched_celebrations
      .slice(0, 5)
      .map((cel) => {
        const day = cel.day_of_week == null ? "Quotidien" : DAY_LABELS[cel.day_of_week];
        return `<li>${day} ${formatTime(cel.start_time)} — ${celebrationLabel(cel.type)}</li>`;
      })
      .join("");
    marker.bindPopup(
      `<a href="church.html?id=${c.id}" style="font-weight:600;color:#8b1a1a;text-decoration:none">${c.name}</a>` +
      `<br><em style="color:#8a7a6b">${churchTypeLabel(c.type)}</em><br>` +
      [c.address, c.city].filter(Boolean).join(", ") +
      `<ul style="padding-left: 18px; margin: 6px 0">${cels}</ul>` +
      `<a href="church.html?id=${c.id}" style="color:#8b1a1a">Voir la fiche →</a>`
    );
    state.markersLayer.addLayer(marker);
    points.push([c.latitude, c.longitude]);
  }
  if (points.length) {
    state.map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
  }
  setTimeout(() => state.map.invalidateSize(), 100);
}

// ---------- View toggle ---------------------------------------------------

els(".view-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    els(".view-toggle button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    el("#list-view").classList.toggle("hidden", view !== "list");
    el("#map-view").classList.toggle("hidden", view !== "map");
    if (view === "map") setTimeout(() => state.map?.invalidateSize(), 100);
  });
});

// ---------- Geolocation --------------------------------------------------

el("#btn-geoloc").addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Géolocalisation indisponible dans ce navigateur.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el("#f-lat").value = pos.coords.latitude.toFixed(5);
      el("#f-lon").value = pos.coords.longitude.toFixed(5);
    },
    (err) => alert("Géolocalisation refusée: " + err.message)
  );
});

// ---------- Reset / search -----------------------------------------------

el("#btn-search").addEventListener("click", runSearch);
el("#f-query").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
el("#btn-reset").addEventListener("click", () => {
  els("input[id^='f-']").forEach((i) => { if (i.id !== "f-radius") i.value = ""; });
  el("#f-day").value = "";
  el("#f-radius").value = "10";
  for (const set of Object.values(state.filters)) set.clear();
  els(".chip.active").forEach((c) => c.classList.remove("active"));
  updateActiveFiltersCount();
  runSearch();
});

// ---------- Filter slide-over ----------------------------------------------

function openFilters() {
  el("#filter-panel").classList.remove("hidden");
  el("#filter-backdrop").classList.remove("hidden");
}
function closeFilters() {
  el("#filter-panel").classList.add("hidden");
  el("#filter-backdrop").classList.add("hidden");
}
el("#btn-open-filters").addEventListener("click", openFilters);
el("#btn-close-filters").addEventListener("click", closeFilters);
el("#btn-close-filters-2").addEventListener("click", closeFilters);
el("#filter-backdrop").addEventListener("click", closeFilters);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeFilters();
});
el("#btn-apply-filters").addEventListener("click", () => {
  closeFilters();
  updateActiveFiltersCount();
  runSearch();
});

function updateActiveFiltersCount() {
  let n = 0;
  for (const set of Object.values(state.filters)) n += set.size;
  for (const id of ["f-city", "f-postal", "f-day", "f-after", "f-before", "f-lat", "f-lon"]) {
    if (el("#" + id).value) n += 1;
  }
  const badge = el("#active-filters-count");
  if (n === 0) {
    badge.classList.add("hidden");
  } else {
    badge.classList.remove("hidden");
    badge.textContent = n;
  }
}

// Recount active filters whenever a filter input changes.
els("#filter-panel input, #filter-panel select").forEach((input) => {
  input.addEventListener("change", updateActiveFiltersCount);
});

// ---------- Ingestion ----------------------------------------------------

el("#btn-ingest-area").addEventListener("click", async () => {
  const lat = parseFloat(el("#f-lat").value);
  const lon = parseFloat(el("#f-lon").value);
  const radius = parseFloat(el("#f-radius").value || "10");
  if (!lat || !lon) {
    alert("Renseigne d'abord une latitude/longitude (utilise 📍).");
    return;
  }
  el("#ingest-output").textContent = "Recherche OSM en cours…";
  try {
    const report = await api("/api/ingest/osm", {
      method: "POST",
      body: JSON.stringify({ latitude: lat, longitude: lon, radius_km: radius, limit: 100 }),
    });
    el("#ingest-output").textContent = JSON.stringify(report, null, 2);
    runSearch();
  } catch (err) {
    el("#ingest-output").textContent = "Erreur: " + err.message;
  }
});

async function ingestUrl(url, { force = false } = {}) {
  const res = await fetch(apiBase() + "/api/ingest/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, force }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

el("#btn-ingest-url").addEventListener("click", async () => {
  const url = el("#ingest-url").value.trim();
  if (!url) return;
  el("#ingest-output").textContent = "Analyse de la page…";
  try {
    let { status, body } = await ingestUrl(url);

    // 451 = robots.txt blocks us. Offer to retry with explicit override.
    if (status === 451) {
      const detail = body.detail || {};
      const ok = window.confirm(
        `Le site ${url} bloque les robots via robots.txt.\n\n` +
        `Réessayer en ignorant robots.txt ?\n` +
        `(Tu prends la responsabilité de cet appel — à utiliser uniquement ` +
        `pour des pages d'horaires explicitement publiques.)`
      );
      if (!ok) {
        el("#ingest-output").textContent =
          "Annulé — robots.txt respecté.\n" + (detail.message || "");
        return;
      }
      ({ status, body } = await ingestUrl(url, { force: true }));
    }

    if (status >= 200 && status < 300) {
      el("#ingest-output").textContent = JSON.stringify(body, null, 2);
      runSearch();
    } else {
      el("#ingest-output").textContent =
        `Erreur ${status}: ${JSON.stringify(body, null, 2)}`;
    }
  } catch (err) {
    el("#ingest-output").textContent = "Erreur: " + err.message;
  }
});

// ---------- Boot ---------------------------------------------------------

(async function init() {
  await loadTaxonomy();
  await runSearch();
})();
