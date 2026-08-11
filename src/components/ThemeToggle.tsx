import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'imds-theme';

function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#031923' : '#edf8f9');
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((current) => current === 'light' ? 'dark' : 'light');
  const nextLabel = theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему';

  return <button
    className="imds-theme-toggle"
    type="button"
    role="switch"
    aria-checked={theme === 'dark'}
    aria-label={nextLabel}
    title={nextLabel}
    onClick={toggle}
  >
    <Sun size={15} className="imds-theme-toggle__sun" />
    <span className="imds-theme-toggle__track"><span className="imds-theme-toggle__thumb" /></span>
    <Moon size={15} className="imds-theme-toggle__moon" />
  </button>;
}
