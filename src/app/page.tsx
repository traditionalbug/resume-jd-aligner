"use client";
import { useState } from "react";

type Coverage = {
  must_have: { covered: number; total: number; items_uncovered: string[] };
  responsibilities: { covered: number; total: number; items_uncovered: string[] };
  nice_to_have: { covered: number; total: number; items_uncovered: string[] };
  exact_match_ratio: number; // 0..1
};

type AnalyzeResult = {
  fitScore?: number;
  alignedResume?: string;
  keyGaps?: string[];
  uncoveredRequirements?: string[];
  rationale?: string;
  coverage?: Coverage;
  note?: string;
  error?: string;
  details?: string;
} | null;

export default function Page() {
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResult>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, jd }),
      });

      if (!res.ok) {
        // Read the body so we can see server error details
        let body = "";
        try {
          body = await res.text();
        } catch {}
        throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
      }

      const data = (await res.json()) as AnalyzeResult;
      setResult(data ?? {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const cov = result?.coverage;
  const pct = cov ? Math.round((cov.exact_match_ratio ?? 0) * 100) : null;

  return (
    <main className="min-h-screen p-6 md:p-10 bg-gradient-to-b from-zinc-900 to-black text-zinc-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl md:text-4xl font-semibold">Resume ↔ JD Aligner (MVP)</h1>

        {/* Form */}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block mb-2 text-sm uppercase tracking-wide text-zinc-400">Resume</label>
            <textarea
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              className="w-full h-40 p-3 rounded-xl bg-zinc-800 outline-none"
              placeholder="Paste your resume text…"
              required
            />
          </div>
          <div>
            <label className="block mb-2 text-sm uppercase tracking-wide text-zinc-400">Job Description</label>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              className="w-full h-40 p-3 rounded-xl bg-zinc-800 outline-none"
              placeholder="Paste the JD text…"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-3 rounded-2xl bg-white text-black font-medium disabled:opacity-50"
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </form>

        {/* Error box with full details */}
        {error && (
          <div className="rounded-xl bg-red-900/30 border border-red-500/40 p-4 text-red-200 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {result && !error && (
          <div className="mt-6 rounded-2xl bg-zinc-800 p-4 space-y-4">
            {typeof result.fitScore === "number" && (
              <div className="text-lg font-medium">Fit Score: {result.fitScore}%</div>
            )}

            {cov && (
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">
                  Coverage (non-LLM): {pct}% — Must-have {cov.must_have.covered}/{cov.must_have.total} ·
                  Responsibilities {cov.responsibilities.covered}/{cov.responsibilities.total} ·
                  Nice-to-have {cov.nice_to_have.covered}/{cov.nice_to_have.total}
                </div>
              </div>
            )}

            {Array.isArray(result.uncoveredRequirements) && result.uncoveredRequirements.length > 0 && (
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Uncovered job requirements</div>
                <div className="flex flex-wrap gap-2">
                  {result.uncoveredRequirements.map((w, i) => (
                    <span key={`${w}-${i}`} className="px-2 py-1 rounded-xl bg-zinc-700">{w}</span>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(result.keyGaps) && result.keyGaps.length > 0 && (
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Gaps (do NOT add unless true)</div>
                <ul className="list-disc pl-5 space-y-1">
                  {result.keyGaps.map((g, i) => <li key={`gap-${i}`}>{g}</li>)}
                </ul>
              </div>
            )}

            {result.alignedResume && (
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Aligned resume (draft)</div>
                <textarea className="w-full h-56 p-3 rounded-xl bg-zinc-900" value={result.alignedResume} readOnly />
              </div>
            )}

            {result.note && <p className="mt-1 text-xs text-zinc-400">{result.note}</p>}
          </div>
        )}
      </div>
    </main>
  );
}