"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { isExcluded, reviewWriting, type AppData, type Item, type Rating, type V2Review, type WritingCard } from "../lib/model";
import { getCharacterMnemonic, type CharacterMnemonic } from "./MnemonicDialog";

type Props = { data: AppData; setData: Dispatch<SetStateAction<AppData>>; deckId: string; onCharacter?: (character: string) => void };
type Point = { x: number; y: number; pressure: number };
type Stroke = Point[];
export const writingCharactersOf = (text: string) => [...new Set(Array.from(
  new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text.normalize("NFC")), entry => entry.segment,
).filter(character => /\p{Letter}/u.test(character) && /[\p{Script=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u.test(character)))];
const charactersOf = writingCharactersOf;
const uid = () => crypto.randomUUID();

export default function WritingPractice({ data, setData, deckId, onCharacter }: Props) {
  const [clock, setClock] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const deck = data.decks.find(entry => entry.id === deckId);
  const items = useMemo(() => data.items.filter(item => item.deckId === deckId && !item.excluded && (!deck || !isExcluded(deck, item.targetTerm)) && charactersOf(item.targetTerm).length > 0), [data.items, deckId, deck]);
  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const cards = useMemo(() => data.writingCards.filter(card => itemById.has(card.itemId)).sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id)), [data.writingCards, itemById]);
  const dueCount = cards.filter(card => card.dueAt <= clock).length;
  const current = cards.find(card => card.dueAt <= clock);
  const missing = items.reduce((count, item) => count + charactersOf(item.targetTerm).filter(character => !cards.some(card => card.itemId === item.id && card.character === character)).length, 0);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  function addCards() {
    const additions: WritingCard[] = items.flatMap(item => charactersOf(item.targetTerm)
      .filter(character => !cards.some(card => card.itemId === item.id && card.character === character))
      .map(character => ({ id: uid(), itemId: item.id, character, dueAt: 0, reviewCount: 0 })));
    setData(previous => ({ ...previous, writingCards: [...previous.writingCards, ...additions.filter(card => !previous.writingCards.some(existing => existing.itemId === card.itemId && existing.character === card.character))] }));
    setClock(Date.now()); setMessage("");
  }

  function finish(card: WritingCard, rating: Rating, usedHint: boolean, strokeCount: number, onPaper: boolean) {
    const now = Date.now();
    const effective = usedHint && rating === "remembered" ? "hard" : rating;
    // Compute before changing any data, so a clock/scheduler error cannot lose a review.
    const scheduled = reviewWriting(card, effective, usedHint, now);
    const review: V2Review = { id: uid(), itemId: card.itemId, exerciseId: "", deckId,
      answer: onPaper ? "Writing attempt on paper or another surface; self-assessed." : `${strokeCount} drawn stroke${strokeCount === 1 ? "" : "s"}; self-assessed.`,
      rating: effective, hintsUsed: usedHint ? 1 : 0, lengthsShown: false, shellShown: false,
      targetRevealed: usedHint, createdAt: now, mode: "writing", character: card.character };
    setData(previous => {
      const latest = previous.writingCards.find(entry => entry.id === card.id);
      if (!latest || latest.reviewCount !== card.reviewCount) return previous;
      return { ...previous, writingCards: previous.writingCards.map(entry => entry.id === card.id ? scheduled : entry),
        reviews: [...previous.reviews, review], writingHintedCards: (previous.writingHintedCards || []).filter(id => id !== card.id) };
    });
    setClock(now);
    setMessage(`Writing review saved. This character is due ${new Date(scheduled.dueAt).toLocaleString()}.`);
  }

  return <section className="wp-root" aria-labelledby="wp-heading">
    <div className="wp-heading"><div><p className="wp-eyebrow">Optional practice</p><h2 id="wp-heading">Remember it with your hand</h2></div><span className="wp-badge">{dueCount} writing review{dueCount === 1 ? "" : "s"} due</span></div>
    <p className="wp-intro">Draw Chinese characters or Japanese kanji and kana, then compare your attempt and rate your recall. Writing has its own review schedule; it does not add to your daily vocabulary count.</p>
    {!items.length && <div className="wp-empty"><h3>No characters in this deck yet</h3><p>Add vocabulary containing Chinese characters or Japanese kanji and kana to begin optional writing practice.</p></div>}
    {!!items.length && missing > 0 && <div className="wp-enable"><p>{cards.length ? `${missing} new character card${missing === 1 ? " is" : "s are"} ready to add.` : "Make separate writing cards from the characters in this deck."}</p><button type="button" className="wp-button wp-primary" onClick={addCards}>{cards.length ? "Add new writing cards" : "Start writing practice"}</button></div>}
    {message && <p className="wp-saved" role="status">{message}</p>}
    {current && <WritingSession key={current.id} card={current} item={itemById.get(current.itemId)!} alreadyHinted={(data.writingHintedCards || []).includes(current.id)} language={deck?.targetLanguage || ""}
      markHint={() => setData(previous => ({ ...previous, writingHintedCards: [...new Set([...(previous.writingHintedCards || []), current.id])] }))}
      onFinish={(rating, hinted, strokeCount, onPaper) => finish(current, rating, hinted, strokeCount, onPaper)} onCharacter={onCharacter} />}
    {!current && cards.length > 0 && <div className="wp-empty"><h3>You’re caught up on writing!</h3><p>Your next character review is due {new Date(cards[0].dueAt).toLocaleString()}. Your vocabulary reviews have their own schedule.</p></div>}
    <style jsx>{`
      .wp-root { color: #293d32; }
      .wp-heading { display: flex; gap: 15px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      h2 { font-family: Georgia, serif; font-size: clamp(25px, 4vw, 34px); font-weight: 500; margin: 4px 0; }
      .wp-eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #5a7162; margin: 0; }
      .wp-badge { border: 1px solid #c4d2c2; background: #edf2e9; padding: 8px 12px; border-radius: 30px; font-size: 13px; }
      .wp-intro { max-width: 740px; line-height: 1.7; color: #59695f; }
      .wp-empty, .wp-enable { margin: 22px 0; border: 1px solid #d9dfd0; background: #fffcf5; padding: 22px; border-radius: 15px; }
      .wp-enable { display: flex; gap: 18px; align-items: center; justify-content: space-between; }
      .wp-enable p { margin: 0; line-height: 1.6; }
      .wp-empty h3 { margin: 0 0 8px; }
      .wp-empty p { margin: 0; line-height: 1.7; }
      .wp-button { min-height: 44px; border: 1px solid #386449; border-radius: 10px; padding: 10px 17px; font: inherit; cursor: pointer; }
      .wp-primary { color: #fff; background: #285840; }
      .wp-button:focus-visible { outline: 3px solid #4b9575; outline-offset: 3px; }
      .wp-saved { color: #365d44; font-size: 13px; line-height: 1.6; }
      @media(max-width: 540px) { .wp-enable { align-items: stretch; flex-direction: column; } }
    `}</style>
  </section>;
}

