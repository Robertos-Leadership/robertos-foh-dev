// ════════════════════════════════════════════════════════════
// kitchen-events — Supabase Edge Function (FOH project paoaivwtkzujmrgrfjuq)
// Feeds the KITCHEN app's on-screen "events" strip. Returns EVERY FOH event
// whose team brief has been sent, from today onward — confirmed, deposit AND
// draft, each carrying its status so the kitchen can see which are not yet
// confirmed rather than simply not being told (the kitchen app groups them
// this-week / next-2-weeks / later and caps the display). Kitchen-
// safe fields ONLY — event name, date, time, area, guests, dietary, and the menu
// with quantities. NEVER prices, contact, or payment.
//
// Handles BOTH canapé menus (event_items) AND plated set menus, resolved from the
// data-driven event_set_menus library by key. Beverage-only events are flagged.
//
// Also returns `highlights`: what the events desk (or the chef) put on the
// kitchen home screen by hand from the FOH Events calendar - a client food
// tasting, a site visit, anything that is not a briefed booking and so would
// otherwise live "only in words" (Danilo, 4 Sep 2026). Table kitchen_highlights.
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
// NOTE: this function stays ASCII-only in its SOURCE literals — a non-ASCII
// literal (·, accents, curly quotes) gets double-encoded by the deploy upload.
// Dish/course names below come from the DB at runtime (not source literals), so
// accents survive fine; only hardcoded literals here must stay ASCII.

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

    // Highlights first, and on EVERY return below: a day with a tasting and no
    // briefed booking must still reach the kitchen. A failed read is loud (null,
    // not []) so the kitchen can say it could not check rather than show nothing.
    let hlFilter = "&on_date=gte." + today;
    if (days >= 1 && days <= 3650) {
      hlFilter += "&on_date=lte." + new Date(nowD.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
    }
    let highlights: unknown[] | null = null;
    try {
      const hlR = await sb(
        "kitchen_highlights?removed_at=is.null" + hlFilter +
        "&select=id,on_date,time_from,title,guests,note&order=on_date.asc,time_from.asc&limit=200",
      );
      const hl = await hlR.json();
      // deno-lint-ignore no-explicit-any
      if (Array.isArray(hl)) highlights = hl.map((h: any) => ({
        id: h.id, date: h.on_date, time_from: h.time_from || null, title: h.title,
        guests: h.guests, note: h.note || null,
      }));
    } catch (_e) { highlights = null; }

    // Drafts are included ON PURPOSE (3 Aug 2026). A brief can be sent for an
    // event that is still a draft, and it was: the kitchen got an email telling
    // them to cook for 12 on the Tuesday while this feed deliberately returned
    // nothing, so the email and the app disagreed and the team had no way to
    // know which to believe. The brief is the thing that says "cook this", so
    // anything briefed now appears — and carries its status, so the kitchen can
    // see at a glance which are firm and which are not yet confirmed.
    const evR = await sb(
      "events_desk?status=in.(confirmed,deposit,draft)" + dateFilter +
      "&select=id,client_name,event_date,time_from,time_to,area,guests,dietary,set_menu,bev_package_id,bev_mode,status" +
      "&order=event_date.asc&limit=200",
    );
    const evsAll = await evR.json();
    if (!Array.isArray(evsAll) || !evsAll.length) return json({ today, count: 0, events: [], highlights });

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
    if (!evs.length) return json({ today, count: 0, events: [], highlights });

    const ids = evs.map((e: { id: string }) => e.id);
    const itR = await sb("event_items?event_id=in.(" + ids.join(",") + ")&select=event_id,dish_id,pcs_per_guest,comp,qty_confirmed");
    const items = await itR.json();
    // Only fetch the dishes actually used (bounded, no library-size row-cap risk).
    const dishIds = Array.from(new Set((Array.isArray(items) ? items : []).map((it: { dish_id: string }) => it.dish_id).filter(Boolean)));
    // deno-lint-ignore no-explicit-any
    const dishById: Record<string, any> = {};
    if (dishIds.length) {
      const dR = await sb("event_dishes?id=in.(" + dishIds.join(",") + ")&select=id,name,serve,allergens,min_order,description");
      for (const d of await dR.json()) dishById[d.id] = d;
    }

    // Plated set menus are DATA-DRIVEN (event_set_menus, edited in the FOH
    // Chef Corner). Resolve each event's chosen menu FROM THAT TABLE here, so
    // the kitchen always cooks the current library — never a hardcoded mirror
    // that silently drifts. Course/dish names are DB data (not source literals),
    // so they survive the deploy upload just like the canapE dish names above.
    // deno-lint-ignore no-explicit-any
    const smByKey: Record<string, any> = {};
    const smKeys = Array.from(new Set(
      // deno-lint-ignore no-explicit-any
      evs.map((e: any) => (e.set_menu && e.set_menu.key) ? String(e.set_menu.key) : null).filter(Boolean),
    ));
    if (smKeys.length) {
      const smR = await sb(
        "event_set_menus?key=in.(" + smKeys.map((k) => '"' + k + '"').join(",") + ")&select=key,name,courses",
      );
      const smRows = await smR.json();
      if (Array.isArray(smRows)) for (const m of smRows) smByKey[m.key] = m;
    }

    // deno-lint-ignore no-explicit-any
    const events = evs.map((ev: any) => {
      const g = Number(ev.guests) || 0;
      // deno-lint-ignore no-explicit-any
      let menu: any[] = [];
      let total_pcs = 0, pcs_per_guest = 0, kind = "none";

      if (ev.set_menu && ev.set_menu.key) {
        // Plated set menu — build the prep rows from the resolved library menu.
        // Fixed courses cook one portion per guest; a "choose" course (options)
        // uses the recorded per-option headcount split, else falls back to guests.
        kind = "set";
        const sm = smByKey[ev.set_menu.key];
        const choices = (ev.set_menu.choices) || {};
        // A set menu stores plain dish NAMES in courses[].items / .options, and
        // the wording and allergens beside them in courses[].desc / .allg -
        // keyed by the same name. Both were dropped on the way here, so the
        // kitchen's set-menu sheet showed a bare list: no description AND no
        // allergens, where the canape sheet had at least the allergens.
        // Older menus still carry the codes inside the prose ("...cartoccio
        // style (R)(S)"), so read both and let the structured field win - the
        // same rule the FOH documents use, so the two can never disagree.
        const ALG_RE = /\s*\(([A-Za-z]{1,3})\)/g;
        // deno-lint-ignore no-explicit-any
        const descOf = (c: any, dish: string) =>
          String((c && c.desc && c.desc[dish]) || "").replace(ALG_RE, "").trim();
        // deno-lint-ignore no-explicit-any
        const algOf = (c: any, dish: string) => {
          if (c && c.allg && Object.prototype.hasOwnProperty.call(c.allg, dish)) return c.allg[dish] || [];
          const t = String((c && c.desc && c.desc[dish]) || "");
          const out: string[] = [];
          ALG_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = ALG_RE.exec(t)) !== null) out.push(m[1].toUpperCase());
          return out;
        };
        // deno-lint-ignore no-explicit-any
        if (sm && Array.isArray(sm.courses)) for (const c of sm.courses as any[]) {
          const cname = c.name || "";
          if (Array.isArray(c.options) && c.choose) {
            for (const o of c.options) {
              const n = Number((choices[cname] || {})[o]) || 0;
              menu.push({ name: o, group: cname, qty: (n || null), unit: "portions", per_guest: null, sub: "guests choice", desc: descOf(c, o), allergens: algOf(c, o), comp: false, unconfirmed: !n, min_flag: null });
            }
          } else if (Array.isArray(c.items)) {
            for (const it of c.items) {
              menu.push({ name: it, group: cname, qty: (g || null), unit: "portions", per_guest: null, sub: "", desc: descOf(c, it), allergens: algOf(c, it), comp: false, unconfirmed: false, min_flag: null });
            }
          }
        }
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
            // What the dish IS, not just what it is called. A chef cannot cook
            // "Sea bass tart" from the name and cannot hand it to the pass as a
            // menu; the wording was recorded in Chef Corner and simply never
            // asked for here, so the kitchen's own sheet was the one document
            // that did not carry it.
            desc: d.description || "",
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
        // The kitchen labels an unconfirmed event rather than hiding it.
        status: ev.status || null, confirmed: ev.status !== "draft",
        kind, menu, total_pcs, pcs_per_guest: Math.round(pcs_per_guest * 10) / 10,
        set_menu: kind === "set"
          ? { key: ev.set_menu.key, name: (smByKey[ev.set_menu.key] && smByKey[ev.set_menu.key].name) || null }
          : null,
        bev_only,
      };
    });

    return json({ today, count: events.length, events, highlights });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
