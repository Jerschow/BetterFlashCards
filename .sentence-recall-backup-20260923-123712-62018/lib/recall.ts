// Sentence/exercise formats shared by the UI and server. New scheduling lives in model.ts.
export type Chunk = { text: string; isTarget: boolean };
export type Exercise = { id: string; sourceSentence: string; referenceTranslation: string; chunks: Chunk[]; origin: "sample" | "ai" };
export type VocabularyItem = { id: string; sourceTerm: string; targetTerm: string; sense: string; sourceLanguage: string; targetLanguage: string; level: string; exercises: Exercise[]; exerciseIndex: number; dueAt: number; intervalDays: number; reviewCount: number };
export type Review = { id: string; itemId: string; exerciseId: string; answer: string; rating: "forgot" | "hard" | "remembered"; hintsUsed: number; lengthsShown?: boolean; shellShown: boolean; targetRevealed: boolean; createdAt: number };
export type LegacySavedData = { version: 1; items: VocabularyItem[]; reviews: Review[] };
export type SavedData = LegacySavedData;
export type Grade = { meaningCorrect: boolean; targetUsed: boolean; grammarFeedback: string; feedback: string; suggestedTranslation: string };

// One mask per grapheme preserves joined letters and vowel marks across scripts.
export function maskText(text: string): string {
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.normalize("NFC"));
  return Array.from(segments, ({ segment }) => /[\p{L}\p{M}\p{N}]/u.test(segment) ? "_" : segment).join("");
}

export function scheduleReview(item: VocabularyItem, rating: Review["rating"], targetRevealed: boolean, now = Date.now()): VocabularyItem {
  const effective = targetRevealed ? "forgot" : rating;
  const intervalDays = effective === "forgot" ? 10 / 1440 : effective === "hard" ? 1 : Math.min(60, Math.max(1, Math.round(item.intervalDays * 2.5)));
  return { ...item, dueAt: now + intervalDays * 86400000, intervalDays, reviewCount: item.reviewCount + 1 };
}

function sample(id: string, sourceSentence: string, referenceTranslation: string, target: string): Exercise {
  const chunks = referenceTranslation.match(/\S+\s*/gu)!.map(text => ({ text, isTarget: text.normalize("NFC").toLowerCase().includes(target.normalize("NFC").toLowerCase()) }));
  return { id, sourceSentence, referenceTranslation, chunks, origin: "sample" };
}

export const SAMPLE_ITEMS: VocabularyItem[] = [
  { id: "sample-shame", sourceTerm: "shame", targetTerm: "vergüenza", sense: "The feeling of shame or embarrassment, not 'what a pity'.", sourceLanguage: "English", targetLanguage: "Spanish", level: "A2", exerciseIndex: 0, dueAt: 0, intervalDays: 0, reviewCount: 0, exercises: [
    sample("shame-1", "The boy felt shame after stealing a cookie.", "El niño sintió vergüenza después de robar una galleta.", "vergüenza"),
    sample("shame-2", "I feel embarrassed when I speak in public.", "Siento vergüenza cuando hablo en público.", "vergüenza"),
  ] },
  { id: "sample-forget", sourceTerm: "to forget", targetTerm: "olvidar", sense: "To fail to remember something.", sourceLanguage: "English", targetLanguage: "Spanish", level: "A2", exerciseIndex: 0, dueAt: 0, intervalDays: 0, reviewCount: 0, exercises: [
    sample("forget-1", "I do not want to forget your name.", "No quiero olvidar tu nombre.", "olvidar"),
    sample("forget-2", "It is easy to forget small details.", "Es fácil olvidar los pequeños detalles.", "olvidar"),
  ] },
  { id: "sample-patience", sourceTerm: "patience", targetTerm: "paciencia", sense: "The ability to wait calmly.", sourceLanguage: "English", targetLanguage: "Spanish", level: "A2", exerciseIndex: 0, dueAt: 0, intervalDays: 0, reviewCount: 0, exercises: [
    sample("patience-1", "Learning a language takes patience.", "Aprender un idioma requiere paciencia.", "paciencia"),
    sample("patience-2", "My teacher has a lot of patience.", "Mi profesor tiene mucha paciencia.", "paciencia"),
  ] },
];

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max: number) => typeof x === "string" && x.length <= max;
const requiredText = (x: unknown, max: number) => text(x, max) && (x as string).trim().length > 0;
const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;

