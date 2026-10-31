// fbtest/gen.ts — builds one 20-question Food & Beverage test from the LIVE Food Bible data.
// Pure functions, no Deno or network calls, so it can be run and checked under node as well.
// Nothing here is a stored question bank: every fact comes from what the Bible page shows a reader — the
// dish story, the guest description, the ingredients, the garnish, the service note, the allergens the
// chefs ticked (own + sub-recipes), and the wine list with its notes and pairings. A recipe the chef changes
// changes the next test. A dish with no allergens ticked is never used, because an empty row looks the same
// as "no allergens" and the test must never teach that.
// Every question in one test is a DIFFERENT kind (31 Oct 2026, after "many questions are very similar"),
// and no dish is the subject of two questions.

export interface Dish {
  id: string; name: string; section: string; diet: string; all: string[]; ing: string[];
  desc: string; story: string; garnish: string[]; more: string;
}
export interface Wine { id: string; name: string; style: string; region: string; grapes: string; notes: string }
export interface Pairing { wine_id: string; recipe_id: string; rank: number; why: string }
export interface Data { dishes: Dish[]; wines: Wine[]; pairings: Pairing[] }
export interface Q {
  level: "Basic" | "Intermediate" | "Advanced";
  area: string;
  kind: string;               // which template made it; one test never repeats a kind
  secs: number;
  type: "one" | "multi" | "match";
  text: string;
  quote?: string;             // a passage from the Bible shown above the options
  opts: string[];
  lefts?: string[];
  correct: number[];          // one/multi: indexes into opts; match: correct[i] = index in opts for lefts[i]
  note: string;
  used?: string[];            // dish ids this question is about (internal; never sent)
}

export const AL: Record<string, string> = {
  gluten: "Gluten", crustacean: "Crustaceans", egg: "Egg", fish: "Fish", peanut: "Peanuts", soy: "Soya",
  milk: "Milk", nuts: "Tree nuts", celery: "Celery", mustard: "Mustard", sesame: "Sesame",
  sulphites: "Sulphites", lupin: "Lupin", mollusc: "Molluscs",
};
const COMMON = ["milk", "gluten", "egg", "fish", "nuts", "celery", "mustard", "sulphites"];
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

