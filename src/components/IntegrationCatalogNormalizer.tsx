import { useEffect } from 'react';

const SECTION_ORDER = [
  'Рекламные кабинеты',
  'CRM',
  'Коммуникации и телефония',
  'Автоматизация и API',
] as const;

function sectionTitle(section: Element): string {
  const title = section.querySelector('h2')?.textContent?.trim() || '';
  return title === 'Телефония' ? 'Коммуникации и телефония' : title;
}

function cardIdentity(card: HTMLElement): string {
  const platform = card.dataset.platform?.trim().toLowerCase();
  if (platform) return `platform:${platform}`;

  const title = (
    card.querySelector('.integration-platform-heading > strong')?.textContent ||
    card.querySelector(':scope > strong')?.textContent ||
    ''
  ).trim().toLowerCase();

  return title ? `title:${title}` : '';
}

function mergeSectionCards(primary: HTMLElement, duplicate: HTMLElement) {
  const targetGrid = primary.querySelector<HTMLElement>('.integration-catalog-grid');
  const sourceGrid = duplicate.querySelector<HTMLElement>('.integration-catalog-grid');
  if (targetGrid && sourceGrid) {
    for (const card of Array.from(sourceGrid.children)) targetGrid.appendChild(card);
  }
  duplicate.remove();
}

function deduplicateCards(section: HTMLElement) {
  const seen = new Set<string>();
  const cards = Array.from(section.querySelectorAll<HTMLElement>('.integration-catalog-grid > .integration-catalog-card'));

  for (const card of cards) {
    const identity = cardIdentity(card);
    if (!identity) continue;
    if (seen.has(identity)) card.remove();
    else seen.add(identity);
  }
}

function normalizeCatalog(): boolean {
  const page = document.querySelector<HTMLElement>('.connections-page');
  if (!page) return false;

  const allSections = Array.from(page.querySelectorAll<HTMLElement>('.integration-catalog-section'));
  const grouped = new Map<string, HTMLElement[]>();

  for (const section of allSections) {
    const title = sectionTitle(section);
    const list = grouped.get(title) || [];
    list.push(section);
    grouped.set(title, list);
  }

  if (!SECTION_ORDER.every((title) => grouped.has(title))) return false;
  if (!SECTION_ORDER.every((title) => grouped.get(title)?.some((section) => section.dataset.catalogExpanded === 'true'))) return false;

  const normalized: HTMLElement[] = [];

  for (const title of SECTION_ORDER) {
    const sections = grouped.get(title) || [];
    const primary = sections.find((section) => section.dataset.catalogExpanded === 'true');
    if (!primary) return false;

    const heading = primary.querySelector('h2');
    if (heading) heading.textContent = title;

    for (const duplicate of sections) {
      if (duplicate !== primary) mergeSectionCards(primary, duplicate);
    }

    deduplicateCards(primary);
    normalized.push(primary);
  }

  for (const section of normalized) page.appendChild(section);

  return true;
}

export default function IntegrationCatalogNormalizer() {
  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return;

    let attempts = 0;
    let timer: number | undefined;

    const run = () => {
      if (normalizeCatalog()) return;
      if (attempts++ < 60) timer = window.setTimeout(run, 100);
    };

    run();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
