-- Roberto's Mare: a new person chooses their 4-digit code on their own phone link (8 Oct 2026).
-- Francesco: the kitchen team get their private link by email and must be able to start straight
-- away, with no tablet in Mare yet. Same rule as mare_kiosk_set_pin: only when NO code exists,
-- so a link can never overwrite a code (a forgotten code is still reset by a manager).
create or replace function public.mare_me_set_pin(p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid; n int;
begin
  select id into v from public.mare_staff where phone_token = coalesce(p_token,'-') and active;
  if v is null then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  if p_pin is null or p_pin !~ '^\d{4}$' then return jsonb_build_object('ok', false, 'error', 'format'); end if;
  update public.mare_staff set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), pin_set_at = now()
   where id = v and pin_hash is null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'already_set'); end if;
  insert into public.mare_pin_events(staff_id, kind, by) values (v, 'set', 'phone');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.mare_me_set_pin(text,text) from public, anon, authenticated;
grant execute on function public.mare_me_set_pin(text,text) to anon, authenticated;
