import { NextResponse } from "next/server";
import { MODELS, openai, anthropic, gemini, criticSystem, factSystem, extractJson } from "@/lib/llms";
import { z } from "zod";
import { FactsJSON, DiffJSON, EditorJSON, TFactsJSON, TEditorJSON } from "@/lib/schema";

export const runtime = "nodejs";

type Body = { resume?: string; jd?: string };

// --- Utilities: mock fallback (unchanged idea) ---
function tokenize(s: string) {
  return Array.from(new Set(s.toLowerCase().match(/\b[a-z0-9+\-\.]{3,}\b/g) || []));
}
function mockScore(resume = "", jd = "") {
  const r = resume.toLowerCase();
  const terms = tokenize(jd);
  const matched = terms.filter((t) => r.includes(t));
  const fit = terms.length ? Math.round((matched.length / terms.length) * 100) : 0;
  return { fitScore: fit, matchedCount: matched.length, totalJDWords: terms.length, sampleMatches: matched.slice(0, 20) };
}

// --- Stage 1: Extract Facts (resume only) ---
async function extractFactsGemini(resume: string): Promise<TFactsJSON> {
  const model = gemini.getGenerativeModel({ model: MODELS.CRITIC_A });
  const prompt = `${factSystem}\nRESUME:\n${resume}`;
  const r = await model.generateContent(prompt);
  const raw = extractJson(r.response.text());
  return FactsJSON.parse(raw); // validate
}

async function extractFactsOpenAI(resume: string): Promise<TFactsJSON> {
  const r = await openai.chat.completions.create({
    model: MODELS.CRITIC_B,
    temperature: 0.1,
    messages: [
      { role: "system", content: factSystem },
      { role: "user", content: `RESUME:\n${resume}` },
    ],
    max_tokens: 900,
    response_format: { type: "json_object" },
  });
  const raw = JSON.parse(r.choices[0].message.content || "{}");
  return FactsJSON.parse(raw);
}

async function extractFactsClaude(resume: string): Promise<TFactsJSON> {
  const r = await anthropic.messages.create({
    model: MODELS.CRITIC_C,
    temperature: 0.1,
    max_tokens: 900,
    system: factSystem,
    messages: [{ role: "user", content: `RESUME:\n${resume}` }],
  });
  const text = r.content[0].type === "text" ? r.content[0].text : "{}";
  const raw = extractJson(text);
  return FactsJSON.parse(raw);
}

// Merge/union facts from multiple critics (dedupe by text)
function mergeFacts(bags: TFactsJSON[]): TFactsJSON {
  const map = new Map<string, any>();
  let i = 1;
  for (const b of bags) {
    for (const f of b.facts) {
      const key = `${f.type}|${f.text.trim().toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, { ...f, id: `f${i++}` });
      }
    }
  }
  return { facts: Array.from(map.values()) };
}

// --- Stage 2: Compute diff JD vs supported facts ---
function computeDiff(facts: TFactsJSON, jd: string) {
  const jdTerms = tokenize(jd);
  const factText = facts.facts.map(f => f.text.toLowerCase()).join(" \n ");
  const supported = jdTerms.filter(t => factText.includes(t));
  const missing = jdTerms.filter(t => !factText.includes(t));
  const raw = { supported_keywords: supported.slice(0, 200), missing_keywords: missing.slice(0, 200) };
  return DiffJSON.parse(raw); // validates shape
}

// --- Stage 3: Editor (constrained rewrite) ---
async function editorRewrite(resume: string, facts: TFactsJSON, diff: z.infer<typeof DiffJSON>): Promise<TEditorJSON> {
  const r = await openai.chat.completions.create({
    model: MODELS.EDITOR,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
`You are the single editor. You may ONLY use information from facts_json and supported_keywords to rewrite the resume.
- You may rephrase, reorder, merge, split, normalize tense.
- You MUST NOT introduce companies, roles, tools, metrics, or claims not present in facts_json.
- Every bullet MUST include source_ids referencing facts_json.facts[].id that support the bullet.
- If the JD contains items not supported by facts_json, list them under missing_keywords/key_gaps. Do not insert them into aligned_resume.
Return STRICT JSON matching:
{"fitScore":0-100,"missing_keywords":["..."],"key_gaps":["..."],
 "aligned_resume":[{"bullet":"...", "source_ids":["f1","f3"]}],
 "rationale":"..."}
JSON ONLY.`,
      },
      {
        role: "user",
        content:
`facts_json:
${JSON.stringify(facts, null, 2)}

supported_keywords:
${JSON.stringify(diff.supported_keywords)}

resume (original, for formatting style only):
${resume}
`,
      },
    ],
    max_tokens: 1500,
    response_format: { type: "json_object" },
  });
  const raw = JSON.parse(r.choices[0].message.content || "{}");
  return EditorJSON.parse(raw); // validate editor JSON
}

// --- Stage 4: Consensus/validator (drop unsupported bullets) ---
function validateProvenance(editorJson: TEditorJSON, facts: TFactsJSON): TEditorJSON {
  const factIds = new Set(facts.facts.map(f => f.id));
  const safe = {
    ...editorJson,
    aligned_resume: (editorJson.aligned_resume || []).filter(b =>
      Array.isArray(b.source_ids) && b.source_ids.length > 0 && b.source_ids.every(id => factIds.has(id))
    ),
  };
  return EditorJSON.parse(safe);
}

// --- GET (sanity) ---
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/analyze" });
}

// --- POST (main) ---
export async function POST(req: Request) {
  try {
    const { resume = "", jd = "" } = (await req.json()) as Body;

    // Fallback to mock if any key missing
    if (!process.env.OPENAI_API_KEY || !process.env.GOOGLE_API_KEY || !process.env.ANTHROPIC_API_KEY) {
      const mock = mockScore(resume, jd);
      return NextResponse.json({ ...mock, note: "Using MOCK (missing one or more API keys)" });
    }

    // 1) Extract facts in parallel from three critics
    const results = await Promise.allSettled([
      extractFactsGemini(resume),
      extractFactsOpenAI(resume),
      extractFactsClaude(resume),
    ]);
    const bags: TFactsJSON[] = results
      .map((r): TFactsJSON | null => (r.status === "fulfilled" ? r.value : null))
      .filter((x): x is TFactsJSON => !!x);

    if (bags.length === 0) {
      // very rare; fallback: treat resume tokens as skills to avoid crash
      const tokens = tokenize(resume).slice(0, 100);
      const minimal: TFactsJSON = { facts: tokens.map((t, i) => ({ id: `f${i+1}`, type: "skill", text: t })) as any };
      bags.push(minimal);
    }

    const mergedFacts = mergeFacts(bags);

    // 2) Diff JD vs facts
    const diff = computeDiff(mergedFacts, jd);

    // 3) Editor, constrained to facts + supported keywords
    const edited = await editorRewrite(resume, mergedFacts, diff);

    // 4) Validator (drop bullets without provenance)
    const finalJson = validateProvenance(edited, mergedFacts);

    // minimal response to UI
    return NextResponse.json({
      fitScore: finalJson.fitScore,
      missingKeywords: finalJson.missing_keywords,
      keyGaps: finalJson.key_gaps,
      alignedResume: finalJson.aligned_resume.map(b => b.bullet).join("\n"),
      rationale: finalJson.rationale,
      criticsCount: bags.length,
      note: "Live pipeline with facts→diff→editor (strict, no fabrication)",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "analysis_failed", details: message }, { status: 500 });
  }
}