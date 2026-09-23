"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Deck } from "../lib/model";
import { isChineseLanguage, isJapaneseLanguage } from "../lib/languages";
import { sentenceLocale } from "./SentenceText";

export type VocabularyCandidate = { text: string; side: "source" | "target"; sentence: string; language: string };
type VocabularyDialogProps = {
  candidate: VocabularyCandidate;
  decks: Deck[];
  initialDeckId: string;
  onClose: () => void;
  onAdd: (deckId: string, withWriting: boolean) => Promise<string | void>;
  onCharacter?: (character: string) => void;
};

export default function VocabularyDialog({ candidate, decks, initialDeckId, onClose, onAdd, onCharacter }: VocabularyDialogProps) {
  const [deckId, setDeckId] = useState(() => decks.some(deck => deck.id === initialDeckId) ? initialDeckId : decks[0]?.id || "");
  const [withWriting, setWithWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const requestId = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const headingId = useId();
  const selectId = useId();
  const deck = decks.find(value => value.id === deckId);
  const writingAvailable = !!deck && (isChineseLanguage(deck.targetLanguage) || isJapaneseLanguage(deck.targetLanguage));
  const characters = Array.from(new Set(Array.from(candidate.text).filter(character => /\p{Script=Han}/u.test(character))));

  useEffect(() => {
    setDeckId(decks.some(value => value.id === initialDeckId) ? initialDeckId : decks[0]?.id || "");
    setWithWriting(false); setError(""); setSuccess(""); setBusy(false);
    inFlight.current = false;
    requestId.current += 1;
    // Reset when another sentence word is selected, not when adding changes a deck's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.text, candidate.side, candidate.sentence, candidate.language, initialDeckId]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!inFlight.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]');
      if (!elements?.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { requestId.current += 1; document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!deck || inFlight.current || success) return;
    inFlight.current = true;
    const currentRequest = ++requestId.current;
    setBusy(true); setError("");
    try {
      const message = await onAdd(deck.id, writingAvailable && withWriting);
      if (requestId.current === currentRequest) setSuccess(message || `Added to ${deck.name}.`);
    } catch (reason) {
      if (requestId.current === currentRequest) setError(reason instanceof Error ? reason.message : "This word could not be added. Please try again.");
    } finally {
      if (requestId.current === currentRequest) { inFlight.current = false; setBusy(false); }
    }
  }

  return <div className="modal-backdrop vocabulary-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !inFlight.current) onClose();
  }}>
    <section ref={dialog} className="modal vocabulary-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
      <div className="modal-heading"><h2 id={headingId}>Keep this word</h2><button ref={closeButton} className="text-button" type="button" onClick={onClose} disabled={busy} aria-label="Close add word">Close</button></div>
      <p className="vocabulary-selected" lang={sentenceLocale(candidate.language)} dir="auto">{candidate.text}</p>
      <p className="vocabulary-context" lang={sentenceLocale(candidate.language)} dir="auto">{candidate.sentence}</p>
      {success ? <div className="vocabulary-success" role="status"><p>{success}</p><button className="button primary" type="button" onClick={onClose}>Done</button></div> : <form onSubmit={submit} aria-busy={busy}>
        {decks.length ? <>
          <div className="form-field"><label htmlFor={selectId}>Add to deck</label><select id={selectId} value={deckId} disabled={busy} onChange={event => { setDeckId(event.target.value); setWithWriting(false); setError(""); }}>
            {decks.map(value => <option key={value.id} value={value.id}>{value.name} · {value.targetLanguage}</option>)}
          </select></div>
          {writingAvailable && <label className="checkbox-label vocabulary-writing"><input type="checkbox" checked={withWriting} disabled={busy} onChange={event => setWithWriting(event.target.checked)}/>Also add to writing practice</label>}
          <p className="field-note">Save the word with its meaning in this sentence and a new practice sentence.</p>
        </> : <p className="field-note">Create a deck for this language in Settings first, then add this word.</p>}
        {error && <p className="message warning" role="alert">{error}</p>}
        <div className="modal-actions"><button className="button primary" type="submit" disabled={!deck || busy}>{busy ? "Adding word…" : "Add word"}</button><button className="button quiet" type="button" onClick={onClose} disabled={busy}>Cancel</button></div>
        {busy && <p className="field-note" role="status">Preparing your practice sentence…</p>}
      </form>}
      {!!onCharacter && characters.length > 0 && <div className="vocabulary-mnemonics"><p className="tiny-label">CHARACTER MEMORY STORIES</p><div>{characters.map(character => <button className="button quiet" type="button" key={character} disabled={busy} onClick={() => onCharacter(character)} aria-label={`Open a memory story for ${character}`}>{character}</button>)}</div></div>}
    </section>
  </div>;
}