export function isExercise(x: unknown): x is Exercise {
  if (!record(x) || !requiredText(x.id, 100) || !requiredText(x.sourceSentence, 2000) || !requiredText(x.referenceTranslation, 2000) || !["sample", "ai"].includes(String(x.origin))) return false;
  if (!Array.isArray(x.chunks) || x.chunks.length < 2 || x.chunks.length > 100) return false;
  if (!x.chunks.every(c => record(c) && text(c.text, 500) && (c.text as string).length > 0 && typeof c.isTarget === "boolean")) return false;
  const chunks = x.chunks as Chunk[];
  return chunks.some(c => c.isTarget) && chunks.some(c => !c.isTarget) && chunks.map(c => c.text).join("") === x.referenceTranslation;
}

// Share the same protection check between AI generation and backup imports.
// Punctuation at a phrase's edges does not change its lexical identity.
export function targetProtectionIssue(exercise: Exercise, target: string): string | null {
  const fold = (s: string) => s.normalize("NFC").toLowerCase();
  const clean = (s: string) => fold(s).replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
  const needle = clean(target);
  if (!needle) return "The target must contain a word or phrase.";
  const reference = fold(exercise.referenceTranslation);
  const protectedCharacters = exercise.chunks.flatMap(c => Array(fold(c.text).length).fill(c.isTarget) as boolean[]);
  // These scripts commonly attach words or grammatical particles without spaces.
  const useWordBoundaries = !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(needle);
  const lexical = (s: string) => /[\p{L}\p{M}\p{N}]/u.test(s);
  let found = false;
  for (let start = reference.indexOf(needle); start !== -1; start = reference.indexOf(needle, start + 1)) {
    const before = Array.from(reference.slice(0, start)).at(-1) || "";
    const after = Array.from(reference.slice(start + needle.length))[0] || "";
    if (useWordBoundaries && (lexical(before) || lexical(after))) continue;
    found = true;
    if (!protectedCharacters.slice(start, start + needle.length).every(Boolean)) return "A hint would reveal an occurrence of the target word.";
  }
  if (!found) return "The sentence does not contain the exact selected target form.";
  if (exercise.chunks.some(c => c.isTarget && clean(c.text) !== needle)) return "A protected chunk must contain only the target word or phrase.";
  return null;
}

export function isSavedData(x: unknown): x is SavedData {
  if (!record(x) || x.version !== 1 || !Array.isArray(x.items) || !Array.isArray(x.reviews) || x.items.length > 2000 || x.reviews.length > 50000) return false;
  const validItems = x.items.every(i => record(i) && requiredText(i.id, 100) && requiredText(i.sourceTerm, 160) && requiredText(i.targetTerm, 160) && text(i.sense, 600) && requiredText(i.sourceLanguage, 60) && requiredText(i.targetLanguage, 60) && ["A1", "A2", "B1", "B2", "C1", "C2"].includes(String(i.level)) && finite(i.dueAt) && finite(i.intervalDays) && Number.isInteger(i.reviewCount) && (i.reviewCount as number) >= 0 && Array.isArray(i.exercises) && i.exercises.length > 0 && i.exercises.length <= 200 && i.exercises.every(e => isExercise(e) && targetProtectionIssue(e, i.targetTerm as string) === null) && Number.isInteger(i.exerciseIndex) && (i.exerciseIndex as number) >= 0 && (i.exerciseIndex as number) < i.exercises.length);
  if (!validItems) return false;
  const ids = new Set(x.items.map(i => i.id));
  if (ids.size !== x.items.length) return false;
  return x.reviews.every(r => record(r) && text(r.id, 100) && text(r.itemId, 100) && text(r.exerciseId, 100) && text(r.answer, 4000) && ["forgot", "hard", "remembered"].includes(String(r.rating)) && finite(r.hintsUsed) && (r.lengthsShown === undefined || typeof r.lengthsShown === "boolean") && typeof r.shellShown === "boolean" && typeof r.targetRevealed === "boolean" && finite(r.createdAt));
}
