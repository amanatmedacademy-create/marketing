import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Image as ImageIcon, LoaderCircle, Monitor, Smartphone, X } from 'lucide-react';
import '../ad-preview.css';

type Mode = 'desktop' | 'mobile' | 'instagram';

type AdPreviewContent = {
  adId: string;
  adName: string;
  pageId?: string;
  instagramActorId?: string;
  message?: string;
  headline?: string;
  description?: string;
  destinationUrl?: string;
  callToAction?: string;
  imageUrl?: string;
  videoId?: string;
  thumbnailUrl?: string;
  effectiveStoryId?: string;
};

type PreviewResponse = {
  platform: string;
  mode: Mode;
  previewHtml?: string;
  previewFormat?: string;
  previewError?: string;
  content: AdPreviewContent;
};

type AdIndexRow = { ad_id: string; ad_name: string; creative_name?: string };
type AdIndexResponse = { rows?: AdIndexRow[] };

const modeLabels: Array<{ id: Mode; label: string; icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Desktop', icon: Monitor },
  { id: 'mobile', label: 'Mobile', icon: Smartphone },
  { id: 'instagram', label: 'Instagram', icon: ImageIcon },
];

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function safeExternalUrl(value?: string) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function hostname(value?: string) {
  const safe = safeExternalUrl(value);
  if (!safe) return 'Рекламное объявление';
  try { return new URL(safe).hostname; } catch { return 'Рекламное объявление'; }
}

function parseErrorBody(body: string, fallback: string) {
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === 'string' && parsed.error ? parsed.error : body;
  } catch { return body; }
}

function extractAdId(row: HTMLElement, nameIndex: Map<string, string>): string {
  const explicit = (row.innerText || '').match(/(?:Объявление|Ad)\s*[·:]\s*(\d{5,})/i)?.[1];
  if (explicit) return explicit;
  const label = row.querySelector('strong, .v36-tree-label b')?.textContent || '';
  return nameIndex.get(normalize(label)) || '';
}

function isAdRow(row: HTMLElement): boolean {
  if (row.classList.contains('v36-level-ad')) return true;
  if (!row.closest('.ads-table-wrap')) return false;
  return Boolean(row.querySelector('strong')) && !row.closest('thead');
}

function injectPreviewButtons(nameIndex: Map<string, string>) {
  document.querySelectorAll<HTMLElement>('tr').forEach((row) => {
    if (!isAdRow(row) || row.dataset.adPreviewReady === 'true') return;
    const adId = extractAdId(row, nameIndex);
    if (!adId) return;
    const target = row.querySelector<HTMLElement>('.v36-tree-label > div, td:nth-child(3), td:nth-child(2)') || row.querySelector<HTMLElement>('td');
    if (!target) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ad-preview-trigger';
    button.dataset.adId = adId;
    button.textContent = 'Превью';
    button.setAttribute('aria-label', 'Открыть превью объявления');
    target.appendChild(button);
    row.dataset.adPreviewReady = 'true';
  });
}

export default function AdPreviewEnhancer() {
  const [adId, setAdId] = useState('');
  const [mode, setMode] = useState<Mode>('desktop');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nameIndex, setNameIndex] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    fetch('/api/analytics/ad-manager?days=365')
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<AdIndexResponse>;
      })
      .then((data) => {
        if (!active) return;
        const counts = new Map<string, string[]>();
        for (const row of data.rows || []) {
          const key = normalize(row.ad_name || row.creative_name || '');
          if (!key || !row.ad_id) continue;
          counts.set(key, [...(counts.get(key) || []), row.ad_id]);
        }
        setNameIndex(new Map([...counts.entries()].filter(([, ids]) => new Set(ids).size === 1).map(([key, ids]) => [key, ids[0]])));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const run = () => injectPreviewButtons(nameIndex);
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    const click = (event: MouseEvent) => {
      const trigger = (event.target as HTMLElement).closest<HTMLElement>('.ad-preview-trigger');
      if (!trigger?.dataset.adId) return;
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
      setError('');
      setAdId(trigger.dataset.adId);
      setMode('desktop');
    };
    document.addEventListener('click', click, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', click, true);
    };
  }, [nameIndex]);

  useEffect(() => {
    if (!adId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/analytics/ad-preview?adId=${encodeURIComponent(adId)}&mode=${mode}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.text();
        if (!response.ok) throw new Error(parseErrorBody(body, `HTTP ${response.status}`));
        return JSON.parse(body) as PreviewResponse;
      })
      .then(setPreview)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [adId, mode]);

  useEffect(() => {
    if (!adId) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setAdId(''); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [adId]);

  const content = preview?.content;
  const destinationUrl = safeExternalUrl(content?.destinationUrl);
  const cta = useMemo(() => content?.callToAction?.replace(/_/g, ' ') || 'Подробнее', [content?.callToAction]);

  if (!adId) return null;

  return <div className="ad-preview-layer" role="dialog" aria-modal="true" aria-label="Предпросмотр объявления">
    <button className="ad-preview-backdrop" type="button" aria-label="Закрыть" onClick={() => setAdId('')}/>
    <aside className="ad-preview-drawer">
      <header>
        <div><span>AD PREVIEW</span><h2>{content?.adName || `Объявление ${adId}`}</h2></div>
        <button type="button" onClick={() => setAdId('')} aria-label="Закрыть"><X size={20}/></button>
      </header>

      <nav className="ad-preview-modes">
        {modeLabels.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={mode === id ? 'active' : ''} onClick={() => setMode(id)}><Icon size={15}/>{label}</button>)}
      </nav>

      <section className={`ad-preview-stage mode-${mode}`}>
        {loading && <div className="ad-preview-state"><LoaderCircle className="spin"/><span>Загружаем контент из Meta…</span></div>}
        {error && <div className="ad-preview-state error"><div><strong>Не удалось загрузить превью</strong><p>{error}</p></div></div>}
        {!loading && !error && preview?.previewHtml && <iframe title="Meta ad preview" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms" referrerPolicy="no-referrer" srcDoc={preview.previewHtml}/>} 
        {!loading && !error && !preview?.previewHtml && content && <article className="ad-preview-fallback">
          <header><div className="ad-preview-page">AM</div><div><strong>{content.pageId ? `Страница ${content.pageId}` : 'Meta Ads'}</strong><span>Реклама · 🌐</span></div></header>
          {content.message && <p className="ad-preview-message">{content.message}</p>}
          <div className="ad-preview-media">{content.imageUrl || content.thumbnailUrl ? <img src={content.imageUrl || content.thumbnailUrl} alt={content.headline || content.adName}/> : <ImageIcon size={42}/>}</div>
          <div className="ad-preview-link"><div><span>{hostname(destinationUrl)}</span><strong>{content.headline || content.adName}</strong><p>{content.description || 'Описание не указано'}</p></div>{destinationUrl ? <a href={destinationUrl} target="_blank" rel="noreferrer">{cta}<ExternalLink size={14}/></a> : <button type="button">{cta}</button>}</div>
          {preview?.previewError && <small className="ad-preview-warning">Meta не вернула готовый формат для выбранного размещения. Показан фактический контент креатива.</small>}
        </article>}
      </section>

      {content && <footer className="ad-preview-meta"><span>ID: {content.adId}{preview?.previewFormat ? ` · ${preview.previewFormat}` : ''}</span>{destinationUrl && <a href={destinationUrl} target="_blank" rel="noreferrer">Открыть ссылку <ExternalLink size={13}/></a>}</footer>}
    </aside>
  </div>;
}
