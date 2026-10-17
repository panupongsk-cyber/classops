import { z } from "zod";
import { validatePracticePackage, type PracticePackage } from "../practice/package.js";

export const LIBRARY_FORMAT = "ps-library-package/v1";
export interface LibraryPackage {
  format: typeof LIBRARY_FORMAT;
  source: { commit: string; path: string };
  paper: PracticePackage;
}
const header = z.object({
  format: z.literal(LIBRARY_FORMAT),
  source: z.object({
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    path: z.string().regex(/^work\/projects\/teaching\/item-bank\/[a-z0-9-]+\/questions\.json$/),
  }).strict(),
  paper: z.unknown(),
}).strict();

export function validateLibraryPackage(raw: unknown): string[] {
  const result = header.safeParse(raw);
  if (!result.success) return result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  return validatePracticePackage(result.data.paper);
}
