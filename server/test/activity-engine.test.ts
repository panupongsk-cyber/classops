// Learning-activity engine unit tests. Synthetic fixtures only -- this repository is public,
// and real activity packages (with answer keys) never enter it.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ActivityAnswerError,
  aggregate,
  correctAnswer,
  itemFeedback,
  localize,
  newSeed,
  optionToken,
  orderedOptions,
  orderedRows,
  packageHash,
  projectItem,
  projectStage,
  rowToken,
  runRecipe,
  type RecipeFeedback,
  type RecipeStep,
  scoreItem,
  validatePackage,
  type DiagramPickPart,
  type MultiSelectPart,
  type PolicyBuilderPart,
  type PolicyFeedback,
  type RecipePipelinePart,
  type OrderingPart,
  type RowPart,
  type SingleChoicePart,
} from "../src/activities/engine.js";
import { syntheticPackage } from "./fixtures/synthetic-activity.js";

const SEED = "00112233445566778899aabbccddeeff";
const SEED2 = "ffeeddccbbaa99887766554433221100";
const t = (en: string) => ({ en });
const tok = (item: string, part: string, id: string, seed = SEED) => optionToken(seed, item, part, id);
const rows = (item: string, part: string, map: Record<string, string>, seed = SEED) =>
  Object.fromEntries(Object.entries(map).map(([id, cat]) => [rowToken(seed, item, part, id), cat]));
const i1 = (one: string, map: Record<string, string>) => ({ one: tok("i1", "one", one), rows: rows("i1", "rows", map) });
const i2 = (pair: string[], many: string[]) => ({
  pair: pair.map((id) => tok("i2", "pair", id)),
  many: many.map((id) => tok("i2", "many", id)),
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test("cross-engine vectors match the private reference engine (activity-engine.mjs)", () => {
  // Computed with the reference module; the token/shuffle scheme must stay byte-identical.
  const seed = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
  const part = {
    key: "p",
    type: "single_choice",
    weight: 1,
    shuffle: true,
    options: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, label: t(id) })),
    answer_key: "a",
  } satisfies SingleChoicePart;
  const rowPart = {
    key: "rp",
    type: "categorize",
    weight: 1,
    shuffle: true,
    rows: ["r1", "r2", "r3", "r4", "r5"].map((id) => ({ id, label: t(id) })),
    categories: [],
    answer_key: {},
  } satisfies RowPart;
  assert.equal(optionToken(seed, "item-1", "p", "a"), "te77a68f37568bca2");
  assert.equal(optionToken(seed, "item-1", "p", "ข้อ"), "tf7292cbf99e5eaa4");
  assert.equal(rowToken(seed, "item-1", "rp", "r1"), "rdfa44d4746a46909");
  assert.equal(orderedOptions(seed, "item-1", part).map((o) => o.id).join(""), "cbdfae");
  assert.equal(orderedRows(seed, "item-1", rowPart).map((r) => r.id).join(","), "r3,r2,r5,r4,r1");
  assert.equal(
    packageHash({ b: [1, { y: "ก", x: null }], a: true }),
    "35d1a1ba80a650fa125cfdcbcbaa4db0be2c92d94563df73ea858d8003762e37",
  );
});

test("the synthetic package is valid", () => {
  assert.deepEqual(validatePackage(syntheticPackage()), []);
});

test("validation catches broken keys, weights, languages, bands, and flags", () => {
  const p = syntheticPackage() as unknown as {
    stages: { items: { parts: Record<string, unknown>[]; rules: Record<string, unknown>[] }[] }[];
    languages: string[];
    bands: { min_percent: number }[];
  };
  p.stages[0]!.items[0]!.parts[0]!.answer_key = "zzz";
  p.stages[0]!.items[0]!.parts[1]!.weight = 0.5;
  p.languages = ["en", "th"];
  p.bands[2]!.min_percent = 10;
  p.stages[1]!.items[0]!.rules[0]!.flag = "undefined-flag";
  const errors = validatePackage(p).join("\n");
  assert.match(errors, /answer_key: must be one of the option ids/);
  assert.match(errors, /weights sum to 1.1/);
  assert.match(errors, /missing th text/);
  assert.match(errors, /last band must have min_percent 0/);
  assert.match(errors, /flag undefined-flag is not defined/);
  assert.deepEqual(validatePackage("nope"), ["$: package must be an object"]);
});

test("credit_by_correct requires min = max = key size", () => {
  const p = syntheticPackage();
  (p.stages[1]!.items[0]!.parts[0] as MultiSelectPart).max = 3;
  assert.match(validatePackage(p).join("\n"), /credit_by_correct requires min = max = key.length/);
});

test("tokens are opaque, stable within a seed, and different across seeds and namespaces", () => {
  const a = tok("i1", "one", "b");
  assert.match(a, /^t[0-9a-f]{16}$/);
  assert.equal(a, tok("i1", "one", "b"));
  assert.notEqual(a, tok("i1", "one", "b", SEED2));
  assert.notEqual(a, tok("i1", "one", "a"));
  assert.notEqual(rowToken(SEED, "i1", "one", "b").slice(1), a.slice(1));
  assert.throws(() => optionToken("short", "i1", "one", "b"), TypeError);
  assert.match(newSeed(), /^[0-9a-f]{32}$/);
});

test("option and row order are seeded; unshuffled parts keep package order", () => {
  const pkg = syntheticPackage();
  const part = pkg.stages[0]!.items[0]!.parts[0] as SingleChoicePart;
  const order = (seed: string) => orderedOptions(seed, "i1", part).map((o) => o.id).join("");
  assert.equal(order(SEED), order(SEED));
  assert.ok(new Set(Array.from({ length: 40 }, () => order(newSeed()))).size > 1);
  const fixed = pkg.stages[1]!.items[0]!.parts[0] as MultiSelectPart;
  assert.deepEqual(orderedOptions(SEED, "i2", fixed).map((o) => o.id), ["p", "q", "r", "s"]);
  const verdicts = pkg.stages[1]!.items[1]!.parts[0] as RowPart;
  assert.deepEqual(orderedRows(SEED, "i3", verdicts).map((r) => r.id), ["c1", "c2"]);
});

