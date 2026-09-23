"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  SAMPLE_ITEMS,
  isSavedData,
  maskText,
  scheduleReview,
  type Exercise,
  type Grade,
  type Review,
  type SavedData,
  type VocabularyItem,
} from "../lib/recall";

const STORAGE_KEY = "sentence-recall.v1";
const LANGUAGES = ["English", "Spanish", "French", "German", "Japanese", "Chinese", "Russian", "Italian", "Portuguese"];
type Tab = "practice" | "vocabulary" | "add";
type WordForm = { sourceTerm: string; targetTerm: string; sense: string; sourceLanguage: string; targetLanguage: string; level: string };
type Generated = { targetTerm: string; sense: string; exercise: Exercise };
const EMPTY_FORM: WordForm = { sourceTerm: "", targetTerm: "", sense: "", sourceLanguage: "English", targetLanguage: "Spanish", level: "A2" };

async function requestPractice<T>(body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("/api/practice", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "The request could not finish. Please try again.");
    if (!data) throw new Error("The server returned an empty response. Please try again.");
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The AI request timed out. Your work is still here; try again.");
    throw error;
  } finally { clearTimeout(timeout); }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function dueLabel(timestamp: number) {
  if (timestamp <= Date.now()) return "Ready now";
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Home() {
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [canPersist, setCanPersist] = useState(false);
  const [storageProblem, setStorageProblem] = useState("");
  const [tab, setTab] = useState<Tab>("practice");
  const [selectedId, setSelectedId] = useState("");
  const [answer, setAnswer] = useState("");
  const [showLengths, setShowLengths] = useState(false);
  const [revealedWords, setRevealedWords] = useState<number[]>([]);
  const [shellShown, setShellShown] = useState(false);
  const [targetRevealed, setTargetRevealed] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [busy, setBusy] = useState<"grade" | "generate" | "context" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [completed, setCompleted] = useState(false);
  const [form, setForm] = useState<WordForm>(EMPTY_FORM);
  const [preview, setPreview] = useState<(Generated & { form: WordForm }) | null>(null);
  const [search, setSearch] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const answerInput = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const reviewSaved = useRef(false);

  useEffect(() => {
    let initialItems = SAMPLE_ITEMS;
    let initialReviews: Review[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (!isSavedData(parsed)) throw new Error("Saved data has an unsupported format.");
        initialItems = parsed.items;
        initialReviews = parsed.reviews;
      }
      setCanPersist(true);
    } catch {
      setStorageProblem("Your saved data could not be loaded. It has not been replaced. You can use the sample exercises for now, import a backup, or explicitly replace the unreadable data.");
    }
    setItems(initialItems);
    setReviews(initialReviews);
    setSelectedId([...initialItems].sort((a, b) => a.dueAt - b.dueAt)[0]?.id || "");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !canPersist) return;
    try {
      const data: SavedData = { version: 1, items, reviews };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      setCanPersist(false);
      setStorageProblem("This browser could not save your changes. Export a backup to keep this session, then try enabling saving again.");
    }
  }, [items, reviews, hydrated, canPersist]);

  const current = items.find((item) => item.id === selectedId) || items[0];
  const exercise = current?.exercises[current.exerciseIndex] || current?.exercises[0];
  const attemptFinished = targetRevealed || grade !== null || completed;
  const dueCount = items.filter((item) => item.dueAt <= Date.now()).length;

  function resetAttempt() {
    setAnswer(""); setShowLengths(false); setRevealedWords([]); setShellShown(false);
    setTargetRevealed(false); setGrade(null); setCompleted(false); setError("");
    reviewSaved.current = false;
  }

  useEffect(() => {
    resetAttempt();
  }, [current?.id, exercise?.id]);

  function changeTab(next: Tab) {
    if (busy) return;
    setTab(next); setError(""); setNotice("");
  }

  function updateForm(key: keyof WordForm, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setPreview(null); setError("");
  }

  async function generateWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (items.length >= 2000) { setError("This prototype can store up to 2,000 vocabulary items. Export your backup before starting a separate collection."); return; }
    if (form.sourceLanguage === form.targetLanguage) { setError("Choose two different languages."); return; }
    inFlight.current = true; setBusy("generate"); setError(""); setNotice(""); setPreview(null);
    const submitted = { ...form, sourceTerm: form.sourceTerm.trim(), targetTerm: form.targetTerm.trim(), sense: form.sense.trim() };
    try {
      const generated = await requestPractice<Generated>({ action: "generate", ...submitted });
      setPreview({ ...generated, form: submitted });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { inFlight.current = false; setBusy(null); }
  }

  function savePreview() {
    if (!preview || busy) return;
    if (items.length >= 2000) { setError("This prototype can store up to 2,000 vocabulary items. Export your backup before starting a separate collection."); return; }
    const item: VocabularyItem = {
      id: crypto.randomUUID(), ...preview.form, targetTerm: preview.targetTerm, sense: preview.sense,
      exercises: [preview.exercise], exerciseIndex: 0, dueAt: Date.now(), intervalDays: 0, reviewCount: 0,
    };
    setItems((previous) => [...previous, item]);
    setSelectedId(item.id); setPreview(null); setForm({ ...form, sourceTerm: "", targetTerm: "", sense: "" });
    resetAttempt(); setTab("practice"); setNotice("Vocabulary saved. Start with the whole sentence, and ask for help when you need it.");
  }

  async function checkAnswer() {
    if (!current || !exercise || !answer.trim() || attemptFinished || inFlight.current || completed) return;
    inFlight.current = true; setBusy("grade"); setError("");
    try {
      const response = await requestPractice<{ grade: Grade }>({
        action: "grade", sourceTerm: current.sourceTerm, targetTerm: current.targetTerm, sense: current.sense,
        sourceLanguage: current.sourceLanguage, targetLanguage: current.targetLanguage, exercise, answer,
      });
      setGrade(response.grade);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { inFlight.current = false; setBusy(null); }
  }

  async function anotherContext() {
    if (!current || !exercise || inFlight.current) return;
    setNotice(""); setError("");
    if (exercise.origin === "sample" && current.exercises.length > 1) {
      setItems((previous) => previous.map((item) => item.id === current.id ? { ...item, exerciseIndex: (item.exerciseIndex + 1) % item.exercises.length } : item));
      return;
    }
    inFlight.current = true; setBusy("context");
    try {
      const generated = await requestPractice<Generated>({
        action: "generate", sourceTerm: current.sourceTerm, targetTerm: current.targetTerm, sense: current.sense,
        sourceLanguage: current.sourceLanguage, targetLanguage: current.targetLanguage, level: current.level,
        avoidSentences: current.exercises.slice(-8).map((entry) => entry.sourceSentence),
      });
      setItems((previous) => previous.map((item) => {
        if (item.id !== current.id) return item;
        const exercises = [...item.exercises, generated.exercise].slice(-200);
        return { ...item, exercises, exerciseIndex: exercises.length - 1 };
      }));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { inFlight.current = false; setBusy(null); }
  }

  function rate(rating: Review["rating"]) {
    if (!current || !exercise || busy || completed || reviewSaved.current) return;
    if (rating !== "forgot" && !answer.trim()) return;
    if (rating === "remembered" && targetRevealed) return;
    reviewSaved.current = true;
    const now = Date.now();
    const updated = scheduleReview(current, rating, targetRevealed, now);
    const review: Review = {
      id: crypto.randomUUID(), itemId: current.id, exerciseId: exercise.id, answer, rating,
      hintsUsed: revealedWords.length, lengthsShown: showLengths, shellShown, targetRevealed, createdAt: now,
    };
    setItems((previous) => previous.map((item) => item.id === current.id ? updated : item));
    setReviews((previous) => [...previous, review].slice(-50000)); setCompleted(true);
    setNotice(`Review recorded. This vocabulary is next due ${updated.dueAt <= now ? "now" : new Date(updated.dueAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`);
  }

  function nextWord() {
    const next = [...items].filter((item) => item.id !== current?.id).sort((a, b) => a.dueAt - b.dueAt)[0];
    resetAttempt(); setNotice("");
    if (next) setSelectedId(next.id);
    else setNotice("You have one vocabulary item. You can practice it again or add another word.");
    requestAnimationFrame(() => answerInput.current?.focus());
  }

  function exportData() {
    const data: SavedData = { version: 1, items, reviews };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "sentence-recall-backup.json";
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Backup exported. Keep it to move your vocabulary and progress to another browser.");
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || busy) return;
    setError("");
    try {
      if (file.size > 5_000_000) throw new Error("Choose a backup smaller than 5 MB.");
      const data: unknown = JSON.parse(await file.text());
      if (!isSavedData(data)) throw new Error("This is not a supported Sentence Recall backup. Your current data has not changed.");
      if (!window.confirm(`Replace the current vocabulary and reviews with this backup (${data.items.length} words, ${data.reviews.length} reviews)?`)) return;
      setItems(data.items); setReviews(data.reviews); setSelectedId(data.items[0]?.id || "");
      setStorageProblem(""); setCanPersist(true); resetAttempt(); setTab("practice"); setNotice("Your backup has been restored.");
    } catch (cause) { setError(errorMessage(cause)); }
  }

  const matchingItems = items.filter((item) => `${item.sourceTerm} ${item.targetTerm} ${item.sense}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  return (
    <div className="recall-app">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); changeTab("practice"); }} aria-label="Sentence Recall home">
          <span className="brand-mark" aria-hidden="true">r.</span><span>Sentence Recall<span className="brand-sub">Words you can actually use.</span></span>
        </a>
        <span className="local-label"><span className="status-dot" /> {canPersist ? "Saved in this browser" : hydrated ? "Saving paused" : "Loading"}</span>
      </header>

      <main className="main-shell">
        <div className="intro-row"><div><p className="eyebrow">A LITTLE PRACTICE, EVERY DAY</p><h1>{tab === "practice" ? "Make the words yours." : tab === "vocabulary" ? "Your growing vocabulary." : "Start with a word."}</h1></div><span className="due-pill">{dueCount} ready to review</span></div>
        <nav className="tabs" aria-label="Main navigation">
          <button type="button" className={tab === "practice" ? "active" : ""} onClick={() => changeTab("practice")} disabled={!!busy} aria-current={tab === "practice" ? "page" : undefined}>Practice</button>
          <button type="button" className={tab === "vocabulary" ? "active" : ""} onClick={() => changeTab("vocabulary")} disabled={!!busy} aria-current={tab === "vocabulary" ? "page" : undefined}>Vocabulary <span className="count">{items.length}</span></button>
          <button type="button" className={tab === "add" ? "active" : ""} onClick={() => changeTab("add")} disabled={!!busy} aria-current={tab === "add" ? "page" : undefined}>+ Add word</button>
        </nav>

        {storageProblem && <div className="message warning" role="alert"><p>{storageProblem}</p><button type="button" className="text-button" onClick={() => { setStorageProblem(""); setCanPersist(true); }}>Save this session and replace the stored copy</button></div>}
        {error && <div className="message error" role="alert">{error}</div>}
        {notice && <div className="message success" role="status">{notice}</div>}

        {!hydrated ? <section className="card loading-card" aria-busy="true">Loading your vocabulary…</section> : tab === "practice" ? (
          current && exercise ? <>
            <section className="card practice-card" aria-label="Translation exercise">
              <div className="card-topline"><span className="language-label">{current.sourceLanguage} <span aria-hidden="true">→</span> {current.targetLanguage}</span><div className="badges"><span className="badge">{current.level}</span><span className="badge subtle">{exercise.origin === "sample" ? "Sample exercise" : "Your vocabulary"}</span></div></div>
              <p className="exercise-direction">Translate the whole sentence into {current.targetLanguage}.</p>
              <p className="source-sentence" lang={current.sourceLanguage === "English" ? "en" : undefined}>{exercise.sourceSentence}</p>
              <p className="source-help">Take a moment to recall it. Hints are here when you need them.</p>

              {(showLengths || shellShown) && !completed && <div className="shell-area">
                <p className="tiny-label">{shellShown ? "SENTENCE SHELL" : "TAP A SURROUNDING WORD TO REVEAL IT"}</p>
                <div className="word-shell" aria-label="Reference sentence with protected target vocabulary">
                  {exercise.chunks.map((chunk, index) => {
                    const isVisible = attemptFinished || (!chunk.isTarget && (shellShown || revealedWords.includes(index)));
                    if (chunk.isTarget) return <span className={`word-chip target-chip ${isVisible ? "visible" : ""}`} key={index} aria-label={isVisible ? undefined : "Target vocabulary, kept hidden"}>{isVisible ? chunk.text : maskText(chunk.text)}</span>;
                    return <button type="button" className={`word-chip ${isVisible ? "visible" : ""}`} key={index} aria-label={isVisible ? chunk.text : `Reveal surrounding word ${index + 1}`} disabled={!!busy || isVisible || completed} onClick={() => setRevealedWords((previous) => previous.includes(index) ? previous : [...previous, index])}>{isVisible ? chunk.text : maskText(chunk.text)}</button>;
                  })}
                </div>
                <p className="field-note">The highlighted blank is the vocabulary you are practicing.</p>
              </div>}

              <div className="answer-block">
                <label htmlFor="translation">Your translation</label>
                <textarea ref={answerInput} id="translation" rows={3} value={answer} maxLength={2000} spellCheck={false} autoCorrect="off" autoComplete="off" autoCapitalize="off" placeholder={`Write your sentence in ${current.targetLanguage}…`} disabled={!!busy || completed || grade !== null || targetRevealed} onChange={(event) => setAnswer(event.target.value)} />
              </div>
              {!completed && <>
                <div className="hint-controls"><button type="button" className="button quiet" onClick={() => setShowLengths(true)} disabled={!!busy || attemptFinished || showLengths || shellShown}>Show word lengths</button><button type="button" className="button quiet" onClick={() => { setShellShown(true); setShowLengths(true); }} disabled={!!busy || attemptFinished || shellShown}>Show sentence shell</button><button type="button" className="text-button" onClick={() => setTargetRevealed(true)} disabled={!!busy || attemptFinished}>Reveal answer</button></div>
                <div className="check-row"><button type="button" className="button primary" onClick={checkAnswer} disabled={!!busy || !answer.trim() || attemptFinished}>{busy === "grade" ? "Checking your translation…" : "Check with AI"}</button><p className="field-note">AI checking is optional.<br />You can rate your own recall below.</p></div>
              </>}

              {attemptFinished && <div className="feedback-area" aria-live="polite">
                {grade && <><div className="feedback-tags"><span className={`feedback-tag ${grade.meaningCorrect ? "positive" : "neutral"}`}>{grade.meaningCorrect ? "Meaning conveyed" : "Check the meaning"}</span><span className={`feedback-tag ${grade.targetUsed ? "positive" : "neutral"}`}>{grade.targetUsed ? "Target used" : "Target needs practice"}</span></div><p>{grade.feedback}</p>{grade.grammarFeedback && <p className="grammar-note">{grade.grammarFeedback}</p>}</>}
                <p className="tiny-label">{grade ? "ONE POSSIBLE TRANSLATION" : "REFERENCE TRANSLATION"}</p><p className="reference-sentence">{exercise.referenceTranslation}</p>
                {grade?.suggestedTranslation && grade.suggestedTranslation !== exercise.referenceTranslation && <p className="grammar-note">Suggested revision: {grade.suggestedTranslation}</p>}
                {targetRevealed && <p className="field-note">You revealed the target. This attempt will be recorded as assisted.</p>}
                {grade && <p className="field-note">AI feedback can be mistaken. Your self-rating determines the next review.</p>}
              </div>}
            </section>

            <section className="rating-card" aria-label="Save your review">
              {completed ? <div className="completion-row"><div><h2>One more step toward recall.</h2><p className="field-note">Your rating and hint use have been recorded.</p></div><button type="button" className="button primary" onClick={nextWord}>Next word <span aria-hidden="true">→</span></button></div> : <><div className="rating-heading"><div><h2>How well did you recall the target word?</h2><p className="field-note">Self-assessment · Choosing a rating saves this review.</p></div><span className="hint-summary">{targetRevealed ? "Target revealed" : shellShown ? "Shell used" : revealedWords.length ? `${revealedWords.length} word hints` : showLengths ? "Lengths shown" : "No hints"}</span></div><div className="rating-buttons"><button type="button" className="rating-button" onClick={() => rate("forgot")} disabled={!!busy}><strong>Forgot</strong><span>Try again soon</span></button><button type="button" className="rating-button" onClick={() => rate("hard")} disabled={!!busy || !answer.trim()}><strong>Hard</strong><span>Needed effort or help</span></button><button type="button" className="rating-button remembered" onClick={() => rate("remembered")} disabled={!!busy || !answer.trim() || targetRevealed}><strong>Remembered</strong><span>Recalled the target myself</span></button></div><p className="rating-note">Hints for surrounding words and revealing the target are recorded separately.</p></>}
            </section>
            <div className="practice-footer"><button type="button" className="text-button" onClick={anotherContext} disabled={!!busy}>{busy === "context" ? "Preparing another sentence…" : "Try another context"}</button><span>{current.reviewCount} {current.reviewCount === 1 ? "review" : "reviews"} · Next due: {dueLabel(current.dueAt)}</span></div>
          </> : <section className="card empty-state"><span className="empty-mark" aria-hidden="true">a.</span><h2>Your next word starts here.</h2><p>Add a word, generate a sentence, and practice recalling it.</p><button type="button" className="button primary" onClick={() => changeTab("add")}>Add your first word</button></section>
        ) : tab === "vocabulary" ? (
          <section className="card vocabulary-card"><div className="section-heading"><div><h2>A word, many contexts.</h2><p className="field-note">Progress belongs to the vocabulary, even when the sentence changes.</p></div></div><label className="visually-hidden" htmlFor="vocabulary-search">Search vocabulary</label><input id="vocabulary-search" className="search-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your vocabulary…" />
            <div className="vocabulary-list">{matchingItems.length ? matchingItems.map((item) => <article className="vocabulary-row" key={item.id}><div className="vocabulary-copy"><h3>{item.sourceTerm} <span aria-hidden="true">→</span> <span className="target-term">{item.targetTerm}</span></h3><p>{item.sense}</p><span className="vocabulary-meta">{item.targetLanguage} · {item.level} · {item.exercises.length} {item.exercises.length === 1 ? "context" : "contexts"} · {item.reviewCount} reviews</span></div><div className="vocabulary-action"><span className={item.dueAt <= Date.now() ? "ready-label" : "field-note"}>{dueLabel(item.dueAt)}</span><button type="button" className="button quiet" onClick={() => { setSelectedId(item.id); resetAttempt(); setTab("practice"); setNotice(""); }}>Practice</button></div></article>) : <p className="empty-search">{items.length ? "No words match your search." : "Your vocabulary is empty. Add a word to begin."}</p>}</div>
          </section>
        ) : (
          <section className="card add-card"><div className="section-heading"><h2>What would you like to remember?</h2><p className="field-note">Enter a word or phrase. AI will create a short translation exercise around it.</p></div>
            <form onSubmit={generateWord}>
              <div className="form-grid"><div className="form-field"><label htmlFor="source-language">Translate from</label><select id="source-language" value={form.sourceLanguage} disabled={!!busy} onChange={(event) => updateForm("sourceLanguage", event.target.value)}>{LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select></div><div className="form-field"><label htmlFor="target-language">Learning language</label><select id="target-language" value={form.targetLanguage} disabled={!!busy} onChange={(event) => updateForm("targetLanguage", event.target.value)}>{LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select></div></div>
              <div className="form-grid"><div className="form-field"><label htmlFor="source-term">Word or phrase in {form.sourceLanguage}</label><input id="source-term" required maxLength={120} value={form.sourceTerm} disabled={!!busy} placeholder="e.g. shame" onChange={(event) => updateForm("sourceTerm", event.target.value)} /></div><div className="form-field"><label htmlFor="target-term">In {form.targetLanguage} <span className="optional">optional</span></label><input id="target-term" maxLength={120} value={form.targetTerm} disabled={!!busy} placeholder="e.g. vergüenza" onChange={(event) => updateForm("targetTerm", event.target.value)} /></div></div>
              <div className="form-field"><label htmlFor="sense">Which meaning? <span className="optional">optional</span></label><input id="sense" maxLength={400} value={form.sense} disabled={!!busy} placeholder="e.g. feeling embarrassed about something you did" onChange={(event) => updateForm("sense", event.target.value)} /><p className="field-note">For example, “feeling shame” and “what a shame!” may need different translations.</p></div>
              <div className="form-field level-field"><label htmlFor="level">Sentence level</label><select id="level" value={form.level} disabled={!!busy} onChange={(event) => updateForm("level", event.target.value)}><option value="A1">A1 · Beginner</option><option value="A2">A2 · Elementary</option><option value="B1">B1 · Intermediate</option><option value="B2">B2 · Upper intermediate</option><option value="C1">C1 · Advanced</option><option value="C2">C2 · Proficient</option></select></div>
              <button className="button primary" type="submit" disabled={!!busy || !form.sourceTerm.trim()}>{busy === "generate" ? "Creating your exercise…" : preview ? "Generate another example" : "Generate an exercise"}</button><p className="field-note generate-note">You will confirm the meaning before saving. Generation requires an AI connection.</p>
            </form>
            {preview && <div className="preview-card" aria-live="polite"><p className="tiny-label">CONFIRM THE WORD AND ITS MEANING</p><h3>{preview.form.sourceTerm} <span aria-hidden="true">→</span> {preview.targetTerm}</h3><p>{preview.sense}</p><div className="preview-example"><p>{preview.exercise.sourceSentence}</p><p className="preview-translation">{preview.exercise.referenceTranslation}</p></div><p className="field-note">If this is a different meaning than you intended, edit the meaning above and generate again.</p><button type="button" className="button primary" onClick={savePreview} disabled={!!busy}>Save vocabulary & practice</button></div>}
          </section>
        )}

        <footer className="page-footer"><p>Small steps. Stronger recall.<span>Your progress stays in this browser. Export a backup to keep a copy.</span></p><div className="backup-controls"><button type="button" className="text-button" onClick={exportData} disabled={!hydrated || !!busy}>Export backup</button><button type="button" className="text-button" onClick={() => importInput.current?.click()} disabled={!hydrated || !!busy}>Import backup</button><input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importData} tabIndex={-1} aria-label="Import a Sentence Recall backup" /></div></footer>
      </main>

      <style jsx global>{`
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #f6f7f3; color: #243e37; }
        .recall-app { min-height: 100vh; font-family: Arial, Helvetica, sans-serif; color: #243e37; background: #f6f7f3; font-size: 15px; line-height: 1.55; }
        .recall-app button, .recall-app input, .recall-app textarea, .recall-app select { font: inherit; }
        .recall-app button { cursor: pointer; }
        .recall-app button:disabled { cursor: default; opacity: .48; }
        .recall-app button:focus-visible, .recall-app a:focus-visible { outline: 3px solid #7eafa0; outline-offset: 4px; }
        .recall-app p, .recall-app h1, .recall-app h2, .recall-app h3 { margin: 0; }
        .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; max-width: 1136px; margin: 0 auto; padding: 28px 40px; }
        .brand { display: flex; gap: 12px; align-items: center; text-decoration: none; color: #243e37; font-weight: 700; font-size: 17px; letter-spacing: -.35px; }
        .brand-mark { display: grid; place-items: center; width: 43px; height: 43px; background: #245c4e; color: #fff; border-radius: 13px; font-family: Georgia, serif; font-size: 31px; font-weight: 400; line-height: 1; padding-bottom: 7px; }
        .brand-sub { display: block; font-size: 11px; font-weight: 400; color: #627268; letter-spacing: 0; margin-top: 0; }
        .local-label { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #627268; }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #568872; }
        .main-shell { max-width: 860px; padding: 40px 32px 24px; margin: 0 auto; }
        .intro-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 30px; }
        .eyebrow { font-size: 11px; letter-spacing: 1.8px; font-weight: 700; color: #627268; margin-bottom: 10px !important; }
        .recall-app h1 { font-family: Georgia, "Times New Roman", serif; font-size: clamp(29px, 4.2vw, 39px); letter-spacing: -1.1px; line-height: 1.2; font-weight: 400; }
        .due-pill { border: 1px solid #d7e2d8; color: #51715d; border-radius: 99px; font-size: 12px; padding: 6px 12px; white-space: nowrap; background: #edf2e9; }
        .tabs { display: flex; gap: 22px; border-bottom: 1px solid #dfe5dd; margin-bottom: 25px; }
        .tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 12px 1px 13px; margin-bottom: -1px; font-weight: 500; font-size: 14px; color: #627268; white-space: nowrap; }
        .tabs button.active { border-bottom-color: #2c6654; color: #245c4e; font-weight: 700; }
        .count { background: #e7ebe4; padding: 2px 6px; border-radius: 5px; font-size: 11px; margin-left: 3px; }
        .card { border: 1px solid #dfe5dc; border-radius: 20px; background: #fffefa; box-shadow: 0 3px 8px #25382b04; }
        .practice-card, .add-card, .vocabulary-card { padding: 29px 32px; }
        .card-topline { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 29px; }
        .language-label { color: #326454; font-size: 12px; font-weight: 700; }
        .language-label > span { margin: 0 8px; color: #627268; }
        .badges { display: flex; gap: 6px; }
        .badge { background: #edf1e9; color: #54735f; padding: 3px 8px; border-radius: 5px; font-size: 11px; font-weight: 600; }
        .badge.subtle { background: #f3f1eb; color: #627268; font-weight: 400; }
        .exercise-direction { font-size: 12px; color: #627268; margin-bottom: 13px !important; }
        .source-sentence { font-family: Georgia, "Times New Roman", serif; font-size: clamp(24px, 3.4vw, 30px); line-height: 1.42; letter-spacing: -.3px; max-width: 650px; overflow-wrap: anywhere; }
        .source-help { font-size: 12px; color: #627268; margin: 13px 0 30px !important; }
        .shell-area { padding: 18px; border: 1px solid #e6e9df; border-radius: 12px; margin: 0 0 25px; background: #f9faf5; }
        .tiny-label { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: #627268; margin-bottom: 11px !important; }
        .word-shell { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
        .word-chip { max-width: 100%; border: 1px solid #dce3d7; background: #fffefa; min-height: 39px; min-width: 34px; padding: 5px 8px; border-radius: 6px; font-size: 15px; color: #6b796d; letter-spacing: 1px; overflow-wrap: anywhere; }
        .word-chip.visible { letter-spacing: 0; color: #304b3d; opacity: 1 !important; }
        .word-chip:not(:disabled):hover { background: #eef2e8; border-color: #8aab91; }
        .target-chip { background: #e4eee3; border-color: #87a886; color: #416546; display: inline-flex; align-items: center; }
        .answer-block label, .form-field > label { display: block; color: #475e50; font-size: 12px; font-weight: 600; margin-bottom: 8px; }
        .recall-app textarea, .recall-app input, .recall-app select { width: 100%; border: 1px solid #dce3d7; border-radius: 9px; color: #304b3d; background: #fffefa; padding: 12px 14px; outline: none; transition: border-color .15s, box-shadow .15s; font-size: 16px; }
        .recall-app textarea:focus, .recall-app input:focus, .recall-app select:focus { border-color: #6d9a7b; box-shadow: 0 0 0 3px #77aa8520; }
        .recall-app textarea { resize: vertical; min-height: 108px; line-height: 1.6; }
        .recall-app input::placeholder, .recall-app textarea::placeholder { color: #627268; }
        .recall-app textarea:disabled, .recall-app input:disabled, .recall-app select:disabled { background: #f4f6ef; }
        .hint-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 13px; }
        .button { display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 11px 17px; border: 1px solid transparent; border-radius: 8px; font-size: 13px !important; font-weight: 600 !important; transition: background .15s; line-height: 1.5; }
        .button.primary { background: #285f4e; color: white; border-color: #285f4e; }
        .button.primary:hover:not(:disabled) { background: #1d4d3e; }
        .button.quiet { border-color: #dfe5d9; background: #f5f7f0; color: #5f7463; padding: 8px 11px; font-size: 11px !important; }
        .button.quiet:hover:not(:disabled) { background: #e9efe2; }
        .text-button { background: none; border: 0; padding: 7px 2px; color: #627268; font-size: 11px !important; text-decoration: underline; text-underline-offset: 3px; }
        .text-button:hover:not(:disabled) { color: #245c4e; }
        .hint-controls .text-button { margin-left: auto; }
        .check-row { display: flex; align-items: center; gap: 16px; margin-top: 23px; }
        .field-note { color: #627268; font-size: 11px; line-height: 1.55; }
        .feedback-area { margin-top: 24px; border-top: 1px solid #e6eadd; padding-top: 22px; font-size: 13px; color: #4c6350; }
        .feedback-area .tiny-label { margin-top: 20px !important; }
        .feedback-tags { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
        .feedback-tag { font-size: 11px; border-radius: 5px; padding: 4px 8px; }
        .feedback-tag.positive { background: #e4eee2; color: #4b714d; }
        .feedback-tag.neutral { background: #f4ecd9; color: #947442; }
        .reference-sentence { font-size: 19px; font-family: Georgia, serif; margin: 0 0 12px !important; overflow-wrap: anywhere; }
        .grammar-note { margin-top: 8px !important; color: #627268; font-size: 12px; }
        .rating-card { background: #edf2e9; border-radius: 16px; margin-top: 17px; padding: 21px 25px 17px; }
        .rating-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 16px; }
        .recall-app h2 { font-size: 15px; font-weight: 600; letter-spacing: -.2px; margin-bottom: 4px; }
        .hint-summary { color: #627268; font-size: 11px; white-space: nowrap; }
        .rating-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .rating-button { display: flex; flex-direction: column; gap: 3px; text-align: center; padding: 12px 7px; border: 1px solid #d7e1d1; background: #f9fbf5; border-radius: 9px; color: #5d755e; }
        .rating-button strong { font-size: 12px; font-weight: 600; }
        .rating-button span { font-size: 11px; color: #627268; }
        .rating-button.remembered { background: #e0ecdc; border-color: #c2d8b8; color: #3e683e; }
        .rating-button:hover:not(:disabled) { border-color: #83a17c; background: #e8f0e0; }
        .rating-note { font-size: 11px; color: #627268; margin-top: 12px !important; }
        .completion-row { display: flex; justify-content: space-between; align-items: center; gap: 15px; }
        .practice-footer { display: flex; justify-content: space-between; gap: 15px; align-items: center; margin: 10px 4px 0; font-size: 11px; color: #627268; }
        .page-footer { border-top: 1px solid #e2e8da; margin-top: 42px; padding-top: 21px; display: flex; justify-content: space-between; gap: 20px; }
        .page-footer > p { color: #627268; font-size: 11px; }
        .page-footer > p span { display: block; color: #627268; font-size: 11px; margin-top: 3px; }
        .backup-controls { display: flex; gap: 12px; align-items: flex-start; white-space: nowrap; }
        .backup-controls .text-button { font-size: 11px !important; }
        .message { border-radius: 10px; padding: 13px 16px; margin-bottom: 18px; font-size: 12px; overflow-wrap: anywhere; }
        .message.error { background: #f9eae4; border: 1px solid #ecd2c8; color: #934e3c; }
        .message.warning { background: #f7f0df; border: 1px solid #e7dbba; color: #8f7947; }
        .message.success { background: #eaf1e5; border: 1px solid #d6e5cc; color: #53744b; }
        .section-heading { margin-bottom: 25px; }
        .section-heading h2 { font-family: Georgia, serif; font-size: 23px; font-weight: 400; margin-bottom: 7px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .form-field { margin-bottom: 21px; min-width: 0; }
        .optional { color: #627268; font-size: 11px; font-weight: 400; margin-left: 4px; }
        .form-field .field-note { margin-top: 6px; }
        .level-field { max-width: 275px; }
        .generate-note { margin-top: 10px !important; }
        .preview-card { margin-top: 28px; background: #f2f6ec; border: 1px solid #d8e4cc; border-radius: 12px; padding: 21px; }
        .preview-card h3 { font-family: Georgia, serif; font-size: 22px; font-weight: 400; margin-bottom: 9px; }
        .preview-card > p:not(.tiny-label):not(.field-note) { font-size: 12px; color: #627268; }
        .preview-example { border-top: 1px solid #dfe8d5; padding-top: 14px; margin: 16px 0; font-size: 14px; }
        .preview-translation { margin-top: 7px !important; color: #627268; }
        .preview-card .button { margin-top: 18px; }
        .vocabulary-row { display: flex; justify-content: space-between; gap: 16px; padding: 22px 0; border-bottom: 1px solid #e7ebdf; }
        .vocabulary-row:last-child { border-bottom: none; padding-bottom: 0; }
        .vocabulary-copy { min-width: 0; }
        .vocabulary-copy h3 { font-size: 16px; font-weight: 500; margin-bottom: 5px; overflow-wrap: anywhere; }
        .vocabulary-copy h3 > span:first-child { color: #627268; margin: 0 6px; font-size: 13px; }
        .target-term { color: #30684e; }
        .vocabulary-copy > p { font-size: 12px; color: #627268; margin-bottom: 5px; }
        .vocabulary-meta { font-size: 11px; color: #627268; }
        .vocabulary-action { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; flex-shrink: 0; }
        .ready-label { font-size: 11px; color: #66865a; }
        .empty-state, .loading-card { text-align: center; padding: 45px 25px; }
        .empty-state h2 { font-family: Georgia, serif; font-size: 25px; margin: 15px 0 7px; font-weight: 400; }
        .empty-state p, .empty-search { font-size: 13px; color: #627268; }
        .empty-state .button { margin-top: 23px; }
        .empty-mark { font-size: 40px; font-family: Georgia, serif; color: #5f8d57; }
        .empty-search { padding: 25px 0; }
        .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
        @media (max-width: 600px) {
          .topbar { padding: 22px 20px 16px; }
          .brand { font-size: 15px; gap: 9px; }
          .brand-mark { width: 37px; height: 37px; border-radius: 11px; font-size: 29px; }
          .brand-sub { font-size: 11px; }
          .local-label { max-width: 95px; font-size: 11px; line-height: 1.4; gap: 5px; }
          .status-dot { flex-shrink: 0; }
          .main-shell { padding: 27px 17px 20px; }
          .intro-row { display: block; margin-bottom: 21px; }
          .due-pill { display: inline-flex; margin-top: 14px; font-size: 11px; padding: 4px 9px; }
          .eyebrow { font-size: 11px; letter-spacing: 1.5px; }
          .tabs { gap: 20px; margin-bottom: 19px; }
          .tabs button { font-size: 12px; }
          .practice-card, .add-card, .vocabulary-card { padding: 23px 19px; border-radius: 15px; }
          .card-topline { margin-bottom: 25px; gap: 9px; }
          .language-label { font-size: 11px; }
          .badge { font-size: 11px; }
          .source-help { font-size: 11px; margin-bottom: 23px !important; }
          .source-sentence { font-size: 25px; }
          .exercise-direction { font-size: 11px; }
          .hint-controls { gap: 7px; }
          .hint-controls .text-button { margin-left: 0; padding-left: 2px; }
          .button.quiet { padding: 8px 9px; font-size: 11px !important; }
          .check-row { align-items: flex-start; flex-direction: column; gap: 10px; margin-top: 17px; }
          .check-row .button { width: 100%; }
          .check-row .field-note br { display: none; }
          .rating-card { padding: 18px 15px; border-radius: 13px; }
          .rating-heading { align-items: flex-start; flex-direction: column; gap: 8px; }
          .recall-app h2 { font-size: 13px; }
          .rating-buttons { gap: 7px; }
          .rating-button { padding: 11px 4px; }
          .rating-button strong { font-size: 11px; }
          .rating-button span { font-size: 11px; line-height: 1.4; }
          .rating-note { font-size: 11px; }
          .practice-footer { font-size: 11px; }
          .practice-footer .text-button { font-size: 11px !important; }
          .form-grid { grid-template-columns: 1fr; gap: 0; }
          .section-heading h2 { font-size: 21px; }
          .page-footer { flex-direction: column; gap: 8px; margin-top: 29px; padding-top: 19px; }
          .completion-row { flex-direction: column; align-items: stretch; }
          .vocabulary-row { gap: 10px; }
          .vocabulary-copy h3 { font-size: 14px; }
          .vocabulary-copy > p { font-size: 11px; }
          .preview-card { padding: 16px; }
          .word-chip { font-size: 14px; }
        }
        @media (pointer: coarse) { .recall-app button, .recall-app .word-chip { min-height: 44px; } }
        @media (prefers-reduced-motion: reduce) { .recall-app * { transition: none !important; } }
      `}</style>
    </div>
  );
}
