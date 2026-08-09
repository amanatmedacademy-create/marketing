import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import DataInspector, { type DataInspectorProps, type DataQuality } from './DataInspector';

type InspectorDefinition = Omit<DataInspectorProps, 'compact' | 'className'>;
type AutoTarget = { id: string; host: HTMLElement; definition: InspectorDefinition };
type RouteDefinition = {
  path: string;
  title: string;
  description: string;
  sources: string[];
  fields: string[];
  quality: DataQuality;
  qualityNote: string;
  technical: string[];
};

const ROUTES: RouteDefinition[] = [
  {
    path: '/',
    title: 'Дашборд маркетинга',
    description: 'Сводит рекламные, CRM и финансовые показатели выбранной клиники в один управленческий экран.',
    sources: ['IMDS CRM', 'Meta / TikTok Ads', 'IMDS Analytics'],
    fields: ['leads', 'target_leads', 'arrived', 'sales', 'spend', 'revenue'],
    quality: 'unknown',
    qualityNote: 'Используется последняя доступная синхронизация каждого источника.',
    technical: ['route: /', 'scope: current company', 'aggregation: dashboard + source summaries'],
  },
  {
    path: '/goals',
    title: 'Цели и эффективность',
    description: 'Сопоставляет плановые маркетинговые цели с фактическими KPI текущей клиники.',
    sources: ['IMDS Analytics', 'CRM', 'Рекламные кабинеты'],
    fields: ['goal', 'actual', 'progress', 'period', 'spend', 'leads', 'sales'],
    quality: 'unknown',
    qualityNote: 'Факт зависит от актуальности CRM и рекламных синхронизаций.',
    technical: ['route: /goals', 'scope: current company'],
  },
  {
    path: '/leads',
    title: 'Лиды',
    description: 'Единый реестр обращений с привязкой к источнику, чату, звонкам, менеджеру и стадии воронки.',
    sources: ['IMDS CRM', 'Call Center', 'Sales Funnel', 'Calls'],
    fields: ['lead_id', 'name', 'phone', 'email', 'source', 'campaign', 'stage', 'manager', 'next_action', 'last_contact_at'],
    quality: 'fresh',
    qualityNote: 'Данные загружаются заново при открытии и ручном обновлении реестра.',
    technical: ['marketingApi.listLeads', 'fetchChatWorkspace', 'marketingApi.calls', 'fetchFunnelWorkspace', 'scope: current company'],
  },
  {
    path: '/customers',
    title: 'Клиенты 360°',
    description: 'Объединяет известные данные клиента, историю касаний, источники, коммуникации и CRM-события.',
    sources: ['IMDS CRM', 'Call Center', 'Sales Funnel', 'Marketing events'],
    fields: ['customer_id', 'contacts', 'sources', 'touchpoints', 'stage', 'messages', 'appointments', 'sales'],
    quality: 'unknown',
    qualityNote: 'Полнота карточки зависит от подключённых каналов и идентификаторов клиента.',
    technical: ['route: /customers', 'scope: current company', 'identity resolution: CRM identifiers'],
  },
  {
    path: '/pipeline',
    title: 'Воронка продаж',
    description: 'Показывает движение лидов по стадиям и ответственных сотрудников.',
    sources: ['IMDS CRM', 'Sales Funnel', 'Call Center'],
    fields: ['lead_id', 'stage', 'manager_user_id', 'updated_at', 'next_action', 'contact_id'],
    quality: 'fresh',
    qualityNote: 'Стадии читаются из текущего workspace воронки.',
    technical: ['route: /pipeline', 'scope: current company', 'workspace: sales funnel'],
  },
  {
    path: '/chat',
    title: 'Колл-центр',
    description: 'Единый inbox для сообщений и обращений из подключённых коммуникационных каналов.',
    sources: ['WhatsApp', 'Instagram', 'Web', 'IMDS Call Center'],
    fields: ['thread_id', 'lead_id', 'channel', 'message', 'direction', 'status', 'read_at', 'assigned_user_id', 'unread_count'],
    quality: 'fresh',
    qualityNote: 'При открытом экране workspace обновляется автоматически.',
    technical: ['/api/callcenter/*', 'visible refresh: ~2.5s', 'background refresh: ~12s', 'scope: current company'],
  },
  {
    path: '/calls',
    title: 'Звонки',
    description: 'Показывает задачи и факты звонков, связанные с лидами и следующими действиями менеджеров.',
    sources: ['IMDS CRM', 'Calls'],
    fields: ['call_id', 'lead_id', 'call_status', 'next_action', 'manager', 'updated_at'],
    quality: 'fresh',
    qualityNote: 'Экран использует текущие записи звонков из CRM.',
    technical: ['marketingApi.calls', 'scope: current company'],
  },
  {
    path: '/whatsapp/campaigns',
    title: 'WhatsApp-рассылки',
    description: 'Управляет массовыми WhatsApp-коммуникациями и показывает состояние отправок.',
    sources: ['WhatsApp Cloud API', 'IMDS CRM'],
    fields: ['campaign_id', 'template_name', 'audience', 'sent', 'delivered', 'read', 'failed', 'created_at'],
    quality: 'unknown',
    qualityNote: 'Статусы зависят от webhook-событий WhatsApp.',
    technical: ['route: /whatsapp/campaigns', 'provider: whatsapp', 'scope: current company'],
  },
  {
    path: '/whatsapp/templates',
    title: 'WhatsApp-шаблоны',
    description: 'Показывает доступные WhatsApp message templates и их состояние для отправки вне 24-часового окна.',
    sources: ['WhatsApp Cloud API', 'Meta Graph API'],
    fields: ['name', 'language', 'category', 'status', 'components', 'parameter_count'],
    quality: 'unknown',
    qualityNote: 'Актуальность зависит от последней синхронизации шаблонов с Meta.',
    technical: ['route: /whatsapp/templates', 'provider: whatsapp', 'scope: current company'],
  },
  {
    path: '/advertising',
    title: 'Рекламные кампании',
    description: 'Сводит кампании, группы и объявления с расходами, delivery-метриками и CRM-конверсиями.',
    sources: ['Meta Marketing API', 'TikTok Ads', 'IMDS CRM'],
    fields: ['campaign_id', 'adset_id', 'ad_id', 'status', 'spend', 'impressions', 'reach', 'clicks', 'leads', 'sales', 'revenue'],
    quality: 'delayed',
    qualityNote: 'Рекламные API могут отдавать данные с задержкой относительно CRM.',
    technical: ['route: /advertising', 'scope: current company', 'currency normalization: enabled'],
  },
  {
    path: '/segments',
    title: 'Сегменты и аудитории',
    description: 'Формирует аудитории по CRM-признакам, поведению и маркетинговым условиям.',
    sources: ['IMDS CRM', 'Marketing events'],
    fields: ['segment_id', 'rules', 'lead_count', 'customer_count', 'source', 'stage', 'activity'],
    quality: 'unknown',
    qualityNote: 'Размер сегмента пересчитывается по доступным данным текущей клиники.',
    technical: ['route: /segments', 'scope: current company'],
  },
  {
    path: '/attribution',
    title: 'UTM и атрибуция',
    description: 'Связывает рекламный источник и UTM-разметку с CRM-лидами, визитами и продажами.',
    sources: ['UTM', 'Рекламные кабинеты', 'IMDS CRM'],
    fields: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'campaign_id', 'lead_id', 'revenue'],
    quality: 'partial',
    qualityNote: 'Часть лидов может остаться неатрибутированной, если источник не передал идентификаторы.',
    technical: ['route: /attribution', 'scope: current company', 'matching: UTM + advertising identifiers'],
  },
  {
    path: '/utm-builder',
    title: 'UTM Builder',
    description: 'Создаёт стандартизированную UTM-разметку для последующей атрибуции кампаний и креативов.',
    sources: ['Ввод пользователя', 'IMDS naming rules'],
    fields: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'],
    quality: 'fresh',
    qualityNote: 'Значения формируются непосредственно из введённых параметров.',
    technical: ['route: /utm-builder', 'generation: client-side'],
  },
  {
    path: '/analytics',
    title: 'Аналитика',
    description: 'Сквозная аналитика от рекламного показа и клика до CRM-лида, записи, прихода и продажи.',
    sources: ['IMDS Analytics', 'Meta / TikTok Ads', 'IMDS CRM'],
    fields: ['spend', 'impressions', 'clicks', 'crm_leads', 'appointments', 'arrived', 'sales', 'revenue', 'roas', 'romi'],
    quality: 'unknown',
    qualityNote: 'Качество итогов определяется наиболее медленным из подключённых источников.',
    technical: ['/api/analytics/overview', '/api/analytics/conversion-matrix', 'scope: current company'],
  },
  {
    path: '/reports',
    title: 'Отчёты',
    description: 'Собирает готовые управленческие срезы по маркетингу, лидам, продажам и эффективности.',
    sources: ['IMDS Analytics', 'IMDS CRM', 'Рекламные кабинеты'],
    fields: ['period', 'dimensions', 'metrics', 'filters', 'totals'],
    quality: 'unknown',
    qualityNote: 'Отчёт использует данные, доступные на момент формирования.',
    technical: ['route: /reports', 'scope: current company'],
  },
  {
    path: '/marketing',
    title: 'Центр маркетинга',
    description: 'Операционный центр маркетинга: задачи, активности, источники и управленческие действия в одном модуле.',
    sources: ['IMDS Marketing', 'CRM', 'Advertising'],
    fields: ['activity', 'status', 'owner', 'period', 'channel', 'result'],
    quality: 'unknown',
    qualityNote: 'Состояние зависит от подключённых рабочих модулей.',
    technical: ['route: /marketing', 'scope: current company'],
  },
  {
    path: '/automation',
    title: 'Journey Automation',
    description: 'Автоматизирует коммуникационные сценарии по событиям и состояниям клиента.',
    sources: ['IMDS CRM', 'Marketing events', 'Communication providers'],
    fields: ['journey_id', 'trigger', 'conditions', 'actions', 'status', 'audience'],
    quality: 'unknown',
    qualityNote: 'Срабатывание зависит от поступления событий и доступности каналов.',
    technical: ['route: /automation', 'scope: current company'],
  },
  {
    path: '/assistant',
    title: 'IMDS AI',
    description: 'Использует доступный маркетинговый контекст для аналитических выводов и рабочих рекомендаций.',
    sources: ['IMDS Analytics', 'CRM', 'Marketing context'],
    fields: ['metrics', 'campaigns', 'leads', 'context', 'prompt'],
    quality: 'unknown',
    qualityNote: 'Рекомендации зависят от полноты данных, доступных модулю.',
    technical: ['route: /assistant', 'scope: current company'],
  },
  {
    path: '/lead-forms',
    title: 'Формы захвата',
    description: 'Настраивает формы, через которые контактные данные и маркетинговый контекст попадают в CRM.',
    sources: ['Web forms', 'IMDS CRM'],
    fields: ['form_id', 'name', 'phone', 'email', 'utm', 'source', 'consent', 'created_at'],
    quality: 'fresh',
    qualityNote: 'Новые отправки поступают в CRM по мере обработки формы.',
    technical: ['route: /lead-forms', 'scope: current company'],
  },
  {
    path: '/media-plan',
    title: 'Медиаплан',
    description: 'Планирует бюджеты, каналы и целевые показатели до запуска рекламы.',
    sources: ['Ввод пользователя', 'Исторические KPI IMDS'],
    fields: ['channel', 'budget', 'period', 'target_cpl', 'target_leads', 'forecast'],
    quality: 'unknown',
    qualityNote: 'Прогнозы являются расчётными и зависят от исходных параметров.',
    technical: ['route: /media-plan', 'scope: current company'],
  },
  {
    path: '/integrations',
    title: 'Интеграции',
    description: 'Показывает подключённые внешние системы, их статус и доступный объём синхронизации.',
    sources: ['Integration credentials', 'Provider APIs'],
    fields: ['provider', 'status', 'last_sync', 'account', 'credential_scope', 'error'],
    quality: 'unknown',
    qualityNote: 'Статус определяется отдельно для каждого подключённого провайдера.',
    technical: ['route: /integrations', 'credentials: encrypted', 'scope: current company'],
  },
  {
    path: '/google',
    title: 'Google Ads + GA4',
    description: 'Объединяет рекламные данные Google Ads и веб-аналитику GA4 с маркетинговым контекстом IMDS.',
    sources: ['Google Ads', 'Google Analytics 4'],
    fields: ['campaign', 'cost', 'clicks', 'sessions', 'events', 'conversions', 'revenue'],
    quality: 'delayed',
    qualityNote: 'Google Ads и GA4 могут обновлять агрегаты не одновременно.',
    technical: ['route: /google', 'scope: current company'],
  },
  {
    path: '/data-quality',
    title: 'Качество данных',
    description: 'Контролирует полноту, свежесть и согласованность маркетинговых и CRM-данных.',
    sources: ['IMDS validation', 'CRM', 'Advertising', 'Integrations'],
    fields: ['check', 'severity', 'source', 'record_count', 'last_seen', 'status'],
    quality: 'fresh',
    qualityNote: 'Этот модуль предназначен для диагностики качества входных данных.',
    technical: ['route: /data-quality', 'scope: current company'],
  },
  {
    path: '/notifications',
    title: 'Уведомления',
    description: 'Показывает системные и маркетинговые события, требующие внимания пользователя.',
    sources: ['IMDS events', 'Integrations', 'Automation'],
    fields: ['notification_id', 'type', 'severity', 'message', 'created_at', 'read_at'],
    quality: 'fresh',
    qualityNote: 'Список отражает уведомления, зарегистрированные системой.',
    technical: ['route: /notifications', 'scope: current user + company'],
  },
  {
    path: '/audit',
    title: 'Аудит и ошибки',
    description: 'Показывает технические и бизнес-события, ошибки синхронизации и действия пользователей.',
    sources: ['IMDS audit log', 'Integration errors'],
    fields: ['event', 'actor', 'provider', 'severity', 'error', 'created_at'],
    quality: 'fresh',
    qualityNote: 'События отображаются по мере записи в аудит.',
    technical: ['route: /audit', 'scope: current company'],
  },
  {
    path: '/architecture',
    title: 'Архитектура',
    description: 'Объясняет связи между источниками, API, CRM, аналитикой и рабочими модулями IMDS Marketing.',
    sources: ['IMDS platform configuration'],
    fields: ['module', 'provider', 'flow', 'dependency', 'status'],
    quality: 'unknown',
    qualityNote: 'Схема описывает текущую конфигурацию платформы.',
    technical: ['route: /architecture'],
  },
];

