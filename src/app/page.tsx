"use client";
import { useState } from "react";

type AnalyzeResult = {
  fitScore?: number;
  matchedCount?: number;
  totalJDWords?: number;
  sampleMatches?: string[];
  note?: string;
  // live pipeline fields
  missingKeywords?: string[];
  keyGaps?: string[];
  alignedResume?: string;
  rationale?: string;
  criticsCount?: number;
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
      const data = await res.json();
      setResult(data ?? {});
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-6 md:p-10 bg-gradient-to-b from-zinc-900 to-black text-zinc-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl md:text-4xl font-semibold">Resume ↔ JD Aligner (MVP)</h1>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block mb-2 text-sm uppercase tracking-wide text-zinc-400">Resume</label>
            <textarea
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              className="w-full h-40 p-3 rounded-xl bg-zinc-800 outline-none"
              placeholder="Paste your resume text..."
              required
            />
          </div>

          <div>
            <label className="block mb-2 text-sm uppercase tracking-wide text-zinc-400">Job Description</label>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              className="w-full h-40 p-3 rounded-xl bg-zinc-800 outline-none"
              placeholder="Paste the JD text..."
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-5 py-3 rounded-2xl bg-white text-black font-medium disabled:opacity-50"
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </form>

        {error && (
          <div className="text-red-400">
            {error}
          </div>
        )}

        {result && !error && (
          <div className="mt-6 rounded-2xl bg-zinc-800 p-4 space-y-3">
            {/* Works for mock or live */}
            {typeof result.fitScore === "number" && (
              <div className="text-lg font-medium">Fit Score: {result.fitScore}%</div>
            )}
            {(typeof result.matchedCount === "number" && typeof result.totalJDWords === "number") && (
              <div className="text-sm text-zinc-400">
                {result.matchedCount} / {result.totalJDWords} JD terms detected in resume
              </div>
            )}
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

            {/* Live-only extras (render if present) */}
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

            {result.note && (
              <p className="mt-1 text-xs text-zinc-400">{result.note}</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}