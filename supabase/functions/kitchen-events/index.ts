// ════════════════════════════════════════════════════════════
// kitchen-events — Supabase Edge Function (FOH project paoaivwtkzujmrgrfjuq)
// Feeds the KITCHEN app's on-screen "events" strip. Returns EVERY confirmed
// FOH event whose team brief has been sent, from today onward (the kitchen app
// groups them this-week / next-2-weeks / later and caps the display). Kitchen-
// safe fields ONLY — event name, date, time, area, guests, dietary, and the menu
// with quantities. NEVER prices, contact, or payment.
//
// Handles BOTH canapé menus (event_items) AND plated set menus (event.set_menu,
// courses mirrored from the FOH PE_SET_MENUS). Beverage-only events are flagged.
//
// GET (header x-proxy-secret: Kitchen), optional ?days=N caps the horizon.
// Deploy with verify_jwt=false. Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto).
// ════════════════════════════════════════════════════════════
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-proxy-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const SERVE_ORDER: Record<string, number> = { Cold: 0, Hot: 1, Dessert: 2 };
// NOTE: this function stays ASCII-only in its OUTPUT literals — a non-ASCII
// literal (·, accents, curly quotes) gets double-encoded by the deploy upload.
// So all display formatting + the plated set-menu course names live in the
// KITCHEN APP; set-menu events just pass through ev.set_menu {key, choices}.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  // Secret lives in the function env (KITCHEN_PROXY_SECRET); the literal
  // fallback keeps old cached kitchen builds working until the env is set,
  // after which only the real value is accepted.
  const SECRET = Deno.env.get("KITCHEN_PROXY_SECRET") || "Kitchen";
  if ((req.headers.get("x-proxy-secret") || "") !== SECRET) return json({ error: "Forbidden" }, 403);

  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = (path: string) =>
      fetch(supaUrl + "/rest/v1/" + path, { headers: { apikey: svcKey, Authorization: "Bearer " + svcKey } });

    const url = new URL(req.url);
    const nowD = new Date(Date.now() + 4 * 3600 * 1000); // Dubai (UTC+4)
    const today = nowD.toISOString().slice(0, 10);
    // Show EVERY briefed event from today onward. Optional ?days=N caps the horizon.
    const days = parseInt(url.searchParams.get("days") || "", 10);
    let dateFilter = "&event_date=gte." + today;
    if (days >= 1 && days <= 3650) {
      dateFilter += "&event_date=lte." + new Date(nowD.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
    }

    const evR = await sb(
      "events_desk?status=in.(confirmed,deposit)" + dateFilter +
      "&select=id,client_name,event_date,time_from,time_to,area,guests,dietary,set_menu,bev_package_id,bev_mode" +
      "&order=event_date.asc&limit=200",
    );
    const evsAll = await evR.json();
    if (!Array.isArray(evsAll) || !evsAll.length) return json({ today, count: 0, events: [] });

    // "Brief sent" = the send was LOGGED, which only happens after the email
    // actually leaves. Previously this filtered on brief_token, but that is
    // written BEFORE the send, so a brief whose email failed still looked sent.
    // FOH's "Team brief sent" chip reads the same log — both apps, one meaning.
    // Matched in JS, not a PostgREST "like" filter: the pattern contains a space,
    // and a mis-encoded filter would silently return NOTHING - which here means a
    // blank kitchen screen on a night with confirmed events. Row count is tiny.
    const allIds = evsAll.map((e: { id: string }) => e.id);
    const lgR = await sb(
      "event_log?event_id=in.(" + allIds.join(",") + ")&action=eq.email&select=event_id,detail",
    );
    const lg = await lgR.json();
    if (!Array.isArray(lg)) throw new Error("could not read the brief send log");
    const briefed = new Set(
      lg.filter((l: { detail: string }) => String(l.detail || "").startsWith("event brief"))
        .map((l: { event_id: string }) => l.event_id),
    );
    const evs = evsAll.filter((e: { id: string }) => briefed.has(e.id));
    if (!evs.length) return json({ today, count: 0, events: [] });

    const ids = evs.map((e: { id: string }) => e.id);
    const itR = await sb("event_items?event_id=in.(" + ids.join(",") + ")&select=event_id,dish_id,pcs_per_guest,comp,qty_confirmed");
    const items = await itR.json();
    // Only fetch the dishes actually used (bounded, no library-size row-cap risk).
    const dishIds = Array.from(new Set((Array.isArray(items) ? items : []).map((it: { dish_id: string }) => it.dish_id).filter(Boolean)));
    // deno-lint-ignore no-explicit-any
    const dishById: Record<string, any> = {};
    if (dishIds.length) {
      const dR = await sb("event_dishes?id=in.(" + dishIds.join(",") + ")&select=id,name,serve,allergens,min_order");
      for (const d of await dR.json()) dishById[d.id] = d;
    }

    // deno-lint-ignore no-explicit-any
    const events = evs.map((ev: any) => {
      const g = Number(ev.guests) || 0;
      // deno-lint-ignore no-explicit-any
      let menu: any[] = [];
      let total_pcs = 0, pcs_per_guest = 0, kind = "none";

      if (ev.set_menu && ev.set_menu.key) {
        // Plated set menu — pass the choice data through; the app owns the course
        // names + portion display (kept out of here to stay ASCII-safe).
        kind = "set";
      } else {
        // Canapé selection (event_items). Dish names come from the DB (safe);
        // no non-ASCII literals are emitted here.
        // deno-lint-ignore no-explicit-any
        const mine = (Array.isArray(items) ? items : []).filter((it: any) => it.event_id === ev.id);
        // deno-lint-ignore no-explicit-any
        menu = mine.map((it: any) => {
          const d = dishById[it.dish_id];
          if (!d) return null;
          const pcs = Number(it.pcs_per_guest) || 0;
          const total = g ? Math.ceil(pcs * g) : null;
          return {
            name: d.name, group: d.serve, qty: total, unit: "pcs", per_guest: pcs,
            allergens: d.allergens || [], comp: !!it.comp,
            unconfirmed: it.qty_confirmed === false,
            min_flag: (total != null && d.min_order && total < d.min_order) ? d.min_order : null,
            _sort: (SERVE_ORDER[d.serve] ?? 9),
          };
          // deno-lint-ignore no-explicit-any
        }).filter(Boolean).sort((a: any, b: any) => a._sort - b._sort).map(({ _sort, ...m }: any) => m);
        for (const m of menu) { if (m.qty) total_pcs += m.qty; pcs_per_guest += m.per_guest || 0; }
        if (menu.length) kind = "canape";
      }

      const bev_only = kind === "none" && (!!ev.bev_package_id || ev.bev_mode === "dry");
      return {
        id: ev.id, name: ev.client_name || "Event", date: ev.event_date,
        time_from: ev.time_from, time_to: ev.time_to, area: ev.area,
        guests: ev.guests, dietary: ev.dietary || null,
        kind, menu, total_pcs, pcs_per_guest: Math.round(pcs_per_guest * 10) / 10,
        set_menu: kind === "set" ? ev.set_menu : null, bev_only,
      };
    });

    return json({ today, count: events.length, events });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
