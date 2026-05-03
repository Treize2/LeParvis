"""Lightweight admin auth via a single shared bearer token.

Set `LEPARVIS_ADMIN_TOKEN` in the deployment env to enable the admin API.
The token is sent by the admin SPA as `Authorization: Bearer <token>`.
"""
from fastapi import Header, HTTPException, status

from .config import settings


async def require_admin(authorization: str = Header(default="")) -> None:
    if not settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin disabled — set LEPARVIS_ADMIN_TOKEN to enable.",
        )
    expected = f"Bearer {settings.admin_token}"
    if not authorization or authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
