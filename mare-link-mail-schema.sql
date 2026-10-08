-- Roberto's Mare: email a team member their own phone link (8 Oct 2026).
-- Francesco: the kitchen team (Vinay and four others) get their link on their own email.
-- The existing send-note only mails @robertos.ae / @skelmore.com, on purpose, so this is a
-- narrow sender of its own: a row in mare_link_mail can only be written by an admin (no grants,
-- RLS on, no RPC), and mare-link-mail only ever sends a queued row's OWN person their OWN link.
-- A caller of the function can only ask for an already-queued row to be sent, once.
create table if not exists public.mare_link_mail (
  id bigserial primary key,
  staff_id uuid not null references public.mare_staff(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_test boolean not null default false,
  status text not null default 'queued',
  tries int not null default 0,
  resend_id text, error text, sent_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);
alter table public.mare_link_mail enable row level security;
revoke all on public.mare_link_mail from anon, authenticated;

create or replace function public.mare_link_kick(p_mail bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://paoaivwtkzujmrgrfjuq.supabase.co/functions/v1/mare-link-mail',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhb2Fpdnd0a3p1am1yZ3JmanVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzAxMzAsImV4cCI6MjA5NjY0NjEzMH0.VynG9PBeIaqRG2lkMEuzskkcB11EhR-UfO9eGYsaUxk'),
    body := jsonb_build_object('mail', p_mail));
end $$;
revoke all on function public.mare_link_kick(bigint) from public, anon, authenticated;
