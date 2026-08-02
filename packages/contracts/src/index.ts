export type ModulePhase = 1 | 2 | 3 | 4 | 5;
export type ModuleStatus = 'foundation' | 'planned';

export type PlatformModule = {
  id: string;
  title: string;
  path: string;
  description: string;
  phase: ModulePhase;
  status: ModuleStatus;
};

export const platformModules = [
  { id: 'dashboard', title: 'Дашборд', path: '/dashboard', description: 'Управленческие KPI, динамика и проблемные показатели.', phase: 2, status: 'planned' },
  { id: 'crm', title: 'CRM', path: '/crm', description: 'Контакты, компании, сделки, воронки и история взаимодействий.', phase: 1, status: 'planned' },
  { id: 'tasks', title: 'Задачи', path: '/tasks', description: 'Задачи, дедлайны, исполнители, напоминания и автоматизация.', phase: 2, status: 'planned' },
  { id: 'projects', title: 'Проекты', path: '/projects', description: 'Проектные доски, сроки, бюджеты, документы и прогресс.', phase: 3, status: 'planned' },
  { id: 'team', title: 'Команда', path: '/team', description: 'Сотрудники, роли, отделы, права доступа, нагрузка и KPI.', phase: 1, status: 'planned' },
  { id: 'inbox', title: 'Омниканальный inbox', path: '/inbox', description: 'WhatsApp, Instagram, email, телефония и операторские очереди.', phase: 3, status: 'planned' },
  { id: 'ads', title: 'Реклама', path: '/ads', description: 'Рекламные кабинеты, кампании, расходы, лид-формы и аудитории.', phase: 3, status: 'planned' },
  { id: 'analytics', title: 'Сквозная аналитика', path: '/analytics', description: 'Путь от расхода до продажи, оплаты, маржи и ROMI.', phase: 4, status: 'planned' },
  { id: 'finance', title: 'Финансы', path: '/finance', description: 'Счета, доходы, расходы, долги, резервы и платежный календарь.', phase: 4, status: 'planned' },
  { id: 'files', title: 'Файлы', path: '/files', description: 'Документы, вложения, версии, доступ и объектное хранилище.', phase: 4, status: 'planned' },
  { id: 'meetings', title: 'Встречи', path: '/meetings', description: 'Календарь, видеовстречи, участники, напоминания и результаты.', phase: 4, status: 'planned' },
  { id: 'integrations', title: 'Интеграции', path: '/integrations', description: 'OAuth, ключи, webhooks, синхронизации, ошибки и health checks.', phase: 2, status: 'planned' },
  { id: 'automation', title: 'Автоматизация', path: '/automation', description: 'Триггеры, действия, очереди, повторные попытки и журнал событий.', phase: 2, status: 'planned' },
  { id: 'ai', title: 'AI-помощник', path: '/ai', description: 'Поиск, рекомендации и управляемые действия с подтверждением.', phase: 5, status: 'planned' },
  { id: 'gamification', title: 'Геймификация', path: '/gamification', description: 'Цели, баллы, достижения, рейтинги и защита от манипуляций.', phase: 5, status: 'planned' },
  { id: 'settings', title: 'Настройки', path: '/settings', description: 'Компания, пользователи, роли, справочники и системные параметры.', phase: 1, status: 'foundation' }
] as const satisfies readonly PlatformModule[];

export type PlatformModuleId = (typeof platformModules)[number]['id'];
