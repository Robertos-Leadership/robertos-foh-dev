// ════════════════════════════════════════════════════════════
// event-client-menu — Supabase Edge Function (Leadership Hub project)
// PUBLIC (verify_jwt off). Two modes:
//  · Event mode (?t=token): the guest of a specific event picks dishes;
//    selection saved onto that event for Valentina to review.
//  · Open mode (no token): the standing "full canapé selection" link —
//    any guest picks dishes, leaves name + contact, and a NEW draft event
//    is created for Valentina with the selection attached.
// Exposes NO prices, NO costs. Uses SUPABASE_SERVICE_ROLE_KEY (auto).
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const fmt12 = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  let h = parseInt(m[1], 10); const min = m[2];
  if (h > 23) return null;
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ":" + min + " " + ap;
};
const plus3h = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = (parseInt(m[1], 10) + 3) % 24;
  return fmt12(h + ":" + m[2]);
};
const cleanQty = (raw: unknown, dishIds: string[]) => {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const k of dishIds) {
      const v = parseInt(String((raw as Record<string, unknown>)[k] ?? ""), 10);
      if (v > 0 && v <= 100000) out[k] = v;
    }
  }
  return out;
};
const allowedDishes = (guests: number) => guests >= 30 ? 15 : (guests >= 20 ? 8 : (guests >= 15 ? 5 : 0));

