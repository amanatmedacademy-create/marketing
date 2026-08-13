import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Image as ImageIcon, LoaderCircle, Play, X } from 'lucide-react';
import '../ad-preview-imds.css';

export type AdPreviewContext = {
  platform?: string;
  accountName?: string;
  accountId?: string;
  campaignName?: string;
  campaignId?: string;
  adsetName?: string;
  adsetId?: string;
  adName?: string;
  status?: string;
  currency?: string | null;
  spend?: number;
  leads?: number;
  sales?: number;
  cpl?: number;
  ctr?: number;
  impressions?: number;
};

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
  content: AdPreviewContent;
};

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

const formatNumber = (value = 0) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const formatMoney = (value = 0, currency?: string | null) => {
  if (!currency) return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0));
  try { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0)); }
  catch { return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency}`; }
};

export default function AdPreviewDrawer({ adId, onClose, context }: { adId: string | null; onClose: () => void; context?: AdPreviewContext | null }) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!adId) return;
    const controller = new AbortController();
    setLoading(true);
    setPreview(null);
    setError('');
    fetch(`/api/analytics/ad-preview?adId=${encodeURIComponent(adId)}`, { signal: controller.signal })
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
  }, [adId]);

  useEffect(() => {
    if (!adId) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [adId, onClose]);

  const content = preview?.content;
  const destinationUrl = safeExternalUrl(content?.destinationUrl);
  const cta = useMemo(() => content?.callToAction?.replace(/_/g, ' ') || 'Подробнее', [content?.callToAction]);
  const media = content?.imageUrl || content?.thumbnailUrl;
  const isVideo = Boolean(content?.videoId);

  if (!adId) return null;

  return <div className="ad-preview-layer" role="dialog" aria-modal="true" aria-label="Предпросмотр объявления">
    <button className="ad-preview-backdrop" type="button" aria-label="Закрыть" onClick={onClose}/>
    <aside className="ad-preview-drawer">
      <header className="ad-preview-header">
        <div><span>IMDS CREATIVE PREVIEW</span><h2>{content?.adName || context?.adName || `Объявление ${adId}`}</h2></div>
        <button type="button" onClick={onClose} aria-label="Закрыть"><X size={20}/></button>
      </header>

      <section className="ad-preview-stage">
        {loading && <div className="ad-preview-state"><LoaderCircle className="spin"/><span>Загружаем фактический creative data…</span></div>}
        {error && <div className="ad-preview-state error"><div><strong>Не удалось загрузить creative data</strong><p>{error}</p></div></div>}
        {!loading && !error && content && <div className="ad-preview-layout">
          <article className="ad-preview-card">
            <header><div className="ad-preview-page">IM</div><div><strong>{context?.accountName || (content.pageId ? `Страница ${content.pageId}` : 'Meta Ads')}</strong><span>{preview?.platform || context?.platform || 'Meta'} · Реклама</span></div></header>
            {content.message && <p className="ad-preview-message">{content.message}</p>}
            <div className="ad-preview-media">
              {media ? <img src={media} alt={content.headline || content.adName}/> : <ImageIcon size={44}/>} 
              {isVideo && <span className="ad-preview-video-badge"><Play size={16} fill="currentColor"/>Видео</span>}
            </div>
            <div className="ad-preview-link"><div><span>{hostname(destinationUrl)}</span><strong>{content.headline || content.adName}</strong>{content.description && <p>{content.description}</p>}</div>{destinationUrl ? <a href={destinationUrl} target="_blank" rel="noreferrer">{cta}<ExternalLink size={14}/></a> : <button type="button">{cta}</button>}</div>
            {isVideo && <small className="ad-preview-warning">Meta вернула video ID и thumbnail. Playable URL не подменяется и не генерируется, если API его не предоставил.</small>}
          </article>

          <aside className="ad-preview-details">
            <section><h3>Объявление</h3><dl>
              <div><dt>Platform</dt><dd>{preview?.platform || context?.platform || 'Meta'}</dd></div>
              <div><dt>Account</dt><dd>{context?.accountName || '—'}{context?.accountId ? <small>{context.accountId}</small> : null}</dd></div>
              <div><dt>Campaign</dt><dd>{context?.campaignName || '—'}{context?.campaignId ? <small>{context.campaignId}</small> : null}</dd></div>
              <div><dt>Ad set</dt><dd>{context?.adsetName || '—'}{context?.adsetId ? <small>{context.adsetId}</small> : null}</dd></div>
              <div><dt>Status</dt><dd>{context?.status || '—'}</dd></div>
              <div><dt>Creative ID</dt><dd>{content.adId}</dd></div>
              <div><dt>Destination</dt><dd>{destinationUrl ? <a href={destinationUrl} target="_blank" rel="noreferrer">{hostname(destinationUrl)} <ExternalLink size={12}/></a> : '—'}</dd></div>
            </dl></section>
            {context && <section><h3>Performance</h3><div className="ad-preview-metrics">
              <span><small>Расход</small><b>{formatMoney(context.spend, context.currency)}</b></span>
              <span><small>Лиды</small><b>{formatNumber(context.leads)}</b></span>
              <span><small>Продажи</small><b>{formatNumber(context.sales)}</b></span>
              <span><small>CPL</small><b>{context.leads ? formatMoney(context.cpl, context.currency) : '—'}</b></span>
              <span><small>CTR</small><b>{Number(context.ctr || 0).toFixed(2)}%</b></span>
              <span><small>Показы</small><b>{formatNumber(context.impressions)}</b></span>
            </div></section>}
          </aside>
        </div>}
      </section>
    </aside>
  </div>;
}
