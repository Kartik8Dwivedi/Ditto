'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'ditto-theme';

/**
 * The `data-theme` attribute on <html> is the source of truth, not React state —
 * the server sets it to dark, and CSS reads it. So rather than mirroring it into
 * state (which means a setState-in-effect and a cascading render), we subscribe
 * to the attribute itself and read it directly.
 *
 * Because dark is already the server-rendered default, there is no flash to
 * prevent and no pre-hydration script needed.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Matches what the server renders, so hydration agrees. */
function getServerSnapshot(): Theme {
  return 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Restores a remembered choice. This only writes to the DOM — an external
  // system — so it does not trigger a render of its own; the observer above
  // picks the change up.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') applyTheme(saved);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className={cn(
        "rounded-md border border-line bg-panel/80 p-1.5 text-ink-subtle backdrop-blur transition-all duration-150 hover:text-ink hover:bg-inset hover:border-line-strong",
        className
      )}
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
