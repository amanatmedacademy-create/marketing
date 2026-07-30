import { useEffect } from 'react';

const COMMUNICATION_TITLES = new Set(['Телефония', 'Коммуникации и телефония']);
const CANONICAL_TITLE = 'Коммуникации и телефония';

function integrationSections(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.integration-catalog-section'));
}

function communicationSections(): HTMLElement[] {
  return integrationSections().filter((section) => {
    const title = section.querySelector('h2')?.textContent?.trim() || '';
    return COMMUNICATION_TITLES.has(title);
  });
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

function removeDuplicateCards(section: HTMLElement) {
  const seen = new Set<string>();
  const cards = Array.from(section.querySelectorAll<HTMLElement>('.integration-catalog-grid > .integration-catalog-card'));

  for (const card of cards) {
    const identity = cardIdentity(card);
    if (!identity) continue;

    if (seen.has(identity)) {
      card.remove();
      continue;
    }

    seen.add(identity);
  }
}

function mergeCommunicationSections() {
  const sections = communicationSections();
  if (!sections.length) return;

  const primary =
    sections.find((section) => section.querySelector('h2')?.textContent?.trim() === CANONICAL_TITLE) ||
    sections.find((section) => section.dataset.catalogSection === 'telephony') ||
    sections[0];

  primary.dataset.catalogSection = 'telephony';
  const heading = primary.querySelector('h2');
  if (heading) heading.textContent = CANONICAL_TITLE;

  const targetGrid = primary.querySelector('.integration-catalog-grid');

  for (const section of sections) {
    if (section === primary) continue;

    const sourceGrid = section.querySelector('.integration-catalog-grid');
    if (sourceGrid && targetGrid) {
      for (const card of Array.from(sourceGrid.children)) targetGrid.appendChild(card);
    }

    section.remove();
  }

  removeDuplicateCards(primary);
}

function deduplicateCatalog() {
  mergeCommunicationSections();
  for (const section of integrationSections()) removeDuplicateCards(section);
}

export default function TelephonySectionDeduplicator() {
  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return;

    deduplicateCatalog();
    const observer = new MutationObserver(deduplicateCatalog);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
