import { CHINESE_SCRIPTS, isSkillLevels, SKILLS, SKILL_LEVELS, type ChineseScript, type SkillLevels } from "./languages";
import { createEmptyCard, fsrs, Rating as FsrsRating, type Card } from "ts-fsrs";
import { isExercise, isSavedData, targetProtectionIssue, type Exercise, type Review, type VocabularyItem } from "./recall";

export type Rating = "forgot" | "hard" | "remembered";
/** JSON-safe FSRS state; dates are restored only at the scheduling boundary. */
export type Schedule = Omit<Card, "due" | "last_review"> & { due: string; last_review?: string };
export type Deck = { id: string; name: string; sourceLanguage: string; targetLanguage: string; level: string; goal: string; personalized: boolean; excludedTerms: string[]; skills?: SkillLevels; dailyGoal?: number; chineseScript?: ChineseScript };
export type Profile = { sourceLanguage: string; languages: string[]; goal: string; level: string; dailyGoal: number; onboarded: boolean; preferencesVersion?: 1 | 2; learningPreferences?: { language: string; skills?: SkillLevels; dailyGoal: number; chineseScript?: ChineseScript }[] };
export type OnboardingDraft = {
  sourceLanguage: string; languages: { targetLanguage: string; level: string; goal: string; skills: Partial<SkillLevels>; dailyGoal: number; chineseScript?: ChineseScript }[]; dailyGoal: number; step: number;
};
export type Item = VocabularyItem & { deckId: string; excluded?: boolean; schedule?: Schedule };
export type WritingCard = { id: string; itemId: string; character: string; schedule?: Schedule; dueAt: number; reviewCount: number };
export type V2Review = Review & { deckId: string; mode: "recall" | "writing"; character?: string; contexts?: AttemptContext[] };
export type AttemptContext = { exerciseId: string; answer: string; hintsUsed: number; lengthsShown: boolean; shellShown: boolean; targetRevealed: boolean; createdAt: number };
export type PendingAttempt = Omit<AttemptContext, "createdAt"> & { contexts: AttemptContext[] };
export type AppData = {
  version: 2; profile: Profile; decks: Deck[]; items: Item[]; reviews: V2Review[]; writingCards: WritingCard[];
  goalPausedDay?: string; goalContinuedDay?: string; languageGoalPausedDays?: Record<string, string>; languageGoalContinuedDays?: Record<string, string>; pendingAttempts?: Record<string, PendingAttempt>; writingHintedCards?: string[];
  onboardingDraft?: OnboardingDraft;
};
export type RecallHints = { hintsUsed: number; lengthsShown: boolean; shellShown: boolean; targetRevealed: boolean };

const DAY_MS = 86_400_000;
const scheduler = fsrs({ request_retention: 0.9, maximum_interval: 36500, enable_fuzz: false });
const fsrsRatings = { forgot: FsrsRating.Again, hard: FsrsRating.Hard, remembered: FsrsRating.Good } as const;

export function emptyData(): AppData {
  return { version: 2, profile: { sourceLanguage: "English", languages: [], goal: "", level: "A2", dailyGoal: 10, onboarded: false }, decks: [], items: [], reviews: [], writingCards: [] };
}

/** Local-calendar dates, rather than UTC dates, keep a learner's midnight intuitive. */
export function dayKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Repeating one word and writing practice do not inflate the daily vocabulary goal. */
export function dailyCount(data: AppData, now = Date.now()): number {
  const today = dayKey(now);
  return new Set(data.reviews.filter(review => review.mode === "recall" && dayKey(review.createdAt) === today).map(review => review.itemId)).size;
}

/** A learner's daily target belongs to the language across all of its decks. */
export function getLanguageGoal(data: AppData, language: string): number {
  const target = normalizeTerm(language);
  const preference = data.profile.learningPreferences?.find(row => normalizeTerm(row.language) === target);
  const deck = data.decks.find(row => normalizeTerm(row.targetLanguage) === target && row.dailyGoal !== undefined);
  return preference?.dailyGoal ?? deck?.dailyGoal ?? Math.min(100, Math.max(1, data.profile.dailyGoal));
}

