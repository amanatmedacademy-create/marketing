create index if not exists patient_journey_events_lead_fk_idx
  on public.patient_journey_events(lead_id)
  where lead_id is not null;

create index if not exists conversion_events_lead_fk_idx
  on public.conversion_events(lead_id)
  where lead_id is not null;

create index if not exists lost_opportunities_lead_fk_idx
  on public.lost_opportunities(lead_id)
  where lead_id is not null;

create index if not exists lost_opportunities_call_fk_idx
  on public.lost_opportunities(call_id)
  where call_id is not null;
