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
  // Re-apply the current view layout (list-only, map-only, or split).
  applyViewLayout();
  renderList();
  renderMap();
}

function renderList() {
  const list = el("#list-view");
  list.innerHTML = "";
  const tpl = el("#church-card");
  const PREVIEW_CELEBRATIONS = 3;
  for (const item of state.results.items) {
    const node = tpl.content.cloneNode(true);
    const c = item.church;
    node.querySelector(".name").textContent = c.name;
    node.querySelector(".badge").textContent = churchTypeLabel(c.type);

    // Meta: address+city if we have them, otherwise fall back to community
    // or church-type label so the line is never empty.
    const locBits = [c.address, c.postal_code, c.city].filter(Boolean);
    const metaParts = [];
    if (locBits.length) metaParts.push(locBits.join(" · "));
    else if (c.city) metaParts.push(c.city);
    if (c.community) metaParts.push(communityLabel(c.community));
    node.querySelector(".meta").textContent =
      metaParts.join(" — ") || churchTypeLabel(c.type);

    const cels = node.querySelector(".celebrations");
    const all = [...(item.matched_celebrations || [])].sort((a, b) => {
      const da = a.day_of_week ?? -1;
      const db = b.day_of_week ?? -1;
      if (da !== db) return da - db;
      return (a.start_time || "").localeCompare(b.start_time || "");
    });
    const preview = all.slice(0, PREVIEW_CELEBRATIONS);

    if (!all.length) {
      const li = document.createElement("li");
      li.className = "no-celebrations";
      li.textContent = "Aucun horaire importé pour ce lieu.";
      cels.appendChild(li);
    }
    for (const cel of preview) {
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
    if (all.length > PREVIEW_CELEBRATIONS) {
      const more = document.createElement("li");
      more.className = "more-celebrations";
      more.textContent = `+ ${all.length - PREVIEW_CELEBRATIONS} autres horaires →`;
      cels.appendChild(more);
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

    // Dedicated "Fiche →" link — the only way to open the detail page now
    // that clicking the card itself focuses the map.
    const footer = node.querySelector(".card-footer");
    const detail = document.createElement("a");
    detail.className = "detail-link";
    detail.href = `church.html?id=${c.id}`;
    detail.textContent = "Fiche →";
    footer.insertBefore(detail, footer.firstChild);

    // Clicking anywhere on the card (except an explicit link) focuses the
    // pin on the map and opens its popup. The map auto-shows if hidden.
    const card = node.querySelector(".card");
    card.dataset.churchId = c.id;
    card.style.cursor = "pointer";
    card.tabIndex = 0;
    const openMap = (e) => {
      if (e?.target?.closest("a")) return;
      focusOnMap(c.id);
    };
    card.addEventListener("click", openMap);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        focusOnMap(c.id);
      }
    });

    // Airbnb-style: hovering a card highlights its pin on the map.
    card.addEventListener("mouseenter", () => highlightMarker(c.id, true));
    card.addEventListener("mouseleave", () => highlightMarker(c.id, false));

    list.appendChild(node);
  }
}

function highlightMarker(churchId, on) {
  const marker = state.markersByChurch?.[churchId];
  if (!marker) return;
  const elNode = marker.getElement();
  if (!elNode) return;
  const pin = elNode.querySelector(".church-pin");
  if (pin) pin.classList.toggle("highlighted", on);
}

// Click on a list card: zoom the map onto the church and open the popup.
// If no marker (church has no coords), fall back to the detail page.
function focusOnMap(churchId) {
  const marker = state.markersByChurch?.[churchId];
  if (!marker) {
    window.location.href = `church.html?id=${churchId}`;
    return;
  }
  // Bring the map into view (no-op if already in split-mode or map view).
  if (document.body.dataset.view !== "map") setActiveView("map");
  setTimeout(() => {
    state.map?.flyTo(marker.getLatLng(), 16, { duration: 0.7 });
    marker.openPopup();
  }, 220);
}

function renderMap() {
  const container = el("#map-view");
  if (!state.map) {
    state.map = L.map(container, { zoomControl: true }).setView([46.6, 2.5], 5);
    // Minimal grayscale tiles — much less visual noise than the
    // default OSM tiles (and Leaflet's default PNG markers don't load
    // reliably through unpkg, so we use a CSS divIcon below).
    // CartoDB Voyager: warm, colorful, Airbnb-ish — water in blue, parks in
    // green, roads with subtle hierarchy. Much friendlier than Positron.
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution: "© OpenStreetMap · © CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      },
    ).addTo(state.map);
    state.markersLayer = L.layerGroup().addTo(state.map);
  }
  state.markersLayer.clearLayers();
  state.markersByChurch = {};
  const points = [];
  for (const item of state.results.items) {
    const c = item.church;
    if (c.latitude == null || c.longitude == null) continue;
    const marker = L.marker([c.latitude, c.longitude], { icon: churchIcon() });
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
    state.markersByChurch[c.id] = marker;
    points.push([c.latitude, c.longitude]);
  }
  if (points.length) {
    state.map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
  }
  setTimeout(() => state.map.invalidateSize(), 100);
}

