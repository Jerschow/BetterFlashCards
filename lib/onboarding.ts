import { isChineseLanguage, isSkillLevels, skillSummary } from "./languages";
import { copyOnboardingDraft, getLanguageGoal, normalizeTerm, validOnboardingDraft, type AppData, type Deck, type OnboardingDraft } from "./model";

/** Old demo/legacy completion flags do not stand in for actually choosing preferences. */
export function needsOnboarding(data: AppData): boolean {
  return !data.profile.onboarded || data.profile.preferencesVersion !== 2;
}

export function getOnboardingDraft(data: AppData): OnboardingDraft {
  if (data.onboardingDraft) return copyOnboardingDraft(data.onboardingDraft);
  const sourceLanguage = data.profile.sourceLanguage || data.decks[0]?.sourceLanguage || "English";
  const source = normalizeTerm(sourceLanguage);
  const matchingDecks = data.decks.filter(deck => normalizeTerm(deck.sourceLanguage) === source);
  const languages: OnboardingDraft["languages"] = [];
  const seen = new Set<string>();
  const selectedLanguages = (data.profile.preferencesVersion === 1 || data.profile.preferencesVersion === 2) ? data.profile.languages
    : [...data.profile.languages, ...matchingDecks.map(deck => deck.targetLanguage)];
  for (const targetLanguage of selectedLanguages) {
    const normalized = normalizeTerm(targetLanguage);
    if (!normalized || normalized === source || seen.has(normalized) || languages.length === 100) continue;
    seen.add(normalized);
    const deck = matchingDecks.find(candidate => normalizeTerm(candidate.targetLanguage) === normalized);
    // When a deck for this language uses another source, its settings belong to that pair.
    const differentSource = data.decks.some(candidate => normalizeTerm(candidate.targetLanguage) === normalized
      && normalizeTerm(candidate.sourceLanguage) !== source);
    if (!deck && differentSource) continue;
    const preference = data.profile.learningPreferences?.find(row => normalizeTerm(row.language) === normalized);
    const skills = preference?.skills ?? deck?.skills;
    languages.push({ targetLanguage: deck?.targetLanguage || targetLanguage,
      level: deck?.level ?? data.profile.level, goal: deck?.goal ?? data.profile.goal,
      skills: skills ? { ...skills } : {}, dailyGoal: getLanguageGoal(data, targetLanguage),
      chineseScript: isChineseLanguage(targetLanguage) ? preference?.chineseScript ?? deck?.chineseScript : undefined });
  }
  return { sourceLanguage, languages: languages.length ? languages : [{ targetLanguage: "", level: "", goal: "", skills: {}, dailyGoal: Math.min(100, Math.max(1, data.profile.dailyGoal)) }],
    dailyGoal: Math.min(100, Math.max(1, data.profile.dailyGoal)), step: 0 };
}

/** Finish setup without replacing old decks, schedules, exclusions, or unfinished attempts. */
export function prepareOnboarding(data: AppData, draft: OnboardingDraft, personalized: boolean): { next: AppData; primary: Deck } {
  if (!validOnboardingDraft(draft)) throw new Error("Some preferences are invalid. Check the language, level, goal, and daily target.");
  if (typeof personalized !== "boolean") throw new Error("Choose personalized vocabulary or your own deck.");
  const sourceLanguage = draft.sourceLanguage.trim();
  if (!sourceLanguage) throw new Error("Choose the language you want to translate from.");
  if (!draft.languages.length) throw new Error("Choose at least one language to learn.");
  const source = normalizeTerm(sourceLanguage);
  const seen = new Set<string>();
  const languages = draft.languages.map(language => {
    const targetLanguage = language.targetLanguage.trim();

    const goal = language.goal.trim();
    const target = normalizeTerm(targetLanguage);
    if (!target) throw new Error("Choose a language for every row, or remove the empty row.");
    if (target === source) throw new Error("Choose a learning language different from your translation language.");
    if (seen.has(target)) throw new Error("Each learning language should appear only once.");
    seen.add(target);
    if (!isSkillLevels(language.skills)) throw new Error(`Choose one level for speaking, writing, listening, and reading in ${targetLanguage}.`);
    if (!Number.isInteger(language.dailyGoal) || language.dailyGoal < 1 || language.dailyGoal > 100) {
      throw new Error(`Choose a daily target from 1 to 100 words for ${targetLanguage}.`);
    }
    if (isChineseLanguage(targetLanguage) && !language.chineseScript) throw new Error("Choose simplified, traditional, or both for Chinese.");
    if (!goal) throw new Error(`Tell us your goal for ${targetLanguage}.`);
    return { targetLanguage, level: skillSummary(language.skills), goal, skills: { ...language.skills },
      dailyGoal: language.dailyGoal, chineseScript: isChineseLanguage(targetLanguage) ? language.chineseScript : undefined };
  });

  const missingCount = languages.filter(language => !data.decks.some(deck => normalizeTerm(deck.sourceLanguage) === source
    && normalizeTerm(deck.targetLanguage) === normalizeTerm(language.targetLanguage))).length;
  if (data.decks.length + missingCount > 200) throw new Error("There is room for up to 200 decks. Remove an unused deck before adding more languages.");

  const next: AppData = structuredClone(data);
  const selected: Deck[] = [];
  for (const language of languages) {
    const existingIndex = next.decks.findIndex(deck => normalizeTerm(deck.sourceLanguage) === source
      && normalizeTerm(deck.targetLanguage) === normalizeTerm(language.targetLanguage));
    let deck: Deck;
    if (existingIndex >= 0) {
      deck = { ...next.decks[existingIndex], level: language.level, goal: language.goal, skills: language.skills,
        dailyGoal: language.dailyGoal, chineseScript: language.chineseScript, personalized };
      next.decks[existingIndex] = deck;
    } else {
      deck = { id: crypto.randomUUID(), name: `${language.targetLanguage} practice`, sourceLanguage,
        targetLanguage: language.targetLanguage, level: language.level, goal: language.goal, skills: language.skills,
        dailyGoal: language.dailyGoal, chineseScript: language.chineseScript, personalized, excludedTerms: [] };
      next.decks.push(deck);
    }
    selected.push(deck);
  }
  const first = languages[0];
  next.profile = { sourceLanguage, languages: languages.map(language => language.targetLanguage), level: first.level,
    goal: first.goal, dailyGoal: first.dailyGoal, onboarded: true, preferencesVersion: 2,
    learningPreferences: languages.map(language => ({ language: language.targetLanguage, skills: { ...language.skills },
      dailyGoal: language.dailyGoal, chineseScript: language.chineseScript })) };
  next.onboardingDraft = undefined;
  return { next, primary: selected[0] };
}
