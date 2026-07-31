import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Phone = { id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; status?: string };
type Template = { id: string; name: string; language?: string; status?: string; category?: string };
type Overview = { configured: boolean; wabaId?: string; phoneNumberId?: string; phones?: Phone[]; templates?: Template[]; error?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await response.text();
  let parsed: unknown = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { error: body }; }
  if (!response.ok) throw new Error((parsed as { error?: string }).error || `HTTP ${response.status}`);
  return parsed as T;
}

export default function WabaCatalogActivation() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('Здравствуйте! Это тестовое сообщение IMDS для проверки WhatsApp Business Messaging.');
  const [result, setResult] = useState('');

  const load = async () => {
    setLoading(true);
    setResult('');
    try {
      setOverview(await request<Overview>('/api/integrations/waba/review/overview'));
    } catch (error) {
      setOverview({ configured: false, error: error instanceof Error ? error.message : String(error) });
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/integrations') return;
    const activate = (card: HTMLElement) => {
      if (card.dataset.wabaReview === 'true') return;
      card.dataset.wabaReview = 'true';
      const badge = card.querySelector<HTMLElement>('.integration-card-top em');
      const button = card.querySelector<HTMLButtonElement>(':scope > button');
      if (!button) return;
      card.classList.remove('integration-state-planned');
      card.classList.add('integration-state-connected');
      if (badge) badge.textContent = 'App Review';
      button.disabled = false;
      button.textContent = 'Открыть WhatsApp Console';
      button.addEventListener('click', () => { setOpen(true); void load(); });
    };
    const scan = () => document.querySelectorAll<HTMLElement>('[data-platform="whatsapp-cloud"]').forEach(activate);
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const send = async () => {
    setLoading(true);
    setResult('');
    try {
      const response = await request<{ ok: boolean; result: { messages?: Array<{ id?: string }> } }>('/api/integrations/waba/review/send', {
        method: 'POST', body: JSON.stringify({ to, message }),
      });
      setResult(`Сообщение отправлено. Message ID: ${response.result.messages?.[0]?.id || 'получен'}`);
    } catch (error) { setResult(`Ошибка: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setLoading(false); }
  };

  if (!open) return null;
  return createPortal(<div style={{position:'fixed',inset:0,zIndex:10000,background:'rgba(2,8,23,.82)',display:'grid',placeItems:'center',padding:24}} onClick={() => setOpen(false)}>
    <div style={{width:'min(1100px,96vw)',maxHeight:'92vh',overflow:'auto',background:'#091426',border:'1px solid #29405f',borderRadius:18,padding:24,color:'#e5edf8'}} onClick={(e) => e.stopPropagation()}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center'}}><div><h2 style={{margin:0}}>WhatsApp Business Console</h2><p style={{color:'#9fb0c7'}}>Демонстрационный сценарий для Meta App Review</p></div><button onClick={() => setOpen(false)}>Закрыть</button></div>
      {loading && <p>Загрузка…</p>}
      {overview?.error && <div style={{padding:14,border:'1px solid #7f1d1d',borderRadius:12,background:'#2a1118'}}>{overview.error}</div>}
      {overview?.configured && <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12,margin:'18px 0'}}>
          <div style={{padding:16,border:'1px solid #29405f',borderRadius:12}}><small>WABA ID</small><div>{overview.wabaId}</div></div>
          <div style={{padding:16,border:'1px solid #29405f',borderRadius:12}}><small>Phone Number ID</small><div>{overview.phoneNumberId}</div></div>
          <div style={{padding:16,border:'1px solid #29405f',borderRadius:12}}><small>Статус API</small><div>Подключено</div></div>
        </div>
        <h3>Телефонные номера</h3>
        <div style={{display:'grid',gap:10}}>{overview.phones?.map((phone) => <div key={phone.id} style={{padding:14,border:'1px solid #29405f',borderRadius:12,display:'flex',justifyContent:'space-between'}}><span><strong>{phone.verified_name || 'WhatsApp Business'}</strong><br/>{phone.display_phone_number || phone.id}</span><span>{phone.quality_rating || phone.status || 'CONNECTED'}</span></div>)}</div>
        <h3 style={{marginTop:24}}>Шаблоны сообщений</h3>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10}}>{overview.templates?.map((template) => <div key={template.id} style={{padding:14,border:'1px solid #29405f',borderRadius:12}}><strong>{template.name}</strong><div>{template.language} · {template.category} · {template.status}</div></div>)}</div>
        <h3 style={{marginTop:24}}>Тестовая отправка</h3>
        <div style={{display:'grid',gap:10}}><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Номер получателя: 77001234567" style={{padding:12,borderRadius:10}}/><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} style={{padding:12,borderRadius:10}}/><button disabled={loading || !to || !message} onClick={() => void send()}>Отправить тестовое сообщение</button>{result && <div style={{padding:12,borderRadius:10,background:'#10233f'}}>{result}</div>}</div>
      </>}
    </div>
  </div>, document.body);
}