test("projection is an allowlist: no keys, ids, weights, rules, or explanation", () => {
  const pkg = syntheticPackage();
  for (const key of ["i1", "i2", "i3"]) {
    const view = projectItem(pkg, key, SEED, "en");
    const json = JSON.stringify(view);
    for (const banned of ["answer_key", "scoring", "weight", "rules", "explanation", "credit", "allowed", "Because"]) {
      assert.ok(!json.includes(banned), `${key} projection leaks ${banned}`);
    }
    for (const part of view.parts) {
      for (const o of part.options ?? []) {
        assert.deepEqual(Object.keys(o).sort(), ["label", "token"]);
        assert.match(o.token, /^t[0-9a-f]{16}$/);
      }
      for (const r of part.rows ?? []) {
        assert.deepEqual(Object.keys(r).sort(), ["label", "token"]);
        assert.match(r.token, /^r[0-9a-f]{16}$/);
      }
    }
  }
  const ids = ["a", "b", "c", "p", "q", "r", "s", "m1", "m2", "m3", "m4", "r1", "r2", "c1", "c2"];
  for (const key of ["i1", "i2", "i3"]) {
    const tokens = JSON.stringify(
      projectItem(pkg, key, SEED, "en").parts.map((p) => [...(p.options ?? []), ...(p.rows ?? [])].map((x) => x.token)),
    );
    for (const id of ids) assert.ok(!tokens.includes(`"${id}"`), `${key} leaks ${id}`);
  }
  assert.deepEqual(projectStage(pkg, "s2", "en"), { key: "s2", title: "Stage two", items: 2 });
});

test("scoring combines weighted parts", () => {
  const pkg = syntheticPackage();
  assert.equal(scoreItem(pkg, "i1", i1("b", { r1: "X", r2: "Y" }), SEED).ratio, 1);
  near(scoreItem(pkg, "i1", i1("a", { r1: "X", r2: "Y" }), SEED).ratio, 0.4);
  near(scoreItem(pkg, "i1", i1("b", { r1: "Y", r2: "Y" }), SEED).ratio, 0.8);
  near(scoreItem(pkg, "i2", i2(["p", "r"], ["m1", "m2"]), SEED).ratio, 0.5 * 0.5 + 0.5 * (2 / 3));
  assert.deepEqual(scoreItem(pkg, "i3", { v: rows("i3", "v", { c1: "CAN", c2: "CAN" }) }, SEED).parts, { v: 0.5 });
});

test("threshold_no_wrong matches the reference engine's pinned vectors", () => {
  // Same vectors as the private reference test (activity-engine.test.mjs).
  const pkg = syntheticPackage();
  pkg.stages[1]!.items[0]!.parts[1] = {
    key: "many",
    type: "multi_select",
    weight: 0.5,
    shuffle: true,
    options: ["m1", "m2", "m3", "m4", "m5"].map((id) => ({ id, label: t(id) })),
    min: 1,
    max: null,
    scoring: { mode: "threshold_no_wrong", key: ["m1", "m2", "m3", "m4"], threshold: 3, partial_factor: 0.3 },
  };
  pkg.stages[1]!.items[0]!.rules = [];
  assert.deepEqual(validatePackage(pkg), []);
  const many = (ids: string[]) =>
    scoreItem(pkg, "i2", { pair: i2(["p", "q"], []).pair, many: ids.map((id) => tok("i2", "many", id)) }, SEED).parts.many;
  const cases: [string[], number][] = [
    [["m1"], 0.1],
    [["m1", "m2"], 0.2],
    [["m1", "m2", "m3"], 0.75],
    [["m1", "m2", "m3", "m4"], 1],
    [["m1", "m5"], 0],
    [["m1", "m2", "m3", "m4", "m5"], 0],
  ];
  for (const [ids, expected] of cases) near(many(ids) ?? -1, expected);
  const bad = structuredClone(pkg);
  (bad.stages[1]!.items[0]!.parts[1] as MultiSelectPart & { scoring: { threshold: number } }).scoring.threshold = 5;
  assert.match(validatePackage(bad).join("\n"), /threshold: must be an integer between 1 and key.length/);
});

test("ordering matches the reference engine's pinned vectors", () => {
  // Same vectors as the private reference test (activity-engine.test.mjs).
  const pkg = syntheticPackage();
  pkg.stages[1]!.items[1]!.parts = [
    {
      key: "seq",
      type: "ordering",
      weight: 1,
      shuffle: true,
      options: ["s1", "s2", "s3", "s4"].map((id) => ({ id, label: t(id) })),
      scoring: { mode: "positional" },
    },
  ];
  assert.deepEqual(validatePackage(pkg), []);
  const seq = (ids: string[]) => ({ seq: ids.map((id) => tok("i3", "seq", id)) });
  const cases: [string[], number][] = [
    [["s1", "s2", "s3", "s4"], 1],
    [["s2", "s1", "s3", "s4"], 0.5],
    [["s4", "s1", "s2", "s3"], 0],
    [["s1", "s3", "s2", "s4"], 0.5],
  ];
  for (const [ids, expected] of cases) assert.equal(scoreItem(pkg, "i3", seq(ids), SEED).ratio, expected, `${ids}`);
  (pkg.stages[1]!.items[1]!.parts[0] as OrderingPart).scoring.mode = "exact";
  assert.equal(scoreItem(pkg, "i3", seq(["s1", "s2", "s3", "s4"]), SEED).ratio, 1);
  assert.equal(scoreItem(pkg, "i3", seq(["s2", "s1", "s3", "s4"]), SEED).ratio, 0);
  for (const bad of [["s1", "s2", "s3"], ["s1", "s1", "s2", "s3"], ["s1", "s2", "s3", "s4", "s1"]]) {
    assert.throws(() => scoreItem(pkg, "i3", seq(bad), SEED), ActivityAnswerError);
  }
  const view = projectItem(pkg, "i3", SEED, "en").parts[0]!;
  assert.deepEqual(Object.keys(view).sort(), ["key", "options", "type"]);
  assert.deepEqual(correctAnswer(pkg.stages[1]!.items[1]!, SEED).seq, ["s1", "s2", "s3", "s4"].map((id) => tok("i3", "seq", id)));
  const unshuffled = structuredClone(pkg) as unknown as { stages: { items: { parts: Record<string, unknown>[] }[] }[] };
  unshuffled.stages[1]!.items[1]!.parts[0]!.shuffle = false;
  assert.match(validatePackage(unshuffled).join("\n"), /an ordering part must be shuffled/);
});

