import { useEffect } from 'react';

function telephonySections(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.integration-catalog-section')).filter(
    (section) => section.querySelector('h2')?.textContent?.trim() === 'Телефония',
  );
}

function removeTelephonyDuplicates() {
  const sections = telephonySections();
  if (sections.length <= 1) return;

  const primary = sections.find((section) => section.dataset.catalogSection === 'telephony') || sections[0];
  primary.dataset.catalogSection = 'telephony';

  for (const section of sections) {
    if (section !== primary) section.remove();
  }
}

export default function TelephonySectionDeduplicator() {
  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return;

    removeTelephonyDuplicates();
    const observer = new MutationObserver(removeTelephonyDuplicates);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
