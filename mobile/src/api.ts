import Constants from "expo-constants";

import type {
  ChurchDetail,
  SearchFilters,
  SearchResponse,
  Taxonomy,
} from "./types";

const DEFAULT_BASE = "https://leparvis.dauchez.me";

function resolveBaseUrl(): string {
  // 1. Build-time override via EAS / .env (`EXPO_PUBLIC_API_URL=...`).
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  // 2. expo extra (set in app.json).
  const fromExtra =
    (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)
      ?.apiBaseUrl;
  if (fromExtra) return fromExtra.replace(/\/$/, "");
  return DEFAULT_BASE;
}

export const apiBase = resolveBaseUrl();

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(apiBase + path, {
    headers: { "Content-Type": "application/json" },
    signal,
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, `${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

function buildQuery(filters: SearchFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export function search(
  filters: SearchFilters,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const qs = buildQuery(filters);
  return request<SearchResponse>(`/api/search${qs ? `?${qs}` : ""}`, {}, signal);
}

export function getTaxonomy(signal?: AbortSignal): Promise<Taxonomy> {
  return request<Taxonomy>("/api/meta/taxonomy", {}, signal);
}

export function getChurch(
  id: number,
  signal?: AbortSignal,
): Promise<ChurchDetail> {
  return request<ChurchDetail>(`/api/churches/${id}`, {}, signal);
}

export function celebrationIcsUrl(id: number): string {
  return `${apiBase}/api/celebrations/${id}/ics`;
}

export { ApiError, buildQuery };