// ---- text helpers ---------------------------------------------------------------------------------------------
const clean = (t: unknown) => String(t ?? "").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
const sentences = (t: string) => clean(t).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 25);
const STOP = /^(alla|della|delle|dello|degli|con|dal|dei|del|and|with|the|for|from|your|style|fatta|casa|nel|sul)$/i;
const nameTokens = (n: string) => clean(n).split(/[\s,'’\-\/()]+/).filter((w) => w.length >= 4 && !STOP.test(w));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ACC: Record<string, string> = { a: "aàáâä", e: "eèéêë", i: "iìíîï", o: "oòóôö", u: "uùúûü" };
// a token as a regex that ignores accents and only matches the whole word ("Souffle" also finds "soufflé")
const wordRe = (t: string, flags = "gi") => new RegExp("(?<![A-Za-zÀ-ÿ])" + esc(t).replace(/[aeiou]/gi, (m) => "[" + ACC[m.toLowerCase()] + "]") + "(?![A-Za-zÀ-ÿ])", flags);
// hide the dish's own name in a passage, so the passage cannot simply give the answer away
function mask(text: string, name: string, word = "this dish"): string {
  let out = clean(text);
  const full = clean(name);
  if (full) out = out.replace(new RegExp(esc(full), "gi"), "\u0001");
  nameTokens(name).forEach((t) => { out = out.replace(wordRe(t), "\u0001"); });
  out = out.replace(/\u0001(?:[\s,]+(?:di|e|al|alla|del|della|con|and)?[\s,]*\u0001)+/gi, "\u0001");
  return out.replace(/\u0001/g, word);
}
const leaks = (text: string, name: string) => nameTokens(name).some((t) => wordRe(t, "i").test(text));
const cut = (t: string, max: number) => { const s = sentences(t); let o = ""; for (const x of s) { if ((o + " " + x).trim().length > max && o) break; o = (o + " " + x).trim(); } return o || clean(t).slice(0, max); };
const words = (t: string) => (clean(t).toLowerCase().match(/[a-zàèéìòù]{5,}/g) || []);
const sameText = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();
const sameSectionFirst = (r: R, d: Dish, pool: Dish[]) => {
  const same = shuffle(r, pool.filter((x) => x.section && x.section === d.section));
  const rest = shuffle(r, pool.filter((x) => !x.section || x.section !== d.section));
  return same.concat(rest);
};

interface Ctx { ingCount: Record<string, number>; garCount: Record<string, number>; byId: Record<string, Dish>; wineById: Record<string, Wine>; rec: Record<string, Pairing[]> }
type Tpl = (r: R, d: Data, c: Ctx) => Q | null;
const mk = (q: Omit<Q, "note"> & { note: string }): Q => q;

// ============================== BASIC: recall ==============================
const B_allergen: Tpl = (r, d) => {
  const x = pick(r, d.dishes); const right = pick(r, x.all);
  const wrong = sample(r, Object.keys(AL).filter((k) => !x.all.includes(k)), 3);
  if (wrong.length < 3) return null;
  return mk({ level: "Basic", area: "Allergens", kind: "allergen", secs: 20, type: "one", text: `Which of these allergens is declared in ${x.name}?`,
    opts: [AL[right], ...wrong.map((k) => AL[k])], correct: [0], note: `${x.name} declares: ${nm(x.all)}.`, used: [x.id] });
};
const B_dishByIngredient: Tpl = (r, d, c) => {
  const cands: [Dish, string][] = [];
  d.dishes.forEach((x) => x.ing.forEach((l) => { if (l.length >= 10 && c.ingCount[l.toLowerCase()] === 1) cands.push([x, l]); }));
  if (!cands.length) return null;
  const [x, l] = pick(r, cands); const key = l.toLowerCase().split(" ")[0];
  const others = sameSectionFirst(r, x, d.dishes.filter((o) => o.id !== x.id && !o.ing.join(" ").toLowerCase().includes(key))).slice(0, 3);
  if (others.length < 3) return null;
  return mk({ level: "Basic", area: "Ingredients", kind: "dish-by-ingredient", secs: 20, type: "one", text: `Which dish is made with ${l}?`,
    opts: [x.name, ...others.map((o) => o.name)], correct: [0], note: `${x.name}: ${x.ing.slice(0, 7).join(", ")}.`, used: [x.id] });
};
const B_oddIngredient: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => y.ing.length >= 4)); if (!x) return null;
  const txt = x.ing.join(" ").toLowerCase();
  const pool: string[] = [];
  d.dishes.forEach((o) => { if (o.id !== x.id) o.ing.forEach((l) => { if (l.length >= 5 && !txt.includes(l.toLowerCase().split(" ")[0])) pool.push(l); }); });
  if (!pool.length) return null;
  const odd = pick(r, pool);
  return mk({ level: "Basic", area: "Ingredients", kind: "odd-ingredient", secs: 25, type: "one", text: `One of these is NOT an ingredient of ${x.name}. Which one?`,
    opts: [odd, ...sample(r, x.ing, 3)], correct: [0], note: `${x.name}: ${x.ing.join(", ")}.`, used: [x.id] });
};
const B_wineRegion: Tpl = (r, d) => {
  const reg = (w: Wine) => clean(w.region);
  const w = pick(r, d.wines.filter((x) => reg(x)));
  const others = Array.from(new Set(d.wines.filter((x) => reg(x) && reg(x) !== reg(w)).map((x) => reg(x))));
  if (!w || others.length < 3) return null;
  return mk({ level: "Basic", area: "Wine", kind: "wine-region", secs: 20, type: "one", text: `Where does ${w.name} come from?`,
    opts: [reg(w), ...sample(r, others, 3)], correct: [0], note: `${w.name}: ${reg(w)}${w.grapes ? " · " + clean(w.grapes) : ""}.` });
};

