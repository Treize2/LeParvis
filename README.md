# LeParvis

Application complète de recherche d'horaires de célébrations catholiques (messes, laudes, vêpres, complies, adoration, confessions…) avec filtrage par type de lieu (paroisse, monastère, basilique, cathédrale, sanctuaire, chapelle…).

## Sommaire

- [Architecture](#architecture)
- [Fonctionnalités](#fonctionnalités)
- [Démarrage rapide](#démarrage-rapide)
- [API](#api)
- [Mécanisme de collecte (scraping)](#mécanisme-de-collecte-scraping)
- [Modèle de données](#modèle-de-données)
- [Roadmap](#roadmap)

## Architecture

```
LeParvis/
├── backend/                  # API FastAPI + base SQLite + scrapers
│   ├── app/
│   │   ├── main.py           # entrée FastAPI
│   │   ├── database.py       # SQLAlchemy session
│   │   ├── models.py         # ORM : Church, Celebration, etc.
│   │   ├── schemas.py        # Pydantic schemas
│   │   ├── api/              # routes (churches, celebrations, search, ingest)
│   │   ├── services/         # géocodage, distance, parsing horaires
│   │   ├── scrapers/         # base + messes.info + paroisses génériques
│   │   └── seed.py           # données d'amorçage
│   └── requirements.txt
├── frontend/                 # SPA légère (HTML + JS + Leaflet)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── docker-compose.yml
└── README.md
```

Stack :
- **Backend** : Python 3.11, FastAPI, SQLAlchemy, SQLite (PostgreSQL en option), httpx, BeautifulSoup, lxml.
- **Frontend** : HTML/CSS/JS sans build, Leaflet pour la carte (OpenStreetMap).
- **Ingestion** : tâches manuelles via CLI ou endpoint admin, parsers modulaires.

## Fonctionnalités

- Recherche par ville, code postal, ou géolocalisation (rayon en km).
- Filtres :
  - **Type de lieu** : paroisse, cathédrale, basilique, monastère, abbaye, sanctuaire, chapelle, oratoire, séminaire.
  - **Type de célébration** : messe, laudes, tierce, sexte, none, vêpres, complies, adoration, chapelet, confession, vigile.
  - **Rite / langue** : Novus Ordo (FR), latin, forme extraordinaire, byzantin, etc.
  - **Jour de la semaine** + **plage horaire**.
  - **Communauté** : diocésain, bénédictin, franciscain, dominicain, carmélite, jésuite, communautés nouvelles…
- Vue **liste** + vue **carte** (Leaflet) + fiche détaillée par lieu.
- Export ICS (calendrier) d'une célébration récurrente.
- Suggestion / signalement par les utilisateurs (modération).
- Ingestion automatique depuis messes.info et sites paroissiaux compatibles.

## Démarrage rapide

### Sans Docker

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.seed                 # crée la base et insère un jeu d'exemple
uvicorn app.main:app --reload --port 8000
```

Ouvre `frontend/index.html` (servi par n'importe quel serveur statique, ou directement) et règle l'URL d'API si nécessaire.

```bash
cd frontend
python -m http.server 5173
```

Puis http://localhost:5173.

### Avec Docker

```bash
docker compose up --build
```

API : http://localhost:8000/docs · Frontend : http://localhost:5173.

## API

| Méthode | Endpoint                             | Description                                   |
|---------|--------------------------------------|-----------------------------------------------|
| GET     | `/api/churches`                      | Liste paginée + filtres                       |
| GET     | `/api/churches/{id}`                 | Détail d'un lieu (avec célébrations)          |
| GET     | `/api/celebrations`                  | Recherche multi-critères                      |
| GET     | `/api/search`                        | Recherche unifiée (texte + filtres + radius)  |
| GET     | `/api/celebrations/{id}/ics`         | Export iCalendar                              |
| POST    | `/api/ingest/messesinfo`             | Lance l'ingestion messes.info pour une zone   |
| POST    | `/api/ingest/url`                    | Tente d'extraire un site paroissial           |
| POST    | `/api/suggestions`                   | Signalement utilisateur                       |

Documentation interactive : `/docs`.

## Mécanisme de collecte (scraping)

Le module `app/scrapers/` propose une **architecture modulaire** :

```
scrapers/
├── base.py            # interface Scraper + helpers (fetch, normalize, dedupe)
├── messes_info.py     # adaptateur messes.info / API egliseinfo
├── paroisse_html.py   # extracteur générique HTML (heuristiques + JSON-LD schema.org)
├── parsers/
│   ├── time_parser.py # « 18h30 », « 6 PM », « le dimanche à 10h » → structuré
│   └── ical_parser.py # support .ics publiés
└── registry.py        # mapping domaine → scraper
```

**Trois stratégies** :

1. **messes.info / egliseinfo.catholique.fr** — appelle l'API publique paramétrée par latitude/longitude/rayon. Réponse JSON normalisée.
2. **JSON-LD `schema.org/Event`** — beaucoup de sites paroissiaux publient leurs horaires via `<script type="application/ld+json">`. Le scraper générique les extrait sans heuristique fragile.
3. **HTML heuristique** — fallback : recherche de patterns d'heures (regex `\d{1,2}h(?:\d{2})?`), de jours (`lundi…dimanche`), et corrélation avec mots-clés (`messe`, `laudes`, `confession`).

Toutes les sources passent par `Pipeline` qui :
- normalise (Unicode, fuseaux),
- déduplique par `(church_id, type, day, start_time)`,
- pose un score de confiance (`confidence` 0–1),
- tag `source` + `source_url` + `last_seen_at` pour la traçabilité.

**Conformité** :
- respect de `robots.txt` (bibliothèque `urllib.robotparser`),
- `User-Agent` identifié + email de contact,
- limitation de débit (`asyncio.Semaphore` + délai),
- cache local 24 h pour éviter les requêtes inutiles,
- mention de la source dans la fiche publique.

## Modèle de données

```
Church (lieu)
  id, name, type, denomination, community,
  address, city, postal_code, country,
  latitude, longitude,
  diocese, parish_id,
  website, phone, email,
  description, image_url,
  source, source_url, last_seen_at

Celebration (célébration récurrente)
  id, church_id,
  type (mass | lauds | vespers | compline | adoration | confession | chapelet | vigil | other),
  rite (ordinary | extraordinary | byzantine | other),
  language,
  day_of_week (0–6 ou null = quotidien),
  start_time, end_time,
  recurrence_rule (RRULE iCal),
  notes, confidence,
  source, source_url, last_seen_at

Suggestion (modération)
  id, church_id, payload (JSON), status, created_at
```

## Roadmap

- [ ] Authentification + interface d'admin pour la modération
- [ ] Notifications (« la messe de 18 h est annulée »)
- [ ] Application mobile PWA installable
- [ ] Multi-langues (EN, IT, ES)
- [ ] Calendrier liturgique (couleur, saint du jour) via API AELF
- [ ] Itinéraire (transports en commun) vers le lieu

## Licence

À définir. Les données collectées restent la propriété de leurs sources respectives.
