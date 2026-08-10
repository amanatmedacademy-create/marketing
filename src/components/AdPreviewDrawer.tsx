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

type MetaPreviewFrame = { src: string; width?: number; height?: number };
type PreviewLayout = { width: number; height: number; scale: number };

const modeLabels: Array<{ id: Mode; label: string; icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Desktop', icon: Monitor },
  { id: 'instagram', label: 'Instagram', icon: ImageIcon },
  { id: 'mobile', label: 'Mobile', icon: Smartphone },
];

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

function parseFrameDimension(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractMetaPreviewFrame(html?: string): MetaPreviewFrame | null {
  if (!html || typeof DOMParser === 'undefined') return null;
  try {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const iframe = document.querySelector('iframe');
    if (!iframe) return null;
    const rawSrc = iframe.getAttribute('src') || '';
    const src = safeExternalUrl(rawSrc.startsWith('//') ? `https:${rawSrc}` : rawSrc);
    if (!src) return null;
    const style = iframe.getAttribute('style') || '';
    const styleWidth = style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i)?.[1] || null;
    const styleHeight = style.match(/(?:^|;)\s*height\s*:\s*([^;]+)/i)?.[1] || null;
    return {
      src,
      width: parseFrameDimension(iframe.getAttribute('width')) || parseFrameDimension(styleWidth),
      height: parseFrameDimension(iframe.getAttribute('height')) || parseFrameDimension(styleHeight),
    };
  } catch { return null; }
}

function DeviceMetaPreview({ frame, mode }: { frame: MetaPreviewFrame; mode: Mode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const isDesktop = mode === 'desktop';
  const intrinsicWidth = frame.width || (isDesktop ? 900 : mode === 'instagram' ? 500 : 360);
  const intrinsicHeight = frame.height || (isDesktop ? 680 : mode === 'instagram' ? 760 : 720);
  const [layout, setLayout] = useState<PreviewLayout>({ width: isDesktop ? 580 : 420, height: isDesktop ? 520 : 680, scale: 1 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const border = isDesktop ? 2 : 16;
      const chrome = isDesktop ? 36 : 52;
      const maxWidth = isDesktop ? 590 : 440;
      const minWidth = isDesktop ? 320 : 280;
      const width = Math.max(minWidth, Math.min(rect.width - 2, maxWidth));
      const screenWidth = Math.max(1, width - border);
      const scale = Math.max(0.1, Math.min(screenWidth / intrinsicWidth, isDesktop ? 1.15 : 1.25));
      const naturalHeight = Math.ceil(intrinsicHeight * scale + chrome + border);
      const height = Math.max(isDesktop ? 240 : 360, Math.min(rect.height - 2, naturalHeight));
      setLayout({ width: Math.floor(width), height: Math.floor(height), scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [intrinsicHeight, intrinsicWidth, isDesktop]);

  return <div className="ad-preview-device-host" ref={hostRef}>
    <div className={`ad-preview-device ${isDesktop ? 'device-desktop' : 'device-phone'} mode-${mode}`} style={{ width: layout.width, height: layout.height }}>
      {isDesktop ? <div className="ad-preview-desktop-chrome"><div className="ad-preview-window-dots"><i/><i/><i/></div><div className="ad-preview-address">Meta Ads Preview</div></div> : <div className="ad-preview-phone-chrome"><span className="ad-preview-phone-time">9:41</span><span className="ad-preview-phone-speaker"/><span className="ad-preview-phone-status">● ●</span></div>}
      <div className="ad-preview-device-screen">
        <div className="ad-preview-native-content" style={{ width: intrinsicWidth * layout.scale, height: intrinsicHeight * layout.scale }}>
          <iframe className="ad-preview-native-frame" title="Meta ad preview" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms" referrerPolicy="no-referrer" src={frame.src} style={{ width: intrinsicWidth, height: intrinsicHeight, transform: `scale(${layout.scale})` }}/>
        </div>
      </div>
      {!isDesktop && <div className="ad-preview-phone-home"><span/></div>}
    </div>
  </div>;
}

export default function AdPreviewDrawer({ adId, onClose }: { adId: string | null; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('desktop');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!adId) return;
    setMode('desktop');
    setPreview(null);
    setError('');
  }, [adId]);

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
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [adId, onClose]);

  const content = preview?.content;
  const destinationUrl = safeExternalUrl(content?.destinationUrl);
  const cta = useMemo(() => content?.callToAction?.replace(/_/g, ' ') || 'Подробнее', [content?.callToAction]);
  const nativeFrame = useMemo(() => extractMetaPreviewFrame(preview?.previewHtml), [preview?.previewHtml]);

  if (!adId) return null;

  return <div className="ad-preview-layer" role="dialog" aria-modal="true" aria-label="Предпросмотр объявления">
    <button className="ad-preview-backdrop" type="button" aria-label="Закрыть" onClick={onClose}/>
    <aside className="ad-preview-drawer">
      <header><div><span>AD PREVIEW</span><h2>{content?.adName || `Объявление ${adId}`}</h2></div><button type="button" onClick={onClose} aria-label="Закрыть"><X size={20}/></button></header>
      <nav className="ad-preview-modes">{modeLabels.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={mode === id ? 'active' : ''} onClick={() => setMode(id)}><Icon size={15}/>{label}</button>)}</nav>
      <section className={`ad-preview-stage mode-${mode}`}>
        {loading && <div className="ad-preview-state"><LoaderCircle className="spin"/><span>Загружаем контент из Meta…</span></div>}
        {error && <div className="ad-preview-state error"><div><strong>Не удалось загрузить превью</strong><p>{error}</p></div></div>}
        {!loading && !error && preview?.previewHtml && nativeFrame && <DeviceMetaPreview frame={nativeFrame} mode={mode}/>} 
        {!loading && !error && preview?.previewHtml && !nativeFrame && <iframe className="ad-preview-srcdoc-frame" title="Meta ad preview" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms" referrerPolicy="no-referrer" srcDoc={preview.previewHtml}/>} 
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
