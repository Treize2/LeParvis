from fastapi import APIRouter

from ..enums import CelebrationType, ChurchType, Community, Rite

router = APIRouter(prefix="/api/meta", tags=["meta"])

LABELS_FR = {
    # Church types
    "parish": "Paroisse",
    "cathedral": "Cathédrale",
    "basilica": "Basilique",
    "monastery": "Monastère",
    "abbey": "Abbaye",
    "priory": "Prieuré",
    "shrine": "Sanctuaire",
    "chapel": "Chapelle",
    "oratory": "Oratoire",
    "seminary": "Séminaire",
    "collegiate": "Collégiale",
    "convent": "Couvent",
    "other": "Autre",
    # Celebrations
    "mass": "Messe",
    "lauds": "Laudes",
    "tierce": "Tierce",
    "sext": "Sexte",
    "none_office": "None",
    "vespers": "Vêpres",
    "compline": "Complies",
    "office_of_readings": "Office des lectures",
    "adoration": "Adoration",
    "confession": "Confessions",
    "chaplet": "Chapelet",
    "vigil": "Vigile",
    "baptism": "Baptême",
    "procession": "Procession",
    # Rites
    "ordinary": "Forme ordinaire (Vatican II)",
    "extraordinary": "Forme extraordinaire (1962)",
    "byzantine": "Rite byzantin",
    "ambrosian": "Rite ambrosien",
    "dominican": "Rite dominicain",
    # Communities
    "diocesan": "Diocésain",
    "benedictine": "Bénédictins",
    "cistercian": "Cisterciens",
    "trappist": "Trappistes",
    "franciscan": "Franciscains",
    "carmelite": "Carmélites",
    "jesuit": "Jésuites",
    "augustinian": "Augustins",
    "redemptorist": "Rédemptoristes",
    "salesian": "Salésiens",
    "opus_dei": "Opus Dei",
    "emmanuel": "Communauté de l'Emmanuel",
    "beatitudes": "Communauté des Béatitudes",
    "neocatechumenate": "Chemin néocatéchuménal",
}


def _items(enum_cls):
    return [{"value": e.value, "label": LABELS_FR.get(e.value, e.value.title())} for e in enum_cls]


@router.get("/taxonomy")
def taxonomy():
    return {
        "church_types": _items(ChurchType),
        "celebration_types": _items(CelebrationType),
        "rites": _items(Rite),
        "communities": _items(Community),
    }
