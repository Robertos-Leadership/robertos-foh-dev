// ═══════════════════════════════════════════════════════════════════════════
// mare-invoice-read — Supabase Edge Function (FOH project), verify_jwt ON.
// Roberto's Mare (6 Nov 2026, Francesco): turn the photo of a supplier invoice into lines
// (item, quantity, unit, unit price, total) when a manager presses "Read the invoice".
//
// It runs AS the caller: the photo is fetched with the caller's own token through
// mare_m_deliv_photo, which only a Mare manager passes. It WRITES NOTHING. The screen saves the
// lines (mare_m_deliv_lines_save) after showing them, and a person checks them.
//
// The reader copies what is PRINTED. It does no arithmetic and never fills a gap: a number it
// cannot read is null. Numbers come back as the printed text ("1.234,50") and the app parses
// them, so a wrong thousands/decimal reading is caught by the app, not hidden by the model.
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY (built in), ANTHROPIC_API_KEY.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const str = { type: ["string", "null"] };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["supplier", "invoice_no", "date_text", "currency", "total_text", "vat_text", "lines", "quality", "unreadable_note"],
  properties: {
    supplier: str, invoice_no: str, date_text: str, currency: str,
    total_text: str,          // the invoice total as printed (the amount to pay)
    vat_text: str,            // the PDV amount as printed, if any
    quality: { type: "string", enum: ["good", "partly_readable", "poor"] },
    unreadable_note: str,     // what could not be read, in one short sentence
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "name", "unit", "qty_text", "unit_price_text", "discount_text", "vat_text", "total_text"],
        properties: { code: str, name: { type: "string" }, unit: str, qty_text: str, unit_price_text: str, discount_text: str, vat_text: str, total_text: str },
      },
    },
  },
};

const SYSTEM = `You read photographs of supplier invoices for a restaurant in Montenegro (Roberto's Mare, Porto Montenegro). The text may be in Montenegrin, Serbian, Croatian, Bosnian, Italian or English, in Latin or Cyrillic script. PDV is the Montenegrin VAT.

Copy what is PRINTED on the invoice, line by line. Rules:
- Never calculate, correct, round or complete anything. If a value is not printed, or you cannot read it with confidence, return null for it.
- Return numbers exactly as printed, as text (for example "1.234,50" or "12,5"). Do not change the separators.
- One entry per invoice line (article). Do not include the totals rows, PDV summary rows, deposit/packaging notes or payment details as lines.
- "name" is the article description as printed. "code" is the supplier's article code or barcode if printed. "unit" is the unit as printed (kg, kom, l, kut ...).
- "total_text" at the top level is the amount to pay for the whole invoice as printed. "vat_text" is the PDV amount if printed.
- If the photo is blurry, cropped, rotated or partly hidden, set quality to "partly_readable" or "poor" and say in one short sentence what could not be read.
- If the image is not an invoice, return no lines, quality "poor", and say so.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return json({ ok: false, error: "auth" }, 401);
    const body = await req.json().catch(() => ({}));
    const id = String(body.delivery_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "delivery" }, 400);

    // the caller's own token: only a Mare manager gets the photo
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: "Bearer " + bearer } }, auth: { persistSession: false },
    });
    const { data, error } = await sb.rpc("mare_m_deliv_photo", { p_id: id });
    if (error || !data || data.ok === false) return json({ ok: false, error: "access" }, 403);
    const photo: string = data.photo || "";
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(photo);
    if (!m) return json({ ok: false, error: "no_photo" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ ok: false, error: "no_key" }, 500);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 6000,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: m[1] } },
            { type: "text", text: "Read this supplier invoice. Copy only what is printed." },
          ],
        }],
      }),
    });
    const out = await r.json();
    if (!r.ok) return json({ ok: false, error: "reader", detail: String(out?.error?.message || r.status).slice(0, 200) }, 502);
    const text = (out.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    let invoice: any;
    try { invoice = JSON.parse(text); } catch { return json({ ok: false, error: "unreadable_reply" }, 502); }
    return json({ ok: true, invoice, usage: out.usage || null });
  } catch (e) {
    return json({ ok: false, error: "server", detail: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
