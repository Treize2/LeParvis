import { useEffect, useState } from "react";

import { getTaxonomy } from "../api";
import type { Taxonomy } from "../types";

type State = {
  taxonomy: Taxonomy | null;
  loading: boolean;
  error: Error | null;
};

const initial: State = { taxonomy: null, loading: true, error: null };

let cache: Taxonomy | null = null;

export function useTaxonomy(): State {
  const [state, setState] = useState<State>(() =>
    cache ? { taxonomy: cache, loading: false, error: null } : initial,
  );

  useEffect(() => {
    if (cache) return;
    const ctrl = new AbortController();
    getTaxonomy(ctrl.signal)
      .then((tx) => {
        cache = tx;
        setState({ taxonomy: tx, loading: false, error: null });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setState({ taxonomy: null, loading: false, error: err as Error });
      });
    return () => ctrl.abort();
  }, []);

  return state;
}

export function labelFor(
  list: { value: string; label: string }[] | undefined,
  value: string,
): string {
  return list?.find((x) => x.value === value)?.label ?? value;
}