test("C2 vectors: exact_set, select_then_tag + select_minimums, matrix_multi", () => {
  // Same vectors as the private reference test (activity-engine.test.mjs), under generic keys.
  const pkg = syntheticPackage();
  pkg.flags!.thin = { title: t("Too few picks"), body: t("Pick more.") };
  pkg.stages[1]!.items[1]!.parts = [
    {
      key: "set",
      type: "multi_select",
      weight: 0.2,
      shuffle: true,
      options: ["g1", "g2", "g3"].map((id) => ({ id, label: t(id) })),
      min: 1,
      max: null,
      scoring: { mode: "exact_set", key: ["g1", "g2"] },
    },
    {
      key: "stack",
      type: "select_then_tag",
      weight: 0.6,
      shuffle: true,
      options: ["L1", "L2", "L3", "L4", "L5"].map((id) => ({ id, label: t(id) })),
      tags: ["A", "B", "C"].map((id) => ({ id, label: t(id) })),
      answer_key: { L1: "A", L2: "B", L3: "B", L4: "B", L5: "C" },
      min: 1,
      max: null,
      scoring: { count_target: 5, count_weight: 0.35, tag_weight: 0.25 },
    },
    {
      key: "grid",
      type: "matrix_multi",
      weight: 0.2,
      rows: ["r1", "r2"].map((id) => ({ id, label: t(id) })),
      dimensions: [
        { key: "fn", label: t("Axis 1"), options: ["P", "D", "R"].map((id) => ({ id, label: t(id) })) },
        { key: "nat", label: t("Axis 2"), options: ["T", "A"].map((id) => ({ id, label: t(id) })) },
      ],
      answer_key: { r1: { fn: ["P"], nat: ["T"] }, r2: { fn: ["P", "D"], nat: ["A"] } },
    },
  ];
  pkg.stages[1]!.items[1]!.rules = [{ type: "select_minimums", part: "stack", min_selected: 3, min_distinct_key_tags: 2, flag: "thin" }];
  assert.deepEqual(validatePackage(pkg), []);
  const it = "i3";
  type Cells = Record<string, string[]>;
  const set = (ids: string[]) => ids.map((id) => tok(it, "set", id));
  const stack = (picks: Record<string, string>) => ({
    selected: Object.keys(picks).map((id) => tok(it, "stack", id)),
    tags: Object.fromEntries(Object.entries(picks).map(([id, tag]) => [tok(it, "stack", id), tag])),
  });
  const grid = (r1: Cells, r2: Cells) => ({ [rowToken(SEED, it, "grid", "r1")]: r1, [rowToken(SEED, it, "grid", "r2")]: r2 });
  const good = { r1: { fn: ["P"], nat: ["T"] }, r2: { fn: ["P", "D"], nat: ["A"] } };
  const score = (g: string[], st: Record<string, string>, so: { r1: Cells; r2: Cells }) =>
    scoreItem(pkg, it, { set: set(g), stack: stack(st), grid: grid(so.r1, so.r2) }, SEED);
  const three = { L1: "A", L2: "B", L5: "C" };
  const all = { L1: "A", L2: "B", L3: "B", L4: "B", L5: "C" };
  near(score(["g1", "g2"], three, good).parts.set!, 1);
  near(score(["g1"], three, good).parts.set!, 0);
  near(score(["g1", "g2", "g3"], three, good).parts.set!, 0);
  near(score(["g1", "g2"], { L1: "A", L2: "C", L5: "C" }, good).parts.stack!, (0.35 * 0.6 + 0.25 * (2 / 3)) / 0.6);
  near(score(["g1", "g2"], all, good).parts.stack!, 1);
  const few = score(["g1", "g2"], { L1: "A", L2: "B" }, good);
  assert.deepEqual([few.ratio, few.flags], [0, ["thin"]]);
  const narrow = score(["g1", "g2"], { L2: "B", L3: "B", L4: "B" }, good);
  assert.deepEqual([narrow.ratio, narrow.flags], [0, ["thin"]]);
  near(score(["g1", "g2"], three, good).parts.grid!, 1);
  near(score(["g1", "g2"], three, { r1: { fn: ["P", "D"], nat: ["T"] }, r2: { fn: ["P"], nat: ["T"] } }).parts.grid!, 0.4375);
  near(score(["g1", "g2"], all, good).ratio, 1);
  const bad = (answer: unknown) => assert.throws(() => scoreItem(pkg, it, answer, SEED), ActivityAnswerError);
  const base = { set: set(["g1"]), stack: stack(three), grid: grid(good.r1, good.r2) };
  const L1 = tok(it, "stack", "L1");
  bad({ ...base, stack: { selected: [L1], tags: {} } });
  bad({ ...base, stack: { selected: [L1], tags: { [L1]: "A", [tok(it, "stack", "L2")]: "B" } } });
  bad({ ...base, stack: { selected: [L1], tags: { [L1]: "Z" } } });
  bad({ ...base, grid: grid({ fn: [], nat: ["T"] }, good.r2) });
  bad({ ...base, grid: { [rowToken(SEED, it, "grid", "r1")]: good.r1 } });
  const correct = correctAnswer(pkg.stages[1]!.items[1]!, SEED) as Record<string, Record<string, unknown>>;
  assert.equal(correct.stack![tok(it, "stack", "L5")], "C");
  assert.deepEqual(correct.grid![rowToken(SEED, it, "grid", "r2")], { fn: ["P", "D"], nat: ["A"] });
  const view = projectItem(pkg, it, SEED, "en");
  assert.deepEqual(Object.keys(view.parts[1]!).sort(), ["key", "max", "min", "options", "tags", "type"]);
  assert.deepEqual(Object.keys(view.parts[2]!).sort(), ["dimensions", "key", "rows", "type"]);
  assert.ok(!JSON.stringify(view).includes("answer_key"));
  const broken = structuredClone(pkg) as unknown as { stages: { items: { parts: { scoring: Record<string, number> }[] }[] }[] };
  broken.stages[1]!.items[1]!.parts[1]!.scoring.count_weight = 0.5;
  assert.match(validatePackage(broken).join("\n"), /count_weight \+ tag_weight must equal the part weight/);
});

test("a firing rule zeroes the item and raises its flag", () => {
  const pkg = syntheticPackage();
  const r1 = scoreItem(pkg, "i1", i1("b", { r1: "X", r2: "X" }), SEED);
  assert.deepEqual([r1.ratio, r1.flags], [0, ["bad"]]);
  const r2 = scoreItem(pkg, "i2", i2(["p", "q"], ["m1", "m2", "m3", "m4"]), SEED);
  assert.deepEqual([r2.ratio, r2.flags], [0, ["bad"]]);
});

