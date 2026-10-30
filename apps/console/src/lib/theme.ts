import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'standby.theme.v1';
const CHANGE_EVENT = 'standby:theme';

function asTheme(value: string | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

function readSavedTheme(): Theme | null {
  try { return asTheme(localStorage.getItem(STORAGE_KEY)); }
  catch { return null; }
}

/** The approved dark default and URL precedence match the head's prepaint reader. */
export function useTheme(): {theme: Theme; setTheme: (next: Theme) => boolean} {
  const location = useLocation(), navigate = useNavigate();
  const [savedTheme, setSavedTheme] = useState<Theme | null>(readSavedTheme);
  const theme = asTheme(new URLSearchParams(location.search).get('theme')) ?? savedTheme ?? 'dark';

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      'content', theme === 'light' ? '#f2f6fb' : '#0b1018',
    );
  }, [theme]);

  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) setSavedTheme(readSavedTheme());
    };
    const localChange = (event: Event) => {
      const next = asTheme((event as CustomEvent<string>).detail);
      if (next) setSavedTheme(next);
    };
    window.addEventListener('storage', synchronize);
    window.addEventListener(CHANGE_EVENT, localChange);
    return () => {
      window.removeEventListener('storage', synchronize);
      window.removeEventListener(CHANGE_EVENT, localChange);
    };
  }, []);

  const setTheme = useCallback((next: Theme): boolean => {
    let persisted = true;
    try { localStorage.setItem(STORAGE_KEY, next); }
    catch { persisted = false; }
    // Blocked storage must not prevent a theme change for the current session.
    setSavedTheme(next);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {detail: next}));
    const params = new URLSearchParams(location.search);
    if (params.has('theme')) {
      params.set('theme', next);
      void navigate({pathname: location.pathname, search: `?${params.toString()}`, hash: location.hash},
        {replace: true, state: location.state});
    }
    return persisted;
  }, [location.pathname, location.search, location.hash, location.state, navigate]);

  return {theme, setTheme};
}
