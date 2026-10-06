// ════════════════════════════════════════════════════════════
// mare-minutes — Supabase Edge Function (Leadership Hub project)
// Roberto's Mare weekly meeting: turns the notes, the recording transcripts
// and the actions into minutes, in English AND Montenegrin, and saves them on
// the meeting. Runs as the signed-in manager: both database calls go through
// mare_m_minutes_source / mare_m_minutes_save, which check mare_is_mgr().
// The model only summarises and translates what was said — it adds nothing.
// Second job (kind: "briefing"): reads what the manager said in a voice note and
// sorts it into the lines of the daily briefing. Nothing is saved: the lines are
// filled on screen and the manager checks them and presses Save.
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

const BRIEF_FIELDS = ["covers_lunch", "covers_dinner", "message", "specials", "eighty_six", "allergies", "vip", "kitchen_note", "foh_note"];
const BRIEF_SCHEMA = {
  type: "object", additionalProperties: false, required: BRIEF_FIELDS,
  properties: Object.fromEntries(BRIEF_FIELDS.map((f) => [f, { type: "string" }])),
};
const BRIEF_SYSTEM = `A manager at Roberto's Mare, an Italian restaurant in Porto Montenegro, recorded the daily staff briefing as a voice note. You get the words the phone heard (they can be wrong, missing or run together) and the lines already written.

Sort what was said into the lines of the briefing:
- covers_lunch, covers_dinner: the number of covers booked, digits only, ONLY if a number was said for that service. Do no arithmetic: if only a total was said, leave both "" and put the total in "message".
- message: the message of the day, anything general for everyone.
- specials: dishes or drinks of the day.
- eighty_six: what is not available today (86).
- allergies: allergies and dietary notes for guests.
- vip: VIPs, groups, birthdays, special bookings, with times and table numbers as said.
- kitchen_note: things only for the kitchen.
- foh_note: things only for the floor and bar.

Rules: only what was said; never invent a dish, a name, a number or a time. Keep numbers and times exactly as said. Short lines, one item per line (use a new line between items). Return ONLY what is new: never repeat something already written in that line. "" for a line nothing new was said about. Leave out greetings and small talk. Write in LANG, Latin letters only (never Cyrillic); in Montenegrin a table is "sto" (sto 12), not "stol".`;

async function claude(key: string, system: string, user: string, schema: unknown, effort: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5", max_tokens: 16000, system,
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error("ai " + r.status + " " + (await r.text()).slice(0, 200));
  const j = await r.json();
  return JSON.parse((j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""));
}

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

    if (body.kind === "briefing") {
      const sbb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      });
      const who = await sbb.rpc("mare_m_managers");   // refuses anyone without Mare access
      if (who.error || !who.data?.ok) return json({ ok: false, error: "access" }, 403);
      const text = String(body.text || "").trim().slice(0, 60000);
      if (!text) return json({ ok: false, error: "empty" }, 200);
      const have = body.have && typeof body.have === "object" ? body.have : {};
      const lang = body.lang === "me" ? "Montenegrin (Latin script, ijekavian)" : "plain British English";
      let fields: any;
      try {
        fields = await claude(key, BRIEF_SYSTEM.replace("LANG", lang),
          "LINES ALREADY WRITTEN:\n" + BRIEF_FIELDS.map((f) => f + ": " + String(have[f] ?? "").slice(0, 2000)).join("\n") +
          "\n\nWHAT THE VOICE NOTE SAID:\n" + text, BRIEF_SCHEMA, "low");
      } catch (e) { return json({ ok: false, error: "ai", detail: String(e).slice(0, 200) }, 502); }
      for (const f of ["covers_lunch", "covers_dinner"]) if (fields[f] && !/^\d{1,4}$/.test(String(fields[f]).trim())) fields[f] = "";
      return json({ ok: true, fields });
    }

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
