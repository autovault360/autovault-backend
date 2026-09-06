import { env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";
import { openRouterChat } from "./openrouter.client.js";
import { assertAndConsumeJennaQuota } from "./jenna.limiter.js";
import {
  buildDealershipSnapshot,
  findVehicles,
  snapshotToPromptText,
} from "./jenna.tools.js";

const PAGE_HINTS = [
  { page: "dashboard", keys: ["dashboard", "home", "overview"] },
  { page: "vehicles", keys: ["vehicle", "inventory", "cars", "lot", "stock"] },
  { page: "expenses", keys: ["expense", "bill", "spending", "overhead"] },
  { page: "profit", keys: ["profit", "p&l", "pnl", "loss"] },
  { page: "reps", keys: ["rep", "commission", "payroll", "sales rep"] },
  { page: "calendar", keys: ["calendar", "reminder", "schedule"] },
  { page: "messages", keys: ["message", "chat", "inbox"] },
];

function detectIntent(message) {
  const q = message.toLowerCase();
  if (/\b(scan|upload|receipt|document)\b/.test(q)) return "scan";
  if (/\b(open|show|go to|take me|navigate)\b/.test(q)) return "navigate";
  if (
    /\b(vin|camry|f-?150|silverado|accord|civic|mustang|corolla|truck|suv|car|vehicle|stock)\b/i.test(
      q,
    ) ||
    /\b[A-HJ-NPR-Z0-9]{11,17}\b/i.test(q)
  ) {
    return "vehicle_lookup";
  }
  return "general";
}

function detectNavigatePage(message) {
  const q = message.toLowerCase();
  for (const h of PAGE_HINTS) {
    if (h.keys.some((k) => q.includes(k))) return h.page;
  }
  return "dashboard";
}

function extractVehicleQuery(message) {
  const vin = message.match(/\b([A-HJ-NPR-Z0-9]{11,17})\b/i);
  if (vin) return vin[1];
  return message
    .replace(
      /\b(what|whats|what's|how|much|profit|cost|all-?in|on|the|for|about|tell|me|show|of|is|are|my)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function parseModelJson(text) {
  if (!text) return { answer: "", action: null };
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { answer: text.trim(), action: null };
  try {
    const j = JSON.parse(m[0]);
    return {
      answer: String(j.answer || j.text || text).trim(),
      action: j.action || null,
    };
  } catch {
    return { answer: text.trim(), action: null };
  }
}

function systemPrompt(crmBlock) {
  return [
    `You are Jenna, the AI assistant for AutoVault dealership CRM (admin portal).`,
    `Answer ONLY from the CRM DATA below. Use exact dollar amounts. Never invent figures.`,
    `If data is missing, say what is missing. Keep answers short but scannable.`,
    ``,
    `FORMAT the "answer" field in Markdown:`,
    `- Start with a one-line bold summary when useful`,
    `- Use bullet lists for multiple metrics (Inventory, Sales, Expenses, etc.)`,
    `- Bold key labels and numbers, e.g. **Active vehicles:** 12`,
    `- Use a short ## heading only if there are 2+ sections`,
    `- No HTML tags. No code fences around the whole answer.`,
    ``,
    `You may suggest UI actions. Reply as STRICT JSON only (answer may contain Markdown):`,
    `{"answer":"markdown string","action":null|{"type":"navigate","page":"dashboard|vehicles|expenses|profit|reps|calendar|messages"}|{"type":"vehicle","vin":"string"}|{"type":"scan"}}`,
    ``,
    `CRM DATA:`,
    crmBlock,
  ].join("\n");
}

export async function chat(dealershipId, { message, history = [] }, ctx = {}) {
  if (!env.JENNA_ENABLED) {
    throw new AppError(
      "Jenna AI is disabled. Set JENNA_ENABLED=true and OPENROUTER_API_KEY.",
      503,
      "JENNA_DISABLED",
    );
  }
  if (!env.OPENROUTER_API_KEY) {
    throw new AppError(
      "OPENROUTER_API_KEY is missing.",
      503,
      "JENNA_NOT_CONFIGURED",
    );
  }

  const quota = await assertAndConsumeJennaQuota(dealershipId);
  const intent = detectIntent(message);

  const snapshot = await buildDealershipSnapshot(dealershipId);
  let extra = "";
  let suggestedAction = null;

  if (intent === "scan") {
    suggestedAction = { type: "scan" };
  } else if (intent === "navigate") {
    suggestedAction = {
      type: "navigate",
      page: detectNavigatePage(message),
    };
  } else if (intent === "vehicle_lookup") {
    const matches = await findVehicles(dealershipId, extractVehicleQuery(message));
    if (matches.length) {
      extra =
        `\nVEHICLE MATCHES:\n` +
        matches.map((m) => m.line).join("\n");
      if (matches.length === 1) {
        suggestedAction = { type: "vehicle", vin: matches[0].vin };
      }
    } else {
      extra = `\nVEHICLE MATCHES: none found for that query.`;
    }
  }

  const crmBlock = snapshotToPromptText(snapshot) + extra;
  const messages = [
    ...(history || [])
      .slice(-6)
      .map((h) => ({ role: h.role, content: h.content.slice(0, 1500) })),
    { role: "user", content: message },
  ];

  const llm = await openRouterChat({
    purpose: "chat",
    system: systemPrompt(crmBlock),
    messages,
  });

  const parsed = parseModelJson(llm.text);
  const action = parsed.action || suggestedAction;

  return {
    answer: parsed.answer || "I could not form an answer from the CRM data.",
    action,
    meta: {
      intent,
      model: llm.model,
      models: {
        chat: env.JENNA_MODEL_CHAT,
        embed: env.JENNA_MODEL_EMBED,
      },
      quota,
      usage: llm.usage,
      asker: ctx.userId || null,
    },
  };
}

export function jennaStatus() {
  return {
    enabled: env.JENNA_ENABLED,
    configured: Boolean(env.OPENROUTER_API_KEY),
    models: {
      chat: env.JENNA_MODEL_CHAT,
      embed: env.JENNA_MODEL_EMBED,
    },
    dailyLimit: env.JENNA_DAILY_LIMIT,
    provider: "openrouter",
  };
}
