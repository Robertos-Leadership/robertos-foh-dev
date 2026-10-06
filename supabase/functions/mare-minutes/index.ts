// ════════════════════════════════════════════════════════════
// mare-minutes — Supabase Edge Function (Leadership Hub project)
// Roberto's Mare weekly meeting: turns the notes, the recording transcripts
// and the actions into minutes, in English AND Montenegrin, and saves them on
// the meeting. Runs as the signed-in manager: both database calls go through
// mare_m_minutes_source / mare_m_minutes_save, which check mare_is_mgr().
// The model only summarises and translates what was said — it adds nothing.
// Secret: ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SIDE = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "points", "decisions", "actions", "unclear"],
  properties: {
    summary: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["topic", "text"],
        properties: { topic: { type: "string" }, text: { type: "string" } },
      },
    },
    decisions: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["what", "who", "when"],
        properties: { what: { type: "string" }, who: { type: "string" }, when: { type: "string" } },
      },
    },
    unclear: { type: "array", items: { type: "string" } },
  },
};
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["en", "me"],
  properties: { en: SIDE, me: SIDE },
};

const SYSTEM = `You write the minutes of the weekly management meeting at Roberto's Mare, an Italian restaurant in Porto Montenegro. The managers speak English, Montenegrin and sometimes Italian.

You are given the typed notes, the transcript of the recording (made by a phone or laptop listening to the room, so words can be wrong, missing or run together, and there are no speaker names), and the actions already written down.

Write the minutes TWICE, with the same content: "en" in plain British English, "me" in Montenegrin (Latin script, ijekavian, e.g. "sjutra", "dvije", "uvijek").

Rules:
- Only what was actually said or written. Never add a fact, a name, a number, a date or a decision that is not in the source. If something is unclear or the transcript is garbled, say so in "unclear" instead of guessing.
- Keep every number, price, time and date exactly as it appears. Do no arithmetic.
- summary: 2–4 short sentences, what the meeting was about and the main outcome.
- points: the subjects discussed, in the order they came up, one short topic title and 1–3 plain sentences each. Group repetition; drop small talk.
- decisions: what was agreed, one line each. Empty if nothing was clearly agreed.
- actions: things someone must do. "who" only if a person was named (use the spelling from the staff list when it clearly matches), otherwise "". "when" only as said ("by Friday", "15 Oct"), otherwise "". Include the actions already written down, without duplicating them.
- Write like a restaurant manager, not a lawyer: short, concrete, no filler.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ ok: false, error: "ANTHROPIC_API_KEY secret not set" }, 500);
    const auth = req.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+/i.test(auth)) return json({ ok: false, error: "Not signed in" }, 401);
    const body = await req.json().catch(() => ({}));
    const id = String(body.meeting_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "No meeting" }, 400);

    // As the caller: the database decides whether this person may do it.
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const src = await sb.rpc("mare_m_minutes_source", { p_id: id });
    if (src.error) return json({ ok: false, error: src.error.message }, 400);
    if (!src.data?.ok) return json({ ok: false, error: src.data?.error || "access" }, 403);
    const s = src.data;
    const m = s.meeting || {};
    const notes = String(m.notes || "").trim();
    const transcripts = (s.transcripts || []).map((t: any) => String(t.text || "").trim()).filter(Boolean);
    if (!notes && !transcripts.length) return json({ ok: false, error: "empty" }, 200);

    const acts = (s.actions || []).map((a: any) =>
      `- ${a.text}${a.owner ? " — " + a.owner : ""}${a.due ? " — by " + a.due : ""}${a.done ? " (done)" : ""}`).join("\n");
    const user =
      `Meeting: ${m.title || "Weekly meeting"} on ${m.date}\n` +
      `Who was there: ${m.attendees || "(not written)"}\n` +
      `Staff list (for spelling names): ${(s.staff || []).join(", ")}\n\n` +
      `TYPED NOTES:\n${notes || "(none)"}\n\n` +
      `ACTIONS ALREADY WRITTEN DOWN:\n${acts || "(none)"}\n\n` +
      transcripts.map((t: string, i: number) => `RECORDING ${i + 1} TRANSCRIPT:\n${t.slice(0, 120000)}`).join("\n\n");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!r.ok) return json({ ok: false, error: "ai", detail: (await r.text()).slice(0, 300) }, 502);
    const j = await r.json();
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let minutes: any;
    try { minutes = JSON.parse(text); } catch { return json({ ok: false, error: "ai", detail: text.slice(0, 200) }, 502); }
    if (!minutes?.en || !minutes?.me) return json({ ok: false, error: "ai" }, 502);
    minutes.source = { notes: !!notes, recordings: transcripts.length };

    const sv = await sb.rpc("mare_m_minutes_save", { p_id: id, p_minutes: minutes });
    if (sv.error || !sv.data?.ok) return json({ ok: false, error: sv.error?.message || sv.data?.error || "save" }, 400);
    return json({ ok: true, minutes });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