export function dailyLanguageCount(data: AppData, language: string, now = Date.now()): number {
  const today = dayKey(now);
  const target = normalizeTerm(language);
  const items = new Set(data.items.filter(item => normalizeTerm(item.targetLanguage) === target).map(item => item.id));
  return new Set(data.reviews.filter(review => review.mode === "recall" && items.has(review.itemId)
    && dayKey(review.createdAt) === today).map(review => review.itemId)).size;
}

export function normalizeTerm(term: string): string {
  return term.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function isExcluded(deck: Deck, targetTerm: string): boolean {
  const normalized = normalizeTerm(targetTerm);
  return deck.excludedTerms.some(term => normalizeTerm(term) === normalized);
}

export function effectiveRating(rating: Rating, hints: RecallHints): Rating {
  if (hints.targetRevealed) return "forgot";
  if (rating === "remembered" && (hints.hintsUsed > 0 || hints.lengthsShown || hints.shellShown)) return "hard";
  return rating;
}

function serialize(card: Card): Schedule {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() };
}

function nextSchedule(previous: Schedule | undefined, rating: Rating, now: number): Schedule {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error("Invalid review time.");
  // A new object/date for every review prevents mutation of stored or previewed state.
  const card: Card = previous
    ? { ...previous, due: new Date(previous.due), last_review: previous.last_review ? new Date(previous.last_review) : undefined }
    : createEmptyCard(new Date(now));
  if (card.last_review && card.last_review.getTime() > now) throw new Error("Your device clock is earlier than the last review. Correct the clock before reviewing.");
  return serialize(scheduler.next(card, new Date(now), fsrsRatings[rating]).card);
}

export function reviewItem(item: Item, rating: Rating, hints: RecallHints, now = Date.now()): Item {
  const schedule = nextSchedule(item.schedule, effectiveRating(rating, hints), now);
  const dueAt = new Date(schedule.due).getTime();
  return { ...item, schedule, dueAt, intervalDays: Math.max(0, (dueAt - now) / DAY_MS), reviewCount: item.reviewCount + 1 };
}

export function reviewWriting(card: WritingCard, rating: Rating, usedHint: boolean, now = Date.now()): WritingCard {
  const effective = rating === "remembered" && usedHint ? "hard" : rating;
  const schedule = nextSchedule(card.schedule, effective, now);
  return { ...card, schedule, dueAt: new Date(schedule.due).getTime(), reviewCount: card.reviewCount + 1 };
}

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max: number): x is string => typeof x === "string" && x.length <= max;
const required = (x: unknown, max: number): x is string => text(x, max) && x.trim().length > 0;
const number = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max;
const integer = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => number(x, max) && Number.isSafeInteger(x);
const timestamp = (x: unknown): x is number => number(x, 8.64e15);
const uniqueIds = (rows: { id: string }[]) => new Set(rows.map(row => row.id)).size === rows.length;
const iso = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const calendarDay = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d\d-\d\d$/.test(x)
  && Number.isFinite(Date.parse(`${x}T12:00:00Z`)) && new Date(`${x}T12:00:00Z`).toISOString().slice(0, 10) === x;

function validSchedule(x: unknown): x is Schedule {
  if (!object(x) || !iso(x.due) || (x.last_review !== undefined && !iso(x.last_review))) return false;
  return number(x.stability, 1e9) && number(x.difficulty, 10) && number(x.elapsed_days, 1e7)
    && number(x.scheduled_days, 36500) && integer(x.learning_steps, 1000) && integer(x.reps, 1e9)
    && integer(x.lapses, 1e9) && integer(x.state, 3) && x.lapses <= x.reps
    && (x.state === 0 || (x.last_review !== undefined && x.stability > 0 && x.difficulty >= 1));
}

