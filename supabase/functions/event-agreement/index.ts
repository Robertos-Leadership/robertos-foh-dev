// ════════════════════════════════════════════════════════════
// event-agreement — Supabase Edge Function (FOH project paoaivwtkzujmrgrfjuq)
// The guest side of the event agreement: one token link where the client reads
// the proposal (menu + beverage + one all-inclusive figure), the agreement with
// their numbers filled in, and signs electronically (typed name + tick).
//
//   GET  ?t=<client_token>              → proposal + terms + signed state
//   POST {t, action:'sign', name, designation}
//        → freezes a snapshot of exactly what was signed, stamps signed_at,
//          flips draft/sent → confirmed, logs it, emails a copy to the guest
//          and to the events desk. Idempotent: a second sign returns 409.
//
// Wording rule (Francesco, 3 Jul 2026): ALL prices inclusive of 5% VAT,
// 7% DIFC authority fee and 10% service charge — everywhere.
// CHANGED from Wed 16 Sep 2026 (approved price list, Aung / Justin): a price
// carries 10% service and 5% VAT only, and the 7% DIFC Authority Fee is added
// on top. Francesco, 14 Sep 2026: event quotes follow the menu. The rule below
// MUST stay identical to peFeeApplies in foh-privateevents.js.
//
// Deploy with verify_jwt=false (public, token-gated like event-client-menu).
// Secrets used: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto), RESEND_API_KEY.
// ════════════════════════════════════════════════════════════
const FROM = "Roberto's DIFC Events <reports@kitchenteam.robertos.ae>";
// Who hears that a guest signed, and who the guest's reply reaches. This used to be
// one person's address in code; when she left the organisation every signed agreement
// alert and every guest reply went to a dead mailbox with nobody the wiser. The live
// list is now app_users.notify ('events_desk'), managed on Admin → Emails, so the desk
// can change hands without a deploy. FALLBACK is used only if nobody is ticked, so a
// signature can never be announced to no one.
const NOTIFY_FALLBACK = ["kvukotic@robertos.ae"];
// deno-lint-ignore no-explicit-any
async function deskList(sb: any): Promise<string[]> {
  try {
    const r = await sb("app_users?select=email,notify");
    const rows = await r.json();
    const to = (Array.isArray(rows) ? rows : [])
      .filter((u: { notify?: string[] }) => Array.isArray(u.notify) && u.notify.indexOf("events_desk") !== -1)
      .map((u: { email: string }) => u.email)
      .filter((e: string) => typeof e === "string" && e.includes("@"));
    return to.length ? to : NOTIFY_FALLBACK;
  } catch { return NOTIFY_FALLBACK; }
}
const FEE_FROM = "2026-09-16";
const MENU_DIV = 1.155, BILL_DIV = 1.225;
const FEE_KEEP_INCLUSIVE = ["bfaf6ab0-69ea-4ac0-846a-2dab6245d3fe"]; // deposit taken on the all-inclusive minimum
const NOTE_NEW = "All prices are in AED and inclusive of 10% service charge and 5% VAT, subject to an additional 7% DIFC Authority Fee.";
const NOTE_OLD = "All prices are in AED, inclusive of 5% VAT, 7% DIFC authority fee and 10% service charge.";
// deno-lint-ignore no-explicit-any
function feeApplies(ev: any): boolean {
  if (ev.id && FEE_KEEP_INCLUSIVE.indexOf(ev.id) >= 0) return false;
  if (ev.signed_at && String(ev.signed_at).slice(0, 10) < FEE_FROM) return false;
  if (ev.event_date && String(ev.event_date).slice(0, 10) < FEE_FROM) return false;
  return true;
}
// deno-lint-ignore no-explicit-any
function feeOn(ev: any, amt: number | null): number | null {
  if (amt == null) return null;
  if (!feeApplies(ev)) return 0;
  const a = Math.round(Number(amt));
  return Math.round(a * BILL_DIV / MENU_DIV) - a;
}
const BANK = { name: "Roberto's Club LTD", bank: "Commercial Bank of Dubai", iban: "AE830230000001002196200", swift: "CBDUAEADXXX" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function money(n: unknown): string {
  const v = Number(n);
  return isNaN(v) ? "—" : Math.round(v).toLocaleString("en-US");
}
function dLabel(ds: unknown): string {
  if (!ds) return "—";
  const d = new Date(String(ds).slice(0, 10) + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// deno-lint-ignore no-explicit-any
function calcTotals(ev: any, items: any[], dishById: Record<string, any>, bev: any) {
  let foodComputed = 0;
  for (const it of items) {
    const d = dishById[it.dish_id];
    // A dish "on the house" is prepared but NOT charged — leave it out of the total.
    if (d && !it.comp) foodComputed += (Number(d.sell_price) || 0) * (Number(it.pcs_per_guest) || 0);
  }
  const foodPP = (ev.food_price_pp != null && ev.food_price_pp !== "") ? Number(ev.food_price_pp) : (foodComputed || 0);
  const bevPP = bev ? Number(bev.price_pp) || 0 : 0;
  const subtotal = ev.guests ? Math.round((foodPP + bevPP) * Number(ev.guests)) : null;
  // A courtesy discount comes off the very end, never below 0.
  const discount = subtotal != null ? Math.min(Math.max(0, Number(ev.discount) || 0), subtotal) : Math.max(0, Number(ev.discount) || 0);
  const total = subtotal != null ? Math.max(0, subtotal - discount) : null;
  return { foodPP, bevPP, subtotal, discount, total };
}

// deno-lint-ignore no-explicit-any
function agreementNumbers(ev: any, totals: { total: number | null; discount?: number }) {
  const pricingType = ev.pricing_type === "min_spend" ? "min_spend" : "set_price";
  const disc = Math.max(0, Number(ev.discount) || 0);
  // set_price total is already discounted in calcTotals; min_spend is discounted here.
  const quoted = pricingType === "min_spend"
    ? (Number(ev.min_spend) ? Math.max(0, Number(ev.min_spend) - disc) : null)
    : totals.total;
  const pct = ev.deposit_pct == null ? 50 : Number(ev.deposit_pct);
  const fee = feeOn(ev, quoted);
  const payable = quoted != null ? (fee ? Math.round(quoted) + fee : quoted) : null;
  const deposit = payable != null && pct > 0 ? Math.round(payable * pct / 100) : 0;
  const guestsMin = ev.guests_min || ev.guests || null;
  const discount = totals.discount != null ? totals.discount : disc;
  return { pricingType, quoted, pct, deposit, guestsMin, discount, fee, payable };
}

// The agreement terms with the event's numbers filled in. This is the ONE
// place the wording lives — the guest page shows it, and the signed snapshot
// stores this exact HTML, so what was read is what was signed.
// deno-lint-ignore no-explicit-any
function termsHtml(ev: any, bev: any, totals: { total: number | null; discount?: number }): string {
  const n = agreementNumbers(ev, totals);
  const priceClause = n.fee
    ? "<b>All quoted prices are inclusive of 10% service charge and 5% VAT. A 7% DIFC Authority Fee of AED " + money(n.fee) +
      " is added, making AED " + money(n.payable) + " payable.</b>"
    : feeApplies(ev)
      ? "<b>All quoted prices are inclusive of 10% service charge and 5% VAT, subject to an additional 7% DIFC Authority Fee.</b>"
      : "<b>All quoted prices are inclusive of 5% VAT, 7% DIFC authority fee and 10% service charge.</b>";
  const sec = (t: string, body: string) =>
    '<div style="margin-top:16px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7A8B4A">' + t + "</div>" +
    '<div style="font-size:13px;line-height:1.65;color:#3A2A1E;margin-top:3px">' + body + "</div></div>";

  const quotedClause = n.pricingType === "min_spend"
    ? "A minimum spend of <b>AED " + money(n.quoted) + "</b> applies to this reservation, on food and beverage consumption as per the agreed menus" +
      (n.guestsMin ? " for a minimum guarantee of <b>" + esc(n.guestsMin) + " guests</b>" : "") +
      ". Should consumption fall below this amount, the difference is charged as a venue fee. " +
      "Additional guests or amendments must be notified in writing at least 48 hours prior to the event, subject to approval and availability. " +
      priceClause
    : "Food and beverage of <b>AED " + money(n.quoted) + "</b> for a minimum guarantee of <b>" + esc(n.guestsMin || "—") + " guests</b>. " +
      "Additional guests or amendments must be notified in writing at least 48 hours prior to the event, subject to approval and availability. " +
      "Additional guests will be charged at the same per-guest rate with prior intimation and confirmation. " +
      priceClause;

  const courtesy = n.discount > 0
    ? " This price already includes a courtesy of AED " + money(n.discount) + "."
    : "";

  const depositClause = n.pct > 0
    ? "The client undertakes to pay a <b>" + n.pct + "% prepayment of AED " + money(n.deposit) + "</b> prior to the reservation date. " +
      "A booking becomes confirmed on receipt of this signed agreement and once the deposit is received. " +
      "When a provisional booking is made, it should be confirmed within 7 days by signing this agreement. " +
      "Final confirmation of the number of guests is to be notified in writing 48 hours prior to the event; the quoted amount is based on the minimum guarantee, and additional guests are charged per guest over and above it."
    : "No advance deposit is required for this reservation. The booking becomes confirmed on receipt of this signed agreement. " +
      "Final confirmation of the number of guests is to be notified in writing 48 hours prior to the event; the quoted amount is based on the minimum guarantee, and additional guests are charged per guest over and above it.";

  return (
    sec("The agreement",
      "This agreement is between Roberto&rsquo;s Club LTD, a licensed Italian fine dining restaurant located at Gate Village No. 1, Dubai International Financial Centre (&ldquo;DIFC&rdquo;), and you, the Client. Modifications to this agreement are only valid if documented in writing and agreed to by Roberto&rsquo;s.") +
    sec("Quoted price", quotedClause + courtesy) +
    sec("Additional items",
      "Additional items such as special cakes, flower arrangements or tobacco will be charged accordingly." +
      (ev.agreement_remarks ? "<br><b>Agreed for this event:</b> " + esc(ev.agreement_remarks) : "")) +
    sec("Booking &amp; deposit", depositClause) +
    sec("Payment",
      (ev.payment_link
        ? "Once this agreement is signed, we will send you a secure payment link to settle the deposit by card. "
        : "Once this agreement is signed, our events team will contact you to arrange the deposit. ") +
      "The remaining balance, including any additional items consumed, is settled on the date of the event by cash or credit card. Special payment arrangements require the approval of the Chief Financial Officer.<br>" +
      "Bank transfers may also be made to: <b>" + BANK.name + "</b> · " + BANK.bank + " · IBAN " + BANK.iban + " · SWIFT " + BANK.swift +
      " · Reference: the name under which the reservation is made.") +
    sec("Unauthorized extras",
      "Unless instructed in writing, the Client is liable for all charges and services incurred by the Client or attendees during the event, including any bar service not included in the agreed menus.") +
    sec("Cancellation policy",
      "All cancellations must be received in writing. Refunds of advance deposits: <b>100%</b> more than 7 days prior · <b>50%</b> within 3–6 days prior · <b>no refund</b> less than 48 hours prior.") +
    sec("No-show policy",
      "Should fewer guests arrive than the minimum guarantee, the reservation is charged as per the agreed menus and beverage package for the guaranteed number.") +
    sec("Conduct &amp; age policy",
      "The Client will conduct the event in an orderly manner, complying with all applicable laws and any directives of Roberto&rsquo;s staff, including liquor licensing requirements. No alcohol or tobacco is served to any person under 21; identification may be requested. Guests under 12 are welcome in the fine dining area (non-smoking) until 8:00 pm and are not permitted in lounge, bar or smoking areas.") +
    sec("Dress code",
      "Smart and stylish: gentlemen in full-length trousers or elegant jeans and closed shoes — no shorts, trainers, flip-flops or caps. National dress is welcomed. Roberto&rsquo;s reserves the right to refuse entry to anybody not dressed appropriately.") +
    sec("Valet parking",
      "Valet parking is available; the first 3 hours are complimentary — please have your ticket validated by a member of the team.")
  );
}

// The full signed document (booking summary + menu + terms + signature) —
// stored as the frozen snapshot and emailed to both sides.
// deno-lint-ignore no-explicit-any
function signedDocHtml(ev: any, items: any[], dishById: Record<string, any>, bev: any,
  totals: { foodPP: number; bevPP: number; total: number | null; discount?: number },
  signed: { name: string; designation: string; at: string }): string {
  const n = agreementNumbers(ev, totals);
  const row = (l: string, v: string) =>
    '<tr><td style="padding:5px 8px;border:1px solid #E3D5C2;width:34%;color:#8B7355;font-size:10.5px;text-transform:uppercase;letter-spacing:1px">' + l + "</td>" +
    '<td style="padding:5px 8px;border:1px solid #E3D5C2;font-size:12.5px">' + (v || "—") + "</td></tr>";
  const groups: Record<string, string[]> = { Cold: [], Hot: [], Dessert: [] };
  for (const it of items) {
    const d = dishById[it.dish_id];
    if (d && groups[d.serve]) groups[d.serve].push(esc(d.name));
  }
  const menuLines = (["Cold", "Hot", "Dessert"] as const)
    .filter((g) => groups[g].length)
    .map((g) => "<b>" + (g === "Dessert" ? "Dolci" : g) + ":</b> " + groups[g].join(" · "))
    .join("<br>");
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Roberto&rsquo;s — Signed Event Agreement</title></head>' +
    '<body style="font-family:Georgia,\'Times New Roman\',serif;color:#2C1810;max-width:720px;margin:0 auto;padding:24px">' +
    '<div style="font-size:22px;letter-spacing:7px;color:#400207;text-align:center;margin:6px 0 2px">R O B E R T O &rsquo; S</div>' +
    '<div style="width:70px;height:1px;background:#C9A84C;margin:10px auto"></div>' +
    '<h2 style="font-size:16px;letter-spacing:2px;color:#7A8B4A;text-align:center;font-weight:normal;text-transform:uppercase">Group Event Agreement</h2>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:12px">' +
    row("Booking name", esc(ev.client_name)) + row("Company", esc(ev.company)) +
    row("Contact", esc([ev.contact_name, ev.contact_phone, ev.contact_email].filter(Boolean).join(" · "))) +
    row("Event type", esc(ev.event_type)) + row("Event date", dLabel(ev.event_date)) +
    row("Timing", esc([ev.time_from, ev.time_to].filter(Boolean).join(" – "))) +
    row("Area", esc(ev.area)) +
    row("Guests reserved for", esc(ev.guests)) + row("Minimum guaranteed guests", esc(n.guestsMin)) +
    row("Food", esc(ev.package_label || (items.length ? "Canapé selection" : ""))) +
    row("Beverage", bev ? esc(bev.name) + (bev.duration_hours ? " — " + bev.duration_hours + " hours" : "") : (ev.bev_mode === "dry" ? "Dry event — no alcohol served (soft drinks &amp; water)" : "—")) +
    row(n.pricingType === "min_spend" ? "Minimum spend" : "Quoted price",
      n.quoted != null ? "AED " + money(n.quoted) + (n.discount > 0 ? " — includes a courtesy of AED " + money(n.discount) : "") +
        (n.fee ? " — inclusive of service and VAT, plus 7% DIFC Authority Fee AED " + money(n.fee) + " = AED " + money(n.payable) + " payable" : " — inclusive of all taxes and service") : "—") +
    row("Deposit", n.pct > 0 ? n.pct + "% — AED " + money(n.deposit) : "None — balance on the day") +
    row("Remarks", esc(ev.agreement_remarks)) +
    "</table>" +
    (menuLines ? '<div style="font-size:12.5px;line-height:1.7;margin-top:12px">' + menuLines + "</div>" : "") +
    termsHtml(ev, bev, totals) +
    '<div style="margin-top:22px;border-top:1px solid #C9A84C;padding-top:12px;font-size:13px">' +
    "<b>Signed electronically by:</b> " + esc(signed.name) +
    (signed.designation ? " — " + esc(signed.designation) : "") +
    "<br>Date &amp; time: " + esc(signed.at) + " (Dubai)" +
    '<br><span style="font-size:11px;color:#8B7355">I have read and understood the General Terms &amp; Conditions of Special Event Reservations at Roberto&rsquo;s.</span></div>' +
    '<div style="text-align:center;font-size:9.5px;color:#A5876B;margin-top:30px;line-height:1.7">Roberto&rsquo;s Club LTD · Gate Village No. 1, DIFC, Dubai · ' + (feeApplies(ev) ? NOTE_NEW : NOTE_OLD) + '</div>' +
    "</body></html>";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const url = new URL(req.url);
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = (path: string, init?: RequestInit) =>
      fetch(supaUrl + "/rest/v1/" + path, {
        ...init,
        headers: { apikey: svcKey, Authorization: "Bearer " + svcKey, "Content-Type": "application/json", Prefer: "return=representation", ...(init?.headers || {}) },
      });

    let token = url.searchParams.get("t") || "";
    // deno-lint-ignore no-explicit-any
    let body: any = null;
    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
      token = body.t || token;
    }
    if (!token) return json({ error: "This link is not valid." }, 404);

    const evR = await sb("events_desk?client_token=eq." + encodeURIComponent(token) + "&select=*&limit=1");
    const evs = await evR.json();
    if (!Array.isArray(evs) || !evs.length) return json({ error: "This link is no longer available." }, 404);
    const ev = evs[0];

    const [itR, dR] = await Promise.all([
      sb("event_items?event_id=eq." + ev.id + "&select=dish_id,pcs_per_guest,comp"),
      sb("event_dishes?select=id,name,description,allergens,serve,sell_price"),
    ]);
    const items = await itR.json();
    // deno-lint-ignore no-explicit-any
    const dishById: Record<string, any> = {};
    for (const d of await dR.json()) dishById[d.id] = d;
    let bev = null;
    if (ev.bev_package_id) {
      const bR = await sb("event_bev_packages?id=eq." + ev.bev_package_id + "&select=id,name,duration_hours,price_pp,includes&limit=1");
      const bs = await bR.json();
      bev = Array.isArray(bs) && bs.length ? bs[0] : null;
    }
    // A set-menu booking carries its food in events_desk.set_menu, NOT in
    // event_items — every set-menu event in the database has zero items. This
    // function only ever read event_items, so those clients were being shown an
    // agreement with no food on it at all, and one has already been sent.
    // deno-lint-ignore no-explicit-any
    let setMenu: any = null;
    if (ev.set_menu && ev.set_menu.key) {
      const smR = await sb("event_set_menus?key=eq." + encodeURIComponent(ev.set_menu.key) + "&select=key,name,courses&limit=1");
      const sms = await smR.json();
      const sm = Array.isArray(sms) && sms.length ? sms[0] : null;
      if (sm) {
        setMenu = {
          name: ev.package_label || sm.name,
          courses: Array.isArray(sm.courses) ? sm.courses : [],
          // What the guest chose per course, when they have already told us.
          choices: (ev.set_menu && ev.set_menu.choices) || null,
        };
      }
    }
    const totals = calcTotals(ev, items, dishById, bev);
    const nums = agreementNumbers(ev, totals);

    if (req.method === "GET") {
      const menu = (Array.isArray(items) ? items : []).map((it: { dish_id: string }) => dishById[it.dish_id])
        .filter(Boolean)
        .map((d: { name: string; description: string; allergens: string[]; serve: string }) =>
          ({ name: d.name, description: d.description, allergens: d.allergens, serve: d.serve }));
      return json({
        event: {
          client_name: ev.client_name, company: ev.company, event_type: ev.event_type,
          event_date: ev.event_date, time_from: ev.time_from, time_to: ev.time_to,
          area: ev.area, guests: ev.guests, guests_min: nums.guestsMin,
          package_label: ev.package_label, bev_mode: ev.bev_mode || null,
        },
        menu,
        setMenu,
        bev: bev ? { name: bev.name, duration_hours: bev.duration_hours, includes: bev.includes } : null,
        quoted: nums.quoted, pricing_type: nums.pricingType, deposit_pct: nums.pct, deposit: nums.deposit,
        fee: nums.fee || 0, payable: nums.payable, price_note: feeApplies(ev) ? NOTE_NEW : NOTE_OLD,
        termsHtml: termsHtml(ev, bev, totals),
        signed: ev.signed_at ? { at: ev.signed_at, name: ev.signed_name, designation: ev.signed_designation } : null,
        // Once signed, the client must see the document they actually signed — not a
        // fresh render of the current row. Every field above (beverage, quoted, deposit,
        // terms) is rebuilt live, so a later edit on the events desk would otherwise
        // change what sits under their signature. contract_snapshot is frozen at the
        // moment of signing; hand it back and let the page render that instead.
        signed_doc: ev.signed_at ? (ev.contract_snapshot || null) : null,
      });
    }

    // POST — sign
    if (!body || body.action !== "sign") return json({ error: "Unknown action." }, 400);
    if (ev.signed_at) return json({ error: "This agreement is already signed.", signed: { at: ev.signed_at, name: ev.signed_name } }, 409);
    const name = String(body.name || "").trim();
    const designation = String(body.designation || "").trim();
    if (name.length < 3) return json({ error: "Please type your full name to sign." }, 400);
    if (nums.quoted == null) return json({ error: "This agreement is not ready yet — please contact the events desk." }, 400);

    const signedAtISO = new Date().toISOString();
    const dubai = new Date(Date.now() + 4 * 3600 * 1000);
    const signedLabel = dubai.toISOString().slice(0, 10) + " " + dubai.toISOString().slice(11, 16);
    const doc = signedDocHtml(ev, items, dishById, bev, totals, { name, designation, at: signedLabel });

    const newStatus = (ev.status === "draft" || ev.status === "sent") ? "confirmed" : ev.status;
    const patchR = await sb("events_desk?id=eq." + ev.id + "&signed_at=is.null", {
      method: "PATCH",
      body: JSON.stringify({
        signed_at: signedAtISO, signed_name: name, signed_designation: designation || null,
        contract_snapshot: doc, status: newStatus, updated_at: signedAtISO,
      }),
    });
    const patched = await patchR.json();
    if (!Array.isArray(patched) || !patched.length) return json({ error: "This agreement is already signed." }, 409);

    await sb("event_log", {
      method: "POST",
      body: JSON.stringify({
        event_id: ev.id, action: "signed",
        detail: "agreement signed by " + name + (designation ? " (" + designation + ")" : "") +
          " · " + (nums.pricingType === "min_spend" ? "min spend" : "set price") + " AED " + money(nums.quoted) +
          (nums.pct > 0 ? " · deposit " + nums.pct + "% AED " + money(nums.deposit) : " · no deposit"),
        actor: "client via agreement link",
      }),
    });

    // Copies to the guest and the events desk — fire-and-forget so an email
    // hiccup can never break the guest's signing.
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const desk = await deskList(sb);
      const send = (to: string[], subject: string) =>
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM, to, reply_to: desk.join(", "), subject, html: doc }),
        }).catch(() => {});
      if (ev.contact_email) send([ev.contact_email], "Your signed agreement — Roberto's · " + (ev.event_date ? String(ev.event_date).slice(0, 10) : ""));
      send(desk, "SIGNED ✓ " + (ev.client_name || "event") + " · " + (ev.event_date ? String(ev.event_date).slice(0, 10) : "") + " — agreement signed by " + name);
    }

    // Hand back the frozen document too, so the page switches straight to it and the
    // client never sees a live re-render — same rule as the GET above.
    return json({ ok: true, signed: { at: signedAtISO, name, designation }, signed_doc: doc });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
