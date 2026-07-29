import { useEffect } from 'react';

export default function RemoveLegacyConversionCards() {
  useEffect(() => {
    const removeLegacyCards = () => {
      document.querySelectorAll<HTMLElement>('.v36-dashboard > .v36-heat-sections').forEach((section) => section.remove());
    };

    removeLegacyCards();
    const observer = new MutationObserver(removeLegacyCards);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