// Who hears about guest submissions the moment they land. This used to be one
// person's address in code; when she left the organisation every guest submission
// was announced to a dead mailbox and nobody knew. The live list is app_users.notify
// ('events_desk'), managed on Admin → Emails, so the desk can change hands without a
// deploy. The fallback is used only if nobody is ticked — an enquiry can never land
// with no one told.
const PE_NOTIFY_FALLBACK = ["kvukotic@robertos.ae"];
const deskList = async (): Promise<string[]> => {
  try {
    const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/rest/v1/app_users?select=email,notify", {
      headers: {
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        Authorization: "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      },
    });
    const rows = await r.json();
    const to = (Array.isArray(rows) ? rows : [])
      .filter((u: { notify?: string[] }) => Array.isArray(u.notify) && u.notify.indexOf("events_desk") !== -1)
      .map((u: { email: string }) => u.email)
      .filter((e: string) => typeof e === "string" && e.includes("@"));
    return to.length ? to : PE_NOTIFY_FALLBACK;
  } catch (_e) { return PE_NOTIFY_FALLBACK; }
};
const NOTIFY_FROM = "Roberto's DIFC Events <reports@kitchenteam.robertos.ae>";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
// Fire-and-forget: a failed notification must never break the guest's submission.
const notifyTeam = async (subject: string, rows: Array<[string, string]>, note: string) => {
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return;
    const html = '<div style="font-family:Georgia,serif;color:#2C1810;max-width:560px">' +
      '<h2 style="color:#400207;font-weight:normal">' + esc(subject) + "</h2>" +
      '<table style="border-collapse:collapse;font-size:14px">' +
      rows.filter((r) => r[1]).map((r) =>
        '<tr><td style="padding:4px 14px 4px 0;color:#8B7355;white-space:nowrap">' + esc(r[0]) + "</td><td style=\"padding:4px 0\"><b>" + esc(r[1]) + "</b></td></tr>"
      ).join("") + "</table>" +
      (note ? '<p style="background:#F7EEE2;border-radius:8px;padding:10px 12px;font-size:13px">&ldquo;' + esc(note) + "&rdquo;</p>" : "") +
      '<p style="font-size:12px;color:#8B7355">Open the FOH app &rarr; Management &rarr; Events — the enquiry is already loaded as a draft menu.</p></div>';
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: NOTIFY_FROM, to: await deskList(), subject, html })
    });
  } catch (_e) { /* never block the guest */ }
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") { try { body = await req.json(); } catch (_e) { /* noop */ } }
    const token = String(url.searchParams.get("t") || body.t || "").slice(0, 64);

    const loadDishes = async () => {
      const dishes = await sb.from("event_dishes")
        .select("id,name,category,serve,description,allergens,sell_price,min_order")
        .eq("active", true).order("category").order("serve").order("name");
      return dishes;
    };

    // ── open mode: the standing full-selection link ──
    if (!token) {
      if (req.method === "GET") {
        const dishes = await loadDishes();
        if (dishes.error) return json({ error: "Could not load the menu" }, 500);
        return json({ mode: "open", dishes: dishes.data });
      }
      if (req.method === "POST") {
        const name = String(body.name || "").trim().slice(0, 120);
        const phone = String(body.phone || "").trim().slice(0, 40);
        const email = String(body.email || "").trim().slice(0, 120);
        const note = String(body.note || "").slice(0, 1000);
        const guests = parseInt(String(body.guests || ""), 10) || 0;
        if (guests < 15) return json({ error: "Canapé events start from 15 guests — please enter at least 15" }, 400);
        const evDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date || "")) ? String(body.event_date) : null;
        if (!evDate) return json({ error: "Please tell us the date of your event" }, 400);
        const today = new Date().toISOString().slice(0, 10);
        if (evDate < today) return json({ error: "Please pick a date in the future" }, 400);
        const startRaw = String(body.time_from || "").slice(0, 5);
        const timeFrom = startRaw ? fmt12(startRaw) : null;
        const timeTo = startRaw ? plus3h(startRaw) : null;
        const dishIds = Array.isArray(body.dish_ids) ? (body.dish_ids as unknown[]).filter((x) => typeof x === "string").slice(0, 40) as string[] : [];
        if (!name) return json({ error: "Please tell us your name" }, 400);
        if (!phone && !email) return json({ error: "Please leave a phone number or email so we can reach you" }, 400);
        if (!dishIds.length) return json({ error: "Pick at least one canapé" }, 400);
        const cap = allowedDishes(guests);
        if (dishIds.length > cap) return json({ error: "With " + guests + " guests you can pick up to " + cap + " different canapés" }, 400);
        const valid = await sb.from("event_dishes").select("id").in("id", dishIds).eq("active", true);
        if (valid.error || (valid.data || []).length !== dishIds.length) return json({ error: "Selection contained unknown dishes" }, 400);
        const sel = { dish_ids: dishIds, quantities: cleanQty(body.quantities, dishIds), note, submitted_at: new Date().toISOString() };
        const ins = await sb.from("events_desk").insert({
          venue_id: "robertos-difc", status: "draft",
          client_name: name, contact_phone: phone || null, contact_email: email || null,
          guests, event_date: evDate, time_from: timeFrom, time_to: timeTo,
          client_selection: sel, updated_by: "guest-link",
          payment_terms: "50% deposit to confirm, balance on the day"
        }).select("id").single();
        if (ins.error || !ins.data) return json({ error: "Could not save — please try again" }, 500);
        // guest picks ARE the menu draft: load them as event items with their quantities
        const items = dishIds.map((d) => ({
          event_id: ins.data.id, dish_id: d,
          pcs_per_guest: sel.quantities[d] && guests ? Math.round(sel.quantities[d] / guests * 100) / 100 : 1
        }));
        await sb.from("event_items").insert(items);
        await sb.from("event_log").insert({
          event_id: ins.data.id, action: "created",
          detail: "guest enquiry from the open selection link · " + dishIds.length + " dishes picked", actor: "guest-link"
        });
        await notifyTeam(
          "New event enquiry — " + name + (evDate ? " · " + evDate : ""),
          [["Name", name], ["Date", evDate || ""], ["Time", timeFrom ? timeFrom + (timeTo ? " – " + timeTo : "") : ""],
           ["Guests", String(guests)], ["Canapés picked", String(dishIds.length)],
           ["Phone", phone], ["Email", email]],
          note
        );
        return json({ ok: true });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    // ── event mode: token-gated, as before ──
    if (!/^[a-f0-9]{16,64}$/.test(token)) return json({ error: "Invalid link" }, 400);
    const ev = await sb.from("events_desk")
      .select("id,client_name,company,event_date,time_from,time_to,area,guests,status,client_selection,fee_included")
      .eq("client_token", token).limit(1);
    if (ev.error || !ev.data || !ev.data.length) return json({ error: "This link is no longer available" }, 404);
    const row = ev.data[0];
    if (!["draft", "sent"].includes(row.status)) return json({ error: "Selections for this event are closed — please contact Roberto's" }, 410);

    if (req.method === "GET") {
      const dishes = await loadDishes();
      if (dishes.error) return json({ error: "Could not load the menu" }, 500);
      const items = await sb.from("event_items").select("dish_id").eq("event_id", row.id);
      return json({
        mode: "event",
        event: {
          client_name: row.client_name, company: row.company, event_date: row.event_date,
          time_from: row.time_from, time_to: row.time_to, area: row.area, guests: row.guests,
          fee_included: row.fee_included === true
        },
        dishes: dishes.data,
        preselected: (items.data || []).map((i) => i.dish_id),
        selection: row.client_selection || null
      });
    }

    if (req.method === "POST") {
      const dishIds = Array.isArray(body.dish_ids) ? (body.dish_ids as unknown[]).filter((x) => typeof x === "string").slice(0, 40) as string[] : [];
      const note = String(body.note || "").slice(0, 1000);
      if (!dishIds.length) return json({ error: "Pick at least one canapé" }, 400);
      const evGuests = parseInt(String(body.guests || ""), 10) || Number(row.guests) || 0;
      if (evGuests >= 15) {
        const cap = allowedDishes(evGuests);
        if (dishIds.length > cap) return json({ error: "With " + evGuests + " guests you can pick up to " + cap + " different canapés" }, 400);
      }
      const valid = await sb.from("event_dishes").select("id").in("id", dishIds).eq("active", true);
      if (valid.error || (valid.data || []).length !== dishIds.length) return json({ error: "Selection contained unknown dishes" }, 400);
      const sel = { dish_ids: dishIds, quantities: cleanQty(body.quantities, dishIds), note, submitted_at: new Date().toISOString() };
      const up = await sb.from("events_desk").update({ client_selection: sel, updated_at: new Date().toISOString() }).eq("id", row.id);
      if (up.error) return json({ error: "Could not save — please try again" }, 500);
      const existing = await sb.from("event_items").select("id").eq("event_id", row.id).limit(1);
      if (!existing.error && (existing.data || []).length === 0) {
        const g = Number(row.guests) || 0;
        await sb.from("event_items").insert(dishIds.map((d) => ({
          event_id: row.id, dish_id: d,
          pcs_per_guest: sel.quantities[d] && g ? Math.round(sel.quantities[d] / g * 100) / 100 : 1
        })));
      }
      await sb.from("event_log").insert({
        event_id: row.id, action: "client_selection",
        detail: dishIds.length + " dishes picked by the client" + (note ? " · note left" : ""), actor: "client-link"
      });
      await notifyTeam(
        "Client selection received — " + (row.client_name || row.company || "event") + (row.event_date ? " · " + row.event_date : ""),
        [["Event", row.client_name || row.company || ""], ["Date", String(row.event_date || "")],
         ["Guests", String(row.guests || "")], ["Canapés picked", String(dishIds.length)]],
        note
      );
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
