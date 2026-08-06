import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Image, LoaderCircle, Search, Square } from 'lucide-react';
import { marketingApi, type MetaCatalogAccount, type MetaCatalogCreative } from '../services/api';

type Props = {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onMessage?: (type: 'ok' | 'error', text: string) => void;
  onSaved?: () => void;
};

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  try { return (JSON.parse(error.message) as { error?: string }).error || error.message; }
  catch { return error.message; }
}

export function MetaSelectionPanel({ disabled, onBusyChange, onMessage, onSaved }: Props) {
  const [accounts, setAccounts] = useState<MetaCatalogAccount[]>([]);
  const [creatives, setCreatives] = useState<MetaCatalogCreative[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedAds, setSelectedAds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCreatives, setLoadingCreatives] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  const busy = loading || loadingCreatives || saving || Boolean(disabled);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void marketingApi.metaCatalog().then((result) => {
      if (!active) return;
      setAccounts(result.accounts);
      setSelectedAccounts(result.selectedAccountIds);
      setSelectedAds(result.selectedAdIds);
    }).catch((error) => onMessage?.('error', `Meta: ${errorText(error)}`)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [onMessage]);

  useEffect(() => {
    if (!selectedAccounts.length) {
      setCreatives([]);
      return;
    }
    let active = true;
    setLoadingCreatives(true);
    void marketingApi.metaCatalog(selectedAccounts).then((result) => {
      if (!active) return;
      setCreatives(result.creatives);
    }).catch((error) => onMessage?.('error', `Креативы Meta: ${errorText(error)}`)).finally(() => active && setLoadingCreatives(false));
    return () => { active = false; };
  }, [selectedAccounts, onMessage]);

  const visibleCreatives = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? creatives.filter((item) => `${item.name} ${item.creativeName || ''} ${item.id}`.toLowerCase().includes(value)) : creatives;
  }, [creatives, query]);

  const toggleAccount = (id: string) => {
    setSelectedAccounts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setSelectedAds([]);
  };

  const toggleAd = (id: string) => setSelectedAds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const save = async () => {
    if (!selectedAccounts.length) {
      onMessage?.('error', 'Выберите хотя бы один рекламный кабинет.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/integrations/meta/selection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectedAccountIds: selectedAccounts, selectedAdIds: selectedAds, prune: true, verified: true }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(body || `Meta selection: ${response.status}`);
      onMessage?.('ok', selectedAds.length
        ? `Сохранено: кабинетов ${selectedAccounts.length}, выбранных креативов ${selectedAds.length}.`
        : `Сохранено: кабинетов ${selectedAccounts.length}. Будут загружены все ${creatives.length} доступных креативов.`);
      onSaved?.();
    } catch (error) {
      onMessage?.('error', `Meta: ${errorText(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return <section className="iv2-meta-selection">
    <div className="iv2-selection-head">
      <div><strong>Рекламные кабинеты</strong><span>Выберите кабинеты, которые должны попадать в аналитику.</span></div>
      {loading && <LoaderCircle className="spin" size={18}/>} 
    </div>
    <div className="iv2-account-list">
      {accounts.map((account) => {
        const selected = selectedAccounts.includes(account.id);
        return <button key={account.id} type="button" className={selected ? 'is-selected' : ''} onClick={() => toggleAccount(account.id)} disabled={busy}>
          {selected ? <CheckSquare size={18}/> : <Square size={18}/>}<span><strong>{account.name}</strong><small>{account.id} · {account.currency || '—'} · {account.creativeCount} креативов</small></span>
        </button>;
      })}
    </div>

    <div className="iv2-selection-head">
      <div><strong>Креативы и объявления</strong><span>Ничего не отмечено — загружаются все креативы выбранных кабинетов.</span></div>
      {loadingCreatives && <LoaderCircle className="spin" size={18}/>} 
    </div>
    <label className="iv2-creative-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию или ID"/></label>
    <div className="iv2-creative-list">
      {visibleCreatives.map((creative) => {
        const selected = selectedAds.includes(creative.id);
        return <button key={`${creative.accountId}:${creative.id}`} type="button" className={selected ? 'is-selected' : ''} onClick={() => toggleAd(creative.id)} disabled={busy}>
          {creative.thumbnailUrl ? <img src={creative.thumbnailUrl} alt=""/> : <span className="iv2-creative-placeholder"><Image size={18}/></span>}
          <span><strong>{creative.name}</strong><small>{creative.creativeName || creative.id} · {creative.status}</small></span>
          {selected ? <CheckSquare size={18}/> : <Square size={18}/>} 
        </button>;
      })}
      {!loadingCreatives && selectedAccounts.length > 0 && visibleCreatives.length === 0 && <p>Креативы не найдены.</p>}
    </div>
    <button className="iv2-primary iv2-selection-save" type="button" onClick={() => void save()} disabled={busy || !selectedAccounts.length}>{saving ? <LoaderCircle className="spin" size={16}/> : null} Сохранить выбор</button>
  </section>;
}
