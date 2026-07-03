-- Events module — printable team brief (additive only, safe to re-run).
-- Run in the FOH project (paoaivwtkzujmrgrfjuq) SQL editor.

-- A separate token (NOT the guest client_token) so the internal brief — which
-- shows costs, contacts and payment terms — is never reachable from a guest link.
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS brief_token text;
-- The exact branded brief that was emailed, saved so the team can reopen & print it.
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS brief_html text;

NOTIFY pgrst, 'reload schema';