const SPECIALS: Array<{ aliases: string[]; definition: Partial<InspectorDefinition> }> = [
  { aliases: ['все лиды', 'всего лидов'], definition: { description: 'Количество лидов CRM за выбранный период или текущий набор фильтров.', sources: ['IMDS CRM'], fields: ['lead_id', 'created_at', 'source'], formula: 'COUNT(unique lead_id)' } },
  { aliases: ['целевые лиды'], definition: { description: 'Лиды, отмеченные CRM как соответствующие целевым критериям клиники.', sources: ['IMDS CRM'], fields: ['lead_id', 'is_target', 'stage'], formula: 'COUNT(leads WHERE is_target = true)' } },
  { aliases: ['пришли', 'пришли на визит'], definition: { description: 'Лиды или клиенты с подтверждённым фактом прихода на визит.', sources: ['IMDS CRM'], fields: ['lead_id', 'arrived_at'], formula: 'COUNT(leads WHERE arrived_at IS NOT NULL)' } },
  { aliases: ['продажи'], definition: { description: 'Количество лидов с подтверждённой продажей в CRM.', sources: ['IMDS CRM'], fields: ['lead_id', 'sold_at', 'revenue'], formula: 'COUNT(leads WHERE sold_at IS NOT NULL)' } },
  { aliases: ['выручка'], definition: { description: 'Сумма выручки, связанной с продажами за выбранный период.', sources: ['IMDS CRM'], fields: ['revenue', 'sold_at'], formula: 'SUM(revenue)' } },
  { aliases: ['рекламный расход', 'общий расход', 'расход'], definition: { description: 'Суммарные рекламные затраты выбранных кабинетов с нормализацией валюты при необходимости.', sources: ['Meta / TikTok / Google Ads'], fields: ['spend', 'account_id', 'currency'], formula: 'SUM(spend converted to display currency)' } },
  { aliases: ['roas'], definition: { description: 'Отношение выручки CRM к рекламным расходам.', sources: ['IMDS CRM', 'Advertising'], fields: ['revenue', 'spend'], formula: 'ROAS = revenue / ad_spend' } },
  { aliases: ['romi'], definition: { description: 'Относительная маркетинговая отдача до учёта операционных расходов.', sources: ['IMDS CRM', 'Advertising'], fields: ['revenue', 'spend'], formula: 'ROMI = (revenue - spend) / spend × 100%' } },
  { aliases: ['cpl'], definition: { description: 'Средняя стоимость одного лида.', sources: ['Advertising', 'IMDS CRM'], fields: ['spend', 'lead_id'], formula: 'CPL = ad_spend / leads' } },
  { aliases: ['cac'], definition: { description: 'Средняя рекламная стоимость одной подтверждённой продажи.', sources: ['Advertising', 'IMDS CRM'], fields: ['spend', 'sales'], formula: 'CAC = ad_spend / sales' } },
  { aliases: ['показы'], definition: { description: 'Количество показов рекламы, переданное рекламной платформой.', sources: ['Advertising API'], fields: ['impressions'] } },
  { aliases: ['охват'], definition: { description: 'Количество уникальных пользователей, охваченных рекламой; при суммировании объектов может быть приблизительным.', sources: ['Advertising API'], fields: ['reach'] } },
  { aliases: ['клики'], definition: { description: 'Количество зарегистрированных рекламной платформой кликов.', sources: ['Advertising API'], fields: ['clicks'] } },
  { aliases: ['ctr'], definition: { description: 'Доля кликов от числа рекламных показов.', sources: ['Advertising API'], fields: ['clicks', 'impressions'], formula: 'CTR = clicks / impressions × 100%' } },
  { aliases: ['cpc'], definition: { description: 'Средняя стоимость рекламного клика.', sources: ['Advertising API'], fields: ['spend', 'clicks'], formula: 'CPC = spend / clicks' } },
  { aliases: ['cpm'], definition: { description: 'Средняя стоимость одной тысячи показов.', sources: ['Advertising API'], fields: ['spend', 'impressions'], formula: 'CPM = spend × 1000 / impressions' } },
  { aliases: ['источник', 'источник / канал'], definition: { description: 'Маркетинговый источник или коммуникационный канал, связанный с записью.', fields: ['source', 'platform', 'channel', 'utm_source'] } },
  { aliases: ['стадия'], definition: { description: 'Текущий этап лида в CRM-воронке.', sources: ['IMDS CRM', 'Sales Funnel'], fields: ['stage', 'updated_at'] } },
  { aliases: ['ответственный'], definition: { description: 'Пользователь или менеджер, назначенный ответственным за лид или диалог.', sources: ['IMDS CRM'], fields: ['manager_user_id', 'assigned_user_id'] } },
  { aliases: ['следующее действие'], definition: { description: 'Запланированное следующее действие менеджера по лиду.', sources: ['IMDS CRM', 'Calls'], fields: ['next_action', 'call_status'] } },
  { aliases: ['последний контакт'], definition: { description: 'Последнее известное время взаимодействия по лиду с учётом CRM, чата, звонков и воронки.', sources: ['IMDS CRM', 'Call Center', 'Calls'], fields: ['updated_at', 'last_message_at', 'first_contact_at'] } },
  { aliases: ['открытых'], definition: { description: 'Количество диалогов со статусом OPEN.', sources: ['IMDS Call Center'], fields: ['thread_id', 'status'], formula: 'COUNT(threads WHERE status = OPEN)' } },
  { aliases: ['ожидают'], definition: { description: 'Количество диалогов со статусом PENDING.', sources: ['IMDS Call Center'], fields: ['thread_id', 'status'], formula: 'COUNT(threads WHERE status = PENDING)' } },
  { aliases: ['непрочитано', 'непрочитанные'], definition: { description: 'Количество непрочитанных входящих сообщений или диалогов.', sources: ['IMDS Call Center'], fields: ['unread_count', 'read_at'] } },
  { aliases: ['динамика лидов'], definition: { description: 'Изменение числа лидов и связанных бизнес-показателей по времени.', sources: ['IMDS Analytics', 'IMDS CRM'], fields: ['date', 'leads', 'sales', 'spend'] } },
  { aliases: ['воронка продаж', 'воронка по платформам'], definition: { description: 'Последовательность переходов от лида к целевому действию или продаже.', sources: ['IMDS CRM', 'Analytics'], fields: ['leads', 'target_leads', 'appointments', 'arrived', 'sales'] } },
  { aliases: ['распределение по источникам', 'распределение по платформам'], definition: { description: 'Разбивка лидов между маркетинговыми источниками или рекламными платформами.', sources: ['IMDS Analytics', 'CRM'], fields: ['source', 'platform', 'leads'] } },
];

