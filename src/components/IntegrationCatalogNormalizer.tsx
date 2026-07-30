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

function cardTitle(card: HTMLElement): string {
  return (
    card.querySelector('.integration-platform-heading > strong')?.textContent ||
    card.querySelector(':scope > strong')?.textContent ||
    ''
  ).trim().toLowerCase();
}

function cardIdentity(card: HTMLElement): string {
  const title = cardTitle(card);
  if (title) return `title:${title}`;

  const platform = card.dataset.platform?.trim().toLowerCase();
  return platform ? `platform:${platform}` : '';
}

function isWorkingCard(card: HTMLElement): boolean {
  return !card.classList.contains('integration-state-planned');
}

function cloneWorkingCard(sourceCard: HTMLElement): HTMLElement {
  const clone = sourceCard.cloneNode(true) as HTMLElement;
  clone.dataset.migratedWorkingCard = 'true';

  const sourceButton = sourceCard.querySelector<HTMLButtonElement>('button');
  const cloneButton = clone.querySelector<HTMLButtonElement>('button');

  if (cloneButton && sourceButton) {
    cloneButton.disabled = sourceButton.disabled;
    cloneButton.addEventListener('click', (event) => {
      event.preventDefault();
      sourceButton.click();
    });
  }

  return clone;
}

function replacePlannedWithWorking(targetGrid: HTMLElement, sourceCard: HTMLElement) {
  const identity = cardIdentity(sourceCard);
  if (!identity) return;

  const existingCards = Array.from(targetGrid.querySelectorAll<HTMLElement>(':scope > .integration-catalog-card'));
  const existingWorking = existingCards.find(
    (card) => cardIdentity(card) === identity && isWorkingCard(card),
  );
  if (existingWorking) return;

  const planned = existingCards.find(
    (card) => cardIdentity(card) === identity && !isWorkingCard(card),
  );
  planned?.remove();

  targetGrid.prepend(cloneWorkingCard(sourceCard));
}

function deduplicateCards(section: HTMLElement) {
  const cards = Array.from(section.querySelectorAll<HTMLElement>('.integration-catalog-grid > .integration-catalog-card'));
  const byIdentity = new Map<string, HTMLElement>();

  for (const card of cards) {
    const identity = cardIdentity(card);
    if (!identity) continue;

    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, card);
      continue;
    }

    if (isWorkingCard(card) && !isWorkingCard(existing)) {
      existing.remove();
      byIdentity.set(identity, card);
    } else {
      card.remove();
    }
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

    const targetGrid = primary.querySelector<HTMLElement>('.integration-catalog-grid');
    if (!targetGrid) return false;

    for (const legacy of sections) {
      if (legacy === primary) continue;

      const workingCards = Array.from(
        legacy.querySelectorAll<HTMLElement>('.integration-catalog-grid > .integration-catalog-card'),
      );

      for (const card of workingCards) replacePlannedWithWorking(targetGrid, card);

      legacy.dataset.legacyCatalogSection = 'true';
      legacy.hidden = true;
      legacy.style.display = 'none';
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
      if (attempts++ < 80) timer = window.setTimeout(run, 100);
    };

    run();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
