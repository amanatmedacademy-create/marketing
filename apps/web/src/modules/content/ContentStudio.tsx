import { useEffect, useMemo, useState } from 'react';
import { FilePlus2, Files, Image, Languages, Plus, Save, Send, Settings2 } from 'lucide-react';
import { apiFetch } from '../../lib/api-client';

type Field = { name: string; label: string; type: string; required?: boolean };
type ContentType = {
  id: string;
  api_id: string;
  display_name: string;
  description: string | null;
  fields: Field[];
  draft_and_publish: boolean;
  localized: boolean;
};
type Entry = {
  id: string;
  content_type_id: string;
  document_id: string;
  locale: string;
  status: 'draft' | 'published' | 'archived';
  title: string;
  slug: string;
  data: Record<string, unknown>;
  published_at: string | null;
  updated_at: string;
};
type MediaItem = { id: string; name: string; url: string; mime_type: string | null; folder: string; alt_text: Record<string, string> };
type Tab = 'entries' | 'types' | 'media';

const locales = [
  { id: 'ru', label: 'Русский' },
  { id: 'kk', label: 'Қазақша' },
  { id: 'en', label: 'English' },
];

export function ContentStudio() {
  const [tab, setTab] = useState<Tab>('entries');
  const [types, setTypes] = useState<ContentType[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [locale, setLocale] = useState('ru');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [entryDraft, setEntryDraft] = useState({ title: '', slug: '', data: {} as Record<string, unknown> });
  const [typeDraft, setTypeDraft] = useState({ display_name: '', api_id: '', description: '', fields: [] as Field[] });
  const [mediaDraft, setMediaDraft] = useState({ name: '', url: '', folder: '/' });

  const selectedType = types.find(item => item.id === selectedTypeId) ?? types[0] ?? null;
  const filteredEntries = useMemo(() => entries.filter(item => (!selectedType || item.content_type_id === selectedType.id) && item.locale === locale), [entries, selectedType, locale]);
  const selectedEntry = entries.find(item => item.id === selectedEntryId) ?? null;

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [typeRows, entryRows, mediaRows] = await Promise.all([
        apiFetch<ContentType[]>('/content/types'),
        apiFetch<Entry[]>('/content/entries'),
        apiFetch<MediaItem[]>('/content/media'),
      ]);
      setTypes(typeRows);
      setEntries(entryRows);
      setMedia(mediaRows);
      if (!selectedTypeId && typeRows[0]) setSelectedTypeId(typeRows[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить Content Studio');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);
  useEffect(() => {
    if (!selectedEntry) return;
    setEntryDraft({ title: selectedEntry.title, slug: selectedEntry.slug, data: selectedEntry.data ?? {} });
  }, [selectedEntryId]);

  function createNewEntry() {
    setSelectedEntryId('');
    setEntryDraft({ title: '', slug: '', data: {} });
  }

  async function saveEntry(status: 'draft' | 'published') {
    if (!selectedType || !entryDraft.title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const payload = { ...entryDraft, content_type_id: selectedType.id, locale, status };
      const saved = selectedEntryId
        ? await apiFetch<Entry>(`/content/entries/${selectedEntryId}`, { method: 'PATCH', body: payload })
        : await apiFetch<Entry>('/content/entries', { method: 'POST', body: payload });
      setEntries(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setSelectedEntryId(saved.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить материал');
    } finally {
      setSaving(false);
    }
  }

  async function createType() {
    if (!typeDraft.display_name.trim()) return;
    setSaving(true);
    try {
      const created = await apiFetch<ContentType>('/content/types', { method: 'POST', body: typeDraft });
      setTypes(current => [...current, created]);
      setSelectedTypeId(created.id);
      setTypeDraft({ display_name: '', api_id: '', description: '', fields: [] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать тип контента');
    } finally {
      setSaving(false);
    }
  }

  async function addMedia() {
    if (!mediaDraft.name.trim() || !mediaDraft.url.trim()) return;
    setSaving(true);
    try {
      const created = await apiFetch<MediaItem>('/content/media', { method: 'POST', body: mediaDraft });
      setMedia(current => [created, ...current]);
      setMediaDraft({ name: '', url: '', folder: '/' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось добавить медиа');
    } finally {
      setSaving(false);
    }
  }

  return <div className="content-studio">
    <aside className="content-studio-sidebar">
      <div className="content-studio-brand"><strong>IMDS</strong><span>Content Studio</span></div>
      <button className={tab === 'entries' ? 'active' : ''} onClick={() => setTab('entries')}><Files size={17} /> Материалы</button>
      <button className={tab === 'types' ? 'active' : ''} onClick={() => setTab('types')}><Settings2 size={17} /> Типы контента</button>
      <button className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}><Image size={17} /> Медиатека</button>
      <div className="content-studio-locale"><Languages size={16} />{locales.map(item => <button key={item.id} className={locale === item.id ? 'active' : ''} onClick={() => setLocale(item.id)}>{item.id.toUpperCase()}</button>)}</div>
    </aside>

    <main className="content-studio-main">
      <header className="content-studio-header">
        <div><h1>{tab === 'entries' ? 'Материалы' : tab === 'types' ? 'Типы контента' : 'Медиатека'}</h1><p>Черновики, публикации, локализация и структура контента.</p></div>
        {tab === 'entries' && <button className="content-primary" onClick={createNewEntry}><FilePlus2 size={16} /> Новый материал</button>}
      </header>

      {error && <div className="content-error">{error}</div>}
      {loading ? <div className="content-empty">Загрузка Content Studio…</div> : null}

      {!loading && tab === 'entries' && <div className="content-entry-layout">
        <section className="content-list-panel">
          <div className="content-type-tabs">{types.map(type => <button key={type.id} className={selectedType?.id === type.id ? 'active' : ''} onClick={() => { setSelectedTypeId(type.id); setSelectedEntryId(''); }}>{type.display_name}</button>)}</div>
          <div className="content-entry-list">{filteredEntries.map(entry => <button key={entry.id} className={selectedEntryId === entry.id ? 'active' : ''} onClick={() => setSelectedEntryId(entry.id)}><strong>{entry.title}</strong><span>{entry.slug}</span><small className={entry.status}>{entry.status === 'published' ? 'Опубликовано' : entry.status === 'draft' ? 'Черновик' : 'Архив'}</small></button>)}{!filteredEntries.length && <div className="content-empty">Материалов пока нет</div>}</div>
        </section>
        <section className="content-editor-panel">
          {!selectedType ? <div className="content-empty">Сначала создайте тип контента</div> : <>
            <div className="content-editor-grid"><label>Заголовок<input value={entryDraft.title} onChange={event => setEntryDraft(value => ({ ...value, title: event.target.value }))} placeholder="Название материала" /></label><label>Slug<input value={entryDraft.slug} onChange={event => setEntryDraft(value => ({ ...value, slug: event.target.value }))} placeholder="url-slug" /></label></div>
            {selectedType.fields.map(field => <ContentField key={field.name} field={field} value={entryDraft.data[field.name]} onChange={value => setEntryDraft(current => ({ ...current, data: { ...current.data, [field.name]: value } }))} />)}
            <div className="content-editor-actions"><button onClick={() => void saveEntry('draft')} disabled={saving}><Save size={16} /> Сохранить черновик</button><button className="content-primary" onClick={() => void saveEntry('published')} disabled={saving}><Send size={16} /> Опубликовать</button></div>
          </>}
        </section>
      </div>}

      {!loading && tab === 'types' && <div className="content-types-layout">
        <section className="content-card"><h2>Новый тип контента</h2><label>Название<input value={typeDraft.display_name} onChange={event => setTypeDraft(value => ({ ...value, display_name: event.target.value }))} placeholder="Например: Инструкция" /></label><label>API ID<input value={typeDraft.api_id} onChange={event => setTypeDraft(value => ({ ...value, api_id: event.target.value }))} placeholder="instruction" /></label><label>Описание<textarea value={typeDraft.description} onChange={event => setTypeDraft(value => ({ ...value, description: event.target.value }))} /></label><button className="content-primary" onClick={() => void createType()} disabled={saving}><Plus size={16} /> Создать тип</button></section>
        <section className="content-type-cards">{types.map(type => <article key={type.id}><strong>{type.display_name}</strong><code>{type.api_id}</code><p>{type.description || 'Без описания'}</p><span>{type.fields.length} полей · {type.localized ? '3 языка' : '1 язык'}</span></article>)}</section>
      </div>}

      {!loading && tab === 'media' && <div className="content-media-layout"><section className="content-card"><h2>Добавить медиа по URL</h2><label>Название<input value={mediaDraft.name} onChange={event => setMediaDraft(value => ({ ...value, name: event.target.value }))} /></label><label>URL<input value={mediaDraft.url} onChange={event => setMediaDraft(value => ({ ...value, url: event.target.value }))} placeholder="https://..." /></label><label>Папка<input value={mediaDraft.folder} onChange={event => setMediaDraft(value => ({ ...value, folder: event.target.value }))} /></label><button className="content-primary" onClick={() => void addMedia()} disabled={saving}><Plus size={16} /> Добавить</button></section><section className="content-media-grid">{media.map(item => <article key={item.id}><div className="content-media-preview">{item.mime_type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(item.url) ? <img src={item.url} alt={item.alt_text?.ru || item.name} /> : <Image size={32} />}</div><strong>{item.name}</strong><span>{item.folder}</span><a href={item.url} target="_blank" rel="noreferrer">Открыть файл</a></article>)}</section></div>}
    </main>
  </div>;
}

function ContentField({ field, value, onChange }: { field: Field; value: unknown; onChange: (value: unknown) => void }) {
  const textValue = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (field.type === 'boolean') return <label className="content-checkbox"><input type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} /> {field.label}</label>;
  if (field.type === 'text' || field.type === 'richtext' || field.type === 'json') return <label>{field.label}{field.required && ' *'}<textarea rows={field.type === 'richtext' ? 12 : 5} value={field.type === 'json' && value && typeof value === 'object' ? JSON.stringify(value, null, 2) : textValue} onChange={event => onChange(event.target.value)} /></label>;
  return <label>{field.label}{field.required && ' *'}<input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text'} value={textValue} onChange={event => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)} placeholder={field.type === 'media' ? 'URL файла из медиатеки' : ''} /></label>;
}