function WritingSession({ card, item, language, alreadyHinted, markHint, onFinish, onCharacter }: {
  card: WritingCard; item: Item; language: string; alreadyHinted: boolean; markHint: () => void;
  onFinish: (rating: Rating, hinted: boolean, strokeCount: number, onPaper: boolean) => void;
  onCharacter?: (character: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const pointer = useRef<number | null>(null);
  const alive = useRef(true);
  const [strokeCount, setStrokeCount] = useState(0);
  const [paper, setPaper] = useState(false);
  const [checked, setChecked] = useState(false);
  const [checkedHintStatus, setCheckedHintStatus] = useState<boolean | null>(null);
  const [hinted, setHinted] = useState(alreadyHinted);
  const [referenceHint, setReferenceHint] = useState(false);
  const [mnemonic, setMnemonic] = useState<CharacterMnemonic | null>(null);
  const [loadingHint, setLoadingHint] = useState(false);
  const [error, setError] = useState("");
  // Checking ends the attempt. Preserve its pre-check hint status for the current
  // self-rating, but persist exposure so leaving/reloading cannot reset the attempt.
  const hintUsed = hinted || (checked ? checkedHintStatus ?? alreadyHinted : alreadyHinted);
  const targetCharacters = Array.from(new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(item.targetTerm.normalize("NFC")), entry => entry.segment);
  const hasComponentStory = /^\p{Script=Han}$/u.test(card.character);
  const position = targetCharacters.indexOf(card.character) + 1;
  const redact = (text: string) => charactersOf(item.targetTerm).reduce((result, character) => result.split(character).join("□"), text);

  function draw() {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const size = element.getBoundingClientRect().width;
    if (!size) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const pixels = Math.round(size * pixelRatio);
    if (element.width !== pixels || element.height !== pixels) { element.width = pixels; element.height = pixels; }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, size, size);
    context.strokeStyle = "#dedfce"; context.lineWidth = 1;
    context.setLineDash([5, 6]);
    context.beginPath(); context.moveTo(size / 2, 0); context.lineTo(size / 2, size); context.moveTo(0, size / 2); context.lineTo(size, size / 2); context.moveTo(0, 0); context.lineTo(size, size); context.moveTo(size, 0); context.lineTo(0, size); context.stroke();
    context.setLineDash([]); context.strokeStyle = "#294b37"; context.fillStyle = "#294b37"; context.lineCap = "round"; context.lineJoin = "round";
    for (const stroke of strokes.current) {
      if (!stroke.length) continue;
      if (stroke.length === 1) { context.beginPath(); context.arc(stroke[0].x * size, stroke[0].y * size, 1.7, 0, Math.PI * 2); context.fill(); }
      for (let i = 1; i < stroke.length; i++) {
        context.lineWidth = 2.5 + 2.5 * ((stroke[i].pressure + stroke[i - 1].pressure) / 2);
        context.beginPath(); context.moveTo(stroke[i - 1].x * size, stroke[i - 1].y * size); context.lineTo(stroke[i].x * size, stroke[i].y * size); context.stroke();
      }
    }
  }

  useEffect(() => {
    alive.current = true;
    const element = canvas.current;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    if (element) observer?.observe(element);
    window.addEventListener("resize", draw); draw();
    return () => { alive.current = false; observer?.disconnect(); window.removeEventListener("resize", draw); };
  }, []);

  function point(event: Pick<PointerEvent, "clientX" | "clientY" | "pressure">): Point {
    const rectangle = canvas.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rectangle.left) / rectangle.width)), y: Math.min(1, Math.max(0, (event.clientY - rectangle.top) / rectangle.height)), pressure: event.pressure || .5 };
  }

  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (checked || pointer.current !== null || event.button !== 0 || strokes.current.length >= 256) return;
    event.preventDefault(); pointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    strokes.current.push([point(event.nativeEvent)]); setStrokeCount(strokes.current.length); draw();
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (checked || pointer.current !== event.pointerId) return;
    event.preventDefault();
    const stroke = strokes.current[strokes.current.length - 1];
    if (!stroke || stroke.length >= 5000) return;
    const events = event.nativeEvent.getCoalescedEvents?.() || [];
    for (const sample of events.length ? events : [event.nativeEvent]) if (stroke.length < 5000) stroke.push(point(sample));
    draw();
  }

  function end(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function rememberHint() { setHinted(true); markHint(); }

  async function componentHint() {
    setLoadingHint(true); setError("");
    try {
      const result = await getCharacterMnemonic(card.character, language);
      if (!alive.current) return;
      rememberHint(); setMnemonic(result);
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "The component hint could not be loaded."); }
    finally { if (alive.current) setLoadingHint(false); }
  }

  function rate(rating: Rating) {
    try { setError(""); onFinish(rating, hintUsed, strokes.current.length, paper && strokes.current.length === 0); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The review could not be saved."); }
  }

  return <article className="ws-card">
    <p className="ws-step">Write character {position} of {targetCharacters.length} in the {language || "target-language"} word for</p>
    <h3 dir="auto">{redact(item.sourceTerm)}</h3>
    {item.sense && <p className="ws-meaning" dir="auto">{redact(item.sense)}</p>}
    <p id="ws-instructions" className="ws-instructions">Hold down your mouse, pen, or finger to draw each stroke. You can also write on paper and select the option below.</p>
    <div className="ws-workspace">
      <div className="ws-drawing">
        <canvas ref={canvas} className={checked ? "ws-canvas is-checked" : "ws-canvas"} role="img" aria-label={`Your writing attempt: ${strokeCount} drawn strokes`} aria-describedby="ws-instructions" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { pointer.current = null; }}>Use a pointer to draw here, or write on paper and use the option below.</canvas>
        <div className="ws-tools"><span>{strokeCount} stroke{strokeCount === 1 ? "" : "s"}</span><button type="button" disabled={!strokeCount || checked} onClick={() => { strokes.current.pop(); setStrokeCount(strokes.current.length); draw(); }}>Undo stroke</button><button type="button" disabled={!strokeCount || checked} onClick={() => { strokes.current = []; setStrokeCount(0); draw(); }}>Clear</button></div>
      </div>
      <div className="ws-side">
        {(checked || referenceHint) ? <div className="ws-reference"><p>Reference character</p><span lang={language.toLowerCase().includes("japanese") ? "ja" : undefined}>{card.character}</span><p dir="auto">{item.targetTerm}</p>{checked && onCharacter && hasComponentStory && <button type="button" onClick={() => { rememberHint(); onCharacter(card.character); }}>Open character story</button>}</div> : <div className="ws-hidden"><span aria-hidden="true">?</span><p>The reference appears when you check your attempt.</p></div>}
        {!checked && <div className="ws-hints"><p>Need a little help?</p>{hasComponentStory && <button type="button" disabled={loadingHint || !!mnemonic} onClick={componentHint}>{loadingHint ? "Loading components…" : "Show component hints"}</button>}<button type="button" disabled={referenceHint} onClick={() => { rememberHint(); setReferenceHint(true); }}>Show reference as a hint</button><small>Using a hint makes the best rating unavailable for this review.</small></div>}
      </div>
    </div>
    {mnemonic && <div className="ws-components"><strong>Visual component hints</strong><ul>{mnemonic.components.map((component, index) => <li key={index}><span>{component.shape}</span> — {component.memoryImage}{component.note ? ` (${component.note})` : ""}</li>)}</ul><p>AI-created memory images may be invented. These are not verified radicals or etymology.</p></div>}
    {!checked && <><label className="ws-paper"><input type="checkbox" checked={paper} onChange={event => setPaper(event.target.checked)} />I made my writing attempt on paper or another surface.</label><button className="ws-check" type="button" disabled={(!strokeCount && !paper) || loadingHint} onClick={() => { pointer.current = null; setCheckedHintStatus(hintUsed); markHint(); setChecked(true); }}>Check my character</button></>}
    {checked && <div className="ws-review"><h4>How well did you remember it?</h4><p>Compare your attempt with the reference and judge your own recall. The app does not automatically recognize handwriting or verify stroke order.</p><div className="ws-ratings"><button type="button" onClick={() => rate("forgot")}><strong>Forgot</strong><span>I could not produce it</span></button><button type="button" onClick={() => rate("hard")}><strong>A little bit</strong><span>I struggled or used help</span></button><button type="button" disabled={hintUsed} onClick={() => rate("remembered")} title={hintUsed ? "Available only without hints" : undefined}><strong>Remembered</strong><span>{hintUsed ? "Unavailable after hints" : "I wrote it without hints"}</span></button></div></div>}
    {hintUsed && <p className="ws-hint-note">Hint use is saved for this card until you record its review.</p>}
    {checked && !hintUsed && <p className="ws-hint-note">Record your rating before leaving this card. Returning to this unfinished attempt after seeing the reference counts as a hint.</p>}
    {error && <p className="ws-error" role="alert">{error}</p>}
    <style jsx>{`
      .ws-card { background: #fffcf5; border: 1px solid #d6ddcf; border-radius: 20px; padding: clamp(18px, 3vw, 30px); margin-top: 22px; color: #293d32; }
      .ws-step { color: #5d6f62; font-size: 13px; margin: 0 0 6px; }
      h3 { font-family: Georgia, serif; font-size: clamp(28px, 5vw, 38px); font-weight: 500; margin: 0; }
      .ws-meaning { font-size: 14px; color: #536559; line-height: 1.6; }
      .ws-instructions { font-size: 14px; line-height: 1.65; color: #536559; }
      .ws-workspace { display: grid; grid-template-columns: minmax(180px, 380px) minmax(170px, 1fr); gap: 28px; align-items: start; margin-top: 20px; }
      .ws-canvas { display: block; width: 100%; aspect-ratio: 1; border: 1px solid #b8c5b2; border-radius: 12px; background: #fffefb; touch-action: none; cursor: crosshair; box-sizing: border-box; }
      .ws-canvas.is-checked { cursor: default; background: #f7f7ed; }
      .ws-tools { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
      .ws-tools span { margin-right: auto; font-size: 12px; color: #5d6f62; }
      button { border: 1px solid #c3cebd; background: #f2f4eb; color: #2b4b36; border-radius: 9px; padding: 10px 13px; min-height: 44px; font: inherit; font-size: 13px; cursor: pointer; }
      button:hover:not(:disabled) { background: #e4eddf; }
      button:disabled { opacity: .48; cursor: not-allowed; }
      button:focus-visible, input:focus-visible { outline: 3px solid #4b9575; outline-offset: 3px; }
      .ws-reference, .ws-hidden { text-align: center; border: 1px dashed #c5cfbd; border-radius: 12px; padding: 16px 12px; }
      .ws-reference > span { display: block; font-size: clamp(72px, 12vw, 115px); line-height: 1.4; }
      .ws-reference > p { margin: 0; font-size: 13px; }
      .ws-reference > p:last-of-type { font-size: 19px; }
      .ws-reference > button { margin-top: 12px; }
      .ws-hidden > span { font-family: Georgia, serif; font-size: 60px; color: #a9b5a4; }
      .ws-hidden > p { margin-bottom: 0; font-size: 13px; line-height: 1.6; color: #64735f; }
      .ws-hints { display: grid; gap: 9px; margin-top: 17px; }
      .ws-hints > p { margin: 0; font-size: 13px; font-weight: 650; }
      .ws-hints small { line-height: 1.6; color: #62715e; }
      .ws-components { background: #edf2e8; border-radius: 12px; padding: 15px 18px; margin-top: 18px; font-size: 14px; }
      .ws-components ul { padding-left: 20px; line-height: 1.8; }
      .ws-components li > span { font-size: 22px; }
      .ws-components p { font-size: 12px; color: #586954; margin-bottom: 0; }
      .ws-paper { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.6; margin: 20px 0 15px; }
      .ws-paper input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: #285840; flex-shrink: 0; }
      .ws-check { background: #285840; color: white; border-color: #285840; padding: 12px 20px; }
      .ws-check:hover:not(:disabled) { background: #1d4631; }
      .ws-review { margin-top: 24px; border-top: 1px solid #dce2d4; padding-top: 18px; }
      .ws-review h4 { font-size: 18px; margin: 0; }
      .ws-review > p { font-size: 13px; color: #586954; line-height: 1.65; }
      .ws-ratings { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .ws-ratings button { display: grid; text-align: left; gap: 7px; padding: 14px; }
      .ws-ratings strong { font-size: 15px; }
      .ws-ratings span { font-size: 12px; line-height: 1.5; }
      .ws-hint-note { font-size: 12px; color: #67715c; line-height: 1.6; }
      .ws-error { color: #8b3e25; background: #fff0e4; padding: 12px; border-radius: 9px; line-height: 1.6; font-size: 13px; }
      @media(max-width: 550px) { .ws-workspace { grid-template-columns: 1fr; gap: 18px; } .ws-drawing { width: min(100%, 360px); margin: 0 auto; } .ws-side { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .ws-hints { margin: 0; } .ws-ratings { gap: 6px; } .ws-ratings button { padding: 11px 8px; } .ws-ratings strong { font-size: 13px; } .ws-ratings span { font-size: 11px; } }
    `}</style>
  </article>;
}
