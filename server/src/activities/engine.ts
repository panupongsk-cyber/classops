/**
 * Learning-activity engine (package format `ps-activity-package/v1`).
 *
 * TypeScript port of the private reference engine
 * (PersonalSchema work/projects/teaching/305331-316331-computerinfosecurity-shared/
 * learning-activities/engine/activity-engine.mjs, PS-TASK-20260925-685). The token and
 * shuffle algorithms must stay byte-identical to that module: test/activity-engine.test.ts
 * pins cross-engine vectors computed from it.
 *
 * Trust model: the server holds the full package (content + answer keys) and a per-attempt
 * secret `seed`. The browser receives only `projectItem()` output, where options and rows are
 * opaque per-attempt tokens, and answers in terms of those tokens. The seed never leaves the
 * server. This file holds no activity content; packages are imported at runtime.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

export const FORMAT = "ps-activity-package/v1";
export const SCORER_VERSION = "activity-engine/0.1.0";
export const LANGS = ["th", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const PART_TYPES = ["single_choice", "multi_select", "categorize", "verdict_matrix"] as const;
export const RULE_TYPES = ["zero_if_selected", "zero_if_row_value"] as const;
export const AGGREGATES = ["stage_mean", "item_mean"] as const;
export const REVEALS = ["none", "after_item", "after_attempt"] as const;
export const BAND_EPSILON = 1e-9;

const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SEED_RE = /^[0-9a-f]{32,128}$/;

export type LocalizedText = Partial<Record<Lang, string>>;
export interface Choice {
  id: string;
  label: LocalizedText;
}
interface PartBase {
  key: string;
  weight: number;
  prompt?: LocalizedText;
}
export interface SingleChoicePart extends PartBase {
  type: "single_choice";
  shuffle: boolean;
  options: Choice[];
  answer_key: string;
}
export type MultiScoring =
  | { mode: "credit_by_correct"; key: string[]; credit: number[] }
  | { mode: "share_of_allowed"; allowed: string[] }
  | { mode: "threshold_no_wrong"; key: string[]; threshold: number; partial_factor: number };
export interface MultiSelectPart extends PartBase {
  type: "multi_select";
  shuffle: boolean;
  options: Choice[];
  min: number;
  max: number | null;
  scoring: MultiScoring;
}
export interface RowPart extends PartBase {
  type: "categorize" | "verdict_matrix";
  shuffle?: boolean;
  rows: Choice[];
  categories: Choice[];
  answer_key: Record<string, string>;
}
export type Part = SingleChoicePart | MultiSelectPart | RowPart;
export type Rule =
  | { type: "zero_if_selected"; part: string; options: string[]; flag: string }
  | { type: "zero_if_row_value"; part: string; row: string; category: string; flag: string };
export interface Item {
  key: string;
  title?: LocalizedText;
  scenario?: LocalizedText;
  evidence?: { tag?: LocalizedText; body: LocalizedText };
  context?: { label: LocalizedText; value: LocalizedText }[];
  explanation?: LocalizedText;
  parts: Part[];
  rules?: Rule[];
}
export interface Stage {
  key: string;
  title: LocalizedText;
  tag?: LocalizedText;
  brief?: LocalizedText;
  goal?: LocalizedText;
  items: Item[];
}
export interface Band {
  min_percent: number;
  badge?: string;
  title: LocalizedText;
  description?: LocalizedText;
}
export interface ActivityPackage {
  format: typeof FORMAT;
  package: string;
  version: number;
  title: LocalizedText;
  languages: Lang[];
  source: unknown;
  aggregate: (typeof AGGREGATES)[number];
  reveal: (typeof REVEALS)[number];
  bands: Band[];
  flags?: Record<string, { title: LocalizedText; body: LocalizedText }>;
  stages: Stage[];
}

export class ActivityAnswerError extends Error {
  readonly code = "INVALID_ANSWER";
  constructor(readonly detail: string) {
    super(`INVALID_ANSWER: ${detail}`);
    this.name = "ActivityAnswerError";
  }
}

// ---------------------------------------------------------------------------
// Seeds, tokens, and seeded order
// ---------------------------------------------------------------------------

/** A fresh per-attempt secret: 128 random bits as 32 lowercase hex characters. */
export function newSeed() {
  return randomBytes(16).toString("hex");
}

