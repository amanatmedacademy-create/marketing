create unique index if not exists pipeline_stages_pipeline_name_uq
  on public.pipeline_stages (pipeline_id, name);

create unique index if not exists projects_company_name_uq
  on public.projects (company_id, name);

create unique index if not exists finance_accounts_company_name_uq
  on public.finance_accounts (company_id, name);
