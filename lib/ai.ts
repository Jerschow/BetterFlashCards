export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
export async function askAI(instructions: string, input: unknown, schema: unknown, name: string, maxOutputTokens = 2200): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("replace_me") || apiKey.includes("your_key")) throw new AppError("Add OPENAI_API_KEY to .env.local in your project folder, then restart npm run dev. The sample exercises work without a key.", 503);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", store: false, instructions, input: JSON.stringify(input), max_output_tokens: maxOutputTokens, text: { format: { type: "json_schema", name, strict: true, schema } } }),
    });
    if (!response.ok) {
      if (response.status === 401) throw new AppError("The API key was rejected. Check OPENAI_API_KEY and restart the development server.", 502);
      if (response.status === 429) throw new AppError("The AI provider reports a quota or rate limit. Check your API billing and limits, or retry later.", 429);
      throw new AppError(`The AI request failed (provider status ${response.status}). Check your model access and try again.`, 502);
    }
    const result: unknown = await response.json();
    if (!object(result) || result.status !== "completed" || !Array.isArray(result.output)) throw new AppError("The AI response was incomplete. Try again.", 502);
    const texts: string[] = [];
    for (const item of result.output) {
      if (!object(item) || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (!object(part)) continue;
        if (part.type === "refusal") throw new AppError("The model could not generate this exercise. Try another word or a clearer meaning.", 422);
        if (part.type === "output_text" && typeof part.text === "string") texts.push(part.text);
      }
    }
    try { return JSON.parse(texts.join("")); }
    catch { throw new AppError("The model returned an unreadable response. Try again.", 502); }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("The AI service could not be reached or took too long. Your saved vocabulary is unchanged; please retry.", 502);
  }
}

export function field(data: Record<string, unknown>, name: string, max: number, optional = false): string {
  const value = data[name];
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string" || value.length > max || (!optional && !value.trim())) throw new AppError(`Check the ${name} field.`);
  return value.normalize("NFC").trim();
}


export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("The request body is missing.");
  const decoder = new TextDecoder(); let raw = ""; let bytes = 0;
  while (true) { const {value, done} = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 100000) { await reader.cancel(); throw new AppError("This request is too large.", 413); }
    raw += decoder.decode(value, {stream:true});
  }
  raw += decoder.decode();
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new AppError("Invalid request format."); }
  if (!object(parsed)) throw new AppError("Invalid request format.");
  return parsed;
}
export function apiError(error: unknown): Response {
  const e = error as {status?:number;message?:string};
  const known = Number.isInteger(e?.status) && e.status! >= 400 && e.status! <= 599;
  return Response.json({error:known ? e.message : "Something went wrong. Please retry."}, {status:known ? e.status : 500});
}
