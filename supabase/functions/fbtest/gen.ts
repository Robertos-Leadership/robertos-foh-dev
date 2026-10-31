// fbtest/gen.ts — builds one 20-question Food & Beverage test from the LIVE Food Bible data.
// Pure functions, no Deno or network calls, so it can be run and checked under node as well.
// Nothing here is a stored question bank: every fact comes from the recipes, the allergens the chefs
// ticked (own + sub-recipes, as food-bible.html does) and fb_wines / fb_wine_pairings. A recipe the chef
// changes changes the next test. A dish with no allergens ticked is never used, because an empty row looks
// the same as "no allergens" and the test must never teach that.

export interface Dish { id: string; name: string; section: string; diet: string; all: string[]; ing: string[] }
export interface Wine { id: string; name: string; style: string; region: string; grapes: string }
export interface Pairing { wine_id: string; recipe_id: string; rank: number; why: string }
export interface Data { dishes: Dish[]; wines: Wine[]; pairings: Pairing[] }
export interface Q {
  level: "Basic" | "Intermediate" | "Advanced";
  area: string;
  secs: number;
  type: "one" | "multi" | "match";
  text: string;
  opts: string[];
  lefts?: string[];
  correct: number[];          // one/multi: indexes into opts; match: correct[i] = index in opts for lefts[i]
  note: string;
}

export const AL: Record<string, string> = {
  gluten: "Gluten", crustacean: "Crustaceans", egg: "Egg", fish: "Fish", peanut: "Peanuts", soy: "Soya",
  milk: "Milk", nuts: "Tree nuts", celery: "Celery", mustard: "Mustard", sesame: "Sesame",
  sulphites: "Sulphites", lupin: "Lupin", mollusc: "Molluscs",
};
const COMMON = ["milk", "gluten", "egg", "fish", "nuts", "celery", "mustard", "sulphites"];
const STYLE: Record<string, string> = { sparkling: "Sparkling", white: "White", rose: "Rosé", red: "Red" };
const nm = (ks: string[]) => ks.map((k) => AL[k] || k).join(", ");

export function rngFrom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type R = () => number;
const pick = <T>(r: R, a: T[]): T => a[Math.floor(r() * a.length)];
function shuffle<T>(r: R, a: T[]): T[] {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}
const sample = <T>(r: R, a: T[], n: number): T[] => shuffle(r, a).slice(0, n);

// Put the options in random order and remember where the right ones went. Done last, for every question,
// so the right answer is never first, longest or most detailed by habit of the template.
function mix(r: R, q: Q): Q {
  const idx = shuffle(r, q.opts.map((_, i) => i));
  const opts = idx.map((i) => q.opts[i]);
  const pos = (old: number) => idx.indexOf(old);
  q.opts = opts;
  q.correct = q.type === "match" ? q.correct.map(pos) : q.correct.map(pos).sort((a, b) => a - b);
  return q;
}

type Tpl = (r: R, d: Data, ctx: Ctx) => Q | null;
interface Ctx { ingCount: Record<string, number>; byId: Record<string, Dish>; wineById: Record<string, Wine>; rec: Record<string, Pairing[]> }

