import { createRoot, type Root } from 'react-dom/client';
import { BadgeCheck, MessageCircle } from 'lucide-react';
import './whatsapp-business-profile.css';

type WhatsAppBusinessProfile = {
  profilePictureUrl?: string | null;
  verifiedName?: string | null;
  displayPhoneNumber?: string | null;
  qualityRating?: string | null;
  about?: string | null;
};

type WabaConfigResponse = {
  connected?: boolean;
  connection?: {
    businessProfile?: WhatsAppBusinessProfile | null;
  } | null;
};

let profilePromise: Promise<WhatsAppBusinessProfile | null> | null = null;

async function loadProfile(): Promise<WhatsAppBusinessProfile | null> {
  if (profilePromise) return profilePromise;
  profilePromise = fetch('/api/integrations/waba/config', { cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json().catch(() => null) as WabaConfigResponse | null;
      if (!response.ok || !payload?.connected) return null;
      return payload.connection?.businessProfile || null;
    })
    .catch(() => null);
  return profilePromise;
}

function BusinessBadge({ profile, compact = false }: { profile: WhatsAppBusinessProfile; compact?: boolean }) {
  const label = profile.verifiedName || 'WhatsApp Business';
  return <div className={`imds-waba-profile ${compact ? 'is-compact' : ''}`} title="Подключённый WhatsApp Business профиль клиники">
    {profile.profilePictureUrl
      ? <img src={profile.profilePictureUrl} alt="WhatsApp Business" referrerPolicy="no-referrer"/>
      : <span className="imds-waba-profile__fallback"><MessageCircle size={compact ? 13 : 18}/></span>}
    <div className="imds-waba-profile__copy">
      <strong>{label}{profile.verifiedName && <BadgeCheck size={compact ? 11 : 13}/>}</strong>
      {!compact && <small>{profile.displayPhoneNumber || 'WhatsApp Business'}</small>}
    </div>
  </div>;
}

type Mount = { host: HTMLElement; root: Root };
let headerMount: Mount | null = null;
let crmMount: Mount | null = null;
let currentProfile: WhatsAppBusinessProfile | null = null;
let loading = false;

function isWhatsAppSelected(): boolean {
  const text = document.querySelector('.callcenter-root .inbox-contact-title small')?.textContent || '';
  return /whatsapp/i.test(text);
}

function ensureHost(parent: Element | null, key: string, className: string): HTMLElement | null {
  if (!parent) return null;
  let host = parent.querySelector<HTMLElement>(`[data-${key}]`);
  if (!host) {
    host = document.createElement('div');
    host.setAttribute(`data-${key}`, '1');
    host.className = className;
    parent.appendChild(host);
  }
  return host;
}

function renderMount(current: Mount | null, host: HTMLElement | null, node: React.ReactNode): Mount | null {
  if (!host) {
    current?.root.unmount();
    return null;
  }
  if (!current || current.host !== host) {
    current?.root.unmount();
    current = { host, root: createRoot(host) };
  }
  current.root.render(node);
  return current;
}

function clear(): void {
  headerMount?.root.unmount();
  crmMount?.root.unmount();
  headerMount = null;
  crmMount = null;
  document.querySelectorAll('[data-imds-waba-header],[data-imds-waba-crm]').forEach((node) => node.remove());
}

function render(): void {
  if (!currentProfile || !isWhatsAppSelected()) {
    clear();
    return;
  }
  const contactTitle = document.querySelector('.callcenter-root .inbox-contact-title');
  const crmProfile = document.querySelector('.callcenter-root .inbox-crm-profile');
  const headerHost = ensureHost(contactTitle, 'imds-waba-header', 'imds-waba-header-host');
  const crmHost = ensureHost(crmProfile, 'imds-waba-crm', 'imds-waba-crm-host');
  headerMount = renderMount(headerMount, headerHost, <BusinessBadge profile={currentProfile} compact/>);
  crmMount = renderMount(crmMount, crmHost, <BusinessBadge profile={currentProfile}/>);
}

function enhance(): void {
  if (!document.querySelector('.callcenter-root')) {
    clear();
    return;
  }
  if (currentProfile) {
    render();
    return;
  }
  if (loading) return;
  loading = true;
  void loadProfile().then((profile) => {
    currentProfile = profile;
    render();
  }).finally(() => { loading = false; });
}

if (typeof window !== 'undefined') {
  enhance();
  const observer = new MutationObserver(() => window.requestAnimationFrame(enhance));
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('focus', enhance);
}
