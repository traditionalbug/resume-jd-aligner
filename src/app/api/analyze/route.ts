import { NextResponse } from "next/server";
import { MODELS, openai, anthropic, gemini, criticSystem, extractJson } from "@/lib/llms";

export const runtime = "nodejs";

type Body = { resume?: string; jd?: string };

// --- simple mock if keys missing ---
function tokenizeSample(s: string) {
  return Array.from(new Set(s.toLowerCase().match(/\b[a-z0-9+\-\.]{3,}\b/g) || []));
}
function mockScore(resume = "", jd = "") {
  const r = resume.toLowerCase();
  const terms = tokenizeSample(jd);
  const matched = terms.filter(t => r.includes(t));
  const fit = terms.length ? Math.round((matched.length / terms.length) * 100) : 0;
  return { fitScore: fit, matchedCount: matched.length, totalJDWords: terms.length, sampleMatches: matched.slice(0, 20) };
}

// --- critics ---
async function criticGemini(resume: string, jd: string) {
  const model = gemini.getGenerativeModel({ model: MODELS.CRITIC_A });
  const prompt = `${criticSystem}\nRESUME:\n${resume}\n\nJD:\n${jd}`;
  const r = await model.generateContent(prompt);
  return extractJson(r.response.text());
}

async function criticOpenAI(resume: string, jd: string) {
  const r = await openai.chat.completions.create({
    model: MODELS.CRITIC_B,
    temperature: 0.2,
    messages: [
      { role: "system", content: criticSystem },
      { role: "user", content: `RESUME:\n${resume}\n\nJD:\n${jd}` },
    ],
    max_tokens: 800,
    response_format: { type: "json_object" },
  });
  return JSON.parse(r.choices[0].message.content || "{}");
}

async function criticClaude(resume: string, jd: string) {
  const r = await anthropic.messages.create({
    model: MODELS.CRITIC_C,
    max_tokens: 800,
    temperature: 0.2,
    system: criticSystem,
    messages: [{ role: "user", content: `RESUME:\n${resume}\n\nJD:\n${jd}` }],
  });
  const text = r.content[0].type === "text" ? r.content[0].text : "";
  return extractJson(text);
}

// --- editor ---
async function editorConsolidate(resume: string, jd: string, critics: any[]) {
  const consolidated = JSON.stringify(critics);
  const r = await openai.chat.completions.create({
    model: MODELS.EDITOR,
    temperature: 0.2,
    messages: [
      { role: "system", content:
        `You are the single editor. Using critics JSON, produce JSON only:
{"fitScore":0-100,"missing_keywords":["..."],"key_gaps":["..."],
 "aligned_resume":"<full rewritten resume text>","rationale":"..."}
Return strictly valid JSON.` },
      { role: "user", content: `CRITICS:\n${consolidated}\n\nRESUME:\n${resume}\n\nJD:\n${jd}\n` },
    ],
    max_tokens: 1400,
    response_format: { type: "json_object" },
  });
  return JSON.parse(r.choices[0].message.content || "{}");
}

// --- consensus ---
async function consensusPass(editorJson: any) {
  const model = gemini.getGenerativeModel({ model: MODELS.CONSENSUS });
  const prompt = `Review this editor JSON and return JSON only (fix obvious issues or return unchanged):\n${JSON.stringify(editorJson)}`;
  const r = await model.generateContent(prompt);
  return extractJson(r.response.text());
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/analyze" });
}

export async function POST(req: Request) {
  try {
    const { resume = "", jd = "" } = (await req.json()) as Body;

    // if any key missing → mock response (safe for first tests)
    if (!process.env.OPENAI_API_KEY || !process.env.GOOGLE_API_KEY || !process.env.ANTHROPIC_API_KEY) {
      const mock = mockScore(resume, jd);
      return NextResponse.json({ ...mock, note: "Using MOCK (missing one or more API keys)" });
    }

    // critics in parallel
    const [a, b, c] = await Promise.allSettled([
      criticGemini(resume, jd),
      criticOpenAI(resume, jd),
      criticClaude(resume, jd),
    ]);
    const critics = [a, b, c].map((r, i) => (r.status === "fulfilled" ? r.value : { error: true, which: i }));

    // editor → consensus
    const edited = await editorConsolidate(resume, jd, critics);
    const finalJson = await consensusPass(edited);

    return NextResponse.json({
      fitScore: finalJson.fitScore ?? 0,
      missingKeywords: finalJson.missing_keywords ?? [],
      keyGaps: finalJson.key_gaps ?? [],
      alignedResume: finalJson.aligned_resume ?? "",
      rationale: finalJson.rationale ?? "",
      criticsCount: critics.length,
      note: "Live pipeline: critics → editor → consensus",
    });
  } catch (err: any) {
    return NextResponse.json({ error: "analysis_failed", details: err?.message ?? "unknown" }, { status: 500 });
  }
}
