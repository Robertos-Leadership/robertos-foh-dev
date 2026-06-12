# Notification system - COMPLETE (12 Jun 2026)

Live and verified:
- send_due_task_emails() function in Supabase, sender hub@kitchenteam.robertos.ae (verified domain)
- Daily cron 'due-task-emails' at 09:00 UTC = 13:00 Dubai
- Scope: Important + Non-negotiable tasks, due today or overdue, one digest per person
- Once-per-task rule via tasks.due_notified_at (verified: second run sends 0)
- App clears the stamp when a task due date changes (live in index.html)
- team_members table = email directory (7 members; Alper excluded)
- Resend key lives ONLY inside the SQL function - never commit it to this public repo