const validGoal = (x: unknown): x is number => integer(x, 100) && x >= 1;
const validScript = (x: unknown): x is ChineseScript => typeof x === "string" && CHINESE_SCRIPTS.includes(x as ChineseScript);
const validPartialSkills = (x: unknown): x is Partial<SkillLevels> => object(x)
  && SKILLS.every(skill => x[skill] === undefined || SKILL_LEVELS.includes(x[skill] as SkillLevels[typeof skill]));
const copySkills = (skills: Partial<SkillLevels>): Partial<SkillLevels> => Object.fromEntries(SKILLS
  .filter(skill => skills[skill] !== undefined).map(skill => [skill, skills[skill]]));

function validDeck(x: unknown): x is Deck {
  return object(x) && required(x.id, 100) && required(x.name, 160) && required(x.sourceLanguage, 100)
    && required(x.targetLanguage, 100) && required(x.level, 100) && text(x.goal, 2000)
    && typeof x.personalized === "boolean" && Array.isArray(x.excludedTerms) && x.excludedTerms.length <= 10000
    && x.excludedTerms.every(term => required(term, 160))
    && (x.skills === undefined || isSkillLevels(x.skills)) && (x.dailyGoal === undefined || validGoal(x.dailyGoal))
    && (x.chineseScript === undefined || validScript(x.chineseScript));
}

function validProfile(x: unknown): x is Profile {
  return object(x) && required(x.sourceLanguage, 100) && Array.isArray(x.languages) && x.languages.length <= 100
    && x.languages.every(language => required(language, 100)) && text(x.goal, 2000) && required(x.level, 100)
    && integer(x.dailyGoal, 500) && x.dailyGoal >= 1 && typeof x.onboarded === "boolean"
    && (!x.onboarded || x.languages.length > 0) && (x.preferencesVersion === undefined || x.preferencesVersion === 1 || x.preferencesVersion === 2)
    && (x.learningPreferences === undefined || (Array.isArray(x.learningPreferences) && x.learningPreferences.length <= 100
      && x.learningPreferences.every(row => object(row) && required(row.language, 100) && validGoal(row.dailyGoal)
        && (row.skills === undefined || isSkillLevels(row.skills)) && (row.chineseScript === undefined || validScript(row.chineseScript)))
      && new Set(x.learningPreferences.map(row => normalizeTerm(row.language as string))).size === x.learningPreferences.length));
}

/** Incomplete choices remain valid while the learner types or moves between steps. */
export function validOnboardingDraft(x: unknown): x is OnboardingDraft {
  return object(x) && text(x.sourceLanguage, 100) && Array.isArray(x.languages) && x.languages.length >= 1 && x.languages.length <= 100
    && x.languages.every(language => object(language) && text(language.targetLanguage, 100)
      && text(language.level, 100) && text(language.goal, 2000)
      && (language.skills === undefined || validPartialSkills(language.skills))
      && (language.dailyGoal === undefined || integer(language.dailyGoal, 100))
      && (language.chineseScript === undefined || validScript(language.chineseScript)))
    && integer(x.dailyGoal, 100) && integer(x.step, 2);
}

export function copyOnboardingDraft(draft: OnboardingDraft): OnboardingDraft {
  return { sourceLanguage: draft.sourceLanguage, languages: draft.languages.map(language => ({
    targetLanguage: language.targetLanguage, level: language.level, goal: language.goal,
    skills: copySkills(language.skills ?? {}), dailyGoal: language.dailyGoal ?? Math.min(100, Math.max(1, draft.dailyGoal)),
    chineseScript: language.chineseScript,
  })), dailyGoal: draft.dailyGoal, step: draft.step };
}

