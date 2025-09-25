// src/app/api/analyze/route.ts
import { NextResponse } from "next/server";
import { MODELS, openai, anthropic, gemini, factSystem, extractJson } from "@/lib/llms";
import { z } from "zod";
import {
  FactsJSON, TFactsJSON, TFact,
  DiffJSON, TEditorJSON, EditorJSON,
  Coverage, TCoverage,
} from "@/lib/schema";
import { buildJDRequirements } from "@/lib/jd";

export const runtime = "nodejs";

/* ---------------- Config knobs (can move to env later) ---------------- */
const FAST_PATH_THRESHOLD = Number(process.env.FAST_PATH_THRESHOLD ?? 88); // % coverage
const CRITIC_TIMEOUT_MS = Number(process.env.CRITIC_TIMEOUT_MS ?? 3500);

/* ---------------- Utilities ---------------- */
type Body = { resume?: string; jd?: string };

function tokenize(s: string) {
  return Array.from(new Set(s.toLowerCase().match(/\b[a-z0-9+\-\.%]{3,}\b/g) || []));
}
function mockScore(resume = "", jd = "") {
  const r = resume.toLowerCase();
  const terms = tokenize(jd);
  const matched = terms.filter((t) => r.includes(t));
  const fit = terms.length ? Math.round((matched.length / terms.length) * 100) : 0;
  return { fitScore: fit, matchedCount: matched.length, totalJDWords: terms.length, sampleMatches: matched.slice(0, 20) };
}
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
  });
}

/* ---------------- Stage 1: Facts extractors ---------------- */
async function extractFactsGemini(resume: string): Promise<TFactsJSON> {
  const model = gemini.getGenerativeModel({ model: MODELS.CRITIC_A });
  const prompt = `${factSystem}\nRESUME:\n${resume}`;
  const r = await withTimeout(model.generateContent(prompt), CRITIC_TIMEOUT_MS, "gemini");
  const raw = extractJson(r.response.text());
  return FactsJSON.parse(raw);
}
async function extractFactsOpenAI(resume: string): Promise<TFactsJSON> {
  const r = await withTimeout(
    openai.chat.completions.create({
      model: MODELS.CRITIC_B,
      temperature: 0.1,
      messages: [{ role: "system", content: factSystem }, { role: "user", content: `RESUME:\n${resume}` }],
      max_tokens: 900,
      response_format: { type: "json_object" },
    }),
    CRITIC_TIMEOUT_MS,
    "openai",
  );
  const raw = JSON.parse(r.choices[0].message.content || "{}");
  return FactsJSON.parse(raw);
}
async function extractFactsClaude(resume: string): Promise<TFactsJSON> {
  const r = await withTimeout(
    anthropic.messages.create({
      model: MODELS.CRITIC_C,
      temperature: 0.1,
      max_tokens: 900,
      system: factSystem,
      messages: [{ role: "user", content: `RESUME:\n${resume}` }],
    }),
    CRITIC_TIMEOUT_MS,
    "anthropic",
  );
  const text = r.content[0].type === "text" ? r.content[0].text : "{}";
  const raw = extractJson(text);
  return FactsJSON.parse(raw);
}

// Merge/union facts from multiple bags
function mergeFacts(bags: TFactsJSON[]): TFactsJSON {
  const map = new Map<string, TFact>();
  let i = 1;
  for (const b of bags) {
    for (const f of b.facts) {
      const key = `${f.type}|${f.text.trim().toLowerCase()}`;
      if (!map.has(key)) map.set(key, { ...f, id: `f${i++}` });
    }
  }
  return { facts: Array.from(map.values()) };
}

/* ---------------- Stage 0: JD skill map + coverage ---------------- */
function coverageAgainstFacts(jd: ReturnType<typeof buildJDRequirements>, facts: TFactsJSON): TCoverage {
  const factText = facts.facts.map((f) => f.text.toLowerCase()).join(" \n ");
  const scoreOne = (arr: string[]) => {
    const total = arr.length;
    const uncovered: string[] = [];
    let covered = 0;
    for (const p of arr) {
      if (factText.includes(p.toLowerCase())) covered++;
      else uncovered.push(p);
    }
    return { covered, total, items_uncovered: uncovered };
  };
  const must = scoreOne(jd.must_have);
  const resp = scoreOne(jd.responsibilities);
  const nice = scoreOne(jd.nice_to_have);
  const exact_match_ratio =
    (must.covered + resp.covered + nice.covered) / Math.max(1, must.total + resp.total + nice.total);
  return Coverage.parse({ must_have: must, responsibilities: resp, nice_to_have: nice, exact_match_ratio });
}

