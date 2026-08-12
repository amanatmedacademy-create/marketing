import { Link2 } from 'lucide-react';

type BrandIcon = { slug: string; label: string; color: string; surface?: string };

function sourceBrands(source?: string | null): BrandIcon[] {
  const value = (source || '').trim().toLowerCase();
  if (!value) return [];

  const brands: BrandIcon[] = [];
  const add = (icon: BrandIcon) => { if (!brands.some((item) => item.slug === icon.slug)) brands.push(icon); };

  if (value.includes('meta')) add({ slug: 'meta', label: 'Meta', color: '0866FF' });
  if (value.includes('whatsapp') || value.includes('waba')) add({ slug: 'whatsapp', label: 'WhatsApp', color: '25D366' });
  if (value.includes('instagram')) add({ slug: 'instagram', label: 'Instagram', color: 'E4405F' });
  if (value.includes('facebook') || /(^|\W)fb($|\W)/.test(value)) add({ slug: 'facebook', label: 'Facebook', color: '1877F2' });
  if (value.includes('google')) add({ slug: 'googleads', label: 'Google Ads', color: '4285F4' });
  if (value.includes('tiktok')) add({ slug: 'tiktok', label: 'TikTok', color: '000000', surface: 'ffffff' });
  if (value.includes('youtube')) add({ slug: 'youtube', label: 'YouTube', color: 'FF0000' });
  if (value.includes('telegram')) add({ slug: 'telegram', label: 'Telegram', color: '26A5E4' });

  return brands.slice(0, 2);
}

function shortSource(source: string): string {
  const value = source.trim();
  if (!value) return 'Источник';
  if (/meta click-to-whatsapp/i.test(value)) return 'Meta → WhatsApp';
  if (/google ads/i.test(value)) return 'Google Ads';
  return value.length > 22 ? `${value.slice(0, 20)}…` : value;
}

export default function SourceBadge({ source, compact = false }: { source?: string | null; compact?: boolean }) {
  const label = (source || '').trim() || 'Источник не указан';
  const brands = sourceBrands(source);

  return <span className={`source-badge ${compact ? 'source-badge--compact' : ''}`} title={label}>
    <span className="source-badge__icons" aria-hidden="true">
      {brands.length ? brands.map((brand) => <span className="source-badge__icon" style={{ background: brand.surface ? `#${brand.surface}` : undefined }} key={brand.slug}>
        <img
          src={`https://cdn.simpleicons.org/${brand.slug}/${brand.color}`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      </span>) : <span className="source-badge__icon source-badge__icon--fallback"><Link2 size={11}/></span>}
    </span>
    {!compact && <span className="source-badge__label">{shortSource(label)}</span>}
  </span>;
}
