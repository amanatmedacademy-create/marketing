import { Instagram, Search } from 'lucide-react';

export function InstagramWorkspace() {
  return (
    <div className="ig-workspace">
      <aside className="ig-sidebar">
        <header className="ig-sidebar-head">
          <div><Instagram size={18} /><strong>Instagram Direct</strong></div>
          <label><Search size={16} /><input placeholder="Поиск контакта" /></label>
        </header>
        <div className="ig-empty-list">
          <Instagram size={44} strokeWidth={1.7} />
          <strong>Нет чатов Instagram</strong>
          <span>Чаты появятся когда клиенты напишут вам</span>
        </div>
      </aside>
      <section className="ig-chat-area">
        <div className="ig-empty-chat">
          <span><Instagram size={40} /></span>
          <strong>Instagram Direct</strong>
          <p>Нет активных чатов. Чаты появятся когда клиенты напишут вам.</p>
        </div>
      </section>
    </div>
  );
}