function validItem(x: unknown): x is Item {
  if (!object(x) || !required(x.id, 100) || !required(x.deckId, 100) || !required(x.sourceTerm, 160)
    || !required(x.targetTerm, 160) || !text(x.sense, 600) || !required(x.sourceLanguage, 100)
    || !required(x.targetLanguage, 100) || !required(x.level, 100) || !timestamp(x.dueAt)
    || !number(x.intervalDays, 1e7) || !integer(x.reviewCount, 1e9)
    || (x.excluded !== undefined && typeof x.excluded !== "boolean")
    || (x.schedule !== undefined && (!validSchedule(x.schedule) || Date.parse(x.schedule.due) !== x.dueAt))
    || !Array.isArray(x.exercises) || x.exercises.length > 200 || !integer(x.exerciseIndex)) return false;
  return x.exercises.every(exercise => isExercise(exercise) && targetProtectionIssue(exercise, x.targetTerm as string) === null)
    && uniqueIds(x.exercises as Exercise[]) && (x.exercises.length === 0 ? x.exerciseIndex === 0 : x.exerciseIndex < x.exercises.length);
}

function validWritingCard(x: unknown): x is WritingCard {
  return object(x) && required(x.id, 100) && required(x.itemId, 100) && required(x.character, 20)
    && Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(x.character)).length === 1
    && timestamp(x.dueAt) && integer(x.reviewCount, 1e9)
    && (x.schedule === undefined || (validSchedule(x.schedule) && Date.parse(x.schedule.due) === x.dueAt));
}

function validReview(x: unknown): x is V2Review {
  return object(x) && required(x.id, 100) && required(x.itemId, 100) && required(x.deckId, 100)
    && text(x.exerciseId, 100) && text(x.answer, 4000) && ["forgot", "hard", "remembered"].includes(String(x.rating))
    && integer(x.hintsUsed, 10000) && (x.lengthsShown === undefined || typeof x.lengthsShown === "boolean")
    && typeof x.shellShown === "boolean" && typeof x.targetRevealed === "boolean" && timestamp(x.createdAt)
    && (x.mode === "recall" || x.mode === "writing") && (x.character === undefined || required(x.character, 20))
    && (x.mode !== "writing" || required(x.character, 20))
    && (x.contexts === undefined || (Array.isArray(x.contexts) && x.contexts.length <= 500 && x.contexts.every(context => validAttempt(context, true))));
}

function validAttempt(x: unknown, historic: boolean): x is AttemptContext {
  return object(x) && required(x.exerciseId, 100) && text(x.answer, 4000) && integer(x.hintsUsed, 10000)
    && typeof x.lengthsShown === "boolean" && typeof x.shellShown === "boolean" && typeof x.targetRevealed === "boolean"
    && (!historic || timestamp(x.createdAt));
}

function copyAttempt(x: Omit<AttemptContext, "createdAt">): Omit<AttemptContext, "createdAt"> {
  return { exerciseId: x.exerciseId, answer: x.answer, hintsUsed: x.hintsUsed, lengthsShown: x.lengthsShown,
    shellShown: x.shellShown, targetRevealed: x.targetRevealed };
}

function copySchedule(schedule: Schedule | undefined): Schedule | undefined {
  if (!schedule) return undefined;
  return { due: schedule.due, stability: schedule.stability, difficulty: schedule.difficulty,
    elapsed_days: schedule.elapsed_days, scheduled_days: schedule.scheduled_days, learning_steps: schedule.learning_steps,
    reps: schedule.reps, lapses: schedule.lapses, state: schedule.state, last_review: schedule.last_review };
}

function copyExercise(exercise: Exercise): Exercise {
  return { id: exercise.id, sourceSentence: exercise.sourceSentence, referenceTranslation: exercise.referenceTranslation,
    origin: exercise.origin, sourceTargetText: exercise.sourceTargetText,
    simplifiedTranslation: exercise.simplifiedTranslation, traditionalTranslation: exercise.traditionalTranslation, chunks: exercise.chunks.map(chunk => ({ text: chunk.text, isTarget: chunk.isTarget })) };
}

