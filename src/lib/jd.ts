// src/lib/jd.ts
import { JDRequirements, TJDRequirements } from "./schema";

/** Very small English stopword set (enough to remove junk like "per", "out", "our"). */
const STOP = new Set([
  "the","a","an","and","or","for","to","of","in","on","with","by","from","at","as","per","out","our","one",
  "is","are","be","being","been","that","this","those","these","it","its","into","about","across","over","under",
  "early","form","act" // noisy JD words we saw
]);

/** Normalize a phrase: lowercase, trim, collapse spaces, strip punctuation edges. */
export function normalizePhrase(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[\(\)\[\]\{\},;:]/g, " ")
    .replace(/[^a-z0-9+\-\.% ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

/** Return true if phrase is worth keeping (>= 3 chars, not only stopwords, contains letter/number). */
function keepPhrase(s: string): boolean {
  if (!s) return false;
  if (s.length < 3) return false;
  if (!/[a-z0-9]/.test(s)) return false;
  if (STOP.has(s)) return false;
  return true;
}

/** Simple alias map for common tech synonyms. */
const ALIASES: Record<string, string> = {
  "llm": "large language model",
  "k8s": "kubernetes",
  "js": "javascript",
  "ts": "typescript",
  "csat": "customer satisfaction",
};

function applyAliases(p: string): string {
  return ALIASES[p] ?? p;
}

/** Extract phrases from JD lines prefixed with common keywords. */
function extractLists(jd: string) {
  const lines = jd.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const must: string[] = [];
  const nice: string[] = [];
  const resp: string[] = [];

  for (const line of lines) {
    const norm = normalizePhrase(line);
    const isMust = /must|required|need|mandatory/.test(norm);
    const isNice = /nice to have|preferred|plus|bonus/.test(norm);
    const isResp = /responsibilit|own|lead|deliver|manage|design|build|implement|ship|execute/.test(norm);

    // Break a line into candidate phrases (comma/semicolon and "and" separators)
    const candidates = norm
      .split(/[,;]| and /g)
      .map((s) => s.trim())
      .map(applyAliases)
      .filter(keepPhrase);

    if (isMust) must.push(...candidates);
    else if (isNice) nice.push(...candidates);
    else if (isResp) resp.push(...candidates);
  }

  // If lists are too small, fall back to top n-grams by length
  const bag = [...must, ...nice, ...resp];
  if (bag.length < 6) {
    const extra = normalizePhrase(jd)
      .split(/[.,;\n]/g)
      .map((s) => s.trim())
      .filter((s) => s.split(" ").length <= 6)
      .map(applyAliases)
      .filter(keepPhrase)
      .slice(0, 20);
    resp.push(...extra);
  }

  // Deduplicate and build canonical union
  const dedup = (arr: string[]) => Array.from(new Set(arr));
  const mustD = dedup(must);
  const niceD = dedup(nice);
  const respD = dedup(resp);
  const canonical = dedup([...mustD, ...respD, ...niceD]);

  return { must_have: mustD, nice_to_have: niceD, responsibilities: respD, canonical_phrases: canonical };
}

/** Public: build structured JD requirements (local only). */
export function buildJDRequirements(jd: string): TJDRequirements {
  return JDRequirements.parse(extractLists(jd));
}
