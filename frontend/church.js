"use strict";

// =========================================================================
// Detail page — fetches /api/churches/{id} and renders.
// =========================================================================

const $ = (s, c = document) => c.querySelector(s);

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const DAY_LABELS_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

const apiBase = (() => {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8000";
  return ""; // same-origin in production
})();

let TAXONOMY = null;

// =========================================================================
// Bootstrap
// =========================================================================

(async function init() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id || !/^\d+$/.test(id)) {
    showError("Identifiant manquant ou invalide.");
    return;
  }

  try {
    [TAXONOMY] = await Promise.all([
      fetchJSON("/api/meta/taxonomy"),
    ]);
    const detail = await fetchJSON(`/api/churches/${id}`);
    renderDetail(detail);
  } catch (err) {
    showError(err.message);
  }
})();

async function fetchJSON(path) {
  const res = await fetch(apiBase + path);
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = await res.text(); }
    throw new Error(typeof body === "string" ? `${res.status} ${body}` : (body.detail || `${res.status}`));
  }
  return res.json();
}

function showError(msg) {
  $("#loading-state").classList.add("hidden");
  $("#error-state").classList.remove("hidden");
  $("#error-message").textContent = msg;
}

// =========================================================================
// Rendering
// =========================================================================

function labelFor(items, value, fallback) {
  return items?.find((x) => x.value === value)?.label ?? (fallback ?? value);
}

function renderDetail(c) {
  document.title = `${c.name} · LeParvis`;

  $("#loading-state").classList.add("hidden");
  $("#detail-content").classList.remove("hidden");

  // Hero
  $("#church-name").textContent = c.name;
  const subtitle = [c.address, c.postal_code, c.city].filter(Boolean).join(" · ");
  $("#church-subtitle").textContent = subtitle || "Adresse non renseignée";
  const typeBadge = $("#church-type-badge");
  typeBadge.textContent = labelFor(TAXONOMY.church_types, c.type, "Lieu");
  typeBadge.style.background = "var(--gold)";
  typeBadge.style.color = "#fff";

  // Hero stats: celebrations count + community
  const stats = $("#hero-stats");
  stats.innerHTML = "";
  const cn = c.celebrations.length;
  if (cn > 0) {
    const e = document.createElement("span");
    e.className = "stat";
    e.innerHTML = `<strong>${cn}</strong> célébration${cn > 1 ? "s" : ""}`;
    stats.appendChild(e);
  }
  if (c.community) {
    const e = document.createElement("span");
    e.className = "stat";
    e.textContent = labelFor(TAXONOMY.communities, c.community);
    stats.appendChild(e);
  }
  if (c.diocese) {
    const e = document.createElement("span");
    e.className = "stat";
    e.textContent = `Diocèse de ${c.diocese}`;
    stats.appendChild(e);
  }

  // Description
  if (c.description) {
    $("#description-section").classList.remove("hidden");
    $("#description-text").textContent = c.description;
  }

  // Contacts
  renderContacts(c);

  // Map
  if (c.latitude != null && c.longitude != null) {
    $("#map-card").classList.remove("hidden");
    setTimeout(() => initMap(c), 30); // ensure container is laid out
  } else {
    // No coords → make contact card span both columns
    document.querySelector(".detail-grid").style.gridTemplateColumns = "1fr";
  }

  // Celebrations
  renderCelebrations(c.celebrations);

  // Bottom-nav quick actions (mobile)
  hydrateBottomNav(c);

  // Source footer
  if (c.source) {
    $("#source-footer").classList.remove("hidden");
    let txt = c.source.replace("_", " ");
    if (c.source_url) {
      txt = `<a href="${c.source_url}" target="_blank" rel="noopener">${txt}</a>`;
    }
    $("#source-text").innerHTML = txt;
  }
}

function renderContacts(c) {
  const ul = $("#contact-list");
  ul.innerHTML = "";

  // Address (open in maps)
  const addrParts = [c.address, c.postal_code, c.city].filter(Boolean);
  if (addrParts.length) {
    const mapUrl = c.latitude != null && c.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=17/${c.latitude}/${c.longitude}`
      : `https://www.openstreetmap.org/search?query=${encodeURIComponent(addrParts.join(", "))}`;
    addRow(ul, "📍", "Adresse", addrParts.join(", "), mapUrl);
  }

  if (c.phone) addRow(ul, "📞", "Téléphone", c.phone, `tel:${c.phone.replace(/\s+/g, "")}`);
  if (c.email) addRow(ul, "✉️", "Email", c.email, `mailto:${c.email}`);
  if (c.website) {
    let display = c.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
    addRow(ul, "🌐", "Site web", display, c.website);
  }

  if (!ul.children.length) {
    const li = document.createElement("li");
    li.style.color = "var(--ink-muted)";
    li.style.fontStyle = "italic";
    li.textContent = "Aucune coordonnée renseignée.";
    ul.appendChild(li);
  }
}

