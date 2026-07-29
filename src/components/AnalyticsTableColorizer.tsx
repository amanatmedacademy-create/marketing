import { useEffect } from 'react';
import '../analytics-table-colors.css';

const platformClass = (value: string) => {
  const text = value.toLowerCase();
  if (text.includes('meta')) return 'platform-meta';
  if (text.includes('tiktok')) return 'platform-tiktok';
  if (text.includes('яндекс') || text.includes('yandex')) return 'platform-yandex';
  if (text.includes('вконтакте') || text.includes('vk')) return 'platform-vk';
  if (text.includes('google')) return 'platform-google';
  if (text.includes('органик')) return 'platform-organic';
  return 'platform-other';
};

const parseMetric = (value: string) => {
  const normalized = value.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  return Number(normalized || 0);
};

export default function AnalyticsTableColorizer() {
  useEffect(() => {
    if (window.location.pathname !== '/analytics') return;

    const apply = () => {
      document.querySelectorAll<HTMLTableElement>('.v36-table table').forEach((table) => {
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim().toLowerCase());
        let activePlatform = 'platform-other';

        table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
          row.classList.remove('platform-meta','platform-tiktok','platform-yandex','platform-vk','platform-google','platform-organic','platform-other','analytics-campaign-row');
          const cells = Array.from(row.cells);
          const first = cells[0]?.textContent?.trim() || '';

          if (row.classList.contains('v36-group')) {
            activePlatform = platformClass(first);
            row.classList.add(activePlatform);
          } else {
            row.classList.add('analytics-campaign-row', activePlatform);
          }

          cells.forEach((cell, index) => {
            cell.classList.remove('metric-excellent','metric-good','metric-warning','metric-danger','recommend-scale','recommend-grow','recommend-watch','recommend-stop');
            const header = headers[index] || '';
            const text = (cell.textContent || '').trim();
            const value = parseMetric(text);

            if (header === 'roas') {
              if (value >= 3.5) cell.classList.add('metric-excellent');
              else if (value >= 2) cell.classList.add('metric-good');
              else if (value >= 1.5) cell.classList.add('metric-warning');
              else cell.classList.add('metric-danger');
            }

            if (header.includes('конверсия') || header === 'купили' || header === 'целевые' || header === 'пришли') {
              const percentMatch = text.match(/(\d+(?:[.,]\d+)?)%/);
              const percent = percentMatch ? Number(percentMatch[1].replace(',', '.')) : 0;
              if (percent >= 60) cell.classList.add('metric-excellent');
              else if (percent >= 40) cell.classList.add('metric-good');
              else if (percent >= 25) cell.classList.add('metric-warning');
              else if (percent > 0) cell.classList.add('metric-danger');
            }

            if (header === 'рекомендация') {
              const recommendation = text.toLowerCase();
              if (recommendation.includes('масштаб')) cell.classList.add('recommend-scale');
              else if (recommendation.includes('раст')) cell.classList.add('recommend-grow');
              else if (recommendation.includes('наблюд') || recommendation.includes('недостаточно')) cell.classList.add('recommend-watch');
              else if (recommendation.includes('отключ')) cell.classList.add('recommend-stop');
            }
          });
        });
      });
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
