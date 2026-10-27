"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle, Send, Sparkles } from "lucide-react";

type GuideSource = { title: string; url: string | null; source: string };
type GuideResponse = { answer?: string; sources?: GuideSource[]; error?: string };

type HeritageGuideProps = {
  title: string;
  artifactId?: string;
  referenceId?: string;
};

const suggestedQuestions = [
  "Why is this place historically important?",
  "What details should I look for?",
  "What does this archive record tell us?",
];

export default function HeritageGuide({ title, artifactId, referenceId }: HeritageGuideProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<GuideSource[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/heritage-guide", { cache: "no-store" })
      .then(response => response.json())
      .then(body => { if (active) setConfigured(body.configured === true); })
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
        body: JSON.stringify({ artifactId, referenceId, question: prompt }),
      });
      const body = await response.json().catch(() => ({})) as GuideResponse;
      if (!response.ok) throw new Error(body.error || "The heritage guide could not answer just now.");
      if (typeof body.answer !== "string" || !body.answer.trim()) throw new Error("The heritage guide returned an empty answer.");
      setAnswer(body.answer);
      setSources(Array.isArray(body.sources) ? body.sources : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The heritage guide could not answer just now.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="heritage-guide" aria-label="AI heritage guide">
    <div className="guide-heading"><span><Sparkles size={15}/></span><div><b>Ask the heritage guide</b><small>AI answers grounded in this record and public references</small></div></div>
    {configured === false ? <p className="guide-config">Add a free <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio key <ArrowUpRight size={12}/></a> as <code>GOOGLE_GENERATIVE_AI_API_KEY</code> to enable answers.</p> : <>
      <div className="guide-suggestions">{suggestedQuestions.map(prompt => <button key={prompt} type="button" disabled={busy || configured === null} onClick={() => void ask(prompt)}>{prompt}</button>)}</div>
      <form className="guide-form" onSubmit={event => { event.preventDefault(); void ask(question); }}>
        <input value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} placeholder={`Ask about ${title}…`} aria-label={`Ask about ${title}`} disabled={busy || configured === null}/>
        <button type="submit" aria-label="Send question" disabled={busy || configured === null || !question.trim()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Send size={15}/>}</button>
      </form>
      {configured === null && <p className="guide-status">Connecting to the heritage guide…</p>}
      {error && <p className="guide-error" role="alert">{error}</p>}
      {answer && <div className="guide-answer" aria-live="polite"><label>HERITAGE GUIDE</label><p>{answer}</p>{sources.length > 0 && <div className="guide-sources"><span>Sources</span>{sources.map((source, index) => source.url
        ? <a key={`${source.source}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">{index + 1}. {source.title} <ArrowUpRight size={11}/></a>
        : <small key={`${source.source}-${source.title}`}>{index + 1}. {source.title}</small>)}</div>}</div>}
    </>}
    <p className="guide-disclosure">Your question and this record’s text are sent to Google Gemini. Google may use free tier prompts to improve its services; check sources before citing.</p>
  </section>;
}