test("duplicate tokens collapse and cannot add credit", () => {
  const pkg = syntheticPackage();
  const p = tok("i2", "pair", "p");
  assert.throws(() => scoreItem(pkg, "i2", { pair: [p, p], many: [tok("i2", "many", "m1")] }, SEED), ActivityAnswerError);
  const m1 = tok("i2", "many", "m1");
  near(scoreItem(pkg, "i2", { pair: i2(["p", "q"], []).pair, many: [m1, m1, m1] }, SEED).parts.many ?? -1, 1 / 3);
});

test("incomplete, foreign, and out-of-bounds answers are rejected", () => {
  const pkg = syntheticPackage();
  const bad = (key: string, answer: unknown) => assert.throws(() => scoreItem(pkg, key, answer, SEED), ActivityAnswerError);
  bad("i1", { one: tok("i1", "one", "b") });
  bad("i1", { ...i1("b", { r1: "X", r2: "Y" }), extra: 1 });
  bad("i1", i1("b", { r1: "X" }));
  bad("i1", { ...i1("b", { r1: "X", r2: "Y" }), rows: { ...rows("i1", "rows", { r1: "X", r2: "Y" }), rzzz: "X" } });
  bad("i1", i1("b", { r1: "X", r2: "Z" }));
  bad("i1", { one: "b", rows: rows("i1", "rows", { r1: "X", r2: "Y" }) });
  bad("i1", { one: tok("i1", "one", "b", SEED2), rows: rows("i1", "rows", { r1: "X", r2: "Y" }) });
  bad("i1", { one: tok("i1", "one", "b"), rows: { r1: "X", r2: "Y" } });
  bad("i2", i2(["p"], ["m1"]));
  bad("i2", i2(["p", "q", "r"], ["m1"]));
  bad("i2", i2(["p", "q"], []));
  bad("i2", { pair: "tnotalist", many: [] });
  bad("i3", "not an object");
});

test("feedback reveals the correct answer only when asked", () => {
  const pkg = syntheticPackage();
  const result = scoreItem(pkg, "i1", i1("a", { r1: "X", r2: "Y" }), SEED);
  const hidden = itemFeedback(pkg, "i1", result, SEED, "en");
  assert.equal(hidden.explanation, "Because.");
  assert.equal(hidden.correct, undefined);
  pkg.reveal = "after_item";
  assert.deepEqual(itemFeedback(pkg, "i1", result, SEED, "en").correct, {
    one: tok("i1", "one", "b"),
    rows: rows("i1", "rows", { r1: "X", r2: "Y" }),
  });
  const zeroed = scoreItem(pkg, "i1", i1("b", { r1: "X", r2: "X" }), SEED);
  assert.deepEqual(itemFeedback(pkg, "i1", zeroed, SEED, "en").flags, [
    { key: "bad", title: "Bad pick", body: "That option is forbidden." },
  ]);
  assert.deepEqual(correctAnswer(pkg.stages[1]!.items[0]!, SEED).pair, [tok("i2", "pair", "p"), tok("i2", "pair", "q")]);
});

test("aggregation: stage_mean vs item_mean, missing items count 0, bands at exact thresholds", () => {
  const pkg = syntheticPackage();
  const a = aggregate(pkg, { i1: 1, i2: 1, i3: 0 });
  assert.deepEqual(a.stage_results, { s1: 1, s2: 0.5 });
  assert.equal(a.score_ratio, 0.75);
  assert.equal(a.band_index, 1);
  pkg.aggregate = "item_mean";
  near(aggregate(pkg, { i1: 1, i2: 1, i3: 0 }).score_ratio, 2 / 3);
  assert.deepEqual([aggregate(pkg, { i1: 1 }).answered, aggregate(pkg, { i1: 1 }).total], [1, 3]);
  const template = pkg.stages[1]!.items[1]!;
  pkg.stages = [{ key: "s", title: t("S"), items: Array.from({ length: 10 }, (_, i) => ({ ...template, key: `k${i}` })) }];
  const ratios = (n: number) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i < n ? 1 : 0]));
  assert.equal(aggregate(pkg, ratios(9)).band_index, 0);
  assert.equal(aggregate(pkg, ratios(8)).band_index, 1);
  assert.equal(aggregate(pkg, ratios(5)).band_index, 1);
  assert.equal(aggregate(pkg, ratios(4)).band_index, 2);
});

test("localize falls back to any available language", () => {
  assert.equal(localize({ th: "ก", en: "a" }, "en"), "a");
  assert.equal(localize({ th: "ก" }, "en"), "ก");
  assert.equal(localize(undefined, "en"), undefined);
});

// Phase 4a (all_correct, accepted_sets, diagram_pick): same fixture and vectors as the
// private reference test (activity-engine.test.mjs).
function phase4Package() {
  const pkg = syntheticPackage();
  pkg.stages = [
    {
      key: "s1",
      title: t("Stage"),
      items: [
        {
          key: "builder",
          all_correct: true,
          parts: ["a", "b"].map((k) => ({
            key: k,
            type: "single_choice" as const,
            weight: 0.5,
            shuffle: true,
            options: [
              { id: `${k}1`, label: t("one") },
              { id: `${k}2`, label: t("two") },
            ],
            answer_key: `${k}1`,
          })),
        },
        {
          key: "tools",
          parts: [
            {
              key: "pick",
              type: "multi_select",
              weight: 1,
              shuffle: true,
              min: 1,
              max: null,
              options: ["W", "L", "A", "X"].map((id) => ({ id, label: t(id) })),
              scoring: { mode: "accepted_sets", sets: [["W", "L"], ["W", "A"], ["W", "L", "A"]] },
            },
          ],
        },
        {
          key: "dfd",
          all_correct: true,
          parts: [
            {
              key: "node",
              type: "diagram_pick",
              weight: 0.5,
              diagram: {
                view_box: [600, 300],
                nodes: [
                  { id: "user", label: t("User"), kind: "entity", x: 80, y: 150, detail: t("An external user") },
                  { id: "app", label: t("App"), kind: "process", x: 260, y: 150 },
                  { id: "files", label: t("Files"), kind: "store", x: 440, y: 150 },
                ],
                flows: [
                  { id: "f1", from: "user", to: "app", label: t("Request") },
                  { id: "f2", from: "app", to: "files", label: t("Write") },
                ],
                boundaries: [{ id: "b1", label: t("Boundary"), x1: 170, y1: 30, x2: 170, y2: 270 }],
              },
              answer_key: "files",
            },
            {
              key: "letter",
              type: "single_choice",
              weight: 0.5,
              shuffle: false,
              options: [
                { id: "T", label: t("Letter one") },
                { id: "I", label: t("Letter two") },
              ],
              answer_key: "T",
            },
          ],
        },
      ],
    },
  ];
  return pkg;
}

