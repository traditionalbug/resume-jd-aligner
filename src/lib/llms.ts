import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const gemini = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

export const MODELS = {
  CRITIC_A: "gemini-2.0-flash",
  CRITIC_B: "gpt-4o-mini",
  CRITIC_C: "claude-3-5-haiku-latest",
  EDITOR:   "gpt-4.1-mini",
  CONSENSUS:"gemini-2.0-flash",
};

export const criticSystem = `
You are a resume-to-JD critic. Output STRICT JSON only:
{"score":0-100,"missing_keywords":["..."],"rewrite_suggestions":["..."],"notes":"..."}
No extra text.
`;

// helper: sometimes models wrap JSON in junk; try to extract
export function extractJson(s: string) {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON found");
  return JSON.parse(s.slice(start, end + 1));
}