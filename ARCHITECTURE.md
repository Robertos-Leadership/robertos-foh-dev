# Roberto's Platform — Architecture & Standards

**Owner:** Francesco Guarracino
**Purpose of this document:** Keep development disciplined so the system scales from today's two small apps to an organization-wide F&B platform (~600 employees) **without ever needing a ground-up rebuild**. This is also the first document handed to any appointed developer who takes over maintenance and further development.

**Last updated:** June 2026

---

## 0. Read this first (for an incoming developer)

This platform was built incrementally, in working sessions, without a traditional dev team. It is intentionally simple: vanilla HTML/CSS/JS single-page apps on GitHub Pages, backed by Supabase (Postgres + Auth + Edge Functions + Realtime). There is no build step and no framework. That is a deliberate choice to keep it understandable and cheap to run, not an oversight.

The apps currently in the platform:

- **Kitchen App** — kitchen operations (prep, scheduling, attendance via COSEC face-recognition, closing reports, recipes, orders). Repos: LIVE `Guarracinofamily/robertos-kitchen`, DEV `Robertos-kitchen/robertos-kitchen`. Supabase project `zrpglswalgjbtghudmhu`.
- **Leadership Hub** — recurring-event planning and execution tracking. Repo `Robertos-Leadership/robertos-leadership-hub`. Supabase project `paoaivwtkzujmrgrfjuq`.

These are **separate projects on purpose** today (separate repos, separate Supabase projects). Section 3 explains how they converge into one platform as the system grows.

---

## 1. Authentication & permissions — the load-bearing rule

**The single most important thing to get right. If this is wrong, the system has to be rebuilt.**

Current state (honest): both apps use the Supabase **anon key** with **open "allow all" Row Level Security (RLS)** policies. That means anyone with the URL can read and write all data. This is acceptable for a trusted kitchen of ~16 people. It is **not acceptable** for an organization platform holding HR, payroll, scheduling, and finance data for hundreds of people.

**Rule: real authentication and role-based access must be built before the platform grows beyond the current trusted teams — and certainly before any HR/payroll/finance module is added.** Security cannot be bolted on afterward; the data model has to assume "who is this user and what may they touch" from the first table.

Target model:

- Supabase **Auth** for identity (email/password or SSO), one user per employee.
- A small set of **roles**: e.g. `staff`, `manager`, `head_chef`, `admin`, plus a `department` attribute (kitchen, floor, finance, HR).
- **RLS policies that enforce those roles** — replace every `using (true) with check (true)` policy with policies that check the authenticated user's role/department.
- The anon key stays only for genuinely public, read-only content (if any). Everything operational moves behind auth.

**Until auth exists, do not build new modules that hold sensitive data.** Each feature added on the open foundation is a feature that must be partly redone after auth lands. Auth is therefore the next foundational build, ahead of new features.

---

## 2. Database schema standards

**2.1 Additive only — never destructive on production.**
No `DELETE`, `TRUNCATE`, `DROP`, or destructive migration on a production Supabase project without explicit written confirmation from the owner. Schema changes must be additive (`add column if not exists`, new tables). App code may `INSERT`/`UPDATE` its own records but must never wipe or reseed existing rows. If a change risks data, back up affected rows first.

**2.2 Normalize — one source of truth per entity.**
Reference entities by ID, not by repeating text. There must be one `employees` table (or equivalent) that every module references by `emp_id`/`id`, rather than storing an employee's name as free text in twenty places. The same applies to suppliers, stations, departments, events. At 16 people, denormalized text is survivable; at 600 it becomes unmaintainable and blocks new modules.

**2.3 Conventions (follow the existing pattern).**
- Primary keys: `id uuid default gen_random_uuid() primary key`.
- Timestamps: `created_at timestamptz default now()`, and `updated_at` where rows change.
- Foreign keys with explicit `references ... on delete` behavior (see existing Leadership Hub `schema.sql` for the established pattern: `on delete cascade` for child rows).
- Status fields as `text` with a documented, commented set of allowed values (e.g. `-- not_started | in_progress | done | blocked`). Consider real Postgres enums or check constraints as the platform matures.
- Money: `numeric` with an explicit `currency text default 'AED'`. Never floats for money.

**2.4 Service-date scoping.**
Operational records (prep, attendance, reports) must be scoped to a service date so data does not bleed across days. This has been a recurring source of bugs (see Section 4).

**2.5 Every schema change is committed as SQL.**
Schema lives in version-controlled `.sql` files in the repo (e.g. `schema.sql`), runnable from the Supabase SQL Editor. Never let the live schema drift away from a checked-in file — a developer must be able to recreate the database from the repo.

---

## 3. One foundation, not copy-pasted apps

Today each app reimplements its own login (none yet), branding, and data access. That is fine for two apps; it does not scale to a fifteen-module org platform.

**Target: shared foundation, modular apps.**

- **One auth system** shared across all modules (Section 1).
- **One shared design system** — brand tokens (Section 6) defined once and reused, not re-pasted per app.
- **Clear module separation in the database** — schemas/table-prefixes per module (kitchen_, events_, hr_, finance_) within a well-organized Supabase project, with shared reference tables (employees, departments) at the core.
- Apps become **modules of one platform**, sharing identity and core data, rather than unrelated standalone sites.

