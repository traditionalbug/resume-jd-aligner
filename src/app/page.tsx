"use client";
import { useState } from "react";

type AnalyzeResult = {
  // works with both mock + live pipeline
  fitScore?: number;
  matchedCount?: number;
  totalJDWords?: number;
  sampleMatches?: string[];
  note?: string;

  // live pipeline extras
  missingKeywords?: string[];
  keyGaps?: string[];
  alignedResume?: string;   // joined bullets from server
  rationale?: string;
  criticsCount?: number;

  // error shape
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
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data = (await res.json()) as AnalyzeResult;
      setResult(data ?? {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

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

        {/* Errors */}
        {error && <div className="text-red-400">{error}</div>}

        {/* Results */}
        {result && !error && (
          <div className="mt-6 rounded-2xl bg-zinc-800 p-4 space-y-4">
            {/* Always show fit score if present */}
            {typeof result.fitScore === "number" && (
              <div className="text-lg font-medium">Fit Score: {result.fitScore}%</div>
            )}

            {/* Mock-only counters (safe to show if present) */}
            {(typeof result.matchedCount === "number" &&
              typeof result.totalJDWords === "number") && (
              <div className="text-sm text-zinc-400">
                {result.matchedCount} / {result.totalJDWords} JD terms detected in resume
              </div>
            )}

            {/* Sample matches from mock */}
            {Array.isArray(result.sampleMatches) && result.sampleMatches.length > 0 && (
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Sample matches</div>
                <div className="flex flex-wrap gap-2">
                  {result.sampleMatches.map((w, i) => (
                    <span key={`${w}-${i}`} className="px-2 py-1 rounded-xl bg-zinc-700">{w}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Live pipeline: Missing Keywords */}
            {Array.isArray(result.missingKeywords) && result.missingKeywords.length > 0 && (
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Missing keywords</div>
                <div className="flex flex-wrap gap-2">
                  {result.missingKeywords.map((w, i) => (
                    <span key={`${w}-${i}`} className="px-2 py-1 rounded-xl bg-zinc-700">{w}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Live pipeline: Gaps (do NOT auto-add) */}
            {Array.isArray(result.keyGaps) && result.keyGaps.length > 0 && (
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Gaps (do NOT add unless true)</div>
                <ul className="list-disc pl-5 space-y-1">
                  {result.keyGaps.map((g, i) => (
                    <li key={`gap-${i}`}>{g}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Live pipeline: Aligned resume draft */}
            {result.alignedResume && (
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Aligned resume (draft)</div>
                <textarea
                  className="w-full h-56 p-3 rounded-xl bg-zinc-900"
                  value={result.alignedResume}
                  readOnly
                />
              </div>
            )}

            {/* Notes / provenance */}
            {result.note && (
              <p className="mt-1 text-xs text-zinc-400">{result.note}</p>
            )}
            {typeof result.criticsCount === "number" && (
              <p className="mt-1 text-xs text-zinc-500">
                Critics used: {result.criticsCount}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}