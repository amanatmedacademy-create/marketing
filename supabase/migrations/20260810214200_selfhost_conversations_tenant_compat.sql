-- Production conversations are tenant-scoped before Speed-to-Lead references
-- company_id. Historical clean replays did not guarantee that column yet.
alter table public.marketing_conversations
  add column if not exists company_id uuid;

-- Preserve any pre-existing replay rows by deriving the tenant from the linked lead.
update public.marketing_conversations c
set company_id = l.company_id
from public.marketing_leads l
where c.company_id is null
  and c.lead_id = l.id;

-- A fresh self-hosted replay has no business rows at this point, so enforce the
-- same NOT NULL contract as production whenever the data is already valid.
do $$
begin
  if not exists (select 1 from public.marketing_conversations where company_id is null) then
    alter table public.marketing_conversations alter column company_id set not null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'marketing_conversations_company_id_fkey'
      and conrelid = 'public.marketing_conversations'::regclass
  ) then
    alter table public.marketing_conversations
      add constraint marketing_conversations_company_id_fkey
      foreign key (company_id) references public.crm_companies(id) on delete cascade;
  end if;
end
$$;

create index if not exists marketing_conversations_company_idx
  on public.marketing_conversations(company_id, updated_at desc);

notify pgrst, 'reload schema';
