// src/lib/llms.ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------- Clients (server-side only) ----------
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const gemini = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

// ---------- Model choices (Ultra-lean plan) ----------
export const MODELS = {
  CRITIC_A: "gemini-2.0-flash",          // critic (facts extractor)
  CRITIC_B: "gpt-4o-mini",               // critic (facts extractor)
  CRITIC_C: "claude-3-5-haiku-latest",   // critic (facts extractor)
  EDITOR:   "gpt-4.1-mini",              // constrained editor
  CONSENSUS:"gemini-2.0-flash",          // light consensus/validator
} as const;

// ---------- Prompts ----------
/** Original critic guidance (kept for reference / other uses).
 *  We now mainly use factSystem for strict facts extraction.
 */
export const criticSystem = `
You are a resume-to-JD critic. Output STRICT JSON only:
{"score":0-100,"missing_keywords":["..."],"rewrite_suggestions":["..."],"notes":"..."}
No extra text.
`;

/** NEW: Strict resume facts extractor (used in Chunk 2)
 *  Purpose: Build ground-truth facts from the resume ONLY.
 */
export const factSystem = `
Extract atomic FACTS from the RESUME only. DO NOT invent.
Return STRICT JSON only matching this TypeScript shape:
{"facts":[
  {"id":"f1","type":"role|company|date|skill|tool|metric|achievement|summary","text":"...","sourceSpan":{"startLine":1,"endLine":2},"tags":["optional","tags"]},
  {"id":"f2","type":"skill","text":"TypeScript"}
]}
Rules:
- Facts MUST come from the resume content only; ignore the JD entirely.
- Preserve metrics exactly as written (e.g., "increased CTR by 18%").
- Use short, faithful text. Avoid generic claims.
- No new companies, roles, tools, certifications, or dates that aren't present.
- Generate stable ids: f1, f2, f3...
- JSON only. No markdown, no commentary.
`;

// ---------- Helpers ----------
/** Some models sometimes wrap JSON in prose or code fences.
 *  This extracts the first {...} block safely and parses it.
 */
export function extractJson(s: string) {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return JSON.parse(s.slice(start, end + 1));
}