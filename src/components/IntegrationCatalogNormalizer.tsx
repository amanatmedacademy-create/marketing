import { useEffect } from 'react';

const SECTION_ORDER = [
  'Рекламные кабинеты',
  'CRM',
  'Коммуникации и телефония',
  'Автоматизация и API',
] as const;

const REQUIRED_WORKING_CARDS = new Map([
  ['meta ads', 'meta'],
  ['tiktok ads', 'tiktok'],
  ['bitrix24', 'bitrix24'],
]);

function sectionTitle(section: Element): string {
  const title = section.querySelector('h2')?.textContent?.trim() || '';
  return title === 'Телефония' ? 'Коммуникации и телефония' : title;
}

function cardTitle(card: HTMLElement): string {
  const explicit = (
    card.querySelector('.integration-platform-heading > strong')?.textContent ||
    card.querySelector(':scope > strong')?.textContent ||
    card.querySelector('h3')?.textContent ||
    card.querySelector('h4')?.textContent ||
    ''
  ).trim().toLowerCase();

  if (explicit) return explicit;

  const text = card.textContent?.toLowerCase() || '';
  for (const title of REQUIRED_WORKING_CARDS.keys()) {
    if (text.includes(title)) return title;
  }

  return '';
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
  const title = cardTitle(sourceCard);
  const platform = REQUIRED_WORKING_CARDS.get(title);

  clone.dataset.migratedWorkingCard = 'true';
  if (platform) clone.dataset.platform = platform;

  const sourceButtons = Array.from(sourceCard.querySelectorAll<HTMLButtonElement>('button'));
  const cloneButtons = Array.from(clone.querySelectorAll<HTMLButtonElement>('button'));

  cloneButtons.forEach((cloneButton, index) => {
    const sourceButton = sourceButtons[index];
    if (!sourceButton) return;

    cloneButton.disabled = sourceButton.disabled;
    cloneButton.addEventListener('click', (event) => {
      event.preventDefault();
      sourceButton.click();
    });
  });

  return clone;
}

function replacePlannedWithWorking(targetGrid: HTMLElement, sourceCard: HTMLElement) {
  const title = cardTitle(sourceCard);
  if (!REQUIRED_WORKING_CARDS.has(title)) return;

  const identity = `title:${title}`;
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
      legacy.style.setProperty('display', 'none', 'important');
    }

    deduplicateCards(primary);
    normalized.push(primary);
  }

  for (const section of normalized) page.appendChild(section);

  const newAdvertising = grouped.get('Рекламные кабинеты')?.find((section) => section.dataset.catalogExpanded === 'true');
  const newCrm = grouped.get('CRM')?.find((section) => section.dataset.catalogExpanded === 'true');
  const advertisingText = newAdvertising?.textContent?.toLowerCase() || '';
  const crmText = newCrm?.textContent?.toLowerCase() || '';

  return advertisingText.includes('meta ads') && advertisingText.includes('tiktok ads') && crmText.includes('bitrix24');
}

export default function IntegrationCatalogNormalizer() {
  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return;

    let attempts = 0;
    let stablePasses = 0;
    let timer: number | undefined;

    const run = () => {
      const complete = normalizeCatalog();
      if (complete) stablePasses += 1;
      else stablePasses = 0;

      if (stablePasses >= 5 || attempts++ >= 100) return;
      timer = window.setTimeout(run, 150);
    };

    run();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