function addRow(ul, icon, label, text, href) {
  const li = document.createElement("li");
  const iconEl = document.createElement("span");
  iconEl.className = "icon";
  iconEl.textContent = icon;
  const labelEl = document.createElement("span");
  labelEl.className = "label";
  labelEl.textContent = label;
  const link = document.createElement("a");
  link.href = href;
  if (href.startsWith("http")) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  link.textContent = text;
  li.appendChild(iconEl);
  li.appendChild(labelEl);
  li.appendChild(link);
  ul.appendChild(li);
}

function initMap(c) {
  const map = L.map("mini-map", {
    scrollWheelZoom: false,
    zoomControl: true,
  }).setView([c.latitude, c.longitude], 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
  }).addTo(map);

  L.marker([c.latitude, c.longitude]).addTo(map).bindPopup(c.name).openPopup();
}

// =========================================================================
// Celebrations
// =========================================================================

function renderCelebrations(celebrations) {
  const root = $("#celebrations-by-day");
  root.innerHTML = "";
  $("#celebrations-count").textContent =
    celebrations.length === 0
      ? "Aucune"
      : `${celebrations.length} célébration${celebrations.length > 1 ? "s" : ""}`;

  if (!celebrations.length) {
    $("#no-celebrations").classList.remove("hidden");
    return;
  }
  $("#no-celebrations").classList.add("hidden");

  // Group by day_of_week
  const groups = new Map();
  for (let d = 0; d <= 6; d++) groups.set(d, []);
  groups.set(null, []); // quotidien / variable

  for (const cel of celebrations) groups.get(cel.day_of_week ?? null).push(cel);

  const order = [0, 1, 2, 3, 4, 5, 6, null];
  for (const d of order) {
    const cels = groups.get(d).sort((a, b) =>
      (a.start_time || "").localeCompare(b.start_time || ""));
    if (cels.length === 0) continue;
    root.appendChild(buildGroup(d, cels));
  }
}

function buildGroup(dayIdx, cels) {
  const wrap = document.createElement("section");
  wrap.className = "schedule-group";

  const head = document.createElement("header");
  head.className = "schedule-group-header";
  head.innerHTML = `
    <span>${dayIdx === null ? "Quotidien / variable" : DAY_LABELS[dayIdx]}</span>
    <span class="muted">${cels.length} célébration${cels.length > 1 ? "s" : ""}</span>
  `;
  wrap.appendChild(head);

  for (const cel of cels) wrap.appendChild(buildRow(cel));
  return wrap;
}

function buildRow(cel) {
  const row = document.createElement("div");
  row.className = "schedule-row";

  // Time
  const time = document.createElement("span");
  time.className = "schedule-time";
  time.textContent = formatTime(cel.start_time);
  row.appendChild(time);

  // Meta (type + tags)
  const meta = document.createElement("div");
  meta.className = "schedule-meta";
  const typeLabel = document.createElement("span");
  typeLabel.className = "schedule-type";
  typeLabel.textContent = labelFor(TAXONOMY.celebration_types, cel.type);
  meta.appendChild(typeLabel);

  if (cel.rite && cel.rite !== "ordinary") {
    const tag = document.createElement("span");
    tag.className = "schedule-tag rite";
    tag.textContent = labelFor(TAXONOMY.rites, cel.rite);
    meta.appendChild(tag);
  }
  if (cel.language) {
    const tag = document.createElement("span");
    tag.className = "schedule-tag lang";
    tag.textContent = cel.language.toUpperCase();
    meta.appendChild(tag);
  }
  row.appendChild(meta);

  // ICS export
  const ics = document.createElement("a");
  ics.className = "schedule-ics";
  ics.href = `${apiBase}/api/celebrations/${cel.id}/ics`;
  ics.download = `celebration-${cel.id}.ics`;
  ics.title = "Ajouter à mon calendrier";
  ics.innerHTML = "📅 .ics";
  row.appendChild(ics);

  return row;
}

function formatTime(t) {
  if (!t) return "—";
  return t.slice(0, 5).replace(":", "h");
}

// =========================================================================
// Bottom-nav (mobile) — wire context actions
// =========================================================================

function hydrateBottomNav(c) {
  // Maps
  const mapsBtn = $("#nav-maps");
  if (c.latitude != null && c.longitude != null) {
    mapsBtn.href = `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=17/${c.latitude}/${c.longitude}`;
    mapsBtn.classList.remove("disabled");
  } else if (c.address || c.city) {
    const q = encodeURIComponent([c.address, c.postal_code, c.city].filter(Boolean).join(", "));
    mapsBtn.href = `https://www.openstreetmap.org/search?query=${q}`;
    mapsBtn.classList.remove("disabled");
  }

  // Call
  const callBtn = $("#nav-call");
  if (c.phone) {
    callBtn.href = `tel:${c.phone.replace(/\s+/g, "")}`;
    callBtn.classList.remove("disabled");
  }

  // Website
  const webBtn = $("#nav-website");
  if (c.website) {
    webBtn.href = c.website;
    webBtn.classList.remove("disabled");
  }

  // Calendar (.ics) — link to the first celebration if any
  const icsBtn = $("#nav-ics");
  if (c.celebrations && c.celebrations.length) {
    const first = c.celebrations[0];
    icsBtn.href = `${apiBase}/api/celebrations/${first.id}/ics`;
    icsBtn.classList.remove("disabled");
  }
}
