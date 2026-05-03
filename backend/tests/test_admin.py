"""Admin API tests: auth, edit, delete, merge."""

# The token is set by conftest.py before app.config is imported.
AUTH = {"Authorization": "Bearer test-secret-token"}


def test_admin_requires_auth(client):
    r = client.post("/api/admin/login")
    assert r.status_code == 401


def test_admin_login_with_valid_token(client):
    r = client.post("/api/admin/login", headers=AUTH)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_admin_login_rejects_wrong_token(client):
    r = client.post("/api/admin/login", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_update_church_persists(client):
    r = client.patch(
        "/api/admin/churches/1",
        json={"phone": "+33 1 42 34 56 10", "city": "Paris"},
        headers=AUTH,
    )
    assert r.status_code == 200
    assert r.json()["phone"] == "+33 1 42 34 56 10"
    # Confirm via the public endpoint.
    pub = client.get("/api/churches/1").json()
    assert pub["phone"] == "+33 1 42 34 56 10"


def test_update_celebration_persists(client):
    cel = client.get("/api/celebrations").json()[0]
    r = client.patch(
        f"/api/admin/celebrations/{cel['id']}",
        json={"language": "la", "rite": "extraordinary"},
        headers=AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["language"] == "la"
    assert body["rite"] == "extraordinary"


def test_merge_moves_celebrations_and_deletes_source(client):
    # Create two churches: one will be merged into the other.
    a = client.post(
        "/api/churches",
        json={"name": "Test Source", "type": "parish", "city": "Test"},
    ).json()
    b = client.post(
        "/api/churches",
        json={"name": "Test Target", "type": "parish", "city": "Test"},
    ).json()
    # Add a celebration to A.
    client.post(
        "/api/celebrations",
        json={
            "church_id": a["id"], "type": "vespers", "rite": "ordinary",
            "day_of_week": 6, "start_time": "18:00",
        },
    )

    r = client.post(
        f"/api/admin/churches/{a['id']}/merge-into/{b['id']}",
        headers=AUTH,
    )
    assert r.status_code == 200
    report = r.json()
    assert report["target_id"] == b["id"]
    assert report["moved_celebrations"] == 1
    assert report["deleted_church_id"] == a["id"]

    # Source is gone.
    assert client.get(f"/api/churches/{a['id']}").status_code == 404
    # Target now owns the vespers slot.
    target = client.get(f"/api/churches/{b['id']}").json()
    assert any(c["type"] == "vespers" and c["start_time"] == "18:00:00" for c in target["celebrations"])


def test_merge_dedupes_overlapping_celebrations(client):
    a = client.post(
        "/api/churches",
        json={"name": "Dedup Source", "type": "parish", "city": "Z"},
    ).json()
    b = client.post(
        "/api/churches",
        json={"name": "Dedup Target", "type": "parish", "city": "Z"},
    ).json()
    common = {
        "type": "mass", "rite": "ordinary",
        "day_of_week": 6, "start_time": "10:30",
    }
    client.post("/api/celebrations", json={**common, "church_id": a["id"]})
    client.post("/api/celebrations", json={**common, "church_id": b["id"]})

    report = client.post(
        f"/api/admin/churches/{a['id']}/merge-into/{b['id']}",
        headers=AUTH,
    ).json()
    assert report["moved_celebrations"] == 0
    assert report["deleted_duplicate_celebrations"] == 1


def test_delete_church_cascades_celebrations(client):
    a = client.post(
        "/api/churches",
        json={"name": "Doomed Church", "type": "parish", "city": "Trash"},
    ).json()
    client.post(
        "/api/celebrations",
        json={
            "church_id": a["id"], "type": "mass", "rite": "ordinary",
            "day_of_week": 6, "start_time": "11:00",
        },
    )
    r = client.delete(f"/api/admin/churches/{a['id']}", headers=AUTH)
    assert r.status_code == 204
    assert client.get(f"/api/churches/{a['id']}").status_code == 404


def test_language_is_per_fragment_not_global():
    """A page that mentions 'espagnol' once shouldn't tag every Mass as Spanish."""
    from app.scrapers.parsers.time_parser import parse_schedule

    text = (
        "Horaires des messes\n"
        "Dimanche : messe à 10h30\n"
        "Une messe en espagnol est célébrée le dernier dimanche du mois à 19h"
    )
    slots = parse_schedule(text)
    masses = [s for s in slots if s.type == "mass"]
    # The 10h30 slot should have language=None; only the 19h fragment has 'espagnol'.
    morning = [s for s in masses if s.start_time and s.start_time.hour == 10]
    assert morning and all(s.language is None for s in morning)
    evening = [s for s in masses if s.start_time and s.start_time.hour == 19]
    assert evening and all(s.language == "es" for s in evening)