test("phase 4 cross-engine vectors match the private reference engine", () => {
  const pkg = phase4Package();
  const s = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
  assert.deepEqual(
    projectItem(pkg, "tools", s, "en").parts[0]!.options!.map((o) => [o.token, o.label]),
    [["ta5d6a1ba21b8ae22", "L"], ["t4e7e2c443f98312e", "X"], ["t7707a675081c220b", "A"], ["t994eb52a99f2e519", "W"]],
  );
  assert.deepEqual(
    projectItem(pkg, "dfd", s, "en").parts[0]!.diagram!.nodes.map((n) => n.token),
    ["t3598693463cfd43f", "tf6302bcd68be99db", "taac9898cd0ca4587"],
  );
  assert.deepEqual(
    projectItem(pkg, "builder", s, "en").parts.map((p) => p.options!.map((o) => o.label)),
    [["two", "one"], ["one", "two"]],
  );
});

test("phase 4 package validates, and bad accepted_sets / diagram parts are rejected", () => {
  assert.deepEqual(validatePackage(phase4Package()), []);
  const bad = phase4Package();
  (bad.stages[0]!.items[1]!.parts[0] as MultiSelectPart).scoring = { mode: "accepted_sets", sets: [["W", "L"], ["L", "W"], ["Q"]] };
  const errs = validatePackage(bad).join("\n");
  assert.match(errs, /duplicates another set/);
  assert.match(errs, /sets\[2\].*non-empty set of option ids/);
  const tooMany = phase4Package();
  const tm = tooMany.stages[0]!.items[1]!.parts[0] as MultiSelectPart;
  tm.max = 2;
  assert.match(validatePackage(tooMany).join("\n"), /sets\[2\].*must fit within min and max/);
  const badDiagram = phase4Package();
  const part = badDiagram.stages[0]!.items[2]!.parts[0] as DiagramPickPart;
  part.answer_key = "nowhere";
  part.diagram.flows![0]!.to = "ghost";
  (part.diagram.nodes[1] as { kind: string }).kind = "cloud";
  const derrs = validatePackage(badDiagram).join("\n");
  assert.match(derrs, /answer_key: must be one of the node ids/);
  assert.match(derrs, /from and to must be node ids/);
  assert.match(derrs, /kind: must be one of entity, process, store/);
  const badFlag = phase4Package();
  (badFlag.stages[0]!.items[0] as { all_correct: unknown }).all_correct = "yes";
  assert.match(validatePackage(badFlag).join("\n"), /all_correct: must be boolean/);
});

test("all_correct: every part must be fully right, otherwise the item scores 0", () => {
  const pkg = phase4Package();
  const k = (p: string, id: string) => tok("builder", p, id);
  assert.equal(scoreItem(pkg, "builder", { a: k("a", "a1"), b: k("b", "b1") }, SEED).ratio, 1);
  const half = scoreItem(pkg, "builder", { a: k("a", "a1"), b: k("b", "b2") }, SEED);
  assert.deepEqual([half.ratio, half.parts, half.flags], [0, { a: 1, b: 0 }, []], "part ratios are still reported");
});

test("accepted_sets: exactly one of the listed sets scores 1; anything else 0; duplicates collapse", () => {
  const pkg = phase4Package();
  const k = (id: string) => tok("tools", "pick", id);
  const score = (ids: string[]) => scoreItem(pkg, "tools", { pick: ids.map(k) }, SEED).ratio;
  assert.equal(score(["W", "L"]), 1);
  assert.equal(score(["A", "W"]), 1);
  assert.equal(score(["W", "L", "A"]), 1);
  assert.equal(score(["W", "W", "L"]), 1, "a duplicate token collapses");
  assert.equal(score(["W"]), 0);
  assert.equal(score(["L", "A"]), 0);
  assert.equal(score(["W", "L", "X"]), 0);
  assert.deepEqual(correctAnswer(pkg.stages[0]!.items[1]!, SEED).pick, [k("W"), k("L")]);
});

test("diagram_pick: nodes travel as tokens, flows refer to tokens, and the pick scores 1 or 0", () => {
  const pkg = phase4Package();
  const view = projectItem(pkg, "dfd", SEED, "en");
  const d = view.parts[0]!.diagram!;
  const k = (id: string) => tok("dfd", "node", id);
  assert.deepEqual(d.view_box, [600, 300]);
  assert.deepEqual(
    d.nodes.map((n) => [n.token, n.label, n.kind, n.x]),
    [[k("user"), "User", "entity", 80], [k("app"), "App", "process", 260], [k("files"), "Files", "store", 440]],
  );
  assert.equal(d.nodes[0]!.detail, "An external user");
  assert.ok(!("detail" in d.nodes[1]!));
  assert.deepEqual(d.flows[1], { from: k("app"), to: k("files"), label: "Write" });
  assert.deepEqual(d.boundaries[0], { label: "Boundary", x1: 170, y1: 30, x2: 170, y2: 270 });
  assert.ok(!/"files"|"user"|answer_key|"f1"|"b1"/.test(JSON.stringify(view)), "no ids or keys reach the browser");
  const letter = (id: string) => tok("dfd", "letter", id);
  assert.equal(scoreItem(pkg, "dfd", { node: k("files"), letter: letter("T") }, SEED).ratio, 1);
  assert.equal(scoreItem(pkg, "dfd", { node: k("app"), letter: letter("T") }, SEED).ratio, 0, "all-or-nothing");
  assert.throws(() => scoreItem(pkg, "dfd", { node: "tnope", letter: letter("T") }, SEED), ActivityAnswerError);
  assert.throws(
    () => scoreItem(pkg, "dfd", { node: tok("dfd", "node", "files", SEED2), letter: letter("T") }, SEED),
    ActivityAnswerError,
    "another attempt's token",
  );
  assert.equal(correctAnswer(pkg.stages[0]!.items[2]!, SEED).node, k("files"));
});

