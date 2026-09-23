"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/cloud";

export type CharacterMnemonic = {
  character: string;
  components: { shape: string; memoryImage: string; note: string }[];
  story: string;
  note: string;
};

const CACHE_KEY = "sentence-recall.mnemonics.v2";
const memory = new Map<string, CharacterMnemonic>();
const pending = new Map<string, Promise<CharacterMnemonic>>();
let cacheLoaded = false;
function validMnemonic(value: unknown): value is CharacterMnemonic {
  if (!value || typeof value !== "object") return false;
  const x = value as CharacterMnemonic;
  return typeof x.character === "string" && Array.from(x.character).length === 1 && /\p{Script=Han}/u.test(x.character)
    && typeof x.story === "string" && x.story.length > 0 && x.story.length <= 6000
    && typeof x.note === "string" && x.note.length <= 2000
    && Array.isArray(x.components) && x.components.length > 0 && x.components.length <= 16
    && x.components.every(c => c && typeof c.shape === "string" && c.shape.length <= 40 && typeof c.memoryImage === "string" && c.memoryImage.length <= 1000 && typeof c.note === "string" && c.note.length <= 1200);
}

function loadCache() {
  if (cacheLoaded || typeof window === "undefined") return;
  cacheLoaded = true;
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    if (Array.isArray(entries)) for (const entry of entries.slice(-300)) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && validMnemonic(entry[1])) memory.set(entry[0], entry[1]);
    }
  } catch { /* A damaged optional cache must not prevent practising. */ }
}

/** Cached visual associations are hints, never verified character etymology. */
export async function getCharacterMnemonic(character: string, language = ""): Promise<CharacterMnemonic> {
  loadCache();
  const key = `${language.toLocaleLowerCase()}\u0000${character}`;
  const cached = memory.get(key);
  if (cached) return cached;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = (async () => {
    const response = await apiFetch("/api/mnemonic", { method: "POST", body: JSON.stringify({ character, language }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The memory story could not be loaded. Please try again.");
    // Accept a plain result or the conventional {mnemonic} route wrapper.
    const result: unknown = body.mnemonic || body;
    if (!validMnemonic(result) || result.character !== character) throw new Error("The generated memory story was incomplete. Please try again.");
    memory.set(key, result);
    if (memory.size > 300) memory.delete(memory.keys().next().value!);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(memory.entries()))); } catch { /* Memory cache remains available when storage is full. */ }
    return result;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

export default function MnemonicDialog({ character, language, onClose }: { character: string; language?: string; onClose: () => void }) {
  const [mnemonic, setMnemonic] = useState<CharacterMnemonic | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let active = true;
    setMnemonic(null); setError("");
    getCharacterMnemonic(character, language).then(value => { if (active) setMnemonic(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "The memory story could not be loaded."); });
    return () => { active = false; };
  }, [character, language, retry]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== "Tab") return;
      const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, []);

  return <div className="mn-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="mn-dialog" role="dialog" aria-modal="true" aria-labelledby="mn-title">
      <div className="mn-top"><span className="mn-eyebrow">Character memory stories · Premium preview</span><button ref={closeButton} type="button" onClick={onClose} aria-label="Close memory story">Close ×</button></div>
      <h2 id="mn-title"><span className="mn-character" lang={language?.toLowerCase().includes("japanese") ? "ja" : language?.toLowerCase().includes("chinese") ? "zh" : undefined}>{character}</span>A story to help it stick</h2>
      <p className="mn-disclaimer">These are AI-created visual memory aids. Component images can be invented; they are not a verified dictionary decomposition, character history, or stroke-order guide.</p>
      {!mnemonic && !error && <p role="status">Creating a memorable story…</p>}
      {error && <div role="alert" className="mn-error"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {mnemonic && <>
        <h3>Picture the parts</h3>
        <ul className="mn-parts">{mnemonic.components.map((component, index) => <li key={index}><span className="mn-shape">{component.shape}</span><div><strong>{component.memoryImage}</strong>{component.note && <p>{component.note}</p>}</div></li>)}</ul>
        <h3>Join them into one scene</h3><p className="mn-story">{mnemonic.story}</p>
        {mnemonic.note && <p className="mn-note">{mnemonic.note}</p>}
        <p className="mn-small">Try picturing the scene, then look away and write the character from memory. This story is saved on this browser so reopening it does not request a new generation.</p>
      </>}
      <style jsx>{`
        .mn-backdrop { position: fixed; inset: 0; z-index: 1200; background: #14291db3; display: grid; place-items: center; padding: 20px; }
        .mn-dialog { max-width: 680px; width: 100%; max-height: 90dvh; overflow-y: auto; background: #fffcf5; color: #24392f; padding: clamp(20px, 4vw, 34px); border-radius: 20px; box-shadow: 0 20px 100px #14291d55; }
        .mn-top { display: flex; gap: 16px; align-items: center; justify-content: space-between; }
        .mn-eyebrow { font-size: 12px; font-weight: 750; color: #456452; }
        .mn-dialog button { background: #e6eee6; color: #244e3c; border: 1px solid #aebead; border-radius: 9px; min-height: 44px; padding: 8px 14px; cursor: pointer; font: inherit; }
        .mn-dialog button:focus-visible { outline: 3px solid #257765; outline-offset: 3px; }
        h2 { display: flex; gap: 18px; align-items: center; font-size: clamp(22px, 4vw, 28px); font-weight: 650; line-height: 1.25; }
        .mn-character { font-size: 64px; font-weight: 400; }
        h3 { font-size: 16px; margin: 25px 0 12px; }
        p { line-height: 1.65; }
        .mn-disclaimer { font-size: 13px; background: #f0ecdf; padding: 12px 15px; border-radius: 9px; }
        .mn-parts { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
        .mn-parts li { display: flex; gap: 15px; align-items: flex-start; }
        .mn-shape { flex-shrink: 0; min-width: 48px; font-size: 32px; text-align: center; background: #edf1e8; border-radius: 9px; padding: 5px; }
        .mn-parts p { margin: 4px 0 0; font-size: 13px; color: #56665c; }
        .mn-story { font-size: 17px; background: #e5efe5; padding: 18px; border-left: 3px solid #4b7659; border-radius: 3px 10px 10px 3px; }
        .mn-note, .mn-small { font-size: 13px; color: #56665c; }
        .mn-error { padding: 12px 16px; background: #fff0e3; border-radius: 10px; }
        @media (max-width: 500px) { .mn-backdrop { padding: 10px; } .mn-top { align-items: flex-start; } .mn-character { font-size: 50px; } }
      `}</style>
    </div>
  </div>;
}
