import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { SearchFilters } from "../types";

type Ctx = {
  filters: SearchFilters;
  setFilters: (next: SearchFilters) => void;
  toggle: (key: keyof SearchFilters & string, value: string) => void;
  reset: () => void;
};

const FiltersContext = createContext<Ctx | null>(null);

const EMPTY: SearchFilters = {};

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY);

  const toggle = useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const list = (prev[key as keyof SearchFilters] as string[] | undefined) ?? [];
      const next = list.includes(value)
        ? list.filter((v) => v !== value)
        : [...list, value];
      return { ...prev, [key]: next.length ? next : undefined };
    });
  }, []);

  const reset = useCallback(() => setFilters(EMPTY), []);

  const value = useMemo(
    () => ({ filters, setFilters, toggle, reset }),
    [filters, toggle, reset],
  );

  return (
    <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
  );
}

export function useFilters(): Ctx {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside <FiltersProvider>");
  return ctx;
}
