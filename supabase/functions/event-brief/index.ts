// ════════════════════════════════════════════════════════════
// event-brief — Supabase Edge Function (FOH project paoaivwtkzujmrgrfjuq)
// Serves the Event Brief as its own printable web page, so the team can open it
// from the email and print it for the wall. Token-gated by brief_token
// (separate from the guest client_token — the brief shows internal
// costs/contacts, so it must never be reachable from a guest link).
//
//   GET ?t=<brief_token>                →  the saved brief HTML (unchanged).
//   GET ?t=<brief_token>&format=json    →  the DATA the app's own renderer needs.
//
// WHY THERE IS A JSON MODE.
// `brief_html` is written ONCE, when the brief is emailed. Everything after that
// — a changed guest count, a swapped dish, a beverage package dropped — moves the
// booking and never moves the saved page. A chef printing this for the wall was
// therefore printing the booking AS IT WAS ON THE DAY IT WAS SENT, with nothing on
// the paper saying so. Farhan Booso's saved brief still carried an AED 5,925
// beverage package that had already been taken off the booking.
//
// The fix is NOT to re-render the brief in here. The brief is ~500 lines of the
// app's own rendering — peBriefBodyHTML and everything under it — and a second
// copy in Deno would drift from the app the first time a line changed, which is
// the same "mirror of live data" mistake in a new place. So this function stays
// dumb and hands back the DATA; print-brief.html loads the app's real module and
// renders with it. One renderer, and the wall print is current by construction.
//
// The saved HTML is still returned alongside it, and print-brief.html falls back
// to it if anything at all goes wrong — the link can never come back blank.
//
// WHAT IS DELIBERATELY NOT SENT. Columns are listed one by one, never `*`:
// client_token (the guest link), brief_token, contract_snapshot, payment_link and
// brief_html's siblings stay server-side, and the dish/à-la-carte rows carry no
// `cost` — the brief does not print food cost, so this page has no business
// holding it. Only the ONE set menu and the ONE beverage package this booking
// uses are returned, never the library.
//
// Deploy with verify_jwt=false (public, token-gated).
// Uses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected secrets).
// ════════════════════════════════════════════════════════════
const cors = { "Access-Control-Allow-Origin": "*" };

// Everything peBriefBodyHTML and peCalcTotals read off the booking, and nothing
// else. Adding a field here is a deliberate act, which is the point.
const EVENT_COLS = [
  "id", "client_name", "company", "contact_name", "contact_phone", "contact_email",
  "event_date", "event_type", "time_from", "time_to", "area", "spaces",
  "guests", "package_label", "food_price_pp", "set_menu", "off_menu",
  "bev_package_id", "bev_package_id_2", "bev_guests", "bev_guests_2", "bev_mode", "min_spend", "discount", "actual_revenue",
  "pricing_type", "price_display", "dietary", "payment_terms", "status",
  "updated_at", "brief_html",
].join(",");

const DISH_COLS   = "id,name,description,allergens,serve,min_order,sell_price,category,active";
const BEV_COLS    = "id,name,price_pp,duration_hours,includes,pdf,non_alcoholic";
const ALC_COLS    = "id,name,description,allergens,course,active,sort_order";
const ITEM_COLS   = "id,event_id,dish_id,pcs_per_guest,qty_confirmed,comp";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const t = url.searchParams.get("t") || "";
    const wantJson = (url.searchParams.get("format") || "") === "json";

    const page = (body: string, status = 200) =>
      new Response(body, { status, headers: { ...cors, "content-type": "text/html; charset=utf-8" } });
    const json = (obj: unknown, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });

    if (!t) {
      return wantJson
        ? json({ ok: false, why: "no token" }, 404)
        : page("<p style='font-family:Georgia,serif;text-align:center;margin-top:60px'>This link is not valid.</p>", 404);
    }

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const rest = async (path: string) => {
      const r = await fetch(supaUrl + "/rest/v1/" + path,
        { headers: { apikey: svc, Authorization: "Bearer " + svc } });
      const body = await r.json();
      return Array.isArray(body) ? body : [];
    };

    const rows = await rest(
      "events_desk?brief_token=eq." + encodeURIComponent(t) + "&select=" + EVENT_COLS + "&limit=1");
    if (!rows.length) {
      return wantJson
        ? json({ ok: false, why: "unknown token" }, 404)
        : page("<p style='font-family:Georgia,serif;text-align:center;margin-top:60px'>This brief is no longer available.</p>", 404);
    }
    const ev = rows[0] as Record<string, unknown>;

    // ── the page-as-it-was route, unchanged ───────────────────────────────
    if (!wantJson) {
      if (!ev.brief_html) {
        return page("<p style='font-family:Georgia,serif;text-align:center;margin-top:60px'>This brief is no longer available.</p>", 404);
      }
      return page(String(ev.brief_html));
    }

    // ── the data route: this booking only ─────────────────────────────────
    const items = await rest(
      "event_items?event_id=eq." + encodeURIComponent(String(ev.id)) + "&select=" + ITEM_COLS + "&order=id");

    // Only the dishes this booking actually uses — the library is not this
    // page's business, and a brief that names ten canapés should not carry
    // thirty. An empty `in.()` is invalid PostgREST, so ask only when there
    // is something to ask for.
    const dishIds = [...new Set(items.map((i: Record<string, unknown>) => String(i.dish_id)).filter(Boolean))];
    const dishes = dishIds.length
      ? await rest("event_dishes?id=in.(" + dishIds.join(",") + ")&select=" + DISH_COLS)
      : [];

    // Up to two packages (one alcoholic, one alcohol-free); the second only counts beside a first.
    const bevIds = [ev.bev_package_id, ev.bev_package_id ? ev.bev_package_id_2 : null].filter(Boolean).map((x: unknown) => String(x));
    const bevs = bevIds.length
      ? await rest("event_bev_packages?id=in.(" + bevIds.map(encodeURIComponent).join(",") + ")&select=" + BEV_COLS)
      : [];

    // The one menu this booking is on. A customised menu is an ordinary row
    // resolved by the same key, so there is no special case here either.
    const smKey = (ev.set_menu && typeof ev.set_menu === "object")
      ? String((ev.set_menu as Record<string, unknown>).key || "") : "";
    const setMenus = smKey
      ? await rest("event_set_menus?key=eq." + encodeURIComponent(smKey) + "&select=*")
      : [];

    // The printed à la carte is how a set menu that never wrote its own
    // description still gets one (peCmDishInfo). Names and allergens only —
    // this page never prints an à la carte price.
    const alacarte = smKey
      ? await rest("event_alacarte?select=" + ALC_COLS + "&order=sort_order,name")
      : [];

    const briefHtml = ev.brief_html ? String(ev.brief_html) : null;
    delete ev.brief_html;

    return json({
      ok: true,
      event: ev,
      items,
      dishes,
      bevs,
      setMenus,
      alacarte,
      // the fallback, so the page is never blank if the live render fails
      brief_html: briefHtml,
    });
  } catch (e) {
    const msg = "Error: " + String((e as Error)?.message || e).slice(0, 200);
    return new Response(msg, { status: 500, headers: cors });
  }
});
