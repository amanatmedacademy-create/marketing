import { useEffect } from 'react';

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function setReactInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function currentDealName(anchor: HTMLAnchorElement): string {
  return anchor.closest('.deal-workspace-panel')?.querySelector<HTMLHeadingElement>('.deal-workspace-identity h1')?.textContent?.trim() || '';
}

function routeCommunication(anchor: HTMLAnchorElement): boolean {
  if (!anchor.closest('.deal-workspace-panel')) return false;
  const href = anchor.getAttribute('href') || '';
  const phone = href.startsWith('tel:')
    ? normalizePhone(href.slice(4))
    : href.includes('wa.me/')
      ? normalizePhone(href.split('wa.me/')[1] || '')
      : '';
  if (!phone) return false;

  const name = currentDealName(anchor);
  const isMessage = href.includes('wa.me/') || /сообщ/i.test(anchor.textContent || '');
  const target = isMessage ? '/chat' : '/calls';
  const params = new URLSearchParams({ phone });
  if (name) params.set('name', name);
  window.location.assign(`${target}?${params.toString()}`);
  return true;
}

function openCalls(phone: string): void {
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const search = document.querySelector<HTMLInputElement>('.calls-filters input');
    if (search) {
      setReactInputValue(search, phone);
      window.setTimeout(() => document.querySelector<HTMLButtonElement>('.calls-list button')?.click(), 120);
      window.clearInterval(timer);
    } else if (attempts > 40) {
      window.clearInterval(timer);
    }
  }, 100);
}

function openChat(phone: string, name: string): void {
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const search = document.querySelector<HTMLInputElement>('.inbox-search input');
    if (!search) {
      if (attempts > 50) window.clearInterval(timer);
      return;
    }

    setReactInputValue(search, phone);
    window.setTimeout(() => {
      const thread = document.querySelector<HTMLButtonElement>('.inbox-thread-list .inbox-thread');
      if (thread) {
        thread.click();
        window.clearInterval(timer);
        return;
      }

      const createButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.callcenter-toolbar button'))
        .find((button) => /новый диалог/i.test(button.textContent || ''));
      createButton?.click();
      window.setTimeout(() => {
        const fields = document.querySelectorAll<HTMLInputElement>('.inbox-modal input');
        if (fields[0] && name) setReactInputValue(fields[0], name);
        if (fields[1]) setReactInputValue(fields[1], phone);
        const channel = document.querySelector<HTMLSelectElement>('.inbox-modal select');
        if (channel) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
          setter?.call(channel, 'WHATSAPP');
          channel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 150);
      window.clearInterval(timer);
    }, 250);
  }, 100);
}

export default function InternalCommunicationBridge() {
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || !routeCommunication(anchor)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const phone = normalizePhone(params.get('phone') || '');
    if (!phone) return;
    if (window.location.pathname === '/calls') openCalls(phone);
    if (window.location.pathname === '/chat') openChat(phone, params.get('name') || '');
  }, []);

  return null;
}
