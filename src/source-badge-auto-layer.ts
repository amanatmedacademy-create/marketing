type Brand = { slug: string; color: string; surface?: string };

const SOURCE_SELECTORS = [
  '.lead-table-wrap tbody td:nth-child(2)',
  '.lead-details dd',
  '.inbox-crm-section dd',
] as const;

function sourceBrands(source: string): Brand[] {
  const value = source.trim().toLowerCase();
  const brands: Brand[] = [];
  const add = (brand: Brand) => { if (!brands.some((item) => item.slug === brand.slug)) brands.push(brand); };

  if (value.includes('meta')) add({ slug: 'meta', color: '0866FF' });
  if (value.includes('whatsapp') || value.includes('waba')) add({ slug: 'whatsapp', color: '25D366' });
  if (value.includes('instagram')) add({ slug: 'instagram', color: 'E4405F' });
  if (value.includes('facebook') || /(^|\W)fb($|\W)/.test(value)) add({ slug: 'facebook', color: '1877F2' });
  if (value.includes('google')) add({ slug: 'googleads', color: '4285F4' });
  if (value.includes('tiktok')) add({ slug: 'tiktok', color: '000000', surface: 'ffffff' });
  if (value.includes('youtube')) add({ slug: 'youtube', color: 'FF0000' });
  if (value.includes('telegram')) add({ slug: 'telegram', color: '26A5E4' });

  return brands.slice(0, 2);
}

function isSourceDetail(node: Element): boolean {
  const parent = node.closest('div');
  const label = parent?.querySelector('dt')?.textContent?.trim().toLowerCase();
  return label === 'источник';
}

function sourceText(node: Element): string {
  if (node.matches('.lead-table-wrap tbody td:nth-child(2)')) {
    return node.querySelector('b')?.textContent?.trim() || '';
  }
  if ((node.matches('.lead-details dd') || node.matches('.inbox-crm-section dd')) && isSourceDetail(node)) {
    return node.textContent?.trim() || '';
  }
  return '';
}

function decorate(node: Element): void {
  if (!(node instanceof HTMLElement) || node.dataset.sourceDecorated === '1') return;
  const source = sourceText(node);
  if (!source || source === '—' || /не указан/i.test(source)) return;
  const brands = sourceBrands(source);
  if (!brands.length) return;

  const badge = document.createElement('span');
  badge.className = 'source-badge source-badge--auto';
  badge.title = source;
  badge.setAttribute('aria-label', `Источник: ${source}`);

  const icons = document.createElement('span');
  icons.className = 'source-badge__icons';
  icons.setAttribute('aria-hidden', 'true');
  for (const brand of brands) {
    const holder = document.createElement('span');
    holder.className = 'source-badge__icon';
    if (brand.surface) holder.style.background = `#${brand.surface}`;
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = `https://cdn.simpleicons.org/${brand.slug}/${brand.color}`;
    image.addEventListener('error', () => { holder.style.display = 'none'; }, { once: true });
    holder.appendChild(image);
    icons.appendChild(holder);
  }
  badge.appendChild(icons);

  if (node.matches('.lead-table-wrap tbody td:nth-child(2)')) {
    const label = node.querySelector('b');
    if (label) label.insertAdjacentElement('beforebegin', badge);
    else node.prepend(badge);
  } else {
    node.prepend(badge);
  }
  node.dataset.sourceDecorated = '1';
}

function scan(root: ParentNode = document): void {
  for (const selector of SOURCE_SELECTORS) {
    root.querySelectorAll(selector).forEach(decorate);
  }
}

let scheduled = false;
function scheduleScan(): void {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    scan();
  });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan(), { once: true });
  else scan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
