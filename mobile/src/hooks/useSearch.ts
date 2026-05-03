import { useCallback, useEffect, useState } from "react";

import { search } from "../api";
import type { SearchFilters, SearchResponse } from "../types";

type State = {
  data: SearchResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
};

export function useSearch(filters: SearchFilters): State {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Stable serialization so the effect only re-runs on real changes.
  const fingerprint = JSON.stringify(filters);

  const refresh = useCallback(() => setReloadTick((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    search(filters, ctrl.signal)
      .then((res) => setData(res))
      .catch((err: Error) => {
        if (ctrl.signal.aborted) return;
        setError(err);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // We intentionally key on the JSON fingerprint, not the object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, reloadTick]);

  return { data, loading, error, refresh };
}
