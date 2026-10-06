-- ══════════════════════════════════════════════════════════════════════
-- Roberto's Mare — one-click test links (6 Oct 2026). A reviewer opens the
-- Mare app from a personal link, already signed in as HIMSELF, with no
-- password. The token is kept only as a hash, expires, and only works for a
-- login that has Mare access. The mare-try function checks all of it.
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.mare_try_links (
  token_hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  uses int not null default 0, last_used_at timestamptz,
  created_by text, created_at timestamptz not null default now()
);
alter table public.mare_try_links enable row level security;
revoke all on public.mare_try_links from anon, authenticated;
