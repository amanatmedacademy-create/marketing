type AvatarResponse = { contactId?: string | null; avatar?: { url?: string; source?: string } | null };

let activeKey = '';
let loadingKey = '';

function identity(): { key: string; phone: string } | null {
  const title = document.querySelector('.callcenter-root .inbox-contact-title');
  const name = title?.querySelector('strong')?.textContent?.trim() || '';
  const detail = title?.querySelector('small')?.textContent || '';
  const phone = detail.match(/\+?\d[\d\s()\-]{8,}\d/)?.[0]?.trim() || '';
  return name || phone ? { key: `${name}|${phone}`, phone } : null;
}

function clearAvatar(): void {
  const host = document.querySelector<HTMLElement>('.callcenter-root .inbox-contact-avatar');
  host?.querySelector('[data-imds-patient-avatar]')?.remove();
  if (host) host.style.fontSize = '';
}

function applyAvatar(url: string): void {
  const host = document.querySelector<HTMLElement>('.callcenter-root .inbox-contact-avatar');
  if (!host) return;
  host.querySelector('[data-imds-patient-avatar]')?.remove();
  host.style.position = 'relative';
  host.style.overflow = 'hidden';
  host.style.fontSize = '0';
  const image = document.createElement('img');
  image.dataset.imdsPatientAvatar = '1';
  image.src = url;
  image.alt = 'Фото пациента';
  image.referrerPolicy = 'no-referrer';
  image.style.position = 'absolute';
  image.style.inset = '0';
  image.style.width = '100%';
  image.style.height = '100%';
  image.style.objectFit = 'cover';
  image.style.borderRadius = 'inherit';
  image.style.display = 'block';
  host.appendChild(image);
}

async function enhance(): Promise<void> {
  const current = identity();
  if (!current) { activeKey = ''; clearAvatar(); return; }
  if (current.key !== activeKey) { activeKey = current.key; clearAvatar(); }
  if (loadingKey === current.key) return;
  loadingKey = current.key;
  try {
    const params = new URLSearchParams();
    if (current.phone) params.set('phone', current.phone);
    const response = await fetch(`/api/contact-avatars/resolve?${params.toString()}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null) as AvatarResponse | null;
    if (activeKey !== current.key) return;
    const url = payload?.avatar?.url || '';
    if (response.ok && url) applyAvatar(url); else clearAvatar();
  } catch { if (activeKey === current.key) clearAvatar(); }
  finally { if (loadingKey === current.key) loadingKey = ''; }
}

if (typeof window !== 'undefined') {
  void enhance();
  const observer = new MutationObserver(() => window.requestAnimationFrame(() => void enhance()));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', () => void enhance());
}
