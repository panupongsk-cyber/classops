// A synthetic ps-practice-package/v1 (invented questions). Real exam packages come from the item
// bank at deploy time and never enter this public repository.
import { createHash } from "node:crypto";

import type { PracticePackage } from "../../src/practice/package.js";

// The smallest valid PNG (1x1, transparent).
export const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6300010000050001" + "0d0a2db40000000049454e44ae426082",
  "hex",
);

export function syntheticPracticePackage(contentId = "2099S_XX", withThai = true): PracticePackage {
  const figureId = `${contentId}_Q002_en`;
  const t = (en: string, th: string) => (withThai ? { en, th } : { en });
  return {
    format: "ps-practice-package/v1",
    family: "synthetic",
    exam: {
      content_id: contentId,
      title: "Synthetic Practice Exam",
      subtitle: "Invented questions",
      provider: "Synthetic Provider",
      session: "Test session",
      item_count: 4,
      time_limit_minutes: 10,
      languages: withThai ? ["en", "th"] : ["en"],
      categories: [
        { name: "Alpha", field: "Strategy" },
        { name: "Beta", field: "Technology" },
      ],
      category_provenance: "analyst-inferred",
      answer_key_provenance: "official",
      translation_note: withThai ? "Synthetic Thai text." : null,
      attribution: "Synthetic questions for tests.",
    },
    questions: [1, 2, 3, 4].map((seq) => ({
      content_id: `${contentId}_Q00${seq}`,
      seq,
      stem: t(`Synthetic question ${seq}?`, `คำถามสังเคราะห์ ${seq}`),
      options: ["a", "b", "c", "d"].map((label) => ({ label, text: t(`option ${label}`, `ตัวเลือก ${label}`) })),
      answer: ["b", "c", "a", "d"][seq - 1]!,
      category: seq <= 2 ? "Alpha" : "Beta",
      field: seq <= 2 ? "Strategy" : "Technology",
      figure: seq === 2 ? { en: figureId } : null,
    })),
    figures: [{ id: figureId, mime: "image/png", sha256: createHash("sha256").update(TINY_PNG).digest("hex"), data_base64: TINY_PNG.toString("base64") }],
  };
}