function assertSeed(seed: string) {
  if (typeof seed !== "string" || !SEED_RE.test(seed)) {
    throw new TypeError("seed must be 32-128 lowercase hex characters");
  }
}

function hmacHex(seed: string, message: string) {
  return createHmac("sha256", seed).update(message, "utf8").digest("hex");
}

/** "t" + first 16 hex of HMAC-SHA256(key=seed, "token\0<item>\0<part>\0<optionId>"). */
export function optionToken(seed: string, itemKey: string, partKey: string, optionId: string) {
  assertSeed(seed);
  return "t" + hmacHex(seed, `token\u0000${itemKey}\u0000${partKey}\u0000${optionId}`).slice(0, 16);
}

/** "r" + first 16 hex of HMAC-SHA256(key=seed, "row\0<item>\0<part>\0<rowId>"). */
export function rowToken(seed: string, itemKey: string, partKey: string, rowId: string) {
  assertSeed(seed);
  return "r" + hmacHex(seed, `row\u0000${itemKey}\u0000${partKey}\u0000${rowId}`).slice(0, 16);
}

function seededOrder<T extends { id: string }>(
  seed: string,
  namespace: string,
  itemKey: string,
  partKey: string,
  list: readonly T[],
  shuffle: boolean,
): T[] {
  if (!shuffle) return [...list];
  return list
    .map((x) => ({ x, k: hmacHex(seed, `${namespace}\u0000${itemKey}\u0000${partKey}\u0000${x.id}`) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((e) => e.x);
}

/** Options sorted by HMAC-SHA256(seed, "order\0<item>\0<part>\0<id>") when `shuffle`. */
export function orderedOptions(seed: string, itemKey: string, part: SingleChoicePart | MultiSelectPart) {
  assertSeed(seed);
  return seededOrder(seed, "order", itemKey, part.key, part.options, part.shuffle);
}

/** Rows sorted under the "roworder" namespace when the row part sets `shuffle: true`. */
export function orderedRows(seed: string, itemKey: string, part: RowPart) {
  assertSeed(seed);
  return seededOrder(seed, "roworder", itemKey, part.key, part.rows, part.shuffle === true);
}

// ---------------------------------------------------------------------------
// Package helpers
// ---------------------------------------------------------------------------

export function localize(text: LocalizedText | undefined, lang: Lang): string | undefined {
  if (!text) return undefined;
  const direct = text[lang];
  if (typeof direct === "string") return direct;
  for (const l of LANGS) {
    const value = text[l];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** sha256 of the key-sorted JSON form: the `content_hash` recorded on import. */
export function packageHash(pkg: unknown) {
  return createHash("sha256").update(stableStringify(pkg), "utf8").digest("hex");
}

export function listItems(pkg: ActivityPackage) {
  const out: { stage: Stage; item: Item }[] = [];
  for (const stage of pkg.stages) for (const item of stage.items) out.push({ stage, item });
  return out;
}

export function findItem(pkg: ActivityPackage, itemKey: string) {
  for (const stage of pkg.stages) {
    for (const item of stage.items) if (item.key === itemKey) return { stage, item };
  }
  throw new RangeError(`unknown item: ${itemKey}`);
}

// ---------------------------------------------------------------------------
// Package validation (authoritative gate used by the importer)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export function validatePackage(input: unknown): string[] {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);
  if (!isObject(input)) return ["$: package must be an object"];
  const pkg = input;

  if (pkg.format !== FORMAT) err("$.format", `must be ${FORMAT}`);
  if (typeof pkg.package !== "string" || !SLUG_RE.test(pkg.package)) err("$.package", "must be a slug");
  if (!Number.isInteger(pkg.version) || (pkg.version as number) < 1) err("$.version", "must be a positive integer");
  const langs = Array.isArray(pkg.languages) ? (pkg.languages as unknown[]) : [];
  if (
    langs.length === 0 ||
    langs.some((l) => !(LANGS as readonly unknown[]).includes(l)) ||
    new Set(langs).size !== langs.length
  ) {
    err("$.languages", `must be a non-empty set drawn from ${LANGS.join(", ")}`);
  }

  const text = (path: string, value: unknown, required = true) => {
    if (value === undefined) {
      if (required) err(path, "is required");
      return;
    }
    if (!isObject(value)) return err(path, "must be a localized text object");
    for (const k of Object.keys(value)) if (!(LANGS as readonly string[]).includes(k)) err(path, `unknown language ${k}`);
    for (const l of langs) {
      const v = value[l as string];
      if (typeof v !== "string" || v.trim() === "") err(path, `missing ${String(l)} text`);
    }
  };

  text("$.title", pkg.title);
  if (!(AGGREGATES as readonly unknown[]).includes(pkg.aggregate)) err("$.aggregate", `must be one of ${AGGREGATES.join(", ")}`);
  if (!(REVEALS as readonly unknown[]).includes(pkg.reveal)) err("$.reveal", `must be one of ${REVEALS.join(", ")}`);

  const bands = Array.isArray(pkg.bands) ? (pkg.bands as unknown[]) : [];
  if (bands.length === 0) err("$.bands", "must be a non-empty array");
  bands.forEach((b, i) => {
    const band = isObject(b) ? b : {};
    const min = band.min_percent;
    if (typeof min !== "number" || min < 0 || min > 100) err(`$.bands[${i}].min_percent`, "must be 0-100");
    const prev = i > 0 && isObject(bands[i - 1]) ? (bands[i - 1] as Json).min_percent : undefined;
    if (i > 0 && !(typeof min === "number" && typeof prev === "number" && min < prev)) {
      err(`$.bands[${i}].min_percent`, "must be strictly descending");
    }
    text(`$.bands[${i}].title`, band.title);
    text(`$.bands[${i}].description`, band.description, false);
    if (band.badge !== undefined && typeof band.badge !== "string") err(`$.bands[${i}].badge`, "must be a string");
  });
  const last = bands[bands.length - 1];
  if (bands.length > 0 && !(isObject(last) && last.min_percent === 0)) err("$.bands", "last band must have min_percent 0");

  const flags = pkg.flags === undefined ? {} : pkg.flags;
  if (!isObject(flags)) err("$.flags", "must be an object");
  const flagNames = new Set(isObject(flags) ? Object.keys(flags) : []);
  if (isObject(flags)) {
    for (const [name, f] of Object.entries(flags)) {
      if (!KEY_RE.test(name)) err(`$.flags.${name}`, "bad flag name");
      text(`$.flags.${name}.title`, isObject(f) ? f.title : undefined);
      text(`$.flags.${name}.body`, isObject(f) ? f.body : undefined);
    }
  }

  const stageKeys = new Set<string>();
  const itemKeys = new Set<string>();
  const stages = Array.isArray(pkg.stages) ? (pkg.stages as unknown[]) : [];
  if (stages.length === 0) err("$.stages", "must be a non-empty array");
  stages.forEach((s, si) => {
    const sp = `$.stages[${si}]`;
    const stage = isObject(s) ? s : {};
    const key = typeof stage.key === "string" ? stage.key : "";
    if (!KEY_RE.test(key)) err(`${sp}.key`, "bad key");
    else if (stageKeys.has(key)) err(`${sp}.key`, `duplicate stage key ${key}`);
    stageKeys.add(key);
    text(`${sp}.title`, stage.title);
    text(`${sp}.brief`, stage.brief, false);
    text(`${sp}.goal`, stage.goal, false);
    text(`${sp}.tag`, stage.tag, false);
    const items = Array.isArray(stage.items) ? (stage.items as unknown[]) : [];
    if (items.length === 0) return err(`${sp}.items`, "must be a non-empty array");
    items.forEach((it, ii) => validateItem(isObject(it) ? it : {}, `${sp}.items[${ii}]`, err, text, itemKeys, flagNames));
  });
  return errors;
}

function uniqueIds(list: unknown, path: string, err: (p: string, m: string) => void, what: string) {
  const ids = new Set<string>();
  if (!Array.isArray(list) || list.length === 0) {
    err(path, `must be a non-empty array of ${what}`);
    return ids;
  }
  list.forEach((x, i) => {
    const id = isObject(x) && typeof x.id === "string" ? x.id : "";
    if (!KEY_RE.test(id)) err(`${path}[${i}].id`, "bad id");
    else if (ids.has(id)) err(`${path}[${i}].id`, `duplicate id ${id}`);
    ids.add(id);
  });
  return ids;
}

function validateItem(
  item: Json,
  ip: string,
  err: (p: string, m: string) => void,
  text: (p: string, v: unknown, required?: boolean) => void,
  itemKeys: Set<string>,
  flagNames: Set<string>,
) {
  const key = typeof item.key === "string" ? item.key : "";
  if (!KEY_RE.test(key)) err(`${ip}.key`, "bad key");
  else if (itemKeys.has(key)) err(`${ip}.key`, `duplicate item key ${key}`);
  itemKeys.add(key);
  text(`${ip}.title`, item.title, false);
  text(`${ip}.scenario`, item.scenario, false);
  text(`${ip}.explanation`, item.explanation, false);
  if (item.evidence !== undefined) {
    const ev = isObject(item.evidence) ? item.evidence : {};
    text(`${ip}.evidence.tag`, ev.tag, false);
    text(`${ip}.evidence.body`, ev.body);
  }
  if (item.context !== undefined) {
    (Array.isArray(item.context) ? item.context : []).forEach((c: unknown, ci: number) => {
      text(`${ip}.context[${ci}].label`, isObject(c) ? c.label : undefined);
      text(`${ip}.context[${ci}].value`, isObject(c) ? c.value : undefined);
    });
  }

  const parts = Array.isArray(item.parts) ? (item.parts as unknown[]) : [];
  if (parts.length === 0) return err(`${ip}.parts`, "must be a non-empty array");
  const partsByKey = new Map<string, Json>();
  let weightSum = 0;
  parts.forEach((raw, pi) => {
    const pp = `${ip}.parts[${pi}]`;
    const part = isObject(raw) ? raw : {};
    const pkey = typeof part.key === "string" ? part.key : "";
    if (!KEY_RE.test(pkey)) err(`${pp}.key`, "bad key");
    else if (partsByKey.has(pkey)) err(`${pp}.key`, `duplicate part key ${pkey}`);
    partsByKey.set(pkey, part);
    if (!(PART_TYPES as readonly unknown[]).includes(part.type)) return err(`${pp}.type`, `must be one of ${PART_TYPES.join(", ")}`);
    const weight = part.weight;
    if (typeof weight !== "number" || !(weight > 0) || weight > 1) err(`${pp}.weight`, "must be in (0, 1]");
    else weightSum += weight;
    text(`${pp}.prompt`, part.prompt, false);

    if (part.type === "single_choice" || part.type === "multi_select") {
      const ids = uniqueIds(part.options, `${pp}.options`, err, "options");
      (Array.isArray(part.options) ? part.options : []).forEach((o: unknown, oi: number) =>
        text(`${pp}.options[${oi}].label`, isObject(o) ? o.label : undefined),
      );
      if (ids.size < 2) err(`${pp}.options`, "needs at least 2 options");
      if (typeof part.shuffle !== "boolean") err(`${pp}.shuffle`, "must be boolean");
      if (part.type === "single_choice") {
        if (typeof part.answer_key !== "string" || !ids.has(part.answer_key)) err(`${pp}.answer_key`, "must be one of the option ids");
      } else {
        const min = part.min;
        const max = part.max;
        if (!Number.isInteger(min) || (min as number) < 1) err(`${pp}.min`, "must be an integer >= 1");
        if (max !== null && (!Number.isInteger(max) || (max as number) < (min as number) || (max as number) > ids.size)) {
          err(`${pp}.max`, "must be null or an integer between min and the option count");
        }
        validateMultiScoring(part, pp, ids, err);
      }
    } else {
      const rowIds = uniqueIds(part.rows, `${pp}.rows`, err, "rows");
      if (part.shuffle !== undefined && typeof part.shuffle !== "boolean") err(`${pp}.shuffle`, "must be boolean");
      (Array.isArray(part.rows) ? part.rows : []).forEach((r: unknown, ri: number) =>
        text(`${pp}.rows[${ri}].label`, isObject(r) ? r.label : undefined),
      );
      const catIds = uniqueIds(part.categories, `${pp}.categories`, err, "categories");
      (Array.isArray(part.categories) ? part.categories : []).forEach((c: unknown, ci: number) =>
        text(`${pp}.categories[${ci}].label`, isObject(c) ? c.label : undefined),
      );
      if (part.type === "verdict_matrix" && catIds.size !== 2) err(`${pp}.categories`, "a verdict_matrix has exactly 2 verdicts");
      if (part.type === "categorize" && catIds.size < 2) err(`${pp}.categories`, "needs at least 2 categories");
      const answerKey = isObject(part.answer_key) ? part.answer_key : {};
      for (const r of rowIds) {
        const cat = answerKey[r];
        if (typeof cat !== "string" || !catIds.has(cat)) err(`${pp}.answer_key.${r}`, "must map to a category id");
      }
      for (const k of Object.keys(answerKey)) if (!rowIds.has(k)) err(`${pp}.answer_key.${k}`, "is not a row id");
    }
  });
  if (Math.abs(weightSum - 1) > 1e-9) err(`${ip}.parts`, `weights sum to ${weightSum}, not 1`);

  (Array.isArray(item.rules) ? item.rules : []).forEach((r: unknown, ri: number) => {
    const rp = `${ip}.rules[${ri}]`;
    const rule = isObject(r) ? r : {};
    if (!(RULE_TYPES as readonly unknown[]).includes(rule.type)) return err(`${rp}.type`, `must be one of ${RULE_TYPES.join(", ")}`);
    if (typeof rule.flag !== "string" || !flagNames.has(rule.flag)) err(`${rp}.flag`, `flag ${String(rule.flag)} is not defined in $.flags`);
    const part = typeof rule.part === "string" ? partsByKey.get(rule.part) : undefined;
    if (!part) return err(`${rp}.part`, `unknown part ${String(rule.part)}`);
    if (rule.type === "zero_if_selected") {
      if (part.type !== "single_choice" && part.type !== "multi_select") return err(`${rp}.part`, "must be a choice part");
      const ids = new Set((Array.isArray(part.options) ? part.options : []).map((o: unknown) => (isObject(o) ? o.id : undefined)));
      const opts = rule.options;
      if (!Array.isArray(opts) || opts.length === 0 || opts.some((o) => !ids.has(o))) {
        err(`${rp}.options`, "must be a non-empty list of the part's option ids");
      }
    } else {
      if (part.type !== "categorize" && part.type !== "verdict_matrix") return err(`${rp}.part`, "must be a row part");
      const rows = Array.isArray(part.rows) ? part.rows : [];
      const cats = Array.isArray(part.categories) ? part.categories : [];
      if (!rows.some((x: unknown) => isObject(x) && x.id === rule.row)) err(`${rp}.row`, "is not a row id");
      if (!cats.some((x: unknown) => isObject(x) && x.id === rule.category)) err(`${rp}.category`, "is not a category id");
    }
  });
}

function validateMultiScoring(part: Json, pp: string, ids: Set<string>, err: (p: string, m: string) => void) {
  const s = isObject(part.scoring) ? part.scoring : {};
  if (s.mode === "credit_by_correct") {
    const key = s.key;
    if (!Array.isArray(key) || key.length === 0 || key.some((k) => !ids.has(k)) || new Set(key).size !== key.length) {
      err(`${pp}.scoring.key`, "must be a non-empty set of option ids");
      return;
    }
    const credit = s.credit;
    if (!Array.isArray(credit) || credit.length !== key.length + 1 || credit.some((c) => typeof c !== "number" || c < 0 || c > 1)) {
      err(`${pp}.scoring.credit`, "must list key.length + 1 credits in [0, 1]");
    }
    if (part.min !== key.length || part.max !== key.length) err(`${pp}.scoring`, "credit_by_correct requires min = max = key.length");
  } else if (s.mode === "share_of_allowed") {
    const allowed = s.allowed;
    if (!Array.isArray(allowed) || allowed.length === 0 || allowed.some((k) => !ids.has(k))) {
      err(`${pp}.scoring.allowed`, "must be a non-empty list of option ids");
    }
  } else if (s.mode === "threshold_no_wrong") {
    const key = s.key;
    if (!Array.isArray(key) || key.length === 0 || key.some((k) => !ids.has(k)) || new Set(key).size !== key.length) {
      err(`${pp}.scoring.key`, "must be a non-empty set of option ids");
      return;
    }
    const threshold = s.threshold;
    if (!Number.isInteger(threshold) || (threshold as number) < 1 || (threshold as number) > key.length) {
      err(`${pp}.scoring.threshold`, "must be an integer between 1 and key.length");
    }
    const factor = s.partial_factor;
    if (typeof factor !== "number" || factor < 0 || factor > 1) {
      err(`${pp}.scoring.partial_factor`, "must be a number in [0, 1]");
    }
  } else {
    err(`${pp}.scoring.mode`, "must be credit_by_correct, share_of_allowed, or threshold_no_wrong");
  }
}

// ---------------------------------------------------------------------------
// Public projection (what the browser may see)
// ---------------------------------------------------------------------------

export interface ProjectedPart {
  key: string;
  type: Part["type"];
  prompt?: string;
  options?: { token: string; label: string | undefined }[];
  min?: number;
  max?: number | null;
  rows?: { token: string; label: string | undefined }[];
  categories?: { id: string; label: string | undefined }[];
}
export interface ProjectedItem {
  key: string;
  stage: string;
  title?: string;
  scenario?: string;
  evidence?: { tag?: string; body: string | undefined };
  context?: { label: string | undefined; value: string | undefined }[];
  parts: ProjectedPart[];
}

/** Browser-safe view of one item, built from an allowlist: no keys, ids, weights, rules, or explanation. */
export function projectItem(pkg: ActivityPackage, itemKey: string, seed: string, lang: Lang): ProjectedItem {
  const { stage, item } = findItem(pkg, itemKey);
  const L = (t: LocalizedText | undefined) => localize(t, lang);
  const out: ProjectedItem = { key: item.key, stage: stage.key, parts: [] };
  const title = L(item.title);
  if (title !== undefined) out.title = title;
  const scenario = L(item.scenario);
  if (scenario !== undefined) out.scenario = scenario;
  if (item.evidence) {
    out.evidence = { body: L(item.evidence.body) };
    const tag = L(item.evidence.tag);
    if (tag !== undefined) out.evidence.tag = tag;
  }
  if (item.context) out.context = item.context.map((c) => ({ label: L(c.label), value: L(c.value) }));
  for (const part of item.parts) {
    const p: ProjectedPart = { key: part.key, type: part.type };
    const prompt = L(part.prompt);
    if (prompt !== undefined) p.prompt = prompt;
    if (part.type === "single_choice" || part.type === "multi_select") {
      p.options = orderedOptions(seed, item.key, part).map((o) => ({
        token: optionToken(seed, item.key, part.key, o.id),
        label: L(o.label),
      }));
      if (part.type === "multi_select") {
        p.min = part.min;
        p.max = part.max;
      }
    } else {
      p.rows = orderedRows(seed, item.key, part).map((r) => ({
        token: rowToken(seed, item.key, part.key, r.id),
        label: L(r.label),
      }));
      p.categories = part.categories.map((c) => ({ id: c.id, label: L(c.label) }));
    }
    out.parts.push(p);
  }
  return out;
}

export function projectStage(pkg: ActivityPackage, stageKey: string, lang: Lang) {
  const stage = pkg.stages.find((s) => s.key === stageKey);
  if (!stage) throw new RangeError(`unknown stage: ${stageKey}`);
  const out: { key: string; title: string | undefined; items: number; brief?: string; goal?: string; tag?: string } = {
    key: stage.key,
    title: localize(stage.title, lang),
    items: stage.items.length,
  };
  for (const f of ["brief", "goal", "tag"] as const) {
    const v = localize(stage[f], lang);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type PartValue = string | Set<string> | Record<string, string>;

function normalizePart(seed: string, itemKey: string, part: Part, raw: unknown): PartValue {
  const where = `${itemKey}.${part.key}`;
  if (part.type === "single_choice" || part.type === "multi_select") {
    const byToken = new Map(part.options.map((o) => [optionToken(seed, itemKey, part.key, o.id), o.id]));
    if (part.type === "single_choice") {
      const id = typeof raw === "string" ? byToken.get(raw) : undefined;
      if (id === undefined) throw new ActivityAnswerError(`${where}: not an option of this part`);
      return id;
    }
    if (!Array.isArray(raw)) throw new ActivityAnswerError(`${where}: must be a list`);
    const ids = new Set<string>();
    for (const t of raw) {
      const id = typeof t === "string" ? byToken.get(t) : undefined;
      if (id === undefined) throw new ActivityAnswerError(`${where}: not an option of this part`);
      ids.add(id); // duplicates collapse here, so they can never add credit
    }
    if (ids.size < part.min) throw new ActivityAnswerError(`${where}: choose at least ${part.min}`);
    if (part.max !== null && ids.size > part.max) throw new ActivityAnswerError(`${where}: choose at most ${part.max}`);
    return ids;
  }
  if (!isObject(raw)) throw new ActivityAnswerError(`${where}: must map every row to a category`);
  const byToken = new Map(part.rows.map((r) => [rowToken(seed, itemKey, part.key, r.id), r.id]));
  const catIds = new Set(part.categories.map((c) => c.id));
  const out: Record<string, string> = {};
  for (const [token, cat] of Object.entries(raw)) {
    const rowId = byToken.get(token);
    if (rowId === undefined) throw new ActivityAnswerError(`${where}: not a row of this part`);
    if (typeof cat !== "string" || !catIds.has(cat)) throw new ActivityAnswerError(`${where}: unknown category`);
    out[rowId] = cat;
  }
  for (const r of part.rows) {
    if (!(r.id in out)) throw new ActivityAnswerError(`${where}: every row needs a category`);
  }
  return out;
}

function partRatio(part: Part, value: PartValue): number {
  if (part.type === "single_choice") return value === part.answer_key ? 1 : 0;
  if (part.type === "multi_select") {
    const chosen = value as Set<string>;
    const s = part.scoring;
    if (s.mode === "credit_by_correct") {
      let n = 0;
      for (const k of s.key) if (chosen.has(k)) n += 1;
      return s.credit[n] ?? 0;
    }
    if (s.mode === "threshold_no_wrong") {
      // Any pick outside the key scores 0. At least `threshold` correct picks score
      // correct / |key|; fewer score partial_factor * correct / threshold.
      let correct = 0;
      for (const id of chosen) {
        if (!s.key.includes(id)) return 0;
        correct += 1;
      }
      if (correct >= s.threshold) return correct / s.key.length;
      return correct > 0 ? s.partial_factor * (correct / s.threshold) : 0;
    }
    let n = 0;
    for (const k of s.allowed) if (chosen.has(k)) n += 1;
    return Math.min(1, n / s.allowed.length);
  }
  const map = value as Record<string, string>;
  let n = 0;
  for (const r of part.rows) if (map[r.id] === part.answer_key[r.id]) n += 1;
  return n / part.rows.length;
}

function ruleFires(rule: Rule, value: PartValue | undefined) {
  if (value === undefined) return false;
  if (rule.type === "zero_if_selected") {
    if (value instanceof Set) return rule.options.some((o) => value.has(o));
    return typeof value === "string" && rule.options.includes(value);
  }
  return typeof value === "object" && !(value instanceof Set) && value[rule.row] === rule.category;
}

export interface ItemScore {
  ratio: number;
  flags: string[];
  parts: Record<string, number>;
}

/**
 * Score one item. `answer` maps every part key to an option token (single_choice), an
 * option-token list (multi_select), or {rowToken: categoryId} (row parts). Throws
 * ActivityAnswerError for an incomplete, foreign, or out-of-bounds answer.
 */
export function scoreItem(pkg: ActivityPackage, itemKey: string, answer: unknown, seed: string): ItemScore {
  assertSeed(seed);
  const { item } = findItem(pkg, itemKey);
  if (!isObject(answer)) throw new ActivityAnswerError(`${itemKey}: answer must be an object`);
  const partKeys = new Set(item.parts.map((p) => p.key));
  for (const k of Object.keys(answer)) if (!partKeys.has(k)) throw new ActivityAnswerError(`${itemKey}: unknown part ${k}`);

  const values = new Map<string, PartValue>();
  for (const part of item.parts) {
    if (!(part.key in answer)) throw new ActivityAnswerError(`${itemKey}.${part.key}: missing`);
    values.set(part.key, normalizePart(seed, itemKey, part, answer[part.key]));
  }

  const flags: string[] = [];
  for (const rule of item.rules ?? []) {
    if (ruleFires(rule, values.get(rule.part)) && !flags.includes(rule.flag)) flags.push(rule.flag);
  }
  const parts: Record<string, number> = {};
  let ratio = 0;
  for (const part of item.parts) {
    const r = partRatio(part, values.get(part.key) as PartValue);
    parts[part.key] = r;
    ratio += part.weight * r;
  }
  if (flags.length > 0) ratio = 0;
  return { ratio: Math.min(1, Math.max(0, ratio)), flags, parts };
}

/** The correct answer of one item, in this attempt's tokens (for reveal). */
export function correctAnswer(item: Item, seed: string) {
  const out: Record<string, string | string[] | Record<string, string>> = {};
  for (const part of item.parts) {
    if (part.type === "single_choice") out[part.key] = optionToken(seed, item.key, part.key, part.answer_key);
    else if (part.type === "multi_select") {
      const ids = part.scoring.mode === "share_of_allowed" ? part.scoring.allowed : part.scoring.key;
      out[part.key] = ids.map((id) => optionToken(seed, item.key, part.key, id));
    } else {
      out[part.key] = Object.fromEntries(
        part.rows.map((r) => [rowToken(seed, item.key, part.key, r.id), part.answer_key[r.id] ?? ""]),
      );
    }
  }
  return out;
}

/** Feedback once an item is locked; the correct answer only when the package reveals it here. */
export function itemFeedback(
  pkg: ActivityPackage,
  itemKey: string,
  result: ItemScore,
  seed: string,
  lang: Lang,
  revealNow = pkg.reveal === "after_item",
) {
  const { item } = findItem(pkg, itemKey);
  const out: {
    ratio: number;
    flags: { key: string; title: string | undefined; body: string | undefined }[];
    explanation?: string;
    correct?: ReturnType<typeof correctAnswer>;
  } = {
    ratio: result.ratio,
    flags: result.flags.map((f) => ({
      key: f,
      title: localize(pkg.flags?.[f]?.title, lang),
      body: localize(pkg.flags?.[f]?.body, lang),
    })),
  };
  const explanation = localize(item.explanation, lang);
  if (explanation !== undefined) out.explanation = explanation;
  if (revealNow) out.correct = correctAnswer(item, seed);
  return out;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface Aggregate {
  score_ratio: number;
  percent: number;
  stage_results: Record<string, number>;
  answered: number;
  total: number;
  band_index: number;
}

/** Aggregate an attempt; an item missing from `itemRatios` counts as 0. */
export function aggregate(pkg: ActivityPackage, itemRatios: Record<string, number>): Aggregate {
  const stageResults: Record<string, number> = {};
  let answered = 0;
  let total = 0;
  let itemSum = 0;
  for (const stage of pkg.stages) {
    let sum = 0;
    for (const item of stage.items) {
      total += 1;
      const r = itemRatios[item.key];
      if (typeof r === "number") {
        answered += 1;
        sum += r;
      }
    }
    itemSum += sum;
    stageResults[stage.key] = sum / stage.items.length;
  }
  const stageValues = Object.values(stageResults);
  const scoreRatio =
    pkg.aggregate === "item_mean" ? itemSum / total : stageValues.reduce((a, b) => a + b, 0) / stageValues.length;
  const percent = scoreRatio * 100;
  const bandIndex = pkg.bands.findIndex((b) => percent + BAND_EPSILON >= b.min_percent);
  return { score_ratio: scoreRatio, percent, stage_results: stageResults, answered, total, band_index: bandIndex };
}