function copyItem(item: Item): Item {
  return { id: item.id, deckId: item.deckId, sourceTerm: item.sourceTerm, targetTerm: item.targetTerm, sense: item.sense,
    sourceLanguage: item.sourceLanguage, targetLanguage: item.targetLanguage, level: item.level,
    exercises: item.exercises.map(copyExercise), exerciseIndex: item.exerciseIndex, dueAt: item.dueAt,
    intervalDays: item.intervalDays, reviewCount: item.reviewCount, excluded: item.excluded, schedule: copySchedule(item.schedule) };
}

function copyReview(review: V2Review): V2Review {
  return { id: review.id, itemId: review.itemId, deckId: review.deckId, exerciseId: review.exerciseId, answer: review.answer,
    rating: review.rating, hintsUsed: review.hintsUsed, lengthsShown: review.lengthsShown, shellShown: review.shellShown,
    targetRevealed: review.targetRevealed, createdAt: review.createdAt, mode: review.mode, character: review.character,
    contexts: review.contexts?.map(context => ({ ...copyAttempt(context), createdAt: context.createdAt })) };
}

function migrateLegacy(data: Parameters<typeof isSavedData>[0]): AppData | null {
  if (!isSavedData(data)) return null;
  const next = emptyData();
  const groups = new Map<string, Deck>();
  for (const item of data.items) {
    const key = JSON.stringify([item.sourceLanguage, item.targetLanguage, item.level]);
    let deck = groups.get(key);
    if (!deck) {
      deck = { id: `imported-deck-${groups.size + 1}`, name: `${item.targetLanguage} vocabulary`, sourceLanguage: item.sourceLanguage,
        targetLanguage: item.targetLanguage, level: item.level, goal: "", personalized: false, excludedTerms: [] };
      groups.set(key, deck);
      next.decks.push(deck);
    }
    next.items.push(copyItem({ ...item, deckId: deck.id }));
  }
  const deckByItem = new Map(next.items.map(item => [item.id, item.deckId]));
  const seenReviews = new Set<string>();
  next.reviews = data.reviews.flatMap((review, index) => {
    const deckId = deckByItem.get(review.itemId);
    if (!deckId) return [];
    const id = review.id && !seenReviews.has(review.id) ? review.id : `migrated-review-${index}`;
    seenReviews.add(id);
    return [copyReview({ ...review, id, deckId, mode: "recall" })];
  });
  if (next.decks.length) next.profile = { ...next.profile, sourceLanguage: next.decks[0].sourceLanguage,
    languages: [...new Set(next.decks.map(deck => deck.targetLanguage))], level: next.decks[0].level };
  return next;
}