const B1: Tpl = (r, d) => {
  const x = pick(r, d.dishes);
  const right = pick(r, x.all);
  const wrong = sample(r, Object.keys(AL).filter((k) => !x.all.includes(k)), 3);
  if (wrong.length < 3) return null;
  return { level: "Basic", area: "Allergens", secs: 20, type: "one", text: `Which of these allergens is declared in ${x.name}?`,
    opts: [AL[right], ...wrong.map((k) => AL[k])], correct: [0], note: `${x.name} declares: ${nm(x.all)}.` };
};
const B2: Tpl = (r, d, c) => {
  const cands: [Dish, string][] = [];
  d.dishes.forEach((x) => x.ing.forEach((l) => { if (l.length >= 10 && c.ingCount[l.toLowerCase()] === 1) cands.push([x, l]); }));
  if (!cands.length) return null;
  const [x, l] = pick(r, cands);
  const key = l.toLowerCase().split(" ")[0];
  const others = d.dishes.filter((o) => o.id !== x.id && !o.ing.join(" ").toLowerCase().includes(key));
  if (others.length < 3) return null;
  return { level: "Basic", area: "Dishes", secs: 20, type: "one", text: `Which dish contains ${l}?`,
    opts: [x.name, ...sample(r, others, 3).map((o) => o.name)], correct: [0], note: `${x.name}: ${x.ing.slice(0, 6).join(", ")}.` };
};
const B3: Tpl = (r, d) => {
  const w = pick(r, d.wines.filter((x) => STYLE[x.style]));
  if (!w) return null;
  return { level: "Basic", area: "Wine", secs: 20, type: "one", text: `What style of wine is ${w.name}?`,
    opts: ["Sparkling", "White", "Rosé", "Red"], correct: [["Sparkling", "White", "Rosé", "Red"].indexOf(STYLE[w.style])],
    note: `${w.name}: ${w.region}${w.grapes ? " · " + w.grapes : ""}.` };
};
const B4: Tpl = (r, d) => {
  const secs = Array.from(new Set(d.dishes.map((x) => x.section).filter(Boolean)));
  if (secs.length < 4) return null;
  const x = pick(r, d.dishes.filter((y) => y.section));
  const wrong = sample(r, secs.filter((s) => s !== x.section), 3);
  return { level: "Basic", area: "Dishes", secs: 20, type: "one", text: `Which section of the menu is ${x.name} on?`,
    opts: [x.section, ...wrong], correct: [0], note: `${x.name} is in ${x.section}.` };
};

const I1: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => y.all.length >= 2 && y.all.length <= 3));
  if (!x) return null;
  const wrong = sample(r, Object.keys(AL).filter((k) => !x.all.includes(k)), 6 - x.all.length);
  return { level: "Intermediate", area: "Allergens", secs: 35, type: "multi", text: `Select every allergen declared in ${x.name}.`,
    opts: [...x.all.map((k) => AL[k]), ...wrong.map((k) => AL[k])], correct: x.all.map((_, i) => i), note: `Declared: ${nm(x.all)}.` };
};
const I2: Tpl = (r, d, c) => {
  const ids = Object.keys(c.rec).filter((id) => { const rk = c.rec[id].map((p) => p.rank).sort().join(); return rk === "1,2" && c.byId[id]; });
  if (!ids.length) return null;
  const id = pick(r, ids); const ps = c.rec[id].slice().sort((a, b) => a.rank - b.rank);
  const have = ps.map((p) => p.wine_id);
  const wrong = sample(r, d.wines.filter((w) => !have.includes(w.id)), 3);
  return { level: "Intermediate", area: "Wine pairing", secs: 35, type: "multi",
    text: `Select the wines the list recommends with ${c.byId[id].name} (best choice and second choice).`,
    opts: [...have.map((w) => c.wineById[w].name), ...wrong.map((w) => w.name)], correct: [0, 1],
    note: ps.map((p) => `${p.rank === 1 ? "Best" : "Also"}: ${c.wineById[p.wine_id].name}`).join("; ") };
};
const I3: Tpl = (r, d, c) => {
  const best: [string, string][] = [];
  Object.keys(c.rec).forEach((id) => { const p = c.rec[id].find((x) => x.rank === 1); if (p && c.byId[id] && c.wineById[p.wine_id]) best.push([id, p.wine_id]); });
  const used = new Set<string>(); const trio: [string, string][] = [];
  for (const [id, w] of shuffle(r, best)) { if (!used.has(w)) { used.add(w); trio.push([id, w]); } if (trio.length === 3) break; }
  if (trio.length < 3) return null;
  const extra = pick(r, d.wines.filter((w) => !used.has(w.id)));
  return { level: "Intermediate", area: "Wine pairing", secs: 50, type: "match", text: "Match each dish to the wine the list recommends as its best choice.",
    lefts: trio.map(([id]) => c.byId[id].name), opts: [...trio.map(([, w]) => c.wineById[w].name), extra.name], correct: [0, 1, 2],
    note: trio.map(([id, w]) => `${c.byId[id].name} → ${c.wineById[w].name}`).join("; ") };
};
const I4: Tpl = (r, d) => {
  const a = pick(r, COMMON);
  const has = d.dishes.filter((x) => x.all.includes(a)), not = d.dishes.filter((x) => !x.all.includes(a));
  if (has.length < 3 || !not.length) return null;
  const odd = pick(r, not);
  return { level: "Intermediate", area: "Allergens", secs: 35, type: "one", text: `Which of these dishes does NOT declare ${AL[a]}?`,
    opts: [odd.name, ...sample(r, has, 3).map((x) => x.name)], correct: [0], note: `${odd.name} declares: ${nm(odd.all)}.` };
};
const I5: Tpl = (r, d) => {
  const ws = d.wines.filter((w) => w.grapes && w.grapes.length > 2);
  const g = Array.from(new Set(ws.map((w) => w.grapes)));
  if (g.length < 4) return null;
  const w = pick(r, ws);
  return { level: "Intermediate", area: "Wine", secs: 35, type: "one", text: `Which grape is ${w.name} made from?`,
    opts: [w.grapes, ...sample(r, g.filter((x) => x !== w.grapes), 3)], correct: [0], note: `${w.name}: ${w.region} · ${w.grapes}.` };
};
const I6: Tpl = (r, d) => {
  const vg = d.dishes.filter((x) => x.diet === "vegan");
  const nv = d.dishes.filter((x) => x.diet !== "vegan" && x.all.some((k) => ["fish", "milk", "egg"].includes(k)));
  if (!vg.length || nv.length < 3) return null;
  const v = pick(r, vg);
  return { level: "Intermediate", area: "Dishes", secs: 35, type: "one", text: "Which of these dishes is marked vegan?",
    opts: [v.name, ...sample(r, nv, 3).map((x) => x.name)], correct: [0], note: `${v.name} is marked vegan. Declared: ${nm(v.all)}.` };
};

