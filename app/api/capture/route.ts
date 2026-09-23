import { AppError, apiError, askAI, field, readBody } from "../../../lib/ai";
import { generatedSchema, generationPreferences, generationRules, readGeneratedWord } from "../../../lib/exercise-generation";
import { authorizeAI } from "../../../lib/server-access";

export const runtime = "nodejs";

/** Capture a clicked word using its sentence to resolve its meaning. */
export async function POST(request: Request) {
  try {
    const data = await readBody(request);
    const text = field(data, "text", 160), sentence = field(data, "sentence", 2000);
    const sourceLanguage = field(data, "sourceLanguage", 60), targetLanguage = field(data, "targetLanguage", 60);
    const level = field(data, "level", 160), goal = field(data, "goal", 600, true);
    if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) throw new AppError("Choose different source and target languages.");
    if (data.side !== "source" && data.side !== "target") throw new AppError("Choose a word from the source or translated sentence.");
    if (!sentence.normalize("NFC").toLocaleLowerCase().includes(text.normalize("NFC").toLocaleLowerCase())) throw new AppError("Choose a word that appears in this sentence.");
    const preferences = generationPreferences(data, targetLanguage);
    await authorizeAI(request);
    const value = await askAI(
      `${generationRules}\nThe learner clicked text inside sentence to save a vocabulary word. Interpret its exact meaning in that context. side=source means text is in sourceLanguage: preserve it as sourceTerm, and provide its contextually correct targetLanguage equivalent. side=target means text is in targetLanguage: preserve it as the fixed targetTerm, and give its sourceLanguage meaning as sourceTerm. Explain the intended sense briefly. Produce one NEW natural sourceSentence and referenceTranslation using this vocabulary for later practice. Do not translate the word in an unrelated dictionary sense.`,
      { text, side: data.side, sentence, sourceLanguage, targetLanguage, level, goal, ...preferences }, generatedSchema, "captured_vocabulary", 3000,
    );
    const word = readGeneratedWord(value, targetLanguage, data.side === "target" ? text : "");
    if (data.side === "source") word.sourceTerm = text;
    return Response.json(word);
  } catch (error) { return apiError(error); }
}
