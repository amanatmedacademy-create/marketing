import { useState } from 'react';
import { Download } from 'lucide-react';
import { marketingApi, type SourceSummaryRow } from '../services/api';

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function buildSourcesCsv(rows: SourceSummaryRow[]) {
  const header = ['Источник', 'Платформа', 'Лиды', 'Продажи', 'Расход', 'Выручка', 'ROAS'];
  const body = rows.map((row) => {
    const spend = Number(row.spend || 0);
    const revenue = Number(row.revenue || 0);
    const roas = spend ? revenue / spend : 0;
    return [
      row.source || '',
      row.platform || '',
      Number(row.leads || 0),
      Number(row.sales || 0),
      spend,
      revenue,
      roas.toFixed(2),
    ];
  });
  return [header, ...body].map((row) => row.map(csvCell).join(';')).join('\n');
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function DashboardCsvExport() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const rows = await marketingApi.sources();
      const date = new Date().toISOString().slice(0, 10);
      downloadTextFile(buildSourcesCsv(rows), `imds-marketing-sources-${date}.csv`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось выгрузить CSV');
    } finally {
      setExporting(false);
    }
  };

  return <div className="dashboard-csv-export">
    {error && <span className="note">{error}</span>}
    <button className="button dashboard-csv-export__button" type="button" onClick={handleExport} disabled={exporting}>
      <Download size={16}/>
      {exporting ? 'Экспорт...' : 'Экспорт CSV'}
    </button>
  </div>;
}
