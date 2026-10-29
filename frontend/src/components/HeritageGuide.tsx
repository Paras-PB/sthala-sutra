"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, LoaderCircle, Send, Sparkles } from "lucide-react";
import { readableError, responseError } from "@/lib/http";

type GuideSource = { title: string; url: string | null; source: string };
type GuideResponse = { answer?: string; sources?: GuideSource[] };

type HeritageGuideProps = {
  /** An archive record (grounded in its transcription) or a Wikipedia reference. */
  kind: "archive" | "reference";
  targetId: string;
  title: string;
};

const SUGGESTED_QUESTIONS: Record<HeritageGuideProps["kind"], string[]> = {
  archive: [
    "What does this record say, in plain English?",
    "Which people, places and dates does it mention?",
    "Which parts of the transcription look uncertain?",
  ],
  reference: [
    "Why is this place historically important?",
    "What should I look for when visiting?",
    "Who built it, and when?",
  ],
};

/**
 * The model answers in plain text. Blank lines separate paragraphs; lines starting
 * with "-", "*", "•" or "1." become list items.
 */
function renderAnswer(text: string): ReactNode[] {
  return text.split(/\n\s*\n/).map((block, blockIndex) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const isList = lines.length > 0 && lines.every((line) => /^([-*•]|\d+[.)])\s+/.test(line));
    if (isList) {
      return <ul key={blockIndex}>{lines.map((line, lineIndex) => <li key={lineIndex}>{line.replace(/^([-*•]|\d+[.)])\s+/, "")}</li>)}</ul>;
    }
    return <p key={blockIndex}>{lines.join(" ")}</p>;
  });
}

export default function HeritageGuide({ kind, targetId, title }: HeritageGuideProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<GuideSource[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = `guide-question-${targetId}`;

  useEffect(() => {
    let active = true;
    void fetch("/api/heritage-guide", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { configured?: boolean }) => { if (active) setConfigured(body.configured === true); })
      .catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);

  async function ask(value: string) {
    const prompt = value.trim();
    if (!prompt || busy || configured === false) return;
    setQuestion(prompt);
    setBusy(true);
    setError("");
    setAnswer("");
    setSources([]);
    try {
      const response = await fetch("/api/heritage-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "archive" ? { artifactId: targetId, question: prompt } : { referenceId: targetId, question: prompt }),
      });
      if (!response.ok) throw new Error(await responseError(response, "The heritage guide could not answer just now."));
      const body = await response.json() as GuideResponse;
      if (typeof body.answer !== "string" || !body.answer.trim()) throw new Error("The heritage guide returned an empty answer.");
      setAnswer(body.answer);
      setSources(Array.isArray(body.sources) ? body.sources : []);
    } catch (cause) {
      setError(readableError(cause, "The heritage guide could not answer just now."));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || configured !== true;
  return (
    <section className="heritage-guide" aria-labelledby={`${inputId}-heading`}>
      <div className="guide-heading">
        <span aria-hidden><Sparkles size={15} /></span>
        <div>
          <h3 id={`${inputId}-heading`}>Ask the heritage guide</h3>
          <p>{kind === "archive" ? "Answers use this record's text and a matching Wikipedia article." : "Answers use this Wikipedia article only."}</p>
        </div>
      </div>

      {configured === false ? (
        <p className="guide-config">
          The guide is off on this server. Add a free <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio key <ArrowUpRight size={12} aria-hidden /></a> as <code>GOOGLE_GENERATIVE_AI_API_KEY</code> to turn it on.
        </p>
      ) : <>
        <div className="guide-suggestions">
          {SUGGESTED_QUESTIONS[kind].map((prompt) => <button key={prompt} type="button" disabled={disabled} onClick={() => void ask(prompt)}>{prompt}</button>)}
        </div>
        <form className="guide-form" onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
          <label htmlFor={inputId} className="visually-hidden">Ask about {title}</label>
          <input id={inputId} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder={`Ask about ${title}…`} disabled={disabled} />
          <button type="submit" aria-label="Send question" disabled={disabled || !question.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} aria-hidden /> : <Send size={15} aria-hidden />}
          </button>
        </form>
        {configured === null && <p className="guide-status">Connecting to the heritage guide…</p>}
        {busy && <p className="guide-status" role="status">Reading the sources…</p>}
        {error && <p className="guide-error" role="alert">{error}</p>}
        {answer && (
          <div className="guide-answer" aria-live="polite">
            {renderAnswer(answer)}
            {sources.length > 0 && (
              <div className="guide-sources">
                <span>Sources</span>
                {sources.map((source, index) => source.url
                  ? <a key={`${source.source}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">{index + 1}. {source.title} <ArrowUpRight size={11} aria-hidden /></a>
                  : <small key={`${source.source}-${source.title}`}>{index + 1}. {source.title}</small>)}
              </div>
            )}
          </div>
        )}
      </>}
      <p className="guide-disclosure">Your question and the source text are sent to Google Gemini, whose free tier may use prompts to improve its services. Check the sources before citing.</p>
    </section>
  );
}
