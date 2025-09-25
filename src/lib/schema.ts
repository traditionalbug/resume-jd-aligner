import { z } from "zod";

// Facts extracted ONLY from the resume (ground truth)
export const Fact = z.object({
  id: z.string(),                       // "f1"
  type: z.enum(["role","company","date","skill","tool","metric","achievement","summary"]),
  text: z.string().min(1),              // verbatim or close paraphrase
  sourceSpan: z.object({                // provenance for transparency
    startLine: z.number().int().nonnegative().optional(),
    endLine: z.number().int().nonnegative().optional(),
  }).optional(),
  tags: z.array(z.string()).optional(), // e.g., ["backend","aws"]
});
export const FactsJSON = z.object({
  facts: z.array(Fact).min(1),
});

// JD diff: what’s present vs missing (computed from facts)
export const DiffJSON = z.object({
  supported_keywords: z.array(z.string()).default([]),
  missing_keywords: z.array(z.string()).default([]),
});

// Editor output constrained to facts (no free-form facts!)
export const EditorJSON = z.object({
  fitScore: z.number().min(0).max(100),
  missing_keywords: z.array(z.string()).default([]),
  key_gaps: z.array(z.string()).default([]),
  aligned_resume: z.array(z.object({
    bullet: z.string().min(1),
    source_ids: z.array(z.string()).min(1), // must reference one or more Fact.id
  })).default([]),
  rationale: z.string().default(""),
});

export type TFact = z.infer<typeof Fact>;
export type TFactsJSON = z.infer<typeof FactsJSON>;
export type TDiffJSON = z.infer<typeof DiffJSON>;
export type TEditorJSON = z.infer<typeof EditorJSON>;