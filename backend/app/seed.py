"""Bootstrap the database with a small set of well-known places.

Run with: ``python -m app.seed`` from the ``backend/`` directory.
"""
from datetime import time

from .database import SessionLocal, init_db
from .models import Celebration, Church
from .services.slug import slugify


SEED = [
    {
        "name": "Cathédrale Notre-Dame de Paris",
        "type": "cathedral",
        "community": "diocesan",
        "address": "6 Parvis Notre-Dame - Pl. Jean-Paul II",
        "city": "Paris",
        "postal_code": "75004",
        "latitude": 48.8530,
        "longitude": 2.3499,
        "diocese": "Paris",
        "website": "https://www.notredamedeparis.fr",
        "celebrations": [
            {"type": "mass", "day_of_week": 6, "start_time": time(11, 30), "language": "fr"},
            {"type": "mass", "day_of_week": 6, "start_time": time(18, 30), "language": "fr"},
            {"type": "vespers", "day_of_week": 6, "start_time": time(17, 30)},
        ],
    },
    {
        "name": "Abbaye de Solesmes",
        "type": "abbey",
        "community": "benedictine",
        "address": "1 Place Dom Guéranger",
        "city": "Solesmes",
        "postal_code": "72300",
        "latitude": 47.8497,
        "longitude": 0.2999,
        "diocese": "Le Mans",
        "website": "https://www.solesmes.com",
        "description": "Abbaye bénédictine célèbre pour sa restauration du chant grégorien.",
        "celebrations": [
            {"type": "lauds", "start_time": time(7, 30)},
            {"type": "mass", "start_time": time(10, 0)},
            {"type": "sext", "start_time": time(13, 0)},
            {"type": "vespers", "start_time": time(17, 0)},
            {"type": "compline", "start_time": time(20, 30)},
        ],
    },
    {
        "name": "Basilique du Sacré-Cœur de Montmartre",
        "type": "basilica",
        "community": "diocesan",
        "address": "35 Rue du Chevalier de la Barre",
        "city": "Paris",
        "postal_code": "75018",
        "latitude": 48.8867,
        "longitude": 2.3431,
        "diocese": "Paris",
        "website": "https://www.sacre-coeur-montmartre.com",
        "celebrations": [
            {"type": "mass", "day_of_week": 6, "start_time": time(11, 0)},
            {"type": "adoration", "day_of_week": 5, "start_time": time(22, 0), "notes": "Adoration nocturne"},
            {"type": "confession", "day_of_week": 5, "start_time": time(15, 0)},
        ],
    },
    {
        "name": "Sanctuaire de Lourdes",
        "type": "shrine",
        "community": "diocesan",
        "address": "1 Avenue Mgr Théas",
        "city": "Lourdes",
        "postal_code": "65100",
        "latitude": 43.0961,
        "longitude": -0.0531,
        "diocese": "Tarbes et Lourdes",
        "website": "https://www.lourdes-france.org",
        "celebrations": [
            {"type": "mass", "day_of_week": 6, "start_time": time(10, 0), "language": "fr"},
            {"type": "chaplet", "start_time": time(15, 30)},
            {"type": "procession", "start_time": time(21, 0), "notes": "Procession aux flambeaux"},
        ],
    },
    {
        "name": "Monastère Sainte-Madeleine du Barroux",
        "type": "monastery",
        "community": "benedictine",
        "address": "La Font de Pertus",
        "city": "Le Barroux",
        "postal_code": "84330",
        "latitude": 44.1758,
        "longitude": 5.0944,
        "diocese": "Avignon",
        "website": "https://www.barroux.org",
        "celebrations": [
            {"type": "lauds", "start_time": time(7, 0)},
            {"type": "mass", "start_time": time(9, 30), "rite": "extraordinary", "language": "la"},
            {"type": "vespers", "start_time": time(18, 0), "language": "la"},
            {"type": "compline", "start_time": time(20, 30), "language": "la"},
        ],
    },
    {
        "name": "Couvent des Dominicains de l'Annonciation",
        "type": "convent",
        "community": "dominican",
        "address": "222 rue du Faubourg Saint-Honoré",
        "city": "Paris",
        "postal_code": "75008",
        "latitude": 48.8743,
        "longitude": 2.3071,
        "diocese": "Paris",
        "website": "https://annonciation.dominicains.fr",
        "celebrations": [
            {"type": "lauds", "start_time": time(7, 30)},
            {"type": "mass", "start_time": time(12, 30)},
            {"type": "vespers", "start_time": time(19, 0)},
        ],
    },
]


def seed() -> None:
    init_db()
    db = SessionLocal()
    try:
        for record in SEED:
            data = {k: v for k, v in record.items() if k != "celebrations"}
            celebrations = record.get("celebrations", [])
            slug = slugify(f"{data['name']}-{data.get('city', '')}")
            existing = db.query(Church).filter(Church.slug == slug).first()
            if existing:
                continue
            church = Church(slug=slug, **data)
            db.add(church)
            db.flush()
            for cel in celebrations:
                db.add(Celebration(church_id=church.id, confidence=1.0, **cel))
        db.commit()
        print("Seed completed.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