// Phase 4b (policy_builder): same fixture and vectors as the private reference test.
function policyPackage() {
  const pkg = syntheticPackage();
  pkg.reveal = "after_item";
  const part: PolicyBuilderPart = {
    key: "policy",
    type: "policy_builder",
    weight: 1,
    shuffle: true,
    permissions: [
      { id: "read", label: t("Read"), detail: t("Read a record"), note: t("Needed to work") },
      { id: "write", label: t("Write"), note: t("Needed to edit") },
      { id: "admin", label: t("Admin"), note: t("Too broad") },
    ],
    conditions: [
      { id: "own", label: t("Own only"), note: t("Others' records leak"), applies: ["read", "write"], predicate: { op: "eq_attr", attr: "owner", other: "actor" } },
      { id: "open", label: t("Open status"), note: t("Closed records change"), applies: ["write"], predicate: { op: "eq", attr: "status", value: "open" } },
      { id: "hours", label: t("Daytime"), note: t("Blocks night work"), applies: ["read"], predicate: { op: "between", attr: "hour", min: 8, max: 16 } },
    ],
    answer_key: { permissions: ["read", "write"], conditions: ["own", "open"] },
    requests: [
      { id: "q1", title: t("Own read at night"), reason: t("Owner may read"), permission: "read", attrs: { actor: "a", owner: "a", hour: 20 }, expected: true },
      { id: "q2", title: t("Other read"), permission: "read", attrs: { actor: "a", owner: "b", hour: 10 }, expected: false },
      { id: "q3", title: t("Own write open"), permission: "write", attrs: { actor: "a", owner: "a", status: "open" }, expected: true },
      { id: "q4", title: t("Own write closed"), permission: "write", attrs: { actor: "a", owner: "a", status: "closed" }, expected: false },
      { id: "q5", title: t("Admin"), permission: "admin", attrs: { actor: "a" }, expected: false },
      { id: "q6", title: t("Read, owner unknown"), permission: "read", attrs: { actor: "a" }, expected: false },
    ],
    scoring: { choice_weight: 0.6, test_weight: 0.4 },
  };
  pkg.stages = [{ key: "s1", title: t("Stage"), items: [{ key: "pol", parts: [part] }] }];
  return pkg;
}
const polPart = (pkg: ReturnType<typeof policyPackage>) => pkg.stages[0]!.items[0]!.parts[0] as PolicyBuilderPart;
const polTok = (id: string) => tok("pol", "policy", id);
const polAnswer = (perms: string[], conds: string[]) => ({ policy: { permissions: perms.map(polTok), conditions: conds.map(polTok) } });

test("policy_builder cross-engine vectors match the private reference engine", () => {
  const view = projectItem(policyPackage(), "pol", "0f1e2d3c4b5a69788796a5b4c3d2e1f0", "en").parts[0]!;
  assert.deepEqual(view.permissions!.map((o) => [o.token, o.label]), [["tb1f4ae6f9c1d0c44", "Write"], ["t0033831f531c83cc", "Admin"], ["tbb0964efaadb8e8d", "Read"]]);
  assert.deepEqual(view.conditions!.map((o) => [o.token, o.label]), [["tb42c3afc3ce230f2", "Open status"], ["tbe934c90ee09867b", "Own only"], ["t6ea84ea0e075440a", "Daytime"]]);
});

test("policy_builder package validates, and broken parts are rejected", () => {
  assert.deepEqual(validatePackage(policyPackage()), []);
  const bad = policyPackage();
  const part = polPart(bad);
  part.conditions[0]!.applies = ["ghost"];
  (part.conditions[1] as { predicate: unknown }).predicate = { op: "regex", attr: "status" };
  part.conditions[2]!.predicate = { op: "between", attr: "hour", min: 16, max: 8 };
  part.conditions.push({ id: "read", label: t("Clash"), applies: ["read"], predicate: { op: "eq", attr: "x", value: 1 } });
  part.requests[0]!.permission = "nope";
  (part.requests[1] as { attrs: unknown }).attrs = { actor: { nested: true } };
  part.answer_key.conditions = ["own", "own"];
  part.scoring = { choice_weight: 0.6, test_weight: 0.5 };
  const errs = validatePackage(bad).join("\n");
  for (const re of [
    /applies: must be a non-empty set of permission ids/,
    /predicate\.op: must be one of eq, eq_attr, ne_attr, between/,
    /min and max must be numbers with min <= max/,
    /conditions\[3\]\.id: duplicate id read/,
    /requests\[0\]\.permission: must be one of the permission ids/,
    /requests\[1\]\.attrs: must map attribute names/,
    /answer_key\.conditions: must be a set/,
    /choice_weight and test_weight must be non-negative and sum to 1/,
  ]) assert.match(errs, re);
});

test("policy_builder projection: tokens, label, detail only; no key, predicate, note, or request", () => {
  const view = projectItem(policyPackage(), "pol", SEED, "en").parts[0]!;
  assert.deepEqual(new Set(view.permissions!.map((o) => o.token)), new Set(["read", "write", "admin"].map(polTok)));
  assert.deepEqual(new Set(view.conditions!.map((o) => o.token)), new Set(["own", "open", "hours"].map(polTok)));
  assert.equal(view.permissions!.find((o) => o.token === polTok("read"))!.detail, "Read a record");
  assert.ok(!("detail" in view.permissions!.find((o) => o.token === polTok("write"))!));
  assert.ok(!/answer_key|requests|predicate|applies|note|"read"|"own"|Needed|leak/.test(JSON.stringify(view)));
});

