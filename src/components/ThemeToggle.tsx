import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

function findHeader(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '.topbar, .app-header, .marketing-topbar, .operations-topbar, header[role="banner"]',
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => initialTheme());
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    let attempts = 0;
    let timer: number | undefined;

    const mount = () => {
      const header = findHeader();
      if (!header) {
        if (attempts++ < 40) timer = window.setTimeout(mount, 100);
        return;
      }

      let slot = header.querySelector<HTMLElement>('.imds-theme-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'imds-theme-slot';
        header.appendChild(slot);
      }
      setTarget(slot);
    };

    mount();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const control = (
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

  return target ? createPortal(control, target) : null;
}
