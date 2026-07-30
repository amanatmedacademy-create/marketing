import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'imds-theme';
type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => initialTheme());

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="imds-theme-toggle"
      aria-label={`Включить ${nextTheme === 'light' ? 'светлую' : 'тёмную'} тему`}
      title={`Включить ${nextTheme === 'light' ? 'светлую' : 'тёмную'} тему`}
      onClick={() => setTheme(nextTheme)}
    >
      <span className="imds-theme-toggle__track" aria-hidden="true">
        <span className="imds-theme-toggle__icon imds-theme-toggle__icon--sun"><Sun size={15}/></span>
        <span className="imds-theme-toggle__icon imds-theme-toggle__icon--moon"><Moon size={15}/></span>
        <span className="imds-theme-toggle__thumb" />
      </span>
      <span className="imds-theme-toggle__label">{theme === 'dark' ? 'Тёмная' : 'Светлая'}</span>
    </button>
  );
}
