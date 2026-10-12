import { AppError, askAI, field, object, readBody, apiError } from "../../../lib/ai";
import { generatedSchema, generationPreferences, generationRules, readGeneratedWord } from "../../../lib/exercise-generation";
import { authorizeGeneration } from "../../../lib/server-access";

export const runtime = "nodejs";
const schema = { type: "object", additionalProperties: false, properties: { words: { type: "array", items: generatedSchema } }, required: ["words"] };
const normalize = (text: string) => text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
function terms(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2000 || !value.every(x => typeof x === "string" && x.length <= 160)) throw new AppError("The vocabulary exclusion list is invalid or too large.");
  return value as string[];
}

export async function POST(request: Request) {
  let generation: Awaited<ReturnType<typeof authorizeGeneration>> | undefined;
  try {
    const data = await readBody(request);
    const sourceLanguage = field(data, "sourceLanguage", 60), targetLanguage = field(data, "targetLanguage", 60);
    const level = field(data, "level", 160), goal = field(data, "goal", 600);
    if (normalize(sourceLanguage) === normalize(targetLanguage)) throw new AppError("Choose different source and target languages.");
    const requestedCount = data.count === undefined ? 5 : data.count;
    if (typeof requestedCount !== "number" || !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 10) throw new AppError("Choose between 1 and 10 new words per batch.");
    const preferences = generationPreferences(data, targetLanguage);
    const excludedTerms = terms(data.excludedTerms), existingTerms = terms(data.existingTerms);
    const blocked = new Set([...excludedTerms, ...existingTerms].map(normalize));
    generation = await authorizeGeneration(request, requestedCount);
    const count = generation.count;
    const result = await askAI(
      `${generationRules}\nSelect exactly count useful, distinct words or short phrases in targetLanguage for this learner's level, individual skills and goal. Exclude excludedTerms and existingTerms, including spelling/case variants; never reintroduce an excluded word. Do not claim an official exam vocabulary list or certification. Include one exercise per word for immediate practice. Avoid obscure words unless the goal requires them; do not invent words if support for the language is limited.`,
      { sourceLanguage, targetLanguage, level, goal, ...preferences, count, excludedTerms, existingTerms }, schema, "personalized_vocabulary", Math.min(16000, 1000 + count * 1300),
    );
    if (!object(result) || !Array.isArray(result.words) || result.words.length !== count) throw new AppError("The generated word list was incomplete. Please retry.", 502);
    const words = result.words.map(value => {
      const word = readGeneratedWord(value, targetLanguage);
      const key = normalize(word.targetTerm);
      if (blocked.has(key)) throw new AppError("The model repeated an existing or excluded word. Please retry; nothing has been added.", 502);
      blocked.add(key);
      return word;
    });
    const guest = await generation.complete();
    return Response.json({ words, ...(guest ? { guest } : {}) });
  } catch (error) {
    await generation?.cancel(); return apiError(error); }
}
