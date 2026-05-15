"use strict";

// =========================================================================
// State
// =========================================================================

const state = {
  filters: {
    type: new Set(),
    celebration_type: new Set(),
    community: new Set(),
    rite: new Set(),
  },
  taxonomy: null,
  results: { total: 0, items: [] },
  selectedId: null,
  map: null,
  miniMap: null,
  markersLayer: null,
  miniMarkersLayer: null,
};

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const DAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

(function initApiBase() {
  const input = $("#api-base");
  const host = window.location.hostname;
  input.value = host === "localhost" || host === "127.0.0.1" ? "http://localhost:8000" : "";
})();
const apiBase = () => $("#api-base").value.replace(/\/$/, "");

async function api(path, options = {}) {
  const res = await fetch(apiBase() + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// =========================================================================
// Taxonomy + label helpers
// =========================================================================

async function loadTaxonomy() {
  try {
    state.taxonomy = await api("/api/meta/taxonomy");
    renderAdvancedFilters();
  } catch (err) {
    showState("error", "API injoignable — " + err.message);
  }
}

function labelFor(items, value) {
  return items?.find((x) => x.value === value)?.label ?? value;
}

function shortCelebrationLabel(value) {
  const map = {
    mass: "messe", lauds: "laudes", vespers: "vêpres", compline: "complies",
    adoration: "adoration", confession: "confession", chaplet: "chapelet",
    vigil: "vigile", tierce: "tierce", sext: "sexte",
    none_office: "none", office_of_readings: "matines",
  };
  return map[value] ?? labelFor(state.taxonomy?.celebration_types, value);
}

function renderAdvancedFilters() {
  for (const [key, items, ctxId] of [
    ["type", state.taxonomy.church_types, "#f-church-types"],
    ["community", state.taxonomy.communities, "#f-communities"],
    ["rite", state.taxonomy.rites, "#f-rites"],
  ]) {
    const root = $(ctxId);
    if (!root) continue;
    root.innerHTML = "";
    for (const it of items) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = it.label;
      chip.addEventListener("click", () => {
        const set = state.filters[key];
        if (set.has(it.value)) {
          set.delete(it.value);
          chip.classList.remove("active");
        } else {
          set.add(it.value);
          chip.classList.add("active");
        }
      });
      root.appendChild(chip);
    }
  }
}

// =========================================================================
// Search
// =========================================================================

function buildQuery() {
  const params = new URLSearchParams();
  const q = $("#f-query").value.trim() || $("#f-query-mobile")?.value.trim();
  if (q) params.set("q", q);
  const city = $("#f-city")?.value.trim(); if (city) params.set("city", city);
  const postal = $("#f-postal")?.value.trim(); if (postal) params.set("postal_code", postal);
  for (const [k, set] of Object.entries(state.filters))
    for (const v of set) params.append(k, v);
  // Quick-pill celebration filter
  const activePill = $(".filter-pills .pill.active[data-celeb]");
  if (activePill?.dataset.celeb) params.append("celebration_type", activePill.dataset.celeb);
  const activeRite = $(".filter-pills .pill.active[data-celeb-rite]");
  if (activeRite?.dataset.celebRite) params.append("rite", activeRite.dataset.celebRite);
  const day = $("#f-day")?.value; if (day) params.set("day_of_week", day);
  const after = $("#f-after")?.value; if (after) params.set("after", after);
  const before = $("#f-before")?.value; if (before) params.set("before", before);
  const lat = $("#f-lat")?.value, lon = $("#f-lon")?.value, radius = $("#f-radius")?.value;
  if (lat && lon && radius) {
    params.set("latitude", lat); params.set("longitude", lon); params.set("radius_km", radius);
  }
  return params;
}

async function runSearch() {
  showState("loading");
  try {
    const data = await api("/api/search?" + buildQuery().toString());
    state.results = data;
    renderResults();
  } catch (err) {
    showState("error", err.message);
  }
}

function showState(kind, message = "") {
  $("#church-list").classList.toggle("hidden", kind === "loading" || kind === "empty" || kind === "error");
  for (const s of ["loading", "empty", "error"])
    $(`#${s}-state`).classList.toggle("hidden", s !== kind);
  if (kind === "error") $("#error-message").textContent = message;
}

function hideStates() {
  for (const s of ["loading", "empty", "error"]) $(`#${s}-state`).classList.add("hidden");
  $("#church-list").classList.remove("hidden");
}

// =========================================================================
// Rendering : list, map, detail
// =========================================================================

function renderResults() {
  $("#results-count").textContent = state.results.total;
  const lieux = state.results.items.length;
  const offices = state.results.items.reduce((sum, it) => sum + it.matched_celebrations.length, 0);
  for (const id of ["#lieux-count", "#map-lieux-count", "#mini-lieux-count"])
    if ($(id)) $(id).textContent = lieux;
  for (const id of ["#map-offices-count", "#mini-offices-count"])
    if ($(id)) $(id).textContent = offices;

  if (state.results.items.length === 0) { showState("empty"); return; }
  hideStates();

  renderList();
  renderMap();
  renderMiniMap();
}

function renderList() {
  const list = $("#church-list");
  list.innerHTML = "";
  for (const item of state.results.items) {
    list.appendChild(buildChurchRow(item));
  }
}

function buildChurchRow(item) {
  const { church, matched_celebrations, distance_km } = item;
  const row = document.createElement("button");
  row.type = "button";
  row.className = "church-row";
  row.dataset.churchId = church.id;
  if (church.id === state.selectedId) row.classList.add("active");

  // Main column
  const main = document.createElement("div");
  main.className = "church-row-main";
  const name = document.createElement("div");
  name.className = "church-name";
  name.textContent = church.name;
  main.appendChild(name);
  const subtitle = document.createElement("div");
  subtitle.className = "church-subtitle";
  subtitle.textContent = [
    church.city,
    labelFor(state.taxonomy?.church_types, church.type),
    church.community ? labelFor(state.taxonomy?.communities, church.community) : null,
  ].filter(Boolean).join(" · ");
  main.appendChild(subtitle);
  row.appendChild(main);

  // Distance
  if (distance_km != null) {
    const d = document.createElement("div");
    d.className = "church-distance";
    d.textContent = `${distance_km.toFixed(1)} KM`;
    row.appendChild(d);
  }

  // Time chips (top 4 + "+N")
  const chips = document.createElement("div");
  chips.className = "time-chips";
  const todayDow = (new Date().getDay() + 6) % 7;
  const todays = matched_celebrations
    .filter((c) => c.day_of_week === todayDow || c.day_of_week == null)
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
  const upcoming = todays.length ? todays : [...matched_celebrations]
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
  const preview = upcoming.slice(0, 4);
  const more = upcoming.length - preview.length;

  for (const cel of preview) {
    const chip = document.createElement("span");
    chip.className = "time-chip";
    if (isSoon(cel)) chip.classList.add("soon");
    const t = document.createElement("span");
    t.textContent = formatTime(cel.start_time);
    const e = document.createElement("em");
    e.textContent = shortCelebrationLabel(cel.type);
    chip.appendChild(t);
    chip.appendChild(e);
    chips.appendChild(chip);
  }
  if (more > 0) {
    const m = document.createElement("span");
    m.className = "time-more";
    m.textContent = `+${more}`;
    chips.appendChild(m);
  }
  if (preview.length === 0) {
    const m = document.createElement("span");
    m.className = "time-more";
    m.textContent = "Pas d'horaire";
    chips.appendChild(m);
  }
  row.appendChild(chips);

  row.addEventListener("click", () => selectChurch(item));
  return row;
}

function selectChurch(item) {
  state.selectedId = item.church.id;
  $$(".church-row").forEach((r) =>
    r.classList.toggle("active", Number(r.dataset.churchId) === state.selectedId));

  // On mobile, navigate to the detail page (no room for a right pane).
  if (window.matchMedia("(max-width: 960px)").matches) {
    window.location.href = `church.html?id=${item.church.id}`;
    return;
  }
  renderDetail(item);
  // Recenter map on the selected pin
  if (item.church.latitude != null && state.map) {
    state.map.flyTo([item.church.latitude, item.church.longitude], 16, { duration: 0.6 });
  }
}

function renderDetail(item) {
  const { church, matched_celebrations, distance_km } = item;
  $("#detail-empty").classList.add("hidden");
  $("#detail-content").classList.remove("hidden");

  const metaParts = [
    [church.city, labelFor(state.taxonomy?.church_types, church.type)].filter(Boolean).join(" · "),
    distance_km != null ? `${distance_km.toFixed(1)} KM` : null,
  ].filter(Boolean);
  $("#detail-meta-text").textContent = metaParts.join(" · ");
  $("#detail-name").textContent = church.name;
  $("#detail-subtitle").textContent =
    [church.address, church.postal_code].filter(Boolean).join(" · ") ||
    (church.diocese ? `Diocèse de ${church.diocese}` : "");

  // Badges
  const badges = $("#detail-badges");
  badges.innerHTML = "";
  for (const v of [
    church.community && labelFor(state.taxonomy?.communities, church.community),
    church.diocese && `Diocèse · ${church.diocese}`,
  ].filter(Boolean)) {
    const b = document.createElement("span");
    b.className = "detail-badge";
    b.textContent = v;
    badges.appendChild(b);
  }

  // Next office
  const next = computeNextOffice(matched_celebrations);
  if (next) {
    $("#next-office-time").textContent = formatTime(next.start_time);
    $("#next-office-type").textContent = labelFor(state.taxonomy?.celebration_types, next.type);
    const eta = etaLabel(next);
    $("#next-office-eta").textContent = eta ? `DANS ${eta}` : "";
    const lang = next.language ? next.language.toUpperCase() : null;
    $("#next-office-meta").textContent = [lang, next.notes].filter(Boolean).join(" · ");
    $("#next-office-card").classList.remove("hidden");
  } else {
    $("#next-office-card").classList.add("hidden");
  }

  // All offices today
  const todayDow = (new Date().getDay() + 6) % 7;
  const today = matched_celebrations
    .filter((c) => c.day_of_week === todayDow || c.day_of_week == null)
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
  $("#detail-offices-count").textContent = today.length;
  const ul = $("#detail-offices-list");
  ul.innerHTML = "";
  for (const cel of today) {
    const li = document.createElement("li");
    const t = document.createElement("span");
    t.className = "time";
    t.textContent = formatTime(cel.start_time);
    const ty = document.createElement("span");
    ty.className = "type";
    ty.textContent = labelFor(state.taxonomy?.celebration_types, cel.type);
    const tags = document.createElement("span");
    tags.className = "tags";
    if (isSoon(cel)) {
      const s = document.createElement("span");
      s.className = "tag soon";
      s.textContent = "Bientôt";
      tags.appendChild(s);
    }
    if (cel.language) {
      const l = document.createElement("span");
      l.className = "tag la";
      l.textContent = cel.language.toUpperCase();
      tags.appendChild(l);
    }
    if (cel.rite && cel.rite !== "ordinary") {
      const r = document.createElement("span");
      r.className = "tag la";
      r.textContent = labelFor(state.taxonomy?.rites, cel.rite);
      tags.appendChild(r);
    }
    li.appendChild(t); li.appendChild(ty); li.appendChild(tags);
    ul.appendChild(li);
  }

  $("#detail-full-link").href = `church.html?id=${church.id}`;
}

// =========================================================================
// "Prochain office" computation
// =========================================================================

function computeNextOffice(celebrations) {
  if (!celebrations.length) return null;
  const now = new Date();
  const todayDow = (now.getDay() + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Today, upcoming
  const candidates = celebrations
    .filter((c) => (c.day_of_week === todayDow || c.day_of_week == null) && c.start_time)
    .map((c) => ({
      cel: c,
      min: parseTimeToMinutes(c.start_time),
    }))
    .filter((x) => x.min >= nowMin)
    .sort((a, b) => a.min - b.min);
  if (candidates.length) return candidates[0].cel;
  // First celebration of next available day
  const sorted = [...celebrations]
    .filter((c) => c.start_time)
    .sort((a, b) => {
      const da = a.day_of_week ?? -1, db = b.day_of_week ?? -1;
      if (da !== db) return da - db;
      return a.start_time.localeCompare(b.start_time);
    });
  return sorted[0] || null;
}

function etaLabel(cel) {
  if (!cel.start_time) return "";
  const now = new Date();
  const todayDow = (now.getDay() + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const tMin = parseTimeToMinutes(cel.start_time);
  if (cel.day_of_week === todayDow || cel.day_of_week == null) {
    const diff = tMin - nowMin;
    if (diff < 0) return "";
    if (diff < 60) return `${diff} MIN`;
    if (diff < 24 * 60) return `${Math.floor(diff / 60)} H ${diff % 60} MIN`;
  }
  if (cel.day_of_week != null) return DAY_SHORT[cel.day_of_week].toUpperCase();
  return "";
}

function isSoon(cel) {
  if (!cel.start_time) return false;
  const now = new Date();
  const todayDow = (now.getDay() + 6) % 7;
  if (cel.day_of_week !== todayDow && cel.day_of_week != null) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const t = parseTimeToMinutes(cel.start_time);
  return t >= nowMin && t - nowMin <= 60;
}

function parseTimeToMinutes(s) {
  if (!s) return -1;
  const [h, m] = s.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function formatTime(s) {
  if (!s) return "—";
  return s.slice(0, 5);
}

// =========================================================================
// Map (desktop) + mini-map (mobile)
// =========================================================================

function renderMap() {
  const node = $("#map-view");
  if (!node || node.offsetParent === null) return; // hidden on mobile
  if (!state.map) {
    state.map = L.map(node, { zoomControl: true }).setView([46.6, 2.5], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
    }).addTo(state.map);
    state.markersLayer = L.layerGroup().addTo(state.map);
  }
  drawMarkers(state.map, state.markersLayer);
  setTimeout(() => state.map.invalidateSize(), 60);
}

function renderMiniMap() {
  const node = $("#mini-map");
  if (!node || node.offsetParent === null) return; // hidden on desktop
  if (!state.miniMap) {
    state.miniMap = L.map(node, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: false,
    }).setView([46.6, 2.5], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(state.miniMap);
    state.miniMarkersLayer = L.layerGroup().addTo(state.miniMap);
  }
  drawMarkers(state.miniMap, state.miniMarkersLayer);
  setTimeout(() => state.miniMap.invalidateSize(), 60);
}

function drawMarkers(map, layer) {
  layer.clearLayers();
  const points = [];
  for (const item of state.results.items) {
    const c = item.church;
    if (c.latitude == null || c.longitude == null) continue;
    const marker = L.marker([c.latitude, c.longitude]);
    marker.bindPopup(
      `<strong>${c.name}</strong><br>${labelFor(state.taxonomy?.church_types, c.type)}`
    );
    marker.on("click", () => selectChurch(item));
    layer.addLayer(marker);
    points.push([c.latitude, c.longitude]);
  }
  if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
}

// =========================================================================
// Filter pills (quick celebration filter)
// =========================================================================

function wirePills(scope) {
  $$(`#${scope} .pill`).forEach((pill) => {
    pill.addEventListener("click", () => {
      if (pill.id === "btn-open-filters") return;
      // Toggle: only one active at a time within celebration pills
      const same = $$(`#${scope} .pill`).find((p) => p.classList.contains("active"));
      if (same) same.classList.remove("active");
      if (same !== pill) pill.classList.add("active");
      // Sync the other pill bar (mobile <-> desktop)
      syncOtherPills(scope, pill);
      runSearch();
    });
  });
}
function syncOtherPills(currentScope, currentPill) {
  const other = currentScope === "celebration-pills"
    ? "celebration-pills-mobile" : "celebration-pills";
  const otherRoot = document.getElementById(other);
  if (!otherRoot) return;
  $$(`#${other} .pill`).forEach((p) => p.classList.remove("active"));
  const match = $$(`#${other} .pill`).find(
    (p) => (p.dataset.celeb || "") === (currentPill.dataset.celeb || "")
        && p.dataset.celebRite === currentPill.dataset.celebRite
  );
  if (match && currentPill.classList.contains("active")) match.classList.add("active");
}

// =========================================================================
// Filters slide-over
// =========================================================================

function openFilters() {
  $("#filter-panel").classList.remove("hidden");
  $("#filter-backdrop").classList.remove("hidden");
}
function closeFilters() {
  $("#filter-panel").classList.add("hidden");
  $("#filter-backdrop").classList.add("hidden");
}
$("#btn-open-filters").addEventListener("click", openFilters);
$("#btn-close-filters").addEventListener("click", closeFilters);
$("#filter-backdrop").addEventListener("click", closeFilters);
$("#btn-apply-filters").addEventListener("click", () => { closeFilters(); runSearch(); });
$("#btn-reset").addEventListener("click", () => {
  $$("#filter-panel input").forEach((i) => { if (i.id !== "f-radius") i.value = ""; });
  $("#f-radius").value = "10";
  $("#f-day").value = "";
  for (const set of Object.values(state.filters)) set.clear();
  $$(".chip.active").forEach((c) => c.classList.remove("active"));
  $$(".pill.active").forEach((p, i) => i === 0 || p.classList.remove("active"));
  runSearch();
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFilters(); });

// =========================================================================
// Search input wiring (debounced)
// =========================================================================

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const debouncedSearch = debounce(runSearch, 300);
$("#f-query").addEventListener("input", (e) => {
  const v = e.target.value;
  if ($("#f-query-mobile")) $("#f-query-mobile").value = v;
  debouncedSearch();
});
if ($("#f-query-mobile")) {
  $("#f-query-mobile").addEventListener("input", (e) => {
    $("#f-query").value = e.target.value;
    debouncedSearch();
  });
}

// =========================================================================
// Bottom nav (mobile)
// =========================================================================

$$(".bottom-nav-item").forEach((btn) => {
  if (btn.tagName === "A") return;
  btn.addEventListener("click", () => {
    const action = btn.dataset.nav;
    $$(".bottom-nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (action === "filters") openFilters();
    else if (action === "geoloc") triggerGeoloc();
    else if (action === "map") { document.body.classList.add("map-mode"); renderMap(); }
    else if (action === "list") { document.body.classList.remove("map-mode"); }
  });
});
$("#btn-show-fullmap")?.addEventListener("click", () => {
  document.body.classList.add("map-mode");
  $$(".bottom-nav-item").forEach((b) => b.classList.remove("active"));
  document.querySelector('.bottom-nav-item[data-nav="map"]').classList.add("active");
  renderMap();
});

// =========================================================================
// Geolocation
// =========================================================================

function triggerGeoloc() {
  if (!navigator.geolocation) { alert("Géolocalisation indisponible."); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $("#f-lat").value = pos.coords.latitude.toFixed(5);
      $("#f-lon").value = pos.coords.longitude.toFixed(5);
      if (!$("#f-radius").value) $("#f-radius").value = "10";
      runSearch();
    },
    (err) => alert("Géolocalisation refusée : " + err.message),
  );
}

// =========================================================================
// Ingest (kept from previous app.js, simplified)
// =========================================================================

$("#btn-ingest-area")?.addEventListener("click", async () => {
  const lat = parseFloat($("#f-lat").value), lon = parseFloat($("#f-lon").value);
  const radius = parseFloat($("#f-radius").value || "10");
  if (!lat || !lon) { alert("Renseigne lat/lon d'abord (📍)."); return; }
  $("#ingest-output").textContent = "Recherche OSM…";
  try {
    const r = await api("/api/ingest/osm", { method: "POST",
      body: JSON.stringify({ latitude: lat, longitude: lon, radius_km: radius, limit: 100 }),
    });
    $("#ingest-output").textContent = JSON.stringify(r, null, 2);
    runSearch();
  } catch (e) { $("#ingest-output").textContent = "Erreur: " + e.message; }
});

$("#btn-ingest-url")?.addEventListener("click", async () => {
  const url = $("#ingest-url").value.trim();
  if (!url) return;
  $("#ingest-output").textContent = "Extraction…";
  try {
    const r = await api("/api/ingest/url", { method: "POST",
      body: JSON.stringify({ url }),
    });
    $("#ingest-output").textContent = JSON.stringify(r, null, 2);
    runSearch();
  } catch (e) { $("#ingest-output").textContent = "Erreur: " + e.message; }
});

// =========================================================================
// Boot
// =========================================================================

window.addEventListener("resize", debounce(() => {
  // Re-render the maps when the layout switches
  if (state.map) state.map.invalidateSize();
  if (state.miniMap) state.miniMap.invalidateSize();
}, 200));

(async function init() {
  wirePills("celebration-pills");
  wirePills("celebration-pills-mobile");
  await loadTaxonomy();
  await runSearch();
})();
