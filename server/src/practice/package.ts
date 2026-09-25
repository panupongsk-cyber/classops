// ps-practice-package/v1: one exam session of an exam-practice family (ITPEC IT Passport first).
// Produced by the item bank's export tool (work/projects/teaching/item-bank/tools/export_practice.py)
// and imported at deploy; never stored in this repository. See migrations/012_practice.sql.

import { createHash } from "node:crypto";

export const PRACTICE_FORMAT = "ps-practice-package/v1";
const ID = /^[0-9A-Za-z_-]{1,64}$/;
const FIGURE_ID = /^[0-9A-Za-z_-]{1,80}$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_FIGURE_BYTES = 2 * 1024 * 1024;

export type PracticeLang = "en" | "th";
export interface LocalText {
  en: string;
  th?: string;
}
export interface PracticeQuestion {
  content_id: string;
  seq: number;
  stem: LocalText;
  options: { label: string; text: LocalText }[];
  answer: string;
  category: string;
  field: string;
  figure: { en?: string; th?: string } | null;
}
export interface PracticeFigure {
  id: string;
  mime: "image/png";
  sha256: string;
  data_base64: string;
}
export interface PracticePackage {
  format: typeof PRACTICE_FORMAT;
  family: string;
  exam: {
    content_id: string;
    title: string;
    subtitle?: string | null;
    provider: string;
    session?: string | null;
    item_count: number;
    time_limit_minutes?: number | null;
    languages: PracticeLang[];
    categories: { name: string; field: string }[];
    category_provenance: string;
    answer_key_provenance: string;
    translation_note?: string | null;
    attribution: string;
  };
  questions: PracticeQuestion[];
  figures: PracticeFigure[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** Every problem with a package, as `path: message` strings; empty means valid. */
export function validatePracticePackage(raw: unknown): string[] {
  const errors: string[] = [];
  const err = (path: string, message: string) => errors.push(`${path}: ${message}`);
  if (!isObject(raw)) return ["$: must be an object"];
  if (raw.format !== PRACTICE_FORMAT) err("$.format", `must be ${PRACTICE_FORMAT}`);
  if (!text(raw.family)) err("$.family", "required");
  const exam = isObject(raw.exam) ? raw.exam : {};
  if (!isObject(raw.exam)) err("$.exam", "must be an object");
  if (typeof exam.content_id !== "string" || !ID.test(exam.content_id)) err("$.exam.content_id", "bad id");
  for (const key of ["title", "provider", "attribution", "category_provenance", "answer_key_provenance"]) {
    if (!text(exam[key])) err(`$.exam.${key}`, "required");
  }
  const languages = Array.isArray(exam.languages) ? exam.languages : [];
  if (languages.length === 0 || !languages.includes("en") || languages.some((l) => l !== "en" && l !== "th")) {
    err("$.exam.languages", "must include en, and only en/th");
  }
  const hasTh = languages.includes("th");
  const categories = Array.isArray(exam.categories) ? exam.categories : [];
  const categoryNames = new Set(categories.map((c) => (isObject(c) ? c.name : undefined)));

  const figures = Array.isArray(raw.figures) ? raw.figures : [];
  const figureIds = new Set<string>();
  figures.forEach((f, i) => {
    const fp = `$.figures[${i}]`;
    if (!isObject(f) || typeof f.id !== "string" || !FIGURE_ID.test(f.id)) return err(fp, "bad figure");
    if (figureIds.has(f.id)) err(`${fp}.id`, "duplicate");
    figureIds.add(f.id);
    if (f.mime !== "image/png") err(`${fp}.mime`, "must be image/png");
    const data = typeof f.data_base64 === "string" ? Buffer.from(f.data_base64, "base64") : Buffer.alloc(0);
    if (data.length === 0 || data.length > MAX_FIGURE_BYTES || !data.subarray(0, 8).equals(PNG_MAGIC)) err(`${fp}.data_base64`, "must be a PNG under 2 MB");
    else if (createHash("sha256").update(data).digest("hex") !== f.sha256) err(`${fp}.sha256`, "does not match the data");
  });

  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  if (questions.length === 0) err("$.questions", "must be a non-empty array");
  if (exam.item_count !== questions.length) err("$.exam.item_count", "must equal the number of questions");
  const ids = new Set<string>();
  const seqs = new Set<number>();
  questions.forEach((q, i) => {
    const qp = `$.questions[${i}]`;
    if (!isObject(q)) return err(qp, "must be an object");
    if (typeof q.content_id !== "string" || !ID.test(q.content_id) || ids.has(q.content_id)) err(`${qp}.content_id`, "bad or duplicate id");
    else ids.add(q.content_id);
    if (!Number.isInteger(q.seq) || (q.seq as number) < 1 || seqs.has(q.seq as number)) err(`${qp}.seq`, "bad or duplicate seq");
    else seqs.add(q.seq as number);
    const stem = isObject(q.stem) ? q.stem : {};
    if (!text(stem.en)) err(`${qp}.stem.en`, "required");
    if (hasTh && !text(stem.th)) err(`${qp}.stem.th`, "required: the exam lists th");
    const options = Array.isArray(q.options) ? q.options : [];
    const labels = options.map((o) => (isObject(o) ? o.label : undefined));
    if (options.length < 2 || new Set(labels).size !== labels.length || labels.some((l) => typeof l !== "string" || !/^[a-z]$/.test(l))) {
      err(`${qp}.options`, "needs 2+ options with unique single-letter labels");
    }
    options.forEach((o, j) => {
      const t = isObject(o) && isObject(o.text) ? o.text : {};
      if (!text(t.en)) err(`${qp}.options[${j}].text.en`, "required");
      if (hasTh && !text(t.th)) err(`${qp}.options[${j}].text.th`, "required: the exam lists th");
    });
    if (typeof q.answer !== "string" || !labels.includes(q.answer)) err(`${qp}.answer`, "must be one of the option labels");
    if (!text(q.category) || !categoryNames.has(q.category)) err(`${qp}.category`, "must be one of $.exam.categories");
    if (!text(q.field)) err(`${qp}.field`, "required");
    if (q.figure !== null && q.figure !== undefined) {
      const fig = isObject(q.figure) ? q.figure : {};
      for (const [lang, id] of Object.entries(fig)) {
        if ((lang !== "en" && lang !== "th") || typeof id !== "string" || !figureIds.has(id)) err(`${qp}.figure.${lang}`, "must name a packaged figure");
      }
    }
  });
  return errors;
}