const veg = (x: Dish) => x.diet === "vegan" || x.diet === "vegetarian";
const A1: Tpl = (r, d) => {
  const ok = d.dishes.filter((x) => veg(x) && !x.all.includes("milk") && !x.all.includes("egg"));
  const no = d.dishes.filter((x) => (veg(x) && (x.all.includes("milk") || x.all.includes("egg"))) ||
    (!veg(x) && !x.all.includes("milk") && !x.all.includes("egg") && !x.all.some((k) => ["fish", "crustacean", "mollusc"].includes(k))));
  if (ok.length < 2 || no.length < 4) return null;
  const s = sample(r, ok, 2), u = sample(r, no, 4), all = [...s, ...u];
  return { level: "Advanced", area: "Guest scenario", secs: 75, type: "multi",
    text: "A guest is vegetarian and cannot have milk or egg. Select every dish below that is marked vegetarian or vegan AND free of both.",
    opts: all.map((x) => x.name), correct: [0, 1], note: all.map((x) => `${x.name} (${x.diet || "no diet mark"}; ${nm(x.all)})`).join("; ") };
};
const A2: Tpl = (r, d, c) => {
  const cs: [string, Pairing, Pairing][] = [];
  Object.keys(c.rec).forEach((id) => {
    const b = c.rec[id].find((p) => p.rank === 1), a = c.rec[id].find((p) => p.rank === 2);
    if (b && a && c.byId[id] && c.wineById[b.wine_id]?.style === "red" && c.wineById[a.wine_id] && c.wineById[a.wine_id].style !== "red") cs.push([id, b, a]);
  });
  if (!cs.length) return null;
  const [id, b, a] = pick(r, cs);
  const dist = sample(r, d.wines.filter((w) => w.id !== b.wine_id && w.id !== a.wine_id && w.style !== "red"), 3);
  if (dist.length < 3) return null;
  return { level: "Advanced", area: "Guest scenario", secs: 60, type: "one",
    text: `A guest orders ${c.byId[id].name} but does not drink red. Which wine do you offer from the list's recommendations?`,
    opts: [c.wineById[a.wine_id].name, ...dist.map((w) => w.name)], correct: [0],
    note: `Best choice is ${c.wineById[b.wine_id].name} (red). Second choice: ${c.wineById[a.wine_id].name}. ${a.why}` };
};
const A3: Tpl = (r, d, c) => {
  const pp = d.pairings.filter((p) => p.rank === 1 && c.byId[p.recipe_id] && c.wineById[p.wine_id] && (p.why || "").length > 60);
  if (pp.length < 4) return null;
  const p = pick(r, pp);
  const uniq: Pairing[] = []; const seenWhy = new Set<string>([p.why]);
  shuffle(r, pp).forEach((x) => { if (x.wine_id !== p.wine_id && x.recipe_id !== p.recipe_id && !seenWhy.has(x.why)) { seenWhy.add(x.why); uniq.push(x); } });
  const others = uniq.slice(0, 3);
  if (others.length < 3) return null;
  return { level: "Advanced", area: "Wine pairing", secs: 60, type: "one",
    text: `${c.wineById[p.wine_id].name} is the best pairing for ${c.byId[p.recipe_id].name}. Which explanation is the one on the list?`,
    opts: [p.why, ...others.map((x) => x.why)], correct: [0], note: "The list gives this reason for this pairing." };
};
const A4: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => y.all.length >= 3 && y.ing.length >= 3 && y.section));
  if (!x) return null;
  const fa = pick(r, COMMON.filter((k) => !x.all.includes(k)));
  const tr = [`${x.name} declares ${AL[pick(r, x.all)]}.`, `${x.name} is on the ${x.section} section.`, `${x.name} includes ${pick(r, x.ing.slice(1))}.`];
  return { level: "Advanced", area: "Dishes", secs: 60, type: "one", text: "Which of these statements is FALSE?",
    opts: [`${x.name} declares ${AL[fa]}.`, ...tr], correct: [0], note: `${x.name}: section ${x.section}; declared ${nm(x.all)}; ingredients ${x.ing.slice(0, 5).join(", ")}.` };
};
const A5: Tpl = (r, d) => {
  const [a, b] = sample(r, COMMON, 2);
  const safe = d.dishes.filter((x) => !x.all.includes(a) && !x.all.includes(b)), uns = d.dishes.filter((x) => x.all.includes(a) || x.all.includes(b));
  if (safe.length < 2 || uns.length < 4) return null;
  const s = sample(r, safe, 2), u = sample(r, uns, 4), all = [...s, ...u];
  return { level: "Advanced", area: "Guest scenario", secs: 75, type: "multi",
    text: `A guest cannot eat ${AL[a].toLowerCase()} or ${AL[b].toLowerCase()}. Select every dish below that is safe for them.`,
    opts: all.map((x) => x.name), correct: [0, 1], note: all.map((x) => `${x.name}: ${nm(x.all)}`).join("; ") };
};
const A6: Tpl = (r, d, c) => {
  const ids = Object.keys(c.rec).filter((id) => c.byId[id]);
  for (let t = 0; t < 400; t++) {
    const x = pick(r, ids), y = pick(r, ids); if (x === y) continue;
    const wx = new Set(c.rec[x].map((p) => p.wine_id)), wy = new Set(c.rec[y].map((p) => p.wine_id));
    const both = [...wx].filter((w) => wy.has(w));
    if (both.length !== 1) continue;
    const onlyX = [...wx].filter((w) => !wy.has(w)), onlyY = [...wy].filter((w) => !wx.has(w));
    const none = d.wines.filter((w) => !wx.has(w.id) && !wy.has(w.id));
    if (!onlyX.length || !onlyY.length || !none.length) continue;
    return { level: "Advanced", area: "Guest scenario", secs: 60, type: "one",
      text: `A table orders ${c.byId[x].name} and ${c.byId[y].name} and wants one bottle that the list recommends for both. Which wine?`,
      opts: [c.wineById[both[0]].name, c.wineById[pick(r, onlyX)].name, c.wineById[pick(r, onlyY)].name, pick(r, none).name], correct: [0],
      note: `Recommended for both: ${c.wineById[both[0]].name}.` };
  }
  return null;
};
const A7: Tpl = (r, d) => {
  const [a, b] = sample(r, COMMON, 2);
  const safe = d.dishes.filter((x) => !x.all.includes(a) && !x.all.includes(b)), uns = d.dishes.filter((x) => x.all.includes(a) || x.all.includes(b));
  if (!safe.length || uns.length < 3) return null;
  const s = pick(r, safe);
  return { level: "Advanced", area: "Guest scenario", secs: 60, type: "one",
    text: `A guest cannot have ${AL[a].toLowerCase()} or ${AL[b].toLowerCase()}. Which ONE of these dishes can they eat?`,
    opts: [s.name, ...sample(r, uns, 3).map((x) => x.name)], correct: [0], note: `${s.name} declares: ${nm(s.all)}.` };
};
const A8: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => y.ing.length >= 4));
  if (!x) return null;
  const txt = x.ing.join(" ").toLowerCase();
  const real = sample(r, x.ing.filter((l) => l.length >= 5), 2);
  const pool: string[] = [];
  d.dishes.forEach((o) => { if (o.id !== x.id) o.ing.forEach((l) => { if (l.length >= 5 && !txt.includes(l.toLowerCase().split(" ")[0])) pool.push(l); }); });
  if (real.length < 2 || pool.length < 3) return null;
  return { level: "Advanced", area: "Dishes", secs: 60, type: "multi", text: `Select the two ingredients that are in ${x.name}.`,
    opts: [...real, ...sample(r, Array.from(new Set(pool)), 3)], correct: [0, 1], note: `${x.name}: ${x.ing.join(", ")}.` };
};

