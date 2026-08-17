alter table public.marketing_leads
  add column if not exists first_name text,
  add column if not exists last_name text;

update public.marketing_leads
set first_name = nullif(btrim(name), '')
where first_name is null
  and nullif(btrim(name), '') is not null;

notify pgrst, 'reload schema';
