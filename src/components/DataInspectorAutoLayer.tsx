import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import DataInspector, { type DataInspectorProps, type DataQuality } from './DataInspector';

type Definition = Omit<DataInspectorProps, 'compact' | 'className'>;
type Target = { id: string; host: HTMLElement; definition: Definition };
type RouteInfo = { title: string; description: string; sources: string[]; fields: string[]; quality?: DataQuality; technical?: string[] };

const ROUTES: Record<string, RouteInfo> = {
  '/': { title: 'Дашборд маркетинга', description: 'Сводный управленческий экран маркетинга: лиды, воронка, расходы, выручка и эффективность.', sources: ['IMDS CRM', 'Meta / TikTok Ads', 'IMDS Analytics'], fields: ['leads', 'target_leads', 'appointments', 'arrived', 'sales', 'spend', 'revenue'], technical: ['/api/dashboard', '/api/sources', '/api/leads', '/api/ads', '/api/ads/currencies', '/api/exchange-rates'] },
  '/leads': { title: 'Лиды', description: 'Единый CRM-реестр обращений и их текущего состояния.', sources: ['marketing_leads', 'Call Center', 'Sales Funnel', 'Calls'], fields: ['id', 'name', 'phone', 'source', 'campaign', 'stage', 'manager', 'next_action', 'updated_at'], quality: 'fresh', technical: ['/api/leads', '/api/callcenter/workspace', '/api/calls', '/api/funnel/workspace'] },
  '/customers': { title: 'Клиенты 360°', description: 'Объединяет CRM-профиль и историю взаимодействий клиента.', sources: ['marketing_leads', 'Call Center', 'Sales Funnel'], fields: ['customer_id', 'contacts', 'touchpoints', 'stage', 'messages', 'sales'] },
  '/pipeline': { title: 'Воронка продаж', description: 'Показывает сделки по стадиям, ответственным и следующим действиям.', sources: ['Sales Funnel', 'IMDS CRM'], fields: ['pipeline_id', 'stage_id', 'marketing_lead_id', 'manager_user_id', 'amount', 'status'], quality: 'fresh', technical: ['/api/funnel/workspace'] },
  '/chat': { title: 'Входящие', description: 'Единый inbox коммуникаций клиники.', sources: ['WhatsApp', 'Instagram', 'Web', 'marketing_conversations', 'marketing_messages'], fields: ['thread_id', 'lead_id', 'channel', 'status', 'assigned_user_id', 'unread_count', 'read_at'], quality: 'fresh', technical: ['/api/callcenter/workspace', '/api/callcenter/threads/:id/messages'] },
  '/calls': { title: 'Звонки', description: 'Звонки, операторы, результаты, качество и следующие действия.', sources: ['IMDS Calls', 'CRM'], fields: ['lead_id', 'operator_user_id', 'call_status', 'duration_seconds', 'appointment_created', 'quality_score'], quality: 'fresh', technical: ['/api/calls', '/api/calls/operators'] },
  '/advertising': { title: 'Рекламные кампании', description: 'Реклама от кабинета до объявления с расходами и CRM-конверсиями.', sources: ['Meta Marketing API', 'TikTok Ads API', 'marketing_ads', 'IMDS CRM'], fields: ['account_id', 'campaign_id', 'adset_id', 'ad_id', 'impressions', 'clicks', 'spend', 'leads', 'sales', 'revenue'], quality: 'delayed', technical: ['/api/ads', '/api/ads/currencies', '/api/exchange-rates'] },
  '/analytics': { title: 'Аналитика', description: 'Сквозная аналитика рекламы, атрибуции и CRM-конверсий.', sources: ['marketing_ads', 'marketing_leads', 'IMDS Analytics', 'UTM / click IDs'], fields: ['spend', 'impressions', 'clicks', 'crm_leads', 'appointments', 'arrived', 'sales', 'revenue', 'roas', 'romi', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'], technical: ['/api/analytics/overview', '/api/analytics/conversion-matrix'] },
  '/integrations': { title: 'Интеграции', description: 'Подключённые внешние системы, их состояние и синхронизации.', sources: ['Provider APIs', 'Encrypted integration credentials', 'Integration runs'], fields: ['provider', 'status', 'last_sync', 'last_error'], technical: ['/api/integrations/status', '/api/integrations/config', '/api/integrations/sync'] },
  '/data-quality': { title: 'Качество данных', description: 'Контроль полноты, свежести и согласованности данных.', sources: ['IMDS validation', 'CRM', 'Advertising', 'Integrations'], fields: ['check', 'severity', 'source', 'record_count', 'last_seen', 'status'], quality: 'fresh' },
};

const SPECIALS: Array<{ aliases: string[]; data: Partial<Definition> }> = [
  { aliases: ['все лиды', 'всего лидов'], data: { description: 'Все уникальные CRM-лиды в текущем наборе данных.', sources: ['marketing_leads'], fields: ['id', 'lead_created_at', 'source'], formula: 'COUNT(unique lead_id)' } },
  { aliases: ['целевые лиды', 'целевые'], data: { description: 'Лиды, отмеченные как целевые.', sources: ['marketing_leads'], fields: ['id', 'is_target', 'stage'], formula: 'COUNT(leads WHERE is_target = true)' } },
  { aliases: ['записаны', 'записи'], data: { description: 'Лиды с созданной записью на визит.', sources: ['marketing_leads'], fields: ['id', 'appointment_at'], formula: 'COUNT(leads WHERE appointment_at IS NOT NULL)' } },
  { aliases: ['пришли'], data: { description: 'Лиды с подтверждённым фактом прихода.', sources: ['marketing_leads'], fields: ['id', 'arrived_at'], formula: 'COUNT(leads WHERE arrived_at IS NOT NULL)' } },
  { aliases: ['продажи'], data: { description: 'Лиды с подтверждённой продажей.', sources: ['marketing_leads'], fields: ['id', 'sold_at', 'sale_amount'], formula: 'COUNT(leads WHERE sold_at IS NOT NULL)' } },
  { aliases: ['лид → продажа', 'лид -> продажа'], data: { description: 'Конверсия всех лидов в продажи.', fields: ['leads', 'sales'], formula: 'sales / leads × 100%' } },
  { aliases: ['нецелевые'], data: { description: 'Лиды с is_target=false или нецелевым CRM-статусом.', sources: ['marketing_leads'], fields: ['is_target', 'stage'] } },
  { aliases: ['не дозвонились'], data: { description: 'Лиды со статусом, указывающим на отсутствие контакта.', sources: ['marketing_leads'], fields: ['stage'] } },
  { aliases: ['отказались'], data: { description: 'Лиды с CRM-статусом отказа.', sources: ['marketing_leads'], fields: ['stage', 'rejected_at'] } },
  { aliases: ['отменили запись'], data: { description: 'Лиды со статусом отмены записи.', sources: ['marketing_leads'], fields: ['stage', 'appointment_at'] } },
  { aliases: ['не пришли'], data: { description: 'Записанные лиды со статусом неявки.', sources: ['marketing_leads'], fields: ['stage', 'appointment_at', 'arrived_at'] } },
  { aliases: ['в работе'], data: { description: 'Лиды без закрывающего статуса: продажи, прихода, отказа, отмены, неявки или нецелевого статуса.', sources: ['marketing_leads'], fields: ['stage', 'sold_at', 'arrived_at'] } },
  { aliases: ['рекламный расход'], data: { description: 'Суммарный расход рекламных кабинетов после конвертации в выбранную валюту.', sources: ['marketing_ads', 'Advertising currencies', 'Exchange rates'], fields: ['spend', 'account_id', 'currency'], formula: 'SUM(convert(spend, native_currency → display_currency))' } },
  { aliases: ['cpl'], data: { description: 'Средняя рекламная стоимость одного лида.', fields: ['spend', 'leads'], formula: 'ad_spend / leads' } },
  { aliases: ['стоимость целевого'], data: { description: 'Средняя рекламная стоимость целевого лида.', fields: ['spend', 'target_leads'], formula: 'ad_spend / target_leads' } },
  { aliases: ['стоимость записи'], data: { description: 'Средняя рекламная стоимость одной записи.', fields: ['spend', 'appointments'], formula: 'ad_spend / appointments' } },
  { aliases: ['стоимость прихода'], data: { description: 'Средняя рекламная стоимость подтверждённого прихода.', fields: ['spend', 'arrived'], formula: 'ad_spend / arrived' } },
  { aliases: ['cac'], data: { description: 'Средняя рекламная стоимость продажи.', fields: ['spend', 'sales'], formula: 'ad_spend / sales' } },
  { aliases: ['выручка'], data: { description: 'CRM-выручка по подтверждённым продажам.', sources: ['marketing_leads'], fields: ['sale_amount', 'sold_at'], formula: 'SUM(sale_amount)' } },
  { aliases: ['средний чек'], data: { description: 'Средняя выручка на одну продажу.', fields: ['revenue', 'sales'], formula: 'revenue / sales' } },
  { aliases: ['roas'], data: { description: 'Окупаемость рекламных расходов.', fields: ['revenue', 'spend'], formula: 'revenue / ad_spend' } },
  { aliases: ['romi'], data: { description: 'Маркетинговая рентабельность до операционных расходов.', fields: ['revenue', 'spend'], formula: '(revenue - ad_spend) / ad_spend × 100%' } },
  { aliases: ['доход на лид'], data: { description: 'Средняя CRM-выручка на один лид.', fields: ['revenue', 'leads'], formula: 'revenue / leads' } },
  { aliases: ['доход на приход'], data: { description: 'Средняя CRM-выручка на один подтверждённый приход.', fields: ['revenue', 'arrived'], formula: 'revenue / arrived' } },
  { aliases: ['динамика воронки', 'динамика лидов'], data: { description: 'Изменение лидов, целевых, приходов и продаж по датам.', fields: ['date', 'leads', 'target_leads', 'arrived', 'sales'] } },
  { aliases: ['полная воронка', 'воронка продаж', 'воронка по платформам'], data: { description: 'Последовательность переходов от лида до продажи.', fields: ['leads', 'target_leads', 'appointments', 'arrived', 'sales'] } },
  { aliases: ['источник', 'источник / канал'], data: { description: 'Источник лида или коммуникационный канал.', fields: ['source', 'platform', 'channel', 'utm_source'] } },
  { aliases: ['стадия'], data: { description: 'Текущая стадия лида или сделки.', fields: ['stage', 'stage_id', 'updated_at'] } },
  { aliases: ['ответственный'], data: { description: 'Назначенный менеджер или пользователь.', fields: ['manager_user_id', 'assigned_user_id'] } },
  { aliases: ['непрочитано', 'непрочитанные'], data: { description: 'Число непрочитанных входящих сообщений.', fields: ['unread_count', 'read_at'] } },
];

function normalize(value: string) { return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function routeFor(pathname: string): RouteInfo {
  if (ROUTES[pathname]) return ROUTES[pathname];
  const match = Object.entries(ROUTES).filter(([path]) => path !== '/' && pathname.startsWith(`${path}/`)).sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] || { title: 'BELES', description: 'Данные текущего модуля BELES.', sources: ['IMDS Data Layer'], fields: ['module_data'] };
}
function specificFor(label: string) {
  const value = normalize(label);
  return SPECIALS.find((item) => item.aliases.some((alias) => value === alias || value.includes(alias)))?.data;
}
function cleanLabel(element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.data-inspector, .data-inspector-auto-host').forEach((node) => node.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}
function anchorFor(element: HTMLElement): HTMLElement {
  if (element.tagName.toLowerCase() === 'th') return element;
  if (element.matches('.marketing-kpis article > span:first-child, .dashboard-v36-kpis article > span, .v36-kpi > span, .metric > span:first-child')) return (element.closest('article, .v36-kpi, .metric') as HTMLElement) || element;
  if (element.matches('.inbox-header-stats > span')) return element;
  if (element.matches('.lead-table-panel > header > strong')) return (element.closest('.lead-table-panel') as HTMLElement) || element;
  if (/^H[123]$/.test(element.tagName)) {
    return (element.closest('.dashboard-chart-card, .panel, article, section, .heading, .page-top, .leads-heading, .callcenter-heading, .inbox-workspace-header') as HTMLElement) || element;
  }
  return element;
}
function buildDefinition(element: HTMLElement, label: string, route: RouteInfo): Definition {
  const specific = specificFor(label);
  if (element.tagName.toLowerCase() === 'h1') return { title: route.title, description: route.description, sources: route.sources, fields: route.fields, quality: route.quality || 'unknown', qualityNote: 'Используется последняя доступная синхронизация источников.', filters: ['Текущая клиника / tenant', 'Права пользователя'], technical: route.technical || [] };
  if (specific) return { title: label, description: specific.description || `Показатель «${label}».`, sources: specific.sources || route.sources, fields: specific.fields || route.fields, formula: specific.formula, filters: ['Текущая клиника / tenant', 'Фильтры текущего экрана'], quality: route.quality || 'unknown', qualityNote: 'Актуальность зависит от источников текущего модуля.', technical: [...(route.technical || []), ...(specific.technical || [])] };
  if (element.tagName.toLowerCase() === 'th') return { title: label || 'Колонка', description: `Поле «${label || 'данные'}» текущей таблицы.`, sources: route.sources, fields: [normalize(label).replace(/[^a-zа-я0-9]+/gi, '_').replace(/^_|_$/g, '') || 'field'], filters: ['Текущая клиника / tenant', 'Фильтры таблицы'], quality: route.quality || 'unknown', technical: route.technical || [] };
  return { title: label || route.title, description: `Блок «${label || route.title}» использует данные модуля «${route.title}».`, sources: route.sources, fields: route.fields, filters: ['Текущая клиника / tenant', 'Фильтры текущего экрана'], quality: route.quality || 'unknown', technical: route.technical || [] };
}

export default function DataInspectorAutoLayer() {
  const location = useLocation();
  const [targets, setTargets] = useState<Target[]>([]);

  useEffect(() => {
    let frame = 0;
    let sequence = 0;
    const scan = () => {
      const root = document.querySelector<HTMLElement>('.marketing-content');
      if (!root) return setTargets([]);
      const route = routeFor(location.pathname);
      const candidates = Array.from(root.querySelectorAll<HTMLElement>([
        'h1','h2','h3','th',
        '.marketing-kpis article > span:first-child',
        '.dashboard-v36-kpis article > span',
        '.v36-kpi > span',
        '.metric > span:first-child',
        '.inbox-header-stats > span',
        '.lead-table-panel > header > strong'
      ].join(',')));
      const next: Target[] = [];
      const usedAnchors = new Set<HTMLElement>();

      candidates.forEach((element) => {
        if (!element.isConnected || element.closest('.data-inspector, .data-inspector__panel')) return;
        const label = cleanLabel(element);
        if (!label || label.length > 140) return;
        const anchor = anchorFor(element);
        if (usedAnchors.has(anchor)) return;
        usedAnchors.add(anchor);
        anchor.classList.add('data-inspector-anchor');
        if (/^H[123]$/.test(element.tagName)) anchor.classList.add('data-inspector-title-anchor');
        let host = Array.from(anchor.children).find((child) => child.classList.contains('data-inspector-auto-host')) as HTMLElement | undefined;
        if (!host) {
          host = document.createElement('span');
          host.className = 'data-inspector-auto-host';
          anchor.append(host);
        }
        const id = `${location.pathname}-${sequence++}`;
        host.dataset.inspectorAutoId = id;
        next.push({ id, host, definition: buildDefinition(element, label, route) });
      });
      setTargets(next);
    };

    const schedule = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(scan); };
    scan();
    const root = document.querySelector<HTMLElement>('.marketing-content');
    if (!root) return () => window.cancelAnimationFrame(frame);
    const observer = new MutationObserver((mutations) => {
      const internalOnly = mutations.every((mutation) => {
        const target = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement;
        return Boolean(target?.closest('.data-inspector') || target?.classList.contains('data-inspector-auto-host'));
      });
      if (!internalOnly) schedule();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      root.querySelectorAll('.data-inspector-auto-host').forEach((node) => node.remove());
      root.querySelectorAll('.data-inspector-anchor').forEach((node) => node.classList.remove('data-inspector-anchor', 'data-inspector-title-anchor'));
      setTargets([]);
    };
  }, [location.pathname]);

  return <>{targets.map(({ id, host, definition }) => createPortal(<DataInspector {...definition} compact />, host, id))}</>;
}
