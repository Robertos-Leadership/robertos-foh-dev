---
name: deploy
description: Ship an FOH App change DEV → LIVE the safe way. Use when Francesco says deploy, push live, ship it, or OK after a DEV link.
disable-model-invocation: true
---
Ship the current change. Stop at the first failure and say what broke in one line.

1. `npm run bump` — cache-bust everything that changed.
2. `npm run precheck` — must pass.
3. Commit with a plain message (what changed, for whom). `git push origin main` (DEV).
4. Wait for the Pages/Actions deploy, then `npm run smoke` (DEV). Must pass.
5. Send Francesco the DEV link https://robertos-foh-dev.pages.dev/ and **wait for his OK**. Stop here unless he already said OK for LIVE.
6. Push the identical files to LIVE: `git push https://github.com/Robertos-Leadership/robertos-foh.git main` (add as remote `live` if missing). If histories differ, copy the changed files onto a fresh clone of LIVE and push — never force-push.
7. Check the Actions run on LIVE is green (a red "in progress deployment" run must be re-run), then `npm run smoke:live`.
8. Confirm DEV and LIVE trees match (`git diff --stat origin/main live/main` is empty). Reply in 2–3 lines: stamp, LIVE link https://robertos-leadership.github.io/robertos-foh/, smoke result.
