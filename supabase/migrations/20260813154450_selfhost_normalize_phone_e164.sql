-- The production database already has this helper, but the checked-in history
-- references it before any migration creates it. Restore the production
-- definition for deterministic self-hosted replay.
create or replace function public.normalize_phone_e164(raw_phone text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  digits text;
begin
  if raw_phone is null then
    return null;
  end if;

  digits := regexp_replace(btrim(raw_phone), '[^0-9]', '', 'g');
  if digits = '' then
    return '';
  end if;

  if left(digits, 2) = '00' then
    digits := substr(digits, 3);
  end if;

  if length(digits) = 10 then
    digits := '7' || digits;
  elsif length(digits) = 11 and left(digits, 1) = '8' then
    digits := '7' || substr(digits, 2);
  end if;

  return '+' || digits;
end;
$function$;

grant execute on function public.normalize_phone_e164(text) to service_role;
notify pgrst, 'reload schema';
