import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, LoaderCircle, Search, UserRoundSearch, UsersRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { marketingApi, type AdSummaryRow, type MarketingLead } from '../services/api';
import '../global-search.css';

type Result = {
  id: string;
  title: string;
  meta: string;
  route: string;
  kind: 'lead' | 'customer' | 'campaign';
};

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

export default function GlobalSearch() {
  const navigate = useNavigate();
  const hostRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<MarketingLead[]>([]);
  const [ads, setAds] = useState<AdSummaryRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, []);

  useEffect(() => {
    if (!open || loaded || query.trim().length < 2) return;
    let active = true;
    setLoading(true);
    Promise.all([
      marketingApi.listLeads({ limit: 500 }).catch(() => []),
      marketingApi.ads().catch(() => []),
    ]).then(([nextLeads, nextAds]) => {
      if (!active) return;
      setLeads(nextLeads);
      setAds(nextAds);
      setLoaded(true);
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [loaded, open, query]);

  const results = useMemo<Result[]>(() => {
    const needle = normalize(query);
    if (needle.length < 2) return [];

    const leadMatches = leads.filter((lead) => [
      lead.name, lead.phone, lead.email, lead.source, lead.platform, lead.campaign,
      lead.manager, lead.utm_source, lead.utm_campaign,
    ].some((value) => normalize(value).includes(needle))).slice(0, 6).map<Result>((lead) => ({
      id: `lead:${lead.id}`,
      title: lead.name || lead.phone || 'Лид без имени',
      meta: [lead.phone, lead.stage, lead.source || lead.platform].filter(Boolean).join(' · '),
      route: `/leads?lead=${encodeURIComponent(lead.id)}`,
      kind: 'lead',
    }));

    const customerKeys = new Set<string>();
    const customers: Result[] = [];
    for (const lead of leads) {
      if (customers.length >= 4) break;
      const matched = [lead.name, lead.phone, lead.email].some((value) => normalize(value).includes(needle));
      if (!matched) continue;
      const key = normalize(lead.phone || lead.email || lead.id);
      if (customerKeys.has(key)) continue;
      customerKeys.add(key);
      customers.push({
        id: `customer:${key}`,
        title: lead.name || lead.phone || 'Клиент',
        meta: [lead.phone, lead.email, 'Customer 360'].filter(Boolean).join(' · '),
        route: `/customers?customer=${encodeURIComponent(key)}`,
        kind: 'customer',
      });
    }

    const campaigns = ads.filter((row) => [
      row.campaign_name, row.adset_name, row.creative_name, row.platform, row.source,
      row.campaign_id, row.ad_id,
    ].some((value) => normalize(value).includes(needle))).slice(0, 5).map<Result>((row) => ({
      id: `campaign:${row.row_key}`,
      title: row.campaign_name || row.creative_name || 'Рекламная кампания',
      meta: [row.platform, row.adset_name, row.creative_name].filter(Boolean).join(' · '),
      route: row.campaign_id
        ? `/advertising?campaign=${encodeURIComponent(row.campaign_id)}`
        : `/advertising?q=${encodeURIComponent(row.campaign_name || row.creative_name || '')}`,
      kind: 'campaign',
    }));

    return [...leadMatches, ...customers, ...campaigns].slice(0, 12);
  }, [ads, leads, query]);

  const choose = (result: Result) => {
    setOpen(false);
    setQuery('');
    navigate(result.route);
  };

  return <div className="global-search" ref={hostRef}>
    <Search size={17}/>
    <input
      value={query}
      onFocus={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
        if (event.key === 'Enter' && results[0]) choose(results[0]);
      }}
      placeholder="Поиск клиентов, лидов, кампаний и UTM"
      aria-label="Глобальный поиск"
    />
    {query && <button type="button" className="global-search-clear" aria-label="Очистить поиск" onClick={() => setQuery('')}><X size={14}/></button>}
    {open && query.trim().length >= 2 && <div className="global-search-popover">
      <header><span>Глобальный поиск</span>{loading && <LoaderCircle className="spin" size={15}/>}</header>
      {!loading && results.length === 0 && <div className="global-search-empty">Ничего не найдено</div>}
      {results.map((result) => {
        const Icon = result.kind === 'campaign' ? BarChart3 : result.kind === 'customer' ? UserRoundSearch : UsersRound;
        return <button type="button" key={result.id} onClick={() => choose(result)}>
          <span className={`global-search-icon global-search-icon--${result.kind}`}><Icon size={16}/></span>
          <span><strong>{result.title}</strong><small>{result.meta || 'Без дополнительных данных'}</small></span>
        </button>;
      })}
      {results.length > 0 && <footer>Enter — открыть первый результат · Esc — закрыть</footer>}
    </div>
  </div>;
}