/* ---------------- Stage 3: Editor (same as before) ---------------- */
async function editorRewrite(
  resume: string,
  facts: TFactsJSON,
  supported: string[],
): Promise<TEditorJSON> {
  const r = await openai.chat.completions.create({
    model: MODELS.EDITOR,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `You are the single editor. You may ONLY use information from facts_json and supported_keywords to rewrite the resume.
- Rephrase/reorder only; no new companies, roles, tools, or metrics.
- Every bullet MUST include source_ids from facts_json.
- Place unsupported items into key_gaps/missing_keywords; do NOT insert into aligned_resume.
Return STRICT JSON:
{"fitScore":0-100,"missing_keywords":["..."],"key_gaps":["..."],
 "aligned_resume":[{"bullet":"...", "source_ids":["f1","f3"]}],
 "rationale":"..."}`,
      },
      {
        role: "user",
        content: `facts_json:
${JSON.stringify(facts, null, 2)}

supported_keywords:
${JSON.stringify(supported)}

resume (original, for style only):
${resume}
`,
      },
    ],
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });
  const raw = JSON.parse(r.choices[0].message.content || "{}");
  return EditorJSON.parse(raw);
}

/* ---------------- GET ---------------- */
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/analyze" });
}

/* ---------------- POST (adaptive path) ---------------- */
export async function POST(req: Request) {
  try {
    const { resume = "", jd = "" } = (await req.json()) as Body;

    if (!process.env.OPENAI_API_KEY || !process.env.GOOGLE_API_KEY || !process.env.ANTHROPIC_API_KEY) {
      const mock = mockScore(resume, jd);
      return NextResponse.json({ ...mock, note: "Using MOCK (missing one or more API keys)" });
    }

    // 0) Build JD skill map locally
    const jdReq = buildJDRequirements(jd);

    // 1) FAST PATH: Critic A only
    const factsA = await extractFactsGemini(resume);
    const coverageA = coverageAgainstFacts(jdReq, factsA);
    const coveragePctA = Math.round(coverageA.exact_match_ratio * 100);

    let mergedFacts = factsA;
    let pathNote = `Fast path (Critic A only). Coverage=${coveragePctA}%`;

    // Escalate if below threshold
    if (coveragePctA < FAST_PATH_THRESHOLD) {
      const results = await Promise.allSettled([extractFactsOpenAI(resume), extractFactsClaude(resume)]);
      const bags: TFactsJSON[] = [factsA];
      for (const r of results) if (r.status === "fulfilled") bags.push(r.value);
      mergedFacts = mergeFacts(bags);
      const coverageFull = coverageAgainstFacts(jdReq, mergedFacts);
      pathNote = `Full path (A+B+C). Coverage=${Math.round(coverageFull.exact_match_ratio * 100)}%`;
    }

    // Supported phrases = those present in mergedFacts
    const factText = mergedFacts.facts.map((f) => f.text.toLowerCase()).join(" \n ");
    const supported = jdReq.canonical_phrases.filter((p) => factText.includes(p.toLowerCase()));
    const missing = jdReq.canonical_phrases.filter((p) => !factText.includes(p.toLowerCase()));

    // 2) Editor (constrained)
    const editorOut = await editorRewrite(resume, mergedFacts, supported);

    // 3) Response
    return NextResponse.json({
      fitScore: editorOut.fitScore,
      uncoveredRequirements: missing, // renamed from "missingKeywords"
      keyGaps: editorOut.key_gaps,
      alignedResume: editorOut.aligned_resume.map((b) => b.bullet).join("\n"),
      rationale: editorOut.rationale,
      coverage: coverageAgainstFacts(jdReq, mergedFacts),
      criticsCount: mergedFacts.facts.length ? 1 : 0,
      note: `Live pipeline with JD skill map → adaptive routing. ${pathNote}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "analysis_failed", details: message }, { status: 500 });
  }
}
