import { env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_TOKENS = 700;
const TEMPERATURE = 0.3;
const APP_TITLE = "AutoVault Jenna";

/**
 * OpenRouter chat completion.
 * @param {object} opts
 * @param {'chat'|'router'} [opts.purpose]
 * @param {string} [opts.model]
 * @param {string} [opts.system]
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 */
export async function openRouterChat({
  purpose = "chat",
  model,
  system,
  messages,
  maxTokens,
  temperature,
} = {}) {
  if (!env.OPENROUTER_API_KEY) {
    throw new AppError(
      "OpenRouter is not configured. Set OPENROUTER_API_KEY.",
      503,
      "JENNA_NOT_CONFIGURED",
    );
  }

  // Router reuses chat model until you add a separate env later
  const modelId = model || env.JENNA_MODEL_CHAT;

  const body = {
    model: modelId,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...(messages || []),
    ],
    max_tokens: maxTokens ?? MAX_TOKENS,
    temperature: temperature ?? TEMPERATURE,
  };

  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.FRONTEND_URL || "http://localhost:5500",
      "X-Title": APP_TITLE,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `OpenRouter error ${res.status}`;
    const code = res.status === 429 ? "JENNA_RATE_LIMITED" : "JENNA_PROVIDER_ERROR";
    throw new AppError(msg, res.status === 429 ? 429 : 502, code, {
      providerStatus: res.status,
      model: modelId,
    });
  }

  const text =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    "";

  return {
    text: String(text || "").trim(),
    model: data?.model || modelId,
    usage: data?.usage || null,
    raw: data,
  };
}

/** Placeholder for Phase 2 — do not call until you have embedding credits. */
export function getEmbedModelId() {
  return env.JENNA_MODEL_EMBED;
}
