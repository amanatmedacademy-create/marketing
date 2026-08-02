export type ProductId =
  | 'marketing'
  | 'conversations'
  | 'crm'
  | 'dashboard'
  | 'automation'
  | 'contracts'
  | 'payments'
  | 'workspace';

export type ProductStage = 'active' | 'beta' | 'planned';

export type CapabilityId =
  | 'ads.accounts'
  | 'ads.campaigns'
  | 'ads.creatives'
  | 'ads.performance'
  | 'inbox.omnichannel'
  | 'inbox.whatsapp'
  | 'inbox.instagram'
  | 'inbox.telegram'
  | 'inbox.email'
  | 'ai.sales_agent'
  | 'ai.knowledge_base'
  | 'ai.follow_up'
  | 'crm.contacts'
  | 'crm.deals'
  | 'crm.pipelines'
  | 'crm.activities'
  | 'analytics.attribution'
  | 'analytics.funnel'
  | 'analytics.revenue'
  | 'analytics.anomalies'
  | 'automation.workflows'
  | 'automation.triggers'
  | 'automation.actions'
  | 'contracts.templates'
  | 'contracts.documents'
  | 'contracts.signatures'
  | 'payments.invoices'
  | 'payments.transactions'
  | 'payments.refunds'
  | 'workspace.tasks'
  | 'workspace.projects'
  | 'workspace.team';

export type ProductDefinition = {
  id: ProductId;
  name: string;
  shortName: string;
  description: string;
  route: string;
  stage: ProductStage;
  order: number;
  capabilities: readonly CapabilityId[];
  dependsOn: readonly ProductId[];
};

export const productRegistry = [
  {
    id: 'marketing',
    name: 'IMDS Marketing',
    shortName: 'Marketing',
    description: 'Рекламные кабинеты, кампании, креативы, расходы и управление эффективностью.',
    route: '/marketing',
    stage: 'beta',
    order: 10,
    capabilities: ['ads.accounts', 'ads.campaigns', 'ads.creatives', 'ads.performance'],
    dependsOn: [],
  },
  {
    id: 'conversations',
    name: 'IMDS Conversations',
    shortName: 'Чаты',
    description: 'WhatsApp, Instagram, Telegram, email, общий inbox и AI-продавец.',
    route: '/conversations',
    stage: 'beta',
    order: 20,
    capabilities: [
      'inbox.omnichannel',
      'inbox.whatsapp',
      'inbox.instagram',
      'inbox.telegram',
      'inbox.email',
      'ai.sales_agent',
      'ai.knowledge_base',
      'ai.follow_up',
    ],
    dependsOn: ['crm'],
  },
  {
    id: 'crm',
    name: 'IMDS CRM',
    shortName: 'CRM',
    description: 'Клиенты, лиды, сделки, воронки, активности и история продаж.',
    route: '/crm',
    stage: 'active',
    order: 30,
    capabilities: ['crm.contacts', 'crm.deals', 'crm.pipelines', 'crm.activities'],
    dependsOn: [],
  },
  {
    id: 'dashboard',
    name: 'IMDS Dashboard',
    shortName: 'Аналитика',
    description: 'Сквозная аналитика от рекламного расхода до оплаты, возврата и LTV.',
    route: '/dashboard',
    stage: 'beta',
    order: 40,
    capabilities: ['analytics.attribution', 'analytics.funnel', 'analytics.revenue', 'analytics.anomalies'],
    dependsOn: ['marketing', 'crm'],
  },
  {
    id: 'automation',
    name: 'IMDS Automation',
    shortName: 'Автоматизация',
    description: 'Триггеры, условия, действия, автодожим и управление бизнес-процессами.',
    route: '/automation',
    stage: 'planned',
    order: 50,
    capabilities: ['automation.workflows', 'automation.triggers', 'automation.actions'],
    dependsOn: ['crm'],
  },
  {
    id: 'contracts',
    name: 'IMDS Contracts',
    shortName: 'Документы',
    description: 'Шаблоны, договоры, версии, согласования и электронное подписание.',
    route: '/contracts',
    stage: 'planned',
    order: 60,
    capabilities: ['contracts.templates', 'contracts.documents', 'contracts.signatures'],
    dependsOn: ['crm'],
  },
  {
    id: 'payments',
    name: 'IMDS Payments',
    shortName: 'Оплаты',
    description: 'Счета, Kaspi Pay, оплаты, частичные платежи, возвраты и задолженность.',
    route: '/payments',
    stage: 'planned',
    order: 70,
    capabilities: ['payments.invoices', 'payments.transactions', 'payments.refunds'],
    dependsOn: ['crm'],
  },
  {
    id: 'workspace',
    name: 'IMDS Workspace',
    shortName: 'Работа',
    description: 'Задачи, проекты, команда, роли и внутреннее исполнение обязательств.',
    route: '/workspace',
    stage: 'beta',
    order: 80,
    capabilities: ['workspace.tasks', 'workspace.projects', 'workspace.team'],
    dependsOn: [],
  },
] as const satisfies readonly ProductDefinition[];

export const productById = Object.fromEntries(productRegistry.map((product) => [product.id, product])) as Record<ProductId, ProductDefinition>;

export function isProductAvailable(productId: ProductId) {
  return productById[productId].stage !== 'planned';
}

export function getProductDependencies(productId: ProductId) {
  return productById[productId].dependsOn.map((dependencyId) => productById[dependencyId]);
}
