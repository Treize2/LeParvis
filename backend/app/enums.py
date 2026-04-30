from enum import Enum


class ChurchType(str, Enum):
    PARISH = "parish"            # paroisse / église paroissiale
    CATHEDRAL = "cathedral"      # cathédrale
    BASILICA = "basilica"        # basilique
    MONASTERY = "monastery"      # monastère
    ABBEY = "abbey"              # abbaye
    PRIORY = "priory"            # prieuré
    SHRINE = "shrine"            # sanctuaire
    CHAPEL = "chapel"            # chapelle
    ORATORY = "oratory"          # oratoire
    SEMINARY = "seminary"        # séminaire
    COLLEGIATE = "collegiate"    # collégiale
    CONVENT = "convent"          # couvent
    OTHER = "other"


class CelebrationType(str, Enum):
    MASS = "mass"                # messe
    LAUDS = "lauds"              # laudes
    TIERCE = "tierce"            # tierce
    SEXT = "sext"                # sexte
    NONE_OFFICE = "none_office"  # none
    VESPERS = "vespers"          # vêpres
    COMPLINE = "compline"        # complies
    OFFICE_OF_READINGS = "office_of_readings"
    ADORATION = "adoration"      # adoration eucharistique
    CONFESSION = "confession"    # confessions
    CHAPLET = "chaplet"          # chapelet / rosaire
    VIGIL = "vigil"              # vigile
    BAPTISM = "baptism"
    PROCESSION = "procession"
    OTHER = "other"


class Rite(str, Enum):
    ORDINARY = "ordinary"            # forme ordinaire (Vatican II / Novus Ordo)
    EXTRAORDINARY = "extraordinary"  # forme extraordinaire (Tridentin / 1962)
    BYZANTINE = "byzantine"
    AMBROSIAN = "ambrosian"
    DOMINICAN = "dominican"
    OTHER = "other"


class Community(str, Enum):
    DIOCESAN = "diocesan"
    BENEDICTINE = "benedictine"
    CISTERCIAN = "cistercian"
    TRAPPIST = "trappist"
    FRANCISCAN = "franciscan"
    DOMINICAN = "dominican"
    CARMELITE = "carmelite"
    JESUIT = "jesuit"
    AUGUSTINIAN = "augustinian"
    REDEMPTORIST = "redemptorist"
    SALESIAN = "salesian"
    OPUS_DEI = "opus_dei"
    EMMANUEL = "emmanuel"
    BEATITUDES = "beatitudes"
    NEOCATECHUMENATE = "neocatechumenate"
    OTHER = "other"
