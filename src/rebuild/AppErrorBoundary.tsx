import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('IMDS frontend error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <main className="rebuild-fatal">
      <div className="rebuild-fatal-card">
        <span className="rebuild-status-dot" />
        <h1>Интерфейс временно недоступен</h1>
        <p>Приложение перехватило ошибку и не оставило пустой экран.</p>
        <pre>{this.state.error.message}</pre>
        <div className="rebuild-fatal-actions">
          <button onClick={() => window.location.reload()}>Перезагрузить</button>
          <a href="/">На главную</a>
        </div>
      </div>
    </main>;
  }
}
