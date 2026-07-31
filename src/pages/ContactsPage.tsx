import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Bell, LayoutDashboard, LoaderCircle, Mail, Megaphone, MessageCircle, Moon, Phone, Plus, RefreshCw, Search, Settings, Sun, UserRound, Users, WalletCards, X } from 'lucide-react';
import { createContact, loadContacts, type Contact } from '../services/crm';

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('imds_theme') === 'dark');

  const refresh = useCallback(async (search = query) => {
    setLoading(true);
    setError('');
    try {
      setContacts(await loadContacts(search));
    } catch (reason) {
      setContacts([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void refresh(''); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(query), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('imds_theme', dark ? 'dark' : 'light');
  }, [dark]);

  const withPhone = useMemo(() => contacts.filter((contact) => Boolean(contact.phone)).length, [contacts]);
  const withEmail = useMemo(() => contacts.filter((contact) => Boolean(contact.email)).length, [contacts]);
  const sources = useMemo(() => new Set(contacts.map((contact) => contact.source).filter(Boolean)).size, [contacts]);

  return <div className={`contacts-satu-shell ${dark ? 'is-dark' : ''}`}>
    <aside className="contacts-satu-sidebar">
      <a className="contacts-satu-logo" href="/" aria-label="IMDS Marketing"><span />IM</a>
      <nav>
        <a href="/" title="Дашборд"><LayoutDashboard /></a>
        <a href="/crm" title="Сделки"><WalletCards /></a>
        <a className="active" href="/contacts" title="Контакты"><UserRound /></a>
        <button title="Команда"><Users /></button>
        <button title="Чаты"><MessageCircle /></button>
        <button title="Реклама"><Megaphone /></button>
      </nav>
      <button className="contacts-satu-settings" title="Настройки"><Settings /></button>
    </aside>

    <section className="contacts-satu-main">
      <header className="contacts-satu-topbar">
        <div className="contacts-satu-brand"><strong>IMDS CRM</strong><span>Контакты текущей компании</span></div>
        <label className="contacts-satu-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, телефон или email" /></label>
        <div className="contacts-satu-actions">
          <button onClick={() => setDark((value) => !value)} aria-label="Переключить тему">{dark ? <Sun /> : <Moon />}</button>
          <button aria-label="Уведомления"><Bell /></button>
          <span>IM</span>
        </div>
      </header>

      <main className="crm-list-page">
        <header className="crm-list-head">
          <div>
            <a href="/" className="crm-back-link"><ArrowLeft /> IMDS Marketing</a>
            <h1>Контакты</h1>
            <p>Реальные клиенты и лиды текущей компании</p>
          </div>
          <div className="crm-list-actions">
            <button className="crm-icon-action" onClick={() => void refresh()} aria-label="Обновить"><RefreshCw /></button>
            <button className="crm-primary-action" onClick={() => setModalOpen(true)}><Plus /> Новый контакт</button>
          </div>
        </header>

        <section className="crm-contact-kpis">
          <article><span>Всего контактов</span><strong>{contacts.length}</strong><small>По текущему фильтру</small></article>
          <article><span>С телефоном</span><strong>{withPhone}</strong><small>Доступны для звонка</small></article>
          <article><span>С email</span><strong>{withEmail}</strong><small>Доступны для рассылки</small></article>
          <article><span>Источников</span><strong>{sources}</strong><small>Уникальные каналы</small></article>
        </section>

        <section className="crm-list-toolbar">
          <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, телефон или email" /></label>
          <span>{contacts.length} контактов</span>
        </section>

        {error && <div className="crm-error"><span>{error}</span><button onClick={() => setError('')}><X /></button></div>}

        {loading ? <div className="crm-list-state"><LoaderCircle className="spin" /><span>Загрузка контактов</span></div> : contacts.length ? <div className="crm-contact-table-wrap">
          <table className="crm-contact-table">
            <thead><tr><th>Контакт</th><th>Телефон</th><th>Email</th><th>Источник</th></tr></thead>
            <tbody>{contacts.map((contact) => {
              const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Без имени';
              return <tr key={contact.id}>
                <td><div className="crm-contact-name"><span><UserRound /></span><strong>{fullName}</strong></div></td>
                <td>{contact.phone ? <a href={`tel:${contact.phone}`}><Phone />{contact.phone}</a> : <em>—</em>}</td>
                <td>{contact.email ? <a href={`mailto:${contact.email}`}><Mail />{contact.email}</a> : <em>—</em>}</td>
                <td>{contact.source ? <span className="crm-source-chip">{contact.source}</span> : <em>Не указан</em>}</td>
              </tr>;
            })}</tbody>
          </table>
          <div className="crm-contact-grid">{contacts.map((contact) => {
            const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Без имени';
            return <article key={contact.id} className="crm-contact-card"><div className="crm-contact-avatar"><UserRound /></div><div className="crm-contact-body"><h2>{fullName}</h2>{contact.phone && <a href={`tel:${contact.phone}`}><Phone />{contact.phone}</a>}{contact.email && <a href={`mailto:${contact.email}`}><Mail />{contact.email}</a>}{contact.source && <span>{contact.source}</span>}</div></article>;
          })}</div>
        </div> : <div className="crm-list-empty"><UserRound /><h2>Контактов пока нет</h2><p>Создайте первый контакт. Демо-записи не добавляются.</p><button className="crm-primary-action" onClick={() => setModalOpen(true)}><Plus /> Создать контакт</button></div>}

        {modalOpen && <ContactModal onClose={() => setModalOpen(false)} onCreated={(contact) => { setContacts((items) => [contact, ...items]); setModalOpen(false); }} />}
      </main>
    </section>
  </div>;
}

function ContactModal({ onClose, onCreated }: { onClose: () => void; onCreated: (contact: Contact) => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!firstName.trim()) return;
    setSaving(true);
    setError('');
    try {
      onCreated(await createContact({ firstName: firstName.trim(), lastName: lastName.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined, source: source.trim() || undefined }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  }

  return <div className="crm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="crm-modal" onSubmit={submit}><div className="crm-modal-head"><div><h2>Новый контакт</h2><p>Контакт будет сохранён в CRM текущей компании.</p></div><button type="button" onClick={onClose}><X /></button></div><label>Имя<input autoFocus value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label><label>Фамилия<input value={lastName} onChange={(event) => setLastName(event.target.value)} /></label><label>Телефон<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Источник<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Meta Ads, TikTok, органика" /></label>{error && <div className="crm-error">{error}</div>}<div className="crm-modal-actions"><button type="button" onClick={onClose}>Отмена</button><button className="crm-primary-action" disabled={saving || !firstName.trim()}>{saving ? 'Сохранение…' : 'Создать контакт'}</button></div></form></div>;
}
