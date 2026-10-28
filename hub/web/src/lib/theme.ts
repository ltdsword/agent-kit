import { useCallback, useEffect, useState } from 'react';

const KEY = 'agent-hub.theme';

function initial(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === 'dark';
  } catch { /* storage may be blocked */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Light/dark theme: follows the system until the user picks one, then remembers it. */
export function useTheme() {
  const [dark, setDark] = useState(initial);
  useEffect(() => {
    document.documentElement.style.background = dark ? '#0D0F14' : '#F4F5F7';
  }, [dark]);
  const toggle = useCallback(() => {
    setDark((d) => {
      try { localStorage.setItem(KEY, d ? 'light' : 'dark'); } catch { /* ignore */ }
      return !d;
    });
  }, []);
  return { dark, toggle };
}