// ============================== INTERMEDIATE: know the dish ==============================
const I_storyToDish: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => sentences(y.story).length >= 2)); if (!x) return null;
  const q = mask(cut(x.story, 260), x.name);
  if (leaks(q, x.name) || q.length < 60) return null;
  const others = sameSectionFirst(r, x, d.dishes.filter((o) => o.id !== x.id && !sameText(o.story, x.story))).slice(0, 3);
  return mk({ level: "Intermediate", area: "Dish stories", kind: "story-dish", secs: 40, type: "one", text: "Which dish does this story belong to?", quote: q,
    opts: [x.name, ...others.map((o) => o.name)], correct: [0], note: `This is the story of ${x.name}.`, used: [x.id] });
};
const longNote = (y: Dish) => clean(y.more).length >= 70;
const I_noteToDish: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => sentences(y.more).length >= 1 && longNote(y))); if (!x) return null;
  const q = mask(cut(x.more, 240), x.name);
  if (q.length < 40) return null;
  const others = sameSectionFirst(r, x, d.dishes.filter((o) => o.id !== x.id && !sameText(o.more, x.more))).slice(0, 3);
  return mk({ level: "Intermediate", area: "Service notes", kind: "note-dish", secs: 40, type: "one", text: "Which dish carries this service note?", quote: q,
    opts: [x.name, ...others.map((o) => o.name)], correct: [0], note: `${x.name}: ${cut(x.more, 240)}`, used: [x.id] });
};
const I_storySentence: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => sentences(y.story).length >= 3)); if (!x) return null;
  const real = pick(r, sentences(x.story).filter((s) => s.length <= 190));
  if (!real) return null;
  const pool: string[] = [];
  d.dishes.forEach((o) => { if (o.id !== x.id) sentences(o.story).forEach((s) => { if (s.length <= 190 && s.length >= 50 && !leaks(s, o.name)) pool.push(s); }); });
  const upool = Array.from(new Set(pool.filter((z) => !sameText(z, real))));
  if (upool.length < 3) return null;
  return mk({ level: "Intermediate", area: "Dish stories", kind: "story-sentence", secs: 40, type: "one", text: `Which of these sentences comes from the story of ${x.name}?`,
    opts: [real, ...sample(r, upool, 3)], correct: [0], note: `From the story of ${x.name}.`, used: [x.id] });
};
const I_garnish: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => y.garnish.length >= 2 && y.garnish.length <= 4)); if (!x) return null;
  const have = x.garnish.map((g) => g.toLowerCase());
  const pool = Array.from(new Set(d.dishes.filter((o) => o.id !== x.id).flatMap((o) => o.garnish).filter((g) => g.length < 60 && !have.includes(g.toLowerCase()))));
  const nWrong = 5 - x.garnish.length; if (pool.length < nWrong || nWrong < 1) return null;
  return mk({ level: "Intermediate", area: "Garnish", kind: "garnish", secs: 40, type: "multi", text: `Select everything that goes on ${x.name} as garnish.`,
    opts: [...x.garnish, ...sample(r, pool, nWrong)], correct: x.garnish.map((_, i) => i), note: `${x.name}: ${x.garnish.join("; ")}.`, used: [x.id] });
};
const I_descToDish: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => clean(y.desc).length >= 25 && !leaks(y.desc, y.name))); if (!x) return null;
  const others = sameSectionFirst(r, x, d.dishes.filter((o) => o.id !== x.id && !sameText(o.desc, x.desc))).slice(0, 3);
  return mk({ level: "Intermediate", area: "Dishes", kind: "desc-dish", secs: 30, type: "one", text: "A guest asks what the dish is. You read them: “" + clean(x.desc) + "”. Which dish is it?",
    opts: [x.name, ...others.map((o) => o.name)], correct: [0], note: `${x.name}: ${clean(x.desc)}`, used: [x.id] });
};
const I_wineByNotes: Tpl = (r, d) => {
  const w = pick(r, d.wines.filter((x) => sentences(x.notes).length >= 1)); if (!w) return null;
  const q = mask(cut(w.notes, 220), w.name, "this wine");
  if (q.length < 40) return null;
  return mk({ level: "Intermediate", area: "Wine", kind: "wine-notes", secs: 35, type: "one", text: "Which wine is described like this?", quote: q,
    opts: [w.name, ...sample(r, d.wines.filter((x) => x.id !== w.id), 3).map((x) => x.name)], correct: [0], note: `${w.name}: ${clean(w.region)}${w.grapes ? " · " + clean(w.grapes) : ""}.` });
};
const I_wineMulti: Tpl = (r, d, c) => {
  const ids = Object.keys(c.rec).filter((id) => c.rec[id].map((p) => p.rank).sort().join() === "1,2" && c.byId[id]);
  if (!ids.length) return null;
  const id = pick(r, ids); const ps = c.rec[id].slice().sort((a, b) => a.rank - b.rank);
  const wrong = sample(r, d.wines.filter((w) => !ps.some((p) => p.wine_id === w.id)), 3);
  return mk({ level: "Intermediate", area: "Wine pairing", kind: "wine-multi", secs: 35, type: "multi", text: `Select the wines the list recommends with ${c.byId[id].name} (best choice and second choice).`,
    opts: [...ps.map((p) => c.wineById[p.wine_id].name), ...wrong.map((w) => w.name)], correct: [0, 1],
    note: ps.map((p) => `${p.rank === 1 ? "Best" : "Also"}: ${c.wineById[p.wine_id].name}`).join("; "), used: [id] });
};
const I_match: Tpl = (r, d, c) => {
  const best: [string, string][] = [];
  Object.keys(c.rec).forEach((id) => { const p = c.rec[id].find((x) => x.rank === 1); if (p && c.byId[id] && c.wineById[p.wine_id]) best.push([id, p.wine_id]); });
  const used = new Set<string>(); const trio: [string, string][] = [];
  for (const [id, w] of shuffle(r, best)) { if (!used.has(w)) { used.add(w); trio.push([id, w]); } if (trio.length === 3) break; }
  if (trio.length < 3) return null;
  const extra = pick(r, d.wines.filter((w) => !used.has(w.id)));
  return mk({ level: "Intermediate", area: "Wine pairing", kind: "match", secs: 50, type: "match", text: "Match each dish to the wine the list recommends as its best choice.",
    lefts: trio.map(([id]) => c.byId[id].name), opts: [...trio.map(([, w]) => c.wineById[w].name), extra.name], correct: [0, 1, 2],
    note: trio.map(([id, w]) => `${c.byId[id].name} → ${c.wineById[w].name}`).join("; "), used: trio.map(([id]) => id) });
};