test("policy_builder scoring: 0.6 x choice accuracy + 0.4 x pass rate; absent attributes fail", () => {
  const pkg = policyPackage();
  const score = (perms: string[], conds: string[]) => scoreItem(pkg, "pol", polAnswer(perms, conds), SEED);
  const key = score(["read", "write"], ["own", "open"]);
  assert.equal(key.ratio, 1);
  assert.deepEqual(key.details, { policy: { allowed: [true, false, true, false, false, false], wrong: [] } });
  const open = score(["read", "write"], []);
  near(open.ratio, (0.6 * 4) / 6 + (0.4 * 3) / 6);
  assert.deepEqual((open.details!.policy as { wrong: string[] }).wrong, ["own", "open"]);
  near(score(["read", "write"], ["own", "open", "hours"]).ratio, (0.6 * 5) / 6 + (0.4 * 5) / 6);
  const none = score([], []);
  near(none.ratio, (0.6 * 2) / 6 + (0.4 * 4) / 6);
  assert.deepEqual((none.details!.policy as { allowed: boolean[] }).allowed, [false, false, false, false, false, false]);
  assert.equal(scoreItem(pkg, "pol", { policy: { permissions: ["read", "read", "write"].map(polTok), conditions: ["own", "open"].map(polTok) } }, SEED).ratio, 1);
  assert.throws(() => scoreItem(pkg, "pol", { policy: { permissions: [polTok("own")], conditions: [] } }, SEED), ActivityAnswerError);
  assert.throws(() => scoreItem(pkg, "pol", { policy: { permissions: [], conditions: [polTok("read")] } }, SEED), ActivityAnswerError);
  assert.throws(() => scoreItem(pkg, "pol", { policy: { permissions: ["read"], conditions: [] } }, SEED), ActivityAnswerError);
  assert.throws(() => scoreItem(pkg, "pol", { policy: { permissions: [] } }, SEED), ActivityAnswerError);
  assert.throws(() => scoreItem(pkg, "pol", { policy: { permissions: [], conditions: [], extra: [] } }, SEED), ActivityAnswerError);
  assert.deepEqual(correctAnswer(pkg.stages[0]!.items[0]!, SEED).policy, { permissions: ["read", "write"].map(polTok), conditions: ["own", "open"].map(polTok) });
});

test("policy_builder feedback: request decisions and notes only with the correct answer", () => {
  const pkg = policyPackage();
  const result = scoreItem(pkg, "pol", polAnswer(["read", "admin"], ["own", "hours"]), SEED);
  const fb = itemFeedback(pkg, "pol", result, SEED, "en");
  const pd = fb.details!.policy as PolicyFeedback;
  assert.deepEqual(pd.requests[0], { title: "Own read at night", reason: "Owner may read", allowed: false, expected: true });
  assert.deepEqual(pd.requests[4], { title: "Admin", allowed: true, expected: false });
  assert.deepEqual(pd.notes, [
    { token: polTok("write"), note: "Needed to edit" },
    { token: polTok("admin"), note: "Too broad" },
    { token: polTok("open"), note: "Closed records change" },
    { token: polTok("hours"), note: "Blocks night work" },
  ]);
  pkg.reveal = "none";
  const hidden = itemFeedback(pkg, "pol", result, SEED, "en");
  assert.ok(!("details" in hidden) && !("correct" in hidden));
  assert.ok(!("details" in itemFeedback(policyPackage(), "pol", { ratio: 0, flags: [], parts: {} }, SEED, "en")));
});

// Phase 4c (recipe_pipeline): synthetic vectors only, the same ones as the private reference test.
const SYN_KEY = "synthetic-test-key-0123456789abc";
const SYN_IV = "synthetic-iv-016";
const SYN_CT = "M7l8p/47hYF3noB5lImVfiTWzlDfiKyzmWGRteNG8JA=";
const RECIPE_OPERATIONS: RecipePipelinePart["operations"] = [
  { id: "fromBase64", label: t("From Base64"), params: [] },
  { id: "toBase64", label: t("To Base64"), params: [] },
  { id: "fromHex", label: t("From Hex"), params: [] },
  { id: "toHex", label: t("To Hex"), params: [] },
  { id: "xor", label: t("XOR"), params: [{ key: "key", label: t("Key") }] },
  { id: "sha256", label: t("SHA-256"), detail: t("Digest"), params: [] },
  { id: "aesDecrypt", label: t("AES Decrypt"), params: [{ key: "key", label: t("Key"), placeholder: t("32 bytes") }, { key: "iv", label: t("IV") }] },
];
const R = (op: RecipeStep["op"], params: Record<string, string> = {}): RecipeStep => ({ op, params });
function recipePackage() {
  const pkg = syntheticPackage();
  pkg.reveal = "after_item";
  const part = (input: string, target: string, solution: RecipePipelinePart["solution"]): RecipePipelinePart => ({
    key: "recipe",
    type: "recipe_pipeline",
    weight: 1,
    input,
    operations: RECIPE_OPERATIONS,
    target,
    solution,
  });
  pkg.stages = [
    {
      key: "s1",
      title: t("Stage"),
      items: [
        { key: "hexor", parts: [part("6f 6d 6c", "NLM", [R("fromHex"), R("xor", { key: "0x21" })])] },
        { key: "aes", parts: [part(SYN_CT, "synthetic plaintext ok", [R("aesDecrypt", { key: SYN_KEY, iv: SYN_IV })])] },
        { key: "hash", parts: [part("synthetic", "b3cc0475bb78a5026098858e9889acf666d31062d513d303314eca31d36e72f2", [{ op: "sha256" }])] },
      ],
    },
  ];
  return pkg;
}

