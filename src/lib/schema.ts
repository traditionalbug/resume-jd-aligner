// src/lib/schema.ts
import { z } from "zod";

/* ---------- Resume Facts (ground truth) ---------- */
export const Fact = z.object({
  id: z.string(), // "f1"
  type: z.enum(["role", "company", "date", "skill", "tool", "metric", "achievement", "summary"]),
  text: z.string().min(1),
  sourceSpan: z
    .object({
      startLine: z.number().int().nonnegative().optional(),
      endLine: z.number().int().nonnegative().optional(),
    })
    .optional(),
  tags: z.array(z.string()).optional(),
});
export const FactsJSON = z.object({
  facts: z.array(Fact).min(1),
});
export type TFact = z.infer<typeof Fact>;
export type TFactsJSON = z.infer<typeof FactsJSON>;

/* ---------- JD Requirements (local parsing) ---------- */
export const JDRequirements = z.object({
  must_have: z.array(z.string()).default([]),
  nice_to_have: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  canonical_phrases: z.array(z.string()).default([]), // deduped union of all lists
});
export type TJDRequirements = z.infer<typeof JDRequirements>;

/* ---------- Diff & Editor (from previous chunks) ---------- */
export const DiffJSON = z.object({
  supported_keywords: z.array(z.string()).default([]),
  missing_keywords: z.array(z.string()).default([]),
});
export type TDiffJSON = z.infer<typeof DiffJSON>;

export const EditorJSON = z.object({
  fitScore: z.number().min(0).max(100),
  missing_keywords: z.array(z.string()).default([]),
  key_gaps: z.array(z.string()).default([]),
  aligned_resume: z
    .array(
      z.object({
        bullet: z.string().min(1),
        source_ids: z.array(z.string()).min(1),
      }),
    )
    .default([]),
  rationale: z.string().default(""),
});
export type TEditorJSON = z.infer<typeof EditorJSON>;

/* ---------- Coverage summary (non-LLM) ---------- */
export const Coverage = z.object({
  must_have: z.object({ covered: z.number(), total: z.number(), items_uncovered: z.array(z.string()) }),
  responsibilities: z.object({ covered: z.number(), total: z.number(), items_uncovered: z.array(z.string()) }),
  nice_to_have: z.object({ covered: z.number(), total: z.number(), items_uncovered: z.array(z.string()) }),
  exact_match_ratio: z.number(), // 0..1
});
export type TCoverage = z.infer<typeof Coverage>;
