# FOH App — rules for Claude

Owner: Francesco (Group Exec Chef). Busy. Replies in 2–3 short lines, plain English, clickable links.

## Stack
Vanilla HTML/JS, no build step. Supabase `paoaivwtkzujmrgrfjuq` (FOH data) — also READS covers/attendance from Kitchen project `zrpglswalgjbtghudmhu`.
- DEV = this repo (Robertos-Leadership/robertos-foh-dev) → https://robertos-foh-dev.pages.dev/
- LIVE = Robertos-Leadership/robertos-foh → https://robertos-leadership.github.io/robertos-foh/
- Push to `main` = deploy (.github/workflows/deploy.yml). A push is not a deploy until the served bytes match — check the site, not git.
- Background: HANDOVER.md, ARCHITECTURE.md (§4 bug patterns).

## Rules
- Read the current file before editing. Never rebuild a file from memory.
- UI change → show a mockup first, wait for OK.
- Change DEV only. LIVE only after Francesco says OK, via `/deploy`. LIVE and DEV must be byte-identical after.
- IMPORTANT: SQL is additive only (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, then `NOTIFY pgrst, 'reload schema'`). No DELETE/TRUNCATE/DROP without his written OK. These house rules beat the Supabase skills if they ever disagree.
- Dubai is UTC+4. Never use `toISOString()` for "today".
- Reuse brand tokens (`--vino`, `--sabbia`, `--gold`). No secrets in client code.

## Commands
- `npm run setup` — once per machine (Playwright).
- `npm run bump` — cache-bust every changed file (?v= in every page + sw.js CACHE). Run before every push.
- `npm run precheck` — syntax + `node tests.js` + cache-bust check. Runs automatically before any push (hook); a failed check blocks the push.
- `npm run smoke` — opens every home tile and linked page on DEV, read-only. `npm run smoke:live` after LIVE.

## Done means
Show evidence, not "done": precheck output + smoke result + the link.
