import { useEffect, useMemo, useRef, useState } from 'react';
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

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setStageSize({ width: rect.width, height: rect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [adId]);

  const content = preview?.content;
  const destinationUrl = safeExternalUrl(content?.destinationUrl);
  const cta = useMemo(() => content?.callToAction?.replace(/_/g, ' ') || 'Подробнее', [content?.callToAction]);

  // Meta отдаёт пост вложенным iframe с фиксированными width/height —
  // берём натуральный размер и масштабируем под размер сцены модалки.
  const frame = useMemo(() => {
    const html = preview?.previewHtml || '';
    const width = Number(/width="?(\d{2,4})/i.exec(html)?.[1]) || 0;
    const height = Number(/height="?(\d{2,4})/i.exec(html)?.[1]) || 0;
    return width >= 100 && height >= 100 ? { width, height } : null;
  }, [preview?.previewHtml]);

  // Desktop-фид Meta рендерит карточку ~500px, хотя iframe объявлен шире —
  // лишний белый «воздух» справа обрезаем, считая масштаб по ширине карточки.
  const contentWidth = frame
    ? (mode === 'desktop' && frame.width > 502 ? 502 : frame.width)
    : 0;

  const scale = frame && stageSize.width > 0 && stageSize.height > 0
    ? Math.min(stageSize.width / contentWidth, stageSize.height / frame.height)
    : 1;

  // В мобильных форматах Meta объявляет высоту меньше фактического контента —
  // внутри поста появляется скролл. Высота вложенного iframe в srcdoc наша,
  // поэтому удлиняем его (до 25% сверх объявленной) и отключаем прокрутку.
  const extendable = mode !== 'desktop';
  const scaledDeclaredHeight = frame ? frame.height * scale : 0;
  const clipHeight = frame
    ? Math.floor(extendable && stageSize.height > 0
      ? Math.min(stageSize.height, scaledDeclaredHeight * 1.25)
      : scaledDeclaredHeight)
    : 0;
  const renderHeight = frame ? Math.ceil(clipHeight / (scale || 1)) : 0;

  const srcDoc = useMemo(() => {
    const html = preview?.previewHtml || '';
    if (!html) return '';
    const adjusted = extendable && frame
      ? html.replace(/height="?\d{2,4}"?/i, `height="${renderHeight}"`).replace(/<iframe/i, '<iframe scrolling="no"')
      : html;
    return `<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}iframe{display:block;border:0}</style>${adjusted}`;
  }, [preview?.previewHtml, extendable, frame, renderHeight]);

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

      <section className={`ad-preview-stage mode-${mode}`} ref={stageRef}>
        {loading && <div className="ad-preview-state"><LoaderCircle className="spin"/><span>Загружаем контент из Meta…</span></div>}
        {error && <div className="ad-preview-state error"><div><strong>Не удалось загрузить превью</strong><p>{error}</p></div></div>}
        {!loading && !error && preview?.previewHtml && (frame
          ? <div className="ad-preview-scalebox" style={{ width: Math.floor(contentWidth * scale), height: clipHeight }}>
              <iframe title="Meta ad preview" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms" referrerPolicy="no-referrer" srcDoc={srcDoc}
                style={{ width: frame.width, height: extendable ? renderHeight : frame.height, transform: `scale(${scale})` }}/>
            </div>
          : <iframe title="Meta ad preview" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms" referrerPolicy="no-referrer" srcDoc={srcDoc}/>)}
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
