"use client";

import { useEffect, useRef } from "react";
import { normalizeTerm, type OnboardingDraft } from "../lib/model";

type Props = {
  draft: OnboardingDraft;
  busy: boolean;
  hasDecks: boolean;
  canCancel: boolean;
  showAccount: boolean;
  onChange: (draft: OnboardingDraft) => void;
  onFinish: (mode: "personalized" | "own" | "demo") => void;
  onCancel: () => void;
  onToggleAccount: () => void;
};

export default function Onboarding({ draft, busy, hasDecks, canCancel, showAccount, onChange, onFinish, onCancel, onToggleAccount }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [draft.step]);
  const targets = draft.languages.map(language => normalizeTerm(language.targetLanguage));
  const source = normalizeTerm(draft.sourceLanguage);
  const languagesValid = !!source && targets.length > 0 && targets.every(target => target && target !== source)
    && new Set(targets).size === targets.length;
  const detailsValid = draft.languages.every(language => language.level.trim() && language.goal.trim())
    && Number.isInteger(draft.dailyGoal) && draft.dailyGoal >= 1 && draft.dailyGoal <= 100;
  const headings = ["What would you like to learn?", "What are you working toward?", "How would you like to begin?"];
  const updateLanguage = (index: number, update: Partial<OnboardingDraft["languages"][number]>) => {
    onChange({ ...draft, languages: draft.languages.map((language, i) => i === index ? { ...language, ...update } : language) });
  };

  return <section className="card onboarding-card" aria-labelledby="setup-heading">
    <p className="eyebrow">YOUR WORDS, YOUR WORLD</p>
    <h1 id="setup-heading" ref={heading} tabIndex={-1}>{headings[draft.step]}</h1>
    <p className="onboarding-intro">{hasDecks
      ? "Let’s tailor your practice to you. Your saved words and review progress will stay with you."
      : "A few preferences, then words you can put to use. You can change these anytime."}</p>
    <div className="step-track" aria-label={`Setup step ${draft.step + 1} of 3`}>
      {["Languages", "Goals & level", "First words"].map((label, index) => <span key={label}
        aria-current={index === draft.step ? "step" : undefined}
        className={index === draft.step ? "current" : index < draft.step ? "done" : ""}><b>{index + 1}</b>{label}</span>)}
    </div>

    <fieldset className="setup-fields" disabled={busy}>
      <legend className="visually-hidden">{headings[draft.step]}</legend>
      {draft.step === 0 ? <>
        <div className="form-field"><label htmlFor="setup-source">Language you translate from</label>
          <input id="setup-source" list="languages" maxLength={60} value={draft.sourceLanguage}
            onChange={event => onChange({ ...draft, sourceLanguage: event.target.value })}/>
          <p className="field-note">Choose a language you already feel comfortable using.</p>
        </div>
        {draft.languages.map((language, index) => <div className="setup-language-row" key={index}>
          <div className="form-field"><label htmlFor={`setup-target-${index}`}>{index === 0 ? "Language you want to learn" : `Learning language ${index + 1}`}</label>
            <input id={`setup-target-${index}`} list="languages" maxLength={60} placeholder="e.g. Japanese" value={language.targetLanguage}
              onChange={event => updateLanguage(index, { targetLanguage: event.target.value })}/>
          </div>
          {draft.languages.length > 1 && <button type="button" className="text-button"
            aria-label={`Remove learning language ${index + 1}`}
            onClick={() => onChange({ ...draft, languages: draft.languages.filter((_, i) => i !== index) })}>Remove</button>}
        </div>)}
        <button type="button" className="button quiet" disabled={draft.languages.length >= 100}
          onClick={() => onChange({ ...draft, languages: [...draft.languages, { targetLanguage: "", level: "", goal: "" }] })}>+ Add another language</button>
        <p className="field-note setup-note">Type any language, even if it isn’t in the suggestions. Each learning language gets its own deck.</p>
        {targets.some(target => target && target === source) && <p className="setup-validation">Choose a learning language different from the language you translate from.</p>}
        {new Set(targets.filter(Boolean)).size < targets.filter(Boolean).length && <p className="setup-validation">Choose each learning language once.</p>}
      </> : draft.step === 1 ? <>
        {draft.languages.map((language, index) => <fieldset className="setup-language-details" key={index}>
          <legend>{language.targetLanguage}</legend>
          <div className="form-field"><label htmlFor={`setup-goal-${index}`}>What would you like to do in {language.targetLanguage}?</label>
            <textarea id={`setup-goal-${index}`} rows={3} maxLength={600} value={language.goal}
              placeholder="For example: prepare for JLPT N1, read newspapers, or chat with friends."
              onChange={event => updateLanguage(index, { goal: event.target.value })}/>
          </div>
          <div className="form-field"><label htmlFor={`setup-level-${index}`}>Your current level in {language.targetLanguage}</label>
            <input id={`setup-level-${index}`} list="levels" maxLength={80} placeholder="e.g. Beginner, B1, or around JLPT N2" value={language.level}
              onChange={event => updateLanguage(index, { level: event.target.value })}/>
            <p className="field-note">An estimate is fine. Put the exam you’re aiming for in your goal above.</p>
          </div>
        </fieldset>)}
        <div className="form-field level-field"><label htmlFor="setup-daily">Different words to practice each day</label>
          <input id="setup-daily" type="number" min={1} max={100} step={1} value={draft.dailyGoal || ""}
            onChange={event => onChange({ ...draft, dailyGoal: Math.min(100, Math.max(0, Math.floor(Number(event.target.value) || 0))) })}/>
          <p className="field-note">Across all your languages. When you reach this goal, we’ll celebrate and ask whether you want to continue.</p>
        </div>
      </> : <>
        <div className="setup-summary">
          <p><strong>{draft.dailyGoal} different words a day</strong> · translating from {draft.sourceLanguage}</p>
          <ul>{draft.languages.map((language, index) => <li key={index}><strong>{language.targetLanguage}</strong> · {language.level}<span>{language.goal}</span></li>)}</ul>
        </div>
        <div className="start-options">
          <button type="button" className="start-option" onClick={() => onFinish("personalized")} disabled={!languagesValid || !detailsValid}>
            <span className="option-icon" aria-hidden="true">✦</span><strong>Choose words for me</strong>
            <span>Begin with five words in {draft.languages[0].targetLanguage}, chosen for your goal and current level. You can exclude any word you don’t want.</span>
            <b>{busy ? "Preparing your practice…" : "Personalize my practice →"}</b>
          </button>
          <button type="button" className="start-option" onClick={() => onFinish("own")} disabled={!languagesValid || !detailsValid}>
            <span className="option-icon" aria-hidden="true">＋</span><strong>I’ll choose my own words</strong>
            <span>{hasDecks ? "Keep using your saved decks. New languages start with an empty deck." : "Start with an empty deck and add words you encounter."}</span>
            <b>{hasDecks ? "Save preferences & continue →" : "Create my deck →"}</b>
          </button>
        </div>
        {draft.languages.length > 1 && <p className="field-note setup-note">Start with {draft.languages[0].targetLanguage}. Switch decks to add or generate words in your other languages whenever you’re ready.</p>}
        <p className="field-note setup-note">Personalized words need an AI connection. If it isn’t available, you can still create your own deck and keep these preferences.</p>
      </>}
      <div className="onboarding-actions">
        {draft.step > 0 && <button type="button" className="button quiet" onClick={() => onChange({ ...draft, step: draft.step - 1 })}>Back</button>}
        {draft.step < 2 && <button type="button" className="button primary" disabled={!languagesValid || (draft.step === 1 && !detailsValid)}
          onClick={() => onChange({ ...draft, step: draft.step + 1 })}>Continue <span aria-hidden="true">→</span></button>}
      </div>
      {draft.step === 2 && source === "english" && targets[0] === "spanish" && <div className="demo-option">
        <button type="button" className="text-button" onClick={() => onFinish("demo")} disabled={!detailsValid}>Try prepared Spanish examples</button>
        <span>Sample sentences, without an AI connection. Your preferences are saved.</span>
      </div>}
    </fieldset>
    <div className="setup-secondary">
      {canCancel && <button className="text-button" onClick={onCancel} disabled={busy}>Cancel changes</button>}
      <button className="text-button" disabled={busy} onClick={onToggleAccount}>{showAccount ? "Hide account sign-in" : "Already have an account? Sign in"}</button>
    </div>
  </section>;
}
