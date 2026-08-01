import { useState } from 'react';
import { Archive, Inbox, LayoutGrid, List, Mail, PenLine, RefreshCw, Search, Send, ShieldAlert, Star, Trash2, X } from 'lucide-react';

type Folder = 'inbox' | 'sent' | 'starred' | 'all' | 'archive' | 'spam' | 'trash';

const folders: Array<{ id: Folder; label: string; icon: typeof Inbox }> = [
  { id: 'inbox', label: 'Входящие', icon: Inbox },
  { id: 'sent', label: 'Отправленные', icon: Send },
  { id: 'starred', label: 'Избранное', icon: Star },
  { id: 'all', label: 'Все письма', icon: Mail },
  { id: 'archive', label: 'Архив', icon: Archive },
  { id: 'spam', label: 'Спам', icon: ShieldAlert },
  { id: 'trash', label: 'Корзина', icon: Trash2 },
];

export function EmailWorkspace() {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [composeOpen, setComposeOpen] = useState(false);
  const activeFolder = folders.find((item) => item.id === folder)!;

  return (
    <div className="mail-workspace">
      <div className="mail-setup-banner">
        <span className="mail-banner-icon"><Mail size={18} /></span>
        <div><strong>Почта ещё не настроена</strong><p>Подключите email, чтобы получать и отправлять письма из CRM.</p></div>
        <button className="primary">Да, настроить</button>
        <button>Нет</button>
      </div>

      <header className="mail-toolbar">
        <div><span className="mail-toolbar-icon"><Mail size={20} /></span><h2>Почта</h2></div>
        <div>
          <button className="primary" onClick={() => setComposeOpen(true)}><PenLine size={15} /> Написать</button>
          <button><LayoutGrid size={16} /></button>
          <button><List size={16} /></button>
          <button><RefreshCw size={16} /></button>
        </div>
      </header>

      <div className="mail-layout">
        <aside className="mail-folders">
          {folders.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={folder === item.id ? 'active' : ''} onClick={() => setFolder(item.id)}><Icon size={16} />{item.label}</button>;
          })}
        </aside>

        <section className="mail-list-pane">
          <label><Search size={16} /><input placeholder="Поиск писем…" /></label>
          <div className="mail-list-empty"><Mail size={42} strokeWidth={1.6} /><strong>Нет писем</strong><span>В папке «{activeFolder.label}» пока пусто</span></div>
        </section>

        <section className="mail-reader-pane">
          <div className="mail-reader-empty"><span><Mail size={36} /></span><strong>Выберите письмо</strong><p>Выберите письмо из списка для просмотра</p></div>
        </section>
      </div>

      {composeOpen && <div className="mail-compose-backdrop" onMouseDown={() => setComposeOpen(false)}>
        <form className="mail-compose-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); setComposeOpen(false); }}>
          <header><h3>Новое письмо</h3><button type="button" onClick={() => setComposeOpen(false)}><X size={18} /></button></header>
          <label>Кому<input type="email" placeholder="email@example.com" required /></label>
          <label>Тема<input placeholder="Тема письма" required /></label>
          <label>Сообщение<textarea placeholder="Текст письма…" required /></label>
          <footer><button type="button" onClick={() => setComposeOpen(false)}><X size={15} /> Свернуть в черновик</button><button className="primary" type="submit"><Send size={15} /> Отправить</button></footer>
        </form>
      </div>}
    </div>
  );
}