function normalize(value: string) {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function routeDefinition(pathname: string): RouteDefinition {
  const exact = ROUTES.find((item) => item.path === pathname);
  if (exact) return exact;
  const nested = ROUTES
    .filter((item) => item.path !== '/' && pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return nested || ROUTES[0];
}

function specialFor(label: string) {
  const value = normalize(label);
  return SPECIALS.find((item) => item.aliases.some((alias) => value === alias || value.includes(alias)))?.definition;
}

function cleanLabel(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.data-inspector, .data-inspector-auto-host').forEach((node) => node.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function buildDefinition(element: HTMLElement, label: string, route: RouteDefinition): InspectorDefinition {
  const tag = element.tagName.toLowerCase();
  if (tag === 'h1') {
    return {
      title: route.title,
      description: route.description,
      sources: route.sources,
      fields: route.fields,
      quality: route.quality,
      qualityNote: route.qualityNote,
      filters: ['Текущая клиника / tenant', 'Права текущего пользователя'],
      technical: route.technical,
    };
  }

  const specific = specialFor(label);
  if (specific) {
    return {
      title: label,
      description: specific.description || `Показывает показатель «${label}» в контексте текущего модуля.`,
      sources: specific.sources || route.sources,
      fields: specific.fields || route.fields,
      formula: specific.formula,
      example: specific.example,
      filters: specific.filters || ['Текущая клиника / tenant', 'Фильтры текущего экрана'],
      quality: specific.quality || route.quality,
      qualityNote: specific.qualityNote || route.qualityNote,
      technical: [...route.technical, ...(specific.technical || [])],
    };
  }

  if (tag === 'th') {
    return {
      title: label || 'Колонка данных',
      description: `Поле «${label || 'данные'}» в текущей таблице. Значение берётся из данных модуля «${route.title}» и учитывает активный tenant и фильтры.`,
      sources: route.sources,
      fields: [normalize(label).replace(/[^a-zа-я0-9]+/gi, '_').replace(/^_|_$/g, '') || 'field'],
      filters: ['Текущая клиника / tenant', 'Фильтры текущей таблицы'],
      quality: route.quality,
      qualityNote: route.qualityNote,
      technical: route.technical,
    };
  }

  return {
    title: label || route.title,
    description: `Блок «${label || route.title}» использует данные модуля «${route.title}».`,
    sources: route.sources,
    fields: route.fields,
    filters: ['Текущая клиника / tenant', 'Фильтры текущего экрана'],
    quality: route.quality,
    qualityNote: route.qualityNote,
    technical: route.technical,
  };
}

function hasManualInspector(element: HTMLElement) {
  if (element.closest('.data-inspector')) return true;
  if (element.querySelector(':scope > .data-inspector')) return true;
  const parent = element.parentElement;
  if (parent?.classList.contains('data-inspector-kpi-head') && parent.querySelector('.data-inspector')) return true;
  if (parent?.classList.contains('data-inspector-card-title') && parent.querySelector('.data-inspector')) return true;
  if (parent?.classList.contains('data-inspector-row-title') && parent.querySelector('.data-inspector')) return true;
  return false;
}

export default function DataInspectorAutoLayer() {
  const location = useLocation();
  const [targets, setTargets] = useState<AutoTarget[]>([]);

  useEffect(() => {
    let frame = 0;
    let sequence = 0;

    const scan = () => {
      const root = document.querySelector<HTMLElement>('.marketing-content');
      if (!root) {
        setTargets([]);
        return;
      }
      const route = routeDefinition(location.pathname);
      const nodes = Array.from(root.querySelectorAll<HTMLElement>([
        'h1',
        'h2',
        'h3',
        'th',
        '.marketing-kpis article > span:first-child',
        '.dashboard-v36-kpis article > span',
        '.v36-kpi > span',
        '.inbox-header-stats > span',
        '.lead-table-panel > header > strong',
        '.metric > span:first-child',
      ].join(',')));
      const next: AutoTarget[] = [];

      nodes.forEach((element) => {
        if (!element.isConnected || hasManualInspector(element)) return;
        if (element.closest('.data-inspector__panel')) return;
        const label = cleanLabel(element);
        if (!label || label.length > 120) return;

        let host = element.querySelector<HTMLElement>(':scope > .data-inspector-auto-host');
        if (!host) {
          host = document.createElement('span');
          host.className = 'data-inspector-auto-host';
          host.dataset.inspectorAutoId = `${location.pathname}-${sequence++}`;
          element.append(host);
        }
        const id = host.dataset.inspectorAutoId || `${location.pathname}-${sequence++}`;
        host.dataset.inspectorAutoId = id;
        next.push({ id, host, definition: buildDefinition(element, label, route) });
      });
      setTargets(next);
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(scan);
    };

    scan();
    const root = document.querySelector<HTMLElement>('.marketing-content');
    if (!root) return () => window.cancelAnimationFrame(frame);

    const observer = new MutationObserver((mutations) => {
      const internalOnly = mutations.every((mutation) => {
        const target = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement;
        return Boolean(target?.classList.contains('data-inspector-auto-host') || target?.closest('.data-inspector'));
      });
      if (!internalOnly) schedule();
    });
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      root.querySelectorAll('.data-inspector-auto-host').forEach((host) => host.remove());
      setTargets([]);
    };
  }, [location.pathname]);

  return <>{targets.map(({ id, host, definition }) => createPortal(
    <DataInspector {...definition} compact />,
    host,
    id,
  ))}</>;
}
