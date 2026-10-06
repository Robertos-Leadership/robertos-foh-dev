// mare-transcribe — Cloudflare Worker. Speech to text for Roberto's Mare voice
// notes and meeting recordings, on Cloudflare Workers AI (Whisper large v3 turbo),
// inside the free daily allowance (10,000 neurons/day; 46.63 per audio minute,
// so about 214 minutes a day — Cloudflare pricing page, checked 6 Oct 2026).
// Only the Supabase function mare-minutes calls it, with the shared secret
// MARE_KEY. Body: { audio: <base64>, language?: "en" | "it" | "bs" | …, prompt?: names }.
export default {
  async fetch(req, env) {
    const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (req.method !== "POST") return j({ ok: false, error: "method" }, 405);
    if (!env.MARE_KEY || req.headers.get("x-mare-key") !== env.MARE_KEY) return j({ ok: false, error: "key" }, 401);
    let body; try { body = await req.json(); } catch { return j({ ok: false, error: "body" }, 400); }
    const audio = String(body.audio || "");
    if (!audio || audio.length > 12_000_000) return j({ ok: false, error: "audio" }, 400);
    const input = { audio, task: "transcribe", vad_filter: true };
    if (/^[a-z]{2}$/.test(body.language || "")) input.language = body.language;
    // Names Whisper should expect (dishes, people) — it spells them right when told.
    if (typeof body.prompt === "string" && body.prompt.trim()) input.initial_prompt = body.prompt.slice(0, 900);
    try {
      const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", input);
      return j({ ok: true, text: (r && r.text || "").trim(), words: r && r.word_count || 0 });
    } catch (e) {
      return j({ ok: false, error: "ai", detail: String(e).slice(0, 200) }, 502);
    }
  }
};
