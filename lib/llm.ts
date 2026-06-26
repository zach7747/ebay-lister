import OpenAI from "openai";

let client: OpenAI | null = null;

export function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env.local or your environment."
    );
  }
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }
  return client;
}

// Mirrors _load_model_json() in the Python script: strip code fences, then fall
// back to grabbing the outermost {...} block.
export function parseModelJson<T = unknown>(raw: string): T {
  let text = (raw || "").trim();
  text = text.replace(/^```(?:json)?\s*/gm, "").replace(/\s*```$/gm, "");
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
    throw new Error("Model did not return valid JSON.");
  }
}

// ── Account-level failures ─────────────────────────────────────────────────
export class LLMAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LLMAuthError";
    this.status = status;
  }
}

export function llmAuthError(e: unknown): LLMAuthError | null {
  const status =
    e && typeof e === "object" && "status" in e
      ? Number((e as { status?: number }).status)
      : undefined;
  const message =
    e && typeof e === "object" && "message" in e
      ? String((e as { message?: unknown }).message ?? "")
      : "";
  if (status === 401)
    return new LLMAuthError(
      "OpenRouter rejected your API key (401). Check that OPENROUTER_API_KEY is set correctly.",
      401
    );
  if (status === 403)
    return new LLMAuthError(
      "Your API key isn't permitted to use this model (403). Check your OpenRouter account.",
      403
    );
  if (status === 402 || /credit balance|too low|billing|payment|insufficient|quota/i.test(message))
    return new LLMAuthError(
      "Your account can't cover this request — add credits in your OpenRouter dashboard.",
      402
    );
  return null;
}
