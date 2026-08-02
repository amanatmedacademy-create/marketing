import type { PlatformModule } from '@imds/contracts';

export function ModulePage({ module }: { module: PlatformModule }) {
  return (
    <section className="module-page">
      <div className="module-heading">
        <div>
          <span>Этап реализации {module.phase}</span>
          <h1>{module.title}</h1>
          <p>{module.description}</p>
        </div>
        <span className={`status ${module.status}`}>{module.status === 'foundation' ? 'Каркас' : 'Запланировано'}</span>
      </div>

      <div className="module-grid">
        <article>
          <h2>Правило готовности</h2>
          <p>Модуль считается рабочим только после реализации схемы данных, tenant isolation, прав, API, интерфейса, аудита, тестов и мониторинга.</p>
        </article>
        <article>
          <h2>Текущее состояние</h2>
          <p>В этом чистом каркасе нет фиктивных метрик, неработающих кнопок или статических статусов подключений.</p>
        </article>
        <article>
          <h2>Следующее действие</h2>
          <p>Разрабатывать модуль отдельным pull request по контрактам из документации и не смешивать его с другими доменами.</p>
        </article>
      </div>
    </section>
  );
}