**Rule while we are still small:** keep Kitchen App and Leadership Hub strictly separate (separate repos, Supabase projects, data) until the shared auth + core-data foundation exists. Do **not** mix their features or data before then. Convergence happens deliberately, on top of the foundation — not by tangling the current apps together.

---

## 4. Known recurring bug patterns (check these every time)

These have bitten the project before. Check them on every change:

- **Dubai timezone (UTC+4).** `toISOString()` returns UTC; using it to compute "today" causes data to appear reset at the wrong time and breaks date scoping. Always compute the local Dubai date explicitly. This has caused real production bugs (daily prep reset, week-creation off-by-one).
- **Cache-busting.** Any push of `app.js`, `order-items.js`, `recipes.js`, `closing-report.js`, or `team.js` **must** also bump `?v=timestamp` in `index.html` and push it, or the kitchen screens run stale code.
- **Stale SHA on GitHub API pushes.** Always fetch the current file SHA (`GET`) immediately before a `PUT` to avoid 409 conflicts. One editing session on `main` at a time.
- **Realtime sync.** Use unique channel names per tab and a short polling fallback; deletes must propagate across the 5 kitchen screens.
- **No secrets in client code.** API keys for third-party services (Resend, COSEC) live in Supabase Edge Function secrets, never in the client JS or the repo. (The Supabase anon/publishable key in the client is expected and fine *once RLS is enforced* — see Section 1.)

---

## 5. Code & deployment standards

- **Keep `index.html` light.** No large base64-embedded images — reference optimized image files so the browser caches them. (A 218KB logo was once embedded 3× inline, bloating `index.html` to ~990KB on every load; fixed to ~95KB by externalizing it.) Target: HTML stays small; heavy/static assets are separate cacheable files.
- **Split code by concern** as files grow. The current single-large-file approach is acceptable at this size but should not be the pattern for the org platform.
- **Validate before pushing.** Run a syntax check (`node --check` for JS files, or parse inline script for single-file apps) and a basic smoke test before pushing to LIVE. A change must not silently break service.
- **DEV → test → LIVE.** Fix on DEV, test, then push the same fix to LIVE. Never experiment directly on production.
- **Deploy links, don't make the owner download.** Push and share the live GitHub Pages URL.
- **No browser storage in artifacts/embedded contexts** where it is unsupported; use in-memory or Supabase.

---

## 6. Brand tokens (define once, reuse everywhere)

```
Sabbia Chiara (background)   #F5F0E8   warm sand / cream
Vino Amarena (headers)       #6B1F2A   deep wine red
Text primary                 #2C1810   dark brown
Text secondary               #8B7355   warm taupe
Gold accent                  #C9A84C
Surface / white              #FFFFFF
Light border                 rgba(107,31,42,0.15)

Fonts: Georgia / Playfair Display (headings), Inter / system sans (body)
```

These must be defined in one shared stylesheet (CSS variables) for the platform, not re-declared per app.

---

## 7. Edge Functions & scheduled jobs

- Edge Functions hold all server-side logic that needs secrets (email via Resend, COSEC attendance sync). Secrets live in function config, never in the repo.
- Scheduled jobs use Supabase `pg_cron` + `pg_net`. Example in production: `cosec-sync-service` runs the attendance sync every 15 min, 14:00–01:30 Dubai, so clock-outs are captured through end of service. Document every cron job here as it is added.
- The COSEC `attendance-daily` endpoint returns **today only** — no historical backfill. Missed past-day data cannot be re-synced and must be corrected manually in-app.

---

## 8. Handover checklist (for the appointed developer)

When development is handed over, the developer should receive and be able to rely on:

- [ ] This document, current and accurate.
- [ ] A `README.md` per repo: what the app does, how to run/deploy, where the data lives.
- [ ] A checked-in `schema.sql` per Supabase project that recreates the database.
- [ ] A diagram (even hand-drawn) of the tables and their relationships.
- [ ] A list of all Edge Functions, what each does, and what secrets it needs (names, not values).
- [ ] A list of all scheduled (cron) jobs and their purpose.
- [ ] Credentials handover done securely (rotated PATs/keys, not pasted in chat history).
- [ ] **Status of Section 1 (auth):** is real auth built, or is the system still on open anon + allow-all RLS? This is the first thing a developer must know.

---

## 9. Cost reference (for planning)

- **Infrastructure** to run the full org platform for ~600 employees: roughly **$120–250/month** (Supabase Pro at $25/mo base + larger compute instance as load grows — 600 users is well within the 100k MAU included; plus email and optional VPS). Compute is the main scaling dimension, not user count.
- **Compliance tier:** Supabase Team ($599/mo) adds SOC2/ISO 27001 compliance and longer backups — needed only if the group formally requires certification, not for capacity.
- **The real cost is building, not hosting.** A proper foundation rebuild by a hired developer would be months of work (Dubai market: roughly AED 100k–250k for the foundation phase alone). The strategy this document supports: build incrementally now at near-zero labor cost while following these standards, so that when a developer is appointed they **extend** the system rather than **rebuild** it.
