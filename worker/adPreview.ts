type JsonRecord = Record<string, unknown>;

export interface AdPreviewEnv {
  META_ACCESS_TOKEN?: string;
  META_GRAPH_VERSION?: string;
}

type PreviewMode = 'desktop' | 'mobile' | 'instagram';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function graphVersion(env: AdPreviewEnv): string {
  const value = text(env.META_GRAPH_VERSION) || 'v23.0';
  return value.startsWith('v') ? value : `v${value}`;
}

async function meta<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.text();
  let parsed: unknown = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { error: { message: body } }; }
  if (!response.ok) {
    const error = record(record(parsed).error);
    throw new Error(text(error.message) || `Meta API вернул HTTP ${response.status}`);
  }
  return parsed as T;
}

function previewFormat(mode: PreviewMode): string {
  if (mode === 'mobile') return 'MOBILE_FEED_STANDARD';
  if (mode === 'instagram') return 'INSTAGRAM_STANDARD';
  return 'DESKTOP_FEED_STANDARD';
}

function firstAsset(value: unknown): JsonRecord {
  return Array.isArray(value) && value.length ? record(value[0]) : {};
}

function creativeContent(ad: JsonRecord) {
  const creative = record(ad.creative);
  const story = record(creative.object_story_spec);
  const link = record(story.link_data);
  const video = record(story.video_data);
  const photo = record(story.photo_data);
  const assets = record(creative.asset_feed_spec);
  const bodyAsset = firstAsset(assets.bodies);
  const titleAsset = firstAsset(assets.titles);
  const descriptionAsset = firstAsset(assets.descriptions);
  const imageAsset = firstAsset(assets.images);
  const videoAsset = firstAsset(assets.videos);
  const callToAction = record(link.call_to_action || video.call_to_action);
  const ctaValue = record(callToAction.value);

  return {
    adId: text(ad.id),
    adName: text(ad.name) || text(creative.name) || 'Без названия',
    pageId: text(story.page_id),
    instagramActorId: text(story.instagram_actor_id),
    message: text(link.message || video.message || photo.caption || bodyAsset.text),
    headline: text(link.name || video.title || titleAsset.text),
    description: text(link.description || descriptionAsset.text),
    destinationUrl: text(link.link || ctaValue.link),
    callToAction: text(callToAction.type),
    imageUrl: text(link.picture || video.image_url || photo.url || imageAsset.url || creative.thumbnail_url),
    videoId: text(video.video_id || videoAsset.video_id),
    thumbnailUrl: text(creative.thumbnail_url),
    effectiveStoryId: text(creative.effective_object_story_id),
  };
}

export async function handleAdPreview(request: Request, env: AdPreviewEnv, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/analytics/ad-preview') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const accessToken = text(env.META_ACCESS_TOKEN);
  if (!accessToken) return json({ error: 'Meta не подключена или access token недоступен' }, 503);

  const adId = text(url.searchParams.get('adId')).replace(/[^0-9]/g, '');
  const requestedMode = text(url.searchParams.get('mode')) as PreviewMode;
  const mode: PreviewMode = ['desktop', 'mobile', 'instagram'].includes(requestedMode) ? requestedMode : 'desktop';
  if (!adId) return json({ error: 'Не указан ID объявления' }, 400);

  const base = `https://graph.facebook.com/${graphVersion(env)}`;
  const adParams = new URLSearchParams({
    fields: 'id,name,creative{id,name,thumbnail_url,object_story_spec,asset_feed_spec,effective_object_story_id}',
    access_token: accessToken,
  });

  try {
    const ad = await meta<JsonRecord>(`${base}/${adId}?${adParams}`);
    let previewHtml = '';
    let previewError = '';
    try {
      const previewParams = new URLSearchParams({ ad_format: previewFormat(mode), access_token: accessToken });
      const preview = await meta<{ data?: Array<{ body?: string }> }>(`${base}/${adId}/previews?${previewParams}`);
      previewHtml = text(preview.data?.[0]?.body);
    } catch (error) {
      previewError = error instanceof Error ? error.message : String(error);
    }

    return json({
      platform: 'Meta',
      mode,
      previewHtml,
      previewError: previewHtml ? '' : previewError,
      content: creativeContent(ad),
    });
  } catch (error) {
    console.error('Meta ad preview failed', { adId, error });
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