const PLAN: [Q["level"], Tpl[], number][] = [
  ["Basic", [B1, B2, B3, B4], 4],
  ["Intermediate", [I1, I2, I3, I4, I5, I6], 7],
  ["Advanced", [A1, A2, A3, A4, A5, A6, A7, A8], 9],
];

export function buildTest(data: Data, seed: number): Q[] {
  const r = rngFrom(seed);
  const byId: Record<string, Dish> = {}; data.dishes.forEach((x) => (byId[x.id] = x));
  const wineById: Record<string, Wine> = {}; data.wines.forEach((x) => (wineById[x.id] = x));
  const rec: Record<string, Pairing[]> = {};
  data.pairings.forEach((p) => { if (byId[p.recipe_id] && wineById[p.wine_id]) (rec[p.recipe_id] = rec[p.recipe_id] || []).push(p); });
  const ingCount: Record<string, number> = {};
  data.dishes.forEach((x) => new Set(x.ing.map((l) => l.toLowerCase())).forEach((l) => (ingCount[l] = (ingCount[l] || 0) + 1)));
  const ctx: Ctx = { ingCount, byId, wineById, rec };
  const out: Q[] = []; const seen = new Set<string>();
  for (const [, tpls, n] of PLAN) {
    // every template once (in random order), then repeats with new random picks until the level is full
    const order = shuffle(r, tpls);
    let made = 0, guard = 0;
    while (made < n && guard++ < 200) {
      const t = made < order.length ? order[made] : pick(r, tpls);
      let q: Q | null = null;
      for (let k = 0; k < 25 && !q; k++) { q = t(r, data, ctx); if (q && seen.has(q.text)) q = null; }
      if (!q) { const alt = pick(r, tpls); for (let k = 0; k < 25 && !q; k++) { q = alt(r, data, ctx); if (q && seen.has(q.text)) q = null; } }
      if (q) { seen.add(q.text); out.push(mix(r, q)); made++; }
    }
  }
  return out;
}

// One question without its answer, as the phone sees it.
export function publicQ(q: Q) {
  return { level: q.level, area: q.area, secs: q.secs, type: q.type, text: q.text, opts: q.opts, lefts: q.lefts || null };
}

// Is this pick right? one: a single index; multi: array of indexes; match: array, one index per left.
export function isRight(q: Q, pick: unknown): boolean {
  if (pick == null) return false;
  if (q.type === "one") return typeof pick === "number" && pick === q.correct[0];
  if (!Array.isArray(pick)) return false;
  if (q.type === "match") return pick.length === q.correct.length && q.correct.every((c, i) => pick[i] === c);
  const p = Array.from(new Set(pick.filter((x) => Number.isInteger(x)))).sort((a: number, b: number) => a - b);
  return p.length === q.correct.length && q.correct.every((c, i) => p[i] === c);
}

export const CUT = { Basic: 3, Intermediate: 4, Advanced: 7 } as const;
export function rate(by: Record<string, { n: number; r: number }>): string {
  if (by.Basic.r < CUT.Basic) return "Not yet passed";
  if (by.Intermediate.r < CUT.Intermediate) return "Foundation";
  if (by.Advanced.r < CUT.Advanced) return "Competent";
  return "Expert";
}