/** Validate both local backups and remote snapshots; never blindly trust cloud JSON. */
export function parseData(input: unknown): AppData | null {
  if (object(input) && input.version === 1) {
    const migrated = migrateLegacy(input);
    return migrated ? parseData(migrated) : null;
  }
  if (!object(input) || input.version !== 2 || !validProfile(input.profile)
    || !Array.isArray(input.decks) || input.decks.length > 200 || !input.decks.every(validDeck)
    || !Array.isArray(input.items) || input.items.length > 2000 || !input.items.every(validItem)
    || !Array.isArray(input.reviews) || input.reviews.length > 100000 || !input.reviews.every(validReview)
    || !Array.isArray(input.writingCards) || input.writingCards.length > 10000 || !input.writingCards.every(validWritingCard)) return null;
  const data = input as AppData;
  if (![data.decks, data.items, data.reviews, data.writingCards].every(uniqueIds)) return null;
  const decks = new Map(data.decks.map(deck => [deck.id, deck]));
  const items = new Map(data.items.map(item => [item.id, item]));
  if (data.items.some(item => {
    const deck = decks.get(item.deckId);
    return !deck || normalizeTerm(deck.sourceLanguage) !== normalizeTerm(item.sourceLanguage)
      || normalizeTerm(deck.targetLanguage) !== normalizeTerm(item.targetLanguage);
  })) return null;
  if (data.reviews.some(review => !items.has(review.itemId) || items.get(review.itemId)!.deckId !== review.deckId)) return null;
  if (data.writingCards.some(card => !items.has(card.itemId))) return null;
  if (new Set(data.writingCards.map(card => JSON.stringify([card.itemId, card.character]))).size !== data.writingCards.length) return null;
  if ((data.goalPausedDay !== undefined && !calendarDay(data.goalPausedDay))
    || (data.goalContinuedDay !== undefined && !calendarDay(data.goalContinuedDay))) return null;
  for (const days of [data.languageGoalPausedDays, data.languageGoalContinuedDays]) {
    if (days !== undefined && (!object(days) || Object.keys(days).length > 100
      || Object.entries(days).some(([language, day]) => !required(language, 100) || normalizeTerm(language) !== language || !calendarDay(day)))) return null;
  }
  if (data.onboardingDraft !== undefined && !validOnboardingDraft(data.onboardingDraft)) return null;
  if (data.pendingAttempts !== undefined) {
    if (!object(data.pendingAttempts) || Object.keys(data.pendingAttempts).length > 2000) return null;
    for (const [itemId, pending] of Object.entries(data.pendingAttempts)) {
      if (!items.has(itemId) || !validAttempt(pending, false) || !Array.isArray(pending.contexts) || pending.contexts.length > 500
        || !pending.contexts.every(context => validAttempt(context, true))
        || !items.get(itemId)!.exercises.some(exercise => exercise.id === pending.exerciseId)) return null;
    }
  }
  if (data.writingHintedCards !== undefined && (!Array.isArray(data.writingHintedCards) || data.writingHintedCards.length > 10000
    || data.writingHintedCards.some(id => !data.writingCards.some(card => card.id === id)))) return null;
  return { version: 2, profile: { sourceLanguage: data.profile.sourceLanguage, languages: [...data.profile.languages],
    goal: data.profile.goal, level: data.profile.level, dailyGoal: data.profile.dailyGoal, onboarded: data.profile.onboarded,
    preferencesVersion: data.profile.preferencesVersion,
    learningPreferences: data.profile.learningPreferences?.map(row => ({ language: row.language, dailyGoal: row.dailyGoal,
      skills: row.skills && { ...row.skills }, chineseScript: row.chineseScript })) },
    decks: data.decks.map(deck => ({ id: deck.id, name: deck.name, sourceLanguage: deck.sourceLanguage, targetLanguage: deck.targetLanguage,
      level: deck.level, goal: deck.goal, skills: deck.skills && { ...deck.skills }, dailyGoal: deck.dailyGoal, chineseScript: deck.chineseScript, personalized: deck.personalized, excludedTerms: [...new Set(deck.excludedTerms.map(normalizeTerm))] })),
    items: data.items.map(copyItem), reviews: data.reviews.map(copyReview),
    writingCards: data.writingCards.map(card => ({ id: card.id, itemId: card.itemId, character: card.character,
      dueAt: card.dueAt, reviewCount: card.reviewCount, schedule: copySchedule(card.schedule) })),
    goalPausedDay: data.goalPausedDay, goalContinuedDay: data.goalContinuedDay,
    languageGoalPausedDays: data.languageGoalPausedDays && { ...data.languageGoalPausedDays },
    languageGoalContinuedDays: data.languageGoalContinuedDays && { ...data.languageGoalContinuedDays },
    pendingAttempts: data.pendingAttempts && Object.fromEntries(Object.entries(data.pendingAttempts).map(([id, pending]) => [id,
      { ...copyAttempt(pending), contexts: pending.contexts.map(context => ({ ...copyAttempt(context), createdAt: context.createdAt })) }])),
    writingHintedCards: data.writingHintedCards && [...new Set(data.writingHintedCards)],
    onboardingDraft: data.onboardingDraft && copyOnboardingDraft(data.onboardingDraft) };
}