// CSS-styled marker so we don't depend on Leaflet's default PNG icons
// (which sometimes 404 from CDNs and leave the map mute).
function churchIcon() {
  return L.divIcon({
    className: "church-marker",
    html: '<div class="church-pin" aria-hidden="true">✚</div>',
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  });
}

// ---------- View toggle ---------------------------------------------------

// On desktop the map opens beside the list (Airbnb-style split). On mobile
// it's still a one-or-the-other toggle. applyViewLayout() reads body.dataset.view
// and the viewport width, then resolves what to actually show.
function applyViewLayout() {
  const view = document.body.dataset.view || "list";
  const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
  const splitMode = isDesktop && view === "map";

  document.body.classList.toggle("split-mode", splitMode);

  // In split mode both panes are visible. Otherwise only the active one.
  el("#list-view").classList.toggle("hidden", view === "map" && !splitMode);
  el("#map-view").classList.toggle("hidden", view === "list");

  els(".view-toggle button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view));

  if (view === "map" || splitMode) {
    setTimeout(() => state.map?.invalidateSize(), 80);
  }
}

function setActiveView(view) {
  document.body.dataset.view = view;
  applyViewLayout();
}

window.addEventListener("resize", applyViewLayout);

els(".view-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

// ---------- Geolocation --------------------------------------------------

el("#btn-geoloc").addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Géolocalisation indisponible dans ce navigateur.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      el("#f-lat").value = lat.toFixed(5);
      el("#f-lon").value = lon.toFixed(5);
      if (!el("#f-radius").value) el("#f-radius").value = "10";
      // Run the search first so markers render around the user's spot.
      await runSearch();
      // Then center the map and pin the user position. Falls back to
      // setView if flyTo fails (e.g. map not yet sized).
      if (state.map) {
        try {
          state.map.flyTo([lat, lon], 14, { duration: 0.8 });
        } catch {
          state.map.setView([lat, lon], 14);
        }
        if (state.userMarker) state.userMarker.remove();
        state.userMarker = L.circleMarker([lat, lon], {
          radius: 9,
          fillColor: "#2563eb",
          color: "#ffffff",
          weight: 3,
          fillOpacity: 1,
        }).addTo(state.map).bindPopup("Vous êtes ici");
      }
      // If the user is on the list view, also flip to the map so they
      // see the result of geolocating.
      const mapToggle = els(".view-toggle button").find((b) => b.dataset.view === "map");
      if (mapToggle) mapToggle.click();
    },
    (err) => alert("Géolocalisation refusée: " + err.message),
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
  document.body.classList.add("filters-open");
  setTimeout(() => state.map?.invalidateSize(), 220);
}
function closeFilters() {
  el("#filter-panel").classList.add("hidden");
  el("#filter-backdrop").classList.add("hidden");
  document.body.classList.remove("filters-open");
  setTimeout(() => state.map?.invalidateSize(), 220);
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

// ---------- Bottom nav (mobile) ------------------------------------------

function showListView() { setActiveView("list"); }
function showMapView() { setActiveView("map"); }

function triggerGeoloc() {
  if (!navigator.geolocation) {
    alert("Géolocalisation indisponible dans ce navigateur.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      el("#f-lat").value = lat.toFixed(5);
      el("#f-lon").value = lon.toFixed(5);
      if (!el("#f-radius").value) el("#f-radius").value = "10";
      await runSearch();
      if (state.map) {
        try { state.map.flyTo([lat, lon], 14, { duration: 0.8 }); }
        catch { state.map.setView([lat, lon], 14); }
        if (state.userMarker) state.userMarker.remove();
        state.userMarker = L.circleMarker([lat, lon], {
          radius: 9, fillColor: "#2563eb", color: "#fff",
          weight: 3, fillOpacity: 1,
        }).addTo(state.map).bindPopup("Vous êtes ici");
      }
      showMapView();
    },
    (err) => alert("Géolocalisation refusée: " + err.message),
  );
}

// Direct DOM manipulation: no programmatic .click() on hidden elements,
// no relying on bubbling through other handlers. Try/catch so a bug
// anywhere surfaces visibly instead of failing silently.
els(".bottom-nav-item").forEach((btn) => {
  // The Admin anchor really navigates; leave it alone.
  if (btn.tagName === "A" && btn.getAttribute("href") !== "/") return;
  btn.addEventListener("click", (e) => {
    try {
      e.preventDefault();
      const action = btn.dataset.nav;
      els(".bottom-nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (action === "filters") {
        openFilters();
      } else if (action === "geoloc") {
        triggerGeoloc();
      } else if (action === "map") {
        showMapView();
      } else if (action === "list") {
        showListView();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      alert("Erreur menu (" + (btn.dataset.nav || "?") + ") : " + err.message);
      console.error("Bottom-nav handler error", err);
    }
  });
});

// ---------- Boot ---------------------------------------------------------

(async function init() {
  if (!document.body.dataset.view) document.body.dataset.view = "list";
  await loadTaxonomy();
  await runSearch();
})();
