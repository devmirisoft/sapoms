import "server-only";

import OpenAI from "openai";

// Provider is chosen purely by env (Groq for testing, Gemini in production), both via
// their OpenAI-compatible endpoints. Swapping providers never needs a code change.
function requireEnv(name: "AI_BASE_URL" | "AI_API_KEY" | "AI_MODEL") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured. Set AI_BASE_URL, AI_API_KEY and AI_MODEL in .env.`);
  return value;
}

export const MODEL = requireEnv("AI_MODEL");

// The SDK retries 408/409/429/5xx and connection errors by status code with exponential
// backoff + jitter, honouring Retry-After: 3 attempts in all. The timeout keeps one slow
// call from eating the route's whole time budget.
export const llm = new OpenAI({ baseURL: requireEnv("AI_BASE_URL"), apiKey: requireEnv("AI_API_KEY"), maxRetries: 2, timeout: 20_000 });
