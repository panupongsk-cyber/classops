// A synthetic learning-activity package for tests. Never put real activity content here:
// this repository is public, and real packages carry answer keys.

import type { ActivityPackage } from "../../src/activities/engine.js";

const t = (en: string) => ({ en });

export function syntheticPackage(): ActivityPackage {
  return {
    format: "ps-activity-package/v1",
    package: "synthetic-demo",
    version: 1,
    title: t("Demo"),
    languages: ["en"],
    source: { game: "synthetic", converter: "none", files: [] },
    aggregate: "stage_mean",
    reveal: "none",
    bands: [
      { min_percent: 90, badge: "A", title: t("High") },
      { min_percent: 50, title: t("Mid") },
      { min_percent: 0, title: t("Low") },
    ],
    flags: { bad: { title: t("Bad pick"), body: t("That option is forbidden.") } },
    stages: [
      {
        key: "s1",
        title: t("Stage one"),
        items: [
          {
            key: "i1",
            scenario: t("Pick one."),
            explanation: t("Because."),
            parts: [
              {
                key: "one",
                type: "single_choice",
                weight: 0.6,
                prompt: t("Which?"),
                shuffle: true,
                options: [
                  { id: "a", label: t("A") },
                  { id: "b", label: t("B") },
                  { id: "c", label: t("C") },
                ],
                answer_key: "b",
              },
              {
                key: "rows",
                type: "categorize",
                weight: 0.4,
                rows: [
                  { id: "r1", label: t("Row 1") },
                  { id: "r2", label: t("Row 2") },
                ],
                categories: [
                  { id: "X", label: t("X") },
                  { id: "Y", label: t("Y") },
                ],
                answer_key: { r1: "X", r2: "Y" },
              },
            ],
            rules: [{ type: "zero_if_row_value", part: "rows", row: "r2", category: "X", flag: "bad" }],
          },
        ],
      },
      {
        key: "s2",
        title: t("Stage two"),
        items: [
          {
            key: "i2",
            parts: [
              {
                key: "pair",
                type: "multi_select",
                weight: 0.5,
                shuffle: false,
                options: ["p", "q", "r", "s"].map((id) => ({ id, label: t(id.toUpperCase()) })),
                min: 2,
                max: 2,
                scoring: { mode: "credit_by_correct", key: ["p", "q"], credit: [0, 0.5, 1] },
              },
              {
                key: "many",
                type: "multi_select",
                weight: 0.5,
                shuffle: true,
                options: ["m1", "m2", "m3", "m4"].map((id) => ({ id, label: t(id) })),
                min: 1,
                max: null,
                scoring: { mode: "share_of_allowed", allowed: ["m1", "m2", "m3"] },
              },
            ],
            rules: [{ type: "zero_if_selected", part: "many", options: ["m4"], flag: "bad" }],
          },
          {
            key: "i3",
            parts: [
              {
                key: "v",
                type: "verdict_matrix",
                weight: 1,
                rows: [
                  { id: "c1", label: t("Claim 1") },
                  { id: "c2", label: t("Claim 2") },
                ],
                categories: [
                  { id: "CAN", label: t("Can claim") },
                  { id: "CANNOT", label: t("Cannot claim yet") },
                ],
                answer_key: { c1: "CAN", c2: "CANNOT" },
              },
            ],
          },
        ],
      },
    ],
  };
}