test("recipe operations follow the game's browser semantics (same vectors as the reference engine)", () => {
  assert.equal(runRecipe("41 42 4", [R("fromHex")]), "[ERROR: Hex length must be even]");
  assert.equal(runRecipe("zz4g0x41", [R("fromHex")]), "\u0000\u0004A");
  assert.equal(runRecipe("AĀ", [R("toHex")]), "41 100");
  assert.equal(runRecipe("Ā", [R("toBase64")]), "[ERROR: Cannot encode Base64]");
  assert.equal(runRecipe(" TW Fu ", [R("fromBase64")]), "Man");
  assert.equal(runRecipe("abc", [R("xor", { key: "" })]), "abc");
  assert.equal(runRecipe("abc", [R("xor", { key: "0xzz" })]), "abc");
  assert.equal(runRecipe("a", [R("xor", { key: "0x2121" })]), String.fromCharCode(0x61 ^ 0x2121));
  assert.equal(runRecipe("ab", [R("xor", { key: "\u0001\u0002" })]), "``");
  assert.equal(runRecipe(SYN_CT, [R("aesDecrypt", { key: SYN_KEY, iv: SYN_IV })]), "synthetic plaintext ok");
  assert.equal(runRecipe(SYN_CT, [R("aesDecrypt", { key: "short", iv: SYN_IV })]), "[ERROR: AES-256-CBC key must be exactly 32 UTF-8 bytes; received 5]");
  assert.equal(runRecipe(SYN_CT, [R("aesDecrypt", { key: SYN_KEY, iv: "x" })]), "[ERROR: AES-CBC IV must be exactly 16 UTF-8 bytes; received 1]");
  assert.equal(runRecipe("!!", [R("aesDecrypt", { key: SYN_KEY, iv: SYN_IV })]), "[ERROR: Decryption Failed. Check Key/IV parameters]");
  assert.equal(runRecipe("abc", [R("toHex"), R("fromHex"), R("sha256")]), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(runRecipe("41 4", [R("fromHex"), R("toHex")]), "[ERROR: Hex length must be even]");
  assert.equal(runRecipe("a".repeat(30000), [R("toHex")]), "[ERROR: Step output exceeds 65536 characters]");
});

test("the player's preview library matches the server executor on a synthetic corpus", async () => {
  const previewPath = "../../src/v2/activities/recipeOps.js";
  const preview = (await import(previewPath)) as { runRecipe: (input: string, steps: RecipeStep[]) => Promise<{ output: string }> };
  const variants: RecipeStep[] = [
    R("fromBase64"), R("toBase64"), R("fromHex"), R("toHex"), R("sha256"),
    ...["", "0x21", "0x2121", "0xD800", "0x", "0xzz", "0x-1", "kÿ", "Āz"].map((key) => R("xor", { key })),
    R("aesDecrypt", { key: SYN_KEY, iv: SYN_IV }), R("aesDecrypt", { key: SYN_KEY, iv: "synthetic-iv-017" }), R("aesDecrypt", { key: "short", iv: SYN_IV }),
  ];
  let checked = 0;
  for (const input of [SYN_CT, "6f 6d 6c", "zz11-1 0x41:42", "Āÿ A", "", "  TWFu  "]) {
    for (const a of variants) for (const b of variants) {
      assert.equal((await preview.runRecipe(input, [a, b])).output, runRecipe(input, [a, b]), JSON.stringify([input, a, b]));
      checked += 1;
    }
  }
  assert.equal(checked, 6 * variants.length ** 2);
});

test("recipe_pipeline package validates, and broken parts are rejected", () => {
  assert.deepEqual(validatePackage(recipePackage()), []);
  const bad = recipePackage();
  const [p0, p1, p2] = bad.stages[0]!.items.map((i) => i.parts[0] as RecipePipelinePart);
  p0!.solution = [R("xor", { key: "0x31" })];
  (p1 as { operations: unknown }).operations = [{ id: "rot13", label: t("ROT13"), params: [] }, { id: "xor", label: t("XOR"), params: [] }];
  p2!.target = "";
  const errs = validatePackage(bad).join("\n");
  assert.match(errs, /items\[0\]\.parts\[0\]\.solution: does not reach the target/);
  assert.match(errs, /operations\[0\]\.id: must be one of fromBase64/);
  assert.match(errs, /operations\[1\]\.params: must list exactly key, in order/);
  assert.match(errs, /items\[2\]\.parts\[0\]\.target: must be a non-empty string/);
});

test("recipe_pipeline projection: input and library only; no target or solution", () => {
  const view = projectItem(recipePackage(), "hash", SEED, "en").parts[0]!;
  assert.equal(view.input, "synthetic");
  assert.deepEqual([view.max_steps, view.max_param], [10, 256]);
  assert.deepEqual(view.operations![6], { id: "aesDecrypt", label: "AES Decrypt", params: [{ key: "key", label: "Key", placeholder: "32 bytes" }, { key: "iv", label: "IV" }] });
  assert.deepEqual(view.operations![5], { id: "sha256", label: "SHA-256", detail: "Digest", params: [] });
  assert.ok(!/target|solution|b3cc04/.test(JSON.stringify(view)));
});

test("recipe_pipeline scoring: the trimmed output must equal the target; bad recipes are rejected", () => {
  const pkg = recipePackage();
  const score = (key: string, recipe: unknown) => scoreItem(pkg, key, { recipe }, SEED);
  assert.equal(score("hexor", [R("fromHex"), R("xor", { key: "0x21" })]).ratio, 1);
  assert.equal(score("hexor", [R("fromHex"), R("xor", { key: "!" })]).ratio, 1);
  assert.equal(score("hexor", [R("fromHex")]).ratio, 0);
  assert.deepEqual(score("hexor", [R("fromHex")]).details, { recipe: { output: "oml" } });
  assert.equal(score("aes", [R("aesDecrypt", { key: SYN_KEY, iv: SYN_IV })]).ratio, 1);
  assert.equal(score("hash", [{ op: "sha256" }]).ratio, 1);
  for (const recipe of [
    [],
    Array.from({ length: 11 }, () => R("toHex")),
    [{ op: "rot13", params: {} }],
    [{ op: "xor", params: {} }],
    [{ op: "xor", params: { key: "k", extra: "x" } }],
    [{ op: "xor", params: { key: 5 } }],
    [{ op: "xor", params: { key: "k".repeat(257) } }],
    [{ op: "toHex", params: {}, id: "step-1" }],
    "toHex",
  ]) {
    assert.throws(() => score("hash", recipe), ActivityAnswerError, JSON.stringify(recipe));
  }
  assert.deepEqual(correctAnswer(pkg.stages[0]!.items[0]!, SEED).recipe, [R("fromHex"), R("xor", { key: "0x21" })]);
});

test("recipe_pipeline feedback: output and target only with the correct answer", () => {
  const pkg = recipePackage();
  const result = scoreItem(pkg, "hash", { recipe: [R("toHex")] }, SEED);
  const fb = itemFeedback(pkg, "hash", result, SEED, "en");
  assert.deepEqual(fb.details, {
    recipe: { output: "73 79 6e 74 68 65 74 69 63", target: "b3cc0475bb78a5026098858e9889acf666d31062d513d303314eca31d36e72f2", matched: false },
  });
  assert.deepEqual(fb.correct!.recipe, [R("sha256")]);
  const five = Array.from({ length: 5 }, () => R("toHex"));
  const long = itemFeedback(pkg, "hash", scoreItem(pkg, "hash", { recipe: five }, SEED), SEED, "en");
  assert.equal((long.details!.recipe as RecipeFeedback).output.length, 2001);
  pkg.reveal = "none";
  assert.ok(!("details" in itemFeedback(pkg, "hash", result, SEED, "en")));
});
