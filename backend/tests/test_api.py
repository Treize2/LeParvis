"""End-to-end smoke tests for the public API.

These exercise the seeded dataset to keep the suite hermetic — no network,
no real scrapers. The intent is regression detection on routes + filters,
not exhaustive coverage of every code path.
"""


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_taxonomy_returns_expected_groups(client):
    r = client.get("/api/meta/taxonomy")
    assert r.status_code == 200
    data = r.json()
    assert {"church_types", "celebration_types", "rites", "communities"} <= data.keys()
    types = {t["value"] for t in data["church_types"]}
    assert {"parish", "monastery", "abbey", "basilica", "cathedral"} <= types


def test_search_filters_by_church_type(client):
    r = client.get("/api/search", params=[("type", "monastery"), ("type", "abbey")])
    assert r.status_code == 200
    payload = r.json()
    assert payload["total"] >= 2
    for item in payload["items"]:
        assert item["church"]["type"] in {"monastery", "abbey"}


def test_search_filters_by_celebration_type(client):
    r = client.get("/api/search", params={"celebration_type": "vespers"})
    assert r.status_code == 200
    payload = r.json()
    assert payload["total"] >= 1
    # Every returned item must have at least one matching vespers celebration.
    for item in payload["items"]:
        assert any(c["type"] == "vespers" for c in item["matched_celebrations"])


def test_search_radius_around_paris(client):
    r = client.get(
        "/api/search",
        params={"latitude": 48.85, "longitude": 2.35, "radius_km": 5},
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "Expected at least Notre-Dame within 5 km of central Paris"
    # Sorted by distance ascending.
    distances = [i["distance_km"] for i in items if i["distance_km"] is not None]
    assert distances == sorted(distances)


def test_search_combines_geo_and_celebration_filter(client):
    r = client.get(
        "/api/search",
        params={
            "latitude": 48.85,
            "longitude": 2.35,
            "radius_km": 10,
            "celebration_type": "adoration",
        },
    )
    assert r.status_code == 200
    payload = r.json()
    assert all(
        any(c["type"] == "adoration" for c in item["matched_celebrations"])
        for item in payload["items"]
    )


def test_extraordinary_form_is_searchable(client):
    r = client.get("/api/search", params={"rite": "extraordinary"})
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "Le Barroux seed should expose an extraordinary-form mass"
    assert any("Barroux" in i["church"]["name"] for i in items)


def test_get_church_detail(client):
    r = client.get("/api/churches/1")
    assert r.status_code == 200
    data = r.json()
    assert "celebrations" in data
    assert isinstance(data["celebrations"], list)


def test_ics_export_contains_rrule(client):
    r = client.get("/api/celebrations/1/ics")
    assert r.status_code == 200
    body = r.text
    assert "BEGIN:VCALENDAR" in body
    assert "RRULE:" in body
    assert "SUMMARY:" in body


def test_unknown_church_returns_404(client):
    assert client.get("/api/churches/999999").status_code == 404


def test_suggestion_submission(client):
    r = client.post(
        "/api/suggestions",
        json={
            "church_id": 1,
            "payload": {"correction": "Vêpres avancées à 17h00"},
            "submitter_email": "fidele@example.com",
        },
    )
    assert r.status_code == 201
    assert r.json()["status"] == "pending"


def test_jsonld_parser_extracts_mass():
    from app.scrapers.parsers.jsonld_parser import parse_jsonld_events

    html = (
        '<script type="application/ld+json">'
        '{"@context":"https://schema.org","@type":"Event",'
        '"name":"Messe dominicale",'
        '"startDate":"2026-05-03T11:00:00+02:00"}'
        "</script>"
    )
    events = list(parse_jsonld_events(html, "https://example.org"))
    assert len(events) == 1
    assert events[0].type == "mass"
    assert events[0].day_of_week == 6  # Sunday
    assert events[0].confidence >= 0.8


def test_osm_overpass_parser_extracts_church():
    from app.scrapers.osm_overpass import OsmOverpassScraper

    scraper = OsmOverpassScraper()
    element = {
        "type": "way",
        "id": 12345,
        "center": {"lat": 48.8530, "lon": 2.3499},
        "tags": {
            "amenity": "place_of_worship",
            "religion": "christian",
            "denomination": "catholic",
            "name": "Cathédrale Notre-Dame de Paris",
            "name:fr": "Cathédrale Notre-Dame de Paris",
            "building": "cathedral",
            "addr:housenumber": "6",
            "addr:street": "Parvis Notre-Dame - Pl. Jean-Paul II",
            "addr:city": "Paris",
            "addr:postcode": "75004",
            "contact:website": "https://www.notredamedeparis.fr",
            "contact:phone": "+33 1 42 34 56 10",
        },
    }
    result = scraper._parse_element(element)
    assert result.church.name == "Cathédrale Notre-Dame de Paris"
    assert result.church.type == "cathedral"
    assert result.church.city == "Paris"
    assert result.church.postal_code == "75004"
    assert result.church.latitude == 48.8530
    assert result.church.longitude == 2.3499
    assert result.church.website == "https://www.notredamedeparis.fr"
    assert result.church.external_id == "osm/way/12345"
    assert result.church.source == "osm_overpass"
    assert result.celebrations == []


def test_osm_overpass_parser_falls_back_to_parish():
    from app.scrapers.osm_overpass import OsmOverpassScraper

    scraper = OsmOverpassScraper()
    element = {
        "type": "node",
        "id": 999,
        "lat": 48.0,
        "lon": 2.0,
        "tags": {
            "amenity": "place_of_worship",
            "religion": "christian",
            "denomination": "catholic",
            "name": "Église Saint-Exemple",
        },
    }
    result = scraper._parse_element(element)
    assert result.church.type == "parish"


def test_heuristic_schedule_parser_french():
    from app.scrapers.parsers.time_parser import parse_schedule

    text = (
        "Horaires des célébrations\n"
        "Messe le dimanche à 10h30\n"
        "Vêpres tous les jours à 18h00\n"
        "Confessions le samedi de 17h à 18h"
    )
    slots = parse_schedule(text)
    types = {s.type for s in slots}
    assert {"mass", "vespers", "confession"} <= types
