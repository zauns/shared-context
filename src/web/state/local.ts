import { useEffect, useState } from 'react';
import type { FilterState } from '../lib/filters.js';

export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initialValue : (JSON.parse(stored) as T);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable or full; the UI still works in memory.
    }
  }, [key, value]);

  return [value, setValue];
}

export function useTheme(): {
  theme: 'dark' | 'light';
  setTheme: (value: 'dark' | 'light') => void;
} {
  const [theme, setTheme] = useLocalStorageState<'dark' | 'light'>('sc.theme', 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return { theme, setTheme };
}

export function useDensity(): {
  density: 'compact' | 'comfortable';
  setDensity: (value: 'compact' | 'comfortable') => void;
} {
  const [density, setDensity] = useLocalStorageState<'compact' | 'comfortable'>(
    'sc.density',
    'compact',
  );
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
  return { density, setDensity };
}

export function useCollapsedColumns(projectKey: string): {
  collapsed: string[];
  toggle: (stage: string) => void;
} {
  const [collapsed, setCollapsed] = useLocalStorageState<string[]>(
    `sc.board.collapsed.${projectKey}`,
    [],
  );
  return {
    collapsed,
    toggle: (stage) =>
      setCollapsed((previous) =>
        previous.includes(stage)
          ? previous.filter((entry) => entry !== stage)
          : [...previous, stage],
      ),
  };
}

export interface SavedView {
  id: string;
  name: string;
  filters: FilterState;
}

export function useSavedViews(projectKey: string): {
  views: SavedView[];
  save: (name: string, filters: FilterState) => void;
  remove: (id: string) => void;
} {
  const [views, setViews] = useLocalStorageState<SavedView[]>(
    `sc.savedViews.${projectKey}`,
    [],
  );
  return {
    views,
    save: (name, filters) =>
      setViews((previous) => [
        ...previous,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          filters,
        },
      ]),
    remove: (id) => setViews((previous) => previous.filter((view) => view.id !== id)),
  };
}

export function useLastProject(): [string, (value: string) => void] {
  return useLocalStorageState<string>('sc.lastProject', '');
}
