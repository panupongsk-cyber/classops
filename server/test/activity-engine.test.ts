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
  scoreItem,
  validatePackage,
  type MultiSelectPart,
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