// ============================== ADVANCED: apply it with a guest ==============================
const veg = (x: Dish) => x.diet === "vegan" || x.diet === "vegetarian";
const A_cloze: Tpl = (r, d) => {
  for (let t = 0; t < 60; t++) {
    const x = pick(r, d.dishes.filter((y) => sentences(y.story).length >= 1)); if (!x) return null;
    const mine = new Set(words(x.ing.join(" "))); const nameSet = new Set(nameTokens(x.name).map((s) => s.toLowerCase()));
    for (const s of shuffle(r, sentences(x.story).filter((z) => z.length >= 45 && z.length <= 200))) {
      // never blank the house name or a word glued to an apostrophe ("Roberto’s")
      const hit = (s.match(/[A-Za-zàèéìòù]{5,}(?![A-Za-zàèéìòù’'])/g) || []).find((w) => mine.has(w.toLowerCase()) && !nameSet.has(w.toLowerCase()) && !STOP.test(w) && !/^roberto/i.test(w));
      if (!hit) continue;
      const plural = hit.toLowerCase().endsWith("s"); const lc = s.toLowerCase();
      const pool = Array.from(new Set(d.dishes.filter((o) => o.id !== x.id).flatMap((o) => words(o.ing.join(" "))))).filter((w) => !mine.has(w) && !lc.includes(w) && w.endsWith("s") === plural);
      if (pool.length < 3) continue;
      const cap = (w: string) => (hit[0] === hit[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w);
      const blanked = s.replace(new RegExp("\\b" + esc(hit) + "\\b"), "_____");
      return mk({ level: "Advanced", area: "Dish stories", kind: "cloze", secs: 45, type: "one", text: `Complete the story of ${x.name}.`, quote: blanked,
        opts: [hit, ...sample(r, pool, 3).map(cap)], correct: [0], note: `The word is "${hit}": ${s}`, used: [x.id] });
    }
  }
  return null;
};
const A_serviceInstruction: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => sentences(y.more).length >= 1 && longNote(y))); if (!x) return null;
  const real = cut(x.more, 200);
  const pool = d.dishes.filter((o) => o.id !== x.id && sentences(o.more).length >= 1 && longNote(o)).map((o) => cut(o.more, 200)).filter((s) => !sameText(s, real));
  const upool = Array.from(new Set(pool));
  if (upool.length < 3) return null;
  return mk({ level: "Advanced", area: "Service notes", kind: "service-instruction", secs: 50, type: "one", text: `Which of these is the note the Bible gives for ${x.name}?`,
    opts: [real, ...sample(r, upool, 3)], correct: [0], note: `${x.name}: ${real}`, used: [x.id] });
};
const A_twoIngredients: Tpl = (r, d, c) => {
  for (let t = 0; t < 200; t++) {
    const x = pick(r, d.dishes.filter((y) => y.ing.length >= 4)); if (!x) return null;
    const [a, b] = sample(r, x.ing.filter((l) => l.length >= 5), 2); if (!a || !b) continue;
    const has = (o: Dish, l: string) => o.ing.some((z) => z.toLowerCase() === l.toLowerCase());
    const both = d.dishes.filter((o) => has(o, a) && has(o, b)); if (both.length !== 1) continue;
    const onlyA = d.dishes.filter((o) => has(o, a) && !has(o, b)), onlyB = d.dishes.filter((o) => has(o, b) && !has(o, a));
    const decoys = [...sample(r, onlyA, 1), ...sample(r, onlyB, 1)];
    const rest = shuffle(r, d.dishes.filter((o) => o.id !== x.id && !decoys.includes(o) && !has(o, a) && !has(o, b)));
    while (decoys.length < 3 && rest.length) decoys.push(rest.pop()!);
    if (decoys.length < 3) continue;
    return mk({ level: "Advanced", area: "Ingredients", kind: "two-ingredients", secs: 45, type: "one", text: `Which dish is made with both ${a} and ${b}?`,
      opts: [x.name, ...decoys.map((o) => o.name)], correct: [0], note: `${x.name}: ${x.ing.join(", ")}.`, used: [x.id] });
  }
  return null;
};
const A_false: Tpl = (r, d) => {
  const x = pick(r, d.dishes.filter((y) => y.ing.length >= 3 && y.all.length >= 2 && y.garnish.length >= 1)); if (!x) return null;
  const others = d.dishes.filter((o) => o.id !== x.id);
  const trueS: string[] = [
    `It declares ${AL[pick(r, x.all)]}.`,
    `It is made with ${pick(r, x.ing)}.`,
    `It is garnished with ${pick(r, x.garnish)}.`,
  ];
  const gpool = others.flatMap((o) => o.garnish).filter((g) => !x.garnish.map((z) => z.toLowerCase()).includes(g.toLowerCase()) && g.length < 60);
  const ipool = others.flatMap((o) => o.ing).filter((l) => !x.ing.join(" ").toLowerCase().includes(l.toLowerCase().split(" ")[0]));
  const apool = COMMON.filter((k) => !x.all.includes(k));
  const falseOpts: string[] = [];
  if (gpool.length) falseOpts.push(`It is garnished with ${pick(r, gpool)}.`);
  if (ipool.length) falseOpts.push(`It is made with ${pick(r, ipool)}.`);
  if (apool.length) falseOpts.push(`It declares ${AL[pick(r, apool)]}.`);
  if (!falseOpts.length) return null;
  return mk({ level: "Advanced", area: "Dishes", kind: "false-statement", secs: 55, type: "one", text: `Three of these statements about ${x.name} are true. Which one is FALSE?`,
    opts: [pick(r, falseOpts), ...trueS], correct: [0], note: `${x.name}: ${x.ing.join(", ")}. Garnish: ${x.garnish.join("; ")}. Declares: ${nm(x.all)}.`, used: [x.id] });
};
const A_allergenGuest: Tpl = (r, d) => {
  const [a, b] = sample(r, COMMON, 2);
  const safe = d.dishes.filter((x) => !x.all.includes(a) && !x.all.includes(b)), uns = d.dishes.filter((x) => x.all.includes(a) || x.all.includes(b));
  if (safe.length < 2 || uns.length < 4) return null;
  const s = sample(r, safe, 2), u = sample(r, uns, 4), all = [...s, ...u];
  return mk({ level: "Advanced", area: "Guest scenario", kind: "allergen-guest", secs: 75, type: "multi",
    text: `A guest cannot eat ${AL[a].toLowerCase()} or ${AL[b].toLowerCase()}. Select every dish below that is safe for them.`,
    opts: all.map((x) => x.name), correct: [0, 1], note: all.map((x) => `${x.name}: ${nm(x.all)}`).join("; "), used: s.map((x) => x.id) });
};
const A_vegGuest: Tpl = (r, d) => {
  const ok = d.dishes.filter((x) => veg(x) && !x.all.includes("milk") && !x.all.includes("egg"));
  const no = d.dishes.filter((x) => (veg(x) && (x.all.includes("milk") || x.all.includes("egg"))) ||
    (!veg(x) && !x.all.includes("milk") && !x.all.includes("egg") && !x.all.some((k) => ["fish", "crustacean", "mollusc"].includes(k))));
  if (ok.length < 2 || no.length < 4) return null;
  const s = sample(r, ok, 2), u = sample(r, no, 4), all = [...s, ...u];
  return mk({ level: "Advanced", area: "Guest scenario", kind: "veg-guest", secs: 75, type: "multi",
    text: "A guest is vegetarian and cannot have milk or egg. Select every dish below that is marked vegetarian or vegan AND free of both.",
    opts: all.map((x) => x.name), correct: [0, 1], note: all.map((x) => `${x.name} (${x.diet || "no diet mark"}; ${nm(x.all)})`).join("; "), used: s.map((x) => x.id) });
};
const A_noRed: Tpl = (r, d, c) => {
  const cs: [string, Pairing, Pairing][] = [];
  Object.keys(c.rec).forEach((id) => {
    const b = c.rec[id].find((p) => p.rank === 1), a = c.rec[id].find((p) => p.rank === 2);
    if (b && a && c.byId[id] && c.wineById[b.wine_id]?.style === "red" && c.wineById[a.wine_id] && c.wineById[a.wine_id].style !== "red") cs.push([id, b, a]);
  });
  if (!cs.length) return null;
  const [id, b, a] = pick(r, cs);
  const dist = sample(r, d.wines.filter((w) => w.id !== b.wine_id && w.id !== a.wine_id && w.style !== "red"), 3);
  if (dist.length < 3) return null;
  return mk({ level: "Advanced", area: "Guest scenario", kind: "no-red", secs: 60, type: "one",
    text: `A guest orders ${c.byId[id].name} but does not drink red. Which wine do you offer from the list's recommendations?`,
    opts: [c.wineById[a.wine_id].name, ...dist.map((w) => w.name)], correct: [0],
    note: `Best choice is ${c.wineById[b.wine_id].name} (red). Second choice: ${c.wineById[a.wine_id].name}. ${a.why}`, used: [id] });
};
const A_why: Tpl = (r, d, c) => {
  const pp = d.pairings.filter((p) => p.rank === 1 && c.byId[p.recipe_id] && c.wineById[p.wine_id] && (p.why || "").length > 60);
  if (pp.length < 4) return null;
  const p = pick(r, pp);
  const uniq: Pairing[] = []; const seen = new Set<string>([p.why]);
  shuffle(r, pp).forEach((x) => { if (x.wine_id !== p.wine_id && x.recipe_id !== p.recipe_id && !seen.has(x.why)) { seen.add(x.why); uniq.push(x); } });
  if (uniq.length < 3) return null;
  return mk({ level: "Advanced", area: "Wine pairing", kind: "why", secs: 60, type: "one",
    text: `${c.wineById[p.wine_id].name} is the best pairing for ${c.byId[p.recipe_id].name}. Which explanation is the one on the list?`,
    opts: [p.why, ...uniq.slice(0, 3).map((x) => x.why)], correct: [0], note: "The list gives this reason for this pairing.", used: [p.recipe_id] });
};
const A_sharedWine: Tpl = (r, d, c) => {
  const ids = Object.keys(c.rec).filter((id) => c.byId[id]);
  for (let t = 0; t < 400; t++) {
    const x = pick(r, ids), y = pick(r, ids); if (x === y) continue;
    const wx = new Set(c.rec[x].map((p) => p.wine_id)), wy = new Set(c.rec[y].map((p) => p.wine_id));
    const both = [...wx].filter((w) => wy.has(w)); if (both.length !== 1) continue;
    const onlyX = [...wx].filter((w) => !wy.has(w)), onlyY = [...wy].filter((w) => !wx.has(w));
    const none = d.wines.filter((w) => !wx.has(w.id) && !wy.has(w.id));
    if (!onlyX.length || !onlyY.length || !none.length) continue;
    return mk({ level: "Advanced", area: "Guest scenario", kind: "shared-wine", secs: 60, type: "one",
      text: `A table orders ${c.byId[x].name} and ${c.byId[y].name} and wants one bottle that the list recommends for both. Which wine?`,
      opts: [c.wineById[both[0]].name, c.wineById[pick(r, onlyX)].name, c.wineById[pick(r, onlyY)].name, pick(r, none).name], correct: [0],
      note: `Recommended for both: ${c.wineById[both[0]].name}.`, used: [x, y] });
  }
  return null;
};

const I_garnishToDish: Tpl = (r, d, c) => {
  const cands: [Dish, string][] = [];
  d.dishes.forEach((x) => x.garnish.forEach((g) => { if (g.length >= 8 && g.length < 60 && c.garCount[g.toLowerCase()] === 1) cands.push([x, g]); }));
  if (!cands.length) return null;
  const [x, g] = pick(r, cands);
  const key = words(g).pop() || g.toLowerCase();
  const others = sameSectionFirst(r, x, d.dishes.filter((o) => o.id !== x.id && !o.garnish.join(" ").toLowerCase().includes(key))).slice(0, 3);
  if (others.length < 3) return null;
  return mk({ level: "Intermediate", area: "Garnish", kind: "garnish-dish", secs: 30, type: "one", text: `Which dish is finished with ${g}?`,
    opts: [x.name, ...others.map((o) => o.name)], correct: [0], note: `${x.name}: ${x.garnish.join("; ")}.`, used: [x.id] });
};
const A_oneSafe: Tpl = (r, d) => {
  const [a, b] = sample(r, COMMON, 2);
  const safe = d.dishes.filter((x) => !x.all.includes(a) && !x.all.includes(b)), uns = d.dishes.filter((x) => x.all.includes(a) || x.all.includes(b));
  if (!safe.length || uns.length < 3) return null;
  const s = pick(r, safe);
  return mk({ level: "Advanced", area: "Guest scenario", kind: "one-safe", secs: 60, type: "one",
    text: `A guest cannot have ${AL[a].toLowerCase()} or ${AL[b].toLowerCase()}. Which ONE of these dishes can they eat?`,
    opts: [s.name, ...sample(r, uns, 3).map((x) => x.name)], correct: [0], note: `${s.name} declares: ${nm(s.all)}.`, used: [s.id] });
};

// every template is used at most once per test, so no two questions are the same kind
const PLAN: [Q["level"], Tpl[], number][] = [
  ["Basic", [B_allergen, B_dishByIngredient, B_oddIngredient, B_wineRegion], 4],
  ["Intermediate", [I_storyToDish, I_noteToDish, I_storySentence, I_garnish, I_descToDish, I_wineByNotes, I_wineMulti, I_match, I_garnishToDish], 7],
  ["Advanced", [A_cloze, A_serviceInstruction, A_twoIngredients, A_false, A_allergenGuest, A_vegGuest, A_noRed, A_why, A_sharedWine, A_oneSafe], 9],
];

// Put the options in random order and remember where the right ones went. Done last, for every question,
// so the right answer is never first, longest or most detailed by habit of the template.
function mix(r: R, q: Q): Q {
  const idx = shuffle(r, q.opts.map((_, i) => i));
  const pos = (old: number) => idx.indexOf(old);
  q.opts = idx.map((i) => q.opts[i]);
  q.correct = q.type === "match" ? q.correct.map(pos) : q.correct.map(pos).sort((a, b) => a - b);
  return q;
}

export function buildTest(data: Data, seed: number): Q[] {
  const r = rngFrom(seed);
  const byId: Record<string, Dish> = {}; data.dishes.forEach((x) => (byId[x.id] = x));
  const wineById: Record<string, Wine> = {}; data.wines.forEach((x) => (wineById[x.id] = x));
  const rec: Record<string, Pairing[]> = {};
  data.pairings.forEach((p) => { if (byId[p.recipe_id] && wineById[p.wine_id]) (rec[p.recipe_id] = rec[p.recipe_id] || []).push(p); });
  const ingCount: Record<string, number> = {}, garCount: Record<string, number> = {};
  data.dishes.forEach((x) => {
    new Set(x.ing.map((l) => l.toLowerCase())).forEach((l) => (ingCount[l] = (ingCount[l] || 0) + 1));
    new Set(x.garnish.map((l) => l.toLowerCase())).forEach((l) => (garCount[l] = (garCount[l] || 0) + 1));
  });
  const ctx: Ctx = { ingCount, garCount, byId, wineById, rec };
  const out: Q[] = []; const usedDish = new Set<string>(); const seenText = new Set<string>();
  for (const [, tpls, n] of PLAN) {
    const order = shuffle(r, tpls); let made = 0;
    for (const t of order) {
      if (made >= n) break;
      let q: Q | null = null;
      for (let k = 0; k < 40 && !q; k++) {
        const c = t(r, data, ctx);
        if (c && !seenText.has(c.text + (c.quote || "")) && !(c.used || []).some((id) => usedDish.has(id))) q = c;
      }
      if (q) { seenText.add(q.text + (q.quote || "")); (q.used || []).forEach((id) => usedDish.add(id)); out.push(mix(r, q)); made++; }
    }
    let guard = 0;
    while (made < n && guard++ < 200) {
      const t = pick(r, tpls); const c = t(r, data, ctx);
      if (c && !out.some((o) => o.kind === c.kind) && !seenText.has(c.text + (c.quote || "")) && !(c.used || []).some((id) => usedDish.has(id))) {
        seenText.add(c.text + (c.quote || "")); (c.used || []).forEach((id) => usedDish.add(id)); out.push(mix(r, c)); made++;
      }
    }
  }
  return out;
}

// One question without its answer, as the phone sees it.
export function publicQ(q: Q) {
  return { level: q.level, area: q.area, secs: q.secs, type: q.type, text: q.text, quote: q.quote || null, opts: q.opts, lefts: q.lefts || null };
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
