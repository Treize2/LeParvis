import re

from unidecode import unidecode


def slugify(value: str, max_length: int = 80) -> str:
    value = unidecode(value or "").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:max_length] or "lieu"


def unique_slug(base: str, exists) -> str:
    """Return a slug that does not collide.

    `exists` is a callable taking the candidate slug and returning True if taken.
    """
    candidate = slugify(base)
    if not exists(candidate):
        return candidate
    i = 2
    while exists(f"{candidate}-{i}"):
        i += 1
    return f"{candidate}-{i}"
