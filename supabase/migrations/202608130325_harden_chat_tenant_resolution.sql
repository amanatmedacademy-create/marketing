create or replace function public.assign_marketing_conversation_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_company_id uuid;
begin
  if new.company_id is not null then
    return new;
  end if;

  if new.lead_id is not null then
    select lead.company_id
      into resolved_company_id
      from public.marketing_leads as lead
     where lead.id = new.lead_id;
  end if;

  if resolved_company_id is null and new.contact_id is not null then
    select lead.company_id
      into resolved_company_id
      from public.marketing_leads as lead
     where lead.id = new.contact_id;
  end if;

  if resolved_company_id is null then
    raise exception 'Cannot resolve chat company from lead/contact; company_id is required'
      using errcode = '23502';
  end if;

  new.company_id := resolved_company_id;
  return new;
end;
$$;

notify pgrst, 'reload schema';
