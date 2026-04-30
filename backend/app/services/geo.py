from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points (in km)."""
    lat1, lon1, lat2, lon2 = map(radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(sqrt(a))


def bounding_box(lat: float, lon: float, radius_km: float) -> tuple[float, float, float, float]:
    """Approximate bounding box (min_lat, max_lat, min_lon, max_lon).

    Used as an SQL pre-filter before refining with haversine in Python.
    """
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(0.1, cos(radians(lat))))
    return lat - dlat, lat + dlat, lon - dlon, lon + dlon
