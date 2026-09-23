export type SkillLevel = "beginner" | "intermediate" | "advanced" | "native";
export type SkillLevels = { speaking: SkillLevel; writing: SkillLevel; listening: SkillLevel; reading: SkillLevel };
export type ChineseScript = "simplified" | "traditional" | "both";

export const SKILLS = ["speaking", "writing", "listening", "reading"] as const;
export const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "native"] as const;
export const CHINESE_SCRIPTS = ["simplified", "traditional", "both"] as const;
const normalized = (language: string) => language.normalize("NFKC").trim().toLowerCase();

export function isChineseLanguage(language: string): boolean {
  const value = normalized(language);
  return /\b(chinese|mandarin|cantonese)\b/u.test(value) || /^(zh(?:[-_].*)?|中文|汉语|漢語|普通话|普通話|國語|国语|粵語|粤语|中国語)$/u.test(value);
}
export function isJapaneseLanguage(language: string): boolean {
  return /^(japanese|日本語|日语|日語|ja(?:[-_].*)?)$/u.test(normalized(language));
}
export function isSkillLevels(value: unknown): value is SkillLevels {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && SKILLS.every(skill => SKILL_LEVELS.includes((value as SkillLevels)[skill]));
}
export function skillSummary(skills: SkillLevels): string {
  return SKILLS.map(skill => `${skill[0].toUpperCase() + skill.slice(1)}: ${skills[skill]}`).join("; ");
}
/** Examples refer to the selected language; free text remains available for any goal. */
export function goalExample(language: string, script?: ChineseScript): string {
  const value = normalized(language);
  if (isJapaneseLanguage(value)) return "For example: prepare for JLPT N1, read Japanese novels, or chat with friends.";
  if (/cantonese|粵語|粤语/iu.test(value)) return "For example: chat naturally in Cantonese, follow Hong Kong films, or connect with family.";
  if (isChineseLanguage(value)) {
    if (script === "traditional") return "For example: prepare for TOCFL, read Taiwanese newspapers, or chat with friends.";
    if (script === "both") return "For example: prepare for HSK or TOCFL, read Chinese newspapers, or chat with friends.";
    return "For example: prepare for HSK, read Chinese newspapers, or chat with friends.";
  }
  if (/^(spanish|español|es(?:[-_].*)?)$/u.test(value)) return "For example: reach C1 or C2, prepare for DELE, or read Spanish newspapers.";
  if (/^(french|français|fr(?:[-_].*)?)$/u.test(value)) return "For example: reach C1 or C2, prepare for DALF, or chat with friends in French.";
  if (/^(german|deutsch|de(?:[-_].*)?)$/u.test(value)) return "For example: reach C1 or C2, prepare for a Goethe-Zertifikat, or read German novels.";
  if (/^(english|en(?:[-_].*)?)$/u.test(value)) return "For example: reach C1 or C2, prepare for IELTS, or feel comfortable at work.";
  if (/^(korean|한국어|ko(?:[-_].*)?)$/u.test(value)) return "For example: prepare for TOPIK, follow Korean dramas, or chat with friends.";
  return `For example: read books, hold everyday conversations, or use ${language.trim() || "this language"} at work.`;
}
